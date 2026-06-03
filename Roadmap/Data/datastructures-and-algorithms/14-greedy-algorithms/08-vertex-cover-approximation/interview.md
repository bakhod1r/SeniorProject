# Vertex Cover Approximation — Interview Preparation

Vertex cover is a favorite for interviews that probe the boundary between greedy algorithms and approximation theory. It is simple enough to state in one sentence, deep enough to ask "why take both endpoints," and practical enough to turn into a coding challenge (build a 2-approx cover, verify it, find the exact minimum on small graphs). This file is a curated bank of questions by seniority, behavioral prompts, and end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Fact | Statement |
|------|-----------|
| Vertex cover | A set `S` touching every edge: `∀(u,v)∈E, u∈S ∨ v∈S`. |
| Minimum cover | Smallest such `S`; size `OPT = τ(G)`. **NP-hard.** |
| 2-approximation | Maximal matching: for each uncovered edge, add **both** endpoints. |
| Guarantee | `|ALG| = 2|M| ≤ 2·OPT`, because `OPT ≥ |M|`. |
| Why both endpoints | Keeps triggered edges a *matching* (disjoint) ⇒ `OPT ≥ |M|`. |
| Degree-greedy | **NOT** a 2-approx; ratio `≈ ln V`. Good for set cover, wrong here. |
| Complement | `S` is a cover ⟺ `V \ S` is independent; `τ + α = n`. |
| König (bipartite) | `min cover = max matching`, **exact**, `O(m√n)`. |
| LP rounding | round `x_v ≥ ½`; 2-approx that also handles **weights**. |
| Inapproximability | no `< 1.36` (NP-hard); no `2 − ε` under UGC. |
| FPT | exact in `O(1.27^k·(n+m))` when cover size `k` is small. |
| Complexity | 2-approx is `O(V + E)`. |

Build recipe (per uncovered edge `(u,v)`):

```text
if u ∉ S and v ∉ S:  add BOTH u and v to S
return S            # |S| ≤ 2·OPT, always valid
```

Algorithm choice:

```text
general, fast       -> maximal matching 2-approx
weighted            -> LP rounding (round x_v ≥ ½)
bipartite, exact    -> König (max matching)
small cover, exact  -> FPT branching (+ NT kernel)
```

---

## Junior Questions (12 Q&A)

### J1. What is a vertex cover?
A set of vertices `S` such that every edge has at least one endpoint in `S`. Equivalently, no edge has both endpoints outside `S`.

### J2. What problem are we approximating, and why approximate?
Minimum vertex cover — the smallest such set. It is NP-hard, so for large graphs there is no known polynomial exact algorithm; we use a fast algorithm with a *provable quality guarantee* instead.

### J3. State the 2-approximation algorithm.
Scan the edges. For each edge `(u, v)` with neither endpoint yet in the cover, add **both** `u` and `v`. When no uncovered edge remains, return the cover. It is at most twice the optimum.

### J4. Why is the result always a valid cover?
The loop only stops when no uncovered edge remains. "No uncovered edge" is exactly the definition of a vertex cover, so the output is always valid regardless of edge order.

### J5. What is the time complexity?
`O(V + E)` — a single pass over the edges with `O(1)` membership checks using a boolean array. Linear, as fast as reading the graph.

### J6. Why add both endpoints instead of one?
Taking both keeps the triggered edges a *matching* (vertex-disjoint). That lets us prove `OPT ≥ |M|`, which gives the 2× bound. Taking one endpoint breaks disjointness and the guarantee can fail badly.

### J7. What is a matching, and a maximal matching?
A matching is a set of edges sharing no endpoints. A *maximal* matching cannot be extended — every remaining edge touches a matched vertex. (Maximal ≠ maximum.)

### J8. What does the matching tell you about the optimum?
`OPT ≥ |M|`: every matched edge needs at least one of its two (distinct) endpoints in any cover, so any cover has at least `|M|` vertices.

### J9. Put the bound together.
Our cover has `2|M|` vertices; `OPT ≥ |M|`. So `|ALG| = 2|M| ≤ 2·OPT`. That is the 2-approximation.

### J10. Walk through the triangle.
Triangle `0–1, 1–2, 0–2`. Trigger on `0–1`, add `{0,1}`. Now `1–2` and `0–2` are covered. Cover `= {0,1}`, size 2. Here `OPT = 2` as well (any two vertices cover a triangle), so ratio 1.

### J11. What does an empty cover mean?
If the graph has no edges, the loop never fires and the cover is empty — correct, since there is nothing to cover. Isolated vertices are never added.

### J12. How would you verify your implementation?
Write `is_valid_cover` (check every edge is covered) and a brute-force exact minimum (try all subsets). Confirm validity always, and that `approx ≤ 2·exact` on graphs up to ~16 vertices.

---

## Middle Questions (12 Q&A)

### M1. Is the highest-degree greedy a 2-approximation?
No. Repeatedly taking the highest-degree vertex is a valid cover but its ratio is `Θ(log V)` (the harmonic bound `H_d`), which exceeds 2 and is unbounded. It is the right algorithm for general *set cover*, but the wrong choice for vertex cover, where a constant-factor algorithm exists.

### M2. Give the intuition for the degree-greedy counterexample.
Build a graph whose optimum is one side `L` of size `k`, but whose highest-degree vertices live on the other side in groups of degree `k, k−1, …, 2`. Greedy peels them off top-down, picking `≈ k·H_k ≈ k·ln k` vertices — ratio `ln k`, versus the optimum `k`.

### M3. How are vertex cover and independent set related?
They are complements: `S` is a cover ⟺ `V \ S` is independent. So `τ(G) + α(G) = n`. Minimizing the cover maximizes the independent set.

### M4. Do vertex cover and independent set have the same approximability?
No — a sharp asymmetry. Vertex cover has a 2-approximation; maximum independent set has **no** constant-factor approximation unless P = NP. Minimizing a small set is far easier than maximizing the leftover.

### M5. State König's theorem.
In a bipartite graph, the minimum vertex cover equals the maximum matching: `τ(G) = ν(G)`. This gives the *exact* minimum cover in polynomial time on bipartite graphs.

### M6. Why does König need bipartiteness?
The proof uses alternating paths that cannot close into odd cycles. The triangle is the minimal counterexample: max matching = 1 but min cover = 2, so `τ ≠ ν` once odd cycles appear.

### M7. How do you get the actual minimum cover from König (not just the size)?
Take a maximum matching `M`; let `Z` be vertices reachable by alternating paths from the unmatched left vertices `U`. The cover is `(L \ Z) ∪ (R ∩ Z)`, of size exactly `|M|`.

### M8. Maximal vs maximum matching in these bounds?
The 2-approx uses any *maximal* matching and gives only `OPT ≥ |M|` (inequality). König uses the *maximum* matching and gives `OPT = ν` (equality), but only for bipartite graphs.

### M9. How do weights change the picture?
For weighted vertex cover the matching rule does not apply cleanly. Use the LP relaxation and round `x_v ≥ ½`; that is a weighted 2-approximation.

### M10. Why does rounding `x_v ≥ ½` give a valid cover?
Each edge constraint is `x_u + x_v ≥ 1`, so at least one endpoint has `x ≥ ½` and gets rounded in. Hence every edge is covered.

### M11. Why is the rounded cover within 2×?
Every chosen vertex has `x_v ≥ ½`, so `1 ≤ 2x_v`; summing weights, `w(S) ≤ 2·Σ w_v x_v = 2·LP* ≤ 2·OPT`.

### M12. When is the 2× bound tight?
On a disjoint union of edges (a perfect matching): the algorithm returns all `2k` vertices while `k` suffice, hitting exactly `2·OPT`. So no analysis of this algorithm beats factor 2.

---

## Senior Questions (10 Q&A)

### S1. Design a service that returns vertex covers for arbitrary graphs.
Share an edge scan and connected-component split. Behind a "quality contract" (`approx2` / `weighted` / `exact`), select a strategy: matching 2-approx (fast, unweighted), LP rounding (weighted), König (bipartite exact), or FPT (small exact). Return metadata stating the algorithm and a per-instance ratio certificate.

### S2. What is a ratio certificate and why return it?
The matching gives `OPT ≥ |M|`, so `|cover|/|M|` is a *proven* per-instance ratio — often far below the worst-case 2. Returning it lets consumers see "within 1.1× here," which is more actionable than the abstract guarantee.

### S3. How do you parallelize vertex cover on a huge graph?
Decompose into connected components (the cover is the union over components) and solve each in parallel — embarrassingly parallel, near-linear speedup. Within FPT, the two branches are independent subtrees you can fork to a bounded pool.

### S4. When do you use FPT instead of the 2-approximation?
When you need the *exact* minimum and the cover is *small* (`OPT = k` small relative to `n`) — common in bioinformatics. FPT runs in `O(1.27^k·(n+m))`: exact, with the exponential confined to the small parameter.

### S5. What is kernelization and how does it help?
The Nemhauser–Trotter theorem: solving the cover LP yields a half-integral `{0,½,1}` solution; fix the `0`/`1` vertices and keep only the `½`-core of `≤ 2k` vertices. This shrinks the instance to a `2k`-vertex kernel before the exponential branch.

### S6. How do you keep an exact (FPT) solver from blowing up?
Cap the budget `k`; kernelize first; branch on high-degree vertices to lower the base toward `1.27^k`; and fall back to the 2-approximation when `k` exceeds the budget.

### S7. What do you instrument in production?
Per-solve latency by `V/E` and algorithm; a `validity` counter (must always be zero); the ratio-certificate distribution (creeping toward 2 means worst-case-like inputs); FPT budget-exceeded rate; and the bipartite fraction (high ⇒ König was available for free exactness).

### S8. Weighted monitoring placement — which algorithm?
Weighted vertex cover via LP rounding: minimize `Σ w_v x_v` subject to edge constraints, round `x_v ≥ ½`. The matching rule ignores weights and would give poor cost.

### S9. Best achievable factor, and the hardness?
Algorithmically `2 − Θ(1/√log n)` (an `o(1)` gain). Hardness: no `< 1.36` unless P = NP (Dinur–Safra); no `2 − ε` under the Unique Games Conjecture (Khot–Regev) — so factor 2 is conjecturally optimal.

### S10. When is vertex-cover approximation the wrong tool?
When the graph is bipartite (use König for the *exact* answer at the same cost), when the optimum is small (FPT is exact), or when you actually want the *largest conflict-free set* (independent set — use the complement, but note it is not constant-factor approximable to *maximize*).

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove the 2-approximation bound.
Let `M` be the triggered (maximal) matching; `|S| = 2|M|`. `M`'s edges are vertex-disjoint, so any cover (including OPT) needs ≥ 1 endpoint per matched edge, giving `OPT ≥ |M|`. Hence `|S| = 2|M| ≤ 2·OPT`. Validity: on termination no uncovered edge remains, the definition of a cover.

### P2. Prove the factor 2 is tight.
A single edge `K_2`: the algorithm returns both endpoints (`|S| = 2`) but `OPT = 1`. A disjoint union of `k` edges gives `|S| = 2k`, `OPT = k`, ratio exactly 2 for all `k`. So no analysis of this algorithm yields a factor below 2.

### P3. Why is `τ(G) ≥ |M|` for any matching, and `= ν(G)` only for bipartite?
Disjointness forces ≥ 1 cover vertex per matched edge, so `τ ≥ |M|` always. Equality `τ = ν` (König) holds only for bipartite graphs because their constraint matrix is totally unimodular (the LP is integral); odd cycles (triangle: `ν=1 < τ=2`) break it.

### P4. State and justify LP rounding.
Relax `x_v ∈ {0,1}` to `[0,1]`; solve; round `x_v ≥ ½` in. Feasible (each edge has `x_u + x_v ≥ 1` ⇒ an endpoint ≥ ½) and within 2× (`1 ≤ 2x_v` on chosen vertices ⇒ `w(S) ≤ 2·LP* ≤ 2·OPT`). Handles weights.

### P5. What is half-integrality (Nemhauser–Trotter)?
The cover LP has an optimal solution with every `x_v ∈ {0, ½, 1}`. The `1`-vertices belong to some optimal cover, the `0`-vertices to none, and only the `½`-core (`≤ 2k` vertices) is undecided — yielding a `2k`-vertex FPT kernel.

### P6. State the inapproximability results.
Dinur–Safra: NP-hard to approximate below `1.3606`. Khot–Regev: under the Unique Games Conjecture, NP-hard to approximate within `2 − ε` for any `ε > 0`. So the simple matching 2-approximation is, conditionally, optimal.

### P7. Give the FPT algorithm and its complexity.
Branch on an edge `(u,v)`: every cover contains `u` or `v`, so recurse on `(G−u, k−1)` and `(G−v, k−1)`. Depth `≤ k`, branching 2 ⇒ `O(2^k·(n+m))`. High-degree branching improves the base to `O(1.2738^k)`.

### P8. Why is vertex cover FPT but independent set W[1]-hard?
Parameterized by solution size, vertex cover (a *small* cover) admits bounded-search-tree branching and a linear kernel; independent set (a *large* set) has no such structure and is W[1]-hard. This mirrors the approximation gap: cover is 2-approximable, independent set is not constant-factor approximable.

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose a provably-good approximation over chasing the optimum.
*Structure (STAR):* describe an NP-hard placement/conflict problem where exact was infeasible (Situation/Task), recognizing the matching 2-approximation gave a guaranteed bound in linear time (Action), and shipping it with a per-instance ratio certificate that proved you were usually far better than 2× (Result). Emphasize *matching the tool to a provable contract*.

### B2. Describe a bug caused by a plausible-but-wrong heuristic.
Talk about a degree-greedy "vertex cover" that looked smart and passed small tests but blew up to `Θ(log V)·OPT` on a real input, how you detected it (a parameterized adversary / comparison to the matching bound), and the fix (switch to the matching rule). The lesson: locally optimal ≠ globally bounded.

### B3. How did you decide between approximate and exact?
Explain weighing the consumer's needs (a monitoring set tolerates 2×; a billing-critical minimum does not), the graph class (bipartite ⇒ König exact for free), and the cover size (small ⇒ FPT exact). You matched the algorithm to the contract, not the other way around.

### B4. Tell me about explaining a counter-intuitive result to a teammate.
Describe convincing someone that taking *both* endpoints (seemingly wasteful) is what *guarantees* 2×, while the *clever-looking* degree-greedy has no constant factor. Lead with the proof's lower bound `OPT ≥ |M|`, not the algorithm. Tailoring the depth to the audience is the point.

### B5. A time you built a verification harness before trusting your code.
The `is_valid_cover` checker plus a brute-force exact minimum: you validated that every output is a valid cover and that `approx ≤ 2·exact` on all small graphs, catching the "added one endpoint" bug instantly. Emphasize "trust but verify."

---

## Coding Challenges

### Challenge 1 — Vertex Cover 2-Approximation

**Problem.** Given an undirected graph, return a vertex cover within 2× of optimal.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func vertexCover2Approx(n int, edges [][2]int) []int {
	inc := make([]bool, n)
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		if !inc[u] && !inc[v] {
			inc[u], inc[v] = true, true
		}
	}
	cover := []int{}
	for i := 0; i < n; i++ {
		if inc[i] {
			cover = append(cover, i)
		}
	}
	sort.Ints(cover)
	return cover
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}}
	fmt.Println(vertexCover2Approx(5, edges)) // [0 1 2 3]
}
```

#### Java
```java
import java.util.*;

public class Challenge1 {
    static List<Integer> cover(int n, int[][] edges) {
        boolean[] inc = new boolean[n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            if (!inc[u] && !inc[v]) { inc[u] = true; inc[v] = true; }
        }
        List<Integer> c = new ArrayList<>();
        for (int i = 0; i < n; i++) if (inc[i]) c.add(i);
        return c;
    }

    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}};
        System.out.println(cover(5, edges)); // [0, 1, 2, 3]
    }
}
```

#### Python
```python
def vertex_cover_2approx(n, edges):
    inc = [False] * n
    for u, v in edges:
        if u == v:
            continue
        if not inc[u] and not inc[v]:
            inc[u] = inc[v] = True
    return [i for i in range(n) if inc[i]]


print(vertex_cover_2approx(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]))  # [0, 1, 2, 3]
```

### Challenge 2 — Verify a Cover and Its Ratio

**Problem.** Given a graph and a candidate cover, confirm it is valid; also compute the brute-force exact minimum (`n ≤ 16`) and check `approx ≤ 2·exact`.

#### Go
```go
package main

import "fmt"

func isValidCover(n int, edges [][2]int, cover []int) bool {
	inc := make([]bool, n)
	for _, c := range cover {
		inc[c] = true
	}
	for _, e := range edges {
		if e[0] != e[1] && !inc[e[0]] && !inc[e[1]] {
			return false
		}
	}
	return true
}

func exactMin(n int, edges [][2]int) int {
	best := n
	for mask := 0; mask < (1 << n); mask++ {
		ok := true
		for _, e := range edges {
			if mask&(1<<e[0]) == 0 && mask&(1<<e[1]) == 0 {
				ok = false
				break
			}
		}
		if ok {
			cnt := 0
			for i := 0; i < n; i++ {
				if mask&(1<<i) != 0 {
					cnt++
				}
			}
			if cnt < best {
				best = cnt
			}
		}
	}
	return best
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}}
	cover := vertexCover2Approx(5, edges) // from Challenge 1
	fmt.Println("valid:", isValidCover(5, edges, cover))                       // true
	fmt.Println("approx:", len(cover), " exact:", exactMin(5, edges))          // 4 3
	fmt.Println("within 2x:", len(cover) <= 2*exactMin(5, edges))             // true
}
```

#### Java
```java
public class Challenge2 {
    static boolean isValid(int n, int[][] edges, java.util.List<Integer> cover) {
        boolean[] inc = new boolean[n];
        for (int c : cover) inc[c] = true;
        for (int[] e : edges)
            if (e[0] != e[1] && !inc[e[0]] && !inc[e[1]]) return false;
        return true;
    }
    static int exactMin(int n, int[][] edges) {
        int best = n;
        for (int mask = 0; mask < (1 << n); mask++) {
            boolean ok = true;
            for (int[] e : edges)
                if ((mask & (1 << e[0])) == 0 && (mask & (1 << e[1])) == 0) { ok = false; break; }
            if (ok) best = Math.min(best, Integer.bitCount(mask));
        }
        return best;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}};
        java.util.List<Integer> cover = Challenge1.cover(5, edges);
        System.out.println("valid: " + isValid(5, edges, cover));            // true
        System.out.println("approx: " + cover.size() + " exact: " + exactMin(5, edges)); // 4 3
        System.out.println("within 2x: " + (cover.size() <= 2 * exactMin(5, edges)));    // true
    }
}
```

#### Python
```python
from itertools import combinations

def is_valid_cover(n, edges, cover):
    s = set(cover)
    return all(u == v or u in s or v in s for u, v in edges)


def exact_min(n, edges):
    for k in range(n + 1):
        for sub in combinations(range(n), k):
            s = set(sub)
            if all(u in s or v in s for u, v in edges):
                return k
    return n


edges = [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]
cover = vertex_cover_2approx(5, edges)            # from Challenge 1
print("valid:", is_valid_cover(5, edges, cover))  # True
print("approx:", len(cover), " exact:", exact_min(5, edges))  # 4 3
assert len(cover) <= 2 * exact_min(5, edges)
```

### Challenge 3 — Exact Minimum via FPT Branching

**Problem.** Given a graph and a budget `k`, decide and return a vertex cover of size ≤ `k` (or report none) using branching.

#### Go
```go
package main

import (
	"fmt"
	"sort"
)

func fptCover(n int, edges [][2]int, k int) []int {
	var solve func(chosen []bool, budget int) []bool
	solve = func(chosen []bool, budget int) []bool {
		u, v := -1, -1
		for _, e := range edges {
			if e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]] {
				u, v = e[0], e[1]
				break
			}
		}
		if u == -1 {
			return chosen
		}
		if budget == 0 {
			return nil
		}
		c1 := append([]bool(nil), chosen...)
		c1[u] = true
		if r := solve(c1, budget-1); r != nil {
			return r
		}
		c2 := append([]bool(nil), chosen...)
		c2[v] = true
		return solve(c2, budget-1)
	}
	r := solve(make([]bool, n), k)
	if r == nil {
		return nil
	}
	out := []int{}
	for i := 0; i < n; i++ {
		if r[i] {
			out = append(out, i)
		}
	}
	sort.Ints(out)
	return out
}

func main() {
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {4, 0}, {1, 3}}
	fmt.Println(fptCover(5, edges, 3)) // [0 1 3]
	fmt.Println(fptCover(5, edges, 2)) // [] (none)
}
```

#### Java
```java
import java.util.*;

public class Challenge3 {
    static int[][] E;
    static boolean[] solve(boolean[] chosen, int budget) {
        int u = -1, v = -1;
        for (int[] e : E)
            if (e[0] != e[1] && !chosen[e[0]] && !chosen[e[1]]) { u = e[0]; v = e[1]; break; }
        if (u == -1) return chosen;
        if (budget == 0) return null;
        boolean[] c1 = chosen.clone(); c1[u] = true;
        boolean[] r1 = solve(c1, budget - 1);
        if (r1 != null) return r1;
        boolean[] c2 = chosen.clone(); c2[v] = true;
        return solve(c2, budget - 1);
    }
    static List<Integer> fptCover(int n, int[][] edges, int k) {
        E = edges;
        boolean[] r = solve(new boolean[n], k);
        if (r == null) return null;
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < n; i++) if (r[i]) out.add(i);
        return out;
    }
    public static void main(String[] args) {
        int[][] edges = {{0,1},{1,2},{2,3},{3,4},{4,0},{1,3}};
        System.out.println(fptCover(5, edges, 3)); // [0, 1, 3]
        System.out.println(fptCover(5, edges, 2)); // null
    }
}
```

#### Python
```python
def fpt_cover(n, edges, k):
    def solve(chosen, budget):
        u = v = -1
        for a, b in edges:
            if a != b and a not in chosen and b not in chosen:
                u, v = a, b
                break
        if u == -1:
            return chosen
        if budget == 0:
            return None
        r = solve(chosen | {u}, budget - 1)
        if r is not None:
            return r
        return solve(chosen | {v}, budget - 1)

    r = solve(set(), k)
    return sorted(r) if r is not None else None


edges = [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]
print(fpt_cover(5, edges, 3))  # [0, 1, 3]
print(fpt_cover(5, edges, 2))  # None
```

### Challenge 4 — Cover and Independent-Set Complement

**Problem.** For any graph, confirm that the complement of your cover is an independent set, and that `|cover| + |independent set| = n`.

#### Python
```python
def complement_check(n, edges):
    cover = vertex_cover_2approx(n, edges)
    s = set(cover)
    indep = [v for v in range(n) if v not in s]
    indep_set = set(indep)
    # no edge lies entirely inside the independent set
    assert all(not (u in indep_set and v in indep_set) for u, v in edges)
    assert len(cover) + len(indep) == n
    return cover, indep


print(complement_check(5, [(0,1),(1,2),(2,3),(3,4),(4,0),(1,3)]))
```

(Go and Java versions mirror this: build the cover, take the complement, verify no edge lives entirely in the complement, and check the sizes sum to `n`.)

---

## Common Pitfalls

- **Adding only one endpoint per edge** — breaks the matching, loses the 2× guarantee.
- **Using degree-greedy and calling it a 2-approx** — it is `Θ(log V)`, not constant-factor.
- **Returning all vertices "to be safe"** — valid but can be `Θ(V)·OPT`.
- **Applying König to a non-bipartite graph** — fails on odd cycles (triangle).
- **Confusing maximal and maximum matching** — `OPT ≥ |maximal|` vs `OPT = |maximum|` (bipartite only).
- **Treating the approximation as the minimum** — it is `≤ 2·OPT`, not exact.
- **Wrong array size for 1-indexed vertices** — off-by-one out-of-bounds.

---

## What Interviewers Are Really Testing

- **Connecting domains:** can you see a *covering* problem as a *matching* problem and a *complement* of independent set?
- **Proof intuition:** can you explain *why* both endpoints (the `OPT ≥ |M|` lower bound), not just *what* the algorithm does?
- **Judgment about heuristics:** do you know the clever-looking degree-greedy has *no* constant factor, and reach for the provable matching rule instead?
- **Knowing the landscape:** König for bipartite exactness, LP for weights, FPT for small covers, and the `1.36`/UGC-2 hardness wall.
- **Correctness discipline:** do you build `is_valid_cover` and a brute-force oracle and check `approx ≤ 2·exact` instead of trusting one run?
