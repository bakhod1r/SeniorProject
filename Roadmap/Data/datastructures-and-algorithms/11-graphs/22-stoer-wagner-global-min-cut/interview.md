# Stoer-Wagner Global Minimum Cut — Interview Preparation

Stoer-Wagner is a favorite "advanced graph" interview topic because it is short enough to write on a whiteboard, deep enough to probe whether you truly understand cuts (versus flows), and full of subtle traps — undirected-only, non-negative-only, "the cut-of-the-phase is a min `s-t` cut" — that separate candidates who memorized the loop from those who understand *why* it works. This file is a curated bank of questions by seniority, plus a full coding challenge with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | Global minimum cut (undirected, weighted) |
| Time (array) | `O(V³)` |
| Time (heap) | `O(V·E + V² log V)` |
| Space | `O(V²)` (matrix) |
| Negative weights | **Not** supported |
| Directed graphs | **Not** supported |
| Phases | `V-1` |
| Per phase | One maximum-adjacency scan, `O(V²)` |
| Answer | Smallest cut-of-the-phase over all phases |
| Key invariant | Cut-of-the-phase `= min s-t cut` for last two vertices |

Core loop:

```text
best = min weighted degree
repeat V-1 times:
    grow A by maximum adjacency (always add max w(A,v))
    s, t = last two added
    best = min(best, w(A, t))   // cut-of-the-phase
    merge s and t
return best
```

---

## Junior Questions (12 Q&A)

### J1. What problem does Stoer-Wagner solve?
It finds the **global minimum cut** of an undirected, non-negatively weighted graph — the cheapest way to split all vertices into two non-empty groups, where "cost" is the total weight of edges crossing between the groups. Unlike an `s-t` min cut, it fixes *no* source or sink; the two sides can be any partition.

### J2. What is the time and space complexity?
The array (matrix) version is `O(V³)` time — `V-1` phases, each `O(V²)` — and `O(V²)` space for the adjacency matrix. A heap-based version is `O(V·E + V² log V)`.

### J3. What is a "cut" and its "weight"?
A cut partitions vertices into two non-empty sets `(S, V\S)`. Its weight is the sum of weights of all edges with one endpoint in `S` and the other in `V\S`.

### J4. How is global min cut different from `s-t` min cut?
An `s-t` cut must keep a fixed `s` on one side and a fixed `t` on the other. The global min cut has no fixed vertices — it is the minimum over *all* partitions, equivalently the minimum `s-t` cut over all pairs `(s, t)`.

### J5. Why not just use max-flow / min-cut?
Max-flow gives a min cut for a *fixed* `s` and `t`. For the global cut you would run `V-1` max-flow computations (fix one source, try every sink) and take the best. Stoer-Wagner replaces all those flows with `V-1` cheap maximum-adjacency scans and never computes a flow.

### J6. What is a "minimum cut phase"?
One round of the algorithm: grow a set `A` one vertex at a time, always adding the vertex most strongly connected to `A`; the cut isolating the last vertex added is recorded (the cut-of-the-phase); then the last two added vertices are merged.

### J7. What is the maximum-adjacency ordering?
An ordering where each next vertex is the one with the largest total edge weight `w(A, v)` to the already-chosen set `A`. It is like Prim's MST but the key is the *sum* of all edges to `A`, not a single cheapest edge.

### J8. What is the cut-of-the-phase?
The cut that isolates the **last vertex `t`** added during a phase: `({t}, rest)`. Its weight is `w(A, t)` at the moment `t` joins.

### J9. What does merging two vertices do?
It fuses `s` and `t` into one super-vertex; edges to a shared neighbor `x` are combined by **adding** their weights (`w(s,x) + w(t,x)`).

### J10. Why merge after each phase?
Because we have already found the best cut that *separates* `s` and `t`. From then on we only need cuts that keep them *together*, which merging enforces. After `V-1` merges, we have covered enough pairs to guarantee the global optimum was recorded.

### J11. Does it work on directed graphs?
No. Stoer-Wagner requires an **undirected** graph (symmetric weights). The correctness proof relies on symmetry.

### J12. Does it handle negative edge weights?
No. The correctness proof requires **non-negative** weights. Negative weights break the cut-of-the-phase guarantee.

### J13. How many phases does the algorithm run, and why?
Exactly `V-1`. Each phase merges two vertices into one, reducing the vertex count by one; after `V-1` merges only a single super-vertex remains. The global minimum is guaranteed to appear among the `V-1` recorded cut-of-the-phase values.

### J14. After the algorithm finishes, what is the answer?
The **smallest** cut-of-the-phase weight recorded across all `V-1` phases. Not the last one — the minimum over all of them.

### J15. Give a one-sentence analogy for the algorithm.
Keep inviting whoever has the most friends already in the room; the last person pulled in is the cheapest to wall off; if two people turn out inseparable, give them one name tag and continue — the cheapest wall-off you ever saw is the answer.

---

## Middle Questions (12 Q&A)

### M1. State the cut-of-the-phase lemma.
In a maximum-adjacency ordering, let `s` and `t` be the last two vertices added. Then the cut isolating `t`, `({t}, V\{t})`, is a **minimum `s-t` cut** of the current graph. Equivalently, of all cuts separating `s` from `t`, simply isolating `t` is the cheapest.

### M2. Why is merging correct?
The global min cut either separates `s` and `t` — in which case its weight is `≥` the min `s-t` cut, which we just recorded — or it keeps them together — in which case merging `s` and `t` preserves it with the same weight. Either way we lose no candidate. (`λ(G) = min(c(s,t), λ(G/{s,t}))`.)

### M3. Why must the start vertex of a phase not matter?
The lemma holds for *any* fixed start vertex — the proof never uses which vertex is `a₁`. Different starts may produce different `(s, t)` pairs, but each phase still yields a valid min `s-t` cut, and over `V-1` phases the global optimum is still guaranteed to appear.

### M4. How do you recover the actual partition, not just the weight?
Track, for each super-vertex, the set of original vertices fused into it (`groups`). When a phase sets a new global best, the isolated side is the group of the last vertex `t`. On merge, union `groups[t]` into `groups[s]`.

### M5. What is the minimum weighted degree, and why seed `best` with it?
The minimum weighted degree is the smallest sum of incident edge weights over all vertices. Isolating that vertex is itself a valid cut, so it is an immediate **upper bound** on the global min cut — a safe initial value for `best` and a sanity check.

### M6. When does the heap variant help?
On **sparse** graphs (`E ≈ V`): a max-priority-queue makes selecting the max-`w(A,v)` vertex `O(log V)` instead of `O(V)`, giving `O(V·E + V² log V)` overall. On dense graphs the array version's low constant usually wins.

### M7. How does Stoer-Wagner relate to Prim's MST?
Both greedily extend a set by the locally-best key. Prim picks the vertex reachable by the single cheapest edge; Stoer-Wagner picks the vertex with the largest *total* connection weight to the set. Same frontier structure, different key, different (cut vs tree) purpose.

### M8. What is the edge connectivity of an unweighted graph in these terms?
Set all weights to `1` and run Stoer-Wagner; the global min cut weight equals the **edge connectivity** `λ(G)` — the minimum number of edges whose removal disconnects the graph.

### M9. What happens on a disconnected graph?
The global min cut is `0` — you can isolate a disconnected component for free. Stoer-Wagner returns `0` correctly because some `w(A, t)` will be `0`.

### M10. How do you handle parallel edges and self-loops?
Sum parallel edges into a single matrix cell. Ignore self-loops (the diagonal stays `0`) — a self-edge never crosses a cut.

### M11. Why is the algorithm sometimes called "deterministic global min cut"?
Because it always returns the exact optimum with no randomness — unlike Karger's contraction algorithm, which is Monte Carlo and must be repeated to boost its success probability.

### M12. What is a "degenerate" cut and why is it a problem for clustering?
The exact global min cut often isolates a single weakly-connected vertex (`{v}` vs rest). For clustering/segmentation you usually want a *balanced* split, so vanilla Stoer-Wagner output may be useless — you add size constraints or switch to a normalized-cut objective.

### M13. Does the choice of start vertex in each phase affect the result?
No — correctness holds for any start vertex; the cut-of-the-phase proof never uses which vertex is `a₁`. Different starts may pick different `(s, t)` pairs and even different intermediate cuts, but the global minimum still appears across the `V-1` phases.

### M14. How do you cross-validate an implementation?
Write a brute-force checker that tries every non-empty proper subset (`O(2^V)`) and computes its cut weight; assert it equals Stoer-Wagner on random graphs with `V ≤ 12`. Add property tests: cut ≤ min weighted degree, both partition sides non-empty, cut ≥ 0.

### M15. Why update *every* remaining vertex's key when one joins `A`?
Because `w(A, v)` is the sum of edges from `v` to the *entire* set `A`. When a new vertex `sel` enters `A`, each remaining `v` gains exactly the edge `w(sel, v)` toward `A`, so `key[v] += w[sel][v]`. Skipping this makes the next `argmax` wrong.

---

## Senior Questions (10 Q&A)

### S1. Design a network-reliability monitor around global min cut.
Build the topology graph (capacities = weights), run Stoer-Wagner on a snapshot to get the weighted edge connectivity, cache the result, and alert when it drops below a safety threshold. Recompute only on topology change (debounced); separate the build worker from a stateless query tier that serves the cached cut.

### S2. The graph has 100k vertices and is sparse. Now what?
Vanilla dense `O(V³)` is infeasible (`10¹⁵` ops, `V²` memory). Use the heap variant on adjacency lists — but note the `V² log V` term still bites. Often better: shrink `V` first (superpixels/supernodes, safe Padberg-Rinaldi contractions) or switch to Karger-Stein (`O(V² log³ V)`, randomized) or Hao-Orlin.

### S3. How do you parallelize Stoer-Wagner?
Phases are inherently sequential (each operates on the post-merge graph). But within a phase, the key-update `key[v] += w[sel][v]` over all remaining vertices is embarrassingly parallel (SIMD/GPU vector add), and the argmax is a parallel reduction. Recursive bisection of disjoint sub-clusters also parallelizes across workers.

### S4. Array vs heap — how do you decide in production?
By density. Dense (`E ≈ V²`, matrix fits): array — cache-friendly, low constant, `O(V³)`. Sparse (`E ≈ V`): heap on adjacency lists, `O(V·E + V² log V)`, lower memory. Measure the crossover on your hardware.

### S5. You need `k` clusters, not 2. How do you use Stoer-Wagner?
Recursive bisection: cut into two, then recursively cut each side until you have `k` clusters or a stopping rule fires (cut weight threshold, min size). Beware degenerate cuts; add size constraints or use it as a subroutine inside a balanced-partition heuristic.

### S6. How do you keep the cut fresh as edges change?
Topology changes are usually infrequent vs queries. Debounce/batch changes, recompute on a schedule or on change, publish a versioned immutable artifact, and serve the last good cut in between. Full incremental min-cut maintenance is hard; most systems recompute.

### S7. What should you monitor?
`min_cut_build_seconds` (cubic cost), `graph_vertices` and `density` (drive the cost and variant choice), `current_min_cut_weight` (the reliability signal), `partition_balance` (degenerate-cut detector), `cut_cache_hit_ratio`, and `recompute_rate` (are you redoing identical work?).

### S8. How does it apply to image segmentation, and why isn't the dense version used?
Pixels are vertices; edges connect neighbors with similarity weights; a min cut separates regions. The pixel grid is sparse and `V = N²` is huge, so production uses specialized max-flow (Boykov-Kolmogorov) or superpixel pre-aggregation rather than the dense `O(V³)` array version.

### S9. What are the failure modes in production?
Degenerate single-vertex cuts (clustering), asymmetric/directed input slipping through (silent wrong answers), negative weights (proof fails), `O(V²)` memory blow-up at large `V`, recompute storms on frequent edge changes, and silent SLA breaches when `V` grows (cubic blowup).

### S10. Compare Stoer-Wagner with Karger-Stein at scale.
Stoer-Wagner is deterministic and exact but `O(V³)` / `O(V·E + V² log V)`. Karger-Stein is `O(V² log³ V)`, faster on large graphs, but Monte Carlo — it can miss the min cut with small probability and must be repeated to amplify confidence. Choose by whether you need exactness/determinism or can tolerate a small failure probability for speed.

### S11. How do you reduce `V` before running on a huge graph?
Pre-aggregate obviously-together vertices into supernodes (superpixels in images, communities in social graphs), apply provably-safe Padberg-Rinaldi contractions that never destroy the min cut, or decompose by a known small cut. Running the cubic algorithm on a much smaller contracted graph is often the single biggest win.

### S12. What is the one-sided monotonicity property and how do you exploit it?
Increasing an edge weight (or adding an edge) can only keep or raise the global min cut; decreasing or removing can only keep or lower it. A reliability monitor watching "did connectivity drop below threshold?" therefore only needs a full recompute on weight *decreases* / edge *removals* — weight increases never trip the alert, often cutting recompute frequency by an order of magnitude.

---

## Professional Questions (8 Q&A)

### P1. Prove the cut-of-the-phase is a minimum `s-t` cut (sketch).
Take any `s-t` cut `C`. Call `a_i` "active" if it lands on the opposite side of `C` from its predecessor `a_{i-1}`. By induction over active vertices, `w(A_{i-1}, a_i) ≤ w(C_i)` (the cut restricted to `A_i`), using the MA property (`a_j` was chosen over later vertices) and non-negativity (cut edges contribute `≥ 0`). Applying it to the last vertex `t` (always active in an `s-t` cut) gives `w({t}, rest) ≤ w(C)`, so isolating `t` is a minimum `s-t` cut.

### P2. Where exactly does non-negativity get used?
In the base case and inductive step, "all edges from `a_i` into the relevant prefix cross `C`, so their weight is `≤ w(C_i)`" requires those weights to be non-negative. Negative weights could make `w(A_{i-1}, a_i)` exceed the cut weight and break the bound.

### P3. State and prove the merge lemma.
`λ(G) = min(c_G(s,t), λ(G/{s,t}))`. Any global min cut either separates `s,t` (so its weight is the min `s-t` cut `c_G(s,t)`) or keeps them together (so it equals a cut of the merged graph `G/{s,t}` with the same weight). Both values are realized by valid cuts, so `λ(G)` is their minimum.

### P4. Prove global correctness by induction.
Base `n=2`: one phase yields the only cut `w(u,v) = λ(G)`. Step: a phase computes `c_G(s,t)` (cut-of-the-phase lemma), merges into `G'` (`n-1` vertices), recursion returns `λ(G')` (IH); the algorithm returns `min(c_G(s,t), λ(G')) = λ(G)` by the merge lemma.

### P5. Derive the `O(V³)` time bound.
Phase on `m` vertices: `m` insertions, each an `O(m)` argmax plus `O(m)` key update → `O(m²)`. Summing over phases with `m = n, n-1, …, 2`: `Σ k² = Θ(n³)`.

### P6. Derive the heap-variant bound.
Per phase, `m` extract-max (`O(log m)` each) and `O(E_phase)` key increases (each `O(log m)`); summing over phases gives `O(V·E + V² log V)` with a Fibonacci heap. The `V² log V` term is irreducible because each of `V-1` phases touches `O(V)` heap entries.

### P7. Why is the in-phase start vertex irrelevant to correctness?
The cut-of-the-phase proof fixes `a₁` arbitrarily and never uses its identity. Any start yields a valid min `s-t` cut for that phase's last pair; the merge lemma and induction then hold regardless.

### P8. Contrast with the flow-based global cut and Hao-Orlin.
Flow-based: `λ(G) = min_q c(p, q)` for a fixed `p`, costing `V-1` max-flows. Hao-Orlin folds these into one parametric max-flow (`O(VE log(V²/E))`), competitive on sparse graphs. Stoer-Wagner avoids flow entirely, trading it for the cut-of-the-phase lemma — simpler, `O(V³)` dense.

### P9. Why is the global min cut in P while MAX-CUT is NP-hard?
The cut function `f(S) = w(S, V\S)` is **symmetric and submodular** (`f(S)+f(T) ≥ f(S∪T)+f(S∩T)`), and minimizing a symmetric submodular function is polynomial — Queyranne's algorithm generalizes Stoer-Wagner to any such `f` in `O(V³)` oracle calls. MAX-CUT *maximizes* the same function, which submodularity does not make easy; it is NP-hard. Balanced/normalized cuts add a constraint that also breaks tractability.

### P10. Where exactly is non-negativity used in the cut-of-the-phase proof?
In the inductive bound "every edge from `a_i` into the relevant prefix crosses the cut, so their total weight is `≤ w(C_i)`." This needs those weights to be `≥ 0`; a negative edge could make the left side exceed the cut weight, breaking the inequality and the lemma.

---

## Behavioral / Discussion Prompts

- *"Tell me about a time you chose a simpler algorithm over a more powerful one."* — Stoer-Wagner over a max-flow engine for a global cut: fewer moving parts, easier to verify, fast enough.
- *"How would you validate a min-cut implementation?"* — brute-force subset checker (`O(2^V)`) on `V ≤ 12`, property tests (cut ≤ min weighted degree, both sides non-empty), and known-answer fixtures.
- *"How do you explain a degenerate cut to a non-technical stakeholder?"* — "The cheapest split just snips off one lonely node; that's mathematically optimal but not the meaningful clusters you want — we need to add a balance constraint."
- *"Walk me through a debugging session where the answer was wrong."* — Compare against the brute-force checker on the smallest failing graph; the bug is almost always in the merge (forgot to update both matrix halves) or the key update (skipped a vertex), and the minimal counterexample pinpoints it.
- *"How would you teach this algorithm to a junior?"* — Start from "what is a cut," contrast with `s-t` max-flow, then the party analogy for maximum adjacency, then trace one phase by hand on a 4-vertex graph before any code.

---

## Self-Check Before the Interview

Tick each box; if you cannot do it from memory, re-read the linked level file.

- [ ] State what a cut and its weight are, and how global differs from `s-t` (`junior.md`).
- [ ] Write the `V-1` phase loop and one phase from memory (`junior.md`).
- [ ] Explain the cut-of-the-phase lemma in one sentence and why merging is safe (`middle.md`).
- [ ] Give the array and heap complexities and derive `O(V³)` live (`professional.md`).
- [ ] Name three applications (reliability, segmentation, clustering) and the degenerate-cut caveat (`senior.md`).
- [ ] List the preconditions (undirected, non-negative) and why each matters.
- [ ] Recover the partition, not just the weight, with a `groups` structure.

---

## Rapid-Fire Definitions (10-second answers)

| Term | Crisp answer |
|------|--------------|
| Global min cut | Cheapest partition of vertices into two non-empty sets |
| Cut weight | Sum of weights of edges crossing the partition |
| `s-t` cut | Cut with fixed `s` on one side, `t` on the other |
| Minimum cut phase | One MA-ordering scan that yields a cut-of-the-phase, then a merge |
| Maximum adjacency | Always add the vertex with the largest total weight to `A` |
| `w(A, v)` | Total edge weight from `v` into the current set `A` |
| Cut-of-the-phase | The cut isolating the last vertex added in a phase |
| Merge | Fuse two vertices; add edge weights to shared neighbors |
| Edge connectivity | Global min cut with all weights `= 1` |
| Degenerate cut | A cut that isolates a single weakly-connected vertex |

These are the kinds of one-liners that keep a phone screen moving; pair each with *why* if the interviewer probes.

---

## Common Traps Interviewers Probe

| Trap | The mistake | The correct stance |
|------|-------------|--------------------|
| Confusing with `s-t` min cut | "Just run max-flow" | Global cut fixes no `s`/`t`; that needs `V-1` flows — Stoer-Wagner avoids them |
| Directed input | Applying it to a directed graph | Symmetry is required by the proof; reject or symmetrize |
| Negative weights | "Shift all weights up by a constant" | Shifting changes which cut is minimum; it is not a safe fix |
| Merging the wrong pair | Merging arbitrary or first-two vertices | Merge the **last two added** (`s`, `t`) |
| Recording the wrong value | Using the second-to-last vertex's key | Cut-of-phase = key of the **last** added vertex `t` |
| Stopping early | Returning the first phase's cut | Run all `V-1` phases; take the **minimum** |
| Forgetting key updates | Not adding `w[sel][v]` when a vertex joins | Every remaining key gains the edge to `sel` |
| 32-bit overflow | `int` keys on large weights after merges | Use 64-bit accumulators (`long`/`int64`) |

A candidate who can name *why* each trap is wrong — not just that it is — signals real understanding of the cut-of-the-phase lemma and the merge reduction.

---

## Whiteboard Walkthrough (what interviewers love to see)

Interviewers want you to *trace a phase by hand*, narrating the keys. Practice this on the sample graph `0-1:3, 0-2:1, 1-2:3, 1-3:1, 2-3:5`.

**Phase 1**, start `A = {0}`:

```text
keys:   w(A,1)=3   w(A,2)=1   w(A,3)=0     pick 1 (max)   A={0,1}
update: w(A,2)=1+3=4   w(A,3)=0+1=1        pick 2 (max)   A={0,1,2}
update: w(A,3)=1+5=6 (0+1+5)               pick 3 (last)  A=all
s,t = 2,3.  cut-of-phase = w(A,3) = 6.  best=6.  merge 2,3.
```

After merging 2 and 3 the weights to the super-vertex add: `w(0,{23})=1`, `w(1,{23})=4`.

**Phase 2**, start `A={0}`:

```text
keys: w(A,1)=3  w(A,{23})=1    pick 1   A={0,1}
update: w(A,{23})=1+4=5        pick {23} (last)
s,t = 1,{23}.  cut-of-phase = 5  (partition {0,1} | {2,3}).  best=min(6,5)=5.  merge.
```

**Phase 3**: only `{0}` and `{123}` remain; cut-of-phase = 4 (partition `{0} | {1,2,3}`). `best = 4`.

**Answer:** global min cut = **4**, isolating vertex 0 (edges `0-1:3`, `0-2:1`).

Narrating the keys out loud — "vertex 2's key grows from 1 to 4 once vertex 1 joins A, so 2 is now the most connected" — is exactly what separates a strong answer from a memorized one.

---

## Coding Challenge (3 Languages)

### Challenge: Global Minimum Cut

> **Problem.** Given an undirected weighted graph with `n` vertices (`0..n-1`) and `m` edges `(u, v, w)` with `w ≥ 0`, return the weight of the **global minimum cut** — the minimum total weight of edges whose removal disconnects the graph into two non-empty parts.
>
> **Constraints.** `2 ≤ n ≤ 500`, `0 ≤ w ≤ 10⁹`. Parallel edges should be summed. Self-loops ignored.
>
> **Examples.**
> - `n=4`, edges `{(0,1,3),(0,2,1),(1,2,3),(1,3,1),(2,3,5)}` → `4`.
> - `n=2`, edges `{(0,1,7)}` → `7`.
> - `n=3` (disconnected: edge only `(0,1,5)`) → `0`.

#### Go

```go
package main

import "fmt"

func globalMinCut(n int, edges [][3]int) int {
	w := make([][]int, n)
	for i := range w {
		w[i] = make([]int, n)
	}
	for _, e := range edges {
		u, v, c := e[0], e[1], e[2]
		if u != v {
			w[u][v] += c
			w[v][u] += c
		}
	}

	merged := make([]bool, n)
	best := 1 << 62
	for phase := 0; phase < n-1; phase++ {
		inA := make([]bool, n)
		key := make([]int, n)
		prev, last := -1, -1
		active := 0
		for i := 0; i < n; i++ {
			if !merged[i] {
				active++
			}
		}
		for added := 0; added < active; added++ {
			sel := -1
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel]) {
					sel = v
				}
			}
			inA[sel] = true
			prev, last = last, sel
			for v := 0; v < n; v++ {
				if !merged[v] && !inA[v] {
					key[v] += w[sel][v]
				}
			}
		}
		if key[last] < best {
			best = key[last]
		}
		merged[last] = true
		for v := 0; v < n; v++ {
			if !merged[v] {
				w[prev][v] += w[last][v]
				w[v][prev] += w[v][last]
			}
		}
	}
	return best
}

func main() {
	fmt.Println(globalMinCut(4, [][3]int{{0, 1, 3}, {0, 2, 1}, {1, 2, 3}, {1, 3, 1}, {2, 3, 5}})) // 4
	fmt.Println(globalMinCut(2, [][3]int{{0, 1, 7}}))                                              // 7
	fmt.Println(globalMinCut(3, [][3]int{{0, 1, 5}}))                                              // 0
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static int globalMinCut(int n, int[][] edges) {
        int[][] w = new int[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1], c = e[2];
            if (u != v) { w[u][v] += c; w[v][u] += c; }
        }
        boolean[] merged = new boolean[n];
        long best = Long.MAX_VALUE;

        for (int phase = 0; phase < n - 1; phase++) {
            boolean[] inA = new boolean[n];
            long[] key = new long[n];
            int prev = -1, last = -1, active = 0;
            for (int i = 0; i < n; i++) if (!merged[i]) active++;
            for (int added = 0; added < active; added++) {
                int sel = -1;
                for (int v = 0; v < n; v++)
                    if (!merged[v] && !inA[v] && (sel == -1 || key[v] > key[sel])) sel = v;
                inA[sel] = true;
                prev = last; last = sel;
                for (int v = 0; v < n; v++)
                    if (!merged[v] && !inA[v]) key[v] += w[sel][v];
            }
            best = Math.min(best, key[last]);
            merged[last] = true;
            for (int v = 0; v < n; v++)
                if (!merged[v]) { w[prev][v] += w[last][v]; w[v][prev] += w[v][last]; }
        }
        return (int) best;
    }

    public static void main(String[] args) {
        System.out.println(globalMinCut(4, new int[][]{{0,1,3},{0,2,1},{1,2,3},{1,3,1},{2,3,5}})); // 4
        System.out.println(globalMinCut(2, new int[][]{{0,1,7}}));                                  // 7
        System.out.println(globalMinCut(3, new int[][]{{0,1,5}}));                                  // 0
    }
}
```

#### Python

```python
def global_min_cut(n, edges):
    w = [[0] * n for _ in range(n)]
    for u, v, c in edges:
        if u != v:
            w[u][v] += c
            w[v][u] += c

    merged = [False] * n
    best = float("inf")
    for _ in range(n - 1):
        in_a = [False] * n
        key = [0] * n
        prev = last = -1
        active = sum(1 for i in range(n) if not merged[i])
        for _ in range(active):
            sel = -1
            for v in range(n):
                if not merged[v] and not in_a[v] and (sel == -1 or key[v] > key[sel]):
                    sel = v
            in_a[sel] = True
            prev, last = last, sel
            for v in range(n):
                if not merged[v] and not in_a[v]:
                    key[v] += w[sel][v]
        best = min(best, key[last])
        merged[last] = True
        for v in range(n):
            if not merged[v]:
                w[prev][v] += w[last][v]
                w[v][prev] += w[v][last]
    return best


if __name__ == "__main__":
    print(global_min_cut(4, [(0,1,3),(0,2,1),(1,2,3),(1,3,1),(2,3,5)]))  # 4
    print(global_min_cut(2, [(0,1,7)]))                                   # 7
    print(global_min_cut(3, [(0,1,5)]))                                   # 0
```

**Discussion.** All three solutions are the `O(V³)` array version: build a symmetric matrix (summing parallel edges, ignoring self-loops), run `n-1` phases, and return the smallest cut-of-the-phase. The disconnected case returns `0` automatically. For sparse graphs at scale, swap the inner selection for a max-heap to reach `O(V·E + V² log V)`. To also return the partition, carry a `groups` structure and snapshot the last vertex's group when a new best is found.

### Complexity derivation (be ready to do this live)

Walk the interviewer through the cost without hand-waving:

```text
One phase on m vertices:
  - m insertions into A
  - each insertion: argmax over <= m keys      -> O(m)
  - each insertion: update <= m keys           -> O(m)
  => phase cost = m * O(m) = O(m^2)

Across phases, m shrinks from n down to 2:
  T(n) = sum_{m=2..n} O(m^2)
       = O(2^2 + 3^2 + ... + n^2)
       = O(n^3 / 3)
       = Theta(n^3).

Space: the V x V matrix dominates -> Theta(V^2).
```

For the heap variant, each phase does `m` extract-max (`O(log m)`) and `O(E_phase)` key increases (`O(log m)` each), summing to `O(V·E + V² log V)`. The `V² log V` term is irreducible: every one of `V-1` phases still touches `O(V)` heap entries even on a sparse graph.

### Follow-ups you should expect

- "Now return the actual partition." → add `groups`, snapshot `groups[last]` on a new best.
- "Make it sparse-friendly." → adjacency lists + lazy max-heap.
- "Validate it." → brute-force subset checker on `V ≤ 12`.
- "What if weights are huge?" → 64-bit keys; merges sum `O(V)` edges.
- "What if the graph is directed?" → it does not apply; explain why symmetry is essential.

---

## One Last Conceptual Check

> *"Convince me in three sentences that running `V-1` phases is enough — why don't we miss the global optimum?"*

Each phase computes the exact minimum `s-t` cut for its last pair `(s, t)` and then merges them, which by the merge lemma means `λ(G) = min(c(s,t), λ(G/{s,t}))`. So either the global optimum separates `s` and `t` — and we just recorded that minimum `s-t` cut — or it keeps them together, in which case it survives untouched into the smaller merged graph that the *next* phases handle. By induction over the `V-1` shrinking graphs, the global minimum must be captured in exactly one of the recorded cut-of-the-phase values, so taking their minimum is the answer.

That three-sentence chain — *compute min `s-t` cut → merge → recurse → induction* — is the whole algorithm distilled, and being able to deliver it cleanly is the strongest signal you understand Stoer-Wagner rather than having memorized its loop.

> **Bonus probe:** *"Could we stop early if a phase's cut equals a known lower bound?"* Yes — `0` is an absolute floor (a disconnected graph), and any cut reaching it cannot be beaten, so you may return immediately. More generally, the minimum weighted degree is the tightest cheap upper bound; if a phase matches it you can stop, since no cut can be smaller than the global minimum it already attains.

---

## Next step:

Continue to [`tasks.md`](./tasks.md) for graded practice problems (beginner, intermediate, advanced) in Go, Java, and Python.

---

## Question Index

- **Junior (15):** definition, complexity, cut/weight, global vs `s-t`, why-not-max-flow, phase, MA ordering, cut-of-phase, merge, why-merge, directed?, negative?, phase count, final answer, analogy.
- **Middle (15):** cut-of-phase lemma, merge correctness, start-vertex irrelevance, partition recovery, min-degree seed, heap variant, vs Prim, edge connectivity, disconnected, parallel edges/self-loops, deterministic, degenerate cut, start choice, validation, key updates.
- **Senior (12):** reliability monitor, large sparse, parallelism, array-vs-heap, `k` clusters, freshness, monitoring, image segmentation, failure modes, vs Karger-Stein, shrinking `V`, monotonicity.
- **Professional (10):** cut-of-phase proof, non-negativity, merge lemma, global correctness, `O(V³)` derivation, heap derivation, start-vertex, vs flow/Hao-Orlin, P vs NP-hard cuts, non-negativity location.

---
