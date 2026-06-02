# Heavy-Light Decomposition — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a statement, constraints, hints, and a reference solution in all three languages.
> Reuse the standard HLD scaffold (two iterative DFS passes + a Segment Tree / Fenwick over `pos[]`). Always decide **vertex vs edge** semantics first.

---

## Beginner Tasks (5)

### Task 1 — Build the decomposition and print `pos[]` and `head[]`

**Problem.** Given a rooted tree (root = 0), build HLD and print, for each node `0..N-1`, its `pos` (array position) and `head` (chain head). This verifies your two DFS passes.

**Constraints.** `1 ≤ N ≤ 2·10⁵`; the input is a tree (N-1 edges). Use an **iterative** DFS — deep trees must not overflow the stack.

**Hint.** Pass 1: compute `size` and `heavy` bottom-up. Pass 2: assign `pos` in heavy-first order and propagate `head`. Assert `cur == N` at the end.

**Reference — Go**
```go
package main

import "fmt"

func main() {
	n := 7
	adj := make([][]int, n)
	add := func(a, b int) { adj[a] = append(adj[a], b); adj[b] = append(adj[b], a) }
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {2, 6}} {
		add(e[0], e[1])
	}
	par := make([]int, n)
	dep := make([]int, n)
	sz := make([]int, n)
	hv := make([]int, n)
	head := make([]int, n)
	pos := make([]int, n)
	for i := range hv {
		hv[i] = -1
	}
	root := 0
	par[root] = -1
	order, st, vis := []int{}, []int{root}, make([]bool, n)
	vis[root] = true
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		order = append(order, u)
		for _, w := range adj[u] {
			if !vis[w] {
				vis[w] = true
				par[w] = u
				dep[w] = dep[u] + 1
				st = append(st, w)
			}
		}
	}
	for i := len(order) - 1; i >= 0; i-- {
		u := order[i]
		sz[u] = 1
		best := 0
		for _, w := range adj[u] {
			if w != par[u] {
				sz[u] += sz[w]
				if sz[w] > best {
					best = sz[w]
					hv[u] = w
				}
			}
		}
	}
	type fr struct{ node, hd int }
	cur := 0
	s2 := []fr{{root, root}}
	for len(s2) > 0 {
		f := s2[len(s2)-1]
		s2 = s2[:len(s2)-1]
		u := f.node
		head[u] = f.hd
		pos[u] = cur
		cur++
		for _, w := range adj[u] {
			if w != par[u] && w != hv[u] {
				s2 = append(s2, fr{w, w})
			}
		}
		if hv[u] != -1 {
			s2 = append(s2, fr{hv[u], f.hd})
		}
	}
	for v := 0; v < n; v++ {
		fmt.Printf("node %d pos %d head %d\n", v, pos[v], head[v])
	}
}
```

**Reference — Java**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        int n = 7;
        List<Integer>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        int[][] e = {{0,1},{0,2},{1,3},{1,4},{2,5},{2,6}};
        for (int[] x : e) { adj[x[0]].add(x[1]); adj[x[1]].add(x[0]); }
        int[] par = new int[n], dep = new int[n], sz = new int[n],
              hv = new int[n], head = new int[n], pos = new int[n];
        Arrays.fill(hv, -1);
        int root = 0; par[root] = -1;
        int[] order = new int[n]; int c = 0; boolean[] vis = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>(); st.push(root); vis[root] = true;
        while (!st.isEmpty()) { int u = st.pop(); order[c++] = u;
            for (int w : adj[u]) if (!vis[w]) { vis[w]=true; par[w]=u; dep[w]=dep[u]+1; st.push(w); } }
        for (int i = c - 1; i >= 0; i--) { int u = order[i]; sz[u]=1; int best=0;
            for (int w : adj[u]) if (w != par[u]) { sz[u]+=sz[w]; if (sz[w]>best){best=sz[w];hv[u]=w;} } }
        int cur = 0; Deque<int[]> s2 = new ArrayDeque<>(); s2.push(new int[]{root, root});
        while (!s2.isEmpty()) { int[] f = s2.pop(); int u=f[0],hd=f[1]; head[u]=hd; pos[u]=cur++;
            for (int w : adj[u]) if (w!=par[u] && w!=hv[u]) s2.push(new int[]{w,w});
            if (hv[u]!=-1) s2.push(new int[]{hv[u], hd}); }
        for (int v = 0; v < n; v++)
            System.out.println("node " + v + " pos " + pos[v] + " head " + head[v]);
    }
}
```

**Reference — Python**
```python
def main():
    n = 7
    adj = [[] for _ in range(n)]
    for a, b in [(0,1),(0,2),(1,3),(1,4),(2,5),(2,6)]:
        adj[a].append(b); adj[b].append(a)
    par=[-1]*n; dep=[0]*n; sz=[0]*n; hv=[-1]*n; head=[0]*n; pos=[0]*n
    root = 0
    order, st, vis = [], [root], [False]*n; vis[root] = True
    while st:
        u = st.pop(); order.append(u)
        for w in adj[u]:
            if not vis[w]:
                vis[w]=True; par[w]=u; dep[w]=dep[u]+1; st.append(w)
    for u in reversed(order):
        sz[u]=1; best=0
        for w in adj[u]:
            if w!=par[u]:
                sz[u]+=sz[w]
                if sz[w]>best: best=sz[w]; hv[u]=w
    cur = 0; s2=[(root, root)]
    while s2:
        u, hd = s2.pop(); head[u]=hd; pos[u]=cur; cur+=1
        for w in adj[u]:
            if w!=par[u] and w!=hv[u]: s2.append((w,w))
        if hv[u]!=-1: s2.append((hv[u], hd))
    for v in range(n):
        print(f"node {v} pos {pos[v]} head {head[v]}")

main()
```

---

### Task 2 — LCA via HLD

**Problem.** Answer `Q` LCA queries using only the chain-jumping loop (no binary lifting, no segment tree).

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. Each query `O(log N)`.

**Hint.** While `head[u] != head[v]`, lift the node with the **deeper** head: `u = parent[head[u]]`. When heads match, the shallower node is the LCA.

**Reference — Go**
```go
func lca(head, par, dep []int, u, v int) int {
	for head[u] != head[v] {
		if dep[head[u]] < dep[head[v]] {
			u, v = v, u
		}
		u = par[head[u]]
	}
	if dep[u] < dep[v] {
		return u
	}
	return v
}
```

**Reference — Java**
```java
static int lca(int[] head, int[] par, int[] dep, int u, int v) {
    while (head[u] != head[v]) {
        if (dep[head[u]] < dep[head[v]]) { int t=u; u=v; v=t; }
        u = par[head[u]];
    }
    return dep[u] < dep[v] ? u : v;
}
```

**Reference — Python**
```python
def lca(head, par, dep, u, v):
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]:
            u, v = v, u
        u = par[head[u]]
    return u if dep[u] < dep[v] else v
```

---

### Task 3 — Path length (number of edges) between two nodes

**Problem.** Answer `dist(u, v)` = number of edges on the path. No values needed — pure structure.

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`.

**Hint.** `dist(u, v) = depth[u] + depth[v] − 2·depth[lca(u, v)]`. Reuse Task 2's LCA.

**Reference — Go**
```go
func dist(head, par, dep []int, u, v int) int {
	w := lca(head, par, dep, u, v)
	return dep[u] + dep[v] - 2*dep[w]
}
```

**Reference — Java**
```java
static int dist(int[] head, int[] par, int[] dep, int u, int v) {
    int w = lca(head, par, dep, u, v);
    return dep[u] + dep[v] - 2 * dep[w];
}
```

**Reference — Python**
```python
def dist(head, par, dep, u, v):
    w = lca(head, par, dep, u, v)
    return dep[u] + dep[v] - 2 * dep[w]
```

---

### Task 4 — Subtree sum with point updates (Euler interval)

**Problem.** Support `update(v, x)` (set node value) and `subtreeSum(v)` over the subtree of `v`.

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. Updates and queries `O(log N)`.

**Hint.** The subtree of `v` is the contiguous interval `[pos[v], pos[v] + size[v] − 1]`. One Fenwick / Segment Tree range query. No chain loop needed.

**Reference — Go** (Fenwick over `pos`)
```go
type BIT struct{ t []int64 }

func NewBIT(n int) *BIT { return &BIT{t: make([]int64, n+1)} }
func (b *BIT) Add(i int, d int64) {
	for i++; i < len(b.t); i += i & (-i) {
		b.t[i] += d
	}
}
func (b *BIT) Sum(i int) int64 { // prefix [0..i]
	var s int64
	for i++; i > 0; i -= i & (-i) {
		s += b.t[i]
	}
	return s
}
func subtreeSum(b *BIT, pos, sz []int, v int) int64 {
	l, r := pos[v], pos[v]+sz[v]-1
	return b.Sum(r) - b.Sum(l-1)
}
```

**Reference — Java**
```java
static long[] bit;
static void bitAdd(int i, long d) { for (i++; i < bit.length; i += i & (-i)) bit[i] += d; }
static long bitSum(int i) { long s = 0; for (i++; i > 0; i -= i & (-i)) s += bit[i]; return s; }
static long subtreeSum(int[] pos, int[] sz, int v) {
    int l = pos[v], r = pos[v] + sz[v] - 1;
    return bitSum(r) - bitSum(l - 1);
}
```

**Reference — Python**
```python
class BIT:
    def __init__(self, n): self.t = [0]*(n+1)
    def add(self, i, d):
        i += 1
        while i < len(self.t): self.t[i] += d; i += i & (-i)
    def sum(self, i):  # prefix [0..i]
        i += 1; s = 0
        while i > 0: s += self.t[i]; i -= i & (-i)
        return s

def subtree_sum(bit, pos, sz, v):
    l, r = pos[v], pos[v] + sz[v] - 1
    return bit.sum(r) - bit.sum(l - 1)
```

---

### Task 5 — Path sum with point updates (vertex values)

**Problem.** Support `update(v, x)` (set node value) and `pathSum(u, v)`.

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. Path query `O(log² N)`.

**Hint.** Chain loop with a sum query per segment; vertex values → the final same-chain segment **includes** the LCA: `[pos[u], pos[v]]` after swapping so `pos[u] ≤ pos[v]`.

**Reference — Python** (assumes BIT over `pos`, plus HLD arrays)
```python
def path_sum(bit, head, par, dep, pos, u, v):
    res = 0
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        l, r = pos[head[u]], pos[u]
        res += bit.sum(r) - bit.sum(l - 1)
        u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    res += bit.sum(pos[v]) - bit.sum(pos[u] - 1)  # include LCA
    return res
```

**Reference — Go**
```go
func pathSum(b *BIT, head, par, dep, pos []int, u, v int) int64 {
	var res int64
	for head[u] != head[v] {
		if dep[head[u]] < dep[head[v]] {
			u, v = v, u
		}
		l, r := pos[head[u]], pos[u]
		res += b.Sum(r) - b.Sum(l-1)
		u = par[head[u]]
	}
	if dep[u] > dep[v] {
		u, v = v, u
	}
	res += b.Sum(pos[v]) - b.Sum(pos[u]-1)
	return res
}
```

**Reference — Java**
```java
static long pathSum(int[] head, int[] par, int[] dep, int[] pos, int u, int v) {
    long res = 0;
    while (head[u] != head[v]) {
        if (dep[head[u]] < dep[head[v]]) { int t=u; u=v; v=t; }
        res += bitSum(pos[u]) - bitSum(pos[head[u]] - 1);
        u = par[head[u]];
    }
    if (dep[u] > dep[v]) { int t=u; u=v; v=t; }
    res += bitSum(pos[v]) - bitSum(pos[u] - 1);
    return res;
}
```

---

## Intermediate Tasks (5)

### Task 6 — Path range-add + path-sum (lazy segment tree, vertex values)

**Problem.** Support `pathAdd(u, v, x)` (add `x` to every node on the path) and `pathSum(u, v)`.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`. Both ops `O(log² N)`.

**Hint.** Lazy segment tree with range-add / range-sum. Run the chain loop calling `rangeAdd` for updates and `rangeSum` for queries. Vertex values → include LCA on the final segment.

**Reference — Python** (lazy add/sum + HLD path ops)
```python
class Lazy:
    def __init__(self, n):
        self.n = n; self.sum = [0]*(4*n); self.lz = [0]*(4*n)
    def _push(self, nd, lo, hi):
        if self.lz[nd]:
            mid = (lo+hi)//2
            for c, clo, chi in ((2*nd, lo, mid), (2*nd+1, mid+1, hi)):
                self.sum[c] += self.lz[nd]*(chi-clo+1); self.lz[c] += self.lz[nd]
            self.lz[nd] = 0
    def add(self, nd, lo, hi, l, r, v):
        if r < lo or hi < l: return
        if l <= lo and hi <= r:
            self.sum[nd] += v*(hi-lo+1); self.lz[nd] += v; return
        self._push(nd, lo, hi); mid=(lo+hi)//2
        self.add(2*nd, lo, mid, l, r, v); self.add(2*nd+1, mid+1, hi, l, r, v)
        self.sum[nd] = self.sum[2*nd] + self.sum[2*nd+1]
    def qry(self, nd, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.sum[nd]
        self._push(nd, lo, hi); mid=(lo+hi)//2
        return self.qry(2*nd, lo, mid, l, r) + self.qry(2*nd+1, mid+1, hi, l, r)

def path_add(seg, head, par, dep, pos, n, u, v, x):
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        seg.add(1, 0, n-1, pos[head[u]], pos[u], x); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    seg.add(1, 0, n-1, pos[u], pos[v], x)  # include LCA

def path_sum(seg, head, par, dep, pos, n, u, v):
    res = 0
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        res += seg.qry(1, 0, n-1, pos[head[u]], pos[u]); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    return res + seg.qry(1, 0, n-1, pos[u], pos[v])
```

**Reference — Go** (lazy core)
```go
type Lazy struct {
	n        int
	sum, lz  []int64
}

func NewLazy(n int) *Lazy { return &Lazy{n: n, sum: make([]int64, 4*n), lz: make([]int64, 4*n)} }
func (s *Lazy) push(nd, lo, hi int) {
	if s.lz[nd] != 0 {
		mid := (lo + hi) / 2
		s.sum[2*nd] += s.lz[nd] * int64(mid-lo+1)
		s.lz[2*nd] += s.lz[nd]
		s.sum[2*nd+1] += s.lz[nd] * int64(hi-mid)
		s.lz[2*nd+1] += s.lz[nd]
		s.lz[nd] = 0
	}
}
func (s *Lazy) Add(nd, lo, hi, l, r int, v int64) {
	if r < lo || hi < l {
		return
	}
	if l <= lo && hi <= r {
		s.sum[nd] += v * int64(hi-lo+1)
		s.lz[nd] += v
		return
	}
	s.push(nd, lo, hi)
	mid := (lo + hi) / 2
	s.Add(2*nd, lo, mid, l, r, v)
	s.Add(2*nd+1, mid+1, hi, l, r, v)
	s.sum[nd] = s.sum[2*nd] + s.sum[2*nd+1]
}
func (s *Lazy) Qry(nd, lo, hi, l, r int) int64 {
	if r < lo || hi < l {
		return 0
	}
	if l <= lo && hi <= r {
		return s.sum[nd]
	}
	s.push(nd, lo, hi)
	mid := (lo + hi) / 2
	return s.Qry(2*nd, lo, mid, l, r) + s.Qry(2*nd+1, mid+1, hi, l, r)
}
```

**Reference — Java** (lazy core)
```java
static int N; static long[] sum, lz;
static void push(int nd, int lo, int hi) {
    if (lz[nd] != 0) {
        int mid = (lo + hi) >> 1;
        sum[2*nd]   += lz[nd]*(mid-lo+1); lz[2*nd]   += lz[nd];
        sum[2*nd+1] += lz[nd]*(hi-mid);   lz[2*nd+1] += lz[nd];
        lz[nd] = 0;
    }
}
static void add(int nd, int lo, int hi, int l, int r, long v) {
    if (r < lo || hi < l) return;
    if (l <= lo && hi <= r) { sum[nd] += v*(hi-lo+1); lz[nd] += v; return; }
    push(nd, lo, hi); int mid = (lo + hi) >> 1;
    add(2*nd, lo, mid, l, r, v); add(2*nd+1, mid+1, hi, l, r, v);
    sum[nd] = sum[2*nd] + sum[2*nd+1];
}
static long qry(int nd, int lo, int hi, int l, int r) {
    if (r < lo || hi < l) return 0;
    if (l <= lo && hi <= r) return sum[nd];
    push(nd, lo, hi); int mid = (lo + hi) >> 1;
    return qry(2*nd, lo, mid, l, r) + qry(2*nd+1, mid+1, hi, l, r);
}
```

---

### Task 7 — Maximum edge weight on a path (edge values)

**Problem.** Each edge has a weight. Answer `maxEdge(u, v)`.

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. Query `O(log² N)`.

**Hint.** Store edge `(parent(c), c)` at `pos[c]`; use a max segment tree. On the final same-chain segment **skip the LCA**: `[pos[lca]+1, pos[deeper]]`; if `u == v` return `−∞`.

**Reference — Python** (path-max core)
```python
NEG = -(1 << 60)

def path_max_edge(qmax, head, par, dep, pos, u, v):
    res = NEG
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        res = max(res, qmax(pos[head[u]], pos[u])); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    if u != v:
        res = max(res, qmax(pos[u] + 1, pos[v]))  # skip LCA
    return res
```

**Reference — Go**
```go
const NEG = int64(-1) << 60

func pathMaxEdge(qmax func(l, r int) int64, head, par, dep, pos []int, u, v int) int64 {
	res := NEG
	for head[u] != head[v] {
		if dep[head[u]] < dep[head[v]] {
			u, v = v, u
		}
		if x := qmax(pos[head[u]], pos[u]); x > res {
			res = x
		}
		u = par[head[u]]
	}
	if dep[u] > dep[v] {
		u, v = v, u
	}
	if u != v {
		if x := qmax(pos[u]+1, pos[v]); x > res {
			res = x
		}
	}
	return res
}
```

**Reference — Java**
```java
static final long NEG = Long.MIN_VALUE / 4;
static long pathMaxEdge(int[] head, int[] par, int[] dep, int[] pos, int u, int v) {
    long res = NEG;
    while (head[u] != head[v]) {
        if (dep[head[u]] < dep[head[v]]) { int t=u; u=v; v=t; }
        res = Math.max(res, qmax(pos[head[u]], pos[u]));
        u = par[head[u]];
    }
    if (dep[u] > dep[v]) { int t=u; u=v; v=t; }
    if (u != v) res = Math.max(res, qmax(pos[u] + 1, pos[v]));
    return res;
}
```

---

### Task 8 — Subtree add + path query (mixed)

**Problem.** Support `subtreeAdd(v, x)` (add `x` to all nodes in `v`'s subtree) and `pathSum(u, v)` — exercising the same `pos[]` for both interval and chain operations.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`. Subtree update `O(log N)`, path query `O(log² N)`.

**Hint.** Subtree update is the single interval `[pos[v], pos[v]+size[v]−1]` on a lazy add/sum tree; path query uses the chain loop. One tree serves both.

**Reference — Python**
```python
def subtree_add(seg, pos, sz, n, v, x):
    seg.add(1, 0, n-1, pos[v], pos[v] + sz[v] - 1, x)

# path_sum is identical to Task 6's path_sum (vertex values, include LCA).
```

**Reference — Go**
```go
func subtreeAdd(s *Lazy, pos, sz []int, n, v int, x int64) {
	s.Add(1, 0, n-1, pos[v], pos[v]+sz[v]-1, x)
}
```

**Reference — Java**
```java
static void subtreeAdd(int[] pos, int[] sz, int v, long x) {
    add(1, 0, N - 1, pos[v], pos[v] + sz[v] - 1, x);
}
```

---

### Task 9 — Count nodes with a target color on a path

**Problem.** Each node has a color in `[0, C)`. Support `setColor(v, c)` and `countOnPath(u, v, c)`.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`; `1 ≤ C ≤ 20`. Query `O(log² N)` (per color via `C` Fenwicks).

**Hint.** Keep `C` Fenwick trees over `pos`. `setColor` removes the old color's `1` at `pos[v]` and adds the new. `countOnPath` runs the chain loop summing the chosen color's Fenwick (vertex values → include LCA).

**Reference — Python**
```python
class ColorFenwicks:
    def __init__(self, n, C):
        self.n, self.C = n, C
        self.t = [[0]*(n+1) for _ in range(C)]
    def add(self, c, i, d):
        i += 1
        while i <= self.n: self.t[c][i] += d; i += i & (-i)
    def pre(self, c, i):
        i += 1; s = 0
        while i > 0: s += self.t[c][i]; i -= i & (-i)
        return s
    def rng(self, c, l, r):
        return self.pre(c, r) - (self.pre(c, l-1) if l > 0 else 0)

def count_on_path(cf, color, head, par, dep, pos, u, v, c):
    res = 0
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        res += cf.rng(c, pos[head[u]], pos[u]); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    return res + cf.rng(c, pos[u], pos[v])  # include LCA
```

**Reference — Go**
```go
type ColorBIT struct {
	n int
	t [][]int64
}

func NewColorBIT(n, C int) *ColorBIT {
	t := make([][]int64, C)
	for i := range t {
		t[i] = make([]int64, n+1)
	}
	return &ColorBIT{n: n, t: t}
}
func (b *ColorBIT) Add(c, i int, d int64) {
	for i++; i <= b.n; i += i & (-i) {
		b.t[c][i] += d
	}
}
func (b *ColorBIT) Pre(c, i int) int64 {
	var s int64
	for i++; i > 0; i -= i & (-i) {
		s += b.t[c][i]
	}
	return s
}
func (b *ColorBIT) Rng(c, l, r int) int64 {
	res := b.Pre(c, r)
	if l > 0 {
		res -= b.Pre(c, l-1)
	}
	return res
}
```

**Reference — Java**
```java
static int CN; static long[][] ct;
static void cAdd(int c, int i, long d) { for (i++; i <= CN; i += i & (-i)) ct[c][i] += d; }
static long cPre(int c, int i) { long s=0; for (i++; i>0; i -= i & (-i)) s += ct[c][i]; return s; }
static long cRng(int c, int l, int r) { return cPre(c, r) - (l > 0 ? cPre(c, l-1) : 0); }
```

---

### Task 10 — Path assignment + path max (lazy "assign", edge or vertex)

**Problem.** Support `pathAssign(u, v, x)` (set every node on the path to `x`) and `pathMax(u, v)`.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`. Both `O(log² N)`.

**Hint.** Lazy segment tree where the lazy tag is "assign" (use a sentinel like `None`/`MIN` for "no pending assign"). The chain loop is unchanged; only the lazy semantics differ from range-add.

**Reference — Python** (assign-lazy max core)
```python
class AssignMax:
    NONE = None
    def __init__(self, n, init=0):
        self.n = n; self.mx = [init]*(4*n); self.lz = [None]*(4*n)
    def _apply(self, nd, val): self.mx[nd] = val; self.lz[nd] = val
    def _push(self, nd):
        if self.lz[nd] is not None:
            self._apply(2*nd, self.lz[nd]); self._apply(2*nd+1, self.lz[nd])
            self.lz[nd] = None
    def assign(self, nd, lo, hi, l, r, val):
        if r < lo or hi < l: return
        if l <= lo and hi <= r: self._apply(nd, val); return
        self._push(nd); mid=(lo+hi)//2
        self.assign(2*nd, lo, mid, l, r, val); self.assign(2*nd+1, mid+1, hi, l, r, val)
        self.mx[nd] = max(self.mx[2*nd], self.mx[2*nd+1])
    def qmax(self, nd, lo, hi, l, r):
        if r < lo or hi < l: return -(1<<60)
        if l <= lo and hi <= r: return self.mx[nd]
        self._push(nd); mid=(lo+hi)//2
        return max(self.qmax(2*nd, lo, mid, l, r), self.qmax(2*nd+1, mid+1, hi, l, r))
```

**Reference — Go** (assign-lazy core)
```go
type AssignMax struct {
	n      int
	mx     []int64
	lz     []int64
	hasLz  []bool
}

func NewAssignMax(n int) *AssignMax {
	return &AssignMax{n: n, mx: make([]int64, 4*n), lz: make([]int64, 4*n), hasLz: make([]bool, 4*n)}
}
func (s *AssignMax) apply(nd int, val int64) { s.mx[nd] = val; s.lz[nd] = val; s.hasLz[nd] = true }
func (s *AssignMax) push(nd int) {
	if s.hasLz[nd] {
		s.apply(2*nd, s.lz[nd])
		s.apply(2*nd+1, s.lz[nd])
		s.hasLz[nd] = false
	}
}
func (s *AssignMax) Assign(nd, lo, hi, l, r int, val int64) {
	if r < lo || hi < l {
		return
	}
	if l <= lo && hi <= r {
		s.apply(nd, val)
		return
	}
	s.push(nd)
	mid := (lo + hi) / 2
	s.Assign(2*nd, lo, mid, l, r, val)
	s.Assign(2*nd+1, mid+1, hi, l, r, val)
	if s.mx[2*nd] > s.mx[2*nd+1] {
		s.mx[nd] = s.mx[2*nd]
	} else {
		s.mx[nd] = s.mx[2*nd+1]
	}
}
```

**Reference — Java** (assign-lazy core)
```java
static int AN; static long[] amx, alz; static boolean[] ahas;
static void apply(int nd, long val) { amx[nd] = val; alz[nd] = val; ahas[nd] = true; }
static void apush(int nd) { if (ahas[nd]) { apply(2*nd, alz[nd]); apply(2*nd+1, alz[nd]); ahas[nd] = false; } }
static void assign(int nd, int lo, int hi, int l, int r, long val) {
    if (r < lo || hi < l) return;
    if (l <= lo && hi <= r) { apply(nd, val); return; }
    apush(nd); int mid = (lo + hi) >> 1;
    assign(2*nd, lo, mid, l, r, val); assign(2*nd+1, mid+1, hi, l, r, val);
    amx[nd] = Math.max(amx[2*nd], amx[2*nd+1]);
}
```

---

## Advanced Tasks (5)

### Task 11 — QTREE-style: change one edge's weight, query max edge on a path

**Problem.** Operations: `change i w` set the weight of the `i`-th input edge to `w`; `query u v` = maximum edge weight on path `u…v`.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`. This is the classic SPOJ QTREE.

**Hint.** Map each edge to its child endpoint, store at `pos[child]`, point-update on `change`, max chain-loop on `query` (skip the LCA). Keep an array `edgeChild[i]` = the deeper endpoint of edge `i`.

**Reference — Python**
```python
# Assume HLD built with edge weights stored at pos[child].
# edge_child[i] = deeper endpoint of input edge i.
def change(seg_set, pos, edge_child, i, w):
    seg_set(pos[edge_child[i]], w)  # point set in a max segment tree

def query_max(qmax, head, par, dep, pos, u, v):
    res = -(1 << 60)
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        res = max(res, qmax(pos[head[u]], pos[u])); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    if u != v: res = max(res, qmax(pos[u] + 1, pos[v]))
    return res
```

**Reference — Go**
```go
func change(set func(i int, w int64), pos, edgeChild []int, i int, w int64) {
	set(pos[edgeChild[i]], w)
}

func queryMax(qmax func(l, r int) int64, head, par, dep, pos []int, u, v int) int64 {
	res := int64(-1) << 60
	for head[u] != head[v] {
		if dep[head[u]] < dep[head[v]] {
			u, v = v, u
		}
		if x := qmax(pos[head[u]], pos[u]); x > res {
			res = x
		}
		u = par[head[u]]
	}
	if dep[u] > dep[v] {
		u, v = v, u
	}
	if u != v {
		if x := qmax(pos[u]+1, pos[v]); x > res {
			res = x
		}
	}
	return res
}
```

**Reference — Java**
```java
static void change(int[] pos, int[] edgeChild, int i, long w) { segSet(pos[edgeChild[i]], w); }
static long queryMax(int[] head, int[] par, int[] dep, int[] pos, int u, int v) {
    long res = Long.MIN_VALUE / 4;
    while (head[u] != head[v]) {
        if (dep[head[u]] < dep[head[v]]) { int t=u; u=v; v=t; }
        res = Math.max(res, qmax(pos[head[u]], pos[u]));
        u = par[head[u]];
    }
    if (dep[u] > dep[v]) { int t=u; u=v; v=t; }
    if (u != v) res = Math.max(res, qmax(pos[u] + 1, pos[v]));
    return res;
}
```

---

### Task 12 — Path XOR with point updates

**Problem.** Each node has a value. Support `set(v, x)` and `pathXor(u, v)` = XOR of all node values on the path (vertex values, include LCA).

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. XOR is its own inverse — a Fenwick of XORs works.

**Hint.** Replace `+` with `^` everywhere (combine and inverse). For a Fenwick, prefix-XOR up to `r` XOR prefix-XOR up to `l−1` gives the range XOR.

**Reference — Python**
```python
class XorBIT:
    def __init__(self, n): self.t = [0]*(n+1)
    def upd(self, i, old, new):  # set value at i; we store via toggling
        # simpler: rebuild requires point xor delta = old ^ new
        d = old ^ new; i += 1
        while i < len(self.t): self.t[i] ^= d; i += i & (-i)
    def pre(self, i):
        i += 1; s = 0
        while i > 0: s ^= self.t[i]; i -= i & (-i)
        return s

def path_xor(bit, val, head, par, dep, pos, u, v):
    res = 0
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        l, r = pos[head[u]], pos[u]
        res ^= bit.pre(r) ^ (bit.pre(l-1) if l > 0 else 0)
        u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    l, r = pos[u], pos[v]
    return res ^ bit.pre(r) ^ (bit.pre(l-1) if l > 0 else 0)
```

**Reference — Go**
```go
type XorBIT struct{ t []int64 }

func (b *XorBIT) Upd(i int, old, new int64) {
	d := old ^ new
	for i++; i < len(b.t); i += i & (-i) {
		b.t[i] ^= d
	}
}
func (b *XorBIT) Pre(i int) int64 {
	var s int64
	for i++; i > 0; i -= i & (-i) {
		s ^= b.t[i]
	}
	return s
}
```

**Reference — Java**
```java
static long[] xt;
static void xUpd(int i, long old, long nw) { long d = old ^ nw; for (i++; i < xt.length; i += i & (-i)) xt[i] ^= d; }
static long xPre(int i) { long s = 0; for (i++; i > 0; i -= i & (-i)) s ^= xt[i]; return s; }
```

---

### Task 13 — Painting a tree: path range-assign color, query number of distinct color segments on a path

**Problem.** Support `paint(u, v, c)` (assign color `c` to every node on the path) and `segments(u, v)` (count maximal same-color runs along the path). This is a harder lazy-assign problem.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`.

**Hint.** Build a segment tree node storing `(leftColor, rightColor, segmentCount)` and a lazy assign tag. Merging two children subtracts 1 if `right.leftColor == left.rightColor`. The HLD path loop must merge segments **in path order** (be careful: the chain pieces appear from `u` up and from `v` up — combine the two halves with correct orientation, since the path goes `u → lca → v`).

**Reference — Python** (segment-merge core; orientation handling sketched)
```python
class Seg:
    # node = (leftColor, rightColor, count); assign-lazy
    def merge(self, a, b):
        if a is None: return b
        if b is None: return a
        lc, rc, cnt = a[0], b[1], a[2] + b[2]
        if a[1] == b[0]: cnt -= 1
        return (lc, rc, cnt)
# Path query collects left-chain pieces (from u side, reversed) and right-chain pieces (from v side),
# then merges them around the LCA respecting that the path reads u -> ... -> lca -> ... -> v.
```

**Reference — Go** (merge core)
```go
type Node struct {
	lc, rc, cnt int
}

func merge(a, b Node, aEmpty, bEmpty bool) (Node, bool) {
	if aEmpty {
		return b, bEmpty
	}
	if bEmpty {
		return a, aEmpty
	}
	cnt := a.cnt + b.cnt
	if a.rc == b.lc {
		cnt--
	}
	return Node{a.lc, b.rc, cnt}, false
}
```

**Reference — Java** (merge core)
```java
static class Node { int lc, rc, cnt; boolean empty;
    Node(int lc, int rc, int cnt, boolean e){this.lc=lc;this.rc=rc;this.cnt=cnt;this.empty=e;} }
static Node merge(Node a, Node b) {
    if (a.empty) return b;
    if (b.empty) return a;
    int cnt = a.cnt + b.cnt;
    if (a.rc == b.lc) cnt--;
    return new Node(a.lc, b.rc, cnt, false);
}
```

---

### Task 14 — Sum of node values on path, with subtree-assign updates

**Problem.** Mix subtree updates with path queries: `subtreeAssign(v, x)` (set every node in `v`'s subtree to `x`) and `pathSum(u, v)`.

**Constraints.** `1 ≤ N, Q ≤ 10⁵`. Subtree update `O(log N)`, path query `O(log² N)`.

**Hint.** Lazy assign/sum segment tree. Subtree update is one interval `[pos[v], pos[v]+size[v]−1]`. Path query is the chain loop with `rangeSum`. The shared `pos[]` makes both work on one tree.

**Reference — Python**
```python
def subtree_assign(seg, pos, sz, n, v, x):
    seg.assign(1, 0, n-1, pos[v], pos[v] + sz[v] - 1, x)

def path_sum(seg, head, par, dep, pos, n, u, v):
    res = 0
    while head[u] != head[v]:
        if dep[head[u]] < dep[head[v]]: u, v = v, u
        res += seg.qsum(1, 0, n-1, pos[head[u]], pos[u]); u = par[head[u]]
    if dep[u] > dep[v]: u, v = v, u
    return res + seg.qsum(1, 0, n-1, pos[u], pos[v])
```

**Reference — Go**
```go
func subtreeAssign(s *AssignSum, pos, sz []int, n, v int, x int64) {
	s.Assign(1, 0, n-1, pos[v], pos[v]+sz[v]-1, x)
}
```

**Reference — Java**
```java
static void subtreeAssign(int[] pos, int[] sz, int v, long x) {
    assignSum(1, 0, N - 1, pos[v], pos[v] + sz[v] - 1, x);
}
```

---

### Task 15 — Kth ancestor and "is u an ancestor of v" using HLD arrays

**Problem.** Support `isAncestor(u, v)` (is `u` an ancestor of `v`?) and `kthAncestor(v, k)` (the ancestor `k` levels above `v`, or `-1`).

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`. `isAncestor` `O(1)` using Euler intervals; `kthAncestor` `O(log N)` via chain jumps.

**Hint.** `isAncestor(u, v)` ⇔ `pos[u] ≤ pos[v] ≤ pos[u]+size[u]−1` (subtree interval containment). `kthAncestor`: repeatedly jump to `head` of the current node; if the target depth is within the current chain, return the node at that depth (use `pos` arithmetic within the chain), else jump to `parent[head]`.

**Reference — Python**
```python
def is_ancestor(pos, sz, u, v):
    return pos[u] <= pos[v] <= pos[u] + sz[u] - 1

def kth_ancestor(head, par, dep, pos, v, k):
    target = dep[v] - k
    if target < 0:
        return -1
    while dep[head[v]] > target:
        v = par[head[v]]
    # within this chain: node at depth `target` sits at pos[v] - (dep[v]-target)
    return v if dep[v] == target else _node_at_pos(pos[v] - (dep[v] - target))
```

**Reference — Go**
```go
func isAncestor(pos, sz []int, u, v int) bool {
	return pos[u] <= pos[v] && pos[v] <= pos[u]+sz[u]-1
}

func kthAncestor(head, par, dep []int, posToNode []int, posArr []int, v, k int) int {
	target := dep[v] - k
	if target < 0 {
		return -1
	}
	for dep[head[v]] > target {
		v = par[head[v]]
	}
	return posToNode[posArr[v]-(dep[v]-target)]
}
```

**Reference — Java**
```java
static boolean isAncestor(int[] pos, int[] sz, int u, int v) {
    return pos[u] <= pos[v] && pos[v] <= pos[u] + sz[u] - 1;
}
static int kthAncestor(int[] head, int[] par, int[] dep, int[] pos, int[] posToNode, int v, int k) {
    int target = dep[v] - k;
    if (target < 0) return -1;
    while (dep[head[v]] > target) v = par[head[v]];
    return posToNode[pos[v] - (dep[v] - target)];
}
```

---

## Benchmark Task

### Task B — Stress test: `10⁵` nodes, `5·10⁵` mixed path operations

**Problem.** Generate a random tree of `N = 10⁵` nodes and `Q = 5·10⁵` operations, each either `pathAdd(u, v, x)` or `pathSum(u, v)` (vertex values). Measure total wall-clock time and verify correctness against a brute-force `O(N)`-per-query oracle on a smaller `N = 2000` tree.

**Constraints.** `N = 10⁵`, `Q = 5·10⁵`. Target: well under 1 s in Go/Java, a few seconds in Python (use fast I/O and an iterative build). The brute-force oracle (small `N`) walks each path explicitly.

**What to measure.**
- Build time (two DFS + segment tree) — expect `O(N)`.
- Average chain segments per query — expect a small constant, far below `2 log₂ N`.
- Total query time / `Q` — expect roughly proportional to `log² N`.

**Validation harness — Python**
```python
import random

def brute_path(adj, par, val, u, v):
    # walk both up to a common ancestor using parent pointers + depth
    # (small N only)
    def depth(x):
        d = 0
        while par[x] != -1: x = par[x]; d += 1
        return d
    du, dv = depth(u), depth(v)
    s = 0; a, b = u, v
    while du > dv: s += val[a]; a = par[a]; du -= 1
    while dv > du: s += val[b]; b = par[b]; dv -= 1
    while a != b: s += val[a] + val[b]; a = par[a]; b = par[b]
    s += val[a]  # the LCA
    return s

def stress():
    n = 2000
    adj = [[] for _ in range(n)]
    par = [-1]*n
    for v in range(1, n):
        p = random.randint(0, v - 1)
        adj[p].append(v); adj[v].append(p); par[v] = p
    val = [random.randint(1, 100) for _ in range(n)]
    # Build HLD over (adj) with vertex values = val, then:
    # for many random (u, v): assert hld.path_sum(u, v) == brute_path(adj, par, val, u, v)
    # (wire to your PathSum class from interview.md Challenge 1)
    print("wire HLD here and assert equality against brute_path")

stress()
```

**Benchmark harness — Go (timing skeleton)**
```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	n := 100000
	q := 500000
	adj := make([][]int, n)
	for v := 1; v < n; v++ {
		p := rand.Intn(v)
		adj[p] = append(adj[p], v)
		adj[v] = append(adj[v], p)
	}
	// build HLD (use the iterative build from middle.md), seed values, then:
	start := time.Now()
	var acc int64
	for i := 0; i < q; i++ {
		u, v := rand.Intn(n), rand.Intn(n)
		if i%2 == 0 {
			// h.PathAdd(u, v, int64(rand.Intn(100)))
		} else {
			// acc += h.PathSum(u, v)
		}
		_ = u
		_ = v
	}
	fmt.Printf("queries done in %v (acc=%d)\n", time.Since(start), acc)
}
```

**Benchmark harness — Java (timing skeleton)**
```java
import java.util.*;

public class Bench {
    public static void main(String[] args) {
        int n = 100000, q = 500000;
        Random rnd = new Random(1);
        // build random tree + HLD (iterative build), seed values
        long start = System.nanoTime();
        long acc = 0;
        for (int i = 0; i < q; i++) {
            int u = rnd.nextInt(n), v = rnd.nextInt(n);
            if (i % 2 == 0) {
                // h.pathAdd(u, v, rnd.nextInt(100));
            } else {
                // acc += h.pathSum(u, v);
            }
        }
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.out.println("queries done in " + ms + " ms (acc=" + acc + ")");
    }
}
```

**Evaluation criteria.**
- Correct: every `pathSum` matches the brute-force oracle on the small tree.
- Fast: `5·10⁵` mixed ops complete in the target time for the language.
- Robust: an iterative build survives a deliberately deep (near-linear) tree without a stack overflow.
