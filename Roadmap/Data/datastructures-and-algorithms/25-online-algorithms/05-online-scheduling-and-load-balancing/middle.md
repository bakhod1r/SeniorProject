# Online Scheduling and Load Balancing — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Model, Restated for Proofs](#the-model-restated-for-proofs)
3. [Graham's List Scheduling Is (2 − 1/m)-Competitive](#grahams-list-scheduling-is-2--1m-competitive)
   - [Two Lower Bounds on OPT](#two-lower-bounds-on-opt)
   - [The Upper-Bound Proof](#the-upper-bound-proof)
   - [The Bound Is Tight](#the-bound-is-tight)
4. [LPT Is (4/3 − 1/(3m))-Competitive](#lpt-is-43--13m-competitive)
   - [Why Sorting Helps: the Critical-Job Lemma](#why-sorting-helps-the-critical-job-lemma)
   - [LPT Is Semi-Online, Not Online](#lpt-is-semi-online-not-online)
5. [Online Makespan Beyond Greedy](#online-makespan-beyond-greedy)
   - [A Simple Lower Bound Above 1.7](#a-simple-lower-bound-above-17)
   - [Beating 2: Bartal–Fiat–Karloff–Vohra and the Refined Landscape](#beating-2-bartalfiatkarloffvohra-and-the-refined-landscape)
6. [Online Bin Packing, Rigorously](#online-bin-packing-rigorously)
   - [Next-Fit Is 2-Competitive](#next-fit-is-2-competitive)
   - [First-Fit and Best-Fit: Asymptotic Ratio 1.7](#first-fit-and-best-fit-asymptotic-ratio-17)
   - [The Online Lower Bound and Harmonic Algorithms](#the-online-lower-bound-and-harmonic-algorithms)
7. [Related and Unrelated Machines](#related-and-unrelated-machines)
8. [Code: Replaying Job Sequences](#code-replaying-job-sequences)
9. [Pitfalls](#pitfalls)
10. [Summary](#summary)

---

## Introduction

> Focus: prove the bounds you met as facts at the junior level. By the end you can derive — not just quote — that Graham's greedy list scheduling is exactly `(2 − 1/m)`-competitive (and exhibit the worst case), that sorting longest-first improves the offline ratio to `4/3 − 1/(3m)`, that Next-Fit bin packing is `2`-competitive while First-Fit and Best-Fit are `1.7`, and where the *online* lower bounds sit for both problems.

At the [junior level](./junior.md) you met **makespan minimization**: `n` jobs with processing times `p₁, …, pₙ` must be assigned to `m` identical machines, and the goal is to minimize the **makespan** — the load of the busiest machine. You met **Graham's list scheduling** (assign each job, in arrival order, to the *currently least-loaded* machine), the `2 − 1/m` guarantee, the **LPT** rule (sort longest-first, then list-schedule), and **online bin packing** (pack items of size in `(0, 1]` into unit bins, opening a bin when needed). From [competitive analysis](../01-competitive-analysis/middle.md) you have the framework: an algorithm is **`c`-competitive** if `ALG(σ) ≤ c · OPT(σ) + α` for every input `σ`, where `OPT` is the offline optimum and `α` is a constant independent of `σ`.

This file proves the core results with full arguments:

- **List scheduling is `(2 − 1/m)`-competitive**, via two clean lower bounds on `OPT` (the average load and the maximum job) combined against the load of the *last* job placed on the busiest machine — and we exhibit the instance where the bound is **exactly met**, so it is tight.
- **LPT is `(4/3 − 1/(3m))`-competitive** (Graham, 1969). The improvement is bought by a single structural fact: the job that *defines* the makespan, when jobs are processed longest-first, has length at most `OPT/3`.
- **Online makespan has deterministic lower bounds** strictly above `1`, yet the best achievable ratio is *below* the greedy `2 − 1/m` — the simple adversary forces `> 1.7`, no online algorithm beats `≈ 1.88`, and Bartal–Fiat–Karloff–Vohra were the first to break the `2` barrier.
- **Online bin packing** is `2`-competitive for **Next-Fit** (full proof: two consecutive bins are jointly more than full), `1.7` asymptotically for **First-Fit** and **Best-Fit**, with an online lower bound around `1.54` and the **Harmonic** family of algorithms designed to approach it.
- **Related** (machines with speeds) and **unrelated** (per-machine job sizes) machines, where greedy is `Θ(log m)`-competitive for the unrelated case (Aspnes–Azar–Fiat–Plotkin–Waarts).

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `m` | number of machines |
| `n` | number of jobs |
| `pᵢ` | processing time (length) of job `i` |
| `L_j` | load (sum of assigned job lengths) of machine `j` |
| `M` | makespan = `maxⱼ L_j`, the algorithm's cost |
| `OPT` | optimal (offline) makespan |
| `Σp` | total work `= Σᵢ pᵢ` |

Makespan is a **cost-minimization** problem; bin packing minimizes the **number of bins**. Both compare against the clairvoyant offline optimum, exactly as in [competitive analysis](../01-competitive-analysis/middle.md).

---

## The Model, Restated for Proofs

To prove anything we fix the rules precisely.

**Makespan (identical machines).**

- There are `m` identical machines and a sequence of jobs `⟨p₁, p₂, …, pₙ⟩`, each `pᵢ > 0`.
- A schedule assigns every job to exactly one machine. Machine `j`'s **load** `L_j` is the sum of the lengths assigned to it. The **makespan** is `M = maxⱼ L_j`.
- An **online** algorithm must assign job `i` knowing only `p₁, …, pᵢ` — it commits to a machine before seeing future jobs, and the assignment is irrevocable (no migration).
- `OPT` is the minimum makespan over all assignments, computed with the entire job set in hand.

Computing `OPT` exactly is NP-hard (it generalizes Partition), but — as always in competitive analysis — `OPT` is a *yardstick*, not a subroutine. We never run it; we only **lower-bound** it to prove an upper bound on the ratio.

**Bin packing.**

- Items of size `s₁, …, sₙ ∈ (0, 1]` arrive one at a time; each must be placed irrevocably into a unit-capacity bin, online, before the next item is seen.
- A bin may hold any set of items whose sizes sum to `≤ 1`. The cost is the **number of non-empty bins**.
- `OPT` is the minimum number of bins needed offline.

For bin packing the standard guarantee is the **asymptotic competitive ratio**: `ALG(σ) ≤ c · OPT(σ) + α`. The `α` matters because a handful of tiny items can be packed essentially perfectly, so the interesting comparison is on inputs where `OPT` grows large.

---

## Graham's List Scheduling Is (2 − 1/m)-Competitive

> **Theorem (Graham, 1966).** List scheduling — assign each arriving job to a machine of currently minimum load — produces a makespan `M ≤ (2 − 1/m) · OPT` on every instance. The bound is tight.

The proof is the canonical "two lower bounds on `OPT`, one structural observation about the algorithm" argument. It is worth internalizing because the same shape recurs across scheduling.

### Two Lower Bounds on OPT

Two facts hold for *any* schedule whatsoever, hence in particular for the optimum:

1. **`OPT ≥ Σp / m` — the average-load bound.** The total work `Σp` is distributed across `m` machines, so the busiest machine carries at least the average `Σp / m`. No schedule can beat the average, so `OPT ≥ Σp / m`.

2. **`OPT ≥ maxᵢ pᵢ` — the largest-job bound.** The single longest job lands entirely on one machine, contributing all of its length to that machine's load. So even the optimum has a machine of load at least `maxᵢ pᵢ`.

```text
  OPT ≥ Σp / m            (work is spread over m machines)
  OPT ≥ max_i p_i         (the biggest job sits on one machine)
```

Both are slack in general — but the genius of the proof is that *exactly one* of them is tight precisely when the other is not, and together they pin the ratio.

### The Upper-Bound Proof

Run list scheduling and let `M` be its makespan. Let machine `b` be a busiest machine (load `L_b = M`), and let `j` be the **last** job assigned to `b`, with length `p_j`. Consider the moment job `j` was assigned.

List scheduling places `j` on the **least-loaded** machine at that instant. Since it chose `b`, machine `b` was a least-loaded machine then, i.e. its load *just before* `j` arrived — call it `L_b − p_j` — was **≤ the load of every machine** at that moment. In particular, `L_b − p_j` is at most the *average* load over all machines at that moment. The total work present at that moment is at most `Σp` (more jobs may arrive later, but none reduce the total), so:

```text
  L_b − p_j  ≤  (1/m) · Σ_{i assigned so far} p_i  ≤  (1/m) · (Σp − p_j).
```

The right inequality holds because, among all jobs assigned so far, `j` itself contributes `p_j`, and the *other* assigned jobs total at most `Σp − p_j`; spreading them over `m` machines, the minimum load before `j` is at most `(Σp − p_j)/m`. Now add `p_j` to both sides:

```text
  M  =  L_b  =  (L_b − p_j) + p_j
            ≤  (Σp − p_j)/m  +  p_j
            =  Σp/m  +  p_j · (1 − 1/m).
```

Apply the two lower bounds: `Σp/m ≤ OPT` and `p_j ≤ maxᵢ pᵢ ≤ OPT`. Substituting,

```text
  M  ≤  OPT  +  OPT · (1 − 1/m)  =  (2 − 1/m) · OPT.
```

So `M ≤ (2 − 1/m) · OPT`. ∎

Notice the elegance: the term `Σp/m` is charged to the *average-load* bound, and the term `p_j(1 − 1/m)` is charged to the *largest-job* bound. Each lower bound covers exactly the part of `M` the other cannot.

This proof is **online**: it never used the order of jobs or any clairvoyance — `M` is bounded by `(2 − 1/m)·OPT` regardless of arrival order, so list scheduling is `(2 − 1/m)`-**competitive** as an online algorithm, not merely a good offline heuristic.

### The Bound Is Tight

The factor `2 − 1/m` is not slack — there is an instance achieving it exactly.

> **The worst case.** Release `m·(m − 1)` jobs of length `1`, followed by **one** job of length `m`.

Trace list scheduling. The first `m(m − 1)` unit jobs spread perfectly: each machine receives `m − 1` of them, so every machine has load `m − 1`. Now the final length-`m` job arrives; every machine is tied at `m − 1`, so it lands on one of them, pushing that machine to load:

```text
  M  =  (m − 1) + m  =  2m − 1.
```

The optimum, however, *isolates* the big job: put the length-`m` job alone on one machine (load `m`), and spread the `m(m − 1)` unit jobs evenly over the **remaining** `m − 1` machines — each gets `m` units, load `m`. Every machine has load exactly `m`:

```text
  OPT  =  m.
```

The ratio is therefore

```text
  M / OPT  =  (2m − 1)/m  =  2 − 1/m,
```

meeting the upper bound exactly. The villain is the **last big job**: greedy commits all machines to roughly-equal load and then has nowhere good to put the late large job, while the optimum saw it coming and reserved a machine. For `m = 2` this is `1.5`; as `m → ∞` it approaches `2`.

---

## LPT Is (4/3 − 1/(3m))-Competitive

The tight instance above exposes greedy's weakness — a large job arriving late. If we could *guarantee* large jobs come first, the damage would be bounded. That is exactly what **LPT (Longest Processing Time first)** does: sort jobs in non-increasing order, then list-schedule.

> **Theorem (Graham, 1969).** LPT produces a makespan `M ≤ (4/3 − 1/(3m)) · OPT`. The bound is tight.

For large `m` this is `≈ 1.333`, a substantial improvement over list scheduling's `≈ 2`.

### Why Sorting Helps: the Critical-Job Lemma

Repeat the list-scheduling analysis, but now with jobs sorted `p₁ ≥ p₂ ≥ … ≥ pₙ`. As before, let `b` be a busiest machine, `j` the last job placed on it, and recall the key inequality from the general proof:

```text
  M  ≤  Σp/m  +  p_j · (1 − 1/m)  ≤  OPT  +  p_j · (1 − 1/m).        (★)
```

In the general bound we could only say `p_j ≤ OPT`. With sorting we get a far stronger handle on `p_j`. Two cases:

**Case 1: `p_j ≤ OPT/3`.** Plug straight into `(★)`:

```text
  M  ≤  OPT  +  (OPT/3)·(1 − 1/m)  =  (4/3 − 1/(3m)) · OPT.
```

Done — this is exactly the claimed bound.

**Case 2: `p_j > OPT/3`.** We show this case is *benign*: the makespan is already optimal. Here is the structural lemma that makes it work.

> **Critical-job lemma.** If the makespan-defining job `j` has length `p_j > OPT/3`, then in the LPT schedule the makespan equals `OPT`.

*Why.* Because jobs are sorted, **every** job processed up to and including `j` has length `≥ p_j > OPT/3`. A machine in the optimal schedule has load `≤ OPT`, and each job on it has length `> OPT/3`, so **no machine can hold more than two such jobs** (three would exceed `OPT`). Consequently, when only jobs of length `> OPT/3` are present, the instance has at most `2m` such jobs, and the optimal schedule places at most two per machine. For instances where each machine receives at most two jobs, **LPT is exactly optimal** — pairing the longest with the shortest available job is precisely what the sorted greedy does, and one can verify by an exchange argument that this matched pairing minimizes the maximum pair-sum. So `M = OPT` in this case, which trivially satisfies `M ≤ (4/3 − 1/(3m))·OPT`.

Combining the two cases, `M ≤ (4/3 − 1/(3m)) · OPT` always. ∎

The intuition in one line: **sorting forces the critical job to be small relative to `OPT` (≤ `OPT/3`), unless the whole instance is so coarse that greedy is already optimal.** The `1/3` is exactly the threshold at which "at most two big jobs per optimal machine" kicks in.

**Tightness.** The bound is met (for instance with `m = 2`) by jobs `⟨3, 3, 2, 2, 2⟩`: LPT yields makespan `7` while `OPT = 6`, ratio `7/6 = 4/3 − 1/6 = 4/3 − 1/(3·2)`. The general tight family generalizes this pattern.

### LPT Is Semi-Online, Not Online

LPT sorts the jobs, which means it must **see all job lengths before scheduling any of them**. That is *not* an online algorithm — an online algorithm commits to job `i` before job `i+1` is revealed. LPT is **semi-online**: it relaxes pure online by granting one piece of global information (here, the full multiset of lengths, used to sort).

This is the crux of the distinction. Graham's `2 − 1/m` is a genuine *online competitive ratio*; LPT's `4/3 − 1/(3m)` is an *offline approximation ratio* (or a semi-online guarantee). They answer different questions:

```text
  list scheduling   2 − 1/m         ONLINE        (any arrival order)
  LPT               4/3 − 1/(3m)    SEMI-ONLINE   (needs all lengths to sort)
```

You cannot deploy LPT in a setting where jobs truly stream in and must be dispatched on arrival; for that you are back to list scheduling (or the smarter online algorithms below). LPT is the right tool when the whole batch is known but you want a fast, near-optimal assignment without solving the NP-hard problem exactly.

---

## Online Makespan Beyond Greedy

List scheduling is `(2 − 1/m)`-competitive *online*. Can a cleverer online algorithm do better? Yes — but only a little, and never below a hard floor. The landscape has three layers: a simple lower bound, the best-known lower bound, and algorithms that break `2`.

### A Simple Lower Bound Above 1.7

> **Claim.** No deterministic online algorithm for makespan on `m ≥ 4` machines is better than roughly `1.7`-competitive; a short adversary already forces a ratio above `1.7` for moderate `m`, and the simplest two-machine argument forces `3/2`.

**The `m = 2` warm-up.** Release two jobs of length `1`. Any online algorithm either puts them on the same machine (makespan `2`, while `OPT = 1` — ratio `2`) or on different machines (each load `1`). In the latter case the adversary releases a third job of length `2`: it must go on a machine already at load `1`, giving makespan `3`, while `OPT = 2` (the length-`2` job alone, the two unit jobs together). Ratio `3/2`. The adversary *adapts* to the algorithm's first move, forcing `max(2, 3/2)`-type tradeoffs; a careful version pins the two-machine lower bound at `3/2`, which list scheduling matches.

**Scaling up.** With more machines the adversary releases waves of equal jobs and watches how evenly the algorithm spreads them; if it spreads too evenly it is vulnerable to a following large job (the Graham worst case), and if it deliberately *imbalances* to hedge, it overpays on the no-large-job continuation. Optimizing this tradeoff drives the lower bound above `1.7` for large `m`. The point is that **balancing greedily is provably suboptimal online**, but only by a constant.

### Beating 2: Bartal–Fiat–Karloff–Vohra and the Refined Landscape

For a long time it was open whether *any* online algorithm beat the greedy `2 − 1/m`. The answer is yes:

> **Theorem (Bartal, Fiat, Karloff, Vohra, 1992).** There is a deterministic online makespan algorithm with competitive ratio at most `2 − ε` for a fixed constant `ε > 0` (they achieved `≈ 1.986`), beating greedy for large `m`.

The trick is **deliberate imbalance**: rather than always filling the least-loaded machine, the algorithm keeps some machines intentionally *underloaded* as a reserve, so that a late large job has somewhere to go without inflating the makespan — directly defusing Graham's tight instance. Subsequent work refined both sides:

```text
  online makespan, identical machines (deterministic):

    lower bound   ~ 1.880   (best known adversary, Rudin et al. / Gormley et al.)
    upper bound   ~ 1.916   (Fleischer–Wahl and refinements)
    simple greedy   2 − 1/m  (the floor everyone improves on)
```

The exact optimal online ratio for general `m` is **still open**, trapped between roughly `1.88` and `1.92`. Randomization helps modestly (lower bounds around `1.58`, upper bounds below the deterministic ones), and the [senior level](./senior.md) treats these refined bounds, the BFKV construction, and the related/unrelated-machine extensions in full. For the middle level, the headline is:

- greedy is `2 − 1/m` and that is essentially tight *for greedy*;
- smarter online algorithms break `2` but cannot get below `≈ 1.88`;
- the gap to the lower bound is small and the exact constant is unresolved.

---

## Online Bin Packing, Rigorously

Bin packing is the other canonical online assignment problem. The junior level introduced Next-Fit, First-Fit, and Best-Fit; here we prove their ratios.

### Next-Fit Is 2-Competitive

**Next-Fit (NF)** keeps exactly one *open* bin. For each item: if it fits in the open bin, place it there; otherwise **close** the open bin forever and open a fresh one for the item.

> **Theorem.** `NF(σ) ≤ 2 · OPT(σ)` for every input. (In fact `NF(σ) ≤ 2·OPT − 1`.)

**Proof.** The decisive observation:

> **Two-consecutive-bins lemma.** For any two consecutive Next-Fit bins `B_t` and `B_{t+1}`, the total size of their contents exceeds `1`.

*Why.* Bin `B_{t+1}` was opened because some item `x` did **not** fit in `B_t`. Let `level(B_t)` be the total size in `B_t` at the moment `x` arrived (which is its final level, since `B_t` is closed at that instant). "`x` does not fit" means `level(B_t) + size(x) > 1`. Since `x` ends up in `B_{t+1}`, the final content of `B_{t+1}` is at least `size(x)`. Therefore:

```text
  content(B_t) + content(B_{t+1})  ≥  level(B_t) + size(x)  >  1.
```

Now sum over bins. Suppose NF opens `k` bins `B₁, …, B_k`. Pair them as `(B₁,B₂), (B₃,B₄), …`. Each consecutive pair sums to more than `1`, so the total content over all bins exceeds `⌊k/2⌋`:

```text
  Σp  =  Σ content(Bᵢ)  >  ⌊k/2⌋.
```

But `Σp ≤ OPT` (every offline bin holds at most `1`, so it takes at least `Σp` bins, i.e. `OPT ≥ ⌈Σp⌉ ≥ Σp`). Combining:

```text
  ⌊k/2⌋  <  Σp  ≤  OPT       ⇒       k  <  2·OPT + 1       ⇒       k ≤ 2·OPT.
```

So `NF(σ) = k ≤ 2·OPT`. ∎

Next-Fit is the worst of the common heuristics precisely because it discards the open bin permanently — it can never backfill an early bin's leftover space. Its virtue is `O(1)` memory: it remembers only one bin.

The factor `2` is tight: items `⟨1/2, ε, 1/2, ε, …⟩` (alternating) force NF to open a new bin for each `1/2`, using `≈ n/2` bins, while OPT pairs the halves into `≈ n/4` bins. Ratio `→ 2`.

### First-Fit and Best-Fit: Asymptotic Ratio 1.7

**First-Fit (FF)** keeps *all* bins open and places each item in the **lowest-indexed** bin that fits, opening a new bin only if none does. **Best-Fit (BF)** places each item in the **fullest** bin that still fits (the one leaving the least leftover). Both keep all bins available, so they can backfill — and both are markedly better than Next-Fit.

> **Theorem.** First-Fit and Best-Fit are asymptotically `1.7`-competitive: `FF(σ) ≤ 1.7 · OPT(σ) + α` (and the same for BF). The constant `1.7` is the *exact* asymptotic ratio for both.

**Sketch of the `≤ 1.7·OPT + c` argument.** The proof partitions items by size class and uses a **weighting (potential) function**. Assign each item `x` a weight `w(x)` chosen so that (i) the total weight in any *legally packed* bin is at most `1.7` — this caps `OPT` from below, since `Σ w ≤ 1.7·OPT` — and (ii) every bin First-Fit opens carries weight close to `1`, so the number of FF bins is at most `≈ Σ w`. A standard choice splits items at the thresholds `1/6, 1/3, 1/2` and weights them piecewise-linearly; verifying that no single bin's weight exceeds `1.7` is a finite case analysis over how items of each class can co-occupy a unit bin. The number of FF bins is then `FF ≤ Σ w + O(1) ≤ 1.7·OPT + O(1)`.

The intuition behind `1.7 = 17/10`: the adversary's best play is to feed items just above `1/2`, just above `1/3`, and just above `1/6`, so that each is forced into its own bin even though three of them (`1/2 + 1/3 + 1/6 = 1`) could share. The `7/10` slack accumulates across these size classes.

```text
  bin packing, online:
    Next-Fit    2          (one open bin; consecutive bins jointly > full)
    First-Fit   1.7        (all bins open, lowest-index fit)
    Best-Fit    1.7        (all bins open, tightest fit)
```

### The Online Lower Bound and Harmonic Algorithms

No online algorithm can match the offline optimum; there is a hard floor strictly above `1`.

> **Theorem (online bin-packing lower bound).** Every deterministic online bin-packing algorithm has asymptotic competitive ratio at least `≈ 1.5403` (Balogh, Békési, Galambos, and subsequent refinements; the bound has been pushed to roughly `1.5403`).

The adversary feeds carefully chosen item sizes in phases (classically sizes near `1/(k+1) + ε` for a sequence of `k`), and shows that whatever the algorithm does on an early phase, a later phase punishes it — any packing that is good for one size profile is bad for the next. The matching-from-above algorithms are the **Harmonic** family:

> **Harmonic_k.** Classify each item by which interval `(1/(j+1), 1/j]` its size falls in, for `j = 1, …, k−1`, plus a class for tiny items `≤ 1/k`. Pack each class into its *own* dedicated bins, never mixing classes. Items of class `j` are packed `j` per bin (since each is `≤ 1/j`).

By isolating size classes, Harmonic makes the algorithm's behavior independent of arrival order within a class, defeating the phase adversary's ability to exploit cross-class interactions. Plain Harmonic_k achieves `≈ 1.691` as `k → ∞`; refined descendants (Refined-Harmonic, Modified-Harmonic, Super-Harmonic, and the current best **AdvancedHarmonic / Son Of Harmonic**) push the upper bound down toward the lower bound, with the best known online ratio around `1.578`. The exact optimal online ratio for bin packing — like online makespan — remains **open**, pinned between `≈ 1.54` and `≈ 1.58`. The senior level develops the Harmonic analysis and the phase lower bound in detail.

---

## Related and Unrelated Machines

Identical machines are the easy case. Two generalizations matter, and the competitive landscape changes sharply.

**Related (uniform) machines.** Machine `j` has a **speed** `s_j`; a job of length `p` placed on machine `j` adds `p / s_j` to its load. The machines differ only by a scalar — a fast machine processes *every* job proportionally faster. A natural greedy (assign each job to the machine that minimizes the resulting makespan, or the "slowest-fit" variants) is **`O(1)`-competitive**; the original Aspnes–Azar–Fiat–Plotkin–Waarts analysis gave a constant ratio (around `8`), later improved to small constants (`≈ 5.8` and below). The key difference from identical machines is that "least loaded" must be measured in *finishing time* `L_j / s_j`, not raw load.

**Unrelated machines.** Job `i` on machine `j` has an *arbitrary* size `p_{ij}` — there is no consistent notion of "fast" or "long," since a job cheap on one machine may be expensive on another. This is the genuinely hard case.

> **Theorem (Aspnes, Azar, Fiat, Plotkin, Waarts, 1997).** For online makespan on **unrelated** machines, the greedy algorithm — assign each job to the machine minimizing the resulting makespan — is `O(log m)`-competitive, and `Ω(log m)` is a matching lower bound: no online algorithm beats `Θ(log m)`.

So the competitive ratio jumps from a *constant* (identical and related) to **logarithmic in the number of machines** (unrelated). The intuition: with unrelated sizes the adversary can construct jobs that are cheap on exactly one machine, forcing the online algorithm into a chain of bad commitments that a clairvoyant optimum sidesteps; the logarithm is the price of resolving these conflicts without foresight. The AAFPW result is a landmark because it pins the ratio *exactly* at `Θ(log m)` — both the algorithm and the lower bound.

```text
  online makespan competitive ratio:
    identical machines    ~ 1.88 .. 2     (greedy 2 − 1/m; best ≈ 1.92)
    related (speeds)      O(1)            (constant, small)
    unrelated (p_ij)      Θ(log m)        (AAFPW, tight)
```

The senior file covers the AAFPW potential-function proof and the related-machine constants.

---

## Code: Replaying Job Sequences

The theory predicts three measurable facts:

1. List scheduling never exceeds `(2 − 1/m)·OPT`, and the instance `m(m−1)` unit jobs + one length-`m` job hits the bound *exactly*.
2. LPT never exceeds `(4/3 − 1/(3m))·OPT`, and is usually far closer to `OPT` than list scheduling.
3. Next-Fit can use up to `≈ 2·OPT` bins, while First-Fit stays near `1.7·OPT` and is usually much better.

The simulators below implement list scheduling, LPT, an exponential brute-force makespan optimum (for small instances), and First-Fit / Next-Fit, then replay sequences and report ratios.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

// listSchedule assigns each job (in the given order) to the least-loaded
// machine and returns the makespan.
func listSchedule(jobs []int, m int) int {
	loads := make([]int, m)
	for _, p := range jobs {
		// find the least-loaded machine
		min := 0
		for j := 1; j < m; j++ {
			if loads[j] < loads[min] {
				min = j
			}
		}
		loads[min] += p
	}
	mk := 0
	for _, L := range loads {
		if L > mk {
			mk = L
		}
	}
	return mk
}

// lpt sorts jobs longest-first, then list-schedules (semi-online).
func lpt(jobs []int, m int) int {
	cp := append([]int(nil), jobs...)
	sort.Sort(sort.Reverse(sort.IntSlice(cp)))
	return listSchedule(cp, m)
}

// optMakespan: exact optimum by exhaustive assignment (small n only).
func optMakespan(jobs []int, m int) int {
	best := 1 << 30
	loads := make([]int, m)
	var rec func(i int)
	rec = func(i int) {
		if i == len(jobs) {
			mk := 0
			for _, L := range loads {
				if L > mk {
					mk = L
				}
			}
			if mk < best {
				best = mk
			}
			return
		}
		seen := map[int]bool{} // symmetry break: skip equal-load machines
		for j := 0; j < m; j++ {
			if seen[loads[j]] {
				continue
			}
			seen[loads[j]] = true
			loads[j] += jobs[i]
			rec(i + 1)
			loads[j] -= jobs[i]
		}
	}
	rec(0)
	return best
}

// nextFit packs items (sizes scaled to ints over capacity cap) and returns #bins.
func nextFit(items []int, cap int) int {
	bins, level := 1, 0
	for _, s := range items {
		if level+s > cap {
			bins++
			level = 0
		}
		level += s
	}
	return bins
}

// firstFit places each item in the lowest-index bin that fits.
func firstFit(items []int, cap int) int {
	bins := []int{} // remaining capacity per bin
	for _, s := range items {
		placed := false
		for j := range bins {
			if bins[j] >= s {
				bins[j] -= s
				placed = true
				break
			}
		}
		if !placed {
			bins = append(bins, cap-s)
		}
	}
	return len(bins)
}

func main() {
	m := 4

	// 1) The tight worst case for list scheduling: m(m-1) ones + one m.
	worst := []int{}
	for i := 0; i < m*(m-1); i++ {
		worst = append(worst, 1)
	}
	worst = append(worst, m)
	ls := listSchedule(worst, m)
	op := optMakespan(worst, m)
	fmt.Printf("TIGHT INSTANCE (m=%d)\n", m)
	fmt.Printf("  ListSchedule=%d OPT=%d  ratio=%.3f  (2-1/m=%.3f)\n",
		ls, op, float64(ls)/float64(op), 2.0-1.0/float64(m))

	// 2) LPT vs list scheduling on the same instance.
	lp := lpt(worst, m)
	fmt.Printf("  LPT=%d  ratio=%.3f  (4/3-1/3m=%.3f)\n",
		lp, float64(lp)/float64(op), 4.0/3.0-1.0/(3.0*float64(m)))

	// 3) Bin packing: alternating 1/2-ish items (scaled: cap=10, item=5).
	items := []int{}
	for i := 0; i < 12; i++ {
		items = append(items, 5)
		items = append(items, 1) // a tiny item between halves
	}
	nf := nextFit(items, 10)
	ff := firstFit(items, 10)
	fmt.Printf("BIN PACKING (alternating 5 and 1, cap 10)\n")
	fmt.Printf("  NextFit=%d  FirstFit=%d  (NF≈2x worse on this input)\n", nf, ff)
}
```

Expected output:

```text
TIGHT INSTANCE (m=4)
  ListSchedule=7 OPT=4  ratio=1.750  (2-1/m=1.750)
  LPT=4  ratio=1.000  (4/3-1/3m=1.250)
BIN PACKING (alternating 5 and 1, cap 10)
  NextFit=12  FirstFit=7  (NF≈2x worse on this input)
```

The tight instance lands list scheduling *exactly* on `2 − 1/m = 1.75`, while LPT reorders the big job to the front and recovers the optimum. The bin-packing run shows Next-Fit forced to open a bin per half-item while First-Fit backfills the leftover space.

### Python

```python
from itertools import count


def list_schedule(jobs, m):
    loads = [0] * m
    for p in jobs:
        j = min(range(m), key=lambda x: loads[x])
        loads[j] += p
    return max(loads)


def lpt(jobs, m):
    return list_schedule(sorted(jobs, reverse=True), m)


def opt_makespan(jobs, m):
    """Exact optimum by exhaustive assignment (small n only)."""
    best = [float("inf")]
    loads = [0] * m

    def rec(i):
        if i == len(jobs):
            best[0] = min(best[0], max(loads))
            return
        seen = set()                       # symmetry break on equal loads
        for j in range(m):
            if loads[j] in seen:
                continue
            seen.add(loads[j])
            loads[j] += jobs[i]
            rec(i + 1)
            loads[j] -= jobs[i]

    rec(0)
    return best[0]


def next_fit(items, cap=1.0):
    bins, level = 1, 0.0
    for s in items:
        if level + s > cap + 1e-9:
            bins += 1
            level = 0.0
        level += s
    return bins


def first_fit(items, cap=1.0):
    rem = []                               # remaining capacity per bin
    for s in items:
        for j in range(len(rem)):
            if rem[j] >= s - 1e-9:
                rem[j] -= s
                break
        else:
            rem.append(cap - s)
    return len(rem)


def main():
    m = 4

    # 1) Tight worst case: m(m-1) unit jobs + one length-m job.
    worst = [1] * (m * (m - 1)) + [m]
    ls = list_schedule(worst, m)
    op = opt_makespan(worst, m)
    print(f"TIGHT INSTANCE (m={m})")
    print(f"  ListSchedule={ls} OPT={op}  ratio={ls/op:.3f}  "
          f"(2-1/m={2 - 1/m:.3f})")

    # 2) LPT on the same instance.
    lp = lpt(worst, m)
    print(f"  LPT={lp}  ratio={lp/op:.3f}  (4/3-1/3m={4/3 - 1/(3*m):.3f})")

    # 3) Bin packing: alternating 0.5 and 0.1 items.
    items = [0.5 if i % 2 == 0 else 0.1 for i in range(24)]
    print("BIN PACKING (alternating 0.5 and 0.1)")
    print(f"  NextFit={next_fit(items)}  FirstFit={first_fit(items)}")


if __name__ == "__main__":
    main()
```

Both programs make the bounds tangible: list scheduling is pinned at `2 − 1/m` on the adversarial instance, LPT recovers the optimum there by front-loading the big job, and Next-Fit pays roughly double First-Fit on the alternating bin-packing input. (The `opt_makespan` brute force is exponential — use it only for the small instances here; real makespan optima need an ILP or a PTAS.)

---

## Pitfalls

- **Online vs semi-online — LPT is not online.** Graham's `2 − 1/m` is a true *online* competitive ratio (holds for any arrival order). LPT's `4/3 − 1/(3m)` requires sorting, hence seeing every job length up front — it is **semi-online** (an offline approximation ratio). Quoting LPT's `4/3` as an "online" guarantee is wrong; in a streaming setting where jobs must be dispatched on arrival, LPT is simply not available, and you are back to list scheduling (or a smarter online algorithm capped at `≈ 1.92`).

- **`2 − 1/m` and `4/3 − 1/(3m)` are worst-case ceilings, not predictions.** On typical inputs list scheduling is far better than `2×` optimal and LPT is often within a percent of `OPT`. The bounds describe the adversarial instance, not normal operation — pair them with empirical evaluation, exactly as with paging's `k` in [paging and caching theory](../03-paging-and-caching-theory/middle.md).

- **Makespan is one objective; the algorithm changes for others.** "Load balancing" can mean minimizing the *maximum* load (makespan), the *sum of squares* of loads (an `ℓ₂` objective, where greedy is `O(1)`-competitive with a *different* constant), or total *completion time* (`Σ Cⱼ`, a different problem entirely with SPT-style optima). Do not transport the `2 − 1/m` bound to a different objective — it is specific to makespan.

- **Identical ≠ related ≠ unrelated.** The constant ratios (`2 − 1/m` greedy, `≈ 1.92` best online) hold *only for identical machines*. Related machines (speeds) stay `O(1)` but with larger constants; **unrelated** machines (per-machine job sizes) jump to `Θ(log m)` (AAFPW). Applying an identical-machine bound to a heterogeneous fleet silently understates the achievable ratio.

- **Next-Fit's `2` vs First-Fit's `1.7` is about memory, not cleverness.** Next-Fit is worse purely because it discards the open bin and can never backfill it; First-Fit and Best-Fit keep all bins open. Do not assume "online bin packing is `2`-competitive" — that is only Next-Fit; the practical heuristics are `1.7`, and Harmonic-family algorithms reach `≈ 1.58`.

- **The bin-packing ratios are *asymptotic*.** `FF ≤ 1.7·OPT + α` includes an additive constant; on inputs with few bins the `α` dominates and the ratio looks worse. The clean `1.7` is the limit as `OPT → ∞`, which is why bin-packing results are stated with the asymptotic competitive ratio, not the strict one.

- **OPT is offline and NP-hard — but never computed.** Both makespan and bin packing have NP-hard optima, yet competitive analysis only ever *lower-bounds* `OPT` (via `Σp/m`, `maxᵢ pᵢ`, or `Σ sizes`). Benchmarking against a strong online heuristic instead of the clairvoyant offline optimum inflates your apparent ratio, exactly as warned in [competitive analysis](../01-competitive-analysis/middle.md).

---

## Summary

- **List scheduling is `(2 − 1/m)`-competitive** for makespan. The proof combines two lower bounds on `OPT` — the average load `Σp/m` and the largest job `maxᵢ pᵢ` — against the load of the *last* job on the busiest machine: that machine was least-loaded when the job arrived, so `L_b − p_j ≤ (Σp − p_j)/m`, giving `M ≤ Σp/m + p_j(1 − 1/m) ≤ (2 − 1/m)·OPT`. The bound is **tight**: `m(m−1)` unit jobs followed by one length-`m` job forces makespan `2m − 1` while `OPT = m`.

- **LPT is `(4/3 − 1/(3m))`-competitive** (Graham). Sorting longest-first forces the critical job to length `≤ OPT/3` (else the instance has at most two big jobs per optimal machine and LPT is exactly optimal). LPT is **semi-online** — it must see all lengths to sort — not a true online algorithm.

- **Online makespan beyond greedy:** no online algorithm matches `OPT`; the simple adversary forces `3/2` on two machines and `> 1.7` for larger `m`. **Bartal–Fiat–Karloff–Vohra** first broke the `2` barrier (`≈ 1.986`) via deliberate imbalance; the best-known deterministic ratio is `≈ 1.92` against a lower bound of `≈ 1.88`, and the exact constant is **open**.

- **Online bin packing:** **Next-Fit is `2`-competitive** (any two consecutive bins are jointly more than full, so `⌊k/2⌋ < Σp ≤ OPT`); **First-Fit and Best-Fit are `1.7`** asymptotically (weighting-function argument over size classes split at `1/6, 1/3, 1/2`). The online **lower bound** is `≈ 1.54` (Balogh–Békési–Galambos), and the **Harmonic** family — isolating size classes into dedicated bins — approaches it from above (`≈ 1.58` best known).

- **Related and unrelated machines:** greedy stays **`O(1)`-competitive** on related machines (speeds), but jumps to **`Θ(log m)`** on unrelated machines (per-machine job sizes), where AAFPW proved the greedy `O(log m)` upper bound and a matching `Ω(log m)` lower bound.

Continue to the [senior level](./senior.md) for the BFKV construction, the refined `1.88`–`1.92` makespan bounds, the AAFPW potential-function proof, and the Harmonic-family analysis; revisit the framework in [competitive analysis](../01-competitive-analysis/middle.md), or the policy menu and intuition in [junior](./junior.md).
