# NP-Hard: TSP & Hamiltonian Path/Cycle — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a clear spec, constraints, hints, and evaluation criteria. Verify exact solvers against brute force on small `n`, and verify heuristics by their *length never exceeding* the construction they started from.

---

## Beginner Tasks (5)

### Task 1 — Brute-force TSP over all permutations

**Problem.** Given an `n×n` distance matrix (`n ≤ 10`), compute the shortest tour starting and ending at city 0 by trying every permutation of the other cities.

**Input / Output.**
- Input: integer `n`, then `n` rows of `n` integers.
- Output: the minimum tour length.

**Constraints.**
- `1 ≤ n ≤ 10`.
- Weights non-negative, fit in 32-bit int.

**Hint.** Fix city 0 as start; permute cities `1..n-1`; for each permutation sum consecutive distances plus the closing edge back to 0.

**Evaluation criteria.**
- Correct minimum on all provided cases.
- Used as the *oracle* to validate Held–Karp in Task 2.

**Starter — Go.**
```go
package main

import "fmt"

func bruteTSP(d [][]int) int {
	n := len(d)
	perm := make([]int, 0, n-1)
	for i := 1; i < n; i++ {
		perm = append(perm, i)
	}
	best := 1 << 30
	var rec func(k int)
	rec = func(k int) {
		if k == len(perm) {
			cost, prev := 0, 0
			for _, c := range perm {
				cost += d[prev][c]
				prev = c
			}
			cost += d[prev][0]
			if cost < best {
				best = cost
			}
			return
		}
		for i := k; i < len(perm); i++ {
			perm[k], perm[i] = perm[i], perm[k]
			rec(k + 1)
			perm[k], perm[i] = perm[i], perm[k]
		}
	}
	rec(0)
	return best
}

func main() {
	d := [][]int{{0, 10, 15, 20}, {10, 0, 35, 25}, {15, 35, 0, 30}, {20, 25, 30, 0}}
	fmt.Println(bruteTSP(d)) // 80
}
```

**Starter — Java.**
```java
public class Task1 {
    static int best;
    static int[][] d;
    static void rec(int[] perm, int k) {
        if (k == perm.length) {
            int cost = 0, prev = 0;
            for (int c : perm) { cost += d[prev][c]; prev = c; }
            cost += d[prev][0];
            best = Math.min(best, cost);
            return;
        }
        for (int i = k; i < perm.length; i++) {
            int t = perm[k]; perm[k] = perm[i]; perm[i] = t;
            rec(perm, k + 1);
            t = perm[k]; perm[k] = perm[i]; perm[i] = t;
        }
    }
    static int bruteTSP(int[][] dist) {
        d = dist; best = Integer.MAX_VALUE;
        int n = dist.length;
        int[] perm = new int[n - 1];
        for (int i = 1; i < n; i++) perm[i - 1] = i;
        rec(perm, 0);
        return best;
    }
    public static void main(String[] args) {
        System.out.println(bruteTSP(new int[][]{{0,10,15,20},{10,0,35,25},{15,35,0,30},{20,25,30,0}}));
    }
}
```

**Starter — Python.**
```python
from itertools import permutations


def brute_tsp(d):
    n = len(d)
    best = float("inf")
    for perm in permutations(range(1, n)):
        tour = (0,) + perm
        cost = sum(d[tour[i]][tour[i + 1]] for i in range(n - 1)) + d[tour[-1]][0]
        best = min(best, cost)
    return best


print(brute_tsp([[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]))  # 80
```

---

### Task 2 — Held–Karp shortest tour length

**Problem.** Solve TSP exactly with the bitmask DP for `n ≤ 16`. Return only the optimal tour length.

**Constraints.**
- `1 ≤ n ≤ 16`.
- `O(2ⁿ·n²)` time.

**Hint.** `dp[mask][i]` = shortest path from 0 covering `mask` ending at `i`. Iterate masks ascending, skip masks without bit 0, close with `+ d[i][0]`.

**Evaluation criteria.**
- Matches Task 1's brute force for every `n ≤ 10`.
- Runs `n = 16` within a second.

**Starter — Python.**
```python
import math


def held_karp(d):
    n = len(d)
    INF = math.inf
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1, full + 1):
        if not (mask & 1):
            continue
        for i in range(n):
            if dp[mask][i] == INF or not (mask & (1 << i)):
                continue
            for j in range(n):
                if mask & (1 << j):
                    continue
                nm = mask | (1 << j)
                dp[nm][j] = min(dp[nm][j], dp[mask][i] + d[i][j])
    return min(dp[full][i] + d[i][0] for i in range(1, n))
```

*(Go and Java versions mirror `interview.md` Challenge 1.)*

---

### Task 3 — Hamiltonian path existence (small graph)

**Problem.** Given an undirected graph (`n ≤ 12`) as an edge list, decide whether a Hamiltonian path exists using backtracking (no DP yet — that's Task 8).

**Constraints.**
- `1 ≤ n ≤ 12`.

**Hint.** DFS from each start vertex, marking visited; succeed when all `n` vertices are on the path. Backtrack on dead ends.

**Evaluation criteria.**
- Correct yes/no on connected and disconnected graphs.
- Returns `true` for a path graph, `false` for a star with ≥ 4 leaves.

**Starter — Python.**
```python
def has_ham_path(n, edges):
    adj = [set() for _ in range(n)]
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)

    def dfs(v, visited, count):
        if count == n:
            return True
        for w in adj[v]:
            if w not in visited:
                visited.add(w)
                if dfs(w, visited, count + 1):
                    return True
                visited.discard(w)
        return False

    return any(dfs(s, {s}, 1) for s in range(n))


print(has_ham_path(4, [(0, 1), (1, 2), (2, 3)]))  # True (path)
print(has_ham_path(4, [(0, 1), (0, 2), (0, 3)]))  # False (star)
```

**Starter — Go.**
```go
package main

import "fmt"

func hasHamPath(n int, edges [][2]int) bool {
	adj := make([][]int, n)
	for _, e := range edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
	}
	visited := make([]bool, n)
	var dfs func(v, count int) bool
	dfs = func(v, count int) bool {
		if count == n {
			return true
		}
		for _, w := range adj[v] {
			if !visited[w] {
				visited[w] = true
				if dfs(w, count+1) {
					return true
				}
				visited[w] = false
			}
		}
		return false
	}
	for s := 0; s < n; s++ {
		for i := range visited {
			visited[i] = false
		}
		visited[s] = true
		if dfs(s, 1) {
			return true
		}
	}
	return false
}

func main() {
	fmt.Println(hasHamPath(4, [][2]int{{0, 1}, {1, 2}, {2, 3}})) // true
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static List<Integer>[] adj;
    static boolean[] visited;
    static int n;
    static boolean dfs(int v, int count) {
        if (count == n) return true;
        for (int w : adj[v]) if (!visited[w]) {
            visited[w] = true;
            if (dfs(w, count + 1)) return true;
            visited[w] = false;
        }
        return false;
    }
    @SuppressWarnings("unchecked")
    static boolean hasHamPath(int nn, int[][] edges) {
        n = nn;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int[] e : edges) { adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
        for (int s = 0; s < n; s++) {
            visited = new boolean[n];
            visited[s] = true;
            if (dfs(s, 1)) return true;
        }
        return false;
    }
    public static void main(String[] args) {
        System.out.println(hasHamPath(4, new int[][]{{0,1},{1,2},{2,3}})); // true
    }
}
```

---

### Task 4 — Tour length and validation

**Problem.** Given a candidate tour (a permutation of `0..n-1`) and a distance matrix, compute its length and validate it is a legal tour (each city exactly once).

**Constraints.**
- `1 ≤ n ≤ 1000`.

**Hint.** Validate by checking the sorted tour equals `0..n-1`. Length sums consecutive edges plus the closing edge.

**Evaluation criteria.**
- Rejects a tour with a repeated or missing city.
- Correct length including the wrap-around edge.

**Starter — Python.**
```python
def tour_length(tour, d):
    n = len(d)
    assert sorted(tour) == list(range(n)), "not a valid permutation"
    return sum(d[tour[i]][tour[(i + 1) % n]] for i in range(n))


d = [[0, 10, 15, 20], [10, 0, 35, 25], [15, 35, 0, 30], [20, 25, 30, 0]]
print(tour_length([0, 2, 3, 1], d))  # 80
```

---

### Task 5 — Nearest-neighbor construction

**Problem.** Build a tour with the nearest-neighbor heuristic from a given start, returning the tour and its length.

**Constraints.**
- `1 ≤ n ≤ 2000`.
- `O(n²)`.

**Hint.** From the last city, scan all unvisited cities for the nearest; append; repeat; close the loop.

**Evaluation criteria.**
- Visits every city exactly once.
- Length ≥ optimal (it is a heuristic), and consistent across runs from the same start.

*(Reference solution mirrors `interview.md` Challenge 3.)*

---

## Intermediate Tasks (5)

### Task 6 — Held–Karp with tour reconstruction

**Problem.** Extend Task 2 to also return the optimal tour (not just its length) via a `parent[mask][i]` table.

**Constraints.**
- `n ≤ 16`.

**Hint.** When relaxing `dp[nm][j]`, record `parent[nm][j] = i`. After choosing the best closing city, walk parents backward, clearing the current bit, then reverse and append 0.

**Evaluation criteria.**
- The reconstructed tour's length equals the DP length.
- The tour is a valid permutation starting at 0.

**Starter — Python.**
```python
import math


def held_karp_tour(d):
    n = len(d)
    INF = math.inf
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    par = [[-1] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1, full + 1):
        if not (mask & 1):
            continue
        for i in range(n):
            if dp[mask][i] == INF or not (mask & (1 << i)):
                continue
            for j in range(n):
                if mask & (1 << j):
                    continue
                nm = mask | (1 << j)
                if dp[mask][i] + d[i][j] < dp[nm][j]:
                    dp[nm][j] = dp[mask][i] + d[i][j]
                    par[nm][j] = i
    best, last = INF, -1
    for i in range(1, n):
        if dp[full][i] + d[i][0] < best:
            best, last = dp[full][i] + d[i][0], i
    tour, mask, cur = [], full, last
    while cur != -1:
        tour.append(cur)
        p = par[mask][cur]
        mask ^= (1 << cur)
        cur = p
    tour.reverse()
    tour.append(0)
    return best, tour
```

*(Go and Java mirror `junior.md` Code Examples.)*

---

### Task 7 — 2-opt local search to a local optimum

**Problem.** Given an initial tour and a distance function, apply improving 2-opt moves until none remains. Return the improved tour and its length.

**Constraints.**
- `1 ≤ n ≤ 2000`.
- `O(n²)` per pass.

**Hint.** For each pair `(i, k)`, compute `gain = d(a,b)+d(c,d) − d(a,c) − d(b,d)`; if positive, reverse the segment `i+1..k`. Loop until a full pass finds no improvement.

**Evaluation criteria.**
- Final length ≤ initial length, always.
- On a tour with a crossing, the crossing is removed.

*(Reference mirrors `interview.md` Challenge 4 / `middle.md` Example A.)*

---

### Task 8 — Hamiltonian path existence via bitmask DP

**Problem.** Decide Hamiltonian-path existence for `n ≤ 20` using the boolean reachability DP `reach[mask][i]`.

**Constraints.**
- `n ≤ 20`.
- `O(2ⁿ·n²)`.

**Hint.** Seed `reach[1<<i][i] = true` for every `i`. Extend along real edges only. Answer: any `reach[FULL][i]`.

**Evaluation criteria.**
- Matches Task 3's backtracking on all `n ≤ 12` cases.
- Handles `n = 20` within a second.

**Starter — Go.**
```go
package main

import "fmt"

func hasHamPathDP(adj [][]bool) bool {
	n := len(adj)
	reach := make([][]bool, 1<<n)
	for m := range reach {
		reach[m] = make([]bool, n)
	}
	for i := 0; i < n; i++ {
		reach[1<<i][i] = true
	}
	for mask := 0; mask < (1 << n); mask++ {
		for i := 0; i < n; i++ {
			if !reach[mask][i] {
				continue
			}
			for j := 0; j < n; j++ {
				if mask&(1<<j) == 0 && adj[i][j] {
					reach[mask|(1<<j)][j] = true
				}
			}
		}
	}
	full := (1 << n) - 1
	for i := 0; i < n; i++ {
		if reach[full][i] {
			return true
		}
	}
	return false
}

func main() {
	adj := [][]bool{{false, true, false}, {true, false, true}, {false, true, false}}
	fmt.Println(hasHamPathDP(adj)) // true
}
```

**Starter — Python.**
```python
def has_ham_path_dp(adj):
    n = len(adj)
    reach = [[False] * n for _ in range(1 << n)]
    for i in range(n):
        reach[1 << i][i] = True
    for mask in range(1 << n):
        for i in range(n):
            if not reach[mask][i]:
                continue
            for j in range(n):
                if not (mask & (1 << j)) and adj[i][j]:
                    reach[mask | (1 << j)][j] = True
    full = (1 << n) - 1
    return any(reach[full][i] for i in range(n))
```

---

### Task 9 — MST-doubling 2-approximation (metric)

**Problem.** Given points in the plane (Euclidean = metric), build a 2-approximate tour: MST (Prim), DFS preorder of the tree (a valid shortcutting of the doubled-tree Euler walk), then close. Return the tour length and verify it is `≤ 2× the Held–Karp optimum` for small `n`.

**Constraints.**
- `n ≤ 12` for the verification against Held–Karp; the algorithm itself scales to large `n`.

**Hint.** A DFS preorder traversal of the MST visits each vertex once and is exactly the shortcut of the Euler tour of the doubled tree — no need to materialize the doubling.

**Evaluation criteria.**
- Tour visits every city once.
- For `n ≤ 12`, `length ≤ 2 × held_karp(d)`.

**Starter — Python.**
```python
import math


def mst_double_tour(pts):
    n = len(pts)
    d = lambda a, b: math.dist(pts[a], pts[b])
    # Prim's MST -> children adjacency
    in_tree = [False] * n
    parent = [-1] * n
    key = [math.inf] * n
    key[0] = 0
    for _ in range(n):
        u = min((i for i in range(n) if not in_tree[i]), key=lambda i: key[i])
        in_tree[u] = True
        for v in range(n):
            if not in_tree[v] and d(u, v) < key[v]:
                key[v] = d(u, v)
                parent[v] = u
    children = [[] for _ in range(n)]
    for v in range(1, n):
        children[parent[v]].append(v)
    # DFS preorder = shortcut of doubled-tree Euler walk
    tour = []

    def dfs(u):
        tour.append(u)
        for c in children[u]:
            dfs(c)

    dfs(0)
    length = sum(d(tour[i], tour[(i + 1) % n]) for i in range(n))
    return tour, length


pts = [(0, 0), (0, 3), (4, 3), (4, 0)]
print(mst_double_tour(pts))  # a 4-cycle around the rectangle
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math"
)

func mstDoubleTour(pts [][2]float64) ([]int, float64) {
	n := len(pts)
	d := func(a, b int) float64 { return math.Hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1]) }
	inTree := make([]bool, n)
	parent := make([]int, n)
	key := make([]float64, n)
	for i := range key {
		key[i] = math.Inf(1)
		parent[i] = -1
	}
	key[0] = 0
	for c := 0; c < n; c++ {
		u, bu := -1, math.Inf(1)
		for i := 0; i < n; i++ {
			if !inTree[i] && key[i] < bu {
				bu, u = key[i], i
			}
		}
		inTree[u] = true
		for v := 0; v < n; v++ {
			if !inTree[v] && d(u, v) < key[v] {
				key[v], parent[v] = d(u, v), u
			}
		}
	}
	children := make([][]int, n)
	for v := 1; v < n; v++ {
		children[parent[v]] = append(children[parent[v]], v)
	}
	tour := []int{}
	var dfs func(u int)
	dfs = func(u int) {
		tour = append(tour, u)
		for _, ch := range children[u] {
			dfs(ch)
		}
	}
	dfs(0)
	length := 0.0
	for i := 0; i < n; i++ {
		length += d(tour[i], tour[(i+1)%n])
	}
	return tour, length
}

func main() {
	fmt.Println(mstDoubleTour([][2]float64{{0, 0}, {0, 3}, {4, 3}, {4, 0}}))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static double[][] pts;
    static double d(int a, int b) { return Math.hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1]); }
    static List<Integer> tour;
    static List<Integer>[] children;
    static void dfs(int u) {
        tour.add(u);
        for (int c : children[u]) dfs(c);
    }
    @SuppressWarnings("unchecked")
    static double mstDoubleTour(double[][] p) {
        pts = p; int n = p.length;
        boolean[] in = new boolean[n];
        int[] parent = new int[n];
        double[] key = new double[n];
        Arrays.fill(key, Double.MAX_VALUE); Arrays.fill(parent, -1); key[0] = 0;
        for (int c = 0; c < n; c++) {
            int u = -1; double bu = Double.MAX_VALUE;
            for (int i = 0; i < n; i++) if (!in[i] && key[i] < bu) { bu = key[i]; u = i; }
            in[u] = true;
            for (int v = 0; v < n; v++) if (!in[v] && d(u, v) < key[v]) { key[v] = d(u, v); parent[v] = u; }
        }
        children = new List[n];
        for (int i = 0; i < n; i++) children[i] = new ArrayList<>();
        for (int v = 1; v < n; v++) children[parent[v]].add(v);
        tour = new ArrayList<>();
        dfs(0);
        double len = 0;
        for (int i = 0; i < n; i++) len += d(tour.get(i), tour.get((i + 1) % n));
        return len;
    }
    public static void main(String[] args) {
        System.out.println(mstDoubleTour(new double[][]{{0,0},{0,3},{4,3},{4,0}}));
    }
}
```

---

### Task 10 — Open vs fixed-endpoint shortest Hamiltonian path

**Problem.** Implement two Held–Karp variants: (a) shortest *open* path with any endpoints; (b) shortest path from a fixed start `s` to a fixed end `t`.

**Constraints.**
- `n ≤ 16`.

**Hint.** (a) seed `dp[1<<i][i]=0` for all `i`, answer `min_i dp[FULL][i]`. (b) seed only `dp[1<<s][s]=0`, answer `dp[FULL][t]`.

**Evaluation criteria.**
- (a) ≤ any specific tour minus its largest edge.
- (b) equals brute force over permutations with fixed endpoints.

*(Reference for (a) mirrors `middle.md` Dynamic Programming Integration.)*

---

## Advanced Tasks (5)

### Task 11 — Branch-and-bound exact TSP

**Problem.** Solve TSP exactly with branch-and-bound, pruning partial tours whose lower bound (sum of cheapest remaining incident edges) exceeds the best complete tour. Seed the incumbent with a nearest-neighbor tour. Target `n ≤ 30`.

**Constraints.**
- `n ≤ 30` (typical instances).

**Hint.** Maintain `bestSoFar` from nearest-neighbor. At each node, lower bound = current path cost + ½·Σ(two cheapest incident edges of unvisited vertices). Prune when LB ≥ bestSoFar.

**Evaluation criteria.**
- Matches Held–Karp on all `n ≤ 16`.
- Solves `n = 25–30` instances far faster than Held–Karp's memory allows.

**Starter — Python.**
```python
import math


def branch_and_bound(d):
    n = len(d)
    # cheapest two incident edges per vertex for the bound
    cheapest2 = []
    for i in range(n):
        edges = sorted(d[i][j] for j in range(n) if j != i)
        cheapest2.append(edges[0] + (edges[1] if len(edges) > 1 else edges[0]))
    min_remaining = lambda unvisited: sum(cheapest2[v] for v in unvisited) / 2

    best = [math.inf]
    visited = [False] * n
    visited[0] = True

    def rec(cur, count, cost):
        if cost >= best[0]:
            return
        if count == n:
            best[0] = min(best[0], cost + d[cur][0])
            return
        unvisited = [v for v in range(n) if not visited[v]]
        if cost + min_remaining(unvisited) >= best[0]:
            return
        for v in sorted(unvisited, key=lambda x: d[cur][x]):
            visited[v] = True
            rec(v, count + 1, cost + d[cur][v])
            visited[v] = False

    rec(0, 1, 0)
    return best[0]


print(branch_and_bound([[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]))  # 80
```

**Starter — Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func branchAndBound(d [][]int) int {
	n := len(d)
	cheapest2 := make([]int, n)
	for i := 0; i < n; i++ {
		var e []int
		for j := 0; j < n; j++ {
			if j != i {
				e = append(e, d[i][j])
			}
		}
		sort.Ints(e)
		s := e[0]
		if len(e) > 1 {
			s += e[1]
		} else {
			s += e[0]
		}
		cheapest2[i] = s
	}
	best := 1 << 30
	visited := make([]bool, n)
	visited[0] = true
	var rec func(cur, count, cost int)
	rec = func(cur, count, cost int) {
		if cost >= best {
			return
		}
		if count == n {
			if cost+d[cur][0] < best {
				best = cost + d[cur][0]
			}
			return
		}
		lb := cost
		for v := 0; v < n; v++ {
			if !visited[v] {
				lb += cheapest2[v] / 2
			}
		}
		if lb >= best {
			return
		}
		for v := 0; v < n; v++ {
			if !visited[v] {
				visited[v] = true
				rec(v, count+1, cost+d[cur][v])
				visited[v] = false
			}
		}
	}
	rec(0, 1, 0)
	return best
}

func main() {
	fmt.Println(branchAndBound([][]int{{0, 10, 15, 20}, {10, 0, 35, 25}, {15, 35, 0, 30}, {20, 25, 30, 0}}))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    static int n, best;
    static int[][] d;
    static int[] cheapest2;
    static boolean[] visited;
    static void rec(int cur, int count, int cost) {
        if (cost >= best) return;
        if (count == n) { best = Math.min(best, cost + d[cur][0]); return; }
        int lb = cost;
        for (int v = 0; v < n; v++) if (!visited[v]) lb += cheapest2[v] / 2;
        if (lb >= best) return;
        for (int v = 0; v < n; v++) if (!visited[v]) {
            visited[v] = true;
            rec(v, count + 1, cost + d[cur][v]);
            visited[v] = false;
        }
    }
    static int solve(int[][] dist) {
        d = dist; n = dist.length; best = Integer.MAX_VALUE;
        cheapest2 = new int[n];
        for (int i = 0; i < n; i++) {
            List<Integer> e = new ArrayList<>();
            for (int j = 0; j < n; j++) if (j != i) e.add(d[i][j]);
            Collections.sort(e);
            cheapest2[i] = e.get(0) + (e.size() > 1 ? e.get(1) : e.get(0));
        }
        visited = new boolean[n]; visited[0] = true;
        rec(0, 1, 0);
        return best;
    }
    public static void main(String[] args) {
        System.out.println(solve(new int[][]{{0,10,15,20},{10,0,35,25},{15,35,0,30},{20,25,30,0}}));
    }
}
```

---

### Task 12 — Christofides (metric) end-to-end

**Problem.** Implement Christofides: MST, identify odd-degree vertices, compute a minimum-weight perfect matching on them (a simple greedy matching is acceptable for this task — note it loses the 1.5× *proof* but still produces a valid tour), combine, Eulerian circuit, shortcut. Verify the tour length ≤ `1.5 × held_karp` for small `n` *only when an exact matching is used*.

**Constraints.**
- `n ≤ 12` for verification.

**Hint.** Odd-degree count is even. With a true minimum matching (e.g. brute force on the small odd set) the 1.5× bound holds; greedy may slightly exceed it.

**Evaluation criteria.**
- Produces a valid Hamiltonian cycle.
- With exact matching, `length ≤ 1.5 × held_karp(d)` for `n ≤ 10`.

**Hint (structure, Python pseudocode).**
```python
# 1. mst (Prim) -> tree edges
# 2. degree parity -> odd = [v for v if deg[v] odd]
# 3. min-weight perfect matching on `odd` (brute force for small |odd|)
# 4. multigraph = tree edges + matching edges
# 5. Eulerian circuit (Hierholzer) -> walk
# 6. shortcut walk (skip seen) -> tour
```

---

### Task 13 — Or-opt move (relocate a chain)

**Problem.** Implement an Or-opt local search: try relocating chains of length 1, 2, and 3 to a better position. Combine with 2-opt for a stronger local optimum.

**Constraints.**
- `n ≤ 2000`.

**Hint.** For each chain start `i` and length `L`, removing the chain saves `d(prev,first)+d(last,next)−d(prev,next)`; inserting between `a` and `b` costs `d(a,first)+d(last,b)−d(a,b)`. Apply if net gain > 0.

**Evaluation criteria.**
- Final length ≤ the 2-opt-only result on the same seed.
- Tour remains a valid permutation.

---

### Task 14 — Asymmetric TSP with Held–Karp

**Problem.** Confirm Held–Karp solves **asymmetric** TSP (where `d[i][j] ≠ d[j][i]`) unchanged. Build a random asymmetric matrix and verify against brute force for `n ≤ 9`.

**Constraints.**
- `n ≤ 9` for brute-force verification.

**Hint.** No code change is needed — Held–Karp never assumes symmetry. The only subtlety: 2-opt and Christofides would *not* work here.

**Evaluation criteria.**
- Held–Karp == brute force on random asymmetric matrices.
- A note explaining why metric approximations do not apply.

---

### Task 15 — Quality study: heuristics vs optimum

**Problem.** On random Euclidean instances (`n = 10`), measure the average ratio of nearest-neighbor, NN+2-opt, and MST-doubling tour lengths to the Held–Karp optimum.

**Constraints.**
- `n = 10`, ≥ 100 random instances.

**Hint.** For each instance compute `OPT` (Held–Karp), then each heuristic's length; report `mean(heuristic/OPT)`.

**Evaluation criteria.**
- NN ratio typically ~1.2–1.3; NN+2-opt ~1.03–1.05; MST-doubling ~1.3–1.5 but always ≤ 2.0.
- A short written interpretation of the results.

**Starter — Python.**
```python
import math, random
from itertools import permutations


def opt(d):
    n = len(d)
    best = math.inf
    for p in permutations(range(1, n)):
        t = (0,) + p
        best = min(best, sum(d[t[i]][t[(i + 1) % n]] for i in range(n)))
    return best


random.seed(42)
ratios_nn = []
for _ in range(100):
    n = 10
    pts = [(random.random(), random.random()) for _ in range(n)]
    d = [[math.dist(pts[i], pts[j]) for j in range(n)] for i in range(n)]
    # nearest neighbor
    seen, tour, cur = [True] + [False] * (n - 1), [0], 0
    for _ in range(n - 1):
        nxt = min((j for j in range(n) if not seen[j]), key=lambda j: d[cur][j])
        seen[nxt] = True
        tour.append(nxt)
        cur = nxt
    nn_len = sum(d[tour[i]][tour[(i + 1) % n]] for i in range(n))
    ratios_nn.append(nn_len / opt(d))
print("avg NN / OPT:", round(sum(ratios_nn) / len(ratios_nn), 3))
```

---

## Benchmark Task

### Benchmark — Exact vs heuristic across growing `n`

**Goal.** Measure how Held–Karp, branch-and-bound, and NN+2-opt scale, and where exact methods become infeasible.

**Method.**
1. Generate random Euclidean instances for `n ∈ {8, 10, 12, 14, 16, 18, 20}`.
2. Time Held–Karp (exact), branch-and-bound (exact), and NN+2-opt (heuristic).
3. Record wall-clock time and, for the heuristic, the gap to the exact optimum (where computable).
4. Note the `n` at which Held–Karp's memory (`2ⁿ·n` ints) becomes a problem.

**Expected shape of results.**

| n | Held–Karp time | B&B time | NN+2-opt time | 2-opt gap |
|---|----------------|----------|---------------|-----------|
| 8 | <1 ms | <1 ms | <0.1 ms | ~3% |
| 12 | ~5 ms | ~2 ms | <0.1 ms | ~4% |
| 16 | ~150 ms | ~10 ms | <0.5 ms | ~4% |
| 20 | ~3 s, ~160 MB | ~100 ms–s | ~1 ms | ~5% |
| 24 | OOM | varies | ~2 ms | — |

**Starter — Python (timing harness).**
```python
import math, random, time
from itertools import permutations


def held_karp(d):
    n = len(d)
    INF = math.inf
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1, full + 1):
        if not (mask & 1):
            continue
        for i in range(n):
            if dp[mask][i] == INF or not (mask & (1 << i)):
                continue
            for j in range(n):
                if mask & (1 << j):
                    continue
                nm = mask | (1 << j)
                dp[nm][j] = min(dp[nm][j], dp[mask][i] + d[i][j])
    return min(dp[full][i] + d[i][0] for i in range(1, n))


random.seed(7)
for n in (8, 10, 12, 14, 16):
    pts = [(random.random(), random.random()) for _ in range(n)]
    d = [[math.dist(pts[i], pts[j]) for j in range(n)] for i in range(n)]
    t0 = time.perf_counter()
    best = held_karp(d)
    dt = time.perf_counter() - t0
    print(f"n={n:2d}  held_karp={best:.3f}  time={dt*1000:.1f} ms")
```

**Evaluation criteria.**
- Held–Karp and branch-and-bound agree on every `n` where both run.
- The heuristic's gap stays small (~5%) even as exact methods become infeasible.
- A written conclusion identifying the practical `n` ceiling for each method (brute force ~12, Held–Karp ~20, B&B ~40–60, heuristics unbounded).

---

## Submission Checklist

- [ ] Every task solved in Go, Java, and Python.
- [ ] Exact solvers (Tasks 2, 6, 11) verified against brute force (Task 1) for `n ≤ 10`.
- [ ] Heuristics (Tasks 5, 7, 9, 13) produce valid tours never longer than their seed/construction.
- [ ] Path-vs-cycle and symmetric-vs-asymmetric conventions documented per task.
- [ ] Benchmark table filled with your own measured numbers and a written conclusion.
</content>
