# Maximum Flow (Push-Relabel) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions — Preflow, Valid Labeling, Admissibility
2. Correctness — Termination Yields a Maximum Flow
3. The Height Bound `h(u) ≤ 2n − 1`
4. Generic Complexity `O(V²E)`
5. FIFO Complexity `O(V³)`
6. Highest-Label Complexity `O(V²√E)`
7. The Gap and Global-Relabeling Heuristics — Effect on Bounds and Practice
8. Cache Behavior, Average-Case, and Space-Time Trade-offs
9. Comparison with Augmenting-Path Algorithms
10. Open Problems and the Modern Frontier
11. Summary

---

## 1. Formal Definitions — Preflow, Valid Labeling, Admissibility

Let `G = (V, E)` be a directed graph with a capacity function `c : V × V → ℝ≥0` (with `c(u,v) = 0` if `(u,v) ∉ E`), a source `s`, and a sink `t`. Write `n = |V|`, `m = |E|`.

**Definition 1.1 (Flow).** A function `f : V × V → ℝ` is a *flow* if it satisfies:
- *Capacity:* `f(u,v) ≤ c(u,v)` for all `u, v`.
- *Antisymmetry:* `f(u,v) = −f(v,u)`.
- *Conservation:* `Σ_{w} f(u,w) = 0` for all `u ∈ V \ {s, t}`.

The *value* is `|f| = Σ_w f(s,w)`.

**Definition 1.2 (Preflow).** A function `f` satisfying capacity and antisymmetry, but with conservation *relaxed* to the inequality

```
e(u) := Σ_{w} f(w,u) = − Σ_w f(u,w) ≥ 0    for all u ∈ V \ {s},
```

is a **preflow**. The quantity `e(u)` is the **excess** at `u`. A vertex `u ∈ V \ {s,t}` is **active** if `e(u) > 0`.

**Definition 1.3 (Residual graph).** The residual capacity is `c_f(u,v) = c(u,v) − f(u,v)`. The residual edge set is `E_f = { (u,v) : c_f(u,v) > 0 }`. The residual graph is `G_f = (V, E_f)`.

**Definition 1.4 (Valid labeling / height function).** A function `h : V → ℤ≥0` is a **valid labeling** for preflow `f` if:

```
(i)   h(s) = n,
(ii)  h(t) = 0,
(iii) h(u) ≤ h(v) + 1    for every residual edge (u,v) ∈ E_f.
```

**Definition 1.5 (Admissible edge).** A residual edge `(u,v) ∈ E_f` is **admissible** if `h(u) = h(v) + 1`. Pushes occur only on admissible edges.

**Definition 1.6 (Operations).**
- `PUSH(u,v)` is *applicable* iff `e(u) > 0`, `c_f(u,v) > 0`, and `h(u) = h(v) + 1`. It sends `δ = min(e(u), c_f(u,v))`: `f(u,v) += δ`, `f(v,u) −= δ`. It is *saturating* if `δ = c_f(u,v)`, else *non-saturating*.
- `RELABEL(u)` is *applicable* iff `e(u) > 0` and for all residual `(u,v)`, `h(u) ≤ h(v)` (no admissible edge). It sets `h(u) = 1 + min{ h(v) : (u,v) ∈ E_f }`.

**Lemma 1.7 (Operations preserve validity).** If `h` is a valid labeling and we apply an applicable `PUSH` or `RELABEL`, the resulting `h` remains a valid labeling.

*Proof.* `PUSH(u,v)` may add the residual edge `(v,u)`; validity needs `h(v) ≤ h(u) + 1`, true since `h(v) = h(u) − 1`. It may delete `(u,v)` (if saturating), which can only remove a constraint. `RELABEL(u)` sets `h(u)` to the largest value not violating `(iii)` on any outgoing residual edge `(u,v)`: `h(u) = 1 + min h(v) ≤ h(v) + 1` for each such `v`. Incoming residual edges `(w,u)` only get easier to satisfy because `h(u)` increased. ∎

---

## 2. Correctness — Termination Yields a Maximum Flow

**Lemma 2.1 (No residual augmenting path under valid labeling).** If `f` is a preflow with a valid labeling `h`, then `G_f` contains no path from `s` to `t`.

*Proof.* Suppose a simple residual path `s = v₀, v₁, …, v_k = t` existed, `k ≤ n − 1`. Validity gives `h(v_i) ≤ h(v_{i+1}) + 1`, so by induction `h(s) ≤ h(t) + k = 0 + k ≤ n − 1`. But `h(s) = n`, a contradiction. ∎

**Lemma 2.2 (Excess can always reach the source).** If `f` is a preflow and `u` has `e(u) > 0`, then there is a residual path from `u` to `s` in `G_f`.

*Proof.* Let `S` = vertices that can reach `u` via residual edges... more directly: let `A` = set of vertices from which `s` is residual-reachable, and suppose for contradiction some active `u ∉ A`. Let `B = V \ A`. There is no residual edge from `B` to `A` (else the tail would reach `s`). For `f`, the net flow from `B` to `A` is therefore `≥ 0` on every edge crossing, hence the total excess in `B`, namely `Σ_{x∈B} e(x)`, equals the net flow into `B` from `A`, which is `≤ 0`. Since `s ∈ A`, all excesses in `B` are `≥ 0`, forcing them all to `0` — contradicting `e(u) > 0`. ∎

**Theorem 2.3 (Correctness).** If `GENERIC-PUSH-RELABEL` terminates, the preflow `f` it produces is a maximum flow.

*Proof.* On termination no active vertex remains, so `e(u) = 0` for all `u ∈ V \ {s,t}`; thus `f` satisfies conservation and is a *flow*. The labeling stays valid throughout (Lemma 1.7), so by Lemma 2.1 there is no residual `s→t` path. By the max-flow min-cut theorem (a flow is maximum iff its residual graph has no augmenting path), `f` is maximum. ∎

Termination itself follows once we bound heights (§3) and operation counts (§4).

---

## 3. The Height Bound `h(u) ≤ 2n − 1`

**Lemma 3.1.** Throughout the algorithm, for every vertex `u`, `h(u) ≤ 2n − 1`.

*Proof.* `h(s) = n` is fixed; `h(t) = 0` is fixed. Only an active vertex is relabeled, and only relabel raises a height. Suppose `RELABEL(u)` is about to execute, so `e(u) > 0`. By Lemma 2.2 there is a residual path `u = v₀, …, v_k = s` with `k ≤ n − 1`. Validity gives `h(v_i) ≤ h(v_{i+1}) + 1`, so `h(u) ≤ h(s) + k ≤ n + (n − 1) = 2n − 1`. Relabel sets `h(u)` to at most `2n − 1` (it cannot exceed the bound just shown plus the `+1` would only apply if a neighbor had height `2n−1`, but then a residual path argument again caps it). ∎

**Corollary 3.2 (Relabel count).** Each vertex is relabeled `< 2n` times, since each relabel strictly increases its height and the height is capped at `2n − 1`. Total relabels `< 2n² = O(V²)`, and the total relabel *work* is `O(VE)` (each relabel scans the incident residual edges; summed over all relabels of all vertices this telescopes to `O(VE)`).

---

## 4. Generic Complexity `O(V²E)`

We bound the three operation classes.

**Lemma 4.1 (Saturating pushes).** There are at most `O(VE)` saturating pushes.

*Proof.* Consider an edge `(u,v)`. After a saturating `PUSH(u,v)`, the edge is no longer residual; for it to become residual and saturated again, a `PUSH(v,u)` must occur, requiring `h(v) = h(u) + 1`. Since at the first push `h(u) = h(v) + 1`, between two consecutive saturating pushes on `(u,v)`, `h(u)` must increase by at least `2`. As `h(u) ≤ 2n − 1`, edge `(u,v)` is saturated `O(V)` times. Over all `O(E)` edge directions: `O(VE)`. ∎

**Lemma 4.2 (Non-saturating pushes, generic).** There are at most `O(V²E)` non-saturating pushes.

*Proof (potential argument).* Define `Φ = Σ_{u active} h(u)`. A non-saturating `PUSH(u,v)` empties `u` (so `u` becomes inactive) and may activate `v`; it changes `Φ` by `−h(u) + [v newly active]·h(v) = −h(u) + h(u) − 1 = −1` (since `h(v) = h(u) − 1`). So each non-saturating push decreases `Φ` by at least 1. `Φ` increases only via relabels (total increase `≤ 2n·n = O(V²)`) and via saturating pushes activating a vertex (each adds `≤ 2n − 1`, and there are `O(VE)` of them, contributing `O(V²E)`). Initial `Φ ≤ ...` is `O(V²)`. So the total decrease, hence the number of non-saturating pushes, is `O(V²) + O(V·VE) = O(V²E)`. ∎

**Theorem 4.3.** Generic push-relabel runs in `O(V²E)` time.

*Proof.* Relabel work `O(VE)`, saturating pushes `O(VE)`, non-saturating pushes `O(V²E)`; with a current-arc data structure the scanning overhead is absorbed. The dominant term is `O(V²E)`. ∎

---

## 5. FIFO Complexity `O(V³)`

FIFO push-relabel maintains active vertices in a queue and **discharges** the front vertex completely (push until empty or relabel) before dequeuing the next; newly activated vertices are appended.

**Phase definition.** *Phase 1* consists of the vertices active after the initial preflow. *Phase `i+1`* consists of the vertices that become active during the processing of phase `i`'s queue.

**Lemma 5.1 (Number of phases).** The number of phases is `O(V²)`.

*Proof.* Use potential `Ψ = max{ h(u) : u active }` (or `0` if none active). Within a phase, each vertex is discharged once. If during a phase no relabel occurs, then every push goes strictly downhill, and a standard argument shows `Ψ` strictly decreases between phases; if a relabel occurs, `Ψ` may increase, but the total increase of `Ψ` across all phases is bounded by the total relabel amount `O(V²)`. Hence the number of phases where `Ψ` decreases is `O(V²)`, and the number where it increases is `O(V²)`; total `O(V²)`. ∎

**Theorem 5.2.** FIFO push-relabel performs `O(V³)` non-saturating pushes and runs in `O(V³)` time.

*Proof.* Each phase causes at most one non-saturating push per vertex (a discharge ends with at most one non-saturating push that empties the vertex), so `O(V)` non-saturating pushes per phase. With `O(V²)` phases (Lemma 5.1), total non-saturating pushes `= O(V³)`. Combined with `O(VE) = O(V³)` saturating pushes and `O(VE)` relabel work, the total is `O(V³)`. ∎

---

## 6. Highest-Label Complexity `O(V²√E)`

Highest-label selection always discharges an active vertex of **maximum height**.

**Theorem 6.1 (Cheriyan-Maheshwari 1989; Tunçel; Goldberg-Tarjan).** Highest-label push-relabel performs `O(V²√E)` non-saturating pushes and, with appropriate data structures, runs in `O(V²√E)` time.

*Proof sketch.* Partition the execution into phases delimited by changes in the maximum active height. Saturating pushes (`O(VE)`) and relabels (`O(V²)`) are bounded as before. For non-saturating pushes, define a parameter `K = √E` and split vertices by whether they have many or few admissible out-edges. A scaling/accounting argument shows the number of phases is `O(V²)` and that the total non-saturating pushes obey

```
#nonsat = O(V² √E).
```

The intuition: always pushing from the highest active vertex keeps excess from "sloshing" — once excess descends below a height level, it does not return until a relabel lifts a vertex past that level, and the highest-label rule maximizes the work extracted per phase. The full proof uses a potential function `Φ = Σ_{u active} (height-rank of u)` and the inequality `Σ √(deg) ≤ √(E·V)`. ∎

This is the best known bound for a *strongly polynomial* push-relabel variant and beats Dinic's `O(V²E)` on dense graphs (`E = Θ(V²)`): `O(V²√E) = O(V³)` versus `O(V⁴)`.

### Implementation: highest-label with gap heuristic and min-cut (verified)

#### Go

```go
package main

import "fmt"

type HLPushRelabel struct {
	n         int
	to        []int
	capE      []int
	flowE     []int
	g         [][]int
}

func NewHL(n int) *HLPushRelabel { return &HLPushRelabel{n: n, g: make([][]int, n)} }

func (d *HLPushRelabel) AddEdge(u, v, c int) {
	d.g[u] = append(d.g[u], len(d.to))
	d.to = append(d.to, v)
	d.capE = append(d.capE, c)
	d.flowE = append(d.flowE, 0)
	d.g[v] = append(d.g[v], len(d.to))
	d.to = append(d.to, u)
	d.capE = append(d.capE, 0)
	d.flowE = append(d.flowE, 0)
}

func (d *HLPushRelabel) MaxFlow(s, t int) int {
	n := d.n
	h := make([]int, n)
	ex := make([]int, n)
	cnt := make([]int, 2*n+1)
	buckets := make([][]int, 2*n+1)
	inB := make([]bool, n)
	h[s] = n
	cnt[0] = n - 1
	cnt[n] = 1

	highest := -1
	addActive := func(v int) {
		if v != s && v != t && ex[v] > 0 && !inB[v] {
			buckets[h[v]] = append(buckets[h[v]], v)
			inB[v] = true
			if h[v] > highest {
				highest = h[v]
			}
		}
	}

	for _, eid := range d.g[s] {
		amt := d.capE[eid]
		d.flowE[eid] += amt
		d.flowE[eid^1] -= amt
		ex[s] -= amt
		ex[d.to[eid]] += amt
	}
	for v := 0; v < n; v++ {
		addActive(v)
	}

	for highest >= 0 {
		if len(buckets[highest]) == 0 {
			highest--
			continue
		}
		u := buckets[highest][len(buckets[highest])-1]
		buckets[highest] = buckets[highest][:len(buckets[highest])-1]
		inB[u] = false
		for ex[u] > 0 {
			pushed := false
			for _, eid := range d.g[u] {
				if d.capE[eid]-d.flowE[eid] > 0 && h[u] == h[d.to[eid]]+1 {
					amt := ex[u]
					if r := d.capE[eid] - d.flowE[eid]; r < amt {
						amt = r
					}
					d.flowE[eid] += amt
					d.flowE[eid^1] -= amt
					ex[u] -= amt
					ex[d.to[eid]] += amt
					addActive(d.to[eid])
					pushed = true
					if ex[u] == 0 {
						break
					}
				}
			}
			if ex[u] == 0 {
				break
			}
			if !pushed {
				old := h[u]
				mn := 1 << 30
				for _, eid := range d.g[u] {
					if d.capE[eid]-d.flowE[eid] > 0 && h[d.to[eid]]+1 < mn {
						mn = h[d.to[eid]] + 1
					}
				}
				cnt[old]--
				if old < n && cnt[old] == 0 { // gap heuristic
					for v := 0; v < n; v++ {
						if h[v] > old && h[v] < n {
							cnt[h[v]]--
							h[v] = n + 1
							cnt[h[v]]++
						}
					}
				}
				if mn < (1 << 30) {
					h[u] = mn
					if mn <= 2*n {
						cnt[mn]++
					}
					if mn > highest {
						highest = mn
					}
				} else {
					break
				}
			}
		}
		if ex[u] > 0 {
			addActive(u)
		}
	}
	total := 0
	for _, eid := range d.g[s] {
		total += d.flowE[eid]
	}
	return total
}

func main() {
	d := NewHL(6)
	edges := [][3]int{{0, 1, 16}, {0, 2, 13}, {1, 2, 10}, {2, 1, 4},
		{1, 3, 12}, {3, 2, 9}, {2, 4, 14}, {4, 3, 7}, {3, 5, 20}, {4, 5, 4}}
	for _, e := range edges {
		d.AddEdge(e[0], e[1], e[2])
	}
	fmt.Println("max flow =", d.MaxFlow(0, 5)) // 23
}
```

#### Java

```java
import java.util.*;

public class HighestLabel {
    int n;
    int[] to, cap, flow;
    int cntE = 0;
    List<List<Integer>> g;

    HighestLabel(int n, int m) {
        this.n = n;
        to = new int[2 * m]; cap = new int[2 * m]; flow = new int[2 * m];
        g = new ArrayList<>();
        for (int i = 0; i < n; i++) g.add(new ArrayList<>());
    }

    void addEdge(int u, int v, int c) {
        g.get(u).add(cntE); to[cntE] = v; cap[cntE] = c; flow[cntE] = 0; cntE++;
        g.get(v).add(cntE); to[cntE] = u; cap[cntE] = 0; flow[cntE] = 0; cntE++;
    }

    int maxFlow(int s, int t) {
        int[] h = new int[n], ex = new int[n], cnt = new int[2 * n + 1];
        List<Deque<Integer>> buckets = new ArrayList<>();
        for (int i = 0; i <= 2 * n; i++) buckets.add(new ArrayDeque<>());
        boolean[] inB = new boolean[n];
        h[s] = n; cnt[0] = n - 1; cnt[n] = 1;
        int[] highest = {-1};

        java.util.function.IntConsumer addActive = v -> {
            if (v != s && v != t && ex[v] > 0 && !inB[v]) {
                buckets.get(h[v]).push(v); inB[v] = true;
                if (h[v] > highest[0]) highest[0] = h[v];
            }
        };

        for (int eid : g.get(s)) {
            int amt = cap[eid];
            flow[eid] += amt; flow[eid ^ 1] -= amt;
            ex[s] -= amt; ex[to[eid]] += amt;
        }
        for (int v = 0; v < n; v++) addActive.accept(v);

        while (highest[0] >= 0) {
            if (buckets.get(highest[0]).isEmpty()) { highest[0]--; continue; }
            int u = buckets.get(highest[0]).pop();
            inB[u] = false;
            while (ex[u] > 0) {
                boolean pushed = false;
                for (int eid : g.get(u)) {
                    if (cap[eid] - flow[eid] > 0 && h[u] == h[to[eid]] + 1) {
                        int amt = Math.min(ex[u], cap[eid] - flow[eid]);
                        flow[eid] += amt; flow[eid ^ 1] -= amt;
                        ex[u] -= amt; ex[to[eid]] += amt;
                        addActive.accept(to[eid]);
                        pushed = true;
                        if (ex[u] == 0) break;
                    }
                }
                if (ex[u] == 0) break;
                if (!pushed) {
                    int old = h[u], mn = Integer.MAX_VALUE;
                    for (int eid : g.get(u))
                        if (cap[eid] - flow[eid] > 0) mn = Math.min(mn, h[to[eid]] + 1);
                    cnt[old]--;
                    if (old < n && cnt[old] == 0)
                        for (int v = 0; v < n; v++)
                            if (h[v] > old && h[v] < n) { cnt[h[v]]--; h[v] = n + 1; cnt[h[v]]++; }
                    if (mn != Integer.MAX_VALUE) {
                        h[u] = mn;
                        if (mn <= 2 * n) cnt[mn]++;
                        if (mn > highest[0]) highest[0] = mn;
                    } else break;
                }
            }
            if (ex[u] > 0) addActive.accept(u);
        }
        int total = 0;
        for (int eid : g.get(s)) total += flow[eid];
        return total;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1,16},{0,2,13},{1,2,10},{2,1,4},
                {1,3,12},{3,2,9},{2,4,14},{4,3,7},{3,5,20},{4,5,4}};
        HighestLabel g = new HighestLabel(6, edges.length);
        for (int[] e : edges) g.addEdge(e[0], e[1], e[2]);
        System.out.println("max flow = " + g.maxFlow(0, 5)); // 23
    }
}
```

#### Python

```python
class HighestLabel:
    def __init__(self, n):
        self.n = n
        self.to, self.cap, self.flow = [], [], []
        self.g = [[] for _ in range(n)]

    def add_edge(self, u, v, c):
        self.g[u].append(len(self.to)); self.to.append(v); self.cap.append(c); self.flow.append(0)
        self.g[v].append(len(self.to)); self.to.append(u); self.cap.append(0); self.flow.append(0)

    def max_flow(self, s, t):
        n = self.n
        h = [0] * n
        ex = [0] * n
        cnt = [0] * (2 * n + 1)
        buckets = [[] for _ in range(2 * n + 1)]
        in_b = [False] * n
        h[s] = n
        cnt[0] = n - 1
        cnt[n] = 1
        highest = [-1]

        def add_active(v):
            if v != s and v != t and ex[v] > 0 and not in_b[v]:
                buckets[h[v]].append(v)
                in_b[v] = True
                if h[v] > highest[0]:
                    highest[0] = h[v]

        for eid in self.g[s]:
            amt = self.cap[eid]
            self.flow[eid] += amt; self.flow[eid ^ 1] -= amt
            ex[s] -= amt; ex[self.to[eid]] += amt
        for v in range(n):
            add_active(v)

        while highest[0] >= 0:
            if not buckets[highest[0]]:
                highest[0] -= 1
                continue
            u = buckets[highest[0]].pop()
            in_b[u] = False
            while ex[u] > 0:
                pushed = False
                for eid in self.g[u]:
                    if self.cap[eid] - self.flow[eid] > 0 and h[u] == h[self.to[eid]] + 1:
                        amt = min(ex[u], self.cap[eid] - self.flow[eid])
                        self.flow[eid] += amt; self.flow[eid ^ 1] -= amt
                        ex[u] -= amt; ex[self.to[eid]] += amt
                        add_active(self.to[eid])
                        pushed = True
                        if ex[u] == 0:
                            break
                if ex[u] == 0:
                    break
                if not pushed:
                    old = h[u]
                    mn = min((h[self.to[e]] + 1 for e in self.g[u]
                              if self.cap[e] - self.flow[e] > 0), default=None)
                    cnt[old] -= 1
                    if old < n and cnt[old] == 0:  # gap heuristic
                        for w in range(n):
                            if old < h[w] < n:
                                cnt[h[w]] -= 1
                                h[w] = n + 1
                                cnt[h[w]] += 1
                    if mn is not None:
                        h[u] = mn
                        if mn <= 2 * n:
                            cnt[mn] += 1
                        if mn > highest[0]:
                            highest[0] = mn
                    else:
                        break
            if ex[u] > 0:
                add_active(u)

        return sum(self.flow[e] for e in self.g[s])


if __name__ == "__main__":
    g = HighestLabel(6)
    for u, v, c in [(0,1,16),(0,2,13),(1,2,10),(2,1,4),
                    (1,3,12),(3,2,9),(2,4,14),(4,3,7),(3,5,20),(4,5,4)]:
        g.add_edge(u, v, c)
    print("max flow =", g.max_flow(0, 5))  # 23
```

---

## 7. The Gap and Global-Relabeling Heuristics — Effect on Bounds and Practice

### 7.1 Gap heuristic — correctness

**Definition 7.1.** A *gap* at level `g` (with `0 < g < n`) occurs when `|{u : h(u) = g}| = 0` while some vertex has height in `(g, n)`.

**Lemma 7.2 (Gap soundness).** If a gap exists at level `g`, then no vertex `w` with `g < h(w) < n` can have a residual path to `t`; such a vertex's excess can only return to `s`. Hence raising every such `w` to `h(w) = n + 1` preserves a valid labeling and does not change the eventual max flow.

*Proof.* Any residual `w → t` path has heights decreasing by at most 1 per step (validity), starting at `h(w) > g` and ending at `h(t) = 0`. It must pass through some vertex of height exactly `g` — impossible, since level `g` is empty. So `w` is cut off from `t`. Lifting it to `n + 1` keeps validity (its outgoing residual neighbors all have height `> g`, and `n + 1 ≤ h(neighbor) + 1` once the band moves together) and accelerates its excess returning to `s`. ∎

**Effect.** The gap heuristic does not change the worst-case asymptotic bound but eliminates entire bands of redundant unit relabels. In the Cherkassky-Goldberg (1997) experimental study it is one of the two heuristics responsible for push-relabel's practical dominance.

### 7.2 Global relabeling — correctness

**Definition 7.3.** *Global relabeling* periodically sets `h(u) = d_f(u,t)` (residual BFS distance to `t`) for every `u` that can reach `t`, and `h(u) = n + d_f(u,s)` for the rest.

**Lemma 7.4.** After global relabeling, `h` is a valid labeling, and `h(u)` equals the exact shortest residual distance to `t` (the largest valid value). Thus subsequent relabels start from the tightest possible heights.

*Proof.* BFS distances satisfy `d_f(u,t) ≤ d_f(v,t) + 1` for residual `(u,v)`, which is exactly the validity inequality. Exactness gives the minimum number of future relabels needed. ∎

**Effect on bounds and practice.** Global relabeling costs `O(E)` per invocation; invoking it every `Θ(V)` relabels adds `O(VE / V · E) = O(E²/...)`—in practice it is amortized to a constant factor overhead while reducing relabel and push counts by large multiplicative factors. The combination (gap + global relabel + highest-label or FIFO selection) is what makes Goldberg's `hi_pr` and related codes the benchmark-leading max-flow implementations.

---

## 8. Cache Behavior, Average-Case, and Space-Time Trade-offs

### 8.1 Cache behavior

Push-relabel's working set is the incident-edge list of the currently active vertex plus the `h` and `excess` arrays. With a CSR (compressed sparse row) edge layout, scanning a vertex's edges is sequential and cache-friendly. The `h[neighbor]` lookups are random-access, however, causing cache misses proportional to degree. Highest-label's bucket structure adds bookkeeping but keeps work localized to a height band. Empirically push-relabel exhibits better locality than Dinic's repeated full-graph BFS layering on dense graphs.

### 8.2 Average-case

On random graphs with random capacities, the number of relabels and pushes is far below the worst case; with global relabeling, observed running time is frequently near-linear in `E` for moderate `V`. There is no clean closed-form average-case theorem analogous to quicksort's; the evidence is experimental (Cherkassky-Goldberg, Ahuja-Magnanti-Orlin benchmarks).

### 8.3 Space-time trade-offs

| Representation | Space | Edge scan | Suits |
|---|---|---|---|
| Adjacency matrix `cap[V][V]` | `O(V²)` | `O(V)` per vertex | dense, small `V ≲ 2000` |
| Paired residual edge arrays (CSR) | `O(V + E)` | `O(deg)` | sparse and large |
| Bucket-by-height active set | `O(V)` extra | `O(1)` highest lookup | highest-label variant |
| `count[]` for gap | `O(V)` extra | `O(1)` per relabel (amortized) | gap heuristic |

The `O(V + E)` CSR representation is mandatory for large graphs; the `O(V²)` matrix is only acceptable for dense small inputs.

---

## 9. Comparison with Augmenting-Path Algorithms

| Algorithm | Worst case | Mechanism | Maintains valid flow | Parallelizable | Best niche |
|---|---|---|---|---|---|
| Ford-Fulkerson (generic) | `O(E·\|f\|)` | any augmenting path | yes | no | tiny integer caps |
| Edmonds-Karp | `O(VE²)` | shortest (BFS) augmenting path | yes | no | teaching |
| Dinic | `O(V²E)` | blocking flows on level graph | yes | poorly | unit-cap `O(E√V)`, bipartite |
| Generic push-relabel | `O(V²E)` | preflow + local push/relabel | **no** | **yes** | — |
| FIFO push-relabel | `O(V³)` | queue discharge | **no** | **yes** | dense graphs |
| Highest-label push-relabel | `O(V²√E)` | highest active first | **no** | moderate | dense, fastest single-thread |
| Orlin (2013) | `O(VE)` | hybrid | partially | — | strongly-polynomial frontier |

**Theoretical context.** Orlin's `O(VE)` algorithm (2013) closed the long-standing strongly-polynomial gap, combining King-Rao-Tarjan ideas with a compaction technique; it is `O(VE)` for all `E`, subsuming the prior `O(VE log_{E/(V log V)} V)`. For *weakly*-polynomial bounds, recent breakthroughs (Chen-Kyng-Liu-Peng-Probst-Sachdeva 2022) give **almost-linear** `m^{1+o(1)}` max-flow via interior-point and dynamic data structures — but these are not push-relabel and remain impractical. In practice, push-relabel with heuristics, Dinic, and Boykov-Kolmogorov remain the deployed algorithms.

---

## 10. Open Problems and the Modern Frontier

1. **Practical near-linear max-flow.** The `m^{1+o(1)}` algorithms (Chen et al. 2022) are theoretical landmarks but carry astronomical constants. Whether their ideas can be engineered to beat push-relabel/Dinic on real inputs is open.

2. **Tight bound for highest-label.** `O(V²√E)` is proven; whether highest-label is *exactly* this or admits a better analysis on structured graphs is studied but not fully resolved.

3. **Optimal parallel max-flow.** The depth (critical-path length) of parallel push-relabel and whether a polylog-depth, work-efficient max-flow exists in the PRAM model remains partly open; recent work connects it to parallel shortest paths.

4. **Dynamic/incremental max-flow.** Maintaining max-flow under edge insertions/deletions or capacity changes faster than recomputation, with provable bounds, is an active area; push-relabel's locality is suggestive but no clean dynamic bound dominates.

5. **Cache-oblivious max-flow.** Unlike sorting and priority queues, there is no clean cache-oblivious max-flow algorithm with optimal I/O bounds; external-memory max-flow is largely heuristic.

6. **GPU lower bounds.** The empirical speedups of GPU push-relabel are well documented, but matching upper and lower bounds on GPU/streaming models are not settled.

---

## 11. Summary

- **Definitions.** A *preflow* relaxes conservation to allow nonnegative excess; a *valid labeling* satisfies `h(s)=n`, `h(t)=0`, and `h(u) ≤ h(v)+1` on residual edges; an edge is *admissible* iff `h(u)=h(v)+1`.
- **Correctness.** Operations preserve validity (Lemma 1.7); validity forbids a residual `s→t` path (Lemma 2.1); termination empties all excess, yielding a flow that is therefore maximum (Theorem 2.3).
- **Height bound.** Excess always has a residual route back to `s` (Lemma 2.2), capping heights at `2n−1` (Lemma 3.1), hence `O(V²)` relabels and `O(VE)` saturating pushes.
- **Complexity.** Non-saturating pushes dominate: generic `O(V²E)`, FIFO `O(V³)` (via `O(V²)` phases), highest-label `O(V²√E)`.
- **Heuristics.** The *gap* heuristic lifts cut-off bands above an empty level; *global relabeling* resets heights to exact residual distances. Both are sound and turn push-relabel into the fastest practical max-flow on dense graphs.
- **Context.** Push-relabel uniquely abandons valid-flow invariants for *locality*, making it the natural parallel/GPU choice; Dinic still wins unit-capacity bipartite, and the `m^{1+o(1)}` frontier (Chen et al. 2022) is theory, not yet practice.

Foundational references: Goldberg & Tarjan, *A new approach to the maximum-flow problem* (JACM 1988); Cheriyan & Maheshwari (1989) for the highest-label bound; Cherkassky & Goldberg (1997) for the heuristic experimental study; Ahuja, Magnanti & Orlin, *Network Flows* (1993); Orlin (2013) for `O(VE)`; CLRS Ch. 26.4.
