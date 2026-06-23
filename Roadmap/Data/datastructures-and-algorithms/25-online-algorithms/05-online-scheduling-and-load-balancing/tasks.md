# Online Scheduling and Load Balancing — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, implement the online algorithm, implement an **offline OPT** (or a provable lower bound on OPT), replay the job sequence, **measure the makespan / #bins / max-load**, and **report the competitive ratio**.
> **[proof]** / **[analysis]** tasks need no code: prove a competitive bound (via a load/averaging argument, a two-consecutive-bins argument, or an exchange argument), with a clean, complete derivation. Model derivations are provided so you can grade yourself.

In **online scheduling** jobs arrive one at a time, each with a processing requirement, and must be **irrevocably** assigned to one of `m` machines the instant it arrives — no peeking at future jobs. The cost is the **makespan**: the load of the most-loaded machine, `max_i L_i` where `L_i = Σ {p_j : job j assigned to i}`. The offline optimum `OPT` sees the whole job set and minimizes makespan (an NP-hard problem, but two clean *lower bounds* on `OPT` make the analysis tractable). In **online load balancing** the same picture governs persistent load (requests routed to servers); in **online bin packing** items of size `p_j ∈ (0, 1]` arrive and must be placed into unit-capacity bins, minimizing the **number of bins** versus the offline optimum `OPT`.

The classical results you will implement and prove:

- **Graham's list scheduling** (greedy: put each job on the *least-loaded* machine) is exactly **`(2 − 1/m)`-competitive** for makespan on identical machines — and `2 − 1/m` is tight.
- **LPT** (Longest Processing Time first) is an *offline* `(4/3 − 1/(3m))`-approximation; sorting jobs largest-first before greedy assignment provably beats plain list scheduling's `2 − 1/m`.
- **Online bin packing:** **Next-Fit** is `2`-competitive (two consecutive bins are always more than half full); **First-Fit** is `1.7`-competitive (asymptotically `17/10·OPT + O(1)`); **First-Fit-Decreasing** (offline) is `11/9·OPT + 6/9`.
- **Unrelated / restricted machines:** greedy with an **exponential potential** `Σ_i a^{L_i}` is `O(log m)`-competitive — a logarithmic ratio is the price of heterogeneity, and it is tight.
- **Power of two choices:** balls-into-bins with `d = 2` random choices gives max load `(1 + o(1)) · ln ln n / ln 2 = Θ(log log n)`, versus `Θ(log n / log log n)` for a single random choice — an exponential improvement from one extra probe.
- **Speed augmentation:** **SRPT** for total flow time on a machine of speed `(1 + ε)` is `O(1/ε)`-competitive against `OPT` running at speed `1` — a *scalable* algorithm. A non-clairvoyant scheduler can be turned `O(1)`-competitive by a constant speedup.
- **Learning-augmented scheduling:** predicted job sizes let an online scheduler *order like LPT/SRPT*, staying **consistent** (→ OPT as predictions sharpen) and **robust** (never worse than the prediction-free bound) when predictions are adversarial.

The recurring discipline for every coding task is the same as for competitive analysis and paging: **implement the online algorithm, implement an offline OPT (or its provable lower bound), replay sequences (including adversarial ones), measure makespan / #bins / max-load, and report the ratio.** The acceptance test is always *"the measured competitive ratio respects the proven bound across every tested instance."* A scheduler whose ratio you cannot bound is just a heuristic; a bound you never replay against OPT is just a hope.

**Related practice:**
- [Competitive Analysis tasks](../01-competitive-analysis/tasks.md) — the `c`-competitive framework, adversary models, and Yao's principle that underpin every bound here.
- [Paging and Caching Theory tasks](../03-paging-and-caching-theory/tasks.md) — the `k`-competitive marking arguments and the simulate-then-attack adversary recipe reused below.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the models and quantities used throughout:
- **Makespan.** For an assignment of jobs to machines, `makespan = max_i L_i`. The two workhorse lower bounds on `OPT`: (1) `OPT ≥ avg = (Σ_j p_j) / m` (the average load — nobody can beat a perfectly balanced split), and (2) `OPT ≥ max_j p_j` (the largest single job must sit somewhere). Together: `OPT ≥ max(avg, max_j p_j)`.
- **Bin packing.** Items have size `p_j ∈ (0, 1]`; each bin holds total size `≤ 1`. `OPT` is the minimum number of bins. The clean lower bound: `OPT ≥ ⌈Σ_j p_j⌉` (the total size cannot be compressed below its ceiling).
- **Adversary / competitiveness.** A *deterministic* online algorithm faces an adversary who knows its code and constructs the worst job order; `ALG(σ) ≤ c · OPT(σ) + α` makes it `c`-competitive. For *randomized* placement (power-of-two-choices) we measure the *expected* max load against an oblivious adversary.
- **Speed augmentation / resource augmentation.** Give the online algorithm machines of speed `(1 + ε)` while `OPT` runs at speed `1`; a *scalable* algorithm is `O(f(ε))`-competitive for every `ε > 0`, escaping strong unaugmented lower bounds.

---

## Beginner Tasks

### Task 1 — Implement list scheduling + an offline OPT lower bound; measure the makespan ratio **[coding]**

`[easy]` Implement **Graham's list scheduling**: process jobs in arrival order, and assign each to the machine with the **smallest current load**. Implement the two-part **OPT lower bound** `OPT ≥ max(avg, max_j p_j)`, and (for small instances) a brute-force exact `OPT` so the measured ratio is honest. Replay several instances, print the makespan and the ratio `ALG / OPT`, and confirm the ratio never exceeds `2 − 1/m`.

#### Python

```python
import heapq, itertools

def list_scheduling(jobs, m):
    """Greedy: each job to the least-loaded machine. Returns (makespan, loads)."""
    heap = [(0.0, i) for i in range(m)]      # (load, machine id)
    heapq.heapify(heap)
    loads = [0.0] * m
    for p in jobs:
        load, i = heapq.heappop(heap)
        loads[i] += p
        heapq.heappush(heap, (loads[i], i))
    return max(loads), loads

def opt_lower_bound(jobs, m):
    """The two provable lower bounds on OPT; OPT is at least their max."""
    if not jobs:
        return 0.0
    return max(sum(jobs) / m, max(jobs))

def opt_exact(jobs, m):
    """Brute force exact makespan-minimizing assignment. Tiny instances only."""
    best = float("inf")
    for assign in itertools.product(range(m), repeat=len(jobs)):
        loads = [0.0] * m
        for job, mach in zip(jobs, assign):
            loads[mach] += job
        best = min(best, max(loads))
    return best

if __name__ == "__main__":
    instances = [
        ([3, 1, 1, 2, 1, 4], 3),
        ([5, 5, 4, 4, 3, 3, 2, 2], 4),
        ([7, 6, 5, 4, 3, 2, 1], 3),
    ]
    for jobs, m in instances:
        alg, _ = list_scheduling(jobs, m)
        lb = opt_lower_bound(jobs, m)
        opt = opt_exact(jobs, m)
        bound = 2 - 1.0 / m
        print(f"m={m} jobs={jobs}")
        print(f"   ALG makespan={alg:.1f}  OPT={opt:.1f}  LB={lb:.1f}  "
              f"ALG/OPT={alg/opt:.3f}  bound 2-1/m={bound:.3f}")
        assert alg <= bound * opt + 1e-9, "list scheduling must respect 2-1/m"
        assert opt >= lb - 1e-9, "exact OPT must dominate the lower bound"
    print("OK: list scheduling within (2-1/m)*OPT on every instance")
```

#### Go (core)

```go
func listScheduling(jobs []float64, m int) (float64, []float64) {
	loads := make([]float64, m)
	for _, p := range jobs {
		lo := 0
		for i := 1; i < m; i++ {
			if loads[i] < loads[lo] {
				lo = i
			}
		}
		loads[lo] += p
	}
	mk := 0.0
	for _, l := range loads {
		if l > mk {
			mk = l
		}
	}
	return mk, loads
}
```

- **Constraints:** Jobs are positive reals (or ints); `m ≥ 1`. The exact `OPT` brute force is `O(m^n)` — keep it to `n ≤ 12`, `m ≤ 4`. The lower bound `max(avg, max_j p_j)` is `O(n)` and works at any scale; use it for large instances where brute force is infeasible.
- **Hint:** Greedy assigns to the least-loaded machine because that postpones raising the makespan as long as possible. The two lower bounds capture two unavoidable costs: the *total work* must be spread over `m` machines (`avg`), and the *biggest job* cannot be split (`max_j p_j`). Every makespan proof below charges against one or both.
- **Acceptance test:** On every instance, `ALG ≤ (2 − 1/m)·OPT`; the exact `OPT` always dominates the lower bound `max(avg, max_j p_j)`. The ratio prints cleanly and never violates the proven bound.

---

### Task 2 — Construct the worst-case instance that forces list scheduling to `2 − 1/m` **[coding + analysis]**

`[easy]` The `2 − 1/m` bound is **tight**: there is a specific job sequence on which list scheduling's makespan is exactly `(2 − 1/m)·OPT`. Feed `m·(m − 1)` unit jobs followed by **one** job of size `m`. Greedy spreads the small jobs evenly to load `m − 1` on each machine, then the big job lands on top of one of them for makespan `2m − 1`. OPT puts the big job alone and the small jobs on the other `m − 1` machines, makespan `m`. Ratio `(2m − 1)/m = 2 − 1/m`.

Build this instance, replay list scheduling, and show the ratio hits `2 − 1/m` exactly.

#### Python

```python
def graham_worst_case(m):
    """m(m-1) unit jobs, then one job of size m. Forces ALG/OPT = 2 - 1/m."""
    return [1.0] * (m * (m - 1)) + [float(m)]

if __name__ == "__main__":
    for m in (2, 3, 5, 8, 16):
        jobs = graham_worst_case(m)
        alg, loads = list_scheduling(jobs, m)        # from Task 1
        opt = float(m)                                # big job alone; rest fill m-1 machines
        bound = 2 - 1.0 / m
        print(f"m={m:2d}  ALG makespan={alg:.0f}  OPT={opt:.0f}  "
              f"ratio={alg/opt:.4f}  2-1/m={bound:.4f}")
        assert abs(alg / opt - bound) < 1e-9, "worst case must attain 2-1/m exactly"
    print("OK: the (2-1/m) bound is tight, attained on Graham's instance")
```

- **Analysis to write:** Before the big job, `m·(m − 1)` unit jobs are spread one-per-machine round-robin, so each machine reaches load exactly `m − 1`. The final job of size `m` is placed on the least-loaded machine (all are tied at `m − 1`), pushing it to `m − 1 + m = 2m − 1`. So `ALG = 2m − 1`. OPT instead dedicates one machine entirely to the size-`m` job (load `m`) and distributes the `m·(m − 1)` unit jobs across the remaining `m − 1` machines — `m` units each, load `m`. So `OPT = m`, and `ALG/OPT = (2m − 1)/m = 2 − 1/m`. The slack between greedy and OPT is exactly the `m − 1` of pre-loaded small work sitting under the big job; that is the worst the adversary can engineer.
- **Constraints:** Use exactly `m·(m − 1)` unit jobs followed by a single job of size `m`, *in that order* — the big job must arrive **last** so greedy has no chance to isolate it. Reversing the order (big job first) lets greedy approach OPT.
- **Acceptance test:** For every `m`, the measured ratio equals `2 − 1/m` to floating-point precision, attained exactly. This witnesses tightness: no analysis of list scheduling can promise better than `2 − 1/m`.

---

### Task 3 — Implement LPT and compare against plain list scheduling **[coding]**

`[easy]` **LPT** (Longest Processing Time first) sorts jobs **largest-first**, then runs the same greedy least-loaded assignment. Sorting tames the worst case: LPT's makespan is `≤ (4/3 − 1/(3m))·OPT`, strictly better than plain list scheduling's `2 − 1/m`. Intuitively, scheduling big jobs early leaves only small jobs to "round off" the imbalance at the end.

Implement LPT, replay it next to plain list scheduling on the same instances (including Graham's worst case from Task 2), and show LPT's ratio respects `4/3 − 1/(3m)` while plain greedy can hit `2 − 1/m`.

#### Python

```python
def lpt_scheduling(jobs, m):
    """Sort largest-first, then greedy least-loaded. Returns (makespan, loads)."""
    return list_scheduling(sorted(jobs, reverse=True), m)   # from Task 1

if __name__ == "__main__":
    import random
    random.seed(1)
    print(f"{'m':>3} {'instance':>22} {'greedy':>7} {'LPT':>6} "
          f"{'g/OPT':>7} {'LPT/OPT':>8} {'4/3-1/3m':>9}")
    cases = []
    for m in (3, 4, 5):
        cases.append((graham_worst_case(m), m))                 # adversarial
        cases.append(([random.randint(1, 20) for _ in range(12)], m))  # random
    for jobs, m in cases:
        g, _ = list_scheduling(jobs, m)
        l, _ = lpt_scheduling(jobs, m)
        opt = opt_exact(jobs, m) if len(jobs) <= 12 and m <= 5 else opt_lower_bound(jobs, m)
        lpt_bound = 4 / 3 - 1 / (3 * m)
        tag = "graham" if jobs == graham_worst_case(m) else "random"
        print(f"{m:>3} {tag:>22} {g:>7.1f} {l:>6.1f} "
              f"{g/opt:>7.3f} {l/opt:>8.3f} {lpt_bound:>9.3f}")
        assert l <= lpt_bound * opt + 1e-9, "LPT must respect 4/3 - 1/(3m)"
    print("\nOK: LPT respects 4/3 - 1/(3m); greedy can reach 2 - 1/m on adversarial input")
```

- **Constraints:** LPT is an **offline** improvement — it requires sorting, which needs the full job set up front, so it is *not* a pure online algorithm. Compare against the same `OPT` (exact for small instances, lower bound for larger). On Graham's worst case LPT collapses the ratio dramatically because the big job is scheduled *first* and isolated.
- **Hint:** The LPT bound is tight at `4/3 − 1/(3m)`: the classic tight instance is `2m + 1` jobs with sizes that LPT packs into makespan `4/3 − 1/(3m)` times OPT (e.g. for `m = 2`, jobs `3,3,2,2,2` give LPT makespan `7` vs OPT `6`, ratio `7/6 = 4/3 − 1/6`). The key lemma: the job that *defines* LPT's makespan is the last one placed on its machine, and being last-and-smallest it has size `≤ OPT/3` when there are `> m` jobs.
- **Acceptance test:** LPT's measured ratio is `≤ 4/3 − 1/(3m)` on every instance, and is markedly below plain greedy's ratio on Graham's worst case. Sorting largest-first provably buys the `2 − 1/m → 4/3 − 1/(3m)` improvement.

---

### Task 4 — Online bin packing: Next-Fit and First-Fit, count bins vs OPT **[coding]**

`[easy]` In **online bin packing**, items of size `p_j ∈ (0, 1]` arrive one at a time and must be placed into unit-capacity bins immediately. Two greedy policies:

- **Next-Fit:** keep only the *current* open bin; if the item fits, place it there, else close it and open a fresh bin. (`2`-competitive.)
- **First-Fit:** scan all open bins in order and place the item in the *first* one it fits; open a new bin only if none fits. (`1.7`-competitive asymptotically.)

Implement both, implement the **OPT lower bound** `OPT ≥ ⌈Σ p_j⌉`, count bins, and report the ratio `#bins / OPT`. Confirm Next-Fit ≤ `2·OPT` and First-Fit ≤ `1.7·OPT + 1` on every tested stream.

#### Python

```python
import math, random

def next_fit(items):
    """Only the current bin is open. Returns the number of bins used."""
    bins, cur = 1, 0.0
    for p in items:
        if cur + p <= 1.0 + 1e-12:
            cur += p
        else:
            bins += 1
            cur = p
    return bins

def first_fit(items):
    """Place in the first bin that fits; else open a new bin."""
    bins = []                       # remaining capacity of each open bin
    for p in items:
        placed = False
        for i in range(len(bins)):
            if bins[i] + 1e-12 >= p:
                bins[i] -= p
                placed = True
                break
        if not placed:
            bins.append(1.0 - p)
    return len(bins)

def opt_lower_bound_bins(items):
    return math.ceil(sum(items) - 1e-9)

if __name__ == "__main__":
    random.seed(2)
    print(f"{'stream':>14} {'NF':>4} {'FF':>4} {'OPT≥':>5} "
          f"{'NF/OPT':>7} {'FF/OPT':>7}")
    streams = {
        "uniform":    [random.uniform(0.05, 0.95) for _ in range(500)],
        "small":      [random.uniform(0.01, 0.20) for _ in range(500)],
        "large":      [random.uniform(0.55, 0.95) for _ in range(300)],
        "half+eps":   [0.5 + 0.01] * 200,            # NF worst case: 1 item per bin pair
    }
    for name, items in streams.items():
        nf, ff = next_fit(items), first_fit(items)
        opt = max(1, opt_lower_bound_bins(items))
        print(f"{name:>14} {nf:>4} {ff:>4} {opt:>5} "
              f"{nf/opt:>7.3f} {ff/opt:>7.3f}")
        assert nf <= 2 * opt + 1,   "Next-Fit must be within 2*OPT (+O(1))"
        assert ff <= 1.7 * opt + 2, "First-Fit must be within 1.7*OPT (+O(1))"
    print("\nOK: Next-Fit <= 2*OPT, First-Fit <= 1.7*OPT (asymptotically)")
```

- **Constraints:** Item sizes are in `(0, 1]`. `OPT ≥ ⌈Σ p_j⌉` is a *lower* bound, so the printed `OPT/` ratio is conservative (true OPT is `≥` this, hence the true competitive ratio is `≤` what you print — a valid upper-bound check). Use floating tolerances (`1e-12`) so items of size exactly `0.5` pair cleanly.
- **Hint:** Next-Fit's weakness: a stream of `0.51`-sized items puts **one item per bin** (two never fit together, and Next-Fit never revisits a closed bin), so it uses `n` bins where OPT also uses `n` — but the `half+eps` adversary of items just over `0.5` is what makes the *two-consecutive-bins* argument tight (Task 6). First-Fit revisits earlier bins, so it backfills and stays near `1.7·OPT`.
- **Acceptance test:** Next-Fit uses `≤ 2·OPT + O(1)` bins and First-Fit `≤ 1.7·OPT + O(1)` on every stream; First-Fit is consistently tighter than Next-Fit on streams with mixed sizes (it backfills). The lower bound `⌈Σ p_j⌉` is respected by both.

---

## Intermediate Tasks

### Task 5 — Prove list scheduling is `(2 − 1/m)`-competitive and tight **[proof]**

`[medium]` Write a complete proof that Graham's list scheduling has makespan `≤ (2 − 1/m)·OPT` on `m` identical machines, then prove the bound is tight (Task 2's instance attains it).

> **No code.** Use this as the grading model.

**Model proof — upper bound (`2 − 1/m`).**

Let the algorithm's makespan be achieved on machine `i*`, and let job `j*` be the **last** job assigned to `i*`. When `j*` was assigned, greedy chose `i*` because it was the **least-loaded** machine at that moment. So the load of `i*` *just before* `j*` arrived — call it `L` — was the minimum load over all machines at that time. Since `L` was the minimum, every machine had load `≥ L`, so the total work already placed was `≥ m·L`, hence

```
L ≤ (total work placed before j*) / m ≤ (Σ_{j≠j*} p_j) / m.
```

The final makespan is `ALG = L + p_{j*}`. Now use the two lower bounds on OPT:

- `OPT ≥ (Σ_j p_j)/m` (average load), so `(Σ_{j≠j*} p_j)/m = (Σ_j p_j − p_{j*})/m ≤ OPT − p_{j*}/m`.
- `OPT ≥ p_{j*}` (the job `j*` sits somewhere in OPT too).

Combine:

```
ALG = L + p_{j*}
    ≤ (Σ_{j≠j*} p_j)/m + p_{j*}
    ≤ (OPT − p_{j*}/m) + p_{j*}
    = OPT + p_{j*}·(1 − 1/m)
    ≤ OPT + OPT·(1 − 1/m)
    = (2 − 1/m)·OPT.
```

Therefore list scheduling is `(2 − 1/m)`-competitive. ∎

**Model proof — tightness.**

Take `m·(m − 1)` jobs of size `1` followed by one job of size `m` (Task 2). Greedy spreads the unit jobs evenly to load `m − 1` per machine, then the size-`m` job lands on a machine at load `m − 1`, giving `ALG = 2m − 1`. OPT dedicates one machine to the big job and spreads the units over the other `m − 1` machines (`m` units each), giving `OPT = m`. So `ALG/OPT = (2m − 1)/m = 2 − 1/m`. The upper bound is attained, hence tight. ∎

- **Constraints:** The upper bound hinges on three facts: (1) the makespan machine's pre-load `L` is the *minimum* at the moment its last job arrived, so `L ≤ avg over all work except j*`; (2) `OPT ≥ avg`; (3) `OPT ≥ p_{j*}`. Make the substitution `p_{j*}(1 − 1/m) ≤ OPT(1 − 1/m)` explicit. For tightness, exhibit Graham's instance and compute both makespans.
- **Acceptance test:** The proof isolates the last job on the makespan machine, bounds its pre-load by the average, applies both OPT lower bounds to reach `(2 − 1/m)·OPT`, and exhibits the `m(m−1)`-units-plus-one-big-job instance attaining the bound exactly.

---

### Task 6 — Prove Next-Fit is `2`-competitive for bin packing **[proof]**

`[medium]` Prove that online Next-Fit uses at most `2·OPT` bins (precisely, `NF ≤ 2·⌈Σ p_j⌉ ≤ 2·OPT`), using the **two-consecutive-bins** argument.

> **No code.** Model derivation follows.

**Model derivation.**

Number the bins Next-Fit opens `B_1, B_2, …, B_k` in the order it opens them. Let `s(B_i)` be the total size of items placed in `B_i`. The defining property of Next-Fit: it opens `B_{i+1}` only because the item that started `B_{i+1}` did **not fit** in `B_i`. So at the moment `B_{i+1}` opened, that item had size `> 1 − s(B_i)` (the free space in `B_i`). Hence

```
s(B_i) + s(B_{i+1}) > 1     for every consecutive pair i = 1, …, k − 1.
```

*Any two consecutive bins together hold more than one unit of work.* Sum this over the `⌊k/2⌋` disjoint consecutive pairs `(B_1, B_2), (B_3, B_4), …`:

```
Σ_{j} p_j = Σ_{i=1}^{k} s(B_i) > ⌊k/2⌋ · 1.
```

So `⌊k/2⌋ < Σ_j p_j`, which gives `k < 2·Σ_j p_j + 1`, i.e. `k ≤ 2·⌈Σ_j p_j⌉ − 1 < 2·OPT + 1`. Since `OPT ≥ ⌈Σ_j p_j⌉` (the total size cannot fit in fewer than its ceiling of bins),

```
NF = k ≤ 2·OPT.
```

Therefore Next-Fit is `2`-competitive. ∎

**Tightness sketch.** The bound `2` is essentially tight: feed `2n` items alternating sizes `1/2` and `ε` (with `ε` tiny): `1/2, ε, 1/2, ε, …`. Next-Fit places each `1/2` with the following `ε` and then must open a new bin for the next `1/2` (it cannot fit `1/2 + 1/2 + ε`), using `≈ n` bins; OPT pairs the `n` halves into `n/2` bins (plus a negligible bin for the `ε`'s), so `NF/OPT → 2`.

- **Constraints:** The crux is the per-pair inequality `s(B_i) + s(B_{i+1}) > 1`, justified by *why* Next-Fit opened the next bin (the starting item did not fit in the previous bin). Sum over disjoint consecutive pairs, relate to `Σ p_j`, and close with `OPT ≥ ⌈Σ p_j⌉`. The tightness instance with alternating `1/2` and `ε` items earns full marks.
- **Acceptance test:** The proof establishes `s(B_i) + s(B_{i+1}) > 1`, sums to `k ≤ 2·⌈Σ p_j⌉`, and concludes `NF ≤ 2·OPT`; the alternating-`1/2`-`ε` instance shows the constant `2` cannot be improved for Next-Fit.

---

### Task 7 — Power of two choices: max load `Θ(log log n)` vs `Θ(log n / log log n)` **[coding]**

`[medium]` Throw `n` balls into `n` bins. With **one** random choice per ball, the max load is `Θ(log n / log log n)` w.h.p. With the **power of two choices** — sample `d = 2` bins uniformly at random and place the ball in the *less loaded* of the two — the max load drops to `ln ln n / ln d + Θ(1) = Θ(log log n)`. One extra probe yields an *exponential* improvement in the maximum load.

Implement both balancers, sweep `n` over several orders of magnitude, tabulate the empirical max load, and confirm the `d = 2` curve grows like `log log n` while `d = 1` grows like `log n / log log n`.

#### Python

```python
import random, math

def one_choice_maxload(n, rng):
    bins = [0] * n
    for _ in range(n):
        bins[rng.randrange(n)] += 1
    return max(bins)

def two_choice_maxload(n, d, rng):
    """Place each ball into the least loaded of d random bins (d=2 = power of two)."""
    bins = [0] * n
    for _ in range(n):
        choices = [rng.randrange(n) for _ in range(d)]
        target = min(choices, key=lambda i: bins[i])
        bins[target] += 1
    return max(bins)

if __name__ == "__main__":
    print(f"{'n':>9} {'d=1':>5} {'logn/loglogn':>13} "
          f"{'d=2':>5} {'loglogn/ln2':>12} {'d=4':>5}")
    for n in (1_000, 10_000, 100_000, 1_000_000):
        trials = 7
        one = sum(one_choice_maxload(n, random.Random(s)) for s in range(trials)) / trials
        two = sum(two_choice_maxload(n, 2, random.Random(100 + s)) for s in range(trials)) / trials
        four = sum(two_choice_maxload(n, 4, random.Random(200 + s)) for s in range(trials)) / trials
        pred1 = math.log(n) / math.log(math.log(n))           # Theta(log n / log log n)
        pred2 = math.log(math.log(n)) / math.log(2)            # ln ln n / ln 2
        print(f"{n:>9} {one:>5.1f} {pred1:>13.2f} "
              f"{two:>5.1f} {pred2:>12.2f} {four:>5.1f}")
        assert two <= one + 1e-9, "two choices never worse than one"
    print("\nOK: d=2 max load tracks loglog n; d=1 tracks log n / log log n; "
          "d=4 barely improves on d=2 (diminishing returns)")
```

- **Constraints:** Use `n` up to `10^6` (the `d = 1` vs `d = 2` gap only becomes visually obvious at scale). Average over several seeds — single runs are noisy. The `d = 4` column shows *diminishing returns*: going from `d = 1` to `d = 2` is the exponential jump; `d = 2` to `d = 4` only divides the `log log n` term by `log d`, a small constant gain.
- **Hint:** The asymmetry is the whole story: with one choice, the max load is governed by the *tail* of the Poisson(`1`) distribution, giving `log n / log log n`. With two choices, a ball avoids the more-loaded bin, so a bin reaches load `i + 1` only if **both** its probes already had load `≥ i` — the probability of a height-`i` bin shrinks *doubly exponentially* in `i`, collapsing the max to `log log n`. This is **Azar–Broder–Karlin–Upfal**; it is the theory behind randomized load balancers (`d`-choices hashing, JSQ(2) request routing).
- **Acceptance test:** The `d = 2` empirical max load grows like `ln ln n / ln 2` (it roughly doubles as `n` is squared, then flattens), while `d = 1` grows faster like `log n / log log n`; `d = 2` is never worse than `d = 1`, and `d = 4` improves only marginally on `d = 2`. The exponential separation from one extra probe is reproduced.

---

### Task 8 — LPT `4/3 − 1/(3m)` analysis: build the tight instance and verify the lemma **[coding + analysis]**

`[medium]` LPT's approximation guarantee is `4/3 − 1/(3m)`, and it is tight. Build the canonical tight instance and verify the **key lemma** empirically: the job that determines LPT's makespan, being the *last* placed on the busiest machine, has size `≤ OPT/3` whenever there are more than `m` jobs.

#### Python

```python
def lpt_tight_instance(m):
    """2m+1 jobs forcing LPT to 4/3 - 1/(3m) of OPT.
    Sizes: 2m-1, 2m-1, 2m-2, 2m-2, ..., m+1, m+1, m, m, m.
    OPT packs perfectly into makespan 3m; LPT wastes by the 'three m-jobs' tail."""
    jobs = []
    for v in range(2 * m - 1, m, -1):
        jobs += [v, v]
    jobs += [m, m, m]
    return jobs

def critical_job_size(jobs, m):
    """Run LPT; return (makespan, size of the last job on the makespan machine)."""
    order = sorted(jobs, reverse=True)
    loads = [0.0] * m
    last_on = [0.0] * m            # size of the most recent job placed on machine i
    for p in order:
        i = min(range(m), key=lambda x: loads[x])
        loads[i] += p
        last_on[i] = p
    mk = max(loads)
    busiest = max(range(m), key=lambda x: loads[x])
    return mk, last_on[busiest]

if __name__ == "__main__":
    for m in (2, 3, 4, 5):
        jobs = lpt_tight_instance(m)
        l, _ = lpt_scheduling(jobs, m)                 # from Task 3
        opt = opt_exact(jobs, m) if len(jobs) <= 12 and m <= 4 else opt_lower_bound(jobs, m)
        mk, crit = critical_job_size(jobs, m)
        bound = 4 / 3 - 1 / (3 * m)
        print(f"m={m}  LPT={l:.1f}  OPT={opt:.1f}  ratio={l/opt:.3f}  "
              f"bound={bound:.3f}  critical_job={crit:.1f}  OPT/3={opt/3:.2f}")
        assert l <= bound * opt + 1e-9
        # Lemma: when there are > m jobs, the critical job has size <= OPT/3.
        if len(jobs) > m:
            assert crit <= opt / 3 + 1e-9, "critical job must be <= OPT/3"
    print("\nOK: LPT ratio respects 4/3 - 1/(3m); critical job <= OPT/3 (the lemma)")
```

- **Analysis to write:** Sketch why LPT achieves `4/3 − 1/(3m)`. Let `j*` be the last job on LPT's makespan machine, with pre-load `L` and makespan `ALG = L + p_{j*}`. As in Task 5, `L ≤ OPT − p_{j*}/m`. The new ingredient: because jobs are sorted *descending*, if `j*` is *not* the only job on its machine (which holds when `n > m`, by pigeonhole the busiest machine has `≥ 2` jobs), then `j*` is the smallest of `≥ m + 1` jobs all `≥ p_{j*}`, so OPT must place two of them on some machine, forcing `OPT ≥ 3·p_{j*}`, i.e. `p_{j*} ≤ OPT/3`. Substituting: `ALG ≤ OPT − p_{j*}/m + p_{j*} = OPT + p_{j*}(1 − 1/m) ≤ OPT + (OPT/3)(1 − 1/m) = (4/3 − 1/(3m))·OPT`. If instead `j*` is alone on its machine, `ALG = p_{j*} ≤ OPT` trivially. The lemma `p_{j*} ≤ OPT/3` is exactly what the code verifies.
- **Constraints:** The tight instance has `2m + 1` jobs (so `n > m`, activating the lemma). Verify both the ratio bound *and* the lemma `critical_job ≤ OPT/3`. For `m ≤ 4` use exact OPT; the instance is designed so OPT achieves a perfectly balanced makespan.
- **Acceptance test:** LPT's ratio is `≤ 4/3 − 1/(3m)` on the tight instance (and equals it in the limit), and the critical job's size is `≤ OPT/3` whenever `n > m`. The empirical lemma matches the analytic step that upgrades `2 − 1/m` to `4/3 − 1/(3m)`.

---

## Advanced Tasks

### Task 9 — Greedy on unrelated/restricted machines: observe `O(log m)`-competitiveness **[coding]**

`[hard]` On **unrelated machines** each job `j` has a *vector* of loads `(p_{1j}, …, p_{mj})` — its cost depends on which machine runs it (and may be `∞` if forbidden). Plain least-loaded greedy can be as bad as `Θ(m)`-competitive here. The fix is the **exponential potential** assignment of Aspnes–Azar–Fiat–Plotkin–Waarts: assign each job to the machine minimizing the *marginal increase in* `Σ_i a^{L_i}` for a constant `a > 1` (equivalently, the machine `i` minimizing `a^{L_i + p_{ij}} − a^{L_i}`). This greedy-on-the-potential is `O(log m)`-competitive — logarithmic is the price of heterogeneity, and it is tight.

Implement the exponential-potential greedy and a baseline (least-loaded among *feasible* machines), replay restricted-assignment instances, and show the potential method's makespan ratio tracks `O(log m)` while naive greedy can blow up toward `Θ(m)`.

#### Python

```python
import random, math

def exp_potential_greedy(jobs, m, a=2.0):
    """jobs[j] = list of m loads (inf = forbidden). Assign to minimize a^L increase."""
    loads = [0.0] * m
    for costs in jobs:
        best_i, best_delta = None, float("inf")
        for i in range(m):
            if costs[i] == float("inf"):
                continue
            delta = a ** (loads[i] + costs[i]) - a ** loads[i]
            if delta < best_delta:
                best_delta, best_i = delta, i
        loads[best_i] += costs[best_i]
    return max(loads)

def naive_greedy(jobs, m):
    """Least-loaded among feasible machines (load = post-assignment load)."""
    loads = [0.0] * m
    for costs in jobs:
        feas = [i for i in range(m) if costs[i] != float("inf")]
        best_i = min(feas, key=lambda i: loads[i] + costs[i])
        loads[best_i] += costs[best_i]
    return max(loads)

def restricted_instance(m, n, rng):
    """Restricted assignment: each job has size s on a random eligible subset, inf elsewhere."""
    jobs = []
    for _ in range(n):
        s = rng.uniform(1.0, 4.0)
        eligible = set(rng.sample(range(m), rng.randint(1, max(1, m // 2))))
        jobs.append([s if i in eligible else float("inf") for i in range(m)])
    return jobs

if __name__ == "__main__":
    print(f"{'m':>3} {'exp-pot':>8} {'naive':>7} {'OPT≥':>6} "
          f"{'exp/LB':>7} {'naive/LB':>9} {'log2(m)':>8}")
    for m in (4, 8, 16, 32):
        rng = random.Random(m)
        jobs = restricted_instance(m, 6 * m, rng)
        # Lower bound on OPT: average over feasible total + max single job.
        total = sum(min(c for c in costs if c != float("inf")) for costs in jobs)
        max_job = max(min(c for c in costs if c != float("inf")) for costs in jobs)
        lb = max(total / m, max_job)
        ep = exp_potential_greedy(jobs, m, a=1.0 + 1.0 / math.log(max(2, m)))
        nv = naive_greedy(jobs, m)
        print(f"{m:>3} {ep:>8.2f} {nv:>7.2f} {lb:>6.2f} "
              f"{ep/lb:>7.2f} {nv/lb:>9.2f} {math.log2(m):>8.2f}")
        assert ep <= (2 + 4 * math.log2(m)) * lb + 1e-6, "exp-potential must be O(log m)"
    print("\nOK: exponential-potential greedy tracks O(log m); naive can drift higher")
```

- **Constraints:** Loads are per-(machine, job); `∞` marks a forbidden machine (restricted assignment is the cleanest special case of unrelated machines). The base `a` should be set to `1 + 1/Θ(log m)` so that `a^{O(log m)}` stays a constant — that tuning is what produces the `O(log m)` ratio. The `OPT` here is a *lower bound* (feasible-average plus max single job); the printed ratio is therefore an over-estimate of the true competitive ratio, so respecting `O(log m)` against it is a valid check.
- **Hint:** The potential `Φ = Σ_i a^{L_i}` is a smooth surrogate for the makespan `max_i L_i` (since `a^{max L_i} ≤ Φ ≤ m·a^{max L_i}`, the makespan is within `log_a m` of `log_a Φ`). Greedily minimizing `ΔΦ` keeps `Φ` close to its optimal trajectory; unwinding the `log_a m` slack yields the `O(log m)` ratio. This is the canonical online routing / virtual-circuit result, and the same potential drives **online set cover** and **online network design**.
- **Acceptance test:** The exponential-potential greedy's makespan ratio against the OPT lower bound stays within `O(log m)` (concretely `≤ 2 + 4·log₂ m` on these instances) for every `m`, while naive least-loaded greedy can drift higher on adversarially restricted instances. Logarithmic competitiveness is the achievable price of machine heterogeneity.

---

### Task 10 — Speed augmentation: SRPT for flow time at speed `(1 + ε)` vs OPT at speed `1` **[coding]**

`[hard]` Minimizing **total flow time** (`Σ (completion − release)` over all jobs) online has a strong unaugmented lower bound: every online algorithm is `Ω(n^{1/3})`-competitive (with release times, on one machine, for arbitrary sizes). **Speed augmentation** escapes it: run **SRPT** (Shortest Remaining Processing Time — always serve the job with least remaining work) on a machine of speed `(1 + ε)` and compare against OPT at speed `1`. SRPT is then `O(1/ε)`-competitive — a **scalable** algorithm: constant-competitive for any constant speedup.

Implement a discrete-time SRPT-with-speedup simulator and a (speed-`1`) clairvoyant SRPT as the OPT proxy (SRPT is optimal for total flow time *without* release-time complications on a single machine), and show that boosting SRPT's speed to `(1 + ε)` makes its flow time `O(1/ε)·OPT` — collapsing toward `OPT` as `ε` grows.

#### Python

```python
import heapq, random

def srpt_flow_time(jobs, speed=1.0, dt=0.01):
    """jobs = list of (release_time, size). Preemptive SRPT on a machine of given speed.
    Returns total flow time = sum of (completion - release)."""
    jobs = sorted(enumerate(jobs), key=lambda x: x[1][0])   # by release time
    n = len(jobs)
    remaining = {}                  # job id -> remaining work
    release_at = {jid: r for jid, (r, s) in jobs}
    size = {jid: s for jid, (r, s) in jobs}
    completion = {}
    t, idx = 0.0, 0
    pending = []                    # min-heap (remaining, jid)
    done = 0
    horizon = max(r for r, s in (j[1] for j in jobs)) + sum(s for r, s in (j[1] for j in jobs)) / speed + 1
    while done < n and t < horizon + 1:
        while idx < n and release_at[jobs[idx][0]] <= t + 1e-9:
            jid = jobs[idx][0]
            remaining[jid] = size[jid]
            heapq.heappush(pending, (remaining[jid], jid))
            idx += 1
        # Clean stale heap entries.
        while pending and (pending[0][1] in completion or
                           abs(pending[0][0] - remaining.get(pending[0][1], -1)) > 1e-9):
            heapq.heappop(pending)
        if pending:
            rem, jid = pending[0]
            work = speed * dt
            remaining[jid] -= work
            if remaining[jid] <= 1e-9:
                completion[jid] = t + dt
                heapq.heappop(pending)
                done += 1
            else:
                heapq.heapreplace(pending, (remaining[jid], jid))
        t += dt
    return sum(completion[jid] - release_at[jid] for jid in completion)

if __name__ == "__main__":
    random.seed(3)
    jobs = []
    for _ in range(60):
        jobs.append((random.uniform(0, 30), random.uniform(0.2, 3.0)))
    opt = srpt_flow_time(jobs, speed=1.0)               # SRPT@1 is the flow-time optimum
    print(f"{'eps':>5} {'SRPT@(1+eps)':>13} {'OPT@1':>8} {'ratio':>7} {'~1+1/eps':>9}")
    for eps in (0.1, 0.25, 0.5, 1.0, 2.0):
        aug = srpt_flow_time(jobs, speed=1.0 + eps)
        ratio = aug / opt
        print(f"{eps:>5.2f} {aug:>13.2f} {opt:>8.2f} {ratio:>7.3f} {1 + 1/eps:>9.2f}")
        assert ratio <= 1.0 + 1e-6, "more speed cannot increase flow time vs OPT@1"
    print("\nOK: SRPT@(1+eps) flow time drops below OPT@1 — speed augmentation makes it scalable")
```

- **Constraints:** Discretize time finely (`dt = 0.01`) so SRPT's preemptions are accurate. SRPT@1 is the genuine single-machine flow-time optimum (preemptive, with release times it is optimal for *total* flow time), so it is a valid `OPT` proxy here. The point: SRPT@(1+ε) has flow time *below* OPT@1 — that is the resource-augmentation win; in the general multi-machine / non-clairvoyant setting the bound is `O(1/ε)·OPT`, which you can probe by adding more jobs and machines.
- **Hint:** This is the **scalability** notion of Phillips–Stein–Torng–Wein and Kalyanasundaram–Pruhs: an algorithm is *scalable* if it is `O(1)`-competitive with any `(1 + ε)` speedup, even where the unaugmented competitive ratio is polynomially large. The intuition: the extra `ε` speed lets the augmented algorithm "catch up" on the backlog that an adversary uses to inflate flow time, neutralizing the `Ω(n^{1/3})` lower bound. The same idea makes **non-clairvoyant** schedulers (no size knowledge, e.g. round-robin / LAPS) `O(1)`-competitive under modest speedup.
- **Acceptance test:** SRPT@(1+ε) flow time is `≤ OPT@1` and shrinks as `ε` grows; the ratio respects `O(1/ε)` in the augmented regimes you construct. Speed augmentation converts an algorithm with a hopeless unaugmented ratio into a constant-competitive (scalable) one.

---

### Task 11 — Learning-augmented scheduling: predict sizes to order like LPT/SRPT **[coding]**

`[hard]` A **learning-augmented** scheduler receives, for each job, a *prediction* `p̂_j` of its true size `p_j`, and uses the predictions to *order* jobs (largest-predicted-first for makespan, like LPT; or shortest-predicted-remaining-first for flow time, like SRPT). We want:

- **Consistency:** ratio `→ OPT`'s guarantee (here `4/3 − 1/(3m)`, LPT's bound) as predictions sharpen (error `→ 0`).
- **Robustness:** even with adversarial predictions, ratio never exceeds the prediction-free online bound `2 − 1/m` (list scheduling's guarantee).

A clean design: order jobs by predicted size descending, but assign each job by the same least-loaded greedy — and **fall back** to arrival-order greedy if prediction error is detected to be large. Implement predicted-LPT, sweep prediction noise, and show consistency (→ `4/3`) versus robustness (≤ `2 − 1/m`).

#### Python

```python
import random

def predicted_lpt(jobs, preds, m):
    """Order by PREDICTED size (descending), assign by least-loaded greedy."""
    order = sorted(range(len(jobs)), key=lambda j: -preds[j])
    loads = [0.0] * m
    for j in order:
        i = min(range(m), key=lambda x: loads[x])
        loads[i] += jobs[j]
    return max(loads)

def robust_predicted_lpt(jobs, preds, m, tau=0.5):
    """Hedge: if predictions look unreliable, fall back to plain online greedy.
    A simple robustness wrapper -> never worse than (2-1/m) by construction."""
    pl = predicted_lpt(jobs, preds, m)
    online, _ = list_scheduling(jobs, m)              # from Task 1: prediction-free
    return min(pl, online)                            # take the better of the two

if __name__ == "__main__":
    random.seed(4)
    m = 4
    jobs = [random.uniform(1, 20) for _ in range(40)]
    opt = opt_lower_bound(jobs, m)                     # from Task 1
    online_bound = 2 - 1.0 / m
    lpt_bound = 4 / 3 - 1.0 / (3 * m)
    print(f"m={m}  OPT(LB)={opt:.1f}  online bound 2-1/m={online_bound:.3f}  "
          f"LPT bound 4/3-1/3m={lpt_bound:.3f}")
    print(f"{'noise':>6} {'pred-LPT/OPT':>13} {'robust/OPT':>11} {'note':>20}")
    for noise in (0.0, 0.1, 0.3, 0.7, 1.5, 3.0):
        trials = 1 if noise == 0 else 100
        pl_tot = rb_tot = 0.0
        for t in range(trials):
            rng = random.Random(500 + t)
            preds = [max(0.01, p * rng.lognormvariate(0.0, noise)) for p in jobs]
            pl_tot += predicted_lpt(jobs, preds, m) / opt
            rb_tot += robust_predicted_lpt(jobs, preds, m) / opt
        pl, rb = pl_tot / trials, rb_tot / trials
        tag = ("consistent (->LPT)" if noise <= 0.1
               else "robust (<= 2-1/m)" if rb <= online_bound + 0.05 else "degrading")
        print(f"{noise:>6.1f} {pl:>13.3f} {rb:>11.3f}   {tag:>20}")
        # Robustness: the hedged scheduler never exceeds the prediction-free bound.
        assert rb <= online_bound * (opt_exact(jobs, m) if len(jobs) <= 12 else opt) / opt + 1.0
    print("\nConsistency: noise->0 gives pred-LPT -> LPT's 4/3 bound.  "
          "Robustness: the hedge stays <= max(pred-LPT, online) <= 2-1/m floor.")
```

- **Constraints:** With `noise = 0` predictions equal true sizes, so predicted-LPT *is* LPT and its ratio approaches the `4/3 − 1/(3m)` consistency guarantee. As noise grows the ordering degrades, but the **robust wrapper** takes the minimum of predicted-LPT and prediction-free list scheduling, so it can never exceed the `2 − 1/m` floor. Average over seeds for noisy settings.
- **Hint:** This is the **consistency–robustness trade-off** of algorithms-with-predictions (Lattanzi–Lavastida–Moseley–Vassilvitskii for scheduling). Pure "trust the predictor" (order strictly by predicted size) is consistent but can be *worse* than online when predictions are adversarial — a bad ordering can defeat the LPT advantage. Hedging against the prediction-free baseline caps the downside at the online bound while keeping the upside when predictions are good. The same template (predict-then-order, hedge against the online floor) governs learning-augmented caching (Task 11 of [paging](../03-paging-and-caching-theory/tasks.md)) and ski rental (Task 11 of [competitive analysis](../01-competitive-analysis/tasks.md)).
- **Acceptance test:** Predicted-LPT's ratio `→ 4/3 − 1/(3m)` as noise `→ 0` (consistency); the robust wrapper stays `≤ 2 − 1/m` for *every* noise level (robustness). The two properties hold simultaneously — the empirical Pareto win of predict-then-order with an online safety net.

---

### Task 12 — Vector bin packing: 2-D FFD for VM placement vs a lower bound **[coding]**

`[hard]` **Vector bin packing** generalizes bin packing to `d` dimensions: each item is a vector (e.g. a VM's `(CPU, memory)` demand), each bin a unit vector of capacity, and an item fits in a bin iff it fits in **every** coordinate. This is the model behind cloud **VM placement / bin packing for capacity planning**. 2-D **First-Fit-Decreasing** (sort items by some scalarization — e.g. the max or the sum of coordinates — descending, then First-Fit) is the workhorse heuristic. Its guarantee is `(d + ε)·OPT`-ish in the worst case (here `d = 2`), and the lower bound `OPT ≥ ⌈max_k Σ_j item_j[k]⌉` (the per-dimension total) lets you measure how close FFD lands.

Implement 2-D FFD VM placement, the per-dimension lower bound, replay VM workloads, and report `#bins / OPT_LB`, confirming it respects the `d`-dimensional bound.

#### Python

```python
import math, random

def fits(bin_used, item):
    """An item fits iff it fits in EVERY coordinate (here 2: CPU, memory)."""
    return all(bin_used[k] + item[k] <= 1.0 + 1e-12 for k in range(len(item)))

def first_fit_decreasing_vec(items, scalarize=max):
    """Sort by a scalarization (max or sum of coords) descending, then First-Fit."""
    order = sorted(items, key=lambda v: scalarize(v), reverse=True)
    bins = []                                  # each bin = list of used capacity per dim
    for item in order:
        placed = False
        for b in bins:
            if fits(b, item):
                for k in range(len(item)):
                    b[k] += item[k]
                placed = True
                break
        if not placed:
            bins.append(list(item))
    return len(bins)

def opt_lower_bound_vec(items, d=2):
    """OPT >= ceil of the most-loaded dimension's total demand."""
    return max(1, math.ceil(max(sum(it[k] for it in items) for k in range(d)) - 1e-9))

if __name__ == "__main__":
    random.seed(5)
    print(f"{'workload':>16} {'FFD-max':>8} {'FFD-sum':>8} {'OPT≥':>5} "
          f"{'max/LB':>7} {'sum/LB':>7}")
    workloads = {
        "balanced":     [(random.uniform(0.1, 0.6), random.uniform(0.1, 0.6)) for _ in range(300)],
        "cpu-heavy":    [(random.uniform(0.4, 0.9), random.uniform(0.05, 0.2)) for _ in range(300)],
        "mem-heavy":    [(random.uniform(0.05, 0.2), random.uniform(0.4, 0.9)) for _ in range(300)],
        "complementary":[((0.7, 0.2) if i % 2 else (0.2, 0.7)) for i in range(300)],
    }
    for name, items in workloads.items():
        ffd_max = first_fit_decreasing_vec(items, scalarize=max)
        ffd_sum = first_fit_decreasing_vec(items, scalarize=sum)
        lb = opt_lower_bound_vec(items)
        print(f"{name:>16} {ffd_max:>8} {ffd_sum:>8} {lb:>5} "
              f"{ffd_max/lb:>7.3f} {ffd_sum/lb:>7.3f}")
        # 2-D FFD is at worst ~d-competitive (d=2); allow the additive slack.
        assert ffd_max <= 2 * lb + 2, "2-D FFD must respect the d-dimensional bound"
        assert ffd_sum <= 2 * lb + 2
    print("\nOK: 2-D FFD within ~d*OPT; the 'complementary' workload shows packing "
          "co-located VMs (CPU-heavy + mem-heavy) near the lower bound")
```

- **Constraints:** Items are 2-D vectors with each coordinate in `(0, 1]`; a bin holds items iff *every* coordinate stays `≤ 1`. The lower bound `⌈max_k Σ_j item_j[k]⌉` is the per-dimension analogue of `⌈Σ p_j⌉` — `OPT` is at least the most-saturated dimension's ceiling. Compare two scalarizations (`max`-coord and `sum`-coord) since neither dominates across workloads.
- **Hint:** Vector bin packing is *harder* than scalar: the `max`-coord lower bound can be loose (two dimensions can be independently near-full), and worst-case FFD is `Θ(d)`-competitive, not `1.7`. The practical lesson — and the reason cloud schedulers care — is in the `complementary` workload: pairing a CPU-heavy VM with a memory-heavy VM packs both dimensions tightly, landing near the lower bound, whereas one-dimensional intuition (pack by CPU alone) wastes the memory dimension. Good VM placement is *anti-correlation matching*, which is exactly what dimension-aware scalarizations chase.
- **Acceptance test:** 2-D FFD uses `≤ 2·OPT_LB + O(1)` bins on every workload (respecting the `d = 2` bound); on the complementary workload it lands near the lower bound by co-locating anti-correlated VMs. The harness cleanly measures multi-resource packing efficiency against the per-dimension floor.

---

## Synthesis Task

> Tie the thread together: implement the online algorithm and an offline OPT (or its lower bound), replay instances (including the adversary), measure makespan / #bins / max-load, prove the bound, and locate online scheduling on the deterministic-vs-sorted-vs-randomized-vs-augmented-vs-predictive map.

`[capstone]` Carry **makespan scheduling** (with bin packing and load balancing as companions) through the full online-algorithms arc — online policy, offline OPT, adversary, proof, sorted/randomized improvement, resource (speed) augmentation, and the prediction-augmented frontier.

1. **Algorithm + OPT [coding].** Implement list scheduling and the OPT lower bound `max(avg, max_j p_j)` plus a brute-force exact OPT (Task 1). Replay instances; report the worst ratio `≤ 2 − 1/m`.

2. **Adversary [coding].** Build the `m(m−1)`-units-plus-one-big-job instance (Task 2); show list scheduling hits exactly `2 − 1/m`.

3. **Deterministic bound [proof].** Prove `ALG ≤ (2 − 1/m)·OPT` via the last-job-on-the-makespan-machine argument and prove it tight (Task 5); prove Next-Fit `2`-competitive via two-consecutive-bins (Task 6).

4. **Sorted / randomized improvement [coding].** Run LPT for the `4/3 − 1/(3m)` makespan bound (Tasks 3, 8); run power-of-two-choices for `Θ(log log n)` max load vs `Θ(log n / log log n)` (Task 7).

5. **Augmentation + predictions [coding].** Run SRPT@(1+ε) for scalable flow time (Task 10); run predicted-LPT with an online-floor hedge and report consistency (→ `4/3`) and robustness (≤ `2 − 1/m`) (Task 11).

Reference harness in **Python** (combines the pieces):

```python
import random

def det_worst(m):
    jobs = graham_worst_case(m)                       # Task 2
    alg, _ = list_scheduling(jobs, m)                 # Task 1
    return alg / m                                     # OPT = m on this instance

def lpt_worst(m):
    jobs = lpt_tight_instance(m)                       # Task 8
    l, _ = lpt_scheduling(jobs, m)                     # Task 3
    opt = opt_exact(jobs, m) if m <= 4 else opt_lower_bound(jobs, m)
    return l / opt

if __name__ == "__main__":
    for m in (2, 4, 8, 16):
        det = det_worst(m)
        lpt = lpt_worst(m)
        print(f"m={m:3d}  list-scheduling worst={det:.3f} (=2-1/m={2-1/m:.3f})  "
              f"LPT worst≈{lpt:.3f} (bound 4/3-1/3m={4/3-1/(3*m):.3f})")
        assert det <= 2 - 1/m + 1e-9
        assert lpt <= 4/3 - 1/(3*m) + 1e-9
```

- **Proof answer:** List scheduling is `(2 − 1/m)`-competitive (last-job argument: `L ≤ avg`, `OPT ≥ avg`, `OPT ≥ p_{j*}`) and tight (Graham's instance). LPT improves this to `4/3 − 1/(3m)` because the critical job has size `≤ OPT/3` when `n > m`. Next-Fit is `2`-competitive (two consecutive bins exceed one unit); First-Fit `1.7`. Power-of-two-choices drops max load from `Θ(log n / log log n)` to `Θ(log log n)`. Exponential-potential greedy is `O(log m)` on unrelated machines. SRPT@(1+ε) is `O(1/ε)`-competitive (scalable). Predicted-LPT is consistent (→ `4/3`) with an online-floor hedge for `(2 − 1/m)`-robustness.
- **Acceptance test:** Deterministic worst ratio `= 2 − 1/m` (attained on Graham's instance); LPT worst ratio `≤ 4/3 − 1/(3m)`; Next-Fit `≤ 2·OPT` and First-Fit `≤ 1.7·OPT`; power-of-two max load tracks `log log n`; exponential-potential greedy tracks `O(log m)`; SRPT@(1+ε) is scalable; predicted-LPT is consistent and robust. The proofs close the list-scheduling upper/lower bounds and Next-Fit's ratio. The write-up places online scheduling on the online map among the deterministic `2 − 1/m`, the sorted `4/3 − 1/(3m)`, the randomized `Θ(log log n)`, the heterogeneous `O(log m)`, the speed-augmented `O(1/ε)`, and the predictive consistency–robustness frontier. This mirrors the whole craft — **implement the policy, build the adversary, prove the ratio, measure makespan / #bins / max-load against OPT, and pin down where sorting, randomization, augmentation, and predictions move the floor**.

---

## Where to go next

- Revisit the `c`-competitive framework, adversary models, and the simulate-then-attack lower-bound recipe that underpin every bound here in the [competitive-analysis tasks](../01-competitive-analysis/tasks.md).
- Compare the `k`-competitive marking arguments and resource/learning augmentation of caching, whose structure mirrors scheduling's, in the [paging-and-caching tasks](../03-paging-and-caching-theory/tasks.md).
- For the conceptual treatment of list scheduling, LPT, online bin packing, unrelated-machine routing, the power of two choices, speed augmentation, and learning-augmented scheduling, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
