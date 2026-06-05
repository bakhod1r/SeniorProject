# Lowest Common Ancestor — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages. Trees are 0-indexed and rooted at node 0 unless stated otherwise.

---

## Beginner Tasks (5)

### Task 1 — Compute depth and parent with one DFS

**Problem.** Given a tree with `n` nodes (`n-1` edges, rooted at 0), compute `parent[v]` (`-1` for the root) and `depth[v]` for every node. Output `depth` for all nodes.

**Constraints.**
- `1 <= n <= 10^6`.
- Use an **iterative** DFS to avoid recursion limits.
- Time `O(n)`.

**Hint.** Build an adjacency list, push `(node, parent, depth)` on a stack, and skip the edge back to the parent.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	parent := make([]int, n)
	depth := make([]int, n)
	parent[0] = -1
	type frame struct{ v, p, d int }
	stack := []frame{{0, -1, 0}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		parent[f.v] = f.p
		depth[f.v] = f.d
		for _, to := range adj[f.v] {
			if to != f.p {
				stack = append(stack, frame{to, f.v, f.d + 1})
			}
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, d := range depth {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, d)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer in = new StreamTokenizer(br);
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b);
            adj.get(b).add(a);
        }
        int[] parent = new int[n], depth = new int[n];
        parent[0] = -1;
        Deque<int[]> stack = new ArrayDeque<>();
        stack.push(new int[]{0, -1, 0});
        while (!stack.isEmpty()) {
            int[] f = stack.pop();
            int v = f[0], p = f[1], d = f[2];
            parent[v] = p; depth[v] = d;
            for (int to : adj.get(v)) if (to != p) stack.push(new int[]{to, v, d + 1});
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(depth[i]);
        }
        System.out.println(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        adj[a].append(b)
        adj[b].append(a)
    parent = [-1] * n
    depth = [0] * n
    stack = [(0, -1, 0)]
    while stack:
        v, p, d = stack.pop()
        parent[v] = p
        depth[v] = d
        for to in adj[v]:
            if to != p:
                stack.append((to, v, d + 1))
    sys.stdout.write(" ".join(map(str, depth)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Iterative DFS (no recursion overflow on a path of `10^6` nodes).
- `parent[0] == -1`, `depth[0] == 0`.
- Linear time.

---

### Task 2 — Naive LCA by equalize-then-climb

**Problem.** Given `parent[]` and `depth[]`, answer `q` LCA queries with the naive method (no preprocessing beyond depth/parent).

**Constraints.**
- `1 <= n, q <= 2000` (small, since each query is `O(n)`).
- Time `O(q · n)`.

**Hint.** Lift the deeper node first, then move both up together until equal.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, depth []int

func lca(u, v int) int {
	for depth[u] > depth[v] {
		u = parent[u]
	}
	for depth[v] > depth[u] {
		v = parent[v]
	}
	for u != v {
		u = parent[u]
		v = parent[v]
	}
	return u
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	depth = make([]int, n)
	for i := 0; i < n; i++ {
		fmt.Fscan(in, &parent[i])
	}
	for i := 0; i < n; i++ {
		fmt.Fscan(in, &depth[i])
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		fmt.Fprintln(out, lca(u, v))
	}
}
```

**Java.**
```java
import java.util.*;

public class Task2 {
    static int[] parent, depth;

    static int lca(int u, int v) {
        while (depth[u] > depth[v]) u = parent[u];
        while (depth[v] > depth[u]) v = parent[v];
        while (u != v) { u = parent[u]; v = parent[v]; }
        return u;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        parent = new int[n];
        depth = new int[n];
        for (int i = 0; i < n; i++) parent[i] = sc.nextInt();
        for (int i = 0; i < n; i++) depth[i] = sc.nextInt();
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            int u = sc.nextInt(), v = sc.nextInt();
            sb.append(lca(u, v)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    parent = [int(next(data)) for _ in range(n)]
    depth = [int(next(data)) for _ in range(n)]
    q = int(next(data))

    def lca(u, v):
        while depth[u] > depth[v]:
            u = parent[u]
        while depth[v] > depth[u]:
            v = parent[v]
        while u != v:
            u = parent[u]
            v = parent[v]
        return u

    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data))
        out.append(str(lca(u, v)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on `u == v` and ancestor–descendant pairs.
- Matches a reference on random trees.

---

### Task 3 — Build the binary-lifting table

**Problem.** Given a tree (`n` nodes, edges, root 0), build `up[k][v]` and print `up[1][v]` (the grandparent / 2nd ancestor) for all `v`, using `-1` for "above the root."

**Constraints.**
- `1 <= n <= 10^5`.
- `LOG = ceil(log2 n)`.

**Hint.** Set `up[0][root] = -1`. When `up[k-1][v] == -1`, keep `up[k][v] = -1`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG := 1
	for (1 << LOG) < n {
		LOG++
	}
	up := make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	// iterative DFS for up[0]
	up[0][0] = -1
	type fr struct{ v, p int }
	st := []fr{{0, -1}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		for _, to := range adj[f.v] {
			if to != f.p {
				st = append(st, fr{to, f.v})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			if up[k-1][v] == -1 {
				up[k][v] = -1
			} else {
				up[k][v] = up[k-1][up[k-1][v]]
			}
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for v := 0; v < n; v++ {
		if v > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, up[1][v])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        int LOG = 1;
        while ((1 << LOG) < n) LOG++;
        int[][] up = new int[LOG][n];
        up[0][0] = -1;
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, -1});
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0]});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++)
                up[k][v] = up[k - 1][v] == -1 ? -1 : up[k - 1][up[k - 1][v]];
        StringBuilder sb = new StringBuilder();
        for (int v = 0; v < n; v++) {
            if (v > 0) sb.append(' ');
            sb.append(up[1][v]);
        }
        System.out.println(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[-1] * n for _ in range(LOG)]
    st = [(0, -1)]
    while st:
        v, p = st.pop()
        up[0][v] = p
        for to in adj[v]:
            if to != p:
                st.append((to, v))
    for k in range(1, LOG):
        prev = up[k - 1]
        cur = up[k]
        for v in range(n):
            cur[v] = -1 if prev[v] == -1 else prev[prev[v]]
    sys.stdout.write(" ".join(str(up[1][v]) for v in range(n)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `up[0][0] == -1`.
- `-1` propagates correctly above the root.
- Build is `O(n log n)`.

---

### Task 4 — k-th ancestor queries

**Problem.** Given a tree, answer `q` queries `getKthAncestor(v, k)` returning the `k`-th ancestor of `v` or `-1`.

**Constraints.**
- `1 <= n, q <= 10^5`.
- Each query `O(log n)`.

**Hint.** Decompose `k` into set bits; for each set bit `i`, jump `v = up[i][v]`; stop if `v == -1`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG := 1
	for (1 << LOG) < n {
		LOG++
	}
	up := make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	up[0][0] = -1
	type fr struct{ v, p int }
	st := []fr{{0, -1}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		for _, to := range adj[f.v] {
			if to != f.p {
				st = append(st, fr{to, f.v})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			if up[k-1][v] == -1 {
				up[k][v] = -1
			} else {
				up[k][v] = up[k-1][up[k-1][v]]
			}
		}
	}
	kth := func(v, k int) int {
		for i := 0; i < LOG && v != -1; i++ {
			if (k>>i)&1 == 1 {
				v = up[i][v]
			}
		}
		return v
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var v, k int
		fmt.Fscan(in, &v, &k)
		fmt.Fprintln(out, kth(v, k))
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static int[][] up;
    static int LOG;

    static int kth(int v, int k) {
        for (int i = 0; i < LOG && v != -1; i++)
            if (((k >> i) & 1) == 1) v = up[i][v];
        return v;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1;
        while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n];
        up[0][0] = -1;
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, -1});
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0]});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++)
                up[k][v] = up[k - 1][v] == -1 ? -1 : up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); int k = (int) in.nval;
            sb.append(kth(v, k)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[-1] * n for _ in range(LOG)]
    st = [(0, -1)]
    while st:
        v, p = st.pop()
        up[0][v] = p
        for to in adj[v]:
            if to != p:
                st.append((to, v))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = -1 if prev[v] == -1 else prev[prev[v]]

    def kth(v, k):
        i = 0
        while k and v != -1:
            if k & 1:
                v = up[i][v]
            k >>= 1
            i += 1
        return v

    q = int(next(data))
    out = []
    for _ in range(q):
        v = int(next(data)); k = int(next(data))
        out.append(str(kth(v, k)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `-1` when `k` exceeds the depth.
- Each query `O(log n)`.

---

### Task 5 — Distance between two nodes

**Problem.** With binary lifting built, answer `q` distance queries `dist(u, v)`.

**Constraints.**
- `1 <= n, q <= 10^5`.
- Each query `O(log n)`.

**Hint.** `dist(u, v) = depth[u] + depth[v] - 2*depth[lca(u, v)]`. You need both the LCA query and `depth[]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth []int
var LOG int

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	type fr struct{ v, p, d int }
	st := []fr{{0, 0, 0}} // root parent = itself
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		depth[f.v] = f.d
		for _, to := range adj[f.v] {
			if to != f.p || (to == f.v && f.v == 0) {
				if to != f.p {
					st = append(st, fr{to, f.v, f.d + 1})
				}
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		l := lca(u, v)
		fmt.Fprintln(out, depth[u]+depth[v]-2*depth[l])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    static int[][] up;
    static int[] depth;
    static int LOG;

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1;
        while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n];
        depth = new int[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, 0, 0}); // root parent = itself
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1];
            depth[f[0]] = f[2];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0], f[2] + 1});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++)
                up[k][v] = up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            int l = lca(u, v);
            sb.append(depth[u] + depth[v] - 2 * depth[l]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    st = [(0, 0, 0)]  # root parent = itself
    while st:
        v, p, d = st.pop()
        up[0][v] = p
        depth[v] = d
        for to in adj[v]:
            if to != p:
                st.append((to, v, d + 1))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1
            i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]
                v = up[i][v]
        return up[0][u]

    q = int(next(data))
    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data))
        l = lca(u, v)
        out.append(str(depth[u] + depth[v] - 2 * depth[l]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for ancestor–descendant pairs and `u == v` (distance 0).
- Each query `O(log n)`.

---

## Intermediate Tasks (5)

### Task 6 — O(1) LCA via Euler tour + sparse table

**Problem.** Build an Euler tour and a sparse table over depths to answer `q` LCA queries in `O(1)` each.

**Constraints.**
- `1 <= n, q <= 2·10^5`.
- Build `O(n log n)`, each query `O(1)`.

**Hint.** Record `first[v]` and run RMQ over the Euler depth array; map back to the node via `euler[]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"math/bits"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	euler := make([]int, 0, 2*n)
	dep := make([]int, 0, 2*n)
	first := make([]int, n)
	// iterative Euler tour
	type fr struct {
		v, p, d, ci int
	}
	st := []fr{{0, -1, 0, 0}}
	first[0] = 0
	euler = append(euler, 0)
	dep = append(dep, 0)
	for len(st) > 0 {
		f := &st[len(st)-1]
		if f.ci == 0 {
			first[f.v] = len(euler) - 1
		}
		adv := false
		for f.ci < len(adj[f.v]) {
			to := adj[f.v][f.ci]
			f.ci++
			if to != f.p {
				euler = append(euler, to)
				dep = append(dep, f.d+1)
				first[to] = len(euler) - 1
				st = append(st, fr{to, f.v, f.d + 1, 0})
				adv = true
				break
			}
		}
		if !adv {
			st = st[:len(st)-1]
			if len(st) > 0 {
				pf := st[len(st)-1]
				euler = append(euler, pf.v)
				dep = append(dep, pf.d)
			}
		}
	}
	m := len(euler)
	K := bits.Len(uint(m))
	sp := make([][]int, K)
	sp[0] = make([]int, m)
	for i := range sp[0] {
		sp[0][i] = i
	}
	for k := 1; (1 << k) <= m; k++ {
		sz := m - (1 << k) + 1
		sp[k] = make([]int, sz)
		for i := 0; i < sz; i++ {
			l, r := sp[k-1][i], sp[k-1][i+(1<<(k-1))]
			if dep[l] <= dep[r] {
				sp[k][i] = l
			} else {
				sp[k][i] = r
			}
		}
	}
	lca := func(u, v int) int {
		l, r := first[u], first[v]
		if l > r {
			l, r = r, l
		}
		k := bits.Len(uint(r-l+1)) - 1
		a, b := sp[k][l], sp[k][r-(1<<k)+1]
		if dep[a] <= dep[b] {
			return euler[a]
		}
		return euler[b]
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		fmt.Fprintln(out, lca(u, v))
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        int[] euler = new int[2 * n], dep = new int[2 * n], first = new int[n];
        int[] m = {0};
        // iterative tour
        int[] stV = new int[2 * n], stP = new int[2 * n], stD = new int[2 * n], stCi = new int[2 * n];
        int top = 0;
        stV[0] = 0; stP[0] = -1; stD[0] = 0; stCi[0] = 0;
        euler[m[0]] = 0; dep[m[0]] = 0; first[0] = 0; m[0]++;
        while (top >= 0) {
            int v = stV[top], p = stP[top], d = stD[top];
            boolean adv = false;
            while (stCi[top] < adj.get(v).size()) {
                int to = adj.get(v).get(stCi[top]++);
                if (to != p) {
                    euler[m[0]] = to; dep[m[0]] = d + 1; first[to] = m[0]; m[0]++;
                    top++;
                    stV[top] = to; stP[top] = v; stD[top] = d + 1; stCi[top] = 0;
                    adv = true;
                    break;
                }
            }
            if (!adv) {
                top--;
                if (top >= 0) { euler[m[0]] = stV[top]; dep[m[0]] = stD[top]; m[0]++; }
            }
        }
        int mm = m[0];
        int K = 32 - Integer.numberOfLeadingZeros(mm);
        int[][] sp = new int[K][];
        sp[0] = new int[mm];
        for (int i = 0; i < mm; i++) sp[0][i] = i;
        for (int k = 1; (1 << k) <= mm; k++) {
            int sz = mm - (1 << k) + 1;
            sp[k] = new int[sz];
            for (int i = 0; i < sz; i++) {
                int l = sp[k - 1][i], r = sp[k - 1][i + (1 << (k - 1))];
                sp[k][i] = dep[l] <= dep[r] ? l : r;
            }
        }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            int l = first[u], r = first[v];
            if (l > r) { int t = l; l = r; r = t; }
            int k = 31 - Integer.numberOfLeadingZeros(r - l + 1);
            int a = sp[k][l], b = sp[k][r - (1 << k) + 1];
            sb.append(dep[a] <= dep[b] ? euler[a] : euler[b]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    euler, dep, first = [], [], [0] * n
    # iterative Euler tour
    stack = [(0, -1, 0, iter(adj[0]))]
    euler.append(0); dep.append(0); first[0] = 0
    while stack:
        v, p, d, it = stack[-1]
        advanced = False
        for to in it:
            if to != p:
                euler.append(to); dep.append(d + 1); first[to] = len(euler) - 1
                stack.append((to, v, d + 1, iter(adj[to])))
                advanced = True
                break
        if not advanced:
            stack.pop()
            if stack:
                pv, _, pd, _ = stack[-1]
                euler.append(pv); dep.append(pd)
    m = len(euler)
    sp = [list(range(m))]
    k = 1
    while (1 << k) <= m:
        prev = sp[k - 1]
        sz = m - (1 << k) + 1
        half = 1 << (k - 1)
        cur = [0] * sz
        for i in range(sz):
            l, r = prev[i], prev[i + half]
            cur[i] = l if dep[l] <= dep[r] else r
        sp.append(cur)
        k += 1

    def lca(u, v):
        l, r = first[u], first[v]
        if l > r:
            l, r = r, l
        k = (r - l + 1).bit_length() - 1
        a, b = sp[k][l], sp[k][r - (1 << k) + 1]
        return euler[a] if dep[a] <= dep[b] else euler[b]

    q = int(next(data))
    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data))
        out.append(str(lca(u, v)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Euler array length is `2n - 1`.
- Each query is `O(1)` (one sparse-table lookup pair).
- Matches the binary-lifting answers on random trees.

---

### Task 7 — Maximum edge weight on a path (weighted binary lifting)

**Problem.** Given a weighted tree, answer `q` queries: the maximum edge weight on the path between `u` and `v`.

**Constraints.**
- `1 <= n, q <= 10^5`, weights up to `10^9`.
- Each query `O(log n)`.

**Hint.** Maintain `maxw[k][v]` alongside `up[k][v]`. Fold partial maxima into a running answer during both the lift and the climb.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up, mx [][]int
var depth []int
var LOG int

func query(u, v int) int {
	ans := 0
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			if mx[i][u] > ans {
				ans = mx[i][u]
			}
			u = up[i][u]
		}
	}
	if u == v {
		return ans
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			if mx[i][u] > ans {
				ans = mx[i][u]
			}
			if mx[i][v] > ans {
				ans = mx[i][v]
			}
			u = up[i][u]
			v = up[i][v]
		}
	}
	if mx[0][u] > ans {
		ans = mx[0][u]
	}
	if mx[0][v] > ans {
		ans = mx[0][v]
	}
	return ans
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	type E struct{ to, w int }
	adj := make([][]E, n)
	for i := 0; i < n-1; i++ {
		var a, b, w int
		fmt.Fscan(in, &a, &b, &w)
		adj[a] = append(adj[a], E{b, w})
		adj[b] = append(adj[b], E{a, w})
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	mx = make([][]int, LOG)
	for k := 0; k < LOG; k++ {
		up[k] = make([]int, n)
		mx[k] = make([]int, n)
	}
	depth = make([]int, n)
	type fr struct{ v, p, w, d int }
	st := []fr{{0, 0, 0, 0}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		mx[0][f.v] = f.w
		depth[f.v] = f.d
		for _, e := range adj[f.v] {
			if e.to != f.p {
				st = append(st, fr{e.to, f.v, e.w, f.d + 1})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			mid := up[k-1][v]
			up[k][v] = up[k-1][mid]
			mx[k][v] = mx[k-1][v]
			if mx[k-1][mid] > mx[k][v] {
				mx[k][v] = mx[k-1][mid]
			}
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		fmt.Fprintln(out, query(u, v))
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    static int[][] up, mx;
    static int[] depth;
    static int LOG;

    static int query(int u, int v) {
        int ans = 0;
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) {
            if (((diff >> i) & 1) == 1) { ans = Math.max(ans, mx[i][u]); u = up[i][u]; }
        }
        if (u == v) return ans;
        for (int i = LOG - 1; i >= 0; i--) {
            if (up[i][u] != up[i][v]) {
                ans = Math.max(ans, Math.max(mx[i][u], mx[i][v]));
                u = up[i][u]; v = up[i][v];
            }
        }
        return Math.max(ans, Math.max(mx[0][u], mx[0][v]));
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            in.nextToken(); int w = (int) in.nval;
            adj[a].add(new int[]{b, w}); adj[b].add(new int[]{a, w});
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; mx = new int[LOG][n]; depth = new int[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, 0, 0, 0}); // v, p, w, d
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1]; mx[0][f[0]] = f[2]; depth[f[0]] = f[3];
            for (int[] e : adj[f[0]]) if (e[0] != f[1]) st.push(new int[]{e[0], f[0], e[1], f[3] + 1});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) {
                int mid = up[k - 1][v];
                up[k][v] = up[k - 1][mid];
                mx[k][v] = Math.max(mx[k - 1][v], mx[k - 1][mid]);
            }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            sb.append(query(u, v)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data)); w = int(next(data))
        adj[a].append((b, w)); adj[b].append((a, w))
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    mx = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    st = [(0, 0, 0, 0)]  # v, p, w, d
    while st:
        v, p, w, d = st.pop()
        up[0][v] = p; mx[0][v] = w; depth[v] = d
        for to, ww in adj[v]:
            if to != p:
                st.append((to, v, ww, d + 1))
    for k in range(1, LOG):
        for v in range(n):
            mid = up[k - 1][v]
            up[k][v] = up[k - 1][mid]
            mx[k][v] = max(mx[k - 1][v], mx[k - 1][mid])

    def query(u, v):
        ans = 0
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                ans = max(ans, mx[i][u]); u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return ans
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                ans = max(ans, mx[i][u], mx[i][v])
                u = up[i][u]; v = up[i][v]
        return max(ans, mx[0][u], mx[0][v])

    q = int(next(data))
    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data))
        out.append(str(query(u, v)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Root's incoming edge weight is the neutral element (`0` for max).
- Folds maxima during both lift and climb, including the final two parent edges.
- Correct on ancestor–descendant pairs.

---

### Task 8 — O(1) ancestor test with tin/tout

**Problem.** Answer `q` queries: "is `a` an ancestor of `b`?" in `O(1)` each, using DFS entry/exit times.

**Constraints.**
- `1 <= n, q <= 10^6`.
- Build `O(n)`, each query `O(1)`.

**Hint.** `a` is an ancestor of `b` iff `tin[a] <= tin[b] && tout[b] <= tout[a]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	tin := make([]int, n)
	tout := make([]int, n)
	timer := 0
	type fr struct{ v, p, ci int }
	st := []fr{{0, -1, 0}}
	tin[0] = timer
	timer++
	for len(st) > 0 {
		f := &st[len(st)-1]
		adv := false
		for f.ci < len(adj[f.v]) {
			to := adj[f.v][f.ci]
			f.ci++
			if to != f.p {
				tin[to] = timer
				timer++
				st = append(st, fr{to, f.v, 0})
				adv = true
				break
			}
		}
		if !adv {
			tout[f.v] = timer
			timer++
			st = st[:len(st)-1]
		}
	}
	isAnc := func(a, b int) bool {
		return tin[a] <= tin[b] && tout[b] <= tout[a]
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var a, b int
		fmt.Fscan(in, &a, &b)
		if isAnc(a, b) {
			fmt.Fprintln(out, "YES")
		} else {
			fmt.Fprintln(out, "NO")
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        int[] tin = new int[n], tout = new int[n];
        int[] stV = new int[n], stP = new int[n], stCi = new int[n];
        int top = 0, timer = 0;
        stV[0] = 0; stP[0] = -1; stCi[0] = 0;
        tin[0] = timer++;
        while (top >= 0) {
            int v = stV[top], p = stP[top];
            boolean adv = false;
            while (stCi[top] < adj.get(v).size()) {
                int to = adj.get(v).get(stCi[top]++);
                if (to != p) {
                    tin[to] = timer++;
                    top++; stV[top] = to; stP[top] = v; stCi[top] = 0;
                    adv = true; break;
                }
            }
            if (!adv) { tout[v] = timer++; top--; }
        }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            boolean anc = tin[a] <= tin[b] && tout[b] <= tout[a];
            sb.append(anc ? "YES" : "NO").append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    tin = [0] * n
    tout = [0] * n
    timer = 0
    stack = [(0, -1, iter(adj[0]))]
    tin[0] = timer; timer += 1
    while stack:
        v, p, it = stack[-1]
        advanced = False
        for to in it:
            if to != p:
                tin[to] = timer; timer += 1
                stack.append((to, v, iter(adj[to])))
                advanced = True
                break
        if not advanced:
            tout[v] = timer; timer += 1
            stack.pop()

    q = int(next(data))
    out = []
    for _ in range(q):
        a = int(next(data)); b = int(next(data))
        out.append("YES" if tin[a] <= tin[b] and tout[b] <= tout[a] else "NO")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- A node is an ancestor of itself (`isAnc(a, a) == YES`).
- Build `O(n)`, query `O(1)`.

---

### Task 9 — k-th node on the path from u to v

**Problem.** With binary lifting + depth, answer `q` queries returning the `k`-th node (0-indexed) on the path from `u` to `v`.

**Constraints.**
- `1 <= n, q <= 10^5`.
- `0 <= k <= dist(u, v)`.

**Hint.** Let `l = lca(u, v)`, `du = depth[u] - depth[l]`. If `k <= du`, answer = k-th ancestor of `u`; else answer = `(dist - k)`-th ancestor of `v`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth []int
var LOG int

func kth(v, k int) int {
	for i := 0; i < LOG; i++ {
		if (k>>i)&1 == 1 {
			v = up[i][v]
		}
	}
	return v
}

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	u = kth(u, depth[u]-depth[v])
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func kthOnPath(u, v, k int) int {
	l := lca(u, v)
	du := depth[u] - depth[l]
	dist := du + depth[v] - depth[l]
	if k <= du {
		return kth(u, k)
	}
	return kth(v, dist-k)
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	type fr struct{ v, p, d int }
	st := []fr{{0, 0, 0}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		depth[f.v] = f.d
		for _, to := range adj[f.v] {
			if to != f.p {
				st = append(st, fr{to, f.v, f.d + 1})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v, k int
		fmt.Fscan(in, &u, &v, &k)
		fmt.Fprintln(out, kthOnPath(u, v, k))
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    static int[][] up;
    static int[] depth;
    static int LOG;

    static int kth(int v, int k) {
        for (int i = 0; i < LOG; i++) if (((k >> i) & 1) == 1) v = up[i][v];
        return v;
    }

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        u = kth(u, depth[u] - depth[v]);
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    static int kthOnPath(int u, int v, int k) {
        int l = lca(u, v);
        int du = depth[u] - depth[l];
        int dist = du + depth[v] - depth[l];
        return k <= du ? kth(u, k) : kth(v, dist - k);
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, 0, 0});
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1]; depth[f[0]] = f[2];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0], f[2] + 1});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); int k = (int) in.nval;
            sb.append(kthOnPath(u, v, k)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    st = [(0, 0, 0)]
    while st:
        v, p, d = st.pop()
        up[0][v] = p; depth[v] = d
        for to in adj[v]:
            if to != p:
                st.append((to, v, d + 1))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def kth(v, k):
        i = 0
        while k:
            if k & 1:
                v = up[i][v]
            k >>= 1; i += 1
        return v

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        u = kth(u, depth[u] - depth[v])
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    def kth_on_path(u, v, k):
        l = lca(u, v)
        du = depth[u] - depth[l]
        dist = du + depth[v] - depth[l]
        return kth(u, k) if k <= du else kth(v, dist - k)

    q = int(next(data))
    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data)); k = int(next(data))
        out.append(str(kth_on_path(u, v, k)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `k = 0` returns `u`; `k = dist` returns `v`.
- The boundary case `k == du` returns the LCA.

---

### Task 10 — Sum of edge weights on a path

**Problem.** Weighted tree. Answer `q` queries: the sum of edge weights on the path between `u` and `v`. Use root-distance prefix sums plus LCA.

**Constraints.**
- `1 <= n, q <= 10^5`, weights up to `10^9` (use 64-bit sums).
- Each query `O(log n)`.

**Hint.** Let `sd[v]` = weighted distance from root to `v`. Then `pathSum(u, v) = sd[u] + sd[v] - 2*sd[lca(u, v)]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth []int
var sd []int64
var LOG int

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	type E struct {
		to int
		w  int64
	}
	adj := make([][]E, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		var w int64
		fmt.Fscan(in, &a, &b, &w)
		adj[a] = append(adj[a], E{b, w})
		adj[b] = append(adj[b], E{a, w})
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	sd = make([]int64, n)
	type fr struct {
		v, p, d int
		s       int64
	}
	st := []fr{{0, 0, 0, 0}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		depth[f.v] = f.d
		sd[f.v] = f.s
		for _, e := range adj[f.v] {
			if e.to != f.p {
				st = append(st, fr{e.to, f.v, f.d + 1, f.s + e.w})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		l := lca(u, v)
		fmt.Fprintln(out, sd[u]+sd[v]-2*sd[l])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    static int[][] up;
    static int[] depth;
    static long[] sd;
    static int LOG;

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            adj[a].add(new long[]{b, w}); adj[b].add(new long[]{a, w});
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n]; sd = new long[n];
        Deque<long[]> st = new ArrayDeque<>();
        st.push(new long[]{0, 0, 0, 0}); // v, p, d, s
        while (!st.isEmpty()) {
            long[] f = st.pop();
            int v = (int) f[0], p = (int) f[1], d = (int) f[2];
            up[0][v] = p; depth[v] = d; sd[v] = f[3];
            for (long[] e : adj[v]) if ((int) e[0] != p)
                st.push(new long[]{e[0], v, d + 1, f[3] + e[1]});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            int l = lca(u, v);
            sb.append(sd[u] + sd[v] - 2 * sd[l]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data)); w = int(next(data))
        adj[a].append((b, w)); adj[b].append((a, w))
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    sd = [0] * n
    st = [(0, 0, 0, 0)]  # v, p, d, s
    while st:
        v, p, d, s = st.pop()
        up[0][v] = p; depth[v] = d; sd[v] = s
        for to, w in adj[v]:
            if to != p:
                st.append((to, v, d + 1, s + w))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    q = int(next(data))
    out = []
    for _ in range(q):
        u = int(next(data)); v = int(next(data))
        l = lca(u, v)
        out.append(str(sd[u] + sd[v] - 2 * sd[l]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- 64-bit accumulation (no overflow at `10^5 · 10^9`).
- `pathSum(u, u) == 0`.

---

## Advanced Tasks (5)

### Task 11 — LCA of multiple nodes (LCA of a set)

**Problem.** Given a tree and `q` queries, each a set `S` of nodes, return the LCA of the entire set. The LCA of a set is the deepest node that is an ancestor of every node in `S`.

**Constraints.**
- `1 <= n <= 10^5`, total `Σ|S| <= 5·10^5`.
- Each set query `O(|S| log n)`.

**Hint.** The LCA of a set equals the pairwise LCA of the two nodes with the **minimum** and **maximum** Euler entry time (`tin`). Or fold: `lca(S) = lca(lca(s0, s1), s2)...`.

**Go.** *(uses the binary-lifting `lca` from Task 5; fold over the set)*
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth []int
var LOG int

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	type fr struct{ v, p, d int }
	st := []fr{{0, 0, 0}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		depth[f.v] = f.d
		for _, to := range adj[f.v] {
			if to != f.p {
				st = append(st, fr{to, f.v, f.d + 1})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var m int
		fmt.Fscan(in, &m)
		cur := -1
		for j := 0; j < m; j++ {
			var x int
			fmt.Fscan(in, &x)
			if cur == -1 {
				cur = x
			} else {
				cur = lca(cur, x)
			}
		}
		fmt.Fprintln(out, cur)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    static int[][] up;
    static int[] depth;
    static int LOG;

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, 0, 0});
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1]; depth[f[0]] = f[2];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0], f[2] + 1});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int m = (int) in.nval;
            int cur = -1;
            for (int j = 0; j < m; j++) {
                in.nextToken(); int x = (int) in.nval;
                cur = cur == -1 ? x : lca(cur, x);
            }
            sb.append(cur).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    st = [(0, 0, 0)]
    while st:
        v, p, d = st.pop()
        up[0][v] = p; depth[v] = d
        for to in adj[v]:
            if to != p:
                st.append((to, v, d + 1))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    q = int(next(data))
    out = []
    for _ in range(q):
        m = int(next(data))
        cur = -1
        for _ in range(m):
            x = int(next(data))
            cur = x if cur == -1 else lca(cur, x)
        out.append(str(cur))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Folding LCA over the set is associative and order-independent.
- A singleton set returns that node.

---

### Task 12 — Build the auxiliary (virtual) tree of a node subset

**Problem.** Given a tree and a query subset `S` of `k` marked nodes, build the **virtual tree**: the minimal tree on `S` plus all pairwise LCAs, contracting degree-2 chains. Output the parent of each node in the virtual tree.

**Constraints.**
- `1 <= n <= 10^5`, `Σk <= 5·10^5`.
- Per query `O(k log k)`.

**Hint.** Sort `S` by `tin`. Insert `lca` of adjacent pairs. Re-sort + dedup by `tin`. Build with a stack: pop while the top is not an ancestor of the current node; the parent is the resulting top.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

var up [][]int
var depth, tin, tout []int
var LOG, timer int

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func isAnc(a, b int) bool { return tin[a] <= tin[b] && tout[b] <= tout[a] }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	tin = make([]int, n)
	tout = make([]int, n)
	type fr struct{ v, p, d, ci int }
	stk := []fr{{0, 0, 0, 0}}
	tin[0] = timer
	timer++
	up[0][0] = 0
	depth[0] = 0
	for len(stk) > 0 {
		f := &stk[len(stk)-1]
		adv := false
		for f.ci < len(adj[f.v]) {
			to := adj[f.v][f.ci]
			f.ci++
			if to != f.p {
				up[0][to] = f.v
				depth[to] = f.d + 1
				tin[to] = timer
				timer++
				stk = append(stk, fr{to, f.v, f.d + 1, 0})
				adv = true
				break
			}
		}
		if !adv {
			tout[f.v] = timer
			timer++
			stk = stk[:len(stk)-1]
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var k int
		fmt.Fscan(in, &k)
		s := make([]int, k)
		for j := range s {
			fmt.Fscan(in, &s[j])
		}
		sort.Slice(s, func(i, j int) bool { return tin[s[i]] < tin[s[j]] })
		extra := []int{}
		for j := 0; j+1 < len(s); j++ {
			extra = append(extra, lca(s[j], s[j+1]))
		}
		s = append(s, extra...)
		sort.Slice(s, func(i, j int) bool { return tin[s[i]] < tin[s[j]] })
		uniq := s[:0]
		seen := map[int]bool{}
		for _, x := range s {
			if !seen[x] {
				seen[x] = true
				uniq = append(uniq, x)
			}
		}
		s = uniq
		// build with a stack; print parent in virtual tree (root parent = -1)
		par := map[int]int{}
		stack := []int{}
		for _, v := range s {
			for len(stack) > 0 && !isAnc(stack[len(stack)-1], v) {
				stack = stack[:len(stack)-1]
			}
			if len(stack) > 0 {
				par[v] = stack[len(stack)-1]
			} else {
				par[v] = -1
			}
			stack = append(stack, v)
		}
		for i, v := range s {
			if i > 0 {
				out.WriteByte(' ')
			}
			fmt.Fprintf(out, "%d:%d", v, par[v])
		}
		out.WriteByte('\n')
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static int[][] up;
    static int[] depth, tin, tout;
    static int LOG, timer = 0;

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    static boolean isAnc(int a, int b) { return tin[a] <= tin[b] && tout[b] <= tout[a]; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n]; tin = new int[n]; tout = new int[n];
        int[] sV = new int[n], sP = new int[n], sD = new int[n], sCi = new int[n];
        int top = 0;
        sV[0] = 0; sP[0] = 0; sD[0] = 0; sCi[0] = 0;
        up[0][0] = 0; tin[0] = timer++;
        while (top >= 0) {
            int v = sV[top], p = sP[top], d = sD[top];
            boolean adv = false;
            while (sCi[top] < adj.get(v).size()) {
                int to = adj.get(v).get(sCi[top]++);
                if (to != p) {
                    up[0][to] = v; depth[to] = d + 1; tin[to] = timer++;
                    top++; sV[top] = to; sP[top] = v; sD[top] = d + 1; sCi[top] = 0;
                    adv = true; break;
                }
            }
            if (!adv) { tout[v] = timer++; top--; }
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); int k = (int) in.nval;
            Integer[] s = new Integer[k];
            for (int j = 0; j < k; j++) { in.nextToken(); s[j] = (int) in.nval; }
            Arrays.sort(s, Comparator.comparingInt(x -> tin[x]));
            List<Integer> all = new ArrayList<>(Arrays.asList(s));
            for (int j = 0; j + 1 < s.length; j++) all.add(lca(s[j], s[j + 1]));
            all.sort(Comparator.comparingInt(x -> tin[x]));
            List<Integer> uniq = new ArrayList<>();
            Set<Integer> seen = new HashSet<>();
            for (int x : all) if (seen.add(x)) uniq.add(x);
            Map<Integer, Integer> par = new HashMap<>();
            Deque<Integer> stack = new ArrayDeque<>();
            for (int v : uniq) {
                while (!stack.isEmpty() && !isAnc(stack.peek(), v)) stack.pop();
                par.put(v, stack.isEmpty() ? -1 : stack.peek());
                stack.push(v);
            }
            for (int i = 0; i < uniq.size(); i++) {
                if (i > 0) sb.append(' ');
                sb.append(uniq.get(i)).append(':').append(par.get(uniq.get(i)));
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    tin = [0] * n
    tout = [0] * n
    timer = 0
    stack = [(0, 0, 0, iter(adj[0]))]
    up[0][0] = 0
    tin[0] = timer; timer += 1
    while stack:
        v, p, d, it = stack[-1]
        advanced = False
        for to in it:
            if to != p:
                up[0][to] = v; depth[to] = d + 1
                tin[to] = timer; timer += 1
                stack.append((to, v, d + 1, iter(adj[to])))
                advanced = True
                break
        if not advanced:
            tout[v] = timer; timer += 1
            stack.pop()
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    def is_anc(a, b):
        return tin[a] <= tin[b] and tout[b] <= tout[a]

    q = int(next(data))
    out = []
    for _ in range(q):
        k = int(next(data))
        s = [int(next(data)) for _ in range(k)]
        s.sort(key=lambda x: tin[x])
        extra = [lca(s[j], s[j + 1]) for j in range(len(s) - 1)]
        s.extend(extra)
        s.sort(key=lambda x: tin[x])
        uniq = []
        seen = set()
        for x in s:
            if x not in seen:
                seen.add(x)
                uniq.append(x)
        par = {}
        st = []
        for v in uniq:
            while st and not is_anc(st[-1], v):
                st.pop()
            par[v] = st[-1] if st else -1
            st.append(v)
        out.append(" ".join(f"{v}:{par[v]}" for v in uniq))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- The virtual tree contains every node of `S` plus needed LCAs, no more.
- Root of the virtual tree (the overall LCA of `S`) has parent `-1`.
- Per-query work is `O(k log k)`, independent of `n`.

---

### Task 13 — Online edge-weight updates via Euler tour + BIT (sum on path)

**Problem.** Weighted tree supporting two operations: `update i w` (set the weight of the `i`-th edge to `w`) and `query u v` (sum of edge weights on the path `u`–`v`). Use an Euler-tour-on-entry/exit difference encoding plus a Fenwick tree, with LCA for the path split.

**Constraints.**
- `1 <= n, q <= 10^5`.
- Each operation `O(log² n)` or `O(log n)`.

**Hint.** Push each edge weight onto the deeper endpoint. Maintain root-distance `sd[v]` implicitly with a BIT over the Euler `tin/tout` range: adding `delta` to the subtree of node `c` (the deeper endpoint of the edge) adds `delta` to `sd[w]` for all `w` in that subtree. `pathSum(u, v) = sd[u] + sd[v] - 2*sd[lca]`, and `sd[w]` is the prefix sum up to `tin[w]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth, tin, tout []int
var bit []int64
var LOG, N, timer int

func bitAdd(i int, d int64) {
	for ; i <= N; i += i & (-i) {
		bit[i] += d
	}
}
func bitSum(i int) int64 {
	var s int64
	for ; i > 0; i -= i & (-i) {
		s += bit[i]
	}
	return s
}

// sd[v] = prefix sum at tin[v]+1 (1-indexed BIT)
func sd(v int) int64 { return bitSum(tin[v] + 1) }

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	N = n
	type E struct {
		to, id int
		w      int64
	}
	adj := make([][]E, n)
	edgeChild := make([]int, n) // edgeChild[id] = deeper endpoint
	edgeW := make([]int64, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		var w int64
		fmt.Fscan(in, &a, &b, &w)
		adj[a] = append(adj[a], E{b, i, w})
		adj[b] = append(adj[b], E{a, i, w})
		edgeW[i] = w
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	tin = make([]int, n)
	tout = make([]int, n)
	bit = make([]int64, n+2)
	type fr struct{ v, p, d, ci int }
	stk := []fr{{0, 0, 0, 0}}
	tin[0] = timer
	timer++
	for len(stk) > 0 {
		f := &stk[len(stk)-1]
		adv := false
		for f.ci < len(adj[f.v]) {
			e := adj[f.v][f.ci]
			f.ci++
			if e.to != f.p {
				up[0][e.to] = f.v
				depth[e.to] = f.d + 1
				edgeChild[e.id] = e.to
				tin[e.to] = timer
				timer++
				stk = append(stk, fr{e.to, f.v, f.d + 1, 0})
				adv = true
				break
			}
		}
		if !adv {
			tout[f.v] = timer - 1
			stk = stk[:len(stk)-1]
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	// initialize BIT with edge weights: add w to subtree of child
	addSub := func(c int, d int64) {
		bitAdd(tin[c]+1, d)
		bitAdd(tout[c]+2, -d)
	}
	for id := 0; id < n-1; id++ {
		addSub(edgeChild[id], edgeW[id])
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var op string
		fmt.Fscan(in, &op)
		if op == "update" {
			var id int
			var w int64
			fmt.Fscan(in, &id, &w)
			c := edgeChild[id]
			addSub(c, w-edgeW[id])
			edgeW[id] = w
		} else {
			var u, v int
			fmt.Fscan(in, &u, &v)
			l := lca(u, v)
			fmt.Fprintln(out, sd(u)+sd(v)-2*sd(l))
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static int[][] up;
    static int[] depth, tin, tout;
    static long[] bit;
    static int LOG, N, timer = 0;

    static void bitAdd(int i, long d) { for (; i <= N; i += i & (-i)) bit[i] += d; }
    static long bitSum(int i) { long s = 0; for (; i > 0; i -= i & (-i)) s += bit[i]; return s; }
    static long sd(int v) { return bitSum(tin[v] + 1); }

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.wordChars('a', 'z');
        in.nextToken(); int n = (int) in.nval;
        N = n;
        List<int[]>[] adj = new List[n]; // {to, id}
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] edgeChild = new int[n];
        long[] edgeW = new long[n];
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            adj[a].add(new int[]{b, i}); adj[b].add(new int[]{a, i});
            edgeW[i] = w;
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n]; tin = new int[n]; tout = new int[n];
        bit = new long[n + 2];
        int[] sV = new int[n], sP = new int[n], sD = new int[n], sCi = new int[n];
        int top = 0;
        sV[0] = 0; sP[0] = 0; sD[0] = 0; sCi[0] = 0;
        tin[0] = timer++;
        while (top >= 0) {
            int v = sV[top], p = sP[top], d = sD[top];
            boolean adv = false;
            while (sCi[top] < adj[v].size()) {
                int[] e = adj[v].get(sCi[top]++);
                if (e[0] != p) {
                    up[0][e[0]] = v; depth[e[0]] = d + 1; edgeChild[e[1]] = e[0];
                    tin[e[0]] = timer++;
                    top++; sV[top] = e[0]; sP[top] = v; sD[top] = d + 1; sCi[top] = 0;
                    adv = true; break;
                }
            }
            if (!adv) { tout[v] = timer - 1; top--; }
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        for (int id = 0; id < n - 1; id++) {
            int c = edgeChild[id];
            bitAdd(tin[c] + 1, edgeW[id]); bitAdd(tout[c] + 2, -edgeW[id]);
        }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); String op = in.sval;
            if ("update".equals(op)) {
                in.nextToken(); int id = (int) in.nval;
                in.nextToken(); long w = (long) in.nval;
                int c = edgeChild[id];
                long delta = w - edgeW[id];
                bitAdd(tin[c] + 1, delta); bitAdd(tout[c] + 2, -delta);
                edgeW[id] = w;
            } else {
                in.nextToken(); int u = (int) in.nval;
                in.nextToken(); int v = (int) in.nval;
                int l = lca(u, v);
                sb.append(sd(u) + sd(v) - 2 * sd(l)).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    N = n
    adj = [[] for _ in range(n)]  # (to, id)
    edge_child = [0] * n
    edge_w = [0] * n
    for i in range(n - 1):
        a = int(next(data)); b = int(next(data)); w = int(next(data))
        adj[a].append((b, i)); adj[b].append((a, i))
        edge_w[i] = w
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    tin = [0] * n
    tout = [0] * n
    bit = [0] * (n + 2)

    def bit_add(i, d):
        while i <= N:
            bit[i] += d
            i += i & (-i)

    def bit_sum(i):
        s = 0
        while i > 0:
            s += bit[i]
            i -= i & (-i)
        return s

    def sd(v):
        return bit_sum(tin[v] + 1)

    timer = 0
    stack = [(0, 0, 0, iter(adj[0]))]
    tin[0] = timer; timer += 1
    while stack:
        v, p, d, it = stack[-1]
        advanced = False
        for to, eid in it:
            if to != p:
                up[0][to] = v; depth[to] = d + 1; edge_child[eid] = to
                tin[to] = timer; timer += 1
                stack.append((to, v, d + 1, iter(adj[to])))
                advanced = True
                break
        if not advanced:
            tout[v] = timer - 1
            stack.pop()
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def add_sub(c, d):
        bit_add(tin[c] + 1, d)
        bit_add(tout[c] + 2, -d)

    for eid in range(n - 1):
        add_sub(edge_child[eid], edge_w[eid])

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    q = int(next(data))
    out = []
    for _ in range(q):
        op = next(data).decode()
        if op == "update":
            eid = int(next(data)); w = int(next(data))
            c = edge_child[eid]
            add_sub(c, w - edge_w[eid])
            edge_w[eid] = w
        else:
            u = int(next(data)); v = int(next(data))
            l = lca(u, v)
            out.append(str(sd(u) + sd(v) - 2 * sd(l)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Subtree range-add via BIT correctly updates all descendant root-distances.
- `query u u == 0` regardless of updates.
- Matches a recompute-from-scratch reference after random updates.

---

### Task 14 — Tree diameter endpoints and farthest-node distance

**Problem.** Given a tree, find its diameter (longest path length) and report, for `q` queries of a node `x`, the distance from `x` to the farther of the two diameter endpoints — a classic eccentricity bound that uses LCA-based distance.

**Constraints.**
- `1 <= n, q <= 10^5`.
- Each query `O(log n)`.

**Hint.** Two BFS/DFS passes find diameter endpoints `a`, `b`. For any node `x`, its eccentricity is `max(dist(x, a), dist(x, b))`. Build binary lifting once and answer each query with two distance calls.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth []int
var LOG int
var adj [][]int

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func dist(u, v int) int { return depth[u] + depth[v] - 2*depth[lca(u, v)] }

func bfsFarthest(src, n int) int {
	d := make([]int, n)
	for i := range d {
		d[i] = -1
	}
	d[src] = 0
	queue := []int{src}
	best := src
	for len(queue) > 0 {
		x := queue[0]
		queue = queue[1:]
		if d[x] > d[best] {
			best = x
		}
		for _, to := range adj[x] {
			if d[to] == -1 {
				d[to] = d[x] + 1
				queue = append(queue, to)
			}
		}
	}
	return best
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	adj = make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	type fr struct{ v, p, d int }
	st := []fr{{0, 0, 0}}
	for len(st) > 0 {
		f := st[len(st)-1]
		st = st[:len(st)-1]
		up[0][f.v] = f.p
		depth[f.v] = f.d
		for _, to := range adj[f.v] {
			if to != f.p {
				st = append(st, fr{to, f.v, f.d + 1})
			}
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	a := bfsFarthest(0, n)
	b := bfsFarthest(a, n)
	diameter := dist(a, b)
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	fmt.Fprintln(out, diameter)
	for ; q > 0; q-- {
		var x int
		fmt.Fscan(in, &x)
		da, db := dist(x, a), dist(x, b)
		if da > db {
			fmt.Fprintln(out, da)
		} else {
			fmt.Fprintln(out, db)
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    static int[][] up;
    static int[] depth;
    static int LOG;
    static List<List<Integer>> adj;

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    static int dist(int u, int v) { return depth[u] + depth[v] - 2 * depth[lca(u, v)]; }

    static int bfsFarthest(int src, int n) {
        int[] d = new int[n];
        Arrays.fill(d, -1);
        d[src] = 0;
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        queue.add(src);
        int best = src;
        while (!queue.isEmpty()) {
            int x = queue.poll();
            if (d[x] > d[best]) best = x;
            for (int to : adj.get(x)) if (d[to] == -1) { d[to] = d[x] + 1; queue.add(to); }
        }
        return best;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n];
        Deque<int[]> st = new ArrayDeque<>();
        st.push(new int[]{0, 0, 0});
        while (!st.isEmpty()) {
            int[] f = st.pop();
            up[0][f[0]] = f[1]; depth[f[0]] = f[2];
            for (int to : adj.get(f[0])) if (to != f[1]) st.push(new int[]{to, f[0], f[2] + 1});
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        int a = bfsFarthest(0, n);
        int b = bfsFarthest(a, n);
        int diameter = dist(a, b);
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        sb.append(diameter).append('\n');
        while (q-- > 0) {
            in.nextToken(); int x = (int) in.nval;
            sb.append(Math.max(dist(x, a), dist(x, b))).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys
from collections import deque


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    st = [(0, 0, 0)]
    while st:
        v, p, d = st.pop()
        up[0][v] = p; depth[v] = d
        for to in adj[v]:
            if to != p:
                st.append((to, v, d + 1))
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    def dist(u, v):
        return depth[u] + depth[v] - 2 * depth[lca(u, v)]

    def bfs_farthest(src):
        d = [-1] * n
        d[src] = 0
        q = deque([src])
        best = src
        while q:
            x = q.popleft()
            if d[x] > d[best]:
                best = x
            for to in adj[x]:
                if d[to] == -1:
                    d[to] = d[x] + 1
                    q.append(to)
        return best

    a = bfs_farthest(0)
    b = bfs_farthest(a)
    diameter = dist(a, b)
    q = int(next(data))
    out = [str(diameter)]
    for _ in range(q):
        x = int(next(data))
        out.append(str(max(dist(x, a), dist(x, b))))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Diameter matches the two-BFS classic result.
- Eccentricity uses `max(dist(x, a), dist(x, b))` — proven correct for trees.
- Each query `O(log n)`.

---

### Task 15 — Path-XOR queries with online point updates on node values

**Problem.** Each node carries a value. Support `update v x` (set node `v`'s value to `x`) and `query u v` (XOR of all node values on the path `u`–`v`, inclusive). Use Euler `tin/tout` ranges, a BIT over XOR with the "to-root XOR" trick, and LCA.

**Constraints.**
- `1 <= n, q <= 10^5`, values fit in 32 bits.
- Each operation `O(log n)`.

**Hint.** Let `rootXor[v]` = XOR of node values from root to `v`. Path-XOR `= rootXor[u] ^ rootXor[v] ^ value[lca]` (the LCA is counted twice and XOR-cancels, so add it back once). Maintain `rootXor` via subtree range-XOR on a BIT keyed by `tin/tout`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var up [][]int
var depth, tin, tout, val []int
var bit []int
var LOG, N, timer int

func bitXor(i, d int) {
	for ; i <= N; i += i & (-i) {
		bit[i] ^= d
	}
}
func bitPref(i int) int {
	x := 0
	for ; i > 0; i -= i & (-i) {
		x ^= bit[i]
	}
	return x
}
func rootXor(v int) int { return bitPref(tin[v] + 1) }

func lca(u, v int) int {
	if depth[u] < depth[v] {
		u, v = v, u
	}
	diff := depth[u] - depth[v]
	for i := 0; i < LOG; i++ {
		if (diff>>i)&1 == 1 {
			u = up[i][u]
		}
	}
	if u == v {
		return u
	}
	for i := LOG - 1; i >= 0; i-- {
		if up[i][u] != up[i][v] {
			u = up[i][u]
			v = up[i][v]
		}
	}
	return up[0][u]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	N = n
	val = make([]int, n)
	for i := range val {
		fmt.Fscan(in, &val[i])
	}
	adj := make([][]int, n)
	for i := 0; i < n-1; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
		adj[b] = append(adj[b], a)
	}
	LOG = 1
	for (1 << LOG) < n {
		LOG++
	}
	up = make([][]int, LOG)
	for k := range up {
		up[k] = make([]int, n)
	}
	depth = make([]int, n)
	tin = make([]int, n)
	tout = make([]int, n)
	bit = make([]int, n+2)
	type fr struct{ v, p, d, ci int }
	stk := []fr{{0, 0, 0, 0}}
	tin[0] = timer
	timer++
	for len(stk) > 0 {
		f := &stk[len(stk)-1]
		adv := false
		for f.ci < len(adj[f.v]) {
			to := adj[f.v][f.ci]
			f.ci++
			if to != f.p {
				up[0][to] = f.v
				depth[to] = f.d + 1
				tin[to] = timer
				timer++
				stk = append(stk, fr{to, f.v, f.d + 1, 0})
				adv = true
				break
			}
		}
		if !adv {
			tout[f.v] = timer - 1
			stk = stk[:len(stk)-1]
		}
	}
	for k := 1; k < LOG; k++ {
		for v := 0; v < n; v++ {
			up[k][v] = up[k-1][up[k-1][v]]
		}
	}
	setSub := func(v, d int) {
		bitXor(tin[v]+1, d)
		bitXor(tout[v]+2, d)
	}
	for v := 0; v < n; v++ {
		setSub(v, val[v])
	}
	var q int
	fmt.Fscan(in, &q)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for ; q > 0; q-- {
		var op string
		fmt.Fscan(in, &op)
		if op == "update" {
			var v, x int
			fmt.Fscan(in, &v, &x)
			setSub(v, val[v]^x) // XOR out old, XOR in new
			val[v] = x
		} else {
			var u, v int
			fmt.Fscan(in, &u, &v)
			l := lca(u, v)
			fmt.Fprintln(out, rootXor(u)^rootXor(v)^val[l])
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    static int[][] up;
    static int[] depth, tin, tout, val, bit;
    static int LOG, N, timer = 0;

    static void bitXor(int i, int d) { for (; i <= N; i += i & (-i)) bit[i] ^= d; }
    static int bitPref(int i) { int x = 0; for (; i > 0; i -= i & (-i)) x ^= bit[i]; return x; }
    static int rootXor(int v) { return bitPref(tin[v] + 1); }

    static int lca(int u, int v) {
        if (depth[u] < depth[v]) { int t = u; u = v; v = t; }
        int diff = depth[u] - depth[v];
        for (int i = 0; i < LOG; i++) if (((diff >> i) & 1) == 1) u = up[i][u];
        if (u == v) return u;
        for (int i = LOG - 1; i >= 0; i--)
            if (up[i][u] != up[i][v]) { u = up[i][u]; v = up[i][v]; }
        return up[0][u];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.wordChars('a', 'z');
        in.nextToken(); int n = (int) in.nval;
        N = n;
        val = new int[n];
        for (int i = 0; i < n; i++) { in.nextToken(); val[i] = (int) in.nval; }
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n - 1; i++) {
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            adj.get(a).add(b); adj.get(b).add(a);
        }
        LOG = 1; while ((1 << LOG) < n) LOG++;
        up = new int[LOG][n]; depth = new int[n]; tin = new int[n]; tout = new int[n];
        bit = new int[n + 2];
        int[] sV = new int[n], sP = new int[n], sD = new int[n], sCi = new int[n];
        int top = 0;
        sV[0] = 0; sP[0] = 0; sD[0] = 0; sCi[0] = 0;
        tin[0] = timer++;
        while (top >= 0) {
            int v = sV[top], p = sP[top], d = sD[top];
            boolean adv = false;
            while (sCi[top] < adj.get(v).size()) {
                int to = adj.get(v).get(sCi[top]++);
                if (to != p) {
                    up[0][to] = v; depth[to] = d + 1; tin[to] = timer++;
                    top++; sV[top] = to; sP[top] = v; sD[top] = d + 1; sCi[top] = 0;
                    adv = true; break;
                }
            }
            if (!adv) { tout[v] = timer - 1; top--; }
        }
        for (int k = 1; k < LOG; k++)
            for (int v = 0; v < n; v++) up[k][v] = up[k - 1][up[k - 1][v]];
        for (int v = 0; v < n; v++) { bitXor(tin[v] + 1, val[v]); bitXor(tout[v] + 2, val[v]); }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        while (q-- > 0) {
            in.nextToken(); String op = in.sval;
            if ("update".equals(op)) {
                in.nextToken(); int v = (int) in.nval;
                in.nextToken(); int x = (int) in.nval;
                int d = val[v] ^ x;
                bitXor(tin[v] + 1, d); bitXor(tout[v] + 2, d);
                val[v] = x;
            } else {
                in.nextToken(); int u = (int) in.nval;
                in.nextToken(); int v = (int) in.nval;
                int l = lca(u, v);
                sb.append(rootXor(u) ^ rootXor(v) ^ val[l]).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main() -> None:
    data = iter(sys.stdin.buffer.read().split())
    n = int(next(data))
    N = n
    val = [int(next(data)) for _ in range(n)]
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a = int(next(data)); b = int(next(data))
        adj[a].append(b); adj[b].append(a)
    LOG = max(1, (n - 1).bit_length())
    up = [[0] * n for _ in range(LOG)]
    depth = [0] * n
    tin = [0] * n
    tout = [0] * n
    bit = [0] * (n + 2)

    def bit_xor(i, d):
        while i <= N:
            bit[i] ^= d
            i += i & (-i)

    def bit_pref(i):
        x = 0
        while i > 0:
            x ^= bit[i]
            i -= i & (-i)
        return x

    def root_xor(v):
        return bit_pref(tin[v] + 1)

    timer = 0
    stack = [(0, 0, 0, iter(adj[0]))]
    tin[0] = timer; timer += 1
    while stack:
        v, p, d, it = stack[-1]
        advanced = False
        for to in it:
            if to != p:
                up[0][to] = v; depth[to] = d + 1
                tin[to] = timer; timer += 1
                stack.append((to, v, d + 1, iter(adj[to])))
                advanced = True
                break
        if not advanced:
            tout[v] = timer - 1
            stack.pop()
    for k in range(1, LOG):
        prev, cur = up[k - 1], up[k]
        for v in range(n):
            cur[v] = prev[prev[v]]

    def set_sub(v, d):
        bit_xor(tin[v] + 1, d)
        bit_xor(tout[v] + 2, d)

    for v in range(n):
        set_sub(v, val[v])

    def lca(u, v):
        if depth[u] < depth[v]:
            u, v = v, u
        diff = depth[u] - depth[v]
        i = 0
        while diff:
            if diff & 1:
                u = up[i][u]
            diff >>= 1; i += 1
        if u == v:
            return u
        for i in range(LOG - 1, -1, -1):
            if up[i][u] != up[i][v]:
                u = up[i][u]; v = up[i][v]
        return up[0][u]

    q = int(next(data))
    out = []
    for _ in range(q):
        op = next(data).decode()
        if op == "update":
            v = int(next(data)); x = int(next(data))
            set_sub(v, val[v] ^ x)
            val[v] = x
        else:
            u = int(next(data)); v = int(next(data))
            l = lca(u, v)
            out.append(str(root_xor(u) ^ root_xor(v) ^ val[l]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `query v v == val[v]` even after updates.
- The LCA value is added back exactly once.
- Matches a brute path-walk reference after random updates.

---

## Benchmark Task

### Task B — LCA method benchmark across Go, Java, Python

**Problem.** For each language, build a self-contained benchmark on a random tree of `n` nodes and `q` random LCA queries comparing three online methods:

- **(a)** Naive equalize+climb (`O(N)` per query).
- **(b)** Binary lifting (`O(N log N)` build, `O(log N)` query).
- **(c)** Euler tour + sparse-table RMQ (`O(N log N)` build, `O(1)` query).

Run for `n ∈ {10^3, 10^4, 10^5}` with `q = n` random queries. Use the **same seed** across languages so the tree and queries are identical. Report build time and total query time (ms) for each method.

**Input / Output spec.**
- No stdin. Output a fixed table:

```text
n        method            build_ms    query_ms
1000     naive             ...         ...
1000     binary_lifting    ...         ...
1000     euler_rmq         ...         ...
...
```

**Constraints.**
- Seed: `42`.
- Random tree: each node `i >= 1` attaches to a uniform random parent in `[0, i)`.
- Time build and query phases separately; verify all three methods agree on every query before timing.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genTree(n int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed))
	edges := make([][2]int, 0, n-1)
	for i := 1; i < n; i++ {
		p := r.Intn(i)
		edges = append(edges, [2]int{p, i})
	}
	return edges
}

func genQueries(n, q int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed + 1))
	qs := make([][2]int, q)
	for i := range qs {
		qs[i] = [2]int{r.Intn(n), r.Intn(n)}
	}
	return qs
}

func main() {
	sizes := []int{1000, 10000, 100000}
	fmt.Println("n        method            build_ms    query_ms")
	for _, n := range sizes {
		_ = genTree(n, 42)
		_ = genQueries(n, n, 42)
		// TODO: build each of the three structures, verify agreement,
		// then time build and query phases; print one row per method.
		_ = time.Now
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class TaskB {
    static int[][] genTree(int n, long seed) {
        Random r = new Random(seed);
        int[][] edges = new int[n - 1][2];
        for (int i = 1; i < n; i++) { edges[i - 1][0] = r.nextInt(i); edges[i - 1][1] = i; }
        return edges;
    }

    static int[][] genQueries(int n, int q, long seed) {
        Random r = new Random(seed + 1);
        int[][] qs = new int[q][2];
        for (int i = 0; i < q; i++) { qs[i][0] = r.nextInt(n); qs[i][1] = r.nextInt(n); }
        return qs;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000};
        System.out.println("n        method            build_ms    query_ms");
        for (int n : sizes) {
            int[][] edges = genTree(n, 42);
            int[][] qs = genQueries(n, n, 42);
            // TODO: build naive / binary_lifting / euler_rmq, verify, time, print.
        }
    }
}
```

**Starter — Python.**
```python
import random
import time
from typing import List, Tuple


def gen_tree(n: int, seed: int) -> List[Tuple[int, int]]:
    r = random.Random(seed)
    return [(r.randrange(i), i) for i in range(1, n)]


def gen_queries(n: int, q: int, seed: int) -> List[Tuple[int, int]]:
    r = random.Random(seed + 1)
    return [(r.randrange(n), r.randrange(n)) for _ in range(q)]


def main() -> None:
    sizes = [1000, 10000, 100000]
    print("n        method            build_ms    query_ms")
    for n in sizes:
        _edges = gen_tree(n, 42)
        _qs = gen_queries(n, n, 42)
        # TODO: build naive / binary_lifting / euler_rmq, verify, time, print.


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces identical trees and queries across languages.
- All three methods agree on every query before timing.
- Binary lifting and Euler+RMQ build times are comparable; Euler+RMQ query time is the smallest, naive is the largest (and blows up at `n = 10^5`).
- Report includes both build and query phases and excludes tree/query generation from the timers.
- Writeup: a short note on the build-vs-query trade-off — when the `O(1)` query of Euler+RMQ pays for its build versus binary lifting.
