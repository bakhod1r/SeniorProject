# Floyd-Warshall Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages. The loop order is always `k, i, j` — `k` outermost.

---

## Beginner Tasks (5)

### Task 1 — Basic all-pairs distance matrix

**Problem.** Read a weighted directed graph and print the all-pairs shortest distance matrix. Print `INF` for unreachable pairs.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w` (directed edge).
- Output: an `n × n` matrix; each cell is the shortest distance or `INF`.

**Constraints.**
- `1 <= n <= 400`, `0 <= m <= n*(n-1)`.
- Weights are non-negative for this task; `0 <= w <= 10^6`.
- Time `O(n³)`, space `O(n²)`.

**Hint.** Initialize the diagonal to 0, edges to their weights, the rest to a large `INF` (use `INF = MAX/4` to avoid overflow). Run the triple loop with `k` outermost.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i == j {
				d[i][j] = 0
			} else {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if j > 0 {
				out.WriteByte(' ')
			}
			if d[i][j] >= INF {
				fmt.Fprint(out, "INF")
			} else {
				fmt.Fprint(out, d[i][j])
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

public class Task1 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(d[i][j] >= INF ? "INF" : Long.toString(d[i][j]));
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik >= INF:
                continue
            di = d[i]
            for j in range(n):
                if dik + dk[j] < di[j]:
                    di[j] = dik + dk[j]
    out = []
    for i in range(n):
        out.append(" ".join("INF" if d[i][j] >= INF else str(d[i][j]) for j in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Loop order is `k, i, j`.
- Unreachable pairs print `INF`, not a wrapped negative number.
- Runs in `O(n³)`.

---

### Task 2 — Transitive closure (reachability)

**Problem.** Given a directed graph, output the `n × n` boolean reachability matrix: `1` if `j` is reachable from `i` (including `i` itself), else `0`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `n` lines of `n` characters each (`0`/`1`).

**Constraints.**
- `1 <= n <= 1000`.
- Time `O(n³)` (or `O(n³/64)` with bitsets for full marks).

**Hint.** Use the `(OR, AND)` semiring: `reach[i][j] = reach[i][j] OR (reach[i][k] AND reach[k][j])`. Skip the row when `reach[i][k]` is false.

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
	reach := make([][]bool, n)
	for i := range reach {
		reach[i] = make([]bool, n)
		reach[i][i] = true
	}
	for ; m > 0; m-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		reach[u][v] = true
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if !reach[i][k] {
				continue
			}
			for j := 0; j < n; j++ {
				if reach[k][j] {
					reach[i][j] = true
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		row := make([]byte, n)
		for j := 0; j < n; j++ {
			if reach[i][j] {
				row[j] = '1'
			} else {
				row[j] = '0'
			}
		}
		out.Write(row)
		out.WriteByte('\n')
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
        boolean[][] reach = new boolean[n][n];
        for (int i = 0; i < n; i++) reach[i][i] = true;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            reach[u][v] = true;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (!reach[i][k]) continue;
                for (int j = 0; j < n; j++)
                    if (reach[k][j]) reach[i][j] = true;
            }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) sb.append(reach[i][j] ? '1' : '0');
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    # bitset rows for speed: row i is an int with bit j set if i reaches j
    reach = [1 << i for i in range(n)]
    for _ in range(m):
        u, v = int(next(data)), int(next(data))
        reach[u] |= 1 << v
    for k in range(n):
        bit_k = 1 << k
        rk = reach[k]
        for i in range(n):
            if reach[i] & bit_k:
                reach[i] |= rk
    out = []
    for i in range(n):
        out.append("".join("1" if reach[i] >> j & 1 else "0" for j in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Every vertex reaches itself.
- Indirect reachability is captured (e.g. `0→1→2` makes `reach[0][2]` true).
- Bonus: bitset implementation for `O(n³/64)`.

---

### Task 3 — Detect a negative cycle

**Problem.** Given a directed weighted graph (weights may be negative), report whether it contains a negative-weight cycle.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: `YES` if a negative cycle exists, else `NO`.

**Constraints.**
- `1 <= n <= 400`, weights fit in 32-bit; use 64-bit accumulation.

**Hint.** Run Floyd-Warshall, then scan the diagonal: if any `dist[i][i] < 0`, a negative cycle exists. Guard against `INF + INF` overflow.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[k][j] < INF && d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	neg := false
	for i := 0; i < n; i++ {
		if d[i][i] < 0 {
			neg = true
			break
		}
	}
	if neg {
		fmt.Println("YES")
	} else {
		fmt.Println("NO")
	}
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
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[k][j] < INF && d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        boolean neg = false;
        for (int i = 0; i < n; i++) if (d[i][i] < 0) { neg = true; break; }
        System.out.println(neg ? "YES" : "NO");
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik >= INF:
                continue
            di = d[i]
            for j in range(n):
                if dk[j] < INF and dik + dk[j] < di[j]:
                    di[j] = dik + dk[j]
    print("YES" if any(d[i][i] < 0 for i in range(n)) else "NO")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correctly flags a graph with a negative cycle.
- A negative *edge* without a negative cycle returns `NO`.
- No INF overflow (guarded relaxation).

---

### Task 4 — Single-pair query after one precompute

**Problem.** Build the all-pairs matrix once, then answer `q` queries `(u, v)` in `O(1)` each, printing the distance or `INF`.

**Input / Output spec.**
- Input: `n m`, `m` edges `u v w`, then `q`, then `q` lines `u v`.
- Output: `q` lines, each a distance or `INF`.

**Constraints.**
- `1 <= n <= 400`, `1 <= q <= 10^6`. Non-negative weights.

**Hint.** The whole point: precompute `O(n³)` once, then each query is a single matrix read.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	var q int
	fmt.Fscan(in, &q)
	for ; q > 0; q-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		if d[u][v] >= INF {
			fmt.Fprintln(out, "INF")
		} else {
			fmt.Fprintln(out, d[u][v])
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        for (int e = 0; e < q; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            sb.append(d[u][v] >= INF ? "INF" : Long.toString(d[u][v])).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.buffer.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik >= INF:
                continue
            di = d[i]
            for j in range(n):
                if dik + dk[j] < di[j]:
                    di[j] = dik + dk[j]
    q = int(next(data))
    out = []
    for _ in range(q):
        u, v = int(next(data)), int(next(data))
        out.append("INF" if d[u][v] >= INF else str(d[u][v]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Precompute runs exactly once.
- Each query is `O(1)`.
- Fast I/O for up to `10^6` queries.

---

### Task 5 — Path reconstruction with a `next` matrix

**Problem.** Build the all-pairs matrix plus a `next` matrix, then for a query `(u, v)` print the actual shortest path as a vertex sequence (or `NO PATH`).

**Input / Output spec.**
- Input: `n m`, `m` edges `u v w`, then `u v`.
- Output: the path `u … v` space-separated, or `NO PATH`.

**Constraints.**
- `1 <= n <= 400`. Non-negative weights.

**Hint.** Initialize `next[u][v] = v` for edges. On relaxation through `k`, set `next[i][j] = next[i][k]`. Reconstruct by following `next` until reaching `v`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	nxt := make([][]int, n)
	for i := range d {
		d[i] = make([]int64, n)
		nxt[i] = make([]int, n)
		for j := range d[i] {
			if i == j {
				d[i][j] = 0
			} else {
				d[i][j] = INF
			}
			nxt[i][j] = -1
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
			nxt[u][v] = v
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
					nxt[i][j] = nxt[i][k]
				}
			}
		}
	}
	var u, v int
	fmt.Fscan(in, &u, &v)
	if nxt[u][v] == -1 && u != v {
		fmt.Fprintln(out, "NO PATH")
		return
	}
	path := []int{u}
	for u != v {
		u = nxt[u][v]
		path = append(path, u)
	}
	for i, p := range path {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, p)
	}
	out.WriteByte('\n')
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        int[][] nxt = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) {
                d[i][j] = (i == j) ? 0 : INF;
                nxt[i][j] = -1;
            }
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) { d[u][v] = w; nxt[u][v] = v; }
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j]) {
                        d[i][j] = d[i][k] + d[k][j];
                        nxt[i][j] = nxt[i][k];
                    }
            }
        in.nextToken(); int u = (int) in.nval;
        in.nextToken(); int v = (int) in.nval;
        if (nxt[u][v] == -1 && u != v) { System.out.println("NO PATH"); return; }
        StringBuilder sb = new StringBuilder();
        sb.append(u);
        while (u != v) { u = nxt[u][v]; sb.append(' ').append(u); }
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
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    nxt = [[-1] * n for _ in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
            nxt[u][v] = v
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik = d[i][k]
            for j in range(n):
                if dik + d[k][j] < d[i][j]:
                    d[i][j] = dik + d[k][j]
                    nxt[i][j] = nxt[i][k]
    u, v = int(next(data)), int(next(data))
    if nxt[u][v] == -1 and u != v:
        print("NO PATH")
        return
    path = [u]
    while u != v:
        u = nxt[u][v]
        path.append(u)
    print(" ".join(map(str, path)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `next[i][j] = next[i][k]` (not `= k`) on relaxation.
- Unreachable pair prints `NO PATH`.
- Path is a valid shortest route.

---

## Intermediate Tasks (5)

### Task 6 — Widest (bottleneck) path between all pairs

**Problem.** Given an undirected network with edge capacities, compute for every pair the maximum bottleneck capacity (the widest path's minimum edge). Print the matrix; `0` = no path.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v c` (undirected capacity `c`).
- Output: `n × n` widest-capacity matrix.

**Constraints.**
- `1 <= n <= 400`, `1 <= c <= 10^9`.

**Hint.** Use the `(max, min)` semiring: `w[i][j] = max(w[i][j], min(w[i][k], w[k][j]))`. Initialize to direct capacities, diagonal to infinity (or a sentinel large value).

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
	const BIG = int64(1) << 62
	w := make([][]int64, n)
	for i := range w {
		w[i] = make([]int64, n)
		w[i][i] = BIG
	}
	for ; m > 0; m-- {
		var u, v int
		var c int64
		fmt.Fscan(in, &u, &v, &c)
		if c > w[u][v] {
			w[u][v] = c
			w[v][u] = c
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				t := w[i][k]
				if w[k][j] < t {
					t = w[k][j]
				}
				if t > w[i][j] {
					w[i][j] = t
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if j > 0 {
				out.WriteByte(' ')
			}
			if i == j {
				fmt.Fprint(out, 0)
			} else if w[i][j] == 0 {
				fmt.Fprint(out, 0)
			} else {
				fmt.Fprint(out, w[i][j])
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

public class Task6 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        final long BIG = 1L << 62;
        long[][] w = new long[n][n];
        for (int i = 0; i < n; i++) w[i][i] = BIG;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long c = (long) in.nval;
            if (c > w[u][v]) { w[u][v] = c; w[v][u] = c; }
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++) {
                    long t = Math.min(w[i][k], w[k][j]);
                    if (t > w[i][j]) w[i][j] = t;
                }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append((i == j) ? 0 : w[i][j]);
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    BIG = 1 << 62
    w = [[0] * n for _ in range(n)]
    for i in range(n):
        w[i][i] = BIG
    for _ in range(m):
        u, v, c = int(next(data)), int(next(data)), int(next(data))
        if c > w[u][v]:
            w[u][v] = c
            w[v][u] = c
    for k in range(n):
        wk = w[k]
        for i in range(n):
            wik = w[i][k]
            wi = w[i]
            for j in range(n):
                t = wik if wik < wk[j] else wk[j]
                if t > wi[j]:
                    wi[j] = t
    out = []
    for i in range(n):
        out.append(" ".join("0" if i == j else str(w[i][j]) for j in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Uses `(max, min)`, not `(min, +)`.
- Disconnected pairs output `0`.
- Matches a brute reference on small inputs.

---

### Task 7 — Count the number of shortest paths between all pairs

**Problem.** For a directed graph with non-negative weights, compute for each pair `(i, j)` the number of distinct shortest paths, modulo `10^9+7`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: `n × n` matrix of counts mod `10^9+7` (diagonal = 1; unreachable = 0).

**Constraints.**
- `1 <= n <= 300`, no negative cycles.

**Hint.** Keep `cnt` alongside `dist`. On strict improvement set `cnt = cnt[i][k]*cnt[k][j]`; on a tie add it. Apply the mod each multiply/add.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60
const MOD = 1000000007

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	c := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		c[i] = make([]int64, n)
		for j := range d[i] {
			if i == j {
				d[i][j] = 0
				c[i][j] = 1
			} else {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
			c[u][v] = 1
		} else if w == d[u][v] {
			c[u][v] = (c[u][v] + 1) % MOD
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[k][j] >= INF {
					continue
				}
				nd := d[i][k] + d[k][j]
				ways := c[i][k] * c[k][j] % MOD
				if nd < d[i][j] {
					d[i][j] = nd
					c[i][j] = ways
				} else if nd == d[i][j] {
					c[i][j] = (c[i][j] + ways) % MOD
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if j > 0 {
				out.WriteByte(' ')
			}
			if d[i][j] >= INF {
				fmt.Fprint(out, 0)
			} else {
				fmt.Fprint(out, c[i][j])
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

public class Task7 {
    static final long INF = 1L << 60, MOD = 1000000007L;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n], c = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) {
                d[i][j] = (i == j) ? 0 : INF;
                if (i == j) c[i][j] = 1;
            }
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) { d[u][v] = w; c[u][v] = 1; }
            else if (w == d[u][v]) c[u][v] = (c[u][v] + 1) % MOD;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++) {
                    if (d[k][j] >= INF) continue;
                    long nd = d[i][k] + d[k][j];
                    long ways = c[i][k] * c[k][j] % MOD;
                    if (nd < d[i][j]) { d[i][j] = nd; c[i][j] = ways; }
                    else if (nd == d[i][j]) c[i][j] = (c[i][j] + ways) % MOD;
                }
            }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(d[i][j] >= INF ? 0 : c[i][j]);
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF, MOD = 1 << 60, 1000000007
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    c = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
            c[u][v] = 1
        elif w == d[u][v]:
            c[u][v] = (c[u][v] + 1) % MOD
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik, cik = d[i][k], c[i][k]
            for j in range(n):
                if d[k][j] >= INF:
                    continue
                nd = dik + d[k][j]
                ways = cik * c[k][j] % MOD
                if nd < d[i][j]:
                    d[i][j] = nd
                    c[i][j] = ways
                elif nd == d[i][j]:
                    c[i][j] = (c[i][j] + ways) % MOD
    out = []
    for i in range(n):
        out.append(" ".join("0" if d[i][j] >= INF else str(c[i][j]) for j in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Counts both strict improvements and ties correctly.
- All arithmetic is modular.
- Diagonal counts are 1; unreachable counts are 0.

---

### Task 8 — Graph diameter and center

**Problem.** For a connected undirected weighted graph, compute the diameter (max over all pairs of shortest distance) and the center vertex (minimizing its eccentricity).

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: two lines — `diameter` and `center` (smallest index on tie).

**Constraints.**
- `1 <= n <= 400`, non-negative weights, graph connected.

**Hint.** Run Floyd-Warshall, then for each `i` compute eccentricity `ecc[i] = max_j dist[i][j]`. Diameter = `max ecc`; center = `argmin ecc`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
			d[v][u] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	var diameter int64
	bestEcc := int64(INF)
	center := 0
	for i := 0; i < n; i++ {
		var ecc int64
		for j := 0; j < n; j++ {
			if d[i][j] > ecc {
				ecc = d[i][j]
			}
		}
		if ecc > diameter {
			diameter = ecc
		}
		if ecc < bestEcc {
			bestEcc = ecc
			center = i
		}
	}
	fmt.Println(diameter)
	fmt.Println(center)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) { d[u][v] = w; d[v][u] = w; }
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        long diameter = 0, bestEcc = INF;
        int center = 0;
        for (int i = 0; i < n; i++) {
            long ecc = 0;
            for (int j = 0; j < n; j++) ecc = Math.max(ecc, d[i][j]);
            diameter = Math.max(diameter, ecc);
            if (ecc < bestEcc) { bestEcc = ecc; center = i; }
        }
        System.out.println(diameter);
        System.out.println(center);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
            d[v][u] = w
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik = d[i][k]
            for j in range(n):
                if dik + d[k][j] < d[i][j]:
                    d[i][j] = dik + d[k][j]
    diameter, best_ecc, center = 0, INF, 0
    for i in range(n):
        ecc = max(d[i])
        diameter = max(diameter, ecc)
        if ecc < best_ecc:
            best_ecc, center = ecc, i
    print(diameter)
    print(center)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Diameter is the max finite distance over all pairs.
- Center minimizes eccentricity, smallest index on tie.
- Correct on a path graph (center is the middle).

---

### Task 9 — Minimax routing (minimize the maximum edge)

**Problem.** Given an undirected graph where each edge has a "difficulty," for each pair find the path minimizing the maximum edge difficulty along the route (the minimax path). Print the matrix.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v c`.
- Output: `n × n` matrix; `INF` if unreachable, `0` on the diagonal.

**Constraints.**
- `1 <= n <= 400`, `1 <= c <= 10^9`.

**Hint.** Use the `(min, max)` semiring: `mm[i][j] = min(mm[i][j], max(mm[i][k], mm[k][j]))`. Initialize to direct edge costs, `INF` otherwise.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	mm := make([][]int64, n)
	for i := range mm {
		mm[i] = make([]int64, n)
		for j := range mm[i] {
			if i != j {
				mm[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var c int64
		fmt.Fscan(in, &u, &v, &c)
		if c < mm[u][v] {
			mm[u][v] = c
			mm[v][u] = c
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if mm[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				t := mm[i][k]
				if mm[k][j] > t {
					t = mm[k][j]
				}
				if t < mm[i][j] {
					mm[i][j] = t
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if j > 0 {
				out.WriteByte(' ')
			}
			if mm[i][j] >= INF {
				fmt.Fprint(out, "INF")
			} else {
				fmt.Fprint(out, mm[i][j])
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

public class Task9 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] mm = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                mm[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long c = (long) in.nval;
            if (c < mm[u][v]) { mm[u][v] = c; mm[v][u] = c; }
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (mm[i][k] >= INF) continue;
                for (int j = 0; j < n; j++) {
                    long t = Math.max(mm[i][k], mm[k][j]);
                    if (t < mm[i][j]) mm[i][j] = t;
                }
            }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(mm[i][j] >= INF ? "INF" : Long.toString(mm[i][j]));
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    mm = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, c = int(next(data)), int(next(data)), int(next(data))
        if c < mm[u][v]:
            mm[u][v] = c
            mm[v][u] = c
    for k in range(n):
        for i in range(n):
            if mm[i][k] >= INF:
                continue
            mik = mm[i][k]
            for j in range(n):
                t = mik if mik > mm[k][j] else mm[k][j]
                if t < mm[i][j]:
                    mm[i][j] = t
    out = []
    for i in range(n):
        out.append(" ".join("INF" if mm[i][j] >= INF else str(mm[i][j]) for j in range(n)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Uses `(min, max)`.
- Disconnected pairs print `INF`.
- Matches a brute reference (try all paths) on small inputs.

---

### Task 10 — Smallest number of edges among shortest paths

**Problem.** Among all shortest (minimum-weight) paths between each pair, also report the minimum number of *edges* used. Output two matrices: minimum weight and minimum edge count among min-weight paths.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w` (non-negative).
- Output: the distance matrix, a blank line, then the min-edge-count matrix (`INF`/`-1` for unreachable).

**Constraints.**
- `1 <= n <= 300`, no negative cycles.

**Hint.** Track `(dist, edges)` lexicographically: prefer smaller distance, then fewer edges. On relaxation compare distance first, then edge count.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	e := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		e[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
				e[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] || (w == d[u][v] && 1 < e[u][v]) {
			d[u][v] = w
			e[u][v] = 1
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[k][j] >= INF {
					continue
				}
				nd := d[i][k] + d[k][j]
				ne := e[i][k] + e[k][j]
				if nd < d[i][j] || (nd == d[i][j] && ne < e[i][j]) {
					d[i][j] = nd
					e[i][j] = ne
				}
			}
		}
	}
	printMat := func(mat [][]int64) {
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				if j > 0 {
					out.WriteByte(' ')
				}
				if mat[i][j] >= INF {
					fmt.Fprint(out, "INF")
				} else {
					fmt.Fprint(out, mat[i][j])
				}
			}
			out.WriteByte('\n')
		}
	}
	printMat(d)
	out.WriteByte('\n')
	printMat(e)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    static final long INF = 1L << 60;
    static int n;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n], e = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                if (i != j) { d[i][j] = INF; e[i][j] = INF; }
        for (int q = 0; q < m; q++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v] || (w == d[u][v] && 1 < e[u][v])) { d[u][v] = w; e[u][v] = 1; }
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++) {
                    if (d[k][j] >= INF) continue;
                    long nd = d[i][k] + d[k][j], ne = e[i][k] + e[k][j];
                    if (nd < d[i][j] || (nd == d[i][j] && ne < e[i][j])) { d[i][j] = nd; e[i][j] = ne; }
                }
            }
        StringBuilder sb = new StringBuilder();
        printMat(sb, d); sb.append('\n'); printMat(sb, e);
        System.out.print(sb);
    }

    static void printMat(StringBuilder sb, long[][] mat) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                sb.append(mat[i][j] >= INF ? "INF" : Long.toString(mat[i][j]));
            }
            sb.append('\n');
        }
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    e = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v] or (w == d[u][v] and 1 < e[u][v]):
            d[u][v] = w
            e[u][v] = 1
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik, eik = d[i][k], e[i][k]
            for j in range(n):
                if d[k][j] >= INF:
                    continue
                nd = dik + d[k][j]
                ne = eik + e[k][j]
                if nd < d[i][j] or (nd == d[i][j] and ne < e[i][j]):
                    d[i][j] = nd
                    e[i][j] = ne

    def fmt(mat):
        return "\n".join(
            " ".join("INF" if mat[i][j] >= INF else str(mat[i][j]) for j in range(n))
            for i in range(n)
        )

    sys.stdout.write(fmt(d) + "\n\n" + fmt(e))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Tie-breaks correctly on edge count when weights are equal.
- Unreachable pairs print `INF` in both matrices.
- Matches a reference BFS-on-shortest-DAG on small inputs.

---

## Advanced Tasks (5)

### Task 11 — Propagate `-INF` to all pairs affected by negative cycles

**Problem.** Given a directed graph that may contain negative cycles, compute the all-pairs distance matrix where any pair whose shortest path can be made arbitrarily small is marked `-INF`. Print `INF` (unreachable), `-INF` (affected by negative cycle), or the finite distance.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: `n × n` matrix with `INF` / `-INF` / value.

**Constraints.**
- `1 <= n <= 400`, weights fit in 32-bit; use 64-bit.

**Hint.** Run Floyd-Warshall. Collect cycle vertices `T = {t : dist[t][t] < 0}`. Then `dist[i][j] = -INF` if there is `t ∈ T` with `dist[i][t] < INF` and `dist[t][j] < INF`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60
const NEGINF = -INF

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[k][j] < INF && d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	neg := []int{}
	for t := 0; t < n; t++ {
		if d[t][t] < 0 {
			neg = append(neg, t)
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			for _, t := range neg {
				if d[i][t] < INF && d[t][j] < INF {
					d[i][j] = NEGINF
					break
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if j > 0 {
				out.WriteByte(' ')
			}
			switch {
			case d[i][j] <= NEGINF/2:
				fmt.Fprint(out, "-INF")
			case d[i][j] >= INF/2:
				fmt.Fprint(out, "INF")
			default:
				fmt.Fprint(out, d[i][j])
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

public class Task11 {
    static final long INF = 1L << 60, NEGINF = -INF;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[k][j] < INF && d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        List<Integer> neg = new ArrayList<>();
        for (int t = 0; t < n; t++) if (d[t][t] < 0) neg.add(t);
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                for (int t : neg)
                    if (d[i][t] < INF && d[t][j] < INF) { d[i][j] = NEGINF; break; }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (j > 0) sb.append(' ');
                if (d[i][j] <= NEGINF / 2) sb.append("-INF");
                else if (d[i][j] >= INF / 2) sb.append("INF");
                else sb.append(d[i][j]);
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
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    NEGINF = -INF
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik = d[i][k]
            for j in range(n):
                if d[k][j] < INF and dik + d[k][j] < d[i][j]:
                    d[i][j] = dik + d[k][j]
    neg = [t for t in range(n) if d[t][t] < 0]
    for i in range(n):
        for j in range(n):
            for t in neg:
                if d[i][t] < INF and d[t][j] < INF:
                    d[i][j] = NEGINF
                    break
    out = []
    for i in range(n):
        row = []
        for j in range(n):
            if d[i][j] <= NEGINF // 2:
                row.append("-INF")
            elif d[i][j] >= INF // 2:
                row.append("INF")
            else:
                row.append(str(d[i][j]))
        out.append(" ".join(row))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All pairs routable through a negative cycle are `-INF`.
- Truly unreachable pairs are `INF`.
- No overflow when comparing/printing sentinels.

---

### Task 12 — Incremental edge-weight decrease in O(V²)

**Problem.** Start from a built distance matrix. Process a stream of edge decreases `(u, v, w)`; after each, the matrix must reflect the new shortest distances. Each update must run in `O(V²)`, not a full `O(V³)` rebuild.

**Input / Output spec.**
- Input: `n m`, `m` initial edges, then `q`, then `q` updates `u v w`, then a single query `a b` per update (interleaved as `u v w a b`).
- Output: for each update, print `dist[a][b]` (or `INF`).

**Constraints.**
- `1 <= n <= 400`, `1 <= q <= 10^4`.
- Weights non-negative; updates only ever *decrease* an edge.

**Hint.** For a decrease of `(u,v)` to `w`: if `w < dist[u][v]`, set `dist[u][v]=w`, then for all `i,j`: `dist[i][j] = min(dist[i][j], dist[i][u] + w + dist[v][j])`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	d := make([][]int64, n)
	for i := range d {
		d[i] = make([]int64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	var q int
	fmt.Fscan(in, &q)
	for ; q > 0; q-- {
		var u, v int
		var w int64
		var a, b int
		fmt.Fscan(in, &u, &v, &w, &a, &b)
		if w < d[u][v] {
			d[u][v] = w
			for i := 0; i < n; i++ {
				if d[i][u] >= INF {
					continue
				}
				base := d[i][u] + w
				for j := 0; j < n; j++ {
					if d[v][j] < INF && base+d[v][j] < d[i][j] {
						d[i][j] = base + d[v][j]
					}
				}
			}
		}
		if d[a][b] >= INF {
			fmt.Fprintln(out, "INF")
		} else {
			fmt.Fprintln(out, d[a][b])
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static final long INF = 1L << 60;

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] d = new long[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        in.nextToken(); int q = (int) in.nval;
        StringBuilder sb = new StringBuilder();
        for (int e = 0; e < q; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            in.nextToken(); int a = (int) in.nval;
            in.nextToken(); int b = (int) in.nval;
            if (w < d[u][v]) {
                d[u][v] = w;
                for (int i = 0; i < n; i++) {
                    if (d[i][u] >= INF) continue;
                    long base = d[i][u] + w;
                    for (int j = 0; j < n; j++)
                        if (d[v][j] < INF && base + d[v][j] < d[i][j])
                            d[i][j] = base + d[v][j];
                }
            }
            sb.append(d[a][b] >= INF ? "INF" : Long.toString(d[a][b])).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = 1 << 60
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        for i in range(n):
            if d[i][k] >= INF:
                continue
            dik = d[i][k]
            for j in range(n):
                if dik + d[k][j] < d[i][j]:
                    d[i][j] = dik + d[k][j]
    q = int(next(data))
    out = []
    for _ in range(q):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        a, b = int(next(data)), int(next(data))
        if w < d[u][v]:
            d[u][v] = w
            for i in range(n):
                if d[i][u] >= INF:
                    continue
                base = d[i][u] + w
                dv = d[v]
                di = d[i]
                for j in range(n):
                    if dv[j] < INF and base + dv[j] < di[j]:
                        di[j] = base + dv[j]
        out.append("INF" if d[a][b] >= INF else str(d[a][b]))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each update runs in `O(V²)`, not `O(V³)`.
- Matrix stays correct (verify against a full rebuild on small inputs).
- Decreases that do not improve `dist[u][v]` are no-ops.

---

### Task 13 — Currency arbitrage detection

**Problem.** Given exchange rates between currencies, determine whether an arbitrage opportunity exists (a cycle whose product of rates exceeds 1). Transform with `weight = -log(rate)` so an arbitrage becomes a negative cycle, then use Floyd-Warshall's diagonal check.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v rate` (rate is a positive float).
- Output: `ARBITRAGE` if an opportunity exists, else `NO`.

**Constraints.**
- `1 <= n <= 200`, `0 < rate <= 10^6`.

**Hint.** Edge weight `= -ln(rate)`. A cycle with product of rates `> 1` has summed weight `< 0`. Run Floyd-Warshall on these weights and check `dist[i][i] < -eps`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	const INF = math.MaxFloat64 / 4
	d := make([][]float64, n)
	for i := range d {
		d[i] = make([]float64, n)
		for j := range d[i] {
			if i != j {
				d[i][j] = INF
			}
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var rate float64
		fmt.Fscan(in, &u, &v, &rate)
		w := -math.Log(rate)
		if w < d[u][v] {
			d[u][v] = w
		}
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if d[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if d[k][j] < INF && d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	const eps = 1e-9
	arb := false
	for i := 0; i < n; i++ {
		if d[i][i] < -eps {
			arb = true
			break
		}
	}
	if arb {
		fmt.Println("ARBITRAGE")
	} else {
		fmt.Println("NO")
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        final double INF = Double.MAX_VALUE / 4;
        double[][] d = new double[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i][j] = (i == j) ? 0 : INF;
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); double rate = in.nval;
            double w = -Math.log(rate);
            if (w < d[u][v]) d[u][v] = w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (d[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (d[k][j] < INF && d[i][k] + d[k][j] < d[i][j])
                        d[i][j] = d[i][k] + d[k][j];
            }
        double eps = 1e-9;
        boolean arb = false;
        for (int i = 0; i < n; i++) if (d[i][i] < -eps) { arb = true; break; }
        System.out.println(arb ? "ARBITRAGE" : "NO");
    }
}
```

**Reference — Python.**
```python
import math
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    INF = float("inf")
    d = [[0.0 if i == j else INF for j in range(n)] for i in range(n)]
    for _ in range(m):
        u, v, rate = int(next(data)), int(next(data)), float(next(data))
        w = -math.log(rate)
        if w < d[u][v]:
            d[u][v] = w
    for k in range(n):
        for i in range(n):
            if d[i][k] == INF:
                continue
            dik = d[i][k]
            for j in range(n):
                if d[k][j] != INF and dik + d[k][j] < d[i][j]:
                    d[i][j] = dik + d[k][j]
    eps = 1e-9
    print("ARBITRAGE" if any(d[i][i] < -eps for i in range(n)) else "NO")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correctly transforms rates with `-log`.
- Uses an epsilon to avoid floating-point false positives.
- Detects a `>1`-product cycle as `ARBITRAGE`.

---

### Task 14 — Min-plus matrix power for shortest paths of fixed length

**Problem.** Given a graph, compute the shortest path from `s` to `t` that uses **exactly** `L` edges. Use min-plus matrix exponentiation (`O(V³ log L)`), which relates to Floyd-Warshall's min-plus semiring but raises the adjacency to a fixed power instead of taking its closure.

**Input / Output spec.**
- Input: `n m L s t`, then `m` lines `u v w`.
- Output: the minimum weight of a length-`L` walk `s→t`, or `INF`.

**Constraints.**
- `1 <= n <= 100`, `1 <= L <= 10^9`.

**Hint.** Define min-plus product `(A⊙B)[i][j] = min_k A[i][k]+B[k][j]`. Compute `W^L` by fast exponentiation; identity is the matrix with 0 on the diagonal and INF elsewhere.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = 1 << 60

func mul(a, b [][]int64) [][]int64 {
	n := len(a)
	c := make([][]int64, n)
	for i := range c {
		c[i] = make([]int64, n)
		for j := range c[i] {
			c[i][j] = INF
		}
	}
	for i := 0; i < n; i++ {
		for k := 0; k < n; k++ {
			if a[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if b[k][j] < INF && a[i][k]+b[k][j] < c[i][j] {
					c[i][j] = a[i][k] + b[k][j]
				}
			}
		}
	}
	return c
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m, L, s, t int
	fmt.Fscan(in, &n, &m, &L, &s, &t)
	w := make([][]int64, n)
	for i := range w {
		w[i] = make([]int64, n)
		for j := range w[i] {
			w[i][j] = INF
		}
	}
	for ; m > 0; m-- {
		var u, v int
		var ww int64
		fmt.Fscan(in, &u, &v, &ww)
		if ww < w[u][v] {
			w[u][v] = ww
		}
	}
	// result = identity (0 diagonal, INF else)
	res := make([][]int64, n)
	for i := range res {
		res[i] = make([]int64, n)
		for j := range res[i] {
			if i != j {
				res[i][j] = INF
			}
		}
	}
	for L > 0 {
		if L&1 == 1 {
			res = mul(res, w)
		}
		w = mul(w, w)
		L >>= 1
	}
	if res[s][t] >= INF {
		fmt.Println("INF")
	} else {
		fmt.Println(res[s][t])
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    static final long INF = 1L << 60;
    static int n;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[n][n];
        for (long[] row : c) Arrays.fill(row, INF);
        for (int i = 0; i < n; i++)
            for (int k = 0; k < n; k++) {
                if (a[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (b[k][j] < INF && a[i][k] + b[k][j] < c[i][j])
                        c[i][j] = a[i][k] + b[k][j];
            }
        return c;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        in.nextToken(); long L = (long) in.nval;
        in.nextToken(); int s = (int) in.nval;
        in.nextToken(); int t = (int) in.nval;
        long[][] w = new long[n][n];
        for (long[] row : w) Arrays.fill(row, INF);
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long ww = (long) in.nval;
            if (ww < w[u][v]) w[u][v] = ww;
        }
        long[][] res = new long[n][n];
        for (int i = 0; i < n; i++) { Arrays.fill(res[i], INF); res[i][i] = 0; }
        while (L > 0) {
            if ((L & 1) == 1) res = mul(res, w);
            w = mul(w, w);
            L >>= 1;
        }
        System.out.println(res[s][t] >= INF ? "INF" : Long.toString(res[s][t]));
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m, L, s, t = (int(next(data)) for _ in range(5))
    INF = 1 << 60

    def mul(a, b):
        c = [[INF] * n for _ in range(n)]
        for i in range(n):
            ai = a[i]
            ci = c[i]
            for k in range(n):
                if ai[k] >= INF:
                    continue
                aik = ai[k]
                bk = b[k]
                for j in range(n):
                    if bk[j] < INF and aik + bk[j] < ci[j]:
                        ci[j] = aik + bk[j]
        return c

    w = [[INF] * n for _ in range(n)]
    for _ in range(m):
        u, v, ww = int(next(data)), int(next(data)), int(next(data))
        if ww < w[u][v]:
            w[u][v] = ww
    res = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    while L > 0:
        if L & 1:
            res = mul(res, w)
        w = mul(w, w)
        L >>= 1
    print("INF" if res[s][t] >= INF else res[s][t])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Uses min-plus product, not ordinary multiplication.
- Identity matrix is `(0 diagonal, INF else)`.
- Correct for small `L` against a brute DP `dp[step][v]`.

---

### Task 15 — Transitive reduction via closure

**Problem.** Given a DAG, output its transitive reduction: the minimal set of edges with the same reachability. Compute the transitive closure with Warshall, then remove any direct edge `(u, v)` that is implied by a two-step path `u → w → v`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v` (a DAG).
- Output: the reduced edge list, one `u v` per line, sorted.

**Constraints.**
- `1 <= n <= 1000`. Input is acyclic.

**Hint.** Build closure `reach`. Edge `(u, v)` is redundant iff there exists `w ≠ u, v` with `reach[u][w]` and `reach[w][v]` (i.e. a path of length ≥ 2). Keep only non-redundant direct edges.

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
	adj := make([][]bool, n)
	reach := make([][]bool, n)
	for i := range adj {
		adj[i] = make([]bool, n)
		reach[i] = make([]bool, n)
	}
	type edge struct{ u, v int }
	edges := make([]edge, 0, m)
	for ; m > 0; m-- {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u][v] = true
		reach[u][v] = true
		edges = append(edges, edge{u, v})
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if !reach[i][k] {
				continue
			}
			for j := 0; j < n; j++ {
				if reach[k][j] {
					reach[i][j] = true
				}
			}
		}
	}
	kept := make([]edge, 0, len(edges))
	for _, e := range edges {
		redundant := false
		for w := 0; w < n; w++ {
			if w != e.u && w != e.v && reach[e.u][w] && reach[w][e.v] {
				redundant = true
				break
			}
		}
		if !redundant {
			kept = append(kept, e)
		}
	}
	sort.Slice(kept, func(i, j int) bool {
		if kept[i].u != kept[j].u {
			return kept[i].u < kept[j].u
		}
		return kept[i].v < kept[j].v
	})
	for _, e := range kept {
		fmt.Fprintln(out, e.u, e.v)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        boolean[][] reach = new boolean[n][n];
        int[][] edges = new int[m][2];
        for (int e = 0; e < m; e++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            reach[u][v] = true;
            edges[e][0] = u; edges[e][1] = v;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (!reach[i][k]) continue;
                for (int j = 0; j < n; j++)
                    if (reach[k][j]) reach[i][j] = true;
            }
        List<int[]> kept = new ArrayList<>();
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            boolean redundant = false;
            for (int w = 0; w < n; w++)
                if (w != u && w != v && reach[u][w] && reach[w][v]) { redundant = true; break; }
            if (!redundant) kept.add(e);
        }
        kept.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        StringBuilder sb = new StringBuilder();
        for (int[] e : kept) sb.append(e[0]).append(' ').append(e[1]).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    n, m = int(next(data)), int(next(data))
    reach = [[False] * n for _ in range(n)]
    edges = []
    for _ in range(m):
        u, v = int(next(data)), int(next(data))
        reach[u][v] = True
        edges.append((u, v))
    for k in range(n):
        for i in range(n):
            if not reach[i][k]:
                continue
            rk = reach[k]
            ri = reach[i]
            for j in range(n):
                if rk[j]:
                    ri[j] = True
    kept = []
    for u, v in edges:
        redundant = any(
            w != u and w != v and reach[u][w] and reach[w][v] for w in range(n)
        )
        if not redundant:
            kept.append((u, v))
    kept.sort()
    sys.stdout.write("\n".join(f"{u} {v}" for u, v in kept))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Reduced graph has identical reachability to the input.
- No edge is removable without changing reachability.
- Output is sorted; works on a chain and on a "diamond" DAG.

---

## Benchmark Task

### Task B — Full benchmark across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark measuring Floyd-Warshall on random dense graphs:

- **(a)** Naive nested 2D array, triple loop, no micro-optimizations.
- **(b)** Flat 1D matrix with the `dist[i][k]` hoist and the `INF`-row skip.
- **(c)** (Python only) NumPy-vectorized layers as a reference for the vectorized speedup; (Go/Java) a goroutine/thread-parallel version with a barrier per `k`.

Run for `V ∈ {200, 400, 800}` on a random dense graph (edge probability 0.5, weights `[1, 100]`). Repeat each measurement 3 times; report the mean wall-clock time in milliseconds. Use the same seed across languages.

**Input / Output spec.**
- No stdin. Output a fixed table:

```text
V       a_naive_ms    b_flat_opt_ms    c_parallel_or_numpy_ms
200     ...           ...              ...
400     ...           ...              ...
800     ...           ...              ...
```

**Constraints.**
- Seed: `42`.
- Time only the algorithm, not graph generation.
- Verify (a), (b), (c) produce identical matrices before timing.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"runtime"
	"sync"
	"time"
)

const INF = 1 << 30

func gen(n int, seed int64) []int {
	r := rand.New(rand.NewSource(seed))
	d := make([]int, n*n)
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if i == j {
				d[i*n+j] = 0
			} else if r.Float64() < 0.5 {
				d[i*n+j] = 1 + r.Intn(100)
			} else {
				d[i*n+j] = INF
			}
		}
	}
	return d
}

func naive(src []int, n int) time.Duration {
	d := make([][]int, n)
	for i := 0; i < n; i++ {
		d[i] = make([]int, n)
		copy(d[i], src[i*n:(i+1)*n])
	}
	t := time.Now()
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				if d[i][k]+d[k][j] < d[i][j] {
					d[i][j] = d[i][k] + d[k][j]
				}
			}
		}
	}
	return time.Since(t)
}

func flatOpt(src []int, n int) time.Duration {
	d := make([]int, n*n)
	copy(d, src)
	t := time.Now()
	for k := 0; k < n; k++ {
		krow := k * n
		for i := 0; i < n; i++ {
			dik := d[i*n+k]
			if dik >= INF {
				continue
			}
			row := i * n
			for j := 0; j < n; j++ {
				if v := dik + d[krow+j]; v < d[row+j] {
					d[row+j] = v
				}
			}
		}
	}
	return time.Since(t)
}

func parallel(src []int, n int) time.Duration {
	d := make([]int, n*n)
	copy(d, src)
	threads := runtime.NumCPU()
	t := time.Now()
	for k := 0; k < n; k++ {
		krow := k * n
		var wg sync.WaitGroup
		chunk := (n + threads - 1) / threads
		for tt := 0; tt < threads; tt++ {
			lo := tt * chunk
			hi := lo + chunk
			if hi > n {
				hi = n
			}
			if lo >= hi {
				continue
			}
			wg.Add(1)
			go func(lo, hi int) {
				defer wg.Done()
				for i := lo; i < hi; i++ {
					dik := d[i*n+k]
					if dik >= INF {
						continue
					}
					row := i * n
					for j := 0; j < n; j++ {
						if v := dik + d[krow+j]; v < d[row+j] {
							d[row+j] = v
						}
					}
				}
			}(lo, hi)
		}
		wg.Wait()
	}
	return time.Since(t)
}

func meanMs(ds []time.Duration) float64 {
	var s float64
	for _, x := range ds {
		s += float64(x.Microseconds()) / 1000.0
	}
	return s / float64(len(ds))
}

func main() {
	fmt.Println("V       a_naive_ms    b_flat_opt_ms    c_parallel_ms")
	for _, n := range []int{200, 400, 800} {
		src := gen(n, 42)
		var ra, rb, rc []time.Duration
		for i := 0; i < 3; i++ {
			ra = append(ra, naive(src, n))
			rb = append(rb, flatOpt(src, n))
			rc = append(rc, parallel(src, n))
		}
		fmt.Printf("%-7d %-13.2f %-16.2f %-16.2f\n", n, meanMs(ra), meanMs(rb), meanMs(rc))
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.util.concurrent.*;

public class TaskB {
    static final int INF = 1 << 30;

    static int[] gen(int n, long seed) {
        Random r = new Random(seed);
        int[] d = new int[n * n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                d[i * n + j] = (i == j) ? 0 : (r.nextDouble() < 0.5 ? 1 + r.nextInt(100) : INF);
        return d;
    }

    static long naive(int[] src, int n) {
        int[][] d = new int[n][n];
        for (int i = 0; i < n; i++)
            System.arraycopy(src, i * n, d[i], 0, n);
        long t = System.nanoTime();
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
        return System.nanoTime() - t;
    }

    static long flatOpt(int[] src, int n) {
        int[] d = src.clone();
        long t = System.nanoTime();
        for (int k = 0; k < n; k++) {
            int krow = k * n;
            for (int i = 0; i < n; i++) {
                int dik = d[i * n + k];
                if (dik >= INF) continue;
                int row = i * n;
                for (int j = 0; j < n; j++) {
                    int v = dik + d[krow + j];
                    if (v < d[row + j]) d[row + j] = v;
                }
            }
        }
        return System.nanoTime() - t;
    }

    static long parallel(int[] src, int n) throws InterruptedException {
        int[] d = src.clone();
        int threads = Runtime.getRuntime().availableProcessors();
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        long t = System.nanoTime();
        try {
            for (int k = 0; k < n; k++) {
                final int kk = k, krow = k * n;
                CountDownLatch latch = new CountDownLatch(threads);
                int chunk = (n + threads - 1) / threads;
                for (int tt = 0; tt < threads; tt++) {
                    final int lo = tt * chunk, hi = Math.min(n, lo + chunk);
                    pool.execute(() -> {
                        for (int i = lo; i < hi; i++) {
                            int dik = d[i * n + kk];
                            if (dik >= INF) continue;
                            int row = i * n;
                            for (int j = 0; j < n; j++) {
                                int v = dik + d[krow + j];
                                if (v < d[row + j]) d[row + j] = v;
                            }
                        }
                        latch.countDown();
                    });
                }
                latch.await();
            }
        } finally { pool.shutdown(); }
        return System.nanoTime() - t;
    }

    static double meanMs(long[] ns) {
        long s = 0; for (long x : ns) s += x;
        return (s / 1_000_000.0) / ns.length;
    }

    public static void main(String[] args) throws InterruptedException {
        System.out.println("V       a_naive_ms    b_flat_opt_ms    c_parallel_ms");
        for (int n : new int[]{200, 400, 800}) {
            int[] src = gen(n, 42L);
            long[] ra = new long[3], rb = new long[3], rc = new long[3];
            for (int i = 0; i < 3; i++) {
                ra[i] = naive(src, n);
                rb[i] = flatOpt(src, n);
                rc[i] = parallel(src, n);
            }
            System.out.printf("%-7d %-13.2f %-16.2f %-16.2f%n", n, meanMs(ra), meanMs(rb), meanMs(rc));
        }
    }
}
```

**Starter — Python.**
```python
import random
import time

import numpy as np

INF = 1 << 30


def gen(n, seed):
    r = random.Random(seed)
    d = [[0 if i == j else (1 + r.randrange(100) if r.random() < 0.5 else INF)
          for j in range(n)] for i in range(n)]
    return d


def naive(src, n):
    d = [row[:] for row in src]
    t = time.perf_counter()
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return (time.perf_counter() - t) * 1000.0


def flat_opt(src, n):
    d = [row[:] for row in src]
    t = time.perf_counter()
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik >= INF:
                continue
            di = d[i]
            for j in range(n):
                v = dik + dk[j]
                if v < di[j]:
                    di[j] = v
    return (time.perf_counter() - t) * 1000.0


def numpy_fw(src, n):
    d = np.array(src, dtype=np.int64)
    big = INF
    t = time.perf_counter()
    for k in range(n):
        np.minimum(d, d[:, k, None] + d[None, k, :], out=d)
        np.minimum(d, big, out=d)  # keep INF capped
    return (time.perf_counter() - t) * 1000.0


def mean_ms(samples):
    return sum(samples) / len(samples)


def main():
    print("V       a_naive_ms    b_flat_opt_ms    c_numpy_ms")
    for n in (200, 400, 800):
        src = gen(n, 42)
        ra = [naive(src, n) for _ in range(3)] if n <= 400 else [float("nan")]
        rb = [flat_opt(src, n) for _ in range(3)]
        rc = [numpy_fw(src, n) for _ in range(3)]
        print(f"{n:<7d} {mean_ms(ra):<13.2f} {mean_ms(rb):<16.2f} {mean_ms(rc):<16.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces identical input across languages.
- Variant (b) consistently beats (a) (flat array + hoist + row skip).
- Variant (c) shows clear speedup (parallel for Go/Java; NumPy for Python).
- All three variants produce identical distance matrices before timing.
- Report includes the mean across at least 3 runs and a short note on where the largest gap appeared and why (cache locality, parallelism, or vectorization).
