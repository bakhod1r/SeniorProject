# NP-Hard: TSP & Hamiltonian Path/Cycle — Interview Preparation

TSP and Hamiltonian problems are interview favorites because they sit at the intersection of three things companies love to probe: **NP-completeness theory** (can you reason about hardness?), **bitmask dynamic programming** (the Held–Karp pattern recurs constantly), and **practical judgment** (do you know when to stop chasing the optimum and ship a heuristic?). This file is a graded question bank, five behavioral prompts, and four runnable coding challenges in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Concept | Key fact |
|---------|----------|
| Hamiltonian path/cycle | Visit every **vertex** once (cycle returns to start). |
| HAM-CYCLE | **NP-complete** decision problem. |
| TSP optimization | **NP-hard** (shortest Hamiltonian cycle). |
| Eulerian (contrast) | Visit every **edge** once — **easy** (polynomial). |
| Brute force | `O(n!)` — dies near `n = 12`. |
| Held–Karp | `O(2ⁿ·n²)` time, `O(2ⁿ·n)` space — exact, `n ≤ ~20`. |
| DP state | `dp[mask][i]` = shortest path from 0, covering `mask`, ending at `i`. |
| Base / transition | `dp[1][0]=0`; `dp[m\|1<<j][j] = min(dp[m][i]+d[i][j])`. |
| Cycle answer | `min_{i≠0} dp[FULL][i] + d[i][0]`. |
| MST lower bound | `w(MST) ≤ OPT`. |
| 2-approx (metric) | MST-doubling + shortcut → `≤ 2·OPT`. |
| Christofides (metric) | MST + min-matching on odd vertices + shortcut → `≤ 1.5·OPT`. |
| General TSP | **Inapproximable** to any constant unless P=NP. |
| Heuristics | nearest-neighbor, greedy-edge, 2-opt, Or-opt, Lin–Kernighan. |

Bitmask DP skeleton:

```text
for mask in [1 .. 2^n):                # ascending so predecessors are ready
    if mask has no bit 0: continue     # all paths start at 0
    for i in mask with dp[mask][i] < INF:
        for j not in mask:
            relax dp[mask | 1<<j][j] = dp[mask][i] + d[i][j]
answer = min_{i≠0} dp[FULL][i] + d[i][0]
```

---

## Junior Questions (12 Q&A)

### J1. What is a Hamiltonian path versus a Hamiltonian cycle?
A Hamiltonian path visits every vertex of a graph exactly once. A Hamiltonian cycle does the same but also returns from the last vertex to the first, forming a closed loop. The difference matters in code: a cycle adds the closing edge cost `d[last][start]`, a path does not.

### J2. What is the Traveling Salesman Problem?
Given a complete weighted graph, find the Hamiltonian cycle of minimum total weight — the cheapest route that visits every city once and returns to the start. It models delivery routing, PCB drilling, and DNA sequencing.

### J3. How is Hamiltonian cycle different from Eulerian cycle?
Hamiltonian visits every *vertex* once; Eulerian visits every *edge* once. The surprising part is the difficulty gap: deciding Eulerian existence is easy (check connectivity and that every vertex has even degree), while deciding Hamiltonian existence is NP-complete.

### J4. Why can't we just try all routes?
Brute force enumerates `(n-1)!/2` tours — factorial growth. At `n = 12` that is already ~20 million; by `n = 15` it is tens of billions. Factorials outpace any computer well before `n = 20`.

### J5. What does NP-complete mean for HAM-CYCLE?
It means HAM-CYCLE is in NP (a proposed cycle can be checked quickly) and is at least as hard as every NP problem. No polynomial algorithm is known, and most believe none exists (P ≠ NP). So we either accept exponential exact methods on small inputs or approximate.

### J6. What is the difference between NP-hard and NP-complete?
NP-complete problems are decision problems both in NP and NP-hard. NP-hard is broader: at least as hard as NP, but not necessarily in NP. TSP *optimization* is NP-hard (it is not a yes/no problem); TSP *decision* ("is there a tour ≤ B?") is NP-complete.

### J7. What is the Held–Karp algorithm and its complexity?
A bitmask DP that solves TSP exactly. State `dp[mask][i]` is the shortest path from city 0 visiting the set `mask` and ending at `i`. Time `O(2ⁿ·n²)`, space `O(2ⁿ·n)`. Practical up to about `n = 20`.

### J8. What does `dp[mask][i]` represent?
The length of the shortest path that starts at city 0, visits exactly the cities whose bits are set in `mask`, and currently ends at city `i` (with bit `i` set in `mask`). The order of intermediate visits doesn't matter — only which cities and where you are now.

### J9. How do you get the final tour length from the DP table?
Take the full mask (all bits set) and close the cycle: `min over i ≠ 0 of dp[FULL][i] + d[i][0]`. For an open path instead, drop the closing term: `min over i of dp[FULL][i]`.

### J10. Why must masks be iterated in increasing order?
Each transition writes to a mask with one more bit set than the source. Iterating masks ascending guarantees every predecessor state is already computed before it is used — the bitmask analogue of topological order in DP.

### J11. What is a bitmask and why is it used here?
A bitmask is an integer whose bits represent membership in a set: bit `i` set means city `i` is visited. It lets us index a DP table by "subset of cities" using a single integer, with `&`, `|`, `^` for set operations. Essential because the DP state *is* a subset.

### J12. What's a real-world application of TSP?
Vehicle routing (delivery, garbage collection), PCB drilling (minimize drill-head travel), DNA fragment assembly (overlap as distance), telescope/satellite scheduling, and warehouse picking order.

---

## Middle Questions (12 Q&A)

### M1. Walk through the Held–Karp transition carefully.
For each mask containing bit 0, and each end city `i` in the mask with a finite `dp[mask][i]`, try extending to every unvisited city `j`: `dp[mask | (1<<j)][j] = min(itself, dp[mask][i] + d[i][j])`. This "push" form avoids subtracting bits. After all masks, close the cycle.

### M2. Why is Held–Karp `O(2ⁿ·n²)` and not `O(2ⁿ·n)`?
There are `2ⁿ·n` states, but computing each requires scanning up to `n` predecessor cities `j`. The extra `n` factor for the inner relaxation loop gives `2ⁿ · n · n = O(2ⁿ·n²)`.

### M3. What limits Held–Karp in practice — time or space?
Space. The table holds `2ⁿ·n` numbers. At `n = 25` that's ~`8×10⁸` entries (gigabytes), which exhausts memory before the running time becomes intolerable. The practical ceiling is `n ≈ 20`.

### M4. How do you reconstruct the actual tour, not just its length?
Keep a `parent[mask][i]` table recording which `i` you came from. After finding the best closing city, walk parents backward, clearing the current bit each step, until you return to the start, then reverse.

### M5. What is the MST 2-approximation and when does it apply?
Build the MST, double its edges, take an Eulerian circuit, and shortcut repeated vertices. The triangle inequality makes shortcutting never increase length, yielding a tour `≤ 2·OPT`. It applies only to **metric** TSP (weights satisfy the triangle inequality).

### M6. What is Christofides' algorithm and its guarantee?
MST, then a minimum-weight perfect matching on the odd-degree vertices, combine to an Eulerian multigraph, Eulerian circuit, shortcut. Guarantee `≤ 1.5·OPT` for metric TSP. It beats doubling because the matching costs `≤ ½·OPT` instead of re-paying the whole tree.

### M7. Why does Christofides need a *perfect* matching on odd-degree vertices?
Adding matching edges to the MST must make every vertex even-degree so an Eulerian circuit exists. The odd-degree set always has even cardinality (handshake lemma), so a perfect matching on it exists; matching exactly fixes the parity of those vertices.

### M8. Is the nearest-neighbor heuristic any good?
It's fast (`O(n²)`) and intuitive but has no constant guarantee — worst case `Θ(log n)·OPT`. It greedily commits and gets stranded into expensive closing edges. Use it to *seed* a tour, then polish with 2-opt.

### M9. Explain a 2-opt move.
Remove two edges `(a,b)` and `(c,d)` from the tour and reconnect as `(a,c)` and `(b,d)`, reversing the segment between. If `d(a,c)+d(b,d) < d(a,b)+d(c,d)`, the move improves. For Euclidean tours this uncrosses crossing edges. Repeat to a local optimum (~5% from optimal typically).

### M10. Symmetric vs asymmetric TSP — what changes?
Symmetric: `d(i,j)=d(j,i)`. Asymmetric (ATSP): directions differ (one-way streets). Held–Karp works for both unchanged. But Christofides and 2-opt assume symmetry (matching and segment reversal break for ATSP); ATSP needs its own methods.

### M11. Can Held–Karp solve the *existence* of a Hamiltonian path?
Yes — replace the `min` cost DP with a boolean reachability DP: `reach[mask][i]` true if some path covers `mask` ending at `i`, extended only along real edges. A Hamiltonian path exists iff `reach[FULL][i]` is true for some `i`. Same `O(2ⁿ·n²)` structure.

### M12. When would you choose a heuristic over Christofides despite the weaker guarantee?
When the instance is non-metric (Christofides doesn't apply), asymmetric, very large, or when empirical quality matters more than a worst-case bound. In practice 2-opt and Lin–Kernighan beat Christofides on real Euclidean instances despite having no proven constant.

---

## Senior Questions (10 Q&A)

### S1. How do you solve a 5,000-stop routing problem when exact methods cap at ~20?
Cluster-first, route-second: partition stops geographically (sweep, k-means, grid), solve each ≤20-stop cluster exactly with Held–Karp or with a metaheuristic, then balance across vehicles. This bounds the exponential to per-cluster size.

### S2. What is usually the real bottleneck in a production routing system?
The distance/time matrix, not the optimizer. For `n` stops you need `n²` pairwise travel times. Querying a paid API is expensive; self-hosting OSRM/Valhalla and caching by `(origin, dest, time-bucket)` is the standard cost-control move.

### S3. How do you keep a slow solver from blocking dispatch?
Run it as an async job with a wall-clock deadline, using an *anytime* metaheuristic that always holds a valid best-so-far tour. Return the best found when the budget expires; never run unbounded in a request path.

### S4. How do you measure tour quality in production?
Compute the optimality gap `tour/LB − 1` against a lower bound (MST or Held–Karp 1-tree). Without a lower bound you can't distinguish a 3%-from-optimal tour from a 40% one — both just "look like routes."

### S5. What real constraints turn TSP into VRP?
Vehicle capacities (CVRP), delivery time windows (VRPTW), pickup-before-delivery precedence (PDPTW), multiple depots, driver shifts and breaks. These need constraint-based engines like OR-Tools, not raw TSP code.

### S6. Which production solvers would you reach for and when?
OR-Tools for constrained VRP (declares dimensions and constraints + metaheuristics). LKH (Lin–Kernighan–Helsgaun) for large pure (A)TSP, near-optimal. Concorde for exact record-setting TSP. Held–Karp only for tiny exact subproblems.

### S7. How do you handle re-optimization when one order is added or cancelled?
Warm start: seed the solver with the previous solution and let local search repair it, instead of solving from scratch. Faster and produces stable routes drivers trust.

### S8. What's the danger of feeding traffic-adjusted times into Christofides?
Traffic times can violate the triangle inequality (a detour avoiding a jam is faster), and they are asymmetric. Both break Christofides' assumptions, so the 1.5× guarantee no longer holds. Treat the result as a heuristic, not a guaranteed approximation.

### S9. How does branch-and-bound push exact solving beyond Held–Karp's `n ≈ 20`?
It explores partial tours and prunes any branch whose lower bound already exceeds the best complete tour. With strong bounds (reduced-cost, Held–Karp 1-tree) it solves `n = 40–60` exactly; with cutting planes (Concorde), thousands.

### S10. Capacity-plan a Held–Karp sub-solver. What's the binding resource?
Memory: `2ⁿ·n` ints. At `n=18` ~18 MB, `n=22` ~370 MB, `n=25` ~3.4 GB. That's why per-cluster caps sit near 18–20. CPU is mild (`n=18` is ~10⁸ ops, single-digit ms). Solves are embarrassingly parallel across jobs.

---

## Advanced / Theory Questions (8 Q&A)

### A1. Sketch why HAM-CYCLE is NP-complete.
Membership: a proposed cycle is verified in `O(n)`. Hardness: reduce 3-SAT to HAM-CYCLE with variable gadgets (a ladder traversed left/right encoding true/false) and clause gadgets (a vertex coverable iff a literal satisfies the clause). The graph has a Hamiltonian cycle iff the formula is satisfiable.

### A2. Prove TSP is NP-hard from HAM-CYCLE.
Given `G`, build `K_n` with weight 1 for edges of `G`, weight 2 for non-edges, budget `B = n`. A tour of weight `≤ n` must use only weight-1 edges (else it exceeds `n`), i.e. a Hamiltonian cycle in `G`. So `G ∈ HAM-CYCLE ⟺` the TSP instance has a tour `≤ n`.

### A3. State and justify the Held–Karp recurrence's correctness.
`g(S,i)=min_j g(S\{i},j)+w(j,i)`. By optimal substructure: in an optimal path covering `S` ending at `i`, drop the last edge `(j,i)`; the remainder must be an optimal path covering `S\{i}` ending at `j`, else swapping in a cheaper one would improve the whole — contradiction.

### A4. Prove `w(MST) ≤ OPT`.
Delete any edge from the optimal tour to get a spanning path, which is a spanning tree. The MST is the minimum spanning tree, so `w(MST) ≤ w(that tree) ≤ w(tour) = OPT`.

### A5. Prove the MST-doubling 2-approximation.
Doubled MST has weight `2·w(MST)` and all-even degrees, so it has an Eulerian circuit of that weight. Shortcutting repeated vertices doesn't increase length (triangle inequality). So the tour `≤ 2·w(MST) ≤ 2·OPT`.

### A6. Why is the matching in Christofides `≤ ½·OPT`?
Shortcut the optimal tour onto just the odd-degree vertices: a cycle of weight `≤ OPT`. An even cycle splits into two perfect matchings whose weights sum to that cycle's weight; the cheaper is `≤ ½·OPT`. The minimum matching is no worse, so `w(M) ≤ ½·OPT`. Total `w(T)+w(M) ≤ 1.5·OPT`.

### A7. Why is general TSP inapproximable but metric TSP is not?
The inapproximability proof uses a huge penalty `α·n+1` on non-edges, deliberately violating the triangle inequality, so that any constant-factor approximator would decide HAM-CYCLE. Metric TSP forbids such penalties (triangle inequality), which is exactly what makes shortcutting — and hence the 2- and 1.5-approximations — valid.

### A8. What is the Held–Karp 1-tree lower bound?
A 1-tree is a spanning tree on `V\{1}` plus the two cheapest edges at vertex 1; every tour is a 1-tree, so the min-weight 1-tree bounds `OPT` from below. Adding Lagrangian node penalties to push degrees toward 2 gives the Held–Karp bound — the tightest combinatorial TSP lower bound, used by Concorde-class solvers.

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose an approximate solution over an exact one.
*Structure:* Name the problem (large routing/scheduling instance), the constraint (deadline or scale made exact infeasible), the decision (heuristic with measured quality gap), and the outcome (shipped on time, gap monitored). Emphasize you *quantified* the trade-off rather than guessing.

### B2. Describe explaining an NP-hard limitation to a non-technical stakeholder.
*Structure:* The ask (a manager wanted "the perfect route, always"), how you framed exponential blow-up in plain terms ("checking every option would take longer than the universe's age past ~20 stops"), and the compromise (provably near-optimal, with a quality number they could trust).

### B3. Tell me about debugging a subtle correctness bug in a DP or optimization.
*Structure:* The symptom (tour length too small), root cause (forgot to close the cycle / `INF + w` overflow / wrong mask order), how you found it (tested against brute force on small `n`), and the lesson (always keep a brute-force oracle for verification).

### B4. Describe a time you had to push back on premature optimization.
*Structure:* A teammate wanted a custom branch-and-bound solver; you showed that an off-the-shelf OR-Tools/LKH solve met requirements in a fraction of the engineering time. Focus on cost-of-engineering vs marginal gain.

### B5. Tell me about a performance problem where the bottleneck wasn't where you expected.
*Structure:* You assumed the optimizer was slow; profiling revealed the `n²` distance-matrix build (API latency) dominated. The fix (self-host OSRM + cache) cut latency and cost. Lesson: profile before optimizing the obvious suspect.

---

## Coding Challenges

### Challenge 1 — Held–Karp shortest route (TSP)

**Problem.** Given an `n×n` distance matrix (`n ≤ 16`), return the length of the shortest tour starting and ending at city 0.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func tsp(d [][]int) int {
	n := len(d)
	const INF = math.MaxInt32
	full := (1 << n) - 1
	dp := make([][]int, 1<<n)
	for m := range dp {
		dp[m] = make([]int, n)
		for i := range dp[m] {
			dp[m][i] = INF
		}
	}
	dp[1][0] = 0
	for mask := 1; mask <= full; mask++ {
		if mask&1 == 0 {
			continue
		}
		for i := 0; i < n; i++ {
			if dp[mask][i] == INF || mask&(1<<i) == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				if mask&(1<<j) != 0 {
					continue
				}
				nm := mask | (1 << j)
				if dp[mask][i]+d[i][j] < dp[nm][j] {
					dp[nm][j] = dp[mask][i] + d[i][j]
				}
			}
		}
	}
	best := INF
	for i := 1; i < n; i++ {
		if dp[full][i]+d[i][0] < best {
			best = dp[full][i] + d[i][0]
		}
	}
	return best
}

func main() {
	d := [][]int{{0, 10, 15, 20}, {10, 0, 35, 25}, {15, 35, 0, 30}, {20, 25, 30, 0}}
	fmt.Println(tsp(d)) // 80
}
```

#### Java
```java
import java.util.*;

public class TSP {
    static int tsp(int[][] d) {
        int n = d.length, INF = Integer.MAX_VALUE / 2, full = (1 << n) - 1;
        int[][] dp = new int[1 << n][n];
        for (int[] r : dp) Arrays.fill(r, INF);
        dp[1][0] = 0;
        for (int mask = 1; mask <= full; mask++) {
            if ((mask & 1) == 0) continue;
            for (int i = 0; i < n; i++) {
                if (dp[mask][i] == INF || (mask & (1 << i)) == 0) continue;
                for (int j = 0; j < n; j++) {
                    if ((mask & (1 << j)) != 0) continue;
                    int nm = mask | (1 << j);
                    dp[nm][j] = Math.min(dp[nm][j], dp[mask][i] + d[i][j]);
                }
            }
        }
        int best = INF;
        for (int i = 1; i < n; i++) best = Math.min(best, dp[full][i] + d[i][0]);
        return best;
    }

    public static void main(String[] args) {
        int[][] d = {{0,10,15,20},{10,0,35,25},{15,35,0,30},{20,25,30,0}};
        System.out.println(tsp(d)); // 80
    }
}
```

#### Python
```python
import math


def tsp(d):
    n = len(d)
    INF = math.inf
    full = (1 << n) - 1
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0
    for mask in range(1, full + 1):
        if not (mask & 1):
            continue
        for i in range(n):
            if dp[mask][i] == INF or not (mask & (1 << i)):
                continue
            for j in range(n):
                if mask & (1 << j):
                    continue
                nm = mask | (1 << j)
                dp[nm][j] = min(dp[nm][j], dp[mask][i] + d[i][j])
    return min(dp[full][i] + d[i][0] for i in range(1, n))


print(tsp([[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]))  # 80
```

---

### Challenge 2 — Hamiltonian path existence via bitmask DP

**Problem.** Given an undirected graph as an adjacency matrix (`n ≤ 20`), decide whether a Hamiltonian path (any endpoints) exists.

#### Go
```go
package main

import "fmt"

func hasHamPath(adj [][]bool) bool {
	n := len(adj)
	reach := make([][]bool, 1<<n)
	for m := range reach {
		reach[m] = make([]bool, n)
	}
	for i := 0; i < n; i++ {
		reach[1<<i][i] = true
	}
	for mask := 0; mask < (1 << n); mask++ {
		for i := 0; i < n; i++ {
			if !reach[mask][i] {
				continue
			}
			for j := 0; j < n; j++ {
				if mask&(1<<j) == 0 && adj[i][j] {
					reach[mask|(1<<j)][j] = true
				}
			}
		}
	}
	full := (1 << n) - 1
	for i := 0; i < n; i++ {
		if reach[full][i] {
			return true
		}
	}
	return false
}

func main() {
	adj := [][]bool{
		{false, true, false, false},
		{true, false, true, false},
		{false, true, false, true},
		{false, false, true, false},
	}
	fmt.Println(hasHamPath(adj)) // true: 0-1-2-3
}
```

#### Java
```java
public class HamPath {
    static boolean has(boolean[][] adj) {
        int n = adj.length;
        boolean[][] reach = new boolean[1 << n][n];
        for (int i = 0; i < n; i++) reach[1 << i][i] = true;
        for (int mask = 0; mask < (1 << n); mask++)
            for (int i = 0; i < n; i++) {
                if (!reach[mask][i]) continue;
                for (int j = 0; j < n; j++)
                    if ((mask & (1 << j)) == 0 && adj[i][j])
                        reach[mask | (1 << j)][j] = true;
            }
        int full = (1 << n) - 1;
        for (int i = 0; i < n; i++) if (reach[full][i]) return true;
        return false;
    }

    public static void main(String[] args) {
        boolean[][] adj = {
            {false,true,false,false},
            {true,false,true,false},
            {false,true,false,true},
            {false,false,true,false},
        };
        System.out.println(has(adj)); // true
    }
}
```

#### Python
```python
def has_ham_path(adj):
    n = len(adj)
    reach = [[False] * n for _ in range(1 << n)]
    for i in range(n):
        reach[1 << i][i] = True
    for mask in range(1 << n):
        for i in range(n):
            if not reach[mask][i]:
                continue
            for j in range(n):
                if not (mask & (1 << j)) and adj[i][j]:
                    reach[mask | (1 << j)][j] = True
    full = (1 << n) - 1
    return any(reach[full][i] for i in range(n))


adj = [
    [False, True, False, False],
    [True, False, True, False],
    [False, True, False, True],
    [False, False, True, False],
]
print(has_ham_path(adj))  # True
```

---

### Challenge 3 — Nearest-neighbor tour

**Problem.** Given points in the plane, build a tour by always moving to the nearest unvisited city from city 0. Return the tour and its length.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func nearestNeighbor(pts [][2]float64) ([]int, float64) {
	n := len(pts)
	dist := func(a, b int) float64 {
		return math.Hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1])
	}
	seen := make([]bool, n)
	tour := []int{0}
	seen[0] = true
	total := 0.0
	for len(tour) < n {
		last := tour[len(tour)-1]
		best, bd := -1, math.Inf(1)
		for j := 0; j < n; j++ {
			if !seen[j] && dist(last, j) < bd {
				bd, best = dist(last, j), j
			}
		}
		seen[best] = true
		tour = append(tour, best)
		total += bd
	}
	total += dist(tour[len(tour)-1], 0)
	return tour, total
}

func main() {
	pts := [][2]float64{{0, 0}, {1, 5}, {5, 2}, {6, 6}}
	t, l := nearestNeighbor(pts)
	fmt.Println(t, l)
}
```

#### Java
```java
import java.util.*;

public class NN {
    static double dist(double[][] p, int a, int b) {
        return Math.hypot(p[a][0]-p[b][0], p[a][1]-p[b][1]);
    }
    static int[] nearestNeighbor(double[][] p) {
        int n = p.length;
        boolean[] seen = new boolean[n];
        int[] tour = new int[n];
        tour[0] = 0; seen[0] = true;
        for (int k = 1; k < n; k++) {
            int last = tour[k - 1], best = -1; double bd = Double.MAX_VALUE;
            for (int j = 0; j < n; j++)
                if (!seen[j] && dist(p, last, j) < bd) { bd = dist(p, last, j); best = j; }
            seen[best] = true; tour[k] = best;
        }
        return tour;
    }
    public static void main(String[] args) {
        double[][] p = {{0,0},{1,5},{5,2},{6,6}};
        System.out.println(Arrays.toString(nearestNeighbor(p)));
    }
}
```

#### Python
```python
import math


def nearest_neighbor(pts):
    n = len(pts)
    dist = lambda a, b: math.dist(pts[a], pts[b])
    seen = [False] * n
    tour = [0]
    seen[0] = True
    total = 0.0
    while len(tour) < n:
        last = tour[-1]
        best, bd = -1, math.inf
        for j in range(n):
            if not seen[j] and dist(last, j) < bd:
                bd, best = dist(last, j), j
        seen[best] = True
        tour.append(best)
        total += bd
    total += dist(tour[-1], 0)
    return tour, total


print(nearest_neighbor([(0, 0), (1, 5), (5, 2), (6, 6)]))
```

---

### Challenge 4 — 2-opt improvement

**Problem.** Given a tour and a distance function, repeatedly apply improving 2-opt moves until none remains. Return the improved tour length.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func twoOpt(tour []int, d func(a, b int) float64) []int {
	n := len(tour)
	improved := true
	for improved {
		improved = false
		for i := 0; i < n-1; i++ {
			for k := i + 1; k < n; k++ {
				a, b := tour[i], tour[(i+1)%n]
				c, e := tour[k], tour[(k+1)%n]
				if a == c || a == e || b == c {
					continue
				}
				if d(a, c)+d(b, e) < d(a, b)+d(c, e)-1e-9 {
					for l, r := i+1, k; l < r; l, r = l+1, r-1 {
						tour[l], tour[r] = tour[r], tour[l]
					}
					improved = true
				}
			}
		}
	}
	return tour
}

func main() {
	pts := [][2]float64{{0, 0}, {6, 6}, {5, 2}, {1, 5}}
	d := func(a, b int) float64 { return math.Hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1]) }
	t := twoOpt([]int{0, 1, 2, 3}, d)
	fmt.Println(t)
}
```

#### Java
```java
import java.util.*;

public class TwoOpt {
    static double[][] pts;
    static double d(int a, int b) { return Math.hypot(pts[a][0]-pts[b][0], pts[a][1]-pts[b][1]); }
    static int[] twoOpt(int[] tour) {
        int n = tour.length;
        boolean improved = true;
        while (improved) {
            improved = false;
            for (int i = 0; i < n - 1; i++)
                for (int k = i + 1; k < n; k++) {
                    int a = tour[i], b = tour[(i+1)%n], c = tour[k], e = tour[(k+1)%n];
                    if (a == c || a == e || b == c) continue;
                    if (d(a,c)+d(b,e) < d(a,b)+d(c,e)-1e-9) {
                        for (int l = i+1, r = k; l < r; l++, r--) {
                            int tmp = tour[l]; tour[l] = tour[r]; tour[r] = tmp;
                        }
                        improved = true;
                    }
                }
        }
        return tour;
    }
    public static void main(String[] args) {
        pts = new double[][]{{0,0},{6,6},{5,2},{1,5}};
        System.out.println(Arrays.toString(twoOpt(new int[]{0,1,2,3})));
    }
}
```

#### Python
```python
import math


def two_opt(tour, pts):
    d = lambda a, b: math.dist(pts[a], pts[b])
    n = len(tour)
    improved = True
    while improved:
        improved = False
        for i in range(n - 1):
            for k in range(i + 1, n):
                a, b = tour[i], tour[(i + 1) % n]
                c, e = tour[k], tour[(k + 1) % n]
                if a in (c, e) or b == c:
                    continue
                if d(a, c) + d(b, e) < d(a, b) + d(c, e) - 1e-9:
                    tour[i + 1:k + 1] = reversed(tour[i + 1:k + 1])
                    improved = True
    return tour


print(two_opt([0, 1, 2, 3], [(0, 0), (6, 6), (5, 2), (1, 5)]))
```

---

## Final Tips

- **Always state path vs cycle and symmetric vs asymmetric** before coding — interviewers plant this ambiguity deliberately.
- **Verify against brute force** on `n ≤ 9` if you have time; it shows rigor.
- **Know the ceilings cold:** brute force `n ≈ 12`, Held–Karp `n ≈ 20`, branch-and-bound `n ≈ 50`.
- **Quote the guarantees precisely:** 2× and 1.5× are *metric-only*; general TSP is inapproximable.
- **When asked "how would you scale this," pivot to** cluster-first/route-second, OR-Tools/LKH, and matrix caching — that signals senior judgment.
</content>
