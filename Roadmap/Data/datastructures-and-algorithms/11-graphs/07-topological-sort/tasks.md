# Topological Sort — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a full reference solution in all three languages.
> Unless stated otherwise, edges are directed and `u → v` means "`u` must come before `v`".

---

## Beginner Tasks (5)

### Task 1 — Kahn's algorithm from scratch

**Problem.** Read a DAG and output one valid topological order using Kahn's algorithm (BFS on in-degrees). If the graph contains a cycle, output the single word `CYCLE`.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v` denoting an edge `u → v`. Vertices are `0..n-1`.
- Output: a valid topological order (space-separated) or `CYCLE`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- Time `O(V + E)`.

**Hint.** Compute `indeg[]`, queue all in-degree-0 vertices, emit and decrement. If you emit fewer than `n` vertices, report `CYCLE`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	if len(order) != n {
		fmt.Fprintln(out, "CYCLE")
		return
	}
	strs := make([]string, n)
	for i, v := range order {
		strs[i] = fmt.Sprint(v)
	}
	fmt.Fprintln(out, strings.Join(strs, " "))
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer st = new StreamTokenizer(br);
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        StringBuilder sb = new StringBuilder();
        int cnt = 0;
        while (!q.isEmpty()) {
            int u = q.poll();
            if (cnt++ > 0) sb.append(' ');
            sb.append(u);
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        System.out.println(cnt == n ? sb.toString() : "CYCLE");
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
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    print(" ".join(map(str, order)) if len(order) == n else "CYCLE")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Runs in `O(V + E)`.
- Correctly outputs `CYCLE` for cyclic input.
- Output passes a validator: for every edge `u → v`, `index(u) < index(v)`.

---

### Task 2 — DFS-based topological sort

**Problem.** Same input as Task 1, but produce the order using DFS reverse post-order. Output one valid order, or `CYCLE`.

**Input / Output spec.** Identical to Task 1.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- Use the three-color (white/gray/black) scheme to detect cycles.

**Hint.** Append each vertex *after* visiting all its neighbours, then reverse. A gray neighbour is a back edge ⟹ cycle. For very deep graphs prefer an explicit stack.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
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
	}
	color := make([]int, n) // 0 white, 1 gray, 2 black
	order := make([]int, 0, n)
	acyclic := true
	var dfs func(u int)
	dfs = func(u int) {
		color[u] = 1
		for _, w := range adj[u] {
			if color[w] == 1 {
				acyclic = false
			} else if color[w] == 0 {
				dfs(w)
			}
		}
		color[u] = 2
		order = append(order, u)
	}
	for v := 0; v < n; v++ {
		if color[v] == 0 {
			dfs(v)
		}
	}
	if !acyclic {
		fmt.Fprintln(out, "CYCLE")
		return
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	strs := make([]string, n)
	for i, v := range order {
		strs[i] = fmt.Sprint(v)
	}
	fmt.Fprintln(out, strings.Join(strs, " "))
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    static int[] color;
    static List<List<Integer>> adj;
    static List<Integer> order = new ArrayList<>();
    static boolean acyclic = true;

    static void dfs(int u) {
        color[u] = 1;
        for (int w : adj.get(u)) {
            if (color[w] == 1) acyclic = false;
            else if (color[w] == 0) dfs(w);
        }
        color[u] = 2;
        order.add(u);
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
        }
        color = new int[n];
        for (int v = 0; v < n; v++) if (color[v] == 0) dfs(v);
        if (!acyclic) { System.out.println("CYCLE"); return; }
        Collections.reverse(order);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < order.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(order.get(i));
        }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    sys.setrecursionlimit(300000)
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
    color = [0] * n
    order = []
    acyclic = True

    def dfs(u):
        nonlocal acyclic
        color[u] = 1
        for w in adj[u]:
            if color[w] == 1:
                acyclic = False
            elif color[w] == 0:
                dfs(w)
        color[u] = 2
        order.append(u)

    for v in range(n):
        if color[v] == 0:
            dfs(v)
    print(" ".join(map(str, reversed(order))) if acyclic else "CYCLE")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output is a valid topological order (validated by the edge property).
- Cycles correctly reported.
- Handles disconnected graphs by looping over all vertices.

---

### Task 3 — Detect a cycle in a directed graph

**Problem.** Given a directed graph, print `true` if it contains a cycle and `false` otherwise.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: `true` or `false`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(V + E)`.

**Hint.** Either run Kahn's and test "emitted < n", or DFS and test for a back edge. The Kahn variant is recursion-free.

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
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	seen := 0
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		seen++
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	fmt.Println(seen != n)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        int seen = 0;
        while (!q.isEmpty()) {
            int u = q.poll();
            seen++;
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        System.out.println(seen != n);
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
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    seen = 0
    while queue:
        u = queue.popleft()
        seen += 1
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    print(str(seen != n).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on self-loops (a self-loop is a cycle).
- Correct on disconnected graphs.
- Single `O(V + E)` pass.

---

### Task 4 — Validate a given order is a valid topological order

**Problem.** Given a DAG and a candidate ordering of all `n` vertices, report whether it is a valid topological order.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`, then a line with `n` vertices — the candidate order.
- Output: `true` or `false`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(V + E)`.

**Hint.** Build `position[v]` = index of `v` in the candidate. The order is valid iff for every edge `u → v`, `position[u] < position[v]` (and the candidate is a permutation of all vertices).

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
	type E struct{ u, v int }
	edges := make([]E, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(in, &edges[i].u, &edges[i].v)
	}
	pos := make([]int, n)
	seen := make([]bool, n)
	ok := true
	for i := 0; i < n; i++ {
		var v int
		fmt.Fscan(in, &v)
		if v < 0 || v >= n || seen[v] {
			ok = false
		} else {
			seen[v] = true
			pos[v] = i
		}
	}
	if ok {
		for _, e := range edges {
			if pos[e.u] >= pos[e.v] {
				ok = false
				break
			}
		}
	}
	fmt.Println(ok)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task4 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        int[] eu = new int[m], ev = new int[m];
        for (int i = 0; i < m; i++) {
            st.nextToken(); eu[i] = (int) st.nval;
            st.nextToken(); ev[i] = (int) st.nval;
        }
        int[] pos = new int[n];
        boolean[] seen = new boolean[n];
        boolean ok = true;
        for (int i = 0; i < n; i++) {
            st.nextToken(); int v = (int) st.nval;
            if (v < 0 || v >= n || seen[v]) ok = false;
            else { seen[v] = true; pos[v] = i; }
        }
        if (ok)
            for (int i = 0; i < m; i++)
                if (pos[eu[i]] >= pos[ev[i]]) { ok = false; break; }
        System.out.println(ok);
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
    edges = []
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        edges.append((u, v))
    pos = [-1] * n
    ok = True
    for i in range(n):
        v = int(data[idx]); idx += 1
        if v < 0 or v >= n or pos[v] != -1:
            ok = False
        else:
            pos[v] = i
    if ok:
        for u, v in edges:
            if pos[u] >= pos[v]:
                ok = False
                break
    print(str(ok).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Rejects orders that are not permutations of all vertices.
- Accepts any valid order (not just one canonical answer).
- Single linear pass over edges.

---

### Task 5 — Course Schedule (can finish?)

**Problem.** Given `numCourses` and `prerequisites` where `[a, b]` means take `b` before `a`, output `true` if all courses can be finished, else `false`.

**Input / Output spec.**
- Input: `numCourses p`, then `p` lines `a b`.
- Output: `true` or `false`.

**Constraints.**
- `1 <= numCourses <= 2000`.
- `O(V + E)`.

**Hint.** Edge `b → a`; run Kahn's; answer is "emitted == numCourses".

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
	var n, p int
	fmt.Fscan(in, &n, &p)
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < p; i++ {
		var a, b int
		fmt.Fscan(in, &a, &b)
		adj[b] = append(adj[b], a)
		indeg[a]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	seen := 0
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		seen++
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	fmt.Println(seen == n)
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), p = sc.nextInt();
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < p; i++) {
            int a = sc.nextInt(), b = sc.nextInt();
            adj.get(b).add(a);
            indeg[a]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        int seen = 0;
        while (!q.isEmpty()) {
            int u = q.poll();
            seen++;
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        System.out.println(seen == n);
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
    p = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(p):
        a = int(data[idx]); b = int(data[idx + 1]); idx += 2
        adj[b].append(a)
        indeg[a] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    seen = 0
    while queue:
        u = queue.popleft()
        seen += 1
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    print(str(seen == n).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `true` for an empty prerequisite list.
- `false` exactly when a cycle exists.
- Linear time.

---

## Intermediate Tasks (5)

### Task 6 — Lexicographically smallest topological order

**Problem.** Output the lexicographically smallest valid topological order, or `CYCLE`.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: the lexicographically smallest order (space-separated) or `CYCLE`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- Time `O(V log V + E)`.

**Hint.** Kahn's algorithm with a min-heap frontier instead of a FIFO queue.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
	"strings"
)

type IntHeap []int

func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)        { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	h := &IntHeap{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			heap.Push(h, v)
		}
	}
	order := []int{}
	for h.Len() > 0 {
		u := heap.Pop(h).(int)
		order = append(order, u)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				heap.Push(h, w)
			}
		}
	}
	if len(order) != n {
		fmt.Fprintln(out, "CYCLE")
		return
	}
	strs := make([]string, n)
	for i, v := range order {
		strs[i] = fmt.Sprint(v)
	}
	fmt.Fprintln(out, strings.Join(strs, " "))
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task6 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) pq.add(v);
        StringBuilder sb = new StringBuilder();
        int cnt = 0;
        while (!pq.isEmpty()) {
            int u = pq.poll();
            if (cnt++ > 0) sb.append(' ');
            sb.append(u);
            for (int w : adj.get(u)) if (--indeg[w] == 0) pq.add(w);
        }
        System.out.println(cnt == n ? sb.toString() : "CYCLE");
    }
}
```

**Reference — Python.**
```python
import sys
import heapq


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    heap = [v for v in range(n) if indeg[v] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        u = heapq.heappop(heap)
        order.append(u)
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                heapq.heappush(heap, w)
    print(" ".join(map(str, order)) if len(order) == n else "CYCLE")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output is provably lexicographically smallest (compare against a brute-force on small inputs).
- `CYCLE` on cyclic input.
- `O(V log V + E)`.

---

### Task 7 — Longest path in a weighted DAG

**Problem.** Given a weighted DAG, output the length of the longest path (sum of edge weights). Paths may start at any vertex.

**Input / Output spec.**
- Input: `n m`, then `m` lines `u v w` (edge `u → v` with weight `w`).
- Output: the maximum path length.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, `0 <= w <= 10^4`.
- The graph is guaranteed acyclic.
- Time `O(V + E)`.

**Hint.** Topologically sort, then relax forward with `max`. The answer is `max(dist[])`.

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
	type E struct{ to, w int }
	adj := make([][]E, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v, w int
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], E{v, w})
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	dist := make([]int, n)
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, e := range adj[u] {
			indeg[e.to]--
			if indeg[e.to] == 0 {
				queue = append(queue, e.to)
			}
		}
	}
	best := 0
	for _, u := range order {
		for _, e := range adj[u] {
			if dist[u]+e.w > dist[e.to] {
				dist[e.to] = dist[u] + e.w
			}
		}
		if dist[u] > best {
			best = dist[u]
		}
	}
	fmt.Println(best)
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task7 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            st.nextToken(); int w = (int) st.nval;
            adj[u].add(new int[]{v, w});
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        int[] dist = new int[n];
        List<Integer> order = new ArrayList<>();
        int[] ind = indeg.clone();
        while (!q.isEmpty()) {
            int u = q.poll();
            order.add(u);
            for (int[] e : adj[u]) if (--ind[e[0]] == 0) q.add(e[0]);
        }
        int best = 0;
        for (int u : order) {
            for (int[] e : adj[u])
                if (dist[u] + e[1] > dist[e[0]]) dist[e[0]] = dist[u] + e[1];
            best = Math.max(best, dist[u]);
        }
        System.out.println(best);
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
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3
        adj[u].append((v, w))
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for v, _ in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    dist = [0] * n
    best = 0
    for u in order:
        for v, w in adj[u]:
            if dist[u] + w > dist[v]:
                dist[v] = dist[u] + w
        best = max(best, dist[u])
    print(best)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for a single vertex (answer 0).
- Linear time; one topo sort + one sweep.
- Matches a brute-force DFS longest path on small inputs.

---

### Task 8 — Parallel job scheduling (minimum number of rounds)

**Problem.** Each job depends on others (`u → v` means `u` before `v`). In one round you may run all jobs whose dependencies are already done. Output the minimum number of rounds, or `-1` if impossible.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: minimum rounds, or `-1`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(V + E)`.

**Hint.** Level-by-level Kahn's; each level is one round. Rounds = longest path length; `-1` if not all jobs run.

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
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	cur := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			cur = append(cur, v)
		}
	}
	rounds, done := 0, 0
	for len(cur) > 0 {
		rounds++
		next := []int{}
		for _, u := range cur {
			done++
			for _, w := range adj[u] {
				indeg[w]--
				if indeg[w] == 0 {
					next = append(next, w)
				}
			}
		}
		cur = next
	}
	if done != n {
		fmt.Println(-1)
	} else {
		fmt.Println(rounds)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task8 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        int rounds = 0, done = 0;
        while (!q.isEmpty()) {
            rounds++;
            int sz = q.size();
            for (int i = 0; i < sz; i++) {
                int u = q.poll();
                done++;
                for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
            }
        }
        System.out.println(done == n ? rounds : -1);
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
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    rounds = done = 0
    while queue:
        rounds += 1
        for _ in range(len(queue)):
            u = queue.popleft()
            done += 1
            for w in adj[u]:
                indeg[w] -= 1
                if indeg[w] == 0:
                    queue.append(w)
    print(rounds if done == n else -1)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Rounds equal the longest path length.
- `-1` exactly on cyclic input.
- Levels processed one barrier at a time.

---

### Task 9 — Count distinct paths between two vertices in a DAG

**Problem.** Given a DAG and vertices `s` and `t`, count the number of distinct directed paths from `s` to `t` (modulo `10^9 + 7`).

**Input / Output spec.**
- Input: `n m s t`, then `m` edges `u v`.
- Output: number of `s → t` paths mod `10^9+7`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- Graph is acyclic.

**Hint.** Topologically sort; `count[s] = 1`; sweep in order, `count[w] = (count[w] + count[u]) % MOD`.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

const MOD = 1_000_000_007

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m, s, t int
	fmt.Fscan(in, &n, &m, &s, &t)
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	count := make([]int64, n)
	count[s] = 1
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		for _, w := range adj[u] {
			count[w] = (count[w] + count[u]) % MOD
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	fmt.Println(count[t])
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task9 {
    static final long MOD = 1_000_000_007L;
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        st.nextToken(); int s = (int) st.nval;
        st.nextToken(); int t = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        long[] count = new long[n];
        count[s] = 1;
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int w : adj.get(u)) {
                count[w] = (count[w] + count[u]) % MOD;
                if (--indeg[w] == 0) q.add(w);
            }
        }
        System.out.println(count[t]);
    }
}
```

**Reference — Python.**
```python
import sys
from collections import deque

MOD = 1_000_000_007


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); s = int(data[idx + 2]); t = int(data[idx + 3])
    idx += 4
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    count = [0] * n
    count[s] = 1
    while queue:
        u = queue.popleft()
        for w in adj[u]:
            count[w] = (count[w] + count[u]) % MOD
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    print(count[t])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct for `s == t` (answer 1).
- Uses modular arithmetic to avoid overflow.
- Single topo sweep accumulating from predecessors.

---

### Task 10 — Build order with cycle reporting

**Problem.** Given build targets and dependencies (`u → v` means "build `u` before `v`"), output a valid build order. If a circular dependency exists, output `CYCLE: ` followed by one cycle as `a -> b -> ... -> a`.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: a valid order, or a `CYCLE: ...` line.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(V + E)`.

**Hint.** Use DFS with white/gray/black. On a back edge to a gray ancestor, walk the recursion stack to reconstruct and print the cycle.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
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
	}
	color := make([]int, n)
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -1
	}
	order := []int{}
	cycleStart, cycleEnd := -1, -1
	var dfs func(u int) bool
	dfs = func(u int) bool {
		color[u] = 1
		for _, w := range adj[u] {
			if color[w] == 0 {
				parent[w] = u
				if dfs(w) {
					return true
				}
			} else if color[w] == 1 {
				cycleStart, cycleEnd = w, u
				return true
			}
		}
		color[u] = 2
		order = append(order, u)
		return false
	}
	for v := 0; v < n && cycleStart == -1; v++ {
		if color[v] == 0 {
			if dfs(v) {
				break
			}
		}
	}
	if cycleStart != -1 {
		cyc := []int{}
		for x := cycleEnd; x != cycleStart; x = parent[x] {
			cyc = append(cyc, x)
		}
		cyc = append(cyc, cycleStart)
		for i, j := 0, len(cyc)-1; i < j; i, j = i+1, j-1 {
			cyc[i], cyc[j] = cyc[j], cyc[i]
		}
		cyc = append(cyc, cycleStart)
		parts := make([]string, len(cyc))
		for i, v := range cyc {
			parts[i] = fmt.Sprint(v)
		}
		fmt.Fprintln(out, "CYCLE: "+strings.Join(parts, " -> "))
		return
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	parts := make([]string, len(order))
	for i, v := range order {
		parts[i] = fmt.Sprint(v)
	}
	fmt.Fprintln(out, strings.Join(parts, " "))
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task10 {
    static int[] color, parent;
    static List<List<Integer>> adj;
    static List<Integer> order = new ArrayList<>();
    static int cycleStart = -1, cycleEnd = -1;

    static boolean dfs(int u) {
        color[u] = 1;
        for (int w : adj.get(u)) {
            if (color[w] == 0) {
                parent[w] = u;
                if (dfs(w)) return true;
            } else if (color[w] == 1) {
                cycleStart = w; cycleEnd = u; return true;
            }
        }
        color[u] = 2;
        order.add(u);
        return false;
    }

    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
        }
        color = new int[n];
        parent = new int[n];
        Arrays.fill(parent, -1);
        for (int v = 0; v < n && cycleStart == -1; v++)
            if (color[v] == 0 && dfs(v)) break;

        if (cycleStart != -1) {
            List<Integer> cyc = new ArrayList<>();
            for (int x = cycleEnd; x != cycleStart; x = parent[x]) cyc.add(x);
            cyc.add(cycleStart);
            Collections.reverse(cyc);
            cyc.add(cycleStart);
            StringBuilder sb = new StringBuilder("CYCLE: ");
            for (int i = 0; i < cyc.size(); i++) {
                if (i > 0) sb.append(" -> ");
                sb.append(cyc.get(i));
            }
            System.out.println(sb);
            return;
        }
        Collections.reverse(order);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < order.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(order.get(i));
        }
        System.out.println(sb);
    }
}
```

**Reference — Python.**
```python
import sys


def main():
    sys.setrecursionlimit(300000)
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    m = int(data[idx]); idx += 1
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
    color = [0] * n
    parent = [-1] * n
    order = []
    cyc = [-1, -1]  # start, end

    def dfs(u):
        color[u] = 1
        for w in adj[u]:
            if color[w] == 0:
                parent[w] = u
                if dfs(w):
                    return True
            elif color[w] == 1:
                cyc[0], cyc[1] = w, u
                return True
        color[u] = 2
        order.append(u)
        return False

    for v in range(n):
        if color[v] == 0 and dfs(v):
            break

    if cyc[0] != -1:
        path = []
        x = cyc[1]
        while x != cyc[0]:
            path.append(x)
            x = parent[x]
        path.append(cyc[0])
        path.reverse()
        path.append(cyc[0])
        print("CYCLE: " + " -> ".join(map(str, path)))
    else:
        print(" ".join(map(str, reversed(order))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- On a DAG, prints a valid order.
- On a cycle, prints a real cycle that starts and ends at the same vertex.
- Handles disconnected graphs.

---

## Advanced Tasks (5)

### Task 11 — Count the number of distinct topological orders (small DAGs)

**Problem.** Count the number of distinct topological orders of a DAG with `n <= 18` vertices.

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: the count (fits in 64-bit for `n <= 18`).

**Constraints.**
- `1 <= n <= 18`.
- Use bitmask DP `O(2^n · n)`.

**Hint.** `pred[v]` = bitmask of `v`'s predecessors. `dp[mask]` = number of orders emitting exactly `mask`. A vertex `v` is addable to `mask` iff `v ∉ mask` and `pred[v] ⊆ mask`.

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
	pred := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v) // u -> v, so u is a predecessor of v
		pred[v] |= 1 << u
	}
	dp := make([]int64, 1<<n)
	dp[0] = 1
	for mask := 0; mask < (1 << n); mask++ {
		if dp[mask] == 0 {
			continue
		}
		for v := 0; v < n; v++ {
			if mask&(1<<v) == 0 && (pred[v]&mask) == pred[v] {
				dp[mask|(1<<v)] += dp[mask]
			}
		}
	}
	fmt.Println(dp[(1<<n)-1])
}
```

**Reference — Java.**
```java
import java.util.*;

public class Task11 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), m = sc.nextInt();
        int[] pred = new int[n];
        for (int i = 0; i < m; i++) {
            int u = sc.nextInt(), v = sc.nextInt();
            pred[v] |= (1 << u);
        }
        long[] dp = new long[1 << n];
        dp[0] = 1;
        for (int mask = 0; mask < (1 << n); mask++) {
            if (dp[mask] == 0) continue;
            for (int v = 0; v < n; v++)
                if ((mask & (1 << v)) == 0 && (pred[v] & mask) == pred[v])
                    dp[mask | (1 << v)] += dp[mask];
        }
        System.out.println(dp[(1 << n) - 1]);
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
    pred = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        pred[v] |= (1 << u)
    dp = [0] * (1 << n)
    dp[0] = 1
    for mask in range(1 << n):
        if dp[mask] == 0:
            continue
        for v in range(n):
            if not (mask >> v) & 1 and (pred[v] & mask) == pred[v]:
                dp[mask | (1 << v)] += dp[mask]
    print(dp[(1 << n) - 1])


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns `n!` for an edgeless graph and `1` for a chain.
- Returns `0` for a cyclic graph (no full mask is reachable).
- `O(2^n · n)` — accept only `n <= 18`.

---

### Task 12 — DAG shortest path with negative weights

**Problem.** Given a weighted DAG (weights may be negative) and a source `s`, output the shortest distance from `s` to every vertex, or `INF` if unreachable.

**Input / Output spec.**
- Input: `n m s`, then `m` lines `u v w`.
- Output: `n` lines, the distance to each vertex or `INF`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, `-10^9 <= w <= 10^9`.
- Graph is acyclic. Time `O(V + E)`.

**Hint.** Topologically sort. Relax edges in order only from reachable vertices (`dist[u] != INF`). Negative weights are fine because predecessors are finalized first.

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
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m, s int
	fmt.Fscan(in, &n, &m, &s)
	type E struct {
		to int
		w  int64
	}
	adj := make([][]E, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], E{v, w})
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, e := range adj[u] {
			indeg[e.to]--
			if indeg[e.to] == 0 {
				queue = append(queue, e.to)
			}
		}
	}
	const INF = math.MaxInt64
	dist := make([]int64, n)
	for i := range dist {
		dist[i] = INF
	}
	dist[s] = 0
	for _, u := range order {
		if dist[u] == INF {
			continue
		}
		for _, e := range adj[u] {
			if dist[u]+e.w < dist[e.to] {
				dist[e.to] = dist[u] + e.w
			}
		}
	}
	for _, d := range dist {
		if d == INF {
			fmt.Fprintln(out, "INF")
		} else {
			fmt.Fprintln(out, d)
		}
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        st.nextToken(); int s = (int) st.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            st.nextToken(); long w = (long) st.nval;
            adj[u].add(new long[]{v, w});
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        List<Integer> order = new ArrayList<>();
        while (!q.isEmpty()) {
            int u = q.poll();
            order.add(u);
            for (long[] e : adj[u]) if (--indeg[(int) e[0]] == 0) q.add((int) e[0]);
        }
        long INF = Long.MAX_VALUE;
        long[] dist = new long[n];
        Arrays.fill(dist, INF);
        dist[s] = 0;
        for (int u : order) {
            if (dist[u] == INF) continue;
            for (long[] e : adj[u]) {
                int v = (int) e[0];
                if (dist[u] + e[1] < dist[v]) dist[v] = dist[u] + e[1];
            }
        }
        StringBuilder sb = new StringBuilder();
        for (long d : dist) sb.append(d == INF ? "INF" : Long.toString(d)).append('\n');
        System.out.print(sb);
    }
}
```

**Reference — Python.**
```python
import sys
from collections import deque

INF = float("inf")


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); s = int(data[idx + 2]); idx += 3
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); w = int(data[idx + 2]); idx += 3
        adj[u].append((v, w))
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for v, _ in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    dist = [INF] * n
    dist[s] = 0
    for u in order:
        if dist[u] == INF:
            continue
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    out = ["INF" if d == INF else str(d) for d in dist]
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct with negative edge weights.
- `INF` for unreachable vertices.
- Matches a Bellman-Ford reference on small graphs.

---

### Task 13 — Critical path with task durations

**Problem.** Each vertex is a task with a positive duration. Edge `u → v` means `u` must finish before `v` starts. Output the project makespan (earliest time all tasks finish) and the set of tasks on a critical path.

**Input / Output spec.**
- Input: `n m`, then a line of `n` durations, then `m` edges `u v`.
- Output: line 1 = makespan; line 2 = vertices on one critical path, in order.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, durations up to `10^4`.
- DAG guaranteed. `O(V + E)`.

**Hint.** Compute `finish[v] = duration[v] + max(finish[pred])` in topo order. The makespan is `max(finish)`. Backtrack from the argmax through predecessors that achieved the max to recover a critical path.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, m int
	fmt.Fscan(in, &n, &m)
	dur := make([]int, n)
	for i := range dur {
		fmt.Fscan(in, &dur[i])
	}
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := []int{}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		order = append(order, u)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	finish := make([]int, n)
	best := make([]int, n)
	for i := range best {
		best[i] = -1
	}
	makespan, endVertex := 0, 0
	for _, u := range order {
		finish[u] += dur[u]
		if finish[u] > makespan {
			makespan = finish[u]
			endVertex = u
		}
		for _, w := range adj[u] {
			if finish[u] > finish[w] {
				finish[w] = finish[u]
				best[w] = u
			}
		}
	}
	path := []int{}
	for x := endVertex; x != -1; x = best[x] {
		path = append(path, x)
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	parts := make([]string, len(path))
	for i, v := range path {
		parts[i] = fmt.Sprint(v)
	}
	fmt.Fprintln(out, makespan)
	fmt.Fprintln(out, strings.Join(parts, " "))
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        int[] dur = new int[n];
        for (int i = 0; i < n; i++) { st.nextToken(); dur[i] = (int) st.nval; }
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        List<Integer> order = new ArrayList<>();
        while (!q.isEmpty()) {
            int u = q.poll();
            order.add(u);
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        int[] finish = new int[n], best = new int[n];
        Arrays.fill(best, -1);
        int makespan = 0, end = 0;
        for (int u : order) {
            finish[u] += dur[u];
            if (finish[u] > makespan) { makespan = finish[u]; end = u; }
            for (int w : adj.get(u))
                if (finish[u] > finish[w]) { finish[w] = finish[u]; best[w] = u; }
        }
        List<Integer> path = new ArrayList<>();
        for (int x = end; x != -1; x = best[x]) path.add(x);
        Collections.reverse(path);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < path.size(); i++) {
            if (i > 0) sb.append(' ');
            sb.append(path.get(i));
        }
        System.out.println(makespan);
        System.out.println(sb);
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
    dur = [int(data[idx + i]) for i in range(n)]; idx += n
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    finish = [0] * n
    best = [-1] * n
    makespan, end = 0, 0
    for u in order:
        finish[u] += dur[u]
        if finish[u] > makespan:
            makespan, end = finish[u], u
        for w in adj[u]:
            if finish[u] > finish[w]:
                finish[w] = finish[u]
                best[w] = u
    path = []
    x = end
    while x != -1:
        path.append(x)
        x = best[x]
    path.reverse()
    print(makespan)
    print(" ".join(map(str, path)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Makespan equals the longest weighted path.
- The reported path is a real path whose total duration equals the makespan.
- Linear time.

---

### Task 14 — Detect whether a topological order is unique

**Problem.** Determine whether a DAG has exactly one topological order. Output `UNIQUE` if so, otherwise `MULTIPLE`. (If the graph is cyclic, output `CYCLE`.)

**Input / Output spec.**
- Input: `n m`, then `m` edges `u v`.
- Output: `UNIQUE`, `MULTIPLE`, or `CYCLE`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`.
- `O(V + E)`.

**Hint.** Run Kahn's. The order is unique **iff** at every step the queue holds exactly one ready vertex. If the queue ever holds two or more, the order is not unique. If you can't emit all `n`, it's a cycle.

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
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	queue := []int{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	emitted := 0
	unique := true
	for len(queue) > 0 {
		if len(queue) > 1 {
			unique = false
		}
		u := queue[0]
		queue = queue[1:]
		emitted++
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	if emitted != n {
		fmt.Println("CYCLE")
	} else if unique {
		fmt.Println("UNIQUE")
	} else {
		fmt.Println("MULTIPLE")
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task14 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        int emitted = 0;
        boolean unique = true;
        while (!q.isEmpty()) {
            if (q.size() > 1) unique = false;
            int u = q.poll();
            emitted++;
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
        System.out.println(emitted != n ? "CYCLE" : (unique ? "UNIQUE" : "MULTIPLE"));
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
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    queue = deque(v for v in range(n) if indeg[v] == 0)
    emitted = 0
    unique = True
    while queue:
        if len(queue) > 1:
            unique = False
        u = queue.popleft()
        emitted += 1
        for w in adj[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                queue.append(w)
    if emitted != n:
        print("CYCLE")
    else:
        print("UNIQUE" if unique else "MULTIPLE")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `UNIQUE` exactly when the DAG admits one order (it is a single chain covering all vertices via a Hamiltonian path of the order).
- `MULTIPLE` when the queue ever has 2+ ready vertices.
- `CYCLE` on cyclic input.

---

### Task 15 — Parallel Kahn executor (simulated, with worker capacity)

**Problem.** Simulate executing a task DAG with at most `k` workers per round, each task taking 1 time unit. In each round you may start up to `k` ready (in-degree-0) tasks. Output the number of rounds needed, or `-1` on a cycle. When more than `k` tasks are ready, prefer the smallest-numbered ones (deterministic).

**Input / Output spec.**
- Input: `n m k`, then `m` edges `u v`.
- Output: number of rounds, or `-1`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5*10^5`, `1 <= k <= n`.
- `O((V + E) log V)`.

**Hint.** Use a min-heap as the ready set. Each round, pop up to `k` tasks, run them, and push any successors that become ready. Tasks unblocked *this* round only become runnable *next* round.

**Reference — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type IntHeap []int

func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)        { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m, k int
	fmt.Fscan(in, &n, &m, &k)
	adj := make([][]int, n)
	indeg := make([]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		indeg[v]++
	}
	ready := &IntHeap{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			heap.Push(ready, v)
		}
	}
	rounds, done := 0, 0
	for ready.Len() > 0 {
		rounds++
		batch := []int{}
		for i := 0; i < k && ready.Len() > 0; i++ {
			batch = append(batch, heap.Pop(ready).(int))
		}
		for _, u := range batch {
			done++
			for _, w := range adj[u] {
				indeg[w]--
				if indeg[w] == 0 {
					heap.Push(ready, w)
				}
			}
		}
	}
	if done != n {
		fmt.Println(-1)
	} else {
		fmt.Println(rounds)
	}
}
```

**Reference — Java.**
```java
import java.util.*;
import java.io.*;

public class Task15 {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st = new StreamTokenizer(
            new BufferedReader(new InputStreamReader(System.in)));
        st.nextToken(); int n = (int) st.nval;
        st.nextToken(); int m = (int) st.nval;
        st.nextToken(); int k = (int) st.nval;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int i = 0; i < m; i++) {
            st.nextToken(); int u = (int) st.nval;
            st.nextToken(); int v = (int) st.nval;
            adj.get(u).add(v);
            indeg[v]++;
        }
        PriorityQueue<Integer> ready = new PriorityQueue<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) ready.add(v);
        int rounds = 0, done = 0;
        while (!ready.isEmpty()) {
            rounds++;
            List<Integer> batch = new ArrayList<>();
            for (int i = 0; i < k && !ready.isEmpty(); i++) batch.add(ready.poll());
            for (int u : batch) {
                done++;
                for (int w : adj.get(u)) if (--indeg[w] == 0) ready.add(w);
            }
        }
        System.out.println(done == n ? rounds : -1);
    }
}
```

**Reference — Python.**
```python
import sys
import heapq


def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx + 1]); k = int(data[idx + 2]); idx += 3
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for _ in range(m):
        u = int(data[idx]); v = int(data[idx + 1]); idx += 2
        adj[u].append(v)
        indeg[v] += 1
    ready = [v for v in range(n) if indeg[v] == 0]
    heapq.heapify(ready)
    rounds = done = 0
    while ready:
        rounds += 1
        batch = []
        for _ in range(min(k, len(ready))):
            batch.append(heapq.heappop(ready))
        for u in batch:
            done += 1
            for w in adj[u]:
                indeg[w] -= 1
                if indeg[w] == 0:
                    heapq.heappush(ready, w)
    print(rounds if done == n else -1)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- With `k >= n`, rounds equal the longest path length.
- With `k = 1`, rounds equal `n` (purely sequential) on a DAG.
- `-1` on a cycle; deterministic batches (smallest-first).

---

## Benchmark Task

### Task B — Full benchmark across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark that measures three topological-sort workloads on random DAGs:

- **(a)** Kahn's algorithm with a FIFO queue.
- **(b)** DFS reverse-postorder (iterative or recursive with a raised limit).
- **(c)** Kahn's algorithm with a min-heap frontier (lexicographically smallest order).

Generate a random DAG by including each forward edge `(i, j)` with `i < j` independently with probability chosen so the average out-degree is ~5 (guarantees acyclicity). Run for `n ∈ {10^4, 10^5, 10^6}`. Repeat each measurement 5 times and report the mean wall-clock time in milliseconds. Use the same seed (`42`) across languages.

**Input / Output spec.**
- No stdin input. Output a fixed table to stdout:

```text
n         a_kahn_ms    b_dfs_ms    c_lex_ms
10000     ...          ...         ...
100000    ...          ...         ...
1000000   ...          ...         ...
```

**Constraints.**
- Seed: `42`. Average out-degree: ~5.
- Time only the algorithm, not the graph generation.

**Reference — Go.**
```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"time"
)

type IntHeap []int

func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)        { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any          { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

func genDAG(n int, seed int64) [][]int {
	r := rand.New(rand.NewSource(seed))
	adj := make([][]int, n)
	avgDeg := 5
	for u := 0; u < n; u++ {
		for d := 0; d < avgDeg; d++ {
			if u+1 < n {
				v := u + 1 + r.Intn(n-u-1) // forward edge => acyclic
				adj[u] = append(adj[u], v)
			}
		}
	}
	return adj
}

func indegrees(n int, adj [][]int) []int {
	indeg := make([]int, n)
	for u := 0; u < n; u++ {
		for _, w := range adj[u] {
			indeg[w]++
		}
	}
	return indeg
}

func kahn(n int, adj [][]int) {
	indeg := indegrees(n, adj)
	q := make([]int, 0, n)
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			q = append(q, v)
		}
	}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				q = append(q, w)
			}
		}
	}
}

func dfsTopo(n int, adj [][]int) {
	color := make([]int, n)
	stack := []int{}
	for s := 0; s < n; s++ {
		if color[s] != 0 {
			continue
		}
		stack = append(stack, s)
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			if color[u] == 0 {
				color[u] = 1
			}
			pushed := false
			for _, w := range adj[u] {
				if color[w] == 0 {
					stack = append(stack, w)
					pushed = true
					break
				}
			}
			if !pushed {
				color[u] = 2
				stack = stack[:len(stack)-1]
			}
		}
	}
}

func lexKahn(n int, adj [][]int) {
	indeg := indegrees(n, adj)
	h := &IntHeap{}
	for v := 0; v < n; v++ {
		if indeg[v] == 0 {
			heap.Push(h, v)
		}
	}
	for h.Len() > 0 {
		u := heap.Pop(h).(int)
		for _, w := range adj[u] {
			indeg[w]--
			if indeg[w] == 0 {
				heap.Push(h, w)
			}
		}
	}
}

func meanMs(ds []time.Duration) float64 {
	var s float64
	for _, d := range ds {
		s += float64(d.Microseconds()) / 1000.0
	}
	return s / float64(len(ds))
}

func main() {
	sizes := []int{10000, 100000, 1000000}
	fmt.Println("n         a_kahn_ms    b_dfs_ms    c_lex_ms")
	for _, n := range sizes {
		adj := genDAG(n, 42)
		var ra, rb, rc []time.Duration
		for i := 0; i < 5; i++ {
			t := time.Now()
			kahn(n, adj)
			ra = append(ra, time.Since(t))
			t = time.Now()
			dfsTopo(n, adj)
			rb = append(rb, time.Since(t))
			t = time.Now()
			lexKahn(n, adj)
			rc = append(rc, time.Since(t))
		}
		fmt.Printf("%-9d %-12.2f %-11.2f %-11.2f\n", n, meanMs(ra), meanMs(rb), meanMs(rc))
	}
}
```

**Reference — Java.**
```java
import java.util.*;

public class TaskB {
    static List<List<Integer>> genDAG(int n, long seed) {
        Random r = new Random(seed);
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int avgDeg = 5;
        for (int u = 0; u < n; u++)
            for (int d = 0; d < avgDeg && u + 1 < n; d++)
                adj.get(u).add(u + 1 + r.nextInt(n - u - 1));
        return adj;
    }

    static int[] indeg(int n, List<List<Integer>> adj) {
        int[] indeg = new int[n];
        for (int u = 0; u < n; u++) for (int w : adj.get(u)) indeg[w]++;
        return indeg;
    }

    static void kahn(int n, List<List<Integer>> adj) {
        int[] indeg = indeg(n, adj);
        ArrayDeque<Integer> q = new ArrayDeque<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) q.add(v);
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int w : adj.get(u)) if (--indeg[w] == 0) q.add(w);
        }
    }

    static void dfsTopo(int n, List<List<Integer>> adj) {
        int[] color = new int[n];
        int[] ptr = new int[n];
        ArrayDeque<Integer> stack = new ArrayDeque<>();
        for (int s = 0; s < n; s++) {
            if (color[s] != 0) continue;
            stack.push(s);
            while (!stack.isEmpty()) {
                int u = stack.peek();
                color[u] = 1;
                boolean pushed = false;
                while (ptr[u] < adj.get(u).size()) {
                    int w = adj.get(u).get(ptr[u]++);
                    if (color[w] == 0) { stack.push(w); pushed = true; break; }
                }
                if (!pushed) { color[u] = 2; stack.pop(); }
            }
        }
    }

    static void lexKahn(int n, List<List<Integer>> adj) {
        int[] indeg = indeg(n, adj);
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int v = 0; v < n; v++) if (indeg[v] == 0) pq.add(v);
        while (!pq.isEmpty()) {
            int u = pq.poll();
            for (int w : adj.get(u)) if (--indeg[w] == 0) pq.add(w);
        }
    }

    static double meanMs(long[] ns) {
        long s = 0;
        for (long x : ns) s += x;
        return (s / 1_000_000.0) / ns.length;
    }

    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        System.out.println("n         a_kahn_ms    b_dfs_ms    c_lex_ms");
        for (int n : sizes) {
            List<List<Integer>> adj = genDAG(n, 42L);
            long[] ra = new long[5], rb = new long[5], rc = new long[5];
            for (int i = 0; i < 5; i++) {
                long t = System.nanoTime(); kahn(n, adj); ra[i] = System.nanoTime() - t;
                t = System.nanoTime(); dfsTopo(n, adj); rb[i] = System.nanoTime() - t;
                t = System.nanoTime(); lexKahn(n, adj); rc[i] = System.nanoTime() - t;
            }
            System.out.printf("%-9d %-12.2f %-11.2f %-11.2f%n",
                n, meanMs(ra), meanMs(rb), meanMs(rc));
        }
    }
}
```

**Reference — Python.**
```python
import heapq
import random
import time
from collections import deque


def gen_dag(n, seed):
    r = random.Random(seed)
    adj = [[] for _ in range(n)]
    avg_deg = 5
    for u in range(n):
        for _ in range(avg_deg):
            if u + 1 < n:
                adj[u].append(u + 1 + r.randrange(n - u - 1))
    return adj


def indeg(n, adj):
    d = [0] * n
    for u in range(n):
        for w in adj[u]:
            d[w] += 1
    return d


def kahn(n, adj):
    d = indeg(n, adj)
    q = deque(v for v in range(n) if d[v] == 0)
    while q:
        u = q.popleft()
        for w in adj[u]:
            d[w] -= 1
            if d[w] == 0:
                q.append(w)


def dfs_topo(n, adj):
    color = [0] * n
    for s in range(n):
        if color[s]:
            continue
        stack = [(s, 0)]
        while stack:
            u, i = stack[-1]
            color[u] = 1
            if i < len(adj[u]):
                stack[-1] = (u, i + 1)
                w = adj[u][i]
                if color[w] == 0:
                    stack.append((w, 0))
            else:
                color[u] = 2
                stack.pop()


def lex_kahn(n, adj):
    d = indeg(n, adj)
    h = [v for v in range(n) if d[v] == 0]
    heapq.heapify(h)
    while h:
        u = heapq.heappop(h)
        for w in adj[u]:
            d[w] -= 1
            if d[w] == 0:
                heapq.heappush(h, w)


def mean_ms(samples):
    return sum(samples) / len(samples) * 1000.0


def main():
    sizes = [10_000, 100_000, 1_000_000]
    print("n         a_kahn_ms    b_dfs_ms    c_lex_ms")
    for n in sizes:
        adj = gen_dag(n, 42)
        ra, rb, rc = [], [], []
        for _ in range(5):
            t = time.perf_counter(); kahn(n, adj); ra.append(time.perf_counter() - t)
            t = time.perf_counter(); dfs_topo(n, adj); rb.append(time.perf_counter() - t)
            t = time.perf_counter(); lex_kahn(n, adj); rc.append(time.perf_counter() - t)
        print(f"{n:<9d} {mean_ms(ra):<12.2f} {mean_ms(rb):<11.2f} {mean_ms(rc):<11.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same graph across languages.
- Workloads (a) and (b) are both linear; (c) is consistently slower due to the `log V` heap factor — confirm the gap widens with `n`.
- Report the mean across at least 5 runs and exclude graph generation from timing.
- Writeup: a short note on which language showed the widest gap between (a) and (c), and why the min-heap frontier costs more.
