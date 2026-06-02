# Union-Find — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Unless a task says otherwise, use the optimized DSU (union by size/rank + path compression). The naive structure is only for Task 1, where the point is to *see* it degrade.

---

## Beginner Tasks (5)

### Task 1 — Implement a naive DSU and observe its worst case

**Problem.** Implement `find` and `union` for a **naive** QuickUnion (no path compression, no union by size). Always link `parent[find(a)] = find(b)`. Then read a sequence of operations and, for every `connected a b` query, print `true`/`false`. Also support a `maxdepth` command that prints the maximum tree depth in the forest, so you can watch the structure degenerate.

**Input / Output spec.**
- Lines: `union a b`, `connected a b`, or `maxdepth`.
- First line is `n` (number of elements, 0-indexed).
- For each `connected`, print `true` or `false`; for `maxdepth`, print an integer.

**Constraints.**
- `1 <= n <= 10^5`.
- Elements are in `[0, n)`.
- This task intentionally has O(n) worst-case operations.

**Hint.** `find` is a `while parent[x] != x` loop. `union` must find both roots first, then `parent[ra] = rb` only if `ra != rb`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type Naive struct{ parent []int }

func NewNaive(n int) *Naive {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &Naive{p}
}
func (d *Naive) Find(x int) int {
	for d.parent[x] != x {
		x = d.parent[x]
	}
	return x
}
func (d *Naive) Union(a, b int) {
	ra, rb := d.Find(a), d.Find(b)
	if ra != rb {
		d.parent[ra] = rb
	}
}
func (d *Naive) Depth(x int) int {
	depth := 0
	for d.parent[x] != x {
		x = d.parent[x]
		depth++
	}
	return depth
}
func (d *Naive) MaxDepth() int {
	best := 0
	for i := range d.parent {
		if dd := d.Depth(i); dd > best {
			best = dd
		}
	}
	return best
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	d := NewNaive(n)
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		switch op {
		case "union":
			var a, b int
			fmt.Fscan(in, &a, &b)
			d.Union(a, b)
		case "connected":
			var a, b int
			fmt.Fscan(in, &a, &b)
			fmt.Fprintln(out, d.Find(a) == d.Find(b))
		case "maxdepth":
			fmt.Fprintln(out, d.MaxDepth())
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int[] parent;

    static int find(int x) { while (parent[x] != x) x = parent[x]; return x; }
    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra != rb) parent[ra] = rb;
    }
    static int depth(int x) { int d = 0; while (parent[x] != x) { x = parent[x]; d++; } return d; }
    static int maxDepth() { int best = 0; for (int i = 0; i < parent.length; i++) best = Math.max(best, depth(i)); return best; }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer tok = new StreamTokenizer(br);
        tok.nextToken(); int n = (int) tok.nval;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        StringBuilder sb = new StringBuilder();
        tok.wordChars('a', 'z');
        while (tok.nextToken() != StreamTokenizer.TT_EOF) {
            String op = tok.sval;
            if (op == null) continue;
            switch (op) {
                case "union" -> { tok.nextToken(); int a = (int) tok.nval; tok.nextToken(); int b = (int) tok.nval; union(a, b); }
                case "connected" -> { tok.nextToken(); int a = (int) tok.nval; tok.nextToken(); int b = (int) tok.nval; sb.append(find(a) == find(b)).append('\n'); }
                case "maxdepth" -> sb.append(maxDepth()).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    it = iter(data)
    n = int(next(it))
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    def depth(x):
        d = 0
        while parent[x] != x:
            x = parent[x]
            d += 1
        return d

    out = []
    for op in it:
        if op == "union":
            union(int(next(it)), int(next(it)))
        elif op == "connected":
            out.append(str(find(int(next(it))) == find(int(next(it)))).lower())
        elif op == "maxdepth":
            out.append(str(max(depth(i) for i in range(n))))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `find` and `union` are correct (link roots only).
- A chained union order (`union 0 1`, `union 1 2`, …) makes `maxdepth` grow linearly — confirm you can observe the degeneration.
- `connected x x` is always `true`.

---

### Task 2 — Optimized DSU: count connected components

**Problem.** Implement DSU with **union by size and path compression**. Read `n` and a list of undirected edges, then print the number of connected components.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `a b`.
- Output: a single integer — the component count.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 10^6`.
- Each operation should be amortized `O(α(n))`.

**Hint.** Start `count = n`; decrement on each effective union (when roots differ).

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type DSU struct {
	parent, size []int
	count        int
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), size: make([]int, n), count: n}
	for i := 0; i < n; i++ {
		d.parent[i] = i
		d.size[i] = 1
	}
	return d
}
func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}
func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.size[ra] < d.size[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	d.size[ra] += d.size[rb]
	d.count--
	return true
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := NewDSU(n)
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		d.Union(a, b)
	}
	fmt.Println(d.count)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    static int[] parent, size;
    static int count;

    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra; size[ra] += size[rb]; count--;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        parent = new int[n]; size = new int[n]; count = n;
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            union(a, b);
        }
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
    parent = list(range(n))
    size = [1] * n
    count = n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for _ in range(m):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]
        count -= 1

    print(count)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct component count on random graphs (validate against a BFS oracle).
- `count` never decremented on a redundant edge.
- Runs within budget for `n, m = 10^6`.

---

### Task 3 — Connectivity queries interleaved with unions

**Problem.** Process a stream that mixes `union a b` and `query a b`. For every `query`, print whether `a` and `b` are currently connected.

**Input / Output spec.**
- Input: `n`, `q`, then `q` lines each `union a b` or `query a b`.
- Output: one `true`/`false` per `query`, in order.

**Constraints.**
- `1 <= n <= 10^5`, `1 <= q <= 10^6`.

**Hint.** This is exactly where DSU beats re-running BFS — answer each query in amortized `O(α(n))`.

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
	var n, q int
	fmt.Fscan(in, &n, &q)
	parent := make([]int, n)
	size := make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for ; q > 0; q-- {
		var op string
		var a, b int
		fmt.Fscan(in, &op, &a, &b)
		if op == "union" {
			ra, rb := find(a), find(b)
			if ra != rb {
				if size[ra] < size[rb] {
					ra, rb = rb, ra
				}
				parent[rb] = ra
				size[ra] += size[rb]
			}
		} else {
			fmt.Fprintln(out, find(a) == find(b))
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    static int[] parent, size;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.wordChars('a', 'z');
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int q = (int) tok.nval;
        parent = new int[n]; size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); String op = tok.sval;
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            if ("union".equals(op)) {
                int ra = find(a), rb = find(b);
                if (ra != rb) {
                    if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
                    parent[rb] = ra; size[ra] += size[rb];
                }
            } else {
                sb.append(find(a) == find(b)).append('\n');
            }
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
    it = iter(data)
    n = int(next(it)); q = int(next(it))
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    out = []
    for _ in range(q):
        op = next(it)
        a = int(next(it)); b = int(next(it))
        if op == b"union":
            ra, rb = find(a), find(b)
            if ra != rb:
                if size[ra] < size[rb]:
                    ra, rb = rb, ra
                parent[rb] = ra
                size[ra] += size[rb]
        else:
            out.append(b"true" if find(a) == find(b) else b"false")
    sys.stdout.write("\n".join(x.decode() for x in out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Every query answered correctly against a reference that rebuilds components by BFS after each union (on small inputs).
- No per-query graph traversal — each query is amortized `O(α(n))`.

---

### Task 4 — Component sizes

**Problem.** After processing all edges, answer size queries: for each query `x`, print the number of elements in `x`'s component.

**Input / Output spec.**
- Input: `n`, `m`, then `m` edges, then `q`, then `q` query nodes.
- Output: one integer per query.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 10^6`, `1 <= q <= 10^6`.

**Hint.** Maintain `size[root]`. Answer is `size[find(x)]`.

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
	parent := make([]int, n)
	size := make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		ra, rb := find(a), find(b)
		if ra != rb {
			if size[ra] < size[rb] {
				ra, rb = rb, ra
			}
			parent[rb] = ra
			size[ra] += size[rb]
		}
	}
	var q int
	fmt.Fscan(in, &q)
	for ; q > 0; q-- {
		var x int
		fmt.Fscan(in, &x)
		fmt.Fprintln(out, size[find(x)])
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static int[] parent, size;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        parent = new int[n]; size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            int ra = find(a), rb = find(b);
            if (ra != rb) {
                if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
                parent[rb] = ra; size[ra] += size[rb];
            }
        }
        tok.nextToken(); int q = (int) tok.nval;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            tok.nextToken(); int x = (int) tok.nval;
            sb.append(size[find(x)]).append('\n');
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
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for _ in range(m):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        ra, rb = find(a), find(b)
        if ra != rb:
            if size[ra] < size[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            size[ra] += size[rb]

    q = int(data[idx]); idx += 1
    out = []
    for _ in range(q):
        x = int(data[idx]); idx += 1
        out.append(str(size[find(x)]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Sizes sum correctly: the sum of distinct component sizes equals `n`.
- A singleton reports size 1.
- `size` is updated only on the surviving root.

---

### Task 5 — Undirected cycle detection

**Problem.** Given an undirected graph as an edge list, report whether it contains any cycle.

**Input / Output spec.**
- Input: `n`, `m`, then `m` edges `a b`.
- Output: `true` if a cycle exists, else `false`.

**Constraints.**
- `1 <= n <= 10^6`, `0 <= m <= 10^6`. No self-loops in input.

**Hint.** Process edges; the first edge whose endpoints are already connected closes a cycle.

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
	parent := make([]int, n)
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
	cycle := false
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		ra, rb := find(a), find(b)
		if ra == rb {
			cycle = true
		} else {
			parent[ra] = rb
		}
	}
	fmt.Println(cycle)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        boolean cycle = false;
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            int ra = find(a), rb = find(b);
            if (ra == rb) cycle = true; else parent[ra] = rb;
        }
        System.out.println(cycle);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    cycle = False
    for _ in range(m):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        ra, rb = find(a), find(b)
        if ra == rb:
            cycle = True
        else:
            parent[ra] = rb
    print(str(cycle).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on a tree (no cycle) and a tree-plus-one-edge (cycle).
- Detects the cycle on the *first* closing edge.
- Duplicate edges between the same pair count as a cycle.

---

## Intermediate Tasks (5)

### Task 6 — Kruskal's Minimum Spanning Tree

**Problem.** Given a connected weighted undirected graph, compute the total weight of its MST using Kruskal's algorithm backed by DSU.

**Input / Output spec.**
- Input: `n`, `m`, then `m` lines `a b w`.
- Output: total MST weight (may need 64-bit).

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, `0 <= w <= 10^9`.
- Graph is connected.

**Hint.** Sort edges by weight; add an edge iff `union` returns true (endpoints in different sets).

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

type Edge struct{ a, b int; w int64 }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	edges := make([]Edge, m)
	for i := range edges {
		fmt.Fscan(in, &edges[i].a, &edges[i].b, &edges[i].w)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].w < edges[j].w })
	parent := make([]int, n)
	size := make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	var total int64
	for _, e := range edges {
		ra, rb := find(e.a), find(e.b)
		if ra == rb {
			continue
		}
		if size[ra] < size[rb] {
			ra, rb = rb, ra
		}
		parent[rb] = ra
		size[ra] += size[rb]
		total += e.w
	}
	fmt.Println(total)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    static int[] parent, size;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        long[][] edges = new long[m][3];
        for (int i = 0; i < m; i++) {
            tok.nextToken(); edges[i][0] = (long) tok.nval;
            tok.nextToken(); edges[i][1] = (long) tok.nval;
            tok.nextToken(); edges[i][2] = (long) tok.nval;
        }
        Arrays.sort(edges, (p, q) -> Long.compare(p[2], q[2]));
        parent = new int[n]; size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        long total = 0;
        for (long[] e : edges) {
            int ra = find((int) e[0]), rb = find((int) e[1]);
            if (ra == rb) continue;
            if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
            parent[rb] = ra; size[ra] += size[rb];
            total += e[2];
        }
        System.out.println(total);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    edges = []
    for _ in range(m):
        a = int(data[idx]); b = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3
        edges.append((w, a, b))
    edges.sort()
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total = 0
    for w, a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]
        total += w
    print(total)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- MST weight matches a Prim's-algorithm reference on random graphs.
- Exactly `n-1` edges are added for a connected graph.
- 64-bit accumulation; sort dominates runtime.

---

### Task 7 — Number of provinces (friend circles)

**Problem.** Given an `n×n` symmetric adjacency matrix `isConnected` where `isConnected[i][j] == 1` means `i` and `j` are directly connected, return the number of provinces (connected components).

**Input / Output spec.**
- Input: `n`, then `n` rows of `n` values (0/1).
- Output: number of provinces.

**Constraints.**
- `1 <= n <= 2000`.

**Hint.** Only union for `i < j` where `isConnected[i][j] == 1`; the diagonal is irrelevant.

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
	g := make([][]int, n)
	for i := range g {
		g[i] = make([]int, n)
		for j := range g[i] {
			fmt.Fscan(in, &g[i][j])
		}
	}
	parent := make([]int, n)
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
	count := n
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if g[i][j] == 1 {
				ra, rb := find(i), find(j)
				if ra != rb {
					parent[ra] = rb
					count--
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

public class Task7 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        int[][] g = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) { tok.nextToken(); g[i][j] = (int) tok.nval; }
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        int count = n;
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (g[i][j] == 1) {
                    int ra = find(i), rb = find(j);
                    if (ra != rb) { parent[ra] = rb; count--; }
                }
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
    g = []
    for _ in range(n):
        row = [int(data[idx + j]) for j in range(n)]
        idx += n
        g.append(row)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    count = n
    for i in range(n):
        for j in range(i + 1, n):
            if g[i][j] == 1:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[ra] = rb
                    count -= 1
    print(count)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a BFS/DFS component count.
- A diagonal of 1s does not affect the answer.
- Correct for the all-disconnected case (`count == n`).

---

### Task 8 — Redundant connection

**Problem.** A tree on `n` nodes (1-indexed) has one extra edge added, creating exactly one cycle. Given the edges in input order, return the edge that closes the cycle (the last such edge in input order).

**Input / Output spec.**
- Input: `n`, then `n` edges `a b` (1-indexed).
- Output: `a b` of the redundant edge.

**Constraints.**
- `3 <= n <= 1000`.

**Hint.** The first edge (scanning in input order) whose endpoints are already connected is the answer.

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
	parent := make([]int, n+1)
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
	ansA, ansB := 0, 0
	for i := 0; i < n; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		ra, rb := find(a), find(b)
		if ra == rb {
			ansA, ansB = a, b
		} else {
			parent[ra] = rb
		}
	}
	fmt.Println(ansA, ansB)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        parent = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        int ansA = 0, ansB = 0;
        for (int i = 0; i < n; i++) {
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            int ra = find(a), rb = find(b);
            if (ra == rb) { ansA = a; ansB = b; }
            else parent[ra] = rb;
        }
        System.out.println(ansA + " " + ansB);
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
    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    ans = (0, 0)
    for _ in range(n):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        ra, rb = find(a), find(b)
        if ra == rb:
            ans = (a, b)
        else:
            parent[ra] = rb
    print(ans[0], ans[1])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- 1-indexed handling correct (`n+1` slots).
- Returns the last cycle-closing edge in input order.
- Works when the redundant edge appears anywhere in the list.

---

### Task 9 — Accounts merge

**Problem.** Given accounts (name + emails), merge accounts sharing any email and output each merged account as `name` followed by sorted emails.

**Input / Output spec.**
- Input: `k`, then `k` accounts; each account is `name c` followed by `c` emails.
- Output: each merged account on its own line: `name email1 email2 ...` (emails sorted). Order of accounts does not matter for grading if you sort lines.

**Constraints.**
- `1 <= k <= 1000`, total emails `<= 10^4`.

**Hint.** Map emails to dense indices; union all emails within one account; group by `find`.

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
	var k int
	fmt.Fscan(in, &k)
	emailID := map[string]int{}
	emailName := map[string]string{}
	var parent []int
	find := func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	id := func(e string) int {
		if v, ok := emailID[e]; ok {
			return v
		}
		v := len(parent)
		emailID[e] = v
		parent = append(parent, v)
		return v
	}
	for i := 0; i < k; i++ {
		var name string
		var c int
		fmt.Fscan(in, &name, &c)
		var first int = -1
		for j := 0; j < c; j++ {
			var e string
			fmt.Fscan(in, &e)
			emailName[e] = name
			cur := id(e)
			if first == -1 {
				first = cur
			} else {
				ra, rb := find(first), find(cur)
				if ra != rb {
					parent[ra] = rb
				}
			}
		}
	}
	groups := map[int][]string{}
	for e, i := range emailID {
		r := find(i)
		groups[r] = append(groups[r], e)
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	lines := []string{}
	for _, emails := range groups {
		sort.Strings(emails)
		line := emailName[emails[0]]
		for _, e := range emails {
			line += " " + e
		}
		lines = append(lines, line)
	}
	sort.Strings(lines)
	for _, l := range lines {
		fmt.Fprintln(out, l)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer tok = new StreamTokenizer(br);
        tok.wordChars('!', '~');
        tok.nextToken(); int k = (int) tok.nval;
        Map<String, Integer> emailId = new HashMap<>();
        Map<String, String> emailName = new HashMap<>();
        List<int[]> unions = new ArrayList<>();
        List<String[]> accs = new ArrayList<>();
        for (int i = 0; i < k; i++) {
            tok.nextToken(); String name = tok.sval;
            tok.nextToken(); int c = (int) tok.nval;
            String[] emails = new String[c];
            for (int j = 0; j < c; j++) { tok.nextToken(); emails[j] = tok.sval; }
            accs.add(name == null ? new String[0] : prepend(name, emails));
        }
        int next = 0;
        for (String[] acc : accs) {
            String name = acc[0];
            int first = -1;
            for (int j = 1; j < acc.length; j++) {
                String e = acc[j];
                emailName.put(e, name);
                if (!emailId.containsKey(e)) emailId.put(e, next++);
                int cur = emailId.get(e);
                if (first == -1) first = cur; else unions.add(new int[]{first, cur});
            }
        }
        parent = new int[next];
        for (int i = 0; i < next; i++) parent[i] = i;
        for (int[] u : unions) {
            int ra = find(u[0]), rb = find(u[1]);
            if (ra != rb) parent[ra] = rb;
        }
        Map<Integer, TreeSet<String>> groups = new HashMap<>();
        for (Map.Entry<String, Integer> en : emailId.entrySet())
            groups.computeIfAbsent(find(en.getValue()), x -> new TreeSet<>()).add(en.getKey());
        List<String> lines = new ArrayList<>();
        for (TreeSet<String> emails : groups.values()) {
            StringBuilder sb = new StringBuilder(emailName.get(emails.first()));
            for (String e : emails) sb.append(' ').append(e);
            lines.add(sb.toString());
        }
        Collections.sort(lines);
        StringBuilder out = new StringBuilder();
        for (String l : lines) out.append(l).append('\n');
        System.out.print(out);
    }

    static String[] prepend(String name, String[] emails) {
        String[] r = new String[emails.length + 1];
        r[0] = name;
        System.arraycopy(emails, 0, r, 1, emails.length);
        return r;
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    it = iter(data)
    k = int(next(it))
    email_id = {}
    email_name = {}
    parent = []

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def get_id(e):
        if e not in email_id:
            email_id[e] = len(parent)
            parent.append(email_id[e])
        return email_id[e]

    for _ in range(k):
        name = next(it)
        c = int(next(it))
        first = -1
        for _ in range(c):
            e = next(it)
            email_name[e] = name
            cur = get_id(e)
            if first == -1:
                first = cur
            else:
                ra, rb = find(first), find(cur)
                if ra != rb:
                    parent[ra] = rb

    groups = {}
    for e, i in email_id.items():
        groups.setdefault(find(i), []).append(e)

    lines = []
    for emails in groups.values():
        emails.sort()
        lines.append(" ".join([email_name[emails[0]]] + emails))
    lines.sort()
    sys.stdout.write("\n".join(lines))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Accounts sharing an email are merged; same-name-no-shared-email stay separate.
- Emails within a group are sorted and de-duplicated.
- "Shares an email" is treated as an equivalence relation.

---

### Task 10 — Number of islands (grid DSU)

**Problem.** Count islands in a grid of `'1'`/`'0'` using DSU (4-directional connectivity).

**Input / Output spec.**
- Input: `rows`, `cols`, then the grid rows (each a string of `0`/`1`).
- Output: number of islands.

**Constraints.**
- `1 <= rows, cols <= 1000`.

**Hint.** Index a cell as `r*cols + c`. Start `count` at the number of land cells; union with up/left land neighbors.

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
	parent := make([]int, rows*cols)
	count := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			idx := r*cols + c
			parent[idx] = idx
			if grid[r][c] == '1' {
				count++
			}
		}
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
		if ra != rb {
			parent[ra] = rb
			count--
		}
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if grid[r][c] != '1' {
				continue
			}
			idx := r*cols + c
			if r > 0 && grid[r-1][c] == '1' {
				union(idx, (r-1)*cols+c)
			}
			if c > 0 && grid[r][c-1] == '1' {
				union(idx, r*cols+c-1)
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

public class Task10 {
    static int[] parent;
    static int count;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    static void union(int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) { parent[ra] = rb; count--; } }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int rows = Integer.parseInt(st.nextToken());
        int cols = Integer.parseInt(st.nextToken());
        String[] grid = new String[rows];
        for (int i = 0; i < rows; i++) grid[i] = br.readLine().trim();
        parent = new int[rows * cols];
        count = 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                int idx = r * cols + c;
                parent[idx] = idx;
                if (grid[r].charAt(c) == '1') count++;
            }
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                if (grid[r].charAt(c) != '1') continue;
                int idx = r * cols + c;
                if (r > 0 && grid[r - 1].charAt(c) == '1') union(idx, (r - 1) * cols + c);
                if (c > 0 && grid[r].charAt(c - 1) == '1') union(idx, r * cols + c - 1);
            }
        System.out.println(count);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    rows = int(data[0]); cols = int(data[1])
    grid = data[2:2 + rows]
    parent = list(range(rows * cols))
    count = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1":
                count += 1

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        nonlocal count
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            count -= 1

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "1":
                continue
            idx = r * cols + c
            if r > 0 and grid[r - 1][c] == "1":
                union(idx, (r - 1) * cols + c)
            if c > 0 and grid[r][c - 1] == "1":
                union(idx, r * cols + c - 1)
    print(count)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a flood-fill (BFS/DFS) island count.
- Only 4-directional adjacency.
- Correct for an all-water and an all-land grid.

---

## Advanced Tasks (5)

### Task 11 — Number of Islands II (online additions)

**Problem.** A grid starts all water. Process a list of positions; each turns a cell to land. After each addition, report the current number of islands. This is the *online* problem where DSU shines.

**Input / Output spec.**
- Input: `rows`, `cols`, `k`, then `k` lines `r c`.
- Output: `k` integers (island count after each addition), space-separated.

**Constraints.**
- `1 <= rows, cols <= 1000`, `1 <= k <= 10^5`.
- Adding an already-land cell does not change the count.

**Hint.** Maintain `count`. On adding a new land cell: `count++`, then union with each of up to 4 already-land neighbors, doing `count--` on each effective union.

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
	var rows, cols, k int
	fmt.Fscan(in, &rows, &cols, &k)
	parent := make([]int, rows*cols)
	land := make([]bool, rows*cols)
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
	count := 0
	dr := []int{-1, 1, 0, 0}
	dc := []int{0, 0, -1, 1}
	res := make([]int, 0, k)
	for i := 0; i < k; i++ {
		var r, c int
		fmt.Fscan(in, &r, &c)
		idx := r*cols + c
		if !land[idx] {
			land[idx] = true
			count++
			for d := 0; d < 4; d++ {
				nr, nc := r+dr[d], c+dc[d]
				if nr < 0 || nr >= rows || nc < 0 || nc >= cols {
					continue
				}
				nidx := nr*cols + nc
				if land[nidx] {
					ra, rb := find(idx), find(nidx)
					if ra != rb {
						parent[ra] = rb
						count--
					}
				}
			}
		}
		res = append(res, count)
	}
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int rows = (int) tok.nval;
        tok.nextToken(); int cols = (int) tok.nval;
        tok.nextToken(); int k = (int) tok.nval;
        parent = new int[rows * cols];
        boolean[] land = new boolean[rows * cols];
        for (int i = 0; i < parent.length; i++) parent[i] = i;
        int count = 0;
        int[] dr = {-1, 1, 0, 0}, dc = {0, 0, -1, 1};
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < k; i++) {
            tok.nextToken(); int r = (int) tok.nval;
            tok.nextToken(); int c = (int) tok.nval;
            int idx = r * cols + c;
            if (!land[idx]) {
                land[idx] = true;
                count++;
                for (int d = 0; d < 4; d++) {
                    int nr = r + dr[d], nc = c + dc[d];
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                    int nidx = nr * cols + nc;
                    if (land[nidx]) {
                        int ra = find(idx), rb = find(nidx);
                        if (ra != rb) { parent[ra] = rb; count--; }
                    }
                }
            }
            if (i > 0) sb.append(' ');
            sb.append(count);
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
    rows = int(data[idx]); cols = int(data[idx + 1]); k = int(data[idx + 2]); idx += 3
    parent = list(range(rows * cols))
    land = [False] * (rows * cols)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    count = 0
    res = []
    dirs = ((-1, 0), (1, 0), (0, -1), (0, 1))
    for _ in range(k):
        r = int(data[idx]); c = int(data[idx + 1]); idx += 2
        cell = r * cols + c
        if not land[cell]:
            land[cell] = True
            count += 1
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    ncell = nr * cols + nc
                    if land[ncell]:
                        ra, rb = find(cell), find(ncell)
                        if ra != rb:
                            parent[ra] = rb
                            count -= 1
        res.append(count)
    sys.stdout.write(" ".join(map(str, res)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output length equals `k`.
- Matches a brute recompute (BFS per step) on small inputs.
- Re-adding a land cell leaves the count unchanged.

---

### Task 12 — Offline reverse-deletion connectivity

**Problem.** You are given a connected-or-not graph and a sequence of operations that only *remove* edges, interleaved with connectivity queries. Since DSU cannot delete, answer the queries **offline**: process the operation stream in reverse so each removal becomes an insertion.

**Input / Output spec.**
- Input: `n`, the initial edge list (`m` edges), then `q` operations: `remove i` (remove the i-th original edge, 1-indexed by original position) or `query a b`.
- Output: one `true`/`false` per query, in the **original** order.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2*10^5`, `1 <= q <= 2*10^5`.
- Each `remove` targets an edge that is currently present.

**Hint.** Determine which edges survive to the end (never removed). Build DSU over surviving edges. Walk operations in reverse: a `remove` becomes a `union` of that edge; a `query` records `connected(a, b)`. Reverse the recorded answers.

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
	var n, m, q int
	fmt.Fscan(in, &n, &m, &q)
	ea := make([]int, m)
	eb := make([]int, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &ea[i], &eb[i])
	}
	type Op struct{ kind, x, y int } // kind 0=remove(edge idx in x), 1=query(x,y)
	ops := make([]Op, q)
	removed := make([]bool, m)
	for i := 0; i < q; i++ {
		var s string
		fmt.Fscan(in, &s)
		if s == "remove" {
			var idx int
			fmt.Fscan(in, &idx)
			ops[i] = Op{0, idx - 1, 0}
			removed[idx-1] = true
		} else {
			var a, b int
			fmt.Fscan(in, &a, &b)
			ops[i] = Op{1, a, b}
		}
	}
	parent := make([]int, n)
	size := make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
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
		if ra != rb {
			if size[ra] < size[rb] {
				ra, rb = rb, ra
			}
			parent[rb] = ra
			size[ra] += size[rb]
		}
	}
	// surviving edges
	for i := 0; i < m; i++ {
		if !removed[i] {
			union(ea[i], eb[i])
		}
	}
	ans := []bool{}
	for i := q - 1; i >= 0; i-- {
		if ops[i].kind == 0 {
			e := ops[i].x
			union(ea[e], eb[e])
		} else {
			ans = append(ans, find(ops[i].x) == find(ops[i].y))
		}
	}
	// ans is in reverse query order; reverse it
	for i, j := 0, len(ans)-1; i < j; i, j = i+1, j-1 {
		ans[i], ans[j] = ans[j], ans[i]
	}
	for _, v := range ans {
		fmt.Fprintln(out, v)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static int[] parent, size;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return;
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra; size[ra] += size[rb];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.wordChars('a', 'z');
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        tok.nextToken(); int q = (int) tok.nval;
        int[] ea = new int[m], eb = new int[m];
        for (int i = 0; i < m; i++) { tok.nextToken(); ea[i] = (int) tok.nval; tok.nextToken(); eb[i] = (int) tok.nval; }
        int[][] ops = new int[q][3]; // [kind, x, y]
        boolean[] removed = new boolean[m];
        for (int i = 0; i < q; i++) {
            tok.nextToken(); String s = tok.sval;
            if ("remove".equals(s)) { tok.nextToken(); int idx = (int) tok.nval - 1; ops[i] = new int[]{0, idx, 0}; removed[idx] = true; }
            else { tok.nextToken(); int a = (int) tok.nval; tok.nextToken(); int b = (int) tok.nval; ops[i] = new int[]{1, a, b}; }
        }
        parent = new int[n]; size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        for (int i = 0; i < m; i++) if (!removed[i]) union(ea[i], eb[i]);
        List<Boolean> ans = new ArrayList<>();
        for (int i = q - 1; i >= 0; i--) {
            if (ops[i][0] == 0) { int e = ops[i][1]; union(ea[e], eb[e]); }
            else ans.add(find(ops[i][1]) == find(ops[i][2]));
        }
        Collections.reverse(ans);
        StringBuilder sb = new StringBuilder();
        for (boolean v : ans) sb.append(v).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    it = iter(data)
    n = int(next(it)); m = int(next(it)); q = int(next(it))
    ea = [0] * m
    eb = [0] * m
    for i in range(m):
        ea[i] = int(next(it)); eb[i] = int(next(it))
    ops = []
    removed = [False] * m
    for _ in range(q):
        s = next(it)
        if s == b"remove":
            idx = int(next(it)) - 1
            ops.append((0, idx, 0))
            removed[idx] = True
        else:
            a = int(next(it)); b = int(next(it))
            ops.append((1, a, b))

    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if size[ra] < size[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        size[ra] += size[rb]

    for i in range(m):
        if not removed[i]:
            union(ea[i], eb[i])

    ans = []
    for kind, x, y in reversed(ops):
        if kind == 0:
            union(ea[x], eb[x])
        else:
            ans.append(find(x) == find(y))
    ans.reverse()
    sys.stdout.write("\n".join("true" if v else "false" for v in ans))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Answers are in original query order.
- Matches a brute reference that rebuilds connectivity (BFS) after each removal, on small inputs.
- Demonstrates the offline reverse trick: removals processed as unions.

---

### Task 13 — Equation satisfiability

**Problem.** Given equations of the form `a==b` and `a!=b` over single-letter variables, determine whether all equations can be satisfied simultaneously.

**Input / Output spec.**
- Input: `k`, then `k` equations as 4-character strings like `a==b` or `a!=b`.
- Output: `true` if satisfiable, else `false`.

**Constraints.**
- `1 <= k <= 10^4`. Variables are lowercase letters `a..z` (26 elements).

**Hint.** First union all `==` pairs. Then check every `!=` pair: if the two variables are in the same set, it is a contradiction.

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
	var k int
	fmt.Fscan(in, &k)
	eqs := make([]string, k)
	for i := range eqs {
		fmt.Fscan(in, &eqs[i])
	}
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
	for _, e := range eqs {
		if e[1] == '=' {
			a, b := int(e[0]-'a'), int(e[3]-'a')
			parent[find(a)] = find(b)
		}
	}
	for _, e := range eqs {
		if e[1] == '!' {
			a, b := int(e[0]-'a'), int(e[3]-'a')
			if find(a) == find(b) {
				fmt.Println(false)
				return
			}
		}
	}
	fmt.Println(true)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int k = Integer.parseInt(br.readLine().trim());
        String[] eqs = new String[k];
        for (int i = 0; i < k; i++) eqs[i] = br.readLine().trim();
        parent = new int[26];
        for (int i = 0; i < 26; i++) parent[i] = i;
        for (String e : eqs)
            if (e.charAt(1) == '=') parent[find(e.charAt(0) - 'a')] = find(e.charAt(3) - 'a');
        for (String e : eqs)
            if (e.charAt(1) == '!' && find(e.charAt(0) - 'a') == find(e.charAt(3) - 'a')) {
                System.out.println(false);
                return;
            }
        System.out.println(true);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    k = int(data[0])
    eqs = data[1:1 + k]
    parent = list(range(26))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in eqs:
        if e[1] == "=":
            parent[find(ord(e[0]) - 97)] = find(ord(e[3]) - 97)
    for e in eqs:
        if e[1] == "!":
            if find(ord(e[0]) - 97) == find(ord(e[3]) - 97):
                print("false")
                return
    print("true")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All `==` processed before any `!=` check.
- A variable comparing equal to itself in a `!=` (`a!=a`) is correctly unsatisfiable.
- Correct on chains like `a==b`, `b==c`, `a!=c` (unsatisfiable).

---

### Task 14 — Largest component by common factor

**Problem.** Given an array of distinct integers, union two numbers if they share a common factor greater than 1. Return the size of the largest resulting component.

**Input / Output spec.**
- Input: `n`, then `n` distinct integers.
- Output: the size of the largest component.

**Constraints.**
- `1 <= n <= 2*10^4`, `1 <= a[i] <= 10^5`.

**Hint.** For each number, union it with each of its prime factors (treated as extra DSU nodes keyed by the factor). Then the component containing a value is determined by `find(value)`. Count occurrences of `find` over the actual array values.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const MAXV = 100001

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	// DSU over node space [0, n) for array indices and [n, n+MAXV) for factors.
	total := n + MAXV
	parent := make([]int, total)
	size := make([]int, total)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(x, y int) {
		rx, ry := find(x), find(y)
		if rx != ry {
			if size[rx] < size[ry] {
				rx, ry = ry, rx
			}
			parent[ry] = rx
			size[rx] += size[ry]
		}
	}
	for i, v := range a {
		x := v
		for p := 2; p*p <= x; p++ {
			if x%p == 0 {
				union(i, n+p)
				for x%p == 0 {
					x /= p
				}
			}
		}
		if x > 1 {
			union(i, n+x)
		}
	}
	best := 0
	cnt := map[int]int{}
	for i := 0; i < n; i++ {
		r := find(i)
		cnt[r]++
		if cnt[r] > best {
			best = cnt[r]
		}
	}
	fmt.Println(best)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    static int[] parent, size;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    static void union(int x, int y) {
        int rx = find(x), ry = find(y);
        if (rx == ry) return;
        if (size[rx] < size[ry]) { int t = rx; rx = ry; ry = t; }
        parent[ry] = rx; size[rx] += size[ry];
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        int[] a = new int[n];
        for (int i = 0; i < n; i++) { tok.nextToken(); a[i] = (int) tok.nval; }
        int MAXV = 100001;
        int total = n + MAXV;
        parent = new int[total]; size = new int[total];
        for (int i = 0; i < total; i++) { parent[i] = i; size[i] = 1; }
        for (int i = 0; i < n; i++) {
            int x = a[i];
            for (int p = 2; (long) p * p <= x; p++) {
                if (x % p == 0) {
                    union(i, n + p);
                    while (x % p == 0) x /= p;
                }
            }
            if (x > 1) union(i, n + x);
        }
        int best = 0;
        HashMap<Integer, Integer> cnt = new HashMap<>();
        for (int i = 0; i < n; i++) {
            int r = find(i);
            int c = cnt.merge(r, 1, Integer::sum);
            best = Math.max(best, c);
        }
        System.out.println(best);
    }
}
```

**Reference — Python.**
```python
import sys
from collections import defaultdict


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    a = [int(data[i + 1]) for i in range(n)]
    MAXV = 100001
    total = n + MAXV
    parent = list(range(total))
    size = [1] * total

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx == ry:
            return
        if size[rx] < size[ry]:
            rx, ry = ry, rx
        parent[ry] = rx
        size[rx] += size[ry]

    for i, v in enumerate(a):
        x = v
        p = 2
        while p * p <= x:
            if x % p == 0:
                union(i, n + p)
                while x % p == 0:
                    x //= p
            p += 1
        if x > 1:
            union(i, n + x)

    best = 0
    cnt = defaultdict(int)
    for i in range(n):
        r = find(i)
        cnt[r] += 1
        best = max(best, cnt[r])
    print(best)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Numbers sharing a prime factor land in the same component.
- A value with no factor > 1 shared (e.g., a unique prime) forms a singleton.
- Largest size matches a brute pairwise-gcd reference on small inputs.

---

### Task 15 — Validate a tree from edges

**Problem.** Given `n` nodes (0-indexed) and an edge list, determine whether the edges form a valid tree: exactly `n-1` edges, connected, and acyclic.

**Input / Output spec.**
- Input: `n`, `m`, then `m` edges `a b`.
- Output: `true` if the edges form a tree, else `false`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** A graph is a tree iff it has exactly `n-1` edges and no cycle (cycle-free is detected when no union ever finds the endpoints already connected). After processing, the component count must be 1.

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
	parent := make([]int, n)
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
	if m != n-1 {
		// consume input then answer
		for i := 0; i < m; i++ {
			var a, b int
			fmt.Fscan(in, &a, &b)
			_ = a
			_ = b
		}
		fmt.Println(false)
		return
	}
	cycle := false
	for i := 0; i < m; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		ra, rb := find(a), find(b)
		if ra == rb {
			cycle = true
		} else {
			parent[ra] = rb
		}
	}
	// exactly n-1 edges + acyclic => connected, hence a tree
	fmt.Println(!cycle)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    static int[] parent;
    static int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    public static void main(String[] args) throws IOException {
        StreamTokenizer tok = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        boolean cycle = false;
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int a = (int) tok.nval;
            tok.nextToken(); int b = (int) tok.nval;
            int ra = find(a), rb = find(b);
            if (ra == rb) cycle = true; else parent[ra] = rb;
        }
        System.out.println(m == n - 1 && !cycle);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); idx += 2
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    cycle = False
    for _ in range(m):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        ra, rb = find(a), find(b)
        if ra == rb:
            cycle = True
        else:
            parent[ra] = rb

    print(str(m == n - 1 and not cycle).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Rejects graphs with `m != n-1`.
- Rejects any graph with a cycle.
- Accepts exactly the connected, acyclic, `n-1`-edge graphs.

---

## Benchmark Task

### Task B — Naive vs optimized DSU across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark that measures two DSU implementations on a worst-case-leaning workload:

- **(a) Naive QuickUnion** — no path compression, no union by size. Always `parent[find(a)] = find(b)`.
- **(b) Optimized DSU** — union by size + path halving.

Generate a "chain-building" union sequence designed to stress the naive version: `union(order[i-1], order[i])` for a shuffled `order`, followed by `m` random `find` calls. Run for `n ∈ {10^4, 10^5, 10^6}` and report mean wall-clock time in milliseconds over 5 runs, with a fixed seed across languages.

**Input / Output spec.**
- No stdin. Output a fixed table:

```text
n         a_naive_ms        b_optimized_ms
10000     ...               ...
100000    ...               ...
1000000   ...               ...
```

**Constraints.**
- Seed: `42`.
- Use the same shuffled union order for both implementations in a given run.
- Time only the union+find workload, not the data generation.

**Reference — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func genOrder(n int, seed int64) []int {
	r := rand.New(rand.NewSource(seed))
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	r.Shuffle(n, func(i, j int) { order[i], order[j] = order[j], order[i] })
	return order
}

func benchNaive(n int, order []int, queries [][2]int) time.Duration {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	find := func(x int) int {
		for parent[x] != x {
			x = parent[x]
		}
		return x
	}
	start := time.Now()
	for i := 1; i < n; i++ {
		ra, rb := find(order[i-1]), find(order[i])
		if ra != rb {
			parent[ra] = rb
		}
	}
	for _, q := range queries {
		_ = find(q[0]) == find(q[1])
	}
	return time.Since(start)
}

func benchOpt(n int, order []int, queries [][2]int) time.Duration {
	parent := make([]int, n)
	size := make([]int, n)
	for i := range parent {
		parent[i] = i
		size[i] = 1
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	start := time.Now()
	for i := 1; i < n; i++ {
		ra, rb := find(order[i-1]), find(order[i])
		if ra != rb {
			if size[ra] < size[rb] {
				ra, rb = rb, ra
			}
			parent[rb] = ra
			size[ra] += size[rb]
		}
	}
	for _, q := range queries {
		_ = find(q[0]) == find(q[1])
	}
	return time.Since(start)
}

func meanMs(d []time.Duration) float64 {
	var s int64
	for _, x := range d {
		s += x.Microseconds()
	}
	return float64(s) / float64(len(d)) / 1000.0
}

func main() {
	sizes := []int{10000, 100000, 1000000}
	fmt.Println("n         a_naive_ms        b_optimized_ms")
	for _, n := range sizes {
		order := genOrder(n, 42)
		r := rand.New(rand.NewSource(7))
		m := n
		queries := make([][2]int, m)
		for i := range queries {
			queries[i] = [2]int{r.Intn(n), r.Intn(n)}
		}
		var ra, rb []time.Duration
		for i := 0; i < 5; i++ {
			ra = append(ra, benchNaive(n, order, queries))
			rb = append(rb, benchOpt(n, order, queries))
		}
		fmt.Printf("%-9d %-17.2f %-17.2f\n", n, meanMs(ra), meanMs(rb))
	}
}
```

**Reference — Java.**
```java
import java.util.*;

public class TaskB {
    static int[] genOrder(int n, long seed) {
        Random r = new Random(seed);
        int[] order = new int[n];
        for (int i = 0; i < n; i++) order[i] = i;
        for (int i = n - 1; i > 0; i--) { int j = r.nextInt(i + 1); int t = order[i]; order[i] = order[j]; order[j] = t; }
        return order;
    }

    static long benchNaive(int n, int[] order, int[][] queries) {
        int[] parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        long start = System.nanoTime();
        for (int i = 1; i < n; i++) {
            int ra = find0(parent, order[i - 1]), rb = find0(parent, order[i]);
            if (ra != rb) parent[ra] = rb;
        }
        for (int[] q : queries) { boolean ignore = find0(parent, q[0]) == find0(parent, q[1]); if (ignore) {} }
        return System.nanoTime() - start;
    }

    static int find0(int[] parent, int x) { while (parent[x] != x) x = parent[x]; return x; }

    static long benchOpt(int n, int[] order, int[][] queries) {
        int[] parent = new int[n], size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        long start = System.nanoTime();
        for (int i = 1; i < n; i++) {
            int ra = find1(parent, order[i - 1]), rb = find1(parent, order[i]);
            if (ra != rb) {
                if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
                parent[rb] = ra; size[ra] += size[rb];
            }
        }
        for (int[] q : queries) { boolean ignore = find1(parent, q[0]) == find1(parent, q[1]); if (ignore) {} }
        return System.nanoTime() - start;
    }

    static int find1(int[] parent, int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

    static double meanMs(long[] ns) { long s = 0; for (long x : ns) s += x; return (s / 1_000_000.0) / ns.length; }

    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        System.out.println("n         a_naive_ms        b_optimized_ms");
        for (int n : sizes) {
            int[] order = genOrder(n, 42L);
            Random r = new Random(7);
            int[][] queries = new int[n][2];
            for (int i = 0; i < n; i++) { queries[i][0] = r.nextInt(n); queries[i][1] = r.nextInt(n); }
            long[] ra = new long[5], rb = new long[5];
            for (int i = 0; i < 5; i++) { ra[i] = benchNaive(n, order, queries); rb[i] = benchOpt(n, order, queries); }
            System.out.printf("%-9d %-17.2f %-17.2f%n", n, meanMs(ra), meanMs(rb));
        }
    }
}
```

**Reference — Python.**
```python
import random
import time


def gen_order(n, seed):
    r = random.Random(seed)
    order = list(range(n))
    r.shuffle(order)
    return order


def bench_naive(n, order, queries):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    start = time.perf_counter()
    for i in range(1, n):
        ra, rb = find(order[i - 1]), find(order[i])
        if ra != rb:
            parent[ra] = rb
    for a, b in queries:
        find(a) == find(b)
    return (time.perf_counter() - start) * 1000.0


def bench_opt(n, order, queries):
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    start = time.perf_counter()
    for i in range(1, n):
        ra, rb = find(order[i - 1]), find(order[i])
        if ra != rb:
            if size[ra] < size[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            size[ra] += size[rb]
    for a, b in queries:
        find(a) == find(b)
    return (time.perf_counter() - start) * 1000.0


def main():
    sizes = [10_000, 100_000, 1_000_000]
    print("n         a_naive_ms        b_optimized_ms")
    for n in sizes:
        order = gen_order(n, 42)
        r = random.Random(7)
        queries = [(r.randrange(n), r.randrange(n)) for _ in range(n)]
        ra = [bench_naive(n, order, queries) for _ in range(5)]
        rb = [bench_opt(n, order, queries) for _ in range(5)]
        print(f"{n:<9d} {sum(ra) / len(ra):<17.2f} {sum(rb) / len(rb):<17.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same union order across languages.
- The optimized version (b) is dramatically faster than naive (a) as `n` grows, since the naive `find` walks long paths while path halving + union by size keep them short.
- Time only the workload, not generation.
- Writeup: a short note on how the gap between (a) and (b) widens with `n`, and which language showed the largest absolute difference.
