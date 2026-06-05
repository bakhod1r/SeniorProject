# Hopcroft-Karp Algorithm — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> The core loop is always: `while bfs(): for each free left u: if dfs(u) matching++`. BFS builds distance layers; DFS augments along a maximal set of vertex-disjoint shortest augmenting paths. Number real vertices from `1`; reserve `0` for NIL.

---

## Beginner Tasks (5)

### Task 1 — Maximum matching size

**Problem.** Read a bipartite graph (`nL`, `nR`, edge list `u v`) and print the size of the maximum-cardinality matching using Hopcroft-Karp.

**Constraints.** `1 <= nL, nR <= 10^4`; up to `10^5` edges. Time `O(E·√V)`.

**Hint.** Use the NIL=0 convention. Loop `while bfs()`, then a DFS per free left vertex.

**Reference — Go.**

```go
package main

import "fmt"

const INF = 1 << 30

type HK struct {
	nL, nR             int
	adj                [][]int
	pairU, pairV, dist []int
}

func NewHK(nL, nR int) *HK {
	return &HK{nL: nL, nR: nR, adj: make([][]int, nL+1),
		pairU: make([]int, nL+1), pairV: make([]int, nR+1), dist: make([]int, nL+1)}
}
func (h *HK) Add(u, v int) { h.adj[u] = append(h.adj[u], v) }
func (h *HK) bfs() bool {
	q := []int{}
	for u := 1; u <= h.nL; u++ {
		if h.pairU[u] == 0 {
			h.dist[u] = 0
			q = append(q, u)
		} else {
			h.dist[u] = INF
		}
	}
	h.dist[0] = INF
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		if h.dist[u] < h.dist[0] {
			for _, v := range h.adj[u] {
				if h.dist[h.pairV[v]] == INF {
					h.dist[h.pairV[v]] = h.dist[u] + 1
					q = append(q, h.pairV[v])
				}
			}
		}
	}
	return h.dist[0] != INF
}
func (h *HK) dfs(u int) bool {
	if u == 0 {
		return true
	}
	for _, v := range h.adj[u] {
		if h.dist[h.pairV[v]] == h.dist[u]+1 && h.dfs(h.pairV[v]) {
			h.pairV[v] = u
			h.pairU[u] = v
			return true
		}
	}
	h.dist[u] = INF
	return false
}
func (h *HK) Solve() int {
	m := 0
	for h.bfs() {
		for u := 1; u <= h.nL; u++ {
			if h.pairU[u] == 0 && h.dfs(u) {
				m++
			}
		}
	}
	return m
}
func main() {
	h := NewHK(3, 3)
	h.Add(1, 1)
	h.Add(1, 2)
	h.Add(2, 1)
	h.Add(3, 2)
	h.Add(3, 3)
	fmt.Println(h.Solve()) // 3
}
```

**Reference — Java.**

```java
import java.util.*;

public class Task1 {
    static final int INF = Integer.MAX_VALUE;
    int nL, nR; List<List<Integer>> adj; int[] pairU, pairV, dist;
    Task1(int nL, int nR) {
        this.nL = nL; this.nR = nR;
        adj = new ArrayList<>();
        for (int i = 0; i <= nL; i++) adj.add(new ArrayList<>());
        pairU = new int[nL + 1]; pairV = new int[nR + 1]; dist = new int[nL + 1];
    }
    void add(int u, int v) { adj.get(u).add(v); }
    boolean bfs() {
        Deque<Integer> q = new ArrayDeque<>();
        for (int u = 1; u <= nL; u++) {
            if (pairU[u] == 0) { dist[u] = 0; q.add(u); } else dist[u] = INF;
        }
        dist[0] = INF;
        while (!q.isEmpty()) {
            int u = q.poll();
            if (dist[u] < dist[0])
                for (int v : adj.get(u))
                    if (dist[pairV[v]] == INF) { dist[pairV[v]] = dist[u] + 1; q.add(pairV[v]); }
        }
        return dist[0] != INF;
    }
    boolean dfs(int u) {
        if (u == 0) return true;
        for (int v : adj.get(u))
            if (dist[pairV[v]] == dist[u] + 1 && dfs(pairV[v])) { pairV[v] = u; pairU[u] = v; return true; }
        dist[u] = INF; return false;
    }
    int solve() {
        int m = 0;
        while (bfs())
            for (int u = 1; u <= nL; u++) if (pairU[u] == 0 && dfs(u)) m++;
        return m;
    }
    public static void main(String[] a) {
        Task1 h = new Task1(3, 3);
        h.add(1,1); h.add(1,2); h.add(2,1); h.add(3,2); h.add(3,3);
        System.out.println(h.solve()); // 3
    }
}
```

**Reference — Python.**

```python
import sys
from collections import deque
INF = float("inf")

class HK:
    def __init__(self, nL, nR):
        self.nL, self.nR = nL, nR
        self.adj = [[] for _ in range(nL + 1)]
        self.pu = [0] * (nL + 1); self.pv = [0] * (nR + 1); self.d = [0] * (nL + 1)
    def add(self, u, v): self.adj[u].append(v)
    def bfs(self):
        q = deque()
        for u in range(1, self.nL + 1):
            if self.pu[u] == 0: self.d[u] = 0; q.append(u)
            else: self.d[u] = INF
        self.d[0] = INF
        while q:
            u = q.popleft()
            if self.d[u] < self.d[0]:
                for v in self.adj[u]:
                    if self.d[self.pv[v]] == INF:
                        self.d[self.pv[v]] = self.d[u] + 1; q.append(self.pv[v])
        return self.d[0] != INF
    def dfs(self, u):
        if u == 0: return True
        for v in self.adj[u]:
            if self.d[self.pv[v]] == self.d[u] + 1 and self.dfs(self.pv[v]):
                self.pv[v] = u; self.pu[u] = v; return True
        self.d[u] = INF; return False
    def solve(self):
        m = 0
        while self.bfs():
            for u in range(1, self.nL + 1):
                if self.pu[u] == 0 and self.dfs(u): m += 1
        return m

if __name__ == "__main__":
    sys.setrecursionlimit(10**6)
    h = HK(3, 3)
    for u, v in [(1,1),(1,2),(2,1),(3,2),(3,3)]: h.add(u, v)
    print(h.solve())  # 3
```

- **Expected Output:** `3`.
- **Evaluation:** correctness, `O(E√V)` complexity, NIL handling.

---

### Task 2 — Print the matched pairs

**Problem.** Extend Task 1 to also print each matched pair `(u, v)` for `u = 1..nL`.

- Provide starter code in all 3 languages reusing the Task 1 solver.
- **Constraints.** Read `pairU[1..nL]`; skip entries equal to `0`.
- **Hint.** After `solve()`, iterate left vertices and print `(u, pairU[u])` where `pairU[u] != 0`.
- **Expected Output:** the matching size followed by the pairs.

---

### Task 3 — Perfect matching detector

**Problem.** Given a balanced bipartite graph (`nL == nR`), report whether a **perfect matching** exists (matching size equals `nL`).

- **Constraints.** Return a boolean.
- **Hint.** Run Hopcroft-Karp; perfect iff `solve() == nL`.
- **Expected Output:** `true` / `false`.

---

### Task 4 — Count free vertices

**Problem.** After computing the maximum matching, print how many left vertices and how many right vertices remain **unmatched**.

- **Constraints.** Use `pairU`/`pairV` (`0` means free).
- **Hint.** Free left = `count(pairU[u] == 0)`; free right = `count(pairV[v] == 0)`.
- **Expected Output:** two integers.

---

### Task 5 — Phase counter

**Problem.** Instrument the solver to count how many **phases** (BFS rounds that returned true) it ran. Print the phase count alongside the matching size.

- **Constraints.** Increment a counter inside the `while bfs()` loop body.
- **Hint.** On random dense graphs the count should stay small (single digits) — empirical evidence of `O(√V)`.
- **Expected Output:** matching size and phase count.

---

## Intermediate Tasks (5)

### Task 6 — Hopcroft-Karp vs. Kuhn differential test

**Problem.** Implement both Kuhn (`O(V·E)`) and Hopcroft-Karp. On 1,000 random bipartite graphs, assert both return the **same** matching size.

- Provide starter code in all 3 languages.
- **Constraints.** Random `nL, nR <= 50`, random edges.
- **Hint.** The *size* is unique even though the pairs may differ.
- **Expected Output:** "all 1000 agree" or the first mismatch.

---

### Task 7 — Minimum vertex cover (König's theorem)

**Problem.** Compute a **minimum vertex cover** of a bipartite graph from a maximum matching.

- **Constraints.** Min vertex cover size = max matching size.
- **Hint.** From the final matching, do an alternating BFS/DFS from unmatched left vertices: let `Z` = vertices reachable via alternating paths. Cover = `(L \ Z) ∪ (R ∩ Z)`.
- **Expected Output:** the cover size and the chosen vertices.

---

### Task 8 — Maximum independent set in a bipartite graph

**Problem.** Output a **maximum independent set** (no two chosen vertices share an edge).

- **Constraints.** Max independent set = `V − max matching` (König complement of vertex cover).
- **Hint.** Compute the min vertex cover (Task 7); the independent set is its complement.
- **Expected Output:** the set size `V − |M|` and the vertices.

---

### Task 9 — Grid domino tiling

**Problem.** Given an `m × n` grid with some cells blocked, determine the maximum number of non-overlapping `1×2` dominoes that fit.

- **Constraints.** Color cells like a checkerboard; black = left, white = right; edges between adjacent free cells.
- **Hint.** Maximum dominoes = maximum bipartite matching on the adjacency graph.
- **Expected Output:** the maximum number of dominoes.

---

### Task 10 — Greedy warm start

**Problem.** Add a greedy pre-matching pass before the phases and measure the reduction in phase count on dense random graphs.

- Provide starter code in all 3 languages.
- **Constraints.** Greedy: for each left vertex grab any free neighbor; then run the normal loop.
- **Hint.** Correctness is unchanged; augmenting paths repair suboptimal greedy choices.
- **Expected Output:** phase counts with and without warm start.

---

## Advanced Tasks (5)

### Task 11 — Iterative (stack-based) DFS

**Problem.** Replace the recursive DFS with an explicit-stack version so deep augmenting chains never overflow the call stack. Verify identical results on stress tests.

- Provide starter code in all 3 languages.
- **Constraints.** Must augment correctly along the discovered path.
- **Hint.** Keep `(vertex, edge-index)` frames; on reaching NIL, commit pairings back up the stack.
- **Expected Output:** same matching size as the recursive version on all tests.

---

### Task 12 — Minimum path cover of a DAG

**Problem.** Given a DAG, find the minimum number of **vertex-disjoint paths** that cover every vertex.

- **Constraints.** Split each vertex `x` into `x_out` (left) and `x_in` (right); edge `x→y` becomes `x_out — y_in`.
- **Hint.** Answer = `(#vertices) − (max matching)`.
- **Expected Output:** the minimum number of paths.

---

### Task 13 — Tick-based incremental re-matching

**Problem.** Simulate a stream of arrivals/departures. Each tick, free invalidated matched edges, then **warm-start** Hopcroft-Karp to repair the matching. Compare total work vs. recomputing from scratch every tick.

- Provide starter code in all 3 languages.
- **Constraints.** Maintain `pairU`/`pairV` across ticks; only re-augment freed vertices.
- **Hint.** Repair is usually one phase since the prior matching is mostly valid.
- **Expected Output:** per-tick matching size and total phases (warm vs. cold).

---

### Task 14 — Time-budgeted (phase-capped) matching

**Problem.** Implement a phase cap `k`. Run at most `k` phases and report the (near-maximum) matching size and the optimality gap (vs. uncapped).

- **Constraints.** Stop after `k` phases even if `bfs()` still returns true.
- **Hint.** Early phases capture most of the matching because each phase increases the shortest-path length.
- **Expected Output:** capped size, true size, and the gap.

---

### Task 15 — Benchmark `O(E·√V)` empirically

**Problem.** Measure runtime and **phase count** as `n` grows over `{100, 500, 1000, 5000, 10000}` on dense random bipartite graphs. Plot/print results and confirm the phase count tracks `√V`, not `V`.

- Provide starter code in all 3 languages.
- **Constraints.** ~`4n` random edges per size; one warm-up run.
- **Hint.** Phase count should grow roughly like `√(2n)` and stay tiny.
- **Expected Output:** a table of `n`, matching size, phase count, and time.

---

## Benchmark Task

> Compare performance across all 3 languages on dense random bipartite graphs.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{100, 500, 1000, 5000, 10000}
	for _, n := range sizes {
		h := NewHK(n, n) // reuse the Task 1 HK type
		for i := 0; i < 4*n; i++ {
			h.Add(rand.Intn(n)+1, rand.Intn(n)+1)
		}
		start := time.Now()
		size := h.Solve()
		fmt.Printf("n=%6d: matching=%6d in %v\n", n, size, time.Since(start))
	}
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {100, 500, 1000, 5000, 10000};
        Random rnd = new Random(1);
        for (int n : sizes) {
            Task1 h = new Task1(n, n); // reuse the Task 1 solver
            for (int i = 0; i < 4 * n; i++)
                h.add(rnd.nextInt(n) + 1, rnd.nextInt(n) + 1);
            long t0 = System.nanoTime();
            int size = h.solve();
            long ms = (System.nanoTime() - t0) / 1_000_000;
            System.out.printf("n=%6d: matching=%6d in %d ms%n", n, size, ms);
        }
    }
}
```

#### Python

```python
import random, time
# reuse the Task 1 HK class

sizes = [100, 500, 1000, 5000]
for n in sizes:
    h = HK(n, n)
    for _ in range(4 * n):
        h.add(random.randint(1, n), random.randint(1, n))
    t0 = time.time()
    size = h.solve()
    print(f"n={n:6d}: matching={size:6d} in {(time.time()-t0)*1000:.1f} ms")
```

> **Expected observation:** runtime grows roughly like `E·√V`; the internal phase count stays in the single digits even at `n = 10000`, confirming the `O(√V)` phase bound in practice.
