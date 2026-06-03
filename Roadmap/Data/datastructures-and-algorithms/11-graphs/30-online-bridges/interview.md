# Online Bridge Finding (Incremental 2-Edge-Connectivity) — Interview Preparation

Online incremental bridge finding is a high-signal interview topic: it forces a candidate to combine three familiar building blocks — union-find, trees/LCA, and amortized small-to-large merging — into one coherent structure, and it has a sharp correctness story (additions only ever destroy bridges) plus a memorable failure mode (it cannot handle deletions). This file is a curated question bank sorted by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions, all verified against a static Tarjan baseline.

---

## Quick-Reference Cheat Sheet

| Operation | Complexity | Notes |
|-----------|------------|-------|
| `add_edge(u, v)` — Case A (redundant) | `O(α(n))` | `find_2ecc(u) == find_2ecc(v)` → return. |
| `add_edge(u, v)` — Case B (new bridge) | amortized `O(log n)` | reroot smaller tree, link, `bridges += 1`. |
| `add_edge(u, v)` — Case C (cycle) | amortized `O(log n)` | LCA + path compress, `bridges -= path_len`. |
| `bridge_count()` | `O(1)` | running counter. |
| `is_bridge(u, v)` | `O(α(n))` | different 2ECC, same component, forest-adjacent. |
| `num_2ecc()` | `O(1)` | second running counter. |
| Total over `m` adds | `O((n+m)α(n) + n log n)` | near-linear. |
| Space | `O(n)` | three int arrays + sizes. |

The three-case dispatch (memorize this):

```text
add_edge(u, v):
    if find_2ecc(u) == find_2ecc(v):      return            # A: redundant inside a 2ECC
    elif find_cc(u)  != find_cc(v):       new bridge        # B: link smaller, bridges += 1
    else:                                 cycle closes       # C: LCA + compress, bridges -= |path|
```

Key facts to recite:

- **Bridge** = edge on no cycle = edge between two different 2ECCs in the same component.
- **Bridge forest** = collapse each 2ECC to a node; remaining edges are exactly the bridges; it is a **forest**.
- **Bridge count** = `(#2ECC) − (#components)` = number of non-root forest nodes.
- **Two DSUs, never one**: `cc` for connectivity, `twoECC` for 2-edge-connectivity (a refinement of `cc`).
- **Additions only**: edges arriving can only *destroy* bridges, never resurrect them — which is why it is near-`α(n)`. Deletions need a fully dynamic structure.

---

## Junior Questions (12 Q&A)

### J1. What is a bridge?
A bridge (cut edge) is an edge whose removal increases the number of connected components — equivalently, an edge that lies on no cycle. In a road network it is the only route to some set of towns: lose it and they are cut off. Bridges are the single points of failure of an undirected graph.

### J2. What does "online incremental" mean here?
"Online" means we answer queries as updates arrive, without seeing the future. "Incremental" means the only update is **adding** an edge — never deleting one. After each addition we can report the current number of bridges in near-constant amortized time, instead of recomputing from scratch.

### J3. How is this different from static bridge finding?
Static bridge finding (Tarjan's DFS, sibling 11-articulation-points-bridges) computes all bridges once in `O(V+E)`. If edges arrive over time and you must answer after each, re-running it costs `O(m(V+E))`. The online structure maintains a summary and updates it locally in amortized `O(α(n))`, giving `O((n+m)α(n))` total.

### J4. What is a 2-edge-connected component?
A maximal set of vertices that stay mutually connected after removing any single edge — i.e. every pair has two edge-disjoint paths between them. Inside a 2ECC there are no bridges. Two vertices in the same 2ECC are robust to any one cable failure between them.

### J5. Why do you keep two disjoint-set structures?
One DSU (`cc`) tracks connected components (coarse), the other (`twoECC`) tracks 2-edge-connected components (fine). A bridge is an edge between two different 2ECCs that are in the same connected component, so you need both questions answered. Using one DSU for both is the classic bug.

### J6. What is the bridge forest?
Collapse every 2ECC into a single super-node. The only edges left are bridges, and they form a forest — one tree per connected component. You store it as a parent array indexed by 2ECC representative. The bridge count equals the number of non-root nodes.

### J7. What happens when you add an edge inside an existing 2ECC?
Nothing. The two endpoints are already 2-edge-connected (already on a cycle together), so the new edge adds a redundant parallel path and changes no equivalence class and no bridge. This is "Case A."

### J8. What happens when you add an edge between two separate components?
The new edge becomes a bridge (it is the only link between the two components, so it lies on no cycle). You link the two bridge-trees and increment the bridge counter by one. This is "Case B."

### J9. What happens when you add an edge inside one component but between different 2ECCs?
It closes a cycle. Every bridge on the tree path between the two endpoints' 2ECCs now lies on that cycle and stops being a bridge. You merge all those 2ECCs into one and subtract that many bridges from the counter. This is "Case C."

### J10. Why can adding an edge only reduce the bridge count, never increase it?
Adding edges only creates cycles, never removes them. A bridge is an edge on no cycle. So an existing non-bridge can never become a bridge by adding edges; only bridges can be "covered" by a new cycle and turned into non-bridges. That monotonicity is why the incremental problem is easy.

### J11. Can this structure handle removing an edge?
No. Deleting an edge can split a 2ECC and turn a non-bridge back into a bridge — a class *split* — and union-find cannot un-merge sets efficiently. Edge deletion is the fully dynamic problem, which needs Euler-tour or link-cut trees and is far more complex.

### J12 (analysis). Why is the total cost near-linear rather than `O(m log n)` everywhere?
Most additions are Case A (a single equality check) or Case C with a short path. Case B's only expensive step is rerooting, and small-to-large caps total rerooting at `O(n log n)`. DSU operations are `O(α(n))` amortized. So the dominant cost is `O((n+m)α(n))` with an `O(n log n)` rerooting term — effectively linear.

---

## Middle Questions (12 Q&A)

### M1. Walk through `add_edge` precisely.
Compute `find_2ecc(u)` and `find_2ecc(v)`; if equal, return (Case A). Else compute `find_cc(u)`, `find_cc(v)`. If different, it is a new bridge (Case B): swap so `u` is in the larger component, `make_root(v)`, set `par[find_2ecc(v)] = find_2ecc(u)`, `bridges += 1`, union the `cc` sets. If the components are equal, it is Case C: find the LCA of the two 2ECCs in the forest and contract the path, subtracting one bridge per edge contracted.

### M2. Why does Case C subtract exactly the path length?
The new edge creates a cycle that contains exactly the bridge-forest path `P` between the two endpoints' 2ECCs, plus the new edge. Every edge on `P` is now on that cycle (no longer a bridge); no edge off `P` is touched. So you subtract precisely `|P|` and merge the `|P|+1` 2ECCs on `P` into one.

### M3. Why do you reroot the *smaller* tree in Case B?
Rerooting a tree of size `k` costs `O(k)`. If you always reroot the smaller tree, each vertex is rerooted only when its component at least doubles, so at most `O(log n)` times per vertex — total `O(n log n)`. Rerooting the larger tree makes a single addition `O(n)` and the whole run quadratic.

### M4. What invariant ties the two DSUs together?
The 2ECC partition refines the connectivity partition: `find_cc(find_2ecc(v)) == find_cc(v)` for all `v`. Two vertices in the same 2ECC are always in the same component; the converse fails (a bridge separates connected vertices into different 2ECCs).

### M5. How do you check whether a specific edge is currently a bridge?
For an edge `(u,v)` that exists in the graph: it is a bridge iff `find_2ecc(u) != find_2ecc(v)`, `find_cc(u) == find_cc(v)`, and the two 2ECCs are adjacent in the bridge forest (one is the other's parent). All in `O(α(n))`.

### M6. Why must you read forest parents through `find_2ecc`?
When 2ECCs merge (Case C), `par[]` entries point at vertices that are no longer their 2ECC's representative. Reading `par[v]` raw follows a stale pointer. Always compute `parent_of(v) = find_2ecc(par[v])` so the parent is the *current* representative.

### M7. How does this compare to maintaining a block-cut tree?
The bridge forest (2ECCs joined by bridges) is the *edge*-connectivity analogue of the block-cut tree (biconnected components joined by articulation points, the *vertex*-connectivity world). Both collapse robust sub-structures into nodes and keep only the fragile connectors. The incremental maintenance idea transfers, but the vertex version's shared cut vertices make the bookkeeping harder.

### M8. What is the cost of an LCA query and does it dominate?
Each LCA walk costs `O(|path|)`. Since each tree edge is contracted at most once over the whole run, total LCA work is `O(n α(n))` — dominated by the rerooting and DSU terms. So LCA does not change the asymptotics.

### M9. When would you just rebuild with static Tarjan instead?
If the graph is fixed, or you query only a few times, the static `O(V+E)` DFS is simpler and fast enough. Also, under churn with occasional deletions, a periodic static rebuild of the current edge set is the pragmatic way to correct the incremental structure's additions-only drift.

### M10. How do you maintain the number of 2ECCs?
Start `num2ecc = n` (each vertex its own 2ECC). Case A: unchanged. Case B: unchanged (a new bridge does not fuse 2ECCs). Case C: decrement once per contracted edge, since each fuses two 2ECCs into one. The bridge count and 2ECC count move together only in Case C.

### M11. What are the three mutually exclusive, exhaustive cases?
A: same 2ECC (redundant). B: different components (new bridge). C: same component, different 2ECC (cycle). Every edge addition is exactly one of these; getting the order right (check A first) prevents double-counting and negative counts.

### M12 (analysis). Why does DSU alone not suffice for Case C?
DSU answers "same set?" not "what is the path between two nodes?". Case C must identify *which* tree edges to destroy — a forest-path query. So you need the explicit bridge forest (parent array) to walk the path; the 2ECC DSU only records the *result* of the contraction, not the path itself.

---

## Senior Questions (10 Q&A)

### S1. Compare incremental, decremental, and fully dynamic 2-edge-connectivity.
Incremental (additions only) is near-`α(n)` amortized because merges are monotone and each tree edge dies once. Decremental (deletions only) and fully dynamic are far harder: deletions split classes, which DSU cannot do; you need Euler-tour trees or the Holm–de Lichtenberg–Thorup structure at `O(log² n)` amortized, matching an `Ω(log n)` cell-probe lower bound.

### S2. How would you deploy this as a live network reliability monitor?
Feed link-up events to a single-writer instance; publish the bridge count atomically for lock-free dashboards. Crucially, model link-*down* events as triggers for a periodic static reconciliation (static Tarjan over the current live edge set), because the additions-only structure silently under-counts after a deletion. Alert on the bridge ratio (`bridges/edges`) and on reconcile drift.

### S3. How do you make updates concurrency-safe?
The forest mutation (reroot, link, contract) is not naturally concurrent and cannot be lock-striped (one addition may touch a long path). Use a single writer behind a mutex. Shard by connected component only if cross-component joins are rare; a cross-shard join needs both locks and a cross-structure reroot.

### S4. How do you survive a process restart?
Keep an append-only edge log plus periodic snapshots of the three int arrays. On restart, load the latest snapshot and replay the log tail. Replay is deterministic because every operation is order-dependent and side-effect-free beyond the arrays. Snapshot cadence bounds replay time.

### S5. What is the worst-case latency per addition and how do you bound it?
The rerooting in Case B is `O(k)` for the smaller component of size `k` — a spike if `k` is large, even though amortized it is `O(log n)`. Bound it by sharding to cap component size, by absorbing spikes behind an async queue, or by switching the forest to link-cut trees for `O(log n)` worst-case per op at higher constants.

### S6. Why is "additions only" sometimes a correctness bug, not just a limitation?
If you deploy it where links also fail (steady-state operations) and call no remove method, it keeps reporting the pre-failure bridge count — too low, a silent staleness that no latency metric catches. The fix is reconciliation against static ground truth plus a `reconcile_drift` alert.

### S7. How would you export failover groups to downstream systems?
The 2ECC DSU *is* the failover grouping: two nodes in the same 2ECC tolerate any single internal link failure. Materialize a node→group map by calling `find_2ecc` per node, recomputed lazily or on each reconciliation, and ship it to routing/alerting layers.

### S8. When do link-cut trees beat the parent-array implementation?
When you need a worst-case per-operation bound (real-time SLA) rather than amortized — link-cut trees give `O(log n)` amortized with no `O(n)` rerooting spike. For batch/offline builds the parent array wins because its constants are 5–10× smaller and most ops are cheap.

### S9. How do you test this structure in CI?
Property-test against static Tarjan on random edge sequences: after every addition, assert the online bridge count equals the static recomputation, and assert the refinement invariant `find_cc(find_2ecc(v)) == find_cc(v)`. This is exactly the verification that catches two-DSU mix-ups and counter drift.

### S10 (analysis). Why is the incremental problem fundamentally easier than the fully dynamic one?
Monotonicity. Additions only coarsen both partitions (classes merge), each tree edge is destroyed at most once, and union-find handles merges in `α(n)`. Deletions refine partitions (classes split), which union-find cannot reverse, forcing a hierarchy of spanning forests and the `O(log² n)` machinery. The gap is provable: `Ω(log n)` per op for fully dynamic, near-`α(n)` for incremental.

---

## Professional Questions (8 Q&A)

### P1. Prove the bridge forest is actually a forest.
Collapsing each 2ECC preserves connectivity, so each component maps to a connected subgraph. If the quotient had a cycle of 2ECC nodes, you could route a closed walk in the original graph through those nodes (each 2ECC has two edge-disjoint internal paths), placing every quotient edge on a cycle — but quotient edges are bridges, which lie on no cycle. Contradiction; the quotient is acyclic, hence a forest.

### P2. Prove the bridge counter stays exact.
The number of bridges equals the number of forest edges, which equals `#2ECC − #components` (a forest on `N` nodes with `c` trees has `N−c` edges). Case B adds one node-to-node link (`+1` edge, `+1` bridge); Case C contracts a path of `|P|` edges into one node (`−|P|` edges, `−|P|` bridges). The increments match the formula at every step, so the running counter equals the static recomputation.

### P3. Derive the total complexity.
DSU work: `O((n+m)α(n))`. Case-C contractions: each tree edge dies once, so `O(n α(n))` total. Rerooting under small-to-large: each vertex rerooted `O(log n)` times, `O(n log n)` total. LCA walks: `Σ|P| ≤ n−1`, so `O(n α(n))`. Sum: `O((n+m)α(n) + n log n)` amortized.

### P4. Why does small-to-large give `O(log n)` rerootings per vertex?
A vertex is rerooted only when its component is the *smaller* side of a merge; afterward its component at least doubles. Size can double at most `log₂ n` times before reaching `n`, so each vertex is rerooted at most `log₂ n` times. Charging `O(1)` per vertex per reroot gives `O(n log n)` aggregate.

### P5. How does this relate to Westbrook–Tarjan?
Westbrook & Tarjan (1992) gave incremental 2-edge- and biconnectivity in `O(m α(m,n))` total. The bridge-forest + two-DSU structure is a concrete realization; the small-to-large parent-array version adds an `O(n log n)` rerooting term, while a link-cut-tree forest matches the `O(α)`-ish amortized bound at higher constants.

### P6. Could you maintain 3-edge-connected components online the same way?
Not directly. The bridge forest works because collapsing 2ECCs yields a *forest*. Collapsing along higher edge-connectivity does not yield a forest, so the parent-array + LCA technique does not transfer. Online 3-edge-connectivity is substantially less understood and an active research area.

### P7. How would you parallelize a batch of additions?
Hard, because additions are order-dependent (a reroot/contract depends on the current forest). Approaches: partition by connected component (independent components parallelize trivially); process within a component via a parallel union-find with deferred forest contraction; or use bulk-parallel dynamic-graph frameworks. Work-efficiency near `O((n+m)α)` with good parallelism is open.

### P8 (analysis). Why is the fully dynamic lower bound `Ω(log n)` but incremental is not bounded so?
Pătraşcu–Demaine (2006) proved `Ω(log n)` per-operation cell-probe for fully dynamic connectivity, which inherits to 2-edge-connectivity. That bound exploits the need to handle *both* merges and splits adversarially. The incremental problem forbids splits, so the adversary is far weaker; union-find's `α(n)` merges suffice and no `Ω(log n)` barrier applies.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose an incremental structure over recomputation.
Look for a structured story: the problem (e.g. "report network fragility after each new link"), the alternative (re-run static bridge DFS each time, `O(m(n+m))`), the criterion (latency budget per event), and why maintaining a bridge forest won. Strong answers cite the measured speedup and acknowledge the additions-only constraint as a deliberate trade-off, not an oversight.

### B2. Design a network reliability dashboard that shows single points of failure in real time.
Online bridge structure is the core. Discuss: ingesting link-up events to a single writer; publishing the bridge count atomically; the bridge-ratio fragility metric; and — the key senior point — handling link-*down* events via periodic static reconciliation because the structure is additions-only. Cover durability (edge log + snapshot) and multi-region failover.

### B3. A teammate proposes using one union-find for the whole thing. How do you respond?
Explain that connectivity and 2-edge-connectivity are *different* equivalence relations: one DSU cannot distinguish "connected" from "robust to one failure." You need `cc` and `twoECC` with the refinement invariant. Use it as a teaching moment about modeling the right equivalence relation rather than reaching for the familiar tool.

### B4. The bridge count looks wrong in production. How do you investigate?
Add a property check that reconciles against static Tarjan on the current edge set; log drift. Check for: a deletion path that the additions-only structure cannot model (most likely), a two-DSU mix-up after a refactor, a raw `par[]` read that should have gone through `find_2ecc`, or rerooting the larger tree. Reproduce with the captured edge sequence; the bug is almost always one of these five.

### B5. A junior asks "why not just recompute bridges each time — it's simpler?" How do you answer?
Recomputation is `O(m(n+m))` — fine for a few thousand edges, catastrophic at a million. The incremental structure is `O((n+m)α(n))`, effectively linear, and gives an `O(1)` bridge count at any instant. The trade-off is added implementation complexity and the additions-only limitation. Choose by scale and update frequency, not by which is easier to write.

---

## Coding Challenges

### Challenge 1: Count Bridges After Each Addition

**Problem.** You are given `n` vertices and a sequence of `m` undirected edges added one at a time. After each addition, output the current number of bridges in the graph.

**Example.**

```text
n = 6
add (0,1) -> 1
add (1,2) -> 2
add (2,0) -> 0     # triangle closes, both bridges vanish
add (2,3) -> 1
add (3,4) -> 2
add (4,5) -> 3
add (5,3) -> 1     # second triangle closes
```

**Constraints.** `1 <= n <= 2·10^5`, `1 <= m <= 5·10^5`, endpoints in `[0, n)`.

**Brute force.** Re-run Tarjan's bridge DFS after each addition: `O(m(n+m))`. Correct but quadratic; times out past a few thousand edges.

**Optimal.** Maintain two DSUs and a bridge forest; dispatch on the three cases. Amortized `O((n+m)α(n) + n log n)`; `O(1)` per-step output.

**Go.**

```go
package main

import "fmt"

type OB struct {
	cc, te, par, sz []int
	bridges         int
}

func NewOB(n int) *OB {
	o := &OB{cc: make([]int, n), te: make([]int, n), par: make([]int, n), sz: make([]int, n)}
	for i := 0; i < n; i++ {
		o.cc[i], o.te[i], o.par[i], o.sz[i] = i, i, -1, 1
	}
	return o
}
func (o *OB) fc(x int) int { for o.cc[x] != x { o.cc[x] = o.cc[o.cc[x]]; x = o.cc[x] }; return x }
func (o *OB) ft(x int) int { for o.te[x] != x { o.te[x] = o.te[o.te[x]]; x = o.te[x] }; return x }
func (o *OB) par2(v int) int {
	if o.par[v] == -1 {
		return -1
	}
	return o.ft(o.par[v])
}
func (o *OB) makeRoot(u int) {
	u = o.ft(u)
	c := -1
	for u != -1 {
		p := o.par2(u)
		o.par[u] = c
		c = u
		u = p
	}
}
func (o *OB) merge(u, v int) {
	a, b := o.ft(u), o.ft(v)
	anc := map[int]bool{}
	for t := a; t != -1; t = o.par2(t) {
		anc[t] = true
	}
	lca := -1
	for t := b; t != -1; t = o.par2(t) {
		if anc[t] {
			lca = t
			break
		}
	}
	for _, s := range []int{a, b} {
		for x := s; x != lca; {
			p := o.par2(x)
			o.bridges--
			o.te[o.ft(x)] = lca
			x = p
		}
	}
}
func (o *OB) Add(u, v int) {
	if o.ft(u) == o.ft(v) {
		return
	}
	cu, cv := o.fc(u), o.fc(v)
	if cu != cv {
		if o.sz[cu] < o.sz[cv] {
			u, v, cu, cv = v, u, cv, cu
		}
		o.makeRoot(v)
		o.par[o.ft(v)] = o.ft(u)
		o.bridges++
		o.cc[cv] = cu
		o.sz[cu] += o.sz[cv]
	} else {
		o.merge(u, v)
	}
}

func main() {
	o := NewOB(6)
	for _, e := range [][2]int{{0, 1}, {1, 2}, {2, 0}, {2, 3}, {3, 4}, {4, 5}, {5, 3}} {
		o.Add(e[0], e[1])
		fmt.Println(o.bridges)
	}
}
```

**Java.**

```java
import java.util.*;

public class CountBridges {
    int[] cc, te, par, sz;
    int bridges = 0;
    CountBridges(int n) {
        cc=new int[n]; te=new int[n]; par=new int[n]; sz=new int[n];
        for(int i=0;i<n;i++){cc[i]=i;te[i]=i;par[i]=-1;sz[i]=1;}
    }
    int fc(int x){ while(cc[x]!=x){cc[x]=cc[cc[x]];x=cc[x];} return x; }
    int ft(int x){ while(te[x]!=x){te[x]=te[te[x]];x=te[x];} return x; }
    int par2(int v){ return par[v]==-1?-1:ft(par[v]); }
    void makeRoot(int u){ u=ft(u); int c=-1; while(u!=-1){int p=par2(u);par[u]=c;c=u;u=p;} }
    void merge(int u,int v){
        int a=ft(u), b=ft(v);
        Set<Integer> anc=new HashSet<>();
        for(int t=a;t!=-1;t=par2(t)) anc.add(t);
        int lca=-1; for(int t=b;t!=-1;t=par2(t)){ if(anc.contains(t)){lca=t;break;} }
        for(int s: new int[]{a,b}) for(int x=s;x!=lca;){ int p=par2(x); bridges--; te[ft(x)]=lca; x=p; }
    }
    void add(int u,int v){
        if(ft(u)==ft(v)) return;
        int cu=fc(u), cv=fc(v);
        if(cu!=cv){
            if(sz[cu]<sz[cv]){int t=u;u=v;v=t;t=cu;cu=cv;cv=t;}
            makeRoot(v); par[ft(v)]=ft(u); bridges++; cc[cv]=cu; sz[cu]+=sz[cv];
        } else merge(u,v);
    }
    public static void main(String[] a){
        CountBridges o=new CountBridges(6);
        for(int[] e: new int[][]{{0,1},{1,2},{2,0},{2,3},{3,4},{4,5},{5,3}}){
            o.add(e[0],e[1]); System.out.println(o.bridges);
        }
    }
}
```

**Python.**

```python
class OB:
    def __init__(self, n):
        self.cc=list(range(n)); self.te=list(range(n)); self.par=[-1]*n; self.sz=[1]*n; self.bridges=0
    def fc(self,x):
        while self.cc[x]!=x: self.cc[x]=self.cc[self.cc[x]]; x=self.cc[x]
        return x
    def ft(self,x):
        while self.te[x]!=x: self.te[x]=self.te[self.te[x]]; x=self.te[x]
        return x
    def par2(self,v): return -1 if self.par[v]==-1 else self.ft(self.par[v])
    def make_root(self,u):
        u=self.ft(u); c=-1
        while u!=-1:
            p=self.par2(u); self.par[u]=c; c=u; u=p
    def merge(self,u,v):
        a,b=self.ft(u),self.ft(v); anc=set(); t=a
        while t!=-1: anc.add(t); t=self.par2(t)
        lca,t=-1,b
        while t!=-1:
            if t in anc: lca=t; break
            t=self.par2(t)
        for s in (a,b):
            x=s
            while x!=lca:
                p=self.par2(x); self.bridges-=1; self.te[self.ft(x)]=lca; x=p
    def add(self,u,v):
        if self.ft(u)==self.ft(v): return
        cu,cv=self.fc(u),self.fc(v)
        if cu!=cv:
            if self.sz[cu]<self.sz[cv]: u,v,cu,cv=v,u,cv,cu
            self.make_root(v); self.par[self.ft(v)]=self.ft(u); self.bridges+=1
            self.cc[cv]=cu; self.sz[cu]+=self.sz[cv]
        else:
            self.merge(u,v)

if __name__=="__main__":
    o=OB(6)
    for u,v in [(0,1),(1,2),(2,0),(2,3),(3,4),(4,5),(5,3)]:
        o.add(u,v); print(o.bridges)
```

**Follow-up.** What if you must also answer "is edge `(a,b)` a bridge right now?" Add `is_bridge` (Challenge 2). What if edges can be removed? You can no longer use this structure — explain the jump to fully dynamic.

---

### Challenge 2: Is This Edge a Bridge Online?

**Problem.** Support two operations interleaved: `add(u, v)` adds an edge, and `query(u, v)` returns whether the (already-added) edge `(u, v)` is currently a bridge.

**Example.**

```text
add(0,1); query(0,1) -> true     # only link, it's a bridge
add(1,2); add(2,0); query(0,1) -> false   # triangle, no longer a bridge
```

**Constraints.** Queries only on edges that have been added. `n, m` up to `2·10^5`.

**Brute force.** For each query, run Tarjan and check membership: `O(n+m)` per query.

**Optimal.** Reuse the structure from Challenge 1. An edge `(u,v)` is a bridge iff `find_2ecc(u) != find_2ecc(v)` (different 2ECCs), `find_cc(u) == find_cc(v)` (same component), and they are forest-adjacent. `O(α(n))` per query.

**Go.**

```go
func (o *OB) IsBridge(u, v int) bool {
	a, b := o.ft(u), o.ft(v)
	if a == b || o.fc(u) != o.fc(v) {
		return false
	}
	return o.par2(a) == b || o.par2(b) == a
}
```

**Java.**

```java
boolean isBridge(int u, int v) {
    int a = ft(u), b = ft(v);
    if (a == b || fc(u) != fc(v)) return false;
    return par2(a) == b || par2(b) == a;
}
```

**Python.**

```python
def is_bridge(self, u, v):
    a, b = self.ft(u), self.ft(v)
    if a == b or self.fc(u) != self.fc(v):
        return False
    return self.par2(a) == b or self.par2(b) == a
```

**Follow-up.** Why is forest-adjacency required and not just "different 2ECC, same component"? Because two 2ECCs may be in the same tree but several bridges apart; the *edge* `(u,v)` is a bridge only if it is the specific forest edge between adjacent 2ECCs.

---

### Challenge 3: Number of 2-Edge-Connected Components Online

**Problem.** After each `add(u, v)`, output the current number of 2-edge-connected components.

**Example.**

```text
n = 4
add(0,1) -> 4    # bridge, no 2ECC fusion: still 4 singletons
add(1,2) -> 4
add(2,0) -> 2    # {0,1,2} fuse into one 2ECC; plus vertex 3 → 2 total
```

**Constraints.** `n, m` up to `2·10^5`.

**Optimal.** Track `num2ecc`, starting at `n`. Decrement once per contracted edge in Case C (each fuses two 2ECCs). Cases A and B leave it unchanged.

**Go.**

```go
// add a num2ecc field initialized to n; inside merge(), after bridges--:
//   o.num2ecc--
// Cases A and B do not touch num2ecc.
```

**Java.**

```java
// int num2ecc = n; in merge(), alongside bridges--: num2ecc--;
```

**Python.**

```python
# self.num2ecc = n; inside merge loop, alongside self.bridges -= 1: self.num2ecc -= 1
```

**Follow-up.** Relate `num2ecc` and `bridges`: within one connected component, `bridges = num2ecc_in_component − 1` (it is a tree). Globally, `bridges = num2ecc − num_components`. This identity is the cheapest correctness self-check you can add.

---

## Common Pitfalls in Interviews

- **Using one DSU.** Connectivity and 2-edge-connectivity are different equivalence relations. Declare both `cc` and `twoECC`.
- **Reading `par[v]` raw.** After 2ECCs merge, the stored parent is stale; always go through `find_2ecc`.
- **Rerooting the larger tree.** Kills the amortized bound; always reroot the smaller (compare `cc_size`).
- **Wrong case order.** Check "same 2ECC?" (A) before the component test, or you risk double-counting / negative counts.
- **Subtracting one total in Case C.** You subtract one *per bridge on the path*, inside the contraction loop.
- **Claiming it supports deletion.** It does not — say so and name the fully dynamic alternative.
- **Forgetting forest-adjacency in `is_bridge`.** "Different 2ECC, same component" is necessary but not sufficient for a *specific* edge to be the bridge.

---

## Rapid-Fire Review (memorize before the interview)

- **Bridge** = edge on no cycle = edge between two different 2ECCs in the same component.
- **Three cases:** A (same 2ECC → skip), B (different component → +1 bridge, reroot smaller), C (same component, different 2ECC → −|path| bridges, contract to LCA).
- **Two DSUs:** `cc` (connectivity), `twoECC` (2-edge-connectivity, refines `cc`).
- **Bridge forest** = collapse each 2ECC to a node; it is a forest; edges are exactly the bridges.
- **Count identity:** `bridges = #2ECC − #components`.
- **Complexity:** `O((n+m)α + n log n)` total; `O(1)` count; `Θ(n)` space.
- **Why easy:** additions only destroy bridges (monotone); each tree edge dies once.
- **Why no deletes:** un-union is not a DSU op; deletions split classes; needs fully dynamic (`Ω(log n)`).
- **Verify:** property-test against static Tarjan after every edge.
- **One bug to avoid:** reading `par[v]` raw — always go through `find_2ecc`.

## What Interviewers Are Really Testing

A question on online incremental bridges is not about reciting an API — it is about composition and judgment. First, can you assemble three known tools (union-find, trees/LCA, small-to-large) into one structure and keep their roles straight? The "two DSUs, never one" discipline is the litmus test: a candidate who collapses connectivity and 2-edge-connectivity into a single union-find has not understood that they are different equivalence relations. Second, can you reason about *why* the incremental case is tractable — the monotonicity argument that additions only destroy bridges, that each tree edge dies once, that small-to-large bounds rerooting — and contrast it sharply with the fully dynamic problem's `Ω(log n)` barrier? Third, can you handle the corners and the production realities: the additions-only limitation as a *correctness* hazard (silent under-counting after a deletion), the rerooting latency spike, the need for reconciliation against a static baseline, and the choice between a parent array and link-cut trees? You do not need to derive every proof on the spot, but you should know the bridge forest is a forest and why, know the bridge count equals `#2ECC − #components`, and be able to verify your structure against static Tarjan — the single most convincing thing you can say is "I'd property-test it against a static recomputation after every edge." That answer signals a candidate who ships correct dynamic-graph code rather than one who memorized a template.
