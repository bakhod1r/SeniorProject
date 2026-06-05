# Bipartite Matching — Interview Preparation

Bipartite matching is a high-signal interview topic: it tests whether a candidate can *recognize* a matching problem hidden behind a word problem ("assign," "pair," "cover," "minimum lines," "maximum students"), implement the augmenting-path search correctly (the `visited`-reset bug separates the prepared from the unprepared), and connect it to the duality theorems (König, Hall) that turn it into vertex cover and independent set. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Concept | Fact |
|---------|------|
| Matching | Edge set, no shared endpoints. |
| Maximum matching | Largest such set. Berge: max ⇔ no augmenting path. |
| Kuhn | DFS augmenting paths, `O(V·E)`. Reset `visited` per left vertex. |
| Hopcroft-Karp | BFS layers + DFS phases, `O(E·√V)`. `O(√V)` phases. |
| König (bipartite) | max matching = min vertex cover. |
| Independent set | `V − max matching` (bipartite). |
| Hall | `L`-saturating matching ⇔ `|N(S)| ≥ |S|` for all `S ⊆ L`. |
| DAG min path cover | `N − max matching` (split each vertex into in/out). |
| Hungarian | weighted/min-cost assignment, `O(V³)`. |
| Flow reduction | source→L (cap 1), L→R edges (cap 1), R→sink (cap 1); max-flow = matching. |
| Bound | `|M| ≤ min(|L|, |R|)`. |
| Gotcha | bipartite only; cardinality ≠ weighted; reset visited. |

Kuhn skeleton:

```text
for each left u: reset used[]; tryKuhn(u)
tryKuhn(u): for v in adj[u]:
              if !used[v]: used[v]=true
                 if matchR[v]==-1 or tryKuhn(matchR[v]): matchR[v]=u; return true
            return false
```

---

## Junior Questions (12 Q&A)

### J1. What is a bipartite graph?
A graph whose vertices split into two disjoint sets such that every edge connects a vertex in one set to a vertex in the other — no edge stays within a set. Equivalently, it is 2-colorable, or it has no odd-length cycle. You can check bipartiteness with a BFS/DFS 2-coloring.

### J2. What is a matching?
A set of edges in which no two edges share an endpoint. Each vertex is touched by at most one edge of the matching. A *maximum* matching has the largest possible number of edges.

### J3. Difference between maximal and maximum matching?
A *maximal* matching cannot be extended by adding a single edge greedily, but it may be small. A *maximum* matching is the globally largest. Example: in a path of 3 edges, picking the middle edge gives a maximal matching of size 1, while the two outer edges form a maximum matching of size 2.

### J4. What is an augmenting path?
An alternating path (edges alternate not-in-matching / in-matching) whose two endpoints are both unmatched. Flipping the membership of every edge along it increases the matching size by exactly one.

### J5. State Berge's theorem.
A matching is maximum if and only if there is no augmenting path with respect to it. This is why algorithms can stop confidently once no augmenting path is found.

### J6. How does Kuhn's algorithm work?
For each left vertex, run a DFS that tries to find an augmenting path. The DFS tries each right neighbor; if the neighbor is free or its current owner can be relocated (recursive call), claim it. Reset the right-side `visited` array before each left vertex.

### J7. Why must you reset `visited` per left vertex?
Each augmenting search is independent. If `visited` carried over, a right vertex marked in a previous search would be wrongly skipped, blocking valid paths and undercounting the matching. This is the most common bug.

### J8. What is the time complexity of Kuhn?
`O(V·E)`: up to `V` DFS launches (one per left vertex), each `O(E)`.

### J9. What is the maximum possible matching size?
At most `min(|L|, |R|)`. If it equals `|L| = |R|`, the matching is *perfect*.

### J10. Does Kuhn work on non-bipartite graphs?
No. It silently produces wrong answers on graphs with odd cycles. General-graph matching needs Edmonds' Blossom algorithm. Always verify bipartiteness first.

### J11. What does König's theorem say (informally)?
In a bipartite graph, the size of the maximum matching equals the size of the minimum vertex cover (smallest set of vertices touching every edge).

### J12. Cardinality vs weighted matching — what is the difference?
Cardinality matching maximizes the *number* of pairs. Weighted matching minimizes total cost (or maximizes total value) and is the *assignment problem*, solved by the Hungarian algorithm, not by Kuhn.

---

## Middle Questions (12 Q&A)

### M1. Explain Hopcroft-Karp at a high level.
It works in phases. Each phase does a BFS from all free left vertices to find the shortest augmenting-path length and layer the graph, then a DFS that augments a *maximal set of vertex-disjoint shortest augmenting paths* at once. The shortest path length strictly increases each phase, bounding the number of phases at `O(√V)`, for `O(E√V)` total.

### M2. Why is Hopcroft-Karp `O(√V)` phases?
After `√V` phases the shortest augmenting path has length `≥ √V`. Remaining augmenting paths are vertex-disjoint and each uses `≥ √V` vertices, so at most `V/√V = √V` remain. Total phases `O(√V)`.

### M3. How do you recover the minimum vertex cover from a maximum matching?
Take `U` = unmatched left vertices. Mark all vertices reachable from `U` by alternating paths (non-matching edge L→R, matching edge R→L). Cover = (left vertices NOT reachable) ∪ (right vertices reachable). This is the constructive proof of König's theorem and runs in `O(V+E)`.

### M4. How do you get the maximum independent set in a bipartite graph?
It is the complement of the minimum vertex cover: `V − |min vertex cover| = V − |max matching|`. Independent set in general graphs is NP-hard, but bipartite is polynomial via matching.

### M5. State Hall's marriage theorem and its use.
A matching saturating all of `L` exists iff every subset `S ⊆ L` has `|N(S)| ≥ |S|`. It tells you *whether* a complete assignment is possible and identifies the bottleneck set when it is not.

### M6. How does minimum path cover of a DAG reduce to matching?
Split each vertex `x` into `x_out` (left) and `x_in` (right). For each edge `x→y` add bipartite edge `x_out — y_in`. Then minimum path cover = `N − max matching`. Each matched edge merges two path fragments.

### M7. How does matching reduce to max-flow?
Add a source with cap-1 edges to every left vertex, keep the bipartite edges at cap 1, and add cap-1 edges from every right vertex to a sink. Max-flow equals the maximum matching; min-cut gives the minimum vertex cover. (Sibling `16-max-flow-edmonds-karp-dinic`.)

### M8. When would you choose Kuhn over Hopcroft-Karp?
When the graph is small/medium and code clarity matters, or when you need an easy incremental `tryAugment` for streaming inserts. For large or dense graphs, Hopcroft-Karp's `√V` factor wins.

### M9. What is the "deficiency" of a bipartite graph?
`max_{S⊆L}(|S| − |N(S)|)` — the number of left vertices that must remain unmatched. Maximum matching size = `|L| − deficiency`.

### M10. Why is König false for general graphs?
A triangle has maximum matching 1 but needs a vertex cover of size 2. König relies on the bipartite structure (no odd cycles), which is exactly what max-flow min-cut exploits.

### M11. What optimization speeds up Kuhn in practice?
Greedy pre-matching: before the augmenting loop, match each left vertex to any free neighbor. This eliminates many expensive DFS launches without affecting correctness.

### M12. How do you avoid the `O(V)` cost of resetting `visited`?
Use a timestamp/iteration counter: store the iteration number in `seen[v]` and compare against the current stamp instead of zeroing the array — `O(1)` reset.

---

## Senior Questions (10 Q&A)

### S1. How would you build a real-time driver-rider dispatch on matching?
Model drivers and riders as a bipartite graph per geo-region. Run a periodic full solve (Hopcroft-Karp or weighted min-cost flow) plus incremental augmenting-path inserts as new supply arrives. Add anti-starvation by biasing edge weights by wait time. Use a single-writer actor for the matching state and emit assignments via a transactional outbox.

### S2. Cardinality or weighted for dispatch — which and why?
Weighted (minimize total ETA / maximize value) is almost always what the business wants; cardinality is the simplified first version. Use cardinality only as a fast feasibility gate (Hall) before optimizing weights.

### S3. How do you scale matching beyond one machine?
Shard by a natural key (geography, category) and solve shards in parallel, then reconcile cross-shard residuals with a small global pass. Halo/overlap zones reduce the value lost to dropped cross-shard edges. For very large weighted problems, relax to a distributed LP and round.

### S4. How do you handle concurrency safely?
Prefer a single-writer actor since augmenting paths mutate the whole `matchR` chain. If parallelizing the DFS phase, use CAS claims on right vertices to enforce disjointness. Use read-copy snapshots for query traffic.

### S5. Insertions vs deletions — why the asymmetry?
Adding a vertex increases the matching by at most one, found by one augmenting search (`O(E)`). Deleting a matched edge frees two vertices and may require re-augmentation and can lower the matching, so deletions are handled by periodic full re-solves plus drift tracking.

### S6. What do you monitor in a matching service?
Matching ratio, unmatched-vertex age (starvation), augmentations per tick, average augmenting-path length, Hopcroft-Karp phase count, solve latency percentiles, and the Hall-deficient bottleneck set for explainability.

### S7. How do you make matching results explainable?
Export the dual certificate: the König vertex cover (cardinality) or the Hungarian dual prices (weighted), plus the Hall deficiency set, which answers "why was this entity not matched."

### S8. What is online matching and when does it matter?
When entities arrive over time and you must commit irrevocably. The RANKING algorithm gives a `1 − 1/e` competitive ratio. It matters only when you cannot wait to batch or revise; otherwise re-solving a batch each tick is simpler.

### S9. How do you warm-start a re-solve?
Keep the previous `matchR`, drop edges that became invalid, and re-augment only the affected/unmatched vertices instead of from scratch — avoids latency spikes on deploys and ticks.

### S10. What failure modes worry you most?
Silent non-bipartite input (wrong answers), stale `visited` undercounting, concurrent augmentation races corrupting the matching, deletion drift, and optimizing cardinality when weighted was intended. Each has a guard: ingest validation, timestamp visited, single-writer, periodic re-solve, explicit objective config.

---

## Professional Questions (8 Q&A)

### P1. Prove the "if" direction of Berge's theorem.
If `M` is not maximum, take a larger matching `M*` and look at `M ⊕ M*`. Every vertex has degree ≤ 2 there, so components are alternating paths and even cycles. Cycles balance `M`/`M*` edges; since `|M*| > |M|`, some component has more `M*` edges — an alternating path ending in `M*` edges on both ends, i.e. an `M`-augmenting path.

### P2. Sketch the constructive proof of König's theorem.
With a maximum matching `M`, let `Z` be vertices alternating-reachable from unmatched left vertices. Cover = `(L∖Z) ∪ (R∩Z)`. It covers all edges, every cover vertex is matched, and no matching edge has both endpoints in the cover, so `|cover| = |M|`. Weak duality closes the equality.

### P3. Why is Hopcroft-Karp `O(E√V)` rigorously?
Shortest augmenting-path length strictly increases each phase (Lemma). After `√V` phases length `≥ √V`; remaining augmenting paths are vertex-disjoint and long, so `≤ √V` remain. Hence `O(√V)` phases, each `O(E)`.

### P4. How does the Hungarian algorithm certify optimality?
It maintains feasible dual potentials `u[i]+v[j] ≤ c[i][j]` and matches only tight edges. For any assignment `σ`, `cost(σ) ≥ Σu+Σv`; the returned perfect tight matching achieves `cost = Σu+Σv`, so it is optimal by LP weak duality made tight.

### P5. Relationship between Hungarian and min-cost max-flow?
Hungarian is min-cost max-flow specialized to the unit-capacity assignment network. Potentials are node prices; tight edges are the reduced-cost-zero subgraph; each augmentation is a shortest (reduced-cost) path. (Sibling `18-min-cost-max-flow`.)

### P6. What is the best known cardinality bipartite matching bound?
Classically `O(E√V)` (Hopcroft-Karp / Dinic on unit caps). Recent continuous-optimization results give almost-linear-time exact max-flow/min-cost-flow (2022), which subsumes matching, though those are not yet the practical default.

### P7. Why does CSR layout help, and what stays slow?
CSR gives contiguous neighbor scans (good locality). The `matchR[v]` lookups stay random-access, so at `V > 10⁶` matching becomes memory-bound on those scattered reads rather than compute-bound.

### P8. Give the deficiency form of Hall.
`max matching = |L| − max_{S⊆L}(|S| − |N(S)|)`. The maximizing `S` is the bottleneck; its excess over its neighborhood equals the number of forced-unmatched left vertices.

---

## Behavioral Questions (5)

1. **Tell me about a time you recognized a known algorithm inside a messy product requirement.** (Looking for: pattern recognition — "assign/pair/cover" → matching, plus how you validated the model.)
2. **Describe a bug that was subtle and hard to find.** (Strong answer: the stale-`visited` undercount that passed small tests but failed at scale.)
3. **How did you decide between a simple-but-slower and a complex-but-faster approach?** (Kuhn vs Hopcroft-Karp trade-off, driven by measured graph size.)
4. **Tell me about explaining an optimization result to a non-technical stakeholder.** (Using the dual / bottleneck set to answer "why wasn't X matched.")
5. **Describe handling correctness under concurrency.** (Single-writer actor vs lock-based, and why you chose it.)

---

## Coding Challenges (Go / Java / Python)

### Challenge 1 — Maximum Bipartite Matching (Kuhn)

**Problem.** Given `nL` left and `nR` right vertices and a list of edges, return the maximum matching size.

```go
package main
import "fmt"
func maxMatching(nL, nR int, adj [][]int) int {
	matchR := make([]int, nR)
	for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(u int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] {
				used[v] = true
				if matchR[v] == -1 || try(matchR[v]) {
					matchR[v] = u; return true
				}
			}
		}
		return false
	}
	count := 0
	for u := 0; u < nL; u++ {
		used = make([]bool, nR)
		if try(u) { count++ }
	}
	return count
}
func main() {
	adj := [][]int{{0, 1}, {0}, {1, 2}}
	fmt.Println(maxMatching(3, 3, adj)) // 3
}
```

```java
import java.util.*;
public class MaxMatching {
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
def max_matching(n_left, n_right, adj):
    match_r = [-1] * n_right
    def try_k(u, used):
        for v in adj[u]:
            if not used[v]:
                used[v] = True
                if match_r[v] == -1 or try_k(match_r[v], used):
                    match_r[v] = u
                    return True
        return False
    count = 0
    for u in range(n_left):
        if try_k(u, [False] * n_right):
            count += 1
    return count

print(max_matching(3, 3, [[0, 1], [0], [1, 2]]))  # 3
```

### Challenge 2 — Minimum Number of Lines to Cover All 1s (König)

**Problem.** Given a 0/1 matrix, find the minimum number of rows + columns ("lines") needed to cover every `1`. This equals the maximum matching where row `i` connects to column `j` iff `matrix[i][j] == 1` (König: min vertex cover = max matching).

```go
package main
import "fmt"
func minLines(grid [][]int) int {
	n, m := len(grid), len(grid[0])
	adj := make([][]int, n)
	for i := 0; i < n; i++ {
		for j := 0; j < m; j++ {
			if grid[i][j] == 1 { adj[i] = append(adj[i], j) }
		}
	}
	matchR := make([]int, m); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(u int) bool
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
	for u := 0; u < n; u++ { used = make([]bool, m); if try(u) { c++ } }
	return c
}
func main() {
	g := [][]int{{1,0,1},{0,1,0},{1,0,0}}
	fmt.Println(minLines(g)) // 3
}
```

```java
import java.util.*;
public class MinLines {
    static List<List<Integer>> adj; static int[] matchR; static boolean[] used;
    static boolean tryK(int u) {
        for (int v : adj.get(u)) if (!used[v]) {
            used[v] = true;
            if (matchR[v] == -1 || tryK(matchR[v])) { matchR[v] = u; return true; }
        }
        return false;
    }
    public static void main(String[] a) {
        int[][] g = {{1,0,1},{0,1,0},{1,0,0}};
        int n = g.length, m = g[0].length;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            adj.add(new ArrayList<>());
            for (int j = 0; j < m; j++) if (g[i][j] == 1) adj.get(i).add(j);
        }
        matchR = new int[m]; Arrays.fill(matchR, -1);
        int c = 0;
        for (int u = 0; u < n; u++) { used = new boolean[m]; if (tryK(u)) c++; }
        System.out.println(c); // 3
    }
}
```

```python
def min_lines(grid):
    n, m = len(grid), len(grid[0])
    adj = [[j for j in range(m) if grid[i][j] == 1] for i in range(n)]
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

print(min_lines([[1,0,1],[0,1,0],[1,0,0]]))  # 3
```

### Challenge 3 — Task Assignment (Minimum Total Cost / Hungarian)

**Problem.** `n` workers, `n` tasks, `cost[i][j]` = cost of worker `i` doing task `j`. Assign each worker exactly one task minimizing total cost.

```go
package main
import "fmt"
const INF = 1 << 60
func assign(cost [][]int) int {
	n := len(cost)
	u := make([]int, n+1); v := make([]int, n+1); p := make([]int, n+1); way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i; j0 := 0
		minv := make([]int, n+1); used := make([]bool, n+1)
		for j := range minv { minv[j] = INF }
		for {
			used[j0] = true; i0 := p[j0]; delta := INF; j1 := -1
			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := cost[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] { minv[j] = cur; way[j] = j0 }
					if minv[j] < delta { delta = minv[j]; j1 = j }
				}
			}
			for j := 0; j <= n; j++ {
				if used[j] { u[p[j]] += delta; v[j] -= delta } else { minv[j] -= delta }
			}
			j0 = j1
			if p[j0] == 0 { break }
		}
		for j0 != 0 { j1 := way[j0]; p[j0] = p[j1]; j0 = j1 }
	}
	total := 0
	for j := 1; j <= n; j++ { if p[j] != 0 { total += cost[p[j]-1][j-1] } }
	return total
}
func main() { fmt.Println(assign([][]int{{4,1,3},{2,0,5},{3,2,2}})) } // 5
```

```java
public class Assign {
    static final long INF = Long.MAX_VALUE / 4;
    public static long solve(int[][] cost) {
        int n = cost.length;
        long[] u = new long[n+1], v = new long[n+1];
        int[] p = new int[n+1], way = new int[n+1];
        for (int i = 1; i <= n; i++) {
            p[0] = i; int j0 = 0;
            long[] minv = new long[n+1]; boolean[] used = new boolean[n+1];
            java.util.Arrays.fill(minv, INF);
            do {
                used[j0] = true; int i0 = p[j0], j1 = -1; long delta = INF;
                for (int j = 1; j <= n; j++) if (!used[j]) {
                    long cur = cost[i0-1][j-1] - u[i0] - v[j];
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
        for (int j = 1; j <= n; j++) if (p[j] != 0) total += cost[p[j]-1][j-1];
        return total;
    }
    public static void main(String[] a) {
        System.out.println(solve(new int[][]{{4,1,3},{2,0,5},{3,2,2}})); // 5
    }
}
```

```python
INF = float("inf")
def assign(cost):
    n = len(cost)
    u = [0]*(n+1); v = [0]*(n+1); p = [0]*(n+1); way = [0]*(n+1)
    for i in range(1, n+1):
        p[0] = i; j0 = 0
        minv = [INF]*(n+1); used = [False]*(n+1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = -1
            for j in range(1, n+1):
                if not used[j]:
                    cur = cost[i0-1][j-1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j] = cur; way[j] = j0
                    if minv[j] < delta: delta = minv[j]; j1 = j
            for j in range(n+1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while j0:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    return sum(cost[p[j]-1][j-1] for j in range(1, n+1) if p[j])

print(assign([[4,1,3],[2,0,5],[3,2,2]]))  # 5
```

### Challenge 4 — Maximum Students Taking Exam (matching on a grid)

**Problem.** A seating grid has broken seats (`#`) and good seats (`.`). A student can cheat by looking at the left, right, upper-left, and upper-right adjacent seats. Place the maximum number of students so no one can cheat off another. Model: good seats in even columns vs odd columns form a bipartite graph; an edge connects two good seats that can cheat. Answer = (good seats) − (maximum matching). This is **max independent set on a bipartite conflict graph = V − max matching**.

```go
package main
import "fmt"
func maxStudents(seats []string) int {
	rows := len(seats); if rows == 0 { return 0 }
	cols := len(seats[0])
	id := func(r, c int) int { return r*cols + c }
	good := func(r, c int) bool { return r >= 0 && r < rows && c >= 0 && c < cols && seats[r][c] == '.' }
	adj := make([][]int, rows*cols)
	total := 0
	// left part: even columns; right part: odd columns
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if seats[r][c] != '.' { continue }
			total++
			if c%2 != 0 { continue } // build edges only from even-column seats
			for _, d := range [][2]int{{0, -1}, {0, 1}, {-1, -1}, {-1, 1}} {
				nr, nc := r+d[0], c+d[1]
				if good(nr, nc) { adj[id(r, c)] = append(adj[id(r, c)], id(nr, nc)) }
			}
		}
	}
	matchR := make([]int, rows*cols); for i := range matchR { matchR[i] = -1 }
	var used []bool
	var try func(u int) bool
	try = func(u int) bool {
		for _, v := range adj[u] {
			if !used[v] {
				used[v] = true
				if matchR[v] == -1 || try(matchR[v]) { matchR[v] = u; return true }
			}
		}
		return false
	}
	m := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c += 2 {
			if seats[r][c] == '.' {
				used = make([]bool, rows*cols)
				if try(id(r, c)) { m++ }
			}
		}
	}
	return total - m
}
func main() {
	fmt.Println(maxStudents([]string{"#.##", "#...", "...#"})) // 4
}
```

```java
import java.util.*;
public class MaxStudents {
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
        int rows = seats.length, cols = seats[0].length(), N = rows * cols;
        adj = new ArrayList<>();
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int total = 0;
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
    cols = len(seats[0])
    N = rows * cols
    def good(r, c): return 0 <= r < rows and 0 <= c < cols and seats[r][c] == '.'
    adj = [[] for _ in range(N)]
    total = 0
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

## Common Pitfalls

- **Forgetting to reset `visited` per left vertex** — silently undercounts.
- **Running on a non-bipartite graph** — wrong answer; 2-color first.
- **Confusing maximal with maximum.**
- **Using Kuhn for a weighted problem** — needs Hungarian / min-cost flow.
- **Wrong sentinel** — mixing `-1` (NIL) and `0` between Kuhn and Hopcroft-Karp implementations.
- **Off-by-one in bipartition for grid problems** — even vs odd column parity must be consistent.
- **Python recursion limit** on long augmenting chains.

---

## What Interviewers Are Really Testing

1. **Pattern recognition** — can you see "assign / pair / cover / maximum independent" and reach for matching? This is the single highest-signal skill.
2. **Correct augmenting-path implementation** — the `visited`-reset detail proves you actually understand the algorithm rather than memorizing it.
3. **Duality fluency** — König (matching = cover), independent set = `V − matching`, Hall's bottleneck. These convert one problem into another and are where strong candidates separate.
4. **Complexity judgment** — knowing when `O(V·E)` Kuhn is fine vs when `O(E√V)` Hopcroft-Karp is required, and that weighted needs `O(V³)` Hungarian.
5. **Modeling discipline** — reducing a word problem (grid seating, DAG path cover, minimum lines) to a clean bipartite graph correctly.
