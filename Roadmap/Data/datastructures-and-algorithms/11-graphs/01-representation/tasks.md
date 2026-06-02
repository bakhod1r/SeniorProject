# Graph Representation — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages. Validate against the evaluation criteria.

---

## Beginner Tasks (5)

### Task 1 — Build an adjacency list from an edge array

**Problem.** Given `n` vertices labelled `0..n-1` and a list of undirected edges, build the adjacency list and print each vertex's neighbors in insertion order.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: `n` lines, line `i` is `i: ` followed by the space-separated neighbors of `i`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.
- Vertices are in `[0, n)`. Self-loops allowed; no parallel edges.
- Build time: `O(n + m)`.

**Hint.** Allocate `n` empty buckets first. For each edge append `v` to `adj[u]` and `u` to `adj[v]`. Never allocate an `n x n` matrix — for `n = 10^5` that is `10^10` cells.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	for i := 0; i < n; i++ {
		fmt.Fprintf(out, "%d:", i)
		for _, v := range adj[i] {
			fmt.Fprintf(out, " %d", v)
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer tok = new StreamTokenizer(br);
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            sb.append(i).append(':');
            for (int v : adj.get(i)) sb.append(' ').append(v);
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        adj[v].append(u)
    out = []
    for i in range(n):
        out.append(f"{i}:" + "".join(f" {v}" for v in adj[i]))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Build runs in `O(n + m)`.
- Each undirected edge appears in both endpoints' lists.
- Isolated vertices print an empty neighbor list, not an error.

---

### Task 2 — Build an adjacency matrix and answer edge queries

**Problem.** Given a small directed graph, build a `V x V` `0/1` adjacency matrix and answer a batch of `hasEdge(u, v)` queries in `O(1)` each.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (directed edge `u -> v`), then `q`, then `q` lines `u v`.
- Output: `q` lines, `true` or `false`.

**Constraints.**
- `1 <= n <= 1000` (so `n^2 <= 10^6` cells).
- `0 <= m, q <= 10^5`.
- Each query is `O(1)`.

**Hint.** A matrix is the right call only because `n <= 1000`. For directed graphs set `M[u][v]` only — do not set the symmetric cell.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	mat := make([][]bool, n)
	for i := range mat {
		mat[i] = make([]bool, n)
	}
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		mat[u][v] = true
	}
	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		fmt.Fprintln(out, mat[u][v])
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        boolean[][] mat = new boolean[n][n];
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            mat[u][v] = true;
        }
        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            sb.append(mat[u][v]).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    mat = [bytearray(n) for _ in range(n)]
    for _ in range(m):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        mat[u][v] = 1
    q = int(data[p]); p += 1
    out = []
    for _ in range(q):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        out.append("true" if mat[u][v] else "false")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each query is `O(1)`.
- Directed edges are not made symmetric.
- A query `hasEdge(u, u)` returns true only if a self-loop was inserted.

---

### Task 3 — Convert an edge list to an edge-count summary

**Problem.** Given an undirected edge list, report the degree of every vertex and the total edge count. This forces you to handle the handshake identity (sum of degrees = 2 * edges).

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: line 1 is `m` (the edge count); line 2 is `n` space-separated degrees.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 2*10^6`.
- `O(n + m)` time, `O(n)` extra memory.
- Self-loops count 2 toward the degree of their vertex.

**Hint.** A single degree array. For each edge `(u, v)` increment `deg[u]` and `deg[v]`; a self-loop `(v, v)` naturally adds 2 to `deg[v]`.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	deg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		deg[u]++
		deg[v]++
	}
	fmt.Fprintln(out, m)
	for i := 0; i < n; i++ {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, deg[i])
	}
	fmt.Fprintln(out)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        int[] deg = new int[n];
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            deg[u]++;
            deg[v]++;
        }
        StringBuilder sb = new StringBuilder();
        sb.append(m).append('\n');
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(deg[i]);
        }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    deg = [0] * n
    for _ in range(m):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        deg[u] += 1
        deg[v] += 1
    sys.stdout.write(str(m) + "\n")
    sys.stdout.write(" ".join(map(str, deg)) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Sum of degrees equals `2 * m` (handshake identity).
- Self-loops contribute 2 to the relevant degree.
- Single pass, `O(n)` memory.

---

### Task 4 — Detect a missing reverse edge (undirected validity check)

**Problem.** Given an adjacency list that *claims* to be undirected, verify it: for every edge `u -> v` there must be a matching `v -> u`. Report whether the list is a valid undirected graph.

**Input / Output spec.**
- Input: `n`, then `n` lines; line `i` starts with `k_i` (the neighbor count) followed by `k_i` neighbor ids.
- Output: `true` if every directed entry has its reverse, else `false`.

**Constraints.**
- `1 <= n <= 10^5`, total entries `<= 4*10^5`.
- No parallel edges (each `(u, v)` appears at most once in `adj[u]`).
- `O(n + total entries)` time.

**Hint.** Put every `(u, v)` with `u < v` into a set, and every `(u, v)` with `u > v` reversed to `(v, u)` into a count. An edge is valid iff both directions are present. Self-loops `(v, v)` must appear an even number of times overall, but with no parallel edges a self-loop appears once in `adj[v]` and is its own reverse.

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
	var n int
	fmt.Fscan(in, &n)
	type pair struct{ a, b int }
	seen := map[pair]bool{}
	adj := make([][]int, n)
	for i := 0; i < n; i++ {
		var k int
		fmt.Fscan(in, &k)
		adj[i] = make([]int, k)
		for j := 0; j < k; j++ {
			fmt.Fscan(in, &adj[i][j])
			seen[pair{i, adj[i][j]}] = true
		}
	}
	valid := true
	for u := 0; u < n && valid; u++ {
		for _, v := range adj[u] {
			if !seen[pair{v, u}] {
				valid = false
				break
			}
		}
	}
	fmt.Println(valid)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        Set<Long> seen = new HashSet<>();
        int[][] adj = new int[n][];
        for (int i = 0; i < n; i++) {
            tok.nextToken(); int k = (int) tok.nval;
            adj[i] = new int[k];
            for (int j = 0; j < k; j++) {
                tok.nextToken(); int v = (int) tok.nval;
                adj[i][j] = v;
                seen.add((long) i * 1_000_000_007L + v);
            }
        }
        boolean valid = true;
        outer:
        for (int u = 0; u < n; u++) {
            for (int v : adj[u]) {
                if (!seen.contains((long) v * 1_000_000_007L + u)) {
                    valid = false;
                    break outer;
                }
            }
        }
        System.out.println(valid);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    adj = []
    seen = set()
    for i in range(n):
        k = int(data[p]); p += 1
        row = []
        for _ in range(k):
            v = int(data[p]); p += 1
            row.append(v)
            seen.add((i, v))
        adj.append(row)
    valid = all((v, u) in seen for u in range(n) for v in adj[u])
    print(str(valid).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correctly flags a one-directional edge as invalid.
- Self-loops are treated as their own reverse.
- Runs in `O(n + total entries)`.

---

### Task 5 — Build a weighted adjacency list

**Problem.** Given an undirected weighted graph, build an adjacency list of `(neighbor, weight)` pairs and answer `weight(u, v)` queries, returning `-1` if no such edge exists.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v w`, then `q`, then `q` lines `u v`.
- Output: `q` lines, each the weight of edge `(u, v)` or `-1`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m, q <= 2*10^5`.
- `1 <= w <= 10^9`. No parallel edges.
- Each query is `O(degree(u))`.

**Hint.** Store `(neighbor, weight)` pairs. For a query scan `adj[u]` for `v`. Note that `0` is *not* used as the sentinel here because weights are positive; we return `-1` for "no edge".

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type wEdge struct {
	to int
	w  int64
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]wEdge, n)
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], wEdge{v, w})
		adj[v] = append(adj[v], wEdge{u, w})
	}
	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		var ans int64 = -1
		for _, e := range adj[u] {
			if e.to == v {
				ans = e.w
				break
			}
		}
		fmt.Fprintln(out, ans)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            tok.nextToken(); long w = (long) tok.nval;
            adj[u].add(new long[]{v, w});
            adj[v].add(new long[]{u, w});
        }
        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            long ans = -1;
            for (long[] e : adj[u]) {
                if (e[0] == v) { ans = e[1]; break; }
            }
            sb.append(ans).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[p]); v = int(data[p + 1]); w = int(data[p + 2]); p += 3
        adj[u].append((v, w))
        adj[v].append((u, w))
    q = int(data[p]); p += 1
    out = []
    for _ in range(q):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        ans = -1
        for to, w in adj[u]:
            if to == v:
                ans = w
                break
        out.append(str(ans))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `-1` for a non-existent edge, never `0`.
- Stores each undirected edge in both endpoints' lists with the same weight.
- Each query is `O(degree(u))`.

---

## Intermediate Tasks (5)

### Task 6 — Build CSR from an edge list and answer neighbor queries

**Problem.** Build a Compressed Sparse Row (CSR) representation of a directed graph using the two-pass counting algorithm, then answer `neighbors(u)` queries by returning the slice `target[offset[u]:offset[u+1]]`.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (directed), then `q`, then `q` query vertices.
- Output: `q` lines; each line is the space-separated out-neighbors of the queried vertex (in edge-input order), or empty.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 5*10^6`, `0 <= q <= 10^5`.
- Build: `O(n + m)`. Each query: `O(degree(u))`.

**Hint.** Three steps: count out-degrees into `offset[u+1]`; prefix-sum `offset`; then place each target using a *separate* `cursor` copy so you never corrupt `offset`.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	us := make([]int, m)
	vs := make([]int, m)
	offset := make([]int, n+1)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &us[i], &vs[i])
		offset[us[i]+1]++
	}
	for i := 1; i <= n; i++ {
		offset[i] += offset[i-1]
	}
	target := make([]int, m)
	cursor := make([]int, n)
	copy(cursor, offset[:n])
	for i := 0; i < m; i++ {
		u := us[i]
		target[cursor[u]] = vs[i]
		cursor[u]++
	}
	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var u int
		fmt.Fscan(in, &u)
		first := true
		for k := offset[u]; k < offset[u+1]; k++ {
			if !first {
				out.WriteByte(' ')
			}
			fmt.Fprint(out, target[k])
			first = false
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        int[] us = new int[m], vs = new int[m];
        int[] offset = new int[n + 1];
        for (int i = 0; i < m; i++) {
            tok.nextToken(); us[i] = (int) tok.nval;
            tok.nextToken(); vs[i] = (int) tok.nval;
            offset[us[i] + 1]++;
        }
        for (int i = 1; i <= n; i++) offset[i] += offset[i - 1];
        int[] target = new int[m];
        int[] cursor = Arrays.copyOf(offset, n);
        for (int i = 0; i < m; i++) target[cursor[us[i]]++] = vs[i];

        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            for (int k = offset[u]; k < offset[u + 1]; k++) {
                if (k > offset[u]) sb.append(' ');
                sb.append(target[k]);
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


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    us = [0] * m
    vs = [0] * m
    offset = [0] * (n + 1)
    for i in range(m):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        us[i] = u
        vs[i] = v
        offset[u + 1] += 1
    for i in range(1, n + 1):
        offset[i] += offset[i - 1]
    target = [0] * m
    cursor = offset[:n]
    for i in range(m):
        u = us[i]
        target[cursor[u]] = vs[i]
        cursor[u] += 1
    q = int(data[p]); p += 1
    out = []
    for _ in range(q):
        u = int(data[p]); p += 1
        out.append(" ".join(map(str, target[offset[u]:offset[u + 1]])))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `offset[u+1] - offset[u]` equals the out-degree of `u`.
- `cursor` is a separate copy; `offset` is never mutated during placement.
- Build is `O(n + m)`; each query is `O(degree)`.

---

### Task 7 — Convert an adjacency list to a deduplicated edge list

**Problem.** Given an undirected adjacency list, output the edge list with each undirected edge listed exactly once. Filter using the `u < v` convention so `(a, b)` and `(b, a)` collapse to one entry. Sort the output for determinism.

**Input / Output spec.**
- Input: `n`, then `n` lines; line `i` is `k_i` followed by `k_i` neighbors.
- Output: line 1 is the edge count `e`; then `e` lines `u v` with `u <= v`, sorted ascending.

**Constraints.**
- `1 <= n <= 10^5`, total entries `<= 4*10^5`.
- Self-loops `(v, v)` are emitted once.
- `O(n + total entries + e log e)` time.

**Hint.** For every stored `(u, v)`, emit it only if `u <= v`. This relies on the list being a valid undirected graph (each edge stored at both endpoints), so the `u < v` half is exactly one copy; self-loops have `u == v`.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n int
	fmt.Fscan(in, &n)
	type edge struct{ u, v int }
	var edges []edge
	for u := 0; u < n; u++ {
		var k int
		fmt.Fscan(in, &k)
		for j := 0; j < k; j++ {
			var v int
			fmt.Fscan(in, &v)
			if u <= v {
				edges = append(edges, edge{u, v})
			}
		}
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].u != edges[j].u {
			return edges[i].u < edges[j].u
		}
		return edges[i].v < edges[j].v
	})
	fmt.Fprintln(out, len(edges))
	for _, e := range edges {
		fmt.Fprintln(out, e.u, e.v)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        List<int[]> edges = new ArrayList<>();
        for (int u = 0; u < n; u++) {
            tok.nextToken(); int k = (int) tok.nval;
            for (int j = 0; j < k; j++) {
                tok.nextToken(); int v = (int) tok.nval;
                if (u <= v) edges.add(new int[]{u, v});
            }
        }
        edges.sort((a, b) -> a[0] != b[0] ? a[0] - b[0] : a[1] - b[1]);
        StringBuilder sb = new StringBuilder();
        sb.append(edges.size()).append('\n');
        for (int[] e : edges) sb.append(e[0]).append(' ').append(e[1]).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    edges = []
    for u in range(n):
        k = int(data[p]); p += 1
        for _ in range(k):
            v = int(data[p]); p += 1
            if u <= v:
                edges.append((u, v))
    edges.sort()
    out = [str(len(edges))]
    out.extend(f"{u} {v}" for u, v in edges)
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each undirected edge appears exactly once in the output.
- Self-loops appear exactly once.
- Output is sorted; edge count matches `len(edges)`.

---

### Task 8 — Implicit grid graph: count connected components

**Problem.** Given a grid of `.` (open) and `#` (wall), count the connected components of open cells, treating each open cell as a vertex connected to its orthogonal open neighbors. Do **not** build an explicit graph — compute neighbors on the fly.

**Input / Output spec.**
- Input: `rows`, `cols`, then `rows` lines of the grid.
- Output: the number of connected components of open cells.

**Constraints.**
- `1 <= rows, cols <= 1000`.
- 4-directional connectivity.
- `O(rows * cols)` time and memory.

**Hint.** The grid *is* the graph. Run BFS/DFS from each unvisited open cell, using the four offset deltas and bounds checks; each BFS marks one component.

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
	var rows, cols int
	fmt.Fscan(in, &rows, &cols)
	grid := make([]string, rows)
	for i := range grid {
		fmt.Fscan(in, &grid[i])
	}
	seen := make([][]bool, rows)
	for i := range seen {
		seen[i] = make([]bool, cols)
	}
	deltas := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	count := 0
	queue := make([][2]int, 0, rows*cols)
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if grid[r][c] != '.' || seen[r][c] {
				continue
			}
			count++
			queue = queue[:0]
			queue = append(queue, [2]int{r, c})
			seen[r][c] = true
			for len(queue) > 0 {
				cell := queue[0]
				queue = queue[1:]
				for _, d := range deltas {
					nr, nc := cell[0]+d[0], cell[1]+d[1]
					if nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
						grid[nr][nc] == '.' && !seen[nr][nc] {
						seen[nr][nc] = true
						queue = append(queue, [2]int{nr, nc})
					}
				}
			}
		}
	}
	fmt.Println(count)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int rows = Integer.parseInt(st.nextToken());
        int cols = Integer.parseInt(st.nextToken());
        char[][] grid = new char[rows][];
        for (int i = 0; i < rows; i++) grid[i] = br.readLine().toCharArray();
        boolean[][] seen = new boolean[rows][cols];
        int[][] deltas = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        int count = 0;
        ArrayDeque<int[]> queue = new ArrayDeque<>();
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (grid[r][c] != '.' || seen[r][c]) continue;
                count++;
                queue.clear();
                queue.add(new int[]{r, c});
                seen[r][c] = true;
                while (!queue.isEmpty()) {
                    int[] cell = queue.poll();
                    for (int[] d : deltas) {
                        int nr = cell[0] + d[0], nc = cell[1] + d[1];
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
                            && grid[nr][nc] == '.' && !seen[nr][nc]) {
                            seen[nr][nc] = true;
                            queue.add(new int[]{nr, nc});
                        }
                    }
                }
            }
        }
        System.out.println(count);
    }
}
```

**Reference — Python.**
```python
import sys
from collections import deque


def main() -> None:
    data = sys.stdin.buffer.read().split()
    rows = int(data[0])
    cols = int(data[1])
    grid = [data[2 + i].decode() for i in range(rows)]
    seen = [[False] * cols for _ in range(rows)]
    deltas = ((-1, 0), (1, 0), (0, -1), (0, 1))
    count = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "." or seen[r][c]:
                continue
            count += 1
            q = deque([(r, c)])
            seen[r][c] = True
            while q:
                cr, cc = q.popleft()
                for dr, dc in deltas:
                    nr, nc = cr + dr, cc + dc
                    if 0 <= nr < rows and 0 <= nc < cols and \
                            grid[nr][nc] == "." and not seen[nr][nc]:
                        seen[nr][nc] = True
                        q.append((nr, nc))
    print(count)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- No explicit adjacency structure is built; neighbors are computed with deltas.
- A grid of all walls yields `0`; a fully open grid yields `1`.
- `O(rows * cols)` time and memory.

---

### Task 9 — Reverse (transpose) a directed graph

**Problem.** Given a directed graph as an adjacency list, build its transpose: the graph with every edge reversed (`u -> v` becomes `v -> u`). Output the transpose as an adjacency list.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v` (directed).
- Output: `n` lines; line `i` is `i:` followed by the sorted out-neighbors of `i` in the transpose.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(n + m + m log m)` time (the sort is for deterministic output).

**Hint.** Allocate `n` buckets for the transpose. For each edge `(u, v)`, append `u` to `radj[v]`. Sorting each bucket makes the output deterministic; the transpose itself needs no sort.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	radj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		radj[v] = append(radj[v], u)
	}
	for i := 0; i < n; i++ {
		sort.Ints(radj[i])
		fmt.Fprintf(out, "%d:", i)
		for _, v := range radj[i] {
			fmt.Fprintf(out, " %d", v)
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        List<List<Integer>> radj = new ArrayList<>();
        for (int i = 0; i < n; i++) radj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            radj.get(v).add(u);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            Collections.sort(radj.get(i));
            sb.append(i).append(':');
            for (int v : radj.get(i)) sb.append(' ').append(v);
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    radj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        radj[v].append(u)
    out = []
    for i in range(n):
        radj[i].sort()
        out.append(f"{i}:" + "".join(f" {v}" for v in radj[i]))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Edge `u -> v` becomes `v -> u` in the output.
- The transpose of the transpose equals the original graph.
- Runs in `O(n + m)` plus the per-bucket sort.

---

### Task 10 — Relabel a string-vertex graph to integer ids

**Problem.** Vertices arrive as arbitrary strings. Assign each a stable integer id in first-appearance order, build the (directed) adjacency list over ids, and answer `neighbors(label)` queries returning the neighbor *labels*.

**Input / Output spec.**
- Input: `m`, then `m` lines `srcLabel dstLabel`, then `q`, then `q` query labels.
- Output: `q` lines; each is the space-separated neighbor labels of the queried vertex (in edge-input order), or empty if the label is unknown or has no out-edges.

**Constraints.**
- `0 <= m, q <= 10^5`. Labels are non-empty alphanumeric strings.
- `id -> label` and `label -> id` maps at the boundary; core stored over ints.

**Hint.** Keep `labelToId` (map) and `idToLabel` (array). On each new label, assign the next id and append to `idToLabel`. Work with ids internally; translate back only at output.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	labelToId := map[string]int{}
	var idToLabel []string
	intern := func(s string) int {
		if id, ok := labelToId[s]; ok {
			return id
		}
		id := len(idToLabel)
		labelToId[s] = id
		idToLabel = append(idToLabel, s)
		return id
	}

	var m int
	fmt.Fscan(in, &m)
	adj := map[int][]int{}
	for i := 0; i < m; i++ {
		var s, d string
		fmt.Fscan(in, &s, &d)
		su, dv := intern(s), intern(d)
		adj[su] = append(adj[su], dv)
	}
	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var s string
		fmt.Fscan(in, &s)
		id, ok := labelToId[s]
		if !ok {
			fmt.Fprintln(out)
			continue
		}
		first := true
		for _, nb := range adj[id] {
			if !first {
				out.WriteByte(' ')
			}
			out.WriteString(idToLabel[nb])
			first = false
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        Map<String, Integer> labelToId = new HashMap<>();
        List<String> idToLabel = new ArrayList<>();
        Map<Integer, List<Integer>> adj = new HashMap<>();

        int m = Integer.parseInt(br.readLine().trim());
        for (int i = 0; i < m; i++) {
            StringTokenizer st = new StringTokenizer(br.readLine());
            int su = intern(st.nextToken(), labelToId, idToLabel);
            int dv = intern(st.nextToken(), labelToId, idToLabel);
            adj.computeIfAbsent(su, k -> new ArrayList<>()).add(dv);
        }
        int q = Integer.parseInt(br.readLine().trim());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            String s = br.readLine().trim();
            Integer id = labelToId.get(s);
            if (id != null && adj.containsKey(id)) {
                List<Integer> ns = adj.get(id);
                for (int j = 0; j < ns.size(); j++) {
                    if (j > 0) sb.append(' ');
                    sb.append(idToLabel.get(ns.get(j)));
                }
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }

    static int intern(String s, Map<String, Integer> map, List<String> rev) {
        Integer id = map.get(s);
        if (id != null) return id;
        int newId = rev.size();
        map.put(s, newId);
        rev.add(s);
        return newId;
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    label_to_id = {}
    id_to_label = []

    def intern(s: str) -> int:
        if s in label_to_id:
            return label_to_id[s]
        new_id = len(id_to_label)
        label_to_id[s] = new_id
        id_to_label.append(s)
        return new_id

    m = int(data[p]); p += 1
    adj = {}
    for _ in range(m):
        s = data[p].decode(); d = data[p + 1].decode(); p += 2
        su, dv = intern(s), intern(d)
        adj.setdefault(su, []).append(dv)
    q = int(data[p]); p += 1
    out = []
    for _ in range(q):
        s = data[p].decode(); p += 1
        idv = label_to_id.get(s)
        if idv is None or idv not in adj:
            out.append("")
        else:
            out.append(" ".join(id_to_label[nb] for nb in adj[idv]))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Ids are assigned in first-appearance order.
- Unknown query labels produce an empty line, not a crash.
- Internal storage uses integer ids; labels appear only at the boundary.

---

## Advanced Tasks (5)

### Task 11 — Weighted CSR with a parallel weight array

**Problem.** Build a weighted CSR for a directed graph: `offset[]`, `target[]`, and a parallel `weight[]` aligned with `target[]` so `weight[k]` is the weight of the edge ending at `target[k]`. Answer `neighbors(u)` queries returning `(target, weight)` pairs.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v w`, then `q`, then `q` query vertices.
- Output: `q` lines; each is space-separated `v:w` pairs for the queried vertex's out-edges (in input order).

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 5*10^6`.
- `1 <= w <= 10^9`.
- Build: `O(n + m)`. Each query: `O(degree)`.

**Hint.** Same two-pass build as plain CSR, but place `weight[cursor[u]]` in lockstep with `target[cursor[u]]`. An off-by-one between the two arrays is a silent correctness bug.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	us := make([]int, m)
	vs := make([]int, m)
	ws := make([]int64, m)
	offset := make([]int, n+1)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &us[i], &vs[i], &ws[i])
		offset[us[i]+1]++
	}
	for i := 1; i <= n; i++ {
		offset[i] += offset[i-1]
	}
	target := make([]int, m)
	weight := make([]int64, m)
	cursor := make([]int, n)
	copy(cursor, offset[:n])
	for i := 0; i < m; i++ {
		u := us[i]
		k := cursor[u]
		target[k] = vs[i]
		weight[k] = ws[i]
		cursor[u]++
	}
	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var u int
		fmt.Fscan(in, &u)
		for k := offset[u]; k < offset[u+1]; k++ {
			if k > offset[u] {
				out.WriteByte(' ')
			}
			fmt.Fprintf(out, "%d:%d", target[k], weight[k])
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        int[] us = new int[m], vs = new int[m];
        long[] ws = new long[m];
        int[] offset = new int[n + 1];
        for (int i = 0; i < m; i++) {
            tok.nextToken(); us[i] = (int) tok.nval;
            tok.nextToken(); vs[i] = (int) tok.nval;
            tok.nextToken(); ws[i] = (long) tok.nval;
            offset[us[i] + 1]++;
        }
        for (int i = 1; i <= n; i++) offset[i] += offset[i - 1];
        int[] target = new int[m];
        long[] weight = new long[m];
        int[] cursor = Arrays.copyOf(offset, n);
        for (int i = 0; i < m; i++) {
            int k = cursor[us[i]]++;
            target[k] = vs[i];
            weight[k] = ws[i];
        }
        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            for (int k = offset[u]; k < offset[u + 1]; k++) {
                if (k > offset[u]) sb.append(' ');
                sb.append(target[k]).append(':').append(weight[k]);
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


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    us = [0] * m
    vs = [0] * m
    ws = [0] * m
    offset = [0] * (n + 1)
    for i in range(m):
        u = int(data[p]); v = int(data[p + 1]); w = int(data[p + 2]); p += 3
        us[i], vs[i], ws[i] = u, v, w
        offset[u + 1] += 1
    for i in range(1, n + 1):
        offset[i] += offset[i - 1]
    target = [0] * m
    weight = [0] * m
    cursor = offset[:n]
    for i in range(m):
        u = us[i]
        k = cursor[u]
        target[k] = vs[i]
        weight[k] = ws[i]
        cursor[u] += 1
    q = int(data[p]); p += 1
    out = []
    for _ in range(q):
        u = int(data[p]); p += 1
        pairs = [f"{target[k]}:{weight[k]}"
                 for k in range(offset[u], offset[u + 1])]
        out.append(" ".join(pairs))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `weight[k]` always corresponds to the edge ending at `target[k]`.
- Build is `O(n + m)`; queries `O(degree)`.
- A randomized cross-check against a `(neighbor, weight)` adjacency list matches exactly.

---

### Task 12 — Snapshot graph store with atomic swap (concurrent reads)

**Problem.** Implement a read-mostly graph store: an immutable CSR snapshot serves lock-free `neighbors(u)` reads; `addEdge` buffers into a side log; `rebuild` folds the buffer into a fresh CSR and publishes it atomically. Demonstrate that reads taken before a rebuild see the old graph and reads after see the new one.

**Input / Output spec.**
- Operations: `add u v`, `rebuild`, `query u`.
- Output: one line per `query` — the space-separated current neighbors of `u`.

**Constraints.**
- `1 <= n <= 10^5`.
- Reads must not lock; writes are applied only on `rebuild`.
- Each `rebuild` is `O(n + E)`.

**Hint.** Hold the current CSR behind an atomic pointer (`atomic.Pointer` / `AtomicReference`). `query` reads through it without locking; `add` appends under a small mutex; `rebuild` sorts all edges by source and swaps a new immutable CSR in.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
)

type CSR struct {
	offset []int
	target []int
}

func (c *CSR) Neighbors(u int) []int { return c.target[c.offset[u]:c.offset[u+1]] }

func buildCSR(n int, edges [][2]int) *CSR {
	offset := make([]int, n+1)
	for _, e := range edges {
		offset[e[0]+1]++
	}
	for i := 1; i <= n; i++ {
		offset[i] += offset[i-1]
	}
	target := make([]int, len(edges))
	cursor := make([]int, n)
	copy(cursor, offset[:n])
	for _, e := range edges {
		target[cursor[e[0]]] = e[1]
		cursor[e[0]]++
	}
	return &CSR{offset, target}
}

type Store struct {
	n       int
	current atomic.Pointer[CSR]
	mu      sync.Mutex
	base    [][2]int
}

func NewStore(n int) *Store {
	s := &Store{n: n}
	s.current.Store(buildCSR(n, nil))
	return s
}

func (s *Store) AddEdge(u, v int) {
	s.mu.Lock()
	s.base = append(s.base, [2]int{u, v})
	s.mu.Unlock()
}

func (s *Store) Rebuild() {
	s.mu.Lock()
	all := append([][2]int(nil), s.base...)
	s.mu.Unlock()
	sort.Slice(all, func(i, j int) bool { return all[i][0] < all[j][0] })
	s.current.Store(buildCSR(s.n, all))
}

func (s *Store) Neighbors(u int) []int { return s.current.Load().Neighbors(u) }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	store := NewStore(n)
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		switch op {
		case "add":
			var u, v int
			fmt.Fscan(in, &u, &v)
			store.AddEdge(u, v)
		case "rebuild":
			store.Rebuild()
		case "query":
			var u int
			fmt.Fscan(in, &u)
			ns := store.Neighbors(u)
			for i, v := range ns {
				if i > 0 {
					out.WriteByte(' ')
				}
				fmt.Fprint(out, v)
			}
			fmt.Fprintln(out)
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.io.*;

public class Task12 {
    static final class CSR {
        final int[] offset, target;
        CSR(int[] o, int[] t) { offset = o; target = t; }
        int[] neighbors(int u) { return Arrays.copyOfRange(target, offset[u], offset[u + 1]); }
    }

    static CSR build(int n, List<int[]> edges) {
        int[] offset = new int[n + 1];
        for (int[] e : edges) offset[e[0] + 1]++;
        for (int i = 1; i <= n; i++) offset[i] += offset[i - 1];
        int[] target = new int[edges.size()];
        int[] cursor = Arrays.copyOf(offset, n);
        for (int[] e : edges) target[cursor[e[0]]++] = e[1];
        return new CSR(offset, target);
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        AtomicReference<CSR> current = new AtomicReference<>(build(n, new ArrayList<>()));
        List<int[]> base = new ArrayList<>();
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isBlank()) continue;
            StringTokenizer st = new StringTokenizer(line);
            String op = st.nextToken();
            switch (op) {
                case "add" -> base.add(new int[]{
                    Integer.parseInt(st.nextToken()), Integer.parseInt(st.nextToken())});
                case "rebuild" -> {
                    List<int[]> all = new ArrayList<>(base);
                    all.sort((a, b) -> a[0] - b[0]);
                    current.set(build(n, all));
                }
                case "query" -> {
                    int u = Integer.parseInt(st.nextToken());
                    int[] ns = current.get().neighbors(u);
                    for (int i = 0; i < ns.length; i++) {
                        if (i > 0) sb.append(' ');
                        sb.append(ns[i]);
                    }
                    sb.append('\n');
                }
            }
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


class CSR:
    __slots__ = ("offset", "target")

    def __init__(self, offset, target):
        self.offset = offset
        self.target = target

    def neighbors(self, u):
        return self.target[self.offset[u]:self.offset[u + 1]]


def build_csr(n, edges):
    offset = [0] * (n + 1)
    for u, _ in edges:
        offset[u + 1] += 1
    for i in range(1, n + 1):
        offset[i] += offset[i - 1]
    target = [0] * len(edges)
    cursor = offset[:n]
    for u, v in edges:
        target[cursor[u]] = v
        cursor[u] += 1
    return CSR(offset, target)


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    base = []
    current = build_csr(n, base)  # GIL makes the pointer swap atomic in CPython
    out = []
    while p < len(data):
        op = data[p].decode(); p += 1
        if op == "add":
            u = int(data[p]); v = int(data[p + 1]); p += 2
            base.append((u, v))
        elif op == "rebuild":
            current = build_csr(n, sorted(base))
        elif op == "query":
            u = int(data[p]); p += 1
            out.append(" ".join(map(str, current.neighbors(u))))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `query` between rebuilds reflects the last published snapshot, not buffered writes.
- Reads dereference one atomic pointer with no lock.
- Each `rebuild` is `O(n + E)` and produces a valid CSR.

---

### Task 13 — Gap + varint compressed adjacency storage

**Problem.** Compress an undirected graph's adjacency lists with gap encoding plus byte-aligned varints: sort each vertex's neighbors, store first-differences, and encode each gap as a LEB128 varint. Answer `neighbors(u)` by decoding the byte stream. Report the total compressed byte size.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`, then `q`, then `q` query vertices.
- Output: line 1 is the total compressed byte size; then `q` lines, each the decoded ascending neighbors of the queried vertex.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- Neighbor ids fit in 32 bits.
- Decode is `O(degree)` per query.

**Hint.** Per vertex: sort neighbors, store `first` then `gap = cur - prev` for the rest. LEB128 writes 7 bits per byte, high bit set while more bytes follow. Keep a per-vertex byte offset index so you can seek to a vertex's stream.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func putVarint(buf []byte, x uint32) []byte {
	for x >= 0x80 {
		buf = append(buf, byte(x)|0x80)
		x >>= 7
	}
	return append(buf, byte(x))
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	starts := make([]int, n+1)
	var stream []byte
	for u := 0; u < n; u++ {
		starts[u] = len(stream)
		ns := adj[u]
		sort.Ints(ns)
		prev := 0
		for j, v := range ns {
			gap := v - prev
			if j == 0 {
				gap = v
			}
			stream = putVarint(stream, uint32(gap))
			prev = v
		}
	}
	starts[n] = len(stream)
	degree := make([]int, n)
	for u := 0; u < n; u++ {
		degree[u] = len(adj[u])
	}
	fmt.Fprintln(out, len(stream))

	decode := func(u int) []int {
		res := make([]int, 0, degree[u])
		pos := starts[u]
		prev := 0
		for len(res) < degree[u] {
			var x uint32
			var shift uint
			for {
				b := stream[pos]
				pos++
				x |= uint32(b&0x7f) << shift
				if b < 0x80 {
					break
				}
				shift += 7
			}
			var v int
			if len(res) == 0 {
				v = int(x)
			} else {
				v = prev + int(x)
			}
			res = append(res, v)
			prev = v
		}
		return res
	}

	var q int
	fmt.Fscan(in, &q)
	for i := 0; i < q; i++ {
		var u int
		fmt.Fscan(in, &u)
		ns := decode(u)
		for j, v := range ns {
			if j > 0 {
				out.WriteByte(' ')
			}
			fmt.Fprint(out, v)
		}
		fmt.Fprintln(out)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        int[] starts = new int[n + 1];
        int[] degree = new int[n];
        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        for (int u = 0; u < n; u++) {
            starts[u] = stream.size();
            List<Integer> ns = adj.get(u);
            Collections.sort(ns);
            degree[u] = ns.size();
            int prev = 0;
            for (int j = 0; j < ns.size(); j++) {
                int v = ns.get(j);
                int gap = (j == 0) ? v : v - prev;
                putVarint(stream, gap);
                prev = v;
            }
        }
        starts[n] = stream.size();
        byte[] bytes = stream.toByteArray();

        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        sb.append(bytes.length).append('\n');
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            int pos = starts[u], prev = 0;
            for (int c = 0; c < degree[u]; c++) {
                int x = 0, shift = 0;
                while (true) {
                    int b = bytes[pos++] & 0xff;
                    x |= (b & 0x7f) << shift;
                    if (b < 0x80) break;
                    shift += 7;
                }
                int v = (c == 0) ? x : prev + x;
                if (c > 0) sb.append(' ');
                sb.append(v);
                prev = v;
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }

    static void putVarint(ByteArrayOutputStream s, int x) {
        while ((x & ~0x7f) != 0) {
            s.write((x & 0x7f) | 0x80);
            x >>>= 7;
        }
        s.write(x);
    }
}
```

**Reference — Python.**
```python
import sys


def put_varint(buf: bytearray, x: int) -> None:
    while x >= 0x80:
        buf.append((x & 0x7f) | 0x80)
        x >>= 7
    buf.append(x)


def main() -> None:
    data = sys.stdin.buffer.read().split()
    p = 0
    n = int(data[p]); p += 1
    m = int(data[p]); p += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[p]); v = int(data[p + 1]); p += 2
        adj[u].append(v)
        adj[v].append(u)
    starts = [0] * (n + 1)
    degree = [0] * n
    stream = bytearray()
    for u in range(n):
        starts[u] = len(stream)
        ns = sorted(adj[u])
        degree[u] = len(ns)
        prev = 0
        for j, v in enumerate(ns):
            gap = v if j == 0 else v - prev
            put_varint(stream, gap)
            prev = v
    starts[n] = len(stream)

    def decode(u: int):
        res = []
        pos = starts[u]
        prev = 0
        while len(res) < degree[u]:
            x = 0
            shift = 0
            while True:
                b = stream[pos]
                pos += 1
                x |= (b & 0x7f) << shift
                if b < 0x80:
                    break
                shift += 7
            v = x if not res else prev + x
            res.append(v)
            prev = v
        return res

    q = int(data[p]); p += 1
    out = [str(len(stream))]
    for _ in range(q):
        u = int(data[p]); p += 1
        out.append(" ".join(map(str, decode(u))))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Decoded neighbors equal the sorted original adjacency list.
- Compressed size is smaller than `4 * (2m)` bytes on locality-rich inputs.
- Decode is `O(degree)` per query.

---

### Task 14 — Partition a graph and measure the cross-edge ratio

**Problem.** Given a graph and a number of partitions `P`, assign each vertex to partition `hash(v) mod P` (use `v mod P` for determinism). Compute the fraction of edges whose endpoints fall in different partitions — the cross-edge ratio that drives network cost in distributed graphs.

**Input / Output spec.**
- Input: `n`, `m`, `P`, then `m` lines `u v` (undirected).
- Output: the cross-edge ratio as a fraction rounded to 6 decimals.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 5*10^6`, `1 <= P <= n`.
- `O(n + m)` time.

**Hint.** `part(v) = v % P`. An edge is a cross-edge iff `part(u) != part(v)`. Ratio is `crossEdges / m` (define ratio as `0` when `m == 0`).

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
	var n, m, p int
	fmt.Fscan(in, &n, &m, &p)
	cross := 0
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		if u%p != v%p {
			cross++
		}
	}
	ratio := 0.0
	if m > 0 {
		ratio = float64(cross) / float64(m)
	}
	fmt.Printf("%.6f\n", ratio)
	_ = n
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        tok.nextToken(); int p = (int) tok.nval;
        long cross = 0;
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            if (u % p != v % p) cross++;
        }
        double ratio = (m > 0) ? (double) cross / m : 0.0;
        System.out.printf("%.6f%n", ratio);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    p = int(data[idx]); idx += 1
    cross = 0
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        if u % p != v % p:
            cross += 1
    ratio = cross / m if m > 0 else 0.0
    print(f"{ratio:.6f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `P = 1` yields ratio `0.0` (all vertices in one partition).
- Empty graph (`m = 0`) yields `0.0`, not a division error.
- Single pass, `O(n + m)`.

---

### Task 15 — Choose the representation and measure its memory footprint

**Problem.** Given graph parameters `V` and `E` and a flag `dense` or `sparse`, compute the estimated bytes for each of matrix, primitive adjacency list, edge list, and CSR (using 4-byte ids and the model from the senior notes), then print which representation a senior engineer would pick and why (one of `matrix`, `list`, `edge`, `csr`).

**Input / Output spec.**
- Input: `V`, `E`, then a string `static` or `mutable`.
- Output: 4 lines `matrix=<bytes>`, `list=<bytes>`, `edge=<bytes>`, `csr=<bytes>`, then a 5th line `choice=<name>`.

**Constraints.**
- `1 <= V <= 2*10^8`, `0 <= E <= 4*10^10`.
- Use 64-bit arithmetic for byte counts.
- Model (directed, 4-byte ids): matrix `= 4*V*V`; list `= 4*E + 40*V` (header + slack); edge `= 8*E`; csr `= 4*(V+1) + 4*E`.

**Hint.** Decision rule: if `E >= V*V/4` (dense and `V` small enough that the matrix fits a sane budget, say `V <= 5000`) choose `matrix`; else if `static` choose `csr`; else choose `list`. The `edge` form is reported but only chosen when explicitly asked for whole-edge sweeps (not in this task's rule).

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
	var v, e int64
	var kind string
	fmt.Fscan(in, &v, &e, &kind)

	matrix := 4 * v * v
	list := 4*e + 40*v
	edge := 8 * e
	csr := 4*(v+1) + 4*e

	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	fmt.Fprintf(out, "matrix=%d\n", matrix)
	fmt.Fprintf(out, "list=%d\n", list)
	fmt.Fprintf(out, "edge=%d\n", edge)
	fmt.Fprintf(out, "csr=%d\n", csr)

	choice := "list"
	if v <= 5000 && e >= v*v/4 {
		choice = "matrix"
	} else if kind == "static" {
		choice = "csr"
	}
	fmt.Fprintf(out, "choice=%s\n", choice)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        long v = Long.parseLong(st.nextToken());
        long e = Long.parseLong(st.nextToken());
        String kind = st.nextToken();

        long matrix = 4L * v * v;
        long list = 4L * e + 40L * v;
        long edge = 8L * e;
        long csr = 4L * (v + 1) + 4L * e;

        StringBuilder sb = new StringBuilder();
        sb.append("matrix=").append(matrix).append('\n');
        sb.append("list=").append(list).append('\n');
        sb.append("edge=").append(edge).append('\n');
        sb.append("csr=").append(csr).append('\n');

        String choice = "list";
        if (v <= 5000 && e >= v * v / 4) choice = "matrix";
        else if (kind.equals("static")) choice = "csr";
        sb.append("choice=").append(choice).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main() -> None:
    parts = sys.stdin.read().split()
    v = int(parts[0])
    e = int(parts[1])
    kind = parts[2]

    matrix = 4 * v * v
    list_bytes = 4 * e + 40 * v
    edge = 8 * e
    csr = 4 * (v + 1) + 4 * e

    out = [
        f"matrix={matrix}",
        f"list={list_bytes}",
        f"edge={edge}",
        f"csr={csr}",
    ]
    if v <= 5000 and e >= v * v // 4:
        choice = "matrix"
    elif kind == "static":
        choice = "csr"
    else:
        choice = "list"
    out.append(f"choice={choice}")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All byte counts use 64-bit arithmetic (no overflow at `V = 2*10^8`).
- A small dense graph picks `matrix`; a large static sparse graph picks `csr`; a large mutable sparse graph picks `list`.
- The four byte estimates match the stated model exactly.

---

## Benchmark Task

### Task B — Representation throughput across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark over a random directed graph of `V` vertices and `E` edges. Measure three workloads that stress the representation differently:

- **(a) build** — construct an adjacency list (`List<List<Integer>>` / `[][]int` / list of lists) from the edge array.
- **(b) build CSR** — construct a CSR (`offset`, `target`) from the same edge array via the two-pass algorithm.
- **(c) full scan** — sum every neighbor id by traversing the CSR, then separately by traversing the adjacency list; report both scan times.

Run for `(V, E) ∈ {(10^4, 5*10^4), (10^5, 5*10^5), (10^6, 5*10^6)}`. Repeat each measurement 5 times and report the mean wall-clock time in milliseconds. Use the same seed across languages so the input distribution is identical.

**Input / Output spec.**
- No stdin input. Output a fixed table to stdout:

```text
V         E          build_list_ms   build_csr_ms   scan_csr_ms   scan_list_ms
10000     50000      ...             ...            ...           ...
100000    500000     ...             ...            ...           ...
1000000   5000000    ...             ...            ...           ...
```

**Constraints.**
- Seed: `42`.
- Edge endpoints: uniform in `[0, V)`.
- Time only the workload, not the random generation.

**Reference — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genEdges(v, e int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed))
	edges := make([][2]int, e)
	for i := range edges {
		edges[i] = [2]int{r.Intn(v), r.Intn(v)}
	}
	return edges
}

func buildList(v int, edges [][2]int) [][]int {
	adj := make([][]int, v)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
	}
	return adj
}

func buildCSR(v int, edges [][2]int) ([]int, []int) {
	offset := make([]int, v+1)
	for _, e := range edges {
		offset[e[0]+1]++
	}
	for i := 1; i <= v; i++ {
		offset[i] += offset[i-1]
	}
	target := make([]int, len(edges))
	cursor := make([]int, v)
	copy(cursor, offset[:v])
	for _, e := range edges {
		target[cursor[e[0]]] = e[1]
		cursor[e[0]]++
	}
	return offset, target
}

func meanMs(d []time.Duration) float64 {
	var s int64
	for _, x := range d {
		s += x.Microseconds()
	}
	return float64(s) / float64(len(d)) / 1000.0
}

func main() {
	cases := [][2]int{{10000, 50000}, {100000, 500000}, {1000000, 5000000}}
	fmt.Println("V         E          build_list_ms   build_csr_ms   scan_csr_ms   scan_list_ms")
	for _, c := range cases {
		v, e := c[0], c[1]
		edges := genEdges(v, e, 42)
		var bl, bc, sc, sl []time.Duration
		for i := 0; i < 5; i++ {
			t := time.Now()
			adj := buildList(v, edges)
			bl = append(bl, time.Since(t))

			t = time.Now()
			offset, target := buildCSR(v, edges)
			bc = append(bc, time.Since(t))

			t = time.Now()
			var s1 int64
			for k := range target {
				s1 += int64(target[k])
			}
			sc = append(sc, time.Since(t))

			t = time.Now()
			var s2 int64
			for u := 0; u < v; u++ {
				for _, w := range adj[u] {
					s2 += int64(w)
				}
			}
			sl = append(sl, time.Since(t))
			_ = offset
			_ = s1
			_ = s2
		}
		fmt.Printf("%-9d %-10d %-15.2f %-14.2f %-13.2f %-12.2f\n",
			v, e, meanMs(bl), meanMs(bc), meanMs(sc), meanMs(sl))
	}
}
```

**Reference — Java.**
```java
import java.util.*;

public class TaskB {
    static int[][] genEdges(int v, int e, long seed) {
        Random r = new Random(seed);
        int[][] edges = new int[e][2];
        for (int i = 0; i < e; i++) {
            edges[i][0] = r.nextInt(v);
            edges[i][1] = r.nextInt(v);
        }
        return edges;
    }

    static List<List<Integer>> buildList(int v, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < v; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(e[1]);
        return adj;
    }

    static int[][] buildCSR(int v, int[][] edges) {
        int[] offset = new int[v + 1];
        for (int[] e : edges) offset[e[0] + 1]++;
        for (int i = 1; i <= v; i++) offset[i] += offset[i - 1];
        int[] target = new int[edges.length];
        int[] cursor = Arrays.copyOf(offset, v);
        for (int[] e : edges) target[cursor[e[0]]++] = e[1];
        return new int[][]{offset, target};
    }

    static double meanMs(long[] ns) {
        long s = 0;
        for (long x : ns) s += x;
        return (s / 1_000_000.0) / ns.length;
    }

    public static void main(String[] args) {
        int[][] cases = {{10000, 50000}, {100000, 500000}, {1000000, 5000000}};
        System.out.println("V         E          build_list_ms   build_csr_ms   scan_csr_ms   scan_list_ms");
        for (int[] c : cases) {
            int v = c[0], e = c[1];
            int[][] edges = genEdges(v, e, 42L);
            long[] bl = new long[5], bc = new long[5], sc = new long[5], sl = new long[5];
            for (int i = 0; i < 5; i++) {
                long t = System.nanoTime();
                List<List<Integer>> adj = buildList(v, edges);
                bl[i] = System.nanoTime() - t;

                t = System.nanoTime();
                int[][] csr = buildCSR(v, edges);
                bc[i] = System.nanoTime() - t;

                t = System.nanoTime();
                long s1 = 0;
                for (int x : csr[1]) s1 += x;
                sc[i] = System.nanoTime() - t;

                t = System.nanoTime();
                long s2 = 0;
                for (int u = 0; u < v; u++) for (int w : adj.get(u)) s2 += w;
                sl[i] = System.nanoTime() - t;
                if (s1 + s2 == -1) System.out.print("");
            }
            System.out.printf("%-9d %-10d %-15.2f %-14.2f %-13.2f %-12.2f%n",
                v, e, meanMs(bl), meanMs(bc), meanMs(sc), meanMs(sl));
        }
    }
}
```

**Reference — Python.**
```python
import random
import time
from typing import List, Tuple


def gen_edges(v: int, e: int, seed: int) -> List[Tuple[int, int]]:
    r = random.Random(seed)
    return [(r.randrange(v), r.randrange(v)) for _ in range(e)]


def build_list(v: int, edges):
    adj = [[] for _ in range(v)]
    for u, w in edges:
        adj[u].append(w)
    return adj


def build_csr(v: int, edges):
    offset = [0] * (v + 1)
    for u, _ in edges:
        offset[u + 1] += 1
    for i in range(1, v + 1):
        offset[i] += offset[i - 1]
    target = [0] * len(edges)
    cursor = offset[:v]
    for u, w in edges:
        target[cursor[u]] = w
        cursor[u] += 1
    return offset, target


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    cases = [(10_000, 50_000), (100_000, 500_000), (1_000_000, 5_000_000)]
    print("V         E          build_list_ms   build_csr_ms   scan_csr_ms   scan_list_ms")
    for v, e in cases:
        edges = gen_edges(v, e, 42)
        bl, bc, sc, sl = [], [], [], []
        for _ in range(5):
            t = time.perf_counter()
            adj = build_list(v, edges)
            bl.append(time.perf_counter() - t)

            t = time.perf_counter()
            offset, target = build_csr(v, edges)
            bc.append(time.perf_counter() - t)

            t = time.perf_counter()
            s1 = 0
            for x in target:
                s1 += x
            sc.append(time.perf_counter() - t)

            t = time.perf_counter()
            s2 = 0
            for u in range(v):
                for w in adj[u]:
                    s2 += w
            sl.append(time.perf_counter() - t)

        print(f"{v:<9d} {e:<10d} {mean_ms(bl):<15.2f} {mean_ms(bc):<14.2f} "
              f"{mean_ms(sc):<13.2f} {mean_ms(sl):<12.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same edge set across languages.
- The CSR scan (`scan_csr_ms`) is at least as fast as the list scan (`scan_list_ms`), and the gap widens with `V` — the cache-locality effect.
- The benchmark does not time edge generation.
- Writeup: a short note on which language showed the widest CSR-vs-list scan gap, and why (cache locality versus interpreter overhead).
