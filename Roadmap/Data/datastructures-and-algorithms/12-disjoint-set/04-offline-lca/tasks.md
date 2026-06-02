# Offline LCA — Practice Tasks

Sixteen tasks that build from "compute one LCA" up to "answer a million batched queries near-linearly," each with a statement, constraints, hints, and reference solutions in Go, Java, and Python. All solutions assume a DSU with path compression + union by rank (siblings 01–03). For deep trees, prefer the iterative DFS shown throughout.

> **Convention.** Trees are rooted at node `0`, given as a children-adjacency list `adj[u] = [children…]`. Queries are `(u, v)` node-id pairs. Answers are returned in input order.

---

## Beginner

### B1. Brute-Force LCA (climb with depths)

**Statement.** Implement `lca(u, v)` for a single pair by equalizing depths and climbing both nodes together until they meet. This is your *reference oracle* for testing the fast algorithm.

**Constraints.** `N ≤ 10⁴`. You are given `parent[]` and `depth[]`.

**Hints.**
- Bring the deeper node up to the shallower's depth.
- Then move both up one step at a time until equal.

**Go.**
```go
func lcaClimb(parent, depth []int, u, v int) int {
	for depth[u] > depth[v] {
		u = parent[u]
	}
	for depth[v] > depth[u] {
		v = parent[v]
	}
	for u != v {
		u = parent[u]
		v = parent[v]
	}
	return u
}
```

**Java.**
```java
int lcaClimb(int[] parent, int[] depth, int u, int v) {
    while (depth[u] > depth[v]) u = parent[u];
    while (depth[v] > depth[u]) v = parent[v];
    while (u != v) { u = parent[u]; v = parent[v]; }
    return u;
}
```

**Python.**
```python
def lca_climb(parent, depth, u, v):
    while depth[u] > depth[v]:
        u = parent[u]
    while depth[v] > depth[u]:
        v = parent[v]
    while u != v:
        u, v = parent[u], parent[v]
    return u
```

---

### B2. Compute Depths and Parents in One DFS

**Statement.** Given `adj` and `root`, fill `parent[]` and `depth[]` with an iterative DFS (no recursion).

**Constraints.** `N ≤ 2·10⁵`; the tree may be a path of `N` nodes.

**Hints.**
- Push `(node)` onto a stack; pop, set children's parent/depth, push children.
- `parent[root] = root` (or `-1`) by convention.

**Go.**
```go
func depthsParents(adj [][]int, root int) (parent, depth []int) {
	n := len(adj)
	parent = make([]int, n)
	depth = make([]int, n)
	parent[root] = root
	stack := []int{root}
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, c := range adj[u] {
			parent[c] = u
			depth[c] = depth[u] + 1
			stack = append(stack, c)
		}
	}
	return
}
```

**Java.**
```java
int[][] depthsParents(java.util.List<java.util.List<Integer>> adj, int root) {
    int n = adj.size();
    int[] parent = new int[n], depth = new int[n];
    parent[root] = root;
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    st.push(root);
    while (!st.isEmpty()) {
        int u = st.pop();
        for (int c : adj.get(u)) { parent[c] = u; depth[c] = depth[u] + 1; st.push(c); }
    }
    return new int[][]{parent, depth};
}
```

**Python.**
```python
def depths_parents(adj, root):
    n = len(adj)
    parent = [0] * n
    depth = [0] * n
    parent[root] = root
    stack = [root]
    while stack:
        u = stack.pop()
        for c in adj[u]:
            parent[c] = u
            depth[c] = depth[u] + 1
            stack.append(c)
    return parent, depth
```

---

### B3. Build the DSU with `ancestor`

**Statement.** Implement a DSU exposing `find`, `union(parent, child)`, and an `ancestor[]` array such that after `union`, `ancestor[find(parent)] == parent`.

**Constraints.** `N ≤ 2·10⁵`.

**Hints.**
- Path compression in `find`, union by rank in `union`.
- After linking, set `ancestor[find(rootKept)] = parent`.

**Go.**
```go
type DSU struct{ parent, rank, anc []int }

func NewDSU(n int) *DSU {
	d := &DSU{make([]int, n), make([]int, n), make([]int, n)}
	for i := range d.parent {
		d.parent[i], d.anc[i] = i, i
	}
	return d
}
func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}
func (d *DSU) Union(p, c int) {
	rp, rc := d.Find(p), d.Find(c)
	if rp == rc {
		return
	}
	if d.rank[rp] < d.rank[rc] {
		rp, rc = rc, rp
	}
	d.parent[rc] = rp
	if d.rank[rp] == d.rank[rc] {
		d.rank[rp]++
	}
	d.anc[d.Find(rp)] = p
}
```

**Java.**
```java
class DSU {
    int[] parent, rank, anc;
    DSU(int n) {
        parent = new int[n]; rank = new int[n]; anc = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; anc[i] = i; }
    }
    int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    void union(int p, int c) {
        int rp = find(p), rc = find(c);
        if (rp == rc) return;
        if (rank[rp] < rank[rc]) { int t = rp; rp = rc; rc = t; }
        parent[rc] = rp;
        if (rank[rp] == rank[rc]) rank[rp]++;
        anc[find(rp)] = p;
    }
}
```

**Python.**
```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.anc = list(range(n))

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, p, c):
        rp, rc = self.find(p), self.find(c)
        if rp == rc:
            return
        if self.rank[rp] < self.rank[rc]:
            rp, rc = rc, rp
        self.parent[rc] = rp
        if self.rank[rp] == self.rank[rc]:
            self.rank[rp] += 1
        self.anc[self.find(rp)] = p
```

---

### B4. Bucket Queries on Both Endpoints

**Statement.** Given `queries = [(u,v)…]`, build `byNode[x]` = list of `(other, queryIndex)` for every query mentioning `x`.

**Constraints.** `Q ≤ 2·10⁵`.

**Hints.**
- Append to *both* `byNode[u]` and `byNode[v]`.
- Carry the original index so answers map back.

**Go.**
```go
type Q struct{ other, id int }

func bucket(n int, queries [][2]int) [][]Q {
	by := make([][]Q, n)
	for id, pr := range queries {
		by[pr[0]] = append(by[pr[0]], Q{pr[1], id})
		by[pr[1]] = append(by[pr[1]], Q{pr[0], id})
	}
	return by
}
```

**Java.**
```java
java.util.List<int[]>[] bucket(int n, int[][] queries) {
    java.util.List<int[]>[] by = new java.util.List[n];
    for (int i = 0; i < n; i++) by[i] = new java.util.ArrayList<>();
    for (int id = 0; id < queries.length; id++) {
        by[queries[id][0]].add(new int[]{queries[id][1], id});
        by[queries[id][1]].add(new int[]{queries[id][0], id});
    }
    return by;
}
```

**Python.**
```python
def bucket(n, queries):
    by = [[] for _ in range(n)]
    for qid, (u, v) in enumerate(queries):
        by[u].append((v, qid))
        by[v].append((u, qid))
    return by
```

---

### B5. Single LCA via a One-Pair Tarjan Run

**Statement.** Answer one LCA query by running the full Tarjan algorithm with a single-element query list. (Tests that your end-to-end wiring is correct on the simplest input.)

**Constraints.** `N ≤ 2·10⁵`.

**Hints.**
- Reuse the iterative Tarjan from B1–B4.
- The result array has length 1.

**Go.**
```go
func singleLCA(adj [][]int, root, u, v int) int {
	return tarjanLCA(adj, root, [][2]int{{u, v}})[0] // tarjanLCA defined in Intermediate I1
}
```

**Java.**
```java
int singleLCA(java.util.List<java.util.List<Integer>> adj, int root, int u, int v) {
    return new TarjanLCA().solve(adj, root, new int[][]{{u, v}})[0]; // I1
}
```

**Python.**
```python
def single_lca(adj, root, u, v):
    return tarjan_lca(adj, root, [(u, v)])[0]  # I1
```

---

## Intermediate

### I1. Full Tarjan Offline LCA (iterative)

**Statement.** Implement the complete iterative Tarjan offline LCA: input `(adj, root, queries)`, output the LCA of each query in input order.

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`; the tree may be deep (a path).

**Hints.**
- Explicit stack of `(node, childPointer)`.
- On post-visit: mark visited, resolve queries, pop, union child into parent.
- Set `ancestor[find(child)] = child` when you push it.

**Go.**
```go
func tarjanLCA(adj [][]int, root int, queries [][2]int) []int {
	n := len(adj)
	d := NewDSU(n) // B3
	visited := make([]bool, n)
	ans := make([]int, len(queries))
	for i := range ans {
		ans[i] = -1
	}
	by := bucket(n, queries) // B4
	type frame struct{ node, ci int }
	st := []frame{{root, 0}}
	d.anc[d.Find(root)] = root
	for len(st) > 0 {
		top := &st[len(st)-1]
		u := top.node
		if top.ci < len(adj[u]) {
			c := adj[u][top.ci]
			top.ci++
			d.anc[d.Find(c)] = c
			st = append(st, frame{c, 0})
		} else {
			visited[u] = true
			for _, q := range by[u] {
				if visited[q.other] {
					ans[q.id] = d.anc[d.Find(q.other)]
				}
			}
			st = st[:len(st)-1]
			if len(st) > 0 {
				d.Union(st[len(st)-1].node, u)
			}
		}
	}
	return ans
}
```

**Java.**
```java
class TarjanLCA {
    int[] solve(java.util.List<java.util.List<Integer>> adj, int root, int[][] queries) {
        int n = adj.size();
        DSU d = new DSU(n); // B3
        boolean[] visited = new boolean[n];
        int[] ans = new int[queries.length];
        java.util.Arrays.fill(ans, -1);
        java.util.List<int[]>[] by = new java.util.List[n];
        for (int i = 0; i < n; i++) by[i] = new java.util.ArrayList<>();
        for (int id = 0; id < queries.length; id++) {
            by[queries[id][0]].add(new int[]{queries[id][1], id});
            by[queries[id][1]].add(new int[]{queries[id][0], id});
        }
        int[] node = new int[n], ci = new int[n];
        int sp = 0; node[sp] = root; ci[sp] = 0; sp++;
        d.anc[d.find(root)] = root;
        while (sp > 0) {
            int u = node[sp - 1];
            if (ci[sp - 1] < adj.get(u).size()) {
                int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
                d.anc[d.find(c)] = c;
                node[sp] = c; ci[sp] = 0; sp++;
            } else {
                visited[u] = true;
                for (int[] q : by[u]) if (visited[q[0]]) ans[q[1]] = d.anc[d.find(q[0])];
                sp--;
                if (sp > 0) d.union(node[sp - 1], u);
            }
        }
        return ans;
    }
}
```

**Python.**
```python
def tarjan_lca(adj, root, queries):
    n = len(adj)
    d = DSU(n)  # B3
    visited = [False] * n
    ans = [-1] * len(queries)
    by = bucket(n, queries)  # B4
    stack = [[root, 0]]
    d.anc[d.find(root)] = root
    while stack:
        fr = stack[-1]; u = fr[0]
        if fr[1] < len(adj[u]):
            c = adj[u][fr[1]]; fr[1] += 1
            d.anc[d.find(c)] = c
            stack.append([c, 0])
        else:
            visited[u] = True
            for other, qid in by[u]:
                if visited[other]:
                    ans[qid] = d.anc[d.find(other)]
            stack.pop()
            if stack:
                d.union(stack[-1][0], u)
    return ans
```

---

### I2. Batch Tree Distances

**Statement.** Return `dist(u,v) = depth[u]+depth[v]−2·depth[LCA(u,v)]` for every query.

**Constraints.** `N, Q ≤ 2·10⁵`, unweighted.

**Hints.**
- Reuse B2 for depths and I1 for LCAs.
- One pass each; combine.

**Go.**
```go
func batchDist(adj [][]int, root int, queries [][2]int) []int {
	_, depth := depthsParents(adj, root) // B2
	lca := tarjanLCA(adj, root, queries) // I1
	res := make([]int, len(queries))
	for i, q := range queries {
		res[i] = depth[q[0]] + depth[q[1]] - 2*depth[lca[i]]
	}
	return res
}
```

**Java.**
```java
int[] batchDist(java.util.List<java.util.List<Integer>> adj, int root, int[][] queries) {
    int[][] pd = depthsParents(adj, root); // B2
    int[] depth = pd[1];
    int[] lca = new TarjanLCA().solve(adj, root, queries); // I1
    int[] res = new int[queries.length];
    for (int i = 0; i < queries.length; i++)
        res[i] = depth[queries[i][0]] + depth[queries[i][1]] - 2 * depth[lca[i]];
    return res;
}
```

**Python.**
```python
def batch_dist(adj, root, queries):
    _, depth = depths_parents(adj, root)  # B2
    lca = tarjan_lca(adj, root, queries)  # I1
    return [depth[u] + depth[v] - 2 * depth[lca[i]]
            for i, (u, v) in enumerate(queries)]
```

---

### I3. Weighted-Tree Path Sums

**Statement.** The tree has edge weights. Return the weighted path length between each query pair.

**Constraints.** `N, Q ≤ 2·10⁵`, weights up to `10⁹` (use 64-bit).

**Hints.**
- Compute `distRoot[c] = distRoot[u] + w(u,c)` in the DFS.
- `weightedDist = distRoot[u] + distRoot[v] − 2·distRoot[LCA]`.

**Go.**
```go
// adj[u] = list of {child, weight}
func weightedDist(adj [][][2]int, root int, queries [][2]int) []int64 {
	n := len(adj)
	distRoot := make([]int64, n)
	childOnly := make([][]int, n)
	stack := []int{root}
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, e := range adj[u] {
			c, w := e[0], e[1]
			distRoot[c] = distRoot[u] + int64(w)
			childOnly[u] = append(childOnly[u], c)
			stack = append(stack, c)
		}
	}
	lca := tarjanLCA(childOnly, root, queries) // I1 over plain adjacency
	res := make([]int64, len(queries))
	for i, q := range queries {
		res[i] = distRoot[q[0]] + distRoot[q[1]] - 2*distRoot[lca[i]]
	}
	return res
}
```

**Java.**
```java
long[] weightedDist(int[][][] adj, int root, int[][] queries) {
    int n = adj.length;
    long[] distRoot = new long[n];
    java.util.List<java.util.List<Integer>> childOnly = new java.util.ArrayList<>();
    for (int i = 0; i < n; i++) childOnly.add(new java.util.ArrayList<>());
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    st.push(root);
    while (!st.isEmpty()) {
        int u = st.pop();
        for (int[] e : adj[u]) {
            int c = e[0], w = e[1];
            distRoot[c] = distRoot[u] + w;
            childOnly.get(u).add(c);
            st.push(c);
        }
    }
    int[] lca = new TarjanLCA().solve(childOnly, root, queries); // I1
    long[] res = new long[queries.length];
    for (int i = 0; i < queries.length; i++)
        res[i] = distRoot[queries[i][0]] + distRoot[queries[i][1]] - 2L * distRoot[lca[i]];
    return res;
}
```

**Python.**
```python
def weighted_dist(adj, root, queries):
    # adj[u] = list of (child, weight)
    n = len(adj)
    dist_root = [0] * n
    child_only = [[] for _ in range(n)]
    stack = [root]
    while stack:
        u = stack.pop()
        for c, w in adj[u]:
            dist_root[c] = dist_root[u] + w
            child_only[u].append(c)
            stack.append(c)
    lca = tarjan_lca(child_only, root, queries)  # I1
    return [dist_root[u] + dist_root[v] - 2 * dist_root[lca[i]]
            for i, (u, v) in enumerate(queries)]
```

---

### I4. Ancestor Test in Batch

**Statement.** For each query `(a, b)` answer `true` iff `a` is an ancestor of `b` (a node is its own ancestor).

**Constraints.** `N, Q ≤ 2·10⁵`.

**Hints.**
- `a` is an ancestor of `b` iff `LCA(a, b) == a`.
- Run Tarjan once on all pairs, then compare.

**Go.**
```go
func ancestorTests(adj [][]int, root int, queries [][2]int) []bool {
	lca := tarjanLCA(adj, root, queries) // I1
	res := make([]bool, len(queries))
	for i, q := range queries {
		res[i] = lca[i] == q[0]
	}
	return res
}
```

**Java.**
```java
boolean[] ancestorTests(java.util.List<java.util.List<Integer>> adj, int root, int[][] queries) {
    int[] lca = new TarjanLCA().solve(adj, root, queries); // I1
    boolean[] res = new boolean[queries.length];
    for (int i = 0; i < queries.length; i++) res[i] = lca[i] == queries[i][0];
    return res;
}
```

**Python.**
```python
def ancestor_tests(adj, root, queries):
    lca = tarjan_lca(adj, root, queries)  # I1
    return [lca[i] == a for i, (a, b) in enumerate(queries)]
```

---

### I5. Validate Against the Oracle

**Statement.** Write a randomized test: build a random tree, generate random query pairs, and assert Tarjan's answers equal the brute-force oracle (B1) for every query.

**Constraints.** Run `≥ 1000` random trees of `N ≤ 200`.

**Hints.**
- Random tree: for `v = 1..N-1`, pick `parent ∈ [0, v)`.
- Compare element-wise; print the failing case.

**Go.**
```go
func validate() bool {
	for trial := 0; trial < 1000; trial++ {
		n := 1 + rand.Intn(200)
		adj := make([][]int, n)
		parent := make([]int, n)
		depth := make([]int, n)
		for v := 1; v < n; v++ {
			p := rand.Intn(v)
			adj[p] = append(adj[p], v)
			parent[v] = p
			depth[v] = depth[p] + 1
		}
		qs := make([][2]int, 50)
		for i := range qs {
			qs[i] = [2]int{rand.Intn(n), rand.Intn(n)}
		}
		got := tarjanLCA(adj, 0, qs) // I1
		for i, q := range qs {
			if got[i] != lcaClimb(parent, depth, q[0], q[1]) { // B1
				return false
			}
		}
	}
	return true
}
```

**Java.**
```java
boolean validate() {
    java.util.Random rnd = new java.util.Random(1);
    for (int trial = 0; trial < 1000; trial++) {
        int n = 1 + rnd.nextInt(200);
        java.util.List<java.util.List<Integer>> adj = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new java.util.ArrayList<>());
        int[] parent = new int[n], depth = new int[n];
        for (int v = 1; v < n; v++) {
            int p = rnd.nextInt(v);
            adj.get(p).add(v); parent[v] = p; depth[v] = depth[p] + 1;
        }
        int[][] qs = new int[50][2];
        for (int[] q : qs) { q[0] = rnd.nextInt(n); q[1] = rnd.nextInt(n); }
        int[] got = new TarjanLCA().solve(adj, 0, qs); // I1
        for (int i = 0; i < qs.length; i++)
            if (got[i] != lcaClimb(parent, depth, qs[i][0], qs[i][1])) return false; // B1
    }
    return true;
}
```

**Python.**
```python
import random

def validate():
    for _ in range(1000):
        n = random.randint(1, 200)
        adj = [[] for _ in range(n)]
        parent = [0] * n
        depth = [0] * n
        for v in range(1, n):
            p = random.randrange(v)
            adj[p].append(v); parent[v] = p; depth[v] = depth[p] + 1
        qs = [(random.randrange(n), random.randrange(n)) for _ in range(50)]
        got = tarjan_lca(adj, 0, qs)  # I1
        for i, (u, v) in enumerate(qs):
            if got[i] != lca_climb(parent, depth, u, v):  # B1
                return False
    return True
```

---

## Advanced

### A1. Offline RMQ via Cartesian Tree + Tarjan

**Statement.** Given an array `a` and a batch of `(i, j)` queries, return the *index* of the minimum in `a[i..j]`. Build a Cartesian tree, then reduce RMQ to LCA and solve with Tarjan.

**Constraints.** `N, Q ≤ 2·10⁵`.

**Hints.**
- Cartesian tree (min-heap, in-order = array order) in `O(N)` with a stack.
- `RMQ(i,j) = LCA(i, j)` in that tree; the LCA node *is* the min index.

**Go.**
```go
func buildCartesian(a []int) (adj [][]int, root int) {
	n := len(a)
	adj = make([][]int, n)
	parent := make([]int, n)
	for i := range parent {
		parent[i] = -1
	}
	stack := []int{}
	for i := 0; i < n; i++ {
		last := -1
		for len(stack) > 0 && a[stack[len(stack)-1]] > a[i] {
			last = stack[len(stack)-1]
			stack = stack[:len(stack)-1]
		}
		if last != -1 {
			parent[last] = i
		}
		if len(stack) > 0 {
			parent[i] = stack[len(stack)-1]
		}
		stack = append(stack, i)
	}
	for v := 0; v < n; v++ {
		if parent[v] >= 0 {
			adj[parent[v]] = append(adj[parent[v]], v)
		} else {
			root = v
		}
	}
	return
}

func offlineRMQ(a []int, queries [][2]int) []int {
	adj, root := buildCartesian(a)
	return tarjanLCA(adj, root, queries) // I1; LCA index == min index
}
```

**Java.**
```java
Object[] buildCartesian(int[] a) {
    int n = a.length;
    java.util.List<java.util.List<Integer>> adj = new java.util.ArrayList<>();
    for (int i = 0; i < n; i++) adj.add(new java.util.ArrayList<>());
    int[] parent = new int[n];
    java.util.Arrays.fill(parent, -1);
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        int last = -1;
        while (!st.isEmpty() && a[st.peek()] > a[i]) last = st.pop();
        if (last != -1) parent[last] = i;
        if (!st.isEmpty()) parent[i] = st.peek();
        st.push(i);
    }
    int root = 0;
    for (int v = 0; v < n; v++) {
        if (parent[v] >= 0) adj.get(parent[v]).add(v); else root = v;
    }
    return new Object[]{adj, root};
}

@SuppressWarnings("unchecked")
int[] offlineRMQ(int[] a, int[][] queries) {
    Object[] ct = buildCartesian(a);
    return new TarjanLCA().solve((java.util.List<java.util.List<Integer>>) ct[0], (int) ct[1], queries);
}
```

**Python.**
```python
def build_cartesian(a):
    n = len(a)
    adj = [[] for _ in range(n)]
    parent = [-1] * n
    stack = []
    for i in range(n):
        last = -1
        while stack and a[stack[-1]] > a[i]:
            last = stack.pop()
        if last != -1:
            parent[last] = i
        if stack:
            parent[i] = stack[-1]
        stack.append(i)
    root = 0
    for v in range(n):
        if parent[v] >= 0:
            adj[parent[v]].append(v)
        else:
            root = v
    return adj, root


def offline_rmq(a, queries):
    adj, root = build_cartesian(a)
    return tarjan_lca(adj, root, queries)  # I1; LCA index == min index
```

---

### A2. LCA of a Set of Nodes

**Statement.** For each of `K` *groups* of nodes, return the LCA of the whole group (the deepest node that is an ancestor of every node in the group).

**Constraints.** total group sizes `≤ 2·10⁵`.

**Hints.**
- The LCA of a set equals `LCA(nodeWithMinEntryTime, nodeWithMaxEntryTime)`.
- Compute DFS entry times (`tin`), then one pair per group, batched through Tarjan.

**Go.**
```go
func tinTimes(adj [][]int, root int) []int {
	n := len(adj)
	tin := make([]int, n)
	timer := 0
	type fr struct{ node, ci int }
	st := []fr{{root, 0}}
	tin[root] = timer
	timer++
	for len(st) > 0 {
		top := &st[len(st)-1]
		u := top.node
		if top.ci < len(adj[u]) {
			c := adj[u][top.ci]
			top.ci++
			tin[c] = timer
			timer++
			st = append(st, fr{c, 0})
		} else {
			st = st[:len(st)-1]
		}
	}
	return tin
}

func groupLCA(adj [][]int, root int, groups [][]int) []int {
	tin := tinTimes(adj, root)
	pairs := make([][2]int, len(groups))
	for i, g := range groups {
		lo, hi := g[0], g[0]
		for _, x := range g {
			if tin[x] < tin[lo] {
				lo = x
			}
			if tin[x] > tin[hi] {
				hi = x
			}
		}
		pairs[i] = [2]int{lo, hi}
	}
	return tarjanLCA(adj, root, pairs) // I1
}
```

**Java.**
```java
int[] tinTimes(java.util.List<java.util.List<Integer>> adj, int root) {
    int n = adj.size();
    int[] tin = new int[n], node = new int[n], ci = new int[n];
    int timer = 0, sp = 0;
    node[sp] = root; ci[sp] = 0; sp++; tin[root] = timer++;
    while (sp > 0) {
        int u = node[sp - 1];
        if (ci[sp - 1] < adj.get(u).size()) {
            int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
            tin[c] = timer++;
            node[sp] = c; ci[sp] = 0; sp++;
        } else sp--;
    }
    return tin;
}

int[] groupLCA(java.util.List<java.util.List<Integer>> adj, int root, int[][] groups) {
    int[] tin = tinTimes(adj, root);
    int[][] pairs = new int[groups.length][2];
    for (int i = 0; i < groups.length; i++) {
        int lo = groups[i][0], hi = groups[i][0];
        for (int x : groups[i]) {
            if (tin[x] < tin[lo]) lo = x;
            if (tin[x] > tin[hi]) hi = x;
        }
        pairs[i] = new int[]{lo, hi};
    }
    return new TarjanLCA().solve(adj, root, pairs); // I1
}
```

**Python.**
```python
def tin_times(adj, root):
    n = len(adj)
    tin = [0] * n
    timer = 0
    stack = [[root, 0]]
    tin[root] = timer; timer += 1
    while stack:
        fr = stack[-1]; u = fr[0]
        if fr[1] < len(adj[u]):
            c = adj[u][fr[1]]; fr[1] += 1
            tin[c] = timer; timer += 1
            stack.append([c, 0])
        else:
            stack.pop()
    return tin


def group_lca(adj, root, groups):
    tin = tin_times(adj, root)
    pairs = []
    for g in groups:
        lo = min(g, key=lambda x: tin[x])
        hi = max(g, key=lambda x: tin[x])
        pairs.append((lo, hi))
    return tarjan_lca(adj, root, pairs)  # I1
```

---

### A3. Count Queries Whose LCA Is the Root

**Statement.** Given a batch of pairs, count how many have `LCA(u,v) == root`. (Pairs whose paths must pass through the root.)

**Constraints.** `N, Q ≤ 5·10⁵`.

**Hints.**
- Run Tarjan once; count answers equal to `root`.

**Go.**
```go
func countRootLCA(adj [][]int, root int, queries [][2]int) int {
	lca := tarjanLCA(adj, root, queries) // I1
	cnt := 0
	for _, v := range lca {
		if v == root {
			cnt++
		}
	}
	return cnt
}
```

**Java.**
```java
int countRootLCA(java.util.List<java.util.List<Integer>> adj, int root, int[][] queries) {
    int[] lca = new TarjanLCA().solve(adj, root, queries); // I1
    int cnt = 0;
    for (int v : lca) if (v == root) cnt++;
    return cnt;
}
```

**Python.**
```python
def count_root_lca(adj, root, queries):
    lca = tarjan_lca(adj, root, queries)  # I1
    return sum(1 for v in lca if v == root)
```

---

### A4. Deduplicate Queries Before Solving

**Statement.** The input may contain many duplicate `(u,v)` pairs. Solve each *distinct* pair once and expand answers back to the original (possibly duplicated) order.

**Constraints.** `Q ≤ 10⁶`, but distinct pairs `≤ 2·10⁵`.

**Hints.**
- Canonicalize each pair as `(min, max)`; map to a distinct index.
- Run Tarjan on distinct pairs; scatter results back.

**Go.**
```go
func dedupSolve(adj [][]int, root int, queries [][2]int) []int {
	type key struct{ a, b int }
	idxOf := map[key]int{}
	var distinct [][2]int
	mapBack := make([]int, len(queries))
	for i, q := range queries {
		a, b := q[0], q[1]
		if a > b {
			a, b = b, a
		}
		k := key{a, b}
		j, ok := idxOf[k]
		if !ok {
			j = len(distinct)
			idxOf[k] = j
			distinct = append(distinct, [2]int{a, b})
		}
		mapBack[i] = j
	}
	dans := tarjanLCA(adj, root, distinct) // I1
	res := make([]int, len(queries))
	for i := range queries {
		res[i] = dans[mapBack[i]]
	}
	return res
}
```

**Java.**
```java
int[] dedupSolve(java.util.List<java.util.List<Integer>> adj, int root, int[][] queries) {
    java.util.Map<Long, Integer> idxOf = new java.util.HashMap<>();
    java.util.List<int[]> distinct = new java.util.ArrayList<>();
    int[] mapBack = new int[queries.length];
    for (int i = 0; i < queries.length; i++) {
        int a = queries[i][0], b = queries[i][1];
        if (a > b) { int t = a; a = b; b = t; }
        long k = ((long) a << 32) | (b & 0xffffffffL);
        Integer j = idxOf.get(k);
        if (j == null) { j = distinct.size(); idxOf.put(k, j); distinct.add(new int[]{a, b}); }
        mapBack[i] = j;
    }
    int[] dans = new TarjanLCA().solve(adj, root, distinct.toArray(new int[0][])); // I1
    int[] res = new int[queries.length];
    for (int i = 0; i < queries.length; i++) res[i] = dans[mapBack[i]];
    return res;
}
```

**Python.**
```python
def dedup_solve(adj, root, queries):
    idx_of = {}
    distinct = []
    map_back = []
    for u, v in queries:
        a, b = (u, v) if u <= v else (v, u)
        if (a, b) not in idx_of:
            idx_of[(a, b)] = len(distinct)
            distinct.append((a, b))
        map_back.append(idx_of[(a, b)])
    dans = tarjan_lca(adj, root, distinct)  # I1
    return [dans[j] for j in map_back]
```

---

### A5. Forest LCA (multiple roots)

**Statement.** The input is a *forest* (several trees). For each query, return the LCA if both nodes share a tree, else `-1`.

**Constraints.** `N, Q ≤ 2·10⁵`.

**Hints.**
- Run Tarjan from each root over the *same* DSU and `visited`/`ancestor` arrays, but reset nothing between roots (separate components stay disjoint).
- A cross-component query stays `-1` because the two endpoints never share a representative whose ancestor is set during the same gray path.

**Go.**
```go
func forestLCA(adj [][]int, roots []int, queries [][2]int) []int {
	n := len(adj)
	d := NewDSU(n) // B3
	visited := make([]bool, n)
	ans := make([]int, len(queries))
	for i := range ans {
		ans[i] = -1
	}
	by := bucket(n, queries) // B4
	type frame struct{ node, ci int }
	for _, root := range roots {
		st := []frame{{root, 0}}
		d.anc[d.Find(root)] = root
		for len(st) > 0 {
			top := &st[len(st)-1]
			u := top.node
			if top.ci < len(adj[u]) {
				c := adj[u][top.ci]
				top.ci++
				d.anc[d.Find(c)] = c
				st = append(st, frame{c, 0})
			} else {
				visited[u] = true
				for _, q := range by[u] {
					if visited[q.other] && d.Find(q.other) == d.Find(u) {
						ans[q.id] = d.anc[d.Find(q.other)]
					}
				}
				st = st[:len(st)-1]
				if len(st) > 0 {
					d.Union(st[len(st)-1].node, u)
				}
			}
		}
	}
	return ans
}
```

**Java.**
```java
int[] forestLCA(java.util.List<java.util.List<Integer>> adj, int[] roots, int[][] queries) {
    int n = adj.size();
    DSU d = new DSU(n); // B3
    boolean[] visited = new boolean[n];
    int[] ans = new int[queries.length];
    java.util.Arrays.fill(ans, -1);
    java.util.List<int[]>[] by = new java.util.List[n];
    for (int i = 0; i < n; i++) by[i] = new java.util.ArrayList<>();
    for (int id = 0; id < queries.length; id++) {
        by[queries[id][0]].add(new int[]{queries[id][1], id});
        by[queries[id][1]].add(new int[]{queries[id][0], id});
    }
    int[] node = new int[n], ci = new int[n];
    for (int root : roots) {
        int sp = 0; node[sp] = root; ci[sp] = 0; sp++;
        d.anc[d.find(root)] = root;
        while (sp > 0) {
            int u = node[sp - 1];
            if (ci[sp - 1] < adj.get(u).size()) {
                int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
                d.anc[d.find(c)] = c;
                node[sp] = c; ci[sp] = 0; sp++;
            } else {
                visited[u] = true;
                for (int[] q : by[u])
                    if (visited[q[0]] && d.find(q[0]) == d.find(u)) ans[q[1]] = d.anc[d.find(q[0])];
                sp--;
                if (sp > 0) d.union(node[sp - 1], u);
            }
        }
    }
    return ans;
}
```

**Python.**
```python
def forest_lca(adj, roots, queries):
    n = len(adj)
    d = DSU(n)  # B3
    visited = [False] * n
    ans = [-1] * len(queries)
    by = bucket(n, queries)  # B4
    for root in roots:
        stack = [[root, 0]]
        d.anc[d.find(root)] = root
        while stack:
            fr = stack[-1]; u = fr[0]
            if fr[1] < len(adj[u]):
                c = adj[u][fr[1]]; fr[1] += 1
                d.anc[d.find(c)] = c
                stack.append([c, 0])
            else:
                visited[u] = True
                for other, qid in by[u]:
                    if visited[other] and d.find(other) == d.find(u):
                        ans[qid] = d.anc[d.find(other)]
                stack.pop()
                if stack:
                    d.union(stack[-1][0], u)
    return ans
```

The extra `d.find(other) == d.find(u)` guard ensures cross-component pairs stay `-1`: only nodes in the *same* tree share a representative during that tree's DFS.

---

## Benchmark Task

### BM. Million-Query Batch — Tarjan vs Repeated Climb

**Statement.** Build a random tree of `N = 10⁶` nodes and `Q = 10⁶` random query pairs. Measure (1) total wall-clock for Tarjan offline LCA, and (2) for comparison, repeated brute-force climbing on a smaller subset (it is `O(N)` per query and will be far slower). Report throughput.

**Constraints.** `N = Q = 10⁶`. Use the iterative DFS (a random tree can be deep). Use 64-bit-safe indices.

**Hints.**
- Random tree: `parent[v] = rand(0, v)` keeps it a valid rooted tree with node ids in DFS-friendly-ish order.
- Pre-size the explicit stack and arrays.
- For the climb baseline, run only `~10³` queries or it dominates the benchmark.

**Go.**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func benchmark() {
	const N, Q = 1_000_000, 1_000_000
	adj := make([][]int, N)
	parent := make([]int, N)
	depth := make([]int, N)
	for v := 1; v < N; v++ {
		p := rand.Intn(v)
		adj[p] = append(adj[p], v)
		parent[v] = p
		depth[v] = depth[p] + 1
	}
	queries := make([][2]int, Q)
	for i := range queries {
		queries[i] = [2]int{rand.Intn(N), rand.Intn(N)}
	}

	t0 := time.Now()
	ans := tarjanLCA(adj, 0, queries) // I1
	d := time.Since(t0)
	fmt.Printf("tarjan: %v for %d queries (%.1f M q/s)\n",
		d, Q, float64(Q)/d.Seconds()/1e6)

	// spot-check against climb on a small subset
	for i := 0; i < 1000; i++ {
		if ans[i] != lcaClimb(parent, depth, queries[i][0], queries[i][1]) { // B1
			panic("mismatch")
		}
	}
	fmt.Println("spot-check passed")
}

func main() { benchmark() }
```

**Java.**
```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        final int N = 1_000_000, Q = 1_000_000;
        Random rnd = new Random(42);
        List<List<Integer>> adj = new ArrayList<>(N);
        for (int i = 0; i < N; i++) adj.add(new ArrayList<>());
        int[] parent = new int[N], depth = new int[N];
        for (int v = 1; v < N; v++) {
            int p = rnd.nextInt(v);
            adj.get(p).add(v); parent[v] = p; depth[v] = depth[p] + 1;
        }
        int[][] q = new int[Q][2];
        for (int[] pair : q) { pair[0] = rnd.nextInt(N); pair[1] = rnd.nextInt(N); }

        long t0 = System.nanoTime();
        int[] ans = new TarjanLCA().solve(adj, 0, q); // I1
        double sec = (System.nanoTime() - t0) / 1e9;
        System.out.printf("tarjan: %.3fs for %d queries (%.1f M q/s)%n", sec, Q, Q / sec / 1e6);

        for (int i = 0; i < 1000; i++)
            if (ans[i] != lcaClimb(parent, depth, q[i][0], q[i][1])) // B1
                throw new IllegalStateException("mismatch");
        System.out.println("spot-check passed");
    }
}
```

**Python.**
```python
import random
import time


def benchmark():
    N = Q = 1_000_000
    adj = [[] for _ in range(N)]
    parent = [0] * N
    depth = [0] * N
    for v in range(1, N):
        p = random.randrange(v)
        adj[p].append(v)
        parent[v] = p
        depth[v] = depth[p] + 1
    queries = [(random.randrange(N), random.randrange(N)) for _ in range(Q)]

    t0 = time.perf_counter()
    ans = tarjan_lca(adj, 0, queries)  # I1
    dt = time.perf_counter() - t0
    print(f"tarjan: {dt:.3f}s for {Q} queries ({Q / dt / 1e6:.1f} M q/s)")

    for i in range(1000):
        assert ans[i] == lca_climb(parent, depth, *queries[i])  # B1
    print("spot-check passed")


if __name__ == "__main__":
    benchmark()
```

**Expected observation.** Tarjan finishes the whole `10⁶ + 10⁶` batch in well under a second in Go/Java (a few seconds in CPython), while repeated climbing would take `O(N)` per query — minutes for the same count. The benchmark makes the near-linear vs `O(N·Q)` gap concrete and confirms correctness on a sampled subset.
