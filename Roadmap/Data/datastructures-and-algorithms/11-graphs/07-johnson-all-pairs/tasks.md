# Johnson's Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> The pipeline is always: Bellman-Ford potentials (reject negative cycle) → reweight `w'=w+h(u)-h(v)≥0` → Dijkstra per source → un-reweight `δ=δ'-h(s)+h(v)`.

---

## Beginner Tasks (5)

### Task 1 — Compute the feasible potential vector

**Problem.** Read a directed weighted graph (weights may be negative) and print the feasible potential `h(v)` for every vertex (shortest distance from the implicit super-source). If a negative cycle exists, print `NEGATIVE CYCLE`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: one line with `n` potentials `h[0] … h[n-1]`, or `NEGATIVE CYCLE`.

**Constraints.**
- `1 <= n <= 2000`, `0 <= m <= 10^5`, weights fit in 32-bit (use 64-bit accumulation).

**Hint.** Initialize `h[v] = 0` (implicit super-source). Relax all edges `n` times; if an edge still relaxes on the `n`-th pass, there is a negative cycle.

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
	type E struct{ u, v int; w int64 }
	es := make([]E, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &es[i].u, &es[i].v, &es[i].w)
	}
	h := make([]int64, n)
	for it := 0; it <= n; it++ {
		changed := false
		for _, e := range es {
			if h[e.u]+e.w < h[e.v] {
				h[e.v] = h[e.u] + e.w
				changed = true
				if it == n {
					fmt.Fprintln(out, "NEGATIVE CYCLE")
					return
				}
			}
		}
		if !changed {
			break
		}
	}
	for i, v := range h {
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

public class Task1 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[][] es = new int[m][3];
        for (int i = 0; i < m; i++) {
            in.nextToken(); es[i][0] = (int) in.nval;
            in.nextToken(); es[i][1] = (int) in.nval;
            in.nextToken(); es[i][2] = (int) in.nval;
        }
        long[] h = new long[n];
        for (int it = 0; it <= n; it++) {
            boolean changed = false;
            for (int[] e : es)
                if (h[e[0]] + e[2] < h[e[1]]) {
                    h[e[1]] = h[e[0]] + e[2];
                    changed = true;
                    if (it == n) { System.out.println("NEGATIVE CYCLE"); return; }
                }
            if (!changed) break;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(h[i]); }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    es = [(int(next(data)), int(next(data)), int(next(data))) for _ in range(m)]
    h = [0] * n
    for it in range(n + 1):
        changed = False
        for u, v, w in es:
            if h[u] + w < h[v]:
                h[v] = h[u] + w
                changed = True
                if it == n:
                    print("NEGATIVE CYCLE")
                    return
        if not changed:
            break
    print(" ".join(map(str, h)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Uses the implicit super-source (`h[v]=0`).
- Detects a negative cycle via the `n`-th pass.
- No overflow on repeated negative relaxations.

---

### Task 2 — Reweight the edges and verify non-negativity

**Problem.** Given a graph and a precomputed potential `h`, print the reweighted edge list `u v w'` where `w' = w + h(u) - h(v)`, and confirm every `w' >= 0` by printing `OK` or `INFEASIBLE` on the last line.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`, then a line with `n` potentials.
- Output: `m` lines `u v w'`, then `OK` or `INFEASIBLE`.

**Constraints.**
- `1 <= n <= 2000`, `0 <= m <= 10^5`.

**Hint.** Just apply the formula per edge and track whether any reweighted weight is negative.

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
	type E struct{ u, v, w int }
	es := make([]E, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &es[i].u, &es[i].v, &es[i].w)
	}
	h := make([]int, n)
	for i := 0; i < n; i++ {
		fmt.Fscan(in, &h[i])
	}
	ok := true
	for _, e := range es {
		rw := e.w + h[e.u] - h[e.v]
		if rw < 0 {
			ok = false
		}
		fmt.Fprintln(out, e.u, e.v, rw)
	}
	if ok {
		fmt.Fprintln(out, "OK")
	} else {
		fmt.Fprintln(out, "INFEASIBLE")
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[][] es = new int[m][3];
        for (int i = 0; i < m; i++)
            for (int k = 0; k < 3; k++) { in.nextToken(); es[i][k] = (int) in.nval; }
        int[] h = new int[n];
        for (int i = 0; i < n; i++) { in.nextToken(); h[i] = (int) in.nval; }
        StringBuilder sb = new StringBuilder();
        boolean ok = true;
        for (int[] e : es) {
            int rw = e[2] + h[e[0]] - h[e[1]];
            if (rw < 0) ok = false;
            sb.append(e[0]).append(' ').append(e[1]).append(' ').append(rw).append('\n');
        }
        sb.append(ok ? "OK" : "INFEASIBLE");
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    es = [(int(next(data)), int(next(data)), int(next(data))) for _ in range(m)]
    h = [int(next(data)) for _ in range(n)]
    ok = True
    out = []
    for u, v, w in es:
        rw = w + h[u] - h[v]
        if rw < 0:
            ok = False
        out.append(f"{u} {v} {rw}")
    out.append("OK" if ok else "INFEASIBLE")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct reweighting formula `w + h[u] - h[v]`.
- Flags `INFEASIBLE` if any `w' < 0` (i.e. `h` is not feasible).

---

### Task 3 — Single-source shortest paths with negative edges via reweighting

**Problem.** Given a graph with negative edges (no negative cycle) and a source `s`, compute shortest distances from `s` using the Johnson reweighting + Dijkstra approach (not Bellman-Ford alone).

**Input / Output spec.**
- Input: `n m s`, then `m` lines `u v w`.
- Output: `n` distances from `s` (`INF` for unreachable).

**Constraints.**
- `1 <= n <= 10^4`, `0 <= m <= 10^5`.

**Hint.** Compute potentials, reweight, run **one** Dijkstra from `s`, then un-reweight with `δ(s,v)=δ'(s,v)-h(s)+h(v)`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

const INF = int64(1) << 60

type edge struct{ to int; w int64 }
type hi struct{ node int; d int64 }
type mh []hi

func (h mh) Len() int            { return len(h) }
func (h mh) Less(a, b int) bool  { return h[a].d < h[b].d }
func (h mh) Swap(a, b int)       { h[a], h[b] = h[b], h[a] }
func (h *mh) Push(x interface{}) { *h = append(*h, x.(hi)) }
func (h *mh) Pop() interface{}   { o := *h; k := len(o); x := o[k-1]; *h = o[:k-1]; return x }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m, s int
	fmt.Fscan(in, &n, &m, &s)
	adj := make([][]edge, n)
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], edge{v, w})
	}
	pot := make([]int64, n)
	for it := 0; it <= n; it++ {
		for u := 0; u < n; u++ {
			for _, e := range adj[u] {
				if pot[u]+e.w < pot[e.to] {
					pot[e.to] = pot[u] + e.w
				}
			}
		}
	}
	radj := make([][]edge, n)
	for u := 0; u < n; u++ {
		for _, e := range adj[u] {
			radj[u] = append(radj[u], edge{e.to, e.w + pot[u] - pot[e.to]})
		}
	}
	d := make([]int64, n)
	for i := range d {
		d[i] = INF
	}
	d[s] = 0
	pq := &mh{{s, 0}}
	for pq.Len() > 0 {
		x := heap.Pop(pq).(hi)
		if x.d > d[x.node] {
			continue
		}
		for _, e := range radj[x.node] {
			if d[x.node]+e.w < d[e.to] {
				d[e.to] = d[x.node] + e.w
				heap.Push(pq, hi{e.to, d[e.to]})
			}
		}
	}
	for v := 0; v < n; v++ {
		if v > 0 {
			out.WriteByte(' ')
		}
		if d[v] >= INF {
			fmt.Fprint(out, "INF")
		} else {
			fmt.Fprint(out, d[v]-pot[s]+pot[v])
		}
	}
	out.WriteByte('\n')
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        in.nextToken(); int s = (int) in.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            adj[u].add(new long[]{v, w});
        }
        long[] pot = new long[n];
        for (int it = 0; it <= n; it++)
            for (int u = 0; u < n; u++)
                for (long[] e : adj[u])
                    if (pot[u] + e[1] < pot[(int) e[0]]) pot[(int) e[0]] = pot[u] + e[1];
        List<long[]>[] radj = new List[n];
        for (int u = 0; u < n; u++) {
            radj[u] = new ArrayList<>();
            for (long[] e : adj[u]) radj[u].add(new long[]{e[0], e[1] + pot[u] - pot[(int) e[0]]});
        }
        long[] d = new long[n];
        Arrays.fill(d, INF);
        d[s] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        pq.add(new long[]{s, 0});
        while (!pq.isEmpty()) {
            long[] c = pq.poll();
            int u = (int) c[0];
            if (c[1] > d[u]) continue;
            for (long[] e : radj[u]) {
                int v = (int) e[0];
                if (d[u] + e[1] < d[v]) { d[v] = d[u] + e[1]; pq.add(new long[]{v, d[v]}); }
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int v = 0; v < n; v++) {
            if (v > 0) sb.append(' ');
            sb.append(d[v] >= INF ? "INF" : Long.toString(d[v] - pot[s] + pot[v]));
        }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys, heapq


def main():
    data = iter(sys.stdin.read().split())
    n, m, s = int(next(data)), int(next(data)), int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        adj[u].append((v, w))
    pot = [0] * n
    for _ in range(n + 1):
        for u in range(n):
            for v, w in adj[u]:
                if pot[u] + w < pot[v]:
                    pot[v] = pot[u] + w
    radj = [[(v, w + pot[u] - pot[v]) for v, w in adj[u]] for u in range(n)]
    INF = float("inf")
    d = [INF] * n
    d[s] = 0
    pq = [(0, s)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > d[u]:
            continue
        for v, w in radj[u]:
            if du + w < d[v]:
                d[v] = du + w
                heapq.heappush(pq, (d[v], v))
    out = []
    for v in range(n):
        out.append("INF" if d[v] == INF else str(d[v] - pot[s] + pot[v]))
    sys.stdout.write(" ".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Uses Dijkstra on the reweighted graph (not Bellman-Ford alone).
- Correctly un-reweights every finite distance.
- Matches Bellman-Ford on small inputs.

---

### Task 4 — Detect whether Johnson's is applicable

**Problem.** Given a graph, print `JOHNSON` if Johnson's can run (no negative cycle), or `REJECT` if a negative cycle makes APSP undefined.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: `JOHNSON` or `REJECT`.

**Constraints.**
- `1 <= n <= 2000`, `0 <= m <= 10^5`.

**Hint.** Run the Bellman-Ford detection pass; that is the only thing that gates Johnson's applicability.

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
	type E struct{ u, v int; w int64 }
	es := make([]E, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &es[i].u, &es[i].v, &es[i].w)
	}
	h := make([]int64, n)
	neg := false
	for it := 0; it <= n && !neg; it++ {
		for _, e := range es {
			if h[e.u]+e.w < h[e.v] {
				h[e.v] = h[e.u] + e.w
				if it == n {
					neg = true
				}
			}
		}
	}
	if neg {
		fmt.Println("REJECT")
	} else {
		fmt.Println("JOHNSON")
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[][] es = new int[m][3];
        for (int i = 0; i < m; i++)
            for (int k = 0; k < 3; k++) { in.nextToken(); es[i][k] = (int) in.nval; }
        long[] h = new long[n];
        boolean neg = false;
        for (int it = 0; it <= n && !neg; it++)
            for (int[] e : es)
                if (h[e[0]] + e[2] < h[e[1]]) {
                    h[e[1]] = h[e[0]] + e[2];
                    if (it == n) neg = true;
                }
        System.out.println(neg ? "REJECT" : "JOHNSON");
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    es = [(int(next(data)), int(next(data)), int(next(data))) for _ in range(m)]
    h = [0] * n
    neg = False
    for it in range(n + 1):
        if neg:
            break
        for u, v, w in es:
            if h[u] + w < h[v]:
                h[v] = h[u] + w
                if it == n:
                    neg = True
    print("REJECT" if neg else "JOHNSON")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- A negative *edge* without a negative cycle returns `JOHNSON`.
- A negative cycle returns `REJECT`.

---

### Task 5 — Full all-pairs distance matrix via Johnson's

**Problem.** Output the full all-pairs shortest-distance matrix for a sparse directed graph with negative edges. Print `INF` for unreachable pairs; print `NEGATIVE CYCLE` and stop if one exists.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: `n × n` matrix or `NEGATIVE CYCLE`.

**Constraints.**
- `1 <= n <= 500`, `0 <= m <= 10^4`.

**Hint.** Run the full pipeline: potentials → reweight → Dijkstra from each source → un-reweight each row.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

const INF = int64(1) << 60

type edge struct{ to int; w int64 }
type hi struct{ node int; d int64 }
type mh []hi

func (h mh) Len() int            { return len(h) }
func (h mh) Less(a, b int) bool  { return h[a].d < h[b].d }
func (h mh) Swap(a, b int)       { h[a], h[b] = h[b], h[a] }
func (h *mh) Push(x interface{}) { *h = append(*h, x.(hi)) }
func (h *mh) Pop() interface{}   { o := *h; k := len(o); x := o[k-1]; *h = o[:k-1]; return x }

func dijkstra(n int, radj [][]edge, s int) []int64 {
	d := make([]int64, n)
	for i := range d {
		d[i] = INF
	}
	d[s] = 0
	pq := &mh{{s, 0}}
	for pq.Len() > 0 {
		x := heap.Pop(pq).(hi)
		if x.d > d[x.node] {
			continue
		}
		for _, e := range radj[x.node] {
			if d[x.node]+e.w < d[e.to] {
				d[e.to] = d[x.node] + e.w
				heap.Push(pq, hi{e.to, d[e.to]})
			}
		}
	}
	return d
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]edge, n)
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], edge{v, w})
	}
	pot := make([]int64, n)
	for it := 0; it <= n; it++ {
		changed := false
		for u := 0; u < n; u++ {
			for _, e := range adj[u] {
				if pot[u]+e.w < pot[e.to] {
					pot[e.to] = pot[u] + e.w
					changed = true
					if it == n {
						fmt.Fprintln(out, "NEGATIVE CYCLE")
						return
					}
				}
			}
		}
		if !changed {
			break
		}
	}
	radj := make([][]edge, n)
	for u := 0; u < n; u++ {
		for _, e := range adj[u] {
			radj[u] = append(radj[u], edge{e.to, e.w + pot[u] - pot[e.to]})
		}
	}
	for s := 0; s < n; s++ {
		d := dijkstra(n, radj, s)
		for v := 0; v < n; v++ {
			if v > 0 {
				out.WriteByte(' ')
			}
			if d[v] >= INF {
				fmt.Fprint(out, "INF")
			} else {
				fmt.Fprint(out, d[v]-pot[s]+pot[v])
			}
		}
		out.WriteByte('\n')
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    static final long INF = 1L << 60;

    static long[] dijkstra(int n, List<long[]>[] radj, int s) {
        long[] d = new long[n];
        Arrays.fill(d, INF);
        d[s] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[1], b[1]));
        pq.add(new long[]{s, 0});
        while (!pq.isEmpty()) {
            long[] c = pq.poll();
            int u = (int) c[0];
            if (c[1] > d[u]) continue;
            for (long[] e : radj[u]) {
                int v = (int) e[0];
                if (d[u] + e[1] < d[v]) { d[v] = d[u] + e[1]; pq.add(new long[]{v, d[v]}); }
            }
        }
        return d;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            adj[u].add(new long[]{v, w});
        }
        long[] pot = new long[n];
        for (int it = 0; it <= n; it++) {
            boolean changed = false;
            for (int u = 0; u < n; u++)
                for (long[] e : adj[u])
                    if (pot[u] + e[1] < pot[(int) e[0]]) {
                        pot[(int) e[0]] = pot[u] + e[1];
                        changed = true;
                        if (it == n) { System.out.println("NEGATIVE CYCLE"); return; }
                    }
            if (!changed) break;
        }
        List<long[]>[] radj = new List[n];
        for (int u = 0; u < n; u++) {
            radj[u] = new ArrayList<>();
            for (long[] e : adj[u]) radj[u].add(new long[]{e[0], e[1] + pot[u] - pot[(int) e[0]]});
        }
        StringBuilder sb = new StringBuilder();
        for (int s = 0; s < n; s++) {
            long[] d = dijkstra(n, radj, s);
            for (int v = 0; v < n; v++) {
                if (v > 0) sb.append(' ');
                sb.append(d[v] >= INF ? "INF" : Long.toString(d[v] - pot[s] + pot[v]));
            }
            sb.append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys, heapq


def dijkstra(n, radj, s):
    INF = float("inf")
    d = [INF] * n
    d[s] = 0
    pq = [(0, s)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > d[u]:
            continue
        for v, w in radj[u]:
            if du + w < d[v]:
                d[v] = du + w
                heapq.heappush(pq, (d[v], v))
    return d


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        adj[u].append((v, w))
    pot = [0] * n
    for it in range(n + 1):
        changed = False
        for u in range(n):
            for v, w in adj[u]:
                if pot[u] + w < pot[v]:
                    pot[v] = pot[u] + w
                    changed = True
                    if it == n:
                        print("NEGATIVE CYCLE")
                        return
        if not changed:
            break
    radj = [[(v, w + pot[u] - pot[v]) for v, w in adj[u]] for u in range(n)]
    INF = float("inf")
    out = []
    for s in range(n):
        d = dijkstra(n, radj, s)
        out.append(" ".join("INF" if d[v] == INF else str(d[v] - pot[s] + pot[v])
                            for v in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Full pipeline correct; matrix matches Floyd-Warshall on small inputs.
- Negative cycle detected and reported.
- Unreachable pairs print `INF`.

---

## Intermediate Tasks (5)

### Task 6 — Compare Johnson's vs Floyd-Warshall outputs

**Problem.** Run both Johnson's and Floyd-Warshall on the same graph and print `MATCH` if their distance matrices agree on every reachable pair, else `MISMATCH`. (A correctness cross-check.)

**Constraints.** `1 <= n <= 300`, no negative cycle. Provide starter code in all 3 languages.

**Hint.** Implement both; compare cell by cell, treating both `INF` sentinels as equal.

---

### Task 7 — On-demand Johnson's service (potentials cached)

**Problem.** Build a service that computes potentials once, then answers `q` single-source queries, each printing the distance row from the queried source. Each query should run only one Dijkstra.

**Constraints.** `1 <= n <= 10^4`, `1 <= q <= 10^3`. Provide starter code in all 3 languages.

**Hint.** Compute `h` and the reweighted graph in the constructor; per query run Dijkstra on the reweighted graph and un-reweight that row.

---

### Task 8 — Parallel Dijkstra fan-out

**Problem.** Compute the full matrix but parallelize the `V` Dijkstra runs across worker threads/goroutines. Verify the parallel result equals the sequential one.

**Constraints.** `1 <= n <= 2000`, sparse. Provide starter code in all 3 languages.

**Hint.** Each Dijkstra writes a disjoint output row from a read-only reweighted graph — no locks needed; just fork-join over sources.

---

### Task 9 — Path reconstruction under Johnson's

**Problem.** For a query `(s, t)`, print the actual shortest path (vertex sequence) and its true cost, using the reweighted Dijkstra plus a predecessor array. Print `NO PATH` if unreachable.

**Constraints.** `1 <= n <= 5000`, sparse. Provide starter code in all 3 languages.

**Hint.** Track `prev[]` during the reweighted Dijkstra; the *route* is identical under reweighting, so reconstruction works directly. Report the un-reweighted cost.

---

### Task 10 — Currency arbitrage check via reweighting

**Problem.** Given exchange rates, build a graph with weights `-log(rate)`. Use the Bellman-Ford potential pass to report whether an arbitrage cycle exists (a negative cycle), and if not, print the best conversion rate between two given currencies.

**Constraints.** `1 <= n <= 500`. Provide starter code in all 3 languages.

**Hint.** Negative cycle in `-log` weights = arbitrage. If none, run Johnson's and convert the shortest `-log` distance back via `exp(-δ)` for the best rate.

---

## Advanced Tasks (5)

### Task 11 — Incremental potentials (min-cost-flow style)

**Problem.** Implement repeated single-source shortest-path queries on a graph that mutates slightly between queries, maintaining a feasible potential incrementally (`h(v) += δ'(s,v)`) so each query uses Dijkstra, not Bellman-Ford.

**Constraints.** `1 <= n <= 10^4`. Provide starter code in all 3 languages.

**Hint.** After each reduced-cost Dijkstra, update `h[v] += d'[v]` (for reachable `v`); reduced costs stay non-negative for the next query.

---

### Task 12 — Min-cost max-flow using Johnson reweighting

**Problem.** Implement successive-shortest-paths min-cost max-flow where the first augmenting path uses Bellman-Ford (to set up potentials) and all subsequent paths use Dijkstra on reduced costs.

**Constraints.** Small graphs (`n <= 200`). Provide starter code in all 3 languages.

**Hint.** Residual back-edges have negative cost; Johnson potentials keep reduced costs non-negative so Dijkstra finds each min-cost augmenting path.

---

### Task 13 — Distributed (sharded) fan-out

**Problem.** Simulate sharding the `V` Dijkstra runs across `k` "workers" (e.g. `k` goroutines/threads each owning a source range). Reassemble the full matrix and verify correctness. Measure load imbalance (max vs min worker time).

**Constraints.** `1 <= n <= 5000`, sparse. Provide starter code in all 3 languages.

**Hint.** Each worker holds a read-only copy of the reweighted graph and computes its assigned rows; no cross-worker communication during the fan-out.

---

### Task 14 — Johnson's with a Fibonacci-heap-style priority queue analysis

**Problem.** Implement Johnson's with a decrease-key-capable priority queue (or simulate the decrease-key behavior) and empirically compare the number of heap operations against the binary-heap version on graphs of varying density.

**Constraints.** `1 <= n <= 2000`. Provide starter code in all 3 languages.

**Hint.** Track push/pop/decrease-key counts; the Fibonacci-heap analysis predicts `O(E + V log V)` per Dijkstra vs `O(E log V)` for the binary heap.

---

### Task 15 — Negative-cycle-affected pairs after rejection

**Problem.** When a negative cycle exists, do not just reject — identify which *pairs* `(i, j)` have undefined (`-∞`) shortest paths (those routable through a negative-cycle vertex). Print the affected-pair matrix.

**Constraints.** `1 <= n <= 400`. Provide starter code in all 3 languages.

**Hint.** Detect cycle vertices via Bellman-Ford, then propagate `-∞` to every pair `(i,j)` reachable through a negative-cycle vertex (a reachability pass on the original graph).

---

## Benchmark Task

> Compare Johnson's against Floyd-Warshall across graph densities in all 3 languages. Johnson's should win on sparse graphs; Floyd-Warshall on dense.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []struct{ n, m int }{{200, 400}, {500, 1500}, {1000, 3000}, {1000, 200000}}
	for _, sz := range sizes {
		edges := make([][3]int, sz.m)
		for i := range edges {
			edges[i] = [3]int{rand.Intn(sz.n), rand.Intn(sz.n), rand.Intn(20) - 5}
		}
		start := time.Now()
		// johnson(sz.n, edges)   // plug in your implementation
		_ = edges
		fmt.Printf("n=%d m=%d: %v\n", sz.n, sz.m, time.Since(start))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[][] sizes = {{200, 400}, {500, 1500}, {1000, 3000}, {1000, 200000}};
        Random rng = new Random();
        for (int[] sz : sizes) {
            int[][] edges = new int[sz[1]][3];
            for (int[] e : edges) {
                e[0] = rng.nextInt(sz[0]); e[1] = rng.nextInt(sz[0]); e[2] = rng.nextInt(20) - 5;
            }
            long start = System.nanoTime();
            // Johnson.johnson(sz[0], edges);  // plug in
            System.out.printf("n=%d m=%d: %.2f ms%n",
                sz[0], sz[1], (System.nanoTime() - start) / 1e6);
        }
    }
}
```

#### Python

```python
import random, time

sizes = [(200, 400), (500, 1500), (1000, 3000), (1000, 200000)]
for n, m in sizes:
    edges = [(random.randrange(n), random.randrange(n), random.randint(-5, 14)) for _ in range(m)]
    start = time.perf_counter()
    # johnson(n, edges)   # plug in your implementation
    print(f"n={n} m={m}: {(time.perf_counter() - start) * 1000:.2f} ms")
```

> Expected: Johnson's stays cheap as `m` grows slowly with `n` (sparse); on the dense `(1000, 200000)` case Floyd-Warshall's `O(V³)` becomes competitive or better.
