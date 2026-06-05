# Maximum Flow — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definitions: Flow and Cut](#1-formal-definitions-flow-and-cut)
2. [The Max-Flow Min-Cut Theorem — Proof](#2-the-max-flow-min-cut-theorem--proof)
3. [Edmonds-Karp O(VE²) Bound — Proof](#3-edmonds-karp-ove²-bound--proof)
4. [Dinic O(V²E) Proof and O(E√V) Unit-Capacity Proof](#4-dinic-ov²e-proof-and-oe√v-unit-capacity-proof)
5. [The Integrality Theorem](#5-the-integrality-theorem)
6. [Lower Bounds and Near-Linear Max-Flow](#6-lower-bounds-and-near-linear-max-flow)
7. [Cache and Memory-Hierarchy Behavior](#7-cache-and-memory-hierarchy-behavior)
8. [Average-Case and Practical Behavior](#8-average-case-and-practical-behavior)
9. [Space-Time Trade-offs](#9-space-time-trade-offs)
10. [Comparison with Alternatives](#10-comparison-with-alternatives)
11. [Open Problems and Summary](#11-open-problems-and-summary)

---

## 1. Formal Definitions: Flow and Cut

Let `G = (V, E)` be a directed graph with a capacity function `c : V × V → ℝ_{≥0}` (with `c(u,v) = 0` if `(u,v) ∉ E`), a source `s ∈ V`, and a sink `t ∈ V`.

**Definition 1.1 (Flow).** A function `f : V × V → ℝ` is a *flow* if:

- **Capacity constraint:** `0 ≤ f(u,v) ≤ c(u,v)` for all `u, v ∈ V`.
- **Flow conservation:** for all `u ∈ V \ {s, t}`,
  ```
  Σ_{v∈V} f(v,u) = Σ_{v∈V} f(u,v)         (inflow = outflow)
  ```

**Definition 1.2 (Value).** The *value* of a flow is the net flow out of the source:
```
|f| = Σ_{v∈V} f(s,v) − Σ_{v∈V} f(v,s)
```

**Definition 1.3 (Residual capacity).** For a flow `f`,
```
c_f(u,v) = c(u,v) − f(u,v) + f(v,u)
```
Equivalently, with the antisymmetric convention `f(u,v) = −f(v,u)`, `c_f(u,v) = c(u,v) − f(u,v)`. The **residual network** `G_f = (V, E_f)` has `E_f = { (u,v) : c_f(u,v) > 0 }`.

**Definition 1.4 (Augmenting path).** A simple path from `s` to `t` in `G_f`. Its *residual capacity* (the bottleneck) is `c_f(p) = min_{(u,v)∈p} c_f(u,v) > 0`.

**Definition 1.5 (s-t cut).** A partition `(S, T)` of `V` with `s ∈ S`, `t ∈ T`. Its *capacity* is
```
c(S,T) = Σ_{u∈S} Σ_{v∈T} c(u,v)
```
(only forward edges from `S` to `T` count toward the capacity).

**Definition 1.6 (Net flow across a cut).** `f(S,T) = Σ_{u∈S} Σ_{v∈T} f(u,v) − Σ_{u∈S} Σ_{v∈T} f(v,u)`.

**Lemma 1.7 (Flow across any cut equals the value).** For any flow `f` and any `s`-`t` cut `(S,T)`, `f(S,T) = |f|`.

*Proof.* Sum the conservation equation over all `u ∈ S`. Internal `S`-to-`S` flows cancel (each appears once positively and once negatively), and the conservation constraint zeroes every term for `u ≠ s`. What remains is the net flow leaving `S`, which is exactly `|f|` by definition of value. ∎

**Corollary 1.8 (Weak duality).** For any flow `f` and any cut `(S,T)`: `|f| = f(S,T) ≤ c(S,T)`, since `f(u,v) ≤ c(u,v)` and the reverse terms are `≥ 0`. Hence **max-flow ≤ min-cut** always.

**Worked instance.** On the CLRS network (`s,a,b,c,d,t` with edges `s→a:16, s→b:13, a→c:12, b→a:4, b→d:14, c→b:9, c→t:20, d→c:7, d→t:4`), the maximum flow value is `23`. A minimum cut is `S = {s, a, b, d}`, `T = {c, t}`, whose forward edges are `a→c (12), d→c (7), d→t (4)` summing to `12 + 7 + 4 = 23` — matching the flow value, as Theorem 2.1 guarantees. Note `b→a` and `c→b` do not count: they either lie inside `S` or run backward across the cut.

This identity — *value of the flow = capacity of the cut* — is not a coincidence of this instance; it is the universal certificate proved next.

---

## 2. The Max-Flow Min-Cut Theorem — Proof

**Theorem 2.1 (Ford-Fulkerson, 1956).** For any flow network the following three statements are equivalent:

1. `f` is a maximum flow.
2. The residual network `G_f` contains no augmenting path (`t` unreachable from `s`).
3. `|f| = c(S,T)` for some `s`-`t` cut `(S,T)`.

*Proof.* We show `(1) ⇒ (2) ⇒ (3) ⇒ (1)`.

**(1) ⇒ (2).** Contrapositive. Suppose `G_f` has an augmenting path `p` with bottleneck `b = c_f(p) > 0`. Define `f'` by augmenting `f` along `p` by `b`: increase `f(u,v)` by `b` on forward edges of `p` and decrease it on the corresponding reverse edges. One checks `f'` satisfies capacity (each residual was `≥ b`) and conservation (each interior vertex of `p` gains `b` inflow and `b` outflow). Then `|f'| = |f| + b > |f|`, so `f` was not maximum.

**(2) ⇒ (3).** Suppose `t` is unreachable from `s` in `G_f`. Let `S = { v : v reachable from s in G_f }` and `T = V \ S`. Then `s ∈ S`, `t ∈ T`, so `(S,T)` is an `s`-`t` cut. For every `u ∈ S`, `v ∈ T`:
- `c_f(u,v) = 0` (else `v` would be reachable), so `f(u,v) = c(u,v)` — every forward cut edge is **saturated**.
- `c_f(v,u) = 0` would not hold in general; but reachability gives `f(v,u) = 0` for the reverse direction across the cut (any positive `f(v,u)` creates a residual edge `u→v`... carefully: a positive `f(v,u)` makes `c_f(u,v) ≥ f(v,u) > 0`, contradicting unreachability). Hence **no flow returns** across the cut.

Therefore `f(S,T) = Σ_{u∈S,v∈T} f(u,v) − 0 = Σ_{u∈S,v∈T} c(u,v) = c(S,T)`. By Lemma 1.7, `|f| = f(S,T) = c(S,T)`.

**(3) ⇒ (1).** By weak duality (Corollary 1.8), `|f'| ≤ c(S,T)` for every flow `f'`. If `|f| = c(S,T)`, then `f` attains this upper bound and is maximum. ∎

**Corollary 2.2 (Max-Flow = Min-Cut).** The maximum flow value equals the minimum cut capacity. The cut `(S,T)` constructed in `(2)⇒(3)` is a minimum cut, recoverable in `O(V + E)` by a graph search from `s` in `G_f` after termination.

---

## 3. Edmonds-Karp O(VE²) Bound — Proof

Edmonds-Karp is Ford-Fulkerson where each augmenting path is a **shortest** path in `G_f` (fewest edges), found by BFS. Write `δ_f(u,v)` for the shortest-path distance (in edges) from `u` to `v` in `G_f`.

**Lemma 3.1 (Monotone distances).** Throughout the Edmonds-Karp execution, for every vertex `v ≠ s, t`, the distance `δ_f(s, v)` is **non-decreasing** across augmentations.

*Proof.* Suppose, for contradiction, that an augmentation transforms `f` into `f'` and strictly *decreases* the distance to some vertex; among all such vertices pick `v` with the smallest `δ_{f'}(s,v)`. Let `u` be the predecessor of `v` on a shortest `s`-`v` path in `G_{f'}`, so `δ_{f'}(s,v) = δ_{f'}(s,u) + 1` and `(u,v) ∈ E_{f'}`. By minimal choice of `v`, `δ_{f'}(s,u) ≥ δ_f(s,u)`.

Case A: `(u,v) ∈ E_f`. Then `δ_f(s,v) ≤ δ_f(s,u) + 1 ≤ δ_{f'}(s,u) + 1 = δ_{f'}(s,v)`, contradicting the decrease.

Case B: `(u,v) ∉ E_f` but `(u,v) ∈ E_{f'}`. The augmentation created residual edge `(u,v)`, which means it pushed flow on `(v,u)`. Since the augmenting path was a *shortest* path in `G_f`, `(v,u)` lay on it, so `δ_f(s,u) = δ_f(s,v) + 1`. Then
```
δ_f(s,v) = δ_f(s,u) − 1 ≤ δ_{f'}(s,u) − 1 = δ_{f'}(s,v) − 2 < δ_{f'}(s,v),
```
again contradicting a decrease. ∎

**Definition.** An edge `(u,v)` is *critical* on an augmenting path if it is the bottleneck, i.e. `c_f(u,v) = c_f(p)`. Augmenting saturates and removes every critical edge from `G_f`.

**Lemma 3.2 (Each edge is critical O(V) times).** Any edge `(u,v)` becomes critical at most `(V/2) + 1` times.

*Proof.* When `(u,v)` is critical, because the path is shortest, `δ_f(s,v) = δ_f(s,u) + 1`. The edge `(u,v)` then vanishes from `G_f` and can reappear only after flow is pushed on `(v,u)`. At that later moment with flow `f'`, since that path is also shortest, `δ_{f'}(s,u) = δ_{f'}(s,v) + 1`. Combining with monotonicity (Lemma 3.1):
```
δ_{f'}(s,u) = δ_{f'}(s,v) + 1 ≥ δ_f(s,v) + 1 = δ_f(s,u) + 2.
```
So between two consecutive times `(u,v)` is critical, `δ(s,u)` increases by at least 2. Since `δ(s,u)` ranges in `[0, V−1]` (or is `∞`, after which the edge never matters), `(u,v)` is critical at most `(V−1)/2 + 1 = O(V)` times. ∎

**Theorem 3.3 (Edmonds-Karp runs in O(VE²)).** Each augmentation makes at least one edge critical, and there are `O(E)` distinct residual edges (forward + reverse), each critical `O(V)` times → `O(VE)` augmentations. Each augmentation costs one BFS = `O(V + E) = O(E)` (assuming `E ≥ V−1`). Total: **`O(VE²)`**, independent of capacities. ∎

**Remark 3.4 (tightness of the lemmas).** Lemma 3.1 is what fails for *arbitrary-path* Ford-Fulkerson: with DFS, a non-shortest augmenting path can be chosen, distances can oscillate, and the critical-edge counting argument collapses — which is exactly why arbitrary-path FF has no polynomial bound. The *only* property Edmonds-Karp adds over FF is "pick the shortest path," and that single discipline buys the entire `O(VE²)` guarantee. The proof uses no fact about capacities, which is why the bound is capacity-independent — a striking contrast with FF's `O(E·|f*|)`.

**Remark 3.5 (BFS records the path).** The standard implementation records, for each vertex `v`, the residual edge used to first reach it (`parent_edge[v]`). After BFS reaches `t`, walking `parent_edge` backward from `t` to `s` recovers the augmenting path; one pass computes the bottleneck, a second applies `cap[e] -= b; cap[e^1] += b`. Both passes are `O(V)` (path length `≤ V−1`), so the per-augmentation cost is dominated by the `O(E)` BFS, confirming the `O(E)`-per-augmentation accounting.

---

## 4. Dinic O(V²E) Proof and O(E√V) Unit-Capacity Proof

Dinic proceeds in **phases**. Each phase: (i) BFS builds the *level graph* `L_f` (only edges `(u,v)` with `δ_f(s,v) = δ_f(s,u) + 1`); (ii) a **blocking flow** is found in `L_f` by DFS with the current-arc optimization; (iii) repeat.

**Lemma 4.1 (Distance strictly increases per phase).** After a blocking flow is pushed in phase `k`, the shortest `s`-`t` distance in the new residual graph is strictly greater than in phase `k`.

*Proof.* A blocking flow saturates at least one edge on every shortest `s`-`t` path of length `δ_f(s,t)`. Any new `s`-`t` path in the updated residual graph either (a) has length `> δ_f(s,t)`, or (b) uses a newly created reverse edge, which by Lemma 3.1's monotonicity argument cannot create a shortest path of length `≤ δ_f(s,t)`. Hence `δ(s,t)` strictly increases. ∎

**Corollary 4.2 (At most V phases).** Since `δ(s,t)` starts at `≥ 1`, strictly increases each phase, and is bounded by `V−1` before becoming `∞` (no path), there are at most `V−1 = O(V)` phases.

**Lemma 4.3 (A blocking flow costs O(VE) per phase).** With the current-arc pointer `it[u]`, each DFS advance either (a) extends the path by one edge (`O(V)` work to build a path of length `≤ V`), or (b) retreats over a *dead* edge, permanently advancing `it[u]` past it. Each of the `O(E)` edges is retreated past at most once per phase. Each augmentation in the phase saturates at least one edge (so `≤ E` augmentations), and each augmentation does `O(V)` path work. Total per phase: `O(VE)` retreats + augmentations `= O(VE)`. ∎

**Theorem 4.4 (Dinic runs in O(V²E)).** `O(V)` phases (Corollary 4.2) × `O(VE)` per phase (Lemma 4.3) = **`O(V²E)`**. ∎

### 4.1 Unit-capacity / bipartite O(E√V)

A *unit-capacity* network has `c(u,v) ∈ {0,1}`. Bipartite matching reduces to such a network.

**Lemma 4.5.** In a unit-capacity network, a single blocking-flow phase costs `O(E)` (each edge is used at most once).

**Lemma 4.6.** After `√E` (equivalently `O(√V)` for the matching reduction) phases, the shortest `s`-`t` distance is at least `√E`, so the remaining max-flow is at most the value of a flow whose every augmenting path has length `≥ √E`. Since the level graph is a DAG with `≤ E` edges across `≥ √E` levels, at most `E/√E = √E` more augmentations remain.

*Proof sketch.* Let `f` be the flow after `√V` phases and `f*` the maximum. By Lemma 4.1 every `s`-`t` path in `G_f` has length `> √V`. Decompose `f* − f` into augmenting paths in `G_f`; they are vertex-"disjoint enough" that, with each path consuming `> √V` vertices out of `V`, there are at most `O(√V)` of them. Hence `|f*| − |f| = O(√V)`, and each remaining augmentation (one per remaining unit) costs `O(E)`. ∎

**Theorem 4.7 (Dinic is O(E√V) on unit-capacity / bipartite graphs).** First `O(√V)` phases cost `O(E√V)` (Lemma 4.5). The remaining `O(√V)` augmentations cost `O(E√V)`. Total: **`O(E√V)`**. ∎

This matches Hopcroft-Karp's bound for bipartite matching; Dinic *is* essentially Hopcroft-Karp specialized to unit capacities.

**Remark 4.8 (the current-arc invariant).** The correctness of the `O(VE)`-per-phase bound rests on a precise invariant: once `it[u]` advances past an edge `(u,v)` during a phase, that edge can never carry flow *again in this phase*, because either it was saturated or the DFS proved `v` cannot reach `t` within the level graph. Re-examining it would be wasted work, so the pointer never moves backward within a phase. This is why `it[]` is reset *between* phases (the level graph changes) but never *within* one. Omitting the reset between phases is a correctness bug (stale pointers skip valid edges); failing to keep it monotone within a phase is a complexity bug (re-scanning makes a phase `O(VE²)` instead of `O(VE)`).

**Remark 4.9 (blocking flow ≠ maximum flow).** A blocking flow is maximal *within one level graph* — every shortest `s`-`t` path is saturated — but is generally far from the global maximum, because longer augmenting paths still exist in the full residual graph. The phase structure is exactly the mechanism that promotes a sequence of blocking flows (each cheap to compute) into a global maximum: each phase strictly raises the minimum `s`-`t` distance, so after `O(V)` phases no path of any length remains.

### 4.2 Reference implementation (Dinic with current-arc)

#### Go

```go
package main

import "fmt"

const INF = int(1 << 60)

type Dinic struct {
	n         int
	to, cap   []int
	head      [][]int
	level, it []int
}

func NewDinic(n int) *Dinic { return &Dinic{n: n, head: make([][]int, n)} }

func (d *Dinic) AddEdge(u, v, c int) {
	d.head[u] = append(d.head[u], len(d.to)); d.to = append(d.to, v); d.cap = append(d.cap, c)
	d.head[v] = append(d.head[v], len(d.to)); d.to = append(d.to, u); d.cap = append(d.cap, 0)
}

func (d *Dinic) bfs(s, t int) bool {
	d.level = make([]int, d.n)
	for i := range d.level {
		d.level[i] = -1
	}
	d.level[s] = 0
	q := []int{s}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		for _, e := range d.head[u] {
			if d.cap[e] > 0 && d.level[d.to[e]] < 0 {
				d.level[d.to[e]] = d.level[u] + 1
				q = append(q, d.to[e])
			}
		}
	}
	return d.level[t] >= 0
}

func (d *Dinic) dfs(u, t, f int) int {
	if u == t {
		return f
	}
	for ; d.it[u] < len(d.head[u]); d.it[u]++ {
		e := d.head[u][d.it[u]]
		v := d.to[e]
		if d.cap[e] > 0 && d.level[v] == d.level[u]+1 {
			if p := d.dfs(v, t, min(f, d.cap[e])); p > 0 {
				d.cap[e] -= p
				d.cap[e^1] += p
				return p
			}
		}
	}
	return 0
}

func (d *Dinic) MaxFlow(s, t int) int {
	flow := 0
	for d.bfs(s, t) {
		d.it = make([]int, d.n)
		for {
			f := d.dfs(s, t, INF)
			if f == 0 {
				break
			}
			flow += f
		}
	}
	return flow
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	d := NewDinic(6)
	for _, e := range [][3]int{{0, 1, 16}, {0, 2, 13}, {1, 3, 12}, {2, 1, 4},
		{2, 4, 14}, {3, 2, 9}, {3, 5, 20}, {4, 3, 7}, {4, 5, 4}} {
		d.AddEdge(e[0], e[1], e[2])
	}
	fmt.Println(d.MaxFlow(0, 5)) // 23
}
```

#### Java

```java
import java.util.*;

public class DinicPro {
    int n; int[] to, cap; List<List<Integer>> head; int[] level, it; int cnt = 0;

    DinicPro(int n, int m) {
        this.n = n; to = new int[2*m]; cap = new int[2*m];
        head = new ArrayList<>();
        for (int i = 0; i < n; i++) head.add(new ArrayList<>());
    }
    void addEdge(int u, int v, int c) {
        head.get(u).add(cnt); to[cnt] = v; cap[cnt] = c; cnt++;
        head.get(v).add(cnt); to[cnt] = u; cap[cnt] = 0; cnt++;
    }
    boolean bfs(int s, int t) {
        level = new int[n]; Arrays.fill(level, -1); level[s] = 0;
        Deque<Integer> q = new ArrayDeque<>(); q.add(s);
        while (!q.isEmpty()) {
            int u = q.poll();
            for (int e : head.get(u))
                if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = level[u]+1; q.add(to[e]); }
        }
        return level[t] >= 0;
    }
    int dfs(int u, int t, int f) {
        if (u == t) return f;
        for (; it[u] < head.get(u).size(); it[u]++) {
            int e = head.get(u).get(it[u]), v = to[e];
            if (cap[e] > 0 && level[v] == level[u]+1) {
                int p = dfs(v, t, Math.min(f, cap[e]));
                if (p > 0) { cap[e] -= p; cap[e^1] += p; return p; }
            }
        }
        return 0;
    }
    int maxFlow(int s, int t) {
        int flow = 0;
        while (bfs(s, t)) {
            it = new int[n]; int f;
            while ((f = dfs(s, t, Integer.MAX_VALUE)) > 0) flow += f;
        }
        return flow;
    }
    public static void main(String[] a) {
        DinicPro d = new DinicPro(6, 9);
        int[][] e = {{0,1,16},{0,2,13},{1,3,12},{2,1,4},{2,4,14},{3,2,9},{3,5,20},{4,3,7},{4,5,4}};
        for (int[] x : e) d.addEdge(x[0], x[1], x[2]);
        System.out.println(d.maxFlow(0, 5)); // 23
    }
}
```

#### Python

```python
from collections import deque
import sys


class Dinic:
    def __init__(self, n):
        self.n = n
        self.to, self.cap = [], []
        self.head = [[] for _ in range(n)]

    def add_edge(self, u, v, c):
        self.head[u].append(len(self.to)); self.to.append(v); self.cap.append(c)
        self.head[v].append(len(self.to)); self.to.append(u); self.cap.append(0)

    def bfs(self, s, t):
        self.level = [-1] * self.n
        self.level[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for e in self.head[u]:
                if self.cap[e] > 0 and self.level[self.to[e]] < 0:
                    self.level[self.to[e]] = self.level[u] + 1
                    q.append(self.to[e])
        return self.level[t] >= 0

    def dfs(self, u, t, f):
        if u == t:
            return f
        while self.it[u] < len(self.head[u]):
            e = self.head[u][self.it[u]]
            v = self.to[e]
            if self.cap[e] > 0 and self.level[v] == self.level[u] + 1:
                p = self.dfs(v, t, min(f, self.cap[e]))
                if p > 0:
                    self.cap[e] -= p
                    self.cap[e ^ 1] += p
                    return p
            self.it[u] += 1
        return 0

    def max_flow(self, s, t):
        sys.setrecursionlimit(1 << 25)
        flow = 0
        while self.bfs(s, t):
            self.it = [0] * self.n
            while True:
                f = self.dfs(s, t, float("inf"))
                if f == 0:
                    break
                flow += f
        return flow


if __name__ == "__main__":
    d = Dinic(6)
    for u, v, c in [(0,1,16),(0,2,13),(1,3,12),(2,1,4),
                    (2,4,14),(3,2,9),(3,5,20),(4,3,7),(4,5,4)]:
        d.add_edge(u, v, c)
    print(d.max_flow(0, 5))  # 23
```

---

## 5. The Integrality Theorem

**Theorem 5.1 (Integrality).** If every capacity `c(u,v)` is an integer, then there exists a maximum flow `f*` in which every `f*(u,v)` is an integer. Moreover, Ford-Fulkerson, Edmonds-Karp, and Dinic all produce such an integral flow.

*Proof.* Start with `f ≡ 0` (integral). Each augmentation pushes the bottleneck `b = c_f(p)`, which is a `min` of integer residuals, hence an integer. Thus the flow remains integral after every augmentation, and at termination it is integral. ∎

**Corollary 5.2 (Termination on integer capacities).** With integer capacities each augmentation increases `|f|` by at least 1, so any augmenting-path method terminates after at most `|f*|` augmentations. (Edmonds-Karp/Dinic give the stronger capacity-independent bounds above.)

**Remark 5.3 (Irrational capacities).** With irrational capacities, *arbitrary-path* Ford-Fulkerson may fail to terminate and may even converge to a value below the true max-flow (Ford & Fulkerson's own counterexample on the "geometric" network with ratio `(√5−1)/2`). BFS (Edmonds-Karp) and Dinic terminate regardless of capacity values, because their bounds depend only on `V` and `E`.

**Corollary 5.4 (Combinatorial consequences).** Integrality is what makes flow model *discrete* problems exactly: a maximum bipartite matching corresponds to an integral max-flow with unit capacities (each matched edge carries exactly 1 unit), and edge-/vertex-disjoint path counts (Menger's theorem, sibling 23) are integral max-flows.

### 5.1 Flow decomposition

**Theorem 5.5 (Flow Decomposition).** Any flow `f` of value `|f|` can be decomposed into at most `E` paths and cycles such that the path flows sum to `f` on every edge: at most `E` simple `s`-`t` paths carrying positive flow, plus at most `E` cycles (which can be cancelled without changing `|f|`).

*Proof sketch.* While `|f| > 0` and there is an edge out of `s` with positive flow, follow positive-flow edges until reaching `t` (a path) or revisiting a vertex (a cycle); subtract the bottleneck of that path/cycle from `f`. Each subtraction zeroes at least one edge, so the process stops after `≤ E` extractions. ∎

Flow decomposition is the bridge between the *numeric* flow `f` and the *combinatorial* objects (paths) downstream systems consume — e.g., extracting the actual `s`-`t` routes, or reading off the matched pairs in a bipartite instance. It is also the engine behind the `O(√V)`-many-paths argument in Lemma 4.6.

### 5.2 Menger's theorem as a corollary

**Theorem 5.6 (Menger, edge version).** The maximum number of pairwise edge-disjoint `s`-`t` paths equals the minimum number of edges whose removal disconnects `s` from `t`.

*Proof.* Give every edge capacity 1. By integrality the max-flow is an integer `k`, decomposable (Theorem 5.5) into `k` edge-disjoint unit `s`-`t` paths. By Max-Flow Min-Cut the value `k` equals the minimum cut, i.e. the minimum number of unit-capacity edges separating `s` from `t`. ∎

The vertex-disjoint version follows after node-splitting (replace each internal vertex with an `in→out` edge of capacity 1). This is exactly the reduction in sibling topic 23.

---

## 6. Lower Bounds and Near-Linear Max-Flow

### 6.1 History of upper bounds

| Year | Authors | Bound | Idea |
|------|---------|-------|------|
| 1956 | Ford-Fulkerson | `O(E·\|f*\|)` | augmenting paths |
| 1970 | Dinitz (Dinic) | `O(V²E)` | level graph + blocking flow |
| 1972 | Edmonds-Karp | `O(VE²)` | shortest augmenting path |
| 1974 | Karzanov | `O(V³)` | preflow / blocking flow on dense graphs |
| 1986 | Goldberg-Tarjan | `O(VE log(V²/E))` | push-relabel + dynamic trees |
| 1998 | Goldberg-Rao | `O(E·min(V^{2/3}, E^{1/2})·log(V²/E)·log U)` | binary blocking flow |
| 2013 | Orlin | `O(VE)` | for `E = O(V^{16/15})`; resolves long-standing target |
| 2022 | Chen, Kyng, Liu, Peng, Probst Gutenberg, Sachdeva | **`O(E^{1+o(1)})`** | interior-point methods + dynamic min-cost flow data structures |

**The 2022 breakthrough.** Chen et al. (FOCS 2022, "Maximum Flow and Minimum-Cost Flow in Almost-Linear Time") gave the first algorithm running in `m^{1+o(1)}` time for max-flow *and* min-cost flow on graphs with `m` edges and polynomially-bounded integer capacities. It works by reformulating flow as a convex optimization solved with a robust interior-point method, where each Newton step is supported by a dynamic data structure maintaining approximate min-ratio cycles on a low-stretch spanning tree. The result is theoretical — the `o(1)` hides large constants and intricate machinery — but it settles the asymptotic question that stood since Ford-Fulkerson: max-flow is (almost) as easy as reading the graph.

### 6.2 Lower bounds

For combinatorial (augmenting-path / push-relabel) algorithms there are families forcing `Ω(VE)` and `Ω(V²√E)` behaviors respectively; these are conditional/model-specific. Any algorithm must at least read the input, giving the trivial `Ω(E)` lower bound — which the 2022 result nearly matches, leaving essentially no asymptotic gap for the general problem.

### 6.3 Min-cost flow preview

Max-flow asks only for *quantity*; **min-cost flow** adds a cost `a(u,v)` per unit on each edge and asks for the maximum flow of minimum total cost (or a flow of a target value of minimum cost). The structure is closely related (sibling topic 18):

- The residual graph gains a **cost** on each edge; the reverse edge has *negated* cost (`−a(u,v)`), since cancelling flow refunds cost.
- Instead of *any* augmenting path (Edmonds-Karp) or *shortest-by-edges* path (Dinic), min-cost flow augments along the **cheapest** `s`-`t` path by cost — found with Bellman-Ford/SPFA (handles negative reverse-edge costs) or with Johnson potentials + Dijkstra after a reweighting.
- **Optimality criterion:** a flow of given value is min-cost **iff** the residual graph contains no negative-cost cycle. This mirrors the "no augmenting path ⇔ max-flow" criterion.
- The 2022 Chen et al. result solves min-cost flow in `m^{1+o(1)}` as well — the two problems are now known to be asymptotically equally easy.

The matching example from `senior.md` (minimize total ETA) is precisely a min-cost maximum matching: unit capacities with per-edge cost.

---

## 7. Cache and Memory-Hierarchy Behavior

The paired-edge (CSR-like) representation stores `to[]`, `cap[]`, and per-vertex adjacency offsets contiguously. Consequences:

- **BFS** sweeps `head[u]` and `to[]` mostly sequentially within a vertex's edge block — cache-friendly. Across vertices the access pattern follows the BFS frontier, which is less local but still array-based (no pointer chasing).
- **DFS blocking flow** follows the level graph; the current-arc pointer `it[u]` advances monotonically through `head[u]`, so each vertex's edge block is scanned at most once per phase — again sequential.
- **The reverse-edge XOR trick** (`e ^ 1`) keeps a forward edge and its reverse adjacent in `cap[]`, so augmenting touches two adjacent cache lines.
- **Vs adjacency matrix:** an `O(V²)` matrix destroys locality for sparse graphs and wastes memory; the list/CSR layout is strictly better except for tiny dense graphs.

For very large graphs, the dominant cost is cache misses on `level[]` and `cap[]` random access during augmentation, not the asymptotic edge count — which is why push-relabel (more local) sometimes wins in wall-clock despite a worse paper bound.

---

## 8. Average-Case and Practical Behavior

The `O(V²E)` Dinic bound and `O(VE²)` Edmonds-Karp bound are **pessimistic worst cases** rarely seen on real or random graphs:

- On random graphs, the number of Dinic phases is typically `O(log V)` or a small constant, not `O(V)`, because shortest-path distances grow logarithmically.
- On bipartite/unit-capacity graphs the `O(E√V)` bound is tight and routinely observed.
- Dinic's worst case is achieved by carefully layered graphs ("Zadeh's examples") with many parallel short augmenting paths — exactly the synthetic fixtures to keep in a benchmark suite.
- Push-relabel with the global-relabeling and gap heuristics often outperforms Dinic on dense graphs in practice, despite identical or worse asymptotics, because of locality and fewer full BFS sweeps.

Empirically, on sparse graphs with `V, E ≤ 10⁵`, Dinic completes in milliseconds; the constant factor is dominated by allocation (resetting `level[]` and `it[]` each phase) and memory traffic.

### 8.1 Worst-case construction for Dinic

To see the `O(V²E)` bound is tight, consider a layered graph: `s`, then `k` layers of width `w`, then `t`, with capacity-1 edges arranged so that each blocking-flow phase advances the `s`-`t` distance by exactly 1 and saturates only `O(w)` edges per phase. With `Θ(V)` layers and `Θ(E)` edges, you incur `Θ(V)` phases each doing `Θ(E)` work — the full `Θ(V²E)` (in the general-capacity variant). Such graphs essentially never arise from natural problem reductions, which is why the practical behavior is so much better than the bound. Keeping one of these layered fixtures in a test suite is the standard way to guard against latency regressions.

### 8.2 Why bipartite matching is the sweet spot

Bipartite matching produces a unit-capacity network of depth essentially 3 (`s` → left → right → `t`) before augmentation, growing only slowly. The `O(E√V)` analysis is tight here, and the constant factor is tiny because every bottleneck is 1 (no arithmetic on capacities) and each phase is a clean `O(E)` sweep. This is why Dinic — not Edmonds-Karp, not push-relabel — is the universal contest choice for matching: it is both asymptotically optimal for the regime and trivial to implement correctly.

### 8.3 Typical phase counts (illustrative)

| Graph family | Worst-case phases | Observed phases |
|--------------|-------------------|-----------------|
| Random sparse `G(n, p)` | `O(V)` | `O(log V)` |
| Bipartite matching, unit cap | `O(√V)` | `O(√V)` (tight) |
| Layered adversarial (Zadeh) | `O(V)` | `O(V)` (tight) |
| Planar / grid (segmentation) | `O(V)` | small constant to `O(√V)` |

The gap between the worst-case column and the observed column is exactly why production sizing must benchmark the adversarial family explicitly: average inputs hide the worst case until a modeling change exposes it.

---

## 9. Space-Time Trade-offs

| Representation | Space | Augment cost | Notes |
|----------------|-------|-------------|-------|
| Adjacency matrix `cap[V][V]` | `Θ(V²)` | BFS `O(V²)` | simplest Edmonds-Karp; only for tiny dense graphs |
| Paired-edge lists (CSR) | `Θ(V + E)` | BFS `O(V+E)` | the standard; cache-friendly |
| Dynamic trees (link-cut) | `Θ(V + E)` | blocking flow `O(E log V)` | improves dense-graph bounds; high constant |
| Push-relabel arrays | `Θ(V + E)` | per-op `O(1)` push/relabel | best parallel locality |

The dominant trade-off is **matrix vs list**: the matrix gives `O(1)` edge lookup but `Θ(V²)` space and `O(V²)` BFS; the list gives `O(V+E)` everything but no random `(u,v)` lookup. For all but the smallest dense instances, lists win decisively.

A subtler trade-off is **allocation per phase**. Resetting `level[]` and `it[]` with fresh allocations each phase is simple but adds `O(V)` allocation traffic per phase, i.e. `O(V²)` total — usually dominated by the algorithm itself, but on hot paths you can amortize by reusing buffers and resetting with a generation counter (stamp `level[v]` with the phase number instead of `-1`-filling). For million-scale graphs this removes a measurable constant factor and reduces GC pressure in managed runtimes.

---

## 10. Comparison with Alternatives

| Algorithm | Time | Space | Strength | Weakness |
|-----------|------|-------|----------|----------|
| Ford-Fulkerson (DFS) | `O(E·\|f*\|)` | `O(V+E)` | trivial to code | pseudo-poly; non-terminating on irrationals |
| Edmonds-Karp | `O(VE²)` | `O(V+E)` | capacity-independent, simple | slow on large `E` |
| Dinic | `O(V²E)` / `O(E√V)` | `O(V+E)` | fast, great for matching | sequential within a run |
| Push-relabel (FIFO) | `O(V³)` | `O(V+E)` | local, parallelizable | complex; heuristics needed for speed |
| Push-relabel (highest-label) | `O(V²√E)` | `O(V+E)` | fast on dense | complex |
| Goldberg-Rao | `Õ(E·min(V^{2/3},√E)·log U)` | `O(V+E)` | best classical for dense | intricate |
| Chen et al. 2022 | `E^{1+o(1)}` | near-linear | almost-optimal asymptotics | not practical yet |

---

## 11. Open Problems and Summary

### Open problems

- **Deterministic, *practical* near-linear max-flow.** The 2022 `m^{1+o(1)}` algorithm is randomized and impractical; a simple, deterministic, implementable near-linear algorithm remains open.
- **Strongly-polynomial near-linear flow.** The 2022 result depends on `log U`; a strongly-polynomial `m^{1+o(1)}` bound (no capacity dependence) is open.
- **Optimal parallel / distributed max-flow.** Tight bounds for work-efficient parallel exact max-flow remain unsettled.
- **Dynamic max-flow.** Maintaining max-flow / min-cut under edge insertions and deletions with sublinear update time is an active area.
- **Tight bounds for incremental/decremental flow.** When only capacities change monotonically (a common production setting), what is the optimal amortized update cost? Parametric flow (Gallo-Grigoriadis-Tarjan) handles monotone single-parameter changes in the time of one static flow, but the general dynamic question is open.
- **Practical exploitation of the near-linear result.** Whether the algebraic/interior-point machinery of Chen et al. can be distilled into something with small constants that beats Dinic/push-relabel on real graphs is unknown — currently it does not.

### Summary

The Max-Flow Min-Cut theorem (`max-flow = min-cut`) is the linchpin: it certifies optimality (no augmenting path ⇔ a saturating cut) and hands you the optimal cut for free. Edmonds-Karp's `O(VE²)` follows from BFS distance monotonicity and the `O(V)`-times-critical edge lemma. Dinic's `O(V²E)` follows from `O(V)` phases (distance strictly increases) times `O(VE)` per blocking flow, dropping to `O(E√V)` on unit-capacity and bipartite graphs — matching Hopcroft-Karp. Integrality guarantees that integer capacities yield an integer optimum, which is exactly why flow models discrete combinatorial problems. The 2022 almost-linear-time result of Chen et al. essentially closes the asymptotic story, leaving practicality and dynamic/parallel variants as the live frontier.
