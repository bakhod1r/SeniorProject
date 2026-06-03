# Graph Coloring — Interview Preparation

Graph coloring is a favorite interview topic because it spans the full difficulty range: the *bipartite check* is a clean linear-time problem any candidate should nail, while *m-coloring feasibility* and *minimum colors* test backtracking, heuristics, and an honest understanding of NP-hardness. Strong candidates know exactly which coloring problems are easy (2-coloring) and which are hard (everything past it), and can explain why. This file is a curated question bank sorted by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Problem | Complexity | Method |
|---------|-----------|--------|
| Is the graph 2-colorable (bipartite)? | O(V + E) | BFS/DFS parity coloring |
| Greedy coloring (some order) | O(V + E) | Smallest free color per vertex |
| Welsh–Powell coloring | O(V log V + E) | Sort by descending degree, then greedy |
| DSATUR coloring | O((V+E) log V) | Color highest-saturation vertex next |
| `m`-coloring feasible? | O(mᵛ) worst | Backtracking + pruning |
| Exact χ(G) | O(2ⁿ) / O(2.45ⁿ) | Inclusion–exclusion / Lawler |
| Edge coloring χ′ | within {Δ, Δ+1} | Vizing; line-graph reduction |

Key identities to recite:

```text
χ(G) ≥ ω(G)              (clique lower bound)
χ(G) ≤ Δ + 1             (greedy upper bound)
χ(G) ≤ Δ                 (Brooks, unless Kₙ or odd cycle)
G is 2-colorable  ⟺  G is bipartite  ⟺  G has no odd cycle
χ′(G) ∈ {Δ, Δ+1}         (Vizing); χ′ = Δ for bipartite (König)
```

Color = a label. Compare colors with `==`/`≠`, never `<`. Colors carry no order.

Common pitfalls interviewers probe:

- Forgetting to **restart the traversal from every component** in a disconnected graph.
- Using **greedy for 2-coloring** instead of the exact bipartite BFS.
- Claiming greedy gives **`χ`** (it gives an order-dependent upper bound).
- Confusing **vertex coloring with edge coloring** (Vizing governs the latter).
- Mishandling **self-loops** (they make a graph uncolorable) and **parallel edges** (harmless for vertex coloring).

---

## Junior Questions (12 Q&A)

### J1. What is graph (vertex) coloring?
Assigning a color to each vertex so that no edge joins two vertices of the same color. A coloring obeying this rule is called *proper*. The goal is usually to use as few colors as possible. The minimum number of colors is the chromatic number `χ(G)`. Colors are just labels (`0, 1, 2, …`); they have no order or arithmetic meaning.

### J2. What is the chromatic number?
`χ(G)` is the smallest number of colors needed for a proper coloring. A triangle needs 3, a 4-cycle needs 2, an edgeless graph needs 1, and the complete graph `Kₙ` needs `n`. Computing `χ(G)` exactly is NP-hard in general, though some special graphs (bipartite, trees, intervals) are easy.

### J3. What does "proper coloring" mean exactly?
For every edge `{u, v}`, `color[u] ≠ color[v]`. That is the only constraint. There is no requirement on non-adjacent vertices — they may freely share or differ in color.

### J4. How does greedy coloring work?
Process vertices in some order. For each vertex, look at the colors already given to its neighbors and assign the smallest color not among them. It always produces a proper coloring and uses at most `Δ + 1` colors, but the number of colors depends on the visiting order and is generally not minimal.

### J5. What is a bipartite graph and how does it relate to coloring?
A bipartite graph's vertices split into two groups with no edges inside a group. That is exactly a proper 2-coloring. So "bipartite" and "2-colorable" mean the same thing. You detect it with a BFS or DFS that alternates two colors.

### J6. How do you check if a graph is bipartite?
Run BFS/DFS from each uncolored vertex, coloring the start `0`, every neighbor `1`, their neighbors `0`, and so on. If you ever find an edge whose endpoints already share a color, the graph is not bipartite. Runs in `O(V + E)`. (See sibling topic `02-bfs`.)

### J7. Why is a triangle not 2-colorable?
A triangle is an odd cycle. Coloring two of its vertices with the two available colors leaves the third adjacent to both colors, so no color is free. In general, any odd-length cycle blocks 2-coloring.

### J8. What is the relationship between odd cycles and bipartiteness?
A graph is bipartite if and only if it has no odd-length cycle. If a 2-coloring attempt fails, the conflict edge lies on an odd cycle. This is the central theorem behind the bipartite check.

### J9. What is the maximum number of colors greedy can ever use?
At most `Δ + 1`, where `Δ` is the maximum degree. A vertex has at most `Δ` neighbors, blocking at most `Δ` colors, so one of the first `Δ + 1` colors is always free.

### J10. Give a real-world use of graph coloring.
Exam scheduling: exams are vertices, two exams sharing a student are connected, and time-slots are colors. A proper coloring is a clash-free timetable; `χ` is the minimum number of slots. Other examples: register allocation in compilers, radio frequency assignment, and Sudoku.

### J11. Is greedy coloring optimal?
No. It always gives a *valid* coloring but often not the minimum, and the count depends on the order. For example, a bipartite graph (which needs only 2 colors) can be greedy-colored with 3 or more under a bad order.

### J12 (analysis). How is Sudoku a graph coloring problem?
Each of the 81 cells is a vertex. Two cells are connected if they share a row, column, or 3×3 box. The 9 digits are 9 colors. A valid Sudoku solution is a proper 9-coloring of this graph where the pre-filled cells are fixed. Solving it is constraint-satisfaction / coloring with given partial colors.

---

## Middle Questions (12 Q&A)

### M1. Explain the Welsh–Powell heuristic and why it helps.
Sort vertices by descending degree, then greedy-color in that order. High-degree vertices are the most constrained, so coloring them first — while many colors are free — tends to reduce the total. It guarantees `χ ≤ 1 + max_i min(deg(v_i), i − 1)`, often much better than `Δ + 1`.

### M2. Explain DSATUR.
DSATUR (Brélaz) is dynamic: at each step it colors the uncolored vertex with the highest *saturation degree* — the number of distinct colors already on its neighbors — breaking ties by ordinary degree. It commits to the most "boxed-in" vertex first. DSATUR is provably optimal on bipartite graphs and other classes, and usually beats Welsh–Powell.

### M3. What is saturation degree?
For an uncolored vertex, the count of *distinct colors* already used among its neighbors. It measures how few color choices remain. DSATUR maximizes this when choosing the next vertex to color.

### M4. State Brooks' theorem.
For a connected graph that is neither a complete graph nor an odd cycle, `χ(G) ≤ Δ(G)`. The two exceptions force `Δ + 1`. So the `Δ + 1` bound is almost never tight.

### M5. What is the chromatic polynomial?
`P(G, k)` counts the proper colorings using at most `k` colors. It is a degree-`n` polynomial in `k`. The smallest `k` with `P(G, k) > 0` is `χ(G)`. For a tree, `P = k(k−1)^{n−1}`; for `Kₙ`, it is the falling factorial `k(k−1)…(k−n+1)`.

### M6. Explain deletion–contraction.
`P(G, k) = P(G − e, k) − P(G / e, k)`: colorings of `G − e` split into those where `e`'s endpoints differ (these are exactly colorings of `G`) and those where they match (colorings of the contracted graph `G / e`). It is the recurrence behind both counting and exact `χ` computation.

### M7. What is edge coloring and Vizing's theorem?
Edge coloring assigns colors to edges so that edges sharing a vertex differ; the minimum is the chromatic index `χ′`. Vizing's theorem says `χ′ ∈ {Δ, Δ+1}` — only two possibilities. For bipartite graphs, König's theorem sharpens it to exactly `Δ`.

### M8. How do you decide if `m` colors suffice?
Backtracking: assign colors to vertices one at a time, trying each color not used by already-colored neighbors, recursing, and backtracking on failure. Worst case `O(mᵛ)`, but ordering vertices by degree and using forward checking prunes heavily.

### M9. Why is 2-coloring easy but 3-coloring hard?
2-coloring is equivalent to bipartiteness, decidable in linear time by a parity BFS. 3-COLORING is NP-complete (reduction from 3-SAT). The complexity jump from 2 to 3 colors is the sharpest boundary in the field — it stays NP-complete even for planar degree-4 graphs.

### M10. What's the difference between vertex and edge coloring complexity?
Vertex `χ` ranges over `[ω, Δ+1]` and is NP-hard and inapproximable within `n^{1−ε}`. Edge `χ′` is always in `{Δ, Δ+1}` — a window of two — though deciding which is still NP-complete (Holyer). Edge coloring is far better behaved.

### M11. When is greedy coloring actually optimal?
On *interval graphs* (conflicts from overlapping intervals): sort by start time, greedy-color, and you get exactly `χ`, equal to the maximum overlap. Also on bipartite graphs DSATUR is optimal, and on any graph the *perfect order* (from an optimal coloring) makes greedy optimal — but finding that order is NP-hard.

### M12 (analysis). How would you find a lower bound on `χ` quickly?
Find a clique — `χ ≥ ω`. Even a heuristic maximal clique gives a useful floor. The Lovász theta function gives a polynomial-time bound `ω ≤ θ(Ḡ) ≤ χ`. These let you tell whether a heuristic coloring is near optimal.

---

## Senior Questions (10 Q&A)

### S1. How does register allocation use graph coloring?
Variables (live ranges) are vertices; two that are simultaneously live interfere (edge); machine registers are colors. A proper `k`-coloring assigns registers; uncolorable vertices are *spilled* to memory. Chaitin–Briggs simplify/select drives this: peel vertices of degree `< k`, optimistically spill the rest, then color on the way back.

### S2. Why are SSA-form interference graphs special?
They are *chordal*, and chordal graphs are colorable in polynomial time via a perfect elimination ordering. So SSA makes the coloring tractable, shifting the hard work to spill placement and coalescing.

### S3. What is a Kempe chain and where is it used?
A maximal connected component of the subgraph induced by two colors `a, b`. Swapping `a ↔ b` within it keeps the coloring proper. Timetabling and edge-coloring improvement loops use Kempe-chain swaps as a local move to reduce colors without breaking constraints.

### S4. How do production timetabling engines work?
Two phases: *construct* a feasible coloring fast (DSATUR/RLF), then *improve* with local search (Kempe swaps, simulated annealing, tabu) to cut slots and satisfy soft constraints, never violating the hard coloring constraint. Exact CP/ILP solvers handle small or highly-constrained cores.

### S5. How do you compute `χ(G)` exactly for small graphs?
Inclusion–exclusion in `O(2ⁿ)`: count covers by `k` independent sets via a signed sum over subsets; the first `k` with a positive count is `χ`. Or Lawler's `O(2.45ⁿ)` subset DP over maximal independent sets. Viable only for `n ≲ 25–30`.

### S6. How do you handle a graph too large to color whole?
Partition into components (color independently; `χ` is the max) or into lightly-connected pieces, color dense cores first, reconcile boundaries. Use bitsets for dense adjacency, and compute a clique lower bound as a sanity floor.

### S7. What is incremental recoloring and why use it?
When the conflict graph changes (a student adds a course, an AP comes online), recolor only the affected neighborhood — often via a Kempe chain — instead of the whole graph. Cap the blast radius; periodically do a full recolor to prevent quality drift.

### S8. How do you validate a coloring in production?
Scan every edge and assert its endpoints differ. This must always pass — a bad edge is a miscompile (registers) or a double-booking (schedules). Also emit `colors_used` vs the clique lower bound to detect heuristic degradation.

### S9. How does frequency assignment differ from plain coloring?
Adjacent channels partially interfere, so colors carry a *distance*: `|color[u] − color[v]| ≥ threshold` depending on graph distance (T-coloring / L(2,1)-labeling). The conflict graph is geometric and often dynamic, favoring incremental recoloring.

### S10. What approximation guarantees exist for `χ`?
Essentially none useful: `χ` is inapproximable within `n^{1−ε}` unless P = NP. Production relies on heuristics with no worst-case guarantee plus instance-specific lower bounds (cliques, theta). This is why "good enough fast" beats "optimal eventually" in practice.

---

## Hard / Analysis Questions (8 Q&A)

### H1. Prove `χ(G) ≤ Δ + 1`.
Greedy: each vertex sees at most `Δ` colored neighbors, so among `{1, …, Δ+1}` a color is always free (pigeonhole). The result is proper because each vertex avoids its already-colored neighbors. ∎

### H2. Prove bipartite ⟺ no odd cycle.
If bipartite, every cycle alternates parts and must have even length. Conversely, if no odd cycle, BFS-color by distance parity; any edge between same-parity endpoints would close an odd cycle (tree paths + edge), contradiction — so the parity coloring is proper. ∎

### H3. Sketch the NP-completeness of 3-COLORING.
In NP (a coloring is a checkable certificate). Hardness: reduce 3-SAT with a truth-triangle fixing T/F/Base colors, variable gadgets forcing `xᵢ ≠ ¬xᵢ`, and clause OR-gadgets 3-colorable iff a literal is True. Polynomial-size, 3-colorable iff satisfiable. ∎

### H4. Why is `χ` inapproximable?
Via the PCP theorem (Feige–Kilian, Zuckerman), no polynomial algorithm approximates `χ` within `n^{1−ε}` unless P = NP. There is no constant-factor approximation, which is why heuristics dominate practice.

### H5. Derive the chromatic polynomial of a cycle `Cₙ`.
By deletion–contraction or transfer matrix: `P(Cₙ, k) = (k−1)ⁿ + (−1)ⁿ(k−1)`. Check `C₃`: `(k−1)³ − (k−1) = k(k−1)(k−2)`, the triangle's count. Check `C₅` at `k=2`: `1 − 1 = 0`, confirming `χ(C₅) > 2`.

### H6. Explain the `O(2ⁿ)` inclusion–exclusion for `χ`.
Let `s(S)` count independent subsets of `S`. The number of ordered `k`-tuples of independent sets covering `V` is `Σ_{S⊆V} (−1)^{n−|S|} s(S)^k`. It is positive iff `G` is `k`-colorable. Compute `s` over subsets in `O(2ⁿ n)`, test `k = 1, 2, …`; the first positive `k` is `χ`.

### H7. State and justify Vizing's bound.
`Δ ≤ χ′ ≤ Δ + 1`. Lower: edges at a max-degree vertex pairwise conflict. Upper: color edges greedily with `Δ+1` colors; if `e = uv` can't be colored, a Vizing fan + α/β Kempe chain shifts colors to free one. So only two values are possible.

### H8. When does `χ = ω` (clique number)?
For *perfect graphs*: `χ(H) = ω(H)` for every induced subgraph. Bipartite, chordal, interval, and comparability graphs are perfect, and all are colorable in polynomial time. The strong perfect graph theorem characterizes them by forbidden odd holes/antiholes.

### H9. Can a triangle-free graph need many colors?
Yes. Mycielski's construction produces triangle-free graphs (`ω = 2`) with arbitrarily large `χ`. So the clique bound `χ ≥ ω` can be arbitrarily loose — high chromatic number is a *global* property, not caused by any local clique. This is a key reason coloring resists local heuristics and polynomial algorithms.

### H10. How would you exactly color a 40-vertex graph in practice?
`2⁴⁰` is too large for the subset DP, so use branch-and-bound: maintain an upper bound from DSATUR and a lower bound from a maximal clique; branch on the most-saturated vertex; prune when colors-used reaches the upper bound or when the bounds meet. Symmetry-break by never introducing two new colors at once. Structured instances (small `χ`, tight clique bound) solve quickly despite the exponential worst case.

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose a heuristic over an exact algorithm.
*Structure:* name the problem (e.g., scheduling with thousands of events), explain that exact `χ` is NP-hard and would not finish, justify DSATUR + local search, and quantify the outcome (e.g., "within 1 slot of the clique lower bound, in 200 ms").

### B2. Describe debugging a subtle correctness issue.
*Structure:* a coloring that validated locally but double-booked in production. Root cause: the *conflict-graph builder* missed an edge type, not the colorer. Lesson: test the graph construction, not just the algorithm.

### B3. How did you explain an NP-hard limitation to a non-technical stakeholder?
*Structure:* translate "we can't guarantee the absolute minimum number of exam slots, but we can guarantee a valid schedule provably within one slot of the best possible, in seconds." Frame the trade-off in their terms.

### B4. Tell me about optimizing a slow algorithm.
*Structure:* DSATUR's max-saturation scan was `O(V)` per step → `O(V²)`. Replaced with a lazy priority queue keyed on `(−saturation, −degree)`, dropping to `O((V+E) log V)`; measured a 10× speedup on the production graph.

### B5. Describe handling changing requirements mid-project.
*Structure:* requirements added soft constraints (preferred time-slots) on top of hard clash constraints. Kept the two-phase design — construct a feasible coloring, then optimize soft constraints in the improvement phase — so the new requirement slotted in without redesign.

---

## Coding Challenges (4)

### Challenge 1: Is the graph bipartite (2-colorable)?

**Problem.** Given an undirected graph, return whether it is 2-colorable. Handle disconnected graphs.

#### Go

```go
package main

import "fmt"

func isBipartite(n int, adj [][]int) bool {
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	for s := 0; s < n; s++ {
		if color[s] != -1 {
			continue
		}
		color[s] = 0
		q := []int{s}
		for len(q) > 0 {
			u := q[0]
			q = q[1:]
			for _, v := range adj[u] {
				if color[v] == -1 {
					color[v] = 1 - color[u]
					q = append(q, v)
				} else if color[v] == color[u] {
					return false
				}
			}
		}
	}
	return true
}

func main() {
	adj := [][]int{{1, 3}, {0, 2}, {1, 3}, {0, 2}}
	fmt.Println(isBipartite(4, adj)) // true
}
```

#### Java

```java
import java.util.*;

public class Bip {
    static boolean isBipartite(int n, List<List<Integer>> adj) {
        int[] color = new int[n];
        Arrays.fill(color, -1);
        for (int s = 0; s < n; s++) {
            if (color[s] != -1) continue;
            color[s] = 0;
            Deque<Integer> q = new ArrayDeque<>();
            q.add(s);
            while (!q.isEmpty()) {
                int u = q.poll();
                for (int v : adj.get(u)) {
                    if (color[v] == -1) { color[v] = 1 - color[u]; q.add(v); }
                    else if (color[v] == color[u]) return false;
                }
            }
        }
        return true;
    }
}
```

#### Python

```python
from collections import deque

def is_bipartite(n, adj):
    color = [-1] * n
    for s in range(n):
        if color[s] != -1:
            continue
        color[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if color[v] == -1:
                    color[v] = 1 - color[u]
                    q.append(v)
                elif color[v] == color[u]:
                    return False
    return True
```

**Complexity:** `O(V + E)` time, `O(V)` space.

### Challenge 2: m-Coloring feasibility (backtracking)

**Problem.** Given a graph and an integer `m`, decide whether the graph has a proper coloring with at most `m` colors. Return one coloring if it exists.

#### Go

```go
package main

import "fmt"

func mColoring(n, m int, adj [][]int) ([]int, bool) {
	color := make([]int, n)
	for i := range color {
		color[i] = -1
	}
	var solve func(v int) bool
	solve = func(v int) bool {
		if v == n {
			return true
		}
		for c := 0; c < m; c++ {
			ok := true
			for _, u := range adj[v] {
				if color[u] == c {
					ok = false
					break
				}
			}
			if ok {
				color[v] = c
				if solve(v + 1) {
					return true
				}
				color[v] = -1
			}
		}
		return false
	}
	if solve(0) {
		return color, true
	}
	return nil, false
}

func main() {
	adj := [][]int{{1, 2}, {0, 2}, {0, 1}} // triangle
	_, ok := mColoring(3, 2, adj)
	fmt.Println(ok) // false (needs 3)
	c, ok2 := mColoring(3, 3, adj)
	fmt.Println(ok2, c) // true
}
```

#### Java

```java
import java.util.*;

public class MColor {
    static int[] color;
    static int N, M;
    static List<List<Integer>> g;

    static boolean solve(int v) {
        if (v == N) return true;
        for (int c = 0; c < M; c++) {
            boolean ok = true;
            for (int u : g.get(v)) if (color[u] == c) { ok = false; break; }
            if (ok) {
                color[v] = c;
                if (solve(v + 1)) return true;
                color[v] = -1;
            }
        }
        return false;
    }

    static boolean mColoring(int n, int m, List<List<Integer>> adj) {
        N = n; M = m; g = adj;
        color = new int[n];
        Arrays.fill(color, -1);
        return solve(0);
    }
}
```

#### Python

```python
def m_coloring(n, m, adj):
    color = [-1] * n

    def solve(v):
        if v == n:
            return True
        for c in range(m):
            if all(color[u] != c for u in adj[v]):
                color[v] = c
                if solve(v + 1):
                    return True
                color[v] = -1
        return False

    return (color, True) if solve(0) else (None, False)


if __name__ == "__main__":
    triangle = [[1, 2], [0, 2], [0, 1]]
    print(m_coloring(3, 2, triangle)[1])  # False
    print(m_coloring(3, 3, triangle))     # (coloring, True)
```

**Complexity:** `O(mᵛ)` worst case; prune by ordering vertices by degree.

**Optimization the interviewer will want to hear:** add *forward checking* — when you color a vertex, immediately check that every uncolored neighbor still has at least one available color; if any neighbor has none, backtrack early instead of descending into a doomed subtree. Combined with the fail-first variable order (color the most-constrained vertex next, à la DSATUR), this turns the exponential worst case into something that solves real graphs of dozens of vertices in milliseconds. Mentioning both the brute-force complexity *and* these prunings signals you understand backtracking, not just recursion.

### Challenge 3: Minimum colors via greedy / DSATUR

**Problem.** Return a proper coloring minimizing colors as best you can in polynomial time. Use DSATUR.

#### Python

```python
def dsatur_min_colors(n, adj):
    color = [-1] * n
    sat = [set() for _ in range(n)]
    deg = [len(adj[v]) for v in range(n)]
    for _ in range(n):
        v = max((x for x in range(n) if color[x] == -1),
                key=lambda x: (len(sat[x]), deg[x]))
        c = 0
        while c in sat[v]:
            c += 1
        color[v] = c
        for u in adj[v]:
            sat[u].add(c)
    return color, max(color) + 1


if __name__ == "__main__":
    adj = [[1, 2], [0, 2, 3], [0, 1, 3], [1, 2, 4], [3]]
    print(dsatur_min_colors(5, adj))
```

(Go and Java versions mirror the `dsatur` implementation in [`middle.md`](./middle.md).)

**Complexity:** `O(V²)` naive, `O((V+E) log V)` with a saturation priority queue.

### Challenge 4: Paint / exam scheduling (minimum time-slots)

**Problem.** Given a list of exams and the pairs that conflict (share a student), return an assignment of exams to the fewest time-slots so no two conflicting exams share a slot. This is graph coloring; time-slots are colors.

#### Python

```python
def schedule_exams(exams, conflicts):
    idx = {e: i for i, e in enumerate(exams)}
    n = len(exams)
    adj = [[] for _ in range(n)]
    for a, b in conflicts:
        adj[idx[a]].append(idx[b])
        adj[idx[b]].append(idx[a])

    # DSATUR to keep slot count low
    color, k = dsatur_min_colors(n, adj)
    slots = {}
    for e, c in zip(exams, color):
        slots.setdefault(c, []).append(e)
    return slots, k


if __name__ == "__main__":
    exams = ["Math", "Physics", "CS", "Art"]
    conflicts = [("Math", "Physics"), ("Physics", "CS"), ("Math", "CS")]
    slots, k = schedule_exams(exams, conflicts)
    print(k, "slots:", slots)  # Math/Physics/CS form a triangle → 3 slots
```

(Reuses `dsatur_min_colors` from Challenge 3; Go and Java follow the same shape.)

**Complexity:** dominated by DSATUR; building the conflict graph is `O(conflicts)`.

**Follow-up the interviewer may ask:** "What if each slot has a room-capacity limit?" Then it becomes *bounded coloring*: skip a color once its class is full, and the lower bound rises from `ω` to `max(ω, ⌈n/C⌉)`. "What if some exams are pre-assigned to fixed slots?" Then it is *precoloring extension* — seed those colors first and color the rest around them, which DSATUR handles naturally because the fixed vertices simply raise their neighbors' saturation.

---

## Final Tips

- **Reach for the bipartite check first** when "two groups" or "alternate" appears — it is the one exact, linear coloring result.
- **Say "NP-hard" out loud** when asked for minimum colors on a general graph; then offer greedy/DSATUR as the practical answer.
- **Never compare colors with `<`** — they are labels. Interviewers notice.
- **Always handle disconnected graphs** — loop over all start vertices.
- **Validate** by scanning edges; mention it even if you don't write it.
- **Distinguish vertex vs edge coloring** crisply — Vizing's two-value theorem is a great senior signal.

## One-Minute Recap

If you remember nothing else walking into the interview, remember this ladder of difficulty:

1. **2 colors** — bipartite, decided in `O(V + E)` by a parity BFS. Easy and exact. Equivalent to "no odd cycle."
2. **`Δ + 1` colors** — always achievable by greedy. Free upper bound.
3. **`Δ` colors** — Brooks' theorem: achievable unless the graph is a clique or odd cycle.
4. **Minimum colors `χ`** — NP-hard for general graphs, even to approximate. Use DSATUR/RLF heuristics.
5. **Edges instead of vertices** — Vizing pins `χ′` to `{Δ, Δ+1}`; bipartite is exactly `Δ` (König).

Then name a real application (register allocation, exam scheduling, frequency assignment, Sudoku) to show you understand why anyone cares. The combination of "I know the complexity boundary" plus "I know where it's used" is exactly the senior signal interviewers look for.

A clean closing line for any coloring question: *"2 colors is bipartiteness — exact and linear. Past that it's NP-hard, so I'd use DSATUR for a good coloring and a clique for a lower bound, and only solve exactly if the graph is tiny."* That one sentence demonstrates you know the easy case, the hard reality, the practical heuristic, and how to bound the gap — the full arc an interviewer wants to hear.

### Sibling topics to cross-reference

- `02-bfs` — the bipartite-detection BFS is the exact 2-coloring algorithm; expect it as a warm-up.
- `28-np-hard-tsp-hamiltonian` — neighboring NP-hard graph problems; useful when discussing reductions and why coloring is intractable.

Practice the four coding challenges above until the bipartite check is reflexive and the `m`-coloring backtracking comes out clean on the first try — those two are the ones that actually appear on whiteboards.
