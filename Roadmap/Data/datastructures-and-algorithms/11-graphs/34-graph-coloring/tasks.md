# Graph Coloring — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, I/O spec, constraints, a hint, and starter code or evaluation criteria. A proper coloring assigns colors so adjacent vertices differ; verify your output by scanning every edge.

---

## Beginner Tasks (5)

### Task 1 — Greedy vertex coloring from scratch

**Problem.** Given an undirected graph as an adjacency list, produce a proper coloring by greedy: process vertices `0..n-1` in index order and assign each the smallest non-negative color not used by its already-colored neighbors. Print the color of each vertex and the total number of colors used.

**Input / Output spec.**
- Input: `n`, `m`, then `m` edges `u v`.
- Output: `n` integers (colors of vertices `0..n-1`), then the number of distinct colors.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`.
- Simple graph (no self-loops, no parallel edges).
- Target time: `O(n + m)`.

**Hint.** For each vertex, gather the colors of colored neighbors into a boolean array sized `n + 1`, then scan for the first free index.

**Starter — Go.**
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
	adj := make([][]int, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], v)
		adj[v] = append(adj[v], u)
	}
	// TODO: greedy color, print colors and count
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    it = iter(data)
    n, m = int(next(it)), int(next(it))
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v = int(next(it)), int(next(it))
        adj[u].append(v)
        adj[v].append(u)
    # TODO: greedy color
main()
```

**Evaluation criteria.** Output is a proper coloring (verified by scanning edges); color count ≤ `Δ + 1`; runs in linear time.

---

### Task 2 — Bipartite check (2-coloring)

**Problem.** Decide whether a graph is 2-colorable (bipartite). If yes, print `YES` and a valid 2-coloring; otherwise print `NO`. Handle disconnected graphs.

**Input / Output spec.**
- Input: `n`, `m`, then `m` edges.
- Output: `YES` and `n` colors `∈ {0,1}`, or `NO`.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`.
- Target time: `O(n + m)`.

**Hint.** BFS/DFS from every uncolored vertex; color the start `0`, flip `1 - color[u]` for each neighbor, fail on a same-color edge. (See sibling topic `02-bfs`.)

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            st = new StringTokenizer(br.readLine());
            int u = Integer.parseInt(st.nextToken());
            int v = Integer.parseInt(st.nextToken());
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        // TODO: BFS 2-coloring
    }
}
```

**Evaluation criteria.** Correct YES/NO on all connected and disconnected cases; the printed coloring is proper when YES.

---

### Task 3 — Detect and report an odd cycle

**Problem.** If a graph is not bipartite, output the vertices of one odd cycle (any one). If it is bipartite, print `BIPARTITE`.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: `BIPARTITE`, or the length and vertex sequence of an odd cycle.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`.

**Hint.** During the 2-coloring BFS/DFS, keep a `parent[]` array. When a conflict edge `{u, v}` (same color) is found, walk both `u` and `v` up the parent tree to their lowest common ancestor; the two tree paths plus the edge form an odd cycle.

**Evaluation criteria.** The reported cycle is a real cycle, has odd length, and exists exactly when the graph is non-bipartite.

---

### Task 4 — Verify a proper coloring

**Problem.** Given a graph and a candidate coloring, decide whether it is proper. Report the first violating edge if any.

**Input / Output spec.**
- Input: `n`, `m`, edges, then `n` colors.
- Output: `PROPER`, or `IMPROPER u v` for a same-color edge.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`.

**Hint.** Single pass over edges: report the first `{u, v}` with `color[u] == color[v]`.

**Evaluation criteria.** Correct on all inputs; `O(n + m)`; this verifier should be reused to validate the other tasks' outputs.

---

### Task 5 — Count colors used by greedy under two orders

**Problem.** Color the graph greedily twice — once in index order `0..n-1`, once in descending-degree order (Welsh–Powell) — and print how many colors each used. The point is to *observe* order dependence.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: two integers — colors used by index-order greedy and by Welsh–Powell.

**Constraints.**
- `1 ≤ n ≤ 10^5`, `0 ≤ m ≤ 2·10^5`.

**Hint.** Sort a list of vertex indices by `-deg(v)` for the second run; reuse your greedy routine with a custom order.

**Evaluation criteria.** Both colorings are proper; Welsh–Powell's count is ≤ index-order's on most inputs (not guaranteed, but typical). Demonstrates that greedy is order-dependent.

---

## Intermediate Tasks (5)

### Task 6 — DSATUR coloring

**Problem.** Implement DSATUR: repeatedly color the uncolored vertex of maximum saturation (distinct neighbor colors), breaking ties by maximum degree, with the smallest free color. Print the coloring and color count.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: `n` colors and the count.

**Constraints.**
- `1 ≤ n ≤ 2·10^4`, `0 ≤ m ≤ 2·10^5`.
- Target: `O((n + m) log n)` with a priority queue (naive `O(n²)` accepted for small `n`).

**Hint.** Track a set/bitmask of neighbor colors per vertex; saturation is its size. After coloring `v`, update the saturation of each neighbor.

**Starter — Python.**
```python
def dsatur(n, adj):
    color = [-1] * n
    sat = [set() for _ in range(n)]
    deg = [len(adj[v]) for v in range(n)]
    for _ in range(n):
        v = max((x for x in range(n) if color[x] == -1),
                key=lambda x: (len(sat[x]), deg[x]))
        c = 0
        while c in sat[v]:
            c += 1
        color[v] = c
        for u in adj[v]:
            sat[u].add(c)
    return color, max(color) + 1
```

**Evaluation criteria.** Proper coloring; on bipartite inputs DSATUR uses exactly 2 colors; color count ≤ Welsh–Powell on most inputs.

---

### Task 7 — m-Coloring feasibility with backtracking

**Problem.** Given a graph and `m`, decide whether a proper `m`-coloring exists and output one if so. Use backtracking with pruning.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: `YES` + coloring, or `NO`.

**Constraints.**
- `1 ≤ n ≤ 30`, `1 ≤ m ≤ n`.
- Target: pruned backtracking; should solve `n ≤ 30` quickly for reasonable graphs.

**Hint.** Order vertices by descending degree (color the hard ones first). For each vertex try colors `0..m-1` not used by colored neighbors; recurse; backtrack. Symmetry-break: vertex 0 always gets color 0.

**Evaluation criteria.** Correct YES/NO; returned coloring is proper and uses ≤ `m` colors; backtracking prunes (does not blindly try all `mⁿ`).

---

### Task 8 — Exact chromatic number for small graphs

**Problem.** Compute `χ(G)` exactly for `n ≤ 18` using subset DP or inclusion–exclusion.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: `χ(G)`.

**Constraints.**
- `1 ≤ n ≤ 18`.
- Target: `O(2ⁿ · n)` or `O(3ⁿ)`.

**Hint.** Precompute which subsets are independent sets via a bitmask; DP `dp[S] = min over independent subsets I ⊆ rem of dp[S]+1`. Or use the inclusion–exclusion method from [`professional.md`](./professional.md).

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func chromatic(n int, adjMask []uint32) int {
	full := (uint32(1) << n) - 1
	ind := make([]bool, 1<<n)
	ind[0] = true
	for s := uint32(1); s <= full; s++ {
		v := bits.TrailingZeros32(s)
		rest := s &^ (1 << v)
		ind[s] = ind[rest] && adjMask[v]&rest == 0
	}
	const INF = 1 << 30
	dp := make([]int, 1<<n)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0
	for s := uint32(0); s <= full; s++ {
		if dp[s] == INF {
			continue
		}
		rem := full &^ s
		for sub := rem; sub > 0; sub = (sub - 1) & rem {
			if ind[sub] && dp[s]+1 < dp[s|sub] {
				dp[s|sub] = dp[s] + 1
			}
		}
	}
	return dp[full]
}

func main() {
	adj := []uint32{0b110, 0b101, 0b011}
	fmt.Println(chromatic(3, adj)) // 3
}
```

**Evaluation criteria.** Matches known `χ` on test graphs (triangle 3, `C₅` 3, `C₄` 2, `K₄` 4, Petersen 3); finishes within time limit for `n ≤ 18`.

---

### Task 9 — Exam timetabling (minimum slots)

**Problem.** Given exams and conflicting pairs (share a student), assign exams to the fewest time-slots so conflicting exams differ. Output the slot of each exam and the number of slots.

**Input / Output spec.**
- Input: list of exam names; list of conflict pairs.
- Output: a slot number per exam and the total slot count.

**Constraints.**
- `1 ≤ exams ≤ 10^4`.
- Use a heuristic (DSATUR); exact not required.

**Hint.** Build the conflict graph, run DSATUR, group exams by color. Report the clique lower bound (size of any clique you find) alongside, to show how close you are.

**Evaluation criteria.** No conflicting exams share a slot; slot count is close to (ideally equal to) the lower bound on sample inputs.

---

### Task 10 — Edge coloring a bipartite graph (König)

**Problem.** Given a bipartite graph, produce a proper *edge* coloring using exactly `Δ` colors (guaranteed possible by König's theorem). Output a color per edge.

**Input / Output spec.**
- Input: bipartite graph (two parts), edges.
- Output: a color per edge such that edges sharing an endpoint differ; use exactly `Δ` colors.

**Constraints.**
- `1 ≤ |edges| ≤ 10^4`.

**Hint.** For each edge `{u, v}`, pick the smallest color free at *both* `u` and `v`. If both have a free color but they differ, an alternating (Kempe) chain swap resolves the clash — this always succeeds for bipartite graphs within `Δ` colors.

**Evaluation criteria.** Coloring is proper on edges; uses exactly `Δ` colors; equals vertex coloring of the line graph.

---

## Advanced Tasks (5)

### Task 11 — Register allocation (Chaitin–Briggs simplify/select)

**Problem.** Given an interference graph and `k` registers, assign registers (colors `0..k-1`); vertices that cannot be colored are spilled. Output the assignment and the spill set. Implement simplify (peel degree `< k`), optimistic spill (peel max-degree when stuck), and select (assign on the way back).

**Input / Output spec.**
- Input: `n`, `k`, interference edges.
- Output: register per vertex (`-1` if spilled) and the list of spilled vertices.

**Constraints.**
- `1 ≤ n ≤ 10^4`.

**Hint.** Use a work-stack. During simplify keep current degrees and a `removed[]` flag. Optimistic coloring (Briggs): a spilled candidate may still find a free register during select.

**Evaluation criteria.** Non-spilled vertices form a proper `k`-coloring; spill set is minimal-ish (optimistic coloring rescues some candidates); see [`senior.md`](./senior.md) for the reference structure.

---

### Task 12 — Chromatic polynomial evaluation

**Problem.** Given a small graph and an integer `k`, compute `P(G, k)`, the number of proper `k`-colorings, via deletion–contraction. Then find `χ(G)` as the smallest `k` with `P(G, k) > 0`.

**Input / Output spec.**
- Input: `n`, edges, `k`.
- Output: `P(G, k)` and `χ(G)`.

**Constraints.**
- `1 ≤ n ≤ 15` (deletion–contraction is exponential).

**Hint.** `P(G, k) = P(G − e, k) − P(G / e, k)`; base case: edgeless graph → `k^{#vertices}`. Memoize on a canonical edge-set form. Verify: tree → `k(k−1)^{n−1}`, `Kₙ` → falling factorial.

**Evaluation criteria.** Matches closed forms for trees, cycles, and complete graphs; `χ` derived correctly (e.g. `C₅ → 3`).

---

### Task 13 — DSATUR with a saturation priority queue

**Problem.** Re-implement DSATUR so each step is `O(log n)` using a lazy priority queue keyed on `(−saturation, −degree, vertex)`. Compare its runtime against the naive `O(n²)` DSATUR on large graphs.

**Input / Output spec.**
- Input: `n`, `m`, edges.
- Output: coloring, color count, and a timing comparison.

**Constraints.**
- `1 ≤ n ≤ 2·10^5`, `0 ≤ m ≤ 10^6`.

**Hint.** Push updated entries on saturation change; on pop, skip stale entries (where the recorded saturation no longer matches). This is the lazy-deletion pattern.

**Evaluation criteria.** Same color count as naive DSATUR; demonstrably faster on large graphs; correct lazy-skip logic.

---

### Task 14 — Timetabling with local-search improvement

**Problem.** Start from a DSATUR coloring, then reduce the color count using Kempe-chain swaps and/or simulated annealing while keeping the coloring proper. Report the before/after color counts.

**Input / Output spec.**
- Input: conflict graph.
- Output: initial colors, improved colors, final coloring.

**Constraints.**
- `1 ≤ n ≤ 10^4`.
- Fixed wall-clock budget for the improvement phase.

**Hint.** A Kempe swap flips two colors in a connected two-colored component, staying proper. Try to empty the largest color class by recoloring its vertices via swaps; accept worsening moves with annealing probability to escape local optima.

**Evaluation criteria.** Final coloring is proper; color count ≤ DSATUR's; improvement loop respects the time budget and never breaks properness.

---

### Task 15 — Frequency assignment with channel distance (L(2,1))

**Problem.** Assign integer channels so that vertices at graph distance 1 differ by at least 2 and vertices at distance 2 differ by at least 1 (an L(2,1)-labeling). Minimize the largest channel used (the *span*).

**Input / Output spec.**
- Input: graph (transmitters and interference edges).
- Output: a channel per vertex and the span.

**Constraints.**
- `1 ≤ n ≤ 5·10^3`.
- Heuristic acceptable; exact not required.

**Hint.** Generalize greedy: when coloring `v`, forbid `{c, c±1}` for distance-1 neighbors and `{c}` for distance-2 neighbors. Order by degree or saturation. Known bound: span `≤ Δ² + Δ` (Griggs–Yeh).

**Evaluation criteria.** Labeling satisfies both distance constraints; span is small (near the `Δ²` regime on dense graphs); generalizes the plain-coloring greedy.

---

## Benchmark Harness

Use this to compare greedy, Welsh–Powell, and DSATUR on the same random graphs: color count and wall time. Run all three on each graph and tabulate.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
	"math/rand"
	"time"
)

func randomGraph(n int, p float64, seed int64) [][]int {
	r := rand.New(rand.NewSource(seed))
	adj := make([][]int, n)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if r.Float64() < p {
				adj[i] = append(adj[i], j)
				adj[j] = append(adj[j], i)
			}
		}
	}
	return adj
}

func countColors(c []int) int {
	max := 0
	for _, x := range c {
		if x+1 > max {
			max = x + 1
		}
	}
	return max
}

func greedy(n int, adj [][]int, order []int) []int {
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	for _, v := range order {
		used := make([]bool, n+1)
		for _, u := range adj[v] {
			if color[u] != -1 {
				used[color[u]] = true
			}
		}
		c := 0
		for used[c] {
			c++
		}
		color[v] = c
	}
	return color
}

func dsatur(n int, adj [][]int) []int {
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	nc := make([]uint64, n)
	deg := make([]int, n)
	for v := range adj {
		deg[v] = len(adj[v])
	}
	for done := 0; done < n; done++ {
		best, bestSat, bestDeg := -1, -1, -1
		for v := 0; v < n; v++ {
			if color[v] != -1 {
				continue
			}
			s := bits.OnesCount64(nc[v])
			if s > bestSat || (s == bestSat && deg[v] > bestDeg) {
				best, bestSat, bestDeg = v, s, deg[v]
			}
		}
		c := 0
		for nc[best]&(1<<uint(c)) != 0 {
			c++
		}
		color[best] = c
		for _, u := range adj[best] {
			nc[u] |= 1 << uint(c)
		}
	}
	return color
}

func main() {
	for _, n := range []int{200, 500, 1000} {
		adj := randomGraph(n, 0.1, 42)
		idx := make([]int, n)
		for i := range idx {
			idx[i] = i
		}
		// index order greedy
		t := time.Now()
		g := greedy(n, adj, idx)
		fmt.Printf("n=%d greedy=%d (%v)\n", n, countColors(g), time.Since(t))
		// DSATUR
		t = time.Now()
		d := dsatur(n, adj)
		fmt.Printf("n=%d dsatur=%d (%v)\n", n, countColors(d), time.Since(t))
	}
}
```

#### Python

```python
import random, time


def random_graph(n, p, seed=42):
    rng = random.Random(seed)
    adj = [[] for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if rng.random() < p:
                adj[i].append(j)
                adj[j].append(i)
    return adj


def greedy(n, adj, order):
    color = [-1] * n
    for v in order:
        used = {color[u] for u in adj[v] if color[u] != -1}
        c = 0
        while c in used:
            c += 1
        color[v] = c
    return color


def welsh_powell(n, adj):
    order = sorted(range(n), key=lambda v: -len(adj[v]))
    return greedy(n, adj, order)


def dsatur(n, adj):
    color = [-1] * n
    sat = [set() for _ in range(n)]
    deg = [len(adj[v]) for v in range(n)]
    for _ in range(n):
        v = max((x for x in range(n) if color[x] == -1),
                key=lambda x: (len(sat[x]), deg[x]))
        c = 0
        while c in sat[v]:
            c += 1
        color[v] = c
        for u in adj[v]:
            sat[u].add(c)
    return color


def colors(c):
    return max(c) + 1


if __name__ == "__main__":
    for n in (200, 500, 1000):
        adj = random_graph(n, 0.1)
        t = time.time(); g = greedy(n, adj, list(range(n)))
        print(f"n={n} greedy={colors(g)} ({time.time()-t:.3f}s)")
        t = time.time(); wp = welsh_powell(n, adj)
        print(f"n={n} welsh-powell={colors(wp)} ({time.time()-t:.3f}s)")
        t = time.time(); d = dsatur(n, adj)
        print(f"n={n} dsatur={colors(d)} ({time.time()-t:.3f}s)")
```

**Expected pattern.** On random `G(n, 0.1)`, DSATUR uses 1–2 fewer colors than index-order greedy, with Welsh–Powell in between, while greedy is the fastest and DSATUR the slowest. The gap to the true `χ` shrinks as you move greedy → Welsh–Powell → DSATUR.

#### Java

```java
import java.util.*;

public class Bench {
    static List<List<Integer>> randomGraph(int n, double p, long seed) {
        Random r = new Random(seed);
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (r.nextDouble() < p) { adj.get(i).add(j); adj.get(j).add(i); }
        return adj;
    }

    static int[] greedy(int n, List<List<Integer>> adj, int[] order) {
        int[] color = new int[n];
        Arrays.fill(color, -1);
        for (int v : order) {
            boolean[] used = new boolean[n + 1];
            for (int u : adj.get(v)) if (color[u] != -1) used[color[u]] = true;
            int c = 0;
            while (used[c]) c++;
            color[v] = c;
        }
        return color;
    }

    static int colors(int[] c) {
        int max = 0;
        for (int x : c) max = Math.max(max, x + 1);
        return max;
    }

    public static void main(String[] args) {
        for (int n : new int[]{200, 500, 1000}) {
            List<List<Integer>> adj = randomGraph(n, 0.1, 42);
            int[] idx = new int[n];
            for (int i = 0; i < n; i++) idx[i] = i;
            long t = System.nanoTime();
            int[] g = greedy(n, adj, idx);
            System.out.printf("n=%d greedy=%d (%.3fms)%n",
                n, colors(g), (System.nanoTime() - t) / 1e6);
        }
    }
}
```

---

## How to Validate Every Task

After any coloring, run the verifier from Task 4: scan all edges and assert `color[u] != color[v]`. Treat a failing edge as a hard error. For minimization tasks, also print the clique lower bound (`χ ≥ ω`) so you can see how close your heuristic got. For exact tasks, cross-check against known values: triangle 3, `C₄` 2, `C₅` 3, `K₄` 4, Petersen graph 3, any tree 2, any bipartite graph 2.
