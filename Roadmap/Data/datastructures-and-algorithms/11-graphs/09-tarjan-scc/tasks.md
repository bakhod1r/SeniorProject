# Tarjan's SCC — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task gives a statement, constraints, hints, and a reference solution in all three languages.
> Unless stated otherwise, vertices are `0..n-1` and graphs are given as an edge list.

---

## Beginner Tasks (5)

### Task 1 — Count strongly connected components

**Problem.** Given a directed graph, return the number of SCCs.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`. Time `O(V + E)`.

**Hint.** Run Tarjan; each time `low[u] == disc[u]` after finishing `u`, you have found one root → one SCC.

**Go.**
```go
package main

import "fmt"

func countSCC(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx, count := 0, 0

	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			count++
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				if w == u {
					break
				}
			}
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return count
}

func main() {
	fmt.Println(countSCC(5, [][]int{{0, 1}, {1, 2}, {2, 0}, {3, 4}}))
	// 3: {0,1,2}, {3}, {4}
}
```

**Java.**
```java
import java.util.*;

public class Task1 {
    static List<List<Integer>> adj;
    static int[] disc, low;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, count = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) {
                dfs(v);
                low[u] = Math.min(low[u], low[v]);
            } else if (onStack[v]) {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (low[u] == disc[u]) {
            count++;
            int w;
            do { w = stack.pop(); onStack[w] = false; } while (w != u);
        }
    }

    static int countSCC(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countSCC(5, new int[][]{{0,1},{1,2},{2,0},{3,4}})); // 3
    }
}
```

**Python.**
```python
import sys


def count_scc(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack, idx, count = [], 0, 0

    def dfs(u):
        nonlocal idx, count
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            count += 1
            while True:
                w = stack.pop()
                on_stack[w] = False
                if w == u:
                    break

    for u in range(n):
        if disc[u] == -1:
            dfs(u)
    return count


if __name__ == "__main__":
    print(count_scc(5, [[0, 1], [1, 2], [2, 0], [3, 4]]))  # 3
```

---

### Task 2 — Detect a directed cycle

**Problem.** Return `true` if the directed graph contains a cycle.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** A cycle exists iff some SCC has size ≥ 2 or some vertex has a self-loop. Reuse Task 1 and track component sizes; also scan for self-loops.

**Go.**
```go
package main

import "fmt"

func hasCycle(n int, edges [][]int) bool {
	adj := make([][]int, n)
	selfLoop := false
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		if e[0] == e[1] {
			selfLoop = true
		}
	}
	if selfLoop {
		return true
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx := 0
	cyc := false

	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			size := 0
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				size++
				if w == u {
					break
				}
			}
			if size > 1 {
				cyc = true
			}
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return cyc
}

func main() {
	fmt.Println(hasCycle(3, [][]int{{0, 1}, {1, 2}, {2, 0}})) // true
	fmt.Println(hasCycle(3, [][]int{{0, 1}, {1, 2}}))         // false
}
```

**Java.**
```java
import java.util.*;

public class Task2 {
    static List<List<Integer>> adj;
    static int[] disc, low;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0;
    static boolean cyc = false;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) {
                dfs(v);
                low[u] = Math.min(low[u], low[v]);
            } else if (onStack[v]) {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (low[u] == disc[u]) {
            int size = 0, w;
            do { w = stack.pop(); onStack[w] = false; size++; } while (w != u);
            if (size > 1) cyc = true;
        }
    }

    static boolean hasCycle(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        boolean selfLoop = false;
        for (int[] e : edges) {
            adj.get(e[0]).add(e[1]);
            if (e[0] == e[1]) selfLoop = true;
        }
        if (selfLoop) return true;
        disc = new int[n]; low = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        return cyc;
    }

    public static void main(String[] args) {
        System.out.println(hasCycle(3, new int[][]{{0,1},{1,2},{2,0}})); // true
        System.out.println(hasCycle(3, new int[][]{{0,1},{1,2}}));       // false
    }
}
```

**Python.**
```python
import sys


def has_cycle(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        if a == b:
            return True
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack, idx = [], 0
    cyc = False

    def dfs(u):
        nonlocal idx, cyc
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            size = 0
            while True:
                w = stack.pop()
                on_stack[w] = False
                size += 1
                if w == u:
                    break
            if size > 1:
                cyc = True

    for u in range(n):
        if disc[u] == -1:
            dfs(u)
    return cyc


if __name__ == "__main__":
    print(has_cycle(3, [[0, 1], [1, 2], [2, 0]]))  # True
    print(has_cycle(3, [[0, 1], [1, 2]]))          # False
```

---

### Task 3 — Assign an SCC id to every vertex

**Problem.** Return an array `comp` where `comp[v]` is the SCC index of vertex `v`. Number components in Tarjan's emission order (`0, 1, 2, ...`).

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** When popping an SCC, assign the current component counter to every popped vertex, then increment.

**Go.**
```go
package main

import "fmt"

func sccIDs(n int, edges [][]int) []int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0

	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp
}

func main() {
	fmt.Println(sccIDs(5, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}}))
}
```

**Java.**
```java
import java.util.*;

public class Task3 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) {
                dfs(v);
                low[u] = Math.min(low[u], low[v]);
            } else if (onStack[v]) {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static int[] sccIDs(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        return comp;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            sccIDs(5, new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4}})));
    }
}
```

**Python.**
```python
import sys


def scc_ids(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)
    return comp


if __name__ == "__main__":
    print(scc_ids(5, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4]]))
```

---

### Task 4 — Is the graph strongly connected?

**Problem.** Return `true` iff the entire directed graph is one SCC (every vertex reaches every other).

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`. A single vertex is trivially strongly connected.

**Hint.** Count SCCs; the graph is strongly connected iff exactly one SCC exists.

**Go.**
```go
package main

import "fmt"

func isStronglyConnected(n int, edges [][]int) bool {
	return countSCC(n, edges) == 1
}

func countSCC(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx, count := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			count++
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				if w == u {
					break
				}
			}
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return count
}

func main() {
	fmt.Println(isStronglyConnected(3, [][]int{{0, 1}, {1, 2}, {2, 0}})) // true
	fmt.Println(isStronglyConnected(3, [][]int{{0, 1}, {1, 2}}))         // false
}
```

**Java.**
```java
import java.util.*;

public class Task4 {
    static List<List<Integer>> adj;
    static int[] disc, low;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, count = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            count++;
            int w;
            do { w = stack.pop(); onStack[w] = false; } while (w != u);
        }
    }

    static boolean isStronglyConnected(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        return count == 1;
    }

    public static void main(String[] args) {
        System.out.println(isStronglyConnected(3, new int[][]{{0,1},{1,2},{2,0}})); // true
        System.out.println(isStronglyConnected(3, new int[][]{{0,1},{1,2}}));       // false
    }
}
```

**Python.**
```python
import sys


def is_strongly_connected(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack, idx, count = [], 0, 0

    def dfs(u):
        nonlocal idx, count
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            count += 1
            while True:
                w = stack.pop()
                on_stack[w] = False
                if w == u:
                    break

    for u in range(n):
        if disc[u] == -1:
            dfs(u)
    return count == 1


if __name__ == "__main__":
    print(is_strongly_connected(3, [[0, 1], [1, 2], [2, 0]]))  # True
    print(is_strongly_connected(3, [[0, 1], [1, 2]]))          # False
```

---

### Task 5 — Largest SCC size

**Problem.** Return the number of vertices in the largest SCC.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Track the size of each popped component and keep the maximum.

**Go.**
```go
package main

import "fmt"

func largestSCC(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx, best := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			size := 0
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				size++
				if w == u {
					break
				}
			}
			if size > best {
				best = size
			}
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return best
}

func main() {
	fmt.Println(largestSCC(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}))
	// 3
}
```

**Java.**
```java
import java.util.*;

public class Task5 {
    static List<List<Integer>> adj;
    static int[] disc, low;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, best = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int size = 0, w;
            do { w = stack.pop(); onStack[w] = false; size++; } while (w != u);
            best = Math.max(best, size);
        }
    }

    static int largestSCC(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        return best;
    }

    public static void main(String[] args) {
        System.out.println(largestSCC(6, new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}})); // 3
    }
}
```

**Python.**
```python
import sys


def largest_scc(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack, idx, best = [], 0, 0

    def dfs(u):
        nonlocal idx, best
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            size = 0
            while True:
                w = stack.pop()
                on_stack[w] = False
                size += 1
                if w == u:
                    break
            best = max(best, size)

    for u in range(n):
        if disc[u] == -1:
            dfs(u)
    return best


if __name__ == "__main__":
    print(largest_scc(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))  # 3
```

---

## Intermediate Tasks (5)

### Task 6 — Build the condensation DAG

**Problem.** Return the condensation as an adjacency list over SCC ids (deduplicated edges).

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** First compute `comp[v]` (Task 3). Then for each edge `u → v` with different components, add `comp[u] → comp[v]`, dedup with a set.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func condensation(n int, edges [][]int) [][]int {
	comp, k := sccIDs(n, edges)
	seen := make(map[[2]int]bool)
	dag := make([][]int, k)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !seen[[2]int{cu, cv}] {
			seen[[2]int{cu, cv}] = true
			dag[cu] = append(dag[cu], cv)
		}
	}
	for _, lst := range dag {
		sort.Ints(lst)
	}
	return dag
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(condensation(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}))
}
```

**Java.**
```java
import java.util.*;

public class Task6 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static List<List<Integer>> condensation(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);

        List<TreeSet<Integer>> dag = new ArrayList<>();
        for (int i = 0; i < cid; i++) dag.add(new TreeSet<>());
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv) dag.get(cu).add(cv);
        }
        List<List<Integer>> out = new ArrayList<>();
        for (TreeSet<Integer> s : dag) out.add(new ArrayList<>(s));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(condensation(6,
            new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}}));
    }
}
```

**Python.**
```python
import sys


def condensation(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    dag = [set() for _ in range(cid)]
    for a, b in edges:
        if comp[a] != comp[b]:
            dag[comp[a]].add(comp[b])
    return [sorted(s) for s in dag]


if __name__ == "__main__":
    print(condensation(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))
```

---

### Task 7 — Course schedule (cycle in prerequisites)

**Problem.** Given `numCourses` and prerequisite pairs `[a, b]` meaning "take `b` before `a`", return `true` if all courses can be finished (i.e. the prerequisite graph is acyclic).

**Constraints.** `1 <= numCourses <= 10^5`, `0 <= prerequisites <= 10^5`.

**Hint.** Build edge `b → a`. The schedule is feasible iff no SCC has size ≥ 2 (no cycle).

**Go.**
```go
package main

import "fmt"

func canFinish(numCourses int, prerequisites [][]int) bool {
	edges := make([][]int, 0, len(prerequisites))
	for _, p := range prerequisites {
		edges = append(edges, []int{p[1], p[0]}) // b -> a
	}
	return !hasCycle(numCourses, edges)
}

func hasCycle(n int, edges [][]int) bool {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx := 0
	cyc := false
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			size := 0
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				size++
				if w == u {
					break
				}
			}
			if size > 1 {
				cyc = true
			}
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return cyc
}

func main() {
	fmt.Println(canFinish(2, [][]int{{1, 0}}))         // true
	fmt.Println(canFinish(2, [][]int{{1, 0}, {0, 1}})) // false
}
```

**Java.**
```java
import java.util.*;

public class Task7 {
    static List<List<Integer>> adj;
    static int[] disc, low;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0;
    static boolean cyc = false;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int size = 0, w;
            do { w = stack.pop(); onStack[w] = false; size++; } while (w != u);
            if (size > 1) cyc = true;
        }
    }

    static boolean canFinish(int numCourses, int[][] prerequisites) {
        adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
        for (int[] p : prerequisites) adj.get(p[1]).add(p[0]); // b -> a
        disc = new int[numCourses]; low = new int[numCourses]; onStack = new boolean[numCourses];
        Arrays.fill(disc, -1);
        for (int u = 0; u < numCourses; u++) if (disc[u] == -1) dfs(u);
        return !cyc;
    }

    public static void main(String[] args) {
        System.out.println(canFinish(2, new int[][]{{1,0}}));        // true
        System.out.println(canFinish(2, new int[][]{{1,0},{0,1}}));  // false
    }
}
```

**Python.**
```python
import sys


def can_finish(num_courses, prerequisites):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(num_courses)]
    for a, b in prerequisites:
        adj[b].append(a)  # b -> a
    disc = [-1] * num_courses
    low = [0] * num_courses
    on_stack = [False] * num_courses
    stack, idx = [], 0
    cyc = False

    def dfs(u):
        nonlocal idx, cyc
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            size = 0
            while True:
                w = stack.pop()
                on_stack[w] = False
                size += 1
                if w == u:
                    break
            if size > 1:
                cyc = True

    for u in range(num_courses):
        if disc[u] == -1:
            dfs(u)
    return not cyc


if __name__ == "__main__":
    print(can_finish(2, [[1, 0]]))          # True
    print(can_finish(2, [[1, 0], [0, 1]]))  # False
```

---

### Task 8 — Iterative Tarjan (overflow-safe)

**Problem.** Implement Tarjan **without recursion** and return the SCC count. Must survive a path graph of `10^6` vertices.

**Constraints.** `1 <= n <= 10^6`, `0 <= m <= 2*10^6`.

**Hint.** Keep an explicit call stack of `(vertex)` plus a per-vertex child cursor `nxt[u]`. On descend, push a child; on return, relax `low[parent]`.

**Go.**
```go
package main

import "fmt"

func countSCCIterative(n int, edges [][]int) int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	nxt := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx, count := 0, 0
	for s := 0; s < n; s++ {
		if disc[s] != -1 {
			continue
		}
		call := []int{s}
		for len(call) > 0 {
			u := call[len(call)-1]
			if nxt[u] == 0 {
				disc[u], low[u] = idx, idx
				idx++
				stack = append(stack, u)
				onStack[u] = true
			}
			descended := false
			for nxt[u] < len(adj[u]) {
				v := adj[u][nxt[u]]
				nxt[u]++
				if disc[v] == -1 {
					call = append(call, v)
					descended = true
					break
				} else if onStack[v] && disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
			if descended {
				continue
			}
			if low[u] == disc[u] {
				count++
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					if w == u {
						break
					}
				}
			}
			call = call[:len(call)-1]
			if len(call) > 0 {
				p := call[len(call)-1]
				if low[u] < low[p] {
					low[p] = low[u]
				}
			}
		}
	}
	return count
}

func main() {
	fmt.Println(countSCCIterative(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}})) // 2
}
```

**Java.**
```java
import java.util.*;

public class Task8 {
    static int countSCCIterative(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        int[] disc = new int[n], low = new int[n], nxt = new int[n];
        boolean[] onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Deque<Integer> stack = new ArrayDeque<>(), call = new ArrayDeque<>();
        int idx = 0, count = 0;
        for (int s = 0; s < n; s++) {
            if (disc[s] != -1) continue;
            call.push(s);
            while (!call.isEmpty()) {
                int u = call.peek();
                if (nxt[u] == 0) {
                    disc[u] = low[u] = idx++;
                    stack.push(u);
                    onStack[u] = true;
                }
                boolean descended = false;
                while (nxt[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(nxt[u]++);
                    if (disc[v] == -1) { call.push(v); descended = true; break; }
                    else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
                }
                if (descended) continue;
                if (low[u] == disc[u]) {
                    count++;
                    int w;
                    do { w = stack.pop(); onStack[w] = false; } while (w != u);
                }
                call.pop();
                if (!call.isEmpty()) low[call.peek()] = Math.min(low[call.peek()], low[u]);
            }
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countSCCIterative(6,
            new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}})); // 2
    }
}
```

**Python.**
```python
def count_scc_iterative(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    nxt = [0] * n
    stack, idx, count = [], 0, 0
    for s in range(n):
        if disc[s] != -1:
            continue
        call = [s]
        while call:
            u = call[-1]
            if nxt[u] == 0:
                disc[u] = low[u] = idx
                idx += 1
                stack.append(u)
                on_stack[u] = True
            descended = False
            while nxt[u] < len(adj[u]):
                v = adj[u][nxt[u]]
                nxt[u] += 1
                if disc[v] == -1:
                    call.append(v)
                    descended = True
                    break
                elif on_stack[v]:
                    low[u] = min(low[u], disc[v])
            if descended:
                continue
            if low[u] == disc[u]:
                count += 1
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    if w == u:
                        break
            call.pop()
            if call:
                low[call[-1]] = min(low[call[-1]], low[u])
    return count


if __name__ == "__main__":
    print(count_scc_iterative(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))  # 2
```

---

### Task 9 — Kosaraju cross-check

**Problem.** Implement Kosaraju and return `comp[v]`. Use it to cross-check a Tarjan implementation on random graphs (same SCC partition up to relabeling).

**Constraints.** `1 <= n <= 10^4`, `0 <= m <= 5*10^4`.

**Hint.** First DFS records finish order; transpose; second DFS in reverse finish order assigns component ids.

**Go.**
```go
package main

import "fmt"

func kosaraju(n int, edges [][]int) []int {
	adj := make([][]int, n)
	radj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		radj[e[1]] = append(radj[e[1]], e[0])
	}
	visited := make([]bool, n)
	var order []int
	var dfs1 func(u int)
	dfs1 = func(u int) {
		visited[u] = true
		for _, v := range adj[u] {
			if !visited[v] {
				dfs1(v)
			}
		}
		order = append(order, u)
	}
	for u := 0; u < n; u++ {
		if !visited[u] {
			dfs1(u)
		}
	}
	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	var dfs2 func(u, c int)
	dfs2 = func(u, c int) {
		comp[u] = c
		for _, v := range radj[u] {
			if comp[v] == -1 {
				dfs2(v, c)
			}
		}
	}
	c := 0
	for i := n - 1; i >= 0; i-- {
		u := order[i]
		if comp[u] == -1 {
			dfs2(u, c)
			c++
		}
	}
	return comp
}

func main() {
	fmt.Println(kosaraju(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}))
}
```

**Java.**
```java
import java.util.*;

public class Task9 {
    static List<List<Integer>> adj, radj;
    static boolean[] visited;
    static List<Integer> order = new ArrayList<>();
    static int[] comp;

    static void dfs1(int u) {
        visited[u] = true;
        for (int v : adj.get(u)) if (!visited[v]) dfs1(v);
        order.add(u);
    }

    static void dfs2(int u, int c) {
        comp[u] = c;
        for (int v : radj.get(u)) if (comp[v] == -1) dfs2(v, c);
    }

    static int[] kosaraju(int n, int[][] edges) {
        adj = new ArrayList<>(); radj = new ArrayList<>();
        for (int i = 0; i < n; i++) { adj.add(new ArrayList<>()); radj.add(new ArrayList<>()); }
        for (int[] e : edges) { adj.get(e[0]).add(e[1]); radj.get(e[1]).add(e[0]); }
        visited = new boolean[n];
        comp = new int[n];
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (!visited[u]) dfs1(u);
        int c = 0;
        for (int i = n - 1; i >= 0; i--) {
            int u = order.get(i);
            if (comp[u] == -1) { dfs2(u, c); c++; }
        }
        return comp;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            kosaraju(6, new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}})));
    }
}
```

**Python.**
```python
import sys


def kosaraju(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    radj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        radj[b].append(a)
    visited = [False] * n
    order = []

    def dfs1(u):
        visited[u] = True
        for v in adj[u]:
            if not visited[v]:
                dfs1(v)
        order.append(u)

    for u in range(n):
        if not visited[u]:
            dfs1(u)

    comp = [-1] * n

    def dfs2(u, c):
        comp[u] = c
        for v in radj[u]:
            if comp[v] == -1:
                dfs2(v, c)

    c = 0
    for u in reversed(order):
        if comp[u] == -1:
            dfs2(u, c)
            c += 1
    return comp


if __name__ == "__main__":
    print(kosaraju(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))
```

---

### Task 10 — Minimum edges to make the graph strongly connected

**Problem.** Given a directed graph, return the minimum number of edges to add so the whole graph becomes one SCC. (If already one SCC, the answer is 0.)

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Condense to a DAG. If it has one node, answer 0. Otherwise count `sources` (in-degree 0) and `sinks` (out-degree 0) in the condensation; the answer is `max(sources, sinks)`.

**Go.**
```go
package main

import "fmt"

func minEdgesToStronglyConnect(n int, edges [][]int) int {
	comp, k := sccIDs(n, edges)
	if k == 1 {
		return 0
	}
	indeg := make([]int, k)
	outdeg := make([]int, k)
	seen := make(map[[2]int]bool)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !seen[[2]int{cu, cv}] {
			seen[[2]int{cu, cv}] = true
			outdeg[cu]++
			indeg[cv]++
		}
	}
	sources, sinks := 0, 0
	for c := 0; c < k; c++ {
		if indeg[c] == 0 {
			sources++
		}
		if outdeg[c] == 0 {
			sinks++
		}
	}
	if sources > sinks {
		return sources
	}
	return sinks
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(minEdgesToStronglyConnect(4, [][]int{{0, 1}, {2, 3}})) // 2
}
```

**Java.**
```java
import java.util.*;

public class Task10 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static int minEdges(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);
        if (cid == 1) return 0;

        int[] indeg = new int[cid], outdeg = new int[cid];
        Set<Long> seen = new HashSet<>();
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv && seen.add(((long) cu << 32) | cv)) {
                outdeg[cu]++; indeg[cv]++;
            }
        }
        int sources = 0, sinks = 0;
        for (int c = 0; c < cid; c++) {
            if (indeg[c] == 0) sources++;
            if (outdeg[c] == 0) sinks++;
        }
        return Math.max(sources, sinks);
    }

    public static void main(String[] args) {
        System.out.println(minEdges(4, new int[][]{{0,1},{2,3}})); // 2
    }
}
```

**Python.**
```python
import sys


def min_edges_to_strongly_connect(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    if cid == 1:
        return 0
    indeg = [0] * cid
    outdeg = [0] * cid
    seen = set()
    for a, b in edges:
        ca, cb = comp[a], comp[b]
        if ca != cb and (ca, cb) not in seen:
            seen.add((ca, cb))
            outdeg[ca] += 1
            indeg[cb] += 1
    sources = sum(1 for c in range(cid) if indeg[c] == 0)
    sinks = sum(1 for c in range(cid) if outdeg[c] == 0)
    return max(sources, sinks)


if __name__ == "__main__":
    print(min_edges_to_strongly_connect(4, [[0, 1], [2, 3]]))  # 2
```

---

## Advanced Tasks (5)

### Task 11 — Longest path in the condensation DAG

**Problem.** Return the length (number of edges) of the longest chain of SCCs in the condensation DAG. This is the deepest dependency chain after collapsing cycles.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Build the condensation, then DP on the DAG. Tarjan emits SCCs in reverse-topo order, so process components in increasing id and relax `dp[cv] = max(dp[cv], dp[cu] + 1)` — but be careful with order; safest is a topological pass over the condensation.

**Go.**
```go
package main

import "fmt"

func longestSCCChain(n int, edges [][]int) int {
	comp, k := sccIDs(n, edges)
	dag := make([][]int, k)
	indeg := make([]int, k)
	seen := make(map[[2]int]bool)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !seen[[2]int{cu, cv}] {
			seen[[2]int{cu, cv}] = true
			dag[cu] = append(dag[cu], cv)
			indeg[cv]++
		}
	}
	// Kahn topological order + longest-path DP
	dp := make([]int, k)
	var queue []int
	for c := 0; c < k; c++ {
		if indeg[c] == 0 {
			queue = append(queue, c)
		}
	}
	best := 0
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		if dp[c] > best {
			best = dp[c]
		}
		for _, nb := range dag[c] {
			if dp[c]+1 > dp[nb] {
				dp[nb] = dp[c] + 1
			}
			indeg[nb]--
			if indeg[nb] == 0 {
				queue = append(queue, nb)
			}
		}
	}
	return best
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(longestSCCChain(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}))
	// 1: condensation has two nodes with one edge between them
}
```

**Java.**
```java
import java.util.*;

public class Task11 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static int longestChain(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);

        List<List<Integer>> dag = new ArrayList<>();
        for (int i = 0; i < cid; i++) dag.add(new ArrayList<>());
        int[] indeg = new int[cid];
        Set<Long> seen = new HashSet<>();
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv && seen.add(((long) cu << 32) | cv)) {
                dag.get(cu).add(cv);
                indeg[cv]++;
            }
        }
        int[] dp = new int[cid];
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < cid; c++) if (indeg[c] == 0) q.add(c);
        int best = 0;
        while (!q.isEmpty()) {
            int c = q.poll();
            best = Math.max(best, dp[c]);
            for (int nb : dag.get(c)) {
                dp[nb] = Math.max(dp[nb], dp[c] + 1);
                if (--indeg[nb] == 0) q.add(nb);
            }
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(longestChain(6,
            new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}})); // 1
    }
}
```

**Python.**
```python
import sys
from collections import deque


def longest_scc_chain(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    dag = [[] for _ in range(cid)]
    indeg = [0] * cid
    seen = set()
    for a, b in edges:
        ca, cb = comp[a], comp[b]
        if ca != cb and (ca, cb) not in seen:
            seen.add((ca, cb))
            dag[ca].append(cb)
            indeg[cb] += 1

    dp = [0] * cid
    q = deque(c for c in range(cid) if indeg[c] == 0)
    best = 0
    while q:
        c = q.popleft()
        best = max(best, dp[c])
        for nb in dag[c]:
            dp[nb] = max(dp[nb], dp[c] + 1)
            indeg[nb] -= 1
            if indeg[nb] == 0:
                q.append(nb)
    return best


if __name__ == "__main__":
    print(longest_scc_chain(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))  # 1
```

---

### Task 12 — 2-SAT with assignment recovery

**Problem.** Given `n` variables and clauses `(literal_a OR literal_b)`, decide satisfiability and, if satisfiable, return one satisfying assignment.

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 10^5`.

**Hint.** Implication graph, Tarjan SCCs with `comp[]`. Unsatisfiable iff `comp[2i] == comp[2i+1]`. Otherwise `x_i = comp[2i] < comp[2i+1]` (literal whose SCC is later in topological order is true; Tarjan numbers in reverse-topo so the larger comp id is earlier in topo — pick accordingly).

**Go.**
```go
package main

import "fmt"

func twoSAT(n int, clauses [][4]int) (bool, []bool) {
	// clause = {a, av(0/1), b, bv(0/1)}
	N := 2 * n
	adj := make([][]int, N)
	node := func(v, val int) int {
		if val == 1 {
			return 2 * v
		}
		return 2*v + 1
	}
	addImpl := func(x, y int) { adj[x] = append(adj[x], y) }
	for _, c := range clauses {
		a, av, b, bv := c[0], c[1], c[2], c[3]
		addImpl(node(a, 1-av), node(b, bv))
		addImpl(node(b, 1-bv), node(a, av))
	}
	disc := make([]int, N)
	low := make([]int, N)
	comp := make([]int, N)
	onStack := make([]bool, N)
	nxt := make([]int, N)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	for s := 0; s < N; s++ {
		if disc[s] != -1 {
			continue
		}
		call := []int{s}
		for len(call) > 0 {
			u := call[len(call)-1]
			if nxt[u] == 0 {
				disc[u], low[u] = idx, idx
				idx++
				stack = append(stack, u)
				onStack[u] = true
			}
			descended := false
			for nxt[u] < len(adj[u]) {
				v := adj[u][nxt[u]]
				nxt[u]++
				if disc[v] == -1 {
					call = append(call, v)
					descended = true
					break
				} else if onStack[v] && disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
			if descended {
				continue
			}
			if low[u] == disc[u] {
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					comp[w] = cid
					if w == u {
						break
					}
				}
				cid++
			}
			call = call[:len(call)-1]
			if len(call) > 0 {
				p := call[len(call)-1]
				if low[u] < low[p] {
					low[p] = low[u]
				}
			}
		}
	}
	assign := make([]bool, n)
	for i := 0; i < n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return false, nil
		}
		// Tarjan numbers in reverse topo order: smaller comp id = later in topo.
		// The literal whose SCC is later in topo (smaller comp id) is true.
		assign[i] = comp[2*i] < comp[2*i+1]
	}
	return true, assign
}

func main() {
	clauses := [][4]int{{0, 1, 1, 1}, {0, 0, 1, 1}, {1, 0, 0, 1}}
	ok, a := twoSAT(2, clauses)
	fmt.Println(ok, a)
}
```

**Java.**
```java
import java.util.*;

public class Task12 {
    public static int[] solve(int n, int[][] clauses) {
        int N = 2 * n;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        for (int[] c : clauses) {
            int a = c[0], av = c[1], b = c[2], bv = c[3];
            adj.get(node(a, 1 - av)).add(node(b, bv));
            adj.get(node(b, 1 - bv)).add(node(a, av));
        }
        int[] disc = new int[N], low = new int[N], comp = new int[N], nxt = new int[N];
        boolean[] onStack = new boolean[N];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        Deque<Integer> stack = new ArrayDeque<>(), call = new ArrayDeque<>();
        int idx = 0, cid = 0;
        for (int s = 0; s < N; s++) {
            if (disc[s] != -1) continue;
            call.push(s);
            while (!call.isEmpty()) {
                int u = call.peek();
                if (nxt[u] == 0) { disc[u] = low[u] = idx++; stack.push(u); onStack[u] = true; }
                boolean descended = false;
                while (nxt[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(nxt[u]++);
                    if (disc[v] == -1) { call.push(v); descended = true; break; }
                    else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
                }
                if (descended) continue;
                if (low[u] == disc[u]) {
                    int w;
                    do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
                    cid++;
                }
                call.pop();
                if (!call.isEmpty()) low[call.peek()] = Math.min(low[call.peek()], low[u]);
            }
        }
        int[] assign = new int[n];
        for (int i = 0; i < n; i++) {
            if (comp[2 * i] == comp[2 * i + 1]) return null; // UNSAT
            assign[i] = comp[2 * i] < comp[2 * i + 1] ? 1 : 0;
        }
        return assign;
    }

    static int node(int v, int val) { return val == 1 ? 2 * v : 2 * v + 1; }

    public static void main(String[] args) {
        int[][] clauses = {{0,1,1,1},{0,0,1,1},{1,0,0,1}};
        System.out.println(Arrays.toString(solve(2, clauses)));
    }
}
```

**Python.**
```python
def two_sat(n, clauses):
    # clauses: list of (a, av, b, bv) with av/bv in {0,1}
    N = 2 * n
    adj = [[] for _ in range(N)]

    def node(v, val):
        return 2 * v if val == 1 else 2 * v + 1

    for a, av, b, bv in clauses:
        adj[node(a, 1 - av)].append(node(b, bv))
        adj[node(b, 1 - bv)].append(node(a, av))

    disc = [-1] * N
    low = [0] * N
    comp = [-1] * N
    on_stack = [False] * N
    nxt = [0] * N
    stack, idx, cid = [], 0, 0

    for s in range(N):
        if disc[s] != -1:
            continue
        call = [s]
        while call:
            u = call[-1]
            if nxt[u] == 0:
                disc[u] = low[u] = idx
                idx += 1
                stack.append(u)
                on_stack[u] = True
            descended = False
            while nxt[u] < len(adj[u]):
                v = adj[u][nxt[u]]
                nxt[u] += 1
                if disc[v] == -1:
                    call.append(v)
                    descended = True
                    break
                elif on_stack[v]:
                    low[u] = min(low[u], disc[v])
            if descended:
                continue
            if low[u] == disc[u]:
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp[w] = cid
                    if w == u:
                        break
                cid += 1
            call.pop()
            if call:
                low[call[-1]] = min(low[call[-1]], low[u])

    assign = []
    for i in range(n):
        if comp[2 * i] == comp[2 * i + 1]:
            return None  # UNSAT
        assign.append(comp[2 * i] < comp[2 * i + 1])
    return assign


if __name__ == "__main__":
    clauses = [(0, 1, 1, 1), (0, 0, 1, 1), (1, 0, 0, 1)]
    print(two_sat(2, clauses))
```

---

### Task 13 — Semi-connectivity check

**Problem.** A directed graph is **semi-connected** if for every pair `(u, v)` there is a path `u ⇝ v` **or** `v ⇝ u`. Return `true` iff the graph is semi-connected.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Condense to a DAG. The graph is semi-connected iff the condensation has a **Hamiltonian path** — which for a DAG means a topological order where consecutive components are connected by an edge (the topo order is unique as a chain). Check that every consecutive pair in topo order has a direct edge.

**Go.**
```go
package main

import "fmt"

func isSemiConnected(n int, edges [][]int) bool {
	comp, k := sccIDs(n, edges)
	adjSet := make([]map[int]bool, k)
	for i := range adjSet {
		adjSet[i] = map[int]bool{}
	}
	indeg := make([]int, k)
	dag := make([][]int, k)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !adjSet[cu][cv] {
			adjSet[cu][cv] = true
			dag[cu] = append(dag[cu], cv)
			indeg[cv]++
		}
	}
	// Kahn: if at any step more than one node has indeg 0, no unique chain → not semi-connected.
	var queue []int
	for c := 0; c < k; c++ {
		if indeg[c] == 0 {
			queue = append(queue, c)
		}
	}
	var order []int
	for len(queue) > 0 {
		if len(queue) > 1 {
			return false // two independent sources → some pair unrelated
		}
		c := queue[0]
		queue = queue[1:]
		order = append(order, c)
		for _, nb := range dag[c] {
			indeg[nb]--
			if indeg[nb] == 0 {
				queue = append(queue, nb)
			}
		}
	}
	// Every consecutive pair in the chain must have a direct edge.
	for i := 0; i+1 < len(order); i++ {
		if !adjSet[order[i]][order[i+1]] {
			return false
		}
	}
	return true
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(isSemiConnected(3, [][]int{{0, 1}, {1, 2}})) // true (0->1->2 chain)
	fmt.Println(isSemiConnected(3, [][]int{{0, 1}, {0, 2}})) // false (1,2 unrelated)
}
```

**Java.**
```java
import java.util.*;

public class Task13 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static boolean isSemiConnected(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);

        List<Set<Integer>> adjSet = new ArrayList<>();
        for (int i = 0; i < cid; i++) adjSet.add(new HashSet<>());
        int[] indeg = new int[cid];
        List<List<Integer>> dag = new ArrayList<>();
        for (int i = 0; i < cid; i++) dag.add(new ArrayList<>());
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv && adjSet.get(cu).add(cv)) { dag.get(cu).add(cv); indeg[cv]++; }
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < cid; c++) if (indeg[c] == 0) q.add(c);
        List<Integer> order = new ArrayList<>();
        while (!q.isEmpty()) {
            if (q.size() > 1) return false;
            int c = q.poll();
            order.add(c);
            for (int nb : dag.get(c)) if (--indeg[nb] == 0) q.add(nb);
        }
        for (int i = 0; i + 1 < order.size(); i++)
            if (!adjSet.get(order.get(i)).contains(order.get(i + 1))) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isSemiConnected(3, new int[][]{{0,1},{1,2}})); // true
        System.out.println(isSemiConnected(3, new int[][]{{0,1},{0,2}})); // false
    }
}
```

**Python.**
```python
import sys
from collections import deque


def is_semi_connected(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    adj_set = [set() for _ in range(cid)]
    indeg = [0] * cid
    dag = [[] for _ in range(cid)]
    for a, b in edges:
        ca, cb = comp[a], comp[b]
        if ca != cb and cb not in adj_set[ca]:
            adj_set[ca].add(cb)
            dag[ca].append(cb)
            indeg[cb] += 1

    q = deque(c for c in range(cid) if indeg[c] == 0)
    order = []
    while q:
        if len(q) > 1:
            return False
        c = q.popleft()
        order.append(c)
        for nb in dag[c]:
            indeg[nb] -= 1
            if indeg[nb] == 0:
                q.append(nb)

    for i in range(len(order) - 1):
        if order[i + 1] not in adj_set[order[i]]:
            return False
    return True


if __name__ == "__main__":
    print(is_semi_connected(3, [[0, 1], [1, 2]]))  # True
    print(is_semi_connected(3, [[0, 1], [0, 2]]))  # False
```

---

### Task 14 — Count SCCs reachable from each vertex (via condensation DP)

**Problem.** For each vertex `v`, return how many distinct SCCs are reachable from `v`'s SCC (including its own). Use DP on the condensation DAG.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Build the condensation, process components in topological order (reverse of Tarjan's emission), and accumulate reachable sets — but exact distinct counts need set unions or bitsets; for large `k` use a DP that counts reachable nodes via topological order assuming the answer is "number of reachable components" computed by a reverse-topo `reach[c] = 1 + union of children`. Here we compute reachable-component *count* using a memoized DFS on the condensation with a visited-set per query is too slow; instead compute via DP where each component's reachable set is represented and merged — for the reference we use a simple memoized reachable-count that is exact when the condensation is a tree/forest, and otherwise approximate; the canonical exact method merges child reachable sets. The reference below uses memoized DFS with explicit set union (correct, `O(k^2)` worst case) suitable for moderate `k`.

**Go.**
```go
package main

import "fmt"

func sccReachCounts(n int, edges [][]int) []int {
	comp, k := sccIDs(n, edges)
	dag := make([][]int, k)
	seen := make(map[[2]int]bool)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !seen[[2]int{cu, cv}] {
			seen[[2]int{cu, cv}] = true
			dag[cu] = append(dag[cu], cv)
		}
	}
	reach := make([]map[int]bool, k)
	var dfs func(c int) map[int]bool
	dfs = func(c int) map[int]bool {
		if reach[c] != nil {
			return reach[c]
		}
		s := map[int]bool{c: true}
		for _, nb := range dag[c] {
			for x := range dfs(nb) {
				s[x] = true
			}
		}
		reach[c] = s
		return s
	}
	res := make([]int, n)
	for v := 0; v < n; v++ {
		res[v] = len(dfs(comp[v]))
	}
	return res
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(sccReachCounts(6, [][]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}))
	// vertices in {0,1,2} reach 2 SCCs; vertices in {3,4,5} reach 1
}
```

**Java.**
```java
import java.util.*;

public class Task14 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;
    static List<List<Integer>> dag;
    static Set<Integer>[] reach;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static Set<Integer> reachOf(int c) {
        if (reach[c] != null) return reach[c];
        Set<Integer> s = new HashSet<>();
        s.add(c);
        for (int nb : dag.get(c)) s.addAll(reachOf(nb));
        reach[c] = s;
        return s;
    }

    @SuppressWarnings("unchecked")
    static int[] sccReachCounts(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);

        dag = new ArrayList<>();
        for (int i = 0; i < cid; i++) dag.add(new ArrayList<>());
        Set<Long> seen = new HashSet<>();
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv && seen.add(((long) cu << 32) | cv)) dag.get(cu).add(cv);
        }
        reach = new HashSet[cid];
        int[] res = new int[n];
        for (int v = 0; v < n; v++) res[v] = reachOf(comp[v]).size();
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            sccReachCounts(6, new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}})));
    }
}
```

**Python.**
```python
import sys


def scc_reach_counts(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    dag = [[] for _ in range(cid)]
    seen = set()
    for a, b in edges:
        ca, cb = comp[a], comp[b]
        if ca != cb and (ca, cb) not in seen:
            seen.add((ca, cb))
            dag[ca].append(cb)

    reach = [None] * cid

    def reach_of(c):
        if reach[c] is not None:
            return reach[c]
        s = {c}
        for nb in dag[c]:
            s |= reach_of(nb)
        reach[c] = s
        return s

    return [len(reach_of(comp[v])) for v in range(n)]


if __name__ == "__main__":
    print(scc_reach_counts(6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]]))
```

---

### Task 15 — Mother vertex (vertex reaching all others)

**Problem.** Return any vertex from which all other vertices are reachable, or `-1` if none exists.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** A mother vertex exists iff the condensation has exactly **one source SCC** (in-degree 0). Any vertex of that source SCC is a mother vertex. (Equivalently, the last vertex finished in a Kosaraju-style DFS is a candidate; verify it reaches all.)

**Go.**
```go
package main

import "fmt"

func motherVertex(n int, edges [][]int) int {
	comp, k := sccIDs(n, edges)
	indeg := make([]int, k)
	seen := make(map[[2]int]bool)
	for _, e := range edges {
		cu, cv := comp[e[0]], comp[e[1]]
		if cu != cv && !seen[[2]int{cu, cv}] {
			seen[[2]int{cu, cv}] = true
			indeg[cv]++
		}
	}
	source := -1
	for c := 0; c < k; c++ {
		if indeg[c] == 0 {
			if source != -1 {
				return -1 // more than one source → no mother vertex
			}
			source = c
		}
	}
	for v := 0; v < n; v++ {
		if comp[v] == source {
			return v
		}
	}
	return -1
}

func sccIDs(n int, edges [][]int) ([]int, int) {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range adj[u] {
			if disc[v] == -1 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if low[u] == disc[u] {
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp[w] = cid
				if w == u {
					break
				}
			}
			cid++
		}
	}
	for u := 0; u < n; u++ {
		if disc[u] == -1 {
			dfs(u)
		}
	}
	return comp, cid
}

func main() {
	fmt.Println(motherVertex(4, [][]int{{0, 1}, {1, 2}, {2, 3}})) // 0
	fmt.Println(motherVertex(4, [][]int{{0, 1}, {2, 3}}))         // -1
}
```

**Java.**
```java
import java.util.*;

public class Task15 {
    static List<List<Integer>> adj;
    static int[] disc, low, comp;
    static boolean[] onStack;
    static Deque<Integer> stack = new ArrayDeque<>();
    static int idx = 0, cid = 0;

    static void dfs(int u) {
        disc[u] = low[u] = idx++;
        stack.push(u);
        onStack[u] = true;
        for (int v : adj.get(u)) {
            if (disc[v] == -1) { dfs(v); low[u] = Math.min(low[u], low[v]); }
            else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
        }
        if (low[u] == disc[u]) {
            int w;
            do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
            cid++;
        }
    }

    static int motherVertex(int n, int[][] edges) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        disc = new int[n]; low = new int[n]; comp = new int[n]; onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        for (int u = 0; u < n; u++) if (disc[u] == -1) dfs(u);

        int[] indeg = new int[cid];
        Set<Long> seen = new HashSet<>();
        for (int[] e : edges) {
            int cu = comp[e[0]], cv = comp[e[1]];
            if (cu != cv && seen.add(((long) cu << 32) | cv)) indeg[cv]++;
        }
        int source = -1;
        for (int c = 0; c < cid; c++) {
            if (indeg[c] == 0) {
                if (source != -1) return -1;
                source = c;
            }
        }
        for (int v = 0; v < n; v++) if (comp[v] == source) return v;
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(motherVertex(4, new int[][]{{0,1},{1,2},{2,3}})); // 0
        System.out.println(motherVertex(4, new int[][]{{0,1},{2,3}}));       // -1
    }
}
```

**Python.**
```python
import sys


def mother_vertex(n, edges):
    sys.setrecursionlimit(1 << 25)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    stack, idx, cid = [], 0, 0

    def dfs(u):
        nonlocal idx, cid
        disc[u] = low[u] = idx
        idx += 1
        stack.append(u)
        on_stack[u] = True
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v)
                low[u] = min(low[u], low[v])
            elif on_stack[v]:
                low[u] = min(low[u], disc[v])
        if low[u] == disc[u]:
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp[w] = cid
                if w == u:
                    break
            cid += 1

    for u in range(n):
        if disc[u] == -1:
            dfs(u)

    indeg = [0] * cid
    seen = set()
    for a, b in edges:
        ca, cb = comp[a], comp[b]
        if ca != cb and (ca, cb) not in seen:
            seen.add((ca, cb))
            indeg[cb] += 1

    source = -1
    for c in range(cid):
        if indeg[c] == 0:
            if source != -1:
                return -1
            source = c
    for v in range(n):
        if comp[v] == source:
            return v
    return -1


if __name__ == "__main__":
    print(mother_vertex(4, [[0, 1], [1, 2], [2, 3]]))  # 0
    print(mother_vertex(4, [[0, 1], [2, 3]]))          # -1
```

---

## Benchmark Task

### Task B — Tarjan vs Kosaraju vs Iterative across Go, Java, Python

**Problem.** Generate a large random directed graph and time three SCC implementations: recursive Tarjan, Kosaraju, and iterative Tarjan. Verify all three agree on the SCC partition (up to relabeling), then report wall-clock times. Also include a worst-case **path graph** of `10^6` vertices to demonstrate that recursive Tarjan overflows while iterative survives.

**Constraints.**
- Random graph: `n = 2*10^5` vertices, `m = 10^6` edges, uniform random endpoints.
- Path graph: `n = 10^6`, edges `i → i+1`.
- Correctness: the SCC partition (a mapping vertex → set) must match across implementations.

**Hints.**
- Compare partitions, not component ids: build `frozenset` of each component and compare the multiset of sets.
- For the path graph, expect recursive Tarjan to crash (`RecursionError` / `StackOverflowError` / segfault); catch and report it.
- Use a fixed seed for reproducibility.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genRandom(n, m int, seed int64) [][]int {
	r := rand.New(rand.NewSource(seed))
	edges := make([][]int, m)
	for i := 0; i < m; i++ {
		edges[i] = []int{r.Intn(n), r.Intn(n)}
	}
	return edges
}

func genPath(n int) [][]int {
	edges := make([][]int, 0, n-1)
	for i := 0; i+1 < n; i++ {
		edges = append(edges, []int{i, i + 1})
	}
	return edges
}

// reuse iterative Tarjan (returns comp ids) and Kosaraju from earlier tasks.

func main() {
	n, m := 200_000, 1_000_000
	edges := genRandom(n, m, 42)

	t0 := time.Now()
	c1 := iterTarjan(n, edges)
	fmt.Printf("iterative Tarjan: %v (%d comps)\n", time.Since(t0), maxID(c1)+1)

	t1 := time.Now()
	c2 := kosaraju(n, edges)
	fmt.Printf("Kosaraju        : %v (%d comps)\n", time.Since(t1), maxID(c2)+1)

	fmt.Println("partitions match:", samePartition(c1, c2))

	// path graph: iterative survives
	pn := 1_000_000
	p := genPath(pn)
	t2 := time.Now()
	cp := iterTarjan(pn, p)
	fmt.Printf("iterative on path(10^6): %v (%d comps)\n", time.Since(t2), maxID(cp)+1)
	// recursive Tarjan would overflow here — intentionally not run.
}

func maxID(c []int) int {
	best := 0
	for _, x := range c {
		if x > best {
			best = x
		}
	}
	return best
}

func samePartition(a, b []int) bool {
	mapAB := map[int]int{}
	mapBA := map[int]int{}
	for i := range a {
		if v, ok := mapAB[a[i]]; ok {
			if v != b[i] {
				return false
			}
		} else {
			mapAB[a[i]] = b[i]
		}
		if v, ok := mapBA[b[i]]; ok {
			if v != a[i] {
				return false
			}
		} else {
			mapBA[b[i]] = a[i]
		}
	}
	return true
}

func iterTarjan(n int, edges [][]int) []int {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	disc := make([]int, n)
	low := make([]int, n)
	comp := make([]int, n)
	onStack := make([]bool, n)
	nxt := make([]int, n)
	for i := range disc {
		disc[i] = -1
		comp[i] = -1
	}
	var stack []int
	idx, cid := 0, 0
	for s := 0; s < n; s++ {
		if disc[s] != -1 {
			continue
		}
		call := []int{s}
		for len(call) > 0 {
			u := call[len(call)-1]
			if nxt[u] == 0 {
				disc[u], low[u] = idx, idx
				idx++
				stack = append(stack, u)
				onStack[u] = true
			}
			descended := false
			for nxt[u] < len(adj[u]) {
				v := adj[u][nxt[u]]
				nxt[u]++
				if disc[v] == -1 {
					call = append(call, v)
					descended = true
					break
				} else if onStack[v] && disc[v] < low[u] {
					low[u] = disc[v]
				}
			}
			if descended {
				continue
			}
			if low[u] == disc[u] {
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					onStack[w] = false
					comp[w] = cid
					if w == u {
						break
					}
				}
				cid++
			}
			call = call[:len(call)-1]
			if len(call) > 0 {
				p := call[len(call)-1]
				if low[u] < low[p] {
					low[p] = low[u]
				}
			}
		}
	}
	return comp
}

func kosaraju(n int, edges [][]int) []int {
	adj := make([][]int, n)
	radj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		radj[e[1]] = append(radj[e[1]], e[0])
	}
	visited := make([]bool, n)
	order := make([]int, 0, n)
	// iterative dfs1 to avoid overflow on the random graph
	nxt := make([]int, n)
	for s := 0; s < n; s++ {
		if visited[s] {
			continue
		}
		stack := []int{s}
		visited[s] = true
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			if nxt[u] < len(adj[u]) {
				v := adj[u][nxt[u]]
				nxt[u]++
				if !visited[v] {
					visited[v] = true
					stack = append(stack, v)
				}
			} else {
				order = append(order, u)
				stack = stack[:len(stack)-1]
			}
		}
	}
	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	c := 0
	for i := n - 1; i >= 0; i-- {
		s := order[i]
		if comp[s] != -1 {
			continue
		}
		stack := []int{s}
		comp[s] = c
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, v := range radj[u] {
				if comp[v] == -1 {
					comp[v] = c
					stack = append(stack, v)
				}
			}
		}
		c++
	}
	return comp
}
```

**Java.**
```java
import java.util.*;

public class TaskB {
    static int[][] genRandom(int n, int m, long seed) {
        Random r = new Random(seed);
        int[][] e = new int[m][2];
        for (int i = 0; i < m; i++) { e[i][0] = r.nextInt(n); e[i][1] = r.nextInt(n); }
        return e;
    }

    static int[] iterTarjan(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        int[] disc = new int[n], low = new int[n], comp = new int[n], nxt = new int[n];
        boolean[] onStack = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(comp, -1);
        Deque<Integer> stack = new ArrayDeque<>(), call = new ArrayDeque<>();
        int idx = 0, cid = 0;
        for (int s = 0; s < n; s++) {
            if (disc[s] != -1) continue;
            call.push(s);
            while (!call.isEmpty()) {
                int u = call.peek();
                if (nxt[u] == 0) { disc[u] = low[u] = idx++; stack.push(u); onStack[u] = true; }
                boolean descended = false;
                while (nxt[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(nxt[u]++);
                    if (disc[v] == -1) { call.push(v); descended = true; break; }
                    else if (onStack[v]) low[u] = Math.min(low[u], disc[v]);
                }
                if (descended) continue;
                if (low[u] == disc[u]) {
                    int w;
                    do { w = stack.pop(); onStack[w] = false; comp[w] = cid; } while (w != u);
                    cid++;
                }
                call.pop();
                if (!call.isEmpty()) low[call.peek()] = Math.min(low[call.peek()], low[u]);
            }
        }
        return comp;
    }

    public static void main(String[] args) {
        int n = 200_000, m = 1_000_000;
        int[][] edges = genRandom(n, m, 42);

        long t0 = System.nanoTime();
        int[] c1 = iterTarjan(n, edges);
        System.out.printf("iterative Tarjan: %.3f s%n", (System.nanoTime() - t0) / 1e9);

        // Path graph 10^6: iterative survives where recursion overflows.
        int pn = 1_000_000;
        int[][] path = new int[pn - 1][2];
        for (int i = 0; i + 1 < pn; i++) { path[i][0] = i; path[i][1] = i + 1; }
        long t1 = System.nanoTime();
        int[] cp = iterTarjan(pn, path);
        System.out.printf("iterative on path(10^6): %.3f s (%d comps)%n",
            (System.nanoTime() - t1) / 1e9, Arrays.stream(cp).max().getAsInt() + 1);
    }
}
```

**Python.**
```python
import random
import sys
import time


def gen_random(n, m, seed=42):
    rng = random.Random(seed)
    return [[rng.randrange(n), rng.randrange(n)] for _ in range(m)]


def iter_tarjan(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
    disc = [-1] * n
    low = [0] * n
    comp = [-1] * n
    on_stack = [False] * n
    nxt = [0] * n
    stack, idx, cid = [], 0, 0
    for s in range(n):
        if disc[s] != -1:
            continue
        call = [s]
        while call:
            u = call[-1]
            if nxt[u] == 0:
                disc[u] = low[u] = idx
                idx += 1
                stack.append(u)
                on_stack[u] = True
            descended = False
            while nxt[u] < len(adj[u]):
                v = adj[u][nxt[u]]
                nxt[u] += 1
                if disc[v] == -1:
                    call.append(v)
                    descended = True
                    break
                elif on_stack[v]:
                    low[u] = min(low[u], disc[v])
            if descended:
                continue
            if low[u] == disc[u]:
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp[w] = cid
                    if w == u:
                        break
                cid += 1
            call.pop()
            if call:
                low[call[-1]] = min(low[call[-1]], low[u])
    return comp


def same_partition(a, b):
    ab, ba = {}, {}
    for x, y in zip(a, b):
        if ab.setdefault(x, y) != y:
            return False
        if ba.setdefault(y, x) != x:
            return False
    return True


if __name__ == "__main__":
    n, m = 200_000, 1_000_000
    edges = gen_random(n, m)

    t0 = time.perf_counter()
    c1 = iter_tarjan(n, edges)
    print(f"iterative Tarjan: {time.perf_counter() - t0:.3f}s, {max(c1) + 1} comps")

    # Path of 10^6 nodes: recursive would overflow; iterative survives.
    pn = 1_000_000
    path = [[i, i + 1] for i in range(pn - 1)]
    t1 = time.perf_counter()
    cp = iter_tarjan(pn, path)
    print(f"iterative on path(10^6): {time.perf_counter() - t1:.3f}s, {max(cp) + 1} comps")
```

**Expected observations.**
- On the random graph, iterative Tarjan and Kosaraju agree on the partition; Tarjan is typically 1.5–2× faster (no transpose).
- On the `10^6` path graph, recursive Tarjan overflows the stack; the iterative version completes and reports `10^6` size-1 SCCs.
- Python is an order of magnitude slower than Go/Java but the relative ordering (Tarjan faster than Kosaraju) holds.
