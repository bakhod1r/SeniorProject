# Centroid Decomposition — Professional Level

> **One-line summary:** A rigorous treatment of the centroid: existence and the `≤ N/2` bound (Jordan), the `O(log N)` centroid-tree height as a direct consequence of strict halving, the path-decomposition theorem (every `u–v` path crosses the centroid-tree LCA of `u, v` exactly once), and the `O(N log N)` build bound from the fact that each vertex appears in `O(log N)` levels.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [Existence and the ≤ N/2 Property](#2-existence-and-the--n2-property)
3. [O(log N) Centroid-Tree Depth](#3-olog-n-centroid-tree-depth)
4. [The Path-Decomposition Theorem](#4-the-path-decomposition-theorem)
5. [Build Complexity O(N log N)](#5-build-complexity-on-log-n)
6. [Cache Behavior](#6-cache-behavior)
7. [Average-Case](#7-average-case)
8. [Space-Time Trade-offs](#8-space-time-trade-offs)
9. [Worked Decomposition Trace](#9-worked-decomposition-trace)
10. [Reference Implementations](#10-reference-implementations)
11. [Comparison](#11-comparison)
12. [Open Problems](#12-open-problems)
13. [Summary](#13-summary)

---

## 1. Formal Definition

Let `T = (V, E)` be a tree with `|V| = N`. For a vertex `v`, removing `v` yields a forest `T − v` whose components we denote `C₁(v), …, C_{deg(v)}(v)`.

**Definition (centroid).** A vertex `c ∈ V` is a **centroid** of `T` if
```
max_i |Cᵢ(c)|  ≤  ⌊N / 2⌋.
```
Equivalently, define the *weight* `w(v) = max_i |Cᵢ(v)|`. A centroid is a vertex minimizing `w`. (The classical statement uses `⌊N/2⌋`; some texts use `N/2` with real division — they coincide because component sizes are integers and the bound is tight only when `N` is even.)

**Definition (centroid decomposition).** Recursively: let `c` be a centroid of `T`. The centroid tree `CT(T)` is the tree rooted at `c` whose subtrees are `CT(C₁(c)), …, CT(C_k(c))`, with each child centroid linked to `c` as its parent.

**Definition (centroid level).** `level(v)` is the depth of `v` in `CT(T)` (root at depth 0). Equivalently, the number of decomposition steps before `v` itself becomes a centroid.

We root `T` arbitrarily to compute subtree sizes; the centroid notion is *root-independent* (it depends only on `T`, not on the chosen root).

---

## 2. Existence and the ≤ N/2 Property

**Theorem 1 (Jordan, 1869).** Every tree `T` with `N ≥ 1` vertices has at least one centroid, and at most two. If two centroids exist, they are adjacent.

**Proof of existence and the bound.** Root `T` at an arbitrary vertex `r` and compute subtree sizes `s(v)`. Start at `r` and repeatedly move to the child `u` whose subtree is *strictly* largest **whenever** `s(u) > ⌊N/2⌋`. We claim this process halts at a centroid.

Consider the vertex `c` where it halts: every child `u` of `c` has `s(u) ≤ ⌊N/2⌋`. The component of `T − c` going "upward" (toward the root) has size `N − s(c)`. We must show `N − s(c) ≤ ⌊N/2⌋`.

The process moved into `c` because, at `c`'s parent `p`, the subtree `s(c) > ⌊N/2⌋` (that is the only reason we descended into `c`). Hence `s(c) > ⌊N/2⌋ ≥ N/2`, so `N − s(c) < N/2 ≤ ⌊N/2⌋ + 1`, giving `N − s(c) ≤ ⌊N/2⌋`. Combined with every child component `≤ ⌊N/2⌋`, *all* components of `T − c` are `≤ ⌊N/2⌋`. Thus `c` is a centroid. ∎

**Proof of "at most two, and adjacent."** Suppose `c₁` and `c₂` are both centroids. Orient the edge between adjacent vertices toward the larger side. For any vertex `v`, the unique edge incident to `v` lying on the path toward the *heavy* side points "down" the weight gradient. A centroid is a local minimum of `w`. One shows `w` is "unimodal" along any path: it strictly decreases toward a centroid and strictly increases away from it. Two distinct local minima of a unimodal function on a path tree can only be adjacent (where the function value ties). If `N` is odd there is a unique centroid; if `N` is even there may be two adjacent centroids, each leaving one component of exactly `N/2` on the side of the other. A full unimodality argument: for adjacent `u, v`, `w(u) − w(v)` changes sign by exactly the edge orientation, so at most one adjacent pair can tie at the minimum. ∎

**Corollary.** The centroid leaves *every* component with `≤ ⌊N/2⌋` vertices — this halving is what drives all subsequent complexity bounds.

---

## 3. O(log N) Centroid-Tree Depth

**Theorem 2.** The height of `CT(T)` is at most `⌊log₂ N⌋ + 1`, i.e. `O(log N)`.

**Proof.** Let `v` be any vertex and let `N₀ > N₁ > … > N_{L}` be the sizes of the nested sequence of components that contain `v` at successive decomposition levels, where `N₀ = N` and `v` becomes a centroid at level `L` (so `N_L = 1` at the moment `v` is chosen, or `v` is in the size-1 residual). By Theorem 1's bound, at each step the component containing `v` is one of the `≤ ⌊Nᵢ/2⌋` pieces, hence
```
N_{i+1} ≤ ⌊Nᵢ / 2⌋ ≤ Nᵢ / 2.
```
Therefore `N_i ≤ N / 2ⁱ`. Since `N_L ≥ 1`, we need `N / 2^L ≥ 1`, i.e. `L ≤ log₂ N`. Counting the root level, `level(v) = L ≤ ⌊log₂ N⌋`, and the height is `≤ ⌊log₂ N⌋ + 1`. ∎

**Corollary (per-vertex level membership).** Each vertex belongs to exactly `level(v) + 1 ≤ ⌊log₂ N⌋ + 1 = O(log N)` centroid components — one per level it survives. This is the quantity that bounds total work.

---

## 4. The Path-Decomposition Theorem

This is the structural theorem that makes centroid decomposition *useful*.

**Theorem 3 (Path–LCA).** For any two vertices `u, v ∈ V`, let `c = LCA_{CT}(u, v)` be their lowest common ancestor in the centroid tree. Then:

1. `c` lies on the unique tree path `P(u, v)` in `T`.
2. `c` is the **unique** vertex on `P(u, v)` that is a centroid-tree ancestor of both `u` and `v`.
3. Equivalently, `c` is the *highest-level* (closest-to-root) centroid lying on `P(u, v)`.

**Proof.**
*(Existence / part 1.)* Consider the decomposition levels. Let `c` be the first centroid (smallest level) whose removal separates `u` from `v` — i.e. the first level at which `u` and `v` cease to be in the same component (this includes the case where the chosen centroid *is* `u` or `v`). Before that level, `u` and `v` are in a common component `C`, so the whole path `P(u, v)` lies in `C` (a component is connected and a tree path between two of its vertices stays inside it). At the level where `c` is the centroid of `C`, removing `c` splits `u` and `v` apart, which forces `c ∈ P(u, v)` (the only way deleting a single vertex disconnects two vertices in a tree is if that vertex lies on the path between them). So `c` lies on `P(u, v)`.

*(`c` is the centroid-tree LCA / part 2.)* At every level `< level(c)`, `u` and `v` share a component, hence share the same centroid ancestor at that level — these are the common ancestors of `u` and `v` in `CT`. At level `level(c)`, the centroid `c` is still a common ancestor (both `u` and `v` are in `C`, whose centroid is `c`). At level `> level(c)`, `u` and `v` are in different components, so they have no further common ancestor. Thus `c` is the deepest common ancestor — `LCA_{CT}(u, v)`.

*(Uniqueness / part 3.)* Suppose another centroid `c' ≠ c` on `P(u, v)` were also a common centroid-tree ancestor of both `u` and `v`. A centroid-tree ancestor of `u` is, by construction, a vertex whose component (at its level) contains `u`. If `c'` is an ancestor of both, then at level `level(c')` both `u, v` lie in `c'`'s component, so they were not yet separated — meaning `level(c') < level(c)` or `c' = c`. But then `c'` is an ancestor of `c` in `CT`; an ancestor of the LCA that also lies on `P(u,v)` cannot be a *common descendant-side* centroid on the path without coinciding with `c`. Removing `c` already separated `u, v`; any higher centroid `c'` on the path is an ancestor of `c`, and on the path the centroids form a chain ordered by level, with exactly one of them — `c` — being the separating one. Hence `c` is the unique such vertex. ∎

**Algorithmic consequence (no double counting).** Define, for each unordered pair `{u, v}`, the "owner" centroid `own(u, v) = LCA_{CT}(u, v)`. The map `own` partitions all `C(N, 2)` pairs (and hence all simple paths) by owner. Therefore
```
Σ_{c ∈ V}  ( # paths whose owner is c )  =  total # paths,
```
each path counted **exactly once**. The per-centroid count "paths through `c` that lie in `c`'s component, with the two endpoints in different child branches (or one endpoint = c)" is precisely the set of paths owned by `c`. The inclusion–exclusion subtraction (whole component minus each branch) computes exactly this set, which is why it neither misses nor double-counts.

---

## 5. Build Complexity O(N log N)

**Theorem 4.** The centroid tree can be built in `O(N log N)` time and `O(N)` space.

**Proof.** Finding the centroid of a component of size `n` costs `O(n)`: one DFS to compute residual subtree sizes, one descent to the centroid. Removing it and recursing partitions the component into pieces of total size `n − 1 < n`.

Charge the `O(n)` cost of processing a component to the vertices in that component: each vertex in a size-`n` component pays `O(1)`. By the Corollary to Theorem 2, a fixed vertex `v` is a member of exactly `level(v) + 1 = O(log N)` components across the whole decomposition. Hence the total charge to `v` over all levels is `O(log N)`, and summing over all vertices,
```
total time = Σ_v O(log N) = O(N log N).
```
Space is `O(N)` for `adj`, `size`, `removed`, `cparent`; the recursion stack is `O(height of size-DFS)`, which is `O(N)` in the worst case (a path tree) unless an explicit-stack iterative DFS bounds it. The *output* (centroid tree) is `O(N)` edges. ∎

**Tightness.** The bound is tight: on a balanced tree each of the `log N` levels does `Θ(N)` aggregate work, giving `Θ(N log N)`. Lower bound: any algorithm that, for each level, recomputes sizes over the residual tree must touch each surviving vertex once per level, and there are `Θ(N log N)` (vertex, level) incidences on a balanced tree.

**Note on weighted variants and storage.** If, per centroid, we *store* the distance of every component vertex (for radius/count queries), we materialize `Σ_v O(log N) = O(N log N)` distance entries, matching the time bound and giving `O(N log N)` space for that augmented index.

---

## 6. Cache Behavior

- The build is **DFS-bound**: subtree-size and centroid-finding passes traverse adjacency lists. With CSR (compressed-sparse-row) adjacency, each level streams the residual edges; cache behavior is that of a tree DFS — poor temporal locality across distant vertices but good when sibling edges are contiguous.
- The `removed[]` guard introduces a branch per neighbor; on skewed trees the branch is predictable (mostly "not removed" early, mostly "removed" late), which is friendly to branch predictors.
- The augmented per-centroid sorted distance arrays are **scan-friendly**: queries binary-search contiguous arrays, giving good locality for the radius-count pattern.
- Storing `cparent[]` as a flat `int` array makes the `O(log N)` ancestor walk a pointer-chase of length `≤ height`; for hot queries this is a handful of cache lines.

---

## 7. Average-Case

- On a **uniformly random labeled tree** (Cayley), the expected height is still `O(log N)` for the centroid tree (the `≤ N/2` halving is worst-case, not average — the centroid tree height is `O(log N)` *always*). What varies by input is the *constant*: balanced inputs reach the `⌊log₂ N⌋` bound, while bushy random trees often have slightly smaller centroid-tree height.
- Average per-component fan-out equals the average degree of centroids, which is `< 2` amortized (the centroid tree has `N − 1` edges over `N` nodes like any tree).
- For counting applications, the **distribution of distances** per centroid governs the constant in `O(N log N)` vs `O(N log² N)`: when distances are bounded by a small diameter, frequency-array counting beats sorting.

---

## 8. Space-Time Trade-offs

| Variant | Time | Space | Supports |
|---------|------|-------|----------|
| Plain CT (`cparent[]` only) | build `O(N log N)` | `O(N)` | static counting via on-the-fly DFS; ancestor walks |
| CT + per-vertex ancestor distances | build `O(N log N)` | `O(N log N)` | `O(log N)` distance to any ancestor; nearest-marked |
| CT + per-centroid sorted distance arrays | build `O(N log N)` | `O(N log N)` | `O(log² N)` radius/count queries |
| CT + per-centroid Fenwick over distance | build `O(N log N)` | `O(N log N)` | dynamic count-within-radius, `O(log² N)` update |

The recurring trade is **memory `O(N)` vs `O(N log N)`**: materializing per-level distance data costs the extra `log N` factor in space but unlocks `O(log² N)` queries/updates without per-query DFS.

---

## 9. Worked Decomposition Trace

We make every claim above concrete on a fixed 9-vertex tree. Vertices `0..8`, edges:
```
0–1, 1–2, 1–3, 3–4, 3–5, 5–6, 5–7, 7–8
```

### 9.1 The input tree (rooted at 0 for drawing)

```
            0
            |
            1
           / \
          2   3
             / \
            4   5
               / \
              6   7
                   \
                    8
```
`N = 9`, so `⌊N/2⌋ = 4`. A centroid must leave **every** component with ≤ 4 vertices.

### 9.2 Level 0 — find the centroid of the whole tree

Root at `0`, compute subtree sizes `s(v)`:

| v | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| s(v) | 9 | 8 | 1 | 6 | 1 | 4 | 1 | 2 | 1 |

Descend from `0`: child `1` has `s=8 > 4` → move to `1`. At `1`, child `3` has `s=6 > 4` → move to `3`. At `3`, children are `4` (`s=1`), `5` (`s=4`); none exceed 4. The "up" component from `3` is `N − s(3) = 9 − 6 = 3 ≤ 4`. **Centroid = 3.**

Check: removing `3` yields components `{4}` (size 1), `{5,6,7,8}` (size 4), `{0,1,2}` (size 3). Max = 4 = ⌊9/2⌋. Valid, and tight.

### 9.3 Level 1 — recurse into the three components

- Component `{0,1,2}` (path `2–1–0`): sizes from any root give centroid **1** (removing 1 → `{0}`,`{2}`, both ≤1).
- Component `{4}`: trivial centroid **4**.
- Component `{5,6,7,8}` (edges `5–6, 5–7, 7–8`): root at 5, `s(5)=4, s(6)=1, s(7)=2, s(8)=1`. From 5, no child > 2 = ⌊4/2⌋ (child 7 has s=2, not > 2). Centroid **5**. Removing 5 → `{6}`, `{7,8}`, both ≤ 2.

### 9.4 Level 2 — recurse again

- Under `1`: `{0}` → centroid 0; `{2}` → centroid 2.
- Under `5`: `{6}` → centroid 6; `{7,8}` (edge 7–8): centroid **7** (removing 7 → `{8}`). 
- Level 3: under 7, `{8}` → centroid 8.

### 9.5 Resulting centroid tree CT(T)

```
                3            level 0   (N=9)
              / | \
             1  4  5         level 1
            /\     /\
           0  2   6  7       level 2
                     |
                     8       level 3
```

`height(CT) = 3 = ⌊log₂ 9⌋ + 1 = 3 + 1 − 1`… check: `⌊log₂ 9⌋ = 3`, bound is `≤ ⌊log₂ N⌋ + 1 = 4`. Observed height 3 ≤ 4. ✓

### 9.6 Verifying the path-LCA theorem on this tree

Take `u = 0`, `v = 8`. Tree path: `0 – 1 – 3 – 5 – 7 – 8`.
Centroid-tree ancestors of `0`: `{0, 1, 3}`. Of `8`: `{8, 7, 5, 3}`. Common ancestors: `{3}`. So `LCA_CT(0,8) = 3`. And indeed `3` lies on the path `0–1–3–5–7–8`, exactly once — confirming Theorem 3.

Take `u = 6`, `v = 8`. Path: `6 – 5 – 7 – 8`. Ancestors of 6: `{6,5,3}`; of 8: `{8,7,5,3}`. Deepest common = `5`. `5` is on the path. ✓ Note the *higher* common ancestor `3` is **not** on the path `6–5–7–8` — only the LCA itself is guaranteed on the path, matching part 3 (uniqueness).

### 9.7 Per-vertex level membership (drives O(N log N))

| vertex | level(v) | components it belongs to (one per level) |
|--------|----------|-------------------------------------------|
| 3 | 0 | {0..8} |
| 1 | 1 | {0..8},{0,1,2} |
| 5 | 1 | {0..8},{5,6,7,8} |
| 0 | 2 | {0..8},{0,1,2},{0} |
| 8 | 3 | {0..8},{5,6,7,8},{7,8},{8} |

Each vertex appears in `level(v)+1 ≤ 4` components — the `O(log N)` bound from §3, which is exactly what charges to `O(N log N)` total work in §5.

---

## 10. Reference Implementations

Three production-quality patterns, in Go, Java, Python (in that order):
**(A)** centroid-tree build returning `cparent[]`;
**(B)** count paths of length *exactly* `K` via inclusion–exclusion;
**(C)** dynamic nearest-marked-node with point updates.

### 10.1 Go

```go
package main

import "fmt"

// ---------- (A) Centroid-tree build ----------

type CD struct {
	adj     [][]int
	removed []bool
	size    []int
	cparent []int // centroid-tree parent; -1 for the root centroid
}

func NewCD(n int) *CD {
	c := &CD{
		adj:     make([][]int, n),
		removed: make([]bool, n),
		size:    make([]int, n),
		cparent: make([]int, n),
	}
	for i := range c.cparent {
		c.cparent[i] = -1
	}
	return c
}

func (c *CD) AddEdge(u, v int) {
	c.adj[u] = append(c.adj[u], v)
	c.adj[v] = append(c.adj[v], u)
}

func (c *CD) computeSize(u, p int) int {
	c.size[u] = 1
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] {
			c.size[u] += c.computeSize(v, u)
		}
	}
	return c.size[u]
}

func (c *CD) findCentroid(u, p, n int) int {
	for _, v := range c.adj[u] {
		if v != p && !c.removed[v] && c.size[v] > n/2 {
			return c.findCentroid(v, u, n)
		}
	}
	return u
}

// Build sets cparent[] and returns the root centroid.
func (c *CD) Build(entry, par int) int {
	n := c.computeSize(entry, -1)
	ce := c.findCentroid(entry, -1, n)
	c.removed[ce] = true
	c.cparent[ce] = par
	for _, v := range c.adj[ce] {
		if !c.removed[v] {
			c.Build(v, ce)
		}
	}
	return ce
}

// ---------- (B) Count paths of length exactly K ----------

type ExactK struct {
	adj     [][]int
	removed []bool
	size    []int
	K       int
	answer  int64
}

func (s *ExactK) computeSize(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.computeSize(v, u)
		}
	}
	return s.size[u]
}

func (s *ExactK) findCentroid(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.findCentroid(v, u, n)
		}
	}
	return u
}

func (s *ExactK) gather(u, p, d int, out *[]int) {
	if d > s.K {
		return // distances beyond K cannot contribute to an exact-K pair
	}
	*out = append(*out, d)
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.gather(v, u, d+1, out)
		}
	}
}

func (s *ExactK) decompose(entry int) {
	n := s.computeSize(entry, -1)
	c := s.findCentroid(entry, -1, n)
	s.removed[c] = true

	// inclusion-exclusion with a frequency array over the whole component
	add := func(ds []int, sign int64) {
		freq := make([]int64, s.K+2)
		for _, d := range ds {
			if d <= s.K {
				freq[d]++
			}
		}
		for _, d := range ds {
			need := s.K - d
			if need < 0 || need > s.K {
				continue
			}
			cnt := freq[need]
			if need == d {
				cnt-- // exclude self
			}
			s.answer += sign * cnt // counts each ordered pair once
		}
	}

	all := []int{0}
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			var br []int
			s.gather(v, c, 1, &br)
			add(br, -1) // remove same-branch (ordered) over-counts
			all = append(all, br...)
		}
	}
	add(all, +1)

	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.decompose(v)
		}
	}
}

// ---------- (C) Dynamic nearest-marked-node ----------

type Near struct {
	adj     [][]int
	removed []bool
	size    []int
	anc     [][][2]int // anc[x] = list of {centroid, dist(x,centroid)}
	best    []map[int]int
}

func (n *Near) computeSize(u, p int) int {
	n.size[u] = 1
	for _, v := range n.adj[u] {
		if v != p && !n.removed[v] {
			n.size[u] += n.computeSize(v, u)
		}
	}
	return n.size[u]
}

func (n *Near) findCentroid(u, p, tot int) int {
	for _, v := range n.adj[u] {
		if v != p && !n.removed[v] && n.size[v] > tot/2 {
			return n.findCentroid(v, u, tot)
		}
	}
	return u
}

func (n *Near) record(u, p, d, c int) {
	n.anc[u] = append(n.anc[u], [2]int{c, d})
	for _, v := range n.adj[u] {
		if v != p && !n.removed[v] {
			n.record(v, u, d+1, c)
		}
	}
}

func (n *Near) build(entry int) {
	tot := n.computeSize(entry, -1)
	c := n.findCentroid(entry, -1, tot)
	n.removed[c] = true
	n.record(c, -1, 0, c)
	for _, v := range n.adj[c] {
		if !n.removed[v] {
			n.build(v)
		}
	}
}

func (n *Near) Mark(x int)   { for _, a := range n.anc[x] { n.best[a[0]][a[1]]++ } }
func (n *Near) Unmark(x int) {
	for _, a := range n.anc[x] {
		m := n.best[a[0]]
		if m[a[1]] <= 1 { delete(m, a[1]) } else { m[a[1]]-- }
	}
}
func (n *Near) Query(x int) int {
	const INF = 1 << 30
	res := INF
	for _, a := range n.anc[x] {
		mn := INF
		for d := range n.best[a[0]] {
			if d < mn { mn = d }
		}
		if mn < INF && a[1]+mn < res { res = a[1] + mn }
	}
	return res
}

func main() {
	// (A) build centroid tree on the §9 tree
	cd := NewCD(9)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}, {3, 5}, {5, 6}, {5, 7}, {7, 8}} {
		cd.AddEdge(e[0], e[1])
	}
	root := cd.Build(0, -1)
	fmt.Println("root centroid:", root, "cparent:", cd.cparent)

	// (B) count paths of length exactly 3
	ek := &ExactK{adj: make([][]int, 9), removed: make([]bool, 9), size: make([]int, 9), K: 3}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}, {3, 5}, {5, 6}, {5, 7}, {7, 8}} {
		ek.adj[e[0]] = append(ek.adj[e[0]], e[1])
		ek.adj[e[1]] = append(ek.adj[e[1]], e[0])
	}
	ek.decompose(0)
	fmt.Println("paths of length exactly 3:", ek.answer/2) // /2: ordered->unordered

	// (C) nearest marked node
	near := &Near{adj: make([][]int, 9), removed: make([]bool, 9), size: make([]int, 9),
		anc: make([][][2]int, 9), best: make([]map[int]int, 9)}
	for i := range near.best {
		near.best[i] = map[int]int{}
	}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}, {3, 5}, {5, 6}, {5, 7}, {7, 8}} {
		near.adj[e[0]] = append(near.adj[e[0]], e[1])
		near.adj[e[1]] = append(near.adj[e[1]], e[0])
	}
	near.build(0)
	near.Mark(8)
	fmt.Println("nearest marked to 0:", near.Query(0)) // dist(0,8)=5
	near.Mark(2)
	fmt.Println("nearest marked to 0:", near.Query(0)) // dist(0,2)=2
}
```

### 10.2 Java

```java
import java.util.*;

public class CentroidPro {
    // ---------- (A) Centroid-tree build ----------
    static class CD {
        List<List<Integer>> adj; boolean[] removed; int[] size, cparent;
        CD(int n) {
            adj = new ArrayList<>();
            for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
            removed = new boolean[n]; size = new int[n];
            cparent = new int[n]; Arrays.fill(cparent, -1);
        }
        void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
        int computeSize(int u, int p) {
            size[u] = 1;
            for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
            return size[u];
        }
        int findCentroid(int u, int p, int tot) {
            for (int v : adj.get(u))
                if (v != p && !removed[v] && size[v] > tot / 2) return findCentroid(v, u, tot);
            return u;
        }
        int build(int entry, int par) {
            int tot = computeSize(entry, -1);
            int c = findCentroid(entry, -1, tot);
            removed[c] = true; cparent[c] = par;
            for (int v : adj.get(c)) if (!removed[v]) build(v, c);
            return c;
        }
    }

    // ---------- (B) Count paths of length exactly K ----------
    static class ExactK {
        List<List<Integer>> adj; boolean[] removed; int[] size; int K; long answer = 0;
        ExactK(int n, int K) {
            this.K = K;
            adj = new ArrayList<>();
            for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
            removed = new boolean[n]; size = new int[n];
        }
        void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
        int computeSize(int u, int p) {
            size[u] = 1;
            for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
            return size[u];
        }
        int findCentroid(int u, int p, int tot) {
            for (int v : adj.get(u))
                if (v != p && !removed[v] && size[v] > tot / 2) return findCentroid(v, u, tot);
            return u;
        }
        void gather(int u, int p, int d, List<Integer> out) {
            if (d > K) return;
            out.add(d);
            for (int v : adj.get(u)) if (v != p && !removed[v]) gather(v, u, d + 1, out);
        }
        void add(List<Integer> ds, long sign) {
            long[] freq = new long[K + 2];
            for (int d : ds) if (d <= K) freq[d]++;
            for (int d : ds) {
                int need = K - d;
                if (need < 0 || need > K) continue;
                long cnt = freq[need];
                if (need == d) cnt--;          // exclude self
                answer += sign * cnt;           // ordered pairs
            }
        }
        void decompose(int entry) {
            int tot = computeSize(entry, -1);
            int c = findCentroid(entry, -1, tot);
            removed[c] = true;
            List<Integer> all = new ArrayList<>(); all.add(0);
            for (int v : adj.get(c)) if (!removed[v]) {
                List<Integer> br = new ArrayList<>();
                gather(v, c, 1, br);
                add(br, -1);
                all.addAll(br);
            }
            add(all, +1);
            for (int v : adj.get(c)) if (!removed[v]) decompose(v);
        }
    }

    // ---------- (C) Dynamic nearest-marked-node ----------
    static class Near {
        List<List<Integer>> adj; boolean[] removed; int[] size;
        List<int[]>[] anc; TreeMap<Integer,Integer>[] best;
        static final int INF = 1 << 30;
        @SuppressWarnings("unchecked")
        Near(int n) {
            adj = new ArrayList<>();
            for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
            removed = new boolean[n]; size = new int[n];
            anc = new List[n]; best = new TreeMap[n];
            for (int i = 0; i < n; i++) { anc[i] = new ArrayList<>(); best[i] = new TreeMap<>(); }
        }
        void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }
        int computeSize(int u, int p) {
            size[u] = 1;
            for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
            return size[u];
        }
        int findCentroid(int u, int p, int tot) {
            for (int v : adj.get(u))
                if (v != p && !removed[v] && size[v] > tot / 2) return findCentroid(v, u, tot);
            return u;
        }
        void record(int u, int p, int d, int c) {
            anc[u].add(new int[]{c, d});
            for (int v : adj.get(u)) if (v != p && !removed[v]) record(v, u, d + 1, c);
        }
        void build(int entry) {
            int tot = computeSize(entry, -1);
            int c = findCentroid(entry, -1, tot);
            removed[c] = true; record(c, -1, 0, c);
            for (int v : adj.get(c)) if (!removed[v]) build(v);
        }
        void mark(int x)   { for (int[] a : anc[x]) best[a[0]].merge(a[1], 1, Integer::sum); }
        void unmark(int x) {
            for (int[] a : anc[x]) {
                TreeMap<Integer,Integer> m = best[a[0]];
                int v = m.get(a[1]); if (v <= 1) m.remove(a[1]); else m.put(a[1], v - 1);
            }
        }
        int query(int x) {
            int res = INF;
            for (int[] a : anc[x]) {
                TreeMap<Integer,Integer> m = best[a[0]];
                if (!m.isEmpty()) res = Math.min(res, a[1] + m.firstKey());
            }
            return res;
        }
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{1,3},{3,4},{3,5},{5,6},{5,7},{7,8}};
        CD cd = new CD(9);
        for (int[] e : edges) cd.addEdge(e[0], e[1]);
        System.out.println("root centroid: " + cd.build(0, -1));
        System.out.println("cparent: " + Arrays.toString(cd.cparent));

        ExactK ek = new ExactK(9, 3);
        for (int[] e : edges) ek.addEdge(e[0], e[1]);
        ek.decompose(0);
        System.out.println("paths of length exactly 3: " + ek.answer / 2);

        Near near = new Near(9);
        for (int[] e : edges) near.addEdge(e[0], e[1]);
        near.build(0);
        near.mark(8);
        System.out.println("nearest marked to 0: " + near.query(0)); // 5
        near.mark(2);
        System.out.println("nearest marked to 0: " + near.query(0)); // 2
    }
}
```

### 10.3 Python

```python
import sys
sys.setrecursionlimit(1 << 20)


# ---------- (A) Centroid-tree build ----------
class CD:
    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.cparent = [-1] * n

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, tot):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > tot // 2:
                return self.find_centroid(v, u, tot)
        return u

    def build(self, entry, par):
        tot = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, tot)
        self.removed[c] = True
        self.cparent[c] = par
        for v in self.adj[c]:
            if not self.removed[v]:
                self.build(v, c)
        return c


# ---------- (B) Count paths of length exactly K ----------
class ExactK:
    def __init__(self, n, K):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.K = K
        self.answer = 0

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, tot):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > tot // 2:
                return self.find_centroid(v, u, tot)
        return u

    def gather(self, u, p, d, out):
        if d > self.K:
            return
        out.append(d)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, d + 1, out)

    def add(self, ds, sign):
        K = self.K
        freq = [0] * (K + 2)
        for d in ds:
            if d <= K:
                freq[d] += 1
        for d in ds:
            need = K - d
            if 0 <= need <= K:
                cnt = freq[need] - (1 if need == d else 0)  # exclude self
                self.answer += sign * cnt                    # ordered pairs

    def decompose(self, entry):
        tot = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, tot)
        self.removed[c] = True
        all_d = [0]
        for v in self.adj[c]:
            if not self.removed[v]:
                br = []
                self.gather(v, c, 1, br)
                self.add(br, -1)
                all_d.extend(br)
        self.add(all_d, +1)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v)


# ---------- (C) Dynamic nearest-marked-node ----------
class Near:
    INF = 1 << 30

    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.anc = [[] for _ in range(n)]   # (centroid, dist)
        self.best = [dict() for _ in range(n)]  # centroid -> {dist: count}

    def add_edge(self, u, v):
        self.adj[u].append(v); self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, tot):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > tot // 2:
                return self.find_centroid(v, u, tot)
        return u

    def record(self, u, p, d, c):
        self.anc[u].append((c, d))
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.record(v, u, d + 1, c)

    def build(self, entry):
        tot = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, tot)
        self.removed[c] = True
        self.record(c, -1, 0, c)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.build(v)

    def mark(self, x):
        for c, d in self.anc[x]:
            self.best[c][d] = self.best[c].get(d, 0) + 1

    def unmark(self, x):
        for c, d in self.anc[x]:
            m = self.best[c]
            if m[d] <= 1:
                del m[d]
            else:
                m[d] -= 1

    def query(self, x):
        res = self.INF
        for c, d in self.anc[x]:
            if self.best[c]:
                res = min(res, d + min(self.best[c]))
        return res


if __name__ == "__main__":
    edges = [(0, 1), (1, 2), (1, 3), (3, 4), (3, 5), (5, 6), (5, 7), (7, 8)]

    cd = CD(9)
    for u, v in edges:
        cd.add_edge(u, v)
    print("root centroid:", cd.build(0, -1))
    print("cparent:", cd.cparent)

    ek = ExactK(9, 3)
    for u, v in edges:
        ek.add_edge(u, v)
    ek.decompose(0)
    print("paths of length exactly 3:", ek.answer // 2)

    near = Near(9)
    for u, v in edges:
        near.add_edge(u, v)
    near.build(0)
    near.mark(8)
    print("nearest marked to 0:", near.query(0))  # 5
    near.mark(2)
    print("nearest marked to 0:", near.query(0))  # 2
```

**On the §9 tree, K = 3.** The exactly-length-3 paths are: `0–1–3–4`, `0–1–3–5`, `2–1–3–4`, `2–1–3–5`, `1–3–5–6`, `1–3–5–7`, `4–3–5–6`, `4–3–5–7`, `3–5–7–8`, `6–5–7–8` → **10 paths**. The inclusion–exclusion accumulator computes ordered pairs, so the printed `answer/2` is 10.

**Production notes.** The `Query` here scans each centroid's distance map for its minimum (`O(distinct)`), kept simple for clarity; replace with a balanced multiset (Java `TreeMap.firstKey`, already `O(log)`) or an indexed min-heap with lazy deletion for `O(log N)` min. The exact-K counter uses a **frequency array** rather than sorting because the distance domain is bounded by `K`, yielding `O(N log N)` overall rather than `O(N log² N)`.

---

## 11. Comparison

| Structure | Query class | Build | Per op | Dynamic topology? |
|-----------|-------------|-------|--------|-------------------|
| **Centroid decomposition** | distance counting, nearest-marked, path-property counting | `O(N log N)` | `O(log²N)` | No (rebuild) |
| **Heavy-Light Decomposition (14)** | path-aggregate query/update (sum/max/assign on `u–v`) | `O(N)` | `O(log²N)` | No (rebuild) |
| **Link-Cut Trees** | path-aggregate **with** link/cut | `O(N)` | `O(log N)` amort. | **Yes** |
| **Mo's algorithm on trees** | offline path queries (frequency/distinct) | — | `O((N+Q)√N)` | No |
| **LCA index (13)** | pairwise distance only | `O(N)` / `O(N log N)` | `O(1)`/`O(log N)` | No |

Centroid decomposition is the unique fit for "count/aggregate over the *set of paths*" and "distance-radius" queries; HLD/LCT handle aggregates *along a single given path*; Mo handles offline path-frequency queries when no clean per-centroid decomposition exists. They are complementary, not interchangeable.

---

## 12. Open Problems

- **Fully-dynamic centroid decomposition.** No known structure maintains a centroid tree under `O(polylog N)` edge insertions/deletions while preserving the `O(log N)` height *and* the per-centroid augmentation; topology change generally forces rebuild. Top-trees and LCT give dynamic *path* aggregates but not the centroid-LCA path-partition property cheaply.
- **Optimal distance-counting.** Whether "count pairs at distance `≤ K`" admits `O(N)` (no log) on arbitrary weighted trees is open in the comparison/algebraic models; CD gives `O(N log N)`–`O(N log² N)`.
- **Cache-oblivious / external-memory CD.** A provably `O((N/B) log_{M/B}(N/B))`-I/O build is not standard; the DFS-driven build is not naturally I/O-efficient.
- **Parallel depth.** Building CT with optimal work `O(N log N)` and polylog span on a PRAM/CREW model, given centroid-finding's sequential descent, is subtle.

---

## 13. Summary

Centroid decomposition rests on four precise facts. **(1)** Jordan's theorem guarantees a centroid exists, leaving every component `≤ ⌊N/2⌋` (Theorem 1). **(2)** Strict halving forces the centroid tree's height to `≤ ⌊log₂ N⌋ + 1` and each vertex into `O(log N)` levels (Theorem 2). **(3)** The path-decomposition theorem (Theorem 3) shows every `u–v` path crosses `LCA_{CT}(u, v)` exactly once, which partitions all paths by owner-centroid and is the rigorous basis for counting without double-counting (resolved by inclusion–exclusion). **(4)** Because each vertex appears in `O(log N)` components and each component costs linear work, the build is `O(N log N)` in `O(N)` space (Theorem 4). These bounds are worst-case and shape-independent, which is exactly why the structure is both theoretically clean and operationally predictable; its principal limitation remains static topology, leaving fully-dynamic centroid decomposition an open problem.
