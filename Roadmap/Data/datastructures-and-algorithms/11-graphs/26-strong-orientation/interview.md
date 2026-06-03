# Strong Orientation (Robbins' Theorem) — Interview Preparation

Strong orientation is a favorite interview topic because it sits at the intersection of three things every strong candidate should know: **DFS and edge classification**, **bridges / 2-edge-connectivity**, and **strong connectivity**. It has a memorable theorem (Robbins'), a slick linear algorithm (tree edges down, back edges up), and several gotchas — bridges, multigraphs, mixed graphs — that separate the candidate who memorized a recipe from the one who understands *why* it works. This file is a curated bank sorted by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Item | Answer |
|------|--------|
| Problem | Direct every undirected edge so the digraph is strongly connected. |
| Robbins' Theorem | Strong orientation exists ⟺ graph is connected **and** bridgeless (2-edge-connected). |
| Why bridges fail | A bridge is the only edge across a cut; oriented one way, the other side is stranded. |
| Construction | One DFS: tree edges **down** (parent→child), back edges **up** (descendant→ancestor). |
| Bridge test | Tree edge `{u,v}` is a bridge ⟺ `low[v] > disc[u]`. |
| Complexity | `O(V + E)` time, `O(V)` space — optimal. |
| Verify | One Tarjan SCC pass (== 1 SCC) or forward+reverse reachability. |
| Mixed graph | Some edges pre-directed ⇒ use flow (Boesch–Tindell), not DFS. |
| Tree input | Every tree edge is a bridge ⇒ no strong orientation. |
| Multigraph | Two parallel edges are **not** a bridge (they form a 2-cycle). |
| Augment to fix | Add `⌈L/2⌉` edges, `L` = bridge-tree leaves (Eswaran–Tarjan). |

DFS orientation core:

```text
dfs(u, parentEdgeId):
    disc[u] = low[u] = timer++
    for (v, eid) in adj[u]:
        if eid == parentEdgeId: continue
        if disc[v] == -1:                     # tree edge
            dir[eid] = (u, v)                 # down
            dfs(v, eid)
            low[u] = min(low[u], low[v])
            if low[v] > disc[u]: bridge = true
        elif disc[v] < disc[u]:               # back edge
            if dir[eid] unset: dir[eid] = (u, v)   # up
            low[u] = min(low[u], disc[v])
```

Key invariants:

- **Existence:** connected + bridgeless.
- **Down/up rule:** tree edges toward children, back edges toward ancestors.
- **Verification:** result must be exactly one SCC.

---

## Junior Questions (12 Q&A)

### J1. What is a strong orientation?
A strong orientation assigns a direction to every undirected edge of a graph so that the resulting directed graph is *strongly connected* — every vertex can reach every other vertex by following edge directions. The classic motivation is making all of a city's two-way streets one-way while keeping every intersection reachable from every other.

### J2. State Robbins' Theorem.
A connected undirected graph has a strong orientation if and only if it is 2-edge-connected, i.e. it has no bridges. The "if" direction is constructive (a DFS builds the orientation); the "only if" direction is the observation that a bridge can never be made strongly connected.

### J3. What is a bridge?
A bridge (or cut edge) is an edge whose removal increases the number of connected components — it is the only link between two parts of the graph. Equivalently, an edge that lies on no cycle. Bridges are the sole obstruction to strong orientation.

### J4. Why can't a graph with a bridge be strongly oriented?
A bridge `{u, v}` is the only edge across the cut separating `u`'s side from `v`'s side. Whichever direction you give it, all the traffic on one side can never cross back. So one side becomes unreachable from the other — not strongly connected. No choice of the other edges can fix this.

### J5. What does "2-edge-connected" mean?
A connected graph that stays connected after the removal of any single edge. Equivalently, a graph with no bridges. Every edge lies on at least one cycle. This is exactly Robbins' precondition.

### J6. How do you construct a strong orientation?
Run a single DFS from any vertex. Orient each tree edge in the direction DFS traversed it (parent to child, "down"), and orient each back edge toward the ancestor it points to ("up"). If the graph is bridgeless, the result is strongly connected.

### J7. What is the time complexity?
`O(V + E)` — it is essentially one DFS. There is no logarithmic factor. Detecting bridges (the precondition) is folded into the same DFS via the low-link computation, so the whole thing is linear.

### J8. What is a tree edge versus a back edge?
In an undirected DFS, a tree edge is one that discovers a new vertex (parent to child). A back edge connects a vertex to one of its ancestors already on the DFS stack. Undirected DFS produces only these two types — no cross or forward edges.

### J9. Does the choice of root or DFS order matter?
For a connected bridgeless graph, any root and any DFS order yields *a* valid strong orientation. The specific orientation differs, but all of them are strongly connected. So the answer's *existence* is independent of the root.

### J10. How do you check the result is correct?
Run a strongly-connected-components check on the oriented graph; it must have exactly one SCC. Simplest version: a forward reachability DFS from any vertex and a reverse reachability DFS from the same vertex must both reach all vertices.

### J11. Can a tree be strongly oriented?
No. In a tree every edge is a bridge (removing any edge disconnects it), so by Robbins' Theorem no strong orientation exists. A tree is the worst case: maximally "bridge-y."

### J12. What is the relationship to one-way streets?
The original 1939 application by Robbins: a town wants to make every street one-way for traffic control. Robbins' Theorem says this is possible (keeping every intersection mutually reachable) exactly when the street network has no bridge — no street that is the sole connection between two parts of town.

---

## Middle Questions (12 Q&A)

### M1. Walk through why the DFS construction produces a strongly connected graph.
Two facts. First, the root reaches everyone: tree edges oriented downward give a directed path from the root to every vertex. Second, everyone reaches the root: in a bridgeless graph, every subtree has a back edge escaping above its root, so from any vertex you descend to a vertex with such a back edge, jump up, and repeat until you hit the root. Reach-from-root plus reach-to-root means any `u` reaches any `v`.

### M2. How is bridge detection folded into the orientation DFS?
You compute `low[u]` = the smallest discovery time reachable from `u`'s subtree using downward tree edges plus one back edge. A tree edge `{u, v}` is a bridge exactly when `low[v] > disc[u]` (nothing in `v`'s subtree reaches `u` or above). The same DFS that orients edges computes `low`, so the precondition check is free.

### M3. What goes wrong on a multigraph if you "skip the parent vertex"?
If two parallel edges connect `u` and `v`, and you skip *all* edges back to the parent vertex, you wrongly discard the second parallel edge and may also misjudge bridges (two parallel edges are not a bridge). The fix is to skip only the *specific parent edge id*, not every edge to the parent vertex.

### M4. Is the strong orientation unique?
No. Different DFS roots or neighbor orders produce different valid orientations. There can be exponentially many strong orientations of a single graph. The DFS just finds one of them deterministically (given a fixed root and adjacency order).

### M5. What is a 2-edge-connected component and why does it matter?
A maximal subgraph with no internal bridge. When the whole graph has bridges, you cannot strongly orient it entirely, but you can orient each 2-edge-connected component strongly. The bridges connect these components in a tree (the bridge tree) and remain forced one-way.

### M6. How do you handle a graph that does have bridges?
Decompose into 2-edge-connected components, strongly orient each one with the DFS recipe, and orient the bridges along the bridge tree (forming a DAG of components). The whole graph can't be strongly connected, but this is the best possible: strong inside each component.

### M7. What is a mixed graph and why does DFS fail on it?
A mixed graph has some edges already directed (fixed one-way streets) and others undirected. DFS would overwrite the fixed directions. Feasibility for mixed graphs is given by the Boesch–Tindell theorem and solved with network flow, not plain DFS.

### M8. How would you verify with a single pass instead of two?
Run Tarjan's SCC algorithm (sibling **08-tarjan-scc**) once on the oriented graph. If it reports exactly one strongly connected component, the orientation is strong. This is `O(V+E)` in one pass and also tells you *how many* components you have if it fails.

### M9. Why are there no cross edges in undirected DFS?
If edge `{u, v}` existed with `u` discovered first, then when DFS processes `u` it sees `v`; either `v` is new (tree edge) or `v` was reached through `u`'s subtree (making it a descendant, so a back edge from `v`). There is no way to form an ancestor-unrelated "cross" relationship in undirected DFS, which is what makes the tree/back classification clean.

### M10. How many edges must be added to make a graph strongly orientable?
If the graph is connected but has bridges, build the bridge tree; if it has `L` leaves, you need `⌈L/2⌉` added edges (Eswaran–Tarjan). Each added edge can pair up two leaves and eliminate the bridges between them.

### M11. What is the recursion-depth risk and how do you mitigate it?
DFS recursion can be `O(V)` deep on a path-like graph and overflow the stack. Mitigate by raising the recursion limit (Python) or converting to an explicit stack for large inputs (`V > 10^5`).

### M12. How does this relate to ear decomposition?
Every 2-edge-connected graph has an open ear decomposition: a base cycle plus a sequence of paths ("ears") attached at existing vertices. Orienting the base cycle consistently and each ear as a directed path gives a strong orientation — an alternative constructive proof of Robbins' Theorem, and the basis of parallel orientation algorithms.

---

## Senior Questions (10 Q&A)

### S1. Design an orientation service for a live city road network.
Split feasibility (with bridge *evidence*) from construction. On each request: check bridgeless via low-link DFS; if feasible, orient via DFS and verify with an SCC pass; if not, degrade to per-2ECC orientation plus an augmentation plan (`⌈L/2⌉` edges). For live edits, maintain 2-edge-connectivity incrementally (sibling **30-online-bridges**) and re-orient only affected components.

### S2. How do you orient a mixed graph at scale?
Hybrid: DFS-orient the fully-undirected 2-edge-connected components (cheap, linear), and reserve the flow-based Boesch–Tindell method for the (usually few) components that contain pre-directed edges. Flow is `O(VE)`; invoking it only where needed keeps the overall cost near-linear.

### S3. What is the single most important production safeguard?
An independent SCC verification on every orientation. The construction is simple enough to get subtly wrong (edge double-orientation, multigraph parent skip), and a non-strongly-connected "strong orientation" is the one defect that must never ship. Alert on any verify failure.

### S4. How do you make orientation incremental under edge insertions?
Adding an edge can only merge 2ECCs and remove bridges. Maintain the bridge tree with a union-find / small-to-large merge (sibling **21-small-to-large-merging**) for near-`O(α)` amortized inserts. Only components whose structure changed need re-orienting; the rest stay valid.

### S5. And under deletions?
Deletions can split components and create bridges — the hard direction. This needs fully-dynamic 2-edge-connectivity (Holm–de Lichtenberg–Thorup), `O(log² n)` amortized. If the edit pattern is insert-heavy, the insert-only structure suffices; otherwise budget for the heavier machinery.

### S6. What observability signals would you emit?
`feasible{result}`, `bridges_blocking` gauge, `orient_latency_ms` histogram, `components_2ecc` gauge, `verify_failures` counter (must be zero), and `augment_edges_recommended`. The critical alert is `verify_failures > 0`.

### S7. How does Robbins relate to Nash-Williams' orientation theorem?
Nash-Williams (1960): every `2k`-edge-connected graph has a `k`-arc-connected orientation. Robbins is the `k=1` case. The general theorem is far deeper and uses submodular flow techniques; Robbins is the friendly entry point.

### S8. When would you choose ear decomposition over DFS?
When you need parallelism. Ear decomposition computes in `O(log n)` parallel depth, so it parallelizes orientation in a way the inherently sequential DFS does not. For single-machine static graphs, DFS wins on simplicity.

### S9. How do you bound memory for a continental road graph?
Adjacency lists dominate: `O(V + E)` words plus `2V` for `disc`/`low`. A 10⁷-edge graph with 8-byte ids is ~160 MB — fits on one node. Orientation is single-pass and cache-friendly along adjacency lists.

### S10. How do you give an operator an actionable answer when orientation is infeasible?
Don't just say "no." Return the blocking bridges (so they can be mapped), orient everything else optimally per 2ECC, and compute `⌈L/2⌉` — the minimum new connections that would make the whole network one-way-able. Feasibility, evidence, and a fix plan in one response.

---

## Analysis Questions (8 Q&A)

### A1. Prove that a bridge precludes strong orientation.
Removing bridge `{u,v}` splits the graph into parts `A∋u` and `B∋v` with `e` the only crossing edge. Any orientation makes `e` either `u→v` (then no arc goes `B→A`, so `B` can't reach `A`) or `v→u` (symmetric). Either way not strongly connected. ∎

### A2. Prove the DFS construction is correct when bridgeless.
Root reaches all via downward tree edges. For the converse, bridgelessness gives `low[x] < disc[x]` for every non-root `x` (else the parent edge is a bridge). So from any `x` you descend in its subtree to a vertex with a back edge above `x`, jump up, and repeat with strictly decreasing discovery time until reaching the root. Both directions ⇒ strongly connected. ∎

### A3. Why is the algorithm optimal?
A single unseen bridge flips feasibility from yes to no, so any correct algorithm must read every edge — `Ω(V+E)`. The DFS achieves `O(V+E)`, matching the lower bound. ∎

### A4. Prove `low[v] > disc[u]` characterizes bridges.
If `low[v] > disc[u]`, nothing in `v`'s subtree reaches `u` or above, so `{u,v}` is the only connection — a bridge. If `low[v] ≤ disc[u]`, some back edge from `v`'s subtree reaches `u` or higher, forming a cycle through `{u,v}`, so it is not a bridge. ∎

### A5. How many strong orientations can a graph have?
Up to exponentially many. For example, a single cycle of length `n` has exactly 2 strong orientations (clockwise / counterclockwise), but denser bridgeless graphs have far more. The count is generally `#P`-hard to compute exactly.

### A6. What is the complexity of the mixed-graph problem?
Polynomial — `O(VE)` via max-flow (Boesch–Tindell reduction). It is *not* NP-hard; the flow feasibility exactly captures the cut conditions. Adding arbitrary side constraints (costs, forbidden directions beyond the basic ones) can push it to ILP territory.

### A7. Derive the augmentation count `⌈L/2⌉`.
Contract 2ECCs to get the bridge tree with `L` leaves. Each added edge can connect two leaves, removing the bridges on the path between them; pairing leaves optimally covers all of them, needing `⌈L/2⌉` edges. A matching lower bound shows fewer cannot suffice. ∎

### A8. Compare orienting for strong connectivity vs for acyclicity.
Opposite goals. Acyclic orientation (a DAG) always exists and is trivial — orient by any topological/vertex order. Strong orientation exists only when bridgeless and aims for the *maximum* cyclic structure (every vertex on a directed cycle reaching all others). One avoids cycles; the other requires them everywhere.

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose a simpler algorithm over a more general one.
*Sample framing:* "We needed to one-way a delivery zone graph. It was fully undirected and bridgeless, so I used the linear DFS orientation instead of building the flow-based mixed-graph solver someone proposed. I justified it by checking the precondition (bridgeless, no pre-directed edges) up front and adding an SCC verification. The simpler path shipped in a day and ran in microseconds; the general solver would have been weeks and unnecessary."

### B2. Describe a bug that only a verification step would have caught.
*Sample framing:* "My orientation skipped the parent by vertex, not edge id, so on a multigraph it dropped a parallel edge and produced a non-strongly-connected result. The DFS 'succeeded.' Only the independent SCC check flagged it. I added the check to CI and switched to edge-id parent tracking. Lesson: trust construction, but verify."

### B3. How did you communicate an infeasible result to a non-technical stakeholder?
*Sample framing:* "The city couldn't be fully one-way because of three bridges over a river. Instead of 'impossible,' I produced a map highlighting the three blocking streets, oriented everything else, and quantified that two new connector roads (`⌈L/2⌉`) would make the whole plan feasible. The stakeholder left with options, not a dead end."

### B4. Tell me about balancing correctness and performance under deadline.
*Sample framing:* "Under a launch deadline I shipped the linear DFS with full verification rather than the incremental maintenance system. It recomputed from scratch on edits — acceptable at our edit rate. I documented the threshold edit rate at which we'd need the incremental version, and we built that later when traffic grew."

### B5. Describe explaining a non-obvious theorem to your team.
*Sample framing:* "I taught Robbins' Theorem by analogy: a bridge is a one-way wall; everything else lives on a loop you can drive around. Then I showed the DFS demo orienting tree edges down and back edges up on a whiteboard graph. Framing the precondition as 'no one-way walls' made the whole team internalize when it applies."

---

## Coding Challenges

### Challenge 1 — Decide and Build a Strong Orientation

**Problem.** Given a connected undirected graph, decide whether a strong orientation exists; if so, output a direction for every edge. Return `("NO", [])` if a bridge exists.

#### Go

```go
package main

import "fmt"

type E struct{ to, id int }

type G struct {
	n, m, timer int
	adj         [][]E
	disc, low   []int
	dir         [][2]int
	bridge      bool
}

func NewG(n int) *G { return &G{n: n, adj: make([][]E, n)} }

func (g *G) Add(u, v int) {
	g.adj[u] = append(g.adj[u], E{v, g.m})
	g.adj[v] = append(g.adj[v], E{u, g.m})
	g.dir = append(g.dir, [2]int{-1, -1})
	g.m++
}

func (g *G) dfs(u, pe int) {
	g.disc[u] = g.timer
	g.low[u] = g.timer
	g.timer++
	for _, e := range g.adj[u] {
		if e.id == pe {
			continue
		}
		if g.disc[e.to] == -1 {
			g.dir[e.id] = [2]int{u, e.to}
			g.dfs(e.to, e.id)
			if g.low[e.to] < g.low[u] {
				g.low[u] = g.low[e.to]
			}
			if g.low[e.to] > g.disc[u] {
				g.bridge = true
			}
		} else if g.disc[e.to] < g.disc[u] {
			if g.dir[e.id] == [2]int{-1, -1} {
				g.dir[e.id] = [2]int{u, e.to}
			}
			if g.disc[e.to] < g.low[u] {
				g.low[u] = g.disc[e.to]
			}
		}
	}
}

func (g *G) Solve() (string, [][2]int) {
	g.disc = make([]int, g.n)
	g.low = make([]int, g.n)
	for i := range g.disc {
		g.disc[i] = -1
	}
	g.dfs(0, -1)
	if g.bridge {
		return "NO", nil
	}
	return "YES", g.dir
}

func main() {
	g := NewG(4)
	for _, e := range [][2]int{{0, 1}, {0, 2}, {1, 2}, {1, 3}, {2, 3}} {
		g.Add(e[0], e[1])
	}
	res, dir := g.Solve()
	fmt.Println(res)
	for id, ft := range dir {
		fmt.Printf("edge %d: %d -> %d\n", id, ft[0], ft[1])
	}
}
```

#### Java

```java
import java.util.*;

public class Challenge1 {
    int n, m = 0, timer = 0;
    List<int[]>[] adj;
    int[] disc, low;
    List<int[]> dir = new ArrayList<>();
    boolean bridge = false;

    @SuppressWarnings("unchecked")
    Challenge1(int n) {
        this.n = n;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
    }

    void add(int u, int v) {
        adj[u].add(new int[]{v, m});
        adj[v].add(new int[]{u, m});
        dir.add(new int[]{-1, -1});
        m++;
    }

    void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dir.set(id, new int[]{u, v});
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) bridge = true;
            } else if (disc[v] < disc[u]) {
                if (dir.get(id)[0] == -1) dir.set(id, new int[]{u, v});
                low[u] = Math.min(low[u], disc[v]);
            }
        }
    }

    String solve() {
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        dfs(0, -1);
        return bridge ? "NO" : "YES";
    }

    public static void main(String[] args) {
        Challenge1 g = new Challenge1(4);
        int[][] es = {{0,1},{0,2},{1,2},{1,3},{2,3}};
        for (int[] e : es) g.add(e[0], e[1]);
        System.out.println(g.solve());
        for (int id = 0; id < g.m; id++) {
            int[] ft = g.dir.get(id);
            System.out.printf("edge %d: %d -> %d%n", id, ft[0], ft[1]);
        }
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1_000_000)


def solve(n, edge_list):
    adj = [[] for _ in range(n)]
    dir_ = []
    for u, v in edge_list:
        eid = len(dir_)
        adj[u].append((v, eid))
        adj[v].append((u, eid))
        dir_.append((-1, -1))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    bridge = [False]

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                dir_[eid] = (u, v)
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridge[0] = True
            elif disc[v] < disc[u]:
                if dir_[eid] == (-1, -1):
                    dir_[eid] = (u, v)
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    return ("NO", []) if bridge[0] else ("YES", dir_)


if __name__ == "__main__":
    res, dir_ = solve(4, [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3)])
    print(res)
    for eid, (f, t) in enumerate(dir_):
        print(f"edge {eid}: {f} -> {t}")
```

### Challenge 2 — Verify a Given Orientation Is Strongly Connected

**Problem.** Given a directed graph, return whether it is strongly connected using a single-source forward + reverse reachability check.

#### Go

```go
package main

import "fmt"

func reach(n int, g [][]int, s int) []bool {
	seen := make([]bool, n)
	st := []int{s}
	seen[s] = true
	for len(st) > 0 {
		u := st[len(st)-1]
		st = st[:len(st)-1]
		for _, v := range g[u] {
			if !seen[v] {
				seen[v] = true
				st = append(st, v)
			}
		}
	}
	return seen
}

func stronglyConnected(n int, arcs [][2]int) bool {
	out := make([][]int, n)
	in := make([][]int, n)
	for _, a := range arcs {
		out[a[0]] = append(out[a[0]], a[1])
		in[a[1]] = append(in[a[1]], a[0])
	}
	f := reach(n, out, 0)
	r := reach(n, in, 0)
	for i := 0; i < n; i++ {
		if !f[i] || !r[i] {
			return false
		}
	}
	return true
}

func main() {
	arcs := [][2]int{{0, 1}, {1, 2}, {2, 3}, {2, 0}, {3, 1}}
	fmt.Println(stronglyConnected(4, arcs)) // true
}
```

#### Java

```java
import java.util.*;

public class Challenge2 {
    static boolean[] reach(int n, List<Integer>[] g, int s) {
        boolean[] seen = new boolean[n];
        Deque<Integer> st = new ArrayDeque<>();
        st.push(s); seen[s] = true;
        while (!st.isEmpty()) {
            int u = st.pop();
            for (int v : g[u]) if (!seen[v]) { seen[v] = true; st.push(v); }
        }
        return seen;
    }

    @SuppressWarnings("unchecked")
    static boolean stronglyConnected(int n, int[][] arcs) {
        List<Integer>[] out = new List[n], in = new List[n];
        for (int i = 0; i < n; i++) { out[i] = new ArrayList<>(); in[i] = new ArrayList<>(); }
        for (int[] a : arcs) { out[a[0]].add(a[1]); in[a[1]].add(a[0]); }
        boolean[] f = reach(n, out, 0), r = reach(n, in, 0);
        for (int i = 0; i < n; i++) if (!f[i] || !r[i]) return false;
        return true;
    }

    public static void main(String[] args) {
        int[][] arcs = {{0,1},{1,2},{2,3},{2,0},{3,1}};
        System.out.println(stronglyConnected(4, arcs)); // true
    }
}
```

#### Python

```python
def reach(n, g, s):
    seen = [False] * n
    st = [s]
    seen[s] = True
    while st:
        u = st.pop()
        for v in g[u]:
            if not seen[v]:
                seen[v] = True
                st.append(v)
    return seen


def strongly_connected(n, arcs):
    out = [[] for _ in range(n)]
    inc = [[] for _ in range(n)]
    for a, b in arcs:
        out[a].append(b)
        inc[b].append(a)
    return all(reach(n, out, 0)) and all(reach(n, inc, 0))


if __name__ == "__main__":
    arcs = [(0, 1), (1, 2), (2, 3), (2, 0), (3, 1)]
    print(strongly_connected(4, arcs))  # True
```

### Challenge 3 — Count Bridges (the Precondition Test)

**Problem.** Given a connected undirected graph, count its bridges. A strong orientation exists iff the count is 0.

#### Go

```go
package main

import "fmt"

func countBridges(n int, edges [][2]int) int {
	type E struct{ to, id int }
	adj := make([][]E, n)
	for i, e := range edges {
		adj[e[0]] = append(adj[e[0]], E{e[1], i})
		adj[e[1]] = append(adj[e[1]], E{e[0], i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	timer := 0
	bridges := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u] = timer
		low[u] = timer
		timer++
		for _, e := range adj[u] {
			if e.id == pe {
				continue
			}
			if disc[e.to] == -1 {
				dfs(e.to, e.id)
				if low[e.to] < low[u] {
					low[u] = low[e.to]
				}
				if low[e.to] > disc[u] {
					bridges++
				}
			} else if disc[e.to] < low[u] {
				low[u] = disc[e.to]
			}
		}
	}
	dfs(0, -1)
	return bridges
}

func main() {
	// triangle + pendant: edge to pendant is a bridge
	fmt.Println(countBridges(4, [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}})) // 1
}
```

#### Java

```java
import java.util.*;

public class Challenge3 {
    static int n, timer = 0, bridges = 0;
    static List<int[]>[] adj;
    static int[] disc, low;

    static void dfs(int u, int pe) {
        disc[u] = low[u] = timer++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) bridges++;
            } else low[u] = Math.min(low[u], disc[v]);
        }
    }

    @SuppressWarnings("unchecked")
    static int countBridges(int nn, int[][] edges) {
        n = nn; timer = 0; bridges = 0;
        adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < edges.length; i++) {
            adj[edges[i][0]].add(new int[]{edges[i][1], i});
            adj[edges[i][1]].add(new int[]{edges[i][0], i});
        }
        disc = new int[n]; low = new int[n];
        Arrays.fill(disc, -1);
        dfs(0, -1);
        return bridges;
    }

    public static void main(String[] args) {
        System.out.println(countBridges(4, new int[][]{{0,1},{1,2},{2,0},{2,3}})); // 1
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1_000_000)


def count_bridges(n, edges):
    adj = [[] for _ in range(n)]
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    bridges = [0]

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridges[0] += 1
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)
    return bridges[0]


if __name__ == "__main__":
    print(count_bridges(4, [(0, 1), (1, 2), (2, 0), (2, 3)]))  # 1
```

### Challenge 4 — Minimum Edges to Add to Make Orientable

**Problem.** Given a connected undirected graph with bridges, compute the minimum number of edges to add so a strong orientation becomes possible. Answer: `⌈L/2⌉` where `L` is the number of leaves of the bridge tree (degree-1 nodes), with `0` when the graph is already 2-edge-connected.

#### Go

```go
package main

import "fmt"

// Build 2ECC ids by ignoring bridges, then count bridge-tree leaf degrees.
func minEdgesToOrient(n int, edges [][2]int) int {
	type E struct{ to, id int }
	adj := make([][]E, n)
	for i, e := range edges {
		adj[e[0]] = append(adj[e[0]], E{e[1], i})
		adj[e[1]] = append(adj[e[1]], E{e[0], i})
	}
	disc := make([]int, n)
	low := make([]int, n)
	for i := range disc {
		disc[i] = -1
	}
	isBridge := make([]bool, len(edges))
	timer := 0
	var dfs func(u, pe int)
	dfs = func(u, pe int) {
		disc[u] = timer
		low[u] = timer
		timer++
		for _, e := range adj[u] {
			if e.id == pe {
				continue
			}
			if disc[e.to] == -1 {
				dfs(e.to, e.id)
				if low[e.to] < low[u] {
					low[u] = low[e.to]
				}
				if low[e.to] > disc[u] {
					isBridge[e.id] = true
				}
			} else if disc[e.to] < low[u] {
				low[u] = disc[e.to]
			}
		}
	}
	dfs(0, -1)

	// label 2ECC components (DFS over non-bridge edges)
	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	c := 0
	for s := 0; s < n; s++ {
		if comp[s] != -1 {
			continue
		}
		stack := []int{s}
		comp[s] = c
		for len(stack) > 0 {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, e := range adj[u] {
				if !isBridge[e.id] && comp[e.to] == -1 {
					comp[e.to] = c
					stack = append(stack, e.to)
				}
			}
		}
		c++
	}
	if c == 1 {
		return 0 // already 2-edge-connected
	}
	deg := make([]int, c)
	for i, e := range edges {
		if isBridge[i] {
			deg[comp[e[0]]]++
			deg[comp[e[1]]]++
		}
	}
	leaves := 0
	for _, d := range deg {
		if d == 1 {
			leaves++
		}
	}
	return (leaves + 1) / 2
}

func main() {
	// two triangles joined by a bridge: bridge tree is a single edge, 2 leaves -> 1
	edges := [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}}
	fmt.Println(minEdgesToOrient(6, edges)) // 1
}
```

#### Java

```java
import java.util.*;

public class Challenge4 {
    public static int minEdges(int n, int[][] edges) {
        List<int[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < edges.length; i++) {
            adj[edges[i][0]].add(new int[]{edges[i][1], i});
            adj[edges[i][1]].add(new int[]{edges[i][0], i});
        }
        int[] disc = new int[n], low = new int[n];
        Arrays.fill(disc, -1);
        boolean[] isBridge = new boolean[edges.length];
        int[] timer = {0};
        dfs(0, -1, adj, disc, low, isBridge, timer);

        int[] comp = new int[n];
        Arrays.fill(comp, -1);
        int c = 0;
        for (int s = 0; s < n; s++) {
            if (comp[s] != -1) continue;
            Deque<Integer> st = new ArrayDeque<>();
            st.push(s); comp[s] = c;
            while (!st.isEmpty()) {
                int u = st.pop();
                for (int[] e : adj[u])
                    if (!isBridge[e[1]] && comp[e[0]] == -1) { comp[e[0]] = c; st.push(e[0]); }
            }
            c++;
        }
        if (c == 1) return 0;
        int[] deg = new int[c];
        for (int i = 0; i < edges.length; i++)
            if (isBridge[i]) { deg[comp[edges[i][0]]]++; deg[comp[edges[i][1]]]++; }
        int leaves = 0;
        for (int d : deg) if (d == 1) leaves++;
        return (leaves + 1) / 2;
    }

    static void dfs(int u, int pe, List<int[]>[] adj, int[] disc, int[] low,
                    boolean[] isBridge, int[] timer) {
        disc[u] = low[u] = timer[0]++;
        for (int[] e : adj[u]) {
            int v = e[0], id = e[1];
            if (id == pe) continue;
            if (disc[v] == -1) {
                dfs(v, id, adj, disc, low, isBridge, timer);
                low[u] = Math.min(low[u], low[v]);
                if (low[v] > disc[u]) isBridge[id] = true;
            } else low[u] = Math.min(low[u], disc[v]);
        }
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}};
        System.out.println(minEdges(6, edges)); // 1
    }
}
```

#### Python

```python
import sys
sys.setrecursionlimit(1_000_000)


def min_edges_to_orient(n, edges):
    adj = [[] for _ in range(n)]
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    disc = [-1] * n
    low = [0] * n
    is_bridge = [False] * len(edges)
    timer = [0]

    def dfs(u, pe):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v, eid in adj[u]:
            if eid == pe:
                continue
            if disc[v] == -1:
                dfs(v, eid)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    is_bridge[eid] = True
            else:
                low[u] = min(low[u], disc[v])

    dfs(0, -1)

    comp = [-1] * n
    c = 0
    for s in range(n):
        if comp[s] != -1:
            continue
        stack = [s]
        comp[s] = c
        while stack:
            u = stack.pop()
            for v, eid in adj[u]:
                if not is_bridge[eid] and comp[v] == -1:
                    comp[v] = c
                    stack.append(v)
        c += 1
    if c == 1:
        return 0
    deg = [0] * c
    for i, (u, v) in enumerate(edges):
        if is_bridge[i]:
            deg[comp[u]] += 1
            deg[comp[v]] += 1
    leaves = sum(1 for d in deg if d == 1)
    return (leaves + 1) // 2


if __name__ == "__main__":
    edges = [(0, 1), (1, 2), (2, 0), (2, 3), (3, 4), (4, 5), (5, 3)]
    print(min_edges_to_orient(6, edges))  # 1
```

---

## Final Tips

- **Lead with the theorem.** State Robbins' precondition (connected + bridgeless) before coding — it shows you understand *when* the problem is even solvable.
- **Fold bridge detection into the orientation DFS.** Don't write three passes; the `low`/`disc` computation does double duty.
- **Track edges by id**, especially if the interviewer mentions parallel roads (multigraph).
- **Always offer to verify** with an SCC check — interviewers love a candidate who self-checks.
- **Know the escalation:** bridges ⇒ per-2ECC orientation; pre-directed edges ⇒ flow (Boesch–Tindell). Mentioning these signals depth even if you don't implement them.
</content>
