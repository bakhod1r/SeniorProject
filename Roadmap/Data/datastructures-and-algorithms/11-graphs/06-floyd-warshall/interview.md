# Floyd-Warshall Algorithm — Interview Preparation

Floyd-Warshall is a favorite interview topic because it is short enough to write on a whiteboard, deep enough to probe dynamic-programming understanding, and full of subtle traps (loop order, INF overflow, negative cycles) that separate candidates who memorized three lines from those who understand *why* the three lines work. This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Aspect | Value |
|--------|-------|
| Problem | All-pairs shortest path (APSP) |
| Time | `O(V³)` |
| Space | `O(V²)` (in-place) |
| Negative edges | Supported |
| Negative cycles | Detected (`dist[i][i] < 0`), not solvable |
| Single-pair query after run | `O(1)` |
| Loop order | **`k` outermost**, then `i`, then `j` |
| Best regime | Dense graph, small `V` (≤ ~400) |

Core relaxation:

```text
dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
```

Initialization:

```text
dist[i][i] = 0
dist[i][j] = w(i, j)  if edge exists, else INF
```

Variant operators (same triple loop):

| Variant | Combine | Extend |
|---|---|---|
| Shortest path | `min` | `+` |
| Transitive closure | `OR` | `AND` |
| Widest / bottleneck | `max` | `min` |
| Counting shortest paths | `+` (on ties) | `×` |

---

## Junior Questions (12 Q&A)

### J1. What problem does Floyd-Warshall solve?
It computes the all-pairs shortest path: the shortest distance between every ordered pair of vertices `(i, j)` in a weighted directed graph. After it runs, `dist[i][j]` holds the shortest `i→j` distance, queryable in `O(1)`. It contrasts with single-source algorithms like Dijkstra, which only answer distances from one fixed source.

### J2. What is the time and space complexity?
`O(V³)` time — three nested loops each running `V` times — and `O(V²)` space for the distance matrix. With path reconstruction you add a second `O(V²)` matrix. The cubic time is fixed: there is no early exit or input-dependent speedup.

### J3. Write the core of the algorithm.
```text
for k in 0..V-1:
  for i in 0..V-1:
    for j in 0..V-1:
      dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
```
Three loops, `k` outermost. That is essentially the whole algorithm.

### J4. Why must the `k` loop be outermost?
`k` indexes the set of allowed intermediate vertices `{0,…,k-1}`. Each pass through `k` must relax *all* pairs through intermediate `k` before moving to `k+1`, because `dp[k+1]` depends on the fully-updated `dp[k]`. Putting `i` or `j` outside `k` finalizes some rows before the intermediate set is correct, producing wrong distances.

### J5. How do you initialize the distance matrix?
Diagonal to `0` (zero cost to stay), each edge `(u, v, w)` to `dist[u][v] = w`, and everything else to `INF` (no known path). For parallel edges, keep the minimum weight.

### J6. Can Floyd-Warshall handle negative edge weights?
Yes — that is one of its advantages over Dijkstra. It correctly computes shortest paths with negative edges, as long as there is no negative *cycle*. A negative cycle makes shortest paths undefined.

### J7. How do you detect a negative cycle?
After running, check the diagonal: if `dist[i][i] < 0` for any `i`, a negative-weight cycle is reachable from and back to `i`. A negative self-distance means you can loop and keep reducing cost, so "shortest path" is undefined.

### J8. What is the INF overflow pitfall?
If `INF` is set to the maximum integer and you compute `dist[i][k] + dist[k][j]` where both are `INF`, the sum overflows to a negative number and looks like a shorter path. Fix: set `INF = MAX/4`, or guard the relaxation with `if dist[i][k] < INF && dist[k][j] < INF`.

### J9. What is the difference between Floyd-Warshall and Dijkstra?
Dijkstra is single-source, non-negative-weights only, and fast on sparse graphs (`O(E log V)`). Floyd-Warshall is all-pairs, handles negative edges, detects negative cycles, and is `O(V³)`. Use Dijkstra (run `V` times) on sparse non-negative graphs; use Floyd-Warshall on dense small graphs or when you need every pair simply.

### J10. What is transitive closure?
The boolean version: `reach[i][j]` is true iff `j` is reachable from `i` by any path. It uses the same triple loop with `OR` and `AND` instead of `min` and `+`: `reach[i][j] = reach[i][j] OR (reach[i][k] AND reach[k][j])`. This is Warshall's original algorithm.

### J11. How do you recover the actual path, not just the distance?
Keep a `next` matrix: `next[i][j]` is the first vertex to step to from `i` toward `j`. Initialize `next[i][j] = j` for edges. On relaxation through `k`, set `next[i][j] = next[i][k]`. To reconstruct, follow `i → next[i][j] → …` until reaching `j`.

### J12 (analysis). Why is it `O(V²)` space and not `O(V³)`?
The natural DP has a `dp[k][i][j]` table — `O(V³)`. But each layer only depends on the previous one, and it turns out you can overwrite a single 2D matrix in place because the pivot row `k` and column `k` do not change during pass `k`. So the third dimension collapses to `O(V²)`.

---

## Middle Questions (12 Q&A)

### M1. Derive the DP recurrence.
Define `dp[k][i][j]` as the shortest `i→j` distance using only `{0,…,k-1}` as intermediates. To extend to `k+1`, vertex `k` is either on the optimal path or not: not on it gives `dp[k][i][j]`; on it gives `dp[k][i][k] + dp[k][k][j]` (split at the single occurrence of `k`). Take the min: `dp[k+1][i][j] = min(dp[k][i][j], dp[k][i][k] + dp[k][k][j])`.

### M2. Prove the in-place update is correct.
During pass `k`, the pivot row `dist[k][*]` and column `dist[*][k]` are invariant: updating `dist[k][j]` would use `dist[k][k] + dist[k][j]`, and `dist[k][k] = 0` (no negative cycle), so nothing changes. Therefore the relaxation always reads the correct `dp[k]` values for the pivot, and other cells only decrease monotonically toward `dp[k+1]`. Hence overwriting one matrix is safe.

### M3. When do you prefer V × Dijkstra over Floyd-Warshall?
On sparse graphs with non-negative weights. `V` runs of Dijkstra cost `O(V·E log V)`, which for `E = O(V)` is `O(V² log V)` — far better than `O(V³)`. Floyd-Warshall wins only when the graph is dense (`E ≈ V²`) or has negative edges, or when `V` is small and code simplicity matters.

### M4. What is Johnson's algorithm and when is it used?
Johnson's solves APSP on sparse graphs *with negative edges*. It runs one Bellman-Ford pass to compute a potential `h(v)`, reweights every edge to `w'(u,v) = w(u,v) + h(u) - h(v) ≥ 0` (non-negative, preserving shortest paths), then runs Dijkstra from each vertex. Total `O(V·E + V·E log V)`, beating Floyd-Warshall's `O(V³)` on sparse graphs.

### M5. How do you compute the widest (bottleneck) path?
The widest path maximizes the minimum edge capacity along the route. Use `(max, min)`: `width[i][j] = max(width[i][j], min(width[i][k], width[k][j]))`. Initialize with direct capacities (0 = no edge). This is the maximin variant.

### M6. How do you count the number of shortest paths?
Maintain a `cnt` matrix alongside `dist`. On a strict improvement (`dist[i][k]+dist[k][j] < dist[i][j]`), set `cnt[i][j] = cnt[i][k]*cnt[k][j]`. On a tie (`==`), add `cnt[i][j] += cnt[i][k]*cnt[k][j]`. Use modular arithmetic because counts can grow exponentially.

### M7. Why does Floyd-Warshall handle negatives but Dijkstra does not?
Dijkstra greedily finalizes the closest unsettled vertex, assuming no later edge can reduce a settled distance — false with negative edges. Floyd-Warshall makes no greedy commitment; it relaxes every pair through every intermediate, so a negative edge discovered "late" still propagates correctly through the DP.

### M8. What goes wrong with INF arithmetic and how do you fix it robustly?
`INF + finite` can overflow if `INF = MAX_INT`. Two robust fixes: (1) set `INF` to roughly `MAX/4` so `INF + INF` stays representable and stays "large"; (2) guard the relaxation so you never add through an unreachable intermediate. Most production code uses both.

### M9. Can you parallelize Floyd-Warshall?
Yes, within each `k`. For a fixed `k`, all `(i, j)` relaxations are independent (they read the read-only pivot row/column and write disjoint cells), so the inner double loop parallelizes across threads. You need a barrier between consecutive `k` values. You cannot parallelize across `k` — the layers are sequential.

### M10. How do you find the graph diameter with Floyd-Warshall?
Run it once, then the diameter is `max over all i,j of dist[i][j]` (over reachable pairs). The center is the vertex minimizing its eccentricity `max_j dist[i][j]`. Both are natural `O(V²)` post-processing scans of the matrix.

### M11. How would you handle an undirected graph?
Add each edge in both directions with the same weight: `dist[u][v] = dist[v][u] = w`. Note that a single negative-weight undirected edge is automatically a negative cycle (you can bounce `u→v→u`), so undirected graphs with negative edges are usually ill-posed.

### M12 (analysis). What is the connection to matrix multiplication?
Floyd-Warshall computes the closure of the weight matrix under the min-plus (tropical) semiring, where `⊗ = +` and `⊕ = min`. It is Kleene's closure algorithm specialized to that semiring. Swapping operators gives transitive closure (Boolean semiring), widest path (max-min), and path counting — all the same `O(V³)` closure in different algebras.

---

## Senior Questions (10 Q&A)

### S1. Compare Floyd-Warshall, V × Dijkstra, and Johnson's at scale.
Floyd-Warshall: `O(V³)`, handles negatives, best on dense small graphs. `V ×` Dijkstra: `O(V·E log V)`, non-negative only, best on sparse graphs. Johnson's: `O(V·E + V·E log V)`, handles negatives via reweighting, best on sparse graphs with negatives. The decision is density-driven: sparse → Dijkstra/Johnson's; dense or simple → Floyd-Warshall.

### S2. How do you make Floyd-Warshall cache-efficient?
Use a flat 1D matrix (`dist[i*n+j]`) for locality, then apply **blocking/tiling**: partition into `β×β` tiles processed in three dependency phases (pivot tile, pivot row/column, remaining tiles). Each tile fits in cache and is reused `β` times, cutting cache misses to `Θ(n³/(B√M))` while keeping `Θ(n³)` work.

### S3. How would you serve a precomputed distance matrix in production?
Build it as an offline batch job (on schedule or topology change), then serve from an immutable, versioned artifact: queries are single array reads, lock-free and shardable by row. Use read-copy-update for rebuilds — build a new matrix, atomically swap a pointer — so readers never see a torn matrix.

### S4. The graph is huge and sparse with a few negative edges. What do you use?
Johnson's algorithm. Floyd-Warshall's `O(V³)` and `O(V²)` memory are both prohibitive for huge sparse graphs. Johnson's reweights once with Bellman-Ford then runs Dijkstra per source, giving near-`O(V² log V)` on sparse inputs while still handling the negative edges.

### S5. One edge weight decreased. Do you rebuild from scratch?
No. An edge `(u,v)` dropping to `w` folds in `O(V²)`: if `w < dist[u][v]`, set it, then `dist[i][j] = min(dist[i][j], dist[i][u] + w + dist[v][j])` for all `i,j`. Edge *increases* are harder (potentially full `O(V³)`), so most systems treat increases as a full rebuild trigger.

### S6. How do you detect and handle negative cycles operationally?
After building, scan the diagonal for `dist[i][i] < 0`. If found, refuse to publish the matrix, emit an alert, and keep serving the last good version — never serve a matrix with a negative diagonal, since affected distances are `-∞` and meaningless. Optionally propagate `-∞` to all pairs routed through a negative-cycle vertex.

### S7. What is the memory wall and when does it bite?
`O(V²)`. An `int32` matrix at `V=30,000` is ~3.6 GB; add a `next` matrix and double it. Beyond ~`30k–40k` vertices a single node struggles. Monitor `matrix_bytes` and alert well below node RAM, because a slowly growing vertex count silently moves you from "fits" to OOM.

### S8. How does the min-plus semiring barrier relate to subcubic APSP?
APSP reduces to min-plus (tropical) matrix product, which — unlike ring matrix product (`O(n^ω)`, `ω<2.373`) — has no known truly subcubic algorithm because the tropical semiring lacks subtraction, blocking Strassen-style cancellation. Williams (2014) achieved `n³/2^{Ω(√log n)}`, beating all `n³/polylog` bounds but still not truly subcubic.

### S9. When would you choose contraction hierarchies over Floyd-Warshall?
For road-network-scale graphs (`V` in the millions) where both fast queries and updates matter. Floyd-Warshall's cubic build and quadratic memory are impossible there; contraction hierarchies (or hub labeling) preprocess once and answer queries in near-logarithmic time with tractable memory.

### S10 (analysis). Why is there no average-case speedup for Floyd-Warshall?
The triple loop is oblivious to edge presence and weights — it executes exactly `V³` relaxations regardless of input. There is no data-dependent branch that prunes work asymptotically. Micro-optimizations (skipping a row when `dist[i][k]=INF`) save constant factors but never change the `Θ(V³)` class, in best, average, and worst case alike.

---

## Professional Questions (8 Q&A)

### P1. State and prove the loop-invariant for correctness.
Invariant: after pass `k`, `dist[i][j]` equals the shortest `i→j` distance using only `{0,…,k}` as intermediates. Proof by induction: base `k=-1` is the raw weight matrix. Step: a shortest path with intermediates in `{0,…,k}` either avoids `k` (cost `= dp[k-1][i][j]`) or uses `k` exactly once (no negative cycle), splitting into two `{0,…,k-1}`-restricted sub-paths summing to `dp[k-1][i][k]+dp[k-1][k][j]`; the min is the recurrence.

### P2. Prove that in-place overwriting does not corrupt the result.
Two lemmas. (1) During pass `k`, the pivot row `dist[k][*]` and column `dist[*][k]` are invariant, since any update to them would route through `dist[k][k]=0` (no negative cycle) and leave them unchanged. (2) Every stored value corresponds to a real walk, so it is `≥` the true `dp[k]` value, and updates only decrease it. Together: the relaxation always reads correct pivot values and converges each cell to `dp[k]` regardless of update order within the pass.

### P3. Explain Floyd-Warshall as a closed-semiring closure.
Over the semiring `(S, ⊕, ⊗, 0̄, 1̄)`, Kleene's algorithm computes the matrix closure `W* = ⊕_{i≥0} W^i`. Floyd-Warshall is the min-plus (tropical) instance: `⊕=min`, `⊗=+`, `0̄=+∞`, `1̄=0`, so `(W*)[i][j] = δ(i,j)`. The same `O(V³)` closure with Boolean, max-min, or `(+,×)` semirings yields reachability, bottleneck, and counting — correctness carries over via semiring distributivity.

### P4. What is the best known asymptotic bound for exact real-weight APSP?
Williams (2014): `n³ / 2^{Ω(√(log n))}`, using the polynomial method from circuit complexity. It beats every `n³/log^c n` bound but is still `n^{3-o(1)}` — not truly subcubic. Under the APSP conjecture (a pillar of fine-grained complexity), no `O(n^{3-ε})` algorithm exists, and APSP is subcubic-equivalent to min-plus product, negative-triangle detection, and several other problems.

### P5. How do special graph classes beat the cubic bound?
Undirected unweighted: Seidel's algorithm, `O(n^ω log n)` via real matrix multiplication and a parity trick — genuinely subcubic. Small integer weights `≤ M`: `Õ(M·n^ω)`-style bounds via fast (max,min) / rectangular matrix product (Zwick). Planar graphs: `O(n²)` exploiting separators. These all rely on structure that general real-weight min-plus lacks.

### P6. Give the cache complexity of blocked Floyd-Warshall.
With cache size `M`, line size `B`, tile side `β=Θ(√M)`: blocked Floyd-Warshall incurs `Θ(n³/(B√M))` cache misses, an `Θ(√M)` improvement over the naive `Θ(n³/B)`. A cache-oblivious recursive formulation achieves the same bound without knowing `M` or `B`. The `Θ(n³)` work is unchanged; only memory traffic improves — but that dominates wall-clock for large `n`.

### P7. How would you propagate `-∞` to all affected pairs after detecting a negative cycle?
After the main run, collect cycle vertices `T = {t : dist[t][t] < 0}`. Then for all `i,j`: if there exists `t ∈ T` with `dist[i][t] < INF` and `dist[t][j] < INF`, set `dist[i][j] = -∞`. This second `O(V³)` (or `O(V²·|T|)`) pass marks every pair whose shortest path can be driven to `-∞` by routing through a negative cycle.

### P8 (analysis). Why does min-plus matrix product lack a Strassen-style speedup?
Strassen and fast matrix multiplication rely on *subtraction* to cancel intermediate products, reducing the multiply count below `n³`. The tropical/min-plus semiring `(min, +)` has no additive inverse — there is no "subtraction" of a `min`. Without cancellation, the algebraic identities underpinning `O(n^ω)` do not apply, so no truly subcubic min-plus product is known, which is exactly the barrier to subcubic exact APSP.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose all-pairs precomputation over on-demand computation.
Look for a structured story: the workload (e.g. millions of pairwise distance queries over a static, dense, small graph), alternatives (per-query Dijkstra, caching), the decision criteria (query latency, graph stability, memory budget), and why a precomputed Floyd-Warshall matrix won. Strong answers cite numbers — `V`, query rate, matrix size — and acknowledge the staleness/rebuild trade-off.

### B2. Design a service that answers "shortest route between any two of our 300 warehouses."
Floyd-Warshall is the natural fit: `V=300`, `V³ ≈ 2.7×10⁷` (sub-millisecond build), `V²` matrix ~360 KB. Discuss precompute-and-serve, versioning for freshness, rebuilding on road-network change, and `O(1)` query serving. Mention falling back to on-demand Dijkstra for warehouses touched by very recent changes (a dirty set).

### B3. Your distance matrix occasionally serves impossible (too-short) routes. Diagnose.
Almost certainly INF overflow: `INF + INF` wrapped to a negative value and fabricated a phantom path. Or a negative cycle in the input made some distances `-∞`. Check the INF constant (use `MAX/4`), add the overflow guard, and scan the diagonal for negative entries before publishing. Add an invariant test with a deliberately unreachable pair and a negative edge.

### B4. A junior asks "why not always precompute all pairs with Floyd-Warshall?" How do you respond?
Explain the regime: it shines only for dense, small, static graphs with a read-heavy query pattern. For sparse graphs it is asymptotically wasteful (Dijkstra-per-source or Johnson's is far better); for large `V` the `O(V²)` memory and `O(V³)` build are prohibitive; for changing graphs you pay full rebuilds. Use it as a teaching moment about matching algorithm to graph density and query pattern.

### B5. The nightly matrix build started overrunning its window. How do you investigate and fix?
The driver is `V`: cubic growth means a modest vertex increase blows the budget. Confirm via `build_duration` vs `vertex_count` metrics. Fixes in order of effort: switch to a flat 1D matrix and blocked/parallel build; offload to GPU; cap `V` via graph contraction; or migrate to a hierarchical method (contraction hierarchies) if `V` has outgrown the cubic approach entirely.

---

## Coding Challenges

### Challenge 1: Find the City With the Smallest Number of Reachable Neighbors

**Problem.** There are `n` cities numbered `0..n-1` connected by bidirectional weighted roads. Given a `distanceThreshold`, find the city with the **fewest** other cities reachable within the threshold (sum of edge weights along the path ≤ threshold). If multiple cities tie, return the one with the **greatest** index. (LeetCode 1334.)

**Example.**
```text
n = 4, edges = [[0,1,3],[1,2,1],[1,3,4],[2,3,1]], threshold = 4
distances: 0-1=3, 0-2=4, 0-3=5(>4), 1-2=1, 1-3=3, 2-3=1
reachable counts: city0->{1,2}=2, city1->{0,2,3}=3, city2->{0,1,3}=3, city3->{1,2}=2
answer = 3  (tie between 0 and 3 -> greatest index)
```

**Constraints.** `2 <= n <= 100`, weights and threshold fit in 32-bit ints. Small `n` and all-pairs requirement → Floyd-Warshall is ideal.

**Approach.** Run Floyd-Warshall to get all-pairs distances, then for each city count how many others are within the threshold, and pick the smallest count breaking ties by larger index.

**Go.**

```go
package main

import "fmt"

func findTheCity(n int, edges [][]int, threshold int) int {
	const INF = 1 << 30
	dist := make([][]int, n)
	for i := range dist {
		dist[i] = make([]int, n)
		for j := range dist[i] {
			if i == j {
				dist[i][j] = 0
			} else {
				dist[i][j] = INF
			}
		}
	}
	for _, e := range edges {
		u, v, w := e[0], e[1], e[2]
		dist[u][v] = w
		dist[v][u] = w
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if dist[i][k] >= INF {
				continue
			}
			for j := 0; j < n; j++ {
				if dist[i][k]+dist[k][j] < dist[i][j] {
					dist[i][j] = dist[i][k] + dist[k][j]
				}
			}
		}
	}
	best, bestCount := -1, n+1
	for i := 0; i < n; i++ {
		c := 0
		for j := 0; j < n; j++ {
			if i != j && dist[i][j] <= threshold {
				c++
			}
		}
		if c <= bestCount { // <= so ties pick the larger index
			bestCount = c
			best = i
		}
	}
	return best
}

func main() {
	edges := [][]int{{0, 1, 3}, {1, 2, 1}, {1, 3, 4}, {2, 3, 1}}
	fmt.Println(findTheCity(4, edges, 4)) // 3
}
```

**Java.**

```java
public class FindTheCity {
    public int findTheCity(int n, int[][] edges, int threshold) {
        final int INF = 1 << 30;
        int[][] dist = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                dist[i][j] = (i == j) ? 0 : INF;
        for (int[] e : edges) {
            dist[e[0]][e[1]] = e[2];
            dist[e[1]][e[0]] = e[2];
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (dist[i][k] >= INF) continue;
                for (int j = 0; j < n; j++)
                    if (dist[i][k] + dist[k][j] < dist[i][j])
                        dist[i][j] = dist[i][k] + dist[k][j];
            }
        int best = -1, bestCount = n + 1;
        for (int i = 0; i < n; i++) {
            int c = 0;
            for (int j = 0; j < n; j++)
                if (i != j && dist[i][j] <= threshold) c++;
            if (c <= bestCount) { bestCount = c; best = i; }
        }
        return best;
    }

    public static void main(String[] args) {
        int[][] edges = {{0, 1, 3}, {1, 2, 1}, {1, 3, 4}, {2, 3, 1}};
        System.out.println(new FindTheCity().findTheCity(4, edges, 4)); // 3
    }
}
```

**Python.**

```python
def find_the_city(n, edges, threshold):
    INF = 1 << 30
    dist = [[0 if i == j else INF for j in range(n)] for i in range(n)]
    for u, v, w in edges:
        dist[u][v] = w
        dist[v][u] = w
    for k in range(n):
        for i in range(n):
            if dist[i][k] >= INF:
                continue
            dik = dist[i][k]
            for j in range(n):
                if dik + dist[k][j] < dist[i][j]:
                    dist[i][j] = dik + dist[k][j]
    best, best_count = -1, n + 1
    for i in range(n):
        c = sum(1 for j in range(n) if i != j and dist[i][j] <= threshold)
        if c <= best_count:  # <= so ties favor the larger index
            best_count, best = c, i
    return best


if __name__ == "__main__":
    edges = [[0, 1, 3], [1, 2, 1], [1, 3, 4], [2, 3, 1]]
    print(find_the_city(4, edges, 4))  # 3
```

**Follow-up.** What if `n` were 10⁵ and the graph sparse? Floyd-Warshall's `O(V³)` is infeasible; run Dijkstra from each city instead (`O(V·E log V)`), or note that the threshold lets you prune.

---

### Challenge 2: Evaluate Division (Reachability + Product Semiring)

**Problem.** Given equations like `a / b = 2.0` and `b / c = 3.0`, answer queries such as `a / c`. Return `-1.0` for any query whose answer is not determined. (LeetCode 399.) This is a Floyd-Warshall over the *product* semiring: treat each variable as a vertex, each equation `a/b = k` as edges `a→b (k)` and `b→a (1/k)`, and "multiply along the path."

**Approach.** Map variables to indices. Build a ratio matrix `r[i][j]` = value of `i/j` (or 0 = unknown), with `r[i][i]=1`. Relax with `r[i][j] = r[i][k] * r[k][j]` when both legs are known.

**Go.**

```go
package main

import "fmt"

func calcEquation(equations [][]string, values []float64, queries [][]string) []float64 {
	id := map[string]int{}
	for _, e := range equations {
		for _, v := range e {
			if _, ok := id[v]; !ok {
				id[v] = len(id)
			}
		}
	}
	n := len(id)
	r := make([][]float64, n)
	for i := range r {
		r[i] = make([]float64, n)
		r[i][i] = 1
	}
	for i, e := range equations {
		a, b := id[e[0]], id[e[1]]
		r[a][b] = values[i]
		r[b][a] = 1 / values[i]
	}
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if r[i][k] == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				if r[k][j] != 0 && r[i][j] == 0 {
					r[i][j] = r[i][k] * r[k][j]
				}
			}
		}
	}
	out := make([]float64, len(queries))
	for q, qq := range queries {
		a, okA := id[qq[0]]
		b, okB := id[qq[1]]
		if !okA || !okB || r[a][b] == 0 {
			out[q] = -1
		} else {
			out[q] = r[a][b]
		}
	}
	return out
}

func main() {
	eq := [][]string{{"a", "b"}, {"b", "c"}}
	val := []float64{2.0, 3.0}
	qs := [][]string{{"a", "c"}, {"b", "a"}, {"a", "e"}, {"x", "x"}}
	fmt.Println(calcEquation(eq, val, qs)) // [6 0.5 -1 -1]
}
```

**Java.**

```java
import java.util.*;

public class EvaluateDivision {
    public double[] calcEquation(List<List<String>> equations, double[] values,
                                 List<List<String>> queries) {
        Map<String, Integer> id = new HashMap<>();
        for (List<String> e : equations)
            for (String v : e) id.putIfAbsent(v, id.size());
        int n = id.size();
        double[][] r = new double[n][n];
        for (int i = 0; i < n; i++) r[i][i] = 1.0;
        for (int i = 0; i < equations.size(); i++) {
            int a = id.get(equations.get(i).get(0));
            int b = id.get(equations.get(i).get(1));
            r[a][b] = values[i];
            r[b][a] = 1.0 / values[i];
        }
        for (int k = 0; k < n; k++)
            for (int i = 0; i < n; i++) {
                if (r[i][k] == 0) continue;
                for (int j = 0; j < n; j++)
                    if (r[k][j] != 0 && r[i][j] == 0)
                        r[i][j] = r[i][k] * r[k][j];
            }
        double[] out = new double[queries.size()];
        for (int q = 0; q < queries.size(); q++) {
            Integer a = id.get(queries.get(q).get(0));
            Integer b = id.get(queries.get(q).get(1));
            out[q] = (a == null || b == null || r[a][b] == 0) ? -1.0 : r[a][b];
        }
        return out;
    }

    public static void main(String[] args) {
        EvaluateDivision s = new EvaluateDivision();
        var eq = List.of(List.of("a", "b"), List.of("b", "c"));
        var qs = List.of(List.of("a", "c"), List.of("b", "a"),
                         List.of("a", "e"), List.of("x", "x"));
        System.out.println(Arrays.toString(
            s.calcEquation(eq, new double[]{2.0, 3.0}, qs))); // [6.0, 0.5, -1.0, -1.0]
    }
}
```

**Python.**

```python
def calc_equation(equations, values, queries):
    id_ = {}
    for a, b in equations:
        id_.setdefault(a, len(id_))
        id_.setdefault(b, len(id_))
    n = len(id_)
    r = [[0.0] * n for _ in range(n)]
    for i in range(n):
        r[i][i] = 1.0
    for (a, b), v in zip(equations, values):
        ia, ib = id_[a], id_[b]
        r[ia][ib] = v
        r[ib][ia] = 1.0 / v
    for k in range(n):
        for i in range(n):
            if r[i][k] == 0:
                continue
            for j in range(n):
                if r[k][j] != 0 and r[i][j] == 0:
                    r[i][j] = r[i][k] * r[k][j]
    out = []
    for a, b in queries:
        if a not in id_ or b not in id_ or r[id_[a]][id_[b]] == 0:
            out.append(-1.0)
        else:
            out.append(r[id_[a]][id_[b]])
    return out


if __name__ == "__main__":
    eq = [["a", "b"], ["b", "c"]]
    val = [2.0, 3.0]
    qs = [["a", "c"], ["b", "a"], ["a", "e"], ["x", "x"]]
    print(calc_equation(eq, val, qs))  # [6.0, 0.5, -1.0, -1.0]
```

**Follow-up.** This is the `(any, ×)` semiring closure. The same skeleton with `(min, +)` gives shortest paths and with `(OR, AND)` gives reachability — emphasize to the interviewer that you recognized the closure pattern.

---

### Challenge 3: Course Schedule IV (Transitive Closure)

**Problem.** There are `numCourses` courses and a list of direct prerequisites `[a, b]` meaning `a` must be taken before `b`. For each query `[u, v]`, answer whether `u` is a prerequisite of `v` (directly or indirectly). (LeetCode 1462.) This is the **transitive closure** — Warshall's algorithm.

**Approach.** Build a boolean reachability matrix; relax with `reach[i][j] |= reach[i][k] && reach[k][j]`; answer each query in `O(1)`.

**Go.**

```go
package main

import "fmt"

func checkIfPrerequisite(numCourses int, prerequisites [][]int, queries [][]int) []bool {
	reach := make([][]bool, numCourses)
	for i := range reach {
		reach[i] = make([]bool, numCourses)
	}
	for _, p := range prerequisites {
		reach[p[0]][p[1]] = true
	}
	for k := 0; k < numCourses; k++ {
		for i := 0; i < numCourses; i++ {
			if !reach[i][k] {
				continue
			}
			for j := 0; j < numCourses; j++ {
				if reach[k][j] {
					reach[i][j] = true
				}
			}
		}
	}
	out := make([]bool, len(queries))
	for q, qq := range queries {
		out[q] = reach[qq[0]][qq[1]]
	}
	return out
}

func main() {
	pre := [][]int{{1, 2}, {1, 0}, {2, 0}}
	qs := [][]int{{1, 0}, {1, 2}, {0, 1}}
	fmt.Println(checkIfPrerequisite(3, pre, qs)) // [true true false]
}
```

**Java.**

```java
import java.util.*;

public class CourseScheduleIV {
    public List<Boolean> checkIfPrerequisite(int numCourses, int[][] prerequisites,
                                             int[][] queries) {
        boolean[][] reach = new boolean[numCourses][numCourses];
        for (int[] p : prerequisites) reach[p[0]][p[1]] = true;
        for (int k = 0; k < numCourses; k++)
            for (int i = 0; i < numCourses; i++) {
                if (!reach[i][k]) continue;
                for (int j = 0; j < numCourses; j++)
                    if (reach[k][j]) reach[i][j] = true;
            }
        List<Boolean> out = new ArrayList<>();
        for (int[] q : queries) out.add(reach[q[0]][q[1]]);
        return out;
    }

    public static void main(String[] args) {
        int[][] pre = {{1, 2}, {1, 0}, {2, 0}};
        int[][] qs = {{1, 0}, {1, 2}, {0, 1}};
        System.out.println(new CourseScheduleIV()
            .checkIfPrerequisite(3, pre, qs)); // [true, true, false]
    }
}
```

**Python.**

```python
def check_if_prerequisite(num_courses, prerequisites, queries):
    reach = [[False] * num_courses for _ in range(num_courses)]
    for a, b in prerequisites:
        reach[a][b] = True
    for k in range(num_courses):
        for i in range(num_courses):
            if not reach[i][k]:
                continue
            row_k = reach[k]
            row_i = reach[i]
            for j in range(num_courses):
                if row_k[j]:
                    row_i[j] = True
    return [reach[u][v] for u, v in queries]


if __name__ == "__main__":
    pre = [[1, 2], [1, 0], [2, 0]]
    qs = [[1, 0], [1, 2], [0, 1]]
    print(check_if_prerequisite(3, pre, qs))  # [True, True, False]
```

**Follow-up.** For very large sparse DAGs, transitive closure via Warshall is `O(V³)` and wasteful; a per-source BFS/DFS or a bitset-packed closure (`O(V³/64)`) is better. Mention the bitset trick: pack each row as a bitword array and OR whole rows.

---

## Common Pitfalls in Interviews

- **Wrong loop order.** Writing `i` or `j` outside `k`. The single most common Floyd-Warshall bug. Always `k, i, j`.
- **INF overflow.** Using `MAX_INT` as INF so `INF + w` or `INF + INF` overflows to a "short" path. Use `MAX/4` and/or guard.
- **Forgetting negative-cycle detection.** Reporting distances without checking `dist[i][i] < 0`.
- **Using it on a sparse/large graph.** `O(V³)` and `O(V²)` are wrong when `V` is large; mention Dijkstra-per-source or Johnson's.
- **Treating it as single-source.** Running the full cube when one Dijkstra would do.
- **Reconstruction bug.** Setting `next[i][j] = k` instead of `next[i][j] = next[i][k]` on relaxation.
- **Undirected negative edges.** Forgetting that a single negative undirected edge is a negative cycle.
- **Not recognizing the semiring.** Missing that division/reachability/bottleneck problems are the *same* triple loop with different operators.

---

## What Interviewers Are Really Testing

A Floyd-Warshall question rarely checks whether you can recite three lines. It probes three deeper things. First, **dynamic-programming maturity**: can you state the `dp[k][i][j]` recurrence, justify why `k` is outermost, and explain why the in-place 2D collapse is correct? That reasoning, not the code, distinguishes understanding from memorization. Second, **algorithm selection**: do you recognize when Floyd-Warshall is right (dense, small, all-pairs, negatives) versus when Dijkstra-per-source or Johnson's dominates (sparse)? Picking the cube on a million-node sparse graph is an instant red flag. Third, **the corners**: INF overflow, negative-cycle detection, path reconstruction, and the semiring generalization (closure, bottleneck, counting, division). The strongest candidates also reach for production realities — precompute-and-serve, versioned immutable matrices, the `O(V²)` memory wall — and can connect the algorithm to its place in fine-grained complexity (min-plus product, the APSP conjecture, Williams' bound). A compact algorithm like this is the perfect canvas to demonstrate all of those dimensions in one conversation.
