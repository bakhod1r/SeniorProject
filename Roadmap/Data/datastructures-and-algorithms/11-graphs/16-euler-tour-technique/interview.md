# Euler Tour Technique (Tree Flattening) — Interview Preparation

The Euler Tour Technique is a favorite interview topic because it is a clean *reduction* — "flatten the tree, then it's just an array problem" — that probes whether a candidate understands DFS timestamps, ranges, and the structures (Fenwick, segment tree, LCA-by-RMQ) layered on top. It is also full of traps: the two conventions (`n` vs `2n`), the inclusive-range detail, the `O(1)` ancestor test, and the confusion with Euler *circuits* in graphs. This file is a curated question bank by seniority, plus end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| What it does | Flattens a rooted tree into an array via DFS `tin`/`tout` |
| Key property | Subtree of `v` = contiguous range `[tin[v], tout[v]]` |
| Build | `O(n)` (one DFS) |
| Subtree query/update | `O(log n)` (Fenwick / segment tree) |
| Ancestor test | `O(1)`: `tin[u]≤tin[w] ∧ tout[w]≤tout[u]` |
| Subtree size | `O(1)`: `tout[v]-tin[v]+1` |
| LCA | `O(1)` after `O(n)` (Euler `2n-1` + ±1 RMQ) |
| Two conventions | `n` (subtree=range), `2n` (path/LCA) |
| NOT | Euler circuit/path in graphs (different problem) |

Core DFS stamping (Convention A):

```text
dfs(v, parent):
    tin[v] = timer++
    for child c != parent: dfs(c, v)
    tout[v] = timer - 1      # subtree = [tin[v], tout[v]], inclusive
```

---

## Junior Questions (14 Q&A)

### J1. What is the Euler Tour Technique?
It flattens a rooted tree into a linear array using a single DFS that stamps each node with an entry time `tin[v]` and an exit time `tout[v]`. The defining payoff is that an entire subtree maps to one contiguous range `[tin[v], tout[v]]`, so subtree queries become array-range queries.

### J2. Why does a subtree map to a contiguous range?
DFS fully explores a subtree before leaving it, so every descendant of `v` gets an entry time after `tin[v]` and before `v` finishes. No node outside the subtree can receive a timestamp in that window, so the subtree's entry times form an unbroken block `[tin[v], tout[v]]`.

### J3. How do you assign `tin` and `tout`?
Keep a global `timer`. On entering `v`, set `tin[v] = timer++`. Recurse into children. After the last child returns, set `tout[v] = timer - 1`. One DFS, `O(n)`.

### J4. What is the time complexity of building the flattening?
`O(n)` — a single DFS visiting each node once and each edge twice.

### J5. After flattening, how fast is a subtree-sum query?
`O(log n)` if you put a Fenwick tree or segment tree over the flattened array. The subtree sum of `v` is the range sum of `[tin[v], tout[v]]`.

### J6. How do you test if `u` is an ancestor of `v` in O(1)?
`u` is an ancestor of `v` iff `tin[u] ≤ tin[v]` and `tout[v] ≤ tout[u]` — `u`'s interval contains `v`'s interval.

### J7. How do you get the size of a subtree in O(1)?
`tout[v] - tin[v] + 1`. The interval length equals the number of nodes in the subtree.

### J8. Is the range inclusive or exclusive?
In Convention A (one entry per node), `[tin[v], tout[v]]` is **inclusive** on both ends. Querying `[tin[v], tout[v])` (exclusive) drops the last node — a classic off-by-one bug.

### J9. What goes at index `t` of the flattened array?
The node entered at time `t`: `order[tin[v]] = v`. If you store *values*, put `flat[tin[v]] = value(v)` so the subtree sum is a range sum.

### J10. Is the Euler Tour Technique the same as an Euler circuit?
No. An Euler circuit/path visits every *edge* of a graph exactly once. The Euler Tour Technique flattens a *rooted tree* into an array via DFS timestamps. They share a name loosely (the DFS walk traverses each tree edge twice), but they solve different problems.

### J11. What structure do you put over the flattened array for subtree sums?
A Fenwick tree (Binary Indexed Tree) for point-update + subtree-sum, or a segment tree for more general range queries/updates. Both give `O(log n)` per operation.

### J12. What is a leaf's range?
A single index: `tin[v] == tout[v]`, so the range `[tin[v], tin[v]]` has length 1.

### J13. Why is ETT faster than answering subtree queries with a fresh DFS each time?
A fresh DFS per query is `O(subtree size)` = up to `O(n)`, so `q` queries cost `O(nq)`. ETT preprocesses once in `O(n)`, then each query is `O(log n)`, for `O(n + q log n)` total — vastly faster for large `n, q`.

### J14 (analysis). After flattening, does changing a node's value require re-running the DFS?
No. `tin`/`tout` depend only on the tree's *shape*, not its values. A value change is a single `O(log n)` update to the Fenwick/segment tree at index `tin[v]`. You re-run the DFS only when the tree's structure (parent/child edges) changes.

---

## Middle Questions (14 Q&A)

### M1. What are the two common Euler-tour flattenings?
Convention A: **one entry per node** (`n`-cell array) — subtree = contiguous range; used for subtree sum/min/update and ancestor tests. Convention B: **entry and exit** (`2n`-cell array) — each node appears twice; used for path sums and LCA-by-RMQ.

### M2. When do you need the 2n flattening instead of the n one?
When you need **path** queries or **LCA**. The `2n-1` Euler tour, paired with a depth array, gives LCA as the shallowest node in a range; subtree-only work uses the cleaner `n`-array.

### M3. How do you do a subtree range-update plus subtree range-sum?
A plain Fenwick only does point-update + range-sum. For range-add + range-sum, use a **lazy segment tree** over `[tin[v], tout[v]]`, or the two-BIT range-update/range-sum trick.

### M4. How do you add a delta to a whole subtree but query single nodes?
Use a **difference Fenwick**: `add(tin[v], +delta)` and `add(tout[v]+1, -delta)`. A node's accumulated value is `base[u] + prefix(tin[u])`.

### M5. How does ETT give LCA?
Build the `2n-1` Euler tour with a parallel depth array. `LCA(u,v)` is the node with minimum depth in the array segment between `first[u]` and `first[v]`. A range-minimum structure over depths answers it in `O(log n)` (segment tree) or `O(1)` (sparse table).

### M6. Why is the LCA = min-depth-in-range correct?
Between the first visits of `u` and `v`, the Euler tour must climb to their common ancestor and back; the shallowest node touched in that window is exactly the LCA, because the tour cannot leave the LCA's subtree between two nodes inside it without returning to the LCA.

### M7. How do you compute the distance between two nodes?
`dist(u,v) = depth[u] + depth[v] - 2·depth[LCA(u,v)]`. The LCA comes from the Euler-tour RMQ.

### M8. Which monoids work with a Fenwick over the flat array, and which need a segment tree?
Invertible monoids (`+`, XOR) work with a Fenwick via prefix differences. Non-invertible ones (`min`, `max`, `gcd`) have no inverse, so the prefix trick fails — use a segment tree.

### M9. What happens to the flattening when a node's value changes?
Nothing structural — `tin/tout` depend only on the tree's *shape*. You update the Fenwick/segtree at `tin[v]` in `O(log n)`. You only re-flatten when the *shape* changes.

### M10. How does ETT compare to Heavy-Light Decomposition?
ETT makes **subtrees** contiguous (`O(log n)` subtree queries) but does not directly handle paths. HLD makes **paths** contiguous across `O(log n)` chains (`O(log² n)` path queries) and still keeps subtrees contiguous. Use ETT for subtree-only; add HLD when you need path queries.

### M11. How do you handle a forest (multiple roots)?
Run the DFS from each root, continuing the same global `timer`. Each tree occupies a disjoint block of timestamps; subtree ranges still work per-tree.

### M12. What is the danger of mixing the two conventions?
Indices stop lining up. If you build a `2n` Euler array but treat `[tin[v], tout[v]]` as if the array had `n` cells, your ranges point at the wrong positions. Pick one convention and stay in it.

### M13. How do you avoid stack overflow when flattening a deep tree?
Use an iterative DFS with an explicit stack of `(node, parent, childIndex)` frames, or raise the recursion limit (Python). A near-chain tree has depth `≈ n`.

### M14. Count nodes in a subtree with a given property — how?
Build a flat array marking the property (1/0), then a Fenwick over it; the count in `v`'s subtree is the range sum `[tin[v], tout[v]]`. For "distinct values in subtree," use offline Mo's algorithm on the flattened array.

### M15. How does ETT enable Mo's algorithm on a tree?
Mo's algorithm answers offline range queries by reordering them to minimize pointer movement. You cannot apply it to a tree directly, but flattening turns each subtree into a contiguous range `[tin[v], tout[v]]`, so subtree queries become ordinary array ranges that Mo's processes in `O((n+q)√n)`. For path queries, a variant uses the `2n` Euler array and the in/out occurrences to add/remove nodes as the window slides.

---

## Middle Questions (continued)

### M16. Why is the in-time the right index to store a value at, not the node id?
The Fenwick/segment tree must be ordered so that a subtree forms a contiguous range. Node ids have no such property — node 5 might be anywhere in the tree. The DFS in-time `tin[v]` is exactly the position that makes subtrees contiguous, so values must live at `flat[tin[v]]`, indexed by time, not id.

---

## Senior Questions (12 Q&A)

### S1. Where does ETT appear in production systems?
Org-chart roll-ups (subtree sums of headcount/spend), permission/ACL inheritance (ancestor/subtree checks), category-tree aggregation, and — most widely — the **nested-set model** in SQL, where `lft`/`rgt` columns are exactly `tin`/`tout` and "all descendants" is a `BETWEEN lft AND rgt` range scan.

### S2. What is the operational cost of a shape change?
A shape change (reparent, insert subtree, re-root) invalidates the flattening because `tin/tout` are indexed by DFS order. The simple response is a full `O(n)` re-flatten + index rebuild. Value changes are cheap (`O(log n)`); shape changes are the wall.

### S3. How do you serve subtree queries at scale?
Separate **build from serve**: a flatten worker reads a consistent shape snapshot, produces a versioned immutable flattening, and a stateless query tier loads it. Value updates go to the live Fenwick/segtree; shape changes trigger a new flatten version, swapped via read-copy-update.

### S4. How do you combine ETT with HLD and LCA in one index?
One DFS emits `tin/tout` (subtree ranges), a depth/Euler array (LCA via RMQ), and HLD chains. If you order children **heavy-first**, the HLD base array is the same flattened order, so one segment tree backs both subtree queries (`O(log n)`) and path queries (`O(log² n)`).

### S5. When do you abandon static ETT for an Euler-Tour Tree?
When the tree's *shape* changes frequently. An Euler-Tour Tree stores the Euler sequence in a balanced BST, giving `O(log n)` `link`/`cut`/subtree-aggregate instead of `O(n)` re-flatten — at the cost of the flat array's cache-friendliness.

### S6. What is the id↔tin remapping failure?
Re-flattening renumbers `tin`. A client caching `tin[v]` from an old version reads a different node's cell after a rebuild. Publish the id↔`tin` mapping **together** with the flattening, version them as one, and reject version mismatches. Every lookup succeeds; only the meaning is silently wrong — the worst kind of bug.

### S7. How do you support time-travel ("subtree sum as of last week")?
Back the value index with a **persistent segment tree**: each update creates `O(log n)` new nodes and a new root; keep a root per version. Subtree queries over any historical version are `O(log n)`, sharing the flattening as long as the shape was stable.

### S8. What metrics do you monitor for a flattening index?
`ett_flatten_duration_seconds`, `ett_node_count`, `ett_shape_version`, and especially `ett_flatten_age_seconds` (staleness vs the live tree). The insidious failure is that every query succeeds against a *stale* flattening, so latency/error monitoring misses it; you need a freshness SLO and reconciliation diffs.

### S9. Why must the flatten worker read a consistent snapshot?
If it reads edges mid-reparent, it flattens a tree that never existed (a node under two parents, or a cycle), producing impossible subtree ranges. Take a point-in-time snapshot (read transaction / event-log offset) and record the marker in the artifact.

### S10. How do you bound staleness without rebuilding on every change?
Tiered freshness: serve the precomputed flattening for the common case; for nodes touched by a very recent reparent (a "dirty set"), fall back to an on-demand bounded DFS that is always fresh. Full re-flatten only when the dirty set crosses a threshold.

### S11. How do reads and writes interact concurrently?
`tin/tout` are immutable (shape-only), so range computation is lock-free. The value index is the mutable shared state — serialize writes (single-writer) and parallelize reads via a versioned snapshot, or use a persistent segment tree for lock-free snapshot reads.

### S12. Why does the nested-set model beat recursive CTEs for reads?
`WHERE lft BETWEEN parent.lft AND parent.rgt` is a contiguous, index-friendly range scan reading sequential pages, while a recursive descent issues random I/Os (one per node). Flattening converts the tree's scattered layout into a linear one — the same locality win as ETT in memory.

---

## Professional Questions (10 Q&A)

### P1. Prove that a subtree maps to a contiguous interval.
By induction on the DFS recursion: `DFS(v)` advances `timer` by exactly `|sub(v)|`, stamping precisely the vertices of `sub(v)` consecutively, because the descendants of `v` partition disjointly into `v` plus its children's subtrees, which DFS visits one after another without interleaving. Hence `{tin[u] : u ∈ sub(v)} = {tin[v], …, tout[v]}`.

### P2. Why is the ancestor test `tin[u]≤tin[w] ∧ tout[w]≤tout[u]` correct?
`w ∈ sub(u)` iff `sub(w) ⊆ sub(u)` iff `w`'s interval is nested inside `u`'s interval. Forward: containment of subtrees gives containment of intervals. Backward: `tin[w] ∈ [tin[u], tout[u]]` puts `w` in `sub(u)` by the subtree-as-interval theorem.

### P3. What is the laminar-family property and why does it matter?
Any two subtree intervals are disjoint or nested — never partially overlapping. This is *why* a single contiguous range is always correct for subtrees. Paths are **not** laminar, which is exactly why HLD must split a path into `O(log n)` intervals.

### P4. Prove LCA equals the min-depth node in the Euler-tour range.
Let `a = LCA(u,v)`. The tour between `first[u]` and `first[v]` is a walk that passes through `a`, so `a` appears in the range and `min depth ≤ depth(a)`. Every node in that range lies in `sub(a)` (the tour can't leave `sub(a)` between two of its nodes without returning to `a`), so all have depth `≥ depth(a)`. Hence the min is `depth(a)`, attained at `a`.

### P5. Why do consecutive Euler-tour depths differ by exactly ±1, and why does it matter?
Each recorded step of the `2n-1` tour moves to a parent or a child — one edge — so depth changes by exactly 1. This ±1 structure enables the Bender–Farach-Colton `⟨O(n), O(1)⟩` RMQ (block decomposition with only `O(√n)` distinct block shapes), giving optimal `O(1)` LCA after `O(n)` preprocessing.

### P6. Which auxiliary structure does a subtree query need, and why does it depend on the monoid?
The subtree aggregate equals the range aggregate over a commutative monoid. Invertible monoids (`+`, XOR) admit the prefix-difference trick, so a Fenwick suffices. Non-invertible monoids (`min`, `max`, `gcd`) have no inverse — you must use a segment tree (or sparse table for static data).

### P7. State the build/query/space complexities precisely.
Build: `Θ(n)`. Subtree query/update with Fenwick or lazy segtree: `Θ(log n)`. Ancestor test, subtree size: `Θ(1)`. LCA: `Θ(1)` with ±1 RMQ (`Θ(n)` space) or `Θ(log n)` with a segment tree. Space: `Θ(n)` for subtree machinery, `Θ(n log n)` if a sparse-table LCA is used.

### P8. Compare ETT, HLD, and centroid decomposition formally.
ETT linearizes **subtrees** (each is one interval; laminar; `Θ(n)` build). HLD linearizes **paths** (each crosses `O(log n)` chains; `Θ(n)` build; `O(log² n)` path query). Centroid decomposition linearizes **balanced recursion** (`O(log n)` layers; `Θ(n log n)` build). ETT is the lightest with the single cleanest invariant.

### P9. Why is the flattening cache-friendly?
It converts the tree's scattered node layout into a linear array, so a direct subtree range scan costs `Θ(⌈|sub(v)|/B⌉)` I/Os (one block per `B` cells) instead of `Θ(|sub(v)|)` random misses (one per node) for pointer-chasing DFS. This is the formal basis of nested-set efficiency.

### P10. Prove HLD's `O(log n)` chain bound (used to contrast with ETT).
Descending a light edge `v→c` at least halves the subtree size, since otherwise `c` would be `v`'s heavy child (`size(c) > size(v)/2`). A path can halve the subtree size at most `log₂ n` times, so it crosses `O(log n)` light edges, hence `O(log n)` chains. ETT needs no such bound because subtrees are already single intervals.

---

## Behavioral / Design Prompts

- *"Walk me through choosing between ETT and HLD for a tree-query service."* Drive at the subtree-vs-path query mix and shape-change frequency.
- *"Your subtree roll-ups are sometimes wrong after a reorg. Diagnose."* Lead them to stale flattening / id↔tin remapping / partial-snapshot flatten.
- *"How would you make subtree queries time-travel?"* Persistent segment tree per value version over a shared flattening.

---

## Coding Challenge 1 (3 Languages)

### Challenge: Subtree Sum with Updates

> Given a rooted tree with `n` nodes (root = 0) and an initial value per node, support two operations:
> - `update(v, x)`: set node `v`'s value to `x`.
> - `query(v)`: return the sum of all values in the subtree of `v`.
>
> Use the Euler tour + a Fenwick tree so each operation is `O(log n)`.

#### Go

```go
package main

import "fmt"

type SubtreeSum struct {
	tin, tout, cur []int
	bit            []int
	timer          int
	adj            [][]int
}

func newSubtreeSum(adj [][]int, vals []int, root int) *SubtreeSum {
	n := len(adj)
	s := &SubtreeSum{
		tin: make([]int, n), tout: make([]int, n),
		cur: make([]int, n), bit: make([]int, n+1), adj: adj,
	}
	s.dfs(root, -1)
	for v := 0; v < n; v++ {
		s.cur[v] = vals[v]
		s.add(s.tin[v], vals[v])
	}
	return s
}

func (s *SubtreeSum) dfs(v, p int) {
	s.tin[v] = s.timer
	s.timer++
	for _, c := range s.adj[v] {
		if c != p {
			s.dfs(c, v)
		}
	}
	s.tout[v] = s.timer - 1
}

func (s *SubtreeSum) add(i, delta int) {
	for i++; i < len(s.bit); i += i & (-i) {
		s.bit[i] += delta
	}
}

func (s *SubtreeSum) prefix(i int) int {
	t := 0
	for i++; i > 0; i -= i & (-i) {
		t += s.bit[i]
	}
	return t
}

func (s *SubtreeSum) Update(v, x int) {
	s.add(s.tin[v], x-s.cur[v])
	s.cur[v] = x
}

func (s *SubtreeSum) Query(v int) int {
	return s.prefix(s.tout[v]) - s.prefix(s.tin[v]-1)
}

func main() {
	adj := [][]int{{1, 2, 3}, {0, 4, 5}, {0}, {0, 6}, {1}, {1}, {3}}
	vals := []int{10, 20, 30, 40, 50, 60, 70}
	s := newSubtreeSum(adj, vals, 0)
	fmt.Println(s.Query(1)) // 20+50+60 = 130
	s.Update(4, 55)
	fmt.Println(s.Query(1)) // 135
	fmt.Println(s.Query(0)) // whole tree = 10+20+30+40+55+60+70 = 285
}
```

#### Java

```java
import java.util.*;

public class SubtreeSum {
    int[] tin, tout, cur; long[] bit; int timer = 0;
    List<List<Integer>> adj;

    SubtreeSum(List<List<Integer>> adj, long[] vals, int root) {
        this.adj = adj;
        int n = adj.size();
        tin = new int[n]; tout = new int[n]; cur = new int[n];
        bit = new long[n + 1];
        dfs(root, -1);
        for (int v = 0; v < n; v++) { cur[v] = (int) vals[v]; add(tin[v], vals[v]); }
    }

    void dfs(int v, int p) {
        tin[v] = timer++;
        for (int c : adj.get(v)) if (c != p) dfs(c, v);
        tout[v] = timer - 1;
    }

    void add(int i, long d) { for (i++; i < bit.length; i += i & (-i)) bit[i] += d; }
    long prefix(int i) { long s = 0; for (i++; i > 0; i -= i & (-i)) s += bit[i]; return s; }

    void update(int v, long x) { add(tin[v], x - cur[v]); cur[v] = (int) x; }
    long query(int v) { return prefix(tout[v]) - prefix(tin[v] - 1); }

    public static void main(String[] args) {
        int n = 7;
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[][] e = {{0,1},{0,2},{0,3},{1,4},{1,5},{3,6}};
        for (int[] x : e) { adj.get(x[0]).add(x[1]); adj.get(x[1]).add(x[0]); }
        SubtreeSum s = new SubtreeSum(adj, new long[]{10,20,30,40,50,60,70}, 0);
        System.out.println(s.query(1)); // 130
        s.update(4, 55);
        System.out.println(s.query(1)); // 135
        System.out.println(s.query(0)); // 285
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1_000_000)


class SubtreeSum:
    def __init__(self, adj, vals, root):
        n = len(adj)
        self.adj = adj
        self.tin = [0] * n
        self.tout = [0] * n
        self.cur = list(vals)
        self.bit = [0] * (n + 1)
        self.timer = 0
        self._dfs(root, -1)
        for v in range(n):
            self._add(self.tin[v], vals[v])

    def _dfs(self, v, p):
        self.tin[v] = self.timer
        self.timer += 1
        for c in self.adj[v]:
            if c != p:
                self._dfs(c, v)
        self.tout[v] = self.timer - 1

    def _add(self, i, d):
        i += 1
        while i < len(self.bit):
            self.bit[i] += d
            i += i & (-i)

    def _prefix(self, i):
        i += 1
        s = 0
        while i > 0:
            s += self.bit[i]
            i -= i & (-i)
        return s

    def update(self, v, x):
        self._add(self.tin[v], x - self.cur[v])
        self.cur[v] = x

    def query(self, v):
        return self._prefix(self.tout[v]) - self._prefix(self.tin[v] - 1)


if __name__ == "__main__":
    adj = [[1, 2, 3], [0, 4, 5], [0], [0, 6], [1], [1], [3]]
    s = SubtreeSum(adj, [10, 20, 30, 40, 50, 60, 70], 0)
    print(s.query(1))  # 130
    s.update(4, 55)
    print(s.query(1))  # 135
    print(s.query(0))  # 285
```

---

## Coding Challenge 2 (3 Languages)

### Challenge: Ancestor Query

> Given a rooted tree, answer `q` queries: "is `u` an ancestor of `v`?" Each query must be `O(1)` after `O(n)` preprocessing.

#### Go

```go
package main

import "fmt"

func ancestorChecker(adj [][]int, root int) func(u, v int) bool {
	n := len(adj)
	tin := make([]int, n)
	tout := make([]int, n)
	timer := 0
	var dfs func(v, p int)
	dfs = func(v, p int) {
		tin[v] = timer
		timer++
		for _, c := range adj[v] {
			if c != p {
				dfs(c, v)
			}
		}
		tout[v] = timer - 1
	}
	dfs(root, -1)
	return func(u, v int) bool {
		return tin[u] <= tin[v] && tout[v] <= tout[u]
	}
}

func main() {
	adj := [][]int{{1, 2, 3}, {0, 4, 5}, {0}, {0, 6}, {1}, {1}, {3}}
	isAnc := ancestorChecker(adj, 0)
	fmt.Println(isAnc(1, 5)) // true  (2 is ancestor of 6)
	fmt.Println(isAnc(1, 6)) // false (2 not ancestor of 7)
	fmt.Println(isAnc(0, 6)) // true  (root ancestor of all)
}
```

#### Java

```java
import java.util.*;

public class AncestorQuery {
    static int[] tin, tout; static int timer = 0; static List<List<Integer>> adj;

    static void dfs(int v, int p) {
        tin[v] = timer++;
        for (int c : adj.get(v)) if (c != p) dfs(c, v);
        tout[v] = timer - 1;
    }
    static boolean isAncestor(int u, int v) {
        return tin[u] <= tin[v] && tout[v] <= tout[u];
    }

    public static void main(String[] args) {
        int n = 7;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        int[][] e = {{0,1},{0,2},{0,3},{1,4},{1,5},{3,6}};
        for (int[] x : e) { adj.get(x[0]).add(x[1]); adj.get(x[1]).add(x[0]); }
        tin = new int[n]; tout = new int[n];
        dfs(0, -1);
        System.out.println(isAncestor(1, 5)); // true
        System.out.println(isAncestor(1, 6)); // false
        System.out.println(isAncestor(0, 6)); // true
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1_000_000)


def ancestor_checker(adj, root):
    n = len(adj)
    tin = [0] * n
    tout = [0] * n
    timer = 0

    def dfs(v, p):
        nonlocal timer
        tin[v] = timer
        timer += 1
        for c in adj[v]:
            if c != p:
                dfs(c, v)
        tout[v] = timer - 1

    dfs(root, -1)
    return lambda u, v: tin[u] <= tin[v] and tout[v] <= tout[u]


if __name__ == "__main__":
    adj = [[1, 2, 3], [0, 4, 5], [0], [0, 6], [1], [1], [3]]
    is_anc = ancestor_checker(adj, 0)
    print(is_anc(1, 5))  # True
    print(is_anc(1, 6))  # False
    print(is_anc(0, 6))  # True
```

---

## Final Tips

- State the **two conventions** unprompted; it signals depth.
- Get the **inclusive range** right and the **`O(1)` ancestor test** exactly.
- Mention the **monoid → Fenwick vs segment tree** distinction for non-sum aggregates.
- Never confuse ETT with **Euler circuits**; say so explicitly if the interviewer's wording is ambiguous.
- For path queries, pivot to **LCA-by-RMQ** and **HLD**.

**Next step:** Practice with [`tasks.md`](./tasks.md) — 15 graded Euler-tour tasks plus a cross-language benchmark.
