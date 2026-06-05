# Centroid Decomposition — Senior Level

> **One-line summary:** At scale, centroid decomposition is a *build-once, query-many* index for tree-distance analytics and nearest-facility queries; its value is the guaranteed `O(log N)` height that bounds per-query and per-update work, and its main operational risks are recursion depth on skewed trees and stale subtree-size recomputation.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Design](#2-system-design)
3. [Distributed / Large-Tree Considerations](#3-distributed--large-tree-considerations)
4. [Concurrency](#4-concurrency)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Code Examples](#7-code-examples)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning](#10-capacity-planning)
11. [Summary](#11-summary)

---

## 1. Introduction

A senior engineer rarely implements centroid decomposition for a one-off contest answer. The interesting question is: *when does it earn its place in a production system, and how do you operate it?* The answer is consistently in **tree-shaped distance analytics**: hierarchical networks, road/rail trees, file-system trees, org charts, dependency forests — anywhere queries are phrased as "how many nodes within distance R," "nearest marked node," or "count paths with property" and the underlying graph is (or can be approximated as) a tree.

The decisive property is **bounded height**. The centroid tree has height `O(log N)`, so per-vertex bookkeeping is `O(log N)` and per-query work is `O(log N)`–`O(log² N)` regardless of how skewed the original tree is. That predictability — a path graph of 10⁷ nodes still yields a depth-24 centroid tree — is what makes it operable. You can size memory, latency, and throughput against `N log N`, not against the (unbounded) diameter of the input.

This file treats centroid decomposition as an **index data structure**: how to build it, store it, query it, observe it, and reason about its failure modes at production scale. We compare it against Heavy-Light Decomposition (sibling **14**) and Link-Cut Trees for *different* query classes, and against the simpler **13-lca** index when only distances (not counts) are needed.

---

## 2. System Design

### Use case A — Tree-distance analytics

"Count nodes within `R` hops of node `x`" over a fixed hierarchy serving millions of queries.

- **Build phase (offline):** decompose once into the centroid tree. For each vertex `x`, store the list of `(centroid_ancestor, dist(x, centroid_ancestor))` — that is `O(log N)` entries per vertex, `O(N log N)` total. Per centroid, store a sorted array of all distances in its component.
- **Query phase (online):** walk `x`'s `O(log N)` ancestors; at each centroid `c` binary-search the count of component vertices with `dist(c, ·) ≤ R − dist(x, c)`; subtract the same-branch over-count. Latency `O(log² N)`.

### Use case B — Nearest-facility queries with updates

"Nearest open store to a customer node," stores open/close over the day.

- Per centroid `c`, maintain a min-structure (multiset / indexed heap) of `dist(c, m)` for currently-open stores `m` in `c`'s component.
- **Open/close (update):** touch `x`'s `O(log N)` centroid ancestors, insert/remove `dist(x, c)`.
- **Query:** over `x`'s ancestors, `min(dist(x, c) + best_open[c])`.

Both designs are *read-optimized indexes*: the build is the expensive, one-time step; queries and (for B) updates are cheap and bounded.

### Capacity-shaping decision

The biggest design lever is **how much per-vertex/per-centroid data you materialize**. Storing per-centroid sorted distance arrays for *all* vertices is `O(N log N)` memory but gives `O(log² N)` radius queries. Storing only per-centroid aggregates (e.g. a single `best[]`) is `O(N)` memory but supports fewer query types. Choose based on the query mix.

---

## 3. Distributed / Large-Tree Considerations

- **Single-machine first.** A 10⁷-node tree needs roughly `N log N ≈ 2.4×10⁸` distance entries — on the order of low GBs with 4–8 byte entries. This usually fits one large box; prefer that over distribution.
- **If `N` truly exceeds RAM:** the centroid tree partitions naturally. The top few centroid levels form a small "skeleton"; each top-level component is independent and can be assigned to a shard. Cross-component paths are handled at the shared high-level centroids, which live on a coordinator. This mirrors the recursion structure.
- **Immutability helps replication.** A static centroid tree is read-only; replicate it freely across read replicas. Only the *marked-set* state (use case B) is mutable and must be coordinated (see Concurrency).
- **Cold build, hot serve.** Build is `O(N log N)` and embarrassingly parallel across sibling components; serving is stateless reads against an immutable index — ideal for a build-then-fan-out deployment.

---

## 4. Concurrency

- **Immutable structure → lock-free reads.** The adjacency, `cparent[]`, per-vertex ancestor-distance tables, and per-centroid sorted arrays never change after build. Concurrent radius/count queries need **no locking**.
- **Parallel build.** After the top centroid is found and removed, each resulting component is independent. Recurse on sibling components in parallel (work-stealing / fork-join). Because components are disjoint vertex sets, there is no shared mutable state except the global `removed[]` and `cparent[]`, which are written exactly once per vertex — partition writes by ownership to avoid contention.
- **Mutable marked-set (use case B).** Per-centroid min-structures are the only contended state. Options:
  - Shard locks: one lock per centroid; updates to disjoint centroid sets don't contend.
  - Lock-free concurrent multiset / skip-list per centroid.
  - Since each update touches `O(log N)` centroids, fine-grained per-centroid locking keeps contention low under skewed-but-spread workloads.
- **Recursion vs threads.** Convert deep recursion to explicit stacks before parallelizing; an `O(N)`-deep native stack on a path graph will blow the thread stack in any worker pool.

---

## 5. Comparison at Scale

| Need | Best structure | Why |
|------|----------------|-----|
| Count pairs/nodes by **distance**, nearest-marked-node | **Centroid decomposition** | Decomposes by highest centroid; `O(log²N)` query. |
| **Path-aggregate** query/update (sum/max/assign on `u–v` path) | **Heavy-Light Decomposition (14)** | Maps paths to `O(log N)` segment-tree ranges. |
| **Fully dynamic** trees (link/cut edges) with path aggregates | **Link-Cut Trees (LCT)** | `O(log N)` amortized per structural change; centroid tree is *not* easily dynamic. |
| Pure **distance** between two nodes, no counting | **LCA index (13)** | `O(1)`/`O(log N)` distance, far less memory than full CD. |
| Subtree color/count, offline | **Small-to-large / Euler + BIT** | Subtree-scoped, not path-scoped. |

Key scaling distinction: **centroid decomposition assumes a static tree.** If edges are inserted/deleted, the centroid tree must be rebuilt (`O(N log N)`) — there is no cheap incremental update. For dynamic topology, LCT or top-trees win. For *static topology with dynamic vertex marks*, centroid decomposition is excellent.

### Workload-by-workload: CD vs HLD vs LCT

The three "tree decomposition" structures a senior is asked to choose between solve **different query algebras**. The table below maps a concrete workload to the right tool and the wrong-but-tempting one.

| Workload | Centroid Decomposition | Heavy-Light Decomposition (14) | Link-Cut Tree |
|----------|------------------------|--------------------------------|---------------|
| "Count nodes within R hops of x" | **Native.** `O(log²N)` per query. | Not designed for it; would need per-path scans. | No native support. |
| "Nearest marked node to x, marks toggle" | **Native.** `O(log²N)` update/query. | Awkward; no distance-radius primitive. | No. |
| "Count paths in the whole tree with length ≤ K" | **Native**, one offline pass `O(N log N)`. | No global-path-set primitive. | No. |
| "Sum of edge weights on path u→v" | Possible but clumsy. | **Native**, `O(log²N)`. | **Native**, `O(log N)` amortized. |
| "Add δ to every edge on path u→v, then max-query a path" | No. | **Native** with lazy segtree. | **Native**. |
| "link(u,v) / cut(u,v) then path-sum" | **No** — forces full rebuild. | No (static topology). | **Native** — the only one. |
| "k-th ancestor / LCA only" | Overkill. | Fine. | Fine; but use 13-lca index. |

The decision rule a senior internalizes: **CD answers questions about the *set of all paths* and about *distance/radius*; HLD/LCT answer questions about *one specified path*; only LCT tolerates *topology mutation*.** Mixing these up is the single most common design error in this space — e.g. reaching for HLD to count distance-≤-R neighborhoods, or reaching for CD to do path-sum updates.

A second axis is **mutability of what changes**:
- *Topology fixed, weights/values on a path change* → HLD (offline-friendly, simple).
- *Topology fixed, vertex marks/colors change* → CD (per-centroid min/count structures).
- *Topology itself changes (link/cut)* → LCT or top-trees; CD and HLD both require rebuild.

### Immutable centroid tree + parallel per-subtree work

The build has a recursion structure that maps cleanly onto fork-join parallelism, and the *served* index is immutable, which is the property that makes the parallelism safe and the reads lock-free.

**Build parallelism.** After the root centroid `c₀` is found and `removed[c₀]=true`, each child component is a **disjoint vertex set**. Recursing into them touches non-overlapping regions of `adj`, `size`, `cparent`, and the per-vertex ancestor-distance tables — so sibling recursions can run on different workers with no synchronization, *provided* writes are partitioned by vertex ownership (each vertex is written by exactly the recursion that owns its component at that level).

```
                 build(root)            worker W0
                /     |      \
        comp A    comp B    comp C      → fork to W1, W2, W3
        /  \        |        / \
      ...  ...     ...     ... ...      → recursively fork until
                                          components are small enough
                                          to finish inline (cutoff)
```

Practical recipe:
- Use a **size cutoff** (e.g. components below ~10⁴ vertices) below which a worker recurses sequentially — fork overhead dominates for tiny components.
- The only truly shared writes are `removed[]` and `cparent[]`. `removed[c]` is written once, before the fork, by the owning level; `cparent[c]` is written once when `c` becomes a centroid. No two workers write the same index, so plain arrays without locks are correct under a happens-before fork-join fence.
- Convert the size/record DFS to an **explicit stack** before parallelizing — a native `O(N)`-deep recursion on a path-shaped component will overflow a worker-pool thread's small stack.

**Serve parallelism.** Once built, the index is read-only for the *distance/count* query classes: lock-free, replicate freely. Only the **marked-set** (use case B) mutates; isolate that mutable state into per-centroid structures (see Concurrency) so the immutable backbone stays shareable.

---

## 6. Architecture Patterns

- **Index service.** Wrap the centroid tree behind a query API (`countWithin(x, R)`, `nearestMarked(x)`, `mark(x)/unmark(x)`). Build offline, ship the immutable artifact, serve reads from replicas.
- **Layered storage.** Hot top-level centroids (few, high fan-in) in memory; deep, rarely-touched per-centroid arrays can be memory-mapped or paged.
- **Rebuild pipeline.** Because there's no incremental edge update, treat topology changes as a periodic rebuild job; double-buffer (build new index, atomically swap) for zero-downtime cutover.
- **Hook separation.** Keep the generic decomposition engine independent from the per-centroid "count/aggregate" hook so multiple query types share one build.

---

## 7. Code Examples

### Example: Nearest marked node with updates

Static topology; vertices can be marked/unmarked; query nearest marked vertex to `x`. We precompute, for each vertex, distances to all its `O(log N)` centroid ancestors, and keep a multiset of marked distances per centroid.

#### Go

```go
package main

import (
	"fmt"
)

const INF = int(1e9)

type Nearest struct {
	adj     [][]int
	removed []bool
	size    []int
	cparent []int
	// ancDist[x] = list of (centroid, dist(x, centroid)) for each ancestor
	ancDist [][]pair
	// per-centroid multiset of marked distances (value -> count) + current min
	marks []map[int]int
}

type pair struct{ c, d int }

func NewNearest(n int) *Nearest {
	N := &Nearest{
		adj:     make([][]int, n),
		removed: make([]bool, n),
		size:    make([]int, n),
		cparent: make([]int, n),
		ancDist: make([][]pair, n),
		marks:   make([]map[int]int, n),
	}
	for i := 0; i < n; i++ {
		N.cparent[i] = -1
		N.marks[i] = map[int]int{}
	}
	return N
}

func (N *Nearest) AddEdge(u, v int) {
	N.adj[u] = append(N.adj[u], v)
	N.adj[v] = append(N.adj[v], u)
}

func (N *Nearest) computeSize(u, p int) int {
	N.size[u] = 1
	for _, v := range N.adj[u] {
		if v != p && !N.removed[v] {
			N.size[u] += N.computeSize(v, u)
		}
	}
	return N.size[u]
}

func (N *Nearest) findCentroid(u, p, n int) int {
	for _, v := range N.adj[u] {
		if v != p && !N.removed[v] && N.size[v] > n/2 {
			return N.findCentroid(v, u, n)
		}
	}
	return u
}

// record dist(x, c) for every x reachable from c in the residual component
func (N *Nearest) recordDist(u, p, d, c int) {
	N.ancDist[u] = append(N.ancDist[u], pair{c, d})
	for _, v := range N.adj[u] {
		if v != p && !N.removed[v] {
			N.recordDist(v, u, d+1, c)
		}
	}
}

func (N *Nearest) Build(entry, cpar int) int {
	n := N.computeSize(entry, -1)
	c := N.findCentroid(entry, -1, n)
	N.removed[c] = true
	N.cparent[c] = cpar
	N.recordDist(c, -1, 0, c) // includes c at distance 0
	for _, v := range N.adj[c] {
		if !N.removed[v] {
			N.Build(v, c)
		}
	}
	return c
}

func (N *Nearest) Mark(x int) {
	for _, pr := range N.ancDist[x] {
		N.marks[pr.c][pr.d]++
	}
}

func (N *Nearest) Unmark(x int) {
	for _, pr := range N.ancDist[x] {
		m := N.marks[pr.c]
		if m[pr.d] <= 1 {
			delete(m, pr.d)
		} else {
			m[pr.d]--
		}
	}
}

func (N *Nearest) Query(x int) int {
	best := INF
	for _, pr := range N.ancDist[x] {
		// min marked distance stored at centroid pr.c
		mn := INF
		for d := range N.marks[pr.c] {
			if d < mn {
				mn = d
			}
		}
		if mn < INF && pr.d+mn < best {
			best = pr.d + mn
		}
	}
	return best
}

func main() {
	N := NewNearest(7)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {1, 3}, {2, 4}, {3, 5}, {5, 6}} {
		N.AddEdge(e[0], e[1])
	}
	N.Build(0, -1)
	N.Mark(4)
	N.Mark(6)
	fmt.Println("nearest marked to 0:", N.Query(0)) // dist(0,4)=3, dist(0,6)=4 -> 3
	N.Unmark(4)
	fmt.Println("nearest marked to 0:", N.Query(0)) // now only 6 -> 4
}
```

> Note: the per-centroid `min` scan above is `O(component-min-distinct)` for clarity; in production replace each `map[int]int` with an indexed min-heap or balanced multiset for `O(log N)` min.

#### Java

```java
import java.util.*;

public class NearestMarked {
    List<List<Integer>> adj;
    boolean[] removed;
    int[] size, cparent;
    // ancDist[x]: list of {centroid, dist}
    List<int[]>[] ancDist;
    // per-centroid TreeMap<distance, count>
    TreeMap<Integer,Integer>[] marks;
    static final int INF = (int)1e9;

    @SuppressWarnings("unchecked")
    NearestMarked(int n) {
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        removed = new boolean[n];
        size = new int[n];
        cparent = new int[n];
        Arrays.fill(cparent, -1);
        ancDist = new List[n];
        marks = new TreeMap[n];
        for (int i = 0; i < n; i++) { ancDist[i] = new ArrayList<>(); marks[i] = new TreeMap<>(); }
    }

    void addEdge(int u, int v) { adj.get(u).add(v); adj.get(v).add(u); }

    int computeSize(int u, int p) {
        size[u] = 1;
        for (int v : adj.get(u)) if (v != p && !removed[v]) size[u] += computeSize(v, u);
        return size[u];
    }

    int findCentroid(int u, int p, int total) {
        for (int v : adj.get(u))
            if (v != p && !removed[v] && size[v] > total / 2) return findCentroid(v, u, total);
        return u;
    }

    void recordDist(int u, int p, int d, int c) {
        ancDist[u].add(new int[]{c, d});
        for (int v : adj.get(u)) if (v != p && !removed[v]) recordDist(v, u, d + 1, c);
    }

    int build(int entry, int cpar) {
        int total = computeSize(entry, -1);
        int c = findCentroid(entry, -1, total);
        removed[c] = true;
        cparent[c] = cpar;
        recordDist(c, -1, 0, c);
        for (int v : adj.get(c)) if (!removed[v]) build(v, c);
        return c;
    }

    void mark(int x) {
        for (int[] pr : ancDist[x]) marks[pr[0]].merge(pr[1], 1, Integer::sum);
    }

    void unmark(int x) {
        for (int[] pr : ancDist[x]) {
            TreeMap<Integer,Integer> m = marks[pr[0]];
            int v = m.get(pr[1]);
            if (v <= 1) m.remove(pr[1]); else m.put(pr[1], v - 1);
        }
    }

    int query(int x) {
        int best = INF;
        for (int[] pr : ancDist[x]) {
            TreeMap<Integer,Integer> m = marks[pr[0]];
            if (!m.isEmpty()) best = Math.min(best, pr[1] + m.firstKey());
        }
        return best;
    }

    public static void main(String[] args) {
        NearestMarked N = new NearestMarked(7);
        int[][] e = {{0,1},{1,2},{1,3},{2,4},{3,5},{5,6}};
        for (int[] x : e) N.addEdge(x[0], x[1]);
        N.build(0, -1);
        N.mark(4); N.mark(6);
        System.out.println("nearest marked to 0: " + N.query(0)); // 3
        N.unmark(4);
        System.out.println("nearest marked to 0: " + N.query(0)); // 4
    }
}
```

#### Python

```python
import sys
from sortedcontainers import SortedList  # or use a heap; std-lib fallback below
sys.setrecursionlimit(1 << 20)


class NearestMarked:
    INF = 10 ** 9

    def __init__(self, n):
        self.adj = [[] for _ in range(n)]
        self.removed = [False] * n
        self.size = [0] * n
        self.cparent = [-1] * n
        self.anc_dist = [[] for _ in range(n)]  # (centroid, dist)
        self.marks = [SortedList() for _ in range(n)]  # per-centroid distances

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

    def record_dist(self, u, p, d, c):
        self.anc_dist[u].append((c, d))
        for v in self.adj[u]:
            if v != p and not self.removed[v]:
                self.record_dist(v, u, d + 1, c)

    def build(self, entry, cpar):
        total = self.compute_size(entry, -1)
        c = self.find_centroid(entry, -1, total)
        self.removed[c] = True
        self.cparent[c] = cpar
        self.record_dist(c, -1, 0, c)
        for v in self.adj[c]:
            if not self.removed[v]:
                self.build(v, c)
        return c

    def mark(self, x):
        for c, d in self.anc_dist[x]:
            self.marks[c].add(d)

    def unmark(self, x):
        for c, d in self.anc_dist[x]:
            self.marks[c].remove(d)

    def query(self, x):
        best = self.INF
        for c, d in self.anc_dist[x]:
            if self.marks[c]:
                best = min(best, d + self.marks[c][0])
        return best


if __name__ == "__main__":
    N = NearestMarked(7)
    for u, v in [(0, 1), (1, 2), (1, 3), (2, 4), (3, 5), (5, 6)]:
        N.add_edge(u, v)
    N.build(0, -1)
    N.mark(4); N.mark(6)
    print("nearest marked to 0:", N.query(0))  # 3
    N.unmark(4)
    print("nearest marked to 0:", N.query(0))  # 4
```

**What it does:** answers nearest-marked-node queries with point mark/unmark updates in `O(log² N)` per operation. The Python version uses `sortedcontainers`; substitute a heap with lazy deletion if that package is unavailable.

---

## 8. Observability

- **Build metrics:** `N`, centroid-tree height (should be `≈ log₂ N`; alert if much larger — indicates a size-recompute bug), total entries materialized (`Σ levels ≈ N·height`).
- **Per-query metrics:** number of centroid ancestors visited per query (should be `≤ height`), per-centroid structure sizes (skew indicator), p50/p99 latency.
- **Memory:** total per-centroid array bytes; watch for the `O(N log N)` materialization dominating.
- **Invariant checks (debug builds):** after build, assert every component recorded had size `≤` half its parent; assert each vertex has exactly `height(vertex)+1` ancestor entries.
- **Sanity oracle:** periodically compare a sample of queries against an `O(N)` BFS ground-truth in a canary.

---

## 9. Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| **Recursion depth** on path-shaped trees | Stack overflow during build (size/record DFS is `O(N)` deep). | Iterative DFS with explicit stack; raise stack size for build workers. |
| **Stale size recomputation** | Wrong centroids, height `≫ log N`, infinite recursion. | Recompute `size[]` over residual tree each level; never reuse. |
| **Forgotten `removed[]` mark** | Build never terminates; re-enters centroid. | Mark before recursing; guard all neighbor loops. |
| **Double-count in counting hooks** | Counts inflated. | Inclusion–exclusion subtraction per branch. |
| **Memory blowup** | OOM at build. | Don't materialize per-centroid full arrays unless the query mix needs them; page/mmap deep levels. |
| **Topology change** | Wrong answers after an edge changes. | CD is static; trigger full rebuild + atomic swap. |
| **Unbalanced marked-set skew** | Hot centroid lock contention. | Lock-free per-centroid structures; shard hot centroids. |

---

## 10. Capacity Planning

- **Memory:** baseline `O(N)` for adjacency + `cparent[]`. Add `O(N log N)` if you store ancestor-distance tables / per-centroid sorted arrays. For `N = 10⁶`, `height ≈ 20`, that's `~2×10⁷` entries — tens of MB at 4 bytes; for `N = 10⁷`, hundreds of MB to low GB.
- **Build time:** `O(N log N)`. Roughly linear-with-a-log constant; parallelizable across sibling components for near-linear wall-clock on multicore.
- **Query throughput:** each query is `O(log N)` ancestor visits × per-structure cost. With `height ≈ 20` and `O(log N)` per centroid, expect microseconds per query in compiled languages — millions of QPS per core on warm caches.
- **Update rate (use case B):** each update is `O(log N)` centroid touches × `O(log N)` structure op = `O(log² N)`; comfortably handles high update rates as long as marked-set structures are efficient.
- **Rebuild budget:** since topology changes force rebuilds, plan rebuild cadence (e.g. nightly) against build cost and the double-buffer memory (need room for two indexes during swap).

### Sizing table (4-byte entries, ancestor-distance index materialized)

| N | height ≈ ⌊log₂N⌋ | distance entries ≈ N·height | memory @4B | typical build (1 core) | double-buffer peak |
|---|------------------|-----------------------------|-----------|------------------------|--------------------|
| 10⁴ | 13 | 1.3×10⁵ | ~0.5 MB | < 10 ms | ~1 MB |
| 10⁵ | 16 | 1.6×10⁶ | ~6 MB | ~50–100 ms | ~12 MB |
| 10⁶ | 19 | 1.9×10⁷ | ~76 MB | ~1 s | ~150 MB |
| 10⁷ | 23 | 2.3×10⁸ | ~0.9 GB | ~15 s | ~1.8 GB |

Notes on reading the table:
- The "distance entries" column equals the total per-vertex ancestor count `Σ_v (level(v)+1)`, which is bounded by `N·(⌊log₂N⌋+1)`. The real value is usually a bit *below* the bound because not every vertex reaches maximum depth.
- If you only need *distance between two nodes* (no counting), skip this index entirely and use the **13-lca** sparse table — `O(N)` extra memory, not `O(N log N)`.
- Build is parallelizable across sibling components; with `P` cores expect roughly `build_time / min(P, fanout-at-top-levels)` wall-clock, bounded below by the sequential descent along the deepest centroid chain.
- The double-buffer peak applies only during a rebuild swap; steady-state memory is a single index.

### Throughput sizing

- A radius/count query visits `≤ height` centroid ancestors, each doing one binary search over a sorted distance array (`O(log component-size)`). On warm caches in a compiled language, that is typically **single-digit microseconds** for `N ≤ 10⁶`, i.e. order **10⁵–10⁶ QPS/core**.
- Nearest-marked updates are `O(log N)` centroid touches × `O(log N)` per balanced-multiset op; at `N = 10⁶` (height ≈ 19) that is a few hundred structure operations per update — comfortably **10⁴–10⁵ updates/sec/core**.
- Because reads are lock-free against the immutable backbone, query throughput scales near-linearly with cores until memory bandwidth (streaming the sorted arrays) saturates.

---

## 11. Summary

At senior scale, centroid decomposition is a **static, immutable, read-optimized index** for tree-distance and nearest-facility queries, valued for its guaranteed `O(log N)` height that makes latency, memory, and throughput predictable even on pathological tree shapes. Build it once (`O(N log N)`, parallelizable), serve lock-free reads from replicas, and handle dynamic *marks* with per-centroid min-structures at `O(log² N)` per op. Its hard limit is **static topology**: edge changes force a full rebuild — for fully dynamic trees use Link-Cut Trees, and for path-aggregate workloads use Heavy-Light Decomposition (sibling 14). The two operational hazards to engineer against are recursion depth on skewed trees (use explicit stacks) and stale subtree-size recomputation (always measure the residual tree).
