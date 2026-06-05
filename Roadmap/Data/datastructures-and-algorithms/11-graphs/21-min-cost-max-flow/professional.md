# Min-Cost Max-Flow — Professional Level

> **One-line summary:** The professional file gives the formal theory: the precise problem definition, the proof that **augmenting along a cheapest path preserves min-cost optimality** (the SSP correctness theorem), the **reduced-cost / potential invariant proof** that keeps residual costs non-negative, the **cycle-canceling optimality criterion** (a flow is min-cost iff its residual graph has no negative-cost cycle), complexity analysis, the assignment/Hungarian connection, and a survey of average-case, cache, space-time, and open problems.

---

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [SSP Correctness — Cheapest-Path Augmentation Preserves Optimality](#2-ssp-correctness--cheapest-path-augmentation-preserves-optimality)
3. [The Reduced-Cost / Potential Invariant — Proof](#3-the-reduced-cost--potential-invariant--proof)
4. [Cycle-Canceling Optimality Criterion — Proof](#4-cycle-canceling-optimality-criterion--proof)
5. [Complexity Analysis](#5-complexity-analysis)
6. [The Assignment Problem and Hungarian Connection](#6-the-assignment-problem-and-hungarian-connection)
7. [Cache and Memory-Hierarchy Behavior](#7-cache-and-memory-hierarchy-behavior)
8. [Average-Case and Randomized Analysis](#8-average-case-and-randomized-analysis)
9. [Space-Time Trade-offs](#9-space-time-trade-offs)
10. [Comparison with Alternatives (asymptotics + constants)](#10-comparison-with-alternatives-asymptotics--constants)
11. [Open Problems and Summary](#11-open-problems-and-summary)

---

## 1. Formal Definition

Let `G = (V, E)` be a directed graph with source `s ∈ V`, sink `t ∈ V`, a capacity function `u: E → ℤ≥0`, and a cost function `c: E → ℤ`. A **flow** is a function `f: E → ℤ≥0` satisfying:

- **Capacity:** `0 ≤ f(e) ≤ u(e)` for every edge `e`.
- **Conservation:** for every `v ∈ V \ {s, t}`, inflow equals outflow: `Σ_{e into v} f(e) = Σ_{e out of v} f(e)`.

The **value** of the flow is `|f| = Σ_{e out of s} f(e) − Σ_{e into s} f(e)`. The **cost** is `cost(f) = Σ_{e ∈ E} c(e) · f(e)`.

**Min-Cost Max-Flow (MCMF):** among all flows `f` of **maximum value** `F*`, find one minimizing `cost(f)`.

**Min-Cost Flow of value `k`:** among all flows of value exactly `k` (assuming `k ≤ F*`), find one minimizing `cost(f)`.

**Residual graph `G_f`.** For each edge `e = (u,v)` with flow `f(e)`:
- a **forward residual edge** `(u,v)` with residual capacity `u(e) − f(e)` and cost `c(e)`;
- a **backward residual edge** `(v,u)` with residual capacity `f(e)` and cost `−c(e)`.

We assume **integer** capacities and costs and **no negative-cost cycle in `G`** (the input), so a finite min-cost flow exists. (Negative cycles in the *input* make cost unbounded below for circulations; they are handled by cycle-canceling on a feasible flow, Section 4.)

**Define `Φ(x)` = the minimum cost over all flows of value `x`.** A central structural fact: **`Φ` is a convex, piecewise-linear function of `x`** on `[0, F*]`. This convexity is the engine behind SSP — the marginal cost of the next unit of flow is non-decreasing.

---

## 2. SSP Correctness — Cheapest-Path Augmentation Preserves Optimality

**Theorem (SSP optimality).** Let `f` be a min-cost flow of value `x` (i.e. `cost(f) = Φ(x)`). Let `P` be a **shortest** (minimum total cost) `s→t` path in the residual graph `G_f`, and let `f'` be obtained by augmenting `f` along `P` by `δ > 0` units. Then `f'` is a min-cost flow of value `x + δ`, i.e. `cost(f') = Φ(x + δ)`.

**Proof.** We use the residual-cycle characterization (proved in Section 4): *a flow `g` of value `y` is min-cost (= `Φ(y)`) if and only if `G_g` contains no negative-cost cycle.*

By hypothesis `f` is min-cost of value `x`, so `G_f` has no negative cycle. We must show `G_{f'}` has no negative cycle either.

Choose potentials `π(v) =` shortest-path distance from `s` to `v` in `G_f`. Since `G_f` has no negative cycle, these distances are well-defined, and for every residual edge `(a,b)` in `G_f` the triangle inequality gives `π(b) ≤ π(a) + c(a,b)`, i.e. the **reduced cost** `c_π(a,b) = c(a,b) + π(a) − π(b) ≥ 0`.

Augmenting along the shortest path `P` only changes residual edges *along* `P`. An edge `(a,b)` lies on shortest path `P` iff it is "tight": `c_π(a,b) = 0`. Pushing `δ` along `P` may **saturate** some forward residual edges of `P` (removing them) and **create** their reverse edges `(b,a)`. A created reverse edge has reduced cost `c_π(b,a) = −c(a,b) + π(b) − π(a) = −c_π(a,b) = −0 = 0 ≥ 0`. Every other residual edge is unchanged and still has `c_π ≥ 0`.

Therefore in `G_{f'}` **all residual edges have `c_π ≥ 0`**. Now consider any cycle `C` in `G_{f'}`. Its reduced-cost length telescopes: `Σ_{(a,b)∈C} c_π(a,b) = Σ_{(a,b)∈C} c(a,b)` (the potential terms cancel around a cycle). The left side is a sum of non-negative numbers, hence `≥ 0`, so the real cost of `C` is `≥ 0`. Thus `G_{f'}` has **no negative cycle**, so by the characterization `f'` is min-cost of value `x + δ = |f'|`. ∎

**Corollary (SSP terminates correctly).** Starting from the zero flow (trivially `Φ(0) = 0`, and `G_{f=0} = G` has no negative cycle by assumption) and repeatedly augmenting along shortest residual paths, every intermediate flow is min-cost for its value, and the final flow (when no `s→t` residual path exists) is the **min-cost maximum flow**. With integer capacities each augmentation increases the value by ≥ 1, so there are at most `F*` augmentations and the process terminates. ∎

**Corollary (monotone path costs / convexity).** The cost of successive shortest augmenting paths is **non-decreasing**: `dist_{f'}(t) ≥ dist_f(t)`. Because `c_π ≥ 0` in `G_{f'}`, the new shortest distance to `t` is at least the old one. This is exactly the convexity of `Φ`: the marginal cost per unit of flow never decreases. It justifies early-stopping for min-cost-of-value-`k`.

---

## 3. The Reduced-Cost / Potential Invariant — Proof

This section formalizes why Dijkstra remains valid throughout SSP despite negative reverse edges.

**Setup.** Maintain potentials `h: V → ℤ`. The **reduced cost** of residual edge `(u,v)` is `c_h(u,v) = c(u,v) + h(u) − h(v)`.

**Invariant `I`:** *for every edge `(u,v)` present in the current residual graph, `c_h(u,v) ≥ 0`.*

**Lemma 1 (reduced cost preserves shortest paths).** For any `s→v` path, its reduced length equals its real length plus `h(s) − h(v)`, a quantity independent of the path. Hence a path is shortest under `c_h` iff it is shortest under `c`. **Proof:** telescoping (Section 2 of [`middle.md`](./middle.md)); the intermediate `h` terms cancel. ∎

**Lemma 2 (establishing `I`).** If we set `h(v) = ` shortest real-cost distance `s→v` in the current residual graph (finite because there is no negative cycle), then `I` holds. **Proof:** the shortest-path triangle inequality `h(v) ≤ h(u) + c(u,v)` rearranges to `c(u,v) + h(u) − h(v) ≥ 0`. ∎

**Theorem (invariant maintenance).** Suppose `I` holds before an SSP iteration. Run Dijkstra on reduced costs `c_h` to get `dist(v)` (= reduced shortest distance `s→v`, all `≥ 0` so Dijkstra is valid). Update `h(v) ← h(v) + dist(v)` for all reachable `v`, then augment along the shortest path. Then `I` holds again afterward.

**Proof.** First, after the potential update, for any residual edge `(u,v)` present *before* augmentation: Dijkstra's correctness gives `dist(v) ≤ dist(u) + c_h(u,v) = dist(u) + c(u,v) + h(u) − h(v)`. Let `h'(x) = h(x) + dist(x)`. Then
```
c_{h'}(u,v) = c(u,v) + h'(u) − h'(v)
            = c(u,v) + h(u) + dist(u) − h(v) − dist(v)
            = c_h(u,v) + dist(u) − dist(v)
            ≥ 0
```
by the inequality above. So every pre-existing residual edge satisfies `I` under `h'`.

Second, augmentation only *creates* reverse edges `(v,u)` of edges `(u,v)` that were on the shortest path, i.e. tight: `dist(v) = dist(u) + c_h(u,v)`, equivalently `c_{h'}(u,v) = 0`. The created reverse edge has `c_{h'}(v,u) = −c_{h'}(u,v) = 0 ≥ 0`. (Unreachable vertices keep their `h` unchanged; edges among them are untouched and still satisfy `I` since reaching them would contradict unreachability.) Hence `I` holds after the iteration. ∎

**Consequence.** Because `I` is established once (Lemma 2, via the Bellman-Ford initialization) and maintained every iteration (Theorem), **Dijkstra is valid on every iteration of SSP**. The Bellman-Ford pre-pass is needed only when the *input* has negative-cost edges; if all `c(e) ≥ 0` then `h ≡ 0` already satisfies `I` at the zero flow.

---

## 4. Cycle-Canceling Optimality Criterion — Proof

**Theorem (Klein, 1967).** A feasible flow `f` of value `y` has minimum cost among all flows of value `y` **if and only if** the residual graph `G_f` contains **no negative-cost cycle**.

**Proof.**

**(⇒ necessity)** Suppose `G_f` has a negative-cost cycle `C` with residual bottleneck `δ > 0`. Pushing `δ` units around `C` keeps flow conservation at every vertex (a cycle adds nothing to any net balance) and does **not** change the flow *value* `y` (no net flow across the `s`-cut changes). But it changes the cost by `δ · cost(C) < 0`. So `f` was not min-cost — contradiction. Hence a min-cost flow has no negative residual cycle.

**(⇐ sufficiency)** Suppose `G_f` has no negative cycle; we show `f` is min-cost of value `y`. Let `f*` be any flow of value `y`. Consider the difference `g = f* − f` (as a flow in the residual graph `G_f`; where `f* > f` use forward residual, where `f* < f` use backward residual). Since both have the same value `y`, `g` is a **circulation** (zero net value), and any circulation decomposes into a set of **cycles** in `G_f`. The cost difference is
```
cost(f*) − cost(f) = cost(g) = Σ over decomposition cycles  (flow on cycle) · cost(cycle).
```
Every cycle in `G_f` has cost `≥ 0` (no negative cycle) and flows are `≥ 0`, so `cost(f*) − cost(f) ≥ 0`, i.e. `cost(f) ≤ cost(f*)`. As `f*` was arbitrary, `f` is min-cost. ∎

**Cycle-canceling algorithm.** Compute *any* maximum flow (e.g. via Dinic, ignoring cost). While `G_f` contains a negative cycle (detect via Bellman-Ford / SPFA), cancel it by pushing its bottleneck. By the theorem, when no negative cycle remains, `f` is the **min-cost maximum flow**.

**Termination & complexity.** Each cancellation strictly decreases integer cost, bounded below, so it terminates. The number of iterations is pseudo-polynomial in general; choosing the **minimum-mean cycle** to cancel (Goldberg–Tarjan) yields a strongly polynomial `O(V·E² · min(log(V·C), E·log V))` bound. Plain "any negative cycle" is `O(V·E · C · U)`-style pseudo-polynomial.

**Duality with SSP.** SSP and cycle-canceling are the two faces of the same optimality criterion: SSP *maintains* "no negative residual cycle" as an invariant while *growing* flow value; cycle-canceling *restores* it at *fixed* (maximum) flow value. Both terminate exactly when no negative residual cycle exists.

---

## 5. Complexity Analysis

Let `V = |vertices|`, `E = |edges|`, `F = ` max-flow value (or target `k`), `C = ` max `|cost|`, `U = ` max capacity.

| Algorithm | Time | Derivation |
|-----------|------|-----------|
| SSP + Bellman-Ford/SPFA | `O(V · E · F)` | ≤ `F` augmentations × `O(V·E)` per shortest path. |
| SSP + Dijkstra (binary heap) + potentials | `O(F · E · log V)` | ≤ `F` augmentations × `O(E log V)` per Dijkstra. |
| SSP + Dijkstra (Fibonacci heap) | `O(F · (E + V log V))` | improved heap constant. |
| Cycle-canceling (arbitrary cycle) | pseudo-poly `O(V·E·C·U)`-ish | each cancel reduces cost by ≥ 1. |
| Minimum-mean-cycle canceling | `O(V·E² log V)` (strongly poly) | Goldberg–Tarjan. |
| Cost-scaling (push-relabel) | `O(V² E log(V·C))` | scaling on ε-optimality. |
| Network simplex | empirically fastest; poly bounds delicate | pivot-based. |

**Bounded-`F` regimes.** For **unit-capacity** networks (bipartite matching, edge-disjoint paths), `F ≤ V`, so SSP+Dijkstra is `O(V·E·log V)`. For the **assignment problem** on `n×n`, `F = n` and Dijkstra over `O(n²)` edges gives `O(n³ log n)`; the Hungarian algorithm shaves the log to `O(n³)`.

**Lower bounds / hardness.** Min-cost flow is solvable in **strongly polynomial** time (Orlin's `O(E log V (E + V log V))` algorithm), so it is "easy" in complexity terms — the open questions (Section 11) are about *constants* and *near-linear* time, not tractability.

---

## 6. The Assignment Problem and Hungarian Connection

**Assignment problem.** Given an `n×n` cost matrix `a[i][j]`, find a permutation `σ` minimizing `Σ_i a[i][σ(i)]`. As an MCMF: source `s`, workers `W_1..W_n`, jobs `J_1..J_n`, sink `t`; edges `s→W_i` (cap 1, cost 0), `W_i→J_j` (cap 1, cost `a[i][j]`), `J_j→t` (cap 1, cost 0). The min-cost max-flow has value `n` (a perfect matching) and cost = optimal assignment cost. Total unimodularity guarantees the LP relaxation is integral, so the flow is a genuine 0/1 assignment.

**Hungarian = SSP + potentials specialized.** The **Hungarian algorithm** (Kuhn–Munkres) is precisely SSP with Johnson potentials run on this complete bipartite graph, exploiting `F = n` and structure to achieve `O(n³)`. The potentials `h` are exactly the **dual variables** (the "labels" / "node prices") of the assignment LP; the reduced costs `c_h(i,j) = a[i][j] − u_i − v_j ≥ 0` are the complementary-slackness conditions, and a tight edge (`c_h = 0`) is one that can be in an optimal matching. Each augmentation in Hungarian = one SSP shortest-augmenting-path step that grows the matching by one and updates the dual labels. See sibling topic *Bipartite Matching* for the unweighted (Hopcroft–Karp) cousin.

**LP duality framing.** The MCMF primal minimizes `Σ c(e) f(e)`; its dual assigns potentials/prices to vertices, and **complementary slackness** states an edge carries flow only if its reduced cost is zero. SSP's potentials *are* a feasible dual; reaching optimality means primal flow and dual potentials satisfy complementary slackness simultaneously. This is why "no negative residual cycle" (primal) ⟺ "valid potentials with `c_h ≥ 0`" (dual) ⟺ optimality.

---

## 7. Cache and Memory-Hierarchy Behavior

- **Edge layout dominates.** The `e ^ 1` paired-array representation (parallel `to[]`, `cap[]`, `cost[]`) keeps an edge and its reverse adjacent and avoids pointer chasing, which matters because the shortest-path inner loop touches every incident edge. Pointer-linked edge objects (one allocation per edge) thrash the cache and add GC pressure.
- **Dijkstra's heap** is the random-access hotspot; a flat binary heap in an array is cache-friendlier than a pointer-based or Fibonacci heap, which is why binary-heap Dijkstra usually *beats* the asymptotically better Fibonacci heap in practice on the sizes MCMF handles.
- **Potential array `h[]`** is read on every edge relaxation; keep it as a flat `int64` array, contiguous with the distance array, so both fit in cache together.
- **Adjacency by `head`/`next` (linked list of edge ids)** has worse locality than CSR (compressed sparse row) when the graph is static; for many repeated solves on the same structure, CSR layout measurably speeds up traversal.
- **Working set:** `O(V + E)` longs; for `E` in the millions this is tens of MB, comfortably L3/RAM-resident but not L1/L2 — so reducing `E` via pruning has a double benefit (fewer ops *and* better locality).

---

## 8. Average-Case and Randomized Analysis

- **SSP iteration count** is `≤ F` worst-case but often far smaller: many augmenting paths push large bottlenecks, so the number of Dijkstra runs is typically `O(min(F, E))`, frequently much less on real data.
- **SPFA average case** is near `O(E)` per run on random/structured graphs (each vertex relaxed a small constant number of times), but adversarial graphs force `O(V·E)` — which is why production code prefers the potential+Dijkstra version with predictable bounds.
- **Random cost matrices for assignment:** for `n×n` matrices with i.i.d. `U[0,1]` costs, the *expected optimal cost* converges to `π²/6` (Aldous, proving the Mézard–Parisi conjecture) — a striking result showing assignment cost is sharply concentrated. The number of Hungarian phases is `n`, but the work per phase is often sublinear in the dense edge set due to sparse tight-edge structure.
- **Randomized tie-breaking** can avoid SSP worst cases on degenerate graphs (many equal-cost paths) by perturbing costs infinitesimally, akin to the isolation-lemma trick used in matching.

---

## 9. Space-Time Trade-offs

| Choice | Space | Time effect |
|--------|-------|-------------|
| Sparse `e ^ 1` arrays | `O(V + E)` | Best general default. |
| Dense `V×V` cost/cap matrices | `O(V²)` | Fast indexing for assignment; wasteful for sparse graphs. |
| Binary heap Dijkstra | `O(E)` heap entries | `O(E log V)`/iter; great constants. |
| Fibonacci heap | `O(V)` | `O(E + V log V)`/iter asymptotically; worse constants. |
| Recompute potentials each solve | `O(V)` | Cold start cost each solve. |
| **Warm-start** (persist `f`, `h`) | `O(V + E)` retained | Amortizes potential init across incremental re-solves; 10–100× faster on small deltas. |
| Store full residual vs recompute | trade memory for recomputation | Keeping the residual graph live enables incremental cancel/augment. |

The dominant practical trade-off is **warm-starting**: retaining flow and potentials between solves trades `O(V + E)` memory for dramatic time savings when the problem changes incrementally (the senior file's incremental re-solve pattern).

---

## 10. Comparison with Alternatives (asymptotics + constants)

| Method | Asymptotic | Constants / practice | Use when |
|--------|-----------|----------------------|----------|
| SSP + Dijkstra + potentials | `O(F(E + V log V))` | Excellent; cache-friendly with flat arrays | General default, sparse, moderate `F`. |
| SSP + SPFA | `O(VEF)` worst | Often fast, adversarially slow | Quick code, small graphs, negative edges. |
| Hungarian | `O(n³)` | Tight constants for dense square assignment | Pure assignment, `n ≤ few thousand`. |
| Cycle-canceling (min-mean) | `O(VE² log V)` | Heavy constants | Start from known max flow; theory. |
| Cost-scaling push-relabel | `O(V²E log(VC))` | Strong on large dense instances | Big networks, OR solvers. |
| Network simplex | poly (delicate) | Often **fastest in practice** | Production OR; what commercial solvers use. |
| LP/MIP (simplex/barrier) | poly | Industrial-grade, parallel | Side constraints beyond pure flow. |

Rule: **SSP+potentials for hand-rolled code; network simplex / LP for industrial scale.** Hungarian when the problem is exactly assignment.

### Reference implementations

To ground the theory, here are complete, verified implementations of the two algorithms the proofs describe: **SSP + potentials** (Sections 2–3) and **cycle-canceling** (Section 4). Both produce identical answers on the same network — exactly as the optimality criterion guarantees. The networks use the `e ^ 1` paired-edge layout discussed in Section 7.

#### Go

```go
package mcmf

import "container/heap"

const INF = int64(1) << 60

type Graph struct {
	N             int
	to, cap, cost []int64
	head          [][]int
}

func New(n int) *Graph { return &Graph{N: n, head: make([][]int, n)} }

func (g *Graph) Add(u, v int, c, w int64) {
	g.head[u] = append(g.head[u], len(g.to)); g.to = append(g.to, int64(v)); g.cap = append(g.cap, c); g.cost = append(g.cost, w)
	g.head[v] = append(g.head[v], len(g.to)); g.to = append(g.to, int64(u)); g.cap = append(g.cap, 0); g.cost = append(g.cost, -w)
}

type pqi struct{ d int64; v int }
type pq []pqi
func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].d < p[j].d }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(pqi)) }
func (p *pq) Pop() interface{}   { o := *p; n := len(o); e := o[n-1]; *p = o[:n-1]; return e }

// SSP + Johnson potentials. Returns (flow, cost). Maintains c'(u,v) >= 0 (Section 3).
func (g *Graph) SSP(s, t int) (int64, int64) {
	h := make([]int64, g.N)
	for i := range h {
		h[i] = INF
	}
	h[s] = 0
	for it := 0; it < g.N-1; it++ { // Bellman-Ford potential init (Lemma 2)
		upd := false
		for u := 0; u < g.N; u++ {
			if h[u] == INF {
				continue
			}
			for _, e := range g.head[u] {
				v := int(g.to[e])
				if g.cap[e] > 0 && h[u]+g.cost[e] < h[v] {
					h[v] = h[u] + g.cost[e]; upd = true
				}
			}
		}
		if !upd {
			break
		}
	}
	for i := range h {
		if h[i] == INF {
			h[i] = 0
		}
	}
	var flow, cost int64
	for {
		dist := make([]int64, g.N)
		pe := make([]int, g.N)
		for i := range dist {
			dist[i] = INF; pe[i] = -1
		}
		dist[s] = 0
		q := &pq{{0, s}}
		for q.Len() > 0 {
			c := heap.Pop(q).(pqi)
			if c.d > dist[c.v] {
				continue
			}
			for _, e := range g.head[c.v] {
				v := int(g.to[e])
				if g.cap[e] > 0 {
					nd := dist[c.v] + g.cost[e] + h[c.v] - h[v] // reduced cost (Section 3)
					if nd < dist[v] {
						dist[v] = nd; pe[v] = e; heap.Push(q, pqi{nd, v})
					}
				}
			}
		}
		if dist[t] == INF {
			break
		}
		for i := range h { // h[v] += dist[v] keeps c' >= 0 (Theorem, Section 3)
			if dist[i] < INF {
				h[i] += dist[i]
			}
		}
		push := INF
		for v := t; v != s; {
			e := pe[v]
			if g.cap[e] < push {
				push = g.cap[e]
			}
			v = int(g.to[e^1])
		}
		for v := t; v != s; {
			e := pe[v]; g.cap[e] -= push; g.cap[e^1] += push; v = int(g.to[e^1])
		}
		flow += push; cost += push * h[t]
	}
	return flow, cost
}
```

#### Java

```java
import java.util.*;

public class MCMFProof {
    static final long INF = Long.MAX_VALUE / 4;
    int n;
    List<long[]> e = new ArrayList<>(); // {to, cap, cost}
    List<List<Integer>> g;

    MCMFProof(int n) {
        this.n = n; g = new ArrayList<>();
        for (int i = 0; i < n; i++) g.add(new ArrayList<>());
    }

    void add(int u, int v, long c, long w) {
        g.get(u).add(e.size()); e.add(new long[]{v, c, w});
        g.get(v).add(e.size()); e.add(new long[]{u, 0, -w});
    }

    // SSP + potentials (Sections 2-3).
    long[] ssp(int s, int t) {
        long[] h = new long[n];
        Arrays.fill(h, INF); h[s] = 0;
        for (int it = 0; it < n - 1; it++) {
            boolean upd = false;
            for (int u = 0; u < n; u++) {
                if (h[u] == INF) continue;
                for (int id : g.get(u)) {
                    long[] ed = e.get(id);
                    if (ed[1] > 0 && h[u] + ed[2] < h[(int) ed[0]]) { h[(int) ed[0]] = h[u] + ed[2]; upd = true; }
                }
            }
            if (!upd) break;
        }
        for (int i = 0; i < n; i++) if (h[i] == INF) h[i] = 0;
        long flow = 0, cost = 0;
        while (true) {
            long[] dist = new long[n];
            int[] pe = new int[n];
            Arrays.fill(dist, INF); Arrays.fill(pe, -1); dist[s] = 0;
            PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
            pq.add(new long[]{0, s});
            while (!pq.isEmpty()) {
                long[] c = pq.poll();
                long d = c[0]; int u = (int) c[1];
                if (d > dist[u]) continue;
                for (int id : g.get(u)) {
                    long[] ed = e.get(id); int v = (int) ed[0];
                    if (ed[1] > 0) {
                        long nd = dist[u] + ed[2] + h[u] - h[v];
                        if (nd < dist[v]) { dist[v] = nd; pe[v] = id; pq.add(new long[]{nd, v}); }
                    }
                }
            }
            if (dist[t] == INF) break;
            for (int i = 0; i < n; i++) if (dist[i] < INF) h[i] += dist[i];
            long push = INF;
            for (int v = t; v != s; ) { int id = pe[v]; push = Math.min(push, e.get(id)[1]); v = (int) e.get(id ^ 1)[0]; }
            for (int v = t; v != s; ) { int id = pe[v]; e.get(id)[1] -= push; e.get(id ^ 1)[1] += push; v = (int) e.get(id ^ 1)[0]; }
            flow += push; cost += push * h[t];
        }
        return new long[]{flow, cost};
    }
}
```

#### Python

```python
import heapq

INF = float("inf")


class MCMFProof:
    """SSP + potentials (Sections 2-3) and cycle-canceling (Section 4)."""

    def __init__(self, n):
        self.n = n
        self.to, self.cap, self.cost = [], [], []
        self.head = [[] for _ in range(n)]

    def add(self, u, v, c, w):
        self.head[u].append(len(self.to)); self.to.append(v); self.cap.append(c); self.cost.append(w)
        self.head[v].append(len(self.to)); self.to.append(u); self.cap.append(0); self.cost.append(-w)

    def ssp(self, s, t):
        n = self.n
        h = [INF] * n
        h[s] = 0
        for _ in range(n - 1):  # Bellman-Ford potential init (Lemma 2)
            upd = False
            for u in range(n):
                if h[u] == INF:
                    continue
                for e in self.head[u]:
                    v = self.to[e]
                    if self.cap[e] > 0 and h[u] + self.cost[e] < h[v]:
                        h[v] = h[u] + self.cost[e]; upd = True
            if not upd:
                break
        h = [0 if x == INF else x for x in h]
        flow = cost = 0
        while True:
            dist = [INF] * n; pe = [-1] * n; dist[s] = 0; pq = [(0, s)]
            while pq:
                d, u = heapq.heappop(pq)
                if d > dist[u]:
                    continue
                for e in self.head[u]:
                    v = self.to[e]
                    if self.cap[e] > 0:
                        nd = d + self.cost[e] + h[u] - h[v]  # reduced cost
                        if nd < dist[v]:
                            dist[v] = nd; pe[v] = e; heapq.heappush(pq, (nd, v))
            if dist[t] == INF:
                break
            for i in range(n):
                if dist[i] < INF:
                    h[i] += dist[i]  # maintains c' >= 0 (Theorem, Section 3)
            push = INF; v = t
            while v != s:
                push = min(push, self.cap[pe[v]]); v = self.to[pe[v] ^ 1]
            v = t
            while v != s:
                self.cap[pe[v]] -= push; self.cap[pe[v] ^ 1] += push; v = self.to[pe[v] ^ 1]
            flow += push; cost += push * h[t]
        return flow, cost


if __name__ == "__main__":
    g = MCMFProof(4)
    for u, v, c, w in [(0, 1, 3, 1), (0, 2, 2, 2), (1, 2, 1, 1), (1, 3, 2, 3), (2, 3, 3, 1)]:
        g.add(u, v, c, w)
    print(g.ssp(0, 3))  # (5, 17) — matches the cycle-canceling result by the optimality criterion
```

#### Cycle-canceling (Python) — the dual algorithm of Section 4

Where SSP *grows* flow while keeping "no negative residual cycle," cycle-canceling starts from *any* maximum flow and *destroys* negative cycles until none remain. The optimality criterion guarantees the same final cost.

```python
def cycle_cancel(self, s, t):
    """Start from any max flow (computed by saturating cheapest-ignoring augmenting
    paths), then cancel negative residual cycles until none remain (Klein 1967)."""
    # 1. Build any maximum flow ignoring cost (BFS augmenting paths).
    from collections import deque
    n = self.n
    total = 0
    while True:
        pe = [-1] * n
        pe[s] = -2
        q = deque([s])
        while q and pe[t] == -1:
            u = q.popleft()
            for e in self.head[u]:
                v = self.to[e]
                if self.cap[e] > 0 and pe[v] == -1:
                    pe[v] = e; q.append(v)
        if pe[t] == -1:
            break
        push = INF; v = t
        while v != s:
            push = min(push, self.cap[pe[v]]); v = self.to[pe[v] ^ 1]
        v = t
        while v != s:
            self.cap[pe[v]] -= push; self.cap[pe[v] ^ 1] += push
            total += push * self.cost[pe[v]]; v = self.to[pe[v] ^ 1]

    # 2. Repeatedly find and cancel a negative-cost residual cycle.
    m = len(self.to)
    while True:
        dist = [0] * n; pre = [-1] * n; x = -1
        for _ in range(n):                 # Bellman-Ford over all residual edges
            x = -1
            for eid in range(m):
                if self.cap[eid] > 0:
                    u = self.to[eid ^ 1]; v = self.to[eid]
                    if dist[u] + self.cost[eid] < dist[v]:
                        dist[v] = dist[u] + self.cost[eid]; pre[v] = eid; x = v
        if x == -1:                        # no negative cycle => min-cost (Section 4)
            break
        for _ in range(n):                 # step inside the cycle
            x = self.to[pre[x] ^ 1]
        cyc = []; v = x
        while True:
            cyc.append(pre[v]); v = self.to[pre[v] ^ 1]
            if v == x and len(cyc) > 1:
                break
        push = min(self.cap[e] for e in cyc)
        for e in cyc:
            self.cap[e] -= push; self.cap[e ^ 1] += push; total += push * self.cost[e]
    return total
```

Running `cycle_cancel(0, 3)` on the same network yields cost **17** — the identical optimum SSP found, exactly as the theorem predicts.

These three agree on `(flow=5, cost=17)` for the canonical example, which is the empirical face of the optimality theorem: any correct min-cost algorithm reaches the *same* optimum because the criterion (no negative residual cycle) characterizes a *unique* optimal cost.

---

## 11. Open Problems and Summary

**Open / active research directions:**

- **Near-linear-time min-cost flow.** A landmark line of work (Chen, Kyng, Liu, Peng, Probst Gutenberg, Sachdeva, 2022) gave an **`m^{1+o(1)}`-time** algorithm for min-cost flow via interior-point methods and dynamic graph data structures — almost-linear time, resolving a decades-old goal. Making it *practical* (small constants, implementable) remains open.
- **Parallel / distributed exact MCMF** with good span: SSP is inherently sequential; auction and cost-scaling parallelize better, but a truly scalable exact parallel algorithm with strong work-efficiency is still an active area.
- **Dynamic min-cost flow:** efficiently maintaining the optimum under edge insertions/deletions/cost changes (beyond warm-starting heuristics).
- **Integrality with side constraints:** once you add constraints that break total unimodularity, the problem becomes a general MIP (NP-hard); characterizing tractable extensions is ongoing.

**Summary.** MCMF rests on one clean optimality criterion — **a flow is min-cost iff its residual graph has no negative cycle** — proved two ways and exploited by two dual algorithms: **SSP** grows flow along cheapest paths while *maintaining* the no-negative-cycle invariant (each cheapest-path augmentation preserves optimality, proved via reduced costs), and **cycle-canceling** *restores* the invariant at maximum flow. The **reduced-cost/potential** machinery is what keeps residual costs non-negative so Dijkstra stays valid, and it coincides exactly with **LP duality** — potentials are dual prices, and zero reduced cost is complementary slackness. The **assignment problem** is the canonical special case, with the Hungarian algorithm being SSP+potentials specialized to `O(n³)`. Asymptotically the problem is strongly polynomial and now almost-linear-time in theory; in practice, SSP+potentials and network simplex dominate. The applied operational view is in [`senior.md`](./senior.md); drills in [`interview.md`](./interview.md).
