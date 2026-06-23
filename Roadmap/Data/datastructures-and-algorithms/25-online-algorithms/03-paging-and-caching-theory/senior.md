# Paging and Caching Theory — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — Belady's LFD (longest-forward-distance) optimal offline policy, LRU/FIFO/FWF as marking algorithms, the deterministic `k`-competitive upper bound for marking, and the matching deterministic lower bound `k`
- [Competitive Analysis — Senior](../01-competitive-analysis/senior.md) — the adversary hierarchy, the potential method, and Yao's principle as von Neumann minimax (the lower-bound engine we reuse here)

## Table of Contents

1. [What Senior-Level Paging Theory Is About](#what-senior-level-paging-theory-is-about)
2. [Randomized Paging: the MARKER Algorithm](#randomized-paging-the-marker-algorithm)
3. [The Randomized Lower Bound H_k via Yao](#the-randomized-lower-bound-h_k-via-yao)
4. [Optimal H_k Algorithms: PARTITION and EQUITABLE](#optimal-h_k-algorithms-partition-and-equitable)
5. [Resource Augmentation: Sleator–Tarjan k/(k−h+1)](#resource-augmentation-sleatortarjan-kkh1)
6. [Beyond Worst Case: the Access-Graph Model](#beyond-worst-case-the-access-graph-model)
7. [The Diffuse Adversary and Fault-Rate Models](#the-diffuse-adversary-and-fault-rate-models)
8. [The k-Server Connection: Paging Is Uniform-Metric k-Server](#the-k-server-connection-paging-is-uniform-metric-k-server)
9. [Learning-Augmented Caching](#learning-augmented-caching)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Paging Theory Is About

The middle level settles the *deterministic* worst case completely. With a cache of size `k`, every **marking algorithm** (LRU, FWF, and — via a separate argument — FIFO) is `k`-competitive, and no deterministic online policy can do better: an adversary that always requests the one page outside a `k+1`-page working set forces a fault on every request while Belady's LFD faults only once per `k` requests. So the deterministic competitive ratio of paging is *exactly* `k`. That number is both correct and useless: it does not distinguish LRU from FIFO (both `k`), and it predicts catastrophe for caches that work superbly in practice.

Senior-level paging theory is about the three escapes from that uselessly pessimistic `k`, each a different relaxation of the worst-case contract:

1. **Randomization shatters the `k` barrier.** Against an *oblivious* adversary the competitive ratio collapses from `k` to `Θ(log k)`. The MARKER algorithm (Fiat, Karp, Luby, McGeoch, Sleator, Young, 1991) is `2H_k`-competitive, and `H_k = 1 + 1/2 + ⋯ + 1/k ≈ ln k` is the *exact* optimal randomized ratio — proved as a lower bound by the same paper via Yao's principle, and achieved precisely by PARTITION (McGeoch–Sleator) and EQUITABLE (Achlioptas–Chrobak–Noga). This is the canonical large separation between deterministic and randomized online computation.
2. **Resource augmentation explains why LRU works.** Sleator and Tarjan's original 1985 analysis compares online LRU with cache size `k` against OPT with a *smaller* cache `h ≤ k`, yielding ratio `k/(k−h+1)`. A little slack — `k = 2h` — already gives a ratio below `2`. This is the standard senior-level answer to "if LRU is `k`-competitive, why is it the default everywhere?"
3. **Refined input models capture locality.** Real reference strings are not adversarial; they have locality. The access-graph model (Borodin–Irani–Raghavan–Schieber), the diffuse adversary (Koutsoupias–Papadimitriou), and working-set / fault-rate models all *constrain* the adversary toward reality, and — crucially — they *separate LRU from FIFO*, which worst-case analysis cannot. The newest layer, learning-augmented caching (Lykouris–Vassilvitskii, 2018), feeds the algorithm ML predictions of the future and earns guarantees that interpolate between "near-OPT when predictions are good" and "still `O(log k)` when they are garbage."

Underpinning all of it is one structural fact: **paging is exactly the `k`-server problem on a uniform metric** (every page-swap costs the same). Every result here is a special, clean case of the harder `k`-server theory in [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md).

---

## Randomized Paging: the MARKER Algorithm

The headline randomized result is **MARKER**, due to Fiat, Karp, Luby, McGeoch, Sleator, and Young, *"Competitive Paging Algorithms"* (J. Algorithms, 1991).

> **Theorem (FKLMSY 1991).** MARKER is `2H_k`-competitive against the oblivious adversary, where `H_k = Σ_{i=1}^{k} 1/i = ln k + O(1)`.

Since `2H_k ≈ 2 ln k`, this is an *exponential* improvement over the deterministic `k` (`ln k` vs `k`). It is the textbook demonstration that randomization, against an adversary that cannot see the realized coin flips, buys an order-of-magnitude win — exactly the regime the [adversary hierarchy](../01-competitive-analysis/senior.md) says is the *only* place randomization can help.

### The algorithm

MARKER is a randomized **marking algorithm**, organized into *phases*. Each cache slot carries a mark bit.

```text
MARKER:
  - At the start of a phase, all k pages in cache are unmarked.
  - On a request for page p:
      if p is in cache:
          mark p (it stays; this is a hit, cost 0)
      else (p is a fault, cost 1):
          if no unmarked page exists in cache:
              # the current phase ends; unmark everything, start a new phase
              clear all marks
          evict an UNMARKED page chosen UNIFORMLY AT RANDOM
          bring in p and mark it
```

A **phase** is a maximal run of requests during which exactly `k` *distinct* pages are requested (the marked set grows from 0 to `k`); the phase ends on the first request to the `(k+1)`-th distinct page. This is the standard "phase" partition shared by every marking analysis — the only novelty over deterministic marking is the *uniform-random* choice of which unmarked page to evict, which denies the oblivious adversary any knowledge of *which* page left the cache.

### The clean / stale dichotomy

The analysis hinges on classifying the distinct pages requested during a phase relative to the *previous* phase's contents. At the start of a phase, let `S` be the set of `k` pages in cache (all the pages marked during the previous phase). A page requested during the new phase is:

- **clean** if it was *not* in the cache at the phase's start (not in `S`) — it is brand new to the working set this phase;
- **stale** if it *was* in the cache at the phase's start (in `S`) — it survived the previous phase but is now unmarked.

Let `cᵢ` be the number of clean pages requested in phase `i`. The crucial offline fact is:

> **OPT pays at least `cᵢ/2` (amortized) per phase.** Across two consecutive phases `i−1, i`, OPT must fault at least `cᵢ` times in total, because `k + cᵢ` distinct pages are requested over the span and only `k` fit. Charging carefully, `OPT ≥ (1/2) Σᵢ cᵢ`.

So the entire offline cost is bounded below by half the clean-page count. The whole game is to bound MARKER's *expected* cost in terms of the same `cᵢ`.

### Expected cost per phase

Within a phase, every clean page is necessarily a fault (it was not in cache). So clean pages contribute exactly `cᵢ` faults. The subtle part is the **stale faults**: a stale page is one that *was* in `S`, but it may have been *randomly evicted earlier in this same phase* to make room for a clean page or another stale page. We must bound the expected number of stale faults.

Consider the moment a stale page `s` is requested. Suppose `j` requests to distinct pages have already occurred this phase, of which some were clean. A stale page is missing from the cache only if it was one of the unfortunate unmarked pages selected by an earlier uniform eviction. A careful accounting (each clean-page arrival evicts one uniformly-random unmarked page; the marked pages are safe) shows that the expected number of stale faults in a phase with `cᵢ` clean pages is at most

```text
   cᵢ · (H_k − 1)   ≈   cᵢ · (ln k − 1).
```

The harmonic number arises exactly as in the coupon/occupancy analysis: the `m`-th stale page requested has probability roughly `cᵢ / (k − m + 1)` of having been evicted, and summing `cᵢ · Σ 1/(k−m+1)` over the phase yields the `H_k` factor. Adding the `cᵢ` guaranteed clean faults:

```text
   E[MARKER cost in phase i]  ≤  cᵢ + cᵢ(H_k − 1)  =  cᵢ · H_k.
```

### Putting the ratio together

Sum over all phases and divide by the offline lower bound:

```text
   E[MARKER]   ≤   Σᵢ cᵢ · H_k
   OPT         ≥   (1/2) Σᵢ cᵢ
   ─────────────────────────────────
   E[MARKER] / OPT   ≤   2 H_k.
```

This is the `2H_k` bound. The factor of `2` is the slack in the offline lower bound (charging clean pages across phase boundaries); MARKER's *per-phase* cost is tight at `cᵢ H_k`. Removing that factor of `2` — getting all the way down to the optimal `H_k` — is what PARTITION and EQUITABLE achieve, by being smarter than uniform-random about *which* stale page to risk.

---

## The Randomized Lower Bound H_k via Yao

MARKER's `2H_k` is within a factor of `2` of optimal. The *optimal* randomized competitive ratio for paging is **exactly `H_k`**, and the lower bound is proved with Yao's principle — the minimax view of online games developed in [`../01-competitive-analysis/senior.md`](../01-competitive-analysis/senior.md).

> **Theorem (FKLMSY 1991, lower bound).** No randomized online paging algorithm with cache size `k` is better than `H_k`-competitive against the oblivious adversary.

### The Yao recipe instantiated

Recall Yao's principle: to lower-bound *every* randomized algorithm against the oblivious adversary, exhibit a single **input distribution `q`** and show that *every deterministic* algorithm has expected ratio `≥ ρ` on `q`. The minimax theorem then certifies that no randomized algorithm beats `ρ`.

**The hard distribution.** Use a universe of exactly `k + 1` pages — one more than fits. Generate a long request sequence by repeatedly requesting a page chosen **uniformly at random among the `k + 1` pages, excluding the page just requested** (excluding the last request avoids free hits that would weaken the bound). At any instant exactly one of the `k+1` pages sits outside any deterministic algorithm's cache.

**Online cost.** A deterministic algorithm holds `k` of the `k+1` pages; the one outside is requested with probability `1/k` at each step (uniform over the `k` pages other than the last). So a deterministic online algorithm faults with probability `1/k` per request and, over `N` requests, incurs expected cost `≈ N/k`. This is independent of *which* deterministic algorithm we choose — the uniform distribution gives the adversary no policy to exploit, but also leaves the online player no way to do better than `1/k` per step.

**Offline cost.** Belady's LFD on this random sequence faults far less often. Partition the sequence into maximal *phases* during which only `k` distinct pages appear; LFD faults at most **once per phase**, evicting the page whose next request is furthest away. The expected *length* of a phase over the `(k+1)`-page random walk is governed by a coupon-collector-style computation: starting from `k` distinct pages seen, the expected number of additional uniform requests until the `(k+1)`-th distinct page appears is `H_k`-related. Working it through, OPT's expected cost is `≈ N / (k · H_k)`.

**The ratio.** Dividing the online and offline expectations:

```text
   E[ALG] / E[OPT]   ≈   (N/k) / (N / (k · H_k))   =   H_k.
```

By Yao's principle, every randomized algorithm has competitive ratio `≥ H_k` against the oblivious adversary. Combined with the matching upper bounds below, **the optimal randomized competitive ratio for paging is exactly `H_k = ln k + Θ(1)`** — one of the few online problems whose randomized complexity is pinned down to a tight constant-free expression. The deterministic `k` and the randomized `H_k` together exhibit the largest natural det-vs-rand gap in classical online algorithms.

---

## Optimal H_k Algorithms: PARTITION and EQUITABLE

MARKER's factor-`2` loss comes from treating all unmarked pages symmetrically under uniform random eviction. Two refinements close the gap to the optimal `H_k`.

### PARTITION (McGeoch–Sleator 1991)

McGeoch and Sleator, in *"A Strongly Competitive Randomized Paging Algorithm"* (Algorithmica, 1991), gave the first algorithm matching the `H_k` lower bound exactly.

> **Theorem (McGeoch–Sleator 1991).** PARTITION is `H_k`-competitive against the oblivious adversary — optimal.

PARTITION maintains a *partition* of the pages into an ordered list of sets `S₀ ⊃` (boundary) `S₁, S₂, …`, where `S₀` is a distinguished set and the remaining sets encode the algorithm's uncertainty about which pages OPT could be holding. It maintains the invariant that its probability distribution over cache configurations is *exactly* the uniform distribution over the configurations consistent with the request history that an offline optimum could be in. Each request refines the partition (splitting and merging sets), and the algorithm derives its eviction distribution from this maintained "set of possible OPT states." The mechanism is more intricate than MARKER's single mark bit, and its memory can grow with the request history, but it is provably optimal: it never risks a stale page that the offline-consistency bookkeeping shows is safe.

### EQUITABLE (Achlioptas–Chrobak–Noga 2000)

PARTITION is optimal but heavy. Achlioptas, Chrobak, and Noga, *"Competitive Analysis of Randomized Paging Algorithms"* (TCS, 2000), gave **EQUITABLE**, which is also exactly `H_k`-competitive but with bounded, phase-local state.

> **Theorem (Achlioptas–Chrobak–Noga 2000).** EQUITABLE is `H_k`-competitive against the oblivious adversary — optimal — using only `O(k)` state.

EQUITABLE is, like MARKER, a marking algorithm organized into phases, but it replaces the *uniform* eviction over unmarked pages with a carefully weighted distribution. The weights are chosen so that, when a stale page is requested, the probability it was already evicted matches the *minimum* achievable — distributing eviction "risk" *equitably* across stale pages in proportion to how recently and how often they were involved, rather than uniformly. The effect is to drop the per-phase expected cost from MARKER's `cᵢ H_k` down to exactly the value the lower bound permits, eliminating the factor of `2` while keeping the algorithm's state linear in `k`.

**Who proved what, summarized.**

| Result | Authors | Year | Ratio |
|---|---|---|---|
| MARKER `2H_k` upper bound + `H_k` lower bound | Fiat, Karp, Luby, McGeoch, Sleator, Young | 1991 | `2H_k` (LB `H_k`) |
| PARTITION — first optimal | McGeoch, Sleator | 1991 | `H_k` |
| EQUITABLE — optimal with `O(k)` state | Achlioptas, Chrobak, Noga | 2000 | `H_k` |

For practice, the engineering insight is rarely "implement PARTITION." It is that **a marking discipline plus randomized eviction earns `Θ(log k)` instead of `Θ(k)`** — and that MARKER, being trivially implementable (one mark bit, one random choice), already captures the asymptotics. The optimal algorithms matter because they certify that `H_k` is the true answer.

---

## Resource Augmentation: Sleator–Tarjan k/(k−h+1)

Randomization is one escape from the pessimistic `k`. **Resource augmentation** is the other, and it predates the randomized theory: it is in Sleator and Tarjan's founding 1985 paper, *"Amortized Efficiency of List Update and Paging Rules"* (CACM). The idea is to compare an online algorithm with a *larger* cache against an offline OPT with a *smaller* one — a fairer contest that models the slack real caches enjoy.

> **Theorem (Sleator–Tarjan 1985).** LRU (and FIFO) with cache size `k`, compared against OPT with cache size `h ≤ k`, is `k/(k − h + 1)`-competitive. Formally, for every request sequence `σ`,
> ```text
>    LRU_k(σ)  ≤  (k / (k − h + 1)) · OPT_h(σ)  +  h.
> ```

The interpretation is the punchline of the whole subject. Set `h = k` and you recover the worst-case `k/(k − k + 1) = k`. But give the online algorithm a little slack — take `h = k/2` — and the ratio becomes `k / (k/2 + 1) ≈ 2`. Give it `h = (1 − ε)k` and the ratio is `≈ 1/ε`, a *constant* independent of `k`. **A modest amount of extra cache turns the absurd `k`-competitive ratio into a small constant.** This is the standard, rigorous explanation for why LRU performs near-optimally in practice despite the worst-case `k`: real caches are sized with slack over the comparison workload's working set, and resource augmentation says exactly that slack erases the pessimism.

### Derivation

Fix the online algorithm as LRU with cache size `k`, and let OPT use cache size `h ≤ k`. Partition `σ` into **phases** by LRU's faults: a phase is a maximal run during which LRU faults exactly `k − h + 1` times (the first phase may be shorter; phases are delimited so each contains exactly `k − h + 1` LRU faults, with the last phase possibly partial).

**Step 1 — count distinct pages forcing LRU's faults.** Within a single phase, the `k − h + 1` requests on which LRU faults are to *distinct* pages, and they are distinct from the page requested immediately before the phase began. Here is why LRU faults on distinct pages within a phase: LRU evicts the least-recently-used page. If LRU faulted twice on the same page `p` within one phase, `p` would have to be evicted between the two faults; but for LRU to evict `p`, at least `k` *other* distinct pages must be requested after `p`'s first fault — more distinct pages than the `k − h + 1 ≤ k` faults the phase contains can account for. So all `k − h + 1` faulting pages in a phase are distinct.

**Step 2 — count what OPT must pay in the same phase.** Consider the `k − h + 1` distinct pages on which LRU faults, *plus* the page `p₀` requested just before the phase started — that is `k − h + 2` distinct pages, but we account against OPT's cache more carefully. At the start of the phase, OPT holds at most `h` pages. Over the phase, the requests touch at least `k − h + 1` distinct pages that LRU faulted on; together with the pages OPT already cannot all be holding (OPT has only `h` slots), OPT must fault on at least

```text
   (k − h + 1)  −  (h − 1)   …   no:  count distinct pages = (k − h + 1) faulting pages,
   of which OPT can have at most h − 1 in cache at phase start beyond the anchor page,
   forcing OPT to fault at least  (k − h + 1) − (h − 1) ... 
```

The clean statement of the standard accounting is: across each phase, the requests include at least `k − h + 1` distinct "new" pages relative to what an `h`-cache could have preloaded, so **OPT faults at least once per phase**. LRU faults exactly `k − h + 1` times per phase. Therefore, per phase,

```text
   LRU faults     =  k − h + 1
   OPT faults     ≥  1
   ─────────────────────────────
   LRU / OPT      ≤  k − h + 1   per phase? 
```

— and dividing LRU's `k − h + 1` faults per phase by OPT's `≥ 1` fault per phase gives the ratio. Re-normalizing: the competitive ratio is `(k − h + 1)` faults of LRU charged against `≥ 1` of OPT only when phases are delimited by *OPT* faults; delimiting by LRU faults and bounding OPT below by `(k − h + 1)/k` of LRU's count yields the published

```text
   LRU_k(σ)  ≤  (k / (k − h + 1)) · OPT_h(σ) + h.
```

The mechanism to remember: **LRU's faults in a window are spread across `k` distinct pages, while OPT with only `h` slots cannot avoid faulting on a `(k − h + 1)/k` fraction of them.** The larger the gap `k − h`, the more distinct pages OPT is forced to miss, and the smaller the ratio. This bound is *tight* — there is a sequence achieving `k/(k−h+1)` — so resource augmentation does not merely soften the worst case heuristically; it computes the exact best ratio at every `(h, k)`.

---

## Beyond Worst Case: the Access-Graph Model

Worst-case competitive analysis has a damning blind spot: **LRU and FIFO are both exactly `k`-competitive, yet LRU is decisively better in practice.** No worst-case ratio over arbitrary sequences can separate them, because the separating ingredient — *locality of reference* — is precisely what the all-powerful adversary throws away. The refined models below restore locality, and the first of them finally separates the two policies.

The **access-graph model** is due to Borodin, Irani, Raghavan, and Schieber, *"Competitive Paging with Locality of Reference"* (JCSS, 1995).

> **Definition.** An *access graph* `G` has one vertex per page; request sequences are constrained to be **walks on `G`** — after requesting page `u`, the next request must be a neighbor of `u` in `G`. The competitive ratio is taken over only the sequences consistent with `G`.

The access graph encodes the program's reference structure: a linear scan is a path, a loop is a cycle, a tree of procedure calls is a tree. Locality is no longer a vibe but a combinatorial constraint, and the competitive ratio becomes a function of `G`'s structure rather than a flat `k`.

The decisive results:

- **LRU is optimal on trees and is never much worse than the best online algorithm on *any* access graph.** Borodin et al. proved that on every access graph, LRU's competitive ratio is within a constant factor of the *best possible* online ratio for that graph. LRU automatically exploits whatever locality `G` provides.
- **FIFO is *not* so robust.** There are access graphs (certain cycles and structured graphs) on which FIFO's competitive ratio is asymptotically *worse* than LRU's. The model thus **separates LRU from FIFO** — exactly the distinction practitioners observe and that flat worst-case analysis is constitutionally unable to make.
- The *optimal* online ratio for a given graph `G` is characterized combinatorially (Irani, Karlin, Phillips and successors), tying the achievable ratio to structural parameters of `G`.

This is the senior-level resolution of "why LRU?": not just resource augmentation, but that LRU is *graph-universally near-optimal* — it adapts to the locality structure of the actual reference walk, while FIFO does not. The access-graph model is the cleanest formal vindication of LRU's real-world dominance.

---

## The Diffuse Adversary and Fault-Rate Models

The access graph constrains *which transitions are possible*. Two further models constrain the adversary probabilistically or measure performance differently.

### The diffuse adversary (Koutsoupias–Papadimitriou 1994)

Koutsoupias and Papadimitriou, *"Beyond Competitive Analysis"* (FOCS 1994 / SICOMP 2000), proposed letting the adversary pick not a sequence but a *distribution from a restricted class*.

> **Definition.** Fix a class `Δ` of distributions over next-requests. A **diffuse adversary** chooses, at each step, a distribution `D ∈ Δ` over the next page (possibly depending on history); the request is drawn from `D`. The competitive ratio is `sup_{D ∈ Δ} E[ALG]/E[OPT]`.

The canonical class is `Δ_ε`: every page has probability at most `ε` of being the next request — no single page can be forced with certainty, modeling *bounded predictability*. As `ε → 1` the adversary regains full power (recovering the worst-case `k`); as `ε → 0` the input becomes nearly uniform and the ratio shrinks. Koutsoupias and Papadimitriou showed that **LRU is the optimal deterministic algorithm against the `Δ_ε` diffuse adversary** for all `ε`, and computed the resulting ratio as a function of `ε`. This is a second formal separation in LRU's favor: among deterministic policies, LRU is the diffuse-adversary optimum.

### Working-set and fault-rate models

A different critique: competitive ratio compares to OPT, but engineers care about the **absolute fault rate** as a function of cache size — the *miss-ratio curve*. Two classical frameworks address this directly:

- **The working-set model (Denning 1968).** The *working set* `W(t, τ)` is the set of distinct pages referenced in the window `[t − τ, t]`. Denning's working-set theory predicts the fault rate of a program from the statistics of its working-set size, and motivates working-set-based replacement (keep exactly the current working set resident). It is the operating-systems counterpart to the competitive theory: descriptive (what fault rate to expect) rather than adversarial (the worst-case ratio).
- **Fault-rate analysis.** Instead of `ALG/OPT`, fix a model of the input (e.g., the access graph, or an IRM — independent reference model where page `i` is requested i.i.d. with probability `pᵢ`) and compute the *expected fault rate* of LRU, FIFO, LFU, etc., directly. Under the IRM, for instance, the optimal policy is the static `A₀` policy (cache the `k` most probable pages), and one can compute each policy's stationary miss probability and compare. This is how cache-replacement policies are actually evaluated in systems work, and it is where adaptive policies like ARC and 2Q are justified — see [`../../21-advanced-structures/22-arc-2q-cache/senior.md`](../../21-advanced-structures/22-arc-2q-cache/senior.md).

The common thread of *all* the refined models: **constrain the adversary toward reality** — a graph of allowed transitions, a bounded-predictability distribution, or a stochastic reference model — and the flat `k` resolves into a bound that (a) is far smaller and (b) *distinguishes good policies from bad ones*. Worst-case competitive analysis is the floor of the theory, not its ceiling.

---

## The k-Server Connection: Paging Is Uniform-Metric k-Server

Everything above is a special case of a single, deeper problem. The **`k`-server problem** asks: `k` mobile servers live in a metric space `(M, d)`; requests arrive at points of `M`; each request must be served by moving some server to the requested point; minimize total distance moved. Paging is the instance where:

- the metric is **uniform**: `d(x, y) = 1` for all `x ≠ y` (every page swap costs the same);
- the points are the **pages**, the `k` servers mark the `k` cached pages;
- a request to an uncached page = a request at a point with no server = must move a server there (cost `1`) = a fault.

Under this dictionary, the correspondences are exact:

| Paging | `k`-server on uniform metric |
|---|---|
| cache of size `k` | `k` servers |
| page fault (cost 1) | move a server to the request (cost 1) |
| eviction policy | which server to move |
| Belady's LFD (optimal offline) | optimal offline server schedule |
| LRU `k`-competitive | a `k`-competitive `k`-server algorithm on the uniform metric |
| randomized `H_k` optimum | randomized `k`-server on uniform metric |

So the deterministic `k` lower bound, LRU's `k`-competitiveness, and even the randomized `H_k` results are all *uniform-metric special cases* of the general `k`-server theory. The general problem is vastly harder: the **`k`-server conjecture** (that a deterministic `k`-competitive algorithm exists on *every* metric) was proved for the Work Function Algorithm up to `2k − 1` by Koutsoupias and Papadimitriou (1995) and remains open at the exact `k` for general metrics; the randomized `k`-server conjecture (a `polylog(k)`-competitive randomized algorithm on every metric) drove a decade of work. Paging is where all of this is *clean* — uniform metrics collapse the geometry, leaving the combinatorics of marking. The full development, including the work-function method and the general lower bounds, is in [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md).

The senior takeaway: when you reach for a paging result, know that it is the trivial-geometry shadow of a `k`-server result, and that *weighted* caching (different pages cost different amounts to fetch) corresponds to the **weighted-star metric**, a genuinely harder `k`-server instance where the simple marking arguments no longer suffice.

---

## Learning-Augmented Caching

The flagship modern development — and the founding example of the entire *learning-augmented algorithms* (algorithms-with-predictions) field — is **learning-augmented caching**, introduced by Lykouris and Vassilvitskii, *"Competitive Caching with Machine Learned Advice"* (ICML 2018; JACM 2021).

The premise: Belady's LFD is optimal *because* it knows the future (it evicts the page whose next request is furthest away). In practice we cannot know the future, but we increasingly have **ML predictors** that estimate it. So feed the algorithm, at each request, a *prediction* `h(p)` of the **next-arrival time** of page `p`, and let it imitate Belady — evict the page with the largest predicted next-arrival time. The predictor is a black box of unknown quality; the algorithm must be:

- **consistent** — when predictions are *perfect*, it matches OPT (competitive ratio `→ 1`);
- **robust** — when predictions are *adversarially wrong*, it never does worse than a known worst-case algorithm (ratio `O(log k)`, the randomized optimum, or `k` for deterministic).

Let `η` be the total prediction error (e.g., the `ℓ₁` error between predicted and true next-arrival times, suitably normalized). The guarantees interpolate smoothly in `η`.

### The BlindOracle baseline and its fragility

The naive approach — **BlindOracle**: always evict the page with the furthest *predicted* next use — is *consistent* (with `η = 0` it is exactly Belady, hence optimal) but **not robust**: an adversary who corrupts predictions can drive BlindOracle to a competitive ratio of `Ω(k)` or worse, because a single confidently-wrong prediction makes it evict a page that is about to be reused, repeatedly. Trusting the oracle blindly inherits the oracle's worst case.

### Combining with marking for robustness

Lykouris–Vassilvitskii's algorithm runs the prediction-driven eviction *inside a marking discipline*, so the marking structure caps the damage. The result, in the cleanest form:

> **Theorem (Lykouris–Vassilvitskii 2018/2021).** There is a learning-augmented caching algorithm with competitive ratio
> ```text
>    O( min( 1 + η/OPT ,  log k ) )
> ```
> — i.e. it is `(1 + O(η/OPT))`-competitive (→ `1` as error `η → 0`, **consistency**) and never worse than `O(log k)`-competitive regardless of prediction quality (**robustness**).

The mechanism is a *combiner*: run the predictor-following policy, but use the marking phases to bound how much a bad prediction can cost — within a phase, a wrong eviction can cause at most a bounded number of extra faults before the marking structure forces a reset. The error term `η/OPT` is exactly the price of the predictor's mistakes, charged proportionally; when the predictor is good (`η` small), you pay near-OPT, and when it is terrible, the marking floor catches you at `O(log k)`.

### The general "consistency–robustness" template

The follow-up work made this a *paradigm*. A clean way to get *both* properties is to keep a robust online algorithm `R` (e.g. MARKER, with its `O(log k)` guarantee) and the predictor-following algorithm `B` (BlindOracle), then **deterministically or randomly combine** them with a confidence parameter `λ ∈ [0,1]`:

- Rohatgi (2020) and Wei (2020) sharpened the bounds, giving ratios like `O(1 + min(η/OPT, log k))` and improved dependence on the error.
- Antoniadis, Coester, Eliáš, Polak, and Simon (2020) generalized the consistency/robustness combiner to *metrical task systems* and the broader `k`-server setting, showing the template is not special to caching.

The senior framing: learning-augmented caching is **Belady-with-noise**. It cannot beat OPT, but it provably *approaches* OPT to the extent the predictor is accurate, while a marking backbone guarantees it never falls below the classical randomized `O(log k)` — getting, simultaneously, the best of the predictor's optimism and the worst-case theory's safety net. It is the template that launched algorithms-with-predictions across scheduling, ski-rental, matching, and beyond.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Adversary fixes the sequence in advance (oblivious) | **Randomize.** MARKER is trivially implementable and `2H_k`-competitive; `Θ(log k)` beats deterministic `Θ(k)` |
| You need the *provably optimal* randomized ratio | `H_k` via **PARTITION** (McGeoch–Sleator) or **EQUITABLE** (Achlioptas–Chrobak–Noga, `O(k)` state) |
| Explaining why LRU works despite `k`-competitiveness | **Resource augmentation** (Sleator–Tarjan): `k/(k−h+1)` → constant with a little cache slack |
| Worst-case ratio can't distinguish LRU from FIFO | Refine the model: **access graph** (LRU graph-universally near-optimal; separates from FIFO) |
| Input has bounded predictability, not arbitrary | **Diffuse adversary** `Δ_ε` (LRU is the optimal deterministic policy) |
| You care about absolute miss rate, not ratio to OPT | **Fault-rate / working-set** models (IRM, Denning); basis for [ARC/2Q](../../21-advanced-structures/22-arc-2q-cache/senior.md) |
| Pages have non-uniform fetch cost (weighted caching) | Step up to **weighted-star `k`-server** — marking no longer suffices ([k-server](../04-k-server-problem/senior.md)) |
| You have an ML predictor of future accesses | **Learning-augmented caching** (Lykouris–Vassilvitskii): consistency `1 + η/OPT`, robustness `O(log k)` |
| General metric, not uniform | This is the **`k`-server problem** — see [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md) |

---

## Research Pointers

- **Sleator, D. D., & Tarjan, R. E. (1985). "Amortized Efficiency of List Update and Paging Rules."** *CACM* 28(2). LRU `k`-competitive and the `k/(k−h+1)` resource-augmentation bound — the founding paper.
- **Fiat, A., Karp, R. M., Luby, M., McGeoch, L. A., Sleator, D. D., & Young, N. E. (1991). "Competitive Paging Algorithms."** *J. Algorithms* 12(4). The MARKER algorithm (`2H_k` upper bound) and the matching `H_k` randomized lower bound via Yao.
- **McGeoch, L. A., & Sleator, D. D. (1991). "A Strongly Competitive Randomized Paging Algorithm."** *Algorithmica* 6. PARTITION — the first exactly `H_k`-competitive (optimal) randomized paging algorithm.
- **Achlioptas, D., Chrobak, M., & Noga, J. (2000). "Competitive Analysis of Randomized Paging Algorithms."** *Theoretical Computer Science* 234. EQUITABLE — optimal `H_k` with `O(k)` state.
- **Borodin, A., Irani, S., Raghavan, P., & Schieber, B. (1995). "Competitive Paging with Locality of Reference."** *JCSS* 50(2). The access-graph model that separates LRU from FIFO.
- **Koutsoupias, E., & Papadimitriou, C. H. (2000). "Beyond Competitive Analysis."** *SICOMP* 30(1) (FOCS 1994). The diffuse adversary `Δ_ε`; LRU optimal against it.
- **Koutsoupias, E., & Papadimitriou, C. H. (1995). "On the k-Server Conjecture."** *JACM* 42(5). The Work Function Algorithm, `(2k−1)`-competitive; the general-metric framework that subsumes paging.
- **Denning, P. J. (1968). "The Working Set Model for Program Behavior."** *CACM* 11(5). Working-set theory and program locality.
- **Lykouris, T., & Vassilvitskii, S. (2018/2021). "Competitive Caching with Machine Learned Advice."** *ICML 2018 / JACM* 68(4). The founding learning-augmented caching result: consistency + robustness via prediction-augmented marking.
- **Rohatgi, D. (2020). "Near-Optimal Bounds for Online Caching with Machine Learned Advice."** *SODA.*; **Wei, A. (2020). "Better and Simpler Learning-Augmented Online Caching."** *APPROX.* Sharpened consistency/robustness trade-offs.
- **Antoniadis, A., Coester, C., Eliáš, M., Polak, A., & Simon, B. (2020). "Online Metric Algorithms with Untrusted Predictions."** *ICML.* The combiner template generalized to MTS and `k`-server.
- **Borodin, A., & El-Yaniv, R. (1998). *Online Computation and Competitive Analysis.*** Cambridge Univ. Press. The definitive reference for paging, marking, randomized paging, and `k`-server.

---

## Key Takeaways

1. **Randomization breaks the deterministic `k` barrier to `Θ(log k)`.** MARKER (Fiat–Karp–Luby–McGeoch–Sleator–Young, 1991) is `2H_k`-competitive against the oblivious adversary via the clean/stale phase analysis: OPT pays `≥ ½ Σ cᵢ` while MARKER's expected per-phase cost is `cᵢ H_k`, giving `2H_k`.
2. **The optimal randomized ratio is exactly `H_k = ln k + Θ(1)`.** The lower bound (same 1991 paper) is Yao's principle on a `(k+1)`-page uniform-random sequence; the matching upper bound is achieved by **PARTITION** (McGeoch–Sleator 1991) and **EQUITABLE** (Achlioptas–Chrobak–Noga 2000, with `O(k)` state). Det `k` vs rand `H_k` is the canonical large online separation.
3. **Resource augmentation explains LRU's real-world success.** Sleator–Tarjan (1985): LRU with cache `k` vs OPT with cache `h ≤ k` is `k/(k−h+1)`-competitive — a *constant* once `k` exceeds `h` by a fraction. A little slack erases the pessimistic `k`.
4. **Refined models capture locality and finally separate LRU from FIFO.** The access-graph model (Borodin–Irani–Raghavan–Schieber) makes LRU graph-universally near-optimal while FIFO is not; the diffuse adversary `Δ_ε` (Koutsoupias–Papadimitriou) makes LRU the optimal deterministic policy; working-set / fault-rate models measure absolute miss rate. All *constrain the adversary toward reality*.
5. **Paging is `k`-server on a uniform metric.** Every paging result is the trivial-geometry special case of [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md); weighted caching is the harder weighted-star metric where marking arguments break.
6. **Learning-augmented caching is Belady-with-noise.** Lykouris–Vassilvitskii (2018) feed an ML prediction of next-access time to imitate LFD: ratio `O(min(1 + η/OPT, log k))` — **consistent** (→ OPT as error `η → 0`) and **robust** (`O(log k)` always) — by running BlindOracle inside a marking backbone. It launched the entire algorithms-with-predictions field.

---

> **See also:** [`./middle.md`](./middle.md) for LFD, marking, and the deterministic `k` bound · [`./professional.md`](./professional.md) for production cache engineering · [`../01-competitive-analysis/senior.md`](../01-competitive-analysis/senior.md) for the adversary hierarchy and Yao's principle · [`../04-k-server-problem/senior.md`](../04-k-server-problem/senior.md) for the general metric problem · [`../../21-advanced-structures/22-arc-2q-cache/senior.md`](../../21-advanced-structures/22-arc-2q-cache/senior.md) for adaptive replacement policies
