# Breadth-First Search — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a reference solution in all three languages.
> Reuse the one BFS template: a FIFO queue plus an **enqueue-time** visited mark. Bolt on `dist`, `parent`, color, or multi-source seeding as the problem demands.

---

## Beginner Tasks (5)

### Task 1 — Distances from a source in an unweighted graph

**Statement.** Given an undirected graph as an adjacency list and a source vertex `src`, compute `dist[v]` = the fewest edges from `src` to every vertex `v`, with `-1` for unreachable vertices.

**Constraints.**
- `1 <= V <= 10^5`, `0 <= E <= 2·10^5`.
- Vertices are labeled `0 .. V-1`.
- Required time: `O(V + E)`.

**Hints.**
- Use a `dist` array initialized to `-1`; `dist[v] == -1` also marks "unvisited."
- Mark visited (set `dist`) at the moment you enqueue, never on dequeue.

**Reference — Go.**
```go
package main

import "fmt"

func bfs(adj [][]int, src int) []int {
	n := len(adj)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = -1
	}
	dist[src] = 0
	q := []int{src}
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
	return dist
}

func main() {
	adj := [][]int{{1, 2}, {0, 3, 4}, {0, 4}, {1}, {1, 2, 5}, {4}}
	fmt.Println(bfs(adj, 0)) // [0 1 1 2 2 3]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task1 {
    public static int[] bfs(List<List<Integer>> adj, int src) {
        int n = adj.size();
        int[] dist = new int[n];
        Arrays.fill(dist, -1);
        dist[src] = 0;
        Deque<Integer> q = new ArrayDeque<>();
        q.add(src);
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int v : adj.get(u)) {
                if (dist[v] == -1) {
                    dist[v] = dist[u] + 1;
                    q.add(v);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1, 2), List.of(0, 3, 4), List.of(0, 4),
            List.of(1), List.of(1, 2, 5), List.of(4));
        System.out.println(Arrays.toString(bfs(adj, 0))); // [0, 1, 1, 2, 2, 3]
    }
}
```

**Reference — Python.**
```python
from collections import deque


def bfs(adj, src):
    n = len(adj)
    dist = [-1] * n
    dist[src] = 0
    q = deque([src])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if dist[v] == -1:
                dist[v] = dist[u] + 1
                q.append(v)
    return dist


if __name__ == "__main__":
    print(bfs([[1, 2], [0, 3, 4], [0, 4], [1], [1, 2, 5], [4]], 0))  # [0,1,1,2,2,3]
```

---

### Task 2 — Shortest path length in a maze grid

**Statement.** Given a grid where `0` is open and `1` is a wall, find the fewest 4-directional moves from the top-left cell to the bottom-right cell. Return `-1` if unreachable or if the start/goal is a wall.

**Constraints.**
- `1 <= n, m <= 1000`.
- Moves: up, down, left, right.
- Required time: `O(n·m)`.

**Hints.**
- A grid is an implicit graph; each cell has up to four neighbors.
- Always bounds-check `(nr, nc)` *before* reading `grid[nr][nc]`.

**Reference — Go.**
```go
package main

import "fmt"

func shortestPath(grid [][]int) int {
	if len(grid) == 0 || grid[0][0] == 1 {
		return -1
	}
	n, m := len(grid), len(grid[0])
	dist := make([][]int, n)
	for i := range dist {
		dist[i] = make([]int, m)
		for j := range dist[i] {
			dist[i][j] = -1
		}
	}
	dist[0][0] = 0
	type cell struct{ r, c int }
	q := []cell{{0, 0}}
	dirs := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < m &&
				grid[nr][nc] == 0 && dist[nr][nc] == -1 {
				dist[nr][nc] = dist[cur.r][cur.c] + 1
				q = append(q, cell{nr, nc})
			}
		}
	}
	return dist[n-1][m-1]
}

func main() {
	grid := [][]int{{0, 0, 1, 0}, {1, 0, 1, 0}, {0, 0, 0, 0}, {0, 1, 1, 0}}
	fmt.Println(shortestPath(grid)) // 6
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task2 {
    public static int shortestPath(int[][] grid) {
        if (grid.length == 0 || grid[0][0] == 1) return -1;
        int n = grid.length, m = grid[0].length;
        int[][] dist = new int[n][m];
        for (int[] row : dist) Arrays.fill(row, -1);
        dist[0][0] = 0;
        Deque<int[]> q = new ArrayDeque<>();
        q.add(new int[]{0, 0});
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int r = cur[0], c = cur[1];
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < m
                        && grid[nr][nc] == 0 && dist[nr][nc] == -1) {
                    dist[nr][nc] = dist[r][c] + 1;
                    q.add(new int[]{nr, nc});
                }
            }
        }
        return dist[n - 1][m - 1];
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 0, 1, 0}, {1, 0, 1, 0}, {0, 0, 0, 0}, {0, 1, 1, 0}};
        System.out.println(shortestPath(grid)); // 6
    }
}
```

**Reference — Python.**
```python
from collections import deque


def shortest_path(grid):
    if not grid or grid[0][0] == 1:
        return -1
    n, m = len(grid), len(grid[0])
    dist = [[-1] * m for _ in range(n)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while q:
        r, c = q.popleft()
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < m and grid[nr][nc] == 0 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return dist[n - 1][m - 1]


if __name__ == "__main__":
    print(shortest_path([[0, 0, 1, 0], [1, 0, 1, 0], [0, 0, 0, 0], [0, 1, 1, 0]]))  # 6
```

---

### Task 3 — Count connected components

**Statement.** Given an undirected graph as an adjacency list, count the number of connected components.

**Constraints.**
- `1 <= V <= 10^5`, `0 <= E <= 2·10^5`.
- Required time: `O(V + E)`.

**Hints.**
- Loop over every vertex; start a fresh BFS only from unvisited vertices.
- Each BFS labels one whole component; increment a counter per new BFS start.

**Reference — Go.**
```go
package main

import "fmt"

func countComponents(adj [][]int) int {
	n := len(adj)
	visited := make([]bool, n)
	count := 0
	for s := 0; s < n; s++ {
		if visited[s] {
			continue
		}
		count++
		visited[s] = true
		q := []int{s}
		for len(q) > 0 {
			u := q[0]
			q = q[1:]
			for _, v := range adj[u] {
				if !visited[v] {
					visited[v] = true
					q = append(q, v)
				}
			}
		}
	}
	return count
}

func main() {
	adj := [][]int{{1}, {0}, {3}, {2}, {}}
	fmt.Println(countComponents(adj)) // 3
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task3 {
    public static int countComponents(List<List<Integer>> adj) {
        int n = adj.size();
        boolean[] visited = new boolean[n];
        int count = 0;
        for (int s = 0; s < n; s++) {
            if (visited[s]) continue;
            count++;
            visited[s] = true;
            Deque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) {
                    if (!visited[v]) {
                        visited[v] = true;
                        q.add(v);
                    }
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1), List.of(0), List.of(3), List.of(2), List.of());
        System.out.println(countComponents(adj)); // 3
    }
}
```

**Reference — Python.**
```python
from collections import deque


def count_components(adj):
    n = len(adj)
    visited = [False] * n
    count = 0
    for s in range(n):
        if visited[s]:
            continue
        count += 1
        visited[s] = True
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if not visited[v]:
                    visited[v] = True
                    q.append(v)
    return count


if __name__ == "__main__":
    print(count_components([[1], [0], [3], [2], []]))  # 3
```

---

### Task 4 — Level-order traversal of a tree

**Statement.** Given a binary tree (each node has up to two children), return its values grouped by level, top to bottom, left to right.

**Constraints.**
- `0 <= number of nodes <= 10^4`.
- Return an empty list for an empty tree.

**Hints.**
- A tree is an acyclic graph; BFS from the root yields level order.
- Snapshot the queue size at the start of each level (`for _ in range(len(q))`) to emit one list per level.

**Reference — Go.**
```go
package main

import "fmt"

type TreeNode struct {
	Val   int
	Left  *TreeNode
	Right *TreeNode
}

func levelOrder(root *TreeNode) [][]int {
	var result [][]int
	if root == nil {
		return result
	}
	q := []*TreeNode{root}
	for len(q) > 0 {
		var level []int
		sz := len(q)
		for i := 0; i < sz; i++ {
			node := q[0]
			q = q[1:]
			level = append(level, node.Val)
			if node.Left != nil {
				q = append(q, node.Left)
			}
			if node.Right != nil {
				q = append(q, node.Right)
			}
		}
		result = append(result, level)
	}
	return result
}

func main() {
	root := &TreeNode{1,
		&TreeNode{2, nil, nil},
		&TreeNode{3, &TreeNode{4, nil, nil}, nil}}
	fmt.Println(levelOrder(root)) // [[1] [2 3] [4]]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task4 {
    static class TreeNode {
        int val; TreeNode left, right;
        TreeNode(int v) { val = v; }
    }

    public static List<List<Integer>> levelOrder(TreeNode root) {
        List<List<Integer>> result = new ArrayList<>();
        if (root == null) return result;
        Deque<TreeNode> q = new ArrayDeque<>();
        q.add(root);
        while (!q.isEmpty()) {
            int sz = q.size();
            List<Integer> level = new ArrayList<>();
            for (int i = 0; i < sz; i++) {
                TreeNode node = q.poll();
                level.add(node.val);
                if (node.left != null) q.add(node.left);
                if (node.right != null) q.add(node.right);
            }
            result.add(level);
        }
        return result;
    }

    public static void main(String[] args) {
        TreeNode root = new TreeNode(1);
        root.left = new TreeNode(2);
        root.right = new TreeNode(3);
        root.right.left = new TreeNode(4);
        System.out.println(levelOrder(root)); // [[1], [2, 3], [4]]
    }
}
```

**Reference — Python.**
```python
from collections import deque


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right


def level_order(root):
    result = []
    if not root:
        return result
    q = deque([root])
    while q:
        level = []
        for _ in range(len(q)):
            node = q.popleft()
            level.append(node.val)
            if node.left:
                q.append(node.left)
            if node.right:
                q.append(node.right)
        result.append(level)
    return result


if __name__ == "__main__":
    root = TreeNode(1, TreeNode(2), TreeNode(3, TreeNode(4)))
    print(level_order(root))  # [[1], [2, 3], [4]]
```

---

### Task 5 — Reconstruct one shortest path

**Statement.** Given an undirected unweighted graph, a source `src`, and a target `dst`, return one shortest path (list of vertices from `src` to `dst`) or an empty list if unreachable.

**Constraints.**
- `1 <= V <= 10^5`, `0 <= E <= 2·10^5`.
- Any one valid shortest path is acceptable.

**Hints.**
- Store `parent[v] = u` when you discover `v` from `u`.
- After BFS, check `dst` was reached before walking `parent` back; reverse the result.

**Reference — Go.**
```go
package main

import "fmt"

func shortestPath(adj [][]int, src, dst int) []int {
	n := len(adj)
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -2 // -2 = unvisited, -1 = source's parent
	}
	parent[src] = -1
	q := []int{src}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		if u == dst {
			break
		}
		for _, v := range adj[u] {
			if parent[v] == -2 {
				parent[v] = u
				q = append(q, v)
			}
		}
	}
	if parent[dst] == -2 {
		return nil
	}
	var path []int
	for cur := dst; cur != -1; cur = parent[cur] {
		path = append(path, cur)
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path
}

func main() {
	adj := [][]int{{1, 2}, {0, 3, 4}, {0, 4}, {1}, {1, 2, 5}, {4}}
	fmt.Println(shortestPath(adj, 0, 5)) // [0 1 4 5]
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task5 {
    public static List<Integer> shortestPath(List<List<Integer>> adj, int src, int dst) {
        int n = adj.size();
        int[] parent = new int[n];
        Arrays.fill(parent, -2);   // -2 unvisited, -1 source's parent
        parent[src] = -1;
        Deque<Integer> q = new ArrayDeque<>();
        q.add(src);
        while (!q.isEmpty()) {
            int u = q.poll();
            if (u == dst) break;
            for (int v : adj.get(u)) {
                if (parent[v] == -2) {
                    parent[v] = u;
                    q.add(v);
                }
            }
        }
        if (parent[dst] == -2) return List.of();
        LinkedList<Integer> path = new LinkedList<>();
        for (int cur = dst; cur != -1; cur = parent[cur]) path.addFirst(cur);
        return path;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1, 2), List.of(0, 3, 4), List.of(0, 4),
            List.of(1), List.of(1, 2, 5), List.of(4));
        System.out.println(shortestPath(adj, 0, 5)); // [0, 1, 4, 5]
    }
}
```

**Reference — Python.**
```python
from collections import deque


def shortest_path(adj, src, dst):
    parent = {src: None}
    q = deque([src])
    while q:
        u = q.popleft()
        if u == dst:
            break
        for v in adj[u]:
            if v not in parent:
                parent[v] = u
                q.append(v)
    if dst not in parent:
        return []
    path = []
    cur = dst
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    return path[::-1]


if __name__ == "__main__":
    adj = [[1, 2], [0, 3, 4], [0, 4], [1], [1, 2, 5], [4]]
    print(shortest_path(adj, 0, 5))  # [0, 1, 4, 5]
```

---

## Intermediate Tasks (5)

### Task 6 — Walls and gates (multi-source BFS)

**Statement.** Given a grid where `-1` is a wall, `0` is a gate, and `INF` (use `2^31 - 1`) is an empty room, fill each empty room with the distance to its nearest gate. Rooms that cannot reach a gate stay `INF`.

**Constraints.**
- `1 <= n, m <= 250`.
- Modify the grid in place. Required time: `O(n·m)`.

**Hints.**
- Seed the queue with *all* gates at distance 0 before the loop.
- A room is unvisited iff it still holds `INF`.

**Reference — Go.**
```go
package main

import "fmt"

const INF = 2147483647

func wallsAndGates(grid [][]int) {
	n := len(grid)
	if n == 0 {
		return
	}
	m := len(grid[0])
	type cell struct{ r, c int }
	var q []cell
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			if grid[r][c] == 0 {
				q = append(q, cell{r, c})
			}
		}
	}
	dirs := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == INF {
				grid[nr][nc] = grid[cur.r][cur.c] + 1
				q = append(q, cell{nr, nc})
			}
		}
	}
}

func main() {
	g := [][]int{{INF, -1, 0, INF}, {INF, INF, INF, -1}, {INF, -1, INF, -1}, {0, -1, INF, INF}}
	wallsAndGates(g)
	fmt.Println(g[0][0], g[3][3]) // 3 4
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task6 {
    static final int INF = Integer.MAX_VALUE;

    public static void wallsAndGates(int[][] grid) {
        int n = grid.length;
        if (n == 0) return;
        int m = grid[0].length;
        Deque<int[]> q = new ArrayDeque<>();
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++)
                if (grid[r][c] == 0) q.add(new int[]{r, c});
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            for (int[] d : dirs) {
                int nr = cur[0] + d[0], nc = cur[1] + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == INF) {
                    grid[nr][nc] = grid[cur[0]][cur[1]] + 1;
                    q.add(new int[]{nr, nc});
                }
            }
        }
    }

    public static void main(String[] args) {
        int[][] g = {{INF, -1, 0, INF}, {INF, INF, INF, -1},
                     {INF, -1, INF, -1}, {0, -1, INF, INF}};
        wallsAndGates(g);
        System.out.println(g[0][0] + " " + g[3][3]); // 3 4
    }
}
```

**Reference — Python.**
```python
from collections import deque

INF = 2147483647


def walls_and_gates(grid):
    n = len(grid)
    if n == 0:
        return
    m = len(grid[0])
    q = deque((r, c) for r in range(n) for c in range(m) if grid[r][c] == 0)
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while q:
        r, c = q.popleft()
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < m and grid[nr][nc] == INF:
                grid[nr][nc] = grid[r][c] + 1
                q.append((nr, nc))


if __name__ == "__main__":
    g = [[INF, -1, 0, INF], [INF, INF, INF, -1],
         [INF, -1, INF, -1], [0, -1, INF, INF]]
    walls_and_gates(g)
    print(g[0][0], g[3][3])  # 3 4
```

---

### Task 7 — Bipartite check (BFS 2-coloring)

**Statement.** Given an undirected graph as an adjacency list, return whether it is bipartite. Handle disconnected graphs.

**Constraints.**
- `1 <= V <= 10^5`, `0 <= E <= 2·10^5`.
- Required time: `O(V + E)`.

**Hints.**
- Color the source 0, neighbors 1, alternating with `color[u] ^ 1`.
- A same-color edge means an odd cycle → not bipartite.

**Reference — Go.**
```go
package main

import "fmt"

func isBipartite(adj [][]int) bool {
	n := len(adj)
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	for s := 0; s < n; s++ {
		if color[s] != -1 {
			continue
		}
		color[s] = 0
		q := []int{s}
		for len(q) > 0 {
			u := q[0]
			q = q[1:]
			for _, v := range adj[u] {
				if color[v] == -1 {
					color[v] = color[u] ^ 1
					q = append(q, v)
				} else if color[v] == color[u] {
					return false
				}
			}
		}
	}
	return true
}

func main() {
	fmt.Println(isBipartite([][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}}))    // true
	fmt.Println(isBipartite([][]int{{1, 2, 3}, {0, 2}, {0, 1, 3}, {0, 2}})) // false
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task7 {
    public static boolean isBipartite(List<List<Integer>> adj) {
        int n = adj.size();
        int[] color = new int[n];
        Arrays.fill(color, -1);
        for (int s = 0; s < n; s++) {
            if (color[s] != -1) continue;
            color[s] = 0;
            Deque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) {
                    if (color[v] == -1) {
                        color[v] = color[u] ^ 1;
                        q.add(v);
                    } else if (color[v] == color[u]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isBipartite(List.of(
            List.of(1, 3), List.of(0, 2), List.of(1, 3), List.of(0, 2)))); // true
    }
}
```

**Reference — Python.**
```python
from collections import deque


def is_bipartite(adj):
    n = len(adj)
    color = [-1] * n
    for s in range(n):
        if color[s] != -1:
            continue
        color[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if color[v] == -1:
                    color[v] = color[u] ^ 1
                    q.append(v)
                elif color[v] == color[u]:
                    return False
    return True


if __name__ == "__main__":
    print(is_bipartite([[1, 3], [0, 2], [1, 3], [0, 2]]))           # True
    print(is_bipartite([[1, 2, 3], [0, 2], [0, 1, 3], [0, 2]]))     # False
```

---

### Task 8 — Word ladder (implicit state-graph BFS)

**Statement.** Given `begin`, `end`, and a word list, return the number of words in the shortest transformation sequence (one letter changed per step, every intermediate word in the list), or 0 if impossible.

**Constraints.**
- All words have the same length `L`, `1 <= L <= 10`.
- `1 <= len(wordList) <= 5000`.

**Hints.**
- Generate neighbors lazily: try every letter at every position.
- Key the visited set by the word string; process level by level.

**Reference — Go.**
```go
package main

import "fmt"

func ladderLength(begin, end string, wordList []string) int {
	words := map[string]bool{}
	for _, w := range wordList {
		words[w] = true
	}
	if !words[end] {
		return 0
	}
	q := []string{begin}
	seen := map[string]bool{begin: true}
	dist := 1
	for len(q) > 0 {
		var next []string
		for _, word := range q {
			if word == end {
				return dist
			}
			b := []byte(word)
			for i := range b {
				orig := b[i]
				for ch := byte('a'); ch <= 'z'; ch++ {
					b[i] = ch
					cand := string(b)
					if words[cand] && !seen[cand] {
						seen[cand] = true
						next = append(next, cand)
					}
				}
				b[i] = orig
			}
		}
		q = next
		dist++
	}
	return 0
}

func main() {
	fmt.Println(ladderLength("hit", "cog",
		[]string{"hot", "dot", "dog", "lot", "log", "cog"})) // 5
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task8 {
    public static int ladderLength(String begin, String end, List<String> wordList) {
        Set<String> words = new HashSet<>(wordList);
        if (!words.contains(end)) return 0;
        Deque<String> q = new ArrayDeque<>();
        q.add(begin);
        Set<String> seen = new HashSet<>(List.of(begin));
        int dist = 1;
        while (!q.isEmpty()) {
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                String word = q.poll();
                if (word.equals(end)) return dist;
                char[] chars = word.toCharArray();
                for (int j = 0; j < chars.length; j++) {
                    char orig = chars[j];
                    for (char ch = 'a'; ch <= 'z'; ch++) {
                        chars[j] = ch;
                        String cand = new String(chars);
                        if (words.contains(cand) && seen.add(cand)) q.add(cand);
                    }
                    chars[j] = orig;
                }
            }
            dist++;
        }
        return 0;
    }

    public static void main(String[] args) {
        System.out.println(ladderLength("hit", "cog",
            List.of("hot", "dot", "dog", "lot", "log", "cog"))); // 5
    }
}
```

**Reference — Python.**
```python
from collections import deque
from string import ascii_lowercase


def ladder_length(begin, end, word_list):
    words = set(word_list)
    if end not in words:
        return 0
    q = deque([(begin, 1)])
    seen = {begin}
    while q:
        word, dist = q.popleft()
        if word == end:
            return dist
        for i in range(len(word)):
            for ch in ascii_lowercase:
                cand = word[:i] + ch + word[i + 1:]
                if cand in words and cand not in seen:
                    seen.add(cand)
                    q.append((cand, dist + 1))
    return 0


if __name__ == "__main__":
    print(ladder_length("hit", "cog",
                        ["hot", "dot", "dog", "lot", "log", "cog"]))  # 5
```

---

### Task 9 — Number of islands (grid component count)

**Statement.** Given a grid of `'1'` (land) and `'0'` (water), count the islands. An island is a maximal group of 4-adjacent land cells.

**Constraints.**
- `1 <= n, m <= 1000`.
- Required time: `O(n·m)`.

**Hints.**
- Scan the grid; when you hit an unvisited land cell, BFS-flood the whole island and count it once.
- Mark cells visited (e.g. overwrite `'1' → '0'`) at enqueue time to avoid recounting.

**Reference — Go.**
```go
package main

import "fmt"

func numIslands(grid [][]byte) int {
	n := len(grid)
	if n == 0 {
		return 0
	}
	m := len(grid[0])
	dirs := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	type cell struct{ r, c int }
	count := 0
	for r := 0; r < n; r++ {
		for c := 0; c < m; c++ {
			if grid[r][c] != '1' {
				continue
			}
			count++
			grid[r][c] = '0'
			q := []cell{{r, c}}
			for len(q) > 0 {
				cur := q[0]
				q = q[1:]
				for _, d := range dirs {
					nr, nc := cur.r+d[0], cur.c+d[1]
					if nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == '1' {
						grid[nr][nc] = '0'
						q = append(q, cell{nr, nc})
					}
				}
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
import java.util.*;

public class Task9 {
    public static int numIslands(char[][] grid) {
        int n = grid.length;
        if (n == 0) return 0;
        int m = grid[0].length;
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        int count = 0;
        for (int r = 0; r < n; r++) {
            for (int c = 0; c < m; c++) {
                if (grid[r][c] != '1') continue;
                count++;
                grid[r][c] = '0';
                Deque<int[]> q = new ArrayDeque<>();
                q.add(new int[]{r, c});
                while (!q.isEmpty()) {
                    int[] cur = q.poll();
                    for (int[] d : dirs) {
                        int nr = cur[0] + d[0], nc = cur[1] + d[1];
                        if (nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == '1') {
                            grid[nr][nc] = '0';
                            q.add(new int[]{nr, nc});
                        }
                    }
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        char[][] grid = {
            {'1', '1', '0', '0'},
            {'1', '0', '0', '1'},
            {'0', '0', '1', '1'}
        };
        System.out.println(numIslands(grid)); // 2
    }
}
```

**Reference — Python.**
```python
from collections import deque


def num_islands(grid):
    n = len(grid)
    if n == 0:
        return 0
    m = len(grid[0])
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    count = 0
    for r in range(n):
        for c in range(m):
            if grid[r][c] != '1':
                continue
            count += 1
            grid[r][c] = '0'
            q = deque([(r, c)])
            while q:
                cr, cc = q.popleft()
                for dr, dc in dirs:
                    nr, nc = cr + dr, cc + dc
                    if 0 <= nr < n and 0 <= nc < m and grid[nr][nc] == '1':
                        grid[nr][nc] = '0'
                        q.append((nr, nc))
    return count


if __name__ == "__main__":
    grid = [['1', '1', '0', '0'],
            ['1', '0', '0', '1'],
            ['0', '0', '1', '1']]
    print(num_islands(grid))  # 2
```

---

### Task 10 — Open the lock (state-graph BFS with a blocklist)

**Statement.** A 4-wheel lock starts at `"0000"`. Each move turns one wheel one slot (0↔9 wrap). Given a list of deadend states you must never enter, return the fewest moves to reach `target`, or `-1`.

**Constraints.**
- States are 4-digit strings.
- `0 <= len(deadends) <= 500`.

**Hints.**
- Each state has 8 neighbors (two per wheel). The state space is `10^4`.
- Treat deadends as already-visited so they are never enqueued.

**Reference — Go.**
```go
package main

import "fmt"

func openLock(deadends []string, target string) int {
	seen := map[string]bool{}
	for _, d := range deadends {
		seen[d] = true
	}
	if seen["0000"] {
		return -1
	}
	if target == "0000" {
		return 0
	}
	seen["0000"] = true
	q := []string{"0000"}
	steps := 0
	for len(q) > 0 {
		steps++
		var next []string
		for _, cur := range q {
			b := []byte(cur)
			for i := 0; i < 4; i++ {
				orig := b[i]
				for _, delta := range []int{1, 9} { // +1 and -1 (mod 10)
					b[i] = byte('0' + (int(orig-'0')+delta)%10)
					cand := string(b)
					if cand == target {
						return steps
					}
					if !seen[cand] {
						seen[cand] = true
						next = append(next, cand)
					}
				}
				b[i] = orig
			}
		}
		q = next
	}
	return -1
}

func main() {
	fmt.Println(openLock([]string{"0201", "0101", "0102", "1212", "2002"}, "0202")) // 6
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task10 {
    public static int openLock(String[] deadends, String target) {
        Set<String> seen = new HashSet<>(Arrays.asList(deadends));
        if (seen.contains("0000")) return -1;
        if (target.equals("0000")) return 0;
        seen.add("0000");
        Deque<String> q = new ArrayDeque<>();
        q.add("0000");
        int steps = 0;
        while (!q.isEmpty()) {
            steps++;
            int sz = q.size();
            for (int s = 0; s < sz; s++) {
                char[] b = q.poll().toCharArray();
                for (int i = 0; i < 4; i++) {
                    char orig = b[i];
                    for (int delta : new int[]{1, 9}) {
                        b[i] = (char) ('0' + ((orig - '0') + delta) % 10);
                        String cand = new String(b);
                        if (cand.equals(target)) return steps;
                        if (seen.add(cand)) q.add(cand);
                    }
                    b[i] = orig;
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(openLock(
            new String[]{"0201", "0101", "0102", "1212", "2002"}, "0202")); // 6
    }
}
```

**Reference — Python.**
```python
from collections import deque


def open_lock(deadends, target):
    seen = set(deadends)
    if "0000" in seen:
        return -1
    if target == "0000":
        return 0
    seen.add("0000")
    q = deque([("0000", 0)])
    while q:
        cur, steps = q.popleft()
        for i in range(4):
            d = int(cur[i])
            for nd in ((d + 1) % 10, (d - 1) % 10):
                cand = cur[:i] + str(nd) + cur[i + 1:]
                if cand == target:
                    return steps + 1
                if cand not in seen:
                    seen.add(cand)
                    q.append((cand, steps + 1))
    return -1


if __name__ == "__main__":
    print(open_lock(["0201", "0101", "0102", "1212", "2002"], "0202"))  # 6
```

---

## Advanced Tasks (5)

### Task 11 — Shortest path in a binary matrix (8-directional)

**Statement.** Given an `n×n` grid of 0s (open) and 1s (blocked), return the length of the shortest clear top-left to bottom-right path moving in 8 directions, counting *cells* visited. Return `-1` if none exists.

**Constraints.**
- `1 <= n <= 100`.
- Required time: `O(n²)`.

**Hints.**
- Eight direction offsets; path length counts cells, so the start cell is distance 1.
- Reject immediately if the start or goal cell is blocked.

**Reference — Go.**
```go
package main

import "fmt"

func shortestPathBinaryMatrix(grid [][]int) int {
	n := len(grid)
	if grid[0][0] == 1 || grid[n-1][n-1] == 1 {
		return -1
	}
	dist := make([][]int, n)
	for i := range dist {
		dist[i] = make([]int, n)
	}
	dist[0][0] = 1
	type cell struct{ r, c int }
	q := []cell{{0, 0}}
	dirs := [8][2]int{{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		if cur.r == n-1 && cur.c == n-1 {
			return dist[cur.r][cur.c]
		}
		for _, d := range dirs {
			nr, nc := cur.r+d[0], cur.c+d[1]
			if nr >= 0 && nr < n && nc >= 0 && nc < n &&
				grid[nr][nc] == 0 && dist[nr][nc] == 0 {
				dist[nr][nc] = dist[cur.r][cur.c] + 1
				q = append(q, cell{nr, nc})
			}
		}
	}
	return -1
}

func main() {
	fmt.Println(shortestPathBinaryMatrix([][]int{{0, 0, 0}, {1, 1, 0}, {1, 1, 0}})) // 4
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task11 {
    public static int shortestPathBinaryMatrix(int[][] grid) {
        int n = grid.length;
        if (grid[0][0] == 1 || grid[n - 1][n - 1] == 1) return -1;
        int[][] dist = new int[n][n];
        dist[0][0] = 1;
        Deque<int[]> q = new ArrayDeque<>();
        q.add(new int[]{0, 0});
        int[][] dirs = {{-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int r = cur[0], c = cur[1];
            if (r == n - 1 && c == n - 1) return dist[r][c];
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n
                        && grid[nr][nc] == 0 && dist[nr][nc] == 0) {
                    dist[nr][nc] = dist[r][c] + 1;
                    q.add(new int[]{nr, nc});
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(shortestPathBinaryMatrix(
            new int[][]{{0, 0, 0}, {1, 1, 0}, {1, 1, 0}})); // 4
    }
}
```

**Reference — Python.**
```python
from collections import deque


def shortest_path_binary_matrix(grid):
    n = len(grid)
    if grid[0][0] == 1 or grid[n - 1][n - 1] == 1:
        return -1
    dist = [[0] * n for _ in range(n)]
    dist[0][0] = 1
    q = deque([(0, 0)])
    dirs = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    while q:
        r, c = q.popleft()
        if r == n - 1 and c == n - 1:
            return dist[r][c]
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0 and dist[nr][nc] == 0:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return -1


if __name__ == "__main__":
    print(shortest_path_binary_matrix([[0, 0, 0], [1, 1, 0], [1, 1, 0]]))  # 4
```

---

### Task 12 — Bidirectional BFS for point-to-point distance

**Statement.** Given an undirected unweighted graph and two vertices `s` and `t`, return the shortest edge distance between them using bidirectional BFS (expand from both ends, stop when frontiers meet). Return `-1` if disconnected.

**Constraints.**
- `1 <= V <= 10^5`.
- Always expand the smaller frontier to keep work balanced.

**Hints.**
- Maintain two visited sets and two frontiers; alternate.
- When expanding `s`'s frontier, if any neighbor is in `t`'s seen set, the frontiers have met.

**Reference — Go.**
```go
package main

import "fmt"

func distance(adj [][]int, s, t int) int {
	if s == t {
		return 0
	}
	frontS := map[int]bool{s: true}
	frontT := map[int]bool{t: true}
	seenS := map[int]bool{s: true}
	seenT := map[int]bool{t: true}
	dist := 0
	for len(frontS) > 0 && len(frontT) > 0 {
		if len(frontS) > len(frontT) {
			frontS, frontT = frontT, frontS
			seenS, seenT = seenT, seenS
		}
		dist++
		next := map[int]bool{}
		for u := range frontS {
			for _, v := range adj[u] {
				if seenT[v] {
					return dist
				}
				if !seenS[v] {
					seenS[v] = true
					next[v] = true
				}
			}
		}
		frontS = next
	}
	return -1
}

func main() {
	adj := [][]int{{1, 2}, {0, 3}, {0, 3}, {1, 2, 4}, {3}}
	fmt.Println(distance(adj, 0, 4)) // 3
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task12 {
    public static int distance(List<List<Integer>> adj, int s, int t) {
        if (s == t) return 0;
        Set<Integer> frontS = new HashSet<>(List.of(s));
        Set<Integer> frontT = new HashSet<>(List.of(t));
        Set<Integer> seenS = new HashSet<>(frontS);
        Set<Integer> seenT = new HashSet<>(frontT);
        int dist = 0;
        while (!frontS.isEmpty() && !frontT.isEmpty()) {
            if (frontS.size() > frontT.size()) {
                Set<Integer> tmp = frontS; frontS = frontT; frontT = tmp;
                Set<Integer> tmp2 = seenS; seenS = seenT; seenT = tmp2;
            }
            dist++;
            Set<Integer> next = new HashSet<>();
            for (int u : frontS) {
                for (int v : adj.get(u)) {
                    if (seenT.contains(v)) return dist;
                    if (seenS.add(v)) next.add(v);
                }
            }
            frontS = next;
        }
        return -1;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1, 2), List.of(0, 3), List.of(0, 3),
            List.of(1, 2, 4), List.of(3));
        System.out.println(distance(adj, 0, 4)); // 3
    }
}
```

**Reference — Python.**
```python
def distance(adj, s, t):
    if s == t:
        return 0
    front_s, front_t = {s}, {t}
    seen_s, seen_t = {s}, {t}
    dist = 0
    while front_s and front_t:
        if len(front_s) > len(front_t):
            front_s, front_t = front_t, front_s
            seen_s, seen_t = seen_t, seen_s
        dist += 1
        nxt = set()
        for u in front_s:
            for v in adj[u]:
                if v in seen_t:
                    return dist
                if v not in seen_s:
                    seen_s.add(v)
                    nxt.add(v)
        front_s = nxt
    return -1


if __name__ == "__main__":
    adj = [[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]
    print(distance(adj, 0, 4))  # 3
```

---

### Task 13 — Count shortest paths between two nodes

**Statement.** Given an undirected unweighted graph, a source `src`, and a target `dst`, return the number of distinct shortest paths from `src` to `dst`. Use modulo `10^9 + 7`.

**Constraints.**
- `1 <= V <= 10^5`.
- Required time: `O(V + E)`.

**Hints.**
- Run BFS computing `dist`. Maintain `cnt[v]`: when you first reach `v` from `u`, set `cnt[v] = cnt[u]`; when you reach `v` again at the same level (`dist[u] + 1 == dist[v]`), add `cnt[u]`.
- Process nodes in BFS (distance) order so all contributors to `v` are settled first.

**Reference — Go.**
```go
package main

import "fmt"

const MOD = 1000000007

func countShortestPaths(adj [][]int, src, dst int) int {
	n := len(adj)
	dist := make([]int, n)
	cnt := make([]int, n)
	for i := range dist {
		dist[i] = -1
	}
	dist[src] = 0
	cnt[src] = 1
	q := []int{src}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		for _, v := range adj[u] {
			if dist[v] == -1 {
				dist[v] = dist[u] + 1
				cnt[v] = cnt[u]
				q = append(q, v)
			} else if dist[v] == dist[u]+1 {
				cnt[v] = (cnt[v] + cnt[u]) % MOD
			}
		}
	}
	if dist[dst] == -1 {
		return 0
	}
	return cnt[dst]
}

func main() {
	adj := [][]int{{1, 2}, {0, 3}, {0, 3}, {1, 2}}
	fmt.Println(countShortestPaths(adj, 0, 3)) // 2
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task13 {
    static final int MOD = 1_000_000_007;

    public static int countShortestPaths(List<List<Integer>> adj, int src, int dst) {
        int n = adj.size();
        int[] dist = new int[n];
        long[] cnt = new long[n];
        Arrays.fill(dist, -1);
        dist[src] = 0;
        cnt[src] = 1;
        Deque<Integer> q = new ArrayDeque<>();
        q.add(src);
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int v : adj.get(u)) {
                if (dist[v] == -1) {
                    dist[v] = dist[u] + 1;
                    cnt[v] = cnt[u];
                    q.add(v);
                } else if (dist[v] == dist[u] + 1) {
                    cnt[v] = (cnt[v] + cnt[u]) % MOD;
                }
            }
        }
        return dist[dst] == -1 ? 0 : (int) cnt[dst];
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = List.of(
            List.of(1, 2), List.of(0, 3), List.of(0, 3), List.of(1, 2));
        System.out.println(countShortestPaths(adj, 0, 3)); // 2
    }
}
```

**Reference — Python.**
```python
from collections import deque

MOD = 1_000_000_007


def count_shortest_paths(adj, src, dst):
    n = len(adj)
    dist = [-1] * n
    cnt = [0] * n
    dist[src] = 0
    cnt[src] = 1
    q = deque([src])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if dist[v] == -1:
                dist[v] = dist[u] + 1
                cnt[v] = cnt[u]
                q.append(v)
            elif dist[v] == dist[u] + 1:
                cnt[v] = (cnt[v] + cnt[u]) % MOD
    return 0 if dist[dst] == -1 else cnt[dst]


if __name__ == "__main__":
    print(count_shortest_paths([[1, 2], [0, 3], [0, 3], [1, 2]], 0, 3))  # 2
```

---

### Task 14 — Shortest bridge (two-phase BFS)

**Statement.** Given a grid with exactly two islands of `1`s (4-connected), return the minimum number of `0`s you must flip to connect them. Equivalently, the fewest steps across water between the two islands.

**Constraints.**
- `2 <= n, m <= 100`, exactly two islands.
- Required time: `O(n·m)`.

**Hints.**
- Phase 1: flood-fill (BFS) the first island you find, marking its cells and seeding them all into a queue.
- Phase 2: multi-source BFS outward from the whole first island; the number of expansion rings until you touch the second island is the answer.

**Reference — Go.**
```go
package main

import "fmt"

func shortestBridge(grid [][]int) int {
	n, m := len(grid), len(grid[0])
	dirs := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	type cell struct{ r, c int }
	var q []cell

	// Phase 1: find and flood the first island, mark as 2, seed queue.
	var floodFirst func()
	floodFirst = func() {
		for r := 0; r < n; r++ {
			for c := 0; c < m; c++ {
				if grid[r][c] == 1 {
					stack := []cell{{r, c}}
					grid[r][c] = 2
					for len(stack) > 0 {
						cur := stack[len(stack)-1]
						stack = stack[:len(stack)-1]
						q = append(q, cur)
						for _, d := range dirs {
							nr, nc := cur.r+d[0], cur.c+d[1]
							if nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1 {
								grid[nr][nc] = 2
								stack = append(stack, cell{nr, nc})
							}
						}
					}
					return
				}
			}
		}
	}
	floodFirst()

	// Phase 2: multi-source BFS outward until we hit the second island (a 1).
	steps := 0
	for len(q) > 0 {
		var next []cell
		for _, cur := range q {
			for _, d := range dirs {
				nr, nc := cur.r+d[0], cur.c+d[1]
				if nr < 0 || nr >= n || nc < 0 || nc >= m {
					continue
				}
				if grid[nr][nc] == 1 {
					return steps
				}
				if grid[nr][nc] == 0 {
					grid[nr][nc] = 2
					next = append(next, cell{nr, nc})
				}
			}
		}
		q = next
		steps++
	}
	return -1
}

func main() {
	grid := [][]int{{0, 1, 0}, {0, 0, 0}, {0, 0, 1}}
	fmt.Println(shortestBridge(grid)) // 2
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task14 {
    static int n, m;
    static int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};

    public static int shortestBridge(int[][] grid) {
        n = grid.length; m = grid[0].length;
        Deque<int[]> q = new ArrayDeque<>();
        outer:
        for (int r = 0; r < n; r++)
            for (int c = 0; c < m; c++)
                if (grid[r][c] == 1) { flood(grid, r, c, q); break outer; }

        int steps = 0;
        while (!q.isEmpty()) {
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                int[] cur = q.poll();
                for (int[] d : dirs) {
                    int nr = cur[0] + d[0], nc = cur[1] + d[1];
                    if (nr < 0 || nr >= n || nc < 0 || nc >= m) continue;
                    if (grid[nr][nc] == 1) return steps;
                    if (grid[nr][nc] == 0) {
                        grid[nr][nc] = 2;
                        q.add(new int[]{nr, nc});
                    }
                }
            }
            steps++;
        }
        return -1;
    }

    static void flood(int[][] grid, int r, int c, Deque<int[]> q) {
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{r, c});
        grid[r][c] = 2;
        while (!st.isEmpty()) {
            int[] cur = st.pop();
            q.add(cur);
            for (int[] d : dirs) {
                int nr = cur[0] + d[0], nc = cur[1] + d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < m && grid[nr][nc] == 1) {
                    grid[nr][nc] = 2;
                    st.push(new int[]{nr, nc});
                }
            }
        }
    }

    public static void main(String[] args) {
        int[][] grid = {{0, 1, 0}, {0, 0, 0}, {0, 0, 1}};
        System.out.println(shortestBridge(grid)); // 2
    }
}
```

**Reference — Python.**
```python
from collections import deque


def shortest_bridge(grid):
    n, m = len(grid), len(grid[0])
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    q = deque()

    def flood(sr, sc):
        stack = [(sr, sc)]
        grid[sr][sc] = 2
        while stack:
            r, c = stack.pop()
            q.append((r, c))
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < n and 0 <= nc < m and grid[nr][nc] == 1:
                    grid[nr][nc] = 2
                    stack.append((nr, nc))

    found = False
    for r in range(n):
        for c in range(m):
            if grid[r][c] == 1:
                flood(r, c)
                found = True
                break
        if found:
            break

    steps = 0
    while q:
        for _ in range(len(q)):
            r, c = q.popleft()
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < n and 0 <= nc < m:
                    if grid[nr][nc] == 1:
                        return steps
                    if grid[nr][nc] == 0:
                        grid[nr][nc] = 2
                        q.append((nr, nc))
        steps += 1
    return -1


if __name__ == "__main__":
    print(shortest_bridge([[0, 1, 0], [0, 0, 0], [0, 0, 1]]))  # 2
```

---

### Task 15 — Minimum genetic mutation with implicit pruning

**Statement.** A gene is an 8-char string over `{A, C, G, T}`. One mutation changes a single character. Given `start`, `end`, and a `bank` of valid genes, return the fewest mutations to turn `start` into `end` where every intermediate gene is in the bank, or `-1`.

**Constraints.**
- Gene length is 8.
- `0 <= len(bank) <= 10`.

**Hints.**
- This is word ladder over a 4-letter alphabet; generate neighbors by trying every letter at every position.
- Only enqueue candidates that are in the bank and unseen; process level by level.

**Reference — Go.**
```go
package main

import "fmt"

func minMutation(start, end string, bank []string) int {
	valid := map[string]bool{}
	for _, b := range bank {
		valid[b] = true
	}
	if !valid[end] {
		return -1
	}
	if start == end {
		return 0
	}
	letters := []byte{'A', 'C', 'G', 'T'}
	q := []string{start}
	seen := map[string]bool{start: true}
	steps := 0
	for len(q) > 0 {
		steps++
		var next []string
		for _, gene := range q {
			b := []byte(gene)
			for i := range b {
				orig := b[i]
				for _, ch := range letters {
					if ch == orig {
						continue
					}
					b[i] = ch
					cand := string(b)
					if cand == end {
						return steps
					}
					if valid[cand] && !seen[cand] {
						seen[cand] = true
						next = append(next, cand)
					}
				}
				b[i] = orig
			}
		}
		q = next
	}
	return -1
}

func main() {
	fmt.Println(minMutation("AACCGGTT", "AAACGGTA",
		[]string{"AACCGGTA", "AACCGCTA", "AAACGGTA"})) // 2
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task15 {
    public static int minMutation(String start, String end, String[] bank) {
        Set<String> valid = new HashSet<>(Arrays.asList(bank));
        if (!valid.contains(end)) return -1;
        if (start.equals(end)) return 0;
        char[] letters = {'A', 'C', 'G', 'T'};
        Deque<String> q = new ArrayDeque<>();
        q.add(start);
        Set<String> seen = new HashSet<>(List.of(start));
        int steps = 0;
        while (!q.isEmpty()) {
            steps++;
            int sz = q.size();
            for (int s = 0; s < sz; s++) {
                char[] b = q.poll().toCharArray();
                for (int i = 0; i < b.length; i++) {
                    char orig = b[i];
                    for (char ch : letters) {
                        if (ch == orig) continue;
                        b[i] = ch;
                        String cand = new String(b);
                        if (cand.equals(end)) return steps;
                        if (valid.contains(cand) && seen.add(cand)) q.add(cand);
                    }
                    b[i] = orig;
                }
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(minMutation("AACCGGTT", "AAACGGTA",
            new String[]{"AACCGGTA", "AACCGCTA", "AAACGGTA"})); // 2
    }
}
```

**Reference — Python.**
```python
from collections import deque


def min_mutation(start, end, bank):
    valid = set(bank)
    if end not in valid:
        return -1
    if start == end:
        return 0
    q = deque([(start, 0)])
    seen = {start}
    for gene, steps in iter(lambda: q.popleft() if q else None, None):
        for i in range(len(gene)):
            for ch in "ACGT":
                if ch == gene[i]:
                    continue
                cand = gene[:i] + ch + gene[i + 1:]
                if cand == end:
                    return steps + 1
                if cand in valid and cand not in seen:
                    seen.add(cand)
                    q.append((cand, steps + 1))
    return -1


if __name__ == "__main__":
    print(min_mutation("AACCGGTT", "AAACGGTA",
                        ["AACCGGTA", "AACCGCTA", "AAACGGTA"]))  # 2
```

---

## Benchmark Task

### Task B — Frontier-width and runtime of BFS at scale

**Statement.** Empirically validate two claims from the senior/professional material on a generated graph:
1. BFS runs in `O(V + E)` — runtime should scale roughly linearly as you grow the graph.
2. The **peak frontier width** on a well-connected random graph reaches a constant fraction of `V`, which is the root cause of wide-frontier OOM.

Generate Erdős–Rényi random graphs `G(n, p)` with average degree `c = n·p ≈ 8` (so `p = 8/n`). For `n ∈ {10^4, 10^5, 10^6}`:
- Build the adjacency list.
- Run a single-source BFS that records, per level, the frontier size, and reports: total time, number of levels (≈ `log n / log c`), and the peak frontier size as a fraction of `n`.

**Constraints.**
- Use `collections.deque` (Python) / `ArrayDeque` (Java) / a slice with a head index (Go) — never `list.pop(0)`.
- Mark visited at enqueue time; verify each vertex is dequeued exactly once.
- Process one ring at a time so you can measure per-level frontier width.

**What to observe.**
- Time grows roughly linearly in `V + E` (here `E ≈ 4n`), confirming `O(V + E)`.
- Levels stay tiny (a handful) even as `n` grows 100×, confirming the small-world `O(log n)` diameter.
- Peak frontier width sits at a *constant fraction* of `n` (often 0.3–0.6), independent of `n` — the formal justification for the wide-frontier OOM warning.

**Reference — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func buildGraph(n, avgDeg int) [][]int32 {
	adj := make([][]int32, n)
	edges := n * avgDeg / 2
	for i := 0; i < edges; i++ {
		u, v := rand.Intn(n), rand.Intn(n)
		if u == v {
			continue
		}
		adj[u] = append(adj[u], int32(v))
		adj[v] = append(adj[v], int32(u))
	}
	return adj
}

func bfsStats(adj [][]int32, src int) (dur time.Duration, levels int, peakFrac float64) {
	n := len(adj)
	dist := make([]int32, n)
	for i := range dist {
		dist[i] = -1
	}
	start := time.Now()
	dist[src] = 0
	frontier := []int32{int32(src)}
	peak := 1
	for len(frontier) > 0 {
		levels++
		if len(frontier) > peak {
			peak = len(frontier)
		}
		var next []int32
		for _, u := range frontier {
			for _, v := range adj[u] {
				if dist[v] == -1 {
					dist[v] = dist[u] + 1
					next = append(next, v)
				}
			}
		}
		frontier = next
	}
	return time.Since(start), levels, float64(peak) / float64(n)
}

func main() {
	for _, n := range []int{10000, 100000, 1000000} {
		adj := buildGraph(n, 8)
		dur, levels, peak := bfsStats(adj, 0)
		fmt.Printf("n=%-8d time=%-12v levels=%-3d peakFrac=%.3f\n", n, dur, levels, peak)
	}
}
```

**Reference — Java.**
```java
import java.util.*;

public class TaskB {
    static List<List<Integer>> buildGraph(int n, int avgDeg) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        Random rnd = new Random(42);
        int edges = n * avgDeg / 2;
        for (int i = 0; i < edges; i++) {
            int u = rnd.nextInt(n), v = rnd.nextInt(n);
            if (u == v) continue;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        return adj;
    }

    static void bfsStats(List<List<Integer>> adj, int src, int n) {
        int[] dist = new int[n];
        Arrays.fill(dist, -1);
        long t0 = System.nanoTime();
        dist[src] = 0;
        List<Integer> frontier = new ArrayList<>(List.of(src));
        int levels = 0, peak = 1;
        while (!frontier.isEmpty()) {
            levels++;
            peak = Math.max(peak, frontier.size());
            List<Integer> next = new ArrayList<>();
            for (int u : frontier)
                for (int v : adj.get(u))
                    if (dist[v] == -1) { dist[v] = dist[u] + 1; next.add(v); }
            frontier = next;
        }
        double ms = (System.nanoTime() - t0) / 1e6;
        System.out.printf("n=%-8d time=%-8.1fms levels=%-3d peakFrac=%.3f%n",
            n, ms, levels, (double) peak / n);
    }

    public static void main(String[] args) {
        for (int n : new int[]{10000, 100000, 1000000}) {
            bfsStats(buildGraph(n, 8), 0, n);
        }
    }
}
```

**Reference — Python.**
```python
import random
import time
from collections import deque


def build_graph(n, avg_deg):
    adj = [[] for _ in range(n)]
    edges = n * avg_deg // 2
    for _ in range(edges):
        u, v = random.randrange(n), random.randrange(n)
        if u == v:
            continue
        adj[u].append(v)
        adj[v].append(u)
    return adj


def bfs_stats(adj, src):
    n = len(adj)
    dist = [-1] * n
    t0 = time.perf_counter()
    dist[src] = 0
    frontier = [src]
    levels = 0
    peak = 1
    while frontier:
        levels += 1
        peak = max(peak, len(frontier))
        nxt = []
        for u in frontier:
            for v in adj[u]:
                if dist[v] == -1:
                    dist[v] = dist[u] + 1
                    nxt.append(v)
        frontier = nxt
    return time.perf_counter() - t0, levels, peak / n


if __name__ == "__main__":
    for n in (10_000, 100_000, 1_000_000):
        adj = build_graph(n, 8)
        dur, levels, peak = bfs_stats(adj, 0)
        print(f"n={n:<8} time={dur*1000:8.1f}ms levels={levels:<3} peakFrac={peak:.3f}")
```

**Evaluation criteria.**
- Correctness: every vertex in the giant component gets a finite distance; isolated vertices stay `-1`.
- Performance: per-edge time stays roughly flat as `n` grows (linear total), proving `O(V + E)`.
- Insight: you can explain why levels grow like `O(log n)` and why peak frontier width is a constant fraction of `V` — and therefore why bounding depth, going bidirectional, or switching to bottom-up BFS is the standard defense against wide-frontier OOM.
