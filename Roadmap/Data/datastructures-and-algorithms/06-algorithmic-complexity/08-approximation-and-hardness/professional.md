# Approximation and Hardness — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Design Toolkit: Six Patterns That Cover Almost Everything](#the-design-toolkit-six-patterns-that-cover-almost-everything)
3. [Pattern 1 — Greedy with a Charging Argument](#pattern-1--greedy-with-a-charging-argument)
4. [Pattern 2 — LP Relaxation and Rounding](#pattern-2--lp-relaxation-and-rounding)
5. [Pattern 3 — Primal–Dual](#pattern-3--primaldual)
6. [Pattern 4 — SDP Rounding (Goemans–Williamson)](#pattern-4--sdp-rounding-goemanswilliamson)
7. [Pattern 5 — Local Search](#pattern-5--local-search)
8. [Pattern 6 — DP + Scaling → FPTAS](#pattern-6--dp--scaling--fptas)
9. [Integrality Gap as the Practical Ceiling](#integrality-gap-as-the-practical-ceiling)
10. [Where These Run in Real Systems](#where-these-run-in-real-systems)
11. [Worked End-to-End: k-Center Server Placement](#worked-end-to-end-k-center-server-placement)
12. [Engineering Reality: Worst-Case Ratio vs Typical, and the Dual Certificate](#engineering-reality-worst-case-ratio-vs-typical-and-the-dual-certificate)
13. [Decision Framework](#decision-framework)
14. [Research Pointers](#research-pointers)
15. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) is about *inapproximability* — the converse theory that says which ratios are impossible, built on gaps and the PCP theorem. This tier is the **constructive** counterpart: how you *design and ship* an approximation algorithm in a real system, and how you report a defensible quality number to the people who own the SLA.

The earlier tiers already defined the ratio `ALG ≤ ρ·OPT`, the PTAS/FPTAS hierarchy, and the four rounding moves at a vocabulary level. We do not re-teach those. The shift here is from "what is a `ρ`-approximation" to:

> **Given a hard problem in your design doc, which of the standard design patterns produces a guaranteed-ratio algorithm — and what lower bound can I compute alongside it so I can report the optimality gap in production?**

Two ideas make this tier worth its length. First, almost every approximation algorithm you will ever ship is an instance of one of **six patterns** — greedy-with-charging, LP-rounding, primal–dual, SDP-rounding, local search, scaling-to-FPTAS — and knowing the pattern tells you the proof *and* the lower bound. Second, the relaxation you solve (LP or SDP) is **two things at once**: the source of the algorithm *and* a computable lower bound on `OPT`. That dual bound is what turns "we used a heuristic" into "we are provably within 6% of optimal, here is the certificate." The companion files: [`../07-reductions-and-np-completeness/professional.md`](../07-reductions-and-np-completeness/professional.md) for proving your problem hard in the first place, and [`../06-complexity-classes-p-np/professional.md`](../06-complexity-classes-p-np/professional.md) for the full exact-or-near-exact response menu (ILP/SAT/CP solvers, FPT, metaheuristics).

---

## The Design Toolkit: Six Patterns That Cover Almost Everything

| Pattern | Canonical problem | Guarantee | When to reach for it |
|---|---|---|---|
| **Greedy + charging** | Set Cover (`H_n ≈ ln n`); submodular max (`1 − 1/e`) | tight `ln n` / `1−1/e` | Coverage, selection, anything with **diminishing returns** (submodular) |
| **LP relaxation + rounding** | Vertex Cover (`2`), Set Cover (`f`) | `2`, `f` (frequency) | Constraints are linear; you want a *dual certificate* for free |
| **Primal–dual** | Vertex Cover (`2`), Steiner Forest (`2`) | `2` | Want LP-quality bounds *without* solving the LP — combinatorial speed |
| **SDP rounding** | MAX-CUT (`0.878`) | `α_GW ≈ 0.878` | Quadratic/`±1` objectives; cut, correlation, ordering |
| **Local search** | k-median / facility location; MAX-CUT (`1/2`) | constant (e.g. `3+ε`, `1/2`) | Clustering, placement; great typical-case behavior |
| **DP + scaling → FPTAS** | Knapsack (`1+ε`) | `(1+ε)`, poly in `1/ε` | A pseudo-poly DP exists and you want arbitrarily-tight |

The pattern you pick is dictated by the **shape of the objective**, exactly as the source-problem cheat sheet in [`../07-reductions-and-np-completeness/professional.md`](../07-reductions-and-np-completeness/professional.md) dictates the hardness proof. The rest of this section works each pattern with its argument and its lower bound.

---

## Pattern 1 — Greedy with a Charging Argument

Greedy is the workhorse: at each step take the locally best move, then prove the total cost via a **charging argument** that amortizes greedy's choices against the optimum.

### Set Cover: greedy is `H_n ≈ ln n`, and it is optimal

Pick repeatedly the set covering the most still-uncovered elements. The analysis charges each element a price `1/(newly covered)` at the moment it is first covered. When `k` elements remain and `OPT` covers all of them with `OPT*` sets, some set covers `≥ k/OPT*` of them, so each element pays `≤ OPT*/k`. Summing the harmonic series gives `ALG ≤ H_n · OPT* ≈ ln n · OPT*`. By Dinur–Steurer (see [`./senior.md`](./senior.md)) this `ln n` is the **best possible** unless `P = NP` — greedy is not a placeholder, it is the answer.

### Submodular maximization: greedy is `1 − 1/e` (Nemhauser–Wolsey–Fisher)

This is the most valuable pattern in modern practice. A set function `f` is **submodular** if it has diminishing returns: for `A ⊆ B` and element `x`, `f(A∪{x}) − f(A) ≥ f(B∪{x}) − f(B)`. It is **monotone** if adding elements never hurts. For maximizing a monotone submodular `f` under a cardinality constraint `|S| ≤ k`, greedily add the element with the largest **marginal gain**:

> **Theorem (Nemhauser–Wolsey–Fisher 1978).** Greedy returns `S` with `f(S) ≥ (1 − 1/e)·OPT ≈ 0.632·OPT`. And `(1 − 1/e)` is the best any polynomial algorithm achieves (Feige), so greedy is optimal here too.

The charging argument: let `Sᵢ` be the greedy set after `i` picks and `O` the optimum. Submodularity gives `f(O) − f(Sᵢ) ≤ Σ_{o∈O} [f(Sᵢ∪{o}) − f(Sᵢ)] ≤ k · (greedy's next gain)`. So each step closes at least a `1/k` fraction of the remaining gap `OPT − f(Sᵢ)`, and after `k` steps the residual is `(1−1/k)^k·OPT ≤ OPT/e`. This single inequality is why so many ML/coverage problems get a clean guarantee: **influence maximization** in social graphs, **sensor placement** (maximize covered information), **feature selection** (mutual information is submodular), document/exemplar **summarization**. The `1 − 1/e` is the bound you write into the design doc.

```python
def greedy_submodular(elements, k, f):
    """Maximize monotone submodular f under |S| <= k. f(S) >= (1 - 1/e) * OPT."""
    S, base = set(), f(set())
    for _ in range(k):
        # pick the element with the largest marginal gain f(S+e) - f(S)
        best = max((e for e in elements if e not in S),
                   key=lambda e: f(S | {e}) - f(S), default=None)
        if best is None:
            break
        S.add(best)
    return S
```

Two production refinements worth knowing: **lazy greedy** (CELF) memoizes marginal gains and re-evaluates only the top of a priority queue — orders of magnitude faster with the *same* guarantee, because submodularity means a stale gain is a valid upper bound, so an element whose stale gain already loses to a freshly-computed gain can be skipped without recomputation. For non-monotone or matroid/knapsack constraints, the **continuous greedy / measured continuous greedy** on the multilinear extension recovers `1 − 1/e` (matroid) or `1/e` (non-monotone). And when `f` is only available through expensive **Monte-Carlo estimates** (influence maximization: each `f(S)` is an expected cascade size, simulated), the modern move is **Reverse Influence Sampling** (Borgs et al.; Tang–Xiao–Shi), which preserves the `1 − 1/e` guarantee with near-linear running time by sampling reverse-reachable sets instead of forward simulations — the technique that made `1 − 1/e` influence maximization tractable on billion-edge graphs.

The reason this pattern is so heavily used is that **submodularity is common and easy to check**: coverage functions, entropy and mutual information, weighted matroid rank, facility-location value, and graph-cut functions are all submodular. If you can argue your objective has diminishing returns, you get the `1 − 1/e` guarantee for free — and the senior-tier hardness says you cannot do better in polynomial time, so there is no point looking for a cleverer algorithm.

---

## Pattern 2 — LP Relaxation and Rounding

Write the problem as an integer program, **relax** the `xᵢ ∈ {0,1}` to `xᵢ ∈ [0,1]`, solve the LP in polynomial time, then **round** the fractional solution back to integral — bounding the damage.

### Vertex Cover: LP rounding gives `2` (and half-integrality)

```text
minimize  Σ_v c_v · x_v
s.t.      x_u + x_v ≥ 1     for every edge {u,v}
          x_v ∈ {0,1}       →  relax to  x_v ∈ [0,1]
```

Solve the LP; **round up** every `x_v ≥ 1/2` to 1. Each edge constraint `x_u + x_v ≥ 1` forces at least one endpoint to `≥ 1/2`, so the rounded set is a valid cover, and rounding at most doubles each chosen variable: `ALG ≤ 2·LP* ≤ 2·OPT`. A beautiful structural fact (Nemhauser–Trotter) makes this even cleaner: the vertex-cover LP is **half-integral** — there is always an optimal LP solution with every `x_v ∈ {0, ½, 1}` — so "round the halves up" is exact and you can even fix the 0/1 variables and recurse on the half-valued core.

### Set Cover: LP rounding gives an `f`-approximation, where `f` = max element frequency

If every element appears in at most `f` sets, round up every set with LP value `≥ 1/f`. Each element's covering constraint `Σ_{S∋e} x_S ≥ 1` has `≤ f` terms, so one of them is `≥ 1/f` and gets rounded in — a valid cover at cost `≤ f·LP*`. For `f = 2` this *is* vertex cover. **Randomized rounding** is the alternative: include set `S` independently with probability `x_S`, repeat `O(log n)` rounds; with high probability you cover everything at cost `O(log n)·LP*` — recovering the `ln n` bound by a completely different route, and the one that generalizes to packing/covering IPs where no clean greedy exists.

The discipline: **deterministic rounding** (threshold) gives a worst-case bound you can state up front; **randomized rounding** gives an expected bound plus a tail you control with repetition and a union bound. Both hand you `LP*` as a lower bound for the gap (next-but-one section).

### The randomized-rounding analysis, made concrete

Randomized rounding is worth understanding precisely because it is the pattern that generalizes when greedy and threshold rounding both run out. For set cover: solve the LP, then in each of `t` independent rounds include set `S` with probability `x_S`. After one round, the probability element `e` is *still uncovered* is `∏_{S∋e}(1 − x_S) ≤ ∏ e^{−x_S} = e^{−Σ_{S∋e} x_S} ≤ e^{−1}` (the covering constraint forces `Σ ≥ 1`). After `t = 2 ln n` rounds, the failure probability per element is `≤ e^{−t} = 1/n²`, so by a **union bound** over `n` elements everything is covered with probability `≥ 1 − 1/n`. The expected cost per round is `Σ_S c_S·x_S = LP*`, so the total is `O(log n)·LP*` in expectation — recovering greedy's `ln n` by an entirely different mechanism. The general lesson: the **`(1 − ∏ e^{−x})` Chernoff/union-bound machinery** turns *any* fractional packing/covering LP into an integral solution at an `O(log)` multiplicative cost, which is why randomized rounding is the default when the constraint matrix is too tangled for a clean combinatorial greedy.

---

## Pattern 3 — Primal–Dual

LP rounding is excellent but pays the price of *solving* an LP. The **primal–dual** method gets the same ratio combinatorially: grow a feasible **dual** solution, and let the dual's tight constraints tell you which primal variables to buy — never solving either LP explicitly.

### Vertex Cover, primal–dual

The dual of the vertex-cover LP puts a variable `y_e ≥ 0` on each edge with `Σ_{e∋v} y_e ≤ c_v` per vertex. Raise the `y_e` of any uncovered edge until some vertex's constraint goes **tight** (`Σ y = c_v`); buy that vertex. Every bought vertex is paid for exactly by its incident dual, and each edge's dual is charged to at most its two endpoints, giving `cost ≤ 2·Σ y_e ≤ 2·OPT`. No LP solver, same `2`, and `Σ y_e` is a valid dual lower bound you get for free.

### Steiner Forest: primal–dual gives `2` (Agrawal–Klein–Ravi / Goemans–Williamson)

The flagship. Given terminal pairs `(sᵢ, tᵢ)` that must be connected, grow dual "moats" uniformly around every component that still separates a pair; when two moats collide, add the edge that merges them. The reverse-delete cleanup removes redundant edges. The moats are a packing of the dual, and the careful charging gives a **2-approximation** for Steiner forest — the basis of how real network-design and multicommodity-connectivity tools (VLSI routing, broadcast-tree planning) get a guarantee. Primal–dual is the pattern to reach for when you want LP-grade bounds at combinatorial speed.

### Why primal–dual gives a certificate "for free"

The reason this pattern matters to a practitioner is **weak LP duality**: any feasible dual is a *lower bound* on the primal optimum (for a minimization LP). The primal–dual method *constructs* a feasible dual `y` as it runs, so when it stops you hold both the integral solution (cost `ALG`) and a dual witness (value `D = Σ y_e`) with `D ≤ LP* ≤ OPT ≤ ALG`. The ratio `ALG/D` is a **certified, instance-specific** optimality gap you can report — and the `2`-approximation theorem is exactly the statement `ALG ≤ 2D`. So you never solve an LP, never call a solver, and still walk away with a provable interval `[D, ALG]` containing `OPT`. This is the cleanest illustration of the tier's thesis that the *relaxation is simultaneously the algorithm and the certificate* — here the certificate is even cheaper, built incrementally by the same loop that builds the solution.

---

## Pattern 4 — SDP Rounding (Goemans–Williamson)

When the objective is **quadratic in `±1` variables**, a linear relaxation is too weak; lift to a **semidefinite program** that relaxes each variable to a unit vector, solve it, and round with a random hyperplane. MAX-CUT is the canonical and still-unbeaten example.

### The algorithm

MAX-CUT seeks a bipartition of `G=(V,E)` maximizing crossing edges. Relax each vertex `i` to a unit vector `vᵢ ∈ ℝⁿ` and solve the SDP

```text
maximize   Σ_{(i,j)∈E} (1 − vᵢ·vⱼ)/2
s.t.       ‖vᵢ‖ = 1
```

solvable to arbitrary precision in poly time (it is `max Σ (1−Mᵢⱼ)/2` over PSD `M` with unit diagonal). Then **round**: draw a uniformly random hyperplane through the origin (a random Gaussian vector `r`), and put `i` on the side given by `sign(vᵢ·r)`.

### Why `0.878`

An edge whose vectors sit at angle `θ` is cut exactly when the hyperplane falls between them — probability `θ/π` — while it contributes `(1−cos θ)/2` to the SDP. The ratio of the two, minimized over `θ`, is the Goemans–Williamson constant:

```text
α_GW = min_{0<θ≤π}  (θ/π) / ((1 − cos θ)/2)  ≈  0.87856
```

So `E[cut] ≥ α_GW · SDP* ≥ α_GW · OPT ≈ 0.878·OPT`. The match to hardness is exact: under UGC, `0.878` is optimal (KKMO; see [`./senior.md`](./senior.md)). The same SDP-plus-rounding template drives **correlation clustering**, **MAX-2SAT**, **MAX-DICUT**, and graph-coloring relaxations. In production SDPs are heavier than LPs (interior-point cost grows fast), so they appear where the quadratic structure genuinely matters and instances are moderate; the Burer–Monteiro low-rank factorization makes them practical at scale.

---

## Pattern 5 — Local Search

Start with any feasible solution and repeatedly apply a small **local move** (swap, add/drop) that improves the objective; stop at a local optimum. The guarantee comes from a **locality argument**: at a local optimum, no improving move exists, and that inequality bounds how far you are from global `OPT`.

### k-median / facility location: local search is a constant factor

For **k-median** (open `k` facilities minimizing total client-to-nearest distance), the single-swap local move — close one open facility, open one closed one, keep if it helps — converges to a `(3+ε)`-approximation; `p`-swaps give `(3 + 2/p + ε)`. **Uncapacitated facility location** has a `(1+√2)`-ish local-search and primal–dual constants. The proof pairs each local optimum's facilities with the optimum's and shows that the *absence* of an improving swap caps the cost ratio. This is why local search dominates real clustering/placement pipelines: simple, fast, and with a worst-case backstop.

### k-means: k-means++ seeding is `O(log k)` expected

Lloyd's algorithm (the standard "k-means") is local search on the squared-distance objective and has *no* approximation guarantee from a bad start. **k-means++** fixes the seeding: pick the first center uniformly, then each next center with probability proportional to its squared distance to the nearest chosen center (`D²` sampling). This seeding alone is an **`O(log k)`-approximation in expectation** (Arthur–Vassilvitskii 2007) — *before* a single Lloyd iteration — and Lloyd then only improves it. It is the default initializer in scikit-learn, Spark MLlib, and essentially every production k-means for this reason: a one-line change that converts an unbounded heuristic into a logarithmic guarantee.

### MAX-CUT: the trivial local search is `1/2`

Flip any vertex to the other side whenever it increases the cut. At a local optimum each vertex has at least half its edges crossing (else flipping helps), so summing over vertices each edge is counted from both endpoints and `≥ |E|/2 ≥ OPT/2` edges are cut. A `1/2`-approximation in a few lines — the floor below which you should never ship a MAX-CUT heuristic, and a useful sanity baseline before reaching for the `0.878` SDP.

### Scheduling and load balancing: list scheduling is a local-search-flavored guarantee

The most common operational instance of this pattern is **makespan minimization** (`P‖Cmax`): assign `n` jobs to `m` identical machines minimizing the latest finish time — the canonical load-balancing problem behind shard placement, task dispatch, and build sharding. **Graham's list scheduling** assigns each job to the least-loaded machine and is a **2-approximation** by a one-line argument: the last-finishing machine had load `≤ (avg) + (last job)`, and both `avg = Σpⱼ/m` and `max pⱼ` are lower bounds on `OPT`, so `ALG ≤ avg + max pⱼ ≤ 2·OPT`. Sorting jobs **longest-first first (LPT)** tightens this to `4/3 − 1/(3m)`. Both bounds come from the same two universal lower bounds — the average load and the largest single job — which double as the **certificate** you report. (A full PTAS exists for `P‖Cmax` via bin-packing-style rounding, but LPT's `4/3` with its trivial certificate is what most production schedulers actually ship.)

---

## Pattern 6 — DP + Scaling → FPTAS

When a problem has a pseudo-polynomial DP (exact but exponential in the *value*, not the size), you can **scale the values down** to make the DP polynomial while losing only a `(1+ε)` factor — an **FPTAS** (running time polynomial in both `n` and `1/ε`).

### Knapsack: the canonical FPTAS

Knapsack's DP indexed by *profit* runs in `O(n²·P_max)` — pseudo-polynomial. Scale every profit `pᵢ → ⌊pᵢ/K⌋` with `K = ε·P_max/n`. The scaled DP now runs in `O(n²·P_max/K) = O(n³/ε)` — polynomial — and the rounding loses at most `K` per item, `nK = ε·P_max ≤ ε·OPT` total. So the scaled-DP solution is within `(1−ε)·OPT`: a `(1+ε)`-approximation in time polynomial in `1/ε`.

> **The key distinction (carried from [`./senior.md`](./senior.md)):** an **FPTAS** is `poly(n, 1/ε)`; a **PTAS** is `poly(n)` for each fixed `ε` but may be `n^{O(1/ε)}` — fine for `ε=0.5`, useless for `ε=0.01`. Strongly NP-hard problems admit **no FPTAS** unless `P=NP` (the value-scaling trick has nothing to scale), so this pattern only applies to *weakly* hard, number-driven problems. That weak-vs-strong test is the same one you ran when proving hardness.

---

## Integrality Gap as the Practical Ceiling

The **integrality gap** of a relaxation is `sup_instances (OPT_IP / OPT_LP)` (minimization) — the worst-case ratio between the true integer optimum and what the relaxation reports. It is the **hard ceiling on any algorithm that proves its ratio against that relaxation**: if the LP can be `2×` off from the integer optimum, no rounding of that LP can guarantee better than `2`, no matter how clever.

This is intensely practical:

- **It tells you when to stop tuning a relaxation.** Vertex cover's LP has integrality gap `2 − o(1)` (the complete graph: LP buys every vertex at `½`, IP needs `n−1`). So no LP-rounding scheme beats `2` — to do better you must *strengthen the relaxation* (add constraints / lift via Sherali–Adams or Lassergre) or switch patterns. The gap is the diagnosis "this relaxation is exhausted."
- **It guides pattern choice.** MAX-CUT's *LP* relaxation has integrality gap `2` (useless), but its *SDP* relaxation has gap `1/α_GW ≈ 1.138` — which is exactly why MAX-CUT is an SDP problem and not an LP problem. The integrality gap of each candidate relaxation is the menu you choose from.
- **It bounds your reportable certificate.** The relaxation's optimum is your lower bound on `OPT`; the integrality gap is the worst gap that bound can show. If the gap is `1.5`, you can never *certify* better than 50% via that relaxation even when the algorithm is doing better.

The senior file frames integrality gap as the algorithmic shadow of the *hardness* threshold (Raghavendra: under UGC the SDP integrality gap *equals* the inapproximability threshold). At this tier the takeaway is operational: **compute the integrality gap of your relaxation before committing to it; it is the best ratio you can ever certify with that tool.**

### Strengthening a relaxation when the gap is too large

When the integrality gap blocks the ratio you need, you do not abandon the LP/SDP route — you **tighten the relaxation** by adding valid inequalities that the integer solutions satisfy but the fractional optimum violates. Three escalating levers, in order of cost:

- **Problem-specific cuts.** Add known facet-defining inequalities (e.g., odd-cycle constraints for the stable-set polytope, comb inequalities for TSP, clique constraints). These are cheap, often dramatic, and are exactly what the *cutting-plane* loop inside a branch-and-cut ILP solver generates automatically.
- **Lift-and-project hierarchies.** **Sherali–Adams** (LP) and **Lasserre / sum-of-squares** (SDP) systematically add higher-degree consistency constraints; level `r` runs in `n^{O(r)}` and the gap shrinks monotonically as `r` grows. This is the principled knob between "fast loose relaxation" and "slow tight one," and it connects directly to the senior-tier UGC story: the SOS hierarchy is the leading candidate for *refuting* UGC.
- **Switch the relaxation class entirely.** The MAX-CUT lesson — LP gap `2`, SDP gap `1.138` — is the canonical case where no amount of LP cuts helps and you must move from an LP to an SDP. The integrality-gap computation is what tells you the LP is fundamentally exhausted rather than merely under-constrained.

The operational reflex: measure the gap, add the cheap problem-specific cuts first, and only climb the hierarchy (or change relaxation class) if the certified gap still misses your SLA.

---

## Where These Run in Real Systems

| System / task | Problem | Pattern & guarantee shipped |
|---|---|---|
| **Server / CDN PoP placement** | k-center | farthest-first greedy, **2-approx** (hard below 2) |
| **Clustering (vector search, segmentation)** | k-means | **k-means++** seeding, `O(log k)` expected, + Lloyd |
| **Facility / warehouse location** | facility location, k-median | local search / primal–dual, constant factor |
| **Test-suite minimization** | set cover | greedy, `ln n`, provably optimal |
| **Sensor / monitor placement, log sampling** | submodular coverage | greedy/CELF, **`1 − 1/e`** |
| **Feature selection, summarization** | monotone submodular max | greedy, **`1 − 1/e`** |
| **Influence maximization (marketing/virality)** | submodular max on cascades | greedy + Monte-Carlo / RIS, `1 − 1/e` |
| **Job scheduling / load balancing** | makespan (`P‖Cmax`) | LPT list scheduling, `4/3`; PTAS exists |
| **Vehicle routing / delivery** | metric TSP / VRP | Christofides `1.5` (theory), **LKH** in practice |
| **Network design / multicast** | Steiner forest/tree | primal–dual, **2** |
| **Anything moderate-`n` and exact-ish** | the IP itself | **ILP solver** (CBC, Gurobi) to a reported gap |

Two production notes. First, **the LP/ILP solver is itself an approximation engine**: branch-and-bound on the ILP runs *anytime* and reports an **optimality gap** (`(incumbent − LP bound)/LP bound`); you stop at, say, 1% and ship a near-exact answer with a certificate — for moderate `n` this beats any hand-rolled heuristic. Second, the **theory ratio and the production tool often differ**: nobody ships Christofides for routing (its `1.5` is worst-case and its matching step is heavy); they ship **LKH** (Lin–Kernighan–Helsgaun local search) which has *no* guarantee but is within a fraction of a percent of optimal on real instances. The guarantee is the floor you fall back to and the language you report in, not always the code you run.

---

## Worked End-to-End: k-Center Server Placement

The problem: place `k` servers (edge PoPs, cache nodes, warehouses) among `n` candidate sites so the **maximum** distance from any client to its nearest server is minimized. This is **metric k-center**, and it has a clean 2-approximation with a matching hardness — the textbook case where a simple greedy is provably the best you can do.

### Gonzalez farthest-first traversal — a 2-approximation

Open an arbitrary first center. Then repeatedly open the site **farthest from all currently open centers**, until `k` are open. The covering radius is the largest client-to-nearest-center distance.

```python
def k_center_farthest_first(dist, sites, k):
    """Gonzalez 2-approx for metric k-center.
    dist(a,b): a metric (symmetric, triangle inequality).
    Returns (centers, radius) where radius <= 2 * OPT."""
    centers = [sites[0]]
    # nearest open-center distance for each site
    d = {s: dist(s, centers[0]) for s in sites}
    while len(centers) < k:
        far = max(sites, key=lambda s: d[s])   # farthest from all centers
        centers.append(far)
        for s in sites:
            d[s] = min(d[s], dist(s, far))      # update nearest-center distance
    radius = max(d[s] for s in sites)
    return centers, radius
```

### The guarantee, and the dual/lower-bound for the optimality gap

> **Theorem (Gonzalez 1985; Hochbaum–Shmoys).** Farthest-first returns a covering radius `R ≤ 2·OPT` on any metric.

*Proof sketch.* Let `R` be the returned radius, achieved by some site `p` whose nearest center is at distance `R`. Consider the `k` opened centers plus `p`: that is `k+1` points, each pair at distance `≥ R` (the greedy always took the farthest remaining, so every center is at least `R` from the others, and `p` is at distance `R` too). By pigeonhole, two of these `k+1` points fall in the same optimal cluster, whose two clients are each within `OPT` of the same optimal center — so by the triangle inequality they are within `2·OPT` of each other. Hence `R ≤ 2·OPT`. ∎

**The lower-bound certificate for the gap.** The same `k+1` mutually-`≥R`-apart points are a **packing witness**: any `k` centers must leave two of these `k+1` points sharing a center, so

```text
OPT ≥ R / 2          (lower bound, from the packing of k+1 far-apart points)
ALG = R              (the radius we shipped)
optimality gap  =  R / OPT  ≤  2,   and you can REPORT  OPT ∈ [R/2, R].
```

That `[R/2, R]` interval is the production deliverable: you ship radius `R` and you *certify* the true optimum is within a factor of 2, with an explicit witness (the `k+1` points) any reviewer can check in `O(k²)`. In practice you also run a binary search over candidate radii (the Hochbaum–Shmoys "bottleneck" framing) and the LP/packing bound usually pins `OPT` far tighter than the worst-case 2.

### The matching hardness — why you stop at 2

> **Theorem (Hsu–Nemhauser 1979).** For metric k-center, it is NP-hard to achieve any approximation ratio `< 2`.

The reduction is from **dominating set**: a graph has a dominating set of size `k` iff the shortest-path metric has a k-center solution of radius 1; a `(2−ε)`-approximation would distinguish radius-1 from radius-2 instances and thus solve dominating set. So `2` is not a weakness of Gonzalez — it is the **wall**. This is the senior-tier gap reasoning made concrete: the algorithm's `2` and the hardness's `2` meet, the problem is *completely settled*, and tuning for `1.9` is wasted effort. (Contrast **k-means/k-median**, where no such tight constant is known and local search keeps the door open.)

---

## Engineering Reality: Worst-Case Ratio vs Typical, and the Dual Certificate

The worst-case ratio is the *contract*, not the *forecast*. Five practitioner truths:

**1. Typical performance is usually far better than the ratio.** A `2`-approx is rarely `2×` off on real data — it is the adversarial bound. The honest workflow is: ship the guaranteed algorithm, but *measure* the real gap against a computable lower bound (the LP/SDP/packing certificate). You will routinely find you are within single-digit percent, and *that measured number*, not the worst-case `2`, is what you report.

**2. A 2-approx with a dual certificate beats a heuristic with none.** This is the central professional judgment. A heuristic that is "usually great" gives you nothing to say when it is silently bad on a new input distribution. A `2`-approx hands you a **lower bound on every instance**, so you always know how far you *could* be off — and on good instances the certificate proves you are nearly optimal. The certificate is the difference between "trust me" and "here is the proof." When the heuristic *also* has no anytime bound, the guaranteed algorithm wins on operability even when its average quality is slightly worse.

**3. Combine approximation with branch-and-bound.** The LP relaxation that gives your approximation is the *same* LP that bounds a branch-and-bound search. Practical pipelines use the approximation as the **initial incumbent** (a warm start and a valid upper bound) and the LP as the **lower bound**, then let B&B close the gap as time allows — you get the guarantee immediately and optimality if you wait.

**4. Anytime algorithms and the optimality gap in production.** An ILP/B&B solver is *anytime*: at any moment it has an incumbent and a bound, hence a live `gap = (incumbent − bound)/bound`. Wire that gap into your service: stop at a budget (`gap ≤ 1%` or `t ≤ 200ms`), and **log the gap as a quality SLO**. A rising gap over time is an early signal that your instances are drifting toward the hard regime — observability for optimization quality.

**5. Report the gap, not the ratio.** "We use a 2-approximation" undersells you and alarms reviewers. "We solve the LP relaxation, round to an integral solution, and the measured optimality gap on production traffic is p95 = 3.1%, worst-case guarantee 2×" is the sentence that earns trust. The relaxation is doing double duty — algorithm and certificate — and the certificate is the deliverable.

---

## Decision Framework

| Question | Answer |
|---|---|
| **Do I even need a guarantee?** | If a silently-bad answer is cheap to detect/recover → a tuned heuristic (LKH, annealing) is fine. If you must *certify* quality (SLA, safety, money) → use a guaranteed algorithm with a dual certificate. |
| **My objective has diminishing returns** | Monotone submodular → **greedy / CELF**, `1 − 1/e`, and it's optimal. (Coverage, sensors, features, influence.) |
| **Covering / hitting-set shape** | **Greedy** set cover `ln n` (optimal), or **LP rounding** `f`-approx if frequency is small. |
| **Linear constraints, want a free lower bound** | **LP rounding** (deterministic threshold or randomized) — `LP*` is your certificate. |
| **Want LP-grade bounds at combinatorial speed** | **Primal–dual** (vertex cover, Steiner forest, `2`). |
| **Quadratic / `±1` / cut-like objective** | **SDP rounding** (Goemans–Williamson, `0.878`); LP relaxation will be too weak. |
| **Clustering / placement** | **Local search** + **k-means++** seeding (`O(log k)`); k-center → **Gonzalez `2`**. |
| **Weakly NP-hard, number-driven, want arbitrarily tight** | **DP + scaling → FPTAS** (`1+ε`, poly in `1/ε`). Strongly NP-hard → no FPTAS, don't try. |
| **PTAS vs constant-factor vs heuristic?** | PTAS only if you need tunable `ε` *and* it exists (often `n^{O(1/ε)}` — check the exponent before promising it). Otherwise the best constant-factor with a certificate; heuristic only when no guarantee is required. |
| **Moderate `n`, want near-exact** | Model as ILP, run **CBC/Gurobi** anytime, ship at a target **optimality gap**. |
| **Is my relaxation exhausted?** | Compute its **integrality gap** — it's the best ratio you can certify; if too large, strengthen the relaxation or switch patterns. |

---

## Research Pointers

- **Williamson, D., & Shmoys, D. (2011). *The Design of Approximation Algorithms.*** The definitive modern textbook — every pattern here (greedy, LP rounding, primal–dual, local search, SDP, FPTAS) with full proofs and a deterministic-vs-randomized organizing spine. The one book to own for this tier. (Free PDF from the authors.)
- **Vazirani, V. (2001). *Approximation Algorithms.*** The complementary classic — superb on LP duality, primal–dual (the "method" chapters), and the combinatorial-vs-LP duality view; the cleanest treatment of set cover, Steiner, and multicut.
- **Nemhauser, G., Wolsey, L., & Fisher, M. (1978). "An Analysis of Approximations for Maximizing Submodular Set Functions."** The `1 − 1/e` greedy theorem — foundation of coverage/influence/feature-selection guarantees.
- **Krause, A., & Golovin, D. (2014). "Submodular Function Maximization."** The practitioner survey: lazy greedy/CELF, constraints, and the ML applications (sensors, summarization, active learning).
- **Goemans, M., & Williamson, D. (1995). "Improved Approximation Algorithms for Maximum Cut … Using Semidefinite Programming."** The `0.878` SDP and hyperplane rounding.
- **Arthur, D., & Vassilvitskii, S. (2007). "k-means++: The Advantages of Careful Seeding."** The `O(log k)`-expected seeding now standard everywhere.
- **Gonzalez, T. (1985). "Clustering to Minimize the Maximum Intercluster Distance."**; **Hochbaum, D., & Shmoys, D. (1985).** Farthest-first / bottleneck k-center 2-approx and the matching `< 2` hardness.
- **Arya et al. (2004). "Local Search Heuristics for k-Median and Facility Location."** The constant-factor local-search analyses.
- **Agrawal, A., Klein, P., & Ravi, R. (1995); Goemans, M., & Williamson, D. (1995).** Primal–dual 2-approx for Steiner forest — the template for network-design guarantees.
- **Gurobi / COIN-OR CBC / OR-Tools docs.** The anytime optimality-gap discipline — modeling, warm starts, and reading the bound as a production certificate.

---

## Key Takeaways

1. **Six patterns cover almost everything you'll ship.** Greedy-with-charging, LP-rounding, primal–dual, SDP-rounding, local search, and DP-scaling-to-FPTAS — the *shape of the objective* picks the pattern, and the pattern hands you the proof *and* the lower bound.
2. **Greedy is not a placeholder.** It is *provably optimal* for set cover (`ln n`) and monotone submodular maximization (`1 − 1/e`). The submodular `1 − 1/e` (Nemhauser–Wolsey–Fisher) is the workhorse behind influence maximization, sensor placement, and feature selection — and CELF/lazy-greedy keeps the same guarantee at scale.
3. **The relaxation is algorithm AND certificate.** The LP/SDP you round to produce the algorithm is *also* a computable lower bound on `OPT`. That dual certificate is what lets you report an honest optimality gap instead of a scary worst-case ratio.
4. **The integrality gap is the practical ceiling.** It is the best ratio any rounding of that relaxation can certify; compute it to know when a relaxation is exhausted (vertex cover LP = `2`) and to choose between relaxations (MAX-CUT: LP gap `2` useless, SDP gap `1.138` — so it's an SDP problem).
5. **Theory ratio ≠ production code.** Christofides (`1.5`) is the routing *guarantee*; LKH (no guarantee, ~0.1% typical) is the *code*. k-means++ (`O(log k)`) seeds Lloyd. The guarantee is your floor and your reporting language; the shipped algorithm is often a certificate-free heuristic measured against that floor.
6. **A 2-approx with a dual certificate beats a guarantee-free heuristic.** On every instance you know how far you *could* be off; on good instances the certificate proves near-optimality. Combine it with branch-and-bound (approx = incumbent, LP = bound) and run anytime, logging the live optimality gap as a quality SLO.
7. **The worked k-center case is the whole tier in miniature.** Gonzalez farthest-first gives `R ≤ 2·OPT`; the same `k+1` far-apart points certify `OPT ≥ R/2`, so you ship `R` and report `OPT ∈ [R/2, R]`; and the `< 2` hardness (Hsu–Nemhauser) says `2` is the wall — algorithm, certificate, and matching lower bound in one problem.

---

> **See also:** [`./senior.md`](./senior.md) for the inapproximability side — gaps, PCP, UGC, and why these exact ratios (`0.878`, `1−1/e`, k-center `2`) are provably optimal · [`../07-reductions-and-np-completeness/professional.md`](../07-reductions-and-np-completeness/professional.md) for proving your problem hard before you approximate it · [`../06-complexity-classes-p-np/professional.md`](../06-complexity-classes-p-np/professional.md) for the full exact-or-near-exact response menu (ILP/SAT/CP solvers, FPT, metaheuristics)
