# Yen's Algorithm (K Shortest Loopless Paths) — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a problem statement, constraints, hints, and starter code in all three languages. Yen's core loop is: seed `A` with one Dijkstra, then for each spur node on the latest accepted path, remove repeating edges + root interior nodes, compute a spur path, push `root + spur` into the candidate heap `B`, and promote the cheapest. Weights are non-negative throughout (Yen relies on Dijkstra).

---

## Beginner Tasks (5)

### Task 1 — Dijkstra with removed edges and nodes

**Problem.** Implement the inner subroutine Yen depends on: a Dijkstra that returns the shortest `s→t` path (vertex list + cost) while ignoring a set of removed edges and removed nodes. Return a "not found" signal if `t` is unreachable.

**Constraints.** Non-negative weights, `1 ≤ V ≤ 10^4`. Must be `O(E + V log V)` with a binary heap.

**Hint.** Skip any edge `(u,v)` with `v` in `removedNodes` or `(u,v)` in `removedEdges`. Reconstruct the path with a `prev` map.

#### Go

```go
package main

// dijkstra returns (path, cost, found).
func dijkstra(g map[string]map[string]int, s, t string,
	remE map[[2]string]bool, remN map[string]bool) ([]string, int, bool) {
	// implement here
	return nil, 0, false
}

func main() {
	// test here
}
```

#### Java

```java
import java.util.*;

public class Task1 {
    // return int[]{cost} and fill outPath; null if not found
    static int[] dijkstra(Map<String, Map<String, Integer>> g, String s, String t,
                          Set<String> remE, Set<String> remN, List<String> outPath) {
        // implement here
        return null;
    }

    public static void main(String[] args) {
        // test here
    }
}
```

#### Python

```python
import heapq


def dijkstra(g, s, t, rem_e=frozenset(), rem_n=frozenset()):
    # implement here; return (path, cost) or None
    pass


if __name__ == "__main__":
    pass
```

- **Expected:** on `C→E 2, E→F 2, F→H 1`, `dijkstra(g,"C","H")` returns `(["C","E","F","H"], 5)`.
- **Evaluation:** correctness, handles removals, returns "not found" cleanly.

---

### Task 2 — Path cost helper

**Problem.** Given a graph and a vertex list, compute the total cost of the path (sum of consecutive edge weights). Assume every consecutive pair is a real edge.

**Constraints.** `O(path length)`.

**Hint.** Loop over indices `0 .. len-2` and sum `g[p[i]][p[i+1]]`.

#### Go

```go
func pathCost(g map[string]map[string]int, p []string) int {
	// implement here
	return 0
}
```

#### Java

```java
static int pathCost(Map<String, Map<String, Integer>> g, List<String> p) {
    // implement here
    return 0;
}
```

#### Python

```python
def path_cost(g, p):
    # implement here
    return 0
```

- **Expected:** cost of `["C","E","F","H"]` on the Task 1 graph is `5`.
- **Evaluation:** correct sum, handles a single-vertex path (cost 0).

---

### Task 3 — Seed the accepted list

**Problem.** Write the first step of Yen: run Dijkstra once from `s` to `t` and return the accepted list `A` containing just that path (or empty if unreachable).

**Constraints.** Reuse Task 1's Dijkstra.

**Hint.** `A = [dijkstra(g, s, t)]` if found, else `[]`.

#### Go

```go
func seed(g map[string]map[string]int, s, t string) [][]string {
	// implement here
	return nil
}
```

#### Java

```java
static List<List<String>> seed(Map<String, Map<String, Integer>> g, String s, String t) {
    // implement here
    return new ArrayList<>();
}
```

#### Python

```python
def seed(g, s, t):
    # implement here
    return []
```

- **Expected:** `seed` returns one path on a connected graph, empty list when `s` can't reach `t`.
- **Evaluation:** correct base case for the algorithm.

---

### Task 4 — Compute the removal sets for one spur node

**Problem.** Given the accepted list `A`, the latest path, and a spur index `i`, compute (a) the set of edges to remove (the spur-leaving edge of every path in `A` sharing the root `last[:i+1]`) and (b) the set of root interior nodes to remove (`last[:i]`).

**Constraints.** `O(|A| · path length)`.

**Hint.** A path `p` shares the root iff `p[:i+1] == last[:i+1]`; then remove edge `(p[i], p[i+1])`.

#### Go

```go
func removals(A [][]string, last []string, i int) (map[[2]string]bool, map[string]bool) {
	// implement here
	return nil, nil
}
```

#### Java

```java
static Object[] removals(List<List<String>> A, List<String> last, int i) {
    // return {Set<String> remE (as "u>v"), Set<String> remN}
    return null;
}
```

#### Python

```python
def removals(A, last, i):
    # return (rem_e set of (u,v), rem_n set of nodes)
    return set(), set()
```

- **Expected:** for `last=["C","E","F","H"]`, `A=[last]`, `i=1` ⇒ remove edge `("E","F")` and node `"C"`.
- **Evaluation:** removes the right edges/nodes; keeps the spur node itself.

---

### Task 5 — Reproduce the worked example

**Problem.** Using Tasks 1–4 (or a full Yen implementation), find the 3 shortest loopless paths from `C` to `H` on the graph below and print each path with its cost.

```
C→D 3, C→E 2, D→F 4, E→D 1, E→F 2, E→G 3, F→G 2, F→H 1, G→H 2
```

**Constraints.** Output must be `[5, 7, 8]` with paths `C,E,F,H` / `C,E,G,H` / `C,D,F,H`.

**Hint.** Wire the pieces: seed, loop over spur nodes, build candidates into a min-heap, pop the cheapest.

#### Go

```go
func yen(g map[string]map[string]int, s, t string, k int) [][2]interface{} {
	// return list of (nodes, cost)
	return nil
}
```

#### Java

```java
static void yen(Map<String, Map<String, Integer>> g, String s, String t, int k) {
    // print each path and cost
}
```

#### Python

```python
def yen(g, s, t, k):
    # return list of (nodes, cost)
    return []
```

- **Expected:** the three paths and costs above, in order.
- **Evaluation:** correct ordering, dedup, dead-end handling.

---

## Intermediate Tasks (5)

### Task 6 — Full Yen with deduplication

**Problem.** Implement complete Yen's algorithm that returns up to `K` shortest loopless paths, deduplicating candidates so no path appears twice in `A` or `B`.

**Constraints.** `O(K · V · (E + V log V))`. Use a `seen` set keyed on the path.

**Hint.** Dedup *on push*: only `heappush` a candidate if its key isn't in `seen`.

#### Go

```go
func yenDedup(g map[string]map[string]int, s, t string, k int) [][]string {
	// implement full algorithm with a seen-set
	return nil
}
```

#### Java

```java
static List<List<String>> yenDedup(Map<String, Map<String, Integer>> g,
                                    String s, String t, int k) {
    // implement
    return new ArrayList<>();
}
```

#### Python

```python
def yen_dedup(g, s, t, k):
    # implement full algorithm with a seen-set
    return []
```

- **Constraints:** verify no duplicate paths; return fewer than K when fewer exist.
- **Evaluation:** correctness on graphs with multiple equal-cost paths.

---

### Task 7 — Lawler's deviation-index optimization

**Problem.** Extend Task 6 to store a **deviation index** per accepted path and start spur generation from that index, skipping redundant spur nodes.

**Constraints.** Output must be identical to plain Yen; only fewer Dijkstra calls.

**Hint.** Store `(cost, nodes, devIdx)`. For the latest path, iterate spur indices `devIdx .. len-2`.

#### Go

```go
type Cand struct {
	Cost  int
	Nodes []string
	Dev   int
}

func yenLawler(g map[string]map[string]int, s, t string, k int) []Cand {
	// implement
	return nil
}
```

#### Java

```java
record Cand(int cost, List<String> nodes, int dev) {}

static List<Cand> yenLawler(Map<String, Map<String, Integer>> g, String s, String t, int k) {
    return new ArrayList<>();
}
```

#### Python

```python
def yen_lawler(g, s, t, k):
    # store (cost, nodes, dev_index); start spurs at dev_index
    return []
```

- **Constraints:** compare spur-Dijkstra counts with/without Lawler on a graph with long shared prefixes.
- **Evaluation:** same output, measurably fewer spur calls.

---

### Task 8 — K shortest with a cost ceiling

**Problem.** Return all loopless paths within a factor `(1 + ε)` of the shortest path's cost (instead of a fixed `K`). Stop early when the heap minimum exceeds the ceiling.

**Constraints.** Use the nondecreasing-order property to terminate.

**Hint.** Ceiling = `cost(A[0]) * (1 + eps)`. Stop when `peek(B).cost > ceiling`.

#### Go

```go
func yenCeiling(g map[string]map[string]int, s, t string, eps float64) [][]string {
	// implement
	return nil
}
```

#### Java

```java
static List<List<String>> yenCeiling(Map<String, Map<String, Integer>> g,
                                      String s, String t, double eps) {
    return new ArrayList<>();
}
```

#### Python

```python
def yen_ceiling(g, s, t, eps):
    # stop when heap-min exceeds cost(A[0]) * (1 + eps)
    return []
```

- **Constraints:** must not compute candidates beyond the ceiling.
- **Evaluation:** correct early termination, returns exactly the within-ceiling paths.

---

### Task 9 — Return paths, not just costs

**Problem.** Modify your Yen to return both the **vertex sequence** and the **cost** of each of the K paths, formatted as `C -> E -> F -> H (cost 5)`.

**Constraints.** Reconstruct paths from the candidate structure, not from a separate run.

**Hint.** Store the full node list with each accepted entry; format on output.

#### Go

```go
func yenWithPaths(g map[string]map[string]int, s, t string, k int) []string {
	// return formatted strings
	return nil
}
```

#### Java

```java
static List<String> yenWithPaths(Map<String, Map<String, Integer>> g,
                                 String s, String t, int k) {
    return new ArrayList<>();
}
```

#### Python

```python
def yen_with_paths(g, s, t, k):
    # return ["C -> E -> F -> H (cost 5)", ...]
    return []
```

- **Expected:** formatted route strings in nondecreasing cost order.
- **Evaluation:** correct reconstruction and formatting.

---

### Task 10 — Handle the zero-weight cycle corner case

**Problem.** On a graph containing a zero-weight cycle through a potential spur node, ensure your Yen never emits a non-simple path. Add the spur-node re-entry guard (settle the spur node at distance 0, forbid returning to it).

**Constraints.** Test on a graph with edges `A→B 0, B→A 0` on a root path.

**Hint.** During a spur search from `v`, also remove incoming edges to `v` (or mark `v` settled and never relax into it).

#### Go

```go
func dijkstraGuarded(g map[string]map[string]int, spur, t string,
	remE map[[2]string]bool, remN map[string]bool) ([]string, int, bool) {
	// forbid re-entering spur node
	return nil, 0, false
}
```

#### Java

```java
static int[] dijkstraGuarded(Map<String, Map<String, Integer>> g, String spur, String t,
                             Set<String> remE, Set<String> remN, List<String> outPath) {
    // forbid re-entering spur node
    return null;
}
```

#### Python

```python
def dijkstra_guarded(g, spur, t, rem_e=frozenset(), rem_n=frozenset()):
    # forbid re-entering the spur node even at zero cost
    pass
```

- **Constraints:** every returned path must be simple.
- **Evaluation:** correctly rejects the zero-cycle loop.

---

## Advanced Tasks (5)

### Task 11 — Diverse K paths (greedy dissimilarity)

**Problem.** Over-fetch `3K` exact paths with Yen, then greedily select `K` whose pairwise **edge Jaccard overlap** stays below a threshold (e.g. 0.6), preserving cheapest-first order.

**Constraints.** Output is the K-cheapest-subject-to-diversity, not the exact K-cheapest.

**Hint.** Compute edge sets `set(zip(p, p[1:]))`; skip a candidate too similar to any already-chosen.

#### Go

```go
func diverseK(g map[string]map[string]int, s, t string, k int, maxOverlap float64) [][]string {
	// implement over-fetch + greedy select
	return nil
}
```

#### Java

```java
static List<List<String>> diverseK(Map<String, Map<String, Integer>> g,
                                    String s, String t, int k, double maxOverlap) {
    return new ArrayList<>();
}
```

#### Python

```python
def diverse_k(g, s, t, k, max_overlap=0.6):
    # over-fetch 3k, greedily select k by Jaccard dissimilarity
    return []
```

- **Evaluation:** returned paths are genuinely different; still cheapest-first within the diverse set.

---

### Task 12 — Yen on an undirected graph

**Problem.** Adapt Yen to undirected weighted graphs (each edge usable both directions) and verify all results are loopless.

**Constraints.** Represent each undirected edge `{u,v,w}` as two directed edges.

**Hint.** Build the directed adjacency from undirected input; the rest of Yen is unchanged.

#### Go

```go
func buildUndirected(edges [][3]interface{}) map[string]map[string]int {
	// add both directions
	return nil
}
```

#### Java

```java
static Map<String, Map<String, Integer>> buildUndirected(List<Object[]> edges) {
    return new HashMap<>();
}
```

#### Python

```python
def build_undirected(edges):
    # edges: list of (u, v, w); add both directions
    g = {}
    return g
```

- **Evaluation:** correct K loopless paths; no path revisits a vertex.

---

### Task 13 — Parallel spur computation

**Problem.** Parallelize the spur Dijkstras *within* one iteration across worker threads, merging candidates into a single guarded heap, while keeping the cross-iteration order correct.

**Constraints.** The graph is read-only; guard only `B` and the `seen` set.

**Hint.** Fan out spur jobs (map), collect candidates, merge under a lock (reduce), then pop the next accepted path.

#### Go

```go
import "sync"

func yenParallel(g map[string]map[string]int, s, t string, k int) [][]string {
	var mu sync.Mutex
	var wg sync.WaitGroup
	_ = mu
	_ = wg
	// fan out spurs per iteration
	return nil
}
```

#### Java

```java
import java.util.concurrent.*;

static List<List<String>> yenParallel(Map<String, Map<String, Integer>> g,
                                      String s, String t, int k) throws Exception {
    // use an ExecutorService for spur jobs
    return new ArrayList<>();
}
```

#### Python

```python
from concurrent.futures import ThreadPoolExecutor


def yen_parallel(g, s, t, k, workers=8):
    # fan out spur jobs per iteration, merge into a guarded heap
    return []
```

- **Evaluation:** identical output to serial Yen; correct synchronization, no data races.

---

### Task 14 — Compare Yen vs Eppstein on a DAG

**Problem.** On a directed acyclic graph, implement both Yen and a simple Eppstein-style k-best (loops impossible on a DAG, so both give loopless paths) and compare their running time for increasing `K`.

**Constraints.** Demonstrate Eppstein's near-linear-in-K advantage.

**Hint.** On a DAG, you can compute `dist(v, t)` for all `v` by reverse topological DP, then enumerate sidetracks. Yen is your baseline.

#### Go

```go
func benchYenVsEppstein(dag map[string]map[string]int, s, t string, ks []int) {
	// time both for each K and print
}
```

#### Java

```java
static void benchYenVsEppstein(Map<String, Map<String, Integer>> dag,
                               String s, String t, int[] ks) {
    // time both for each K
}
```

#### Python

```python
def bench_yen_vs_eppstein(dag, s, t, ks):
    # time both for each K and print
    pass
```

- **Evaluation:** correct results from both; clear demonstration of the complexity gap as K grows.

---

### Task 15 — Constrained KSP (hop limit)

**Problem.** Find the K shortest loopless paths whose length is at most `L` hops. Filter candidates exceeding the hop limit before accepting.

**Constraints.** A path with `> L` edges is rejected (not merely deprioritized).

**Hint.** Either bound the spur Dijkstra's depth, or reject over-long totals before pushing into `B`. Discuss why a *cost* budget on a second metric would instead be NP-hard.

#### Go

```go
func yenHopLimited(g map[string]map[string]int, s, t string, k, maxHops int) [][]string {
	// reject paths exceeding maxHops
	return nil
}
```

#### Java

```java
static List<List<String>> yenHopLimited(Map<String, Map<String, Integer>> g,
                                        String s, String t, int k, int maxHops) {
    return new ArrayList<>();
}
```

#### Python

```python
def yen_hop_limited(g, s, t, k, max_hops):
    # reject candidates with more than max_hops edges
    return []
```

- **Evaluation:** all returned paths respect the hop limit; correct K-best among them.

---

## Benchmark Task

> Compare Yen's running time across all 3 languages as `K` and graph size grow.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func makeGraph(n, deg int) map[string]map[string]int {
	g := map[string]map[string]int{}
	for u := 0; u < n; u++ {
		key := fmt.Sprintf("%d", u)
		g[key] = map[string]int{}
		for d := 0; d < deg; d++ {
			v := rand.Intn(n)
			if v != u {
				g[key][fmt.Sprintf("%d", v)] = rand.Intn(9) + 1
			}
		}
	}
	return g
}

func main() {
	for _, n := range []int{100, 500, 1000} {
		g := makeGraph(n, 4)
		start := time.Now()
		// yenDedup(g, "0", fmt.Sprintf("%d", n-1), 10)
		_ = g
		fmt.Printf("n=%5d K=10: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        Random rnd = new Random();
        for (int n : new int[]{100, 500, 1000}) {
            Map<String, Map<String, Integer>> g = new HashMap<>();
            for (int u = 0; u < n; u++) {
                Map<String, Integer> adj = new HashMap<>();
                for (int d = 0; d < 4; d++) {
                    int v = rnd.nextInt(n);
                    if (v != u) adj.put(String.valueOf(v), rnd.nextInt(9) + 1);
                }
                g.put(String.valueOf(u), adj);
            }
            long start = System.nanoTime();
            // yenDedup(g, "0", String.valueOf(n - 1), 10);
            System.out.printf("n=%5d K=10: %.3f ms%n", n, (System.nanoTime() - start) / 1e6);
        }
    }
}
```

#### Python

```python
import random
import time


def make_graph(n, deg):
    g = {}
    for u in range(n):
        g[str(u)] = {}
        for _ in range(deg):
            v = random.randrange(n)
            if v != u:
                g[str(u)][str(v)] = random.randint(1, 9)
    return g


for n in (100, 500, 1000):
    g = make_graph(n, 4)
    start = time.perf_counter()
    # yen_dedup(g, "0", str(n - 1), 10)
    print(f"n={n:>5} K=10: {(time.perf_counter() - start) * 1000:.3f} ms")
```

- **Goal:** observe the `K·V·(E + V log V)` scaling; note where pure Python lags Go/Java and where Lawler's optimization helps.
