# Stoer-Wagner Global Minimum Cut — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages. The graph is always **undirected** with **non-negative** weights; the matrix is symmetric with a zero diagonal.

---

## Beginner Tasks (5)

### Task 1 — Build a symmetric adjacency matrix

**Problem.** Read `n` and `m`, then `m` undirected weighted edges `u v w`. Build the `n × n` symmetric weight matrix, summing parallel edges and ignoring self-loops. Print the matrix.

**Constraints.** `2 ≤ n ≤ 200`, `0 ≤ w ≤ 10⁶`.

**Hint.** For each edge set `w[u][v] += w` and `w[v][u] += w`; skip when `u == v`.

#### Go

```go
package main

import "fmt"

func buildMatrix(n int, edges [][3]int) [][]int {
	w := make([][]int, n)
	for i := range w {
		w[i] = make([]int, n)
	}
	for _, e := range edges {
		u, v, c := e[0], e[1], e[2]
		if u != v {
			w[u][v] += c
			w[v][u] += c
		}
	}
	return w
}

func main() {
	m := buildMatrix(3, [][3]int{{0, 1, 2}, {0, 1, 3}, {1, 2, 4}})
	fmt.Println(m) // [[0 5 0] [5 0 4] [0 4 0]]
}
```

#### Java

```java
public class Task1 {
    static int[][] buildMatrix(int n, int[][] edges) {
        int[][] w = new int[n][n];
        for (int[] e : edges)
            if (e[0] != e[1]) { w[e[0]][e[1]] += e[2]; w[e[1]][e[0]] += e[2]; }
        return w;
    }

    public static void main(String[] args) {
        int[][] w = buildMatrix(3, new int[][]{{0,1,2},{0,1,3},{1,2,4}});
        System.out.println(java.util.Arrays.deepToString(w));
    }
}
```

#### Python

```python
def build_matrix(n, edges):
    w = [[0] * n for _ in range(n)]
    for u, v, c in edges:
        if u != v:
            w[u][v] += c
            w[v][u] += c
    return w


if __name__ == "__main__":
    print(build_matrix(3, [(0, 1, 2), (0, 1, 3), (1, 2, 4)]))
```

---

### Task 2 — Weighted degree of every vertex

**Problem.** Given the symmetric matrix, print each vertex's weighted degree (sum of its row), and the minimum weighted degree (a valid upper bound on the global min cut).

**Constraints.** `2 ≤ n ≤ 200`.

**Hint.** The min weighted degree is a free upper bound; seed `best` with it later.

#### Go

```go
func weightedDegrees(w [][]int) (degs []int, minDeg int) {
	minDeg = 1 << 60
	for _, row := range w {
		d := 0
		for _, x := range row {
			d += x
		}
		degs = append(degs, d)
		if d < minDeg {
			minDeg = d
		}
	}
	return
}
```

#### Java

```java
static int[] weightedDegrees(int[][] w) {
    int n = w.length, min = Integer.MAX_VALUE;
    int[] degs = new int[n];
    for (int i = 0; i < n; i++) {
        int d = 0;
        for (int x : w[i]) d += x;
        degs[i] = d;
        min = Math.min(min, d);
    }
    System.out.println("min weighted degree = " + min);
    return degs;
}
```

#### Python

```python
def weighted_degrees(w):
    degs = [sum(row) for row in w]
    return degs, min(degs)
```

---

### Task 3 — One minimum cut phase

**Problem.** Implement a single minimum cut phase on the full matrix (no merging yet). Return the maximum-adjacency order, the pair `(s, t)`, and the cut-of-the-phase weight.

**Constraints.** `2 ≤ n ≤ 200`.

**Hint.** Grow `A` from vertex 0; each step pick the un-added vertex with the largest `key`, then add `w[sel][v]` to every remaining `key[v]`.

#### Go

```go
func phase(n int, w [][]int) (order []int, s, t, cut int) {
	inA := make([]bool, n)
	key := make([]int, n)
	for added := 0; added < n; added++ {
		sel := -1
		for v := 0; v < n; v++ {
			if !inA[v] && (sel == -1 || key[v] > key[sel]) {
				sel = v
			}
		}
		inA[sel] = true
		order = append(order, sel)
		for v := 0; v < n; v++ {
			if !inA[v] {
				key[v] += w[sel][v]
			}
		}
	}
	t = order[len(order)-1]
	s = order[len(order)-2]
	cut = key[t]
	return
}
```

#### Java

```java
static int[] phase(int n, int[][] w) {
    boolean[] inA = new boolean[n];
    int[] key = new int[n];
    int[] order = new int[n];
    int idx = 0;
    for (int added = 0; added < n; added++) {
        int sel = -1;
        for (int v = 0; v < n; v++)
            if (!inA[v] && (sel == -1 || key[v] > key[sel])) sel = v;
        inA[sel] = true;
        order[idx++] = sel;
        for (int v = 0; v < n; v++) if (!inA[v]) key[v] += w[sel][v];
    }
    int t = order[n - 1], s = order[n - 2];
    return new int[]{s, t, key[t]}; // s, t, cut-of-phase
}
```

#### Python

```python
def phase(n, w):
    in_a = [False] * n
    key = [0] * n
    order = []
    for _ in range(n):
        sel = -1
        for v in range(n):
            if not in_a[v] and (sel == -1 or key[v] > key[sel]):
                sel = v
        in_a[sel] = True
        order.append(sel)
        for v in range(n):
            if not in_a[v]:
                key[v] += w[sel][v]
    t, s = order[-1], order[-2]
    return order, s, t, key[t]
```

---

### Task 4 — Full global min cut (weight only)

**Problem.** Combine phase + merge into the full `O(V³)` Stoer-Wagner. Return only the global min cut weight.

**Constraints.** `2 ≤ n ≤ 300`.

**Hint.** Use a `merged[]` flag; after each phase merge the last vertex into the second-to-last by adding rows/columns.

#### Go

```go
func globalMinCut(n int, w [][]int) int {
	merged := make([]bool, n)
	best := 1 << 60
	for phase := 0; phase < n-1; phase++ {
		inA := make([]bool, n)
		key := make([]int, n)
		prev, last := -1, -1
		active := 0
		for i := 0; i < n; i++ {
			if !merged[i] {
				active++
			}
		}
		for added := 0; added < active; added++ {
			sel := -1
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel]) {
					sel = v
				}
			}
			inA[sel] = true
			prev, last = last, sel
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] {
					key[v] += w[sel][v]
				}
			}
		}
		if key[last] < best {
			best = key[last]
		}
		merged[last] = true
		for v := 0; v < n; v++ {
			if !merged[v] {
				w[prev][v] += w[last][v]
				w[v][prev] += w[v][last]
			}
		}
	}
	return best
}
```

#### Java

```java
static int globalMinCut(int n, int[][] w) {
    boolean[] merged = new boolean[n];
    int best = Integer.MAX_VALUE;
    for (int phase = 0; phase < n - 1; phase++) {
        boolean[] inA = new boolean[n];
        int[] key = new int[n];
        int prev = -1, last = -1, active = 0;
        for (int i = 0; i < n; i++) if (!merged[i]) active++;
        for (int added = 0; added < active; added++) {
            int sel = -1;
            for (int v = 0; v < n; v++)
                if (!merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel])) sel = v;
            inA[sel] = true; prev = last; last = sel;
            for (int v = 0; v < n; v++) if (!merged[v] && !inA[v]) key[v] += w[sel][v];
        }
        best = Math.min(best, key[last]);
        merged[last] = true;
        for (int v = 0; v < n; v++)
            if (!merged[v]) { w[prev][v] += w[last][v]; w[v][prev] += w[v][last]; }
    }
    return best;
}
```

#### Python

```python
def global_min_cut(n, w):
    merged = [False] * n
    best = float("inf")
    for _ in range(n - 1):
        in_a = [False] * n
        key = [0] * n
        prev = last = -1
        active = sum(1 for i in range(n) if not merged[i])
        for _ in range(active):
            sel = -1
            for v in range(n):
                if not merged[v] and not in_a[v] and (sel == -1 or key[v] > key[sel]):
                    sel = v
            in_a[sel] = True
            prev, last = last, sel
            for v in range(n):
                if not merged[v] and not in_a[v]:
                    key[v] += w[sel][v]
        best = min(best, key[last])
        merged[last] = True
        for v in range(n):
            if not merged[v]:
                w[prev][v] += w[last][v]
                w[v][prev] += w[v][last]
    return best
```

---

### Task 5 — Validate against brute force

**Problem.** Write a brute-force `O(2^n)` min cut (try every non-empty proper subset) and assert it equals Stoer-Wagner on random graphs with `n ≤ 10`.

**Constraints.** `2 ≤ n ≤ 10`, weights `0..9`.

**Hint.** A subset `S` defines cut weight `Σ_{u∈S, v∉S} w[u][v]`.

#### Go

```go
func bruteForce(n int, w [][]int) int {
	best := 1 << 60
	for mask := 1; mask < (1<<n)-1; mask++ {
		cut := 0
		for u := 0; u < n; u++ {
			for v := 0; v < n; v++ {
				if (mask>>u)&1 == 1 && (mask>>v)&1 == 0 {
					cut += w[u][v]
				}
			}
		}
		if cut < best {
			best = cut
		}
	}
	return best
}
```

#### Java

```java
static int bruteForce(int n, int[][] w) {
    int best = Integer.MAX_VALUE;
    for (int mask = 1; mask < (1 << n) - 1; mask++) {
        int cut = 0;
        for (int u = 0; u < n; u++)
            for (int v = 0; v < n; v++)
                if (((mask >> u) & 1) == 1 && ((mask >> v) & 1) == 0) cut += w[u][v];
        best = Math.min(best, cut);
    }
    return best;
}
```

#### Python

```python
def brute_force(n, w):
    best = float("inf")
    for mask in range(1, (1 << n) - 1):
        cut = sum(
            w[u][v]
            for u in range(n)
            for v in range(n)
            if (mask >> u) & 1 and not (mask >> v) & 1
        )
        best = min(best, cut)
    return best
```

---

## Intermediate Tasks (5)

### Task 6 — Recover the partition

**Problem.** Extend the full algorithm to also return one side of the partition achieving the global min cut.

**Constraints.** `2 ≤ n ≤ 300`.

**Hint.** Keep `groups[v]` (original vertices fused into super-vertex `v`). On a new best, snapshot `groups[last]`. On merge, append `groups[last]` to `groups[prev]`.

#### Go

```go
func minCutWithSide(n int, w [][]int) (int, []int) {
	merged := make([]bool, n)
	groups := make([][]int, n)
	for i := range groups {
		groups[i] = []int{i}
	}
	best := 1 << 60
	var side []int
	for phase := 0; phase < n-1; phase++ {
		inA := make([]bool, n)
		key := make([]int, n)
		prev, last := -1, -1
		active := 0
		for i := 0; i < n; i++ {
			if !merged[i] {
				active++
			}
		}
		for added := 0; added < active; added++ {
			sel := -1
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel]) {
					sel = v
				}
			}
			inA[sel] = true
			prev, last = last, sel
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] {
					key[v] += w[sel][v]
				}
			}
		}
		if key[last] < best {
			best = key[last]
			side = append([]int(nil), groups[last]...)
		}
		merged[last] = true
		groups[prev] = append(groups[prev], groups[last]...)
		for v := 0; v < n; v++ {
			if !merged[v] {
				w[prev][v] += w[last][v]
				w[v][prev] += w[v][last]
			}
		}
	}
	return best, side
}
```

#### Java

```java
static Object[] minCutWithSide(int n, int[][] w) {
    boolean[] merged = new boolean[n];
    java.util.List<java.util.List<Integer>> groups = new java.util.ArrayList<>();
    for (int i = 0; i < n; i++) groups.add(new java.util.ArrayList<>(java.util.List.of(i)));
    int best = Integer.MAX_VALUE;
    java.util.List<Integer> side = new java.util.ArrayList<>();
    for (int phase = 0; phase < n - 1; phase++) {
        boolean[] inA = new boolean[n];
        int[] key = new int[n];
        int prev = -1, last = -1, active = 0;
        for (int i = 0; i < n; i++) if (!merged[i]) active++;
        for (int added = 0; added < active; added++) {
            int sel = -1;
            for (int v = 0; v < n; v++)
                if (!merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel])) sel = v;
            inA[sel] = true; prev = last; last = sel;
            for (int v = 0; v < n; v++) if (!merged[v] && !inA[v]) key[v] += w[sel][v];
        }
        if (key[last] < best) { best = key[last]; side = new java.util.ArrayList<>(groups.get(last)); }
        merged[last] = true;
        groups.get(prev).addAll(groups.get(last));
        for (int v = 0; v < n; v++)
            if (!merged[v]) { w[prev][v] += w[last][v]; w[v][prev] += w[v][last]; }
    }
    return new Object[]{best, side};
}
```

#### Python

```python
def min_cut_with_side(n, w):
    merged = [False] * n
    groups = [{i} for i in range(n)]
    best, side = float("inf"), set()
    for _ in range(n - 1):
        in_a = [False] * n
        key = [0] * n
        prev = last = -1
        active = sum(1 for i in range(n) if not merged[i])
        for _ in range(active):
            sel = -1
            for v in range(n):
                if not merged[v] and not in_a[v] and (sel == -1 or key[v] > key[sel]):
                    sel = v
            in_a[sel] = True
            prev, last = last, sel
            for v in range(n):
                if not merged[v] and not in_a[v]:
                    key[v] += w[sel][v]
        if key[last] < best:
            best, side = key[last], set(groups[last])
        merged[last] = True
        groups[prev] |= groups[last]
        for v in range(n):
            if not merged[v]:
                w[prev][v] += w[last][v]
                w[v][prev] += w[v][last]
    return best, side
```

---

### Task 7 — Edge connectivity of an unweighted graph

**Problem.** Given an unweighted undirected graph, compute its edge connectivity `λ(G)` (min edges to disconnect).

**Constraints.** `2 ≤ n ≤ 300`.

**Hint.** Set every existing edge weight to `1` and run global min cut.

#### Go

```go
func edgeConnectivity(n int, edges [][2]int) int {
	w := make([][]int, n)
	for i := range w {
		w[i] = make([]int, n)
	}
	for _, e := range edges {
		w[e[0]][e[1]] = 1
		w[e[1]][e[0]] = 1
	}
	return globalMinCut(n, w)
}
```

#### Java

```java
static int edgeConnectivity(int n, int[][] edges) {
    int[][] w = new int[n][n];
    for (int[] e : edges) { w[e[0]][e[1]] = 1; w[e[1]][e[0]] = 1; }
    return globalMinCut(n, w);
}
```

#### Python

```python
def edge_connectivity(n, edges):
    w = [[0] * n for _ in range(n)]
    for u, v in edges:
        w[u][v] = w[v][u] = 1
    return global_min_cut(n, w)
```

---

### Task 8 — Seed with minimum weighted degree

**Problem.** Modify the full algorithm to seed `best` with the minimum weighted degree before any phase runs. Confirm the result is unchanged on random graphs.

**Constraints.** `2 ≤ n ≤ 300`.

**Hint.** `best = min over i of sum(w[i])`; the algorithm can only improve from there.

#### Go

```go
func minCutSeeded(n int, w [][]int) int {
	best := 1 << 60
	for i := 0; i < n; i++ {
		d := 0
		for j := 0; j < n; j++ {
			d += w[i][j]
		}
		if d < best {
			best = d
		}
	}
	// ... then run the standard phases, keeping `best`
	return globalMinCutFrom(n, w, best)
}
```

#### Java

```java
static int minCutSeeded(int n, int[][] w) {
    int best = Integer.MAX_VALUE;
    for (int i = 0; i < n; i++) {
        int d = 0;
        for (int x : w[i]) d += x;
        best = Math.min(best, d);
    }
    return globalMinCutFrom(n, w, best); // phases keep refining `best`
}
```

#### Python

```python
def min_cut_seeded(n, w):
    best = min(sum(row) for row in w)
    return global_min_cut_from(n, w, best)  # phases refine `best`
```

---

### Task 9 — Most reliable bottleneck report

**Problem.** Given a network with link capacities, report the global min cut weight (its reliability) and which links cross the cut.

**Constraints.** `2 ≤ n ≤ 300`.

**Hint.** Recover the partition (Task 6); a link `(u, v)` crosses if exactly one endpoint is in the recovered side.

#### Go

```go
func crossingLinks(side []int, n int, edges [][3]int) [][3]int {
	in := make([]bool, n)
	for _, v := range side {
		in[v] = true
	}
	var cross [][3]int
	for _, e := range edges {
		if in[e[0]] != in[e[1]] {
			cross = append(cross, e)
		}
	}
	return cross
}
```

#### Java

```java
static java.util.List<int[]> crossingLinks(java.util.Set<Integer> side, int[][] edges) {
    java.util.List<int[]> cross = new java.util.ArrayList<>();
    for (int[] e : edges)
        if (side.contains(e[0]) != side.contains(e[1])) cross.add(e);
    return cross;
}
```

#### Python

```python
def crossing_links(side, edges):
    s = set(side)
    return [e for e in edges if (e[0] in s) != (e[1] in s)]
```

---

### Task 10 — Heap-based phase for sparse graphs

**Problem.** Implement the minimum cut phase using a max-priority-queue keyed on `w(A, v)` with lazy deletion, for a graph given as adjacency lists.

**Constraints.** `2 ≤ n ≤ 2000`, sparse.

**Hint.** Push `(key, v)`; on pop, skip if already in `A` or if the popped key is stale.

#### Go

```go
// See middle.md for the full maxHeap definition; this is the phase body.
// minCutPhaseHeap(alive, adj) returns (cutWeight, s, t).
```

#### Java

```java
// See middle.md HeapPhase.minCutPhase(alive, adj) → {cut, s, t}.
```

#### Python

```python
import heapq


def min_cut_phase_heap(alive, adj):
    key = {v: 0 for v in alive}
    in_a = set()
    heap = [(0, v) for v in alive]
    heapq.heapify(heap)
    order = []
    while heap:
        neg_k, v = heapq.heappop(heap)
        if v in in_a or -neg_k != key[v]:
            continue
        in_a.add(v)
        order.append(v)
        for u, c in adj.get(v, []):
            if u not in in_a:
                key[u] += c
                heapq.heappush(heap, (-key[u], u))
    return key[order[-1]], order[-2], order[-1]
```

---

## Advanced Tasks (5)

### Task 11 — Recursive min-cut clustering into k clusters

**Problem.** Use global min cut as a subroutine to bisect a graph recursively until you have `k` clusters (cut whichever current cluster has the cheapest internal min cut next).

**Constraints.** `2 ≤ n ≤ 300`, `2 ≤ k ≤ n`.

**Hint.** Maintain a priority queue of clusters keyed by their min-cut weight; pop the cheapest, split it, push the two halves; stop at `k` clusters.

#### Go

```go
// Pseudostructure: maintain []cluster; repeatedly pick the cluster whose
// internal global min cut is smallest, split it via minCutWithSide, until k clusters.
```

#### Java

```java
// Use a PriorityQueue<Cluster> ordered by internal min-cut weight; split until size == k.
```

#### Python

```python
import heapq


def recursive_cluster(n, w, k):
    def submatrix(verts):
        idx = {v: i for i, v in enumerate(verts)}
        m = len(verts)
        sw = [[0] * m for _ in range(m)]
        for a in verts:
            for b in verts:
                sw[idx[a]][idx[b]] = w[a][b]
        return sw

    clusters = [list(range(n))]
    # priority by internal min cut (smaller = easier to split)
    while len(clusters) < k:
        # pick the most-splittable cluster of size > 1
        cand = [c for c in clusters if len(c) > 1]
        if not cand:
            break
        target = min(cand, key=lambda c: global_min_cut(len(c), submatrix(c)))
        sw = submatrix(target)
        _, side = min_cut_with_side(len(target), [row[:] for row in sw])
        side_global = {target[i] for i in side}
        a = [v for v in target if v in side_global]
        b = [v for v in target if v not in side_global]
        clusters.remove(target)
        clusters.extend([a, b])
    return clusters
```

---

### Task 12 — Find all minimum cuts (cactus-free brute check)

**Problem.** Enumerate every distinct global minimum cut (there can be several with equal weight) for small graphs and report how many there are.

**Constraints.** `2 ≤ n ≤ 14`.

**Hint.** Use the brute-force subset scan; collect all subsets whose cut weight equals the minimum (deduplicate `S` and its complement).

#### Go

```go
func allMinCuts(n int, w [][]int) [][]int {
	best := bruteForce(n, w)
	var cuts [][]int
	seen := map[int]bool{}
	for mask := 1; mask < (1<<n)-1; mask++ {
		if seen[mask] || seen[((1<<n)-1)^mask] {
			continue
		}
		cut := 0
		for u := 0; u < n; u++ {
			for v := 0; v < n; v++ {
				if (mask>>u)&1 == 1 && (mask>>v)&1 == 0 {
					cut += w[u][v]
				}
			}
		}
		if cut == best {
			var side []int
			for v := 0; v < n; v++ {
				if (mask>>v)&1 == 1 {
					side = append(side, v)
				}
			}
			cuts = append(cuts, side)
			seen[mask] = true
		}
	}
	return cuts
}
```

#### Java

```java
static java.util.List<int[]> allMinCuts(int n, int[][] w) {
    int best = bruteForce(n, w);
    java.util.List<int[]> cuts = new java.util.ArrayList<>();
    boolean[] seen = new boolean[1 << n];
    for (int mask = 1; mask < (1 << n) - 1; mask++) {
        if (seen[mask] || seen[((1 << n) - 1) ^ mask]) continue;
        int cut = 0;
        for (int u = 0; u < n; u++)
            for (int v = 0; v < n; v++)
                if (((mask >> u) & 1) == 1 && ((mask >> v) & 1) == 0) cut += w[u][v];
        if (cut == best) {
            java.util.List<Integer> side = new java.util.ArrayList<>();
            for (int v = 0; v < n; v++) if (((mask >> v) & 1) == 1) side.add(v);
            cuts.add(side.stream().mapToInt(Integer::intValue).toArray());
            seen[mask] = true;
        }
    }
    return cuts;
}
```

#### Python

```python
def all_min_cuts(n, w):
    best = brute_force(n, w)
    cuts, seen = [], set()
    full = (1 << n) - 1
    for mask in range(1, full):
        if mask in seen or (full ^ mask) in seen:
            continue
        cut = sum(
            w[u][v]
            for u in range(n)
            for v in range(n)
            if (mask >> u) & 1 and not (mask >> v) & 1
        )
        if cut == best:
            cuts.append([v for v in range(n) if (mask >> v) & 1])
            seen.add(mask)
    return cuts
```

---

### Task 13 — Compare Stoer-Wagner vs (V-1) max-flow

**Problem.** Implement the naive global-min-cut-via-max-flow (`V-1` runs from a fixed source) and verify both give the same answer; measure their runtimes.

**Constraints.** `2 ≤ n ≤ 60` (so the flow approach stays tractable).

**Hint.** Fix source `0`; for each sink `t`, compute the min `0-t` cut via max-flow on the undirected graph (each undirected edge becomes two directed arcs of capacity `w`). Take the minimum.

#### Go

```go
// flowGlobalMinCut: for t in 1..n-1, maxflow(0, t); return the min.
// Reuse any Dinic/Edmonds-Karp from 19-max-flow. Compare to globalMinCut(n, w).
```

#### Java

```java
// for (int t = 1; t < n; t++) best = min(best, maxFlow(0, t));  // compare with Stoer-Wagner
```

#### Python

```python
# def flow_global_min_cut(n, w):
#     return min(max_flow(0, t, n, w) for t in range(1, n))
# assert flow_global_min_cut(n, w) == global_min_cut(n, [r[:] for r in w])
```

---

### Task 14 — Robustness analysis: most critical edge

**Problem.** For each edge, compute how much the global min cut increases if that edge's weight is boosted (or how it drops if removed). Report the single most critical edge (largest impact on min cut).

**Constraints.** `2 ≤ n ≤ 120`.

**Hint.** Baseline = global min cut. For each edge, perturb its weight, recompute, restore. `O(E · V³)` — fine for small graphs.

#### Go

```go
func mostCriticalEdge(n int, w [][]int, edges [][3]int) ([3]int, int) {
	base := globalMinCut(n, copyMatrix(w))
	var bestEdge [3]int
	bestImpact := -1
	for _, e := range edges {
		u, v := e[0], e[1]
		tmp := copyMatrix(w)
		tmp[u][v], tmp[v][u] = 0, 0 // remove edge
		drop := base - globalMinCut(n, tmp)
		if drop > bestImpact {
			bestImpact = drop
			bestEdge = e
		}
	}
	return bestEdge, bestImpact
}
```

#### Java

```java
// For each edge: clone matrix, zero the edge, recompute global min cut, track largest drop.
```

#### Python

```python
def most_critical_edge(n, w, edges):
    import copy
    base = global_min_cut(n, copy.deepcopy(w))
    best_edge, best_drop = None, -1
    for (u, v, _) in edges:
        tmp = copy.deepcopy(w)
        tmp[u][v] = tmp[v][u] = 0
        drop = base - global_min_cut(n, tmp)
        if drop > best_drop:
            best_drop, best_edge = drop, (u, v)
    return best_edge, best_drop
```

---

### Task 15 — Benchmark array vs heap variants

**Problem.** Generate random graphs across densities and `V`, time the array and heap implementations, and report where the heap variant overtakes the array version.

**Constraints.** `V ∈ {50, 100, 200, 400}`, density `∈ {0.05, 0.3, 1.0}`.

**Hint.** Sparse + larger `V` favors the heap; dense favors the array (lower constant).

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{50, 100, 200, 400} {
		w := make([][]int, n)
		for i := range w {
			w[i] = make([]int, n)
		}
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				if rand.Float64() < 0.3 {
					x := rand.Intn(10) + 1
					w[i][j], w[j][i] = x, x
				}
			}
		}
		start := time.Now()
		globalMinCut(n, copyMatrix(w))
		fmt.Printf("array n=%4d: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        Random r = new Random(1);
        for (int n : new int[]{50, 100, 200, 400}) {
            int[][] w = new int[n][n];
            for (int i = 0; i < n; i++)
                for (int j = i + 1; j < n; j++)
                    if (r.nextDouble() < 0.3) {
                        int x = r.nextInt(10) + 1;
                        w[i][j] = w[j][i] = x;
                    }
            long s = System.nanoTime();
            // globalMinCut(n, clone(w));
            System.out.printf("array n=%4d: %.1f ms%n", n, (System.nanoTime() - s) / 1e6);
        }
    }
}
```

#### Python

```python
import random, time, copy

for n in [50, 100, 200, 400]:
    w = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if random.random() < 0.3:
                x = random.randint(1, 10)
                w[i][j] = w[j][i] = x
    s = time.perf_counter()
    global_min_cut(n, copy.deepcopy(w))
    print(f"array n={n:4d}: {(time.perf_counter()-s)*1000:.1f} ms")
```

---

## Benchmark Task

> Compare the array `O(V³)` Stoer-Wagner across all 3 languages on dense random graphs.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{50, 100, 200, 400} {
		w := make([][]int, n)
		for i := range w {
			w[i] = make([]int, n)
		}
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j++ {
				x := rand.Intn(10) + 1
				w[i][j], w[j][i] = x, x
			}
		}
		start := time.Now()
		globalMinCut(n, w)
		fmt.Printf("n=%4d: %v\n", n, time.Since(start))
	}
}
```

#### Java

```java
import java.util.Random;

public class Bench {
    public static void main(String[] args) {
        Random r = new Random(1);
        for (int n : new int[]{50, 100, 200, 400}) {
            int[][] w = new int[n][n];
            for (int i = 0; i < n; i++)
                for (int j = i + 1; j < n; j++) {
                    int x = r.nextInt(10) + 1;
                    w[i][j] = w[j][i] = x;
                }
            long s = System.nanoTime();
            Task4.globalMinCut(n, w);
            System.out.printf("n=%4d: %.1f ms%n", n, (System.nanoTime() - s) / 1e6);
        }
    }
}
```

#### Python

```python
import random, time

for n in [50, 100, 200, 400]:
    w = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            x = random.randint(1, 10)
            w[i][j] = w[j][i] = x
    s = time.perf_counter()
    global_min_cut(n, w)
    print(f"n={n:4d}: {(time.perf_counter()-s)*1000:.1f} ms")
```

Expect cubic scaling: doubling `n` multiplies time by ~8. Python will be markedly slower; vectorize the key update with NumPy for larger `n`.
