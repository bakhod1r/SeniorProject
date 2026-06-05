# Eulerian Path & Circuit — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a reference solution in all three languages.

---

## Beginner Tasks (5)

### Task 1 — Detect an Eulerian circuit in an undirected graph

**Problem.** Given an undirected graph, report whether it has an Eulerian circuit (every vertex even degree **and** edges form one connected component).

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `YES` or `NO`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.
- Time `O(n + m)`.

**Hint.** Count degrees; if any is odd, answer `NO`. Otherwise DFS/BFS from any edge-bearing vertex and confirm all edge-bearing vertices are reached.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	deg := make([]int, n)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		deg[u]++
		deg[v]++
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	for v := 0; v < n; v++ {
		if deg[v]%2 == 1 {
			fmt.Println("NO")
			return
		}
	}
	start := -1
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			start = v
			break
		}
	}
	if start == -1 {
		fmt.Println("YES") // no edges
		return
	}
	seen := make([]bool, n)
	stack := []int{start}
	seen[start] = true
	cnt := 1
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, w := range adj[v] {
			if !seen[w] {
				seen[w] = true
				cnt++
				stack = append(stack, w)
			}
		}
	}
	withEdges := 0
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			withEdges++
		}
	}
	if cnt == withEdges {
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

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer in = new StreamTokenizer(br);
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[] deg = new int[n];
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            deg[u]++; deg[v]++;
            adj[u].add(v); adj[v].add(u);
        }
        for (int v = 0; v < n; v++) if (deg[v] % 2 == 1) { System.out.println("NO"); return; }
        int start = -1;
        for (int v = 0; v < n; v++) if (deg[v] > 0) { start = v; break; }
        if (start == -1) { System.out.println("YES"); return; }
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(start); seen[start] = true; int cnt = 1;
        while (!st.isEmpty()) {
            int v = st.pop();
            for (int w : adj[v]) if (!seen[w]) { seen[w] = true; cnt++; st.push(w); }
        }
        int withEdges = 0;
        for (int v = 0; v < n; v++) if (deg[v] > 0) withEdges++;
        System.out.println(cnt == withEdges ? "YES" : "NO");
    }
}
```

**Python.**
```python
import sys
sys.setrecursionlimit(1 << 25)


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    deg = [0] * n
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        deg[u] += 1
        deg[v] += 1
        adj[u].append(v)
        adj[v].append(u)
    if any(d % 2 for d in deg):
        print("NO")
        return
    start = next((v for v in range(n) if deg[v] > 0), -1)
    if start == -1:
        print("YES")
        return
    seen = [False] * n
    stack = [start]
    seen[start] = True
    cnt = 1
    while stack:
        v = stack.pop()
        for w in adj[v]:
            if not seen[w]:
                seen[w] = True
                cnt += 1
                stack.append(w)
    with_edges = sum(1 for v in range(n) if deg[v] > 0)
    print("YES" if cnt == with_edges else "NO")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Correct on disconnected even graphs (must say `NO`), empty graph (`YES`), single self-loop (`YES`).

---

### Task 2 — Classify Eulerian status (none / path / circuit), undirected

**Problem.** Output `0` (neither), `1` (path only), or `2` (circuit).

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: one integer `0`, `1`, or `2`.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2*10^5`.

**Hint.** Count odd-degree vertices; `0` and connected → 2, `2` and connected → 1, else 0.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	deg := make([]int, n)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		deg[u]++
		deg[v]++
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	start := -1
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			start = v
			break
		}
	}
	connected := true
	if start != -1 {
		seen := make([]bool, n)
		stack := []int{start}
		seen[start] = true
		cnt := 1
		for len(stack) > 0 {
			v := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, w := range adj[v] {
				if !seen[w] {
					seen[w] = true
					cnt++
					stack = append(stack, w)
				}
			}
		}
		withEdges := 0
		for v := 0; v < n; v++ {
			if deg[v] > 0 {
				withEdges++
			}
		}
		connected = cnt == withEdges
	}
	odd := 0
	for v := 0; v < n; v++ {
		if deg[v]%2 == 1 {
			odd++
		}
	}
	if !connected {
		fmt.Println(0)
		return
	}
	switch odd {
	case 0:
		fmt.Println(2)
	case 2:
		fmt.Println(1)
	default:
		fmt.Println(0)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[] deg = new int[n];
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            deg[u]++; deg[v]++;
            adj[u].add(v); adj[v].add(u);
        }
        int start = -1;
        for (int v = 0; v < n; v++) if (deg[v] > 0) { start = v; break; }
        boolean connected = true;
        if (start != -1) {
            boolean[] seen = new boolean[n];
            Deque<Integer> st = new ArrayDeque<>();
            st.push(start); seen[start] = true; int cnt = 1;
            while (!st.isEmpty()) {
                int v = st.pop();
                for (int w : adj[v]) if (!seen[w]) { seen[w] = true; cnt++; st.push(w); }
            }
            int withEdges = 0;
            for (int v = 0; v < n; v++) if (deg[v] > 0) withEdges++;
            connected = cnt == withEdges;
        }
        int odd = 0;
        for (int v = 0; v < n; v++) if (deg[v] % 2 == 1) odd++;
        if (!connected) System.out.println(0);
        else if (odd == 0) System.out.println(2);
        else if (odd == 2) System.out.println(1);
        else System.out.println(0);
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
    m = int(data[idx]); idx += 1
    deg = [0] * n
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        deg[u] += 1; deg[v] += 1
        adj[u].append(v); adj[v].append(u)
    start = next((v for v in range(n) if deg[v] > 0), -1)
    connected = True
    if start != -1:
        seen = [False] * n
        stack = [start]; seen[start] = True; cnt = 1
        while stack:
            v = stack.pop()
            for w in adj[v]:
                if not seen[w]:
                    seen[w] = True; cnt += 1; stack.append(w)
        with_edges = sum(1 for v in range(n) if deg[v] > 0)
        connected = cnt == with_edges
    odd = sum(1 for v in range(n) if deg[v] % 2 == 1)
    if not connected:
        print(0)
    else:
        print({0: 2, 2: 1}.get(odd, 0))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Single linear pass; correct classification of all five cases including the no-edge graph (treat as circuit, `2`).

---

### Task 3 — Print one Eulerian circuit of an undirected graph

**Problem.** Given an undirected graph guaranteed to have an Eulerian circuit, print the vertex sequence of one such circuit (length `m + 1`).

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `m + 1` space-separated vertices.

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 5*10^5`. Time `O(m)`.

**Hint.** Iterative Hierholzer with edge ids and a `used[]` array; use a per-vertex pointer into the adjacency list.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	type half struct{ to, id int }
	adj := make([][]half, n)
	for id := 0; id < m; id++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], half{v, id})
		adj[v] = append(adj[v], half{u, id})
	}
	used := make([]bool, m)
	iter := make([]int, n)
	start := 0
	for v := 0; v < n; v++ {
		if len(adj[v]) > 0 {
			start = v
			break
		}
	}
	stack := []int{start}
	var circ []int
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		adv := false
		for iter[v] < len(adj[v]) {
			h := adj[v][iter[v]]
			iter[v]++
			if !used[h.id] {
				used[h.id] = true
				stack = append(stack, h.to)
				adv = true
				break
			}
		}
		if !adv {
			circ = append(circ, v)
			stack = stack[:len(stack)-1]
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i := len(circ) - 1; i >= 0; i-- {
		if i < len(circ)-1 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, circ[i])
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
        in.nextToken(); int m = (int) in.nval;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int id = 0; id < m; id++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            adj[u].add(new int[]{v, id});
            adj[v].add(new int[]{u, id});
        }
        boolean[] used = new boolean[m];
        int[] iter = new int[n];
        int start = 0;
        for (int v = 0; v < n; v++) if (!adj[v].isEmpty()) { start = v; break; }
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(start);
        ArrayList<Integer> circ = new ArrayList<>();
        while (!stack.isEmpty()) {
            int v = stack.peek();
            boolean adv = false;
            while (iter[v] < adj[v].size()) {
                int[] h = adj[v].get(iter[v]++);
                if (!used[h[1]]) { used[h[1]] = true; stack.push(h[0]); adv = true; break; }
            }
            if (!adv) circ.add(stack.pop());
        }
        StringBuilder sb = new StringBuilder();
        for (int i = circ.size() - 1; i >= 0; i--) {
            if (i < circ.size() - 1) sb.append(' ');
            sb.append(circ.get(i));
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
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for eid in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, eid))
        adj[v].append((u, eid))
    used = [False] * m
    it = [0] * n
    start = next((v for v in range(n) if adj[v]), 0)
    stack = [start]
    circ = []
    while stack:
        v = stack[-1]
        adv = False
        while it[v] < len(adj[v]):
            w, eid = adj[v][it[v]]
            it[v] += 1
            if not used[eid]:
                used[eid] = True
                stack.append(w)
                adv = True
                break
        if not adv:
            circ.append(stack.pop())
    sys.stdout.write(" ".join(map(str, reversed(circ))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Output length is exactly `m + 1`; each edge used once (validate). Runs in `O(m)` (no adjacency re-scan).

---

### Task 4 — Classify Eulerian status of a directed graph

**Problem.** Output `0` (neither), `1` (path), or `2` (circuit) for a directed graph using in/out balance + connectivity.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v` (arc `u -> v`).
- Output: `0`, `1`, or `2`.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.

**Hint.** Balance check: count vertices with `out−in = +1` and `in−out = +1`. For connectivity, check that all edge-bearing vertices are reachable from a valid start in the underlying graph (weak) plus that all reach back (here a simple weak-connectivity check on edge-bearing vertices suffices for the balanced case; for the path case verify reachability from the `+1` source).

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	outd := make([]int, n)
	ind := make([]int, n)
	adj := make([][]int, n)  // directed
	und := make([][]int, n)  // undirected (for weak connectivity)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		outd[u]++
		ind[v]++
		adj[u] = append(adj[u], v)
		und[u] = append(und[u], v)
		und[v] = append(und[v], u)
	}
	plus, minus := 0, 0
	bad := false
	start := -1
	for v := 0; v < n; v++ {
		d := outd[v] - ind[v]
		if d == 1 {
			plus++
			start = v
		} else if d == -1 {
			minus++
		} else if d != 0 {
			bad = true
		}
		if start == -1 && outd[v] > 0 {
			start = v
		}
	}
	// weak connectivity of edge-bearing vertices
	connected := true
	s := -1
	for v := 0; v < n; v++ {
		if outd[v]+ind[v] > 0 {
			s = v
			break
		}
	}
	if s != -1 {
		seen := make([]bool, n)
		stack := []int{s}
		seen[s] = true
		cnt := 1
		for len(stack) > 0 {
			x := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, w := range und[x] {
				if !seen[w] {
					seen[w] = true
					cnt++
					stack = append(stack, w)
				}
			}
		}
		withEdges := 0
		for v := 0; v < n; v++ {
			if outd[v]+ind[v] > 0 {
				withEdges++
			}
		}
		connected = cnt == withEdges
	}
	if bad || !connected {
		fmt.Println(0)
		return
	}
	if plus == 0 && minus == 0 {
		fmt.Println(2)
	} else if plus == 1 && minus == 1 {
		fmt.Println(1)
	} else {
		fmt.Println(0)
	}
	_ = adj
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[] outd = new int[n], ind = new int[n];
        List<Integer>[] und = new List[n];
        for (int i = 0; i < n; i++) und[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            outd[u]++; ind[v]++;
            und[u].add(v); und[v].add(u);
        }
        int plus = 0, minus = 0; boolean bad = false;
        for (int v = 0; v < n; v++) {
            int d = outd[v] - ind[v];
            if (d == 1) plus++;
            else if (d == -1) minus++;
            else if (d != 0) bad = true;
        }
        int s = -1;
        for (int v = 0; v < n; v++) if (outd[v] + ind[v] > 0) { s = v; break; }
        boolean connected = true;
        if (s != -1) {
            boolean[] seen = new boolean[n];
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s); seen[s] = true; int cnt = 1;
            while (!st.isEmpty()) {
                int x = st.pop();
                for (int w : und[x]) if (!seen[w]) { seen[w] = true; cnt++; st.push(w); }
            }
            int withEdges = 0;
            for (int v = 0; v < n; v++) if (outd[v] + ind[v] > 0) withEdges++;
            connected = cnt == withEdges;
        }
        if (bad || !connected) System.out.println(0);
        else if (plus == 0 && minus == 0) System.out.println(2);
        else if (plus == 1 && minus == 1) System.out.println(1);
        else System.out.println(0);
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
    m = int(data[idx]); idx += 1
    outd = [0] * n
    ind = [0] * n
    und = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        outd[u] += 1; ind[v] += 1
        und[u].append(v); und[v].append(u)
    plus = minus = 0
    bad = False
    for v in range(n):
        d = outd[v] - ind[v]
        if d == 1:
            plus += 1
        elif d == -1:
            minus += 1
        elif d != 0:
            bad = True
    s = next((v for v in range(n) if outd[v] + ind[v] > 0), -1)
    connected = True
    if s != -1:
        seen = [False] * n
        stack = [s]; seen[s] = True; cnt = 1
        while stack:
            x = stack.pop()
            for w in und[x]:
                if not seen[w]:
                    seen[w] = True; cnt += 1; stack.append(w)
        with_edges = sum(1 for v in range(n) if outd[v] + ind[v] > 0)
        connected = cnt == with_edges
    if bad or not connected:
        print(0)
    elif plus == 0 and minus == 0:
        print(2)
    elif plus == 1 and minus == 1:
        print(1)
    else:
        print(0)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Correct on balanced-but-disconnected (`0`) and on a single source/sink path (`1`).

---

### Task 5 — One-stroke drawing feasibility

**Problem.** Given a figure as line segments between labeled points, decide whether it can be drawn in one continuous stroke without retracing any segment. Output `YES` / `NO`, and if `YES`, also the count of valid starting points.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v` (a drawable segment between points `u` and `v`).
- Output: `YES <count>` or `NO`.

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 2*10^5`.

**Hint.** One-stroke == Eulerian path/circuit. If 0 odd vertices and connected → `YES` with `(number of edge-bearing vertices)` valid starts (any). If 2 odd and connected → `YES 2` (the two odd vertices). Else `NO`.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	deg := make([]int, n)
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		deg[u]++
		deg[v]++
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	start := -1
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			start = v
			break
		}
	}
	connected := true
	withEdges := 0
	for v := 0; v < n; v++ {
		if deg[v] > 0 {
			withEdges++
		}
	}
	if start != -1 {
		seen := make([]bool, n)
		stack := []int{start}
		seen[start] = true
		cnt := 1
		for len(stack) > 0 {
			x := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, w := range adj[x] {
				if !seen[w] {
					seen[w] = true
					cnt++
					stack = append(stack, w)
				}
			}
		}
		connected = cnt == withEdges
	}
	odd := 0
	for v := 0; v < n; v++ {
		if deg[v]%2 == 1 {
			odd++
		}
	}
	if !connected || (odd != 0 && odd != 2) {
		fmt.Println("NO")
		return
	}
	if odd == 0 {
		fmt.Println("YES", withEdges)
	} else {
		fmt.Println("YES", 2)
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task5 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        int[] deg = new int[n];
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            deg[u]++; deg[v]++; adj[u].add(v); adj[v].add(u);
        }
        int start = -1, withEdges = 0;
        for (int v = 0; v < n; v++) { if (deg[v] > 0) { withEdges++; if (start == -1) start = v; } }
        boolean connected = true;
        if (start != -1) {
            boolean[] seen = new boolean[n];
            Deque<Integer> st = new ArrayDeque<>();
            st.push(start); seen[start] = true; int cnt = 1;
            while (!st.isEmpty()) {
                int x = st.pop();
                for (int w : adj[x]) if (!seen[w]) { seen[w] = true; cnt++; st.push(w); }
            }
            connected = cnt == withEdges;
        }
        int odd = 0;
        for (int v = 0; v < n; v++) if (deg[v] % 2 == 1) odd++;
        if (!connected || (odd != 0 && odd != 2)) { System.out.println("NO"); return; }
        System.out.println("YES " + (odd == 0 ? withEdges : 2));
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
    m = int(data[idx]); idx += 1
    deg = [0] * n
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        deg[u] += 1; deg[v] += 1
        adj[u].append(v); adj[v].append(u)
    with_edges = sum(1 for v in range(n) if deg[v] > 0)
    start = next((v for v in range(n) if deg[v] > 0), -1)
    connected = True
    if start != -1:
        seen = [False] * n
        stack = [start]; seen[start] = True; cnt = 1
        while stack:
            x = stack.pop()
            for w in adj[x]:
                if not seen[w]:
                    seen[w] = True; cnt += 1; stack.append(w)
        connected = cnt == with_edges
    odd = sum(1 for v in range(n) if deg[v] % 2 == 1)
    if not connected or odd not in (0, 2):
        print("NO")
    else:
        print("YES", with_edges if odd == 0 else 2)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Distinguishes circuit (any start) from path (exactly 2 starts); rejects disconnected figures.

---

## Intermediate Tasks (5)

### Task 6 — Reconstruct Itinerary (lexicographically smallest)

**Problem.** Given directed tickets `[from, to]`, output the lexicographically smallest Eulerian path starting at `"JFK"`, using all tickets.

**Input / Output spec.**
- Input: `m`, then `m` lines `from to` (airport codes).
- Output: the itinerary, one airport per line.

**Constraints.** `1 <= m <= 10^5`. A valid itinerary is guaranteed.

**Hint.** Sort adjacency ascending (or min-heap); iterative Hierholzer; reverse the popped order.

**Go.**
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
	var m int
	fmt.Fscan(in, &m)
	adj := map[string][]string{}
	for i := 0; i < m; i++ {
		var a, b string
		fmt.Fscan(in, &a, &b)
		adj[a] = append(adj[a], b)
	}
	for k := range adj {
		sort.Strings(adj[k])
	}
	idx := map[string]int{}
	var route, stack []string
	stack = append(stack, "JFK")
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if idx[v] < len(adj[v]) {
			nx := adj[v][idx[v]]
			idx[v]++
			stack = append(stack, nx)
		} else {
			route = append(route, v)
			stack = stack[:len(stack)-1]
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i := len(route) - 1; i >= 0; i-- {
		fmt.Fprintln(out, route[i])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int m = Integer.parseInt(br.readLine().trim());
        Map<String, PriorityQueue<String>> adj = new HashMap<>();
        for (int i = 0; i < m; i++) {
            StringTokenizer st = new StringTokenizer(br.readLine());
            adj.computeIfAbsent(st.nextToken(), x -> new PriorityQueue<>()).add(st.nextToken());
        }
        Deque<String> stack = new ArrayDeque<>();
        LinkedList<String> route = new LinkedList<>();
        stack.push("JFK");
        while (!stack.isEmpty()) {
            String v = stack.peek();
            PriorityQueue<String> pq = adj.get(v);
            if (pq != null && !pq.isEmpty()) stack.push(pq.poll());
            else route.addFirst(stack.pop());
        }
        StringBuilder sb = new StringBuilder();
        for (String s : route) sb.append(s).append('\n');
        System.out.print(sb);
    }
}
```

**Python.**
```python
import heapq
import sys
from collections import defaultdict


def main():
    data = sys.stdin.read().split()
    m = int(data[0])
    adj = defaultdict(list)
    p = 1
    for _ in range(m):
        a, b = data[p], data[p + 1]; p += 2
        heapq.heappush(adj[a], b)
    route, stack = [], ["JFK"]
    while stack:
        v = stack[-1]
        if adj[v]:
            stack.append(heapq.heappop(adj[v]))
        else:
            route.append(stack.pop())
    sys.stdout.write("\n".join(reversed(route)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Output is the lexicographically smallest valid itinerary, uses all tickets, length `m + 1`.

---

### Task 7 — Build a de Bruijn sequence B(k, n)

**Problem.** Output a cyclic de Bruijn sequence over alphabet `{0..k-1}` where every length-`n` string appears exactly once. Output the linear representation of length `k^n` (the cyclic sequence written once).

**Input / Output spec.**
- Input: `k n`.
- Output: the sequence string.

**Constraints.** `1 <= k <= 7`, `1 <= n <= 8`, `k^n <= 2*10^6`.

**Hint.** Eulerian circuit on the de Bruijn graph: vertices are `(n−1)`-mers, edges append a symbol. Collect appended symbols in Euler order.

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
	var k, n int
	fmt.Fscan(in, &k, &n)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	if n == 1 {
		for i := 0; i < k; i++ {
			out.WriteByte(byte('0' + i))
		}
		return
	}
	numV := 1
	for i := 0; i < n-1; i++ {
		numV *= k
	}
	iter := make([]int, numV)
	var nodeStack, edgeStack []int
	var seq []byte
	nodeStack = append(nodeStack, 0)
	edgeStack = append(edgeStack, -1)
	for len(nodeStack) > 0 {
		v := nodeStack[len(nodeStack)-1]
		if iter[v] < k {
			c := iter[v]
			iter[v]++
			nodeStack = append(nodeStack, (v*k+c)%numV)
			edgeStack = append(edgeStack, c)
		} else {
			nodeStack = nodeStack[:len(nodeStack)-1]
			c := edgeStack[len(edgeStack)-1]
			edgeStack = edgeStack[:len(edgeStack)-1]
			if c >= 0 {
				seq = append(seq, byte('0'+c))
			}
		}
	}
	for i, j := 0, len(seq)-1; i < j; i, j = i+1, j-1 {
		seq[i], seq[j] = seq[j], seq[i]
	}
	out.Write(seq)
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int k = (int) in.nval;
        in.nextToken(); int n = (int) in.nval;
        if (n == 1) {
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < k; i++) s.append(i);
            System.out.print(s);
            return;
        }
        int numV = 1;
        for (int i = 0; i < n - 1; i++) numV *= k;
        int[] iter = new int[numV];
        Deque<Integer> nodeStack = new ArrayDeque<>(), edgeStack = new ArrayDeque<>();
        StringBuilder seq = new StringBuilder();
        nodeStack.push(0); edgeStack.push(-1);
        while (!nodeStack.isEmpty()) {
            int v = nodeStack.peek();
            if (iter[v] < k) {
                int c = iter[v]++;
                nodeStack.push((v * k + c) % numV);
                edgeStack.push(c);
            } else {
                nodeStack.pop();
                int c = edgeStack.pop();
                if (c >= 0) seq.append(c);
            }
        }
        System.out.print(seq.reverse());
    }
}
```

**Python.**
```python
import sys


def main():
    k, n = map(int, sys.stdin.read().split())
    if n == 1:
        sys.stdout.write("".join(str(i) for i in range(k)))
        return
    num_v = k ** (n - 1)
    it = [0] * num_v
    node_stack, edge_stack, seq = [0], [-1], []
    while node_stack:
        v = node_stack[-1]
        if it[v] < k:
            c = it[v]; it[v] += 1
            node_stack.append((v * k + c) % num_v)
            edge_stack.append(c)
        else:
            node_stack.pop()
            c = edge_stack.pop()
            if c >= 0:
                seq.append(str(c))
    sys.stdout.write("".join(reversed(seq)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Length is exactly `k^n`; every length-`n` window (cyclically) is distinct; validate on `k=2,n=3`.

---

### Task 8 — Valid Arrangement of Pairs

**Problem.** Given directed `pairs [start, end]`, output an arrangement so consecutive pairs chain (`prev.end == cur.start`), using all pairs. A valid arrangement is guaranteed.

**Input / Output spec.**
- Input: `m`, then `m` lines `start end`.
- Output: `m` lines `start end` in arrangement order.

**Constraints.** `1 <= m <= 10^5`.

**Hint.** Directed Eulerian path; start at the `out−in=+1` vertex if it exists.

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
	var m int
	fmt.Fscan(in, &m)
	adj := map[int][]int{}
	outd := map[int]int{}
	ind := map[int]int{}
	first := 0
	for i := 0; i < m; i++ {
		var s, e int
		fmt.Fscan(in, &s, &e)
		adj[s] = append(adj[s], e)
		outd[s]++
		ind[e]++
		if i == 0 {
			first = s
		}
	}
	start := first
	for v := range outd {
		if outd[v]-ind[v] == 1 {
			start = v
			break
		}
	}
	idx := map[int]int{}
	var route, stack []int
	stack = append(stack, start)
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if idx[v] < len(adj[v]) {
			nx := adj[v][idx[v]]
			idx[v]++
			stack = append(stack, nx)
		} else {
			route = append(route, v)
			stack = stack[:len(stack)-1]
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i := len(route) - 1; i >= 1; i-- {
		fmt.Fprintln(out, route[i], route[i-1])
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
        in.nextToken(); int m = (int) in.nval;
        Map<Integer, Deque<Integer>> adj = new HashMap<>();
        Map<Integer, Integer> outd = new HashMap<>(), ind = new HashMap<>();
        int first = 0;
        for (int i = 0; i < m; i++) {
            in.nextToken(); int s = (int) in.nval;
            in.nextToken(); int e = (int) in.nval;
            adj.computeIfAbsent(s, x -> new ArrayDeque<>()).push(e);
            outd.merge(s, 1, Integer::sum);
            ind.merge(e, 1, Integer::sum);
            if (i == 0) first = s;
        }
        int start = first;
        for (int v : outd.keySet())
            if (outd.get(v) - ind.getOrDefault(v, 0) == 1) { start = v; break; }
        Deque<Integer> stack = new ArrayDeque<>();
        LinkedList<Integer> route = new LinkedList<>();
        stack.push(start);
        while (!stack.isEmpty()) {
            int v = stack.peek();
            Deque<Integer> nb = adj.get(v);
            if (nb != null && !nb.isEmpty()) stack.push(nb.pop());
            else route.addFirst(stack.pop());
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i + 1 < route.size(); i++)
            sb.append(route.get(i)).append(' ').append(route.get(i + 1)).append('\n');
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys
from collections import defaultdict


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    m = int(data[idx]); idx += 1
    adj = defaultdict(list)
    outd, ind = defaultdict(int), defaultdict(int)
    first = None
    for i in range(m):
        s = int(data[idx]); e = int(data[idx + 1]); idx += 2
        adj[s].append(e)
        outd[s] += 1
        ind[e] += 1
        if i == 0:
            first = s
    start = first
    for v in outd:
        if outd[v] - ind[v] == 1:
            start = v
            break
    it = defaultdict(int)
    route, stack = [], [start]
    while stack:
        v = stack[-1]
        if it[v] < len(adj[v]):
            stack.append(adj[v][it[v]])
            it[v] += 1
        else:
            route.append(stack.pop())
    route.reverse()
    out = []
    for i in range(len(route) - 1):
        out.append(f"{route[i]} {route[i + 1]}")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** All pairs used once; consecutive chaining holds; correct when a unique source/sink exists or when it is a circuit.

---

### Task 9 — Smallest superstring of all k-mers (de Bruijn assembly toy)

**Problem.** Given a multiset of length-`L` strings (`k`-mers) over a small alphabet that are guaranteed to form a single Eulerian path in their de Bruijn graph (each `k`-mer is an edge from its `(L−1)`-prefix to its `(L−1)`-suffix), reconstruct the original string.

**Input / Output spec.**
- Input: `m L`, then `m` strings of length `L`.
- Output: the reconstructed string of length `m + L − 1`.

**Constraints.** `1 <= m <= 2*10^5`, `2 <= L <= 32`. A valid reconstruction is guaranteed.

**Hint.** Map each `(L−1)`-mer to an integer id; each `k`-mer is an arc prefix→suffix. Find the start (`out−in=+1`), Hierholzer, then spell: first node's full string, then append the last character of each subsequent node.

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
	var m, L int
	fmt.Fscan(in, &m, &L)
	id := map[string]int{}
	getID := func(s string) int {
		if v, ok := id[s]; ok {
			return v
		}
		v := len(id)
		id[s] = v
		return v
	}
	var label []string
	add := func(s string) int {
		if _, ok := id[s]; !ok {
			label = append(label, s)
		}
		return getID(s)
	}
	adj := map[int][]int{}
	outd := map[int]int{}
	ind := map[int]int{}
	for i := 0; i < m; i++ {
		var s string
		fmt.Fscan(in, &s)
		a := add(s[:L-1])
		b := add(s[1:])
		adj[a] = append(adj[a], b)
		outd[a]++
		ind[b]++
	}
	start := 0
	for v := 0; v < len(label); v++ {
		if outd[v]-ind[v] == 1 {
			start = v
			break
		}
	}
	idx := map[int]int{}
	var route, stack []int
	stack = append(stack, start)
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if idx[v] < len(adj[v]) {
			nx := adj[v][idx[v]]
			idx[v]++
			stack = append(stack, nx)
		} else {
			route = append(route, v)
			stack = stack[:len(stack)-1]
		}
	}
	// reverse route
	for i, j := 0, len(route)-1; i < j; i, j = i+1, j-1 {
		route[i], route[j] = route[j], route[i]
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	if len(route) == 0 {
		return
	}
	out.WriteString(label[route[0]])
	for i := 1; i < len(route); i++ {
		s := label[route[i]]
		out.WriteByte(s[len(s)-1])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int m = (int) in.nval;
        in.nextToken(); int L = (int) in.nval;
        in.ordinaryChars(0, 255);
        in.wordChars('!', '~');
        in.whitespaceChars(0, ' ');
        Map<String, Integer> id = new HashMap<>();
        List<String> label = new ArrayList<>();
        Map<Integer, Deque<Integer>> adj = new HashMap<>();
        int[] outd = new int[2 * m + 5], ind = new int[2 * m + 5];
        for (int i = 0; i < m; i++) {
            in.nextToken();
            String s = in.sval;
            int a = id.computeIfAbsent(s.substring(0, L - 1), x -> { label.add(x); return label.size() - 1; });
            int b = id.computeIfAbsent(s.substring(1), x -> { label.add(x); return label.size() - 1; });
            adj.computeIfAbsent(a, x -> new ArrayDeque<>()).push(b);
            outd[a]++; ind[b]++;
        }
        int start = 0;
        for (int v = 0; v < label.size(); v++) if (outd[v] - ind[v] == 1) { start = v; break; }
        Deque<Integer> stack = new ArrayDeque<>();
        ArrayList<Integer> route = new ArrayList<>();
        stack.push(start);
        while (!stack.isEmpty()) {
            int v = stack.peek();
            Deque<Integer> nb = adj.get(v);
            if (nb != null && !nb.isEmpty()) stack.push(nb.pop());
            else route.add(stack.pop());
        }
        Collections.reverse(route);
        StringBuilder sb = new StringBuilder();
        if (!route.isEmpty()) {
            sb.append(label.get(route.get(0)));
            for (int i = 1; i < route.size(); i++) {
                String s = label.get(route.get(i));
                sb.append(s.charAt(s.length() - 1));
            }
        }
        System.out.print(sb);
    }
}
```

**Python.**
```python
import sys
from collections import defaultdict


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    m = int(data[idx]); idx += 1
    L = int(data[idx]); idx += 1
    id_map = {}
    label = []

    def get_id(s):
        if s in id_map:
            return id_map[s]
        v = len(label)
        id_map[s] = v
        label.append(s)
        return v

    adj = defaultdict(list)
    outd, ind = defaultdict(int), defaultdict(int)
    for _ in range(m):
        s = data[idx].decode(); idx += 1
        a = get_id(s[:L - 1])
        b = get_id(s[1:])
        adj[a].append(b)
        outd[a] += 1
        ind[b] += 1
    start = 0
    for v in range(len(label)):
        if outd[v] - ind[v] == 1:
            start = v
            break
    it = defaultdict(int)
    route, stack = [], [start]
    while stack:
        v = stack[-1]
        if it[v] < len(adj[v]):
            stack.append(adj[v][it[v]])
            it[v] += 1
        else:
            route.append(stack.pop())
    route.reverse()
    if not route:
        return
    out = [label[route[0]]]
    for i in range(1, len(route)):
        out.append(label[route[i]][-1])
    sys.stdout.write("".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Output length is `m + L − 1`; every input `k`-mer is a substring; consistent with a brute reference on tiny inputs.

---

### Task 10 — Eulerian circuit edge sequence (output edge ids)

**Problem.** Given an undirected multigraph with an Eulerian circuit, output the **edge ids** in the order they are traversed (not the vertices). Edges are numbered `0..m-1` in input order.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `m` space-separated edge ids in traversal order.

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 5*10^5`. Circuit guaranteed.

**Hint.** Track, alongside the vertex stack, the edge id used to descend; emit it when you pop, then reverse.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	type half struct{ to, id int }
	adj := make([][]half, n)
	for id := 0; id < m; id++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], half{v, id})
		adj[v] = append(adj[v], half{u, id})
	}
	used := make([]bool, m)
	iter := make([]int, n)
	start := 0
	for v := 0; v < n; v++ {
		if len(adj[v]) > 0 {
			start = v
			break
		}
	}
	vStack := []int{start}
	eStack := []int{-1}
	var order []int
	for len(vStack) > 0 {
		v := vStack[len(vStack)-1]
		adv := false
		for iter[v] < len(adj[v]) {
			h := adj[v][iter[v]]
			iter[v]++
			if !used[h.id] {
				used[h.id] = true
				vStack = append(vStack, h.to)
				eStack = append(eStack, h.id)
				adv = true
				break
			}
		}
		if !adv {
			vStack = vStack[:len(vStack)-1]
			e := eStack[len(eStack)-1]
			eStack = eStack[:len(eStack)-1]
			if e >= 0 {
				order = append(order, e)
			}
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i := len(order) - 1; i >= 0; i-- {
		if i < len(order)-1 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, order[i])
	}
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int id = 0; id < m; id++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            adj[u].add(new int[]{v, id});
            adj[v].add(new int[]{u, id});
        }
        boolean[] used = new boolean[m];
        int[] iter = new int[n];
        int start = 0;
        for (int v = 0; v < n; v++) if (!adj[v].isEmpty()) { start = v; break; }
        Deque<Integer> vStack = new ArrayDeque<>(), eStack = new ArrayDeque<>();
        vStack.push(start); eStack.push(-1);
        ArrayList<Integer> order = new ArrayList<>();
        while (!vStack.isEmpty()) {
            int v = vStack.peek();
            boolean adv = false;
            while (iter[v] < adj[v].size()) {
                int[] h = adj[v].get(iter[v]++);
                if (!used[h[1]]) { used[h[1]] = true; vStack.push(h[0]); eStack.push(h[1]); adv = true; break; }
            }
            if (!adv) {
                vStack.pop();
                int e = eStack.pop();
                if (e >= 0) order.add(e);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = order.size() - 1; i >= 0; i--) {
            if (i < order.size() - 1) sb.append(' ');
            sb.append(order.get(i));
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
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for eid in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, eid))
        adj[v].append((u, eid))
    used = [False] * m
    it = [0] * n
    start = next((v for v in range(n) if adj[v]), 0)
    v_stack = [start]
    e_stack = [-1]
    order = []
    while v_stack:
        v = v_stack[-1]
        adv = False
        while it[v] < len(adj[v]):
            w, eid = adj[v][it[v]]
            it[v] += 1
            if not used[eid]:
                used[eid] = True
                v_stack.append(w)
                e_stack.append(eid)
                adv = True
                break
        if not adv:
            v_stack.pop()
            e = e_stack.pop()
            if e >= 0:
                order.append(e)
    sys.stdout.write(" ".join(map(str, reversed(order))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Exactly `m` edge ids, each exactly once, consecutive edges share a vertex, and the walk closes (first edge's far endpoint chains back).

---

## Advanced Tasks (5)

### Task 11 — Directed Eulerian path with full validation

**Problem.** Given a directed graph, output an Eulerian path if one exists (path or circuit), else `IMPOSSIBLE`. Validate balance, connectivity, and `len == m + 1`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `m + 1` vertices, or `IMPOSSIBLE`.

**Constraints.** `1 <= n <= 2*10^5`, `0 <= m <= 10^6`. Time `O(n + m)`.

**Hint.** Choose start = the `out−in=+1` vertex if present, else any vertex with out-degree. Run Hierholzer iteratively; reject if balance fails or trail length ≠ `m + 1`.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	outd := make([]int, n)
	ind := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		outd[u]++
		ind[v]++
	}
	start, plus, minus := -1, 0, 0
	bad := false
	for v := 0; v < n; v++ {
		d := outd[v] - ind[v]
		if d == 1 {
			plus++
			start = v
		} else if d == -1 {
			minus++
		} else if d != 0 {
			bad = true
		}
		if start == -1 && outd[v] > 0 {
			start = v
		}
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	if bad || !((plus == 0 && minus == 0) || (plus == 1 && minus == 1)) {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	if m == 0 {
		fmt.Fprintln(out, "IMPOSSIBLE") // no edges, no path defined; adjust per spec
		return
	}
	iter := make([]int, n)
	stack := []int{start}
	var trail []int
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if iter[v] < len(adj[v]) {
			w := adj[v][iter[v]]
			iter[v]++
			stack = append(stack, w)
		} else {
			trail = append(trail, v)
			stack = stack[:len(stack)-1]
		}
	}
	if len(trail) != m+1 {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	for i := len(trail) - 1; i >= 0; i-- {
		if i < len(trail)-1 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, trail[i])
	}
	out.WriteByte('\n')
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] outd = new int[n], ind = new int[n];
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            adj[u].add(v); outd[u]++; ind[v]++;
        }
        int start = -1, plus = 0, minus = 0; boolean bad = false;
        for (int v = 0; v < n; v++) {
            int d = outd[v] - ind[v];
            if (d == 1) { plus++; start = v; }
            else if (d == -1) minus++;
            else if (d != 0) bad = true;
            if (start == -1 && outd[v] > 0) start = v;
        }
        if (bad || !((plus == 0 && minus == 0) || (plus == 1 && minus == 1)) || m == 0) {
            System.out.println("IMPOSSIBLE"); return;
        }
        int[] iter = new int[n];
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(start);
        ArrayList<Integer> trail = new ArrayList<>();
        while (!stack.isEmpty()) {
            int v = stack.peek();
            if (iter[v] < adj[v].size()) stack.push(adj[v].get(iter[v]++));
            else trail.add(stack.pop());
        }
        if (trail.size() != m + 1) { System.out.println("IMPOSSIBLE"); return; }
        StringBuilder sb = new StringBuilder();
        for (int i = trail.size() - 1; i >= 0; i--) {
            if (i < trail.size() - 1) sb.append(' ');
            sb.append(trail.get(i));
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
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    outd = [0] * n
    ind = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v); outd[u] += 1; ind[v] += 1
    start, plus, minus, bad = -1, 0, 0, False
    for v in range(n):
        d = outd[v] - ind[v]
        if d == 1:
            plus += 1; start = v
        elif d == -1:
            minus += 1
        elif d != 0:
            bad = True
        if start == -1 and outd[v] > 0:
            start = v
    if bad or not ((plus == 0 and minus == 0) or (plus == 1 and minus == 1)) or m == 0:
        print("IMPOSSIBLE")
        return
    it = [0] * n
    stack = [start]
    trail = []
    while stack:
        v = stack[-1]
        if it[v] < len(adj[v]):
            stack.append(adj[v][it[v]])
            it[v] += 1
        else:
            trail.append(stack.pop())
    if len(trail) != m + 1:
        print("IMPOSSIBLE")
        return
    sys.stdout.write(" ".join(map(str, reversed(trail))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Returns `IMPOSSIBLE` for unbalanced or disconnected graphs; correct path otherwise; `O(n + m)`.

---

### Task 12 — Chinese Postman (undirected, small)

**Problem.** Given a connected weighted undirected graph, return the minimum total distance of a closed walk that traverses every edge at least once.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w`.
- Output: the minimum total distance.

**Constraints.** `1 <= n <= 16`, `1 <= m <= 200`, `1 <= w <= 10^6`. (Small `n` so odd-vertex matching is feasible via bitmask DP.)

**Hint.** Sum all edge weights. Find odd-degree vertices. All-pairs shortest paths (Floyd–Warshall). Minimum-weight perfect matching over odd vertices via bitmask DP. Answer = total + matching cost.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const INF = int64(1) << 60

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	fmt.Fscan(in, &n, &m)
	dist := make([][]int64, n)
	for i := range dist {
		dist[i] = make([]int64, n)
		for j := range dist[i] {
			if i != j {
				dist[i][j] = INF
			}
		}
	}
	deg := make([]int, n)
	var total int64
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		if w < dist[u][v] {
			dist[u][v] = w
			dist[v][u] = w
		}
		deg[u]++
		deg[v]++
		total += w
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				if dist[i][k]+dist[k][j] < dist[i][j] {
					dist[i][j] = dist[i][k] + dist[k][j]
				}
			}
		}
	}
	var odd []int
	for v := 0; v < n; v++ {
		if deg[v]%2 == 1 {
			odd = append(odd, v)
		}
	}
	K := len(odd)
	full := 1 << K
	dp := make([]int64, full)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0
	for mask := 0; mask < full; mask++ {
		if dp[mask] == INF {
			continue
		}
		i := 0
		for i < K && mask&(1<<i) != 0 {
			i++
		}
		if i == K {
			continue
		}
		for j := i + 1; j < K; j++ {
			if mask&(1<<j) != 0 {
				continue
			}
			nm := mask | (1 << i) | (1 << j)
			c := dp[mask] + dist[odd[i]][odd[j]]
			if c < dp[nm] {
				dp[nm] = c
			}
		}
	}
	fmt.Println(total + dp[full-1])
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static final long INF = 1L << 60;
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        long[][] dist = new long[n][n];
        for (long[] row : dist) Arrays.fill(row, INF);
        for (int i = 0; i < n; i++) dist[i][i] = 0;
        int[] deg = new int[n];
        long total = 0;
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            in.nextToken(); long w = (long) in.nval;
            if (w < dist[u][v]) { dist[u][v] = w; dist[v][u] = w; }
            deg[u]++; deg[v]++; total += w;
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
        List<Integer> odd = new ArrayList<>();
        for (int v = 0; v < n; v++) if (deg[v] % 2 == 1) odd.add(v);
        int K = odd.size(), full = 1 << K;
        long[] dp = new long[full];
        Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int mask = 0; mask < full; mask++) {
            if (dp[mask] == INF) continue;
            int i = 0;
            while (i < K && (mask & (1 << i)) != 0) i++;
            if (i == K) continue;
            for (int j = i + 1; j < K; j++) {
                if ((mask & (1 << j)) != 0) continue;
                int nm = mask | (1 << i) | (1 << j);
                long c = dp[mask] + dist[odd.get(i)][odd.get(j)];
                if (c < dp[nm]) dp[nm] = c;
            }
        }
        System.out.println(total + dp[full - 1]);
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
    m = int(data[idx]); idx += 1
    INF = float("inf")
    dist = [[INF] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    deg = [0] * n
    total = 0
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3
        if w < dist[u][v]:
            dist[u][v] = dist[v][u] = w
        deg[u] += 1
        deg[v] += 1
        total += w
    for k in range(n):
        dk = dist[k]
        for i in range(n):
            dik = dist[i][k]
            if dik == INF:
                continue
            di = dist[i]
            for j in range(n):
                nd = dik + dk[j]
                if nd < di[j]:
                    di[j] = nd
    odd = [v for v in range(n) if deg[v] % 2 == 1]
    K = len(odd)
    full = 1 << K
    dp = [INF] * full
    dp[0] = 0
    for mask in range(full):
        if dp[mask] == INF:
            continue
        i = 0
        while i < K and (mask >> i) & 1:
            i += 1
        if i == K:
            continue
        for j in range(i + 1, K):
            if (mask >> j) & 1:
                continue
            nm = mask | (1 << i) | (1 << j)
            c = dp[mask] + dist[odd[i]][odd[j]]
            if c < dp[nm]:
                dp[nm] = c
    print(total + dp[full - 1])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Equals total edge weight when already Eulerian (no odd vertices); correct matching cost otherwise; handles multi-edges (keep min weight).

---

### Task 13 — Count Eulerian circuits in a directed graph (BEST theorem)

**Problem.** Given a small connected balanced directed graph (`in==out` everywhere), count its Eulerian circuits modulo a prime, using the BEST theorem.

**Input / Output spec.**
- Input: `n m MOD`, then `m` lines `u v`.
- Output: number of Eulerian circuits mod `MOD`, or `0` if the graph is not Eulerian.

**Constraints.** `1 <= n <= 60`, `1 <= m <= 2000`. `MOD` is a prime up to `10^9+7`.

**Hint.** `ec = (#arborescences rooted at vertex 0) * Π (out(v) - 1)!`. Arborescence count = a cofactor of the directed Laplacian (Matrix-Tree). Compute the determinant of the `(n-1)x(n-1)` reduced Laplacian modulo `MOD` via Gaussian elimination with modular inverses. Multiply by the factorial product.

**Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func power(a, b, mod int64) int64 {
	a %= mod
	r := int64(1)
	for b > 0 {
		if b&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		b >>= 1
	}
	return r
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m int
	var MOD int64
	fmt.Fscan(in, &n, &m, &MOD)
	out := make([]int64, n)
	ind := make([]int64, n)
	// Laplacian L[i][j] = (i==j? outdeg : 0) - (#arcs i->j)
	L := make([][]int64, n)
	for i := range L {
		L[i] = make([]int64, n)
	}
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		out[u]++
		ind[v]++
		L[u][u] = (L[u][u] + 1) % MOD
		L[u][v] = (L[u][v] - 1 + MOD) % MOD
	}
	for v := 0; v < n; v++ {
		if out[v] != ind[v] {
			fmt.Println(0)
			return
		}
	}
	// reduced Laplacian: delete row 0 and col 0 -> (n-1)x(n-1)
	sz := n - 1
	a := make([][]int64, sz)
	for i := 0; i < sz; i++ {
		a[i] = make([]int64, sz)
		for j := 0; j < sz; j++ {
			a[i][j] = L[i+1][j+1]
		}
	}
	det := int64(1)
	for col := 0; col < sz; col++ {
		piv := -1
		for r := col; r < sz; r++ {
			if a[r][col] != 0 {
				piv = r
				break
			}
		}
		if piv == -1 {
			det = 0
			break
		}
		if piv != col {
			a[piv], a[col] = a[col], a[piv]
			det = (MOD - det) % MOD
		}
		det = det * a[col][col] % MOD
		inv := power(a[col][col], MOD-2, MOD)
		for r := col + 1; r < sz; r++ {
			f := a[r][col] * inv % MOD
			for c := col; c < sz; c++ {
				a[r][c] = (a[r][c] - f*a[col][c]%MOD + MOD) % MOD
			}
		}
	}
	res := det % MOD
	for v := 0; v < n; v++ {
		if out[v] > 0 {
			f := int64(1)
			for x := int64(1); x < out[v]; x++ {
				f = f * (x % MOD) % MOD
			}
			res = res * f % MOD
		}
	}
	fmt.Println(res % MOD)
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static long power(long a, long b, long mod) {
        a %= mod; long r = 1;
        while (b > 0) { if ((b & 1) == 1) r = r * a % mod; a = a * a % mod; b >>= 1; }
        return r;
    }
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        in.nextToken(); long MOD = (long) in.nval;
        long[] out = new long[n], ind = new long[n];
        long[][] L = new long[n][n];
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            out[u]++; ind[v]++;
            L[u][u] = (L[u][u] + 1) % MOD;
            L[u][v] = (L[u][v] - 1 + MOD) % MOD;
        }
        for (int v = 0; v < n; v++) if (out[v] != ind[v]) { System.out.println(0); return; }
        int sz = n - 1;
        long[][] a = new long[sz][sz];
        for (int i = 0; i < sz; i++)
            for (int j = 0; j < sz; j++) a[i][j] = L[i + 1][j + 1];
        long det = 1;
        for (int col = 0; col < sz; col++) {
            int piv = -1;
            for (int r = col; r < sz; r++) if (a[r][col] != 0) { piv = r; break; }
            if (piv == -1) { det = 0; break; }
            if (piv != col) { long[] t = a[piv]; a[piv] = a[col]; a[col] = t; det = (MOD - det) % MOD; }
            det = det * a[col][col] % MOD;
            long inv = power(a[col][col], MOD - 2, MOD);
            for (int r = col + 1; r < sz; r++) {
                long f = a[r][col] * inv % MOD;
                for (int c = col; c < sz; c++)
                    a[r][c] = (a[r][c] - f * a[col][c] % MOD + MOD) % MOD;
            }
        }
        long res = det % MOD;
        for (int v = 0; v < n; v++) if (out[v] > 0) {
            long f = 1;
            for (long x = 1; x < out[v]; x++) f = f * (x % MOD) % MOD;
            res = res * f % MOD;
        }
        System.out.println(res % MOD);
    }
}
```

**Python.**
```python
import sys


def power(a, b, mod):
    a %= mod
    r = 1
    while b:
        if b & 1:
            r = r * a % mod
        a = a * a % mod
        b >>= 1
    return r


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    MOD = int(data[idx]); idx += 1
    out = [0] * n
    ind = [0] * n
    L = [[0] * n for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        out[u] += 1
        ind[v] += 1
        L[u][u] = (L[u][u] + 1) % MOD
        L[u][v] = (L[u][v] - 1) % MOD
    if any(out[v] != ind[v] for v in range(n)):
        print(0)
        return
    sz = n - 1
    a = [[L[i + 1][j + 1] % MOD for j in range(sz)] for i in range(sz)]
    det = 1
    for col in range(sz):
        piv = -1
        for r in range(col, sz):
            if a[r][col] != 0:
                piv = r
                break
        if piv == -1:
            det = 0
            break
        if piv != col:
            a[piv], a[col] = a[col], a[piv]
            det = (-det) % MOD
        det = det * a[col][col] % MOD
        inv = power(a[col][col], MOD - 2, MOD)
        for r in range(col + 1, sz):
            f = a[r][col] * inv % MOD
            for c in range(col, sz):
                a[r][c] = (a[r][c] - f * a[col][c]) % MOD
    res = det % MOD
    for v in range(n):
        if out[v] > 0:
            f = 1
            for x in range(1, out[v]):
                f = f * x % MOD
            res = res * f % MOD
    print(res % MOD)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Matches a brute-force enumeration on tiny graphs (e.g., a single directed cycle has exactly 1 circuit); returns 0 for unbalanced graphs; modular determinant correct.

---

### Task 14 — Mixed-graph one-stroke with edge directions partially fixed (greedy check)

**Problem.** Given an undirected graph plus the requirement that the trail must *start* and *end* at two specific given vertices `s` and `t` (`s != t`), decide whether an Eulerian path from `s` to `t` exists, and if so output it.

**Input / Output spec.**
- Input: `n m s t`, then `m` lines `u v`.
- Output: the vertex sequence (`m+1` vertices) or `IMPOSSIBLE`.

**Constraints.** `1 <= n <= 10^5`, `1 <= m <= 5*10^5`.

**Hint.** An `s→t` Eulerian path exists iff the graph is connected on edge-bearing vertices and the only odd-degree vertices are exactly `s` and `t` (i.e., `deg(s)` and `deg(t)` odd, all others even). Then Hierholzer from `s`.

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
	var n, m, s, t int
	fmt.Fscan(in, &n, &m, &s, &t)
	type half struct{ to, id int }
	adj := make([][]half, n)
	deg := make([]int, n)
	for id := 0; id < m; id++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], half{v, id})
		adj[v] = append(adj[v], half{u, id})
		deg[u]++
		deg[v]++
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	// odd vertices must be exactly {s, t}
	ok := true
	for v := 0; v < n; v++ {
		odd := deg[v]%2 == 1
		if odd != (v == s || v == t) {
			ok = false
			break
		}
	}
	if s == t || !ok {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	used := make([]bool, m)
	iter := make([]int, n)
	stack := []int{s}
	var trail []int
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		adv := false
		for iter[v] < len(adj[v]) {
			h := adj[v][iter[v]]
			iter[v]++
			if !used[h.id] {
				used[h.id] = true
				stack = append(stack, h.to)
				adv = true
				break
			}
		}
		if !adv {
			trail = append(trail, v)
			stack = stack[:len(stack)-1]
		}
	}
	if len(trail) != m+1 || trail[0] != t {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	for i := len(trail) - 1; i >= 0; i-- {
		if i < len(trail)-1 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, trail[i])
	}
	out.WriteByte('\n')
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        in.nextToken(); int s = (int) in.nval;
        in.nextToken(); int t = (int) in.nval;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] deg = new int[n];
        for (int id = 0; id < m; id++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            adj[u].add(new int[]{v, id});
            adj[v].add(new int[]{u, id});
            deg[u]++; deg[v]++;
        }
        boolean ok = s != t;
        for (int v = 0; v < n && ok; v++) {
            boolean odd = deg[v] % 2 == 1;
            if (odd != (v == s || v == t)) ok = false;
        }
        if (!ok) { System.out.println("IMPOSSIBLE"); return; }
        boolean[] used = new boolean[m];
        int[] iter = new int[n];
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(s);
        ArrayList<Integer> trail = new ArrayList<>();
        while (!stack.isEmpty()) {
            int v = stack.peek();
            boolean adv = false;
            while (iter[v] < adj[v].size()) {
                int[] h = adj[v].get(iter[v]++);
                if (!used[h[1]]) { used[h[1]] = true; stack.push(h[0]); adv = true; break; }
            }
            if (!adv) trail.add(stack.pop());
        }
        if (trail.size() != m + 1 || trail.get(0) != t) { System.out.println("IMPOSSIBLE"); return; }
        StringBuilder sb = new StringBuilder();
        for (int i = trail.size() - 1; i >= 0; i--) {
            if (i < trail.size() - 1) sb.append(' ');
            sb.append(trail.get(i));
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
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    s = int(data[idx]); idx += 1
    t = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    deg = [0] * n
    for eid in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append((v, eid))
        adj[v].append((u, eid))
        deg[u] += 1
        deg[v] += 1
    ok = s != t
    for v in range(n):
        odd = deg[v] % 2 == 1
        if odd != (v == s or v == t):
            ok = False
            break
    if not ok:
        print("IMPOSSIBLE")
        return
    used = [False] * m
    it = [0] * n
    stack = [s]
    trail = []
    while stack:
        v = stack[-1]
        adv = False
        while it[v] < len(adj[v]):
            w, eid = adj[v][it[v]]
            it[v] += 1
            if not used[eid]:
                used[eid] = True
                stack.append(w)
                adv = True
                break
        if not adv:
            trail.append(stack.pop())
    if len(trail) != m + 1 or trail[0] != t:
        print("IMPOSSIBLE")
        return
    sys.stdout.write(" ".join(map(str, reversed(trail))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Path begins at `s`, ends at `t`, uses all edges; rejects when odd-vertex set is not exactly `{s, t}` or when disconnected.

---

### Task 15 — Strongly connected check + directed Eulerian circuit

**Problem.** Given a directed graph, output an Eulerian **circuit** (closed) if one exists, else `IMPOSSIBLE`. You must verify both `in==out` everywhere and that all edge-bearing vertices form one strongly connected piece.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v`.
- Output: `m + 1` vertices forming a closed circuit, or `IMPOSSIBLE`.

**Constraints.** `1 <= n <= 2*10^5`, `0 <= m <= 10^6`.

**Hint.** Balance: every vertex `in==out`. Then a single Hierholzer run that consumes all `m` edges (length `m+1` and first==last) confirms the circuit; the `len==m+1` check subsumes connectivity for the balanced case.

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	outd := make([]int, n)
	ind := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		outd[u]++
		ind[v]++
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for v := 0; v < n; v++ {
		if outd[v] != ind[v] {
			fmt.Fprintln(out, "IMPOSSIBLE")
			return
		}
	}
	if m == 0 {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	start := -1
	for v := 0; v < n; v++ {
		if outd[v] > 0 {
			start = v
			break
		}
	}
	iter := make([]int, n)
	stack := []int{start}
	var trail []int
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		if iter[v] < len(adj[v]) {
			w := adj[v][iter[v]]
			iter[v]++
			stack = append(stack, w)
		} else {
			trail = append(trail, v)
			stack = stack[:len(stack)-1]
		}
	}
	if len(trail) != m+1 || trail[0] != trail[len(trail)-1] {
		fmt.Fprintln(out, "IMPOSSIBLE")
		return
	}
	for i := len(trail) - 1; i >= 0; i-- {
		if i < len(trail)-1 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, trail[i])
	}
	out.WriteByte('\n')
}
```

**Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        in.nextToken(); int n = (int) in.nval;
        in.nextToken(); int m = (int) in.nval;
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] outd = new int[n], ind = new int[n];
        for (int i = 0; i < m; i++) {
            in.nextToken(); int u = (int) in.nval;
            in.nextToken(); int v = (int) in.nval;
            adj[u].add(v); outd[u]++; ind[v]++;
        }
        for (int v = 0; v < n; v++) if (outd[v] != ind[v]) { System.out.println("IMPOSSIBLE"); return; }
        if (m == 0) { System.out.println("IMPOSSIBLE"); return; }
        int start = -1;
        for (int v = 0; v < n; v++) if (outd[v] > 0) { start = v; break; }
        int[] iter = new int[n];
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(start);
        ArrayList<Integer> trail = new ArrayList<>();
        while (!stack.isEmpty()) {
            int v = stack.peek();
            if (iter[v] < adj[v].size()) stack.push(adj[v].get(iter[v]++));
            else trail.add(stack.pop());
        }
        if (trail.size() != m + 1 || !trail.get(0).equals(trail.get(trail.size() - 1))) {
            System.out.println("IMPOSSIBLE"); return;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = trail.size() - 1; i >= 0; i--) {
            if (i < trail.size() - 1) sb.append(' ');
            sb.append(trail.get(i));
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
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    outd = [0] * n
    ind = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        outd[u] += 1
        ind[v] += 1
    if any(outd[v] != ind[v] for v in range(n)) or m == 0:
        print("IMPOSSIBLE")
        return
    start = next((v for v in range(n) if outd[v] > 0), -1)
    it = [0] * n
    stack = [start]
    trail = []
    while stack:
        v = stack[-1]
        if it[v] < len(adj[v]):
            stack.append(adj[v][it[v]])
            it[v] += 1
        else:
            trail.append(stack.pop())
    if len(trail) != m + 1 or trail[0] != trail[-1]:
        print("IMPOSSIBLE")
        return
    sys.stdout.write(" ".join(map(str, reversed(trail))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.** Closed circuit (first==last); rejects balanced-but-disconnected via the length check; `O(n + m)`.

---

## Benchmark Task

### Task B — Hierholzer vs Fleury timing across Go, Java, Python

**Problem.** For each language, build a connected Eulerian undirected multigraph with `m` edges (e.g., `c` overlapping even cycles), then measure:

- **(a)** Iterative Hierholzer with the `iter[]` pointer — `O(E)`.
- **(b)** A naive Hierholzer that re-scans each adjacency list from index 0 on every visit — `O(E²)` (run only for small `m`).
- **(c)** Fleury's algorithm with a per-edge bridge check — `O(E²)` (run only for small `m`).

Run (a) for `m ∈ {10^4, 10^5, 10^6}`; run (b) and (c) only for `m ∈ {10^2, 10^3, 5*10^3}` because they explode. Report mean wall-clock over 5 runs in milliseconds, same RNG seed across languages.

**Input / Output spec.**
- No stdin. Output a fixed table:

```text
m         a_hierholzer_ms   b_naive_ms        c_fleury_ms
...
```

**Constraints.** Seed `42`. Time only the algorithm, not graph construction.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

// buildEulerian returns an even, connected undirected multigraph as edge list.
func buildEulerian(m int, seed int64) [][2]int {
	r := rand.New(rand.NewSource(seed))
	edges := make([][2]int, 0, m)
	// chain of triangles keeps every vertex even and graph connected
	v := 0
	for len(edges) < m {
		a, b, c := v, v+1, v+2
		edges = append(edges, [2]int{a, b}, [2]int{b, c}, [2]int{c, a})
		v += 2 // share a vertex with next triangle
		_ = r
	}
	return edges[:m]
}

func hierholzer(n int, edges [][2]int) int {
	type half struct{ to, id int }
	adj := make([][]half, n)
	for id, e := range edges {
		adj[e[0]] = append(adj[e[0]], half{e[1], id})
		adj[e[1]] = append(adj[e[1]], half{e[0], id})
	}
	used := make([]bool, len(edges))
	iter := make([]int, n)
	stack := []int{edges[0][0]}
	cnt := 0
	for len(stack) > 0 {
		v := stack[len(stack)-1]
		adv := false
		for iter[v] < len(adj[v]) {
			h := adj[v][iter[v]]
			iter[v]++
			if !used[h.id] {
				used[h.id] = true
				stack = append(stack, h.to)
				adv = true
				break
			}
		}
		if !adv {
			cnt++
			stack = stack[:len(stack)-1]
		}
	}
	return cnt
}

func main() {
	fmt.Println("m         a_hierholzer_ms")
	for _, m := range []int{10000, 100000, 1000000} {
		edges := buildEulerian(m, 42)
		n := 2*m/2 + 5
		var times []time.Duration
		for i := 0; i < 5; i++ {
			t := time.Now()
			hierholzer(n, edges)
			times = append(times, time.Since(t))
		}
		var s int64
		for _, d := range times {
			s += d.Microseconds()
		}
		fmt.Printf("%-9d %-16.2f\n", m, float64(s)/float64(len(times))/1000.0)
	}
}
```

**Java.**
```java
import java.util.*;

public class TaskB {
    static int[][] buildEulerian(int m) {
        List<int[]> edges = new ArrayList<>();
        int v = 0;
        while (edges.size() < m) {
            int a = v, b = v + 1, c = v + 2;
            edges.add(new int[]{a, b});
            edges.add(new int[]{b, c});
            edges.add(new int[]{c, a});
            v += 2;
        }
        return edges.subList(0, m).toArray(new int[0][]);
    }

    static int hierholzer(int n, int[][] edges) {
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int id = 0; id < edges.length; id++) {
            adj[edges[id][0]].add(new int[]{edges[id][1], id});
            adj[edges[id][1]].add(new int[]{edges[id][0], id});
        }
        boolean[] used = new boolean[edges.length];
        int[] iter = new int[n];
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(edges[0][0]);
        int cnt = 0;
        while (!stack.isEmpty()) {
            int v = stack.peek();
            boolean adv = false;
            while (iter[v] < adj[v].size()) {
                int[] h = adj[v].get(iter[v]++);
                if (!used[h[1]]) { used[h[1]] = true; stack.push(h[0]); adv = true; break; }
            }
            if (!adv) { cnt++; stack.pop(); }
        }
        return cnt;
    }

    public static void main(String[] args) {
        System.out.println("m         a_hierholzer_ms");
        for (int m : new int[]{10_000, 100_000, 1_000_000}) {
            int[][] edges = buildEulerian(m);
            int n = m + 5;
            long sum = 0;
            for (int i = 0; i < 5; i++) {
                long t = System.nanoTime();
                hierholzer(n, edges);
                sum += System.nanoTime() - t;
            }
            System.out.printf("%-9d %-16.2f%n", m, (sum / 5.0) / 1_000_000.0);
        }
    }
}
```

**Python.**
```python
import time


def build_eulerian(m):
    edges = []
    v = 0
    while len(edges) < m:
        a, b, c = v, v + 1, v + 2
        edges.extend([(a, b), (b, c), (c, a)])
        v += 2
    return edges[:m]


def hierholzer(n, edges):
    adj = [[] for _ in range(n)]
    for eid, (u, w) in enumerate(edges):
        adj[u].append((w, eid))
        adj[w].append((u, eid))
    used = [False] * len(edges)
    it = [0] * n
    stack = [edges[0][0]]
    cnt = 0
    while stack:
        v = stack[-1]
        adv = False
        while it[v] < len(adj[v]):
            w, eid = adj[v][it[v]]
            it[v] += 1
            if not used[eid]:
                used[eid] = True
                stack.append(w)
                adv = True
                break
        if not adv:
            cnt += 1
            stack.pop()
    return cnt


def main():
    print("m         a_hierholzer_ms")
    for m in (10_000, 100_000, 1_000_000):
        edges = build_eulerian(m)
        n = m + 5
        times = []
        for _ in range(5):
            t = time.perf_counter()
            hierholzer(n, edges)
            times.append(time.perf_counter() - t)
        print(f"{m:<9d} {sum(times) / len(times) * 1000:<16.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- (a) scales linearly: doubling `m` roughly doubles the time.
- (b) and (c) scale quadratically and become unusable past a few thousand edges — demonstrating why Hierholzer's `iter[]` pointer matters and why Fleury is avoided.
- Same seed yields identical graphs across languages.
- Writeup: a short note on the constant-factor gap between the compiled languages and Python on workload (a).
