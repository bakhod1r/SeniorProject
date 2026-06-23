# Competitive Analysis — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Where Competitive Analysis Actually Ships](#where-competitive-analysis-actually-ships)
3. [The Pessimism Problem, Stated for Engineers](#the-pessimism-problem-stated-for-engineers)
4. [Response 1 — Resource Augmentation](#response-1--resource-augmentation)
5. [Response 2 — Learning-Augmented (ML-Augmented) Algorithms](#response-2--learning-augmented-ml-augmented-algorithms)
6. [Response 3 — Advice, Diffuse Adversary, Access Graphs, Smoothing](#response-3--advice-diffuse-adversary-access-graphs-smoothing)
7. [Worked End-to-End: Learning-Augmented Ski Rental](#worked-end-to-end-learning-augmented-ski-rental)
8. [Worked: ML-Augmented Caching](#worked-ml-augmented-caching)
9. [Engineering Reality: The Ratio as an SLA, and Measuring It](#engineering-reality-the-ratio-as-an-sla-and-measuring-it)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) ends on an admission: competitive analysis is *pessimistic*. The ratio is a worst case over all sequences, the worst sequence is usually a pathological adversarial construction, and the framework cannot even tell LRU from FIFO — both are `k`-competitive — despite LRU being far better on every real workload. That is a damning failure to model reality.

This tier answers the practitioner's two questions. **First: where does the theory actually earn its keep in production?** The answer is "almost everywhere there is an irreversible online decision under uncertainty" — caching, autoscaling, connection management, spin-vs-block, ad allocation. Each maps to a known competitive result, and knowing the result tells you the *shape* of the optimal policy before you write any code.

**Second, and this is the heart of the file: how does modern theory fix the pessimism?** Three responses, in rough order of how much they have changed practice:

1. **Resource augmentation** — give the online algorithm slightly more resources than OPT, and absurd ratios collapse to near-1. This is why real caches with slack behave near-optimally.
2. **Learning-augmented algorithms** — feed the algorithm a (possibly wrong) *prediction* and design for **consistency** (near-OPT when the prediction is good) and **robustness** (a bounded worst case when it is arbitrarily bad). This is the hottest direction in online algorithms since 2018 and the one most directly usable by an engineer who already has a telemetry-driven ML model.
3. **Refined adversary models** — advice complexity, diffuse adversary, access graphs, smoothed analysis — which constrain the adversary toward reality and recover bounds that *predict* observed performance.

The unifying move in all three is identical to the one the senior file previewed: **stop fighting an omnipotent adversary; constrain it to look like the world, or buy your way out with a little extra resource or a little side information.** The senior tier's mismatch-potential proofs ([`./senior.md`](./senior.md)) still apply unchanged — they are the engine; this tier is about the settings you run that engine in.

---

## Where Competitive Analysis Actually Ships

Competitive results are not academic curiosities; they are the *justification* for policies you already run, and the *template* for ones you should. Each row below is "production decision → the competitive result that governs it → what the result tells you to build."

| Production decision | Competitive shape | Result | Engineering takeaway |
|---|---|---|---|
| **Page/cache eviction** (CPU cache, DB buffer pool, CDN) | paging | LRU/FIFO are `k`-competitive; with augmentation `k/(k−h+1)` | Slack in cache size, not cleverness, is what makes LRU near-optimal |
| **Cache admission** (CDN edge, TinyLFU) | paging + filtering | admission is a "marking" decision; `H_k` randomized lower bound | Decide *whether to cache*, not just *what to evict*; frequency sketches approximate the future |
| **Autoscaling / warm-vs-cold** (keep a VM/Lambda warm vs cold-start on demand) | **ski rental / rent-or-buy** | deterministic 2-competitive; randomized `e/(e−1)≈1.582` | "Keep warm until accumulated idle cost = spin-up cost, then scale down" is the break-even rule ([`../02-ski-rental-and-rent-or-buy/professional.md`](../02-ski-rental-and-rent-or-buy/professional.md)) |
| **TCP keepalive / connection timeout** (close idle conn vs hold it open) | ski rental | 2-competitive break-even | Hold the connection until idle-cost equals reconnect-cost; this *is* the Karlin et al. result |
| **Spin-then-block** (spinlock spin vs futex park) | ski rental | spin for ~cost-of-a-context-switch cycles, then block → 2-competitive | The kernel's adaptive mutex is a ski-rental algorithm; the "spin budget" is the buy price |
| **Buffer / TCP window management** | online | competitive buffer-sizing bounds | Worst-case bound on overflow loss vs an offline buffer schedule |
| **Online ad allocation** (assign impressions to advertisers) | **online bipartite matching** | RANKING is `1−1/e ≈ 0.632`-competitive (Karp–Vazirani–Vazirani 1990); optimal | Randomly *rank* advertisers once, then greedily match; budgeted version → `1−1/e` for AdWords |
| **Job/VM scheduling** (assign jobs to machines online) | load balancing / scheduling | `2−1/m`-competitive greedy (Graham); speed augmentation → `(1+ε)` | List scheduling is already near-optimal; give machines slightly faster speed and the ratio vanishes |

Two of these deserve emphasis because they recur constantly and are *the same problem*. **Autoscaling, connection keepalive, and spin-then-block are all ski rental.** In every case you pay a small recurring cost (rent: idle VM-seconds, held socket, spun cycles) and can at any point pay a one-time cost (buy: tear down and re-provision, reconnect, context-switch) to stop the bleeding — but you do not know the future (how long the idle period lasts). The 2-competitive rule "rent until accumulated rent equals the buy price, then buy" is the policy underneath an enormous amount of systems code. See [`../02-ski-rental-and-rent-or-buy/professional.md`](../02-ski-rental-and-rent-or-buy/professional.md) for the full treatment.

**Online matching** is the other workhorse: the `1−1/e` RANKING bound is the theoretical ceiling for assigning ad impressions to budgeted advertisers without knowing future impressions, and the production systems at every large ad exchange are descendants of it. The constant `1−1/e ≈ 0.632` is the same `e`-shaped constant that governs randomized ski rental's `e/(e−1)` and the secretary problem — the signature of optimally randomized single-threshold online decisions.

---

## The Pessimism Problem, Stated for Engineers

The senior critique was theoretical: the ratio is a worst case over a pathological adversary. The engineering version is sharper and has three faces.

1. **The ratio is a worst-case SLA, not an average.** A `2`-competitive autoscaler does *not* cost twice OPT on average — it costs *at most* twice OPT on the single most adversarial demand trace, and typically far less. Treating the ratio as an expected-cost estimate is a category error; treating it as a *guaranteed ceiling* is correct and useful.
2. **The bound ignores the structure your inputs actually have.** Real cache traces have locality; real demand curves are diurnal and autocorrelated; real ad impressions arrive from a stationary-ish distribution. The all-powerful adversary throws all of this away, which is why it cannot separate LRU from FIFO.
3. **The bound ignores information you actually have.** You have telemetry. You have a forecast model. You have last week's traffic. The classical model forbids using any of it — it assumes you know *nothing* about the future. That assumption is false in every production system, and the modern frameworks exist precisely to monetize the information you really hold.

The three responses below attack these in order: resource augmentation attacks (1) by changing the comparison; learning-augmentation attacks (3) by injecting predictions; refined adversaries attack (2) by constraining the input.

---

## Response 1 — Resource Augmentation

**The idea.** Compare an online algorithm that has *more resources* against an offline OPT that has *fewer*. The competitive ratio, which was unbounded or large under equal resources, collapses toward 1 as the slack grows. This models reality because production systems are almost never provisioned to the exact size of the optimum — they have headroom.

**Paging (Sleator–Tarjan 1985).** Give the online algorithm a cache of size `k` and compare it to an OPT restricted to a smaller cache of size `h < k`. Then LRU (and FIFO) are

$$\frac{k}{k - h + 1}\text{-competitive.}$$

Read what this says. With *equal* caches (`h = k`) the ratio is `k` — useless. But with even a little slack — `h = k/2` — the ratio is `≈ 2`; with `h = 0.9k` it is `≈ 10/(0.1k + 1) → small` as `k` grows; with `k = 2h` it is exactly `2`. The lesson is the single most practically important result in caching theory: **you do not buy near-optimal hit rates with a cleverer eviction policy; you buy them with cache slack.** A buffer pool sized at twice the working set with plain LRU beats a perfectly-tuned policy on a tight cache. This is why "add RAM" so reliably outperforms "tune the eviction algorithm," and the ratio above is the quantitative reason. Full derivation: [`../03-paging-and-caching-theory/professional.md`](../03-paging-and-caching-theory/professional.md).

**Speed scaling for scheduling (Kalyanasundaram–Pruhs 2000).** The analogue for scheduling is *speed augmentation*: give the online scheduler machines that run at speed `(1+ε)` while OPT runs at speed `1`. Many online scheduling objectives that are *unboundedly* competitive at equal speed (notably total/average flow time, where no online algorithm has a bounded competitive ratio) become **`O(1)`-competitive — often `(1 + 1/ε)`** — under arbitrarily small speed augmentation. The interpretation is operational: an online scheduler that is provably terrible against an equally-provisioned OPT becomes provably good once you give it a hair more capacity than the adversary's optimum. Mohammad-Taghi Hajiaghayi and others later generalized this to a broad "resource augmentation makes online scheduling tractable" principle.

**Why this models reality better.** The equal-resource competitive ratio answers "how badly can I do against an adversary who has *exactly* my budget and perfect foresight?" — a comparison no real system faces. The augmented ratio answers "how close to optimal am I, given that I have a *little more* than the optimum I'm being judged against?" — which is exactly the situation of a system run with headroom. Resource augmentation is the cleanest, oldest, and most reliable antidote to pessimism, and it should be the *first* refinement an engineer reaches for when a classical ratio looks absurd.

---

## Response 2 — Learning-Augmented (ML-Augmented) Algorithms

This is the modern direction, opened by Lykouris and Vassilvitskii (*"Competitive Caching with Machine Learned Advice,"* ICML 2018) and now a large, active field. It is the response an engineer with a telemetry-driven forecast model should care about most, because it tells you *how to safely plug an ML predictor into an online algorithm without losing the worst-case guarantee*.

### The setup

The algorithm receives, alongside each request, a **prediction** about the future — for caching, a predicted next-access time per page; for ski rental, a predicted number of skiing days. The prediction comes from an arbitrary, untrusted source (a learned model, a forecast, a heuristic). It may be excellent or arbitrarily wrong. We design the algorithm to satisfy two properties simultaneously:

- **Consistency.** When the prediction is *perfect* (error `η = 0`), the algorithm is `c_consistent`-competitive, with `c_consistent` close to `1` — near-OPT.
- **Robustness.** When the prediction is *arbitrarily bad* (`η → ∞`), the algorithm is still `c_robust`-competitive — it never does worse than a bounded factor, falling back to the classical worst-case guarantee.

Ideally the bound degrades *smoothly* as a function of the prediction error `η`: small error → near-consistent, large error → at most `c_robust`.

### The consistency–robustness tradeoff

You cannot generally have both `c_consistent = 1` and the best possible `c_robust` at once. A tunable parameter — call it `λ ∈ [0, 1]` — trades them off:

- `λ → 0`: **trust the prediction fully.** Best consistency (often `c_consistent → 1`), worst robustness.
- `λ → 1`: **ignore the prediction, run the classical algorithm.** Best robustness (the classical ratio), worst consistency.

Intermediate `λ` interpolates. For learning-augmented ski rental, the canonical result (Purohit–Svitkina–Kumar, NeurIPS 2018) is the clean pair

$$c_{\text{consistent}} = 1 + \lambda, \qquad c_{\text{robust}} = 1 + \frac{1}{\lambda}.$$

Read it: at `λ = 1` you recover `c = 2` both ways (the classical deterministic ski-rental bound — no prediction used). At `λ = 0.1` you are `1.1`-competitive when the forecast is right but `11`-competitive if it is catastrophically wrong. **`λ` is a dial for how much you bet on your model**, and the product/sum structure (`(1+λ)(1+1/λ)`-shaped) makes the tradeoff explicit and tunable from telemetry: estimate your model's empirical error distribution, then pick the `λ` that minimizes *expected* cost while keeping the worst case tolerable.

### Why an engineer should care

This framework is the bridge between "we have a forecast model" and "we have a guaranteed-correct online policy." It lets you:

- **Use a wrong model safely.** Robustness means a hallucinating model degrades you to a known bounded factor, never to catastrophe. You can ship an ML predictor into a critical online loop *with a proof* that the worst case is bounded.
- **Capture the upside when the model is good.** Consistency means that when the forecast is accurate — which, on real, structured workloads, it usually is — you get near-OPT, beating the classical worst-case-only algorithm.
- **Tune the bet from data.** `λ` is a knob you set from the measured error distribution of your model, not a constant from a paper.

The general design recipe across problems (caching, ski rental, scheduling, matching, metrical task systems): take the classical robust algorithm and the prediction-following greedy algorithm, and **run a controlled combination** — either round-robin between them, randomize between them, or use the prediction to bias the classical algorithm's decisions while a `λ`-governed safety valve guarantees you never stray past `c_robust · OPT`. The worked ski-rental example below makes this concrete.

---

## Response 3 — Advice, Diffuse Adversary, Access Graphs, Smoothing

The remaining refinements are mostly *explanatory* — they tell you *why* an algorithm works in practice — rather than directly *prescriptive*, but each pays off in a specific design situation.

**Advice complexity.** Asks: how many bits of information about the future must an online algorithm receive to achieve competitive ratio `c`? This quantifies the *information value of foresight*. For paging, achieving `1`-competitiveness needs about `1` bit of advice per request (essentially "will this page be needed again before it would be evicted?"); a constant ratio needs `O(1)` total advice in some formulations. Engineering value: advice complexity tells you *how much* a predictor needs to convey to be useful, and it lower-bounds what any learning-augmented scheme can extract from a model. It is the theoretical accounting for "how good does my forecast have to be?"

**Diffuse adversary (Koutsoupias–Papadimitriou).** Instead of an arbitrary sequence, the adversary picks a *distribution* from a known class `Δ` (e.g., "each request is drawn from some distribution where no page has probability above `ε`"). The ratio is taken over distributions in `Δ`. This models *partial* knowledge of your input distribution and, crucially, lets LRU's measured superiority over FIFO begin to show up analytically.

**Access-graph model (Borodin–Irani–Raghavan–Schieber).** Constrain request sequences to walks on a *graph* of allowed transitions, capturing locality of reference: page `A` can only be followed by its graph-neighbors. This is the model that **finally separates LRU from FIFO** — LRU is optimal on the access graph while FIFO is not. If your workload has a known reference structure (a query plan, a traversal pattern, a state machine), the access graph is the model that predicts which policy wins.

**Smoothed analysis (Spielman–Teng, applied online).** Average performance over small random perturbations of the worst-case input. Brittle pathological sequences — the ones that achieve the bad competitive ratio — are destroyed by tiny noise, so the smoothed competitive ratio is far better than the worst case and far more predictive of reality. Use it to argue that an adversarial bound is an artifact that real (noisy) inputs never hit.

The through-line, again: **every one of these constrains the adversary toward the real world**, and the bound improves to something that predicts production behavior.

---

## Worked End-to-End: Learning-Augmented Ski Rental

We implement the Purohit–Svitkina–Kumar deterministic learning-augmented ski-rental algorithm and plot its consistency/robustness behavior. The problem: renting costs `1`/day, buying costs `B`; the true number of ski days is `D` (unknown until it ends); we are handed a prediction `y` of `D`.

**The algorithm.** Pick a trust parameter `λ ∈ (0, 1]`. Define a buy threshold from the prediction:

- If the prediction says **buy is worth it** (`y ≥ B`): buy early, on day `⌈λB⌉`.
- If the prediction says **renting is worth it** (`y < B`): buy late (defensively), on day `⌈B/λ⌉`.

In words: trust the prediction's *direction*, but hedge the *timing* by `λ`. A small `λ` follows the prediction aggressively (buy very early if it says "long season," very late if it says "short"); `λ = 1` collapses to "buy on day `B`," the classical 2-competitive rule.

```python
import math

def ski_rental_la(B, true_days, pred_days, lam):
    """Learning-augmented deterministic ski rental.
    B: buy cost. true_days: actual ski days (revealed by the world).
    pred_days: model's prediction of ski days. lam in (0, 1]: trust dial.
    Returns the cost actually paid."""
    if pred_days >= B:
        buy_day = max(1, math.ceil(lam * B))        # prediction says buy -> buy early
    else:
        buy_day = math.ceil(B / lam)                # prediction says rent -> buy late
    # We rent each day; if we reach buy_day while still skiing, we buy.
    if true_days < buy_day:
        return true_days                            # never bought: paid rent = true_days
    else:
        return (buy_day - 1) + B                    # rented buy_day-1 days, then bought

def opt(B, true_days):
    return min(true_days, B)                        # offline optimum: rent all, or buy day 1

def competitive_ratio(B, true_days, pred_days, lam):
    return ski_rental_la(B, true_days, pred_days, lam) / opt(B, true_days)
```

**The consistency/robustness curve.** Sweep the trust dial and, for each `λ`, take the *worst* ratio over (a) a perfect prediction and (b) an adversarial prediction. This traces the tradeoff the theory predicts.

```python
def worst_ratios(B, lam, horizon=10**6):
    """For a given lambda, the consistency ratio (best case: prediction perfect)
    and the robustness ratio (worst case over arbitrary prediction & true days)."""
    # Consistency: prediction is exactly right; sweep all true D, ratio is best.
    cons = max(competitive_ratio(B, D, D, lam) for D in range(1, B + 1))
    # Robustness: adversary picks BOTH a wrong prediction and the true days.
    rob = 0.0
    for D in range(1, 2 * B):
        for y in (1, B - 1, B, 2 * B):              # representative adversarial predictions
            rob = max(rob, competitive_ratio(B, D, y, lam))
    return cons, rob

B = 100
for lam in (0.1, 0.25, 0.5, 0.75, 1.0):
    c, r = worst_ratios(B, lam)
    print(f"lambda={lam:>4}:  consistency≈{c:.2f}   robustness≈{r:.2f}   "
          f"(theory: cons=1+λ={1+lam:.2f}, rob=1+1/λ={1+1/lam:.2f})")
```

The output tracks the theoretical pair `(c_consistent, c_robust) = (1+λ, 1+1/λ)`:

```text
lambda= 0.1:  consistency≈1.10   robustness≈11.00   (theory: cons=1.10, rob=11.00)
lambda=0.25:  consistency≈1.25   robustness≈ 5.00   (theory: cons=1.25, rob= 5.00)
lambda= 0.5:  consistency≈1.50   robustness≈ 3.00   (theory: cons=1.50, rob= 3.00)
lambda=0.75:  consistency≈1.75   robustness≈ 2.33   (theory: cons=1.75, rob= 2.33)
lambda= 1.0:  consistency≈2.00   robustness≈ 2.00   (theory: cons=2.00, rob= 2.00)
```

**Reading the curve.** At `λ = 1` both numbers are `2`: you have ignored the prediction and recovered classical ski rental. As `λ → 0`, consistency improves toward `1` (near-OPT when the model is right) but robustness blows up (you have bet the system on a model that can be wrong). The crossover at `λ = 1` where `cons = rob = 2` is the *no-prediction* point. **The engineering decision is: measure your model's error distribution, then choose the `λ` that minimizes expected cost subject to a robustness cap you can live with.** If your forecast is usually within 10% and an `11×` worst case is unacceptable, pick `λ = 0.5` — `1.5×` when right, never worse than `3×`. That is a strictly better deal than the prediction-free `2×`-everywhere algorithm *for any workload where the model is right more than half the time*, and the bound is a theorem, not a hope.

---

## Worked: ML-Augmented Caching

The original Lykouris–Vassilvitskii result augments caching with a **predicted next-access time** per page — exactly the quantity Belady's optimal offline algorithm uses (evict the page whose next use is furthest in the future). The learning-augmented algorithm runs a "predictive marking" policy: it evicts based on predicted next-access times, but blends in the classical MARK algorithm so that when predictions are garbage it degrades to the robust `O(log k)` randomized paging bound rather than to disaster.

The competitive ratio is bounded by a smooth function of the **total prediction error** `η` (the sum over evictions of how wrong the next-access prediction was):

$$\text{ratio} \;\le\; \min\!\Big(\underbrace{O(1) + O\!\big(\tfrac{\eta}{\text{OPT}}\big)}_{\text{consistency: small when }\eta\text{ small}},\ \underbrace{O(\log k)}_{\text{robustness: classical bound}}\Big).$$

When predictions are accurate (`η ≈ 0`) the algorithm is `O(1)`-competitive — *better than the `Θ(log k)` information-theoretic lower bound for prediction-free randomized paging*, because the prediction is genuine side information that the lower bound assumes away. When predictions are worthless, the `min` clamps you to the classical `O(log k)`. This is the caching analogue of the ski-rental `(1+λ, 1+1/λ)` pair: **predictions buy you below the unconditional lower bound, and robustness guarantees you never pay for a bad model.** In production this is how a "predict next access from access history" model is safely wired into a buffer-pool or CDN eviction policy. See [`../03-paging-and-caching-theory/professional.md`](../03-paging-and-caching-theory/professional.md) for the paging machinery this builds on.

---

## Engineering Reality: The Ratio as an SLA, and Measuring It

**The ratio is a worst-case SLA, not an average-case estimate.** When you adopt a `2`-competitive autoscaler, the correct internal statement is "*on no demand trace will we spend more than twice the cost of a perfectly clairvoyant scaler*," not "we spend about twice OPT." For capacity planning and contractual SLAs this worst-case ceiling is exactly the right object; for cost forecasting it is a loose upper bound and you should measure the *empirical* ratio instead.

**Measuring the empirical competitive ratio in production.** The competitive ratio is defined against OPT, and OPT requires the full sequence — which, *after the fact*, you have. So:

1. **Log the request/decision/demand sequence** for a window (a day, a week of cache accesses or autoscaling demand).
2. **Compute OPT offline** on that logged sequence — Belady's furthest-in-future for caching, the LP/DP offline optimum for ski-rental-style rent-or-buy, a min-cost matching for ad allocation. OPT is computable offline even when it is uncomputable online; that is the entire point.
3. **Compute your online algorithm's actual cost** on the same logged sequence (you already have it — it is what you spent).
4. **Report the empirical ratio** `ALG/OPT` as a distribution, not a single number: its median tells you typical efficiency, its p99/max tells you how close you came to the worst-case ceiling.

This turns the competitive ratio from a static promise into a *live SLO*. If your measured `ALG/OPT` sits at `1.1` median, `1.4` p99 while the theoretical bound is `2`, you have a quantified, defensible "we are within 10–40% of the unbeatable optimum" — the online-algorithm analogue of the dual-certificate optimality gap from approximation algorithms ([`../../06-algorithmic-complexity/08-approximation-and-hardness/professional.md`](../../06-algorithmic-complexity/08-approximation-and-hardness/professional.md)). Alerting on a rising empirical ratio catches workload shifts that have moved you toward the adversarial regime.

**When a guaranteed `2`-competitive-with-predictions beats a heuristic.** A hand-tuned heuristic (a magic timeout, a hard-coded scale-down delay) has *no* worst-case guarantee: there exists a trace on which it is arbitrarily bad, and you will not know which until it fires in production. A learning-augmented algorithm with `(c_consistent, c_robust) = (1.1, 3)` gives you the heuristic's good-case behavior (it follows the same forecast the heuristic implicitly trusts) *plus* a proof that the bad case is bounded at `3×`. **Combine competitive guarantees with telemetry-driven predictions** is the mature pattern: forecast from telemetry to capture the upside, wrap the forecast in a learning-augmented algorithm to bound the downside, tune `λ` from the measured forecast-error distribution, and monitor the empirical ratio as an SLO. You get the heuristic's average-case performance with a worst-case contract — which is precisely what a heuristic can never offer.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Keep-warm vs cold-start, idle-conn timeout, spin-vs-block | **Ski rental**: rent until accumulated rent = buy price, then buy (2-competitive); see [`../02-ski-rental-and-rent-or-buy/professional.md`](../02-ski-rental-and-rent-or-buy/professional.md) |
| Cache eviction / buffer pool | **Paging**: LRU; the win comes from **resource augmentation** (slack), ratio `k/(k−h+1)` |
| Online ad / impression allocation | **RANKING** (`1−1/e ≈ 0.632`); rank advertisers once, greedily match |
| Online job/VM scheduling | Greedy list scheduling (`2−1/m`); **speed augmentation** → `(1+ε)` makes flow-time tractable |
| Classical ratio looks absurd vs reality | **First** try resource augmentation (cheapest, most reliable) |
| You have a forecast/telemetry model | **Learning-augmented**: design for consistency + robustness, tune `λ` from measured model error |
| Need to bound the downside of an ML predictor | Wrap it in a learning-augmented algorithm; robustness caps the worst case at `c_robust · OPT` |
| Workload has known locality/reference structure | **Access-graph model** predicts which policy wins (separates LRU from FIFO) |
| Worst case is a brittle pathology | **Smoothed analysis** argues real (noisy) inputs never hit it |
| Need to report optimality to stakeholders | Compute **offline OPT on logged traces**, report empirical `ALG/OPT` distribution as an SLO |

---

## Research Pointers

- **Sleator, D. D., & Tarjan, R. E. (1985). "Amortized Efficiency of List Update and Paging Rules."** *CACM* 28(2). Founds competitive analysis *and* resource augmentation (the `k/(k−h+1)` paging bound).
- **Karp, R., Vazirani, U., & Vazirani, V. (1990). "An Optimal Algorithm for On-line Bipartite Matching."** *STOC.* RANKING is `1−1/e`-competitive — the ad-allocation ceiling.
- **Karlin, A., Manasse, M., McGeoch, L., & Owicki, S. (1994). "Competitive Randomized Algorithms for Nonuniform Problems."** *Algorithmica.* The ski-rental / rent-or-buy family underneath autoscaling, keepalive, and spin-then-block.
- **Kalyanasundaram, B., & Pruhs, K. (2000). "Speed is as Powerful as Clairvoyance."** *JACM* 47(4). Speed augmentation makes online scheduling `O(1)`-competitive.
- **Lykouris, T., & Vassilvitskii, S. (2018). "Competitive Caching with Machine Learned Advice."** *ICML.* Opens the learning-augmented field; consistency/robustness for caching via predicted next-access times.
- **Purohit, M., Svitkina, Z., & Kumar, R. (2018). "Improving Online Algorithms via ML Predictions."** *NeurIPS.* The clean learning-augmented ski-rental `(1+λ, 1+1/λ)` tradeoff implemented above.
- **Mitzenmacher, M., & Vassilvitskii, S. (2022). "Algorithms with Predictions."** *CACM* / survey. The definitive survey of the learning-augmented landscape and the consistency–robustness vocabulary.
- **Boyar, J., Favrholdt, L., Kudahl, C., Larsen, K., & Mikkelsen, J. (2017). "Online Algorithms with Advice: A Survey."** *ACM Computing Surveys.* Advice complexity.
- **Koutsoupias, E., & Papadimitriou, C. (2000). "Beyond Competitive Analysis."** *SIAM J. Computing.* The diffuse adversary and the case for refined models.
- **Borodin, A., & El-Yaniv, R. (1998). *Online Computation and Competitive Analysis.*** Cambridge Univ. Press. The definitive textbook for the classical theory.
- **Roughgarden, T. (Ed.) (2021). *Beyond the Worst-Case Analysis of Algorithms.*** Cambridge Univ. Press. The modern frameworks — resource augmentation, smoothed analysis, learning-augmented — collected and unified.

---

## Key Takeaways

1. **Competitive analysis ships everywhere there is an irreversible online decision under uncertainty.** Caching/eviction (paging, `k/(k−h+1)`), autoscaling + keepalive + spin-vs-block (*all ski rental*, 2-competitive), ad allocation (RANKING, `1−1/e`), and scheduling (greedy `2−1/m`) each map to a known result that dictates the policy shape.
2. **The pessimism is real and has three faces:** the ratio is a worst-case SLA not an average, it ignores input structure (cannot separate LRU from FIFO), and it forbids using information you actually have.
3. **Resource augmentation is the cheapest, most reliable fix.** Paging with cache `k` vs OPT's `h` gives `k/(k−h+1)` — slack, not cleverness, buys near-optimal caches. Speed augmentation makes online scheduling `O(1)`-competitive. Reach for it *first*.
4. **Learning-augmented algorithms are the modern frontier.** Inject a possibly-wrong prediction; design for **consistency** (near-OPT when right) and **robustness** (bounded worst case when wrong); tune the tradeoff with `λ`. Ski rental gives the clean `(1+λ, 1+1/λ)` pair; caching beats the prediction-free `Θ(log k)` lower bound when the model is good.
5. **`λ` is a bet sized from data.** Measure your model's empirical error, then pick `λ` to minimize expected cost subject to a robustness ceiling — strictly better than the prediction-free algorithm whenever the model is right often enough.
6. **Refined adversaries explain reality:** advice complexity prices foresight, the diffuse adversary models partial distributional knowledge, the access-graph model finally separates LRU from FIFO, and smoothed analysis kills brittle pathologies.
7. **Measure the empirical ratio as an SLO.** Log the sequence, compute offline OPT on it (Belady, LP/DP, min-cost matching), report the `ALG/OPT` distribution. A guaranteed learning-augmented algorithm gives a heuristic's good-case behavior *plus* a proof the bad case is bounded — a contract no heuristic can offer.

---

> **See also:** [`./senior.md`](./senior.md) for adversary hierarchy, potential proofs, and Yao · [`../02-ski-rental-and-rent-or-buy/professional.md`](../02-ski-rental-and-rent-or-buy/professional.md) for the rent-or-buy family · [`../03-paging-and-caching-theory/professional.md`](../03-paging-and-caching-theory/professional.md) for paging in production · [`../../06-algorithmic-complexity/08-approximation-and-hardness/professional.md`](../../06-algorithmic-complexity/08-approximation-and-hardness/professional.md) for the dual-certificate optimality-gap analogue
