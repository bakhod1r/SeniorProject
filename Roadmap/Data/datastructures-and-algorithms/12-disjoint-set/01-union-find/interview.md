# Union-Find — Interview Preparation

Union-Find (Disjoint Set Union, DSU) is one of the highest-leverage data structures to bring to a coding interview: it is twenty lines on a whiteboard, it powers a whole family of "are these connected?" / "how many groups?" problems (number of connected components, redundant connection, accounts merge, number of islands, Kruskal's MST, friend circles), and it has a few precise gotchas that separate a candidate who memorized the API from one who understands the forest. This file is a curated question bank sorted by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Operation             | Complexity (optimized) | Notes |
|-----------------------|------------------------|-------|
| `makeSet(x)`          | O(1)                   | `parent[x] = x`, `size[x] = 1`. |
| `find(x)`             | O(α(n)) amortized      | Walk to root; with path compression, near-constant. |
| `union(a, b)`         | O(α(n)) amortized      | Link roots; with union by size/rank, balanced. |
| `connected(a, b)`     | O(α(n)) amortized      | `find(a) == find(b)`. |
| `count()`             | O(1)                   | Maintain a counter; `--` on each effective union. |
| `sizeOf(x)`           | O(α(n))                | `size[find(x)]`. |
| Space                 | O(n)                   | One or two `int[]` arrays. |

Naive (no optimizations) bounds: `find` and `union` are **O(n)** worst case (degenerate chain).

Core code skeleton (union by size + path compression):

```text
parent[i] = i,  size[i] = 1,  count = n
find(x):    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]; return x   // path halving
union(a,b): ra,rb = find(a),find(b); if ra==rb return false
            if size[ra] < size[rb]: swap(ra,rb)
            parent[rb] = ra; size[ra] += size[rb]; count--; return true
```

Invariants:

- **Root:** `r` is a root ⟺ `parent[r] == r`.
- **Same set:** `a ≡ b` ⟺ `find(a) == find(b)`.
- **Count:** `count` = number of roots = number of disjoint sets.
- **Golden rule:** `union` links **roots** (`parent[find(a)] = find(b)`), never raw nodes.

---

## Junior Questions (12 Q&A)

### J1. What problem does Union-Find solve?
It maintains a partition of `n` elements into disjoint sets under two operations: `union(a, b)` merges two sets, and `find(x)` returns the representative of `x`'s set so you can test whether two elements are in the same set. It is the standard structure for **dynamic (incremental) connectivity** — answering "are `a` and `b` connected?" as edges are added one at a time.

### J2. What is the `parent[]` array and what does a root look like?
Each set is a rooted tree stored in a single `parent[]` array: `parent[x]` is `x`'s parent. A **root** points to itself, `parent[r] == r`, and the root is the set's representative. Initially every element is its own root, so there are `n` singleton sets.

### J3. How does `find` work?
`find(x)` follows parent pointers upward until it reaches a node that points to itself (the root), then returns it. The cost is the depth of `x` in its tree.

### J4. How does `union` work, and what is the single most common bug?
`union(a, b)` first computes both roots, `ra = find(a)` and `rb = find(b)`. If they differ, it links one under the other: `parent[ra] = rb`. The classic bug is writing `parent[a] = b` instead of linking the *roots* — that links two non-root nodes and corrupts the forest.

### J5. What is the difference between QuickFind and QuickUnion?
QuickFind stores a flat label array `id[x]` = set id; `find` is O(1) but `union` relabels the whole array in O(n). QuickUnion stores a forest via `parent[]`; `union` just links two roots (cheap) and `find` walks to a root (cost = tree height). Almost all real DSUs use QuickUnion plus optimizations.

### J6. What are the time complexities, naive vs optimized?
Naive QuickUnion: `find` and `union` are O(n) worst case because trees can degenerate into chains. With union by size/rank plus path compression: O(α(n)) amortized, where α is the inverse Ackermann function — effectively constant (≤ 4 for any real input).

### J7. How do you count connected components?
Keep a `count` starting at `n`. Each time `union` actually merges two different sets, decrement `count`. At the end `count` is the number of components. You must not decrement when the two elements were already in the same set.

### J8. What is `connected(a, b)`?
It is just `find(a) == find(b)`. If the two roots match, the elements are in the same set.

### J9. Can Union-Find remove an edge or split a set?
No — the basic structure is **monotonic**: sets only ever merge. There is no efficient un-union. If you need deletions, you either process offline in reverse (deletions become insertions) or use a dynamic-connectivity structure like link-cut or Euler-tour trees.

### J10. Why is Union-Find better than BFS/DFS for connectivity?
BFS/DFS answers connectivity in O(n + m) **per query** by traversing the graph. Union-Find maintains connectivity **incrementally**, so each `union` and each `connected` query is near-constant. When edges arrive one at a time and you must answer questions in between, DSU is dramatically faster.

### J11. What is union by size (or rank), in one sentence?
Always attach the smaller (or shorter) tree under the larger root, so trees stay shallow — this bounds height to O(log n) and prevents the degenerate chain.

### J12 (analysis). Why does the naive version reach O(n)?
If every union links the current root under the next element in a chain, you build a single path of length n−1. A `find` on the deepest node then walks all n−1 edges. Balancing (union by size/rank) fixes this by never letting the taller/larger tree hang under the smaller one.

---

## Middle Questions (12 Q&A)

### M1. Walk through path compression.
During `find`, after locating the root, point every node on the path directly at the root (full compression), or point each node at its grandparent (path halving). This flattens the tree so future `find`s on those nodes are O(1). Combined with union by rank it gives the O(α(n)) amortized bound. Path halving is a single iterative pass and is usually preferred in practice.

### M2. Union by rank vs union by size — what's the difference?
Union by **size** tracks the number of nodes per tree and hangs the smaller-count tree under the larger; it also answers "how big is this component?" for free. Union by **rank** tracks an upper bound on tree height and hangs the lower-rank tree under the higher. Both bound height to O(log n); pick size if you need component sizes, rank if you want a one-byte balancing field.

### M3. How do you detect a cycle in an undirected graph with DSU?
Process edges; for each edge `(a, b)`, if `connected(a, b)` is already true, that edge closes a cycle — report it. Otherwise `union(a, b)`. This is exactly the test Kruskal's algorithm uses to skip cycle-forming edges.

### M4. How does Kruskal's MST use Union-Find?
Sort edges by weight ascending. For each edge, if its endpoints are in different sets, add it to the MST and union them; otherwise skip it (it would form a cycle). DSU performs both the membership test and the merge. Total cost is dominated by the O(m log m) sort.

### M5. Why must `union` find roots before linking?
Linking arbitrary nodes (`parent[a] = b`) can attach a root's subtree to a non-root, creating cycles or wrong membership. Only `parent[find(a)] = find(b)` preserves the forest's acyclicity invariant and correct set semantics.

### M6. How do you answer "size of the component containing x"?
Maintain `size[root]` on each root. Then `sizeOf(x) = size[find(x)]`. The size is updated during `union` by adding the absorbed tree's size to the surviving root.

### M7. How would you map non-integer keys (strings, emails) into DSU?
Build a dictionary that assigns each distinct key a dense integer index `0..n-1` as you first see it, then run the DSU over those indices. This keeps the structure a flat array and avoids hashing inside `find`.

### M8. What is the inverse Ackermann function and why does it appear?
α(n) is the inverse of the extremely fast-growing Ackermann function; it grows so slowly that α(n) ≤ 4 for any n you could store. It is the tight amortized cost per operation for union by rank + path compression (Tarjan 1975), and Fredman–Saks (1989) proved it is a genuine lower bound, not an artifact.

### M9. Does `find` modify the structure?
With path compression, yes — `find` rewrites parent pointers to flatten the path. This matters for concurrency: even "read" operations become writers, so naive concurrent reads need a lock or a non-mutating `find`.

### M10. How do you handle the "number of islands II" online problem?
Treat the grid as a DSU over cell indices. Start with `count = 0`. When a water cell becomes land, increment `count`, then union it with any already-land orthogonal neighbor, decrementing `count` on each effective union. After each addition, `count` is the current number of islands.

### M11. How do you process a stream of "is a connected to b?" queries interleaved with unions?
Just call `union` for merge operations and `connected` for queries as they arrive. Because each operation is near-constant, you can interleave millions of them. A static graph traversal cannot do this efficiently — it would recompute components after each union.

### M12 (analysis). Why does union by size bound height to O(log n)?
A node's depth increases only when its tree is the smaller side of a union, and each such merge at least doubles the size of the tree it lives in. A tree of n nodes can double at most log₂ n times, so any node's depth is at most log₂ n.

---

## Senior Questions (10 Q&A)

### S1. How would you persist and recover a Union-Find?
Because every mutation is a `union(a, b)`, append each effective union to a log. On restart, replay the log to rebuild `parent[]` and `size[]`. Snapshot the arrays periodically to bound replay time. The log doubles as your only "undo" mechanism, since DSU cannot un-merge.

### S2. How do you make Union-Find thread-safe?
Simplest: one mutex around `union` and `find` (remember `find` mutates with compression). For read parallelism, use a non-mutating `find` under a read lock and compress only on the write path. For high write contention, use a CAS-based lock-free DSU with path halving (every intermediate pointer is still a valid ancestor, so the race is benign).

### S3. Your DSU needs to support edge deletion. What do you do?
Basic DSU cannot delete. If all deletions are known in advance, process the operation stream backwards so deletions become unions (offline reverse-deletion). If deletions are frequent and online, switch to a fully dynamic connectivity structure (Holm–de Lichtenberg–Thorup, Euler-tour trees, or link-cut trees), accepting O(log n) or O(log² n) per operation.

### S4. How do you shard a DSU when the element space exceeds one node?
Shard by `hash(element) mod K`. Each shard runs a local DSU; cross-shard unions are recorded in a global "stitch" table mapping local roots across shards. A cross-shard `find` resolves the local root then follows the stitch table. The hard part is that connectivity is a global property of a partitioned dataset, so cross-shard operations are inherently more expensive.

### S5. What is a "giant component" and why is it a production hazard?
In entity resolution, a single bad merge key (e.g., everyone sharing a default email) can union millions of records into one component. Because DSU is irreversible live, this is a serious incident. Mitigate by alerting on `largest_component_size`, treating high-degree keys as non-mergeable, and keeping the union log so you can rebuild without the bad edge.

### S6. Compare Union-Find to BFS/DFS and to dynamic-connectivity trees at scale.
DSU: O(α(n)) per op, insertion-only, no paths. BFS/DFS: O(n+m) per query but gives actual paths and handles deletions trivially (just recompute). Dynamic trees: O(log n)–O(log² n) per op, support insert and delete. Choose DSU for monotonic incremental connectivity (the common case), BFS/DFS for one-shot or path queries, dynamic trees when deletions are first-class.

### S7. How does the offline LCA algorithm use Union-Find?
Tarjan's offline LCA processes the tree in DFS order, unioning each finished subtree into its parent's set and answering queued LCA queries via `find` on the other endpoint when it is already visited. It runs in near-linear time and is the topic of the sibling `04-offline-lca`. The key trick is that DSU lets "the deepest already-finished ancestor" be queried cheaply.

### S8. Can Union-Find be made persistent (queryable in the past)?
Yes, with a persistent (path-copying) parent array: each `union` returns a new version sharing structure with the old, so historical versions remain queryable in O(log n) per access. This enables "were a and b connected as of time t?" at the cost of array locality and extra memory. Without persistence, snapshot the arrays at intervals.

### S9. Why does Union-Find not support efficient `decrease`/`split`?
The structure encodes only "merged-into" relationships via a forest; merging is a single pointer redirect, but splitting requires knowing which descendants belonged to each side — information the flat forest deliberately discards for speed. Recovering it would cost as much as rebuilding, which is why split is not part of the basic ADT.

### S10 (analysis). When is the inverse-Ackermann bound actually relevant in practice?
Almost never as a *slowdown* — α(n) ≤ 4 means operations are effectively constant for any real n. It is relevant as a *guarantee*: it tells you DSU will not degrade, and the matching Fredman–Saks lower bound tells you no online structure can do asymptotically better. In practice the real costs are cache misses on `parent[]`, lock contention, and durable writes — not the path length.

---

## Professional Questions (8 Q&A)

### P1. Design an entity-resolution pipeline using Union-Find.
Read "these records share an identifier" facts, map each record to a dense index, and `union` records that share a key. The component root becomes the canonical entity id. Make it batch and per-partition-parallel with a reconcile step; emit `find(x)` per record as the entity assignment. Guard against giant components from bad keys, and keep the union log so a bad merge can be rebuilt out.

### P2. How do you bound recovery time for a durable DSU?
Recovery replays the union log: O(m·α(n)). To bound it, snapshot the `parent[]`/`size[]` arrays every N unions; on recovery, load the latest snapshot and replay only the tail since that snapshot. Tune N to trade snapshot cost against recovery latency, like database WAL checkpointing.

### P3. How would you parallelize building connected components over a billion edges?
Use a distributed connected-components job (e.g., Spark GraphX / label propagation) or partition the edges, run a local DSU per partition, emit `(localRoot, element)` pairs, then reconcile cross-partition roots in a second DSU pass. The reconcile step is small (proportional to distinct local roots). Accept that a fully online global DSU does not distribute cheaply because connectivity is global.

### P4. How do you detect and prevent a runaway giant component in production?
Track `largest_component_size` and `component_count` as metrics. Alert when the largest component grows faster than a threshold or exceeds a fraction of n. Add a blocklist of join keys that must never trigger unions, and cap the degree of any single merge key. Because the merge is irreversible live, prevention plus the rebuildable union log are the safety net.

### P5. How do you choose between union by rank and union by size in a real system?
Union by size if you need `componentSize` queries (common in product features like "group size") — `size[]` is reused. Union by rank if you only need connectivity and want to minimize the balancing field (rank fits in a byte since it is ≤ log n). Both give the same asymptotics; the choice is about whether sizes are a product requirement.

### P6. How would you support point-in-time connectivity audits?
Either snapshot the arrays at intervals (O(n) each, queryable as of the snapshot) or use a persistent DSU for fine-grained history. Combined with the union log, you can answer "when did a and b first become connected, and via which edge?" — valuable for fraud and compliance investigations.

### P7. How do you debug a "find loops forever" production incident?
A `find` infinite loop means a cycle was introduced into `parent[]` — almost always a `union` that linked a root to one of its own descendants, or a concurrency race. Add an assertion that `union` only ever writes `parent[rb] = ra` for distinct roots; log the offending indices; check for unsynchronized concurrent access. Reproduce by replaying the captured union sequence deterministically.

### P8 (analysis). Why is the offline union-find problem linear while the online one is not?
Online, Fredman–Saks proves Ω(α(n)) amortized per operation in the cell-probe model — the structure cannot "see the future." Offline (Gabow–Tarjan 1985), the entire operation sequence and union forest are known in advance, so the algorithm precomputes a micro-tree decomposition with table lookups and achieves O(m + n). Knowing the future breaks the lower bound; this is the basis of offline LCA.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose Union-Find over another structure. What were the trade-offs?
Look for: the problem (e.g., incremental friend-circle grouping), alternatives considered (recomputing components with BFS, a graph DB, a dynamic-connectivity tree), the deciding criteria (insertion-only workload, query latency, simplicity), and why DSU won. Strong answers name the irreversibility limitation up front and explain why it was acceptable, plus what was measured.

### B2. Design a "friends recommendation" connectivity service.
DSU over user ids with union by size; `connected(a, b)` and `componentSize(x)` as the API. Discuss persistence (union log + snapshots), concurrency (single lock vs sharded), and the giant-component hazard (a viral group merging everyone). Address the deletion problem honestly: unfriending requires rebuild or a dynamic-connectivity structure.

### B3. Design an account-merge / deduplication system.
Map every contact identifier (email, phone) to an index; union records sharing an identifier; the component is the merged account. Discuss canonical id selection (the root), idempotency (re-running unions is a no-op), and auditing (union log explains *why* two accounts merged). Call out the irreversibility risk and the bad-key giant-component failure.

### B4. A junior asks: "Why not just rerun BFS for every connectivity query?"
Explain incremental vs one-shot: BFS is O(n+m) per query, DSU is near-constant amortized per operation. For a stream of unions interleaved with queries, BFS recomputes everything each time while DSU updates in place. Use it as a teaching moment about matching the data structure to the *access pattern* (incremental, insertion-only) rather than defaulting to the familiar tool.

### B5. Your DSU-based system shows wrong component counts intermittently. How do you investigate?
Suspect two things first: decrementing `count` on no-op unions (when roots are equal), and concurrency races on `parent[]`. Add an invariant check that recomputes component count by scanning roots and compares to the maintained counter. Add metrics for effective-union rate and no-op-union ratio. Replay the captured operation log deterministically to reproduce.

---

## Coding Challenges

### Challenge 1: Number of Connected Components in an Undirected Graph

**Problem.** You have `n` nodes labeled `0..n-1` and a list of undirected edges. Return the number of connected components.

**Example.**

```text
n = 5, edges = [[0,1],[1,2],[3,4]]
Output: 2     // {0,1,2} and {3,4}
```

**Constraints.** `1 <= n <= 2000`, `0 <= edges.length <= n*(n-1)/2`, no duplicate edges, nodes are valid.

**Approach.** Initialize DSU with `count = n`. Union both endpoints of each edge; each effective union reduces `count` by one. Return `count`. O((n + m)·α(n)).

**Go.**

```go
package main

import "fmt"

type DSU struct {
	parent []int
	size   []int
	count  int
}

func NewDSU(n int) *DSU {
	d := &DSU{parent: make([]int, n), size: make([]int, n), count: n}
	for i := 0; i < n; i++ {
		d.parent[i] = i
		d.size[i] = 1
	}
	return d
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]] // path halving
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.size[ra] < d.size[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	d.size[ra] += d.size[rb]
	d.count--
	return true
}

func countComponents(n int, edges [][]int) int {
	d := NewDSU(n)
	for _, e := range edges {
		d.Union(e[0], e[1])
	}
	return d.count
}

func main() {
	fmt.Println(countComponents(5, [][]int{{0, 1}, {1, 2}, {3, 4}})) // 2
}
```

**Java.**

```java
import java.util.*;

public class CountComponents {
    static int[] parent, size;

    static int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

    static boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        size[ra] += size[rb];
        return true;
    }

    public static int countComponents(int n, int[][] edges) {
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        int count = n;
        for (int[] e : edges) if (union(e[0], e[1])) count--;
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countComponents(5, new int[][]{{0, 1}, {1, 2}, {3, 4}})); // 2
    }
}
```

**Python.**

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n
        self.count = n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        self.count -= 1
        return True


def count_components(n, edges):
    d = DSU(n)
    for a, b in edges:
        d.union(a, b)
    return d.count


if __name__ == "__main__":
    print(count_components(5, [[0, 1], [1, 2], [3, 4]]))  # 2
```

**Follow-up.** What if nodes are added over time? Grow the arrays and start each new node as its own set with `count += 1`.

---

### Challenge 2: Redundant Connection

**Problem.** A tree on `n` nodes has had exactly one extra edge added, forming a single cycle. Given the edge list (1-indexed), return the edge that can be removed so the result is a tree. If multiple answers exist, return the one that appears **last** in the input.

**Example.**

```text
edges = [[1,2],[1,3],[2,3]]
Output: [2,3]     // adding 2-3 closes the cycle 1-2-3-1
```

**Constraints.** `n == edges.length`, `3 <= n <= 1000`, 1-indexed nodes, the graph is connected with exactly one cycle.

**Approach.** Process edges in order; the first edge whose two endpoints are *already* connected is the redundant one. Since we scan in input order and return on first cycle, this is automatically the last edge needed to close it.

**Go.**

```go
package main

import "fmt"

func findRedundant(edges [][]int) []int {
	n := len(edges)
	parent := make([]int, n+1)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for _, e := range edges {
		ra, rb := find(e[0]), find(e[1])
		if ra == rb {
			return e // endpoints already connected -> this edge closes a cycle
		}
		parent[ra] = rb
	}
	return nil
}

func main() {
	fmt.Println(findRedundant([][]int{{1, 2}, {1, 3}, {2, 3}})) // [2 3]
}
```

**Java.**

```java
import java.util.*;

public class RedundantConnection {
    static int[] parent;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    public static int[] findRedundantConnection(int[][] edges) {
        int n = edges.length;
        parent = new int[n + 1];
        for (int i = 0; i <= n; i++) parent[i] = i;
        for (int[] e : edges) {
            int ra = find(e[0]), rb = find(e[1]);
            if (ra == rb) return e; // closes a cycle
            parent[ra] = rb;
        }
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            findRedundantConnection(new int[][]{{1, 2}, {1, 3}, {2, 3}}))); // [2, 3]
    }
}
```

**Python.**

```python
def find_redundant_connection(edges):
    n = len(edges)
    parent = list(range(n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb:
            return [a, b]   # closes a cycle
        parent[ra] = rb
    return []


if __name__ == "__main__":
    print(find_redundant_connection([[1, 2], [1, 3], [2, 3]]))  # [2, 3]
```

**Follow-up.** For the directed version (Redundant Connection II) you must also handle a node with two parents; that needs extra casework beyond plain DSU.

---

### Challenge 3: Accounts Merge

**Problem.** Given a list of accounts where `accounts[i][0]` is a name and the rest are emails, merge accounts that share any email (the same person may have multiple accounts). Return the merged accounts, each as the name followed by its emails sorted lexicographically. Two accounts with the same name but no shared email are different people.

**Example.**

```text
[["John","a@x.com","b@x.com"],
 ["John","b@x.com","c@x.com"],
 ["Mary","m@x.com"]]
-> [["John","a@x.com","b@x.com","c@x.com"],["Mary","m@x.com"]]
```

**Constraints.** Up to ~1000 accounts, emails are valid, total emails up to ~10⁴.

**Approach.** Assign each distinct email a dense index. Within one account, union all its emails together (they belong to the same person). Then group emails by `find(email)`, sort each group, and prepend the name (recorded per email).

**Go.**

```go
package main

import (
	"fmt"
	"sort"
)

func accountsMerge(accounts [][]string) [][]string {
	emailID := map[string]int{}
	emailName := map[string]string{}
	var parent []int

	find := func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[ra] = rb
		}
	}
	id := func(e string) int {
		if v, ok := emailID[e]; ok {
			return v
		}
		v := len(parent)
		emailID[e] = v
		parent = append(parent, v)
		return v
	}

	for _, acc := range accounts {
		name := acc[0]
		first := id(acc[1])
		emailName[acc[1]] = name
		for _, e := range acc[2:] {
			emailName[e] = name
			union(first, id(e))
		}
	}

	groups := map[int][]string{}
	for e, i := range emailID {
		r := find(i)
		groups[r] = append(groups[r], e)
	}

	res := [][]string{}
	for _, emails := range groups {
		sort.Strings(emails)
		row := append([]string{emailName[emails[0]]}, emails...)
		res = append(res, row)
	}
	return res
}

func main() {
	accounts := [][]string{
		{"John", "a@x.com", "b@x.com"},
		{"John", "b@x.com", "c@x.com"},
		{"Mary", "m@x.com"},
	}
	fmt.Println(accountsMerge(accounts))
}
```

**Java.**

```java
import java.util.*;

public class AccountsMerge {
    static int[] parent;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra != rb) parent[ra] = rb;
    }

    public static List<List<String>> accountsMerge(List<List<String>> accounts) {
        Map<String, Integer> emailId = new HashMap<>();
        Map<String, String> emailName = new HashMap<>();
        int n = 0;
        for (List<String> acc : accounts) n += acc.size() - 1;
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;

        int next = 0;
        for (List<String> acc : accounts) {
            String name = acc.get(0);
            int first = -1;
            for (int i = 1; i < acc.size(); i++) {
                String e = acc.get(i);
                if (!emailId.containsKey(e)) emailId.put(e, next++);
                emailName.put(e, name);
                int cur = emailId.get(e);
                if (first == -1) first = cur; else union(first, cur);
            }
        }

        Map<Integer, TreeSet<String>> groups = new HashMap<>();
        for (Map.Entry<String, Integer> en : emailId.entrySet()) {
            int r = find(en.getValue());
            groups.computeIfAbsent(r, k -> new TreeSet<>()).add(en.getKey());
        }

        List<List<String>> res = new ArrayList<>();
        for (TreeSet<String> emails : groups.values()) {
            List<String> row = new ArrayList<>();
            row.add(emailName.get(emails.first()));
            row.addAll(emails);
            res.add(row);
        }
        return res;
    }

    public static void main(String[] args) {
        List<List<String>> accounts = Arrays.asList(
            Arrays.asList("John", "a@x.com", "b@x.com"),
            Arrays.asList("John", "b@x.com", "c@x.com"),
            Arrays.asList("Mary", "m@x.com"));
        System.out.println(accountsMerge(accounts));
    }
}
```

**Python.**

```python
def accounts_merge(accounts):
    email_id = {}
    email_name = {}
    parent = []

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    def get_id(e):
        if e not in email_id:
            email_id[e] = len(parent)
            parent.append(email_id[e])
        return email_id[e]

    for acc in accounts:
        name = acc[0]
        first = get_id(acc[1])
        email_name[acc[1]] = name
        for e in acc[2:]:
            email_name[e] = name
            union(first, get_id(e))

    groups = {}
    for e, i in email_id.items():
        groups.setdefault(find(i), []).append(e)

    res = []
    for emails in groups.values():
        emails.sort()
        res.append([email_name[emails[0]]] + emails)
    return res


if __name__ == "__main__":
    accounts = [
        ["John", "a@x.com", "b@x.com"],
        ["John", "b@x.com", "c@x.com"],
        ["Mary", "m@x.com"],
    ]
    print(accounts_merge(accounts))
```

**Follow-up.** This is a textbook equivalence-class problem: "shares an email" is reflexive, symmetric, and transitive, which is exactly what DSU computes.

---

### Challenge 4: Number of Islands

**Problem.** Given a grid of `'1'` (land) and `'0'` (water), count the islands. An island is a maximal group of `'1'` cells connected horizontally or vertically.

**Example.**

```text
grid =
1 1 0 0
1 0 0 1
0 0 1 1
Output: 2
```

**Constraints.** `1 <= rows, cols <= 300`.

**Approach.** Treat each land cell as a DSU element indexed `r*cols + c`. Start `count` at the number of land cells. For each land cell, union it with its land neighbor to the left and above; each effective union reduces `count`. Return `count`.

**Go.**

```go
package main

import "fmt"

func numIslands(grid [][]byte) int {
	rows, cols := len(grid), len(grid[0])
	parent := make([]int, rows*cols)
	count := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			idx := r*cols + c
			parent[idx] = idx
			if grid[r][c] == '1' {
				count++
			}
		}
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[ra] = rb
			count--
		}
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			if grid[r][c] != '1' {
				continue
			}
			idx := r*cols + c
			if r > 0 && grid[r-1][c] == '1' {
				union(idx, (r-1)*cols+c)
			}
			if c > 0 && grid[r][c-1] == '1' {
				union(idx, r*cols+c-1)
			}
		}
	}
	return count
}

func main() {
	grid := [][]byte{
		{'1', '1', '0', '0'},
		{'1', '0', '0', '1'},
		{'0', '0', '1', '1'},
	}
	fmt.Println(numIslands(grid)) // 2
}
```

**Java.**

```java
public class NumberOfIslands {
    static int[] parent;
    static int count;

    static int find(int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    static void union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra != rb) { parent[ra] = rb; count--; }
    }

    public static int numIslands(char[][] grid) {
        int rows = grid.length, cols = grid[0].length;
        parent = new int[rows * cols];
        count = 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                int idx = r * cols + c;
                parent[idx] = idx;
                if (grid[r][c] == '1') count++;
            }
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                if (grid[r][c] != '1') continue;
                int idx = r * cols + c;
                if (r > 0 && grid[r - 1][c] == '1') union(idx, (r - 1) * cols + c);
                if (c > 0 && grid[r][c - 1] == '1') union(idx, r * cols + c - 1);
            }
        return count;
    }

    public static void main(String[] args) {
        char[][] grid = {
            {'1', '1', '0', '0'},
            {'1', '0', '0', '1'},
            {'0', '0', '1', '1'},
        };
        System.out.println(numIslands(grid)); // 2
    }
}
```

**Python.**

```python
def num_islands(grid):
    rows, cols = len(grid), len(grid[0])
    parent = list(range(rows * cols))
    count = 0

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        nonlocal count
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            count -= 1

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1":
                count += 1

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "1":
                continue
            idx = r * cols + c
            if r > 0 and grid[r - 1][c] == "1":
                union(idx, (r - 1) * cols + c)
            if c > 0 and grid[r][c - 1] == "1":
                union(idx, r * cols + c - 1)
    return count


if __name__ == "__main__":
    grid = [
        ["1", "1", "0", "0"],
        ["1", "0", "0", "1"],
        ["0", "0", "1", "1"],
    ]
    print(num_islands(grid))  # 2
```

**Follow-up.** "Number of Islands II" (cells turn from water to land over time, report island count after each addition) is the *online* version — exactly DSU's strength, since BFS/DFS would recompute the whole grid each step.

---

## Common Pitfalls in Interviews

- **Linking non-roots.** Writing `parent[a] = b` instead of `parent[find(a)] = find(b)`. Corrupts the forest silently. Always union roots.
- **Decrementing `count` on a no-op union.** Only subtract when `find(a) != find(b)`. Otherwise the component count is wrong.
- **Forgetting initialization.** Leaving `parent` zero-filled makes index 0 a false parent of everyone. Always `parent[i] = i`.
- **0-indexed vs 1-indexed confusion.** Many graph problems label nodes `1..n`. Allocate `n+1` slots or subtract 1 — pick one and be consistent.
- **Assuming the root is stable.** The representative can change after a union; never cache "the root" across operations that may re-link.
- **Trying to delete/un-union.** Basic DSU is monotonic. If asked for deletions, mention offline reverse-deletion or a dynamic-connectivity structure rather than hacking the forest.
- **Skipping the optimizations.** Without union by size/rank, the worst case is O(n). Mention and implement at least path compression — interviewers check for it.
- **Non-dense keys.** For strings/emails, map to integer indices first; do not hash inside `find`.

---

## What Interviewers Are Really Testing

A Union-Find question is rarely about reciting the API. Interviewers probe three deeper things. First, **can you recognize the pattern in disguise?** "Friend circles," "accounts merge," "number of provinces," "redundant connection," and "number of islands" are all the same equivalence-class problem wearing different clothes — spotting that a problem is "group things that are transitively related" is the real signal. Second, **can you reason about complexity precisely?** Knowing that naive QuickUnion is O(n) but union by rank + path compression is O(α(n)) ≈ O(1), and being able to explain *why* (the doubling argument for height, compression for flattening), distinguishes a strong candidate. Third, **do you know the corners and the limits?** The golden rule (union links roots), the no-op-union count bug, 0/1-indexing, and especially the irreversibility limitation — DSU cannot delete — are what separate mid from senior. You do not need to derive the inverse-Ackermann bound on the whiteboard, but you should name it, know it is essentially constant, and know that Fredman–Saks proved it optimal. The best answers also reach for production realities: how would I persist this (union log), make it thread-safe (lock or CAS with path halving), and detect a runaway giant component? Union-Find is small enough to demonstrate all of these dimensions in a single conversation.
