# Centroid Decomposition — Middle Level

> **One-line summary:** Centroid decomposition reduces tree-path problems to a balanced `O(log N)`-deep divide-and-conquer; the working pattern is "for each centroid, count paths *through* it using inclusion–exclusion," which solves count-pairs-at-distance-K, count-paths-with-length-≤-K, and dynamic nearest-marked-node queries in `O(N log N)` (or `O(N log² N)` with sorting).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph and Tree Applications](#graph-and-tree-applications)
6. [Algorithmic Integration](#algorithmic-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At the junior level we learned *what* a centroid is and *how* to build the centroid tree. At the middle level we learn *why it works* and *how to use it* to actually solve problems. Two ideas carry all the weight:

1. **Why the depth is `O(log N)`** — the halving guarantee, made precise.
2. **The path-through-centroid principle** — every path is owned by exactly one centroid, which lets us decompose any path-counting problem into independent per-centroid subproblems.

The third recurring idea is the **inclusion–exclusion correction**: when you count "all pairs of vertices whose combined distance to the centroid satisfies the property," you accidentally include pairs that live in the *same* child branch and therefore don't actually pass through the centroid. You subtract those out, per branch.

With those three ideas you can solve a whole family of classic problems: counting pairs at distance exactly `K`, counting paths of length `≤ K`, the IOI **Race** problem (shortest path with exactly `K` edges), and dynamic **nearest marked/colored node** queries with point updates.

We will also contrast centroid decomposition with its siblings — **14-heavy-light-decomposition** (path-aggregate updates), **small-to-large merging**, and the **Euler-tour distance table** — so you know which tool fits which problem.

---

## Deeper Concepts

### Why the centroid-tree depth is O(log N)

When we decompose a component of size `n`, every piece we recurse into has size `≤ ⌊n/2⌋`. Define the *level* of a vertex as the depth of its centroid in the centroid tree. A vertex `v` survives into a component of size `n₀ = N`, then `n₁ ≤ N/2`, then `n₂ ≤ N/4`, … Each level at least halves the surviving component size, so after at most `⌊log₂ N⌋ + 1` levels the component containing `v` has size 1 and `v` becomes a centroid. Therefore:

- The centroid tree's height is `≤ ⌊log₂ N⌋ + 1 = O(log N)`.
- Each vertex `v` belongs to exactly `level(v) + 1 = O(log N)` centroid components.

Summing over all vertices, the **total size of all components across all levels** is `Σ_v O(log N) = O(N log N)`. Since each level's work is linear in its component sizes, the total build (and per-level processing) cost is `O(N log N)`. A formal proof is in [`professional.md`](./professional.md).

### The path-through-centroid principle

> For any two distinct vertices `u, v`, the unique tree path `u … v` contains **exactly one** vertex `c` that is the lowest common ancestor of `u` and `v` in the centroid tree. Moreover, `c` lies *on* the path, and both `u` and `v` lie in `c`'s component at the level where `c` is the centroid.

Intuition: consider the first (highest) centroid `c` whose removal *separates* `u` and `v` into different pieces — or that *is* one of them. Before `c` is removed, `u` and `v` are in the same component (because nothing earlier separated them), so the path `u…v` lies entirely within that component, which means it passes through `c` when `c` is the centroid. After `c` is removed, `u` and `v` fall into different sub-pieces (or one of them is `c`). That `c` is exactly the centroid-tree LCA.

**Consequence:** any path problem "count/aggregate over all paths satisfying property P" splits into independent subproblems "for each centroid `c`, handle paths whose highest centroid is `c`," and these subproblems together cover every path **exactly once**.

### Inclusion–exclusion to avoid double counting

At centroid `c`, a path through `c` is the concatenation of two "legs": one from `c` into branch `A`, one from `c` into branch `B` (`A ≠ B`), plus possibly the trivial leg ending at `c` itself. If we naively count *all* pairs of vertices in `c`'s component whose leg-distances combine to satisfy the property, we include pairs `(x, y)` where `x` and `y` are in the **same** branch — those paths go *down then back up* through `c`, which is not a simple path and double-counts.

The fix:

```
answer(c) = pairs_satisfying_P(distances over WHOLE component including c)
          − Σ over each child branch b:
                pairs_satisfying_P(distances over branch b only, shifted by +0)
```

When counting with the centroid included, give the centroid itself distance 0 so that single-leg paths ending at `c` are handled by the "+ centroid" term. The subtraction removes same-branch over-counts because within one branch, the two legs would have to share the branch and thus not pass through `c`.

### Distance bookkeeping

For most problems you need, per centroid `c`, the multiset of distances `dist(c, x)` for every `x` in `c`'s component. You collect these with a single DFS from `c` over the residual tree, *grouping by branch* so you can do the per-branch subtraction.

### Why inclusion–exclusion is exactly right (worked on a star)

The inclusion–exclusion step is the part people get wrong, so let's make it concrete on a tiny example: a star with center `c` and three leaves `a, b, e`, all at distance 1 from `c`.

```
        a
        |
   b -- c -- e
```

Distances from `c` (component including `c` itself at 0): `[0, 1, 1, 1]` (for `c, a, b, e`).

Suppose `K = 2` and we count pairs with `dist == K`. A pair `(x, y)` passing through `c` has total distance `dist(c,x) + dist(c,y)`. The "whole component" count of ordered pairs summing to 2:
- `a–b`: 1+1 = 2 ✓
- `a–e`: 2 ✓
- `b–e`: 2 ✓
- `a–a, b–b, e–e`: self-pairs, excluded
- pairs with `c` (distance 0): need partner at distance 2, none exists.

So the whole-component pass finds 3 unordered pairs: `{a,b}, {a,e}, {b,e}`. **All three genuinely pass through `c`** because each leaf is its own branch — there is no same-branch over-count to subtract. The per-branch subtraction subtracts 0 from each singleton branch. Correct answer: 3 paths of length 2.

Now glue two leaves into the same branch — path `c – a – f` (so `a` at distance 1, `f` at distance 2), plus leaf `b` at distance 1:

```
   b -- c -- a -- f
```

Distances from `c`: `[0(c), 1(b), 1(a), 2(f)]`. Whole-component pairs summing to `K=2`:
- `b–a`: 2 ✓ (different branches — real path `b–c–a`)
- `b–f` would be 1+2 = 3, not 2.
- `a–f`: 1+2 = 3, not 2.
- the pair making `2` *within* the `a`-branch: `c–f` gives 0+2 = 2 — but that path is `c–a–f`, which is real and **does** pass through (ends at) `c`.

Here the only `K=2` pair is `{b,a}`, plus `{c,f}` which is a leg ending at `c`. The branch-only pass on branch `{a, f}` (distances `1, 2`) finds pairs summing to 2: none (`1+1` needs two copies of distance-1, but there's only one; `a–f` is 3). So subtraction removes 0, and we keep `{b,a}` and `{c,f}` — both correct. The over-count only appears when a branch contains **two** vertices whose distances sum to `K`; then those two are in the same branch, their "path" would bounce off `c`, and the subtraction removes exactly that spurious pair.

**Rule:** the whole-component pass over-counts precisely the pairs `(x, y)` in the *same* branch whose `dist(c,x)+dist(c,y)` hits the target; subtracting the same computation restricted to each branch cancels them, with no path counted twice because each real path lives in exactly one centroid (the path-LCA theorem).

### Ordered vs unordered, and the factor of 2

Two clean ways to count:

1. **All-then-subtract (frequency array).** For each vertex at distance `d`, add `freq[K − d]`. This counts every ordered pair twice and self-matches once (when `2d = K`). Easiest fix: build `freq` first, exclude self (`if need == d: cnt -= 1`), sum, then divide the final answer by 2.
2. **Incremental per branch.** Maintain a running `freq` of *previously processed* branches; for each new branch, first query it against `freq` (this gives unordered cross-branch pairs directly, no double count), then merge the new branch into `freq`. This avoids the divide-by-2 and never forms same-branch pairs in the first place.

Both are `O(n)` per centroid when the distance domain is bounded by `K`; the incremental form is what competitive solutions usually ship.

---

## Comparison with Alternatives

| Technique | Best for | Update support | Build | Per query | Notes |
|-----------|----------|----------------|-------|-----------|-------|
| **Centroid decomposition** | Counting/answering by **distance** or path property; nearest-marked-node | Point updates (mark/unmark) easy | `O(N log N)` | `O(log N)`–`O(log² N)` | Decomposes by "highest centroid on path." |
| **Heavy-Light Decomposition (14)** | **Aggregate** queries/updates *along* a path (sum, max, assign) | Path updates via segment tree | `O(N)` | `O(log² N)` | Different problem class: values on the path, not distance counting. |
| **Small-to-large merging** | Subtree-rooted multiset queries (count colors in subtree, etc.) | Offline subtree queries | `O(N log N)` | amortized | Merges child maps into parent; not for arbitrary paths. |
| **Euler-tour distance table** | Static all-pairs distance via LCA | None | `O(N)` + LCA | `O(1)` per distance | Gives distance fast but doesn't *count* paths by property cheaply. |
| **Brute force** | `N ≤ ~3000` | trivial | — | `O(N²)` | Enumerate all pairs; baseline for testing. |

**Rule of thumb:** if the problem says "distance" or "count pairs/paths," reach for centroid decomposition. If it says "update the value on every edge along the path from u to v, then query the sum," reach for HLD (sibling 14). They solve disjoint problem classes and are often confused in interviews.

---

## Advanced Patterns

### Pattern A — Count pairs at distance exactly K

For each centroid `c`, count pairs `(u, v)` with `dist(u, c) + dist(v, c) = K`, `u, v` in different branches. Use a frequency array `cnt[d]` of distances seen so far; for a new vertex at distance `d`, add `cnt[K − d]`. Process branch by branch (add a branch's contributions only against previously-added branches), or use the all-then-subtract inclusion–exclusion form.

### Pattern B — Count paths with length ≤ K (or in a range)

Replace the exact-match `cnt[K − d]` lookup with a **prefix-sum / sorted-two-pointer** count of distances `≤ K − d`. Sorting the distance list per centroid gives `O(n log n)` per centroid, `O(N log² N)` overall. This is the structure behind the IOI **Race**-style "≤ K" variants.

#### Worked trace — count pairs at distance ≤ K

Tree (5 vertices), `K = 2`:
```
   2 -- 1 -- 0
        |
        3 -- 4
```
edges `0–1, 1–2, 1–3, 3–4`.

**Level 0 — centroid is 1** (removing 1 leaves `{0}`,`{2}`,`{3,4}`, max size 2 = ⌊5/2⌋).
Distances from `1` over whole component: `1:0, 0:1, 2:1, 3:1, 4:2` → list `[0,1,1,1,2]`.
Sort → `[0,1,1,1,2]`. Two-pointer count of pairs `(i<j)` with sum ≤ 2:

| lo | hi | d[lo]+d[hi] | action | added |
|----|----|-------------|--------|-------|
| 0 | 4 | 0+2=2 ≤ 2 | add `hi−lo`=4, lo→1 | 4 |
| 1 | 4 | 1+2=3 > 2 | hi→3 | — |
| 1 | 3 | 1+1=2 ≤ 2 | add `hi−lo`=2, lo→2 | 2 |
| 2 | 3 | 1+1=2 ≤ 2 | add `hi−lo`=1, lo→3 | 1 |
| 3 | 3 | lo==hi stop | | |

Whole-component count = 4+2+1 = **7**.
Now subtract same-branch over-counts. Branches of `1`: `{0}` (dist `[1]`), `{2}` (dist `[1]`), `{3,4}` (dist `[1,2]`).
- branch `[1]`: 0 pairs. branch `[1]`: 0 pairs.
- branch `[1,2]`: pairs ≤ 2? `1+2=3 > 2` → 0 pairs.
Subtraction total = 0. Contribution of centroid 1 = **7**.

**Level 1 — recurse on `{3,4}` (centroid 3 or 4).** Distances from centroid `3`: `[0,1]` (for `3,4`). Pairs ≤ 2: `0+1=1 ≤ 2` → 1. Branch `{4}` = `[1]`, 0 pairs. Contribution = **1**. Components `{0}, {2}` contribute 0.

**Total = 7 + 1 = 8.** Brute force: enumerate all `C(5,2)=10` pairs; distances are `01:1, 02:2, 03:2, 04:3, 12:1, 13:1, 14:2, 23:2, 24:3, 34:1`. Pairs with distance ≤ 2: all except `04` and `24` → 8. ✓ This is the exact value the `countPairs`-based code below prints.

### Pattern C — Distance-based / radius queries

"How many nodes are within distance `R` of node `x`?" precompute, for each centroid `c` and each vertex `x` under it, the value `dist(c, x)`. Store, per centroid, a sorted list of distances of all vertices in its component. A query walks `x`'s `O(log N)` centroid ancestors, and at each ancestor `c` binary-searches "count of vertices with `dist(c, ·) ≤ R − dist(c, x)`," subtracting the same-branch over-count.

### Pattern D — Dynamic nearest marked node (point updates)

Maintain a set of "marked" vertices that can toggle on/off. Query: nearest marked vertex to `x`.

- **Precompute** for every vertex `x` and each of its `O(log N)` centroid ancestors `c` the value `dist(x, c)` (true tree distance, computable via LCA or stored during decomposition).
- **Per centroid** keep `best[c]` = minimum `dist(c, m)` over currently-marked `m` in `c`'s component (a multiset / min-structure).
- **Update (mark x):** for each centroid ancestor `c`, insert `dist(x, c)` into `c`'s structure.
- **Query (nearest to x):** for each centroid ancestor `c`, candidate answer is `dist(x, c) + best[c]`; take the minimum across all `O(log N)` ancestors.

Correctness follows from the path-through-centroid principle: the nearest marked node's path to `x` passes through their centroid-tree LCA `c`, and that `c` is one of `x`'s ancestors. Each update/query touches `O(log N)` centroids, each costing `O(log N)` for the multiset → `O(log² N)`.

---

## Graph and Tree Applications

- **Network distance analytics** — "how many server pairs are within `R` hops?" on a tree topology (spanning tree of a network).
- **Nearest facility / nearest open store** on a road tree, with stores opening and closing (point updates).
- **Counting "good" paths** — paths whose endpoints share a property, or whose length lies in a range.
- **Tree DP acceleration** — some pair-summation DPs that are `O(N²)` collapse to `O(N log N)` when decomposed by centroid.
- **IOI/ICPC classics** — Race (shortest edge-count path of total weight `K`), Xenia and Tree (nearest red node with updates), and many "count pairs with distance property" problems.

Note these are all **path** or **distance** problems on a **tree**. For value-on-path aggregation with updates, use HLD (14); for subtree color counts, use small-to-large.

---

## Algorithmic Integration

- **With LCA (sibling 13):** to get true tree distances quickly inside queries, precompute LCA (binary lifting or Euler+sparse table) so `dist(u, v) = depth[u] + depth[v] − 2·depth[lca(u,v)]` in `O(1)`/`O(log N)`. This is handy in nearest-marked-node where you need `dist(x, c)` for centroid ancestors `c`.
- **With BIT/segment trees:** per-centroid sorted distance arrays support range-count queries; a Fenwick tree over distance buckets supports dynamic count-within-radius.
- **With multisets / heaps:** the dynamic nearest-marked-node pattern stores, per centroid, a min-structure of marked distances.
- **With offline sorting:** "≤ K" path counts use sorting + two pointers per centroid.

---

## Code Examples

### Example: Count pairs of nodes at distance ≤ K via centroid decomposition

The approach: for each centroid `c`, gather distances of all reachable vertices (including `c` at distance 0), sort, count pairs with sum `≤ K` via two pointers, then **subtract** the same over-count computed per child branch (where distances are shifted by the edge weight into that branch).

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Solver struct {
	adj     [][]int
	removed []bool
	size    []int
	K       int
	answer  int64
}

func (s *Solver) computeSize(u, p int) int {
	s.size[u] = 1
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.size[u] += s.computeSize(v, u)
		}
	}
	return s.size[u]
}

func (s *Solver) findCentroid(u, p, n int) int {
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] && s.size[v] > n/2 {
			return s.findCentroid(v, u, n)
		}
	}
	return u
}

// collect distances (edge count) from 'root' over the residual component.
func (s *Solver) gather(u, p, d int, out *[]int) {
	*out = append(*out, d)
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.gather(v, u, d+1, out)
		}
	}
}

// countPairs: number of pairs (i<j) with dist[i]+dist[j] <= K.
func countPairs(d []int, K int) int64 {
	sort.Ints(d)
	var cnt int64
	lo, hi := 0, len(d)-1
	for lo < hi {
		if d[lo]+d[hi] <= K {
			cnt += int64(hi - lo)
			lo++
		} else {
			hi--
		}
	}
	return cnt
}

func (s *Solver) decompose(entry int) {
	n := s.computeSize(entry, -1)
	c := s.findCentroid(entry, -1, n)
	s.removed[c] = true

	// All distances from c over the whole component (c included at 0).
	var all []int
	all = append(all, 0)
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			var branch []int
			s.gather(v, c, 1, &branch)
			all = append(all, branch...)
			// subtract same-branch over-count (paths not through c)
			s.answer -= countPairs(branch, s.K)
		}
	}
	s.answer += countPairs(all, s.K)

	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.decompose(v)
		}
	}
}

func main() {
	n := 5
	s := &Solver{
		adj:     make([][]int, n),
		removed: make([]bool, n),
		size:    make([]int, n),
		K:       2,
	}
	edges := [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}}
	for _, e := range edges {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.decompose(0)
	fmt.Println("pairs with distance <= 2:", s.answer)
}
```

#### Java

```java
import java.util.*;

public class CountPairsLeqK {
    int n, K;
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size;
    long answer = 0;

    CountPairsLeqK(int n, int K) {
        this.n = n; this.K = K;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u))
            if (v != p && !removed[v]) size[u] += computeSize(v, u);
        return size[u];
    }

    int findCentroid(int u, int p, int total) {
        for (int v : adj.get(u))
            if (v != p && !removed[v] && size[v] > total / 2)
                return findCentroid(v, u, total);
        return u;
    }

    void gather(int u, int p, int d, List<Integer> out) {
        out.add(d);
        for (int v : adj.get(u))
            if (v != p && !removed[v]) gather(v, u, d + 1, out);
    }

    long countPairs(List<Integer> d) {
        Collections.sort(d);
        long cnt = 0;
        int lo = 0, hi = d.size() - 1;
        while (lo < hi) {
            if (d.get(lo) + d.get(hi) <= K) { cnt += hi - lo; lo++; }
            else hi--;
        }
        return cnt;
    }

    void decompose(int entry) {
        int total = computeSize(entry, -1);
        int c = findCentroid(entry, -1, total);
        removed[c] = true;

        List<Integer> all = new ArrayList<>();
        all.add(0);
        for (int v : adj.get(c)) {
            if (!removed[v]) {
                List<Integer> branch = new ArrayList<>();
                gather(v, c, 1, branch);
                all.addAll(branch);
                answer -= countPairs(branch);
            }
        }
        answer += countPairs(all);

        for (int v : adj.get(c))
            if (!removed[v]) decompose(v);
    }

    public static void main(String[] args) {
        CountPairsLeqK s = new CountPairsLeqK(5, 2);
        int[][] edges = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] e : edges) s.addEdge(e[0], e[1]);
        s.decompose(0);
        System.out.println("pairs with distance <= 2: " + s.answer);
    }
}
```

#### Python

```python
import sys
from bisect import bisect_right
sys.setrecursionlimit(1 << 20)


class CountPairsLeqK:
    def __init__(self, n, K):
        self.n, self.K = n, K
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.answer = 0

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, total):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > total // 2:
                return self.find_centroid(v, u, total)
        return u

    def gather(self, u, p, d, out):
        out.append(d)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, d + 1, out)

    def count_pairs(self, d):
        d.sort()
        cnt, lo, hi = 0, 0, len(d) - 1
        while lo < hi:
            if d[lo] + d[hi] <= self.K:
                cnt += hi - lo
                lo += 1
            else:
                hi -= 1
        return cnt

    def decompose(self, entry):
        total = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, total)
        self.removed[c] = True

        all_d = [0]
        for v in self.adj[c]:
            if not self.removed[v]:
                branch = []
                self.gather(v, c, 1, branch)
                all_d.extend(branch)
                self.answer -= self.count_pairs(branch)
        self.answer += self.count_pairs(all_d)

        for v in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v)


if __name__ == "__main__":
    s = CountPairsLeqK(5, 2)
    for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
        s.add_edge(u, v)
    s.decompose(0)
    print("pairs with distance <= 2:", s.answer)
```

**What it does:** counts unordered pairs of vertices whose tree distance is `≤ K` in `O(N log² N)`. On the test tree (`0-1-2`, `1-3-4`, `K=2`) the answer is 8.
**Run:** `go run main.go` | `javac CountPairsLeqK.java && java CountPairsLeqK` | `python solve.py`

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Answer too large | Double-counting same-branch pairs. | Subtract `countPairs(branch)` for each branch (inclusion–exclusion). |
| Answer slightly off by `N` | Mishandling the centroid's own distance-0 contribution, or counting `(x,x)` self-pairs. | Include centroid as a single distance-0 entry; ensure `lo < hi` excludes self-pairs. |
| Stack overflow | `gather` / `compute_size` recurse `O(N)` deep on a path tree. | Iterative DFS with an explicit stack, or raise recursion limit. |
| TLE on `N = 10⁵` | Re-sorting or re-allocating large arrays unnecessarily; using maps where arrays suffice. | Reuse buffers; sort only per-centroid distance lists. |
| Wrong distances | Forgot edge weights (used hop count when weights matter). | Pass weights into `gather`; accumulate `d + w`. |

---

## Performance Analysis

- **Build:** `O(N log N)` — `O(log N)` levels, linear work per level.
- **Count-≤-K with sort + two pointers:** `O(N log² N)` — the extra `log` from sorting per-centroid distance lists.
- **Count-exact-K with a frequency array:** `O(N log N)` — no sorting, but needs a bounded distance domain.
- **Dynamic nearest-marked-node:** `O(N log N)` precompute, `O(log² N)` per update/query.
- **Space:** `O(N)` for the structure; `O(N log N)` only if you *store* per-centroid distance lists for all vertices (a common trade-off for radius queries).

The per-vertex `O(log N)` level membership is what bounds everything: any per-vertex, per-level constant work sums to `O(N log N)`.

---

## Best Practices

- Always test against an `O(N²)` brute force on random trees, including path graphs and stars.
- Separate generic decomposition from problem-specific counting so the same skeleton serves every problem.
- Prefer **frequency-array counting** for exact-distance problems (no sort); use **sort + two pointers** only for range/`≤K` problems.
- For dynamic problems, store `dist(x, ancestor)` once during decomposition rather than recomputing via LCA each query when possible.
- Guard recursion depth: convert size/gather DFS to iterative when `N ≥ 10⁵` and the tree may be a path.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation.
>
> The animation demonstrates:
> - Subtree-size computation and centroid selection
> - Removal and per-level coloring
> - The recursion into components
> - The growing centroid tree shown beside the original tree
> - How a path's "highest centroid" is identified

---

## Summary

The middle-level mastery of centroid decomposition rests on three pillars: the **halving guarantee** (depth `O(log N)`, `O(log N)` levels per vertex, `O(N log N)` total work), the **path-through-centroid principle** (every path owned by exactly one centroid — its centroid-tree LCA), and **inclusion–exclusion** (subtract same-branch over-counts). With these you can count pairs at distance exactly `K`, count paths of length `≤ K`, answer radius queries, and maintain a dynamic nearest-marked-node structure in `O(log² N)` per operation. Reach for centroid decomposition on *distance/path-counting* problems; reach for HLD (sibling 14) on *path-aggregate* problems — they are different tools for different jobs.
