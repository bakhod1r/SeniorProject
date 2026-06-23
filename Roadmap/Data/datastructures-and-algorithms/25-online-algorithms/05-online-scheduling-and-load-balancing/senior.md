# Online Scheduling and Load Balancing — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — Graham's list scheduling (`2 − 1/m`-competitive), LPT, the greedy load-balancing lower bound, and online bin packing First-Fit / Next-Fit / First-Fit-Decreasing with their `1.7·OPT + O(1)` and `2·OPT` bounds
- [Competitive Analysis — Senior](../01-competitive-analysis/senior.md) — the adversary hierarchy, the potential method, and Yao's principle as von Neumann minimax (the lower-bound engine reused here)

## Table of Contents

1. [What Senior-Level Scheduling Theory Is About](#what-senior-level-scheduling-theory-is-about)
2. [Online Makespan, Refined: Beating 2 on Identical Machines](#online-makespan-refined-beating-2-on-identical-machines)
3. [The 1.9201 Lower Bound: Construction Sketch](#the-19201-lower-bound-construction-sketch)
4. [Randomized Makespan](#randomized-makespan)
5. [Related and Unrelated Machines: Θ(log m)](#related-and-unrelated-machines-thetalog-m)
6. [Worked Proof: Greedy Is O(log m) on Unrelated Machines](#worked-proof-greedy-is-olog-m-on-unrelated-machines)
7. [Flow Time and the Necessity of Resource Augmentation](#flow-time-and-the-necessity-of-resource-augmentation)
8. [Speed Augmentation and Scalable Algorithms](#speed-augmentation-and-scalable-algorithms)
9. [Online Bin Packing, Advanced: Harmonic to 1.578](#online-bin-packing-advanced-harmonic-to-1578)
10. [Vector Bin Packing and VM Placement](#vector-bin-packing-and-vm-placement)
11. [Connections: k-Server, MTS, and Rent-or-Buy](#connections-k-server-mts-and-rent-or-buy)
12. [Learning-Augmented Scheduling](#learning-augmented-scheduling)
13. [Decision Framework](#decision-framework)
14. [Research Pointers](#research-pointers)
15. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Scheduling Theory Is About

The middle level settles the *easy* questions. Graham's greedy **list scheduling** — assign each arriving job to the least-loaded machine — is `(2 − 1/m)`-competitive for makespan on `m` identical machines, and a matching lower bound shows greedy cannot do better. **LPT** (longest-processing-time first) tightens the *offline/sorted* case to `4/3 − 1/(3m)`. Online **bin packing** sits at First-Fit `1.7·OPT + O(1)`, Next-Fit `2·OPT`, with the easy `4/3` lower bound. Those bounds are correct and, for an interview, sufficient. They are also where the *interesting* theory begins, not ends.

Senior-level scheduling theory is about four deeper truths, each a different relaxation of the naive worst case:

1. **Beating Graham's `2 − 1/m` requires deliberate imbalance.** The best deterministic online makespan algorithms for identical machines sit at `≈ 1.92` (Fleischer–Wahl 1.9201, Albers 1.923), strictly below `2`, and the best lower bound is `≈ 1.9201` (Rudin). The key structural insight: an algorithm that *always* balances perfectly (pure greedy) is provably stuck near `2`; to beat it you must **keep some machines underloaded on purpose**, hedging against a future burst of large jobs. This is the rare case where the locally greedy move is globally wrong.
2. **Machine heterogeneity costs a `log m` factor.** On **unrelated machines** (job `j` takes time `p_{ij}` on machine `i`, with no structure across machines) greedy is `Θ(log m)`-competitive — `O(log m)` from above (Aspnes, Azar, Fiat, Plotkin, Waarts 1997) and a matching `Ω(log m)` lower bound. No online algorithm escapes the logarithm.
3. **Some objectives admit *no* constant-competitive online algorithm — until you cheat with resources.** Minimizing **total/average flow time** or weighted completion time has an unbounded competitive ratio online. But give the online scheduler **faster machines** than OPT — *speed augmentation* — and SRPT / SETF become `O(1)`-competitive (Kalyanasundaram–Pruhs 1995/2000). This *resource-augmentation* framework, and the notion of a **scalable** algorithm `(1 + ε)`-speed `O(1)`-competitive, is the senior centerpiece.
4. **Bin packing's true constant is now nailed down to a narrow window.** The Super-Harmonic / Harmonic++ family pushed the upper bound below `1.59`, and Balogh, Békési, Dósa, Epstein, and Levin (2018) reached `≈ 1.578` with a matching-direction lower bound of `≈ 1.5403`. Multi-dimensional (**vector**) bin packing — the abstraction behind VM placement — is genuinely harder.

Underneath sits the same machinery as the rest of [`../01-competitive-analysis/senior.md`](../01-competitive-analysis/senior.md): potentials for upper bounds, Yao and explicit adversary constructions for lower bounds, and the connection to [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md) and metrical task systems.

---

## Online Makespan, Refined: Beating 2 on Identical Machines

Graham's analysis is exact for *pure* greedy: the makespan it produces is at most `OPT·(2 − 1/m)`, and an adversary achieves it (release `m(m−1)` unit jobs to balance everything perfectly, then one job of size `m`). The natural senior question is: **can any deterministic online algorithm beat `2 − 1/m`?** The answer is yes — but the algorithm must abandon perfect balancing.

### Why pure greedy is stuck near 2

Greedy's failure mode is that it leaves *no slack*. After greedy has balanced `m` machines to load `L`, a single huge job of size `≈ L` must pile onto some machine, producing makespan `≈ 2L`, while OPT — knowing the huge job was coming — would have reserved a lightly loaded machine for it. Greedy's commitment to *immediate* balance is exactly what the adversary punishes.

### The imbalance idea

The breakthrough algorithms (Bartal, Fiat, Karloff, Vohra 1992, the first sub-`2` algorithm at `2 − 1/70`; then Karger–Phillips–Torng, Albers, Fleischer–Wahl) deliberately maintain an **uneven load profile**: they keep a designated fraction of machines *below average* so that a future large job has a cheap home. Concretely, an algorithm assigns an arriving job to a machine only if doing so keeps the machine's load below `α · (current average or lower-bound estimate of OPT)`; otherwise it "wastes" the more-loaded machines and uses a reserved light one. The competitive ratio is tuned by choosing the imbalance threshold `α`.

> **Theorem (Fleischer–Wahl 2000).** There is a deterministic online algorithm for makespan on `m` identical machines that is `≈ 1.9201`-competitive as `m → ∞`.

> **Theorem (Albers 1999).** There is a deterministic online algorithm that is `1.923`-competitive for all `m`, together with an improved lower bound (Albers' analysis brought both ends closer).

The precise constant `1.9201` of Fleischer–Wahl matches the **lower bound** of `≈ 1.9201` (the bound usually attributed to Rudin's thesis, *Improved Bounds for the Online Scheduling Problem*, 2001, sharpening Bartal–Karloff–Rabani and Albers). So for deterministic identical-machine makespan, the competitive ratio is pinned to the interval `[1.9201, 1.9201]` up to the precision of these constants — the problem is, for practical purposes, *solved*.

The senior takeaway is structural, not numeric: **the only way past `2` is to forgo greedy's instantaneous balance and bank capacity for an adversarial large job.** This is the canonical example where "always do the locally optimal load-balancing move" is provably suboptimal online.

---

## The 1.9201 Lower Bound: Construction Sketch

The lower bound for deterministic identical-machine makespan is an explicit adversary, in the spirit of the constructions in [`../01-competitive-analysis/senior.md`](../01-competitive-analysis/senior.md). We sketch its skeleton for `m → ∞`; the full optimization yields `≈ 1.9201`.

### The adversary's weapon: stop early if the algorithm is balanced

The adversary releases jobs in **rounds of geometrically increasing size**, and watches the algorithm's load vector. The principle:

- The adversary feeds many *small* jobs first. By the time it has released enough small work, the algorithm has committed each piece to some machine.
- At a moment of the adversary's choosing, it **stops** and the makespan is the current maximum machine load. If the algorithm balanced perfectly, the adversary *continues* with a batch of larger jobs; if the algorithm hedged (kept some machine light), the adversary stops *now* and the algorithm's wasted, over-loaded machines hurt its makespan relative to a balanced OPT.

The algorithm faces a dilemma the adversary engineered: **balance now and be punished by a future large job, or hedge now and be punished if the adversary stops immediately.** Either response is suboptimal against the *right* stopping time, and the adversary picks the worse one for the algorithm.

### The optimization

Formally, let the adversary release jobs in phases. In phase `t`, it releases jobs of size `s_t` (geometric, `s_t = γ^t`) until the algorithm's load configuration reaches a target. After each phase the adversary computes two quantities:

- the **online makespan** `ALG_t` if it stops here (max load over the algorithm's machines), and
- the **optimal makespan** `OPT_t` for the jobs released so far (a balanced offline assignment of all phases up to `t`).

The adversary stops at the phase `t*` maximizing `ALG_{t*} / OPT_{t*}`. The construction is arranged so that *whatever* online assignment policy is used, some phase exhibits a ratio approaching the target. Setting up the recurrence between consecutive phases' loads and solving the resulting optimization (a small LP / fixed-point in the geometric ratio `γ` and the per-phase job counts) yields the value:

```text
   sup over online algorithms  inf over them  ALG/OPT   →   ≈ 1.9201   (as m → ∞).
```

The earliest such bound (Faigle–Kern–Turán) gave `1 + 1/√2 ≈ 1.707` for small `m`; Bartal–Karloff–Rabani pushed it to `1.837`; Albers and then Rudin's optimization reached `1.9201`. The matching upper bound (Fleischer–Wahl) is what closes the problem. The *technique* — a geometric-phase adversary with an optimal stopping time chosen to maximize the realized ratio — is the standard tool for online-scheduling lower bounds and recurs in the flow-time impossibility below.

---

## Randomized Makespan

Against an *oblivious* adversary, randomization helps for makespan, though far less dramatically than it does for paging (`k → H_k`). The randomization lets the algorithm hide *which* machine it kept light, denying the adversary the precise stopping time it needs.

- For **`m = 2` machines**, the optimal randomized competitive ratio is `4/3` (Bartal–Fiat–Karloff–Vohra), versus the deterministic `3/2 = 2 − 1/2`. A randomized lower bound for general `m` of `e/(e−1) ≈ 1.5819` holds for randomized makespan (Chen–van Vliet–Woeginger; Sgall) — note the `e/(e−1)` constant, the same signature value from randomized [ski rental](../01-competitive-analysis/senior.md) and online matching.
- For large `m`, the best randomized upper bounds (e.g. Albers' randomized algorithm) sit *below* the deterministic `1.9201` but above the `e/(e−1) ≈ 1.582` lower bound; the exact randomized constant for general `m` remains **open**, a rare gap in an otherwise tightly characterized problem.

The senior framing matches the [adversary-hierarchy](../01-competitive-analysis/senior.md) prediction: randomization buys an order-of-magnitude win only when the deterministic ratio is large (paging, `k`); for makespan, where the deterministic ratio is already a small constant, randomization shaves the constant from `≈ 1.92` toward `≈ 1.58` and no further.

---

## Related and Unrelated Machines: Θ(log m)

Identical machines are the easy case. Heterogeneity changes the complexity class of the problem.

### The three machine models

| Model | Job `j` on machine `i` takes | Structure |
|---|---|---|
| **Identical** | `p_j` (same everywhere) | none — load = sum of sizes |
| **Related (uniform)** | `p_j / s_i` (machine `i` has speed `s_i`) | one speed scalar per machine |
| **Unrelated** | `p_{ij}` (arbitrary matrix) | no cross-machine relation |
| **Restricted assignment** | `p_j` if `i ∈ S_j`, else `∞` | each job has an allowed *set* of machines |

Restricted assignment is the special case of unrelated where each entry is either the job's "real" size or infinity — and it is already hard.

### The results

> **Theorem (Aspnes, Azar, Fiat, Plotkin, Waarts 1997).** For online makespan on **unrelated** machines, the greedy "assign to the machine of least resulting load" algorithm is `O(log m)`-competitive, and a smarter exponential-potential algorithm achieves `O(log m)`. No online algorithm is better than `Ω(log m)`-competitive.

> **Restricted assignment is Θ(log m).** Azar, Naor, and Rom showed greedy is `Θ(log m)` for the restricted-assignment special case — the lower bound already bites when entries are just `{p_j, ∞}`.

> **Related machines are O(1).** With a single speed per machine, the structure is enough: there are deterministic `O(1)`-competitive algorithms (Aspnes et al. give a constant; later work tightened it). The logarithm is a price specifically of *unstructured* heterogeneity.

The algorithmic idea behind the `O(log m)` upper bound is the **exponential (potential / multiplicative-weights-flavored) assignment rule**: instead of minimizing the *new max load*, assign job `j` to the machine minimizing the increase in `Σ_i a^{load_i}` for a base `a ≈ 1 + 1/something`. This convex potential penalizes piling onto an already-loaded machine super-linearly, smoothing the load and capping the ratio at `O(log m)`. The same exponential-potential trick underlies online routing and virtual-circuit assignment (Aspnes et al.'s actual motivation), and the assignment-LP rounding view (assign fractionally by an LP, round) gives an alternative route to the same `O(log m)`.

---

## Worked Proof: Greedy Is O(log m) on Unrelated Machines

We prove the upper-bound half via the exponential potential — the cleanest senior-level argument and the template for the whole AAFPW line.

### Setup

Jobs arrive online; job `j` on machine `i` adds load `p_{ij}`. Let `L_i(t)` be the load of machine `i` after the first `t` jobs. Normalize so that the optimal makespan satisfies `OPT ≤ 1` (we can guess and *doubling-scale* on a binary-search estimate of OPT, losing only a constant factor; assume the guess is correct). Define the potential after `t` jobs, for a base `a > 1` to be fixed:

```text
   Φ(t)  =  Σ_{i=1}^{m}  ( a^{L_i(t)}  −  1 ).
```

`Φ(0) = 0`. The assignment rule: place job `j` on the machine `i` minimizing the *increase* `a^{L_i + p_{ij}} − a^{L_i}` in `Φ`.

### The invariant

> **Claim.** With base `a = 2` (any constant `> 1` works with a different constant in the bound), the greedy-by-potential rule keeps `Φ(t) ≤ (a − 1)·m·(something)` such that no machine's load exceeds `O(log m)·OPT`.

**Charging against OPT.** Fix the optimal schedule `OPT`, which assigns job `j` to some machine `σ(j)` with `p_{σ(j),j} ≤ OPT ≤ 1`, and whose per-machine loads are all `≤ OPT ≤ 1`. When our algorithm places job `j`, by the greedy choice its increase in `Φ` is at most the increase OPT *would* incur by placing `j` on `σ(j)`:

```text
   ΔΦ_alg(j)  ≤  a^{L_{σ(j)} + p_{σ(j),j}} − a^{L_{σ(j)}}
              =  a^{L_{σ(j)}} · ( a^{p_{σ(j),j}} − 1 ).
```

Using `p_{σ(j),j} ≤ 1` and the convexity bound `a^{p} − 1 ≤ p·(a − 1)` for `p ∈ [0,1]`:

```text
   ΔΦ_alg(j)  ≤  (a − 1) · a^{L_{σ(j)}} · p_{σ(j),j}.
```

### Summing

Sum over all jobs `j`. Group the right-hand side by the machine `i = σ(j)` that OPT used. Because OPT's total load on machine `i` is `Σ_{j: σ(j)=i} p_{ij} ≤ OPT ≤ 1`, and the factor `a^{L_{σ(j)}}` is bounded by `a^{ALG's load on i at that time} ≤ a^{(final load on i)}`, a careful accounting (the standard AAFPW summation) gives:

```text
   Φ(final)  =  Σ_j ΔΦ_alg(j)  ≤  (a − 1) · Σ_i a^{L_i^{final}} · (OPT load on i)
             ≤  (a − 1) · Φ(final)  +  (lower-order),
```

which — solving for `Φ(final)` with `a` chosen so that `a − 1 < 1` absorbs the self-reference — bounds `Φ(final) = O(m)`. Since `Φ(final) ≥ a^{max_i L_i} − 1`, we get

```text
   a^{max_i L_i}  ≤  O(m)   ⇒   max_i L_i  ≤  log_a O(m)  =  O(log m)  · OPT.
```

The makespan is `O(log m)·OPT`. The exponential potential is doing the essential work: it makes piling onto a loaded machine *exponentially* expensive, so the greedy-by-potential rule self-limits the maximum load to a logarithm. The matching `Ω(log m)` lower bound (AAFPW) is an adversary that forces *any* online algorithm to spread a structured set of jobs across machines such that some machine accrues `Ω(log m)` times OPT — restricted-assignment instances suffice.

---

## Flow Time and the Necessity of Resource Augmentation

Makespan rewards *balance*; **flow time** rewards *speed of completion*. The flow (or response) time of a job is `completion − release`; we minimize **total flow time** `Σ_j (C_j − r_j)`, or its average. This objective is brutal online.

> **Theorem (impossibility).** No deterministic or randomized online algorithm for total flow time on a single machine — or on parallel machines — is `O(1)`-competitive. The competitive ratio is unbounded (grows with `n` or the size ratios); on multiple machines even `SRPT` is `Ω(log(P))` or worse, where `P` is the max/min job-size ratio.

The intuition: a single long job, if scheduled at the wrong moment, blocks a flood of tiny jobs that each accrue large flow time while waiting; the offline optimum, knowing the flood is coming, finishes the long job earlier or defers it. The online algorithm cannot win this race in the worst case — there is genuinely no constant-competitive online algorithm. This is the senior insight that *forces* a change of framework: **for flow time, competitive analysis against an equal-resource OPT is the wrong question.** The fix is resource augmentation.

---

## Speed Augmentation and Scalable Algorithms

**Resource augmentation** for scheduling, introduced by Kalyanasundaram and Pruhs (*"Speed is as Powerful as Clairvoyance,"* FOCS 1995 / JACM 2000), gives the online algorithm machines that run **faster** than OPT's, then asks for a competitive ratio.

> **Definition (speed augmentation).** An online algorithm is **`s`-speed `c`-competitive** if, when its machines run at speed `s ≥ 1` while OPT's run at speed `1`, its objective is at most `c · OPT` for every instance.

The headline result rescues flow time:

> **Theorem (Kalyanasundaram–Pruhs 2000).** **SRPT** (shortest-remaining-processing-time) and **SETF** (shortest-elapsed-time-first, the non-clairvoyant analogue) are `(1 + ε)`-speed `O(1/ε)`-competitive for total flow time. With even a *tiny* speed advantage `ε`, the unbounded competitive ratio collapses to a constant.

The slogan **"speed is as powerful as clairvoyance"** is exact: SETF, which does *not* know job sizes, achieves with `(1 + ε)` speed essentially what the clairvoyant SRPT achieves with no augmentation — the speed makes up for not seeing the future.

### Scalable algorithms

The gold standard the framework defines:

> **Definition (scalable).** An algorithm is **scalable** if for every `ε > 0` it is `(1 + ε)`-speed `O(f(ε))`-competitive — arbitrarily close to OPT's resources buys an `O(1)` ratio (with the constant possibly blowing up as `ε → 0`).

Scalable is the "online-optimal" badge for objectives with no constant-competitive algorithm: it says the *only* obstruction is the resource gap, and any positive resource advantage closes it. Major scalable results:

- **SRPT / SETF** — scalable for total flow time (Kalyanasundaram–Pruhs).
- **Weighted flow time** — scalable algorithms via the **`k`-th power / highest-density-first** family and **potential-function** analyses (Bansal–Pruhs; Bansal–Dhamdhere). Weighted flow time has *no* `O(1)`-competitive online algorithm either, and is rescued only by augmentation.
- **`ℓ_p` norms of flow time / stretch** — scalable via amortized-potential arguments (Bansal–Pruhs, *"Server Scheduling in the `ℓ_p` Norm"*).
- **Online primal-dual** (Anand–Garg–Kumar; Devanur–Huang; Im–Kulkarni–Munagala) gave a *unified* recipe: write the scheduling LP, run the multiplicative/primal-dual update, and the dual feasibility certifies a `(1 + ε)`-speed `O(1)`-competitive bound. This is the modern engine for scalability proofs.

### The proof shape (SRPT flow time, augmented)

The standard argument is a **local-competitiveness / potential** proof. Define a potential `Φ(t)` measuring, at each instant, how far the algorithm's set of unfinished jobs (its *remaining-work profile*) lags OPT's. The instantaneous flow-time rate is the **number of unfinished jobs** `n_{ALG}(t)`; we want `∫ n_{ALG} dt ≤ O(1)·∫ n_{OPT} dt`. The running condition to establish is, at every instant,

```text
   n_{ALG}(t)  +  dΦ/dt   ≤   c · n_{OPT}(t),
```

which telescopes (integrates) to `∫ n_{ALG} ≤ c·∫ n_{OPT} + Φ(0) − Φ(∞)`. The speed advantage `s = 1 + ε` enters precisely here: because the algorithm processes work `(1 + ε)` times faster, whenever it is "behind" OPT in remaining work, its higher throughput drives `dΦ/dt` sufficiently negative to absorb the `n_{ALG}` term, making the running inequality hold with `c = O(1/ε)`. Without the speed boost (`ε = 0`) the potential cannot pay for `n_{ALG}`, and indeed no constant `c` exists — the impossibility result. **The `ε` of extra speed is exactly the budget that makes the potential argument close.** This is the same `ALG_move + ΔΦ ≤ c·OPT_move` skeleton as the [potential method for competitive proofs](../01-competitive-analysis/senior.md), specialized to a continuous-time flow-time integral.

---

## Online Bin Packing, Advanced: Harmonic to 1.578

Bin packing: items of size in `(0, 1]` arrive online; pack each, on arrival, into a unit-capacity bin (open a new one if needed); minimize the number of bins. The middle level covers First-Fit (`1.7·OPT + O(1)`) and the `4/3` lower bound. Senior bin packing is the decades-long race to the optimal *asymptotic* competitive ratio.

### The Harmonic family

The structural problem with First-Fit is that two items of size `0.51` waste nearly half a bin each and can never share. The **Harmonic** algorithm (Lee–Lee 1985) fixes this by **classifying items by size class** and packing each class into its own dedicated bins:

- Partition `(0, 1]` into intervals `(1/(k+1), 1/k]` for `k = 1, …, M−1` and a tail `(0, 1/M]`.
- An item of class `k` goes only into bins reserved for class `k`, each of which holds exactly `k` such items.

This **bounded-space** algorithm (only `O(M)` open bins at once) is `≈ 1.691`-competitive as `M → ∞` — the value `Π_∞ ≈ 1.6910` is provably the *best possible for any bounded-space online algorithm* (Lee–Lee). To beat `1.691` you must use **unbounded space** (keep arbitrarily many bins open) and *combine* size classes cleverly.

### Super-Harmonic and Harmonic++

The improvements pair up complementary classes — e.g. a large item near `2/3` with a small item near `1/3` — so the wasted space in one class is filled by another. This is the **Super-Harmonic** framework (Seiden 2002), which unifies Harmonic, Refined-Harmonic (Lee–Lee, `1.636`), Modified-Harmonic, and **Harmonic++** (Seiden), the best Super-Harmonic algorithm at `≈ 1.58889`. Seiden also proved Super-Harmonic algorithms cannot beat `≈ 1.583`, so a fundamentally new idea was needed to go lower.

### The modern frontier

> **Theorem (Balogh, Békési, Dósa, Epstein, Levin 2018).** There is an online bin-packing algorithm with asymptotic competitive ratio `≈ 1.5783` — beating the Super-Harmonic barrier — and **no** online algorithm has asymptotic ratio below `≈ 1.5403`.

The `1.5403` lower bound (Balogh–Békési–Dósa–Sgall–van Stee, sharpening the long-standing `1.5401`) and the `1.5783` upper bound bracket the true online bin-packing constant into a narrow but still-open window. The senior point: bin packing is *not* solved the way identical-machine makespan is; the optimal asymptotic ratio is one of the genuinely open constants in online algorithms.

| Algorithm | Asymptotic ratio | Space |
|---|---|---|
| Next-Fit | `2.0` | bounded (1 open bin) |
| First-Fit | `1.7` | unbounded |
| Harmonic (Lee–Lee 1985) | `≈ 1.691` | **bounded** (optimal for bounded-space) |
| Refined-Harmonic | `≈ 1.636` | unbounded |
| Harmonic++ (Seiden 2002) | `≈ 1.589` | unbounded |
| Balogh et al. 2018 | `≈ 1.578` | unbounded |
| **Lower bound** (Balogh et al.) | `≈ 1.5403` | — |

### Bin covering

The dual objective, **bin covering** — fill bins to *at least* `1`, maximize the number of covered bins — has its own online theory (Csirik–Totik): the best online competitive ratio is `1/2`, a sharp contrast to packing, reflecting that covering is the harder direction to do online.

---

## Vector Bin Packing and VM Placement

The objective that matters for cloud infrastructure is **vector (multi-dimensional) bin packing**: each item is a `d`-vector of resource demands (CPU, memory, disk, bandwidth), each bin a `d`-vector of capacities, and an item fits only if it fits in *every* coordinate. This is exactly **VM placement / container bin-packing** on physical hosts.

The dimensionality is punishing:

- **Offline** vector bin packing is APX-hard and the best approximation is `O(log d)` (or `1 + ε·d`-style trade-offs); there is no PTAS for `d ≥ 2` (unlike the `1`-D asymptotic PTAS of Fernandez de la Vega–Lueker).
- **Online**, First-Fit-style algorithms are `Θ(d)`-competitive — the competitive ratio grows *linearly* in the number of resource dimensions, and a matching `Ω(d / log d)`-type lower bound holds. Each additional constrained resource dimension makes online packing strictly harder.

The practical consequence for a senior engineer designing a scheduler (Kubernetes, Borg, a VM placement service): **per-host bin packing across multiple resources is provably hard online**, the `1`-D `1.578` intuition does not transfer, and real schedulers therefore lean on (a) **repacking / migration** (turning the online problem partially offline — see the rent-or-buy connection below), (b) **dominant-resource** heuristics that collapse `d` dimensions to one, and (c) **overcommit** with statistical multiplexing rather than worst-case packing. The theory says no online rule will be within a constant factor across many tight resources.

---

## Connections: k-Server, MTS, and Rent-or-Buy

Online scheduling does not live alone; it shares machinery with the rest of [`25-online-algorithms`](../).

- **Metrical task systems and `k`-server.** Load balancing with *migration cost* — where reassigning a job to another machine costs a movement penalty — is a metrical task system, the abstraction that generalizes both paging and the [`k`-server problem](../04-k-server-problem/senior.md). The exponential-potential assignment rule used for unrelated machines is a sibling of the work-function and potential arguments in `k`-server; both penalize concentration via a convex potential. When jobs can be *migrated* between machines at a cost, the analysis borrows directly from MTS competitive theory.
- **Rent-or-buy / ski rental in scheduling.** Many scheduling sub-decisions are **rent-or-buy** ([ski rental](../01-competitive-analysis/senior.md)) problems: *Should I keep a machine powered on (paying per-unit "rent") or accept the one-time "buy" cost of spinning a new one up?* — the core of **machine activation / dynamic provisioning** and energy-aware scheduling. The deterministic `2`-competitive and randomized `e/(e−1)`-competitive ski-rental strategies transfer directly to deciding when to acquire capacity. **Energy-aware speed scaling** (Yao–Demers–Shenker; Bansal–Kimbrel–Pruhs) — choosing processor speeds to trade energy against flow time — is itself analyzed with the *same* speed-augmentation and potential framework as flow-time scheduling, unifying the two threads.

The senior view: scheduling, paging, `k`-server, and rent-or-buy are dialects of one language — online cost minimization analyzed by potentials (upper bounds) and adversary constructions or Yao (lower bounds). Recognizing a scheduling decision as a disguised ski-rental or MTS instance is what lets you import a tight bound instead of re-deriving one.

---

## Learning-Augmented Scheduling

The newest layer — mirroring [learning-augmented caching](../03-paging-and-caching-theory/senior.md) — feeds the scheduler **ML predictions** and asks for guarantees that interpolate between "near-optimal when predictions are good" (**consistency**) and "no worse than the classical worst case when they are garbage" (**robustness**).

- **Predicted job sizes for flow time.** Purohit, Svitkina, and Kumar (*"Improving Online Algorithms via ML Predictions,"* NeurIPS 2018) give non-clairvoyant scheduling that, with predicted processing times, runs a **preferential round-robin / SPJF blend** controlled by a confidence parameter `λ`: it is `(1 + λ)/(2λ)`-consistent and `(1 + λ)/(1 − λ)`-robust for total completion time — `λ → 1` trusts the predictor (near-optimal SPT-like behavior), `λ → 0` falls back to robust round-robin. The same paper's ski-rental-with-predictions result is the companion template.
- **Permutation / order predictions.** Lattanzi, Lavastida, Moseley, and Vassilvitskii (*"Online Scheduling via Learned Weights,"* SODA 2020) predict a **per-machine weight** (a proxy for the right assignment) for restricted-assignment makespan, achieving a competitive ratio of `O(log(1/η))` for predictions of quality `η` — degrading *gracefully* from `O(1)` (good predictions) toward the worst-case `O(log m)` (bad predictions), exactly the consistency/robustness interpolation, here *beating* the prediction-free `Θ(log m)` barrier when predictions are decent.
- **The general pattern.** As in caching, the recipe is a **combiner**: run the prediction-following policy but cap its damage with a robust classical backbone (round-robin for flow time, greedy/exponential-potential for makespan), tuned by a confidence knob. The predictions let well-behaved instances escape the pessimistic lower bounds (`log m` for unrelated machines, unboundedness for flow time) while the backbone preserves the worst-case safety net.

This is an active frontier; the senior takeaway is that **predictions are the principled way to beat the `Θ(log m)` and flow-time impossibility barriers on realistic inputs** without abandoning worst-case guarantees — the scheduling analogue of Belady-with-noise.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Identical machines, makespan, simplicity matters | **Greedy list scheduling** (`2 − 1/m`); good enough unless you need sub-2 |
| Identical machines, you must beat 2 | **Imbalance algorithm** (Fleischer–Wahl `1.9201` / Albers `1.923`) — deliberately keep machines underloaded |
| Machines have one speed each (related) | `O(1)`-competitive algorithms exist — heterogeneity with structure is cheap |
| Unrelated machines / restricted assignment | **Exponential-potential greedy**, `Θ(log m)` — the logarithm is unavoidable online |
| Minimizing flow / completion time, no resources to spare | **Impossible** to be `O(1)`-competitive — change the question |
| Flow time with a little extra hardware budget | **Speed augmentation**: SRPT/SETF are `(1+ε)`-speed `O(1)`-competitive (scalable) |
| Weighted / `ℓ_p` flow time | **Scalable** via highest-density-first or **online primal-dual** |
| 1-D bin packing, best ratio | Unbounded-space **Harmonic++ / Balogh et al.** (`≈ 1.578`); **Harmonic** (`1.691`) if memory is bounded |
| Multi-resource VM / container placement | **Vector bin packing** — `Θ(d)` online; lean on migration, dominant-resource, overcommit |
| "Power on a machine vs. spin up a new one" | **Rent-or-buy / ski rental** (det. `2`, rand. `e/(e−1)`) |
| You have an ML predictor of job sizes / order | **Learning-augmented** scheduling (Purohit et al.; Lattanzi et al.) — consistency + robustness |

---

## Research Pointers

- **Graham, R. L. (1966/1969). "Bounds for Certain Multiprocessing Anomalies."** *Bell System Tech. J. / SIAM J. Appl. Math.* List scheduling `2 − 1/m`; LPT `4/3 − 1/(3m)`. The origin of the field.
- **Bartal, Y., Fiat, A., Karloff, H., & Vohra, R. (1992/1995). "New Algorithms for an Ancient Scheduling Problem."** *STOC / JCSS.* First deterministic algorithm beating `2` for identical-machine makespan (`2 − 1/70`), and randomized `4/3` for `m = 2`.
- **Albers, S. (1999). "Better Bounds for Online Scheduling."** *SIAM J. Comput.* The `1.923`-competitive algorithm and improved lower bound for identical machines.
- **Fleischer, R., & Wahl, M. (2000). "Online Scheduling Revisited."** *J. Scheduling.* The `≈ 1.9201`-competitive algorithm matching the lower bound.
- **Rudin, J. F. (2001). *Improved Bounds for the Online Scheduling Problem* (PhD thesis, UT Dallas).** The `≈ 1.9201` lower bound for deterministic identical-machine makespan.
- **Aspnes, J., Azar, Y., Fiat, A., Plotkin, S., & Waarts, O. (1997). "On-line Routing of Virtual Circuits with Applications to Load Balancing and Machine Scheduling."** *JACM* 44(3). Greedy `O(log m)` on unrelated machines and the `Ω(log m)` lower bound; the exponential potential.
- **Kalyanasundaram, B., & Pruhs, K. (1995/2000). "Speed is as Powerful as Clairvoyance."** *FOCS / JACM* 47(4). The speed-augmentation framework; SRPT/SETF `(1+ε)`-speed `O(1)`-competitive for flow time.
- **Bansal, N., & Pruhs, K. (2003/2010). "Server Scheduling in the `ℓ_p` Norm" / "Speed Scaling..."** Scalable algorithms for weighted and `ℓ_p`-norm flow time via potentials.
- **Anand, S., Garg, N., & Kumar, A. (2012). "Resource Augmentation for Weighted Flow-Time Explained by Dual Fitting."** *SODA.* The online primal-dual / dual-fitting recipe for scalability.
- **Lee, C. C., & Lee, D. T. (1985). "A Simple On-line Bin-Packing Algorithm."** *JACM* 32(3). Harmonic; the `1.691` bounded-space optimum.
- **Seiden, S. S. (2002). "On the Online Bin Packing Problem."** *JACM* 49(5). The Super-Harmonic framework and Harmonic++ (`≈ 1.589`).
- **Balogh, J., Békési, J., Dósa, G., Epstein, L., & Levin, A. (2018/2019). "A New and Improved Algorithm for Online Bin Packing" / lower bound.** *ESA / SIAM J. Comput.* Upper bound `≈ 1.578`; lower bound `≈ 1.5403`.
- **Purohit, M., Svitkina, Z., & Kumar, R. (2018). "Improving Online Algorithms via ML Predictions."** *NeurIPS.* Non-clairvoyant scheduling and ski rental with predicted sizes; consistency/robustness.
- **Lattanzi, S., Lavastida, T., Moseley, B., & Vassilvitskii, S. (2020). "Online Scheduling via Learned Weights."** *SODA.* Restricted-assignment makespan with per-machine weight predictions.
- **Borodin, A., & El-Yaniv, R. (1998). *Online Computation and Competitive Analysis.*** Cambridge Univ. Press. The definitive reference for the competitive machinery underlying all of the above.

---

## Key Takeaways

1. **Beating Graham's `2 − 1/m` requires deliberate imbalance.** The deterministic identical-machine makespan ratio is `≈ 1.9201` — achieved by Fleischer–Wahl (1.9201) and Albers (1.923), matched by Rudin's lower bound. Pure greedy is stuck near `2` because it leaves no slack for a future large job; the sub-2 algorithms reserve underloaded machines on purpose.
2. **The lower bound is a geometric-phase adversary with an optimal stopping time.** It feeds geometrically growing jobs and stops at the phase maximizing `ALG/OPT`, forcing any online algorithm into a balance-vs-hedge dilemma that yields `≈ 1.9201`. Randomized makespan improves the constant toward `e/(e−1) ≈ 1.582` (tight at `4/3` for `m = 2`) but not below.
3. **Unrelated machines cost a logarithm.** Greedy via the **exponential potential** is `O(log m)`-competitive (Aspnes–Azar–Fiat–Plotkin–Waarts 1997), matched by `Ω(log m)`; restricted assignment is already `Θ(log m)`, while *related* (single-speed) machines stay `O(1)`. The convex potential makes concentration exponentially expensive, self-limiting the max load.
4. **Flow time has no `O(1)`-competitive online algorithm — resource augmentation rescues it.** Kalyanasundaram–Pruhs (1995): **"speed is as powerful as clairvoyance"** — SRPT/SETF are `(1+ε)`-speed `O(1/ε)`-competitive, and the `ε` of extra speed is exactly the budget that makes the potential argument `n_{ALG} + dΦ/dt ≤ c·n_{OPT}` close. **Scalable** = `(1+ε)`-speed `O(1)`-competitive is the online-optimality badge; online primal-dual is the modern proof engine.
5. **Online bin packing's optimal constant is open, in `[1.5403, 1.578]`.** Harmonic (`1.691`) is the bounded-space optimum; Super-Harmonic / Harmonic++ (`1.589`) and Balogh–Békési–Dósa–Epstein–Levin (`1.578`) are the unbounded-space frontier. **Vector** bin packing (VM placement) is `Θ(d)`-competitive — each resource dimension makes online packing strictly harder.
6. **Scheduling shares machinery with `k`-server, MTS, and rent-or-buy.** Migration-cost load balancing is an MTS; machine activation and power-on decisions are ski rental (det. `2`, rand. `e/(e−1)`). See [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md).
7. **Learning-augmented scheduling beats the impossibility barriers on realistic inputs.** Predicted job sizes (Purohit et al. 2018) and permutation/weight predictions (Lattanzi et al. 2020) give consistency/robustness trade-offs that escape `Θ(log m)` and flow-time unboundedness when predictions are good, with a robust classical backbone as the safety net.

---

> **See also:** [`./middle.md`](./middle.md) for list scheduling, LPT, and basic bin packing · [`./professional.md`](./professional.md) for production scheduler engineering · [`../01-competitive-analysis/senior.md`](../01-competitive-analysis/senior.md) for potentials, Yao, and the adversary hierarchy · [`../03-paging-and-caching-theory/senior.md`](../03-paging-and-caching-theory/senior.md) for the learning-augmented template · [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md) for MTS and the general metric problem
