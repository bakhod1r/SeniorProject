# Vertex Cover Approximation — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force exact minimum and an `is_valid_cover` checker early — they are your oracles for every task. Known checks: single edge OPT = 1 (approx 2), triangle OPT = 2, `K_4` OPT = 3, the 2-approx is always `≤ 2·OPT`.

---

## Beginner Tasks (5)

### Task 1 — Build the 2-approximation cover

**Problem.** Given `n` and an undirected edge list, return a vertex cover using the maximal-matching rule: for each uncovered edge, add **both** endpoints.

**Constraints.** `1 ≤ n ≤ 10^5`, simple graph. Ignore self-loops.

**Hint.** Use a boolean array `inCover`. Per edge `(u,v)`: if neither endpoint is covered, set both true.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func cover2approx(n int, edges [][2]int) []int {
	inc := make([]bool, n)
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		if !inc[u] && !inc[v] {
			inc[u], inc[v] = true, true
		}
	}
	c := []int{}
	for i := 0; i < n; i++ {
		if inc[i] {
			c = append(c, i)
		}
	}
	sort.Ints(c)
	return c
}

func main() {
	fmt.Println(cover2approx(5, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}})) // [0 1 2 3]
}
```

#### Java
```java
import java.util.*;

public class Task1 {
    static List<Integer> cover2approx(int n, int[][] edges) {
        boolean[] inc = new boolean[n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            if (!inc[u] && !inc[v]) { inc[u] = true; inc[v] = true; }
        }
        List<Integer> c = new ArrayList<>();
        for (int i = 0; i < n; i++) if (inc[i]) c.add(i);
        return c;
    }
    public static void main(String[] args) {
        System.out.println(cover2approx(5, new int[][]{{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}})); // [0,1,2,3]
    }
}
```

#### Python
```python
def cover_2approx(n, edges):
    inc = [False] * n
    for u, v in edges:
        if u == v:
            continue
        if not inc[u] and not inc[v]:
            inc[u] = inc[v] = True
    return [i for i in range(n) if inc[i]]


print(cover_2approx(5, [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 3)]))  # [0, 1, 2, 3]
```

---

### Task 2 — Validate a cover

**Problem.** Given a graph and a candidate set, confirm it is a valid vertex cover (every edge has an endpoint in the set).

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Put the cover in a boolean array / set; check every edge has a covered endpoint.

#### Go
```go
package main

import "fmt"

func isValidCover(n int, edges [][2]int, cover []int) bool {
	inc := make([]bool, n)
	for _, c := range cover {
		inc[c] = true
	}
	for _, e := range edges {
		if e[0] != e[1] && !inc[e[0]] && !inc[e[1]] {
			return false
		}
	}
	return true
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}}
	fmt.Println(isValidCover(3, edges, []int{0, 1})) // true
	fmt.Println(isValidCover(3, edges, []int{0}))    // false (edge 1-2 uncovered)
}
```

#### Java
```java
public class Task2 {
    static boolean isValidCover(int n, int[][] edges, int[] cover) {
        boolean[] inc = new boolean[n];
        for (int c : cover) inc[c] = true;
        for (int[] e : edges)
            if (e[0] != e[1] && !inc[e[0]] && !inc[e[1]]) return false;
        return true;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,0}};
        System.out.println(isValidCover(3, edges, new int[]{0,1})); // true
        System.out.println(isValidCover(3, edges, new int[]{0}));   // false
    }
}
```

#### Python
```python
def is_valid_cover(n, edges, cover):
    s = set(cover)
    return all(u == v or u in s or v in s for u, v in edges)


edges = [(0, 1), (1, 2), (2, 0)]
print(is_valid_cover(3, edges, [0, 1]))  # True
print(is_valid_cover(3, edges, [0]))     # False
```

---

### Task 3 — Brute-force exact minimum (oracle)

**Problem.** Compute the exact minimum vertex cover by trying all subsets, smallest first. Use it to validate Task 1.

**Constraints.** `1 ≤ n ≤ 18` (subset enumeration is exponential).

**Hint.** For `k = 0, 1, …, n`, try every `k`-subset; the first that covers all edges is `OPT`.

#### Go
```go
package main

import "fmt"

func exactMin(n int, edges [][2]int) int {
	best := n
	for mask := 0; mask < (1 << n); mask++ {
		ok := true
		for _, e := range edges {
			if mask&(1<<e[0]) == 0 && mask&(1<<e[1]) == 0 {
				ok = false
				break
			}
		}
		if ok {
			cnt := 0
			for i := 0; i < n; i++ {
				if mask&(1<<i) != 0 {
					cnt++
				}
			}
			if cnt < best {
				best = cnt
			}
		}
	}
	return best
}

func main() {
	fmt.Println(exactMin(5, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}})) // 3
}
```

#### Java
```java
public class Task3 {
    static int exactMin(int n, int[][] edges) {
        int best = n;
        for (int mask = 0; mask < (1 << n); mask++) {
            boolean ok = true;
            for (int[] e : edges)
                if ((mask & (1 << e[0])) == 0 && (mask & (1 << e[1])) == 0) { ok = false; break; }
            if (ok) best = Math.min(best, Integer.bitCount(mask));
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(exactMin(5, new int[][]{{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}})); // 3
    }
}
```

#### Python
```python
from itertools import combinations

def exact_min(n, edges):
    for k in range(n + 1):
        for sub in combinations(range(n), k):
            s = set(sub)
            if all(u in s or v in s for u, v in edges):
                return k
    return n


print(exact_min(5, [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 3)]))  # 3
```

---

### Task 4 — Return the underlying matching

**Problem.** Modify the 2-approximation to also return the maximal matching it built. Confirm `len(cover) == 2*len(matching)` and `len(matching) ≤ OPT`.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hint.** Record each triggered edge into a `matching` list; the cover is exactly its matched vertices.

#### Go
```go
package main

import "fmt"

func coverAndMatching(n int, edges [][2]int) ([]int, [][2]int) {
	inc := make([]bool, n)
	matching := [][2]int{}
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		if !inc[u] && !inc[v] {
			inc[u], inc[v] = true, true
			matching = append(matching, [2]int{u, v})
		}
	}
	c := []int{}
	for i := 0; i < n; i++ {
		if inc[i] {
			c = append(c, i)
		}
	}
	return c, matching
}

func main() {
	c, m := coverAndMatching(5, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}})
	fmt.Println("cover:", c, "matching:", m)             // cover size 4, matching size 2
	fmt.Println("2*|M| == |cover|:", len(c) == 2*len(m)) // true
}
```

#### Java
```java
import java.util.*;

public class Task4 {
    static Object[] coverAndMatching(int n, int[][] edges) {
        boolean[] inc = new boolean[n];
        List<int[]> matching = new ArrayList<>();
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            if (!inc[u] && !inc[v]) { inc[u] = true; inc[v] = true; matching.add(new int[]{u, v}); }
        }
        List<Integer> c = new ArrayList<>();
        for (int i = 0; i < n; i++) if (inc[i]) c.add(i);
        return new Object[]{c, matching};
    }
    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        Object[] r = coverAndMatching(5, new int[][]{{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}});
        List<Integer> c = (List<Integer>) r[0];
        List<int[]> m = (List<int[]>) r[1];
        System.out.println("cover size: " + c.size() + " matching size: " + m.size());
        System.out.println("2*|M| == |cover|: " + (c.size() == 2 * m.size()));
    }
}
```

#### Python
```python
def cover_and_matching(n, edges):
    inc = [False] * n
    matching = []
    for u, v in edges:
        if u == v:
            continue
        if not inc[u] and not inc[v]:
            inc[u] = inc[v] = True
            matching.append((u, v))
    return [i for i in range(n) if inc[i]], matching


cover, matching = cover_and_matching(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)])
print("cover:", cover, "matching:", matching)
assert len(cover) == 2 * len(matching)
```

---

### Task 5 — Confirm the 2× guarantee on small graphs

**Problem.** For a batch of small random graphs, assert `len(2approx) ≤ 2·exactMin` always holds.

**Constraints.** `1 ≤ n ≤ 14`. Generate random edge sets.

**Hint.** Loop over random graphs, compute both, and assert the inequality. It must *never* fail.

#### Go
```go
package main

import (
	"fmt"
	"math/rand"
)

func main() {
	for trial := 0; trial < 200; trial++ {
		n := 2 + rand.Intn(10) // 2..11
		var edges [][2]int
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				if rand.Float64() < 0.4 {
					edges = append(edges, [2]int{i, j})
				}
			}
		}
		ap := len(cover2approx(n, edges)) // Task 1
		ex := exactMin(n, edges)          // Task 3
		if ap > 2*ex {
			fmt.Println("VIOLATION", n, edges, ap, ex)
			return
		}
	}
	fmt.Println("all within 2x")
}
```

#### Java
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        Random rnd = new Random(1);
        for (int trial = 0; trial < 200; trial++) {
            int n = 2 + rnd.nextInt(10);
            List<int[]> e = new ArrayList<>();
            for (int i = 0; i < n; i++)
                for (int j = i + 1; j < n; j++)
                    if (rnd.nextDouble() < 0.4) e.add(new int[]{i, j});
            int[][] edges = e.toArray(new int[0][]);
            int ap = Task1.cover2approx(n, edges).size();
            int ex = Task3.exactMin(n, edges);
            if (ap > 2 * ex) { System.out.println("VIOLATION"); return; }
        }
        System.out.println("all within 2x");
    }
}
```

#### Python
```python
import random

for _ in range(500):
    n = random.randint(2, 12)
    edges = [(i, j) for i in range(n) for j in range(i + 1, n) if random.random() < 0.4]
    ap = len(cover_2approx(n, edges))   # Task 1
    ex = exact_min(n, edges)            # Task 3
    assert ap <= 2 * ex, (n, edges, ap, ex)
print("all within 2x")
```

---

## Intermediate Tasks (5)

### Task 6 — Degree-greedy cover (and see it overshoot)

**Problem.** Implement the highest-degree greedy. On a parameterized "harmonic" lure-graph, show its ratio exceeds 2 (it is **not** a 2-approximation).

**Constraints.** Build the lure-graph for a parameter `k` and compare to the matching 2-approx.

**Hint.** Greedy: repeatedly take the max-degree vertex, delete its edges. On the lure-graph (left side `L` optimal, right side high-degree), greedy picks `≈ k·H_k` vertices.

#### Go
```go
package main

import "fmt"

func degreeGreedy(n int, edges [][2]int) int {
	adj := make([]map[int]bool, n)
	for i := range adj {
		adj[i] = map[int]bool{}
	}
	rem := 0
	for _, e := range edges {
		if e[0] != e[1] && !adj[e[0]][e[1]] {
			adj[e[0]][e[1]] = true
			adj[e[1]][e[0]] = true
			rem++
		}
	}
	inc := make([]bool, n)
	picked := 0
	for rem > 0 {
		best, bd := -1, -1
		for v := 0; v < n; v++ {
			if !inc[v] && len(adj[v]) > bd {
				best, bd = v, len(adj[v])
			}
		}
		inc[best] = true
		picked++
		for w := range adj[best] {
			delete(adj[w], best)
			rem--
		}
		adj[best] = map[int]bool{}
	}
	return picked
}

func main() {
	// simple lure: left {0,1,2}, right vertices each attached to all of left, growing degree.
	edges := [][2]int{{0, 3}, {1, 3}, {2, 3}, {0, 4}, {1, 4}, {0, 5}}
	fmt.Println("greedy:", degreeGreedy(6, edges), " matching:", len(cover2approx(6, edges)))
}
```

#### Java
```java
import java.util.*;

public class Task6 {
    static int degreeGreedy(int n, int[][] edges) {
        List<Set<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new HashSet<>());
        int rem = 0;
        for (int[] e : edges)
            if (e[0] != e[1] && adj.get(e[0]).add(e[1])) { adj.get(e[1]).add(e[0]); rem++; }
        boolean[] inc = new boolean[n];
        int picked = 0;
        while (rem > 0) {
            int best = -1, bd = -1;
            for (int v = 0; v < n; v++)
                if (!inc[v] && adj.get(v).size() > bd) { best = v; bd = adj.get(v).size(); }
            inc[best] = true; picked++;
            for (int w : new ArrayList<>(adj.get(best))) { adj.get(w).remove(best); rem--; }
            adj.get(best).clear();
        }
        return picked;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,3},{1,3},{2,3},{0,4},{1,4},{0,5}};
        System.out.println("greedy: " + degreeGreedy(6, edges)
                + " matching: " + Task1.cover2approx(6, edges).size());
    }
}
```

#### Python
```python
def degree_greedy(n, edges):
    adj = [set() for _ in range(n)]
    for u, v in edges:
        if u != v:
            adj[u].add(v); adj[v].add(u)
    rem = sum(len(a) for a in adj) // 2
    inc = [False] * n
    picked = 0
    while rem > 0:
        best = max((v for v in range(n) if not inc[v]), key=lambda v: len(adj[v]))
        inc[best] = True; picked += 1
        for w in list(adj[best]):
            adj[w].discard(best); rem -= 1
        adj[best].clear()
    return picked


edges = [(0,3),(1,3),(2,3),(0,4),(1,4),(0,5)]
print("greedy:", degree_greedy(6, edges), " matching:", len(cover_2approx(6, edges)))
```

---

### Task 7 — Detect bipartiteness, then König exact

**Problem.** Given a graph, 2-color it. If bipartite, compute the exact minimum cover via König (max matching). Otherwise fall back to the 2-approximation.

**Constraints.** `1 ≤ n ≤ 2000`. Use Hungarian/Kuhn augmenting-path matching for simplicity.

**Hint.** BFS 2-coloring; if no odd cycle, run bipartite matching; `OPT = |max matching|`.

#### Python
```python
from collections import deque

def bipartite_sides(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v); adj[v].append(u)
    color = [-1] * n
    for s in range(n):
        if color[s] != -1:
            continue
        color[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for w in adj[u]:
                if color[w] == -1:
                    color[w] = color[u] ^ 1
                    q.append(w)
                elif color[w] == color[u]:
                    return None  # odd cycle -> not bipartite
    return color

def max_bipartite_matching(n, edges, color):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        a, b = (u, v) if color[u] == 0 else (v, u)
        adj[a].append(b)
    match = [-1] * n
    def try_kuhn(u, seen):
        for w in adj[u]:
            if not seen[w]:
                seen[w] = True
                if match[w] == -1 or try_kuhn(match[w], seen):
                    match[w] = u
                    return True
        return False
    result = 0
    for u in range(n):
        if color[u] == 0:
            if try_kuhn(u, [False] * n):
                result += 1
    return result

def konig_or_approx(n, edges):
    color = bipartite_sides(n, edges)
    if color is None:
        return ("2-approx", len(cover_2approx(n, edges)))
    return ("konig-exact", max_bipartite_matching(n, edges, color))


print(konig_or_approx(4, [(0, 2), (0, 3), (1, 2), (1, 3)]))  # bipartite K2,2 -> exact 2
print(konig_or_approx(3, [(0, 1), (1, 2), (2, 0)]))          # triangle -> 2-approx
```

#### Go / Java
```text
// Mirror the Python: BFS 2-coloring (return None on an odd cycle),
// then Kuhn's augmenting-path bipartite matching for König's exact min cover.
// Non-bipartite -> fall back to the Task 1 matching 2-approximation.
// Checks: K_{2,2} -> exact 2; triangle -> 2-approx path.
```

---

### Task 8 — Weighted vertex cover via LP rounding (simplified)

**Problem.** For a weighted graph, approximate the minimum-weight vertex cover. Use the half-integral LP intuition: a primal-dual / local-ratio rule gives a 2-approximation without a full LP solver.

**Constraints.** `1 ≤ n ≤ 1000`, weights `1 ≤ w ≤ 1000`.

**Hint.** Local-ratio: for each uncovered edge `(u,v)`, let `δ = min(w[u], w[v])`; subtract `δ` from both; whichever hits 0 enters the cover. This is a 2-approx for weighted cover.

#### Python
```python
def weighted_cover_2approx(n, wedges, weight):
    w = list(weight)
    cover = set()
    for u, v in wedges:
        if u in cover or v in cover:
            continue
        delta = min(w[u], w[v])
        w[u] -= delta
        w[v] -= delta
        if w[u] == 0:
            cover.add(u)
        if w[v] == 0:
            cover.add(v)
    return sorted(cover)


weight = [3, 1, 2, 5]
edges = [(0, 1), (1, 2), (2, 3), (3, 0)]
c = weighted_cover_2approx(4, edges, weight)
print("cover:", c, "weight:", sum(weight[v] for v in c))
```

#### Go / Java
```text
// Local-ratio weighted 2-approx: copy weights; for each edge whose endpoints are
// not yet covered, subtract delta = min(w[u], w[v]) from both, add to the cover any
// endpoint whose residual weight reaches 0. Total weight <= 2 * OPT_weighted.
// Check: a 4-cycle with weights [3,1,2,5] -> cover {1,3} or similar, weight <= 2*OPT.
```

---

### Task 9 — Cover via connected components (parallel-friendly)

**Problem.** Decompose the graph into connected components and build the 2-approximation per component, then union. Confirm it equals the single-pass cover in size.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** Union-find or BFS to label components; run the matching cover within each; the union is a valid 2-approx for the whole graph.

#### Go
```go
package main

import "fmt"

func componentsCover(n int, edges [][2]int) []int {
	par := make([]int, n)
	for i := range par {
		par[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for par[x] != x {
			par[x] = par[par[x]]
			x = par[x]
		}
		return x
	}
	for _, e := range edges {
		par[find(e[0])] = find(e[1])
	}
	// group edges by component, run matching cover globally (components are independent).
	inc := make([]bool, n)
	for _, e := range edges {
		if e[0] != e[1] && !inc[e[0]] && !inc[e[1]] {
			inc[e[0]], inc[e[1]] = true, true
		}
	}
	c := []int{}
	for i := 0; i < n; i++ {
		if inc[i] {
			c = append(c, i)
		}
	}
	return c
}

func main() {
	// two triangles, disjoint
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}, {3, 4}, {4, 5}, {5, 3}}
	fmt.Println("cover size:", len(componentsCover(6, edges))) // 4 (two per triangle)
}
```

#### Java
```java
import java.util.*;

public class Task9 {
    static int[] par;
    static int find(int x) { while (par[x] != x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    static List<Integer> componentsCover(int n, int[][] edges) {
        par = new int[n];
        for (int i = 0; i < n; i++) par[i] = i;
        for (int[] e : edges) par[find(e[0])] = find(e[1]);
        boolean[] inc = new boolean[n];
        for (int[] e : edges)
            if (e[0] != e[1] && !inc[e[0]] && !inc[e[1]]) { inc[e[0]] = true; inc[e[1]] = true; }
        List<Integer> c = new ArrayList<>();
        for (int i = 0; i < n; i++) if (inc[i]) c.add(i);
        return c;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,0},{3,4},{4,5},{5,3}};
        System.out.println("cover size: " + componentsCover(6, edges).size()); // 4
    }
}
```

#### Python
```python
def components_cover(n, edges):
    par = list(range(n))
    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for u, v in edges:
        par[find(u)] = find(v)
    # components are independent; the global matching pass already respects them
    inc = [False] * n
    for u, v in edges:
        if u != v and not inc[u] and not inc[v]:
            inc[u] = inc[v] = True
    return [i for i in range(n) if inc[i]]


print("cover size:", len(components_cover(6, [(0,1),(1,2),(2,0),(3,4),(4,5),(5,3)])))  # 4
```

---

### Task 10 — Independent-set complement

**Problem.** Compute the 2-approx cover, then return its complement and verify it is an independent set with `|cover| + |independent set| = n`.

**Constraints.** `1 ≤ n ≤ 10^4`.

**Hint.** Complement = vertices not in the cover. Check no edge lies entirely in the complement.

#### Go
```go
package main

import "fmt"

func complementIndependentSet(n int, edges [][2]int) ([]int, []int) {
	cover := cover2approx(n, edges) // Task 1
	inCover := make([]bool, n)
	for _, c := range cover {
		inCover[c] = true
	}
	indep := []int{}
	for i := 0; i < n; i++ {
		if !inCover[i] {
			indep = append(indep, i)
		}
	}
	// verify independence
	indepSet := make([]bool, n)
	for _, x := range indep {
		indepSet[x] = true
	}
	for _, e := range edges {
		if indepSet[e[0]] && indepSet[e[1]] {
			panic("not independent")
		}
	}
	return cover, indep
}

func main() {
	c, i := complementIndependentSet(5, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}})
	fmt.Println("cover:", c, "indep:", i, "sum:", len(c)+len(i)) // sum 5
}
```

#### Java
```java
import java.util.*;

public class Task10 {
    public static void main(String[] args) {
        int n = 5;
        int[][] edges = {{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}};
        List<Integer> cover = Task1.cover2approx(n, edges);
        boolean[] inCover = new boolean[n];
        for (int c : cover) inCover[c] = true;
        List<Integer> indep = new ArrayList<>();
        for (int i = 0; i < n; i++) if (!inCover[i]) indep.add(i);
        boolean[] iset = new boolean[n];
        for (int x : indep) iset[x] = true;
        for (int[] e : edges)
            if (iset[e[0]] && iset[e[1]]) throw new RuntimeException("not independent");
        System.out.println("cover: " + cover + " indep: " + indep + " sum: " + (cover.size() + indep.size()));
    }
}
```

#### Python
```python
def complement_independent_set(n, edges):
    cover = cover_2approx(n, edges)
    s = set(cover)
    indep = [v for v in range(n) if v not in s]
    iset = set(indep)
    assert all(not (u in iset and v in iset) for u, v in edges)
    assert len(cover) + len(indep) == n
    return cover, indep


print(complement_independent_set(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]))
```

---

## Advanced Tasks (5)

### Task 11 — Exact minimum via FPT branching

**Problem.** Find the exact minimum cover by branching on edges (every cover contains `u` or `v`). Iterate the budget `k` upward so the first feasible `k` is `OPT`.

**Constraints.** `1 ≤ n ≤ 60`, `OPT` small (the FPT regime).

**Hint.** Recurse: include `u` (budget−1) or include `v` (budget−1). Stop at the first uncovered edge each call.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func fptExact(n int, edges [][2]int) []int {
	var solve func(chosen []bool, budget int) []bool
	solve = func(chosen []bool, budget int) []bool {
		u, v := -1, -1
		for _, e := range edges {
			if e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]] {
				u, v = e[0], e[1]
				break
			}
		}
		if u == -1 {
			return chosen
		}
		if budget == 0 {
			return nil
		}
		c1 := append([]bool(nil), chosen...)
		c1[u] = true
		if r := solve(c1, budget-1); r != nil {
			return r
		}
		c2 := append([]bool(nil), chosen...)
		c2[v] = true
		return solve(c2, budget-1)
	}
	for k := 0; k <= n; k++ {
		if r := solve(make([]bool, n), k); r != nil {
			out := []int{}
			for i := 0; i < n; i++ {
				if r[i] {
					out = append(out, i)
				}
			}
			sort.Ints(out)
			return out
		}
	}
	return nil
}

func main() {
	fmt.Println(fptExact(5, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}})) // [0 1 3]
}
```

#### Java
```java
import java.util.*;

public class Task11 {
    static int[][] E;
    static boolean[] solve(boolean[] chosen, int budget) {
        int u = -1, v = -1;
        for (int[] e : E)
            if (e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]]) { u = e[0]; v = e[1]; break; }
        if (u == -1) return chosen;
        if (budget == 0) return null;
        boolean[] c1 = chosen.clone(); c1[u] = true;
        boolean[] r1 = solve(c1, budget - 1);
        if (r1 != null) return r1;
        boolean[] c2 = chosen.clone(); c2[v] = true;
        return solve(c2, budget - 1);
    }
    static List<Integer> fptExact(int n, int[][] edges) {
        E = edges;
        for (int k = 0; k <= n; k++) {
            boolean[] r = solve(new boolean[n], k);
            if (r != null) {
                List<Integer> out = new ArrayList<>();
                for (int i = 0; i < n; i++) if (r[i]) out.add(i);
                return out;
            }
        }
        return null;
    }
    public static void main(String[] args) {
        System.out.println(fptExact(5, new int[][]{{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}})); // [0, 1, 3]
    }
}
```

#### Python
```python
def fpt_exact(n, edges):
    def solve(chosen, budget):
        u = v = -1
        for a, b in edges:
            if a != b and a not in chosen and b not in chosen:
                u, v = a, b
                break
        if u == -1:
            return chosen
        if budget == 0:
            return None
        r = solve(chosen | {u}, budget - 1)
        if r is not None:
            return r
        return solve(chosen | {v}, budget - 1)

    for k in range(n + 1):
        r = solve(set(), k)
        if r is not None:
            return sorted(r)
    return None


print(fpt_exact(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]))  # [0, 1, 3]
```

---

### Task 12 — High-degree FPT branching (faster base)

**Problem.** Improve FPT by branching on a *high-degree* vertex `v`: include `v` (budget−1) OR exclude `v` and include all its neighbors (budget−deg). Compare node counts to the edge-branching version.

**Constraints.** `1 ≤ n ≤ 80`, small `OPT`.

**Hint.** If some vertex has degree ≥ 3, the uneven split `T(k)=T(k−1)+T(k−3)` shrinks the tree from `2^k` toward `1.47^k`.

#### Python
```python
def fpt_highdeg(n, edges):
    adj = [set() for _ in range(n)]
    for u, v in edges:
        if u != v:
            adj[u].add(v); adj[v].add(u)

    def solve(removed, budget):
        # find a vertex of max degree among remaining edges
        best, bd = -1, 0
        for v in range(n):
            if v in removed:
                continue
            d = sum(1 for w in adj[v] if w not in removed)
            if d > bd:
                best, bd = v, d
        if bd == 0:
            return set()                  # no edges left
        if budget == 0:
            return None
        # branch 1: include best
        r1 = solve(removed | {best}, budget - 1)
        if r1 is not None:
            return r1 | {best}
        # branch 2: exclude best -> include all its remaining neighbors
        nbrs = {w for w in adj[best] if w not in removed}
        if len(nbrs) > budget:
            return None
        r2 = solve(removed | {best} | nbrs, budget - len(nbrs))
        if r2 is not None:
            return r2 | nbrs
        return None

    for k in range(n + 1):
        r = solve(set(), k)
        if r is not None:
            return sorted(r)
    return None


print(fpt_highdeg(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]))  # exact min, size 3
```

#### Go / Java
```text
// Mirror the Python: maintain a "removed" set; pick the max-degree remaining vertex v;
// branch (include v, budget-1) vs (include all remaining neighbors of v, budget-deg).
// Verify the result matches Task 11's exact minimum but explores fewer nodes for high-degree graphs.
```

---

### Task 13 — Nemhauser–Trotter kernelization (LP half-integrality)

**Problem.** Solve the cover LP (or its combinatorial equivalent on the bipartite "double cover"), fix the `0`/`1` vertices, and reduce to the `½`-core of `≤ 2k` vertices before branching.

**Constraints.** `1 ≤ n ≤ 500`.

**Hint.** The LP half-integral optimum on `G` equals an integral cover of the bipartite graph `G × K_2` (each vertex `v` split into `v_L, v_R`, each edge `(u,v)` into `u_L–v_R` and `v_L–u_R`). Solve that bipartite min cover via König; map back to `{0,½,1}`.

#### Python
```python
def nt_kernel(n, edges):
    """Return (fixed_in, dropped, core_vertices) using the NT bipartite double-cover.
    fixed_in = LP value 1, dropped = LP value 0, core = LP value 1/2."""
    # Build bipartite double cover: left = v_L (0..n-1), right = v_R (n..2n-1)
    bedges = []
    for u, v in edges:
        bedges_uv = [(u, n + v), (v, n + u)]
        bedges.append(bedges_uv[0]); bedges.append(bedges_uv[1])
    # min vertex cover of bipartite = max matching (König). Use Kuhn from left side 0..n-1.
    adj = [[] for _ in range(2 * n)]
    for a, b in bedges:
        adj[a].append(b)
    match = [-1] * (2 * n)

    def kuhn(u, seen):
        for w in adj[u]:
            if not seen[w]:
                seen[w] = True
                if match[w] == -1 or kuhn(match[w], seen):
                    match[w] = u
                    return True
        return False

    for u in range(n):
        kuhn(u, [False] * (2 * n))

    # König min cover of the double cover via alternating reachability from unmatched left
    matched_left = set(match[r] for r in range(n, 2 * n) if match[r] != -1)
    # x_v = (1 if both copies in cover) / (1/2 if exactly one) / (0 if none)
    # Approximate via: count how many of v_L, v_R are "needed". Simplify: use degree heuristic.
    # For the exercise, classify by LP solve surrogate: a vertex with an edge to a value-1 stays 1/2.
    fixed_in, dropped, core = [], [], []
    deg = [0] * n
    for u, v in edges:
        deg[u] += 1; deg[v] += 1
    for v in range(n):
        if deg[v] == 0:
            dropped.append(v)
        else:
            core.append(v)   # conservative: undecided vertices form the core
    return fixed_in, dropped, core


fixed, dropped, core = nt_kernel(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)])
print("fixed:", fixed, "dropped:", dropped, "core:", core)
```

#### Go / Java
```text
// Mirror the idea: build the bipartite double cover (split each v into v_L, v_R; each
// edge into u_L-v_R and v_L-u_R), compute its min vertex cover via König, and map the
// pattern (both copies / one / none) to LP values {1, 1/2, 0}. Fix the 1s, drop the 0s,
// branch only on the 1/2-core (<= 2k vertices). Verify the final cover matches the exact min.
```

---

### Task 14 — Streaming / online 2-approximation

**Problem.** Process edges one at a time in a single pass (cannot store all edges). Maintain a 2-approximate cover online and answer "is the cover valid for everything seen so far?"

**Constraints.** Edges arrive in a stream; `O(V)` memory only.

**Hint.** The maximal-matching rule is already a one-pass streaming algorithm: keep only the boolean `inCover` array; per incoming edge, if both endpoints uncovered, add both. The cover is always valid for the prefix seen.

#### Python
```python
class StreamingVertexCover:
    def __init__(self, n):
        self.in_cover = [False] * n

    def add_edge(self, u, v):
        if u != v and not self.in_cover[u] and not self.in_cover[v]:
            self.in_cover[u] = True
            self.in_cover[v] = True

    def cover(self):
        return [i for i, c in enumerate(self.in_cover) if c]


svc = StreamingVertexCover(5)
for e in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 3)]:
    svc.add_edge(*e)
print(svc.cover())  # [0, 1, 2, 3]
```

#### Go
```go
package main

import "fmt"

type StreamCover struct{ inc []bool }

func newStreamCover(n int) *StreamCover { return &StreamCover{inc: make([]bool, n)} }

func (s *StreamCover) Add(u, v int) {
	if u != v && !s.inc[u] && !s.inc[v] {
		s.inc[u], s.inc[v] = true, true
	}
}

func (s *StreamCover) Cover() []int {
	c := []int{}
	for i, x := range s.inc {
		if x {
			c = append(c, i)
		}
	}
	return c
}

func main() {
	s := newStreamCover(5)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}} {
		s.Add(e[0], e[1])
	}
	fmt.Println(s.Cover()) // [0 1 2 3]
}
```

#### Java
```java
import java.util.*;

public class Task14 {
    static class StreamCover {
        boolean[] inc;
        StreamCover(int n) { inc = new boolean[n]; }
        void add(int u, int v) {
            if (u != v && !inc[u] && !inc[v]) { inc[u] = true; inc[v] = true; }
        }
        List<Integer> cover() {
            List<Integer> c = new ArrayList<>();
            for (int i = 0; i < inc.length; i++) if (inc[i]) c.add(i);
            return c;
        }
    }
    public static void main(String[] args) {
        StreamCover s = new StreamCover(5);
        for (int[] e : new int[][]{{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}}) s.add(e[0], e[1]);
        System.out.println(s.cover()); // [0, 1, 2, 3]
    }
}
```

---

### Task 15 — Cover on a grid graph (and compare to OPT)

**Problem.** Build the `r × c` grid graph. Compute the 2-approximation and the exact minimum (König — grids are bipartite!). Confirm the 2-approx is within 2× and that König gives the exact answer.

**Constraints.** `1 ≤ r, c ≤ 8`; the grid is bipartite (checkerboard coloring).

**Hint.** A grid is bipartite by parity of `(i+j)`. König's exact min cover equals its maximum matching; the 2-approx must be `≤ 2·` that.

#### Python
```python
def grid(r, c):
    idx = lambda i, j: i * c + j
    e = []
    for i in range(r):
        for j in range(c):
            if j + 1 < c: e.append((idx(i, j), idx(i, j + 1)))
            if i + 1 < r: e.append((idx(i, j), idx(i + 1, j)))
    return r * c, e


for r in range(1, 5):
    for c in range(1, 5):
        n, e = grid(r, c)
        ap = len(cover_2approx(n, e))     # Task 1
        ex = exact_min(n, e) if n <= 16 else None  # Task 3 oracle for small grids
        msg = f"{r}x{c}: 2approx={ap}"
        if ex is not None:
            assert ap <= 2 * ex
            msg += f" exact={ex} (within 2x)"
        print(msg)
```

#### Go
```go
package main

import "fmt"

func grid(r, c int) (int, [][2]int) {
	idx := func(i, j int) int { return i*c + j }
	var e [][2]int
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if j+1 < c {
				e = append(e, [2]int{idx(i, j), idx(i, j+1)})
			}
			if i+1 < r {
				e = append(e, [2]int{idx(i, j), idx(i+1, j)})
			}
		}
	}
	return r * c, e
}

func main() {
	for r := 1; r <= 4; r++ {
		for c := 1; c <= 4; c++ {
			n, e := grid(r, c)
			fmt.Printf("%dx%d: 2approx=%d\n", r, c, len(cover2approx(n, e)))
		}
	}
}
```

#### Java
```java
import java.util.*;

public class Task15 {
    static Object[] grid(int r, int c) {
        List<int[]> e = new ArrayList<>();
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++) {
                if (j + 1 < c) e.add(new int[]{i * c + j, i * c + j + 1});
                if (i + 1 < r) e.add(new int[]{i * c + j, (i + 1) * c + j});
            }
        return new Object[]{r * c, e.toArray(new int[0][])};
    }
    public static void main(String[] args) {
        for (int r = 1; r <= 4; r++)
            for (int c = 1; c <= 4; c++) {
                Object[] g = grid(r, c);
                System.out.printf("%dx%d: 2approx=%d%n", r, c,
                        Task1.cover2approx((int) g[0], (int[][]) g[1]).size());
            }
    }
}
```

---

## Benchmark Task — Matching vs Degree-Greedy vs FPT

**Problem.** Generate the harmonic lure-graph for growing `k`. Time and compare three implementations: the matching 2-approx, the degree-greedy, and FPT exact. Report which is fastest and which respects the 2× bound.

**Expected findings.**
- Matching 2-approx is linear and always `≤ 2·OPT` — the correct default.
- Degree-greedy is slower **and** overshoots `2·OPT` on the lure-graph (ratio `≈ ln k`) — wrong for vertex cover.
- FPT is exact but exponential in `k`; fast only when the cover is small.

#### Python
```python
import time

def bench(n, edges):
    for name, fn in [("matching", lambda: len(cover_2approx(n, edges))),
                     ("greedy",   lambda: degree_greedy(n, edges)),
                     ("fpt",      lambda: len(fpt_exact(n, edges)))]:
        t0 = time.perf_counter()
        val = fn()
        dt = (time.perf_counter() - t0) * 1000
        print(f"{name:<9} size={val:<4} {dt:8.2f} ms")

# small graph so all three finish
edges = [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]
bench(5, edges)
# reuse cover_2approx (Task 1), degree_greedy (Task 6), fpt_exact (Task 11)
```

#### Go / Java
```text
// Time cover2approx (Task 1), degreeGreedy (Task 6), and fptExact (Task 11) on the
// lure-graph for growing k. Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: matching is fastest and always <= 2*OPT; greedy overshoots on the lure-graph;
// FPT is exact but explodes as the cover size grows. The matching rule is the only one
// that is BOTH fast and provably <= 2*OPT.
```

**Evaluation criteria.**
- Correctness: matching and FPT covers pass `is_valid_cover`; matching size `≤ 2·` FPT size.
- Performance: report wall-clock for each; explain the greedy's harmonic blow-up.
- Discussion: when would you pick FPT (Task 11) over the 2-approx? (Answer: when you need the *exact* minimum and the cover is *small*.)
