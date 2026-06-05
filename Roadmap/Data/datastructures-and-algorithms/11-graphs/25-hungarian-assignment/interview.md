# Hungarian Algorithm (Kuhn-Munkres) — Interview Preparation

The Hungarian algorithm is a favorite for senior/competitive interviews: it is short enough to template on a whiteboard, deep enough to probe linear-programming duality and primal-dual reasoning, and full of subtle traps (square-matrix requirement, maximization transform, INF overflow, potential updates) that separate candidates who memorized a template from those who understand *why* it is correct. This file is a curated bank of questions by seniority, plus end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | Minimum-cost perfect matching in a weighted bipartite graph (assignment) |
| Time | `O(n³)` (potentials / augmenting-path form) |
| Space | `O(n²)` (cost matrix) |
| Negative costs | Supported (potentials form) |
| Maximization | Negate, or `BIG - profit`, then minimize |
| Rectangular | Pad to square with `0`-cost dummies, or row-augment the smaller side (`O(r²c)`) |
| Output | `n` worker→job pairs + total cost (+ dual potentials as certificate) |
| Optimality proof | Complementary slackness: `Σ u + Σ v == total cost` |

Core idea:

```text
reduced(i,j) = cost[i][j] - u[i] - v[j] >= 0   (dual feasibility)
tight edge   = reduced(i,j) == 0               (equality subgraph)
goal         = perfect matching on tight edges → optimal (cost = Σu + Σv)
```

By-hand recipe:

```text
1. Row-reduce (subtract row mins)   2. Col-reduce (subtract col mins)
3. Cover zeros with min lines       4. If lines == n: match zeros, done
5. Else δ = min uncovered; subtract from uncovered, add to doubly-covered; goto 3
```

---

## Junior Questions (13 Q&A)

### J1. What problem does the Hungarian algorithm solve?
The **assignment problem**: given `n` workers and `n` jobs with a cost `cost[i][j]` for each pairing, assign each worker exactly one job (and each job one worker) so the **total cost is minimized**. It is equivalently the minimum-cost perfect matching in a complete weighted bipartite graph.

### J2. What is its time and space complexity?
`O(n³)` time in the standard potentials/augmenting-path form, and `O(n²)` space for the cost matrix. The auxiliary arrays are all `O(n)`. The cubic time is structural — there is no input-dependent early exit on a dense matrix.

### J3. Why not just brute-force all assignments?
There are `n!` permutations of jobs to workers. For `n = 20` that exceeds 10¹⁸ — astronomically infeasible. The Hungarian algorithm is polynomial `O(n³)`, so it handles `n` in the hundreds or thousands.

### J4. What is the core "subtraction" insight?
Subtracting a constant from an entire row (or column) of the cost matrix changes every complete assignment's total by the same amount — because each assignment uses exactly one cell per row and column. So it never changes *which* assignment is cheapest, but it lets us create zeros, which are the candidate cheap pairings.

### J5. Why does matching all zeros prove optimality?
After reduction, all reduced costs are `≥ 0`. An assignment made entirely of zero (reduced-cost-0) cells has reduced total `0`, the smallest possible. So a zero-only perfect matching must be optimal; translating back to the original costs gives the true minimum.

### J6. Walk through the by-hand steps.
(1) Row-reduce: subtract each row's minimum. (2) Column-reduce: subtract each column's minimum. (3) Try to pick `n` independent zeros (one per row and column). (4) If you cannot, cover all zeros with the fewest lines; if fewer than `n` lines, find the smallest uncovered value `δ`, subtract it from uncovered cells, add it to doubly-covered cells, and repeat.

### J7. How do you handle maximization instead of minimization?
Transform to a minimization problem: replace each cost with `BIG - profit[i][j]` (or negate it), solve the min problem, then read off the original profits. The optimal assignment is the same; only the objective direction flips.

### J8. What if the matrix is not square?
Pad it to `n × n` (where `n = max(rows, cols)`) with dummy rows or columns of cost `0`. A real item matched to a dummy is effectively left unassigned at no cost.

### J9. What is the INF overflow pitfall?
If you set `INF = MaxInt` and compute `cost - u - v` or add `δ` during potential updates, the arithmetic can overflow to a negative number and fabricate a phantom cheap assignment. Use `INF = MaxInt/2`.

### J10. Can it handle negative costs?
The potentials/augmenting-path version handles negative costs directly. Some non-negative-only by-hand variants do not; if you must use one, shift all costs up by `-min(cost)` first.

### J11. What does the output look like?
A list of `n` pairs (worker → job) and the total cost. The clean implementations also expose the dual potentials `u`, `v`, which certify optimality.

### J12. Why is greedy (each worker picks their cheapest job) wrong?
Two workers may both want the same job; greedy double-books a column, and fixing it locally can cascade into a globally worse total. Greedy optimizes each choice in isolation; the assignment problem needs the *globally* cheapest one-to-one plan.

### J13 (analysis). Why is the space `O(n²)` and not more?
The only `O(n²)` object is the cost matrix itself. Everything else — row/column potentials, the column→row match array, path back-pointers, the slack array — is a handful of `O(n)` arrays.

---

## Middle Questions (13 Q&A)

### M1. What are the potentials `u` and `v`?
Per-row and per-column values such that the **reduced cost** `cost[i][j] - u[i] - v[j]` is the matrix entry after "virtual" row/column reduction. They replace physically mutating the matrix: reduction becomes bookkeeping on two `O(n)` arrays, which enables the clean `O(n³)` implementation.

### M2. What is dual feasibility and why does it matter?
The invariant `cost[i][j] - u[i] - v[j] ≥ 0` for all `i, j`. While it holds, the matrix's optimum is unchanged and any perfect matching using only reduced-cost-0 ("tight") edges is optimal. Every step of the algorithm preserves it.

### M3. What is the equality subgraph?
The bipartite graph of **tight edges** — pairs with reduced cost exactly `0`. The algorithm grows a matching inside it. If the equality subgraph has a perfect matching, that matching is the optimal assignment.

### M4. Explain the `δ`-relaxation step.
When the augmenting search stalls with reached rows `S` and columns `T`, `δ` is the minimum reduced cost from `S` to columns *not* in `T`. Add `δ` to `u[i]` for reached rows and subtract `δ` from `v[j]` for reached columns. This keeps existing tight edges tight, preserves feasibility, and creates at least one new tight edge — guaranteeing progress.

### M5. Why does the algorithm terminate?
Each augmentation permanently grows the matching (bounded by `n`), and between augmentations each `δ`-update enlarges the reachable column set `T` (bounded by `n`). Equivalently, each `δ`-update strictly raises the dual objective `Σu + Σv`, which is bounded above by the optimal cost — so it cannot increase forever.

### M6. When do you use min-cost max-flow instead?
When the problem has **capacities** (a worker can do `k` jobs), **unbalanced supply/demand** (transportation problem), or many-to-one matching. The assignment problem is the unit-capacity bipartite special case of min-cost flow; MCMF handles the general case (at higher cost).

### M7. When do you use Hopcroft-Karp instead?
When weights are irrelevant and you only need the **largest** (maximum-cardinality) matching. Hopcroft-Karp is `O(E√V)` and far simpler — do not pay for weighted machinery you do not use.

### M8. How do you certify the answer is optimal without checking other assignments?
Complementary slackness: if the matching uses only tight edges and the duals are feasible, then `total cost == Σu + Σv`. That equality *is* the proof — the dual value is a lower bound that the matching achieves. Assert it after solving.

### M9. What is the difference between the `O(n³)` and `O(n⁴)` versions?
The `O(n⁴)` version recomputes the minimum line cover and slack from scratch each phase. The `O(n³)` version maintains a running `minv[]` array of column slacks and a `way[]` back-pointer array, computing `δ` in `O(n)` and augmenting in `O(n)` per phase. Always use the `O(n³)` template.

### M10. How do you forbid an illegal assignment?
Set that cell's cost to a sentinel `BIG` large enough never to appear in an optimal total but small enough not to overflow when summed (e.g. `10×` the max plausible total, not `MaxInt`). If a forbidden cell still appears, the instance was infeasible.

### M11. Why is this a "primal-dual" algorithm?
It maintains a feasible *dual* (the potentials, always keeping reduced costs `≥ 0`) and grows a *primal* matching restricted to tight edges, stopping exactly when the primal is perfect. At that moment primal cost equals dual value, certifying optimality. This template generalizes to min-cost flow and much of combinatorial optimization.

### M12. How do you minimize the maximum cost (bottleneck) instead of the sum?
Different objective — binary-search a threshold `T`, keep only edges with `cost ≤ T`, and test for a perfect matching (unweighted). The smallest feasible `T` is the bottleneck optimum. The Hungarian algorithm optimizes the *sum*, so it is the wrong tool for the max objective.

### M13. What happens with ties (multiple optimal assignments)?
The algorithm returns *one* optimal assignment; several may share the minimum cost. Treat the cost as the contract and the specific pairing as one valid witness — never assume uniqueness.

---

## Senior Questions (12 Q&A)

### S1. Where does an assignment solver fit in a multi-object tracker?
It is the per-frame **data-association** step: build a cost matrix of track-to-detection dissimilarities (distance, IoU), solve the optimal assignment to link tracks to detections, then gate the output (reject too-expensive matches as "no match"). It runs 30–60× per second inside the tracking loop.

### S2. The cost matrix is rectangular in practice — how do you handle it?
Tracks ≠ detections. Either pad to `max(T, D)` square with `0`-cost (or gate-cost) dummies, or use the rectangular augmenting form that processes the smaller side at `O(min² · max)`. Always define "unmatched" semantics explicitly — an unmatched track should *coast*, not be force-paired with a dummy.

### S3. What is gating and why is it essential at scale?
Pruning impossible pairs before building the matrix — only pairs within a distance/IoU threshold get a finite cost. It drops cost construction from dense `O(T·D)` to `O(T·g)` with `g` the average candidates per track, and shortens augmenting paths. Without gating, large scenes are too slow for real time.

### S4. What is the single biggest practical speedup for sparse problems?
**Connected-component decomposition.** If gating splits the bipartite graph into components, each is an independent assignment subproblem; `Σ n_c³ ≪ (Σ n_c)³`. A union-find over gated edges finds components in near-linear time. A scene that looks like 500×500 is often a dozen near-independent 40×40 problems.

### S5. Can the algorithm be parallelized?
The `O(n³)` core is sequential (each row's augmentation depends on prior potentials). What parallelizes: **cost construction** (the `O(n²)` pairwise costs, often the dominant cost — parallel/GPU), **independent components**, and **independent batches** (e.g. multiple camera streams). GPU/SIMD Hungarian variants exist but rarely pay off below `n ≈ 1000`.

### S6. What dominates the cost — the solve or the matrix build?
Frequently the **build**: computing `n²` expensive pairwise features (descriptors, IoUs) can exceed the `O(n³)` solve. Profile the whole build-solve-post-process step; optimizing only the solver while ignoring construction is a classic misallocation.

### S7. How do you keep a per-frame solver inside a 16 ms (60 fps) budget?
Gate hard, decompose into components, cap per-request `n`, and time-box the solve with a greedy/auction fallback when a batch would overrun. The dense `n` you can afford exactly at 60 fps is only a few hundred — real systems rely on gating and decomposition, not raw solver speed.

### S8. When do you switch from exact to approximate?
When `n` (post-gating) is in the tens of thousands, the budget is tight, and a *certified* optimum is not required. Auction algorithms give tunable near-optimal results at large `n`; greedy gives a fast floor. The senior call is naming whether the domain needs the exactness certificate at all.

### S9. What is an "output gate" and why is it mandatory?
After solving, reject any matched pair whose cost exceeds a no-match threshold, treating it as unmatched. The exact optimum *will* pair a track to a far-away detection if that minimizes the *complete* matching cost — producing a teleporting track. The math optimizes the sum, not physical plausibility; the output gate restores it.

### S10. How do you observe an assignment step in production?
Latency: `solve_duration` p99 vs budget, `matrix_n` distribution, `cost_build_duration`. Sparsity: `gated_degree_avg`, `components_count`. Quality: `unmatched_ratio`, `gate_reject_ratio`, and periodic `optimality_gap` (exact vs approximate). A fast-but-wrong assignment fails silently, so quality canaries matter as much as latency.

### S11. Why can't you incrementally update on a single cost change?
There is no general `o(n²)` exact update — a single changed cost can ripple through the entire matching. Practical systems *warm-start* duals from the previous frame and re-solve only changed components, cutting the constant in the common small-delta case, but the worst case is a full re-solve.

### S12. The cost matrix mixed inputs from two frames — what breaks?
The optimal matching is then for a world that never existed (some detections from frame `t`, some from `t-1` due to a race). Always build the matrix from a single consistent input snapshot and record the frame/snapshot id with the result, or you get intermittent "impossible" associations that no single frame can reproduce.

---

## Professional Questions (10 Q&A)

### P1. State the assignment LP and its dual.
Primal: `min Σ c[i][j]z[i][j]` s.t. `Σ_j z[i][j] = 1`, `Σ_i z[i][j] = 1`, `z ≥ 0`. Dual: `max Σ u[i] + Σ v[j]` s.t. `u[i] + v[j] ≤ c[i][j]`. The dual constraint is exactly dual feasibility `reduced(i,j) ≥ 0`, and the dual objective is the lower bound the algorithm tracks.

### P2. Prove weak duality for the assignment problem.
For feasible `z` and feasible `(u,v)`: `Σ c·z ≥ Σ(u[i]+v[j])z[i][j] = Σ_i u[i]Σ_j z[i][j] + Σ_j v[j]Σ_i z[i][j] = Σu + Σv`, using the assignment constraints. So every matching costs at least `Σu + Σv`.

### P3. State and prove the optimality certificate (complementary slackness).
A feasible primal and dual are both optimal iff every matched edge is tight (`z[i][j] > 0 ⟹ u[i]+v[j] = c[i][j]`). Proof: the only slack in the weak-duality chain is `Σ reduced(i,j)·z[i][j]`, which is `0` iff matched edges have reduced cost `0`; then primal cost `= Σu+Σv`, so both are optimal.

### P4. Prove the `δ`-update preserves dual feasibility.
With reached sets `S` (rows), `T` (columns): for `i∈S, j∈T` the reduced cost is unchanged (`-δ` from row, `+δ` from column cancel); for `i∈S, j∉T` it drops by `δ` but stays `≥ 0` since `δ = min` over exactly those pairs; for `i∉S, j∈T` it rises; otherwise unchanged. All cases keep reduced cost `≥ 0`.

### P5. Why does the LP relaxation have an integral optimum?
The constraint matrix is the incidence matrix of a bipartite graph, which is **totally unimodular** (every square submatrix has determinant in `{-1,0,1}`). With an integral right-hand side, every polytope vertex is integral, so an optimal LP vertex is a `{0,1}` matching — the LP optimum equals the integer-program optimum.

### P6. Give the `O(n³)` time argument.
`n` outer phases (one per row matched). Each phase does at most `n` `δ`-updates, each `O(n)` to compute (scan the `minv` slack array) and apply, plus an `O(n)` path traversal. So each phase is `O(n²)` and the total is `O(n³)`. The naive recompute-the-cover version is `O(n⁴)`.

### P7. How does the Hungarian algorithm relate to min-cost max-flow?
Build a network: source→worker (cap 1, cost 0), worker→job (cap 1, cost `c`), job→sink (cap 1, cost 0). Min-cost max-flow of value `n` is the optimal assignment. The Hungarian `δ`-update is exactly the reduced-cost/potential reweighting of successive-shortest-path MCMF specialized to this unit-capacity bipartite network — same primal-dual idea.

### P8. What is König's theorem and how does it appear here?
In unweighted bipartite graphs, max matching size = min vertex cover size. The by-hand "cover all zeros with the fewest lines" rule is König's theorem applied to the equality subgraph: the minimum number of covering lines equals the maximum matching among the zeros. The weighted `δ`-update generalizes the cover selection.

### P9. Is there a sub-cubic algorithm?
No truly sub-cubic *combinatorial* algorithm is known for general real costs — it is tied to min-plus / matrix-product barriers like APSP. For integer costs bounded by `C`, scaling algorithms (Gabow-Tarjan) achieve `O(n^{2.5} log(nC))`, beating `n³` when `C` is small.

### P10. What is the Jonker-Volgenant variant and why does SciPy use it?
LAPJV is a shortest-augmenting-path assignment algorithm with the same `O(n³)` worst case but much better practical constants (smart initialization, fewer augmentations on typical inputs), and it handles rectangular and sparse matrices well. `scipy.optimize.linear_sum_assignment` uses a modified Jonker-Volgenant for exactly these reasons.

---

## Rapid-Fire Q&A (8)

Short questions interviewers fire off to probe depth quickly.

### R1. One sentence: what does the algorithm minimize?
The total cost of a perfect one-to-one matching between two equal-size sets.

### R2. What does subtracting a row's minimum do to the optimal assignment?
Nothing — it lowers every assignment's total by the same constant, preserving the ordering.

### R3. What is a "tight edge"?
A pair whose reduced cost `cost[i][j] - u[i] - v[j]` equals `0`.

### R4. What does `Σu + Σv` represent?
The dual objective — a lower bound on any assignment's cost; at optimum it *equals* the cost.

### R5. Hungarian vs Hopcroft-Karp in one line?
Hungarian = min-cost (weighted) perfect matching; Hopcroft-Karp = maximum-cardinality (unweighted) matching.

### R6. Hungarian vs min-cost max-flow in one line?
Assignment is the unit-capacity bipartite special case of min-cost flow; use MCMF when capacities or unbalanced supply appear.

### R7. How do you make it maximize?
Negate the costs, or use `BIG - profit`, then minimize.

### R8. What is the brute-force complexity it beats?
`O(n·n!)` — checking every permutation.

### R9. Why must the matrix be square?
A perfect matching needs equal-size sides; rectangular input is padded with `0`-cost dummies (or solved with the smaller-side augmenting form).

### R10. Does loop/row order affect the answer?
No — the optimum is independent of the order rows are processed; only the *specific* tied witness may differ.

### R11. What library function would you reach for in Python?
`scipy.optimize.linear_sum_assignment` — a tuned Jonker-Volgenant implementation that handles rectangular matrices.

### R12. What certifies optimality without an oracle?
Complementary slackness: feasible duals + a tight matching with `cost == Σu + Σv`.

---

## Scenario / Design Questions (4)

### D1. Design the data-association step of a real-time multi-object tracker.
Build a gated cost matrix (track-to-detection distance/IoU, infinite past a threshold), decompose into connected components via union-find, solve each component's assignment exactly (Hungarian), then apply an output gate to reject implausible matches and a cascade to prioritize fresh tracks. Cap per-frame `n`, time-box the solve with a greedy fallback, and instrument `solve_duration` p99, `unmatched_ratio`, and `gate_reject_ratio`. Discuss exact-vs-approximate explicitly: a tracker needs *consistent* associations, and the certificate is cheap at small gated `n`, so exact is justified — but the budget (16 ms at 60 fps) caps dense `n` at a few hundred, which is why gating and decomposition carry the design.

### D2. A marketplace must match 50,000 drivers to 50,000 riders every few seconds. How?
Dense Hungarian is `5×10⁴³`... no — `(5×10⁴)³ ≈ 1.25×10¹⁴` ops, minutes, far past budget. Gate by geography so each driver only competes for nearby riders; this both sparsifies and decomposes the problem into per-region subproblems solvable independently and in parallel. Question whether a *certified* optimum is even required — a marketplace usually tolerates near-optimal, so an auction/approximate algorithm or a min-cost-flow model with regional capacities is the better fit. The senior signal is recognizing this is no longer a single dense assignment.

### D3. The assignment result occasionally "teleports" a tracked object. Why, and how do you fix it?
Without an output gate, the exact optimum pairs a track to a far-away detection whenever that minimizes the *complete* matching cost — the math optimizes the sum, not physical plausibility. Fix: reject any matched pair whose cost exceeds a no-match threshold in post-processing, leaving that track unmatched (coasting) instead of force-paired.

### D4. How would you unit-test a Hungarian implementation you wrote?
Three layers: (1) brute-force oracle on random `n ≤ 8` matrices, asserting equal costs; (2) the complementary-slackness certificate — assert dual feasibility, matched-edge tightness, and `total == Σu + Σv` on every input; (3) edge cases — `n = 1`, all-equal, negative costs, rectangular (padded), and forbidden cells. The certificate check is the most valuable because it proves optimality without an oracle and catches potential-update bugs directly.

---

## Coding Challenge 1 (3 Languages)

### Challenge: Minimum-cost job assignment

> Given an `n × n` cost matrix, return the minimum total cost of assigning each worker exactly one job. Implement the `O(n³)` Hungarian algorithm.

#### Go

```go
package main

import "fmt"

const INF = 1 << 60

func minCostAssignment(cost [][]int) int {
	n := len(cost)
	u := make([]int, n+1)
	v := make([]int, n+1)
	p := make([]int, n+1)
	way := make([]int, n+1)
	for i := 1; i <= n; i++ {
		p[0] = i
		j0 := 0
		minv := make([]int, n+1)
		used := make([]bool, n+1)
		for j := range minv {
			minv[j] = INF
		}
		for {
			used[j0] = true
			i0, delta, j1 := p[j0], INF, -1
			for j := 1; j <= n; j++ {
				if used[j] {
					continue
				}
				cur := cost[i0-1][j-1] - u[i0] - v[j]
				if cur < minv[j] {
					minv[j], way[j] = cur, j0
				}
				if minv[j] < delta {
					delta, j1 = minv[j], j
				}
			}
			for j := 0; j <= n; j++ {
				if used[j] {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}
			j0 = j1
			if p[j0] == 0 {
				break
			}
		}
		for j0 != 0 {
			j1 := way[j0]
			p[j0] = p[j1]
			j0 = j1
		}
	}
	total := 0
	for j := 1; j <= n; j++ {
		total += cost[p[j]-1][j-1]
	}
	return total
}

func main() {
	cost := [][]int{{9, 11, 14}, {6, 15, 13}, {12, 13, 6}}
	fmt.Println(minCostAssignment(cost)) // 23
}
```

#### Java

```java
import java.util.Arrays;

public class MinCostAssignment {
    static final int INF = Integer.MAX_VALUE / 2;

    static int minCost(int[][] cost) {
        int n = cost.length;
        int[] u = new int[n + 1], v = new int[n + 1];
        int[] p = new int[n + 1], way = new int[n + 1];
        for (int i = 1; i <= n; i++) {
            p[0] = i;
            int j0 = 0;
            int[] minv = new int[n + 1];
            boolean[] used = new boolean[n + 1];
            Arrays.fill(minv, INF);
            do {
                used[j0] = true;
                int i0 = p[j0], delta = INF, j1 = -1;
                for (int j = 1; j <= n; j++) {
                    if (used[j]) continue;
                    int cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                    else minv[j] -= delta;
                }
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        int total = 0;
        for (int j = 1; j <= n; j++) total += cost[p[j] - 1][j - 1];
        return total;
    }

    public static void main(String[] args) {
        int[][] cost = {{9, 11, 14}, {6, 15, 13}, {12, 13, 6}};
        System.out.println(minCost(cost)); // 23
    }
}
```

#### Python

```python
INF = float("inf")


def min_cost_assignment(cost):
    n = len(cost)
    u = [0] * (n + 1)
    v = [0] * (n + 1)
    p = [0] * (n + 1)
    way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (n + 1)
        used = [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], INF, -1
            for j in range(1, n + 1):
                if used[j]:
                    continue
                cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j], way[j] = cur, j0
                if minv[j] < delta:
                    delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0 != 0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
    return sum(cost[p[j] - 1][j - 1] for j in range(1, n + 1))


if __name__ == "__main__":
    cost = [[9, 11, 14], [6, 15, 13], [12, 13, 6]]
    print(min_cost_assignment(cost))  # 23
```

---

## Coding Challenge 2 (3 Languages)

### Challenge: Maximize total profit (assignment of profits)

> Given an `n × n` profit matrix, assign each worker one job to **maximize** total profit. Reuse the min-cost solver via the `BIG - profit` transform.

#### Go

```go
package main

import "fmt"

func maxProfit(profit [][]int) int {
	n := len(profit)
	big := 0
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if profit[i][j] > big {
				big = profit[i][j]
			}
		}
	}
	cost := make([][]int, n)
	for i := range cost {
		cost[i] = make([]int, n)
		for j := range cost[i] {
			cost[i][j] = big - profit[i][j] // transform max -> min
		}
	}
	minCost := minCostAssignment(cost) // from Challenge 1
	return n*big - minCost              // undo the transform
}

func main() {
	profit := [][]int{{3, 5, 2}, {8, 4, 6}, {7, 9, 1}}
	fmt.Println(maxProfit(profit)) // 5 + 8 + 9 = 22
}
```

#### Java

```java
public class MaxProfitAssignment {
    static int maxProfit(int[][] profit) {
        int n = profit.length, big = 0;
        for (int[] row : profit) for (int x : row) big = Math.max(big, x);
        int[][] cost = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                cost[i][j] = big - profit[i][j];
        return n * big - MinCostAssignment.minCost(cost); // reuse Challenge 1
    }

    public static void main(String[] args) {
        int[][] profit = {{3, 5, 2}, {8, 4, 6}, {7, 9, 1}};
        System.out.println(maxProfit(profit)); // 22
    }
}
```

#### Python

```python
def max_profit(profit):
    n = len(profit)
    big = max(max(row) for row in profit)
    cost = [[big - profit[i][j] for j in range(n)] for i in range(n)]
    return n * big - min_cost_assignment(cost)  # reuse Challenge 1


if __name__ == "__main__":
    profit = [[3, 5, 2], [8, 4, 6], [7, 9, 1]]
    print(max_profit(profit))  # 22  (5 + 8 + 9)
```

---

## Common Pitfalls in Interviews

- **Non-square matrix.** Forgetting to pad rectangular inputs to square. The most common bug.
- **Maximization without transform.** Running the min solver on raw profits returns the *worst* plan.
- **INF overflow.** `INF = MaxInt` so `cost - u - v` or `δ`-updates overflow. Use `MaxInt/2`.
- **Reading cost from the reduced matrix.** Always sum the *original* costs for the final answer.
- **Using the `O(n⁴)` line-covering version on large `n`.** Use the `O(n³)` potentials template.
- **Greedy instead of optimal.** "Each worker picks their cheapest job" double-books and is suboptimal.
- **Assuming a unique optimum.** Ties exist; the algorithm returns one valid witness.
- **Wrong tool.** Using Hungarian for capacities (use min-cost flow) or pure cardinality (use Hopcroft-Karp).

---

## What Interviewers Are Really Testing

A Hungarian-algorithm question rarely checks whether you can recite a template. It probes three deeper things. First, **duality maturity**: can you state the assignment LP and its dual, explain that the potentials *are* the dual variables, and use complementary slackness (`Σu + Σv == cost`) to certify optimality without enumerating other matchings? That primal-dual reasoning is the real signal. Second, **algorithm selection**: do you recognize when the problem is genuinely assignment (balanced, one-to-one, exact, weighted) versus when it is min-cost flow (capacities), cardinality matching (Hopcroft-Karp), or an approximate-friendly large-scale problem (auction)? Choosing the cubic exact solver for a capacitated or tens-of-thousands-item problem is a red flag. Third, **the engineering corners**: the square-matrix requirement, the maximization transform, INF overflow, and — at senior level — gating, component decomposition, rectangular handling, output gates, and the latency budget of a per-frame tracker. The strongest candidates connect the algorithm to its theory (total unimodularity → integrality, König's theorem, the min-cost-flow reduction) and to its production reality (SciPy's Jonker-Volgenant, multi-object tracking). A compact algorithm like this is the perfect canvas to demonstrate LP duality, combinatorial optimization, and systems thinking in one conversation.
