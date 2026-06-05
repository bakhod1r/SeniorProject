# Centroid Decomposition — Interview Preparation

> **One-line summary:** Interviewers use centroid decomposition to test whether you can recognize a tree *distance/path-counting* problem, articulate the `≤ N/2` halving and `O(log N)` depth, state the path-through-centroid principle, and avoid the two classic bugs (stale size recomputation, same-branch double-counting).

---

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (12 Q&A)](#middle-questions-12-qa)
4. [Senior Questions (10 Q&A)](#senior-questions-10-qa)
5. [Professional Questions (8 Q&A)](#professional-questions-8-qa)
6. [Behavioral / System-Design Questions (5)](#behavioral--system-design-questions-5)
7. [Coding Challenges](#coding-challenges)
8. [Common Pitfalls in Interviews](#common-pitfalls-in-interviews)
9. [What Interviewers Are Really Testing](#what-interviewers-are-really-testing)

---

## Quick-Reference Cheat Sheet

| Concept | Fact |
|---------|------|
| Centroid | Removal leaves every component `≤ ⌊N/2⌋`. |
| How many centroids | 1 or 2 (two are adjacent). |
| Centroid tree height | `O(log N)` (`≤ ⌊log₂ N⌋ + 1`). |
| Per-vertex levels | `O(log N)`. |
| Build time / space | `O(N log N)` / `O(N)` (or `O(N log N)` if storing per-centroid distances). |
| Path ownership | Every `u–v` path crosses `LCA_CT(u,v)` exactly once. |
| Counting hook | Per centroid: count paths through it; subtract same-branch over-count. |
| Find centroid | DFS sizes, then walk to child with `size > n/2`. |
| Must-do guards | `!removed[v]` everywhere; recompute `size[]` per level. |
| Sibling tools | HLD (14) = path aggregates; LCA (13) = pairwise distance; LCT = dynamic trees. |

Skeleton:
```
decompose(entry, cpar):
    n = computeSize(entry)        # residual only
    c = findCentroid(entry, n)
    removed[c] = true; cparent[c] = cpar
    process(c)                    # problem-specific, with inclusion-exclusion
    for v in adj[c] if !removed[v]: decompose(v, c)
```

---

## Junior Questions (12 Q&A)

**Q1. What is a centroid of a tree?**
A vertex whose removal leaves every remaining connected component with at most `⌊N/2⌋` vertices.

**Q2. How many centroids can a tree have?**
One or two. If two, they are adjacent (joined by an edge); this happens only when `N` is even.

**Q3. How do you find a centroid?**
Root anywhere, DFS to compute subtree sizes, then descend from the root toward whichever child's subtree has size `> n/2`; stop when no child exceeds `n/2`. You're standing on the centroid.

**Q4. What is the centroid tree?**
A new tree whose root is the first centroid; its children are the centroids of the components left after removing it, recursively. Each centroid's parent is the centroid of the component it was found in.

**Q5. Why is the centroid tree only `O(log N)` deep?**
Because each removal leaves pieces `≤ N/2`, the component containing any vertex at least halves every level, so after `O(log N)` levels it shrinks to size 1.

**Q6. What does `removed[]` do?**
Marks vertices already chosen as centroids so deeper recursions ignore them — the "residual tree" is everything not yet removed.

**Q7. Why must you recompute subtree sizes at each level?**
Because after removing centroids, the residual tree is different; sizes from a previous level are wrong and would give an incorrect centroid (and can cause infinite recursion).

**Q8. What's the build time?**
`O(N log N)`: `O(N)` work per level, `O(log N)` levels.

**Q9. Is centroid decomposition for general graphs?**
No — it requires a *tree* (connected, acyclic). For forests, decompose each tree separately.

**Q10. What kind of problems does it solve?**
Tree problems phrased in terms of *distance* or *paths*: count pairs at distance `K`, count paths of length `≤ K`, nearest marked node, etc.

**Q11. How is a centroid different from a tree's root or its "center"?**
The root is arbitrary. The *center* minimizes eccentricity (max distance). The *centroid* minimizes the largest component after removal (a size/mass criterion). They can differ.

**Q12. What's the single most common bug?**
Forgetting to recompute sizes over the residual tree (reusing stale `size[]`), closely followed by double-counting same-branch pairs.

---

## Middle Questions (12 Q&A)

**Q1. State the path-through-centroid principle.**
For any `u, v`, the unique tree path between them passes through exactly one vertex that is their LCA in the centroid tree — the highest-level centroid on the path.

**Q2. Why does that principle prevent double-counting?**
Each path is "owned" by exactly one centroid (its centroid-tree LCA). Summing per-centroid counts over all centroids counts each path exactly once.

**Q3. What is the inclusion–exclusion correction and why is it needed?**
When counting paths "through" a centroid `c` using all vertices in its component, you over-count pairs that lie in the *same* child branch (those paths don't actually pass through `c`). Subtract, per branch, the count computed within that branch alone.

**Q4. How do you count pairs at distance exactly `K`?**
Per centroid `c`, for each vertex at distance `d` from `c`, add `cnt[K − d]` where `cnt` accumulates distances from previously processed branches; or count over the whole component and subtract per-branch over-counts.

**Q5. How does counting "distance `≤ K`" differ?**
Replace exact-match lookup with a range count: sort the distance list per centroid and use two pointers (or prefix sums) to count pairs summing to `≤ K`. Adds a `log` factor → `O(N log² N)`.

**Q6. Centroid decomposition vs Heavy-Light Decomposition — when each?**
CD for *distance/path-counting* and nearest-marked-node. HLD (sibling 14) for *aggregates along a given path* (sum/max/assign on `u–v`) via a segment tree. Different problem classes.

**Q7. Centroid decomposition vs small-to-large?**
Small-to-large answers *subtree*-scoped multiset queries by merging child maps. CD answers *path*-scoped distance queries. Not interchangeable.

**Q8. How do you handle edge weights?**
Carry the accumulated weight in the distance DFS (`d + w`) instead of hop count. The counting logic is unchanged.

**Q9. Why `O(log² N)` for dynamic nearest-marked-node?**
Each update/query touches `O(log N)` centroid ancestors, and each touch costs `O(log N)` on a multiset/heap → `O(log² N)`.

**Q10. What do you store per centroid for radius queries?**
A sorted array of distances of all vertices in that centroid's component (so a query binary-searches a count within a radius).

**Q11. How much total per-centroid distance data is there?**
`O(N log N)` — each vertex appears in `O(log N)` components, contributing one distance entry each.

**Q12. How do you avoid recursion-depth crashes?**
Convert the size/gather DFS to an explicit-stack iterative form (or raise the recursion limit) — a path graph makes those DFS calls `O(N)` deep.

---

## Senior Questions (10 Q&A)

**Q1. When is centroid decomposition the right production choice?**
Static tree topology, query-heavy workload phrased as distance/nearest-facility/path-counting, where the `O(log N)` height gives predictable latency/memory.

**Q2. What happens if the tree's edges change?**
There's no cheap incremental update — you rebuild (`O(N log N)`). For dynamic topology use Link-Cut Trees / top-trees.

**Q3. How do you make queries concurrent?**
The structure is immutable after build → lock-free reads. Only the marked-set (dynamic nearest) is mutable; use per-centroid locks or lock-free multisets.

**Q4. How do you parallelize the build?**
After removing the top centroid, sibling components are disjoint and independent — recurse on them in parallel (fork-join), partitioning writes by component.

**Q5. What metrics would you monitor?**
Centroid-tree height (should be `≈ log₂ N`; spikes signal a size-recompute bug), ancestors visited per query, per-centroid structure sizes (skew), and p99 latency.

**Q6. Memory footprint for `N = 10⁶`?**
`O(N)` base; `O(N log N) ≈ 2×10⁷` entries if storing ancestor distances — tens of MB at 4 bytes per entry.

**Q7. How do you deploy topology changes with zero downtime?**
Double-buffer: build the new index, atomically swap pointers, drain the old one.

**Q8. Centroid decomposition vs LCA-only index for distance queries?**
If you only need pairwise distance (not counts), an LCA index (sibling 13) is far cheaper (`O(N)` space). CD is justified when you must *count* or answer *nearest* over sets.

**Q9. How would you shard a tree too big for one machine?**
Use the top centroid levels as a shared skeleton on a coordinator; assign each top-level component to a shard; resolve cross-component paths at the shared high-level centroids.

**Q10. What's the dominant failure mode in practice?**
Recursion depth on skewed/path trees during build, and stale size recomputation producing a degenerate (deep) centroid tree.

---

## Professional Questions (8 Q&A)

**Q1. Prove a centroid exists.**
Root the tree; descend toward any child whose subtree exceeds `⌊N/2⌋`. At the stopping vertex `c`, all child components are `≤ ⌊N/2⌋`; and since we descended into `c` because `s(c) > ⌊N/2⌋`, the upward component `N − s(c) < N/2 ≤ ⌊N/2⌋`. So all components are `≤ ⌊N/2⌋`. (See [`professional.md`](./professional.md).)

**Q2. Why at most two centroids, and why adjacent?**
The weight function `w(v) = max component size after removing v` is unimodal along any path; two minima can tie only at adjacent vertices, which occurs only when `N` is even.

**Q3. Prove the centroid tree height is `O(log N)`.**
The component containing a vertex `v` has sizes `N₀=N ≥ N₁ ≥ …` with `N_{i+1} ≤ ⌊Nᵢ/2⌋`, so `Nᵢ ≤ N/2ⁱ`; since `N_L ≥ 1`, `L ≤ log₂ N`.

**Q4. State and prove the path-decomposition theorem.**
For `u, v`, their centroid-tree LCA `c` lies on path `P(u,v)` and is the unique such common ancestor. Proof: take the first level separating `u` and `v`; before it they share a component (so `P(u,v)` is inside it), and the separating centroid must lie on `P(u,v)`; that centroid is the deepest common ancestor. (Full proof in `professional.md`.)

**Q5. Prove the `O(N log N)` build.**
Centroid-finding on a size-`n` component is `O(n)`. Charge it to the `n` vertices. Each vertex is in `O(log N)` components (Q3 corollary), so total charge per vertex is `O(log N)`; summed → `O(N log N)`.

**Q6. Why does inclusion–exclusion compute exactly the owned-by-`c` paths?**
"Through `c`" = endpoints in different child branches (or one endpoint is `c`). Counting over the whole component includes same-branch pairs (not through `c`); subtracting each branch's internal count removes precisely those.

**Q7. Space-time trade-off for radius queries?**
Storing per-centroid sorted distance arrays costs `O(N log N)` space and gives `O(log² N)` queries; storing only aggregates is `O(N)` but supports fewer query types.

**Q8. Is fully-dynamic centroid decomposition solved?**
No standard structure maintains the centroid tree under edge updates in polylog time while preserving the path-LCA property and augmentation; it's an open problem. LCT/top-trees handle dynamic path aggregates but not the centroid partition cheaply.

---

## Behavioral / System-Design Questions (5)

**Q1. Tell me about a time you chose a more complex data structure for a measurable win.**
Frame: identified an `O(N²)` pair-counting bottleneck, recognized the tree structure, applied centroid decomposition for `O(N log N)`, validated against a brute-force oracle, and quantified the latency drop.

**Q2. Design a "nearest open store" service over a hierarchical road network.**
Static tree → centroid decomposition index; per-centroid min-structures of open-store distances; `mark/unmark` on open/close; query walks `O(log N)` ancestors. Discuss build offline, immutable replicas, double-buffer rebuild on topology change.

**Q3. How would you test a centroid-decomposition implementation?**
Brute-force oracle on random small trees (including path and star), property assertions (height `≤ log₂ N + 1`, each component `≤` half its parent, per-vertex level count), and fuzzing mark/unmark sequences against BFS ground truth.

**Q4. You shipped a CD index and latency spiked after a data refresh — debug it.**
Suspect a degenerate centroid tree from stale size recomputation; check the height metric (should be `~log N`); verify `removed[]` handling and that sizes are recomputed over the residual tree each level.

**Q5. Trade-off discussion: CD vs HLD for a path-sum-update feature.**
HLD is correct here (aggregates along a path); CD does not natively support path-value updates. Explain you'd push back on using CD and pick HLD (sibling 14).

---

## Coding Challenges

### Challenge 1 — Count node pairs within distance `D`

**Problem.** Given a weighted tree, count unordered pairs `(u, v)` with `dist(u, v) ≤ D`.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type edge struct{ to, w int }

type Solver struct {
	adj     [][]edge
	removed []bool
	size    []int
	D       int
	ans     int64
}

func (s *Solver) computeSize(u, p int) int {
	s.size[u] = 1
	for _, e := range s.adj[u] {
		if e.to != p && !s.removed[e.to] {
			s.size[u] += s.computeSize(e.to, u)
		}
	}
	return s.size[u]
}

func (s *Solver) findCentroid(u, p, n int) int {
	for _, e := range s.adj[u] {
		if e.to != p && !s.removed[e.to] && s.size[e.to] > n/2 {
			return s.findCentroid(e.to, u, n)
		}
	}
	return u
}

func (s *Solver) gather(u, p, d int, out *[]int) {
	*out = append(*out, d)
	for _, e := range s.adj[u] {
		if e.to != p && !s.removed[e.to] {
			s.gather(e.to, u, d+e.w, out)
		}
	}
}

func (s *Solver) countLeq(d []int) int64 {
	sort.Ints(d)
	var c int64
	lo, hi := 0, len(d)-1
	for lo < hi {
		if d[lo]+d[hi] <= s.D {
			c += int64(hi - lo)
			lo++
		} else {
			hi--
		}
	}
	return c
}

func (s *Solver) decompose(entry int) {
	n := s.computeSize(entry, -1)
	c := s.findCentroid(entry, -1, n)
	s.removed[c] = true
	all := []int{0}
	for _, e := range s.adj[c] {
		if !s.removed[e.to] {
			var br []int
			s.gather(e.to, c, e.w, &br)
			all = append(all, br...)
			s.ans -= s.countLeq(br)
		}
	}
	s.ans += s.countLeq(all)
	for _, e := range s.adj[c] {
		if !s.removed[e.to] {
			s.decompose(e.to)
		}
	}
}

func main() {
	s := &Solver{adj: make([][]edge, 5), removed: make([]bool, 5), size: make([]int, 5), D: 3}
	add := func(u, v, w int) {
		s.adj[u] = append(s.adj[u], edge{v, w})
		s.adj[v] = append(s.adj[v], edge{u, w})
	}
	add(0, 1, 1); add(1, 2, 1); add(1, 3, 2); add(3, 4, 1)
	s.decompose(0)
	fmt.Println("pairs with dist <= 3:", s.ans)
}
```

#### Java

```java
import java.util.*;

public class PairsWithinD {
    int[][] to; // adjacency via arrays of {to, w}
    List<int[]>[] adj;
    boolean[] removed;
    int[] size;
    int D;
    long ans = 0;

    @SuppressWarnings("unchecked")
    PairsWithinD(int n, int D) {
        this.D = D;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        removed = new boolean[n];
        size = new int[n];
    }

    void addEdge(int u, int v, int w) { adj[u].add(new int[]{v, w}); adj[v].add(new int[]{u, w}); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int[] e : adj[u]) if (e[0] != p && !removed[e[0]]) size[u] += computeSize(e[0], u);
        return size[u];
    }

    int findCentroid(int u, int p, int n) {
        for (int[] e : adj[u]) if (e[0] != p && !removed[e[0]] && size[e[0]] > n / 2) return findCentroid(e[0], u, n);
        return u;
    }

    void gather(int u, int p, int d, List<Integer> out) {
        out.add(d);
        for (int[] e : adj[u]) if (e[0] != p && !removed[e[0]]) gather(e[0], u, d + e[1], out);
    }

    long countLeq(List<Integer> d) {
        Collections.sort(d);
        long c = 0; int lo = 0, hi = d.size() - 1;
        while (lo < hi) {
            if (d.get(lo) + d.get(hi) <= D) { c += hi - lo; lo++; } else hi--;
        }
        return c;
    }

    void decompose(int entry) {
        int n = computeSize(entry, -1);
        int c = findCentroid(entry, -1, n);
        removed[c] = true;
        List<Integer> all = new ArrayList<>(); all.add(0);
        for (int[] e : adj[c]) if (!removed[e[0]]) {
            List<Integer> br = new ArrayList<>();
            gather(e[0], c, e[1], br);
            all.addAll(br);
            ans -= countLeq(br);
        }
        ans += countLeq(all);
        for (int[] e : adj[c]) if (!removed[e[0]]) decompose(e[0]);
    }

    public static void main(String[] args) {
        PairsWithinD s = new PairsWithinD(5, 3);
        s.addEdge(0,1,1); s.addEdge(1,2,1); s.addEdge(1,3,2); s.addEdge(3,4,1);
        s.decompose(0);
        System.out.println("pairs with dist <= 3: " + s.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class PairsWithinD:
    def __init__(self, n, D):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.D = D
        self.ans = 0

    def add_edge(self, u, v, w):
        self.adj[u].append((v, w))
        self.adj[v].append((u, w))

    def compute_size(self, u, p):
        self.size[u] = 1
        for v, _ in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, n):
        for v, _ in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.find_centroid(v, u, n)
        return u

    def gather(self, u, p, d, out):
        out.append(d)
        for v, w in self.adj[u]:
            if v != p and not self.removed[v]:
                self.gather(v, u, d + w, out)

    def count_leq(self, d):
        d.sort()
        c, lo, hi = 0, 0, len(d) - 1
        while lo < hi:
            if d[lo] + d[hi] <= self.D:
                c += hi - lo
                lo += 1
            else:
                hi -= 1
        return c

    def decompose(self, entry):
        n = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, n)
        self.removed[c] = True
        all_d = [0]
        for v, w in self.adj[c]:
            if not self.removed[v]:
                br = []
                self.gather(v, c, w, br)
                all_d.extend(br)
                self.ans -= self.count_leq(br)
        self.ans += self.count_leq(all_d)
        for v, _ in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v)


if __name__ == "__main__":
    s = PairsWithinD(5, 3)
    for u, v, w in [(0, 1, 1), (1, 2, 1), (1, 3, 2), (3, 4, 1)]:
        s.add_edge(u, v, w)
    s.decompose(0)
    print("pairs with dist <= 3:", s.ans)
```

### Challenge 2 — Count paths of length exactly `K` edges (IOI "Race" flavor)

**Problem.** Given a tree and an integer `K`, count *unordered pairs* of nodes whose path has exactly `K` edges. (The IOI Race variant minimizes the edge-count of a path with total weight exactly `K`; the counting variant below uses a frequency array.)

#### Go

```go
package main

import "fmt"

type Solver struct {
	adj     [][]int
	removed []bool
	size    []int
	K       int
	cnt     []int // cnt[d] = how many vertices at distance d from current centroid (accumulated)
	ans     int64
	touched []int
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

// count pairs by querying cnt[K-d]; if add, also register into cnt
func (s *Solver) walk(u, p, d int, query bool) {
	if d > s.K {
		return
	}
	if query && s.K-d >= 0 {
		s.ans += int64(s.cnt[s.K-d])
	}
	if !query {
		s.cnt[d]++
		s.touched = append(s.touched, d)
	}
	for _, v := range s.adj[u] {
		if v != p && !s.removed[v] {
			s.walk(v, u, d+1, query)
		}
	}
}

func (s *Solver) decompose(entry int) {
	n := s.computeSize(entry, -1)
	c := s.findCentroid(entry, -1, n)
	s.removed[c] = true
	s.cnt[0] = 1 // the centroid itself, distance 0
	s.touched = append(s.touched, 0)
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.walk(v, c, 1, true)  // query against everything registered so far
			s.walk(v, c, 1, false) // then register this branch
		}
	}
	for _, d := range s.touched {
		s.cnt[d] = 0
	}
	s.touched = s.touched[:0]
	for _, v := range s.adj[c] {
		if !s.removed[v] {
			s.decompose(v)
		}
	}
}

func main() {
	n := 5
	s := &Solver{adj: make([][]int, n), removed: make([]bool, n), size: make([]int, n), K: 2, cnt: make([]int, n+1)}
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {3, 4}} {
		s.adj[e[0]] = append(s.adj[e[0]], e[1])
		s.adj[e[1]] = append(s.adj[e[1]], e[0])
	}
	s.decompose(0)
	fmt.Println("pairs at distance exactly 2:", s.ans)
}
```

#### Java

```java
import java.util.*;

public class PathsExactK {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size, cnt;
    int K;
    long ans = 0;
    List<Integer> touched = new ArrayList<>();

    PathsExactK(int n, int K) {
        this.K = K;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        cnt = new int[n + 1];
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
        return size[u];
    }

    int findCentroid(int u, int p, int n) {
        for (int v : adj.get(u)) if (v != p && !removed[v] && size[v] > n / 2) return findCentroid(v, u, n);
        return u;
    }

    void walk(int u, int p, int d, boolean query) {
        if (d > K) return;
        if (query && K - d >= 0) ans += cnt[K - d];
        if (!query) { cnt[d]++; touched.add(d); }
        for (int v : adj.get(u)) if (v != p && !removed[v]) walk(v, u, d + 1, query);
    }

    void decompose(int entry) {
        int n = computeSize(entry, -1);
        int c = findCentroid(entry, -1, n);
        removed[c] = true;
        cnt[0] = 1; touched.add(0);
        for (int v : adj.get(c)) if (!removed[v]) { walk(v, c, 1, true); walk(v, c, 1, false); }
        for (int d : touched) cnt[d] = 0;
        touched.clear();
        for (int v : adj.get(c)) if (!removed[v]) decompose(v);
    }

    public static void main(String[] args) {
        PathsExactK s = new PathsExactK(5, 2);
        int[][] e = {{0,1},{1,2},{1,3},{3,4}};
        for (int[] x : e) s.addEdge(x[0], x[1]);
        s.decompose(0);
        System.out.println("pairs at distance exactly 2: " + s.ans);
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1 << 20)


class PathsExactK:
    def __init__(self, n, K):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.K = K
        self.cnt = [0] * (n + 1)
        self.ans = 0
        self.touched = []

    def add_edge(self, u, v):
        self.adj[u].append(v)
        self.adj[v].append(u)

    def compute_size(self, u, p):
        self.size[u] = 1
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.size[u] += self.compute_size(v, u)
        return self.size[u]

    def find_centroid(self, u, p, n):
        for v in self.adj[u]:
            if v != p and not self.removed[v] and self.size[v] > n // 2:
                return self.find_centroid(v, u, n)
        return u

    def walk(self, u, p, d, query):
        if d > self.K:
            return
        if query and self.K - d >= 0:
            self.ans += self.cnt[self.K - d]
        if not query:
            self.cnt[d] += 1
            self.touched.append(d)
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.walk(v, u, d + 1, query)

    def decompose(self, entry):
        n = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, n)
        self.removed[c] = True
        self.cnt[0] = 1
        self.touched.append(0)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.walk(v, c, 1, True)
                self.walk(v, c, 1, False)
        for d in self.touched:
            self.cnt[d] = 0
        self.touched.clear()
        for v in self.adj[c]:
            if not self.removed[v]:
                self.decompose(v)


if __name__ == "__main__":
    s = PathsExactK(5, 2)
    for u, v in [(0, 1), (1, 2), (1, 3), (3, 4)]:
        s.add_edge(u, v)
    s.decompose(0)
    print("pairs at distance exactly 2:", s.ans)
```

This "query-then-register branch by branch" form is itself a clean inclusion–exclusion: a branch is only counted against branches processed *before* it, so no same-branch pair is ever counted.

### Challenge 3 — Closest marked node with updates

See the full `mark / unmark / query` implementation in [`senior.md`](./senior.md) §7 (all three languages). In an interview, sketch: precompute `dist(x, ancestor)` for each centroid ancestor; per centroid keep a min over marked distances; update touches `O(log N)` centroids; query takes `min(dist(x,c) + best[c])` over ancestors. Total `O(log² N)` per op.

---

## Common Pitfalls in Interviews

- **Confusing centroid with center or root.** The centroid is a *mass/size* minimizer, not an eccentricity minimizer.
- **Reusing stale sizes.** Forgetting that the residual tree shrinks; this is the #1 bug interviewers probe.
- **Double-counting.** Not applying inclusion–exclusion (or the equivalent "query before register") for same-branch pairs.
- **Reaching for CD on a path-aggregate problem.** That's HLD (14); using CD signals you don't know the boundary.
- **Ignoring recursion depth.** On a path graph the size DFS is `O(N)` deep — say you'd use an explicit stack.
- **Claiming dynamic edge updates are cheap.** They aren't — CD is static; mention LCT for dynamic topology.

---

## What Interviewers Are Really Testing

1. **Pattern recognition** — can you spot that "count pairs/paths by distance on a tree" is a centroid-decomposition problem, distinct from HLD's path-aggregate problems?
2. **The core invariants** — `≤ N/2` halving, `O(log N)` depth, `O(log N)` levels per vertex, `O(N log N)` build, and the path-through-centroid principle.
3. **Bug awareness** — do you proactively mention recomputing sizes over the residual tree and avoiding same-branch double-counting?
4. **Counting rigor** — can you derive the inclusion–exclusion correction and explain *why* it counts each path exactly once?
5. **Engineering judgment** — static vs dynamic topology, memory trade-offs, recursion depth, and when a simpler tool (LCA index) suffices.
