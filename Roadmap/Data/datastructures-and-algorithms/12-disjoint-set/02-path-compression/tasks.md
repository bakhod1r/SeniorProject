# Path Compression — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Assume you already know the basic DSU (`parent[i] = i`, root iff `parent[r] == r`). These tasks focus on the **Find-side** compression.

---

## Beginner Tasks (5)

### Task 1 — Implement full path compression (recursive find)

**Problem.** Implement a DSU with arbitrary union and a recursive **full path compression** `find`. After `find(x)`, every node on the path from `x` to the root must point directly at the root.

**Input / Output spec.**
- Operations: `union a b` or `find x`.
- For each `find`, print the returned root.

**Constraints.**
- `1 <= n <= 10^5` elements, `1 <= ops <= 10^6`.
- (Watch recursion depth — for this task `n` is small enough.)

**Hint.** `find(x): if parent[x] != x: parent[x] = find(parent[x]); return parent[x]`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type DSU struct{ parent []int }

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{p}
}

func (d *DSU) Find(x int) int {
	if d.parent[x] != x {
		d.parent[x] = d.Find(d.parent[x])
	}
	return d.parent[x]
}

func (d *DSU) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra != rb {
		d.parent[ra] = rb
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	d := NewDSU(n)
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		if op == "union" {
			var a, b int
			fmt.Fscan(in, &a, &b)
			d.Union(a, b)
		} else {
			var x int
			fmt.Fscan(in, &x)
			fmt.Fprintln(out, d.Find(x))
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int[] parent;

    static int find(int x) {
        if (parent[x] != x) parent[x] = find(parent[x]);
        return parent[x];
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra != rb) parent[ra] = rb;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        StringBuilder sb = new StringBuilder();
        while (st.nextToken() != StreamTokenizer.TT_EOF) {
            String op = st.sval;
            if ("union".equals(op)) {
                st.nextToken(); int a = (int) st.nval;
                st.nextToken(); int b = (int) st.nval;
                union(a, b);
            } else {
                st.nextToken(); int x = (int) st.nval;
                sb.append(find(x)).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main():
    sys.setrecursionlimit(300000)
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))

    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    out = []
    while idx < len(data):
        op = data[idx]; idx += 1
        if op == "union":
            a, b = int(data[idx]), int(data[idx + 1]); idx += 2
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
        else:
            x = int(data[idx]); idx += 1
            out.append(str(find(x)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- After any `find(x)`, every node on the path points directly to the root.
- Two elements in the same group return the same root.
- `find` of a root returns itself.

---

### Task 2 — Implement iterative path halving

**Problem.** Reimplement `find` as **iterative path halving** — no recursion. Each step, point a node to its grandparent and advance.

**Input / Output spec.**
- Same as Task 1.

**Constraints.**
- `1 <= n <= 10^6`. Must handle deep chains **without** recursion.

**Hint.** `while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]`.

**Go.**
```go
func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}
```

**Java.**
```java
static int find(int x) {
    while (parent[x] != x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    return x;
}
```

**Python.**
```python
def find(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
```

**Evaluation criteria.**
- No recursion; survives `n = 10^6` deep chains.
- After repeated finds the tree becomes flat (average path length → ~1).
- Correctly returns the root each call.

---

### Task 3 — Implement path splitting and compare to halving

**Problem.** Implement **path splitting** `find`, then write a small driver that builds the same chain `0→1→…→n-1`, runs `find(0)` once under halving and once under splitting (on fresh copies), and prints both resulting `parent[]` arrays so you can see the difference.

**Input / Output spec.**
- Input: a single integer `n`.
- Output: two lines — the `parent[]` after one halving find, and after one splitting find.

**Constraints.**
- `2 <= n <= 20` (small, so you can eyeball the arrays).

**Hint.** Splitting: `next = parent[x]; parent[x] = parent[parent[x]]; x = next`.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func chain(n int) []int {
	p := make([]int, n)
	for i := 0; i < n-1; i++ {
		p[i] = i + 1
	}
	p[n-1] = n - 1
	return p
}

func halving(p []int, x int) {
	for p[x] != x {
		p[x] = p[p[x]]
		x = p[x]
	}
}

func splitting(p []int, x int) {
	for p[x] != x {
		next := p[x]
		p[x] = p[p[x]]
		x = next
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	a := chain(n)
	halving(a, 0)
	b := chain(n)
	splitting(b, 0)
	fmt.Println("halving  ", a)
	fmt.Println("splitting", b)
}
```

**Java.**
```java
import java.util.*;

public class Task3 {
    static int[] chain(int n) {
        int[] p = new int[n];
        for (int i = 0; i < n - 1; i++) p[i] = i + 1;
        p[n - 1] = n - 1;
        return p;
    }

    static void halving(int[] p, int x) {
        while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; }
    }

    static void splitting(int[] p, int x) {
        while (p[x] != x) { int next = p[x]; p[x] = p[p[x]]; x = next; }
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = chain(n); halving(a, 0);
        int[] b = chain(n); splitting(b, 0);
        System.out.println("halving   " + Arrays.toString(a));
        System.out.println("splitting " + Arrays.toString(b));
    }
}
```

**Python.**
```python
import sys


def chain(n):
    return list(range(1, n)) + [n - 1]


def halving(p, x):
    while p[x] != x:
        p[x] = p[p[x]]
        x = p[x]


def splitting(p, x):
    while p[x] != x:
        nxt = p[x]
        p[x] = p[p[x]]
        x = nxt


def main():
    n = int(sys.stdin.read().split()[0])
    a = chain(n); halving(a, 0)
    b = chain(n); splitting(b, 0)
    print("halving  ", a)
    print("splitting", b)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Both finds return/leave the correct root.
- Halving rewrites roughly every other node; splitting rewrites every node to its grandparent.
- The two printed arrays differ as expected.

---

### Task 4 — Connectivity queries

**Problem.** Implement `connected(a, b)` on a path-compressed DSU. Process a stream of `union a b` and `query a b` operations; print `YES`/`NO` for each query.

**Input / Output spec.**
- Input: `n`, then operations.
- Output: one `YES`/`NO` per `query`.

**Constraints.**
- `1 <= n <= 10^6`, up to `2*10^6` operations. Use iterative find.

**Hint.** `connected(a, b)` is just `find(a) == find(b)`; both finds compress as a side effect.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, rnk []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		return
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	parent[rb] = ra
	if rnk[ra] == rnk[rb] {
		rnk[ra]++
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		var a, b int
		fmt.Fscan(in, &a, &b)
		if op == "union" {
			union(a, b)
		} else {
			if find(a) == find(b) {
				fmt.Fprintln(out, "YES")
			} else {
				fmt.Fprintln(out, "NO")
			}
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static int[] parent, rank;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        StringBuilder sb = new StringBuilder();
        while (st.nextToken() != StreamTokenizer.TT_EOF) {
            String op = st.sval;
            st.nextToken(); int a = (int) st.nval;
            st.nextToken(); int b = (int) st.nval;
            if ("union".equals(op)) union(a, b);
            else sb.append(find(a) == find(b) ? "YES" : "NO").append('\n');
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    out = []
    while idx < len(data):
        op = data[idx]; a = int(data[idx + 1]); b = int(data[idx + 2]); idx += 3
        if op == b"union":
            ra, rb = find(a), find(b)
            if ra != rb:
                if rank[ra] < rank[rb]:
                    ra, rb = rb, ra
                parent[rb] = ra
                if rank[ra] == rank[rb]:
                    rank[ra] += 1
        else:
            out.append("YES" if find(a) == find(b) else "NO")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct connectivity answers vs a brute-force reference.
- Iterative find; no stack overflow on deep inputs.
- Uses union by rank so trees stay shallow.

---

### Task 5 — Average path length before and after compression

**Problem.** Build a chain of `n` nodes. Compute the average find-path length (hops to root) over all `n` nodes **without** compressing, then run one full sweep of compressing finds and recompute the average. Print both.

**Input / Output spec.**
- Input: `n`.
- Output: two floats — average path length before, and after one compressing sweep.

**Constraints.**
- `2 <= n <= 10^5`.

**Hint.** A read-only walk measures depth; the compressing sweep flattens; the second average should be ~1.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func chain(n int) []int {
	p := make([]int, n)
	for i := 0; i < n-1; i++ {
		p[i] = i + 1
	}
	p[n-1] = n - 1
	return p
}

func depth(p []int, x int) int {
	d := 0
	for p[x] != x {
		x = p[x]
		d++
	}
	return d
}

func findHalving(p []int, x int) {
	for p[x] != x {
		p[x] = p[p[x]]
		x = p[x]
	}
}

func avgDepth(p []int) float64 {
	total := 0
	for i := range p {
		total += depth(p, i)
	}
	return float64(total) / float64(len(p))
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	p := chain(n)
	before := avgDepth(p)
	for i := range p {
		findHalving(p, i)
	}
	after := avgDepth(p)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	fmt.Fprintf(out, "%.3f\n%.3f\n", before, after)
}
```

**Java.**
```java
import java.util.*;

public class Task5 {
    static int[] chain(int n) {
        int[] p = new int[n];
        for (int i = 0; i < n - 1; i++) p[i] = i + 1;
        p[n - 1] = n - 1;
        return p;
    }

    static int depth(int[] p, int x) {
        int d = 0;
        while (p[x] != x) { x = p[x]; d++; }
        return d;
    }

    static void findHalving(int[] p, int x) {
        while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; }
    }

    static double avgDepth(int[] p) {
        long total = 0;
        for (int i = 0; i < p.length; i++) total += depth(p, i);
        return (double) total / p.length;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] p = chain(n);
        double before = avgDepth(p);
        for (int i = 0; i < n; i++) findHalving(p, i);
        double after = avgDepth(p);
        System.out.printf("%.3f%n%.3f%n", before, after);
    }
}
```

**Python.**
```python
import sys


def chain(n):
    return list(range(1, n)) + [n - 1]


def depth(p, x):
    d = 0
    while p[x] != x:
        x = p[x]
        d += 1
    return d


def find_halving(p, x):
    while p[x] != x:
        p[x] = p[p[x]]
        x = p[x]


def avg_depth(p):
    return sum(depth(p, i) for i in range(len(p))) / len(p)


def main():
    n = int(sys.stdin.read().split()[0])
    p = chain(n)
    before = avg_depth(p)
    for i in range(n):
        find_halving(p, i)
    after = avg_depth(p)
    print(f"{before:.3f}")
    print(f"{after:.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- "Before" average is roughly `(n-1)/2` for a chain.
- "After" average is close to 1 (near-flat forest).
- Confirms compression's flattening effect quantitatively.

---

## Intermediate Tasks (5)

### Task 6 — Kruskal's MST using a compressed DSU

**Problem.** Given a weighted undirected graph, compute the total weight of a minimum spanning tree using a path-compressed DSU with union by rank.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v w`.
- Output: total MST weight, or `-1` if the graph is disconnected.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, `0 <= w <= 10^9`.
- Time: `O(m log m)`.

**Hint.** Sort edges by weight; `union` returns whether a real merge happened; count merges to detect connectivity.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

var parent, rnk []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func union(a, b int) bool {
	ra, rb := find(a), find(b)
	if ra == rb {
		return false
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	parent[rb] = ra
	if rnk[ra] == rnk[rb] {
		rnk[ra]++
	}
	return true
}

type edge struct{ u, v, w int }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	edges := make([]edge, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].u, &edges[i].v, &edges[i].w)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].w < edges[j].w })
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	total, used := int64(0), 0
	for _, e := range edges {
		if union(e.u, e.v) {
			total += int64(e.w)
			used++
		}
	}
	if used == n-1 {
		fmt.Println(total)
	} else {
		fmt.Println(-1)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    static int[] parent, rank;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
        return true;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        int[][] edges = new int[m][3];
        for (int i = 0; i < m; i++) {
            st.nextToken(); edges[i][0] = (int) st.nval;
            st.nextToken(); edges[i][1] = (int) st.nval;
            st.nextToken(); edges[i][2] = (int) st.nval;
        }
        Arrays.sort(edges, (a, b) -> Integer.compare(a[2], b[2]));
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long total = 0; int used = 0;
        for (int[] e : edges) if (union(e[0], e[1])) { total += e[2]; used++; }
        System.out.println(used == n - 1 ? total : -1);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    edges = []
    for _ in range(m):
        u, v, w = int(data[idx]), int(data[idx + 1]), int(data[idx + 2]); idx += 3
        edges.append((w, u, v))
    edges.sort()
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, used = 0, 0
    for w, u, v in edges:
        ru, rv = find(u), find(v)
        if ru == rv:
            continue
        if rank[ru] < rank[rv]:
            ru, rv = rv, ru
        parent[rv] = ru
        if rank[ru] == rank[rv]:
            rank[ru] += 1
        total += w
        used += 1
    print(total if used == n - 1 else -1)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct MST weight vs a reference.
- Detects disconnection (`used != n-1`).
- DSU part is effectively linear; runtime dominated by the sort.

---

### Task 7 — Cycle detection in an undirected graph

**Problem.** Given `n` nodes and `m` undirected edges, decide whether the graph contains a cycle. Use a path-compressed DSU.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `u v`.
- Output: `YES` if a cycle exists, else `NO`.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 2*10^6`.

**Hint.** Before unioning an edge, if both endpoints already share a root, that edge closes a cycle.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, rnk []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	cycle := false
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		ru, rv := find(u), find(v)
		if ru == rv {
			cycle = true
		} else {
			if rnk[ru] < rnk[rv] {
				ru, rv = rv, ru
			}
			parent[rv] = ru
			if rnk[ru] == rnk[rv] {
				rnk[ru]++
			}
		}
	}
	if cycle {
		fmt.Println("YES")
	} else {
		fmt.Println("NO")
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    static int[] parent, rank;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        boolean cycle = false;
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            int ru = find(u), rv = find(v);
            if (ru == rv) cycle = true;
            else {
                if (rank[ru] < rank[rv]) { int t = ru; ru = rv; rv = t; }
                parent[rv] = ru;
                if (rank[ru] == rank[rv]) rank[ru]++;
            }
        }
        System.out.println(cycle ? "YES" : "NO");
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    cycle = False
    for _ in range(m):
        u, v = int(data[idx]), int(data[idx + 1]); idx += 2
        ru, rv = find(u), find(v)
        if ru == rv:
            cycle = True
        else:
            if rank[ru] < rank[rv]:
                ru, rv = rv, ru
            parent[rv] = ru
            if rank[ru] == rank[rv]:
                rank[ru] += 1
    print("YES" if cycle else "NO")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on trees (`NO`) and on graphs with a back edge (`YES`).
- Handles self-loops and parallel edges as cycles.
- Iterative find; scales to `10^6` nodes.

---

### Task 8 — Number of islands (grid connectivity via DSU)

**Problem.** Given a grid of `0`/`1`, count the number of connected groups of `1`s (4-directional adjacency). Use a DSU over cell indices with path compression.

**Input / Output spec.**
- Input: `r`, `c`, then `r` rows of `c` integers (0 or 1).
- Output: the number of islands.

**Constraints.**
- `1 <= r, c <= 1000`.

**Hint.** Map cell `(i, j)` to `i*c + j`. Union each `1`-cell with its right and down `1`-neighbors. Count distinct roots among `1`-cells.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, rnk []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		return
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	parent[rb] = ra
	if rnk[ra] == rnk[rb] {
		rnk[ra]++
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var r, c int
	fmt.Fscan(in, &r, &c)
	g := make([]int, r*c)
	for i := range g {
		fmt.Fscan(in, &g[i])
	}
	parent = make([]int, r*c)
	rnk = make([]int, r*c)
	for i := range parent {
		parent[i] = i
	}
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			id := i*c + j
			if g[id] == 0 {
				continue
			}
			if j+1 < c && g[id+1] == 1 {
				union(id, id+1)
			}
			if i+1 < r && g[id+c] == 1 {
				union(id, id+c)
			}
		}
	}
	count := 0
	for i := 0; i < r*c; i++ {
		if g[i] == 1 && find(i) == i {
			count++
		}
	}
	fmt.Println(count)
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    static int[] parent, rank;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int r = (int) st.nval;
        st.nextToken(); int c = (int) st.nval;
        int[] g = new int[r * c];
        for (int i = 0; i < r * c; i++) { st.nextToken(); g[i] = (int) st.nval; }
        parent = new int[r * c]; rank = new int[r * c];
        for (int i = 0; i < r * c; i++) parent[i] = i;
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++) {
                int id = i * c + j;
                if (g[id] == 0) continue;
                if (j + 1 < c && g[id + 1] == 1) union(id, id + 1);
                if (i + 1 < r && g[id + c] == 1) union(id, id + c);
            }
        int count = 0;
        for (int i = 0; i < r * c; i++) if (g[i] == 1 && find(i) == i) count++;
        System.out.println(count);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    r = int(data[idx]); c = int(data[idx + 1]); idx += 2
    g = [int(data[idx + i]) for i in range(r * c)]
    parent = list(range(r * c))
    rank = [0] * (r * c)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1

    for i in range(r):
        for j in range(c):
            cell = i * c + j
            if g[cell] == 0:
                continue
            if j + 1 < c and g[cell + 1] == 1:
                union(cell, cell + 1)
            if i + 1 < r and g[cell + c] == 1:
                union(cell, cell + c)

    print(sum(1 for i in range(r * c) if g[i] == 1 and find(i) == i))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct island count vs a BFS/DFS reference.
- Only `1`-cells are counted as roots.
- Handles all-`0` and all-`1` grids.

---

### Task 9 — Union by size + compression, report component sizes

**Problem.** Implement a DSU with **union by size** and path halving. After all unions, output the size of each element's component.

**Input / Output spec.**
- Input: `n`, `q`, then `q` lines `union a b`.
- Output: `n` integers — the component size for elements `0..n-1`.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= q <= 2*10^6`.

**Hint.** Keep `size[]` at roots. On union, attach the smaller tree under the larger and add sizes. Compression does **not** invalidate size (re-pointing within a tree does not change its element count).

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, size []int

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		return
	}
	if size[ra] < size[rb] {
		ra, rb = rb, ra
	}
	parent[rb] = ra
	size[ra] += size[rb]
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, q int
	fmt.Fscan(in, &n, &q)
	parent = make([]int, n)
	size = make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	for ; q > 0; q-- {
		var op string
		var a, b int
		fmt.Fscan(in, &op, &a, &b)
		union(a, b)
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i := 0; i < n; i++ {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, size[find(i)])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    static int[] parent, size;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        size[ra] += size[rb];
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int q = (int) st.nval;
        parent = new int[n]; size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        for (int i = 0; i < q; i++) {
            st.nextToken(); // "union"
            st.nextToken(); int a = (int) st.nval;
            st.nextToken(); int b = (int) st.nval;
            union(a, b);
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(size[find(i)]);
        }
        System.out.println(sb);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); q = int(data[idx + 1]); idx += 2
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for _ in range(q):
        a = int(data[idx + 1]); b = int(data[idx + 2]); idx += 3  # skip "union"
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]

    print(" ".join(str(size[find(i)]) for i in range(n)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Component sizes match a reference.
- Size stays exact despite compression.
- Largest possible component is `n` when all are unioned.

---

### Task 10 — Explicit two-pass full compression (no recursion)

**Problem.** Implement full path compression that yields a **perfectly flat** path after one call, but uses an explicit two-pass loop instead of recursion (so it is safe on deep chains).

**Input / Output spec.**
- Input: `n`, then operations `union a b` / `find x` (print root for finds).
- Output: roots for each find.

**Constraints.**
- `1 <= n <= 10^7`. Must not use recursion.

**Hint.** Pass 1: walk to the root. Pass 2: walk again, setting each node's parent to that root.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent []int

func find(x int) int {
	root := x
	for parent[root] != root {
		root = parent[root]
	}
	for parent[x] != root {
		next := parent[x]
		parent[x] = root
		x = next
	}
	return root
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		if op == "union" {
			var a, b int
			fmt.Fscan(in, &a, &b)
			ra, rb := find(a), find(b)
			if ra != rb {
				parent[ra] = rb
			}
		} else {
			var x int
			fmt.Fscan(in, &x)
			fmt.Fprintln(out, find(x))
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    static int[] parent;

    static int find(int x) {
        int root = x;
        while (parent[root] != root) root = parent[root];
        while (parent[x] != root) { int next = parent[x]; parent[x] = root; x = next; }
        return root;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        StringBuilder sb = new StringBuilder();
        while (st.nextToken() != StreamTokenizer.TT_EOF) {
            String op = st.sval;
            if ("union".equals(op)) {
                st.nextToken(); int a = (int) st.nval;
                st.nextToken(); int b = (int) st.nval;
                int ra = find(a), rb = find(b);
                if (ra != rb) parent[ra] = rb;
            } else {
                st.nextToken(); int x = (int) st.nval;
                sb.append(find(x)).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            nxt = parent[x]
            parent[x] = root
            x = nxt
        return root

    out = []
    while idx < len(data):
        op = data[idx]; idx += 1
        if op == b"union":
            a, b = int(data[idx]), int(data[idx + 1]); idx += 2
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
        else:
            x = int(data[idx]); idx += 1
            out.append(str(find(x)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- After one `find(x)`, the entire path is flat (depth 1).
- No recursion; survives `n = 10^7` chains.
- Same results as recursive full compression.

---

## Advanced Tasks (5)

### Task 11 — Rollback DSU (compression deliberately omitted)

**Problem.** Implement a DSU with union by rank and **no compression** so that `union` can be undone. Support `union a b`, `rollback` (undo last union), and `connected a b`.

**Input / Output spec.**
- Operations: `union a b`, `rollback`, `query a b`.
- Output: `YES`/`NO` for each query.

**Constraints.**
- `1 <= n <= 10^5`, up to `10^6` operations. Each `rollback` is `O(1)`.

**Hint.** Log `(child_root, parent_root, rank_bumped)` per real union; rollback restores exactly one parent and optionally decrements one rank. Compression would make rollback impossible.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var parent, rnk []int

type rec struct {
	child, par int
	bumped     bool
	real       bool
}

var history []rec

func find(x int) int { // read-only, NO compression
	for parent[x] != x {
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		history = append(history, rec{real: false})
		return
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	bumped := rnk[ra] == rnk[rb]
	history = append(history, rec{child: rb, par: ra, bumped: bumped, real: true})
	parent[rb] = ra
	if bumped {
		rnk[ra]++
	}
}

func rollback() {
	r := history[len(history)-1]
	history = history[:len(history)-1]
	if !r.real {
		return
	}
	parent[r.child] = r.child
	if r.bumped {
		rnk[r.par]--
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		switch op {
		case "union":
			var a, b int
			fmt.Fscan(in, &a, &b)
			union(a, b)
		case "rollback":
			rollback()
		case "query":
			var a, b int
			fmt.Fscan(in, &a, &b)
			if find(a) == find(b) {
				fmt.Fprintln(out, "YES")
			} else {
				fmt.Fprintln(out, "NO")
			}
		}
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    static int[] parent, rank;
    static int[][] history = new int[1 << 20][]; // {child, par, bumped, real}
    static int top = 0;

    static int find(int x) { // read-only
        while (parent[x] != x) x = parent[x];
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) { history[top++] = new int[]{0, 0, 0, 0}; return; }
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        int bumped = rank[ra] == rank[rb] ? 1 : 0;
        history[top++] = new int[]{rb, ra, bumped, 1};
        parent[rb] = ra;
        if (bumped == 1) rank[ra]++;
    }

    static void rollback() {
        int[] r = history[--top];
        if (r[3] == 0) return;
        parent[r[0]] = r[0];
        if (r[2] == 1) rank[r[1]]--;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        StringBuilder sb = new StringBuilder();
        while (st.nextToken() != StreamTokenizer.TT_EOF) {
            String op = st.sval;
            if ("union".equals(op)) {
                st.nextToken(); int a = (int) st.nval;
                st.nextToken(); int b = (int) st.nval;
                union(a, b);
            } else if ("rollback".equals(op)) {
                rollback();
            } else {
                st.nextToken(); int a = (int) st.nval;
                st.nextToken(); int b = (int) st.nval;
                sb.append(find(a) == find(b) ? "YES" : "NO").append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))
    rank = [0] * n
    history = []

    def find(x):  # read-only, no compression
        while parent[x] != x:
            x = parent[x]
        return x

    out = []
    while idx < len(data):
        op = data[idx]; idx += 1
        if op == b"union":
            a, b = int(data[idx]), int(data[idx + 1]); idx += 2
            ra, rb = find(a), find(b)
            if ra == rb:
                history.append(None)
            else:
                if rank[ra] < rank[rb]:
                    ra, rb = rb, ra
                bumped = rank[ra] == rank[rb]
                history.append((rb, ra, bumped))
                parent[rb] = ra
                if bumped:
                    rank[ra] += 1
        elif op == b"rollback":
            rec = history.pop()
            if rec is not None:
                rb, ra, bumped = rec
                parent[rb] = rb
                if bumped:
                    rank[ra] -= 1
        else:  # query
            a, b = int(data[idx]), int(data[idx + 1]); idx += 2
            out.append("YES" if find(a) == find(b) else "NO")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each `rollback` exactly undoes the last `union` in `O(1)`.
- No path compression anywhere (asserted in review).
- Connectivity correct after arbitrary union/rollback interleavings.

---

### Task 12 — Concurrent find with path splitting + CAS

**Problem.** Implement a concurrency-safe DSU whose `find` uses path splitting with compare-and-swap, so multiple goroutines/threads can call `find` and `union` safely. Demonstrate with parallel unions.

**Input / Output spec.**
- Programmatic: union a set of pairs from multiple workers, then report the number of components.

**Constraints.**
- Correctness under data races is the goal; performance is secondary.

**Hint.** Each splitting write publishes the grandparent (always an ancestor), so lost/stale CAS writes never break correctness.

**Go.**
```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type CDSU struct {
	parent []int32
	rank   []int32
}

func NewCDSU(n int) *CDSU {
	p := make([]int32, n)
	for i := range p {
		p[i] = int32(i)
	}
	return &CDSU{p, make([]int32, n)}
}

func (d *CDSU) Find(x int32) int32 {
	for {
		p := atomic.LoadInt32(&d.parent[x])
		if p == x {
			return x
		}
		gp := atomic.LoadInt32(&d.parent[p])
		atomic.CompareAndSwapInt32(&d.parent[x], p, gp) // splitting
		x = gp
	}
}

func (d *CDSU) Union(a, b int32) {
	for {
		ra, rb := d.Find(a), d.Find(b)
		if ra == rb {
			return
		}
		if atomic.LoadInt32(&d.rank[ra]) < atomic.LoadInt32(&d.rank[rb]) {
			ra, rb = rb, ra
		}
		if atomic.CompareAndSwapInt32(&d.parent[rb], rb, ra) {
			if atomic.LoadInt32(&d.rank[ra]) == atomic.LoadInt32(&d.rank[rb]) {
				atomic.AddInt32(&d.rank[ra], 1)
			}
			return
		}
	}
}

func main() {
	n := 1000
	d := NewCDSU(n)
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func(off int) {
			defer wg.Done()
			for i := off; i < n-1; i += 4 {
				d.Union(int32(i), int32(i+1))
			}
		}(w)
	}
	wg.Wait()
	count := 0
	for i := 0; i < n; i++ {
		if d.Find(int32(i)) == int32(i) {
			count++
		}
	}
	fmt.Println(count) // 1 — all unioned into one chain-of-pairs component
}
```

**Java.**
```java
import java.util.concurrent.atomic.AtomicIntegerArray;

public class Task12 {
    final AtomicIntegerArray parent;
    final AtomicIntegerArray rank;

    Task12(int n) {
        parent = new AtomicIntegerArray(n);
        rank = new AtomicIntegerArray(n);
        for (int i = 0; i < n; i++) parent.set(i, i);
    }

    int find(int x) {
        while (true) {
            int p = parent.get(x);
            if (p == x) return x;
            int gp = parent.get(p);
            parent.compareAndSet(x, p, gp); // splitting
            x = gp;
        }
    }

    void union(int a, int b) {
        while (true) {
            int ra = find(a), rb = find(b);
            if (ra == rb) return;
            if (rank.get(ra) < rank.get(rb)) { int t = ra; ra = rb; rb = t; }
            if (parent.compareAndSet(rb, rb, ra)) {
                if (rank.get(ra) == rank.get(rb)) rank.incrementAndGet(ra);
                return;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        int n = 1000;
        Task12 d = new Task12(n);
        Thread[] ts = new Thread[4];
        for (int w = 0; w < 4; w++) {
            final int off = w;
            ts[w] = new Thread(() -> {
                for (int i = off; i < n - 1; i += 4) d.union(i, i + 1);
            });
            ts[w].start();
        }
        for (Thread t : ts) t.join();
        int count = 0;
        for (int i = 0; i < n; i++) if (d.find(i) == i) count++;
        System.out.println(count); // 1
    }
}
```

**Python.**
```python
import threading

# NOTE: CPython's GIL makes list writes effectively atomic per bytecode,
# but a read-modify-write of parent[x] is NOT atomic across statements.
# We use a lock to emulate CAS semantics for correctness on all interpreters.


class CDSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.lock = threading.Lock()

    def find(self, x):
        # Splitting under a lock (CAS emulation for portability).
        while True:
            with self.lock:
                p = self.parent[x]
                if p == x:
                    return x
                gp = self.parent[p]
                self.parent[x] = gp
            x = gp

    def union(self, a, b):
        while True:
            ra, rb = self.find(a), self.find(b)
            if ra == rb:
                return
            with self.lock:
                if self.parent[rb] != rb:
                    continue  # lost the race; retry
                if self.rank[ra] < self.rank[rb]:
                    ra, rb = rb, ra
                self.parent[rb] = ra
                if self.rank[ra] == self.rank[rb]:
                    self.rank[ra] += 1
                return


def main():
    n = 1000
    d = CDSU(n)
    threads = []
    for off in range(4):
        def work(off=off):
            for i in range(off, n - 1, 4):
                d.union(i, i + 1)
        t = threading.Thread(target=work)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    print(sum(1 for i in range(n) if d.find(i) == i))  # 1


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Final component count is correct (deterministic) despite parallel unions.
- `find` uses splitting (grandparent writes), so races never corrupt the forest.
- No deadlocks; union retries on lost CAS.

---

### Task 13 — Offline LCA-style "find representative" with compression

**Problem.** Given a rooted tree and a set of `(u, v)` queries, simulate Tarjan-style offline ancestor lookup: DFS the tree, and use a path-compressed DSU where each fully-processed subtree is unioned into its parent. When a query's other endpoint is already processed, its DSU root is the LCA. Output each query's LCA.

**Input / Output spec.**
- Input: `n`, parent of each node (root has parent `-1`), `q`, then `q` query pairs.
- Output: the LCA for each query.

**Constraints.**
- `1 <= n <= 10^5`, `1 <= q <= 10^5`.

**Hint.** Process children first; after finishing a child subtree, `union(child, node)` and set the DSU "ancestor" of that set to `node`. For a query `(u, v)`, when you finish `u` and `v` is already finished, the answer is `find_ancestor(v)`. Compression keeps `find` near-constant.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	parent, ancestor []int
	visited          []bool
	children         [][]int
	queries          [][]int // queries[u] = list of (v, queryIndex)
	answer           []int
)

func find(x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

func dfs(u int) {
	ancestor[u] = u
	for _, c := range children[u] {
		dfs(c)
		parent[c] = u           // union child set into u
		ancestor[find(u)] = u   // representative of u's set is u
	}
	visited[u] = true
	for _, q := range queries[u] {
		v, qi := q[0], q[1]
		if visited[v] {
			answer[qi] = ancestor[find(v)]
		}
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	ancestor = make([]int, n)
	visited = make([]bool, n)
	children = make([][]int, n)
	root := 0
	for i := 0; i < n; i++ {
		parent[i] = i
		var p int
		fmt.Fscan(in, &p)
		if p == -1 {
			root = i
		} else {
			children[p] = append(children[p], i)
		}
	}
	var q int
	fmt.Fscan(in, &q)
	queries = make([][]int, n)
	answer = make([]int, q)
	for i := 0; i < q; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		queries[u] = append(queries[u], []int{v, i})
		queries[v] = append(queries[v], []int{u, i})
	}
	dfs(root)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, a := range answer {
		fmt.Fprintln(out, a)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static int[] parent, ancestor;
    static boolean[] visited;
    static List<Integer>[] children;
    static List<int[]>[] queries;
    static int[] answer;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void dfs(int u) {
        ancestor[u] = u;
        for (int c : children[u]) {
            dfs(c);
            parent[c] = u;
            ancestor[find(u)] = u;
        }
        visited[u] = true;
        for (int[] q : queries[u]) {
            if (visited[q[0]]) answer[q[1]] = ancestor[find(q[0])];
        }
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n]; ancestor = new int[n]; visited = new boolean[n];
        children = new List[n]; queries = new List[n];
        for (int i = 0; i < n; i++) { parent[i] = i; children[i] = new ArrayList<>(); queries[i] = new ArrayList<>(); }
        int root = 0;
        for (int i = 0; i < n; i++) {
            st.nextToken(); int p = (int) st.nval;
            if (p == -1) root = i; else children[p].add(i);
        }
        st.nextToken(); int q = (int) st.nval;
        answer = new int[q];
        for (int i = 0; i < q; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            queries[u].add(new int[]{v, i});
            queries[v].add(new int[]{u, i});
        }
        dfs(root);
        StringBuilder sb = new StringBuilder();
        for (int a : answer) sb.append(a).append('\n');
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys
from sys import setrecursionlimit


def main():
    setrecursionlimit(300000)
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))
    ancestor = list(range(n))
    visited = [False] * n
    children = [[] for _ in range(n)]
    root = 0
    for i in range(n):
        p = int(data[idx]); idx += 1
        if p == -1:
            root = i
        else:
            children[p].append(i)
    q = int(data[idx]); idx += 1
    queries = [[] for _ in range(n)]
    answer = [0] * q
    for i in range(q):
        u, v = int(data[idx]), int(data[idx + 1]); idx += 2
        queries[u].append((v, i))
        queries[v].append((u, i))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def dfs(u):
        ancestor[u] = u
        for c in children[u]:
            dfs(c)
            parent[c] = u
            ancestor[find(u)] = u
        visited[u] = True
        for v, qi in queries[u]:
            if visited[v]:
                answer[qi] = ancestor[find(v)]

    dfs(root)
    sys.stdout.write("\n".join(map(str, answer)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- LCAs match a binary-lifting reference on random trees.
- Each query answered exactly once (when its second endpoint is reached).
- Compression keeps the DSU finds near-constant; overall `O((n + q) α(n))`.

---

### Task 14 — Measure α(n)-like flatness: writes per find over a long run

**Problem.** Run `m` mixed `union`/`find` operations over `n` elements with compression + union by rank, counting total compression writes. Report the average writes per find. It should stay tiny (near-constant), illustrating the amortized `O(α(n))` behavior.

**Input / Output spec.**
- Input: `n`, then operations.
- Output: total finds, total compression writes, average writes per find (3 decimals).

**Constraints.**
- `1 <= n <= 10^6`, up to `5*10^6` operations.

**Hint.** Increment a global counter each time `find` rewrites a parent.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	parent, rnk   []int
	writes, finds int64
)

func find(x int) int {
	for parent[x] != x {
		gp := parent[parent[x]]
		if parent[x] != gp {
			parent[x] = gp
			writes++
		}
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		return
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	parent[rb] = ra
	if rnk[ra] == rnk[rb] {
		rnk[ra]++
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			break
		}
		var a, b int
		fmt.Fscan(in, &a, &b)
		if op == "union" {
			union(a, b)
		} else {
			finds++
			find(a)
			_ = b
		}
	}
	avg := 0.0
	if finds > 0 {
		avg = float64(writes) / float64(finds)
	}
	fmt.Printf("finds=%d writes=%d avg=%.3f\n", finds, writes, avg)
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    static int[] parent, rank;
    static long writes = 0, finds = 0;

    static int find(int x) {
        while (parent[x] != x) {
            int gp = parent[parent[x]];
            if (parent[x] != gp) { parent[x] = gp; writes++; }
            x = parent[x];
        }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.wordChars('a', 'z');
        st.nextToken(); int n = (int) st.nval;
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        while (st.nextToken() != StreamTokenizer.TT_EOF) {
            String op = st.sval;
            st.nextToken(); int a = (int) st.nval;
            st.nextToken(); int b = (int) st.nval;
            if ("union".equals(op)) union(a, b);
            else { finds++; find(a); }
        }
        double avg = finds > 0 ? (double) writes / finds : 0;
        System.out.printf("finds=%d writes=%d avg=%.3f%n", finds, writes, avg);
    }
}
```

**Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    parent = list(range(n))
    rank = [0] * n
    writes = 0
    finds = 0

    def find(x):
        nonlocal writes
        while parent[x] != x:
            gp = parent[parent[x]]
            if parent[x] != gp:
                parent[x] = gp
                writes += 1
            x = parent[x]
        return x

    while idx < len(data):
        op = data[idx]; a = int(data[idx + 1]); b = int(data[idx + 2]); idx += 3
        if op == b"union":
            ra, rb = find(a), find(b)
            if ra != rb:
                if rank[ra] < rank[rb]:
                    ra, rb = rb, ra
                parent[rb] = ra
                if rank[ra] == rank[rb]:
                    rank[ra] += 1
        else:
            finds += 1
            find(a)

    avg = writes / finds if finds else 0.0
    print(f"finds={finds} writes={writes} avg={avg:.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Average writes per find stays small and roughly constant as `n` grows.
- Demonstrates the amortized near-constant cost empirically.
- Counter only increments on a real re-pointing.

---

### Task 15 — DSU on the segment tree of time (offline dynamic connectivity)

**Problem.** Edges are added at some time and removed later. Answer "is `u` connected to `v` at time `t`?" offline. Use a **rollback DSU (no compression)** and a segment tree over time: attach each edge to the time-intervals where it is alive, DFS the segment tree, union on entry, query at leaves, rollback on exit.

**Input / Output spec.**
- Input: `n`, `T` (number of time steps), a list of edge-add/edge-remove events with times, and connectivity queries `(u, v, t)`.
- Output: `YES`/`NO` per query.

**Constraints.**
- `1 <= n <= 10^5`, `1 <= T <= 10^5`, total events/queries up to `2*10^5`.
- Compression must be **omitted** (rollback requires it).

**Hint.** Build a segment tree over `[0, T)`. For each edge alive on `[l, r]`, add it to the `O(log T)` canonical nodes. DFS: at each node union its edges (logging for rollback), recurse, then rollback. Answer each query at its leaf.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

var (
	parent, rnk []int
	seg         [][][2]int // seg[node] = list of edges (u,v)
	stack       [][3]int   // rollback log: (child, parent, bumped)
	T           int
	queryAt     map[int][]struct{ u, v, qi int }
	answer      []bool
)

func find(x int) int { // NO compression
	for parent[x] != x {
		x = parent[x]
	}
	return x
}

func union(a, b int) {
	ra, rb := find(a), find(b)
	if ra == rb {
		stack = append(stack, [3]int{-1, -1, 0})
		return
	}
	if rnk[ra] < rnk[rb] {
		ra, rb = rb, ra
	}
	bumped := 0
	if rnk[ra] == rnk[rb] {
		bumped = 1
	}
	stack = append(stack, [3]int{rb, ra, bumped})
	parent[rb] = ra
	if bumped == 1 {
		rnk[ra]++
	}
}

func rollback() {
	r := stack[len(stack)-1]
	stack = stack[:len(stack)-1]
	if r[0] == -1 {
		return
	}
	parent[r[0]] = r[0]
	if r[2] == 1 {
		rnk[r[1]]--
	}
}

func addEdge(node, nl, nr, l, r, u, v int) {
	if r < nl || nr < l {
		return
	}
	if l <= nl && nr <= r {
		seg[node] = append(seg[node], [2]int{u, v})
		return
	}
	mid := (nl + nr) / 2
	addEdge(2*node, nl, mid, l, r, u, v)
	addEdge(2*node+1, mid+1, nr, l, r, u, v)
}

func dfs(node, nl, nr int) {
	cnt := 0
	for _, e := range seg[node] {
		union(e[0], e[1])
		cnt++
	}
	if nl == nr {
		for _, q := range queryAt[nl] {
			answer[q.qi] = find(q.u) == find(q.v)
		}
	} else {
		mid := (nl + nr) / 2
		dfs(2*node, nl, mid)
		dfs(2*node+1, mid+1, nr)
	}
	for ; cnt > 0; cnt-- {
		rollback()
	}
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, q int
	fmt.Fscan(in, &n, &T, &q)
	parent = make([]int, n)
	rnk = make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	seg = make([][][2]int, 4*T)
	queryAt = map[int][]struct{ u, v, qi int }{}
	answer = make([]bool, q)
	// Edges: each line "u v l r" means edge (u,v) alive on times [l, r].
	var e int
	fmt.Fscan(in, &e)
	for i := 0; i < e; i++ {
		var u, v, l, r int
		fmt.Fscan(in, &u, &v, &l, &r)
		addEdge(1, 0, T-1, l, r, u, v)
	}
	for i := 0; i < q; i++ {
		var u, v, t int
		fmt.Fscan(in, &u, &v, &t)
		queryAt[t] = append(queryAt[t], struct{ u, v, qi int }{u, v, i})
	}
	dfs(1, 0, T-1)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, a := range answer {
		if a {
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

public class Task15 {
    static int[] parent, rank;
    static List<int[]>[] seg;
    static Deque<int[]> stack = new ArrayDeque<>();
    static int T;
    static Map<Integer, List<int[]>> queryAt = new HashMap<>();
    static boolean[] answer;

    static int find(int x) { while (parent[x] != x) x = parent[x]; return x; }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) { stack.push(new int[]{-1, -1, 0}); return; }
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        int bumped = rank[ra] == rank[rb] ? 1 : 0;
        stack.push(new int[]{rb, ra, bumped});
        parent[rb] = ra;
        if (bumped == 1) rank[ra]++;
    }

    static void rollback() {
        int[] r = stack.pop();
        if (r[0] == -1) return;
        parent[r[0]] = r[0];
        if (r[2] == 1) rank[r[1]]--;
    }

    static void addEdge(int node, int nl, int nr, int l, int r, int u, int v) {
        if (r < nl || nr < l) return;
        if (l <= nl && nr <= r) { seg[node].add(new int[]{u, v}); return; }
        int mid = (nl + nr) / 2;
        addEdge(2 * node, nl, mid, l, r, u, v);
        addEdge(2 * node + 1, mid + 1, nr, l, r, u, v);
    }

    static void dfs(int node, int nl, int nr) {
        int cnt = 0;
        for (int[] e : seg[node]) { union(e[0], e[1]); cnt++; }
        if (nl == nr) {
            for (int[] q : queryAt.getOrDefault(nl, Collections.emptyList()))
                answer[q[2]] = find(q[0]) == find(q[1]);
        } else {
            int mid = (nl + nr) / 2;
            dfs(2 * node, nl, mid);
            dfs(2 * node + 1, mid + 1, nr);
        }
        while (cnt-- > 0) rollback();
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); T = (int) st.nval;
        st.nextToken(); int q = (int) st.nval;
        parent = new int[n]; rank = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        seg = new List[4 * T];
        for (int i = 0; i < 4 * T; i++) seg[i] = new ArrayList<>();
        answer = new boolean[q];
        st.nextToken(); int e = (int) st.nval;
        for (int i = 0; i < e; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            st.nextToken(); int l = (int) st.nval;
            st.nextToken(); int r = (int) st.nval;
            addEdge(1, 0, T - 1, l, r, u, v);
        }
        for (int i = 0; i < q; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            st.nextToken(); int t = (int) st.nval;
            queryAt.computeIfAbsent(t, k -> new ArrayList<>()).add(new int[]{u, v, i});
        }
        dfs(1, 0, T - 1);
        StringBuilder sb = new StringBuilder();
        for (boolean a : answer) sb.append(a ? "YES" : "NO").append('\n');
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys
from sys import setrecursionlimit


def main():
    setrecursionlimit(400000)
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); T = int(data[idx + 1]); q = int(data[idx + 2]); idx += 3
    parent = list(range(n))
    rank = [0] * n
    seg = [[] for _ in range(4 * T)]
    stack = []
    query_at = {}
    answer = [False] * q

    def find(x):  # no compression
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            stack.append(None)
            return
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        bumped = rank[ra] == rank[rb]
        stack.append((rb, ra, bumped))
        parent[rb] = ra
        if bumped:
            rank[ra] += 1

    def rollback():
        rec = stack.pop()
        if rec is None:
            return
        rb, ra, bumped = rec
        parent[rb] = rb
        if bumped:
            rank[ra] -= 1

    def add_edge(node, nl, nr, l, r, u, v):
        if r < nl or nr < l:
            return
        if l <= nl and nr <= r:
            seg[node].append((u, v))
            return
        mid = (nl + nr) // 2
        add_edge(2 * node, nl, mid, l, r, u, v)
        add_edge(2 * node + 1, mid + 1, nr, l, r, u, v)

    def dfs(node, nl, nr):
        cnt = 0
        for u, v in seg[node]:
            union(u, v)
            cnt += 1
        if nl == nr:
            for u, v, qi in query_at.get(nl, []):
                answer[qi] = find(u) == find(v)
        else:
            mid = (nl + nr) // 2
            dfs(2 * node, nl, mid)
            dfs(2 * node + 1, mid + 1, nr)
        for _ in range(cnt):
            rollback()

    e = int(data[idx]); idx += 1
    for _ in range(e):
        u, v, l, r = (int(data[idx]), int(data[idx + 1]),
                      int(data[idx + 2]), int(data[idx + 3])); idx += 4
        add_edge(1, 0, T - 1, l, r, u, v)
    for i in range(q):
        u, v, t = int(data[idx]), int(data[idx + 1]), int(data[idx + 2]); idx += 3
        query_at.setdefault(t, []).append((u, v, i))

    dfs(1, 0, T - 1)
    sys.stdout.write("\n".join("YES" if a else "NO" for a in answer))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct connectivity-at-time answers vs a brute-force per-time reference.
- Compression is omitted; rollback is `O(1)` per union.
- Overall complexity `O((events + queries) log T · log n)`.

---

## Benchmark Task

### Task B — Benchmark the three Find variants across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark that measures the three compression variants (full, halving, splitting) plus a **no-compression baseline**, all paired with union by rank. For each variant:

- Build a DSU on `n` elements.
- Perform a fixed pseudo-random sequence of `m` unions and `m` finds (same seed across languages and variants).
- Measure total wall-clock time.

Run for `n ∈ {10^4, 10^5, 10^6}` with `m = 4n`. Repeat each measurement 5 times and report the mean in milliseconds.

**Input / Output spec.**
- No stdin. Print a fixed table:

```text
n        full_ms   halving_ms   splitting_ms   none_ms
10000    ...       ...          ...            ...
100000   ...       ...          ...            ...
1000000  ...       ...          ...            ...
```

**Constraints.**
- Seed: `42`. Same operation sequence for every variant.
- For the full (recursive) variant at `n = 10^6`, you may need an explicit two-pass version to avoid stack overflow — note which you used.
- Time only the operation loop, not setup.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

type DSU struct {
	parent, rank []int
	find         func(*DSU, int) int
}

func newDSU(n int, find func(*DSU, int) int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{parent: p, rank: make([]int, n), find: find}
}

func findFull(d *DSU, x int) int {
	if d.parent[x] != x {
		d.parent[x] = findFull(d, d.parent[x])
	}
	return d.parent[x]
}

func findHalving(d *DSU, x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}

func findSplitting(d *DSU, x int) int {
	for d.parent[x] != x {
		next := d.parent[x]
		d.parent[x] = d.parent[d.parent[x]]
		x = next
	}
	return x
}

func findNone(d *DSU, x int) int {
	for d.parent[x] != x {
		x = d.parent[x]
	}
	return x
}

func (d *DSU) union(a, b int) {
	ra, rb := d.find(d, a), d.find(d, b)
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

func bench(n int, find func(*DSU, int) int) float64 {
	m := 4 * n
	r := rand.New(rand.NewSource(42))
	ops := make([][2]int, m)
	for i := range ops {
		ops[i] = [2]int{r.Intn(n), r.Intn(n)}
	}
	const reps = 5
	var total time.Duration
	for rep := 0; rep < reps; rep++ {
		d := newDSU(n, find)
		start := time.Now()
		for _, op := range ops {
			d.union(op[0], op[1])
			d.find(d, op[1])
		}
		total += time.Since(start)
	}
	return float64(total.Milliseconds()) / reps
}

func main() {
	fmt.Println("n        full_ms   halving_ms   splitting_ms   none_ms")
	for _, n := range []int{10000, 100000, 1000000} {
		fmt.Printf("%-8d %-9.2f %-12.2f %-14.2f %-8.2f\n",
			n,
			bench(n, findFull),       // may overflow at 1e6; swap for two-pass if so
			bench(n, findHalving),
			bench(n, findSplitting),
			bench(n, findNone))
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.util.function.*;

public class TaskB {
    static int[] parent, rank;

    interface Find { int find(int x); }

    static int findHalving(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static int findSplitting(int x) {
        while (parent[x] != x) { int next = parent[x]; parent[x] = parent[parent[x]]; x = next; }
        return x;
    }

    static int findNone(int x) {
        while (parent[x] != x) x = parent[x];
        return x;
    }

    // two-pass full compression (avoids recursion at 1e6)
    static int findFull(int x) {
        int root = x;
        while (parent[root] != root) root = parent[root];
        while (parent[x] != root) { int next = parent[x]; parent[x] = root; x = next; }
        return root;
    }

    static void union(int a, int b, Find f) {
        int ra = f.find(a), rb = f.find(b);
        if (ra == rb) return;
        if (rank[ra] < rank[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        if (rank[ra] == rank[rb]) rank[ra]++;
    }

    static double bench(int n, Find f) {
        int m = 4 * n;
        Random r = new Random(42);
        int[][] ops = new int[m][2];
        for (int i = 0; i < m; i++) { ops[i][0] = r.nextInt(n); ops[i][1] = r.nextInt(n); }
        int reps = 5;
        long total = 0;
        for (int rep = 0; rep < reps; rep++) {
            parent = new int[n]; rank = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
            long start = System.nanoTime();
            for (int[] op : ops) { union(op[0], op[1], f); f.find(op[1]); }
            total += System.nanoTime() - start;
        }
        return (total / 1e6) / reps;
    }

    public static void main(String[] args) {
        System.out.println("n        full_ms   halving_ms   splitting_ms   none_ms");
        for (int n : new int[]{10_000, 100_000, 1_000_000}) {
            double full = bench(n, TaskB::findFull);
            double half = bench(n, TaskB::findHalving);
            double split = bench(n, TaskB::findSplitting);
            double none = bench(n, TaskB::findNone);
            System.out.printf("%-8d %-9.2f %-12.2f %-14.2f %-8.2f%n", n, full, half, split, none);
        }
    }
}
```

**Starter — Python.**
```python
import random
import sys
import time


def make_dsu(n):
    return list(range(n)), [0] * n


def find_halving(parent, x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def find_splitting(parent, x):
    while parent[x] != x:
        nxt = parent[x]
        parent[x] = parent[parent[x]]
        x = nxt
    return x


def find_none(parent, x):
    while parent[x] != x:
        x = parent[x]
    return x


def find_full(parent, x):  # two-pass, no recursion
    root = x
    while parent[root] != root:
        root = parent[root]
    while parent[x] != root:
        nxt = parent[x]
        parent[x] = root
        x = nxt
    return root


def union(parent, rank, a, b, find):
    ra, rb = find(parent, a), find(parent, b)
    if ra == rb:
        return
    if rank[ra] < rank[rb]:
        ra, rb = rb, ra
    parent[rb] = ra
    if rank[ra] == rank[rb]:
        rank[ra] += 1


def bench(n, find):
    m = 4 * n
    r = random.Random(42)
    ops = [(r.randrange(n), r.randrange(n)) for _ in range(m)]
    reps = 5
    total = 0.0
    for _ in range(reps):
        parent, rank = make_dsu(n)
        start = time.perf_counter()
        for a, b in ops:
            union(parent, rank, a, b, find)
            find(parent, b)
        total += time.perf_counter() - start
    return total / reps * 1000.0


def main():
    sys.setrecursionlimit(2_000_000)
    print("n        full_ms   halving_ms   splitting_ms   none_ms")
    for n in [10_000, 100_000, 1_000_000]:
        full = bench(n, find_full)
        half = bench(n, find_halving)
        split = bench(n, find_splitting)
        none = bench(n, find_none)
        print(f"{n:<8d} {full:<9.2f} {half:<12.2f} {split:<14.2f} {none:<8.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same operation sequence across languages and variants.
- full / halving / splitting are all dramatically faster than `none` as `n` grows (none degrades because, with union by rank only, height is `O(log n)` — so the gap is moderate here; make it stark by also benching a no-rank arbitrary-union baseline).
- full / halving / splitting are within a small constant factor of each other.
- The full (recursive) variant overflows at large `n`; document that you switched to the two-pass version, and explain why.
- Writeup: a short note on which variant was fastest per language and the measured average find-path length after the run.
