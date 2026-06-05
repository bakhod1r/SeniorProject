# Heavy-Light Decomposition — Interview Preparation

Heavy-Light Decomposition (HLD) is a "tier-2" interview topic: you will rarely be asked to implement it cold in a 45-minute screen, but it shows up constantly in competitive programming, in senior/staff system-design discussions about tree-structured data, and as a follow-up when a candidate proposes "just use a segment tree" for a tree-path problem. This file is a graded question bank, behavioral/design prompts, and three runnable coding challenges in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Concept | Fact |
|---------|------|
| Heavy child | child with the **largest subtree** |
| Heavy edge | edge to the heavy child; all others **light** |
| Light edge key fact | `size(light child) ≤ size(parent) / 2` |
| Light edges on any root path | `≤ ⌊log₂ N⌋` |
| Chains touched by a path | `O(log N)` |
| Build | two DFS: (1) sizes + heavy child, (2) heads + positions |
| Linearization rule | DFS visits **heavy child first** → chains are contiguous |
| Subtree interval | `[pos[v], pos[v] + size[v] − 1]` |
| Path query cost | **O(log² N)** = O(log N) chains × O(log N) seg-tree |
| Subtree query cost | **O(log N)** (one interval) |
| LCA via HLD | jump `u = parent[head[u]]` while heads differ → **O(log N)** |
| Vertex values | final same-chain segment **includes** LCA: `[pos[lca], pos[deeper]]` |
| Edge values | final segment **skips** LCA: `[pos[lca]+1, pos[deeper]]` |
| Dynamic tree? | use **Link-Cut Tree**, not HLD |
| Pair/distance counting? | use **centroid decomposition**, not HLD |

Path loop skeleton:

```text
while head[u] != head[v]:
    if depth[head[u]] < depth[head[v]]: swap(u, v)
    op(pos[head[u]], pos[u]); u = parent[head[u]]
if depth[u] > depth[v]: swap(u, v)
op(pos[u] (+1 if edge values), pos[v])
```

---

## Junior Questions (12 Q&A)

**J1. What problem does Heavy-Light Decomposition solve?**
It answers queries and updates along **paths** between two nodes of a rooted tree — sum, min, max, range-add, range-assign — and also **subtree** aggregates, in logarithmic-ish time. A plain Segment Tree handles arrays; HLD is what makes a tree *behave* like a small number of arrays so a Segment Tree can be applied to tree paths.

**J2. What is the heavy child?**
For a node `v`, the heavy child is the child whose subtree contains the **most** nodes. The edge to it is the heavy edge; every other child-edge is light. Ties are broken arbitrarily.

**J3. Why is the heavy child defined by subtree *size*, not edge weight?**
Because size is what guarantees the halving property: a light child has at most half the parent's subtree, so any root path crosses at most `log N` light edges. Edge weights are the *data* you query; they have nothing to do with which child is heavy.

**J4. What is a chain?**
A maximal run of nodes connected by heavy edges, going straight down the tree. Each chain has a **head** (its top node, reached from its parent by a light edge, or the root).

**J5. Why does a path touch only `O(log N)` chains?**
You only switch chains when you cross a light edge. Each light edge halves the subtree size, and you can halve `N` only `log₂ N` times, so a root path has `≤ log N` light edges — hence `O(log N)` chains. A `u→v` path is two root paths joined at the LCA, so still `O(log N)`.

**J6. How does HLD turn a chain into something a Segment Tree can query?**
A DFS that visits the heavy child first numbers each node with a position `pos[v]`. Because the heavy child is numbered immediately after its parent, every chain occupies a **contiguous** block of positions. A Segment Tree over that numbering answers any single chain as a range query.

**J7. What is the time complexity of a path query?**
`O(log² N)`: there are `O(log N)` chain segments, and each is one `O(log N)` Segment Tree range query.

**J8. What is the time complexity of a subtree query, and why is it cheaper?**
`O(log N)`. A subtree is a single contiguous interval `[pos[v], pos[v]+size[v]−1]`, so it is just one Segment Tree query — no chain decomposition.

**J9. What are the two DFS passes in building HLD?**
Pass 1 computes subtree `size` and the `heavy` child of every node. Pass 2 walks the tree heavy-child-first, assigning each node its chain `head` and its `pos` in the array.

**J10. Where do node values go in the array?**
At `base[pos[v]] = value(v)`. The Segment Tree is built over `base`. So index `pos[v]` in the array corresponds to node `v` in the tree.

**J11. Can HLD compute the LCA?**
Yes, for free. Repeatedly take the node whose chain head is deeper and jump `u = parent[head[u]]`; when both share a head, the shallower node is the LCA. `O(log N)`, no Segment Tree needed.

**J12. When should you NOT use HLD?**
When the tree shape changes over time (use a Link-Cut Tree), when you only need subtree queries (a plain Euler tour is simpler), or when the question is about counting node pairs by distance (use centroid decomposition).

---

## Middle Questions (12 Q&A)

**M1. Prove that a light edge at least halves the subtree size.**
Let `c` be a light child of `v` and `hc` the heavy child. By definition `size(c) ≤ size(hc)`. The children's subtrees are disjoint inside `v`'s subtree, so `size(c) + size(hc) ≤ size(v)`. Adding `size(c) ≤ size(hc)` gives `2·size(c) ≤ size(v)`, so `size(c) ≤ size(v)/2`.

**M2. Where does the second `log` in `O(log² N)` come from?**
The first `log` is the number of chains a path crosses (structural). The second `log` is the cost of each Segment Tree range query on a chain. They multiply because each of the `O(log N)` chain segments is an independent Segment Tree query.

**M3. Explain the edge-vs-vertex off-by-one at the LCA.**
For **vertex** values, the final same-chain segment `[pos[lca], pos[deeper]]` correctly includes the LCA. For **edge** values stored at the child, `pos[lca]` holds the edge *above* the LCA, which is not on the path — so you must query `[pos[lca]+1, pos[deeper]]` and skip the LCA. If `u == v`, the path has no edges, so do nothing.

**M4. Why must the second DFS visit the heavy child first?**
So each chain occupies a contiguous range of positions. If a light child were numbered between a node and its heavy child, the chain would be split across non-adjacent indices and a single range query could no longer cover it.

**M5. How do you do a path *update* (add `x` to every node on a path)?**
Run the same chain loop but call a lazy Segment Tree `range_add(pos[head[u]], pos[u], x)` on each segment instead of a query. Still `O(log² N)`.

**M6. How do you support both path and subtree queries with one structure?**
The same `pos[]` numbering makes both chains *and* subtrees contiguous. A single Segment Tree serves path queries (chain loop) and subtree queries (one interval `[pos[v], pos[v]+size[v]−1]`).

**M7. Compare HLD to an Euler tour.**
An Euler tour (in-time/out-time) makes subtrees contiguous and answers subtree queries in `O(log N)`, but it **cannot** answer arbitrary path aggregates because a path is not a contiguous interval in the tour. HLD handles paths (`O(log² N)`) and subtrees (`O(log N)`). Use Euler tour when subtree-only; HLD when you need paths.

**M8. Compare HLD to centroid decomposition.**
Different query classes. Centroid decomposition answers "aggregate/count over all node *pairs*" (e.g. count pairs within distance `K`). HLD answers "aggregate along one given path." Centroid does not efficiently answer a single path query; HLD does not efficiently count all pairs.

**M9. Compare HLD to Link-Cut Trees.**
LCTs solve the same path problems in `O(log N)` *amortized* and support dynamic `link`/`cut`, but with a much larger constant and harder code. HLD is `O(log² N)` *worst-case* on a **static** tree. Prefer HLD unless the tree shape changes.

**M10. How do you compute `dist(u, v)` with HLD?**
`dist(u, v) = depth[u] + depth[v] − 2·depth[LCA(u, v)]`, using the HLD LCA in `O(log N)`.

**M11. Why is `heavy[]` independent of the values you store?**
The heavy child depends only on subtree *sizes* — the tree's *shape*. Updating a node's value never changes which child is heavy, so you never recompute the decomposition on a value update.

**M12. What's the worst-case tree for HLD, and what's the best?**
Worst: a "caterpillar"/balanced tree forcing `Θ(log N)` light edges per path. Best: a path graph — one chain, so a path query is a single `O(log N)` Segment Tree query. A star degenerates to many length-1 chains but still `O(log N)` per query.

---

## Senior Questions (10 Q&A)

**S1. How do you make HLD safe for concurrent readers?**
Split it into an **immutable topology layer** (`parent, depth, size, heavy, head, pos` — never changes after build) and a **mutable value layer** (the Segment Tree). The topology is lock-free for readers. Coordinate only the value layer — via an RW lock or copy-on-write/persistent snapshots, which give lock-free, point-in-time reads.

**S2. The tree occasionally changes shape. What do you do?**
HLD's topology is invalidated by any structural change. Either rebuild in `O(N)` using double-buffering (build the new HLD in the background, then atomically swap the active pointer), or, if changes are frequent, switch to a Link-Cut Tree.

**S3. Why does HLD not shard across machines?**
A single path query can cross `O(log N)` chains located anywhere in the tree, so you cannot partition the tree and answer arbitrary paths locally. Instead **replicate** the immutable topology, **shard by independent tree** (forest), or **tier by hotness**.

**S4. What's the most common production failure?**
Stack overflow from recursive DFS on a deep (near-linear) tree. Ship an **iterative** build. The second most common is the edge-vs-vertex off-by-one at the LCA.

**S5. How do you observe HLD health?**
Emit a `chain_segments_per_query` histogram (spikes reveal a pathological tree), `build_count`/`build_duration` (frequent rebuilds mean the tree isn't really static — consider LCT), and value-layer lock-wait time (read latency under write load).

**S6. Amortized vs worst-case — why does it matter for HLD vs LCT?**
HLD gives `O(log² N)` *worst-case per operation* — predictable tail latency. LCT gives `O(log N)` *amortized*, so a single op can spike to `O(N)`. For tail-latency SLOs, HLD's worst-case guarantee can be preferable despite the extra `log`.

**S7. How big can a single-node HLD get?**
Topology ≈ `6 × 4 × N` bytes; Segment Tree (int64 sum) ≈ `2–4 × 8 × N`. `N = 10⁷` ≈ 0.6 GB; `N = 10⁸` ≈ 6 GB — a single large machine. Beyond that, shard by tree or reconsider whether subtree-only (cheaper Euler tour) suffices.

**S8. How does HLD pair with persistence?**
Because the topology is immutable, a **persistent Segment Tree** value layer gives version history and point-in-time path queries with structural sharing in `O(log N)` per update — readers pin a snapshot and never lock.

**S9. When would you reduce HLD's `log²` to `log`?**
For invertible monoids (sum), the "subtree-add / path-query" prefix duality over a Fenwick can give `O(log N)` path queries. For min/max (non-invertible) the trick fails and you stay at `O(log² N)` or move to an LCT for amortized `O(log N)`.

**S10. CQRS view of HLD?**
Treat the durable **edge list + value log** as the write model and the HLD index as a derived, rebuildable **read model**. The index is a cache: throw it away and regenerate from the log on restart or schema change.

---

## Professional Questions (8 Q&A)

**P1. State and prove the light-edge bound precisely.**
For any node `u`, the number of light edges on the root→`u` path is `≤ ⌊log₂ N⌋`. Proof: each light step multiplies the current subtree size by `≤ ½` (Lemma: `size(light child) ≤ size(parent)/2`), heavy steps don't increase it, so after `L` light steps the size is `≤ N/2^L ≥ 1`, giving `2^L ≤ N`, i.e. `L ≤ ⌊log₂ N⌋`.

**P2. Prove chain contiguity.**
The heavy-first DFS assigns `pos(head)`, then immediately `pos(head)+1` to the heavy child, and so on down the chain (induction). Light subtrees branch off and are numbered *after* the whole heavy descent, so they get strictly larger indices. Hence the chain is exactly `[pos(head), pos(head)+k−1]`.

**P3. Why are the two logs in `O(log² N)` independent?**
The first counts contiguous intervals the path decomposes into — a property of the tree and the heavy rule. The second is the base structure's per-interval cost. Swap the base structure and the path cost becomes `O(log N · f(N))`: Fenwick `f=O(log N)`, merge-sort tree pushes "count ≤ x on path" to `O(log³ N)`.

**P4. How does an LCT achieve `O(log N)` where HLD pays `O(log² N)`?**
An LCT uses splay trees as the per-path structure; `access` exposes a root-to-node preferred path and its cost telescopes to `O(log N)` *amortized* via the splay potential argument. So it's `O(log N)` amortized (and dynamic), versus HLD's `O(log² N)` worst-case static.

**P5. Describe HLD's cache behavior.**
Build pass 1 (sizes/heavy) is cache-hostile (scattered parent/child indices). Query time: chain queries hit *contiguous* `base[]` ranges (chain = contiguous), so they're localized; subtree queries are a single contiguous interval (best case). The chain loop does `O(log N)` scattered reads into `head/parent/depth` — keep those as separate flat arrays (structure-of-arrays).

**P6. What's the average-case number of chains per path?**
Far below the `2 log N` worst case. Random trees touch a handful; a path graph touches 1; balanced trees approach `log N` but with length-1 chains. The `log²` is a safe upper bound rarely realized.

**P7. Space-time trade-offs for the base structure?**
Iterative Segment Tree (`2N`, best cache), recursive lazy (`4N`, range updates), Fenwick (lowest constant, sums), persistent (`N + Q log N`, versions), merge-sort tree (`N log N` space, `log³ N` order-statistics on paths). Topology arrays are always `Θ(N)`.

**P8. Name an open problem related to HLD.**
A practically fast, **worst-case** `O(log N)`, easy-to-implement, fully-dynamic path-aggregate structure. LCTs are amortized; top trees / Frederickson topology trees are worst-case `O(log N)` but have large constants and intricate code. Shaving the `log²` for non-invertible monoids (min/max) with updates, small constants, and `O(N)` space is the everyday open question.

---

## Behavioral / System-Design Questions (5)

**B1. "Design a service that answers path-aggregate queries over a 50M-node org tree, updated hourly, read millions of times per minute."**
Static shape (org changes are rare) + read-heavy → HLD. Split into immutable topology (built once, shared read-only, replicated to every query node) and a value layer (Segment Tree, updated hourly). Use copy-on-write/persistent snapshots so reads never block on the hourly update. On the rare reorg, rebuild via double-buffer and atomic swap. Shard by independent org tree if you have many tenants.

**B2. "A teammate proposes a Segment Tree for tree-path queries. What do you ask?"**
"A Segment Tree works on arrays — how are you mapping tree *paths* onto array intervals?" That surfaces the need for HLD (or Euler tour for subtree-only). Then clarify vertex vs edge values, whether the tree shape changes (→ LCT), and the expected query mix.

**B3. "Your path-query p99 latency spiked 50× while the median is flat. Diagnose."**
Median flat + p99 spike → a subset of queries touches far more chains. Check the `chain_segments_per_query` histogram: a pathological/caterpillar tree shape, or a hot subtree got deep. It's a *topology* issue, not a value-layer or lock issue. Mitigate by alerting on chain count and, if shape is drifting, consider a periodic rebalance or LCT.

**B4. "When would you choose LCT over HLD in production, knowing LCT is harder?"**
Only when the tree shape genuinely changes frequently enough that `O(N)` HLD rebuilds dominate, *and* you can tolerate amortized (not worst-case) latency. If shape is static or changes rarely, HLD's simpler code and worst-case guarantee win.

**B5. "How do you test an HLD implementation you can't fully trust?"**
Brute-force oracle: on small random trees, compare `path_query` against an `O(N)` path walk and `subtree_query` against a direct subtree sum, across thousands of random query/update sequences. Add explicit edge-cases: `N=1`, `path(u,u)`, path graph, star, and both vertex and edge value modes.

---

## Coding Challenges (Go / Java / Python)

### Challenge 1 — Path Sum with Point Updates (vertex values)

Given a tree of `N` nodes with values, support: `update(v, x)` set node `v`'s value to `x`; `query(u, v)` return the sum of values on the path `u…v`.

#### Go
```go
package main

import "fmt"

type HLD struct {
	n                                int
	adj                              [][]int
	par, dep, hv, sz, head, pos      []int
	seg                              []int64
	cur                              int
}

func New(n int) *HLD {
	h := &HLD{n: n, adj: make([][]int, n),
		par: make([]int, n), dep: make([]int, n), hv: make([]int, n),
		sz: make([]int, n), head: make([]int, n), pos: make([]int, n),
		seg: make([]int64, 2*n)}
	for i := range h.hv {
		h.hv[i] = -1
	}
	return h
}
func (h *HLD) Edge(u, v int) { h.adj[u] = append(h.adj[u], v); h.adj[v] = append(h.adj[v], u) }
func (h *HLD) build(root int) {
	order, st, vis := []int{}, []int{root}, make([]bool, h.n)
	vis[root] = true
	h.par[root] = -1
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		order = append(order, u)
		for _, w := range h.adj[u] {
			if !vis[w] {
				vis[w] = true
				h.par[w] = u
				h.dep[w] = h.dep[u] + 1
				st = append(st, w)
			}
		}
	}
	for i := len(order) - 1; i >= 0; i-- {
		u := order[i]
		h.sz[u] = 1
		best := 0
		for _, w := range h.adj[u] {
			if w != h.par[u] {
				h.sz[u] += h.sz[w]
				if h.sz[w] > best {
					best = h.sz[w]
					h.hv[u] = w
				}
			}
		}
	}
	type fr struct{ node, hd int }
	s2 := []fr{{root, root}}
	for len(s2) > 0 {
		f := s2[len(s2)-1]
		s2 = s2[:len(s2)-1]
		u := f.node
		h.head[u] = f.hd
		h.pos[u] = h.cur
		h.cur++
		for _, w := range h.adj[u] {
			if w != h.par[u] && w != h.hv[u] {
				s2 = append(s2, fr{w, w})
			}
		}
		if h.hv[u] != -1 {
			s2 = append(s2, fr{h.hv[u], f.hd})
		}
	}
}
func (h *HLD) Update(v int, x int64) {
	i := h.pos[v] + h.n
	h.seg[i] = x
	for i >>= 1; i >= 1; i >>= 1 {
		h.seg[i] = h.seg[2*i] + h.seg[2*i+1]
	}
}
func (h *HLD) q(l, r int) int64 {
	var res int64
	for l, r = l+h.n, r+h.n+1; l < r; l, r = l>>1, r>>1 {
		if l&1 == 1 {
			res += h.seg[l]
			l++
		}
		if r&1 == 1 {
			r--
			res += h.seg[r]
		}
	}
	return res
}
func (h *HLD) Query(u, v int) int64 {
	var res int64
	for h.head[u] != h.head[v] {
		if h.dep[h.head[u]] < h.dep[h.head[v]] {
			u, v = v, u
		}
		res += h.q(h.pos[h.head[u]], h.pos[u])
		u = h.par[h.head[u]]
	}
	if h.dep[u] > h.dep[v] {
		u, v = v, u
	}
	res += h.q(h.pos[u], h.pos[v])
	return res
}
func main() {
	h := New(7)
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 3}, {1, 4}, {2, 5}, {2, 6}} {
		h.Edge(e[0], e[1])
	}
	h.build(0)
	vals := []int64{1, 2, 3, 4, 5, 6, 7}
	for i, x := range vals {
		h.Update(i, x)
	}
	fmt.Println(h.Query(3, 6)) // 4+2+1+3+7 = 17
	h.Update(0, 100)
	fmt.Println(h.Query(3, 6)) // 4+2+100+3+7 = 116
}
```

#### Java
```java
import java.util.*;

public class PathSum {
    int n, cur = 0;
    List<Integer>[] adj;
    int[] par, dep, hv, sz, head, pos;
    long[] seg;

    @SuppressWarnings("unchecked")
    PathSum(int n) {
        this.n = n; adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        par = new int[n]; dep = new int[n]; hv = new int[n];
        sz = new int[n]; head = new int[n]; pos = new int[n];
        seg = new long[2 * n]; Arrays.fill(hv, -1);
    }
    void edge(int u, int v) { adj[u].add(v); adj[v].add(u); }
    void build(int root) {
        int[] order = new int[n]; int c = 0; boolean[] vis = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>(); st.push(root); vis[root] = true; par[root] = -1;
        while (!st.isEmpty()) { int u = st.pop(); order[c++] = u;
            for (int w : adj[u]) if (!vis[w]) { vis[w]=true; par[w]=u; dep[w]=dep[u]+1; st.push(w); } }
        for (int i = c - 1; i >= 0; i--) { int u = order[i]; sz[u]=1; int best=0;
            for (int w : adj[u]) if (w != par[u]) { sz[u]+=sz[w]; if (sz[w]>best){best=sz[w];hv[u]=w;} } }
        Deque<int[]> s2 = new ArrayDeque<>(); s2.push(new int[]{root, root});
        while (!s2.isEmpty()) { int[] f = s2.pop(); int u=f[0],hd=f[1]; head[u]=hd; pos[u]=cur++;
            for (int w : adj[u]) if (w!=par[u] && w!=hv[u]) s2.push(new int[]{w,w});
            if (hv[u]!=-1) s2.push(new int[]{hv[u], hd}); }
    }
    void update(int v, long x) { int i = pos[v]+n; seg[i]=x;
        for (i>>=1; i>=1; i>>=1) seg[i]=seg[2*i]+seg[2*i+1]; }
    long q(int l, int r) { long res=0;
        for (l+=n, r+=n+1; l<r; l>>=1, r>>=1) { if ((l&1)==1) res+=seg[l++]; if ((r&1)==1) res+=seg[--r]; }
        return res; }
    long query(int u, int v) { long res=0;
        while (head[u]!=head[v]) { if (dep[head[u]]<dep[head[v]]){int t=u;u=v;v=t;}
            res+=q(pos[head[u]],pos[u]); u=par[head[u]]; }
        if (dep[u]>dep[v]){int t=u;u=v;v=t;} res+=q(pos[u],pos[v]); return res; }
    public static void main(String[] a) {
        PathSum h = new PathSum(7);
        int[][] e = {{0,1},{0,2},{1,3},{1,4},{2,5},{2,6}};
        for (int[] x : e) h.edge(x[0], x[1]);
        h.build(0);
        long[] vals = {1,2,3,4,5,6,7};
        for (int i = 0; i < 7; i++) h.update(i, vals[i]);
        System.out.println(h.query(3, 6)); // 17
        h.update(0, 100);
        System.out.println(h.query(3, 6)); // 116
    }
}
```

#### Python
```python
class PathSum:
    def __init__(self, n):
        self.n = n
        self.adj = [[] for _ in range(n)]
        self.par = [-1]*n; self.dep = [0]*n; self.hv = [-1]*n
        self.sz = [0]*n; self.head = [0]*n; self.pos = [0]*n
        self.seg = [0]*(2*n); self.cur = 0
    def edge(self, u, v): self.adj[u].append(v); self.adj[v].append(u)
    def build(self, root):
        order, st, vis = [], [root], [False]*self.n; vis[root] = True
        while st:
            u = st.pop(); order.append(u)
            for w in self.adj[u]:
                if not vis[w]:
                    vis[w]=True; self.par[w]=u; self.dep[w]=self.dep[u]+1; st.append(w)
        for u in reversed(order):
            self.sz[u]=1; best=0
            for w in self.adj[u]:
                if w!=self.par[u]:
                    self.sz[u]+=self.sz[w]
                    if self.sz[w]>best: best=self.sz[w]; self.hv[u]=w
        s2 = [(root, root)]
        while s2:
            u, hd = s2.pop(); self.head[u]=hd; self.pos[u]=self.cur; self.cur+=1
            for w in self.adj[u]:
                if w!=self.par[u] and w!=self.hv[u]: s2.append((w,w))
            if self.hv[u]!=-1: s2.append((self.hv[u], hd))
    def update(self, v, x):
        i = self.pos[v]+self.n; self.seg[i]=x; i >>= 1
        while i>=1: self.seg[i]=self.seg[2*i]+self.seg[2*i+1]; i >>= 1
    def q(self, l, r):
        res=0; l+=self.n; r+=self.n+1
        while l<r:
            if l&1: res+=self.seg[l]; l+=1
            if r&1: r-=1; res+=self.seg[r]
            l>>=1; r>>=1
        return res
    def query(self, u, v):
        res=0
        while self.head[u]!=self.head[v]:
            if self.dep[self.head[u]]<self.dep[self.head[v]]: u,v=v,u
            res+=self.q(self.pos[self.head[u]], self.pos[u]); u=self.par[self.head[u]]
        if self.dep[u]>self.dep[v]: u,v=v,u
        res+=self.q(self.pos[u], self.pos[v]); return res

if __name__ == "__main__":
    h = PathSum(7)
    for u, v in [(0,1),(0,2),(1,3),(1,4),(2,5),(2,6)]:
        h.edge(u, v)
    h.build(0)
    for i, x in enumerate([1,2,3,4,5,6,7]): h.update(i, x)
    print(h.query(3, 6))  # 17
    h.update(0, 100)
    print(h.query(3, 6))  # 116
```

### Challenge 2 — Maximum Edge Weight on a Path (edge values)

Each edge has a weight. Answer `maxEdge(u, v)` = the maximum edge weight on the path `u…v`. This exercises **edge values** and the **skip-the-LCA** rule. (Build as in Challenge 1; replace the sum Segment Tree with a max tree and store edge `(parent(c), c)` at `pos[c]`.)

**Key differences from Challenge 1:**
- Identity is `−∞`; combine is `max`.
- Store each edge's weight at the **child's** position.
- The final same-chain segment is `[pos[lca]+1, pos[deeper]]` (skip the LCA); if `u == v`, return `−∞`.

#### Python (reference; Go/Java mirror the structure)
```python
NEG = -(1 << 60)

class MaxEdge:
    def __init__(self, n):
        self.n = n; self.adj = [[] for _ in range(n)]
        self.par=[-1]*n; self.dep=[0]*n; self.hv=[-1]*n
        self.sz=[0]*n; self.head=[0]*n; self.pos=[0]*n
        self.seg=[NEG]*(2*n); self.cur=0
    def edge(self, u, v, w): self.adj[u].append((v, w)); self.adj[v].append((u, w))
    def build(self, root):
        order, st, vis = [], [root], [False]*self.n; vis[root]=True
        wp = [0]*self.n  # weight of edge to parent
        while st:
            u = st.pop(); order.append(u)
            for w, wt in self.adj[u]:
                if not vis[w]:
                    vis[w]=True; self.par[w]=u; self.dep[w]=self.dep[u]+1; wp[w]=wt; st.append(w)
        for u in reversed(order):
            self.sz[u]=1; best=0
            for w, _ in self.adj[u]:
                if w!=self.par[u]:
                    self.sz[u]+=self.sz[w]
                    if self.sz[w]>best: best=self.sz[w]; self.hv[u]=w
        s2=[(root, root)]
        while s2:
            u, hd = s2.pop(); self.head[u]=hd; self.pos[u]=self.cur; self.cur+=1
            for w, _ in self.adj[u]:
                if w!=self.par[u] and w!=self.hv[u]: s2.append((w, w))
            if self.hv[u]!=-1: s2.append((self.hv[u], hd))
        for v in range(self.n):
            if v != root: self._set(self.pos[v], wp[v])
    def _set(self, i, x):
        i+=self.n; self.seg[i]=x; i>>=1
        while i>=1: self.seg[i]=max(self.seg[2*i], self.seg[2*i+1]); i>>=1
    def _qmax(self, l, r):
        res=NEG; l+=self.n; r+=self.n+1
        while l<r:
            if l&1: res=max(res, self.seg[l]); l+=1
            if r&1: r-=1; res=max(res, self.seg[r])
            l>>=1; r>>=1
        return res
    def max_edge(self, u, v):
        res=NEG
        while self.head[u]!=self.head[v]:
            if self.dep[self.head[u]]<self.dep[self.head[v]]: u,v=v,u
            res=max(res, self._qmax(self.pos[self.head[u]], self.pos[u])); u=self.par[self.head[u]]
        if self.dep[u]>self.dep[v]: u,v=v,u
        if u!=v: res=max(res, self._qmax(self.pos[u]+1, self.pos[v]))
        return res

if __name__ == "__main__":
    g = MaxEdge(6)
    for u, v, w in [(0,1,5),(1,2,3),(1,3,8),(0,4,2),(4,5,9)]:
        g.edge(u, v, w)
    g.build(0)
    print(g.max_edge(2, 3))  # path 2-1-3: max(3,8)=8
    print(g.max_edge(2, 5))  # 2-1-0-4-5: max(3,5,2,9)=9
```

#### Go (max_edge core)
```go
func (h *HLD) MaxEdge(u, v int) int64 {
	res := NEG
	for h.head[u] != h.head[v] {
		if h.dep[h.head[u]] < h.dep[h.head[v]] {
			u, v = v, u
		}
		res = max64(res, h.qmax(h.pos[h.head[u]], h.pos[u]))
		u = h.par[h.head[u]]
	}
	if h.dep[u] > h.dep[v] {
		u, v = v, u
	}
	if u != v { // edge values: skip the LCA
		res = max64(res, h.qmax(h.pos[u]+1, h.pos[v]))
	}
	return res
}
```

#### Java (maxEdge core)
```java
long maxEdge(int u, int v) {
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

### Challenge 3 — Count Nodes Equal to a Target Value on a Path

Given a tree where each node has a small color in `[0, C)`, support `query(u, v, c)` = how many nodes on the path `u…v` have color `c`. (Approach: maintain `C` Fenwick/segment trees, or a single segment tree of small frequency arrays; for small `C`, one bit per color. Vertex values → include the LCA.)

**Hint:** With small `C`, store a count vector per position and let the Segment Tree merge vectors; the path loop sums the vectors over the `O(log N)` chain segments and reads component `c`. Total `O(C log² N)` per query. For point color-changes, update one position in `O(C log N)`.

#### Python (single-color-per-query via `C` Fenwicks over `pos`)
```python
class ColorPath:
    def __init__(self, n, C):
        self.n = n; self.C = C
        self.adj = [[] for _ in range(n)]
        self.par=[-1]*n; self.dep=[0]*n; self.hv=[-1]*n
        self.sz=[0]*n; self.head=[0]*n; self.pos=[0]*n; self.cur=0
        self.bit = [[0]*(n+1) for _ in range(C)]  # one Fenwick per color
        self.color = [0]*n
    def edge(self, u, v): self.adj[u].append(v); self.adj[v].append(u)
    def build(self, root, colors):
        order, st, vis = [], [root], [False]*self.n; vis[root]=True
        while st:
            u = st.pop(); order.append(u)
            for w in self.adj[u]:
                if not vis[w]:
                    vis[w]=True; self.par[w]=u; self.dep[w]=self.dep[u]+1; st.append(w)
        for u in reversed(order):
            self.sz[u]=1; best=0
            for w in self.adj[u]:
                if w!=self.par[u]:
                    self.sz[u]+=self.sz[w]
                    if self.sz[w]>best: best=self.sz[w]; self.hv[u]=w
        s2=[(root, root)]
        while s2:
            u, hd = s2.pop(); self.head[u]=hd; self.pos[u]=self.cur; self.cur+=1
            for w in self.adj[u]:
                if w!=self.par[u] and w!=self.hv[u]: s2.append((w, w))
            if self.hv[u]!=-1: s2.append((self.hv[u], hd))
        for v in range(self.n): self.set_color(v, colors[v])
    def _add(self, c, i, delta):
        i += 1
        while i <= self.n:
            self.bit[c][i] += delta; i += i & (-i)
    def _sum(self, c, i):  # prefix sum [0..i]
        i += 1; s = 0
        while i > 0:
            s += self.bit[c][i]; i -= i & (-i)
        return s
    def _range(self, c, l, r):  # inclusive
        return self._sum(c, r) - (self._sum(c, l-1) if l > 0 else 0)
    def set_color(self, v, c):
        old = self.color[v]
        if old == c: return
        self._add(old, self.pos[v], -1) if False else None
        # remove old, add new
        self._add(self.color[v], self.pos[v], -1)
        self.color[v] = c
        self._add(c, self.pos[v], 1)
    def query(self, u, v, c):
        res = 0
        while self.head[u] != self.head[v]:
            if self.dep[self.head[u]] < self.dep[self.head[v]]: u, v = v, u
            res += self._range(c, self.pos[self.head[u]], self.pos[u])
            u = self.par[self.head[u]]
        if self.dep[u] > self.dep[v]: u, v = v, u
        res += self._range(c, self.pos[u], self.pos[v])  # vertex values: include LCA
        return res

if __name__ == "__main__":
    cp = ColorPath(7, 3)
    for u, v in [(0,1),(0,2),(1,3),(1,4),(2,5),(2,6)]:
        cp.edge(u, v)
    # set initial colors to 0, then assign
    cp.build(0, [0,0,0,0,0,0,0])
    cols = [1,2,1,1,0,2,1]
    for i, c in enumerate(cols): cp.set_color(i, c)
    print(cp.query(3, 6, 1))  # path 3-1-0-2-6 colors [1,2,1,1,1] → count of 1 = 4
```

*(Go and Java versions follow the identical structure: `C` Fenwick arrays indexed by `pos`, the same chain loop, vertex semantics including the LCA.)*

---

## Common Pitfalls

1. **Edge-vs-vertex off-by-one at the LCA** — the #1 HLD bug. Vertex: include LCA. Edge: `pos[lca]+1`, and `u==v` → empty.
2. **Light children before the heavy child** in the second DFS — chains stop being contiguous; everything breaks silently.
3. **Lifting the shallower head** — compare `depth[head[u]]` vs `depth[head[v]]` *inside* the loop, then jump `u = parent[head[u]]`.
4. **Recursive DFS on deep trees** — stack overflow at `N ~ 10⁵`; use iterative build.
5. **Claiming path queries are `O(log N)`** — they're `O(log² N)`.
6. **Recomputing `heavy[]` after a value update** — heavy depends on *shape*, never on values.
7. **Mismatched segment-tree size** (`2N` iterative vs `4N` recursive).

---

## What Interviewers Are Really Testing

- **Do you know when a tree problem needs HLD at all** — vs an Euler tour (subtree-only), centroid decomposition (pair counting), or an LCT (dynamic)? Choosing the right tool is the real signal.
- **Can you articulate the `O(log N)` chains argument** — the halving lemma is the heart of the topic; reproducing it shows you understand *why* HLD works, not just *that* it does.
- **Do you handle edge vs vertex values correctly** — the LCA off-by-one separates people who've implemented HLD from those who've only read about it.
- **Do you see the layering** — HLD routes a tree op into `O(log N)` array intervals fed to a Segment Tree; the `log²` is `chains × seg-tree`. Seeing the composition lets you swap base structures (Fenwick, lazy, persistent, merge-sort tree) on demand.
- **Senior+: do you reason about it as a system** — immutable topology + mutable value layer, rebuild-on-shape-change, worst-case vs amortized latency, and why it doesn't shard.
