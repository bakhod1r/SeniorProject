# Offline LCA — Interview Preparation

Tarjan's offline LCA is a favorite "do you really understand Union-Find?" interview topic: it is a small, elegant *application* of DSU, it forces you to reason about DFS finishing order, and it has a crisp correctness argument that separates candidates who memorized the steps from those who understand *why* `find(other)`'s ancestor is the LCA. This file is a graded question bank plus three end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Item | Value |
|------|-------|
| Problem setting | **Offline** — all queries known before the run |
| Total time | **O((N + Q)·α(N))** ≈ near-linear |
| Space | O(N + Q) |
| Core structure | DSU (path compression + union by rank) |
| Unions performed | exactly **N − 1** (one per non-root node) |
| Answer a query `(u,v)` | when its **second** endpoint is visited |
| Answer formula | `ancestor[ find(other_endpoint) ]` |
| Union timing | **after** a child's subtree fully finishes, union child → parent |
| `ancestor` reset | at node entry **and** after every union |
| Register each query | on **both** endpoints |
| Distance (unweighted) | `depth[u] + depth[v] − 2·depth[LCA(u,v)]` |

Pseudocode skeleton:

```text
dfs(u):
    ancestor[find(u)] = u
    for child c of u:
        dfs(c); union(u, c); ancestor[find(u)] = u
    visited[u] = true
    for (other, qid) in queries[u]:
        if visited[other]: ans[qid] = ancestor[find(other)]
```

Online alternatives at a glance:

| Method | Build | Query | Online? |
|--------|-------|-------|---------|
| Tarjan offline | — | `α(N)` am. | No |
| Binary lifting | `O(N log N)` | `O(log N)` | Yes |
| Euler + sparse table | `O(N log N)` | `O(1)` | Yes |

---

## Junior Questions (12 Q&A)

### J1. What is the Lowest Common Ancestor of two nodes?
It is the deepest node that is an ancestor of *both* nodes in a rooted tree. Because a node is its own ancestor, `LCA(u, u) = u`, and if `u` is an ancestor of `v` then `LCA(u, v) = u`. The ancestor sets of two nodes are chains that both contain the root, so their intersection is a non-empty chain with a unique deepest element — that is the LCA.

### J2. What does "offline" mean here?
Offline means all queries are known *before* the algorithm starts. You collect the entire batch of `(u, v)` pairs, run one pass, and produce all answers. You cannot answer a query that arrives later. Online algorithms, by contrast, preprocess the tree and then answer each query whenever it shows up.

### J3. What data structure does Tarjan's algorithm use?
Disjoint Set Union (Union-Find), ideally with path compression and union by rank. The DSU tracks, for each visited node, the nearest still-open ancestor that "owns" its set. Tarjan's algorithm is a textbook *application* of DSU.

### J4. What is the overall time complexity?
`O((N + Q)·α(N))`, where `N` is the number of nodes, `Q` the number of queries, and `α` the inverse Ackermann function (effectively a small constant, ≤ 4). So it is near-linear — basically `O(N + Q)`.

### J5. When during the DFS is a query answered?
When the *second* of its two endpoints is visited. The first endpoint to finish just marks itself visited; when the second is processed, it sees the first already visited and computes the answer.

### J6. Why store each query on both endpoints?
You do not know in advance which endpoint the DFS will finish first. By registering the query under both nodes, whichever is processed second will find the other already visited and resolve the query.

### J7. What is the answer formula?
`ancestor[ find(other_endpoint) ]`. When you are visiting node `u` and the other endpoint `w` is already visited, `find(w)` gives `w`'s DSU representative, and `ancestor` of that representative is the LCA of `u` and `w`.

### J8. When do you perform the union, and which way?
After a child's entire subtree has finished, you union the child into its parent: `union(parent, child)`. Doing it *after* the child finishes is essential — that is what makes the finished subtree "belong to" the parent.

### J9. Why must you re-set `ancestor` after each union?
Union by rank can change the set's representative. If you set `ancestor` to the parent at entry but then a union flips the representative, `ancestor[find(parent)]` would read a stale value. So you re-assign `ancestor[find(parent)] = parent` right after every union.

### J10. What is `LCA(u, u)`?
It is `u` itself, since a node is its own ancestor. The algorithm handles this naturally — when `u` is visited and the query `(u, u)` is checked, `find(u)`'s ancestor is `u`.

### J11. Name two online LCA methods and how they differ from Tarjan.
Binary lifting (`O(N log N)` build, `O(log N)` per query) and Euler tour + sparse table (`O(N log N)` build, `O(1)` per query). Both answer queries as they arrive; Tarjan needs the whole batch up front but uses less memory and is simpler.

### J12 (analysis). Why is the total work near-linear?
There are exactly `N − 1` unions and `O(N + Q)` finds. With path compression and union by rank, each costs amortized `α(N)`. The DFS itself is `O(N)`. Summing gives `O((N + Q)·α(N))`, which is near-linear because `α(N) ≤ 4` for all realistic `N`.

---

## Middle Questions (12 Q&A)

### M1. State the invariant that makes the algorithm correct.
Every already-entered (non-white) node sits in the DSU set whose `ancestor` equals its **deepest still-open (gray) ancestor**. Because the gray nodes form a single root-to-current path, when you are at node `u` and `w` is finished, `ancestor[find(w)]` is the deepest common ancestor of `u` and `w` — the LCA.

### M2. Why are the gray nodes a single path?
The DFS recursion stack is exactly the chain of open calls, and each call is made from its parent's call. So the stack is a root-to-current path, meaning any two gray nodes are in an ancestor–descendant relationship.

### M3. Prove `ancestor[find(w)]` is the LCA when `u` is gray and `w` is black.
Let `g = ancestor[find(w)]` = deepest gray ancestor of `w`. `g` is an ancestor of `w` by definition, and gray, so it is on the root-to-`u` path, hence an ancestor of `u`. Let `c = LCA(u, w)`; `c` is on the root-to-`u` path so it is also gray, making it a gray ancestor of `w`, so `depth(c) ≤ depth(g)`. But `g` is a common ancestor so `depth(g) ≤ depth(c)`. Equal depth on the same chain ⇒ `g = c`.

### M4. How many unions occur, and why?
Exactly `N − 1`. Each non-root node is unioned into its parent exactly once, when its subtree finishes during the parent's child loop. The root is never unioned upward.

### M5. How does the iterative DFS work and why use it?
Replace recursion with an explicit stack of `(node, child_pointer)` frames. On the "post-visit" (after all children processed), mark visited, resolve queries, pop, and union into the parent. Use it on deep trees (a chain of `N` nodes) where recursion would overflow the stack.

### M6. How do you compute tree distance from LCA?
`dist(u, v) = depth[u] + depth[v] − 2·depth[LCA(u, v)]`. Compute `depth` during the same DFS, batch all distance queries through Tarjan, then read the depths.

### M7. How does Tarjan compare to binary lifting?
Both are near-optimal, but binary lifting is online (`O(N log N)` build, `O(log N)` per query) and uses `O(N log N)` memory, while Tarjan is offline, near-linear total, and uses `O(N + Q)` memory. Choose binary lifting when queries stream or you also need `k`-th ancestor; choose Tarjan for a frozen batch.

### M8. What is the RMQ ↔ LCA equivalence?
They reduce to each other in `O(N)`. LCA → RMQ: the Euler tour's depth array, where `RMQ` over `[first[u], first[v]]` gives the LCA. RMQ → LCA: build a Cartesian tree of the array; `RMQ(i,j)` equals `LCA(node_i, node_j)`. So a batch of RMQ queries can be solved by building a Cartesian tree and running Tarjan.

### M9. What happens with a disconnected forest?
Tarjan runs from one root and only visits that component. Cross-component pairs have no common ancestor and remain unanswered (`-1`). Run the DFS once per root and treat cross-component LCA as undefined.

### M10. Does Tarjan require sorting the queries?
No. Unlike Mo's algorithm, Tarjan resolves queries by DFS order, not by any imposed query order. You only bucket each query under its two endpoints.

### M11. What breaks if you union *before* the child finishes?
The invariant breaks: a still-open child would be folded into the parent prematurely, so `ancestor[find(w)]` could return a node deeper than the true LCA. You must union only in the post-visit, after the child's whole subtree is black.

### M12 (analysis). Why does correctness not depend on the DSU heuristic but time does?
The proof only uses that `find` returns a consistent representative and that sets merge on `union` — true for any DSU. Path compression and union by rank only affect *how fast* `find`/`union` run, taking the bound from `O(log N)` (one heuristic) down to `α(N)` (both). A slow DSU gives correct answers, just slower.

---

## Senior Questions (10 Q&A)

### S1. Where does an offline LCA kernel belong in a system?
Behind a *batch boundary* where the tree and full query set are frozen into a consistent snapshot. It is a pure function (tree, queries) → answers, so it is idempotent and cacheable. It must never sit on an interactive hot path, since it cannot answer late queries.

### S2. How do you scale to a tree that does not fit in RAM?
Use an explicit-stack DFS over memory-mapped arrays, stream the adjacency in DFS order for page-cache locality, keep the random-access DSU arrays resident, and relabel nodes by DFS-entry order so subtrees are contiguous index ranges.

### S3. How do you scale when `Q` is enormous but the tree fits?
Shard the *queries*: replicate the tree to `K` workers, split queries into `K` chunks, run `K` independent Tarjan passes, concatenate answers. Total `O(K·N + Q)`, worthwhile when `Q ≫ K·N`.

### S4. Can you parallelize a single tree's DFS?
Only partially. Sibling subtrees are independent until their parent unions them, so you could fork per child — but any query straddling two siblings must wait for both to finish and a sequential DSU merge. The merge cost and bandwidth limits usually make a single fast sequential pass win.

### S5. What is the most common correctness bug, and how do you catch it?
Forgetting to re-set `ancestor[find(parent)] = parent` after a union, which collapses every LCA to the root. Catch it with a unit test on a small canonical tree and a production canary that re-checks sampled answers against an independent climb-with-depths LCA.

### S6. What observability signals matter?
`unanswered_queries == 0` (for a connected tree), `unions_total == N − 1`, `dfs_max_stack_depth` (= tree height, warns before overflow), and `find_path_length_avg` (spikes mean DSU optimizations stopped engaging).

### S7. When would you abandon Tarjan for another method?
When queries stream over time (use binary lifting or Euler+sparse-table), when you will run many batches against the same static tree (build an online structure once and reuse), or when the tree mutates (use heavy-light decomposition or link-cut trees).

### S8. How do you make the batch reproducible?
Hash the `(tree_version, query_set)` snapshot and key the answers by that hash. Same snapshot ⇒ same answers; retries recompute nothing and auditors can verify reproducibility from the key.

### S9. What is the memory footprint at `N = Q = 10⁸`?
Roughly: DSU arrays ≈ `10⁸ × ~32 B ≈ 3.2 GB`, query buckets ≈ `2 × 10⁸ × ~32 B ≈ 6.4 GB`, plus adjacency. Tens of GB — fits a single 64 GB box. It is the smallest footprint of any LCA method (no `O(N log N)` table).

### S10 (analysis). Is there an average-case speedup?
No, to leading order. The `α(N)` factor is amortized and already effectively constant on all inputs. What varies is *stack space* (tree height: `O(log N)` balanced vs `O(N)` path-shaped), not time. Tarjan's time bound is the same near-linear figure on best, average, and worst inputs.

---

## Professional Questions (8 Q&A)

### P1. Why is the inverse-Ackermann factor unavoidable for DSU-based LCA?
Because the algorithm reduces to a Union-Find operation sequence, and Tarjan (1979) / Fredman–Saks (1989, cell-probe) proved a matching `Ω(α(N))` lower bound per operation for separable pointer / cell-probe Union-Find. You cannot beat `α` without leaving the DSU model.

### P2. Compare the `⟨O(N), O(1)⟩` online LCA with Tarjan offline.
Euler tour + Farach-Colton–Bender achieves `O(N)` build and `O(1)` per query online, exploiting the `±1` structure of the Euler depth array (block decomposition + sparse table on block minima + precomputed block-shape tables). Tarjan achieves `O(N + Q)` total offline with `O(N + Q)` memory and far simpler code. FCB wins when queries stream; Tarjan wins on simplicity and memory for a single batch.

### P3. Derive the union count and find count precisely.
`N` make-sets (entry). `N − 1` unions (one per non-root node, post-order). Finds: `N` at entry assignments, `N − 1` after-union assignments, `O(1)` inside each union, and `Q` at query resolution (each query resolved once) — totaling `Θ(N + Q)` finds. Apply the DSU bound for `O((N+Q)α(N))`.

### P4. How do Cartesian trees connect RMQ to this algorithm?
A Cartesian tree of an array is a min-heap whose in-order traversal is the array. `RMQ(i, j)` equals `LCA(node_i, node_j)` in that tree. So an offline batch of RMQ queries reduces to: build the Cartesian tree in `O(N)`, then run Tarjan offline LCA — a near-linear offline RMQ.

### P5. What does it take to support a *dynamic* tree?
Tarjan and the static online methods all assume a frozen tree. For insertions/deletions you need link-cut trees (Sleator–Tarjan, `O(log N)` amortized) or Euler-tour trees. Offline-with-updates can sometimes use divide-and-conquer on the timeline, but there is no clean DSU-only solution.

### P6. How would you debug "all LCAs are the root" in production?
That signature is almost always a stale `ancestor` after union. Add an invariant check that recomputes a sampled LCA via depth-equalized climbing and compares; log mismatches with the snapshot hash. Then inspect the union code path for the missing `ancestor[find(parent)] = parent` re-assignment.

### P7. Why does relabeling by DFS-entry order improve cache behavior?
After relabeling, every subtree occupies a contiguous index range. The DSU's `parent`/`ancestor` writes and reads, and the per-node query buckets, then cluster into the same cache lines, cutting random-access misses 1.5–2× on large trees.

### P8 (analysis). When is Tarjan asymptotically optimal for a batch?
When `Q = Θ(N)` and the batch is available offline: `Θ(N·α(N))` ties the `Θ(N)` of Euler+FCB to within the unavoidable `α`, while using strictly less memory than the `Θ(N log N)`-space methods. The only thing it gives up is online answering.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose an offline algorithm over an online one.
Look for a structured story: the workload was a frozen batch (e.g. nightly tree analytics), the alternatives (binary lifting, sparse table) cost more memory and build time, and the offline kernel was simpler, near-linear, and idempotent. Strong answers cite the deciding factor — *availability of the full batch* — not just asymptotics, and mention how they validated correctness.

### B2. Design a service that answers tree-distance questions for an org chart.
Expected answer: collect distance queries into a batch, freeze a snapshot of the org tree, run Tarjan offline LCA computing `depth[]` in the same DFS, then `depth[u]+depth[v]−2·depth[LCA]`. Discuss the batch boundary, reproducibility via snapshot hash, and the online fallback (climb-with-depths) for stray late queries.

### B3. Your batch job reports some queries as unanswered. How do you investigate?
Check whether the tree is actually connected (forest ⇒ cross-component pairs never resolve), whether queries reference valid node ids, and whether each query was registered on *both* endpoints. Add the `unanswered_queries` metric and assert every node was visited (`unions_total == N − 1`).

### B4. A teammate wants to use Tarjan for an interactive LCA endpoint. What do you say?
Tarjan is offline; it cannot answer a query that was not in the original batch. For an interactive endpoint use an online structure (binary lifting or Euler+sparse-table) built once over the static tree. Reserve Tarjan for genuine batch workloads. Use it as a teaching moment about matching the algorithm to the access pattern.

### B5. How would you make a giant offline LCA job robust and observable?
Explicit-stack DFS pre-sized to tree height (no recursion overflow), snapshot hashing for idempotent retries, metrics for stack depth / unions / unanswered queries, and a CI canary verifying sampled answers against an independent LCA. Plan capacity by `N + Q` memory and memory bandwidth.

---

## Coding Challenges

### Challenge 1: Implement Tarjan Offline LCA

**Problem.** Given a tree with `N` nodes rooted at node `0` (adjacency list of children) and a list of `Q` query pairs, return an array of the LCAs in the same order as the queries.

**Example.**
```text
Tree (children): 0->[1,2], 1->[3,4], 2->[5]
Queries: (3,4), (3,5), (4,2)
Output:  1, 0, 0
```

**Constraints.** `1 ≤ N ≤ 2·10⁵`, `1 ≤ Q ≤ 2·10⁵`, tree may be deep — handle it.

**Approach.** Single DFS; union each finished child into its parent; answer a query when its second endpoint is visited via `ancestor[find(other)]`. Use the iterative DFS to survive deep trees.

**Go.**

```go
package main

import "fmt"

type DSU struct{ parent, rank, anc []int }

func newDSU(n int) *DSU {
	d := &DSU{make([]int, n), make([]int, n), make([]int, n)}
	for i := range d.parent {
		d.parent[i], d.anc[i] = i, i
	}
	return d
}
func (d *DSU) find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]]
		x = d.parent[x]
	}
	return x
}
func (d *DSU) union(p, c int) {
	rp, rc := d.find(p), d.find(c)
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
	d.anc[d.find(rp)] = p
}

func tarjanLCA(adj [][]int, root int, queries [][2]int) []int {
	n := len(adj)
	d := newDSU(n)
	visited := make([]bool, n)
	ans := make([]int, len(queries))
	for i := range ans {
		ans[i] = -1
	}
	type q struct{ other, id int }
	byNode := make([][]q, n)
	for id, pr := range queries {
		byNode[pr[0]] = append(byNode[pr[0]], q{pr[1], id})
		byNode[pr[1]] = append(byNode[pr[1]], q{pr[0], id})
	}
	type frame struct{ node, ci int }
	st := []frame{{root, 0}}
	d.anc[d.find(root)] = root
	for len(st) > 0 {
		top := &st[len(st)-1]
		u := top.node
		if top.ci < len(adj[u]) {
			c := adj[u][top.ci]
			top.ci++
			d.anc[d.find(c)] = c
			st = append(st, frame{c, 0})
		} else {
			visited[u] = true
			for _, qq := range byNode[u] {
				if visited[qq.other] {
					ans[qq.id] = d.anc[d.find(qq.other)]
				}
			}
			st = st[:len(st)-1]
			if len(st) > 0 {
				d.union(st[len(st)-1].node, u)
			}
		}
	}
	return ans
}

func main() {
	adj := [][]int{{1, 2}, {3, 4}, {5}, {}, {}, {}}
	queries := [][2]int{{3, 4}, {3, 5}, {4, 2}}
	fmt.Println(tarjanLCA(adj, 0, queries)) // [1 0 0]
}
```

**Java.**

```java
import java.util.*;

public class TarjanLCA {
    int[] parent, rank, anc;
    int find(int x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    void union(int p, int c) {
        int rp = find(p), rc = find(c);
        if (rp == rc) return;
        if (rank[rp] < rank[rc]) { int t = rp; rp = rc; rc = t; }
        parent[rc] = rp;
        if (rank[rp] == rank[rc]) rank[rp]++;
        anc[find(rp)] = p;
    }

    int[] solve(List<List<Integer>> adj, int root, int[][] queries) {
        int n = adj.size();
        parent = new int[n]; rank = new int[n]; anc = new int[n];
        boolean[] visited = new boolean[n];
        for (int i = 0; i < n; i++) { parent[i] = i; anc[i] = i; }
        List<int[]>[] byNode = new List[n];
        for (int i = 0; i < n; i++) byNode[i] = new ArrayList<>();
        int[] ans = new int[queries.length];
        Arrays.fill(ans, -1);
        for (int id = 0; id < queries.length; id++) {
            byNode[queries[id][0]].add(new int[]{queries[id][1], id});
            byNode[queries[id][1]].add(new int[]{queries[id][0], id});
        }
        int[] node = new int[n], ci = new int[n];
        int sp = 0; node[sp] = root; ci[sp] = 0; sp++;
        anc[find(root)] = root;
        while (sp > 0) {
            int u = node[sp - 1];
            if (ci[sp - 1] < adj.get(u).size()) {
                int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
                anc[find(c)] = c;
                node[sp] = c; ci[sp] = 0; sp++;
            } else {
                visited[u] = true;
                for (int[] q : byNode[u]) if (visited[q[0]]) ans[q[1]] = anc[find(q[0])];
                sp--;
                if (sp > 0) union(node[sp - 1], u);
            }
        }
        return ans;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < 6; i++) adj.add(new ArrayList<>());
        adj.get(0).addAll(List.of(1, 2));
        adj.get(1).addAll(List.of(3, 4));
        adj.get(2).add(5);
        int[][] q = {{3, 4}, {3, 5}, {4, 2}};
        System.out.println(Arrays.toString(new TarjanLCA().solve(adj, 0, q))); // [1, 0, 0]
    }
}
```

**Python.**

```python
def tarjan_lca(adj, root, queries):
    n = len(adj)
    parent = list(range(n)); rank = [0]*n; anc = list(range(n))
    visited = [False]*n; ans = [-1]*len(queries)
    by_node = [[] for _ in range(n)]
    for qid, (u, v) in enumerate(queries):
        by_node[u].append((v, qid)); by_node[v].append((u, qid))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x

    def union(p, c):
        rp, rc = find(p), find(c)
        if rp == rc: return
        if rank[rp] < rank[rc]: rp, rc = rc, rp
        parent[rc] = rp
        if rank[rp] == rank[rc]: rank[rp] += 1
        anc[find(rp)] = p

    stack = [[root, 0]]; anc[find(root)] = root
    while stack:
        fr = stack[-1]; u = fr[0]
        if fr[1] < len(adj[u]):
            c = adj[u][fr[1]]; fr[1] += 1
            anc[find(c)] = c
            stack.append([c, 0])
        else:
            visited[u] = True
            for other, qid in by_node[u]:
                if visited[other]:
                    ans[qid] = anc[find(other)]
            stack.pop()
            if stack:
                union(stack[-1][0], u)
    return ans


if __name__ == "__main__":
    adj = [[1, 2], [3, 4], [5], [], [], []]
    print(tarjan_lca(adj, 0, [(3, 4), (3, 5), (4, 2)]))  # [1, 0, 0]
```

**Follow-up.** What if queries can arrive over time? Tarjan no longer applies — switch to binary lifting (build once, answer each as it comes).

---

### Challenge 2: Batch Tree-Distance Queries

**Problem.** Given a tree rooted at `0` and `Q` pairs, return the number of edges on the path between each pair: `dist(u,v) = depth[u] + depth[v] − 2·depth[LCA(u,v)]`.

**Example.**
```text
Tree: 0->[1,2], 1->[3,4], 2->[5]
depths: 0:0  1:1  2:1  3:2  4:2  5:2
dist(3,4) = 2+2-2*1 = 2   (3-1-4)
dist(3,5) = 2+2-2*0 = 4   (3-1-0-2-5)
dist(4,2) = 2+1-2*0 = 3   (4-1-0-2)
```

**Constraints.** `1 ≤ N, Q ≤ 2·10⁵`; weights are 1 (unweighted). For weighted, replace `depth` with `distRoot` (sum of edge weights to root).

**Approach.** Compute `depth[]` during the DFS, run Tarjan offline LCA, then apply the formula.

**Go.**

```go
package main

import "fmt"

// Reuse DSU and tarjanLCA from Challenge 1 (omitted; assume in package).

func distances(adj [][]int, root int, queries [][2]int) []int {
	n := len(adj)
	depth := make([]int, n)
	// BFS/iterative DFS to fill depth
	type fr struct{ node, ci int }
	st := []fr{{root, 0}}
	for len(st) > 0 {
		top := &st[len(st)-1]
		u := top.node
		if top.ci < len(adj[u]) {
			c := adj[u][top.ci]
			top.ci++
			depth[c] = depth[u] + 1
			st = append(st, fr{c, 0})
		} else {
			st = st[:len(st)-1]
		}
	}
	lca := tarjanLCA(adj, root, queries)
	res := make([]int, len(queries))
	for i, q := range queries {
		res[i] = depth[q[0]] + depth[q[1]] - 2*depth[lca[i]]
	}
	return res
}

func main() {
	adj := [][]int{{1, 2}, {3, 4}, {5}, {}, {}, {}}
	queries := [][2]int{{3, 4}, {3, 5}, {4, 2}}
	fmt.Println(distances(adj, 0, queries)) // [2 4 3]
}
```

**Java.**

```java
import java.util.*;

public class BatchDistance {
    // Reuse TarjanLCA.solve from Challenge 1.
    int[] distances(List<List<Integer>> adj, int root, int[][] queries) {
        int n = adj.size();
        int[] depth = new int[n];
        int[] node = new int[n], ci = new int[n];
        int sp = 0; node[sp] = root; ci[sp] = 0; sp++;
        while (sp > 0) {
            int u = node[sp - 1];
            if (ci[sp - 1] < adj.get(u).size()) {
                int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
                depth[c] = depth[u] + 1;
                node[sp] = c; ci[sp] = 0; sp++;
            } else sp--;
        }
        int[] lca = new TarjanLCA().solve(adj, root, queries);
        int[] res = new int[queries.length];
        for (int i = 0; i < queries.length; i++)
            res[i] = depth[queries[i][0]] + depth[queries[i][1]] - 2 * depth[lca[i]];
        return res;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < 6; i++) adj.add(new ArrayList<>());
        adj.get(0).addAll(List.of(1, 2));
        adj.get(1).addAll(List.of(3, 4));
        adj.get(2).add(5);
        int[][] q = {{3, 4}, {3, 5}, {4, 2}};
        System.out.println(Arrays.toString(new BatchDistance().distances(adj, 0, q))); // [2, 4, 3]
    }
}
```

**Python.**

```python
def distances(adj, root, queries):
    n = len(adj)
    depth = [0] * n
    stack = [[root, 0]]
    while stack:
        fr = stack[-1]; u = fr[0]
        if fr[1] < len(adj[u]):
            c = adj[u][fr[1]]; fr[1] += 1
            depth[c] = depth[u] + 1
            stack.append([c, 0])
        else:
            stack.pop()
    lca = tarjan_lca(adj, root, queries)  # from Challenge 1
    return [depth[u] + depth[v] - 2 * depth[lca[i]]
            for i, (u, v) in enumerate(queries)]


if __name__ == "__main__":
    adj = [[1, 2], [3, 4], [5], [], [], []]
    print(distances(adj, 0, [(3, 4), (3, 5), (4, 2)]))  # [2, 4, 3]
```

**Follow-up.** For a weighted tree, accumulate `distRoot[c] = distRoot[u] + w(u,c)` instead of `depth`, and use `distRoot[u] + distRoot[v] − 2·distRoot[LCA]`.

---

### Challenge 3: LCA of the Two Deepest Leaves

**Problem.** Given a rooted tree, find the LCA of the two deepest leaves. If several leaves share the maximum depth, return the LCA of *all* deepest leaves (the deepest node that is an ancestor of every maximum-depth leaf).

**Example.**
```text
Tree: 0->[1,2], 1->[3,4], 2->[5]
Leaves: 3(d2), 4(d2), 5(d2). Max depth 2; deepest leaves {3,4,5}.
LCA(3,4,5) = 0
```

**Approach.** One DFS to compute depths and collect leaves at the maximum depth. Then fold them into pairwise queries and run Tarjan — or, simpler, the LCA of a *set* equals the LCA of the leaves with the minimum and maximum DFS-entry index among the set. Here we batch consecutive pairs through Tarjan and reduce.

**Go.**

```go
package main

import "fmt"

// Reuse tarjanLCA from Challenge 1.

func lcaOfDeepestLeaves(adj [][]int, root int) int {
	n := len(adj)
	depth := make([]int, n)
	type fr struct{ node, ci int }
	st := []fr{{root, 0}}
	maxD := 0
	var deepest []int
	for len(st) > 0 {
		top := &st[len(st)-1]
		u := top.node
		if top.ci < len(adj[u]) {
			c := adj[u][top.ci]
			top.ci++
			depth[c] = depth[u] + 1
			st = append(st, fr{c, 0})
		} else {
			if len(adj[u]) == 0 { // leaf
				if depth[u] > maxD {
					maxD = depth[u]
					deepest = []int{u}
				} else if depth[u] == maxD {
					deepest = append(deepest, u)
				}
			}
			st = st[:len(st)-1]
		}
	}
	if len(deepest) == 1 {
		return deepest[0]
	}
	// Reduce: LCA of a set = fold pairwise.
	cur := deepest[0]
	for _, x := range deepest[1:] {
		ans := tarjanLCA(adj, root, [][2]int{{cur, x}})
		cur = ans[0]
	}
	return cur
}

func main() {
	adj := [][]int{{1, 2}, {3, 4}, {5}, {}, {}, {}}
	fmt.Println(lcaOfDeepestLeaves(adj, 0)) // 0
}
```

**Java.**

```java
import java.util.*;

public class DeepestLeavesLCA {
    // Reuse TarjanLCA.solve from Challenge 1.
    int solve(List<List<Integer>> adj, int root) {
        int n = adj.size();
        int[] depth = new int[n];
        int[] node = new int[n], ci = new int[n];
        int sp = 0; node[sp] = root; ci[sp] = 0; sp++;
        int maxD = 0;
        List<Integer> deepest = new ArrayList<>();
        while (sp > 0) {
            int u = node[sp - 1];
            if (ci[sp - 1] < adj.get(u).size()) {
                int c = adj.get(u).get(ci[sp - 1]); ci[sp - 1]++;
                depth[c] = depth[u] + 1;
                node[sp] = c; ci[sp] = 0; sp++;
            } else {
                if (adj.get(u).isEmpty()) {
                    if (depth[u] > maxD) { maxD = depth[u]; deepest = new ArrayList<>(List.of(u)); }
                    else if (depth[u] == maxD) deepest.add(u);
                }
                sp--;
            }
        }
        int cur = deepest.get(0);
        for (int i = 1; i < deepest.size(); i++)
            cur = new TarjanLCA().solve(adj, root, new int[][]{{cur, deepest.get(i)}})[0];
        return cur;
    }

    public static void main(String[] args) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < 6; i++) adj.add(new ArrayList<>());
        adj.get(0).addAll(List.of(1, 2));
        adj.get(1).addAll(List.of(3, 4));
        adj.get(2).add(5);
        System.out.println(new DeepestLeavesLCA().solve(adj, 0)); // 0
    }
}
```

**Python.**

```python
def lca_of_deepest_leaves(adj, root):
    n = len(adj)
    depth = [0] * n
    stack = [[root, 0]]
    max_d, deepest = 0, []
    while stack:
        fr = stack[-1]; u = fr[0]
        if fr[1] < len(adj[u]):
            c = adj[u][fr[1]]; fr[1] += 1
            depth[c] = depth[u] + 1
            stack.append([c, 0])
        else:
            if not adj[u]:  # leaf
                if depth[u] > max_d:
                    max_d, deepest = depth[u], [u]
                elif depth[u] == max_d:
                    deepest.append(u)
            stack.pop()
    cur = deepest[0]
    for x in deepest[1:]:
        cur = tarjan_lca(adj, root, [(cur, x)])[0]  # from Challenge 1
    return cur


if __name__ == "__main__":
    adj = [[1, 2], [3, 4], [5], [], [], []]
    print(lca_of_deepest_leaves(adj, 0))  # 0
```

**Follow-up.** Folding pairwise reruns Tarjan per pair. To do it in *one* pass, batch all consecutive pairs `(deepest[i], deepest[i+1])` into a single Tarjan call, then take the LCA of all those answers (the LCA of a set is the LCA of consecutive ones in DFS order). Interviewers like seeing you avoid the repeated-pass trap.

---

## Common Pitfalls in Interviews

- **Forgetting `ancestor` re-assignment after union.** The single most common bug; produces "everything is the root."
- **Registering the query on one endpoint only.** The query silently never resolves if the other endpoint finishes first.
- **Answering without the `visited[other]` guard.** Reads an ancestor for a node not yet finished — garbage.
- **Recursive DFS on a deep tree.** Stack overflow at `~10⁴`–`10⁵` depth; use the explicit stack.
- **Claiming it works online.** Tarjan cannot answer queries not in the batch — say so explicitly.
- **Skipping path compression / union by rank.** Correct but loses the near-linear bound; mention both heuristics.
- **Confusing the union direction.** Always `union(parent, child)` *after* the child finishes, never before.
- **Not mapping answers back to input order.** Carry the query index through.

---

## What Interviewers Are Really Testing

A Tarjan-LCA question is a probe into three things. **First, do you understand Union-Find as a *tool*, not just an API?** The whole algorithm is an application of DSU, and the give-away of real understanding is being able to explain *why* `ancestor[find(other)]` is the LCA — the "deepest gray ancestor" invariant — rather than reciting the steps. **Second, can you reason about DFS finishing order?** The union-after-finish timing and the answer-on-second-endpoint timing are the crux; candidates who blur entry vs finish get subtly wrong code. **Third, do you know the trade-off landscape?** Offline vs online is the decision that actually matters in practice; a strong candidate immediately asks "are all queries known up front?" and picks Tarjan only when the answer is yes, otherwise reaching for binary lifting or Euler+sparse-table. The best answers also handle the corners — deep-tree recursion (go iterative), disconnected forests, `LCA(u,u)`, duplicate queries — and mention how they would validate correctness against a brute-force LCA. A single small algorithm, but it exercises data-structure intuition, careful invariant reasoning, and engineering judgment all at once.
