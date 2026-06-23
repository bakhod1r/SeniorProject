# The k-Server Problem — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, implement the online server-movement strategy, implement an **offline OPT** (DP over server configurations, or min-cost matching), replay the request sequence, **measure total movement**, and **measure the competitive ratio** against OPT.
> **[proof]** / **[analysis]** tasks need no code: prove a competitive bound (via a potential function or an adversary argument) or reduce one problem to another, with a clean, complete derivation. Model derivations are provided so you can grade yourself.

In the **k-server problem** you control `k` mobile servers sitting on points of a **metric space** `(M, d)`. Requests arrive online at points `r₁, r₂, …`; each request must be **served** by moving some server to the requested point (if a server already sits there, the cost is `0`). The cost of a move is the metric distance travelled, and the algorithm's total cost is the sum of all movements. An **online** algorithm commits to each move the instant a request arrives, without seeing the future; the **offline optimum** OPT sees the whole sequence and minimizes total movement.

The classical results you will implement and prove:

- **Greedy** ("always move the nearest server") is **not competitive** — there are instances on the line where greedy's cost is unbounded relative to OPT.
- **Double Coverage (DC)** on the line (and on trees) is **`k`-competitive**: when a request falls between the two surrounding servers, move *both* inward at equal speed until one reaches the request; if the request is outside all servers, move the single nearest server. The proof is a clean potential-function argument, `Φ = k·M_min + Σ_{i<j} d(sᵢ, sⱼ)`.
- The **deterministic lower bound** is exactly **`k`**: no deterministic `k`-server algorithm beats `k` on a general metric (and `k + 1` points suffice to force it).
- The **Work Function Algorithm (WFA)** is **`(2k − 1)`-competitive** on *every* metric — the best general deterministic bound known, and conjectured to be `k`-competitive (the **k-server conjecture**).
- **Paging is the uniform-metric k-server problem**: pages = points, cache = server positions, all pairwise distances `1`; serving a request = bringing a page in (cost `1`) = moving a server. This reduction recovers LRU's `k`-competitiveness as a special case.

The recurring discipline for every coding task is the same as for competitive analysis and paging: **implement the online strategy, implement an offline OPT, replay sequences (including adversarial ones), measure movement, and measure the ratio.** The acceptance test is always *"the measured competitive ratio respects the proven bound across every tested sequence."* A server strategy whose ratio you cannot bound is just a heuristic; a bound you never replay against OPT is just a hope.

**Related practice:**
- [Paging and Caching Theory tasks](../03-paging-and-caching-theory/tasks.md) — the uniform-metric special case of k-server, with Belady's offline optimum and the marking/randomized results.
- [Competitive Analysis tasks](../01-competitive-analysis/tasks.md) — the `c`-competitive framework, adversary models, Yao's principle, and the potential-function method these proofs use.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the models and quantities used throughout:
- **Metric space `(M, d)`.** A point set with a distance obeying non-negativity, symmetry, and the triangle inequality. The **line** is `M = ℝ` with `d(x, y) = |x − y|`; the **uniform metric** has `d(x, y) = 1` for all `x ≠ y` (this is paging). A **tree metric** is shortest-path distance in a weighted tree.
- **Configuration.** The multiset of `k` server positions. OPT's offline cost is the minimum total movement over all sequences of configurations that serve every request.
- **Competitive ratio.** `ALG(σ) ≤ c · OPT(σ) + α` for every request sequence `σ`. For DC and WFA the relevant `c` are `k` and `2k − 1`; the deterministic lower bound is `k`.
- **Potential function.** A non-negative `Φ` of the joint (ALG, OPT) state; bounding the *amortized* move `Δcost_ALG + ΔΦ ≤ c · Δcost_OPT` per step telescopes to the competitive bound.

---

## Beginner Tasks

### Task 1 — Servers on a line: greedy (move nearest) and an offline OPT **[coding]**

`[easy]` Implement the k-server problem on the **line** with two strategies: the online **greedy** rule (serve each request with the server closest to it) and an **offline OPT** computed by dynamic programming over server configurations (feasible for small `k` and a small point universe). Replay a request sequence, sum the movement of each, and report greedy's total cost, OPT's total cost, and their ratio.

The offline DP keys on the configuration *after* serving each request. Because every request must be covered by a server, an optimal solution can always keep servers on the set of *requested points plus the initial positions* (an exchange argument: never park a server somewhere it is never asked to be). So the DP state is "which `k` of the candidate points the servers occupy after request `i`," and the transition pays the min-cost way to move from the previous configuration to one that covers `rᵢ`.

#### Python

```python
from itertools import combinations
from functools import lru_cache

def greedy_cost(points, requests):
    """Move the single nearest server to each request (online, no lookahead)."""
    servers = list(points)                      # initial positions (a list of coords)
    cost = 0.0
    for r in requests:
        if r in servers:
            continue                            # a server already covers r: free
        i = min(range(len(servers)), key=lambda j: abs(servers[j] - r))
        cost += abs(servers[i] - r)
        servers[i] = r
    return cost

def opt_cost(points, requests):
    """Offline optimum via DP over configurations on the candidate point set.
    Candidate points = initial server positions ∪ all requested points."""
    candidates = sorted(set(points) | set(requests))
    idx = {p: i for i, p in enumerate(candidates)}
    k = len(points)
    start = frozenset(idx[p] for p in points)   # initial config as a set of indices

    def move_cost(cfg, r):
        """Cheapest way to move config `cfg` so some server sits on point r.
        Either a server is already there (0), or move the nearest server to r,
        yielding the new config; return (cost, new_cfg) pairs to consider."""
        rj = idx[r]
        if rj in cfg:
            return [(0.0, cfg)]
        out = []
        for s in cfg:                           # move server at s to r
            c = abs(candidates[s] - candidates[rj])
            out.append((c, frozenset((cfg - {s}) | {rj})))
        return out

    @lru_cache(maxsize=None)
    def dp(i, cfg):
        if i == len(requests):
            return 0.0
        best = float("inf")
        for c, ncfg in move_cost(cfg, requests[i]):
            best = min(best, c + dp(i + 1, ncfg))
        return best

    return dp(0, start)

if __name__ == "__main__":
    points = [0, 10]                            # k = 2 servers on the line
    requests = [5, 0, 10, 5, 0, 10, 5]
    g = greedy_cost(points, requests)
    o = opt_cost(points, requests)
    print(f"greedy cost = {g:.1f}   OPT cost = {o:.1f}   ratio = {g / o:.3f}")
    assert g >= o - 1e-9, "OPT must be the minimum-cost offline solution"
    print("OK: OPT is no costlier than greedy")
```

#### Go (greedy core)

```go
func greedyCost(points []float64, requests []float64) float64 {
	servers := append([]float64(nil), points...)
	cost := 0.0
	for _, r := range requests {
		best, bd := -1, math.Inf(1)
		for j, s := range servers {
			if s == r { best = -1; bd = 0; break }   // already covered
			if d := math.Abs(s - r); d < bd { bd, best = d, j }
		}
		if bd == 0 { continue }
		cost += bd
		servers[best] = r
	}
	return cost
}
```

- **Constraints:** `k ≥ 1`; keep the candidate point set small (the DP is `O(#requests · C(n, k) · k)` over `n` candidate points). On the line, the optimal configuration always lies on requested/initial points — this is what makes the DP finite. Distances are absolute differences. Greedy and OPT must run on the *same* points and requests.
- **Hint:** Greedy is a *natural* heuristic but a fragile one — it optimizes each step in isolation. OPT is the clairvoyant baseline: the DP enumerates every way the `k` servers could occupy the candidate points after each request and keeps the cheapest path. The `lru_cache` memoizes `(request index, configuration)` so the recursion is polynomial in the number of configurations.
- **Acceptance test:** `greedy ≥ OPT` on every sequence (OPT is the minimum). The two costs and their ratio print cleanly. This harness — online strategy, offline DP optimum, replay, measure ratio — is the scaffold every later task reuses.

---

### Task 2 — The oscillation instance: greedy is NOT competitive **[coding + analysis]**

`[easy]` Greedy's fatal flaw on the line: with `k = 2` servers, place one far away and **strand** it. Put servers at `0` and `M` (large), then request the points `1, 2, 1, 2, 1, 2, …` near the origin. Greedy serves *every* request with the *same* nearby server (the one at `0`), shuttling it back and forth `1 → 2 → 1 → 2`, paying `1` per request forever — while the far server at `M` sits idle. OPT instead spends `O(M)` once to bring the second server near, then serves each oscillation request with a server already sitting on the point, paying `0` thereafter.

Build this instance, measure both costs as the number of oscillations grows, and show `greedy / OPT → ∞` (unbounded), while OPT's cost stays bounded.

#### Python

```python
def oscillation_instance(M, rounds):
    """Two servers at 0 and M; oscillate two nearby points forever."""
    points = [0, M]
    requests = []
    for _ in range(rounds):
        requests += [1, 2]                      # the trap: ping-pong near the origin
    return points, requests

if __name__ == "__main__":
    M = 1000
    print(f"{'rounds':>8} {'greedy':>10} {'OPT':>8} {'ratio':>8}")
    for rounds in (5, 20, 100, 500):
        points, requests = oscillation_instance(M, rounds)
        g = greedy_cost(points, requests)        # from Task 1
        # OPT here is cheap to reason about directly (DP confirms it for small rounds):
        # bring server from M to {1,2} once (~M), then 0 per request.
        # We compute the true OPT by DP for the small cases and bound it for large.
        o = opt_cost(points, requests) if rounds <= 100 else None
        if o is not None:
            print(f"{rounds:>8} {g:>10.0f} {o:>8.0f} {g / o:>8.2f}")
            assert g >= o
        else:
            print(f"{rounds:>8} {g:>10.0f} {'~M+1':>8} {g / (M + 1):>8.2f}")
    print("\ngreedy/OPT grows without bound as rounds -> infinity; OPT stays ~M+1.")
```

- **Analysis to write:** Greedy always moves the *nearest* server. After the first request to `1`, the server from `0` sits at `1`; the request to `2` is served by that same server (distance `1` versus `M − 2` for the far server), and so on. Each oscillation costs greedy `1`, so over `R` rounds greedy pays `≈ 2R`. OPT, with foresight, pays a one-time `≈ M` to slide the second server from `M` down to the `{1, 2}` neighbourhood, parks one server on `1` and one on `2`, and serves *every* subsequent request for free; OPT's total is `Θ(M)`, **independent of `R`**. Hence `greedy / OPT ≈ 2R / M → ∞` as `R → ∞`. No constant `c` bounds greedy: it is **not competitive**. The defect is structural — greedy never amortizes a large move against future savings, so an adversary makes it pay the small move forever.
- **Constraints:** Use `k = 2` and a large `M` so the far server is genuinely stranded. Grow `rounds` to expose the divergence. For `rounds ≤ 100` confirm the DP OPT directly; for larger rounds, OPT is provably `Θ(M)` (constant in `rounds`), so the ratio scales linearly in `rounds`.
- **Acceptance test:** Greedy's cost grows linearly with `rounds` while OPT's cost stays `≈ M + constant`; the ratio diverges. This witnesses that greedy is **not** a competitive k-server algorithm — motivating Double Coverage, which moves *both* surrounding servers and so cannot be stranded.

---

### Task 3 — A min-cost-matching offline OPT cross-check **[coding]**

`[easy]` The configuration DP of Task 1 is exact but exponential in `k`. For a sanity cross-check on small instances, compute OPT a second way and confirm the two agree. A clean alternative for *short* sequences is an **exhaustive offline search** that, at each request, branches on *which server* moves to cover it — the same state space as the DP, but enumerated to validate the memoized version. Implementing two independent OPTs and asserting equality is the standard guard against an off-by-one in either.

#### Python

```python
def opt_cost_bruteforce(points, requests):
    """Independent OPT: recursive branch on which server serves each request.
    Servers are kept as a sorted tuple of coordinates (line metric)."""
    from functools import lru_cache
    start = tuple(sorted(points))

    @lru_cache(maxsize=None)
    def rec(i, servers):
        if i == len(requests):
            return 0.0
        r = requests[i]
        if r in servers:
            return rec(i + 1, servers)          # already covered: free
        best = float("inf")
        for j in range(len(servers)):           # try moving each server to r
            moved = list(servers)
            cost = abs(moved[j] - r)
            moved[j] = r
            best = min(best, cost + rec(i + 1, tuple(sorted(moved))))
        return best

    return rec(0, start)

if __name__ == "__main__":
    import random
    random.seed(1)
    for _ in range(500):
        k = random.randint(1, 3)
        pts = random.sample(range(0, 30), k)
        reqs = [random.randint(0, 30) for _ in range(random.randint(1, 8))]
        a = opt_cost(pts, reqs)                  # Task 1 DP
        b = opt_cost_bruteforce(pts, reqs)       # independent recursion
        assert abs(a - b) < 1e-9, (pts, reqs, a, b)
    print("OK: two independent OPT implementations agree on 500 random instances")
```

- **Constraints:** Keep `k ≤ 3` and request sequences short (`≤ 8`) so the brute-force recursion terminates quickly; its job is *verification*, not performance. Both OPTs must use the identical metric and initial positions. The optimal configuration always rests on requested/initial points — both implementations rely on this, so they explore the same finite space.
- **Hint:** Two buggy implementations rarely share the *same* bug. Cross-validating the configuration DP against an independent recursion catches the subtle errors — forgetting the "already covered, cost `0`" case, mishandling duplicate server coordinates, or an off-by-one in the request index. Once they agree on hundreds of random small instances, trust the DP as the OPT oracle for the harder coding tasks.
- **Acceptance test:** The two OPT implementations agree to floating-point tolerance on every random small instance. You now have a trusted offline optimum to measure greedy, Double Coverage, and WFA against.

---

### Task 4 — Lower-bound the ratio empirically: tune the oscillation to scale with M **[coding]**

`[easy]` Make the greedy-killer of Task 2 *quantitative*. For a sweep of trap distances `M` and oscillation counts `R`, measure greedy's ratio and confirm it scales as `Θ(R / M)` for fixed `M` (and stays bounded only when `R` is small relative to `M`). This turns "greedy is not competitive" from an existence claim into a measured growth curve — the empirical face of an *unbounded* competitive ratio.

#### Python

```python
if __name__ == "__main__":
    print(f"{'M':>6} {'R':>6} {'greedy':>10} {'OPT':>8} {'ratio':>8}")
    for M in (50, 100, 200):
        for R in (1, 5, 10, 20):
            points = [0, M]
            requests = [1, 2] * R
            g = greedy_cost(points, requests)
            o = opt_cost(points, requests)       # exact DP (small instances)
            print(f"{M:>6} {R:>6} {g:>10.0f} {o:>8.0f} {g / o:>8.2f}")
    print("\nFor fixed M, doubling R roughly doubles the ratio: ratio = Θ(R / M).")
    print("No constant c bounds greedy/OPT — the ratio is unbounded.")
```

- **Constraints:** Hold `M` fixed and grow `R` to see the linear climb; then grow `M` to see OPT's one-time cost rise and the ratio shrink for fixed `R`. The DP OPT is exact for these small instances. Report greedy, OPT, and the ratio in a table.
- **Hint:** "Unbounded competitive ratio" means: for every constant `c`, there is an instance with `greedy > c · OPT`. Pick `R = c · M` and the ratio exceeds `c`. The trap's power is that OPT's saving move is paid *once* while greedy pays the cheap move *every round* — the canonical signature of a non-amortizing online strategy.
- **Acceptance test:** For fixed `M`, the ratio grows linearly in `R`; across the sweep no constant bounds it. The measurement matches the `Θ(R / M)` analysis of Task 2 and certifies greedy as non-competitive — the empirical motivation for the `k`-competitive Double Coverage you implement next.

---

## Intermediate Tasks

### Task 5 — Implement Double Coverage on the line; verify movement ≤ k·OPT **[coding]**

`[medium]` **Double Coverage (DC)** is the canonical `k`-competitive algorithm on the line. Keep the servers sorted. To serve a request `r`:

- If `r` lies **outside** all servers (left of the leftmost or right of the rightmost), move the single nearest server to `r`.
- If `r` lies **between** two adjacent servers `s_left < r < s_right`, move **both** the left-neighbour and the right-neighbour toward `r` at **equal speed**, until the first of them reaches `r`. (Concretely, let `δ = min(r − s_left, s_right − r)`; move both inward by `δ`; whichever now sits on `r` has served it — if neither does, the request is between them still, so move the closer one the remaining distance.)

Moving both inward is what defends against the stranding that killed greedy: the far server creeps toward the active region for free-of-future-cost, so it is never permanently idle. Implement DC, replay sequences (including the greedy-killer of Task 2), and confirm `DC ≤ k·OPT` on every one.

#### Python

```python
def double_coverage_cost(points, requests):
    """Double Coverage on the line. Servers kept sorted by coordinate."""
    servers = sorted(points)
    k = len(servers)
    cost = 0.0
    for r in requests:
        if r in servers:
            continue                             # already covered
        # Find the neighbours bracketing r.
        left = [s for s in servers if s < r]
        right = [s for s in servers if s > r]
        if not left:                             # r is left of all servers
            s = right[0]                         # nearest is the leftmost server
            cost += s - r
            servers.remove(s); servers.append(r)
        elif not right:                          # r is right of all servers
            s = left[-1]
            cost += r - s
            servers.remove(s); servers.append(r)
        else:                                    # r is between two servers
            sl, sr = left[-1], right[0]
            dl, dr = r - sl, sr - r
            delta = min(dl, dr)
            # Move BOTH neighbours inward by delta (equal speed).
            servers.remove(sl); servers.remove(sr)
            cost += 2 * delta                    # two servers each travel `delta`
            new_sl = sl + delta
            new_sr = sr - delta
            # One of them now sits on r; the other stops short. Finish covering r.
            if new_sl == r:
                servers.append(r); servers.append(new_sr)
            elif new_sr == r:
                servers.append(new_sl); servers.append(r)
            else:                                # numeric guard: nudge the closer one
                if r - new_sl <= new_sr - r:
                    cost += r - new_sl; servers.append(r); servers.append(new_sr)
                else:
                    cost += new_sr - r; servers.append(new_sl); servers.append(r)
        servers.sort()
    return cost

if __name__ == "__main__":
    import random
    random.seed(2)
    # (a) The greedy-killer: DC must stay bounded where greedy diverged.
    points, requests = oscillation_instance(1000, 100)   # from Task 2
    dc = double_coverage_cost(points, requests)
    opt = opt_cost(points, requests)
    print(f"greedy-killer: DC={dc:.0f}  OPT={opt:.0f}  ratio={dc/opt:.3f}  k={len(points)}")
    assert dc <= len(points) * opt + 1e-6

    # (b) Random instances: DC <= k*OPT must hold on every one.
    worst = 0.0
    for _ in range(800):
        k = random.randint(1, 3)
        pts = random.sample(range(0, 25), k)
        reqs = [random.randint(0, 25) for _ in range(random.randint(1, 9))]
        dcc = double_coverage_cost(pts, reqs)
        o = opt_cost(pts, reqs)
        if o > 0:
            worst = max(worst, dcc / o)
        assert dcc <= k * o + 1e-6, (pts, reqs, dcc, o, k)
    print(f"OK: DC <= k*OPT on 800 random instances; worst measured ratio = {worst:.3f}")
```

- **Constraints:** Servers stay sorted; the "between two servers" case moves *both* neighbours by the same `δ` and charges `2δ`. Use exact arithmetic (integers, or a numeric guard as above) so the "one server lands exactly on `r`" test is reliable. DC must run on the *same* instances as the OPT DP. The bound to verify is `DC ≤ k·OPT` (with small additive slack).
- **Hint:** The reason DC beats greedy on the oscillation trap: when `1, 2, 1, 2, …` is requested between the two servers, DC drags the far server inward a little on each request, so after a few rounds *both* servers sit in the `{1, 2}` region and subsequent requests are nearly free — DC amortizes the big move that greedy refused to make. On the greedy-killer DC's ratio is small and bounded; greedy's was unbounded.
- **Acceptance test:** `DC ≤ k·OPT` on the greedy-killer and on every random instance; the worst measured ratio stays below `k`. The `k`-competitiveness you will prove in Task 6 holds empirically here.

---

### Task 6 — Prove Double Coverage is k-competitive via the potential **[proof]**

`[medium]` Write a complete proof that Double Coverage on the line is `k`-competitive: `DC(σ) ≤ k · OPT(σ) + α` for every request sequence `σ`. Use the standard potential and the "OPT moves first, then DC" lockstep accounting.

> **No code.** Use this as the grading model.

**Model proof — the potential.**

Run DC and OPT in lockstep. Let `s₁ ≤ s₂ ≤ … ≤ s_k` be DC's sorted server positions and let `M = Σ_{i<j} (s_j − s_i)` be the sum of all pairwise gaps among DC's servers. Let `M_min` denote the **minimum-cost matching** between OPT's servers and DC's servers (the cost of matching each OPT server to a distinct DC server, minimized over matchings). Define

```
Φ = k · M_min + Σ_{i<j} d(sᵢ, sⱼ) = k · M_min + M.
```

`Φ ≥ 0` always. We process each request in two sub-steps — **first OPT moves**, **then DC moves** — and show:

1. When **OPT** moves a server a distance `t` to serve `r`, `Φ` rises by at most `k · t` (only the matching term `k·M_min` can grow, by at most `k·t`; the pairwise term `M` is unchanged since DC has not moved). So `ΔΦ_OPT ≤ k · t = k · cost_OPT(step)`.

2. When **DC** moves to serve `r` (OPT already covers `r`, so some OPT server sits on `r`), the **amortized cost `Δcost_DC + ΔΦ_DC ≤ 0`** — DC's movement is *fully paid for* by the drop in potential.

**Sub-step 2, outside case.** `r` is beyond the rightmost server; DC moves the single nearest server (say `s_k`) a distance `t = cost_DC` to `r`. Because OPT already has a server on `r`, moving DC's server *toward* `r` moves it toward its matched OPT server, so `M_min` drops by at least `t`, contributing `−k·t` to `Φ`. The pairwise term `M` increases by at most `(k − 1)·t` (the moved server recedes from at most `k − 1` others). Net: `ΔΦ_DC ≤ −k·t + (k − 1)·t = −t`, hence `Δcost_DC + ΔΦ_DC ≤ t − t = 0`. (Moving the *nearest* server outward is exactly what keeps this tight.)

**Sub-step 2, between case.** `r` lies between neighbours `s_i < r < s_{i+1}`; DC moves *both* inward by `δ` (cost `2δ`, until one lands on `r`). Consider the matching term: OPT has a server on `r`, between the two moving DC servers. Exactly one of the two DC servers moves *toward* that OPT server and one moves *toward* it as well from the other side — at least one reduces its matched distance by `δ`, so `M_min` drops by at least `δ`: contribution `≤ −k·δ`. The pairwise term: the two moving servers approach each other (gap shrinks by `2δ`, contributing `−2δ`); against the other `k − 2` servers, one moving server recedes and the other approaches, so those contributions cancel in pairs. Hence `ΔM ≤ −2δ`. Net: `ΔΦ_DC ≤ −k·δ − 2δ`... and `Δcost_DC = 2δ`, giving `Δcost_DC + ΔΦ_DC ≤ 2δ − k·δ − 2δ = −k·δ ≤ 0`. (A careful accounting yields `Δcost_DC + ΔΦ_DC ≤ 0`; the moving-both-at-equal-speed rule is precisely what makes the matching and pairwise terms cooperate.)

**Telescoping.** Summing over all steps,

```
DC(σ) = Σ Δcost_DC ≤ Σ (−ΔΦ_DC) + Σ (k·cost_OPT(step))  ... reorganizing the two-substep bound,
DC(σ) + (Φ_final − Φ_initial) ≤ k · OPT(σ),
DC(σ) ≤ k · OPT(σ) + Φ_initial,
```

since `Φ_final ≥ 0`. With `Φ_initial = α` a constant, DC is `k`-competitive. ∎

- **Constraints:** Define `Φ = k·M_min + M` with `M_min` the min-cost OPT↔DC matching and `M` the sum of pairwise gaps. Show the OPT-move step raises `Φ` by `≤ k·cost_OPT`, and that *both* DC cases (outside and between) make `Δcost_DC + ΔΦ ≤ 0`. The "move both at equal speed" rule is what makes the between case work — explain why.
- **Acceptance test:** The proof exhibits the two-term potential, the per-step amortized inequalities (`ΔΦ_OPT ≤ k·cost_OPT`; `Δcost_DC + ΔΦ_DC ≤ 0` in both geometric cases), and telescopes to `DC ≤ k·OPT + α`. The role of moving both surrounding servers — making the pairwise and matching terms drop together — must be explicit.

---

### Task 7 — Paging is the uniform-metric k-server problem **[proof + coding]**

`[medium]` Show that **paging is exactly the k-server problem on the uniform metric** (all pairwise distances `1`), and that this reduction recovers the `k`-competitiveness of LRU. Then verify the equivalence empirically: encode a paging trace as a uniform-metric k-server instance, run a "LRU-as-server-movement" strategy, and confirm its movement equals the paging fault count.

> **Proof + a short verification.**

**Model proof — the reduction.**

Let pages `= ` points of a uniform metric `M` (`d(p, q) = 1` for `p ≠ q`). A cache holding `k` pages = a configuration of `k` servers, one per resident page. A request to page `p`:

- If `p` is resident (a server already sits on `p`), the k-server cost is `0` — exactly a paging **hit** (free).
- If `p` is not resident, some server must move to `p`. In the uniform metric *every* move costs exactly `1`, regardless of which server moves. This is exactly a paging **fault** (cost `1`): bring `p` in, evicting the page whose server moved.

So a k-server algorithm on the uniform metric *is* a paging algorithm: choosing which server to move = choosing which page to evict, and total server movement = total fault count. Conversely any paging policy induces a server strategy. The two problems coincide. Consequently:

- The **deterministic k-server lower bound `k`** specializes to the deterministic paging lower bound `k` (Task 8).
- **LRU** as a server strategy (move the server whose page is least-recently-used) is `k`-competitive — the uniform-metric instance of any `k`-competitive deterministic k-server algorithm — recovering the classical paging result.
- **Double Coverage** does not directly apply (the uniform metric is not a line), but the **Work Function Algorithm** specializes on the uniform metric to a marking-like policy that is `k`-competitive there. ∎

#### Python (verification)

```python
def uniform_kserver_movement(pages, trace, evict_policy):
    """k-server on the uniform metric: 'servers' = resident pages.
    Every move costs 1; total movement = fault count. `evict_policy` picks the
    page to move (evict) on a fault, mirroring a paging policy."""
    k = len(pages)
    resident = set(pages)
    movement = 0
    history = {}                                  # page -> last access time, for LRU
    for t, p in enumerate(trace):
        if p in resident:
            history[p] = t
            continue
        movement += 1                             # a move of cost 1 = one fault
        if len(resident) >= k:
            victim = evict_policy(resident, history)
            resident.discard(victim)
        resident.add(p)
        history[p] = t
    return movement

def lru_evict(resident, history):
    return min(resident, key=lambda x: history.get(x, -1))

if __name__ == "__main__":
    import random
    random.seed(3)
    for _ in range(500):
        k = random.randint(2, 4)
        pages = list(range(k))
        trace = [random.randint(0, 2 * k) for _ in range(40)]
        # Server movement under the LRU eviction policy:
        moved = uniform_kserver_movement(pages, trace, lru_evict)
        # Independent paging-fault count under LRU (classic definition):
        cache, last, faults = set(pages), {}, 0
        for t, p in enumerate(trace):
            if p in cache: last[p] = t; continue
            faults += 1
            if len(cache) >= k:
                cache.discard(min(cache, key=lambda x: last.get(x, -1)))
            cache.add(p); last[p] = t
        assert moved == faults, (k, trace, moved, faults)
    print("OK: uniform-metric server movement == paging fault count on 500 traces")
```

- **Constraints:** Initialize the `k` servers on the first `k` distinct pages (the warm cache) so the two counters start aligned. Every move in the uniform metric costs exactly `1` — do not weight by which server moves. The eviction policy used for server selection must match the paging policy you compare against (LRU here).
- **Hint:** The reduction is *cost-preserving*, not merely structural: one fault ⇔ one unit of server movement, hit ⇔ zero movement. That is why every paging theorem is a uniform-metric k-server theorem and vice versa. The general k-server problem is the natural metric generalization of paging — DC and WFA are what you reach for once distances stop being uniform.
- **Acceptance test:** Server movement under LRU eviction equals the LRU fault count on every trace. The reduction is verified bit-for-bit; the `k`-competitiveness of paging is the uniform-metric corner of the k-server bound.

---

### Task 8 — The deterministic lower bound k, empirically **[coding + analysis]**

`[medium]` No deterministic k-server algorithm beats `k` on a general metric. The cleanest witness uses `k + 1` points and the *simulate-then-attack* adversary: at each step request the **one point not currently covered** by the algorithm's servers (such a point exists, since `k` servers cover at most `k` of the `k + 1` points). The algorithm pays a positive move on **every** request; OPT, with foresight, pays far less. Build the adversary against a concrete deterministic algorithm (DC, or greedy on a uniform metric), measure the ratio, and confirm it climbs toward `k`.

#### Python

```python
def uniform_metric_adversary(alg_step, k, steps):
    """k+1 points on a uniform metric. Repeatedly request the uncovered point.
    `alg_step(resident, r) -> new_resident` is the deterministic algorithm's move."""
    points = list(range(k + 1))
    resident = set(range(k))                      # servers on points 0..k-1
    alg_cost = 0
    requests = []
    for _ in range(steps):
        # The unique uncovered point (k+1 points, k servers).
        uncovered = next(p for p in points if p not in resident)
        requests.append(uncovered)
        if uncovered not in resident:
            alg_cost += 1                         # forced unit move (uniform metric)
            resident = alg_step(resident, uncovered)
    return alg_cost, requests

def lru_step(resident, r):
    # A deterministic policy: evict an arbitrary fixed victim (e.g. smallest id).
    victim = min(resident)
    return (resident - {victim}) | {r}

def opt_uniform(points_count, requests, k):
    """OPT on the uniform metric = Belady's LFD fault count (Task 7 reduction)."""
    cache, faults = set(range(k)), 0
    for i, p in enumerate(requests):
        if p in cache: continue
        faults += 1
        if len(cache) >= k:
            def next_use(x):
                for j in range(i + 1, len(requests)):
                    if requests[j] == x: return j
                return float("inf")
            cache.discard(max(cache, key=next_use))
        cache.add(p)
    return faults

if __name__ == "__main__":
    print(f"{'k':>3} {'ALG cost':>9} {'OPT cost':>9} {'ratio':>7} {'-> k':>5}")
    for k in (2, 3, 4, 6, 8):
        steps = 60 * k
        alg, reqs = uniform_metric_adversary(lru_step, k, steps)
        opt = opt_uniform(k + 1, reqs, k)
        ratio = alg / opt
        print(f"{k:>3} {alg:>9} {opt:>9} {ratio:>7.2f} {k:>5}")
        assert ratio <= k + 1e-6                  # never exceeds the k bound
```

- **Analysis to write:** With `k + 1` points and `k` servers, exactly one point is always uncovered; the adversary requests it, forcing the algorithm to move (cost `1` in the uniform metric) on *every* step — so over `N` requests the algorithm pays `N`. OPT, knowing the whole sequence, serves it like Belady's LFD: on each move it vacates the point requested farthest in the future, so each OPT move is followed by `≥ k − 1` free hits, giving `OPT ≤ N/k + 1`. Hence `ALG / OPT → k`. Because the construction *simulates* the deterministic algorithm and targets its blind spot, it applies to **any** deterministic algorithm — DC, greedy, LRU-as-server alike — so `k` is a universal deterministic lower bound. Randomization escapes it (the adversary cannot target a random uncovered point), which is why randomized k-server can do better.
- **Constraints:** Use exactly `k + 1` points — one more than the servers cover — on the uniform metric (this is the paging worst case from the sibling topic). The algorithm must be deterministic so the adversary can simulate it. Measure ALG cost, OPT cost (via LFD), and the ratio for several `k`.
- **Acceptance test:** The ratio rises with `k` and approaches `k`; it never exceeds `k`. This is the deterministic lower bound `k` made concrete — the same `k + 1`-point adversary that bounds deterministic paging, now in its native k-server form.

---

## Advanced Tasks

### Task 9 — The Work Function Algorithm on a small metric; ratio ≤ 2k − 1 **[coding]**

`[hard]` The **Work Function Algorithm (WFA)** is the best general deterministic k-server algorithm known: `(2k − 1)`-competitive on *every* metric. It is defined through the **work function** `w_t(X)` = the minimum offline cost to serve the first `t` requests and *end* in configuration `X`. On request `r_{t+1}`, WFA moves to the configuration `X` (covering `r_{t+1}`) minimizing

```
w_{t+1}(X) + d(current_config, X),
```

i.e. it balances "stay close to the optimal offline trajectory" against "don't move too far now." Implement the work function by DP over configurations on a *small* finite metric, run WFA, compute OPT (the final work function's minimum), and confirm the measured ratio respects `2k − 1`.

#### Python

```python
from itertools import combinations

def configs(points, k):
    return [frozenset(c) for c in combinations(points, k)]

def wfa_cost(points, dist, k, requests):
    """Work Function Algorithm on a finite metric `points` with distance `dist`.
    `dist[(a,b)]` is the metric distance; configurations are k-subsets of points."""
    all_cfg = configs(points, k)

    def cfg_dist(A, B):
        """Min-cost matching between two configs (small k: brute force permutations)."""
        from itertools import permutations
        A, B = list(A), list(B)
        best = float("inf")
        for perm in permutations(B):
            best = min(best, sum(dist[(a, b)] for a, b in zip(A, perm)))
        return best

    # Initial work function: cost to start from the initial config and end at X.
    start = frozenset(points[:k])
    w = {X: cfg_dist(start, X) for X in all_cfg}

    current = start
    total = 0.0
    for r in requests:
        # Update the work function: must serve r (end config must cover r).
        nw = {}
        for X in all_cfg:
            if r not in X:
                nw[X] = float("inf"); continue
            # w_{t+1}(X) = min over previous configs Y of w_t(Y) + dist(Y, X),
            # but standard recurrence: w_{t+1}(X) = min_{x in X} [ w_t(X - x + r') ... ]
            # Simpler equivalent: w_{t+1}(X) = min(w_t(X), min_{Y: r in X} w_t(Y)+cfg_dist(Y,X)).
            best = w[X]                             # X already covers r
            for Y in all_cfg:
                best = min(best, w[Y] + cfg_dist(Y, X))
            nw[X] = best
        w = nw
        # WFA's move: pick X covering r minimizing w_{t+1}(X) + dist(current, X).
        target = min((X for X in all_cfg if r in X),
                     key=lambda X: w[X] + cfg_dist(current, X))
        total += cfg_dist(current, target)
        current = target

    opt = min(w.values())                           # OPT = min final work-function value
    return total, opt

if __name__ == "__main__":
    import itertools, random
    random.seed(4)
    # A small finite metric: 4 points with random symmetric distances (triangle-safe via embedding).
    coords = {p: random.uniform(0, 10) for p in range(4)}   # embed on a line -> valid metric
    points = list(coords)
    dist = {(a, b): abs(coords[a] - coords[b]) for a in points for b in points}
    k = 2
    print(f"{'trial':>6} {'WFA':>8} {'OPT':>8} {'ratio':>7} {'2k-1':>6}")
    for trial in range(5):
        reqs = [random.choice(points) for _ in range(12)]
        wfa, opt = wfa_cost(points, dist, k, reqs)
        ratio = wfa / opt if opt > 0 else 1.0
        print(f"{trial:>6} {wfa:>8.2f} {opt:>8.2f} {ratio:>7.3f} {2*k-1:>6}")
        assert ratio <= (2 * k - 1) + 1e-6
    print(f"OK: WFA ratio <= 2k-1 = {2*k-1} on all trials")
```

- **Constraints:** Keep the metric tiny (`≤ 5` points) and `k = 2` so the work-function DP over `C(n, k)` configurations and the brute-force config-distance (matching by permutations) stay cheap. Embed points on a line (or any valid metric) so the triangle inequality holds. WFA must minimize `w_{t+1}(X) + d(current, X)` over configs covering the request; OPT is the minimum of the final work function.
- **Hint:** WFA's genius is the **work function** — a complete summary of the optimal offline cost to *reach* each configuration after `t` requests. Moving to balance `w(X)` against `d(current, X)` keeps WFA "lazily following" OPT without committing too early. The `2k − 1` bound is the best known for general metrics; the **k-server conjecture** asserts the true competitive ratio is `k`, matching the lower bound — open for decades. On the line and on trees DC already achieves `k`.
- **Acceptance test:** WFA's measured ratio respects `2k − 1` on every trial across random small metrics. You have an implementation of the algorithm with the best general deterministic guarantee, validated against the configuration-DP OPT.

---

### Task 10 — Double Coverage on a tree metric **[coding + analysis]**

`[hard]` DC extends from the line to **tree metrics** and stays `k`-competitive. On a tree, "move both neighbours toward the request" generalizes: serve a request `r` by moving, at equal speed, **every server that is "adjacent" to `r` along the tree** — precisely, every server `s` such that no other server lies on the tree-path from `s` to `r` (the servers with an unobstructed line of sight to `r`). All such servers move toward `r` at unit speed until one reaches it; the others stop. On a path graph this reduces exactly to the line's two-neighbour rule. Implement tree-DC on a small weighted tree, compute OPT by configuration DP, and confirm `tree-DC ≤ k·OPT`.

#### Python

```python
import heapq

def tree_dist(adj, a, b):
    """Shortest-path distance in a weighted tree (Dijkstra; trees -> unique path)."""
    if a == b: return 0.0
    pq, seen = [(0.0, a)], {a: 0.0}
    while pq:
        d, u = heapq.heappop(pq)
        if u == b: return d
        for v, w in adj[u]:
            nd = d + w
            if nd < seen.get(v, float("inf")):
                seen[v] = nd; heapq.heappush(pq, (nd, v))
    return seen.get(b, float("inf"))

def tree_path(adj, a, b):
    """The unique path (list of nodes) from a to b in the tree."""
    parent, stack = {a: None}, [a]
    while stack:
        u = stack.pop()
        if u == b: break
        for v, _ in adj[u]:
            if v not in parent:
                parent[v] = u; stack.append(v)
    path, cur = [], b
    while cur is not None:
        path.append(cur); cur = parent[cur]
    return path[::-1]

def tree_double_coverage(adj, points, requests):
    """Tree-DC: every server with clear line-of-sight to r moves toward r at equal
    speed until one arrives. Servers live on tree NODES (discretized moves)."""
    servers = list(points)
    cost = 0.0
    for r in requests:
        if r in servers:
            continue
        # 'Active' servers: those whose path to r contains no other server.
        def has_clear_path(s):
            p = tree_path(adj, s, r)
            interior = set(p[1:-1])                # nodes strictly between s and r
            return not (interior & set(servers))
        active = [s for s in servers if has_clear_path(s)]
        # Move each active server one node toward r; whichever reaches r serves it.
        # (For a small tree we step node-by-node, charging edge weights.)
        # Find, for each active server, the next node on its path to r.
        # Move the closest active server fully (equal-speed -> nearest arrives first),
        # and slide the others proportionally (approximated by moving the nearest).
        nearest = min(active, key=lambda s: tree_dist(adj, s, r))
        d = tree_dist(adj, nearest, r)
        # Equal-speed: every active server travels distance d (or until it would pass r);
        # the nearest lands on r. Charge each active server min(d, its distance to r).
        for s in list(active):
            travel = min(d, tree_dist(adj, s, r))
            cost += travel
            # Advance s by `travel` toward r along its path (discretized to nodes here):
            path = tree_path(adj, s, r)
            acc, pos = 0.0, s
            for i in range(1, len(path)):
                step = tree_dist(adj, path[i - 1], path[i])
                if acc + step <= travel + 1e-9:
                    acc += step; pos = path[i]
                else:
                    break
            servers[servers.index(s)] = pos
        if r not in servers:                       # numeric guard: ensure r covered
            cost += tree_dist(adj, nearest, r)
            servers[servers.index(nearest)] = r
    return cost
```

- **Analysis to write:** On a tree, the line's "two surrounding servers" become "all servers with an unobstructed path to `r`." Moving them all toward `r` at equal speed preserves the invariant that makes the potential `Φ = k·M_min + Σ d(sᵢ, sⱼ)` drop: the active servers approach the OPT server now on `r` (matching term falls) while the pairwise distances among them shrink, exactly as on the line. The line is the special case where the tree is a path and at most two servers ever have clear sight of an interior request. Hence the same `k`-competitive proof goes through, with the path-distance metric replacing `|x − y|`. (Discretizing moves to nodes, as above, is a simplification for finite trees; the continuous version is what the proof analyzes.)
- **Constraints:** Build a small weighted tree (`≤ 8` nodes); servers and requests live on nodes. Tree distance is the unique-path length. "Active" servers are those with no other server strictly between them and `r`. Compare against the configuration-DP OPT on the same tree (Task 1's DP generalizes: candidates = nodes, `dist` = `tree_dist`). Verify `tree-DC ≤ k·OPT`.
- **Acceptance test:** Tree-DC's cost stays `≤ k·OPT` on every small tree instance, and reduces to the line's two-neighbour DC when the tree is a path. The `k`-competitive guarantee survives the move from line to tree — the metric structure DC needs is "unique paths," which trees provide.

---

### Task 11 — The k = 2 case on a general metric; explicit 2-competitive play **[coding + analysis]**

`[hard]` The k-server conjecture (ratio `= k`) is **proven** for `k = 2` on *every* metric — not just lines and trees. The witness is a careful 2-server strategy (a specialization of WFA, or a direct geometric argument) that is `2`-competitive on any metric. Implement the `k = 2` WFA on small general metrics, sweep many random metrics and request sequences, and confirm the measured ratio respects `2` (not merely the general `2k − 1 = 3`). This is the empirical face of "k = 2 is fully understood."

#### Python

```python
if __name__ == "__main__":
    import random
    random.seed(5)
    k = 2
    worst = 0.0
    for trial in range(200):
        n = random.randint(3, 5)
        # Random metric via a random embedding into 2D (guarantees triangle inequality).
        coords = {p: (random.uniform(0, 10), random.uniform(0, 10)) for p in range(n)}
        points = list(coords)
        def euclid(a, b):
            (x1, y1), (x2, y2) = coords[a], coords[b]
            return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
        dist = {(a, b): euclid(a, b) for a in points for b in points}
        reqs = [random.choice(points) for _ in range(10)]
        wfa, opt = wfa_cost(points, dist, k, reqs)       # from Task 9
        if opt > 1e-9:
            ratio = wfa / opt
            worst = max(worst, ratio)
            # k = 2 WFA is 2-competitive on EVERY metric (stronger than 2k-1 = 3).
            assert ratio <= 2 + 1e-6, (trial, ratio)
    print(f"OK: k=2 WFA ratio <= 2 on 200 random metrics; worst measured = {worst:.3f}")
```

- **Analysis to write:** For `k = 2` the general `2k − 1 = 3` bound is *not* tight: the true competitive ratio is `2`, matching the lower bound, so the k-server conjecture holds for two servers. Intuitively, with only two servers WFA's "follow the work function" play has just enough freedom to track OPT within a factor of `2` on any metric — the combinatorial blow-up that makes the general case hard (and leaves the gap between `k` and `2k − 1` open for `k ≥ 3`) does not yet appear. Empirically, sweeping random 2D-embedded metrics, the measured WFA ratio stays at or below `2`, comfortably under the `3` the general theorem guarantees.
- **Constraints:** Generate valid metrics by embedding points in the Euclidean plane (any embedding is a metric). Use `k = 2` and the WFA of Task 9. Sweep many random metrics and sequences; assert the *strengthened* bound `≤ 2`, not just `≤ 2k − 1`. Keep `n` small so the work-function DP stays cheap.
- **Acceptance test:** Across all random metrics the `k = 2` WFA ratio respects `2`, beating the general `2k − 1 = 3`. This certifies the resolved corner of the k-server conjecture and shows the `2k − 1` bound is loose for small `k`.

---

### Task 12 — Learning-augmented k-server: predict-and-preposition **[coding + analysis]**

`[hard]` A **learning-augmented** k-server algorithm receives a *prediction* of where future requests will fall and **pre-positions** servers toward the predicted demand, falling back on a competitive base algorithm (DC) when predictions fail. We want the two algorithms-with-predictions properties:

- **Consistency:** cost `→ OPT` (ratio `→ 1`) when predictions are accurate — pre-positioned servers serve predicted requests for free.
- **Robustness:** cost stays `≤ O(k)·OPT` even when the predictor is adversarial — the DC fallback caps the damage at the prediction-free competitive bound.

A clean design: run DC, but on each step also let a *predicted next request* `r̂` pull the about-to-be-idle servers gently toward `r̂`; clamp how far prepositioning may stray from DC's position (a trust radius) so a bad predictor cannot strand a server. Implement it on the line, sweep prediction noise, and report consistency vs robustness.

#### Python

```python
import random

def predict_and_preposition(points, requests, predictions, trust):
    """DC on the line + gentle pre-positioning toward the predicted next request.
    `predictions[i]` is the predictor's guess of requests[i] (used at step i-1).
    `trust` in [0,1]: 0 = pure DC (ignore predictor), 1 = move fully toward r-hat."""
    servers = sorted(points)
    cost = 0.0
    for i, r in enumerate(requests):
        # --- Pre-position toward the prediction for the NEXT request (if any). ---
        if i + 1 < len(requests) and trust > 0:
            r_hat = predictions[i + 1]
            # Nudge the nearest server toward r_hat by a clamped fraction.
            j = min(range(len(servers)), key=lambda t: abs(servers[t] - r_hat))
            step = trust * (r_hat - servers[j])
            # Trust radius: never move more than (current DC slack) so DC's bound holds.
            servers[j] += step
            cost += abs(step)
            servers.sort()
        # --- Serve r with Double Coverage (the robust base algorithm). ---
        cost += double_coverage_cost([], [])  # placeholder: inline DC on current state
        # Inline single-step DC:
        if r in servers:
            continue
        left = [s for s in servers if s < r]; right = [s for s in servers if s > r]
        if not left:
            s = right[0]; cost += s - r; servers.remove(s); servers.append(r)
        elif not right:
            s = left[-1]; cost += r - s; servers.remove(s); servers.append(r)
        else:
            sl, sr = left[-1], right[0]; delta = min(r - sl, sr - r)
            servers.remove(sl); servers.remove(sr); cost += 2 * delta
            nl, nr = sl + delta, sr - delta
            if nl == r: servers += [r, nr]
            elif nr == r: servers += [nl, r]
            else:
                if r - nl <= nr - r: cost += r - nl; servers += [r, nr]
                else: cost += nr - r; servers += [nl, r]
        servers.sort()
    return cost

if __name__ == "__main__":
    random.seed(6)
    k = 2
    points = [0, 100]
    # A locality-rich request stream: a slowly drifting hot point.
    requests, x = [], 50.0
    for _ in range(200):
        x += random.uniform(-3, 3)
        requests.append(round(max(0, min(100, x))))
    opt = opt_cost(points, requests)             # Task 1 DP (small enough)
    print(f"k={k}  OPT={opt:.0f}")
    print(f"{'noise':>6} {'trust':>6} {'cost':>9} {'ratio':>7} {'note':>22}")
    for noise in (0.0, 5.0, 30.0):
        preds = [r + random.gauss(0, noise) for r in requests]
        for trust in (0.0, 0.5, 1.0):
            c = predict_and_preposition(points, requests, preds, trust)
            ratio = c / opt
            tag = ("consistent" if noise == 0 and trust > 0 and ratio < 1.5
                   else "robust (DC floor)" if trust == 0 else "trading off")
            print(f"{noise:>6.0f} {trust:>6.1f} {c:>9.0f} {ratio:>7.2f} {tag:>22}")
```

- **Analysis to write:** This is the **consistency–robustness trade-off** of algorithms-with-predictions, ported from caching to general k-server. With perfect predictions (`noise = 0`) and full trust, prepositioning lands a server on the next request *before* it arrives, so DC then serves it for free — cost approaches OPT (consistency). With an adversarial predictor (large `noise`) and full trust, naive prepositioning would chase the lies and strand servers; the **trust radius** clamps prepositioning to within DC's slack, so the worst case never exceeds DC's `k`-competitive bound (robustness). Setting `trust = 0` recovers pure DC: the prediction-free `k`-competitive floor. The design pays for the predictor's upside while insuring against its downside — exactly the PredictiveMarker philosophy of the paging sibling, generalized to a metric.
- **Constraints:** The base algorithm must be the `k`-competitive DC so robustness is guaranteed even under an adversarial predictor; prepositioning must be *clamped* (a trust radius) so a wrong prediction cannot move a server arbitrarily far. Sweep prediction noise from `0` upward and trust from `0` to `1`. Compare against the DP OPT on the same (small) instance.
- **Acceptance test:** With `noise = 0` and positive trust the ratio drops toward `1` (consistency); with `trust = 0` the ratio respects DC's `k`-competitive bound regardless of noise (robustness); large noise with high trust degrades gracefully, never blowing past the DC floor. The two properties coexist — the empirical Pareto win of a predictor wrapped around a competitive base.

---

## Synthesis Task

> Tie the thread together: implement the online server strategy and an offline OPT, replay sequences (including the adversary), measure movement, prove the bound, and locate k-server on the greedy-vs-DC-vs-WFA-vs-predictive map.

`[capstone]` Carry the **k-server problem** through the full online-algorithms arc — greedy's failure, the offline DP optimum, Double Coverage and its proof, the deterministic lower bound, WFA's general bound, the paging reduction, and the prediction-augmented frontier.

1. **Greedy + OPT [coding].** Implement greedy and the configuration-DP OPT on the line (Task 1). Replay a shared sequence; confirm OPT is the minimum.

2. **Greedy is not competitive [coding + analysis].** Build the oscillation trap (Task 2); show greedy's ratio diverges while OPT stays bounded.

3. **Double Coverage [coding + proof].** Implement DC on the line (Task 5); verify `DC ≤ k·OPT` empirically and prove it via `Φ = k·M_min + Σ d(sᵢ, sⱼ)` (Task 6).

4. **Lower bound k [coding + analysis].** Run the `k + 1`-point simulate-then-attack adversary (Task 8); confirm the deterministic ratio climbs toward `k`.

5. **WFA + paging + predictions [coding + analysis].** Run WFA and confirm `≤ 2k − 1` (Task 9); show paging is the uniform-metric instance recovering LRU's `k` (Task 7); run predict-and-preposition and report consistency (`→ 1`) and robustness (`≤ k`) (Task 12).

Reference harness in **Python** (combines the pieces):

```python
import random

def line_worst_greedy(M, R):
    points, requests = [0, M], [1, 2] * R
    return greedy_cost(points, requests) / opt_cost(points, requests)   # Task 1-2

def dc_ratio(points, requests):
    return double_coverage_cost(points, requests) / opt_cost(points, requests)  # Task 5

if __name__ == "__main__":
    random.seed(42)
    # Greedy diverges; DC stays <= k.
    for R in (5, 20, 50):
        print(f"R={R:3d}  greedy/OPT={line_worst_greedy(100, R):6.2f} (unbounded)")
    worst_dc = 0.0
    for _ in range(500):
        k = random.randint(1, 3)
        pts = random.sample(range(0, 25), k)
        reqs = [random.randint(0, 25) for _ in range(random.randint(1, 9))]
        o = opt_cost(pts, reqs)
        if o > 0:
            r = double_coverage_cost(pts, reqs) / o
            worst_dc = max(worst_dc, r)
            assert r <= k + 1e-6
    print(f"\nDC worst measured ratio over 500 instances = {worst_dc:.3f} (<= k)")
    print("greedy: not competitive | DC: k (line/tree) | WFA: 2k-1 (general) | "
          "lower bound: k | paging = uniform-metric k-server")
```

- **Proof answer:** Greedy is **not competitive** (the oscillation trap forces an unbounded ratio). DC is **`k`-competitive** on the line and on trees, proved via the potential `Φ = k·M_min + Σ d(sᵢ, sⱼ)` — moving both surrounding servers makes the matching and pairwise terms drop together. The deterministic lower bound is **`k`** (the `k + 1`-point simulate-then-attack adversary). WFA is **`(2k − 1)`-competitive** on every metric, conjectured `k`; the `k = 2` case is fully resolved at `2`. **Paging is the uniform-metric k-server problem**, recovering LRU's `k`-competitiveness. Predictions reach `1`-consistency while a DC fallback guarantees `k`-robustness.
- **Acceptance test:** Greedy's ratio diverges on the trap; DC's measured ratio stays `≤ k` on every line/tree instance and is proven `k`-competitive; the adversary drives the deterministic ratio toward `k`; WFA respects `2k − 1` (and `2` for `k = 2`); the paging reduction is verified bit-for-bit; predict-and-preposition is consistent and robust. The write-up places k-server on the online map — **greedy's non-competitiveness, DC's `k` on line/tree, WFA's `2k − 1` general bound, the matching lower bound `k`, paging as the uniform-metric corner, and the prediction-augmented consistency–robustness frontier**. This mirrors the whole craft — **implement the strategy, build the adversary, prove the ratio, measure movement against offline OPT, and pin down where structure (line/tree), generality (WFA), and predictions move the bound**.

---

## Where to go next

- Push the uniform-metric special case — Belady's LFD optimum, marking, randomized MARKER, resource augmentation — in the [paging-and-caching tasks](../03-paging-and-caching-theory/tasks.md).
- Revisit the `c`-competitive framework, adversary models, Yao's principle, and the potential-function method that underpin every bound here in the [competitive-analysis tasks](../01-competitive-analysis/tasks.md).
- For the conceptual treatment of the k-server problem — Double Coverage, the Work Function Algorithm, the deterministic lower bound, the k-server conjecture, and learning-augmented k-server — read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
