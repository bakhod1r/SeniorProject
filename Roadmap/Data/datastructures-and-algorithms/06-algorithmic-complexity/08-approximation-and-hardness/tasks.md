# Approximation and Hardness — Practice Tasks

> Coding tasks must be solved in **Go**, **Java**, and **Python** where marked **[coding]**.
> Heavier coding tasks ship a reference solution in **one** language (Go or Python) — port it as practice.
> **[analysis]** tasks need no code: prove a ratio, construct a tight/worst-case instance, or argue inapproximability, with a one- to three-line justification per claim.

These tasks build the central skill of approximation: **proving and measuring an approximation ratio**. For a minimization problem, an algorithm is an `α`-approximation if `ALG(x) ≤ α · OPT(x)` on every instance `x` (and `α ≥ 1`); for maximization, `ALG(x) ≥ α · OPT(x)` with `α ≤ 1`. The proof side establishes the *worst-case* guarantee; the empirical side keeps you honest. The recurring discipline for **every** coding task below is the same: **implement the approximation, implement a brute-force OPT, and measure the achieved ratio on many small instances** — the acceptance test is always *"the measured ratio respects the proven bound on every instance tested."* An approximation algorithm you cannot bound is just a heuristic, and a bound you never test against OPT is just a hope.

**Related practice:**
- [Reductions and NP-Completeness tasks](../07-reductions-and-np-completeness/tasks.md) — the hardness those approximations route around, and the gap reductions that limit them.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

---

## Beginner Tasks

### Task 1 — Greedy Vertex Cover via maximal matching (2-approx) **[coding]**

`[easy]` The textbook 2-approximation for **minimum Vertex Cover**: repeatedly pick any uncovered edge `(u, v)`, add **both** endpoints to the cover, and delete every edge touching `u` or `v`. The chosen edges form a **matching** `M` (no two share a vertex), and the cover has size `2|M|`.

> **Why ≤ 2·OPT:** the edges of `M` are pairwise vertex-disjoint, so *any* cover — including the optimal one — must contain at least one distinct vertex per edge of `M`. Hence `OPT ≥ |M|`, and `ALG = 2|M| ≤ 2·OPT`.

Implement the greedy cover and a brute-force minimum vertex cover, then **measure the ratio `ALG/OPT` on random small graphs** and assert it never exceeds 2.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

type Edge struct{ U, V int }

// Greedy 2-approx: take both endpoints of each uncovered edge.
func greedyVertexCover(n int, edges []Edge) map[int]bool {
	cover := make(map[int]bool)
	used := make([]bool, len(edges))
	for i, e := range edges {
		if used[i] {
			continue
		}
		if cover[e.U] || cover[e.V] {
			used[i] = true
			continue
		}
		cover[e.U] = true
		cover[e.V] = true
		// Mark every edge now covered.
		for j, f := range edges {
			if cover[f.U] || cover[f.V] {
				used[j] = true
			}
		}
	}
	return cover
}

func isCover(edges []Edge, s map[int]bool) bool {
	for _, e := range edges {
		if !s[e.U] && !s[e.V] {
			return false
		}
	}
	return true
}

func minVertexCover(n int, edges []Edge) int {
	best := n
	for mask := 0; mask < (1 << n); mask++ {
		s := make(map[int]bool)
		cnt := 0
		for v := 0; v < n; v++ {
			if mask&(1<<v) != 0 {
				s[v] = true
				cnt++
			}
		}
		if cnt < best && isCover(edges, s) {
			best = cnt
		}
	}
	return best
}

func main() {
	rng := rand.New(rand.NewSource(1))
	worst := 0.0
	for t := 0; t < 2000; t++ {
		n := 4 + rng.Intn(5) // 4..8 vertices
		var edges []Edge
		for u := 0; u < n; u++ {
			for v := u + 1; v < n; v++ {
				if rng.Float64() < 0.4 {
					edges = append(edges, Edge{u, v})
				}
			}
		}
		opt := minVertexCover(n, edges)
		alg := len(greedyVertexCover(n, edges))
		if opt == 0 {
			continue
		}
		ratio := float64(alg) / float64(opt)
		if ratio > worst {
			worst = ratio
		}
		if ratio > 2.0+1e-9 {
			panic(fmt.Sprintf("bound violated: alg=%d opt=%d", alg, opt))
		}
	}
	fmt.Printf("worst measured ratio = %.3f (proven bound 2.0)\n", worst)
}
```

- **Constraints:** Greedy runs in `O(n·m)` as written (fine for the test). Brute force enumerates `2^n` subsets — keep `n ≤ 8`. The matching insight is what the proof rests on; the code just witnesses it.
- **Acceptance test:** Over thousands of random graphs, `ALG/OPT ≤ 2` always, and the worst measured ratio is reported (you will typically see values approaching but never exceeding 2).

---

### Task 2 — Greedy Set Cover, ratio vs OPT and vs ln n **[coding]**

`[easy]` The greedy for **minimum Set Cover**: repeatedly pick the set covering the most *still-uncovered* elements, until everything is covered. Its guarantee is `ALG ≤ H_n · OPT ≤ (1 + ln n)·OPT`, where `n = |U|` and `H_n = 1 + 1/2 + … + 1/n` is the `n`-th harmonic number.

Implement greedy set cover and a brute-force minimum set cover, then on small instances **measure two things**: the ratio `ALG/OPT`, and whether `ALG ≤ H_n · OPT` holds.

#### Python

```python
from itertools import combinations
from math import log

def greedy_set_cover(universe, sets):
    remaining = set(universe)
    chosen = []
    sets = [set(s) for s in sets]
    while remaining:
        # Pick the set covering the most uncovered elements.
        best_i = max(range(len(sets)), key=lambda i: len(sets[i] & remaining))
        if not (sets[best_i] & remaining):
            return None  # universe not coverable
        chosen.append(best_i)
        remaining -= sets[best_i]
    return chosen

def min_set_cover(universe, sets):
    universe = set(universe)
    sets = [set(s) for s in sets]
    for k in range(1, len(sets) + 1):
        for combo in combinations(range(len(sets)), k):
            union = set()
            for i in combo:
                union |= sets[i]
            if union >= universe:
                return k
    return None

def harmonic(n):
    return sum(1.0 / i for i in range(1, n + 1))

if __name__ == "__main__":
    universe = list(range(8))
    sets = [{0,1,2}, {3,4}, {5,6,7}, {0,3,5}, {1,4,6}, {2,4,7}]
    alg = greedy_set_cover(universe, sets)
    opt = min_set_cover(universe, sets)
    n = len(universe)
    print(f"greedy used {len(alg)} sets, OPT = {opt}")
    print(f"ratio = {len(alg)/opt:.3f}, H_n bound = {harmonic(n):.3f}")
    assert len(alg) <= harmonic(n) * opt + 1e-9
```

- **Constraints:** Greedy is `O(m · |U|)` per round; brute force enumerates subsets of the `m` sets. Keep `m ≤ ~14`.
- **Acceptance test:** Greedy covers the universe, and `len(greedy) ≤ H_n · OPT` on every instance. Report `ALG/OPT` and confirm it stays at or below the harmonic bound. (On most random instances greedy ties or nearly ties OPT — the `ln n` gap needs *engineered* instances, which is Task 3.)

---

### Task 3 — Build the worst-case Set Cover instance (greedy → ln n) **[coding + analysis]**

`[easy]` The `H_n` analysis is **tight**: there are instances where greedy uses `≈ ln n` times the optimal number of sets. The classic construction forces greedy into a trap.

**Construction.** Universe `U` of `n = 2^{k+1} - 2` elements. Two "good" sets `A` and `B` partition `U` exactly (`|A| = |B| = n/2`), so `OPT = 2`. Add a family of "greedy bait" sets `G_1, G_2, …, G_k`: `G_i` has `2^i` elements, designed so that **at each step greedy prefers a `G_i` over `A` or `B`** (ties broken toward the bait). Greedy then picks all `k = Θ(log n)` bait sets instead of the two good ones.

A simpler, self-contained variant uses a geometric "halving" family. Implement the generator below, run greedy, and confirm `ALG/OPT` grows like `ln n` as `n` increases.

#### Python

```python
from math import log

def greedy_set_cover_count(universe, sets):
    remaining = set(universe)
    count = 0
    sets = [set(s) for s in sets]
    while remaining:
        best = max(sets, key=lambda s: len(s & remaining))
        if not (best & remaining):
            return None
        remaining -= best
        count += 1
    return count

def worst_case_instance(k):
    """OPT = 2 (sets A, B). Bait sets G_i force greedy to take ~k sets.
    Element ids are integers; A and B partition the universe."""
    A, B = set(), set()
    baits = []
    nid = 0
    # Each bait G_i grabs 2^i fresh elements, half assigned to A, half to B.
    for i in range(1, k + 1):
        size = 2 ** i
        g = set()
        for j in range(size):
            g.add(nid)
            (A if j % 2 == 0 else B).add(nid)
            nid += 1
        baits.append(g)
    universe = A | B
    sets = [A, B] + baits
    return universe, sets

if __name__ == "__main__":
    print(f"{'k':>2} {'n':>5} {'OPT':>4} {'greedy':>7} {'ratio':>6} {'ln n':>6}")
    for k in range(2, 11):
        universe, sets = worst_case_instance(k)
        n = len(universe)
        g = greedy_set_cover_count(universe, sets)
        print(f"{k:>2} {n:>5} {2:>4} {g:>7} {g/2:>6.2f} {log(n):>6.2f}")
```

- **Analysis to write:** Argue that greedy, breaking ties toward the largest bait, picks every `G_i` before it would ever touch `A` or `B`, giving `ALG = k` while `OPT = 2`. Since `n = Θ(2^k)`, `k = Θ(log n)`, so `ALG/OPT = Θ(log n)` — the harmonic bound is essentially tight.
- **Acceptance test:** As `k` grows, `greedy / OPT` tracks `Θ(ln n)` (it should rise roughly with `ln n`), demonstrating the lower bound. The instance has `OPT = 2` by construction (`A ∪ B = U`).

---

### Task 4 — Spot the broken "approximation" claim **[analysis]**

`[easy]` An `α`-approximation must satisfy its bound on **every** instance, not on average and not on the instances you happened to test. For each claim, say whether it is sound; if not, name the flaw.

1. "Greedy vertex cover is a 2-approximation because on 10,000 random graphs the ratio averaged 1.3."
2. "Picking a *single* arbitrary endpoint per uncovered edge (not both) gives a 2-approximation for vertex cover."
3. "Greedy set cover is an `O(1)`-approximation." 
4. "Our heuristic returned the optimum on all 50 test cases, so it is a 1-approximation (exact)."
5. "For metric TSP, MST-doubling gives a tour of cost ≤ 2·OPT, so it is a 2-approximation even on non-metric instances."

**Reference answers.**

1. **Unsound reasoning, true conclusion.** The 2-approx claim is correct, but *averaging* proves nothing about the worst case. The guarantee comes from the matching lower bound `OPT ≥ |M|`, not from empirical means. A bound is a `∀`-statement.
2. **False.** Picking one arbitrary endpoint can miss the optimal vertex entirely; the lower bound `OPT ≥ |M|` relies on taking *both* endpoints so the chosen edges form a matching. The single-endpoint rule has **no constant ratio** (consider a star: pick all the leaves, OPT picks the center).
3. **False.** Greedy set cover is `Θ(log n)`, not `O(1)` — Task 3 builds instances forcing `≈ ln n`. And `Θ(log n)` is essentially optimal: no poly-time `(1−o(1)) ln n`-approximation exists unless P = NP.
4. **False.** Passing 50 tests is not a proof of optimality; "1-approximation" would require `ALG = OPT` on *all* instances, which for an NP-hard problem would imply P = NP. Empirical success ≠ a guarantee.
5. **False.** MST-doubling's 2-approx proof *requires the triangle inequality* (shortcutting the Euler tour cannot increase cost only in a metric). On non-metric instances the shortcut step can blow up arbitrarily; TSP without the triangle inequality has **no constant-factor approximation** unless P = NP.

- **Constraints:** Distinguish "the guarantee is a worst-case `∀`-bound" from "the measured average is small."
- **Acceptance test:** Correctly flags 2, 3, 4, 5 as unsound (and the *reasoning* in 1 as unsound despite the true claim), each with the precise flaw named.

---

## Intermediate Tasks

### Task 5 — Metric TSP: MST-doubling 2-approximation **[coding]**

`[medium]` For **metric TSP** (symmetric edge weights obeying the triangle inequality), the MST-doubling heuristic gives a tour of cost `≤ 2·OPT`:

1. Build a minimum spanning tree `T`.
2. "Double" every edge to get an Eulerian multigraph; take an Euler tour.
3. **Shortcut** repeated vertices (skip already-visited nodes) to get a Hamiltonian cycle. Shortcutting never increases cost *because the triangle inequality holds*.

> **Why ≤ 2·OPT:** `cost(T) ≤ OPT` (deleting one edge from the optimal tour leaves a spanning tree, so `OPT ≥` some spanning tree `≥ MST`). The doubled tour costs `2·cost(T) ≤ 2·OPT`, and shortcutting only helps. Hence `ALG ≤ 2·OPT`.

Implement MST-doubling on random metric instances (points in the plane → Euclidean distances satisfy the triangle inequality) and a brute-force optimal tour, then **measure `ALG/OPT`**.

#### Python

```python
from itertools import permutations
import math, random

def dist_matrix(points):
    n = len(points)
    d = [[0.0]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            d[i][j] = math.dist(points[i], points[j])
    return d

def mst_prim(d):
    n = len(d)
    in_tree = [False]*n
    parent = [-1]*n
    key = [math.inf]*n
    key[0] = 0.0
    for _ in range(n):
        u = min((v for v in range(n) if not in_tree[v]), key=lambda v: key[v])
        in_tree[u] = True
        for v in range(n):
            if not in_tree[v] and d[u][v] < key[v]:
                key[v] = d[u][v]
                parent[v] = u
    children = {v: [] for v in range(n)}
    for v in range(1, n):
        children[parent[v]].append(v)
    return children

def mst_doubling_tour(d):
    children = mst_prim(d)
    order = []
    # Preorder DFS = Euler tour with shortcutting (each node visited once).
    stack = [0]
    seen = set()
    while stack:
        u = stack.pop()
        if u in seen:
            continue
        seen.add(u)
        order.append(u)
        for c in reversed(children[u]):
            stack.append(c)
    cost = sum(d[order[i]][order[(i+1) % len(order)]] for i in range(len(order)))
    return cost

def brute_force_tsp(d):
    n = len(d)
    best = math.inf
    for perm in permutations(range(1, n)):
        tour = (0,) + perm
        cost = sum(d[tour[i]][tour[(i+1) % n]] for i in range(n))
        best = min(best, cost)
    return best

if __name__ == "__main__":
    random.seed(7)
    worst = 0.0
    for _ in range(500):
        n = random.randint(5, 9)
        pts = [(random.random(), random.random()) for _ in range(n)]
        d = dist_matrix(pts)
        alg = mst_doubling_tour(d)
        opt = brute_force_tsp(d)
        ratio = alg / opt
        worst = max(worst, ratio)
        assert ratio <= 2.0 + 1e-9, (alg, opt)
    print(f"worst measured ratio = {worst:.3f} (proven bound 2.0)")
```

- **Constraints:** Use Euclidean points so the triangle inequality holds — the proof needs it. Brute force is `O(n!)`; keep `n ≤ 9`. (Christofides tightens this to 3/2, but its blossom matching is out of scope here.)
- **Acceptance test:** `ALG/OPT ≤ 2` on every metric instance; report the worst. In practice MST-doubling lands well under 2 (often ~1.2–1.5), but the guarantee is the ceiling.

---

### Task 6 — Prove the Vertex Cover 2-approximation **[analysis]**

`[medium]` Write a complete, rigorous proof that the maximal-matching greedy of Task 1 is a 2-approximation for minimum Vertex Cover.

**Reference model proof.**

Let the algorithm pick edges `e_1, …, e_t` (each chosen because it was uncovered when selected), adding both endpoints of each, so `ALG = 2t`.

**Claim 1 — the picked edges form a matching.** When `e_j` is selected, it shares no endpoint with any earlier `e_i`: if it did, that endpoint would already be in the cover, and `e_j` would have been deleted as "covered" before selection. So `M = {e_1, …, e_t}` is a matching of size `t`.

**Claim 2 — `OPT ≥ t`.** The edges of `M` are pairwise vertex-disjoint. Any vertex cover `C` must contain, for each `e_i = (u_i, v_i)`, at least one of `u_i, v_i`. Because the `e_i` share no endpoints, these `t` covering vertices are **distinct**. Therefore `|C| ≥ t`; in particular `OPT ≥ t`.

**Combine.** `ALG = 2t ≤ 2·OPT`. The output is a valid cover (every edge is deleted only once an endpoint is chosen), so the algorithm is a 2-approximation. ∎

- **Constraints:** Both claims required: (1) the chosen edges form a matching, (2) any cover needs ≥ one distinct vertex per matched edge. State why disjointness makes the covering vertices distinct.
- **Acceptance test:** Proof establishes `ALG = 2|M|`, the matching property, the lower bound `OPT ≥ |M|`, and concludes `ALG ≤ 2·OPT` with a one-line validity check on the output.

---

### Task 7 — Knapsack FPTAS (value rounding) **[coding]**

`[medium]` 0/1 Knapsack is NP-hard, yet it has an **FPTAS**: for any `ε > 0`, a `(1−ε)`-approximation running in time polynomial in `n` *and* `1/ε`. The trick is to **round the values** so the value-indexed DP becomes cheap.

**Construction.** Let `v_max = max value`. Scale each value: `v'_i = floor(v_i · (n / (ε · v_max)))`. Run the exact `O(n · ΣV')` value-DP on the scaled values (minimize weight to achieve each scaled value), then return the original-value sum of the chosen items. The rounding loses at most `ε · v_max ≤ ε · OPT` per item across the solution.

> **Guarantee:** `ALG ≥ (1 − ε)·OPT`. Running time `O(n² / ε)` after scaling.

Implement the FPTAS and a brute-force OPT, then **verify `ALG ≥ (1−ε)·OPT` for several `ε`**.

#### Python

```python
from itertools import combinations

def knapsack_brute(values, weights, W):
    n = len(values)
    best = 0
    for r in range(n + 1):
        for combo in combinations(range(n), r):
            wt = sum(weights[i] for i in combo)
            if wt <= W:
                best = max(best, sum(values[i] for i in combo))
    return best

def knapsack_fptas(values, weights, W, eps):
    n = len(values)
    vmax = max(values)
    if vmax == 0:
        return 0
    scale = (eps * vmax) / n
    vp = [int(v // scale) for v in values]   # scaled-down values
    Vsum = sum(vp)
    INF = float('inf')
    # dp[val] = min weight to achieve scaled value exactly `val`.
    dp = [INF] * (Vsum + 1)
    dp[0] = 0
    for i in range(n):
        for val in range(Vsum, vp[i] - 1, -1):
            if dp[val - vp[i]] + weights[i] < dp[val]:
                dp[val] = dp[val - vp[i]] + weights[i]
    # Largest scaled value achievable within capacity; recover true value.
    best_scaled = max(val for val in range(Vsum + 1) if dp[val] <= W)
    # Reconstruct true value by re-solving with the same picks (simplest:
    # recompute via a parallel true-value DP keyed on scaled value).
    best_true = recover_true_value(values, weights, vp, W, best_scaled, Vsum)
    return best_true

def recover_true_value(values, weights, vp, W, target_scaled, Vsum):
    n = len(values)
    INF = float('inf')
    # dp[val] = (min weight, true value) achieving scaled value `val`.
    dp = [(INF, 0)] * (Vsum + 1)
    dp[0] = (0, 0)
    for i in range(n):
        for val in range(Vsum, vp[i] - 1, -1):
            w0, t0 = dp[val - vp[i]]
            if w0 + weights[i] < dp[val][0]:
                dp[val] = (w0 + weights[i], t0 + values[i])
    best = 0
    for val in range(Vsum + 1):
        if dp[val][0] <= W:
            best = max(best, dp[val][1])
    return best

if __name__ == "__main__":
    import random
    random.seed(3)
    for _ in range(200):
        n = random.randint(4, 10)
        values = [random.randint(1, 50) for _ in range(n)]
        weights = [random.randint(1, 20) for _ in range(n)]
        W = random.randint(10, 40)
        opt = knapsack_brute(values, weights, W)
        for eps in (0.5, 0.3, 0.1):
            alg = knapsack_fptas(values, weights, W, eps)
            assert alg >= (1 - eps) * opt - 1e-9, (alg, opt, eps)
    print("FPTAS respects (1-eps)*OPT for eps in {0.5, 0.3, 0.1} on all instances")
```

- **Constraints:** Scale values, **not** weights (weights stay exact so capacity is honored). Runtime is polynomial in `n` and `1/ε`. The brute force is the OPT oracle.
- **Acceptance test:** For every instance and every tested `ε`, `ALG ≥ (1−ε)·OPT`. Smaller `ε` should generally yield values closer to OPT (at higher runtime) — the FPTAS trade-off.

---

### Task 8 — Load balancing: list scheduling (2-approx) and LPT (4/3) **[coding]**

`[medium]` **Makespan minimization** on `m` identical machines: assign `n` jobs to minimize the maximum machine load.

- **Graham's list scheduling:** process jobs in arbitrary order, each to the *currently least-loaded* machine. Guarantee `ALG ≤ (2 − 1/m)·OPT`.
- **LPT (Longest Processing Time first):** sort jobs descending, then list-schedule. Tighter guarantee `ALG ≤ (4/3 − 1/(3m))·OPT`.

> **Why list scheduling ≤ (2 − 1/m)·OPT:** consider the machine finishing last, and the last job `j` placed on it (load `p_j`). Just before placing `j`, that machine was least-loaded, so its load was `≤ (total − p_j)/m`. Thus `ALG ≤ (total − p_j)/m + p_j ≤ OPT + (1 − 1/m)·p_j ≤ (2 − 1/m)·OPT`, using `OPT ≥ total/m` and `OPT ≥ p_j`.

Implement both heuristics and a brute-force optimal makespan, then **measure the ratios**.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

func listScheduling(jobs []int, m int) int {
	load := make([]int, m)
	for _, p := range jobs {
		// Assign to least-loaded machine.
		mi := 0
		for i := 1; i < m; i++ {
			if load[i] < load[mi] {
				mi = i
			}
		}
		load[mi] += p
	}
	mx := 0
	for _, l := range load {
		if l > mx {
			mx = l
		}
	}
	return mx
}

func lpt(jobs []int, m int) int {
	cp := append([]int(nil), jobs...)
	sort.Sort(sort.Reverse(sort.IntSlice(cp)))
	return listScheduling(cp, m)
}

func optMakespan(jobs []int, m int) int {
	best := 1 << 30
	assign := make([]int, len(jobs))
	var rec func(i int)
	rec = func(i int) {
		if i == len(jobs) {
			load := make([]int, m)
			for k, mc := range assign {
				load[mc] += jobs[k]
			}
			mx := 0
			for _, l := range load {
				if l > mx {
					mx = l
				}
			}
			if mx < best {
				best = mx
			}
			return
		}
		for mc := 0; mc < m; mc++ {
			assign[i] = mc
			rec(i + 1)
		}
	}
	rec(0)
	return best
}

func main() {
	rng := rand.New(rand.NewSource(2))
	worstLS, worstLPT := 0.0, 0.0
	for t := 0; t < 1000; t++ {
		m := 2 + rng.Intn(2) // 2..3 machines
		n := 4 + rng.Intn(4) // 4..7 jobs
		jobs := make([]int, n)
		for i := range jobs {
			jobs[i] = 1 + rng.Intn(9)
		}
		opt := optMakespan(jobs, m)
		ls := float64(listScheduling(jobs, m)) / float64(opt)
		lp := float64(lpt(jobs, m)) / float64(opt)
		if ls > worstLS {
			worstLS = ls
		}
		if lp > worstLPT {
			worstLPT = lp
		}
		if ls > 2.0+1e-9 || lp > 4.0/3.0+1e-9 {
			panic(fmt.Sprintf("bound violated ls=%.3f lpt=%.3f", ls, lp))
		}
	}
	fmt.Printf("worst list-scheduling ratio = %.3f (bound < 2)\n", worstLS)
	fmt.Printf("worst LPT ratio            = %.3f (bound <= 4/3)\n", worstLPT)
}
```

- **Constraints:** Brute force tries `m^n` assignments — keep `m ≤ 3`, `n ≤ 7`. List scheduling is `O(n·m)`; LPT adds an `O(n log n)` sort.
- **Acceptance test:** List scheduling stays `≤ 2 − 1/m < 2`; LPT stays `≤ 4/3 − 1/(3m) ≤ 4/3`. Report both worst ratios; LPT's should be visibly tighter.

---

## Advanced Tasks

### Task 9 — Submodular maximization: greedy `(1 − 1/e)` on coverage **[coding]**

`[hard]` For a **monotone submodular** function `f` under a cardinality constraint `|S| ≤ k`, the greedy that repeatedly adds the element with the largest *marginal gain* achieves `f(S) ≥ (1 − 1/e)·OPT ≈ 0.632·OPT`. **Max Coverage** (pick `k` sets to maximize the number of covered elements) is the canonical instance — its coverage function is monotone submodular.

> **Why `(1 − 1/e)`:** monotone submodularity gives, at each step, a marginal gain of at least `(OPT − f(S_current))/k`. Unrolling this recurrence over `k` steps yields `f(S_k) ≥ (1 − (1 − 1/k)^k)·OPT ≥ (1 − 1/e)·OPT`.

Implement greedy max-coverage and a brute-force OPT (best `k` of `m` sets), then **verify `ALG ≥ (1 − 1/e)·OPT`**.

#### Python

```python
from itertools import combinations
from math import e

def coverage(sets, chosen):
    u = set()
    for i in chosen:
        u |= sets[i]
    return len(u)

def greedy_max_coverage(sets, k):
    chosen = []
    covered = set()
    for _ in range(k):
        # Largest marginal gain.
        best_i, best_gain = -1, -1
        for i in range(len(sets)):
            if i in chosen:
                continue
            gain = len(sets[i] - covered)
            if gain > best_gain:
                best_gain, best_i = gain, i
        if best_i == -1 or best_gain == 0:
            break
        chosen.append(best_i)
        covered |= sets[best_i]
    return coverage(sets, chosen)

def opt_max_coverage(sets, k):
    best = 0
    for combo in combinations(range(len(sets)), min(k, len(sets))):
        best = max(best, coverage(sets, combo))
    return best

if __name__ == "__main__":
    import random
    random.seed(11)
    threshold = 1 - 1/e
    worst = 1.0
    for _ in range(500):
        m = random.randint(4, 8)
        universe = random.randint(8, 16)
        sets = [set(random.sample(range(universe),
                                  random.randint(1, universe // 2 + 1)))
                for _ in range(m)]
        k = random.randint(1, min(4, m))
        alg = greedy_max_coverage(sets, k)
        opt = opt_max_coverage(sets, k)
        if opt == 0:
            continue
        ratio = alg / opt
        worst = min(worst, ratio)
        assert ratio >= threshold - 1e-9, (alg, opt, k)
    print(f"worst measured ratio = {worst:.3f} (proven floor 1 - 1/e = {threshold:.3f})")
```

- **Constraints:** This is *maximization* — the ratio is `ALG/OPT` and the **floor** is `1 − 1/e ≈ 0.632`. Coverage must be evaluated as a set union (submodular), not a sum. Brute force tries `C(m, k)` subsets.
- **Acceptance test:** Over many random instances, `ALG/OPT ≥ 1 − 1/e` always; report the *minimum* observed ratio (the worst case for a maximization guarantee). The `(1 − 1/e)` factor is known to be optimal for max-coverage unless P = NP.

---

### Task 10 — Max-Cut: greedy/local-search `1/2`, and Goemans–Williamson at a glance **[coding + analysis]**

`[hard]` **Max-Cut** partitions vertices into `(A, B)` to maximize the number of edges crossing the cut. NP-hard, but easy to half-approximate.

- **Greedy/local search:** start from any partition; while some vertex has more edges to its *own* side than across, flip it. Each flip strictly increases the cut, so it terminates at a local optimum where **every vertex has ≥ half its edges crossing** — hence `ALG ≥ |E|/2 ≥ OPT/2`.

> **Why `1/2`:** at the local optimum, summing "≥ half of each vertex's edges cross" over all vertices double-counts each cut edge once and each internal edge zero useful times, yielding `cut ≥ |E|/2`. Since `OPT ≤ |E|`, `ALG ≥ OPT/2`.

Implement local-search Max-Cut and a brute-force OPT, then **measure `ALG/OPT ≥ 1/2`**.

#### Python

```python
from itertools import product

def cut_size(n, edges, side):  # side[v] in {0,1}
    return sum(1 for u, v in edges if side[u] != side[v])

def local_search_maxcut(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    side = [0] * n
    improved = True
    while improved:
        improved = False
        for v in range(n):
            same = sum(1 for w in adj[v] if side[w] == side[v])
            cross = len(adj[v]) - same
            if same > cross:            # flipping increases the cut
                side[v] ^= 1
                improved = True
    return cut_size(n, edges, side)

def opt_maxcut(n, edges):
    best = 0
    for bits in product([0, 1], repeat=n):
        best = max(best, cut_size(n, edges, bits))
    return best

if __name__ == "__main__":
    import random
    random.seed(5)
    worst = 1.0
    for _ in range(800):
        n = random.randint(4, 8)
        edges = [(u, v) for u in range(n) for v in range(u + 1, n)
                 if random.random() < 0.5]
        if not edges:
            continue
        alg = local_search_maxcut(n, edges)
        opt = opt_maxcut(n, edges)
        ratio = alg / opt
        worst = min(worst, ratio)
        assert ratio >= 0.5 - 1e-9, (alg, opt)
    print(f"worst measured ratio = {worst:.3f} (proven floor 0.5)")
```

**Analysis to write — Goemans–Williamson at a high level.** The `1/2` floor is beaten by the **Goemans–Williamson SDP**: relax each vertex's `±1` label to a *unit vector* `xᵥ ∈ ℝⁿ`, maximize `Σ_{(u,v)∈E} (1 − xᵤ·xᵥ)/2` (a semidefinite program, solvable in poly time), then **round** by picking a uniformly random hyperplane through the origin and cutting vectors by which side they fall on. The probability an edge is cut is `θ/π` where `θ = arccos(xᵤ·xᵥ)`, and a calculus bound shows `θ/π ≥ 0.878 · (1 − cos θ)/2`. So `E[cut] ≥ 0.878 · SDP ≥ 0.878 · OPT` — a `0.878`-approximation. Under the Unique Games Conjecture, `0.878` is **optimal**: no poly-time algorithm does better. (You are asked to *describe* this, not implement an SDP solver.)

- **Constraints:** Local search must flip on strict improvement only (guarantees termination — the cut is integer-valued and strictly increasing). Brute force tries `2^n` partitions. Implement the `1/2` algorithm; the `0.878` SDP is a written description.
- **Acceptance test:** `ALG/OPT ≥ 1/2` on every instance (report the min); the write-up correctly states the SDP relaxation, the random-hyperplane rounding, the `0.878` constant, and that it is UGC-optimal.

---

### Task 11 — k-Center: Gonzalez farthest-first (2-approx) with tightness **[coding + analysis]**

`[hard]` **Metric k-Center:** choose `k` centers to minimize the maximum distance from any point to its nearest center. **Gonzalez's farthest-first traversal:** pick an arbitrary first center; repeatedly add the point *farthest* from the current center set; stop at `k` centers. Guarantee `ALG ≤ 2·OPT`.

> **Why ≤ 2·OPT:** let `r = ALG` (the achieved radius) and suppose `r > 2·OPT`. The `k` chosen centers plus the farthest leftover point are `k+1` points pairwise more than `2·OPT` apart. By pigeonhole, two of them share an optimal cluster (some optimal center within `OPT` of each), so by the triangle inequality they are within `2·OPT` — contradiction. Hence `ALG ≤ 2·OPT`.

Implement Gonzalez and a brute-force optimal radius, then **measure `ALG/OPT ≤ 2`**. Also construct a **tight instance** where the ratio approaches 2.

#### Python

```python
from itertools import combinations
import math, random

def radius(points, centers):
    return max(min(math.dist(p, points[c]) for c in centers) for p in points)

def gonzalez(points, k):
    centers = [0]  # arbitrary first center
    while len(centers) < k:
        # Farthest point from current centers.
        far = max(range(len(points)),
                  key=lambda p: min(math.dist(points[p], points[c]) for c in centers))
        centers.append(far)
    return radius(points, centers)

def opt_kcenter(points, k):
    n = len(points)
    best = math.inf
    for combo in combinations(range(n), k):
        best = min(best, radius(points, combo))
    return best

def tight_instance():
    # Three collinear points 0 -- d -- 2d with k=2. OPT picks {0, 2}: radius 0
    # is impossible with 2 centers for 3 points only if... use 1 center to expose 2x.
    # Classic: equilateral-ish layout forcing ratio -> 2 as clusters tighten.
    return [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)]  # k=1 demo below

if __name__ == "__main__":
    random.seed(9)
    worst = 0.0
    for _ in range(400):
        n = random.randint(4, 8)
        pts = [(random.random(), random.random()) for _ in range(n)]
        k = random.randint(1, min(3, n))
        alg = gonzalez(pts, k)
        opt = opt_kcenter(pts, k)
        if opt < 1e-12:
            continue
        ratio = alg / opt
        worst = max(worst, ratio)
        assert ratio <= 2.0 + 1e-9, (alg, opt, k)
    print(f"worst measured ratio = {worst:.3f} (proven bound 2.0)")
```

- **Analysis to write — tight instance.** Take three points on a line at positions `0, 1, 2` with `k = 2`. OPT places centers to make radius `1/2` (one center between two close points)... construct instead a star-like cluster layout where Gonzalez's arbitrary first pick forces it to "waste" a center, driving the ratio toward 2. Argue *why* the pigeonhole slack in the proof is achievable: place `k+1` tight clusters so the farthest-first traversal must leave one cluster radius nearly `2·OPT`.
- **Constraints:** Euclidean points (triangle inequality required). Brute force tries `C(n, k)` center sets. Report the worst ratio.
- **Acceptance test:** `ALG/OPT ≤ 2` on all random instances; the constructed tight instance pushes the ratio close to 2, and the write-up explains it via the pigeonhole step of the proof. (k-center is NP-hard to approximate below `2 − ε`, so this is best possible.)

---

### Task 12 — Gap reductions ⇒ inapproximability **[analysis]**

`[hard]` Why can't we approximate some problems *at all* within a constant? The tool is the **gap-producing reduction**. Write a high-level but rigorous account of how a gap reduction proves an inapproximability lower bound, using TSP (general, non-metric) as the worked example.

**Reference model answer.**

A **gap reduction** from an NP-hard decision problem `L` to an optimization problem `Π` (say minimization) maps each instance `x` to an instance `f(x)` of `Π` and fixes two thresholds `a < b` such that:

- if `x ∈ L`, then `OPT(f(x)) ≤ a`;
- if `x ∉ L`, then `OPT(f(x)) > b = α·a`.

The interval `(a, b)` is the **gap**. Now suppose a poly-time `c`-approximation existed for `Π` with `c < α = b/a`. Run it on `f(x)`: if `x ∈ L` it returns `≤ c·a < b`; if `x ∉ L` it returns `> b` (since even `OPT > b`). So the *approximate* value alone decides whether `x ∈ L` in poly time — solving the NP-hard `L`. Therefore **no poly-time `c`-approximation exists for any `c < α` unless P = NP**.

**Worked example — general TSP has no constant-factor approximation.** Reduce **Hamiltonian Cycle** to TSP: given `G` on `n` vertices, build a complete graph where `G`-edges have weight `1` and non-edges have weight `B` for a huge `B` (say `B = α·n + 1`). Then:

- if `G` is Hamiltonian, there is a tour of cost exactly `n` (`a = n`);
- if not, every tour uses at least one weight-`B` non-edge, so cost `≥ (n−1) + B > α·n = b`.

The gap is `(n, α·n)`. A poly-time `α`-approximation would distinguish the two cases and decide Hamiltonicity — impossible unless P = NP. Since `α` (via `B`) can be *any* constant, **general TSP admits no constant-factor approximation** unless P = NP. (This is exactly why metric TSP — Tasks 5 — is the well-behaved cousin: the triangle inequality forbids the arbitrarily expensive non-edges that create the gap.)

- **Constraints:** Define the gap `(a, b)`, state both implications, and show the contradiction: a `c`-approximation with `c < b/a` would decide the NP-hard source. Use the weight-`1`/weight-`B` TSP construction concretely.
- **Acceptance test:** The answer defines a gap reduction, derives the `α = b/a` inapproximability threshold, and applies it to general TSP (with the `B`-edge gadget) to conclude no constant-factor approximation unless P = NP. Bonus: note PCP-theorem gap reductions underlie the `Θ(log n)` set-cover and APX-hardness results.

---

### Task 13 — Construct a tight instance for the Vertex Cover 2-approx **[coding + analysis]**

`[hard]` The Task 1/Task 6 bound `ALG ≤ 2·OPT` is **tight**: there are graphs where the greedy actually returns `2·OPT`. The cleanest witness is a **perfect matching**.

**Construction.** Take a graph that is a disjoint union of `k` edges (a perfect matching on `2k` vertices): `(0,1), (2,3), …, (2k−2, 2k−1)`. 

- **OPT:** one endpoint per edge covers everything → `OPT = k`.
- **Greedy:** every edge is uncovered when examined, so greedy takes *both* endpoints of all `k` edges → `ALG = 2k = 2·OPT`.

Implement the generator, run Task 1's greedy and a brute-force OPT, and **confirm the ratio is exactly 2** for several `k`.

#### Python

```python
from itertools import combinations

def perfect_matching_graph(k):
    return 2 * k, [(2 * i, 2 * i + 1) for i in range(k)]

def greedy_vertex_cover(n, edges):
    cover, covered = set(), set()
    for u, v in edges:
        if u in cover or v in cover:
            continue
        cover.add(u); cover.add(v)   # take BOTH endpoints
    return cover

def is_cover(edges, s):
    return all(u in s or v in s for u, v in edges)

def min_vertex_cover(n, edges):
    for r in range(n + 1):
        for cand in combinations(range(n), r):
            if is_cover(edges, set(cand)):
                return r
    return n

if __name__ == "__main__":
    for k in range(1, 7):
        n, edges = perfect_matching_graph(k)
        alg = len(greedy_vertex_cover(n, edges))
        opt = min_vertex_cover(n, edges)
        ratio = alg / opt
        print(f"k={k}: ALG={alg} OPT={opt} ratio={ratio:.1f}")
        assert abs(ratio - 2.0) < 1e-9, (k, alg, opt)
    print("perfect matching forces the tight ratio 2.0 for every k")
```

- **Analysis to write:** Argue that on a perfect matching greedy *must* return `2k`: no two edges share a vertex, so when greedy examines any edge, neither endpoint is yet in the cover, forcing it to add both. Meanwhile a single endpoint per edge suffices, so `OPT = k`. The instance saturates the proof's only slack — the moment where greedy "doubles up." Contrast: this does *not* mean the algorithm is bad, only that `2` is the right constant; LP-rounding and the matching bound both confirm `2` is essentially the best known constant (and is conjectured optimal, with `2 − ε` ruled out under UGC).
- **Acceptance test:** For every `k`, `ALG = 2k`, `OPT = k`, ratio exactly `2.0`. The write-up explains *why* the perfect matching is the worst case (greedy is forced to take both endpoints of every disjoint edge).

---

## Synthesis Task

> Tie the thread together: implement an approximation, bound it by proof, measure it against OPT, then locate it on the hardness map.

`[capstone]` Take **METRIC k-CENTER** and carry it through the full approximation arc — algorithm, proof, measurement, and hardness boundary.

1. **Algorithm [coding].** Implement Gonzalez farthest-first (Task 11) and a brute-force optimal radius.

2. **Empirical ratio [coding].** On many random metric instances, measure `ALG/OPT` and assert it never exceeds 2. Report the worst observed ratio.

3. **Proof [analysis].** Prove `ALG ≤ 2·OPT` via the pigeonhole + triangle-inequality argument: if the achieved radius exceeded `2·OPT`, the `k` centers plus the farthest point would be `k+1` points pairwise `> 2·OPT` apart, but only `k` optimal clusters exist, so two share a cluster and are `≤ 2·OPT` apart — contradiction.

4. **Hardness boundary [analysis].** State that metric k-center is **NP-hard to approximate within `2 − ε`** for any `ε > 0` (via a gap reduction from Dominating Set, Task 12 style), so the 2-approximation is **optimal** — no improvement is possible unless P = NP. Contrast this with metric TSP (improvable from 2 to 3/2) and general TSP (no constant factor at all).

Reference solution in **Python** (combines Task 11's pieces):

```python
from itertools import combinations
import math, random

def radius(points, centers):
    return max(min(math.dist(p, points[c]) for c in centers) for p in points)

def gonzalez(points, k):
    centers = [0]
    while len(centers) < k:
        far = max(range(len(points)),
                  key=lambda p: min(math.dist(points[p], points[c]) for c in centers))
        centers.append(far)
    return radius(points, centers)

def opt_kcenter(points, k):
    best = math.inf
    for combo in combinations(range(len(points)), k):
        best = min(best, radius(points, combo))
    return best

if __name__ == "__main__":
    random.seed(42)
    worst = 0.0
    for _ in range(1000):
        n = random.randint(4, 9)
        pts = [(random.random(), random.random()) for _ in range(n)]
        k = random.randint(1, min(3, n))
        alg, opt = gonzalez(pts, k), opt_kcenter(pts, k)
        if opt < 1e-12:
            continue
        ratio = alg / opt
        worst = max(worst, ratio)
        assert ratio <= 2.0 + 1e-9, (alg, opt, k)
    print(f"worst measured ratio = {worst:.3f}  (proven bound 2.0, also the hardness floor)")
```

- **Proof answer:** Let `c_1, …, c_k` be Gonzalez's centers and `p` the farthest leftover point at radius `r = ALG`. By the greedy choice, `c_1, …, c_k, p` are pairwise more than `r` apart... refined: more than `OPT`-distance reasoning gives, if `r > 2·OPT`, that these `k+1` points lie in `k` optimal clusters, so two share one and are `≤ 2·OPT` apart, contradicting pairwise distance `> 2·OPT`. Hence `ALG ≤ 2·OPT`.
- **Acceptance test:** Gonzalez's measured ratio never exceeds 2 across all metric instances (report the worst); the proof closes the `2·OPT` bound via pigeonhole; the write-up correctly places metric k-center at its `2 − ε` inapproximability threshold and contrasts it with metric/general TSP. This mirrors the full craft — **implement the approximation, prove the worst-case ratio, measure it against a brute-force OPT, and pin down where the hardness floor sits** — which is the whole discipline of approximation and hardness.
