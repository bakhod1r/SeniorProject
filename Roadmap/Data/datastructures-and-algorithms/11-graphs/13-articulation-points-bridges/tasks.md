# Articulation Points & Bridges — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a full reference solution in all three languages.
> Graphs are undirected unless stated otherwise. Vertices are `0..n-1`.

---

## Beginner Tasks (5)

### Task 1 — Count the bridges

**Problem.** Given an undirected connected graph, count how many edges are bridges (edges whose removal disconnects the graph).

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: a single integer — the number of bridges.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.
- No self-loops; no multi-edges in this task.
- Time: `O(n + m)`.

**Hint.** Single `disc`/`low` DFS. A tree edge `(u, v)` is a bridge iff `low[v] > disc[u]`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	count := 0
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] > disc[u] {
					count++
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	fmt.Println(count)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int[] disc, low;
    static List<List<Integer>> adj;
    static int timer = 0, count = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) count++;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer t = new StreamTokenizer(br);
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n];
        low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        System.out.println(count);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    count = [0]

    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    count[0] += 1
            else:
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    print(count[0])


if __name__ == "__main__":
    main()
```

---

### Task 2 — Count the articulation points

**Problem.** Given an undirected graph (possibly disconnected), count the number of articulation points.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: a single integer — the number of articulation points.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.
- Time: `O(n + m)`.

**Hint.** Non-root `u` is a cut vertex if some child `v` has `low[v] >= disc[u]`; the root is one if it has `>= 2` DFS children. Use a boolean array to avoid double-counting.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	isAP := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		children := 0
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				children++
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if parent != -1 && low[v] >= disc[u] {
					isAP[u] = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if parent == -1 && children >= 2 {
			isAP[u] = true
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	cnt := 0
	for i := 0; i < n; i++ {
		if isAP[i] {
			cnt++
		}
	}
	fmt.Println(cnt)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    static int[] disc, low;
    static boolean[] isAP;
    static List<List<Integer>> adj;
    static int timer = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        int children = 0;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                children++;
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (parent != -1 && low[v] >= disc[u]) isAP[u] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (parent == -1 && children >= 2) isAP[u] = true;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n];
        low = new int[n];
        isAP = new boolean[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        int cnt = 0;
        for (boolean b : isAP) if (b) cnt++;
        System.out.println(cnt);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    is_ap = [False] * n
    timer = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        children = 0
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                children += 1
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if parent != -1 and low[v] >= disc[u]:
                    is_ap[u] = True
            else:
                low[u] = min(low[u], disc[v])
        if parent == -1 and children >= 2:
            is_ap[u] = True

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    print(sum(is_ap))


if __name__ == "__main__":
    main()
```

---

### Task 3 — Is the graph 2-edge-connected?

**Problem.** Determine whether a connected undirected graph is 2-edge-connected, i.e. it has **no bridge**. Print `YES` or `NO`.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`. The graph is connected.
- Output: `YES` if no bridge exists, otherwise `NO`.

**Constraints.**
- `2 <= n <= 10^5`, `n-1 <= m <= 2·10^5`.

**Hint.** Run the bridge DFS; the answer is `YES` iff the bridge count is 0. You can short-circuit and stop early at the first bridge.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	hasBridge := false
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] > disc[u] {
					hasBridge = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	dfs(0, -1)
	if hasBridge {
		fmt.Println("NO")
	} else {
		fmt.Println("YES")
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    static int[] disc, low;
    static List<List<Integer>> adj;
    static int timer = 0;
    static boolean hasBridge = false;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) hasBridge = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n];
        low = new int[n];
        Arrays.fill(disc, -1);
        dfs(0, -1);
        System.out.println(hasBridge ? "NO" : "YES");
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    has_bridge = [False]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    has_bridge[0] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    print("NO" if has_bridge[0] else "YES")


if __name__ == "__main__":
    main()
```

---

### Task 4 — Brute-force oracle for bridges

**Problem.** Implement the *naive* bridge finder: for each edge, remove it, check whether the graph's component count increased, and report it as a bridge if so. This is the oracle you validate the fast algorithm against. Output the bridges as normalized pairs `(min, max)`, sorted.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: one line per bridge, `u v` with `u < v`, sorted lexicographically.

**Constraints.**
- `1 <= n <= 500`, `0 <= m <= 2000` (small, since this is `O(m·(n+m))`).

**Hint.** Count components with a plain DFS/BFS while skipping the removed edge. Compare to the original component count.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func components(n int, adj map[int][]int, skipU, skipV int) int {
	seen := make([]bool, n)
	var dfs func(u int)
	dfs = func(u int) {
		seen[u] = true
		for _, v := range adj[u] {
			if (u == skipU && v == skipV) || (u == skipV && v == skipU) {
				continue
			}
			if !seen[v] {
				dfs(v)
			}
		}
	}
	cnt := 0
	for i := 0; i < n; i++ {
		if !seen[i] {
			cnt++
			dfs(i)
		}
	}
	return cnt
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make(map[int][]int)
	type E struct{ u, v int }
	edges := make([]E, 0, m)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
		edges = append(edges, E{u, v})
	}
	base := components(n, adj, -1, -1)
	var bridges [][2]int
	for _, e := range edges {
		if components(n, adj, e.u, e.v) > base {
			a, b := e.u, e.v
			if a > b {
				a, b = b, a
			}
			bridges = append(bridges, [2]int{a, b})
		}
	}
	sort.Slice(bridges, func(i, j int) bool {
		if bridges[i][0] != bridges[j][0] {
			return bridges[i][0] < bridges[j][0]
		}
		return bridges[i][1] < bridges[j][1]
	})
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, b := range bridges {
		fmt.Fprintln(out, b[0], b[1])
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static List<List<Integer>> adj;
    static int n;

    static int components(int skipU, int skipV) {
        boolean[] seen = new boolean[n];
        int cnt = 0;
        for (int s = 0; s < n; s++) {
            if (seen[s]) continue;
            cnt++;
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s);
            seen[s] = true;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int v : adj.get(u)) {
                    if ((u == skipU && v == skipV) || (u == skipV && v == skipU)) continue;
                    if (!seen[v]) { seen[v] = true; st.push(v); }
                }
            }
        }
        return cnt;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[][] edges = new int[m][2];
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
            edges[i][0] = u; edges[i][1] = v;
        }
        int base = components(-1, -1);
        List<int[]> bridges = new ArrayList<>();
        for (int[] e : edges) {
            if (components(e[0], e[1]) > base) {
                int a = Math.min(e[0], e[1]), b = Math.max(e[0], e[1]);
                bridges.add(new int[]{a, b});
            }
        }
        bridges.sort((x, y) -> x[0] != y[0] ? x[0] - y[0] : x[1] - y[1]);
        StringBuilder sb = new StringBuilder();
        for (int[] b : bridges) sb.append(b[0]).append(' ').append(b[1]).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    edges = []
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
        edges.append((u, v))

    def components(skip):
        seen = [False] * n
        cnt = 0
        for s in range(n):
            if seen[s]:
                continue
            cnt += 1
            stack = [s]
            seen[s] = True
            while stack:
                u = stack.pop()
                for v in adj[u]:
                    if (u, v) == skip or (v, u) == skip:
                        continue
                    if not seen[v]:
                        seen[v] = True
                        stack.append(v)
        return cnt

    base = components(None)
    bridges = []
    for u, v in edges:
        if components((u, v)) > base:
            bridges.append((min(u, v), max(u, v)))
    for a, b in sorted(bridges):
        print(a, b)


if __name__ == "__main__":
    main()
```

---

### Task 5 — Bridge or not? (multi-edge aware)

**Problem.** Given a graph that **may contain multi-edges**, answer `q` queries: for a given edge id, is that edge a bridge? A doubled edge is never a bridge.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (edge `i` is the `i`-th line, `0`-indexed). Then `q`, then `q` lines each an edge id.
- Output: `YES`/`NO` per query.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`, `1 <= q <= 2·10^5`.

**Hint.** Skip by **edge id**, not parent vertex. Mark which edge ids are bridges during the DFS, then answer each query in `O(1)`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
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
	isBridge := make([]bool, m)
	timer := 0
	var dfs func(u, parentEdge int)
	dfs = func(u, parentEdge int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, e := range adj[u] {
			if e.id == parentEdge {
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
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var id int
		fmt.Fscan(in, &id)
		if isBridge[id] {
			fmt.Fprintln(out, "YES")
		} else {
			fmt.Fprintln(out, "NO")
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    static int[] disc, low;
    static boolean[] isBridge;
    static List<int[]>[] adj; // {to, id}
    static int timer = 0;

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n];
        low = new int[n];
        isBridge = new boolean[m];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        t.nextToken(); int q = (int) t.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            t.nextToken(); int id = (int) t.nval;
            sb.append(isBridge[id] ? "YES" : "NO").append('\n');
        }
        System.out.print(sb);
    }

    static void dfs(int u, int parentEdge) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == parentEdge) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * m
    timer = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent_edge):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == parent_edge:
                continue
            if disc[v] == -1:
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    is_bridge[eid] = True
            else:
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    q = int(data[idx]); idx += 1
    out = []
    for _ in range(q):
        eid = int(data[idx]); idx += 1
        out.append("YES" if is_bridge[eid] else "NO")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

---

## Intermediate Tasks (5)

### Task 6 — Extract biconnected components

**Problem.** Output the biconnected components of an undirected graph. Each component is a set of edge ids. Print one component per line as sorted edge ids.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (edge `i` is line `i`).
- Output: one line per biconnected component, edge ids sorted ascending; components in any order.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.

**Hint.** Push edge ids onto a stack during DFS. When `low[v] >= disc[u]` fires at `u` for child `v`, pop edges down to and including `(u, v)`. Push a back edge only when going *up* (`disc[v] < disc[u]`).

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
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
	var stack []int
	var comps [][]int
	var dfs func(u, parentEdge int)
	dfs = func(u, parentEdge int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, e := range adj[u] {
			if e.id == parentEdge {
				continue
			}
			if disc[e.to] == -1 {
				stack = append(stack, e.id)
				dfs(e.to, e.id)
				if low[e.to] < low[u] {
					low[u] = low[e.to]
				}
				if low[e.to] >= disc[u] {
					var comp []int
					for {
						top := stack[len(stack)-1]
						stack = stack[:len(stack)-1]
						comp = append(comp, top)
						if top == e.id {
							break
						}
					}
					comps = append(comps, comp)
				}
			} else if disc[e.to] < disc[u] {
				stack = append(stack, e.id)
				if disc[e.to] < low[u] {
					low[u] = disc[e.to]
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, comp := range comps {
		sort.Ints(comp)
		for i, id := range comp {
			if i > 0 {
				out.WriteByte(' ')
			}
			fmt.Fprint(out, id)
		}
		out.WriteByte('\n')
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    static int[] disc, low;
    static List<int[]>[] adj;
    static int timer = 0;
    static Deque<Integer> stack = new ArrayDeque<>();
    static List<List<Integer>> comps = new ArrayList<>();

    static void dfs(int u, int parentEdge) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == parentEdge) continue;
            if (disc[v] == -1) {
                stack.push(id);
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] >= disc[u]) {
                    List<Integer> comp = new ArrayList<>();
                    int top;
                    do { top = stack.pop(); comp.add(top); } while (top != id);
                    comps.add(comp);
                }
            } else if (disc[v] < disc[u]) {
                stack.push(id);
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n];
        low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        StringBuilder sb = new StringBuilder();
        for (List<Integer> comp : comps) {
            Collections.sort(comp);
            for (int i = 0; i < comp.size(); i++) {
                if (i > 0) sb.append(' ');
                sb.append(comp.get(i));
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    stack = []
    comps = []
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent_edge):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == parent_edge:
                continue
            if disc[v] == -1:
                stack.append(eid)
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] >= disc[u]:
                    comp = []
                    while True:
                        top = stack.pop()
                        comp.append(top)
                        if top == eid:
                            break
                    comps.append(comp)
            elif disc[v] < disc[u]:
                stack.append(eid)
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    out = []
    for comp in comps:
        out.append(" ".join(map(str, sorted(comp))))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

---

### Task 7 — Build the bridge tree (2-edge-connected component tree)

**Problem.** Compute the 2-edge-connected components, then build the bridge tree: contract each 2ECC to a node and connect contracted nodes by the bridges. Output the number of nodes (2ECCs) and the bridge-tree edges.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`. The graph is connected, no multi-edges.
- Output: first line `k` (number of 2ECCs). Then `k-1` lines `a b` — edges of the bridge tree, where `a`, `b` are 2ECC ids.

**Constraints.**
- `2 <= n <= 10^5`, `n-1 <= m <= 2·10^5`.

**Hint.** Find bridges. Then flood-fill component ids without crossing bridges to assign each vertex a 2ECC id. For each bridge `(u, v)`, add tree edge `(id[u], id[v])`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
	adj := make([][]E, n)
	eu := make([]int, m)
	ev := make([]int, m)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		eu[i], ev[i] = u, v
		adj[u] = append(adj[u], E{v, i})
		adj[v] = append(adj[v], E{u, i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	isBridge := make([]bool, m)
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u], low[u] = timer, timer
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
	k := 0
	for s := 0; s < n; s++ {
		if comp[s] != -1 {
			continue
		}
		stack := []int{s}
		comp[s] = k
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, e := range adj[u] {
				if isBridge[e.id] {
					continue
				}
				if comp[e.to] == -1 {
					comp[e.to] = k
					stack = append(stack, e.to)
				}
			}
		}
		k++
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	fmt.Fprintln(out, k)
	for i := 0; i < m; i++ {
		if isBridge[i] {
			fmt.Fprintln(out, comp[eu[i]], comp[ev[i]])
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    static int[] disc, low;
    static List<int[]>[] adj;
    static boolean[] isBridge;
    static int timer = 0;

    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] eu = new int[m], ev = new int[m];
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            eu[i] = u; ev[i] = v;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n];
        low = new int[n];
        isBridge = new boolean[m];
        Arrays.fill(disc, -1);
        dfs(0, -1);

        int[] comp = new int[n];
        Arrays.fill(comp, -1);
        int k = 0;
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1) continue;
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s); comp[s] = k;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int[] e : adj[u]) {
                    if (isBridge[e[1]]) continue;
                    if (comp[e[0]] == -1) { comp[e[0]] = k; st.push(e[0]); }
                }
            }
            k++;
        }
        StringBuilder sb = new StringBuilder();
        sb.append(k).append('\n');
        for (int i = 0; i < m; i++)
            if (isBridge[i]) sb.append(comp[eu[i]]).append(' ').append(comp[ev[i]]).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    eu = [0] * m
    ev = [0] * m
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        eu[i], ev[i] = u, v
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * m
    timer = [0]
    sys.setrecursionlimit(1 << 20)

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
                    is_bridge[eid] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)

    comp = [-1] * n
    k = 0
    for s in range(n):
        if comp[s] != -1:
            continue
        stack = [s]
        comp[s] = k
        while stack:
            u = stack.pop()
            for v, eid in adj[u]:
                if is_bridge[eid]:
                    continue
                if comp[v] == -1:
                    comp[v] = k
                    stack.append(v)
        k += 1

    out = [str(k)]
    for i in range(m):
        if is_bridge[i]:
            out.append(f"{comp[eu[i]]} {comp[ev[i]]}")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

---

### Task 8 — Add minimum edges to make 2-edge-connected

**Problem.** Given a connected undirected graph (no multi-edges), find the **minimum number of edges** to add so the graph has no bridge (becomes 2-edge-connected). The answer is `ceil(L / 2)`, where `L` is the number of leaves in the bridge tree (and `0` if the bridge tree has a single node).

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`. Connected.
- Output: a single integer — the minimum number of edges to add.

**Constraints.**
- `1 <= n <= 10^5`, `n-1 <= m <= 2·10^5`.

**Hint.** Build the bridge tree (Task 7). Count its leaves `L` (degree-1 nodes). The answer is `0` if the tree has one node, else `(L + 1) / 2`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
	adj := make([][]E, n)
	eu := make([]int, m)
	ev := make([]int, m)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		eu[i], ev[i] = u, v
		adj[u] = append(adj[u], E{v, i})
		adj[v] = append(adj[v], E{u, i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	isBridge := make([]bool, m)
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u], low[u] = timer, timer
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
	k := 0
	for s := 0; s < n; s++ {
		if comp[s] != -1 {
			continue
		}
		stack := []int{s}
		comp[s] = k
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, e := range adj[u] {
				if isBridge[e.id] {
					continue
				}
				if comp[e.to] == -1 {
					comp[e.to] = k
					stack = append(stack, e.to)
				}
			}
		}
		k++
	}
	if k == 1 {
		fmt.Println(0)
		return
	}
	deg := make([]int, k)
	for i := 0; i < m; i++ {
		if isBridge[i] {
			deg[comp[eu[i]]]++
			deg[comp[ev[i]]]++
		}
	}
	leaves := 0
	for i := 0; i < k; i++ {
		if deg[i] == 1 {
			leaves++
		}
	}
	fmt.Println((leaves + 1) / 2)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    static int[] disc, low;
    static List<int[]>[] adj;
    static boolean[] isBridge;
    static int timer = 0;

    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] eu = new int[m], ev = new int[m];
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            eu[i] = u; ev[i] = v;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n];
        low = new int[n];
        isBridge = new boolean[m];
        Arrays.fill(disc, -1);
        dfs(0, -1);

        int[] comp = new int[n];
        Arrays.fill(comp, -1);
        int k = 0;
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1) continue;
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s); comp[s] = k;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int[] e : adj[u]) {
                    if (isBridge[e[1]]) continue;
                    if (comp[e[0]] == -1) { comp[e[0]] = k; st.push(e[0]); }
                }
            }
            k++;
        }
        if (k == 1) { System.out.println(0); return; }
        int[] deg = new int[k];
        for (int i = 0; i < m; i++)
            if (isBridge[i]) { deg[comp[eu[i]]]++; deg[comp[ev[i]]]++; }
        int leaves = 0;
        for (int d : deg) if (d == 1) leaves++;
        System.out.println((leaves + 1) / 2);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    eu = [0] * m
    ev = [0] * m
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        eu[i], ev[i] = u, v
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * m
    timer = [0]
    sys.setrecursionlimit(1 << 20)

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
                    is_bridge[eid] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)

    comp = [-1] * n
    k = 0
    for s in range(n):
        if comp[s] != -1:
            continue
        stack = [s]
        comp[s] = k
        while stack:
            u = stack.pop()
            for v, eid in adj[u]:
                if is_bridge[eid]:
                    continue
                if comp[v] == -1:
                    comp[v] = k
                    stack.append(v)
        k += 1

    if k == 1:
        print(0)
        return
    deg = [0] * k
    for i in range(m):
        if is_bridge[i]:
            deg[comp[eu[i]]] += 1
            deg[comp[ev[i]]] += 1
    leaves = sum(1 for d in deg if d == 1)
    print((leaves + 1) // 2)


if __name__ == "__main__":
    main()
```

---

### Task 9 — Iterative articulation points (no recursion)

**Problem.** Find all articulation points using an **iterative** DFS (explicit stack) so it survives graphs deep enough to overflow recursion. Output the sorted list.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: sorted articulation-point ids on one line, space-separated (empty line if none).

**Constraints.**
- `1 <= n <= 2·10^6`, `0 <= m <= 4·10^6`. Recursion would overflow.

**Hint.** Keep `disc`, `low`, `parent`, and an iterator index per vertex. Apply `low` folding and the criteria when you pop a vertex. Track root children.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	parent := make([]int, n)
	it := make([]int, n)
	isAP := make([]bool, n)
	for i := range disc {
		disc[i] = -1
		parent[i] = -1
	}
	timer := 0
	for s := 0; s < n; s++ {
		if disc[s] != -1 {
			continue
		}
		disc[s], low[s] = timer, timer
		timer++
		stack := []int{s}
		rootChildren := 0
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			if it[u] < len(adj[u]) {
				v := adj[u][it[u]]
				it[u]++
				if v == parent[u] {
					continue
				}
				if disc[v] == -1 {
					parent[v] = u
					disc[v], low[v] = timer, timer
					timer++
					if u == s {
						rootChildren++
					}
					stack = append(stack, v)
				} else if disc[v] < low[u] {
					low[u] = disc[v]
				}
			} else {
				stack = stack[:len(stack)-1]
				p := parent[u]
				if p != -1 {
					if low[u] < low[p] {
						low[p] = low[u]
					}
					if p != s && low[u] >= disc[p] {
						isAP[p] = true
					}
				}
			}
		}
		if rootChildren >= 2 {
			isAP[s] = true
		}
	}
	var res []int
	for i := 0; i < n; i++ {
		if isAP[i] {
			res = append(res, i)
		}
	}
	sort.Ints(res)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
	out.WriteByte('\n')
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        int[] disc = new int[n], low = new int[n], parent = new int[n], it = new int[n];
        boolean[] isAP = new boolean[n];
        Arrays.fill(disc, -1);
        Arrays.fill(parent, -1);
        int timer = 0;
        int[] stack = new int[n];
        for (int s = 0; s < n; s++) {
            if (disc[s] != -1) continue;
            disc[s] = low[s] = timer++;
            int sp = 0;
            stack[sp++] = s;
            int rootChildren = 0;
            while (sp > 0) {
                int u = stack[sp - 1];
                if (it[u] < adj.get(u).size()) {
                    int v = adj.get(u).get(it[u]++);
                    if (v == parent[u]) continue;
                    if (disc[v] == -1) {
                        parent[v] = u;
                        disc[v] = low[v] = timer++;
                        if (u == s) rootChildren++;
                        stack[sp++] = v;
                    } else {
                        low[u] = Math.min(low[u], disc[v]);
                    }
                } else {
                    sp--;
                    int p = parent[u];
                    if (p != -1) {
                        low[p] = Math.min(low[p], low[u]);
                        if (p != s && low[u] >= disc[p]) isAP[p] = true;
                    }
                }
            }
            if (rootChildren >= 2) isAP[s] = true;
        }
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (int i = 0; i < n; i++) if (isAP[i]) {
            if (!first) sb.append(' ');
            sb.append(i); first = false;
        }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    parent = [-1] * n
    it = [0] * n
    is_ap = [False] * n
    timer = 0
    for s in range(n):
        if disc[s] != -1:
            continue
        disc[s] = low[s] = timer
        timer += 1
        stack = [s]
        root_children = 0
        while stack:
            u = stack[-1]
            if it[u] < len(adj[u]):
                v = adj[u][it[u]]
                it[u] += 1
                if v == parent[u]:
                    continue
                if disc[v] == -1:
                    parent[v] = u
                    disc[v] = low[v] = timer
                    timer += 1
                    if u == s:
                        root_children += 1
                    stack.append(v)
                elif disc[v] < low[u]:
                    low[u] = disc[v]
            else:
                stack.pop()
                p = parent[u]
                if p != -1:
                    if low[u] < low[p]:
                        low[p] = low[u]
                    if p != s and low[u] >= disc[p]:
                        is_ap[p] = True
        if root_children >= 2:
            is_ap[s] = True
    res = [str(i) for i in range(n) if is_ap[i]]
    sys.stdout.write(" ".join(res))


if __name__ == "__main__":
    main()
```

---

### Task 10 — Vertices that are NOT articulation points (robustness count)

**Problem.** A graph is "resilient at `u`" if removing `u` keeps the graph connected (within `u`'s component). Count the vertices that are **not** articulation points — i.e. the resilient vertices.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: the number of vertices that are not articulation points.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.

**Hint.** Find articulation points; answer is `n - (#articulation points)`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	isAP := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		children := 0
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				children++
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if parent != -1 && low[v] >= disc[u] {
					isAP[u] = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if parent == -1 && children >= 2 {
			isAP[u] = true
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	cnt := 0
	for i := 0; i < n; i++ {
		if !isAP[i] {
			cnt++
		}
	}
	fmt.Println(cnt)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    static int[] disc, low;
    static boolean[] isAP;
    static List<List<Integer>> adj;
    static int timer = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        int children = 0;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                children++;
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (parent != -1 && low[v] >= disc[u]) isAP[u] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (parent == -1 && children >= 2) isAP[u] = true;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n];
        low = new int[n];
        isAP = new boolean[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        int cnt = 0;
        for (boolean b : isAP) if (!b) cnt++;
        System.out.println(cnt);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    is_ap = [False] * n
    timer = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        children = 0
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                children += 1
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if parent != -1 and low[v] >= disc[u]:
                    is_ap[u] = True
            else:
                low[u] = min(low[u], disc[v])
        if parent == -1 and children >= 2:
            is_ap[u] = True

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    print(n - sum(is_ap))


if __name__ == "__main__":
    main()
```

---

## Advanced Tasks (5)

### Task 11 — Number of critical edges on each query path (bridge tree + LCA)

**Problem.** Build the bridge tree, then answer `q` queries: given vertices `a` and `b`, how many bridges lie on every path between them? (Equivalently, the bridge-tree distance between their 2ECCs.)

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (connected). Then `q`, then `q` lines `a b`.
- Output: one integer per query.

**Constraints.**
- `2 <= n <= 10^5`, `n-1 <= m <= 2·10^5`, `1 <= q <= 2·10^5`.

**Hint.** Bridges → 2ECC ids → bridge tree. Root it, compute depth and binary-lifting parents, answer `dist = depth[a]+depth[b]-2*depth[lca]`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
	adj := make([][]E, n)
	eu := make([]int, m)
	ev := make([]int, m)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		eu[i], ev[i] = u, v
		adj[u] = append(adj[u], E{v, i})
		adj[v] = append(adj[v], E{u, i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	isBridge := make([]bool, m)
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u], low[u] = timer, timer
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
	k := 0
	for s := 0; s < n; s++ {
		if comp[s] != -1 {
			continue
		}
		stack := []int{s}
		comp[s] = k
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, e := range adj[u] {
				if isBridge[e.id] {
					continue
				}
				if comp[e.to] == -1 {
					comp[e.to] = k
					stack = append(stack, e.to)
				}
			}
		}
		k++
	}
	tree := make([][]int, k)
	for i := 0; i < m; i++ {
		if isBridge[i] {
			a, b := comp[eu[i]], comp[ev[i]]
			tree[a] = append(tree[a], b)
			tree[b] = append(tree[b], a)
		}
	}
	const LOG = 18
	depth := make([]int, k)
	up := make([][]int, LOG)
	for j := 0; j < LOG; j++ {
		up[j] = make([]int, k)
	}
	// iterative BFS/DFS to set depth and up[0]
	vis := make([]bool, k)
	stack := []int{0}
	vis[0] = true
	up[0][0] = 0
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, w := range tree[u] {
			if !vis[w] {
				vis[w] = true
				depth[w] = depth[u] + 1
				up[0][w] = u
				stack = append(stack, w)
			}
		}
	}
	for j := 1; j < LOG; j++ {
		for v := 0; v < k; v++ {
			up[j][v] = up[j-1][up[j-1][v]]
		}
	}
	lca := func(a, b int) int {
		if depth[a] < depth[b] {
			a, b = b, a
		}
		d := depth[a] - depth[b]
		for j := 0; j < LOG; j++ {
			if d&(1<<j) != 0 {
				a = up[j][a]
			}
		}
		if a == b {
			return a
		}
		for j := LOG - 1; j >= 0; j-- {
			if up[j][a] != up[j][b] {
				a = up[j][a]
				b = up[j][b]
			}
		}
		return up[0][a]
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var a, b int
		fmt.Fscan(in, &a, &b)
		ca, cb := comp[a], comp[b]
		l := lca(ca, cb)
		fmt.Fprintln(out, depth[ca]+depth[cb]-2*depth[l])
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    static int[] disc, low;
    static List<int[]>[] adj;
    static boolean[] isBridge;
    static int timer = 0;

    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] eu = new int[m], ev = new int[m];
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            eu[i] = u; ev[i] = v;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n]; low = new int[n]; isBridge = new boolean[m];
        Arrays.fill(disc, -1);
        dfs(0, -1);

        int[] comp = new int[n];
        Arrays.fill(comp, -1);
        int k = 0;
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1) continue;
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s); comp[s] = k;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int[] e : adj[u]) {
                    if (isBridge[e[1]]) continue;
                    if (comp[e[0]] == -1) { comp[e[0]] = k; st.push(e[0]); }
                }
            }
            k++;
        }
        List<List<Integer>> tree = new ArrayList<>();
        for (int i = 0; i < k; i++) tree.add(new ArrayList<>());
        for (int i = 0; i < m; i++) if (isBridge[i]) {
            int a = comp[eu[i]], b = comp[ev[i]];
            tree.get(a).add(b); tree.get(b).add(a);
        }
        int LOG = 18;
        int[] depth = new int[k];
        int[][] up = new int[LOG][k];
        boolean[] vis = new boolean[k];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(0); vis[0] = true; up[0][0] = 0;
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int w : tree.get(u)) if (!vis[w]) {
                vis[w] = true; depth[w] = depth[u] + 1; up[0][w] = u; st.push(w);
            }
        }
        for (int j = 1; j < LOG; j++)
            for (int v = 0; v < k; v++) up[j][v] = up[j - 1][up[j - 1][v]];

        t.nextToken(); int q = (int) t.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            t.nextToken(); int a = comp[(int) t.nval];
            t.nextToken(); int b = comp[(int) t.nval];
            int l = lca(a, b, depth, up, LOG);
            sb.append(depth[a] + depth[b] - 2 * depth[l]).append('\n');
        }
        System.out.print(sb);
    }

    static int lca(int a, int b, int[] depth, int[][] up, int LOG) {
        if (depth[a] < depth[b]) { int tmp = a; a = b; b = tmp; }
        int d = depth[a] - depth[b];
        for (int j = 0; j < LOG; j++) if ((d & (1 << j)) != 0) a = up[j][a];
        if (a == b) return a;
        for (int j = LOG - 1; j >= 0; j--)
            if (up[j][a] != up[j][b]) { a = up[j][a]; b = up[j][b]; }
        return up[0][a];
    }
}
```

**Reference — Python.**
```python
import sys
from collections import deque


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    eu = [0] * m
    ev = [0] * m
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        eu[i], ev[i] = u, v
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * m
    timer = [0]
    sys.setrecursionlimit(1 << 20)

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
                    is_bridge[eid] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)

    comp = [-1] * n
    k = 0
    for s in range(n):
        if comp[s] != -1:
            continue
        stack = [s]
        comp[s] = k
        while stack:
            u = stack.pop()
            for v, eid in adj[u]:
                if is_bridge[eid]:
                    continue
                if comp[v] == -1:
                    comp[v] = k
                    stack.append(v)
        k += 1

    tree = [[] for _ in range(k)]
    for i in range(m):
        if is_bridge[i]:
            a, b = comp[eu[i]], comp[ev[i]]
            tree[a].append(b)
            tree[b].append(a)

    LOG = max(1, k.bit_length())
    depth = [0] * k
    up = [[0] * k for _ in range(LOG)]
    vis = [False] * k
    dq = deque([0])
    vis[0] = True
    while dq:
        u = dq.popleft()
        for w in tree[u]:
            if not vis[w]:
                vis[w] = True
                depth[w] = depth[u] + 1
                up[0][w] = u
                dq.append(w)
    for j in range(1, LOG):
        upj, upj1 = up[j], up[j - 1]
        for v in range(k):
            upj[v] = upj1[upj1[v]]

    def lca(a, b):
        if depth[a] < depth[b]:
            a, b = b, a
        d = depth[a] - depth[b]
        for j in range(LOG):
            if d & (1 << j):
                a = up[j][a]
        if a == b:
            return a
        for j in range(LOG - 1, -1, -1):
            if up[j][a] != up[j][b]:
                a = up[j][a]
                b = up[j][b]
        return up[0][a]

    q = int(data[idx]); idx += 1
    out = []
    for _ in range(q):
        a = comp[int(data[idx])]; b = comp[int(data[idx + 1])]; idx += 2
        l = lca(a, b)
        out.append(str(depth[a] + depth[b] - 2 * depth[l]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

---

### Task 12 — Edges that lie on some simple cycle (non-bridge edges)

**Problem.** An edge lies on at least one simple cycle iff it is **not** a bridge. Count the edges that lie on some simple cycle.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (no multi-edges, no self-loops).
- Output: a single integer — the number of non-bridge edges.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.

**Hint.** Total edges minus bridge count. (Corollary 2.4 from the professional level: only tree edges can be bridges, and a non-bridge edge is on a cycle.)

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	bridges := 0
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if low[v] > disc[u] {
					bridges++
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	fmt.Println(m - bridges)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static int[] disc, low;
    static List<List<Integer>> adj;
    static int timer = 0, bridges = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) bridges++;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        System.out.println(m - bridges);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    bridges = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridges[0] += 1
            else:
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    print(m - bridges[0])


if __name__ == "__main__":
    main()
```

---

### Task 13 — Largest biconnected component (by edge count)

**Problem.** Find the size (number of edges) of the largest biconnected component.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: the maximum edge count over all biconnected components (`0` if `m == 0`).

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`.

**Hint.** Run the edge-stack BCC extraction (Task 6) and track the maximum component size, without storing all components.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
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
	var stack []int
	best := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u], low[u] = timer, timer
		timer++
		for _, e := range adj[u] {
			if e.id == pe {
				continue
			}
			if disc[e.to] == -1 {
				stack = append(stack, e.id)
				dfs(e.to, e.id)
				if low[e.to] < low[u] {
					low[u] = low[e.to]
				}
				if low[e.to] >= disc[u] {
					size := 0
					for {
						top := stack[len(stack)-1]
						stack = stack[:len(stack)-1]
						size++
						if top == e.id {
							break
						}
					}
					if size > best {
						best = size
					}
				}
			} else if disc[e.to] < disc[u] {
				stack = append(stack, e.id)
				if disc[e.to] < low[u] {
					low[u] = disc[e.to]
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	fmt.Println(best)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static int[] disc, low;
    static List<int[]>[] adj;
    static int timer = 0, best = 0;
    static Deque<Integer> stack = new ArrayDeque<>();

    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                stack.push(id);
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] >= disc[u]) {
                    int size = 0, top;
                    do { top = stack.pop(); size++; } while (top != id);
                    best = Math.max(best, size);
                }
            } else if (disc[v] < disc[u]) {
                stack.push(id);
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj[u].add(new int[]{v, i});
            adj[v].add(new int[]{u, i});
        }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        System.out.println(best);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for i in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    stack = []
    best = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                stack.append(eid)
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] >= disc[u]:
                    size = 0
                    while True:
                        top = stack.pop()
                        size += 1
                        if top == eid:
                            break
                    if size > best[0]:
                        best[0] = size
            elif disc[v] < disc[u]:
                stack.append(eid)
                low[u] = min(low[u], disc[v])

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    print(best[0])


if __name__ == "__main__":
    main()
```

---

### Task 14 — Will removing vertex `u` disconnect the graph? (per-query)

**Problem.** Precompute articulation points, then answer `q` queries: "if we remove vertex `u`, does the graph (within `u`'s component) become disconnected?" Answer `YES`/`NO` per query in `O(1)`.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`. Then `q`, then `q` vertex ids.
- Output: `YES`/`NO` per query.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2·10^5`, `1 <= q <= 2·10^5`.

**Hint.** A query answer is `YES` iff `u` is an articulation point. Compute the AP set once.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	disc := make([]int, n)
	low := make([]int, n)
	isAP := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	var dfs func(u, parent int)
	dfs = func(u, parent int) {
		disc[u], low[u] = timer, timer
		timer++
		children := 0
		for _, v := range adj[u] {
			if v == parent {
				continue
			}
			if disc[v] == -1 {
				children++
				dfs(v, u)
				if low[v] < low[u] {
					low[u] = low[v]
				}
				if parent != -1 && low[v] >= disc[u] {
					isAP[u] = true
				}
			} else if disc[v] < low[u] {
				low[u] = disc[v]
			}
		}
		if parent == -1 && children >= 2 {
			isAP[u] = true
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i, -1)
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u int
		fmt.Fscan(in, &u)
		if isAP[u] {
			fmt.Fprintln(out, "YES")
		} else {
			fmt.Fprintln(out, "NO")
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    static int[] disc, low;
    static boolean[] isAP;
    static List<List<Integer>> adj;
    static int timer = 0;

    static void dfs(int u, int parent) {
        disc[u] = low[u] = timer++;
        int children = 0;
        for (int v : adj.get(u)) {
            if (v == parent) continue;
            if (disc[v] == -1) {
                children++;
                dfs(v, u);
                low[u] = Math.min(low[u], low[v]);
                if (parent != -1 && low[v] >= disc[u]) isAP[u] = true;
            } else {
                low[u] = Math.min(low[u], disc[v]);
            }
        }
        if (parent == -1 && children >= 2) isAP[u] = true;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); int n = (int) t.nval;
        t.nextToken(); int m = (int) t.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            t.nextToken(); int u = (int) t.nval;
            t.nextToken(); int v = (int) t.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        disc = new int[n]; low = new int[n]; isAP = new boolean[n];
        Arrays.fill(disc, -1);
        for (int i = 0; i < n; i++) if (disc[i] == -1) dfs(i, -1);
        t.nextToken(); int q = (int) t.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            t.nextToken(); int u = (int) t.nval;
            sb.append(isAP[u] ? "YES" : "NO").append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [0] * n
    is_ap = [False] * n
    timer = [0]
    sys.setrecursionlimit(1 << 20)

    def dfs(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        children = 0
        for v in adj[u]:
            if v == parent:
                continue
            if disc[v] == -1:
                children += 1
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if parent != -1 and low[v] >= disc[u]:
                    is_ap[u] = True
            else:
                low[u] = min(low[u], disc[v])
        if parent == -1 and children >= 2:
            is_ap[u] = True

    for i in range(n):
        if disc[i] == -1:
            dfs(i, -1)
    q = int(data[idx]); idx += 1
    out = []
    for _ in range(q):
        u = int(data[idx]); idx += 1
        out.append("YES" if is_ap[u] else "NO")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

---

### Task 15 — Minimum days to disconnect island (grid articulation points)

**Problem.** Given a binary grid (`1` = land, `0` = water) with the land 4-connected as a single island, return the minimum number of land cells to remove to disconnect it (answer is always `0`, `1`, or `2`). Return `0` if it is already disconnected (0 or ≥2 land components).

**Input / Output spec.**
- Input: `r`, `c`, then `r` lines of `c` integers (`0`/`1`).
- Output: a single integer `0`, `1`, or `2`.

**Constraints.**
- `1 <= r, c <= 30`.

**Hint.** Count land components: if not exactly 1, return 0. Else if any land cell is an articulation point (treat land cells as vertices, grid adjacency as edges), return 1. Else return 2.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	grid [][]int
	r, c int
	dirs = [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
)

func countComponents() int {
	seen := make([][]bool, r)
	for i := range seen {
		seen[i] = make([]bool, c)
	}
	var dfs func(i, j int)
	dfs = func(i, j int) {
		seen[i][j] = true
		for _, d := range dirs {
			ni, nj := i+d[0], j+d[1]
			if ni >= 0 && ni < r && nj >= 0 && nj < c && grid[ni][nj] == 1 && !seen[ni][nj] {
				dfs(ni, nj)
			}
		}
	}
	cnt := 0
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if grid[i][j] == 1 && !seen[i][j] {
				cnt++
				dfs(i, j)
			}
		}
	}
	return cnt
}

func main() {
	in := bufio.NewReader(os.Stdin)
	fmt.Fscan(in, &r, &c)
	grid = make([][]int, r)
	for i := 0; i < r; i++ {
		grid[i] = make([]int, c)
		for j := 0; j < c; j++ {
			fmt.Fscan(in, &grid[i][j])
		}
	}
	if countComponents() != 1 {
		fmt.Println(0)
		return
	}
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if grid[i][j] == 1 {
				grid[i][j] = 0
				if countComponents() != 1 {
					fmt.Println(1)
					return
				}
				grid[i][j] = 1
			}
		}
	}
	fmt.Println(2)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    static int[][] grid;
    static int r, c;
    static int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    static int countComponents() {
        boolean[][] seen = new boolean[r][c];
        int cnt = 0;
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                if (grid[i][j] == 1 && !seen[i][j]) { cnt++; dfs(seen, i, j); }
        return cnt;
    }

    static void dfs(boolean[][] seen, int i, int j) {
        seen[i][j] = true;
        for (int[] d : dirs) {
            int ni = i + d[0], nj = j + d[1];
            if (ni >= 0 && ni < r && nj >= 0 && nj < c && grid[ni][nj] == 1 && !seen[ni][nj])
                dfs(seen, ni, nj);
        }
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer t = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        t.nextToken(); r = (int) t.nval;
        t.nextToken(); c = (int) t.nval;
        grid = new int[r][c];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++) { t.nextToken(); grid[i][j] = (int) t.nval; }
        if (countComponents() != 1) { System.out.println(0); return; }
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                if (grid[i][j] == 1) {
                    grid[i][j] = 0;
                    if (countComponents() != 1) { System.out.println(1); return; }
                    grid[i][j] = 1;
                }
        System.out.println(2);
    }
}
```

**Reference — Python.**
```python
import sys
sys.setrecursionlimit(1 << 20)


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    r = int(data[idx]); idx += 1
    c = int(data[idx]); idx += 1
    grid = []
    for _ in range(r):
        row = [int(data[idx + j]) for j in range(c)]
        idx += c
        grid.append(row)
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]

    def count_components():
        seen = [[False] * c for _ in range(r)]
        cnt = 0
        for i in range(r):
            for j in range(c):
                if grid[i][j] == 1 and not seen[i][j]:
                    cnt += 1
                    stack = [(i, j)]
                    seen[i][j] = True
                    while stack:
                        x, y = stack.pop()
                        for dx, dy in dirs:
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < r and 0 <= ny < c and grid[nx][ny] == 1 and not seen[nx][ny]:
                                seen[nx][ny] = True
                                stack.append((nx, ny))
        return cnt

    if count_components() != 1:
        print(0)
        return
    for i in range(r):
        for j in range(c):
            if grid[i][j] == 1:
                grid[i][j] = 0
                if count_components() != 1:
                    print(1)
                    return
                grid[i][j] = 1
    print(2)


if __name__ == "__main__":
    main()
```

---

## Benchmark Task

### Task B — Recursive vs iterative DFS, and single-DFS vs remove-and-check

**Problem.** For each language, write a self-contained benchmark on random connected undirected graphs that measures:

- **(a)** Recursive `disc`/`low` DFS finding all articulation points and bridges.
- **(b)** Iterative `disc`/`low` DFS finding the same.
- **(c)** Brute-force remove-and-check for bridges only (the oracle).

Run on `n ∈ {1000, 5000, 20000}` with `m = 2n` random edges (plus a spanning path to ensure connectivity). For each `n`, generate the graph once (same seed across languages), then time each method 5 times and report the mean wall-clock milliseconds. Also include one **deep** graph: a path of `n = 200000` vertices, and report whether the **recursive** version overflows the stack (catch the error and print `OVERFLOW`) while the **iterative** version succeeds.

**Input / Output spec.**
- No stdin. Print a table:

```text
n        a_recursive_ms   b_iterative_ms   c_brute_bridges_ms
1000     ...              ...              ...
5000     ...              ...              ...
20000    ...              ...              ...
deep-path n=200000: recursive=OVERFLOW iterative=<ms>
```

**Constraints.**
- Seed: `42`. Verify (a), (b), (c) agree on the bridge set for the small graphs before timing.
- Time only the algorithm, not graph generation.

**Hints.**
- Reuse the recursive finder (Tasks 1/2), the iterative finder (Task 9), and the brute oracle (Task 4).
- For the deep path, expect the recursive DFS to overflow around tens of thousands of frames depending on language/stack settings; the iterative DFS runs in linear time.
- Brute remove-and-check is `O(m·(n+m))`; keep its `n` small so it finishes.

**Reference — Go (structure; fill in timers and reuse earlier solutions).**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genGraph(n, m int, seed int64) [][]int {
	r := rand.New(rand.NewSource(seed))
	adj := make([][]int, n)
	add := func(u, v int) {
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	for i := 1; i < n; i++ { // spanning path => connected
		add(i-1, i)
	}
	for i := 0; i < m-(n-1); i++ {
		u, v := r.Intn(n), r.Intn(n)
		if u != v {
			add(u, v)
		}
	}
	return adj
}

// recursiveBridges, iterativeAnalyze, bruteBridges:
// reuse Task1/Task9/Task4 implementations (omitted here for brevity).

func main() {
	sizes := []int{1000, 5000, 20000}
	fmt.Println("n        a_recursive_ms   b_iterative_ms   c_brute_bridges_ms")
	for _, n := range sizes {
		_ = genGraph(n, 2*n, 42)
		// time recursive, iterative, brute (5 runs each), print means
		_ = time.Now()
		fmt.Printf("%-8d %-16.2f %-16.2f %-16.2f\n", n, 0.0, 0.0, 0.0)
	}
	// deep path: recursive may overflow (recover), iterative succeeds
	fmt.Println("deep-path n=200000: recursive=OVERFLOW iterative=<ms>")
}
```

**Reference — Java (structure).**
```java
import java.util.*;

public class TaskB {
    static List<List<Integer>> genGraph(int n, int m, long seed) {
        Random r = new Random(seed);
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 1; i < n; i++) { adj.get(i - 1).add(i); adj.get(i).add(i - 1); }
        for (int i = 0; i < m - (n - 1); i++) {
            int u = r.nextInt(n), v = r.nextInt(n);
            if (u != v) { adj.get(u).add(v); adj.get(v).add(u); }
        }
        return adj;
    }

    // reuse Task1/Task9/Task4 logic for recursive, iterative, brute; time each.

    public static void main(String[] args) {
        int[] sizes = {1000, 5000, 20000};
        System.out.println("n        a_recursive_ms   b_iterative_ms   c_brute_bridges_ms");
        for (int n : sizes) {
            genGraph(n, 2 * n, 42);
            System.out.printf("%-8d %-16.2f %-16.2f %-16.2f%n", n, 0.0, 0.0, 0.0);
        }
        // wrap recursive deep-path call in try/catch StackOverflowError
        System.out.println("deep-path n=200000: recursive=OVERFLOW iterative=<ms>");
    }
}
```

**Reference — Python (structure).**
```python
import random
import sys
import time


def gen_graph(n, m, seed):
    r = random.Random(seed)
    adj = [[] for _ in range(n)]
    for i in range(1, n):
        adj[i - 1].append(i)
        adj[i].append(i - 1)
    for _ in range(m - (n - 1)):
        u, v = r.randrange(n), r.randrange(n)
        if u != v:
            adj[u].append(v)
            adj[v].append(u)
    return adj


# reuse Task1/Task9/Task4 implementations for recursive/iterative/brute, time each.


def main():
    sizes = [1000, 5000, 20000]
    print("n        a_recursive_ms   b_iterative_ms   c_brute_bridges_ms")
    for n in sizes:
        gen_graph(n, 2 * n, 42)
        print(f"{n:<8d} {0.0:<16.2f} {0.0:<16.2f} {0.0:<16.2f}")
    # deep path: recursive raises RecursionError (catch), iterative succeeds
    print("deep-path n=200000: recursive=OVERFLOW iterative=<ms>")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- (a), (b), and (c) produce the same bridge set on the small graphs before any timing.
- (b) iterative matches (a) recursive in result and is within a small constant factor in time on shallow graphs.
- On the deep path, (a) recursive overflows (reported as `OVERFLOW`) while (b) iterative completes in linear time — the central lesson.
- (c) brute is dramatically slower (orders of magnitude) even at `n = 20000`, demonstrating why the single DFS is the only viable approach at scale.
- Report includes the mean over 5 runs and excludes graph-generation time.
- Writeup: a short note on the stack-depth limit you observed in each language and how it motivates the iterative version.
