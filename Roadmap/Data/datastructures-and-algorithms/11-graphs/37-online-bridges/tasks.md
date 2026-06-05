# Online Bridge Finding (Incremental 2-Edge-Connectivity) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code in all three languages. Fill in the online-bridge logic and validate against the evaluation criteria. The gold standard for every correctness check is a **static Tarjan recomputation** (sibling 11-articulation-points-bridges) of the current edge set.

---

## Beginner Tasks (5)

### Task 1 — Connectivity DSU baseline

**Problem.** Before touching bridges, implement a plain Disjoint Set Union with `find` (path halving) and `union` (by size). Process `union u v` and `same u v` queries; print `YES`/`NO` for each `same`. This is the `cc` half of the online-bridge structure.

**Input / Output spec.**
- Operations: `union u v` or `same u v`.
- For each `same`, print `YES` if `u` and `v` are in one component else `NO`.

**Constraints.**
- `1 <= n <= 10^5`, up to `10^6` operations.
- Amortized `O(α(n))` per operation.

**Hint.** Path halving: `parent[x] = parent[parent[x]]`. Union by size: attach the smaller root under the larger.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type DSU struct{ p, sz []int }

func NewDSU(n int) *DSU {
	d := &DSU{p: make([]int, n), sz: make([]int, n)}
	for i := range d.p {
		d.p[i], d.sz[i] = i, 1
	}
	return d
}
func (d *DSU) Find(x int) int { /* TODO: path halving */ return x }
func (d *DSU) Union(a, b int)  { /* TODO: by size */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	d := NewDSU(n)
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		var u, v int
		fmt.Fscan(in, &u, &v)
		if op == "union" {
			d.Union(u, v)
		} else if d.Find(u) == d.Find(v) {
			fmt.Fprintln(out, "YES")
		} else {
			fmt.Fprintln(out, "NO")
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int[] p, sz;
    static int find(int x) { /* TODO: path halving */ return x; }
    static void union(int a, int b) { /* TODO: by size */ }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        p = new int[n]; sz = new int[n];
        for (int i = 0; i < n; i++) { p[i] = i; sz[i] = 1; }
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            StringTokenizer st = new StringTokenizer(line);
            String op = st.nextToken();
            int u = Integer.parseInt(st.nextToken()), v = Integer.parseInt(st.nextToken());
            if (op.equals("union")) union(u, v);
            else out.append(find(u) == find(v) ? "YES" : "NO").append('\n');
        }
        System.out.print(out);
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    p = list(range(n)); sz = [1] * n

    def find(x):
        # TODO: path halving
        return x

    def union(a, b):
        # TODO: by size
        pass

    out = []
    while idx < len(data):
        op = data[idx]; u = int(data[idx+1]); v = int(data[idx+2]); idx += 3
        if op == "union":
            union(u, v)
        else:
            out.append("YES" if find(u) == find(v) else "NO")
    print("\n".join(out))

main()
```

**Evaluation criteria.** Correct component answers; `O(α(n))` amortized; handles self-unions.

---

### Task 2 — Static bridge count (the baseline to test against)

**Problem.** Given a fixed undirected graph, count its bridges with a single DFS (Tarjan, sibling 11-articulation-points-bridges). You will reuse this as the ground truth for all later online tasks.

**Input / Output spec.** First line `n m`; then `m` lines `u v`. Output the number of bridges.

**Constraints.** `1 <= n <= 10^5`, `0 <= m <= 2·10^5`. Use an **iterative** DFS to avoid stack overflow.

**Hint.** Track `disc[]` and `low[]`. Edge `(node, child)` is a bridge iff `low[child] > disc[node]`. Skip the parent edge by edge-id, not by vertex (handles multi-edges).

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
	var n, m int
	fmt.Fscan(in, &n, &m)
	type E struct{ to, id int }
	adj := make([][]E, n)
	for i := 0; i < m; i++ {
		var u, v int
		fmt.Fscan(in, &u, &v)
		adj[u] = append(adj[u], E{v, i})
		adj[v] = append(adj[v], E{u, i})
	}
	// TODO: iterative DFS computing disc/low; count edges with low[child] > disc[node]
	count := 0
	fmt.Println(count)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task2 {
    public static void main(String[] args) throws IOException {
        // TODO: read graph, iterative DFS, count bridges via low[child] > disc[node]
    }
}
```

**Starter — Python.**
```python
import sys

def main():
    data = sys.stdin.buffer.read().split()
    idx = 0
    n = int(data[idx]); m = int(data[idx+1]); idx += 2
    adj = [[] for _ in range(n)]
    for i in range(m):
        u = int(data[idx]); v = int(data[idx+1]); idx += 2
        adj[u].append((v, i)); adj[v].append((u, i))
    # TODO: iterative DFS, count bridges
    print(0)

main()
```

**Evaluation criteria.** Matches a brute-force "remove each edge, recount components" check on small graphs; `O(n+m)`; iterative (no recursion limit issues).

---

### Task 3 — Online bridge count, three-case dispatch

**Problem.** Implement the full online structure: two DSUs (`cc`, `twoECC`), a bridge-forest parent array, and a running `bridges` counter. After each `add u v`, print the current bridge count.

**Input / Output spec.** First line `n`; then lines `add u v`. Print `bridges` after each addition.

**Constraints.** `1 <= n <= 2·10^5`, up to `5·10^5` additions.

**Hint.** Dispatch: same 2ECC → return; different component → new bridge (reroot smaller, `bridges += 1`); same component, different 2ECC → compress path to LCA (`bridges -= path_len`).

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type OB struct {
	cc, te, par, sz []int
	bridges         int
}

func NewOB(n int) *OB { /* TODO: init four arrays */ return &OB{} }
func (o *OB) fc(x int) int   { /* TODO */ return x }
func (o *OB) ft(x int) int   { /* TODO */ return x }
func (o *OB) par2(v int) int { /* TODO: ft(par[v]) or -1 */ return -1 }
func (o *OB) makeRoot(u int) { /* TODO: reverse parents */ }
func (o *OB) merge(u, v int) { /* TODO: LCA + compress */ }
func (o *OB) Add(u, v int)   { /* TODO: three cases */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n int
	fmt.Fscan(in, &n)
	o := NewOB(n)
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		var u, v int
		fmt.Fscan(in, &u, &v)
		o.Add(u, v)
		fmt.Fprintln(out, o.bridges)
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task3 {
    int[] cc, te, par, sz; int bridges = 0;
    Task3(int n) { /* TODO: init */ }
    int fc(int x) { /* TODO */ return x; }
    int ft(int x) { /* TODO */ return x; }
    int par2(int v) { /* TODO */ return -1; }
    void makeRoot(int u) { /* TODO */ }
    void merge(int u, int v) { /* TODO */ }
    void add(int u, int v) { /* TODO */ }

    public static void main(String[] a) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        Task3 o = new Task3(n);
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            StringTokenizer st = new StringTokenizer(line);
            st.nextToken();
            int u = Integer.parseInt(st.nextToken()), v = Integer.parseInt(st.nextToken());
            o.add(u, v);
            sb.append(o.bridges).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys

class OB:
    def __init__(self, n):
        pass  # TODO: cc, te, par, sz, bridges
    def fc(self, x): return x          # TODO
    def ft(self, x): return x          # TODO
    def par2(self, v): return -1       # TODO
    def make_root(self, u): pass       # TODO
    def merge(self, u, v): pass        # TODO
    def add(self, u, v): pass          # TODO

def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    o = OB(n); out = []
    while idx < len(data):
        # tokens: "add" u v
        u = int(data[idx+1]); v = int(data[idx+2]); idx += 3
        o.add(u, v); out.append(str(o.bridges))
    print("\n".join(out))

main()
```

**Evaluation criteria.** Output matches Task 2's static recomputation after every addition on random sequences. The walkthrough input `0 1 / 1 2 / 2 0 / 2 3 / 3 4 / 4 5 / 5 3` must produce `1 2 0 1 2 3 1`.

---

### Task 4 — Handle self-loops and duplicate edges

**Problem.** Extend Task 3 so that self-loops (`u == v`) and duplicate edges are handled correctly. A self-loop is never a bridge; a duplicate edge between two vertices already 2-edge-connected changes nothing; a duplicate parallel edge between two bridge-separated vertices closes a 2-cycle and removes that bridge.

**Input / Output spec.** Same as Task 3, but inputs may include `u == v` and repeated edges.

**Constraints.** Same as Task 3.

**Hint.** All three cases already handle these correctly *if* you check "same 2ECC?" first. A self-loop has `find_2ecc(u) == find_2ecc(v)` → Case A. A parallel edge across a bridge is Case C with a length-1 path.

**Starter — Go / Java / Python.** Reuse your Task 3 solution; add test inputs:
```text
3
add 0 0      # self-loop: bridges stays 0
add 0 1      # bridge: 1
add 0 1      # parallel edge: closes 2-cycle, bridge gone: 0
```

**Evaluation criteria.** The above produces `0 1 0`. Verified against static Tarjan (which must treat parallel edges by edge-id, not vertex).

---

### Task 5 — Count 2-edge-connected components online

**Problem.** After each addition, also output the number of 2-edge-connected components. Start at `n` (every vertex its own 2ECC); decrement once per contracted edge in Case C.

**Input / Output spec.** First line `n`; then `add u v` lines. After each, print `bridges num2ecc`.

**Constraints.** Same as Task 3.

**Hint.** Cases A and B never change `num2ecc`. In Case C, decrement `num2ecc` in the same loop where you decrement `bridges`.

**Starter — Python (Go/Java analogous).**
```python
class OB:
    def __init__(self, n):
        self.cc = list(range(n)); self.te = list(range(n))
        self.par = [-1]*n; self.sz = [1]*n
        self.bridges = 0
        self.num2ecc = n   # TODO: decrement in merge()
    # ... fc, ft, par2, make_root as before ...
    def merge(self, u, v):
        # TODO: in the compression loop, do both:
        #   self.bridges -= 1
        #   self.num2ecc -= 1
        pass
```

**Evaluation criteria.** Identity check: `bridges == num2ecc - num_components` at all times, where `num_components` is the count of distinct `find_cc` roots. Cross-check against static recomputation of both quantities.

---

## Intermediate Tasks (5)

### Task 6 — `is_bridge(u, v)` online query

**Problem.** Interleave `add u v` and `query u v`. For `query`, print whether the already-added edge `(u,v)` is currently a bridge.

**Constraints.** Queries only on added edges; `n, m` up to `2·10^5`.

**Hint.** Bridge iff different 2ECCs, same component, and forest-adjacent: `par2(ft(u)) == ft(v)` or `par2(ft(v)) == ft(u)`.

**Starter — Go.**
```go
func (o *OB) IsBridge(u, v int) bool {
	a, b := o.ft(u), o.ft(v)
	if a == b || o.fc(u) != o.fc(v) {
		return false
	}
	// TODO: return forest-adjacency test
	return false
}
```

**Starter — Java.**
```java
boolean isBridge(int u, int v) {
    int a = ft(u), b = ft(v);
    if (a == b || fc(u) != fc(v)) return false;
    return false; // TODO: forest-adjacency
}
```

**Starter — Python.**
```python
def is_bridge(self, u, v):
    a, b = self.ft(u), self.ft(v)
    if a == b or self.fc(u) != self.fc(v):
        return False
    return False  # TODO: forest-adjacency
```

**Evaluation criteria.** Matches static Tarjan's bridge set membership after each addition; `O(α(n))` per query.

---

### Task 7 — Largest 2-edge-connected component

**Problem.** After each addition, output the size of the largest 2ECC (number of vertices in the biggest 2-edge-connected group).

**Constraints.** `n, m` up to `2·10^5`.

**Hint.** Maintain a `size2ecc[]` array indexed by 2ECC root, updated when 2ECCs fuse in Case C, and a running `maxSize`. When folding a node into the LCA's 2ECC, add its size to the LCA's and update the max.

**Starter — Python (Go/Java analogous).**
```python
class OB:
    def __init__(self, n):
        # ... as before ...
        self.size2ecc = [1]*n
        self.max2ecc = 1
    def merge(self, u, v):
        # TODO: when self.te[ft(x)] = lca, do:
        #   self.size2ecc[lca] += self.size2ecc[ft(x)]   (read before reassigning rep)
        #   self.max2ecc = max(self.max2ecc, self.size2ecc[lca])
        pass
```

**Evaluation criteria.** Cross-check against grouping vertices by static 2ECC and taking the max group size.

---

### Task 8 — Depth-tracked LCA (avoid the visited set)

**Problem.** Replace the set-based LCA in `merge` with a depth-balanced two-pointer walk: lift the deeper 2ECC until depths match, then lift both until they meet. Maintain `depth[]` per 2ECC representative through `make_root`.

**Constraints.** `n, m` up to `5·10^5`; this version reduces constant factors and memory.

**Hint.** `make_root` reverses a path, so depths along it change; recompute them as you reverse. After linking in Case B, the rerooted tree's depths are re-based on the new root. Keep `depth[rep]` consistent with the forest.

**Starter — Go.**
```go
// Add o.depth []int. In par2-based LCA:
func (o *OB) lca(a, b int) int {
	for o.depth[a] > o.depth[b] {
		a = o.par2(a)
	}
	for o.depth[b] > o.depth[a] {
		b = o.par2(b)
	}
	for a != b {
		a = o.par2(a)
		b = o.par2(b)
	}
	return a
}
// TODO: maintain o.depth through makeRoot and linking.
```

**Starter — Java.**
```java
int lca(int a, int b) {
    while (depth[a] > depth[b]) a = par2(a);
    while (depth[b] > depth[a]) b = par2(b);
    while (a != b) { a = par2(a); b = par2(b); }
    return a;
    // TODO: maintain depth[] through makeRoot and linking
}
```

**Starter — Python.**
```python
def lca(self, a, b):
    while self.depth[a] > self.depth[b]: a = self.par2(a)
    while self.depth[b] > self.depth[a]: b = self.par2(b)
    while a != b:
        a = self.par2(a); b = self.par2(b)
    return a
    # TODO: maintain self.depth through make_root and linking
```

**Evaluation criteria.** Identical bridge counts to the set-based version on all random tests; lower memory and constant factor.

---

### Task 9 — Streaming fragility ratio

**Problem.** After each addition, output the bridge ratio `bridges / edges_added_so_far` as a fraction in lowest terms (or 0 if no edges). This is the "network fragility" signal from the senior file.

**Constraints.** `n, m` up to `2·10^5`. Count *all* added edges (including redundant ones) in the denominator.

**Hint.** Track a separate `edgeCount` incremented on every `add` regardless of case. Reduce the fraction with `gcd`.

**Starter — Python (Go/Java analogous).**
```python
from math import gcd

class OB:
    def __init__(self, n):
        # ... as before ...
        self.edge_count = 0
    def add(self, u, v):
        self.edge_count += 1   # count every add
        # ... existing three-case logic ...
    def ratio(self):
        if self.edge_count == 0:
            return "0/1"
        g = gcd(self.bridges, self.edge_count) or 1
        return f"{self.bridges // g}/{self.edge_count // g}"
```

**Evaluation criteria.** Denominator equals total adds; numerator matches static bridge count; fraction in lowest terms.

---

### Task 10 — Reconciliation harness

**Problem.** Build a test harness that, after every addition, compares the online bridge count against a static recomputation (Task 2) of the current live edge set, and reports the first mismatch (there should be none for additions-only). This is the property test from the interview file.

**Constraints.** Run on random graphs `n <= 8`, up to `15` random additions, `>= 1000` trials.

**Hint.** Keep a running list of added edges; after each `add`, call your static counter on that list and `assert online == static`.

**Starter — Python (Go/Java analogous).**
```python
import random

def static_count(n, edges):
    # reuse Task 2 iterative Tarjan
    ...

def harness():
    random.seed(1)
    for trial in range(2000):
        n = random.randint(2, 8)
        ob = OB(n); edges = []
        for _ in range(random.randint(0, 14)):
            u, v = random.randrange(n), random.randrange(n)
            if u == v:
                continue
            edges.append((u, v)); ob.add(u, v)
            assert ob.bridges == static_count(n, edges), (trial, edges)
    print("ALL TRIALS PASSED")

harness()
```

**Evaluation criteria.** Prints `ALL TRIALS PASSED`. Any assertion failure prints the offending edge sequence for debugging.

---

## Advanced Tasks (5)

### Task 11 — Minimum additions to make the graph bridge-free

**Problem.** Given the final graph built by the online structure, output the minimum number of *extra* edges to add so that the entire graph (within each connected component) becomes 2-edge-connected (zero bridges).

**Constraints.** `n, m` up to `2·10^5`.

**Hint.** Build the bridge forest, count leaves `L` in each tree (degree-1 2ECC nodes) and isolated 2ECC nodes; the classic answer to make a tree 2-edge-connected is `ceil(L / 2)`. Sum over trees; handle single-node trees. This connects to sibling 26-strong-orientation's tree-augmentation idea.

**Starter — Python (Go/Java analogous).**
```python
def min_augment(ob, n):
    # TODO:
    #  1. group vertices by find_2ecc into forest nodes
    #  2. build forest adjacency from par[] (through par2)
    #  3. per tree: count leaves L; contribution = ceil(L/2), with edge cases
    #  4. sum contributions
    return 0
```

**Evaluation criteria.** Matches brute force on small graphs (try all small edge sets that zero out the bridge count).

---

### Task 12 — Bridges within a query-time window

**Problem.** Process a mix of `add u v` and `count` operations. Each `count` reports the current bridge total. Then support a final batch of "what was the bridge count after the k-th addition?" queries. Store the count after each addition in an array for `O(1)` historical lookup.

**Constraints.** Up to `5·10^5` additions, `10^5` historical queries.

**Hint.** The online structure already produces the count after each addition; persist them in `history[]`. Historical queries are array reads.

**Starter — Go.**
```go
history := []int{}
// after each o.Add(u, v):
history = append(history, o.bridges)
// query k (1-indexed): answer = history[k-1]
```

**Starter — Java.**
```java
ArrayList<Integer> history = new ArrayList<>();
// after add: history.add(o.bridges);
// query k: history.get(k - 1)
```

**Starter — Python.**
```python
history = []
# after add: history.append(o.bridges)
# query k: history[k - 1]
```

**Evaluation criteria.** Historical answers match a static recomputation on the prefix of edges; queries `O(1)`.

---

### Task 13 — Component-sharded monitor

**Problem.** Implement the sharded design from the senior file: maintain one online-bridge structure per connected component cluster, with a global bridge total. Support `add u v` where a cross-cluster addition merges two shards (reroot the smaller, re-key under the larger). Report the global bridge count after each addition.

**Constraints.** `n, m` up to `2·10^5`. Cross-cluster joins should be `O(min cluster size)` amortized.

**Hint.** In the single-structure design, "shards" are just connected components and the merge is already Case B. The exercise is to expose a clean per-cluster API and a global aggregate, mirroring a real sidecar monitor. The global bridge total is just `ob.bridges`.

**Starter — Python (Go/Java analogous).**
```python
class Monitor:
    def __init__(self, n):
        self.ob = OB(n)   # one structure; clusters = connected components
    def add_link(self, u, v):
        self.ob.add(u, v)
        return self.ob.bridges  # global bridge total
    def cluster_of(self, v):
        return self.ob.fc(v)    # which component/cluster
    # TODO: expose per-cluster bridge counts by walking the forest per component
```

**Evaluation criteria.** Global count matches static Tarjan; `cluster_of` matches connected-component labeling.

---

### Task 14 — Stress test against static rebuild on large graphs

**Problem.** Generate large random graphs (`n = 10^5`, `m = 5·10^5`), run the online structure, and once at the end compare `ob.bridges` against a single static Tarjan run. Time both phases.

**Constraints.** Must finish in a few seconds; static comparison is run only once at the end (running it per-edge would be too slow).

**Hint.** Use fast I/O. Seed the RNG for reproducibility. Verify equality once; benchmark the online build separately.

**Starter — Python (Go/Java analogous).**
```python
import random, time

def stress(n=100_000, m=500_000, seed=42):
    random.seed(seed)
    ob = OB(n); edges = []
    t0 = time.perf_counter()
    for _ in range(m):
        u, v = random.randrange(n), random.randrange(n)
        if u != v:
            edges.append((u, v)); ob.add(u, v)
    t1 = time.perf_counter()
    assert ob.bridges == static_count(n, edges)
    t2 = time.perf_counter()
    print(f"online build: {t1-t0:.3f}s  static check: {t2-t1:.3f}s  bridges={ob.bridges}")

stress()
```

**Evaluation criteria.** Equality holds; the online build is dramatically faster than `m` static recomputations would be.

---

### Task 15 — Explain-and-implement: why deletions break it

**Problem.** Write a small program demonstrating that the additions-only structure is *wrong* if you naively allow deletion (e.g. by removing an edge from the underlying graph without un-merging 2ECCs). Add an edge to close a cycle (bridge count drops), then "delete" one cycle edge, and show the online count diverges from a fresh static recomputation. Then explain in a comment what a correct fully-dynamic structure would need.

**Constraints.** Small graphs; this is a correctness demonstration, not a performance task.

**Hint.** The online structure has no `remove`. Simulate a delete by recomputing static on the reduced edge set and comparing to the (now stale) online count. The divergence is the lesson.

**Starter — Python (Go/Java analogous).**
```python
def demo():
    ob = OB(3)
    ob.add(0, 1); ob.add(1, 2); ob.add(2, 0)  # triangle: online bridges == 0
    print("online (triangle):", ob.bridges)   # 0
    # "delete" edge (2,0): live edges now {(0,1),(1,2)} -> a path with 2 bridges
    live = [(0, 1), (1, 2)]
    print("static after delete:", static_count(3, live))  # 2
    print("online is now STALE (still 0); deletions require a fully dynamic structure")
    # A correct structure (Euler-tour / link-cut trees, Holm-de Lichtenberg-Thorup)
    # maintains a hierarchy of spanning forests so a 2ECC can SPLIT on deletion.

demo()
```

**Evaluation criteria.** Demonstrates the divergence (online `0`, static `2` after the simulated delete) and the comment correctly names the fully-dynamic alternative.

---

## Benchmark Task

### Benchmark — Online structure vs per-edge static rebuild

**Goal.** Empirically confirm the asymptotic gap: the online structure is near-linear total, while re-running static Tarjan after each addition is quadratic in `m`.

**Setup.** For `m ∈ {1000, 4000, 16000}` and `n = m`, build a random graph two ways:
1. **Online**: call `add` `m` times, reading `bridges` after each.
2. **Static-per-edge**: after each addition, run a full Tarjan recomputation on the prefix.

Measure wall-clock time for each. Confirm the online build scales ~linearly while static-per-edge scales ~quadratically.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, m := range []int{1000, 4000, 16000} {
		n := m
		rng := rand.New(rand.NewSource(1))
		edges := make([][2]int, 0, m)
		for i := 0; i < m; i++ {
			u, v := rng.Intn(n), rng.Intn(n)
			if u != v {
				edges = append(edges, [2]int{u, v})
			}
		}
		// online
		o := NewOB(n)
		t0 := time.Now()
		for _, e := range edges {
			o.Add(e[0], e[1])
			_ = o.bridges
		}
		onlineMs := time.Since(t0).Milliseconds()
		// static per edge (reuse Task 2 staticCount)
		t1 := time.Now()
		for i := range edges {
			_ = staticCount(n, edges[:i+1]) // TODO: implement staticCount
		}
		staticMs := time.Since(t1).Milliseconds()
		fmt.Printf("m=%d online=%dms staticPerEdge=%dms\n", m, onlineMs, staticMs)
	}
}
```

**Java.**
```java
public class Benchmark {
    public static void main(String[] args) {
        int[] ms = {1000, 4000, 16000};
        for (int m : ms) {
            int n = m;
            java.util.Random rng = new java.util.Random(1);
            java.util.List<int[]> edges = new java.util.ArrayList<>();
            for (int i = 0; i < m; i++) {
                int u = rng.nextInt(n), v = rng.nextInt(n);
                if (u != v) edges.add(new int[]{u, v});
            }
            Task3 o = new Task3(n);
            long t0 = System.nanoTime();
            for (int[] e : edges) { o.add(e[0], e[1]); }
            long onlineMs = (System.nanoTime() - t0) / 1_000_000;
            long t1 = System.nanoTime();
            for (int i = 0; i < edges.size(); i++) {
                // TODO: staticCount(n, edges.subList(0, i + 1));
            }
            long staticMs = (System.nanoTime() - t1) / 1_000_000;
            System.out.printf("m=%d online=%dms staticPerEdge=%dms%n", m, onlineMs, staticMs);
        }
    }
}
```

**Python.**
```python
import random, time

def benchmark():
    for m in (1000, 4000, 16000):
        n = m
        random.seed(1)
        edges = []
        for _ in range(m):
            u, v = random.randrange(n), random.randrange(n)
            if u != v:
                edges.append((u, v))
        o = OB(n)
        t0 = time.perf_counter()
        for u, v in edges:
            o.add(u, v); _ = o.bridges
        online = time.perf_counter() - t0
        t1 = time.perf_counter()
        for i in range(len(edges)):
            static_count(n, edges[:i+1])   # full recompute per edge
        static = time.perf_counter() - t1
        print(f"m={m} online={online:.3f}s static_per_edge={static:.3f}s")

benchmark()
```

**Expected shape.** Online time roughly triples when `m` quadruples (near-linear, accounting for the `n log n` reroot term). Static-per-edge time grows ~16× when `m` quadruples (quadratic). At `m = 16000` the gap should already be two-to-three orders of magnitude.

**Reporting.** Produce a small table:

| m | online | static-per-edge | speedup |
|---|--------|-----------------|---------|
| 1000 | … | … | … |
| 4000 | … | … | … |
| 16000 | … | … | … |

Discuss where the online structure's `n log n` rerooting term shows up and why most additions are cheap (Case A or short Case C) once the graph densifies.
