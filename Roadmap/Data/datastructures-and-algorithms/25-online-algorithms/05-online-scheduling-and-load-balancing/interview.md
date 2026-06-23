# Online Scheduling and Load Balancing — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Marquee: List Scheduling is (2−1/m)-competitive](#the-marquee-list-scheduling-is-21m-competitive)
3. [LPT & Semi-Online Scheduling](#lpt--semi-online-scheduling)
4. [Online Bin Packing](#online-bin-packing)
5. [Machine Models & Flow Time](#machine-models--flow-time)
6. [The Famous One: Power of Two Choices](#the-famous-one-power-of-two-choices)
7. [Gotcha / Trick Questions](#gotcha--trick-questions)
8. [Rapid-Fire Q&A](#rapid-fire-qa)
9. [Common Mistakes](#common-mistakes)
10. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: Define the online makespan-scheduling problem. *(Easy)*

**Answer**: There are `m` identical machines. Jobs arrive one at a time, each with a processing time `pⱼ` revealed on arrival. The moment a job arrives you must **irrevocably assign it** to one machine, without knowing future jobs. The **load** of a machine is the sum of the processing times assigned to it; the **makespan** is the maximum load over all machines. The objective is to **minimize the makespan** — finish all work as early as possible.

This is the canonical online load-balancing problem: distribute arriving work across servers so the busiest one isn't too overloaded. `OPT` is the offline optimum makespan — the best assignment computable with the whole job sequence in hand. See [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md) for the `c`-competitive framework.

### Q2: What is Graham's list scheduling (the greedy rule)? *(Easy)*

**Answer**: **List scheduling** = **greedy / least-loaded**: assign each arriving job to the machine that currently has the **smallest load** (break ties arbitrarily). It's the most natural online heuristic — always feed the hungriest machine — and it requires no knowledge of future jobs. Graham (1966) analyzed exactly this rule and proved it is **(2 − 1/m)-competitive** for makespan.

### Q3: What two lower bounds on OPT make the analysis work? *(Medium)*

**Answer**: Two facts bound `OPT` from below, and every good proof leans on both:

1. **Average load**: `OPT ≥ (1/m)·Σⱼ pⱼ` — the makespan is at least the total work divided across all `m` machines (you can't beat a perfectly even split).
2. **Max job**: `OPT ≥ maxⱼ pⱼ` — some machine must run the single biggest job in full, so the makespan is at least that job's length.

These are the only two ingredients you need to prove the `(2 − 1/m)` bound for greedy. State them first in any interview answer.

---

## The Marquee: List Scheduling is (2−1/m)-competitive

### Q4: Prove greedy list scheduling is (2 − 1/m)-competitive. *(Hard — the last-job argument)*

**Answer**: Consider the machine `M` that ends up with the **maximum load** (it defines the makespan), and look at the **last job** `j` that greedy placed on `M`, with processing time `pⱼ`.

When `j` was assigned, greedy chose `M` because it was the **least-loaded** machine at that moment. So `M`'s load *before* `j` — call it `L` — was the minimum over all machines, which means **every** machine had load `≥ L` at that instant. Therefore the total work already placed was `≥ m·L`, giving:

```
L ≤ (1/m)·Σ (work before j) ≤ (1/m)·Σⱼ pⱼ ≤ OPT.
```

The final makespan on `M` is `L + pⱼ`. Subtract `j`'s own contribution from the average bound to tighten it: the work before `j` is at most `Σ pᵢ − pⱼ`, so `L ≤ (1/m)(Σ pᵢ − pⱼ)`. Then:

```
makespan = L + pⱼ ≤ (1/m)(Σ pᵢ − pⱼ) + pⱼ
         = (1/m)·Σ pᵢ + (1 − 1/m)·pⱼ
         ≤ OPT + (1 − 1/m)·OPT          [using both lower bounds: avg ≤ OPT, pⱼ ≤ OPT]
         = (2 − 1/m)·OPT.
```

So greedy's makespan is `≤ (2 − 1/m)·OPT`. The whole proof is one idea: **the busiest machine's final load = (its load before the last job, which is below average) + (one job, which is at most OPT).**

### Q5: Show the (2 − 1/m) bound is tight. *(Hard — the adversary)*

**Answer**: The adversary builds a stream that forces the ratio. Send **`m·(m − 1)` tiny jobs of size 1**, then **one big job of size `m`**.

- **Greedy** spreads the small jobs perfectly evenly: each machine reaches load `m − 1`. Then the big job of size `m` lands on some machine (all are tied), pushing it to `m − 1 + m = 2m − 1`. So **greedy's makespan = `2m − 1`**.
- **OPT** dedicates **one machine entirely to the big job** (load `m`) and spreads the `m(m−1)` unit jobs across the **other `m − 1` machines**: each gets `m` units, load `m`. So **`OPT = m`**.

The ratio is `(2m − 1)/m = 2 − 1/m`, exactly matching the upper bound. Hence **`(2 − 1/m)` is tight** — greedy cannot be analyzed any better, and no input can force it worse. The lesson mirrors the lower bounds in [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md): a tight bound needs both a proof *and* a matching adversary.

### Q6: Can any online algorithm beat (2 − 1/m)? *(Medium)*

**Answer**: **Yes, slightly — but you can't reach 1.** Pure greedy is `(2 − 1/m)`, and that's tight *for greedy*. Cleverer online algorithms (Bartal et al., Albers, Fleischer–Wahl) push the best-known competitive ratio for makespan down to roughly **`1.92`** (and a lower bound of about **`1.88`** rules out anything close to 1 for large `m`). These improve by deliberately keeping some machines **imbalanced** — leaving headroom on a few machines to absorb a future big job — rather than greedily flattening everything. But the gains are modest; greedy's `(2 − 1/m)` remains the canonical answer and the one to derive on a whiteboard.

---

## LPT & Semi-Online Scheduling

### Q7: What is LPT and what bound does it achieve? *(Medium)*

**Answer**: **LPT (Longest Processing Time first)**: sort the jobs in **decreasing** order of size, then run greedy list scheduling on that order. Graham proved LPT achieves makespan:

```
LPT ≤ (4/3 − 1/(3m))·OPT.
```

That's a big improvement over plain greedy's `(2 − 1/m)` — roughly `1.33` instead of `2`.

**Why sorting longest-first helps**: in the tight bad case for greedy, a *big* job arrives **last** and lands on an already-loaded machine. LPT eliminates that: by the time the small jobs are placed, all the big ones are already down, so the final job added to the bottleneck machine is **small** — bounding the `pⱼ` term in the last-job argument. Concretely, the job that defines the makespan is at most the *m+1*-th largest job, which is `≤ OPT/3` worth of overshoot, yielding the `4/3` factor.

### Q8: Why is LPT only "semi-online," not online? *(Medium)*

**Answer**: Because **LPT must see all the jobs to sort them** by size before placing the first one. A truly online algorithm must commit to each job *as it arrives*, with no knowledge of what's coming — it cannot reorder the stream. LPT needs the whole job *set* up front (even if it doesn't need to know future *arrivals' timing*), so it's **semi-online**: it has partial extra information (the full multiset of job sizes, or the ability to sort) that pure online algorithms lack. The general lesson: the `4/3` bound is *not* a fair comparison to the `(2 − 1/m)` online bound — LPT buys its improvement with information greedy doesn't have. Other semi-online settings give the algorithm the total sum `Σ pⱼ` in advance, or the max job size, or a buffer to reorder a few jobs.

---

## Online Bin Packing

### Q9: State the online bin-packing problem and Next-Fit's ratio. *(Medium)*

**Answer**: **Bin packing**: items of sizes in `(0, 1]` arrive online; each must be placed into a unit-capacity bin (open a new bin if needed) immediately and irrevocably. Minimize the **number of bins** used. `OPT` is the offline minimum.

**Next-Fit**: keep only **one open bin**; place each item there if it fits, otherwise **close it and open a fresh bin**. Next-Fit is **2-competitive**.

**Proof sketch**: take any **two consecutive bins** `Bᵢ` and `Bᵢ₊₁`. The item that opened `Bᵢ₊₁` didn't fit in `Bᵢ`, so `load(Bᵢ) + load(Bᵢ₊₁) > 1`. Pairing up bins this way, **every pair holds more than 1 unit of items**, so the total content exceeds (number of bins)/2. Since `OPT ≥ total content`, we get `NextFit ≤ 2·OPT`. The `2` is tight (alternating tiny and just-over-half items).

### Q10: What does First-Fit achieve, and what's the online lower bound? *(Hard)*

**Answer**:

- **First-Fit** places each item in the **earliest-opened bin where it fits** (open a new bin only if none does). Its asymptotic competitive ratio is **1.7** — `FF ≤ 1.7·OPT + O(1)`. **Best-Fit** (tightest-fitting open bin) achieves the same **1.7**. Both dominate Next-Fit because they keep *all* bins open for reuse, not just the last one.
- **Online lower bound**: **no online bin-packing algorithm can do better than ≈ 1.54** (the bound has been pushed to roughly `1.5403` by Balogh et al.). So there's a genuine gap between the best possible online ratio (`~1.54`) and First-Fit (`1.7`); the best known algorithms (Harmonic-family, e.g. Harmonic++) sit around **`1.58`**, closing in on but not reaching the lower bound.

The number to remember: **Next-Fit 2, First-Fit/Best-Fit 1.7, online lower bound ≈ 1.54.** Offline, **FFD (First-Fit Decreasing)** reaches `11/9·OPT + O(1) ≈ 1.22` — the same "sort big-first" trick as LPT.

---

## Machine Models & Flow Time

### Q11: Identical vs related vs unrelated machines — what's the difference? *(Medium)*

**Answer**: Three models of increasing generality for how job `j` loads machine `i`:

| Model | Processing time of job `j` on machine `i` | Greedy makespan ratio |
|-------|-------------------------------------------|-----------------------|
| **Identical** | `pⱼ` — same on every machine | `2 − 1/m` |
| **Related (uniform)** | `pⱼ / sᵢ` — machine `i` has speed `sᵢ` | `O(1)` (constant, ~`2`–`3`) |
| **Unrelated** | `pᵢⱼ` — an *arbitrary* matrix; a job can be fast on one machine, slow on another | `O(log m)` (greedy) |

**Identical** machines are interchangeable. **Related** machines differ only by a single speed scalar. **Unrelated** machines are fully arbitrary — there's no global "this machine is faster," only per-job affinities (think CPU vs GPU, or data-locality where a job is cheap only on the node holding its data).

### Q12: Why is greedy only O(log m)-competitive for unrelated machines? *(Hard)*

**Answer**: On **unrelated** machines, the natural greedy rule — assign each job to the machine minimizing the *resulting* maximum load — is **`O(log m)`-competitive** (Aspnes–Azar–Fiat–Plotkin–Waarts), and this is essentially the best any online algorithm can do: there's a matching **`Ω(log m)` lower bound**. The intuition for why you *can't* stay constant: with arbitrary `pᵢⱼ`, an early greedy choice can place a job on a machine that *later* turns out to be the only fast home for a flood of future jobs — and you can't undo it. The adversary stacks these conflicts in `log m` levels, and each level can cost a constant factor. The clever algorithms use an **exponential potential** `Σ aᵏ·loadᵢ` (assign to minimize the increase in `Σ a^{loadᵢ}`) instead of raw max-load, which is what yields the `O(log m)` rather than something worse.

### Q13: Makespan vs flow time — why does flow time need speed augmentation? *(Hard)*

**Answer**: **Makespan** = when does the *last* job finish (a throughput / load-balancing objective). **Flow time** of a job = completion time − arrival time (how long it waited + ran); **total/average flow time** is a *responsiveness* objective — what users actually feel.

Flow time is **brutally hard online**: for total flow time on multiple machines, *every* online algorithm has an **unbounded (polynomial in `n`) competitive ratio** — a tiny job can be stuck behind a huge one, and without the future you can't avoid it. The standard escape is **resource augmentation via speed**: give the online algorithm machines that are **`(1 + ε)` times faster** than `OPT`'s, and then a simple rule like **SRPT** (Shortest Remaining Processing Time) or **immediate-dispatch** becomes **`O(1/ε)`-competitive** — *scalable*. This is the **speed-augmentation** analysis of Kalyanasundaram–Pruhs: a little extra speed converts an impossible ratio into a constant, exactly as a little extra cache does for paging (see [../03-paging-and-caching-theory/interview.md](../03-paging-and-caching-theory/interview.md)). The moral: when the bare competitive ratio is unbounded, **augment the resource** and report the ratio as a function of the slack `ε`.

---

## The Famous One: Power of Two Choices

### Q14: What is the "power of two choices," and why does sampling 2 servers help so much? *(Hard — the marquee practical result)*

**Answer**: Setting: `n` balls (requests) thrown into `n` bins (servers), one at a time. We care about the **maximum load** (the most overloaded server).

- **One choice** (each ball to a *uniformly random* bin): the maximum load is **`Θ(log n / log log n)`** balls — heavily skewed; the busiest server is logarithmically overloaded.
- **Two choices** (sample **2** random bins, place the ball in the **less-loaded** of the two): the maximum load drops to **`log log n / log 2 + Θ(1)`** — i.e. **`Θ(log log n)`**.

This is the **power of two choices** (Azar–Broder–Karlin–Upfal; Mitzenmacher): going from 1 to 2 samples gives an **exponential** reduction in max load, `log n → log log n`. Adding even more choices (`d` instead of 2) only helps by a *constant factor* (`log log n / log d`) — **the dramatic jump is from 1 to 2.**

**Why**: with one choice, nothing discourages a bin from growing — load is decided by raw randomness. With two choices, a bin only grows when it's the *lighter* of *both* sampled bins, so a bin already at height `k` is avoided unless **both** samples are also `≥ k` — and the fraction of bins at height `k` shrinks **doubly-exponentially** (`∝ 2^{-d^k}` roughly), because reaching the next level requires the rare event of two high samples. That doubly-exponential decay is exactly what turns `log n` into `log log n`. In short: **two choices add just enough negative feedback to crush the tail.**

### Q15: How does this relate to JSQ and real load balancers? *(Medium)*

**Answer**: **JSQ (Join-the-Shortest-Queue)** = sample *all* `n` servers and pick the least loaded — optimal balance but **`O(n)` coordination per request**, infeasible at scale (every dispatcher must know every server's queue). **Power-of-two-choices** (often **"JSQ(2)"** or **"the two random choices" / d-choices**) gets *almost all* the benefit of JSQ for **`O(1)` coordination** — query just 2 servers. This is why production load balancers and schedulers use it: NGINX's `random two least_conn`, HAProxy, Sparrow, and many Kubernetes/Nomad-style schedulers sample a small number `d` of candidates and pick the lightest. The takeaway interviewers want: **you don't need global state for good balance — two random probes buy exponentially better tail load than one, at constant cost.**

---

## Gotcha / Trick Questions

### Q16: "Is greedy load balancing within 2× in practice — should I worry?" *(Medium)*

**Answer**: **No, the `2×` is a worst-case ceiling, not what you'll see.** The `(2 − 1/m)` bound is forced only by an adversarial stream — many tiny jobs followed by one job of size `m` (Q5). On real workloads with many jobs that are **small relative to total load**, the last-job term `(1 − 1/m)·pⱼ` is negligible, so greedy lands **very close to the average load**, i.e. near-optimal. In practice you also keep **headroom** (don't run servers at 100%) and jobs are numerous and small, so least-loaded balancing is excellent. The `2×` only bites when a single job is comparable to a whole machine's capacity — the same worst-case-vs-typical trap as the competitive-ratio gotchas in [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md).

### Q17: "Online vs offline scheduling — what exactly is the handicap?" *(Easy)*

**Answer**: **Offline** scheduling sees the entire job set up front and can plan the optimal assignment (still NP-hard to compute exactly for makespan, but *information* is complete). **Online** scheduling must assign each job **irrevocably on arrival**, blind to all future jobs. The handicap is **missing future information, not computation** — even with infinite compute per step, an online scheduler can be forced to `(2 − 1/m)` because it committed early jobs without knowing a big one was coming. That's precisely the **competitive** (information) vs **approximation** (computation) distinction. Semi-online algorithms like LPT sit in between: they get *some* of the offline information (the sortable job set) back.

### Q18: "If two choices beat one, do a million choices beat two?" *(Medium)*

**Answer**: **No — there's sharply diminishing returns.** Going `1 → 2` is the exponential jump (`log n → log log n`). Going `2 → d` only improves the **constant**: max load `≈ log log n / log d`. So `d = 1000` gives the same *asymptotic* `log log n` as `d = 2`, just a smaller constant — not worth the `1000×` coordination cost. The full-information extreme, JSQ (`d = n`), is optimal but `O(n)` per request. **Two is the sweet spot**: nearly all the benefit, minimal cost. Naming the `log log n / log d` form signals you understand *why* two is special and more isn't dramatically better.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Online makespan objective? | Minimize the max machine load, assigning jobs irrevocably on arrival |
| 2 | Graham's list scheduling rule? | Greedy — assign each job to the least-loaded machine |
| 3 | List-scheduling competitive ratio? | **`2 − 1/m`** (tight) |
| 4 | Two lower bounds on OPT? | `OPT ≥ avg load = (Σpⱼ)/m` and `OPT ≥ max pⱼ` |
| 5 | Key idea of the proof? | Busiest machine = (below-average load before last job) + (one job ≤ OPT) |
| 6 | Tight adversary for greedy? | `m(m−1)` unit jobs then one job of size `m` → ratio `(2m−1)/m` |
| 7 | LPT rule? | Sort jobs **decreasing**, then greedy |
| 8 | LPT makespan ratio? | **`4/3 − 1/(3m)`** |
| 9 | Why is LPT semi-online? | It must see all jobs to sort before placing any |
| 10 | Next-Fit bin packing? | **2-competitive** (two consecutive bins hold > 1) |
| 11 | First-Fit / Best-Fit ratio? | **1.7** |
| 12 | Online bin-packing lower bound? | **≈ 1.54** |
| 13 | Offline FFD ratio? | `11/9 ≈ 1.22` |
| 14 | Three machine models? | Identical, related (speeds), unrelated (arbitrary `pᵢⱼ`) |
| 15 | Greedy on unrelated machines? | **`O(log m)`** (tight; `Ω(log m)` lower bound) |
| 16 | Makespan vs flow time? | Last-finish (load) vs completion − arrival (responsiveness) |
| 17 | Why flow time needs augmentation? | Online ratio is unbounded; `(1+ε)`-speed → `O(1/ε)` (SRPT) |
| 18 | Power of two choices: 1 vs 2 max load? | `Θ(log n/log log n)` → **`Θ(log log n)`** |
| 19 | Effect of `d` choices? | `log log n / log d` — only a constant gain past 2 |
| 20 | JSQ vs two-choices cost? | JSQ `O(n)` (optimal), two-choices `O(1)` (near-optimal) |

---

## Common Mistakes

1. **Claiming greedy is "always within 2× in practice."** `(2 − 1/m)` is a worst-case ceiling forced by one big job after many tiny ones; with small jobs greedy is near-optimal.
2. **Calling LPT an online algorithm.** It must sort the whole job set first — it's **semi-online**, and its `4/3` bound isn't comparable to the `(2 − 1/m)` online bound.
3. **Mixing up the bin-packing numbers.** Next-Fit **2**, First-Fit/Best-Fit **1.7**, online lower bound **≈ 1.54**, offline FFD **11/9**. Don't swap them.
4. **Forgetting both OPT lower bounds.** The makespan proof needs *both* `OPT ≥ avg` and `OPT ≥ max job`; using only one doesn't give `(2 − 1/m)`.
5. **Thinking unrelated machines are just "related with more speeds."** Unrelated means an arbitrary `pᵢⱼ` matrix (no global speed order) — that's why greedy degrades to `O(log m)`.
6. **Expecting bounded flow-time competitiveness.** Total flow time is unbounded online; you need **speed augmentation** to get a constant — quote `(1+ε)`-speed → `O(1/ε)`.
7. **Believing more sampled servers keep helping a lot.** `1 → 2` is exponential (`log n → log log n`); `2 → d` is only a constant factor `1/log d`. Two is the sweet spot.

---

## Tips & Summary

- **Lead with the two OPT lower bounds** (`avg` and `max job`); the entire `(2 − 1/m)` proof is just "busiest machine = below-average load + one job," each term `≤ OPT`.
- **Memorize the canonical numbers**: greedy makespan **`2 − 1/m`** (tight); LPT **`4/3 − 1/(3m)`** (semi-online); Next-Fit **2**, First-Fit **1.7**, bin-packing online lower bound **≈ 1.54**; unrelated machines greedy **`O(log m)`**; power-of-two-choices **`log log n`**. These are the constants interviewers expect on sight.
- **Narrate the tight adversary** for greedy: `m(m−1)` unit jobs spread evenly, then one job of size `m` lands on top → `2m − 1` vs `OPT = m`.
- **Frame LPT and FFD as the same trick** — "sort big-first so no large job arrives late onto a loaded machine" — and flag that it requires offline/semi-online information.
- **For the practical question, reach for power-of-two-choices**: two random probes give `log log n` max load vs `log n` for one, at `O(1)` cost — JSQ-quality balance without global state. That's why real load balancers do it.
- **When a bare ratio is unbounded (flow time), pivot to resource augmentation**: `(1 + ε)`-speed machines make SRPT `O(1/ε)`-competitive — the scheduling analogue of extra cache in [../03-paging-and-caching-theory/interview.md](../03-paging-and-caching-theory/interview.md).

**Related:** [Competitive Analysis — Interview](../01-competitive-analysis/interview.md) · [Paging & Caching Theory — Interview](../03-paging-and-caching-theory/interview.md) · [Online Scheduling & Load Balancing — Middle](./middle.md)
