# Bipartite Matching — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships a problem statement, constraints, hints, and a reference solution in all three languages.
> Reuse the Kuhn / Hopcroft-Karp / Hungarian skeletons from `junior.md`, `middle.md`, and `professional.md`.

---

## Beginner Tasks (5)

### Task 1 — Count Maximum Matching Size (Kuhn)

**Problem.** Given a bipartite graph with `nL` left and `nR` right vertices and an edge list, output the maximum-cardinality matching size.

**Constraints.** `1 ≤ nL, nR ≤ 2000`, `0 ≤ edges ≤ 10^4`.

**Hint.** Standard Kuhn. Reset `used[]` per left vertex.

```go
package main
import "fmt"
func maxMatch(nL, nR int, adj [][]int) int {
	matchR := make([]int, nR)
	for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] {
				used[v] = true
				if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true }
			}
		}
		return false
	}
	c := 0
	for u := 0; u < nL; u++ {
		used = make([]bool, nR)
		if try(u) { c++ }
	}
	return c
}
func main() {
	adj := [][]int{{0, 1}, {0}, {1, 2}}
	fmt.Println(maxMatch(3, 3, adj)) // 3
}
```

```java
import java.util.*;
public class Task1 {
    static int[] matchR; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        adj = new int[][]{{0,1},{0},{1,2}};
        int nL = 3, nR = 3;
        matchR = new int[nR]; Arrays.fill(matchR, -1);
        int c = 0;
        for (int u = 0; u < nL; u++) { used = new boolean[nR]; if (tryK(u)) c++; }
        System.out.println(c); // 3
    }
}
```

```python
def max_match(n_left, n_right, adj):
    match_r = [-1] * n_right
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    c = 0
    for u in range(n_left):
        if try_k(u, [False] * n_right):
            c += 1
    return c

print(max_match(3, 3, [[0, 1], [0], [1, 2]]))  # 3
```

---

### Task 2 — Verify Bipartiteness (2-Coloring)

**Problem.** Given a general undirected graph, decide whether it is bipartite (so matching algorithms are valid). Output `true`/`false`.

**Constraints.** `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 2·10^5`.

**Hint.** BFS/DFS 2-coloring. If an edge joins two same-colored vertices, it is not bipartite.

```go
package main
import "fmt"
func isBipartite(n int, adj [][]int) bool {
	color := make([]int, n)
	for i := range color { color[i] = -1 }
	for s := 0; s < n; s++ {
		if color[s] != -1 { continue }
		color[s] = 0
		queue := []int{s}
		for len(queue) > 0 {
			u := queue[0]; queue = queue[1:]
			for _, v := range adj[u] {
				if color[v] == -1 { color[v] = color[u] ^ 1; queue = append(queue, v) } else if color[v] == color[u] { return false }
			}
		}
	}
	return true
}
func main() {
	adj := [][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}}
	fmt.Println(isBipartite(4, adj)) // true (4-cycle)
}
```

```java
import java.util.*;
public class Task2 {
    public static boolean isBipartite(int n, List<List<Integer>> adj) {
        int[] color = new int[n]; Arrays.fill(color, -1);
        for (int s = 0; s < n; s++) {
            if (color[s] != -1) continue;
            color[s] = 0;
            Deque<Integer> q = new ArrayDeque<>(); q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) {
                    if (color[v] == -1) { color[v] = color[u] ^ 1; q.add(v); }
                    else if (color[v] == color[u]) return false;
                }
            }
        }
        return true;
    }
    public static void main(String[] a) {
        List<List<Integer>> adj = new ArrayList<>();
        int[][] e = {{1,3},{0,2},{1,3},{0,2}};
        for (int[] row : e) adj.add(new ArrayList<>(Arrays.stream(row).boxed().toList()));
        System.out.println(isBipartite(4, adj)); // true
    }
}
```

```python
from collections import deque
def is_bipartite(n, adj):
    color = [-1] * n
    for s in range(n):
        if color[s] != -1: continue
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

print(is_bipartite(4, [[1, 3], [0, 2], [1, 3], [0, 2]]))  # True
```

---

### Task 3 — Print the Actual Matched Pairs

**Problem.** Compute the maximum matching and print each matched pair `(leftVertex, rightVertex)`.

**Constraints.** `1 ≤ nL, nR ≤ 2000`.

**Hint.** After Kuhn, iterate `matchR[v]` for `v` with `matchR[v] != -1`.

```go
package main
import "fmt"
func main() {
	nL, nR := 3, 3
	adj := [][]int{{0, 1}, {0}, {1, 2}}
	matchR := make([]int, nR); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] {
				used[v] = true
				if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true }
			}
		}
		return false
	}
	for u := 0; u < nL; u++ { used = make([]bool, nR); try(u) }
	for v := 0; v < nR; v++ {
		if matchR[v] != -1 { fmt.Printf("L%d - R%d\n", matchR[v], v) }
	}
}
```

```java
import java.util.*;
public class Task3 {
    static int[] matchR; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        adj = new int[][]{{0,1},{0},{1,2}};
        int nL = 3, nR = 3;
        matchR = new int[nR]; Arrays.fill(matchR, -1);
        for (int u = 0; u < nL; u++) { used = new boolean[nR]; tryK(u); }
        for (int v = 0; v < nR; v++) if (matchR[v] != -1)
            System.out.println("L" + matchR[v] + " - R" + v);
    }
}
```

```python
def solve():
    n_left, n_right = 3, 3
    adj = [[0, 1], [0], [1, 2]]
    match_r = [-1] * n_right
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    for u in range(n_left):
        try_k(u, [False] * n_right)
    for v in range(n_right):
        if match_r[v] != -1:
            print(f"L{match_r[v]} - R{v}")

solve()
```

---

### Task 4 — Check for Perfect Matching

**Problem.** Given a balanced bipartite graph (`nL == nR`), report whether a perfect matching exists.

**Constraints.** `1 ≤ nL = nR ≤ 2000`.

**Hint.** Compute max matching; perfect iff size `== nL`.

```go
package main
import "fmt"
func perfect(n int, adj [][]int) bool {
	matchR := make([]int, n); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	c := 0
	for u := 0; u < n; u++ { used = make([]bool, n); if try(u) { c++ } }
	return c == n
}
func main() { fmt.Println(perfect(3, [][]int{{0, 1}, {0}, {1, 2}})) } // true
```

```java
import java.util.*;
public class Task4 {
    static int[] matchR; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        adj = new int[][]{{0,1},{0},{1,2}};
        int n = 3;
        matchR = new int[n]; Arrays.fill(matchR, -1);
        int c = 0;
        for (int u = 0; u < n; u++) { used = new boolean[n]; if (tryK(u)) c++; }
        System.out.println(c == n); // true
    }
}
```

```python
def perfect(n, adj):
    match_r = [-1] * n
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    c = 0
    for u in range(n):
        if try_k(u, [False] * n):
            c += 1
    return c == n

print(perfect(3, [[0, 1], [0], [1, 2]]))  # True
```

---

### Task 5 — Greedy Pre-Match then Augment

**Problem.** Implement Kuhn with a greedy pre-matching pass (match each left to any free neighbor first), then run augmenting paths only for the unmatched. Output the final size.

**Constraints.** `1 ≤ nL, nR ≤ 5000`.

**Hint.** Pre-matching reduces DFS launches; correctness is unaffected.

```go
package main
import "fmt"
func main() {
	nL, nR := 3, 3
	adj := [][]int{{0, 1}, {0}, {1, 2}}
	matchR := make([]int, nR); for i := range matchR { matchR[i] = -1 }
	matchL := make([]int, nL); for i := range matchL { matchL[i] = -1 }
	// greedy
	for u := 0; u < nL; u++ {
		for _, v := range adj[u] {
			if matchR[v] == -1 { matchR[v] = u; matchL[u] = v; break }
		}
	}
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; matchL[u] = v; return true } }
		}
		return false
	}
	c := 0
	for u := 0; u < nL; u++ {
		if matchL[u] != -1 { c++; continue }
		used = make([]bool, nR)
		if try(u) { c++ }
	}
	fmt.Println(c) // 3
}
```

```java
import java.util.*;
public class Task5 {
    static int[] matchR, matchL; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; matchL[u] = v; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        adj = new int[][]{{0,1},{0},{1,2}};
        int nL = 3, nR = 3;
        matchR = new int[nR]; Arrays.fill(matchR, -1);
        matchL = new int[nL]; Arrays.fill(matchL, -1);
        for (int u = 0; u < nL; u++)
            for (int v : adj[u]) if (matchR[v] == -1) { matchR[v] = u; matchL[u] = v; break; }
        int c = 0;
        for (int u = 0; u < nL; u++) {
            if (matchL[u] != -1) { c++; continue; }
            used = new boolean[nR];
            if (tryK(u)) c++;
        }
        System.out.println(c); // 3
    }
}
```

```python
def solve():
    n_left, n_right = 3, 3
    adj = [[0, 1], [0], [1, 2]]
    match_r = [-1] * n_right
    match_l = [-1] * n_left
    for u in range(n_left):
        for v in adj[u]:
            if match_r[v] == -1:
                match_r[v] = u; match_l[u] = v; break
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u; match_l[u] = v; return True
        return False
    c = 0
    for u in range(n_left):
        if match_l[u] != -1:
            c += 1; continue
        if try_k(u, [False] * n_right):
            c += 1
    return c

print(solve())  # 3
```

---

## Intermediate Tasks (5)

### Task 6 — Hopcroft-Karp from Scratch

**Problem.** Implement Hopcroft-Karp and return the maximum matching size on a large bipartite graph.

**Constraints.** `1 ≤ nL, nR ≤ 5·10^4`, `E ≤ 2·10^5`.

**Hint.** BFS layering then DFS phases; `dist[w] == dist[u]+1` guard.

```go
package main
import "fmt"
const INF = 1 << 30
type HK struct{ nL,nR int; adj [][]int; ml,mr,dist []int }
func (h *HK) bfs() bool {
	q := []int{}
	for u := 1; u <= h.nL; u++ { if h.ml[u] == 0 { h.dist[u] = 0; q = append(q, u) } else { h.dist[u] = INF } }
	found := false
	for len(q) > 0 {
		u := q[0]; q = q[1:]
		for _, v := range h.adj[u] {
			w := h.mr[v]
			if w == 0 { found = true } else if h.dist[w] == INF { h.dist[w] = h.dist[u] + 1; q = append(q, w) }
		}
	}
	return found
}
func (h *HK) dfs(u int) bool {
	for _, v := range h.adj[u] {
		w := h.mr[v]
		if w == 0 || (h.dist[w] == h.dist[u]+1 && h.dfs(w)) { h.ml[u] = v; h.mr[v] = u; return true }
	}
	h.dist[u] = INF; return false
}
func (h *HK) solve() int {
	m := 0
	for h.bfs() {
		for u := 1; u <= h.nL; u++ { if h.ml[u] == 0 && h.dfs(u) { m++ } }
	}
	return m
}
func main() {
	h := &HK{nL: 3, nR: 3, adj: make([][]int, 4), ml: make([]int, 4), mr: make([]int, 4), dist: make([]int, 4)}
	h.adj[1] = []int{1, 2}; h.adj[2] = []int{1}; h.adj[3] = []int{2, 3}
	fmt.Println(h.solve()) // 3
}
```

```java
import java.util.*;
public class Task6 {
    static final int INF = Integer.MAX_VALUE;
    int nL, nR; List<List<Integer>> adj; int[] ml, mr, dist;
    Task6(int nL, int nR) {
        this.nL = nL; this.nR = nR;
        adj = new ArrayList<>(); for (int i = 0; i <= nL; i++) adj.add(new ArrayList<>());
        ml = new int[nL + 1]; mr = new int[nR + 1]; dist = new int[nL + 1];
    }
    boolean bfs() {
        Deque<Integer> q = new ArrayDeque<>();
        for (int u = 1; u <= nL; u++) { if (ml[u] == 0) { dist[u] = 0; q.add(u); } else dist[u] = INF; }
        boolean found = false;
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int v : adj.get(u)) {
                int w = mr[v];
                if (w == 0) found = true;
                else if (dist[w] == INF) { dist[w] = dist[u] + 1; q.add(w); }
            }
        }
        return found;
    }
    boolean dfs(int u) {
        for (int v : adj.get(u)) {
            int w = mr[v];
            if (w == 0 || (dist[w] == dist[u] + 1 && dfs(w))) { ml[u] = v; mr[v] = u; return true; }
        }
        dist[u] = INF; return false;
    }
    int solve() {
        int m = 0;
        while (bfs()) for (int u = 1; u <= nL; u++) if (ml[u] == 0 && dfs(u)) m++;
        return m;
    }
    public static void main(String[] a) {
        Task6 h = new Task6(3, 3);
        h.adj.get(1).addAll(List.of(1, 2)); h.adj.get(2).add(1); h.adj.get(3).addAll(List.of(2, 3));
        System.out.println(h.solve()); // 3
    }
}
```

```python
import sys
from collections import deque
INF = float("inf")
class HK:
    def __init__(self, nl, nr):
        self.nl = nl; self.nr = nr
        self.adj = [[] for _ in range(nl + 1)]
        self.ml = [0] * (nl + 1); self.mr = [0] * (nr + 1); self.dist = [0] * (nl + 1)
    def bfs(self):
        q = deque()
        for u in range(1, self.nl + 1):
            if self.ml[u] == 0: self.dist[u] = 0; q.append(u)
            else: self.dist[u] = INF
        found = False
        while q:
            u = q.popleft()
            for v in self.adj[u]:
                w = self.mr[v]
                if w == 0: found = True
                elif self.dist[w] == INF: self.dist[w] = self.dist[u] + 1; q.append(w)
        return found
    def dfs(self, u):
        for v in self.adj[u]:
            w = self.mr[v]
            if w == 0 or (self.dist[w] == self.dist[u] + 1 and self.dfs(w)):
                self.ml[u] = v; self.mr[v] = u; return True
        self.dist[u] = INF; return False
    def solve(self):
        m = 0
        while self.bfs():
            for u in range(1, self.nl + 1):
                if self.ml[u] == 0 and self.dfs(u): m += 1
        return m

sys.setrecursionlimit(10**6)
h = HK(3, 3)
h.adj[1] = [1, 2]; h.adj[2] = [1]; h.adj[3] = [2, 3]
print(h.solve())  # 3
```

---

### Task 7 — Minimum Vertex Cover Recovery

**Problem.** After a maximum matching, output a minimum vertex cover (list of left and right vertices).

**Constraints.** `1 ≤ nL, nR ≤ 2000`.

**Hint.** Alternating reachability from unmatched left vertices; cover = (left not reached) ∪ (right reached).

```go
package main
import "fmt"
func main() {
	nL, nR := 3, 3
	adj := [][]int{{0}, {0, 1}, {1, 2}}
	matchR := make([]int, nR); for i := range matchR { matchR[i] = -1 }
	matchL := make([]int, nL); for i := range matchL { matchL[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; matchL[u] = v; return true } }
		}
		return false
	}
	for u := 0; u < nL; u++ { used = make([]bool, nR); try(u) }
	visL := make([]bool, nL); visR := make([]bool, nR)
	var dfs func(u int)
	dfs = func(u int) {
		visL[u] = true
		for _, v := range adj[u] {
			if !visR[v] && matchL[u] != v {
				visR[v] = true
				if matchR[v] != -1 && !visL[matchR[v]] { dfs(matchR[v]) }
			}
		}
	}
	for u := 0; u < nL; u++ { if matchL[u] == -1 { dfs(u) } }
	fmt.Print("Cover L: ")
	for u := 0; u < nL; u++ { if !visL[u] { fmt.Print(u, " ") } }
	fmt.Print("\nCover R: ")
	for v := 0; v < nR; v++ { if visR[v] { fmt.Print(v, " ") } }
	fmt.Println()
}
```

```java
import java.util.*;
public class Task7 {
    static int[] matchR, matchL; static boolean[] used; static int[][] adj;
    static boolean[] visL, visR;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; matchL[u] = v; return true; }
        }
        return false;
    }
    static void dfs(int u) {
        visL[u] = true;
        for (int v : adj[u]) if (!visR[v] && matchL[u] != v) {
            visR[v] = true;
            if (matchR[v] != -1 && !visL[matchR[v]]) dfs(matchR[v]);
        }
    }
    public static void main(String[] a) {
        adj = new int[][]{{0},{0,1},{1,2}};
        int nL = 3, nR = 3;
        matchR = new int[nR]; Arrays.fill(matchR, -1);
        matchL = new int[nL]; Arrays.fill(matchL, -1);
        for (int u = 0; u < nL; u++) { used = new boolean[nR]; tryK(u); }
        visL = new boolean[nL]; visR = new boolean[nR];
        for (int u = 0; u < nL; u++) if (matchL[u] == -1) dfs(u);
        System.out.print("Cover L: ");
        for (int u = 0; u < nL; u++) if (!visL[u]) System.out.print(u + " ");
        System.out.print("\nCover R: ");
        for (int v = 0; v < nR; v++) if (visR[v]) System.out.print(v + " ");
        System.out.println();
    }
}
```

```python
import sys
def solve():
    n_left, n_right = 3, 3
    adj = [[0], [0, 1], [1, 2]]
    match_r = [-1] * n_right
    match_l = [-1] * n_left
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u; match_l[u] = v; return True
        return False
    for u in range(n_left):
        try_k(u, [False] * n_right)
    vis_l = [False] * n_left
    vis_r = [False] * n_right
    def dfs(u):
        vis_l[u] = True
        for v in adj[u]:
            if not vis_r[v] and match_l[u] != v:
                vis_r[v] = True
                if match_r[v] != -1 and not vis_l[match_r[v]]:
                    dfs(match_r[v])
    for u in range(n_left):
        if match_l[u] == -1:
            dfs(u)
    print("Cover L:", [u for u in range(n_left) if not vis_l[u]])
    print("Cover R:", [v for v in range(n_right) if vis_r[v]])

sys.setrecursionlimit(10**6)
solve()
```

---

### Task 8 — Maximum Independent Set Size

**Problem.** Output the maximum independent set size of a bipartite graph: `V − max matching`.

**Constraints.** `1 ≤ nL, nR ≤ 2000`.

**Hint.** `|MIS| = (nL + nR) − maxMatching`.

```go
package main
import "fmt"
func mis(nL, nR int, adj [][]int) int {
	matchR := make([]int, nR); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	m := 0
	for u := 0; u < nL; u++ { used = make([]bool, nR); if try(u) { m++ } }
	return nL + nR - m
}
func main() { fmt.Println(mis(3, 3, [][]int{{0, 1}, {0}, {1, 2}})) } // 3
```

```java
import java.util.*;
public class Task8 {
    static int[] matchR; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        adj = new int[][]{{0,1},{0},{1,2}};
        int nL = 3, nR = 3;
        matchR = new int[nR]; Arrays.fill(matchR, -1);
        int m = 0;
        for (int u = 0; u < nL; u++) { used = new boolean[nR]; if (tryK(u)) m++; }
        System.out.println(nL + nR - m); // 3
    }
}
```

```python
def mis(n_left, n_right, adj):
    match_r = [-1] * n_right
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    m = 0
    for u in range(n_left):
        if try_k(u, [False] * n_right):
            m += 1
    return n_left + n_right - m

print(mis(3, 3, [[0, 1], [0], [1, 2]]))  # 3
```

---

### Task 9 — Minimum Path Cover of a DAG

**Problem.** Given a DAG, find the minimum number of vertex-disjoint paths covering every vertex.

**Constraints.** `1 ≤ N ≤ 2000`, `M ≤ 10^4`.

**Hint.** Split each vertex into out (left) / in (right); answer = `N − maxMatching`.

```go
package main
import "fmt"
func minPathCover(n int, edges [][2]int) int {
	adj := make([][]int, n)
	for _, e := range edges { adj[e[0]] = append(adj[e[0]], e[1]) }
	matchR := make([]int, n); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	m := 0
	for u := 0; u < n; u++ { used = make([]bool, n); if try(u) { m++ } }
	return n - m
}
func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {0, 3}}
	fmt.Println(minPathCover(4, edges)) // 2  (0->1->2 and 3)
}
```

```java
import java.util.*;
public class Task9 {
    static int[] matchR; static boolean[] used; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        int n = 4;
        int[][] edges = {{0,1},{1,2},{0,3}};
        List<List<Integer>> g = new ArrayList<>();
        for (int i = 0; i < n; i++) g.add(new ArrayList<>());
        for (int[] e : edges) g.get(e[0]).add(e[1]);
        adj = new int[n][];
        for (int i = 0; i < n; i++) adj[i] = g.get(i).stream().mapToInt(Integer::intValue).toArray();
        matchR = new int[n]; Arrays.fill(matchR, -1);
        int m = 0;
        for (int u = 0; u < n; u++) { used = new boolean[n]; if (tryK(u)) m++; }
        System.out.println(n - m); // 2
    }
}
```

```python
def min_path_cover(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
    match_r = [-1] * n
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    m = 0
    for u in range(n):
        if try_k(u, [False] * n):
            m += 1
    return n - m

print(min_path_cover(4, [(0, 1), (1, 2), (0, 3)]))  # 2
```

---

### Task 10 — Hall's Condition Bottleneck Detector

**Problem.** If a balanced bipartite graph has no perfect matching, find a left subset `S` with `|N(S)| < |S|` (a Hall violator).

**Constraints.** `1 ≤ nL = nR ≤ 1000`.

**Hint.** Run max matching; the unmatched-left-reachable left set `Z_L` together with its neighborhood `Z_R` gives `|Z_L| > |Z_R|` — `Z_L` is the violator.

```go
package main
import "fmt"
func main() {
	n := 3
	adj := [][]int{{0}, {0}, {1, 2}} // L0,L1 both only -> R0: deficiency
	matchR := make([]int, n); for i := range matchR { matchR[i] = -1 }
	matchL := make([]int, n); for i := range matchL { matchL[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; matchL[u] = v; return true } }
		}
		return false
	}
	for u := 0; u < n; u++ { used = make([]bool, n); try(u) }
	visL := make([]bool, n); visR := make([]bool, n)
	var dfs func(int)
	dfs = func(u int) {
		visL[u] = true
		for _, v := range adj[u] {
			if !visR[v] && matchL[u] != v { visR[v] = true; if matchR[v] != -1 && !visL[matchR[v]] { dfs(matchR[v]) } }
		}
	}
	for u := 0; u < n; u++ { if matchL[u] == -1 { dfs(u) } }
	var S, NS []int
	for u := 0; u < n; u++ { if visL[u] { S = append(S, u) } }
	for v := 0; v < n; v++ { if visR[v] { NS = append(NS, v) } }
	fmt.Println("Violator S:", S, "N(S):", NS) // |S|=2 > |N(S)|=1
}
```

```java
import java.util.*;
public class Task10 {
    static int[] matchR, matchL; static boolean[] used, visL, visR; static int[][] adj;
    static boolean tryK(int u) {
        for (int v : adj[u]) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; matchL[u] = v; return true; }
        }
        return false;
    }
    static void dfs(int u) {
        visL[u] = true;
        for (int v : adj[u]) if (!visR[v] && matchL[u] != v) {
            visR[v] = true;
            if (matchR[v] != -1 && !visL[matchR[v]]) dfs(matchR[v]);
        }
    }
    public static void main(String[] a) {
        adj = new int[][]{{0},{0},{1,2}};
        int n = 3;
        matchR = new int[n]; Arrays.fill(matchR, -1);
        matchL = new int[n]; Arrays.fill(matchL, -1);
        for (int u = 0; u < n; u++) { used = new boolean[n]; tryK(u); }
        visL = new boolean[n]; visR = new boolean[n];
        for (int u = 0; u < n; u++) if (matchL[u] == -1) dfs(u);
        List<Integer> S = new ArrayList<>(), NS = new ArrayList<>();
        for (int u = 0; u < n; u++) if (visL[u]) S.add(u);
        for (int v = 0; v < n; v++) if (visR[v]) NS.add(v);
        System.out.println("Violator S: " + S + " N(S): " + NS);
    }
}
```

```python
import sys
def solve():
    n = 3
    adj = [[0], [0], [1, 2]]
    match_r = [-1] * n
    match_l = [-1] * n
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u; match_l[u] = v; return True
        return False
    for u in range(n):
        try_k(u, [False] * n)
    vis_l = [False] * n
    vis_r = [False] * n
    def dfs(u):
        vis_l[u] = True
        for v in adj[u]:
            if not vis_r[v] and match_l[u] != v:
                vis_r[v] = True
                if match_r[v] != -1 and not vis_l[match_r[v]]:
                    dfs(match_r[v])
    for u in range(n):
        if match_l[u] == -1:
            dfs(u)
    S = [u for u in range(n) if vis_l[u]]
    NS = [v for v in range(n) if vis_r[v]]
    print("Violator S:", S, "N(S):", NS)

sys.setrecursionlimit(10**6)
solve()
```

---

## Advanced Tasks (5)

### Task 11 — Weighted Assignment (Hungarian, minimize cost)

**Problem.** Given an `n×n` cost matrix, find the minimum-cost perfect assignment.

**Constraints.** `1 ≤ n ≤ 400`.

**Hint.** `O(n³)` `minSlack` Hungarian from `professional.md`.

```go
package main
import "fmt"
const INF = 1 << 60
func hungarian(c [][]int) int {
	n := len(c)
	u := make([]int, n+1); v := make([]int, n+1); p := make([]int, n+1); way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i; j0 := 0
		minv := make([]int, n+1); used := make([]bool, n+1)
		for j := range minv { minv[j] = INF }
		for {
			used[j0] = true; i0 := p[j0]; delta := INF; j1 := -1
			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := c[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] { minv[j] = cur; way[j] = j0 }
					if minv[j] < delta { delta = minv[j]; j1 = j }
				}
			}
			for j := 0; j <= n; j++ { if used[j] { u[p[j]] += delta; v[j] -= delta } else { minv[j] -= delta } }
			j0 = j1
			if p[j0] == 0 { break }
		}
		for j0 != 0 { j1 := way[j0]; p[j0] = p[j1]; j0 = j1 }
	}
	total := 0
	for j := 1; j <= n; j++ { if p[j] != 0 { total += c[p[j]-1][j-1] } }
	return total
}
func main() { fmt.Println(hungarian([][]int{{4, 1, 3}, {2, 0, 5}, {3, 2, 2}})) } // 5
```

```java
public class Task11 {
    static final long INF = Long.MAX_VALUE / 4;
    static long solve(int[][] c) {
        int n = c.length;
        long[] u = new long[n+1], v = new long[n+1];
        int[] p = new int[n+1], way = new int[n+1];
        for (int i = 1; i <= n; i++) {
            p[0] = i; int j0 = 0;
            long[] minv = new long[n+1]; boolean[] used = new boolean[n+1];
            java.util.Arrays.fill(minv, INF);
            do {
                used[j0] = true; int i0 = p[j0], j1 = -1; long delta = INF;
                for (int j = 1; j <= n; j++) if (!used[j]) {
                    long cur = c[i0-1][j-1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        long total = 0;
        for (int j = 1; j <= n; j++) if (p[j] != 0) total += c[p[j]-1][j-1];
        return total;
    }
    public static void main(String[] a) {
        System.out.println(solve(new int[][]{{4,1,3},{2,0,5},{3,2,2}})); // 5
    }
}
```

```python
INF = float("inf")
def hungarian(c):
    n = len(c)
    u = [0]*(n+1); v = [0]*(n+1); p = [0]*(n+1); way = [0]*(n+1)
    for i in range(1, n+1):
        p[0] = i; j0 = 0
        minv = [INF]*(n+1); used = [False]*(n+1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = -1
            for j in range(1, n+1):
                if not used[j]:
                    cur = c[i0-1][j-1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j] = cur; way[j] = j0
                    if minv[j] < delta: delta = minv[j]; j1 = j
            for j in range(n+1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while j0:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    return sum(c[p[j]-1][j-1] for j in range(1, n+1) if p[j])

print(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]))  # 5
```

---

### Task 12 — Maximum-Weight Assignment (negate for max)

**Problem.** Given an `n×n` *profit* matrix, find the assignment maximizing total profit.

**Constraints.** `1 ≤ n ≤ 400`.

**Hint.** Negate the matrix and run min-cost Hungarian; negate the result.

```go
package main
import "fmt"
const INF = 1 << 60
func hungarianMin(c [][]int) int {
	n := len(c)
	u := make([]int, n+1); v := make([]int, n+1); p := make([]int, n+1); way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i; j0 := 0
		minv := make([]int, n+1); used := make([]bool, n+1)
		for j := range minv { minv[j] = INF }
		for {
			used[j0] = true; i0 := p[j0]; delta := INF; j1 := -1
			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := c[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] { minv[j] = cur; way[j] = j0 }
					if minv[j] < delta { delta = minv[j]; j1 = j }
				}
			}
			for j := 0; j <= n; j++ { if used[j] { u[p[j]] += delta; v[j] -= delta } else { minv[j] -= delta } }
			j0 = j1
			if p[j0] == 0 { break }
		}
		for j0 != 0 { j1 := way[j0]; p[j0] = p[j1]; j0 = j1 }
	}
	total := 0
	for j := 1; j <= n; j++ { if p[j] != 0 { total += c[p[j]-1][j-1] } }
	return total
}
func maxAssign(profit [][]int) int {
	n := len(profit)
	c := make([][]int, n)
	for i := range c { c[i] = make([]int, n); for j := range c[i] { c[i][j] = -profit[i][j] } }
	return -hungarianMin(c)
}
func main() { fmt.Println(maxAssign([][]int{{4, 1, 3}, {2, 0, 5}, {3, 2, 2}})) } // 11
```

```java
public class Task12 {
    static final long INF = Long.MAX_VALUE / 4;
    static long hungarianMin(int[][] c) {
        int n = c.length;
        long[] u = new long[n+1], v = new long[n+1];
        int[] p = new int[n+1], way = new int[n+1];
        for (int i = 1; i <= n; i++) {
            p[0] = i; int j0 = 0;
            long[] minv = new long[n+1]; boolean[] used = new boolean[n+1];
            java.util.Arrays.fill(minv, INF);
            do {
                used[j0] = true; int i0 = p[j0], j1 = -1; long delta = INF;
                for (int j = 1; j <= n; j++) if (!used[j]) {
                    long cur = c[i0-1][j-1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        long total = 0;
        for (int j = 1; j <= n; j++) if (p[j] != 0) total += c[p[j]-1][j-1];
        return total;
    }
    static long maxAssign(int[][] profit) {
        int n = profit.length;
        int[][] c = new int[n][n];
        for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) c[i][j] = -profit[i][j];
        return -hungarianMin(c);
    }
    public static void main(String[] a) {
        System.out.println(maxAssign(new int[][]{{4,1,3},{2,0,5},{3,2,2}})); // 11
    }
}
```

```python
INF = float("inf")
def hungarian_min(c):
    n = len(c)
    u = [0]*(n+1); v = [0]*(n+1); p = [0]*(n+1); way = [0]*(n+1)
    for i in range(1, n+1):
        p[0] = i; j0 = 0
        minv = [INF]*(n+1); used = [False]*(n+1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = -1
            for j in range(1, n+1):
                if not used[j]:
                    cur = c[i0-1][j-1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j] = cur; way[j] = j0
                    if minv[j] < delta: delta = minv[j]; j1 = j
            for j in range(n+1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while j0:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    return sum(c[p[j]-1][j-1] for j in range(1, n+1) if p[j])

def max_assign(profit):
    n = len(profit)
    c = [[-profit[i][j] for j in range(n)] for i in range(n)]
    return -hungarian_min(c)

print(max_assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]))  # 11
```

---

### Task 13 — Rectangular Assignment (pad to square)

**Problem.** `n` workers, `m` tasks (`n ≤ m`), `cost[i][j]`. Assign every worker a distinct task minimizing cost.

**Constraints.** `1 ≤ n ≤ m ≤ 400`.

**Hint.** Pad to an `m×m` square with dummy workers whose cost is 0 (or a large constant if you must forbid). Run Hungarian.

```go
package main
import "fmt"
const INF = 1 << 60
func hungarian(c [][]int) int {
	n := len(c)
	u := make([]int, n+1); v := make([]int, n+1); p := make([]int, n+1); way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i; j0 := 0
		minv := make([]int, n+1); used := make([]bool, n+1)
		for j := range minv { minv[j] = INF }
		for {
			used[j0] = true; i0 := p[j0]; delta := INF; j1 := -1
			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := c[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] { minv[j] = cur; way[j] = j0 }
					if minv[j] < delta { delta = minv[j]; j1 = j }
				}
			}
			for j := 0; j <= n; j++ { if used[j] { u[p[j]] += delta; v[j] -= delta } else { minv[j] -= delta } }
			j0 = j1
			if p[j0] == 0 { break }
		}
		for j0 != 0 { j1 := way[j0]; p[j0] = p[j1]; j0 = j1 }
	}
	t := 0
	for j := 1; j <= n; j++ { if p[j] != 0 { t += c[p[j]-1][j-1] } }
	return t
}
func main() {
	cost := [][]int{{4, 1, 3}, {2, 0, 5}} // 2 workers, 3 tasks
	n, m := len(cost), len(cost[0])
	sq := make([][]int, m)
	for i := 0; i < m; i++ {
		sq[i] = make([]int, m)
		for j := 0; j < m; j++ {
			if i < n { sq[i][j] = cost[i][j] } else { sq[i][j] = 0 } // dummy workers free
		}
	}
	fmt.Println(hungarian(sq)) // 3 (dummy worker rows cost 0; real workers contribute 1+2 = 3)
}
```

```java
public class Task13 {
    static final long INF = Long.MAX_VALUE / 4;
    static long hungarian(int[][] c) {
        int n = c.length;
        long[] u = new long[n+1], v = new long[n+1];
        int[] p = new int[n+1], way = new int[n+1];
        for (int i = 1; i <= n; i++) {
            p[0] = i; int j0 = 0;
            long[] minv = new long[n+1]; boolean[] used = new boolean[n+1];
            java.util.Arrays.fill(minv, INF);
            do {
                used[j0] = true; int i0 = p[j0], j1 = -1; long delta = INF;
                for (int j = 1; j <= n; j++) if (!used[j]) {
                    long cur = c[i0-1][j-1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        long t = 0;
        for (int j = 1; j <= n; j++) if (p[j] != 0) t += c[p[j]-1][j-1];
        return t;
    }
    public static void main(String[] a) {
        int[][] cost = {{4,1,3},{2,0,5}};
        int n = cost.length, m = cost[0].length;
        int[][] sq = new int[m][m];
        for (int i = 0; i < m; i++) for (int j = 0; j < m; j++)
            sq[i][j] = (i < n) ? cost[i][j] : 0;
        System.out.println(hungarian(sq)); // 3
    }
}
```

```python
INF = float("inf")
def hungarian(c):
    n = len(c)
    u = [0]*(n+1); v = [0]*(n+1); p = [0]*(n+1); way = [0]*(n+1)
    for i in range(1, n+1):
        p[0] = i; j0 = 0
        minv = [INF]*(n+1); used = [False]*(n+1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = -1
            for j in range(1, n+1):
                if not used[j]:
                    cur = c[i0-1][j-1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j] = cur; way[j] = j0
                    if minv[j] < delta: delta = minv[j]; j1 = j
            for j in range(n+1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while j0:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    return sum(c[p[j]-1][j-1] for j in range(1, n+1) if p[j])

cost = [[4, 1, 3], [2, 0, 5]]
n, m = len(cost), len(cost[0])
sq = [[cost[i][j] if i < n else 0 for j in range(m)] for i in range(m)]
print(hungarian(sq))  # 3
```

---

### Task 14 — Minimum Lines to Cover All Ones (König)

**Problem.** Given a 0/1 matrix, find the minimum number of rows+columns to cover every 1.

**Constraints.** `1 ≤ rows, cols ≤ 500`.

**Hint.** Min lines = max matching where row `i` — col `j` iff `m[i][j]=1`.

```go
package main
import "fmt"
func minLines(g [][]int) int {
	n, m := len(g), len(g[0])
	adj := make([][]int, n)
	for i := 0; i < n; i++ { for j := 0; j < m; j++ { if g[i][j] == 1 { adj[i] = append(adj[i], j) } } }
	matchR := make([]int, m); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	c := 0
	for u := 0; u < n; u++ { used = make([]bool, m); if try(u) { c++ } }
	return c
}
func main() { fmt.Println(minLines([][]int{{1, 1, 0}, {0, 1, 1}, {0, 0, 1}})) } // 3
```

```java
import java.util.*;
public class Task14 {
    static List<List<Integer>> adj; static int[] matchR; static boolean[] used;
    static boolean tryK(int u) {
        for (int v : adj.get(u)) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        int[][] g = {{1,1,0},{0,1,1},{0,0,1}};
        int n = g.length, m = g[0].length;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            adj.add(new ArrayList<>());
            for (int j = 0; j < m; j++) if (g[i][j] == 1) adj.get(i).add(j);
        }
        matchR = new int[m]; Arrays.fill(matchR, -1);
        int c = 0;
        for (int u = 0; u < n; u++) { used = new boolean[m]; if (tryK(u)) c++; }
        System.out.println(c); // 2
    }
}
```

```python
def min_lines(g):
    n, m = len(g), len(g[0])
    adj = [[j for j in range(m) if g[i][j] == 1] for i in range(n)]
    match_r = [-1] * m
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    c = 0
    for u in range(n):
        if try_k(u, [False] * m):
            c += 1
    return c

print(min_lines([[1, 1, 0], [0, 1, 1], [0, 0, 1]]))  # 3
```

---

### Task 15 — Maximum Students Taking Exam (LeetCode 1349)

**Problem.** Grid of `.` (good) and `#` (broken) seats; a student sees left, right, upper-left, upper-right. Maximize seated students with no cheating. Answer = good seats − max matching of the conflict graph (even vs odd columns).

**Constraints.** `1 ≤ rows, cols ≤ 8` (or larger with bitmask DP; here use matching).

**Hint.** Build bipartite conflict graph between even-column and odd-column good seats; max independent set = total − matching.

```go
package main
import "fmt"
func maxStudents(seats []string) int {
	rows := len(seats); if rows == 0 { return 0 }
	cols := len(seats[0]); N := rows * cols
	id := func(r, c int) int { return r*cols + c }
	good := func(r, c int) bool { return r >= 0 && r < rows && c >= 0 && c < cols && seats[r][c] == '.' }
	adj := make([][]int, N); total := 0
	dirs := [][2]int{{0, -1}, {0, 1}, {-1, -1}, {-1, 1}}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if seats[r][c] != '.' { continue }
			total++
			if c%2 != 0 { continue }
			for _, d := range dirs {
				if good(r+d[0], c+d[1]) { adj[id(r, c)] = append(adj[id(r, c)], id(r+d[0], c+d[1])) }
			}
		}
	}
	matchR := make([]int, N); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	m := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c += 2 {
			if seats[r][c] == '.' { used = make([]bool, N); if try(id(r, c)) { m++ } }
		}
	}
	return total - m
}
func main() { fmt.Println(maxStudents([]string{"#.##", "#...", "...#"})) } // 4
```

```java
import java.util.*;
public class Task15 {
    static List<List<Integer>> adj; static int[] matchR; static boolean[] used;
    static boolean tryK(int u) {
        for (int v : adj.get(u)) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        String[] seats = {"#.##", "#...", "...#"};
        int rows = seats.length, cols = seats[0].length(), N = rows * cols, total = 0;
        adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int[][] dirs = {{0,-1},{0,1},{-1,-1},{-1,1}};
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c++) {
            if (seats[r].charAt(c) != '.') continue;
            total++;
            if (c % 2 != 0) continue;
            for (int[] d : dirs) {
                int nr = r + d[0], nc = c + d[1];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && seats[nr].charAt(nc) == '.')
                    adj.get(r * cols + c).add(nr * cols + nc);
            }
        }
        matchR = new int[N]; Arrays.fill(matchR, -1);
        int m = 0;
        for (int r = 0; r < rows; r++) for (int c = 0; c < cols; c += 2)
            if (seats[r].charAt(c) == '.') { used = new boolean[N]; if (tryK(r*cols+c)) m++; }
        System.out.println(total - m); // 4
    }
}
```

```python
def max_students(seats):
    rows = len(seats)
    if rows == 0: return 0
    cols = len(seats[0]); N = rows * cols
    def good(r, c): return 0 <= r < rows and 0 <= c < cols and seats[r][c] == '.'
    adj = [[] for _ in range(N)]; total = 0
    dirs = [(0, -1), (0, 1), (-1, -1), (-1, 1)]
    for r in range(rows):
        for c in range(cols):
            if seats[r][c] != '.': continue
            total += 1
            if c % 2 != 0: continue
            for dr, dc in dirs:
                if good(r + dr, c + dc):
                    adj[r * cols + c].append((r + dr) * cols + (c + dc))
    match_r = [-1] * N
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    m = 0
    for r in range(rows):
        for c in range(0, cols, 2):
            if seats[r][c] == '.':
                if try_k(r * cols + c, [False] * N):
                    m += 1
    return total - m

print(max_students(["#.##", "#...", "...#"]))  # 4
```

---

## Benchmark Task — Kuhn vs Hopcroft-Karp

**Problem.** Generate a random bipartite graph with `n = 5000` per side and `~5n` random edges. Run both Kuhn and Hopcroft-Karp; verify they return the **same** matching size and compare wall-clock time. Expect Hopcroft-Karp to win as `n` grows.

**Constraints.** `n` up to `10^5`; edges up to `10^6`.

**Hint.** Use a fixed seed for reproducibility; both must agree on the size (correctness check), then compare timings.

```go
package main
import (
	"fmt"
	"math/rand"
	"time"
)
// (Reuse Kuhn from Task 1 and Hopcroft-Karp from Task 6.)
func benchmark() {
	n, e := 5000, 25000
	rng := rand.New(rand.NewSource(42))
	edges := make([][2]int, e)
	for i := range edges { edges[i] = [2]int{rng.Intn(n), rng.Intn(n)} }
	// Build Kuhn adj
	adj := make([][]int, n)
	for _, ed := range edges { adj[ed[0]] = append(adj[ed[0]], ed[1]) }
	matchR := make([]int, n); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] { used[v] = true; if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true } }
		}
		return false
	}
	t0 := time.Now()
	c := 0
	for u := 0; u < n; u++ { used = make([]bool, n); if try(u) { c++ } }
	fmt.Printf("Kuhn: size=%d time=%v\n", c, time.Since(t0))
}
func main() { benchmark() }
```

```java
import java.util.*;
public class Benchmark {
    static int[] matchR; static boolean[] used; static List<List<Integer>> adj;
    static boolean tryK(int u) {
        for (int v : adj.get(u)) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        int n = 5000, e = 25000;
        Random rng = new Random(42);
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < e; i++) adj.get(rng.nextInt(n)).add(rng.nextInt(n));
        matchR = new int[n]; Arrays.fill(matchR, -1);
        long t0 = System.nanoTime();
        int c = 0;
        for (int u = 0; u < n; u++) { used = new boolean[n]; if (tryK(u)) c++; }
        System.out.printf("Kuhn: size=%d time=%.1fms%n", c, (System.nanoTime() - t0) / 1e6);
    }
}
```

```python
import random, time, sys
def benchmark():
    n, e = 5000, 25000
    random.seed(42)
    adj = [[] for _ in range(n)]
    for _ in range(e):
        adj[random.randrange(n)].append(random.randrange(n))
    match_r = [-1] * n
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    t0 = time.time()
    c = 0
    for u in range(n):
        if try_k(u, [False] * n):
            c += 1
    print(f"Kuhn: size={c} time={(time.time()-t0)*1000:.1f}ms")

sys.setrecursionlimit(10**6)
benchmark()
```

**Evaluation.** Both algorithms must report the identical matching size. Hopcroft-Karp should be faster at large `n`; record the ratio. On random sparse graphs the gap is modest, but on dense graphs (`e ≈ n²`) Hopcroft-Karp's `√V` advantage becomes dramatic.
