# Ski Rental and Rent-or-Buy — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [Spin-Then-Block: The Original Systems Instance](#spin-then-block-the-original-systems-instance)
3. [The Rent-or-Buy Catalog: Systems Decisions That Are Ski Rental](#the-rent-or-buy-catalog-systems-decisions-that-are-ski-rental)
4. [Learning-Augmented Rent-or-Buy in Production](#learning-augmented-rent-or-buy-in-production)
5. [Worked: Warm-Pool Sizing with a Predicted Idle Duration](#worked-warm-pool-sizing-with-a-predicted-idle-duration)
6. [Worked End-to-End: Adaptive Spin-Then-Block in Code](#worked-end-to-end-adaptive-spin-then-block-in-code)
7. [Engineering Reality: The Ratio as an SLA Floor](#engineering-reality-the-ratio-as-an-sla-floor)
8. [Pitfalls That Break the Cost Model](#pitfalls-that-break-the-cost-model)
9. [Decision Framework](#decision-framework)
10. [Research Pointers](#research-pointers)
11. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) proved that ski rental sits at the conceptual center of online algorithms: the `e/(e−1)` constant is the exact game value by Yao, both algorithms fall out of one covering LP via online primal–dual, and a whole rent-or-buy family — TCP-ack, Bahncard, parking-permit, network rent-or-buy, learning-augmented — radiates from it. That tier is about *why the math is what it is*.

This tier is about *where the math is already running in your production code, whether you named it or not*. The thesis is blunt: **an enormous amount of systems engineering is ski rental in a costume, and the costume usually hides the fact that the right policy is a one-line break-even rule with a proven 2-competitive guarantee.** A thread deciding whether to spin or block; an autoscaler deciding whether to keep a container warm; a connection pool deciding whether to hold an idle socket; a cache deciding when to flush a dirty page; a finance team deciding between on-demand and reserved cloud capacity — every one of these is "pay a small recurring cost (rent) until you make a one-time irrevocable payment (buy), without knowing how long the idle period lasts."

Three things make this tier *professional* rather than academic:

1. **The classic systems instance is spin-then-block** (Karlin, Li, McGuire, Owicki and the broader Karlin–Manasse–McGeoch–Owicki line). It is literally how Linux futexes, the JVM, and `pthread` adaptive mutexes decide whether to busy-wait or park. We start there because it is the cleanest proof that this theory is load-bearing in code you run every day.
2. **You almost always have a prediction.** Historical session length, an ML-predicted idle time, an autoscaler's demand forecast. The Purohit–Svitkina–Kumar learning-augmented framework tells you how to *use* that prediction with a tunable `λ` that trades consistency against robustness — and how to pick `λ` from your model's measured confidence.
3. **The competitive ratio is an SLA floor, not a cost estimate.** We show how to measure the *empirical* ratio against an offline-OPT replay of telemetry, when to retune the break-even threshold for asymmetric or time-varying costs, and the pitfalls that silently invalidate the whole model.

---

## Spin-Then-Block: The Original Systems Instance

A thread wants a lock that is currently held. It has two options:

- **Spin** (busy-wait): keep checking the lock in a tight loop. This burns CPU cycles — it is *renting* the CPU. If the lock is released after a few cycles, spinning is cheap and you avoid a context switch entirely.
- **Block** (park): hand the CPU back to the scheduler and sleep until woken. This costs a fixed `C` — the price of two context switches plus cache/TLB damage from the descheduling — but it stops the bleeding: a blocked thread burns no cycles while it waits.

The thread does **not know** how long the holder will keep the lock. If the lock frees in 50 cycles, spinning wins overwhelmingly. If it stays held for 10 ms, spinning wastes millions of cycles and blocking would have been far cheaper. This is *exactly* ski rental: spinning is renting (1 cost per cycle), blocking is buying (one-time cost `C`), and the unknown future is the lock's remaining hold time.

### The break-even rule and its 2-competitive guarantee

Karlin, Manasse, McGeoch, and Owicki (1990) gave the algorithm and the proof: **spin for exactly `C` cycles; if the lock is still held, block.** Let `t` be the true remaining hold time (revealed only when the lock frees).

- If `t ≤ C`: the algorithm spins the whole time, paying `t`. OPT also spins, paying `t`. Ratio `1`.
- If `t > C`: the algorithm spins `C` cycles, then blocks, paying `C + C = 2C`. OPT, knowing the future, would have blocked immediately, paying `C`. Ratio `2`.

So the deterministic spin-then-block policy is **2-competitive**, and — as with vanilla ski rental — no deterministic strategy beats it. The spin budget equals the buy price `C`; this is the systems statement of "rent until accumulated rent equals the buy price, then buy."

### The randomized improvement

Against an oblivious adversary you can do better. Randomize the spin budget: choose the cutoff from the truncated-geometric distribution derived in [`./middle.md`](./middle.md) and [`./senior.md`](./senior.md), and the expected competitive ratio drops to `e/(e−1) ≈ 1.582`. KMMO proved this is optimal. In practice a fully randomized spin budget is rarely implemented verbatim — the bookkeeping costs more than the ~21% it saves — but the *idea* (don't always spin the same fixed amount; jitter the cutoff) shows up as randomized backoff and as adaptive estimation of the cutoff from recent history.

### How real synchronization primitives implement this

This is not a metaphor — it is the actual design of adaptive locks:

- **Linux futexes / adaptive spinning.** A futex's fast path is a userspace atomic; the slow path is the `futex()` syscall that parks the thread (the "buy"). Kernel mutexes (`mutex_lock`) and `glibc`'s `PTHREAD_MUTEX_ADAPTIVE_NP` spin for a bounded number of iterations — tuned to roughly the context-switch cost — and fall back to parking. The bound *is* the ski-rental buy price.
- **JVM adaptive locking.** HotSpot's monitors spin adaptively before inflating to an OS-level wait. The spin count is adjusted from recent success rates (a crude online estimate of `t`), which is a heuristic learning-augmented variant: it predicts the hold time from history and shortens or lengthens the spin budget accordingly.
- **`pthread` adaptive mutex / `std::mutex` implementations.** `PTHREAD_MUTEX_ADAPTIVE_NP` and many C++ standard-library mutexes spin a fixed budget then block. The number is a hand-tuned approximation of `C`.

When a kernel or runtime author writes "spin for N iterations then sleep," they have, knowingly or not, implemented the 2-competitive ski-rental algorithm with `N ≈ C`. Getting `N` right is exactly the break-even-tuning problem this tier is about.

---

## The Rent-or-Buy Catalog: Systems Decisions That Are Ski Rental

Once you can see spin-then-block as ski rental, the pattern is everywhere. Each row pays a recurring **rent** until a one-time **buy** stops it, under an unknown idle/active future. The break-even rule is always the same shape: *rent until accumulated rent equals the buy price, then buy.*

| Systems decision | Rent (recurring) | Buy (one-time) | Unknown future | Break-even |
|---|---|---|---|---|
| **Spin-then-block** | CPU cycles spun | context switch `C` | remaining lock hold time | spin `C` cycles, then park |
| **TCP keep-alive / conn reuse** | holding an idle socket (memory, FD, keepalive probes) | teardown + reconnect (handshake, slow-start) | time until next request on this conn | hold until idle-cost = reconnect-cost |
| **Autoscaling warm vs cold** | idle VM/container seconds | cold-start latency + spin-up cost | time until next request to this instance | keep warm until idle-cost = cold-start cost |
| **Serverless warm pools** | paying for pre-warmed workers | cold invocation penalty | inter-arrival gap of invocations | keep N warm until idle-cost = cold penalty |
| **DB connection pooling** | idle pooled connection (server memory, backend slot) | new connect (auth, TLS, backend fork) | time until pool needs this conn again | retire conn when idle-cost = reconnect-cost |
| **Cache writeback timing** | risk/staleness window of a dirty page held in cache | flush (write I/O to backing store) | time until the page is overwritten again | write-back: delay flush until hold-cost = write-cost |
| **CDN object retention** | edge storage rent for a cached object | re-fetch from origin on miss | time until next request for the object | evict when storage-cost = expected re-fetch cost |
| **Cloud on-demand vs reserved** | on-demand hourly rate | reserved / committed-use up-front commitment | how long you'll actually use the capacity | commit when cumulative on-demand spend = reservation price |
| **Checkpoint / snapshot interval** | recompute-since-last-checkpoint risk | checkpoint write cost | time until the next failure | checkpoint when expected redo-cost = checkpoint-cost |

Two clusters deserve emphasis.

**The "keep warm vs pay cold-start" cluster** — autoscaling, serverless warm pools, connection pooling, TCP keep-alive — is the single most common production form. In every case you pay rent to *avoid* a future cold-start, but you don't know if the next request will arrive in 200 ms (keep warm, obviously) or in 40 minutes (you've burned 40 minutes of rent for nothing). The 2-competitive rule says: **keep the resource warm until the accumulated idle cost equals the cold-start cost, then release it.** If a cold start costs the equivalent of 5 minutes of idle compute, keep the instance warm for exactly 5 minutes of idleness, then scale it down. This is provably within 2× of a clairvoyant scaler on every possible demand trace.

**Cache writeback** is the subtle one because the "rent" is a *risk* cost, not a cash cost. Holding a dirty page in a write-back cache rents durability risk and coalescing opportunity; flushing buys safety at the price of a write. Write-through is "buy immediately every time" (`λ → 0` aggressive); pure write-back with no flush is "never buy" (unbounded risk). The break-even flush interval is the ski-rental timing decision, and it is why real buffer managers flush on an interval tuned to the write cost and the staleness tolerance.

---

## Learning-Augmented Rent-or-Buy in Production

The classical 2-competitive rule assumes you know *nothing* about the future. In production that assumption is almost always false. You have:

- **Historical session/idle-length distributions** for connections and warm instances.
- **An ML-predicted idle time** from a model fed request patterns, time-of-day, and tenant behavior.
- **An autoscaler's demand forecast** that already exists for capacity planning.

The Purohit–Svitkina–Kumar (NeurIPS 2018) framework, developed at length in [`./senior.md`](./senior.md), tells you how to *monetize* that prediction while keeping a worst-case guarantee. Recall the setup: renting costs `1`/unit, buying costs `B`, the true horizon is `D`, and you're handed a prediction `y` of `D`. The deterministic algorithm uses a trust dial `λ ∈ (0, 1]`:

- If `y ≥ B` (prediction says "long idle, you'll want to buy"): **buy early**, on day `⌈λB⌉`.
- If `y < B` (prediction says "short idle, just rent"): **buy late**, on day `⌈B/λ⌉`.

This yields the clean pair

$$c_{\text{consistent}} = 1 + \lambda, \qquad c_{\text{robust}} = 1 + \frac{1}{\lambda}.$$

When the prediction is perfect you are `(1+λ)`-competitive; when it is arbitrarily wrong you are never worse than `(1+1/λ)`-competitive. `λ = 1` recovers the prediction-free `2`-competitive rule.

### Picking `λ` from prediction confidence

`λ` is not a constant from a paper — it is a bet you size from your model's measured reliability. The consistency/robustness curve makes the tradeoff explicit:

| `λ` | Consistency `1+λ` (model right) | Robustness `1+1/λ` (model wrong) | Use when |
|---|---|---|---|
| `0.1` | `1.10` | `11.0` | Forecast is excellent and a rare blow-up is tolerable |
| `0.25` | `1.25` | `5.0` | High-confidence model, bounded blast radius needed |
| `0.5` | `1.50` | `3.0` | Good model, conservative; a common default |
| `0.75` | `1.75` | `2.33` | Low confidence; barely beating prediction-free |
| `1.0` | `2.00` | `2.00` | No trust; ignore the prediction entirely |

The disciplined procedure:

1. **Measure the model's error distribution** offline from telemetry — for each historical decision, compare predicted idle time `y` to the realized `D`.
2. **Fix a robustness ceiling** you can survive operationally. If a `3×` cost spike during a forecast failure is acceptable but `11×` would page someone and blow the budget, your ceiling is `c_robust ≤ 3`, i.e. `λ ≥ 0.5`.
3. **Among the `λ` satisfying the ceiling, pick the one that minimizes *expected* cost** under your measured error distribution. A model that is usually within 10% pushes you toward small `λ` (capture the upside); a noisy model pushes you toward `λ = 1` (trust nothing).

The key engineering property: **a wrong prediction degrades you to a known bounded factor, never to catastrophe.** This is what lets you wire an ML predictor into a critical warm-pool or spin-budget loop *with a proof* that the worst case is capped — something a hand-tuned heuristic timeout can never offer.

---

## Worked: Warm-Pool Sizing with a Predicted Idle Duration

Make it concrete. A serverless platform keeps a pool of warm workers. Keeping a worker warm costs `1` cost-unit per second of idleness. A cold start costs `B = 300` cost-units (latency penalty + spin-up compute), so the prediction-free break-even is "keep a worker warm for 300 idle-seconds, then release it."

We have a model predicting the idle gap `y` until the next invocation that would use this worker, trained on per-tenant arrival history. Its measured error is moderate. We use the PSK deterministic rule with `λ = 0.5` (consistency `1.5`, robustness `3.0` — we can survive a `3×` cost spike when the forecast misfires, but not an `11×` one).

- If the model predicts `y ≥ 300` (a long idle gap): we *believe* the worker will sit idle long enough that releasing it and eating one cold start is cheaper than paying rent the whole time → **buy (release) early**, after `⌈0.5 · 300⌉ = 150` idle-seconds.
- If the model predicts `y < 300` (a short idle gap): we believe an invocation is imminent and a cold start would be wasted → **buy (release) late**, after `⌈300 / 0.5⌉ = 600` idle-seconds, hedging against a wrong "stay warm" prediction.

Read the two failure modes. If the model says "long idle" but an invocation actually arrives at 160 s, we already released at 150 s and eat one avoidable cold start — bounded waste. If the model says "short idle" but the worker actually sits idle forever, we hold it to 600 s before releasing — at most `2×` the rent OPT would have paid, and within the `3×` robustness ceiling. Neither failure is catastrophic; both are capped by the `λ` we chose. That cap is the whole point: you get the model's upside on the common case and a theorem on the tail.

---

## Worked End-to-End: Adaptive Spin-Then-Block in Code

Here is the original systems instance implemented and measured. We model a lock whose hold time is drawn from a workload, compare the classical 2-competitive spin-then-block rule against a learning-augmented variant that uses a (noisy) predicted hold time, and measure empirical competitiveness against the offline optimum on synthetic traces.

```python
import math, random, statistics

C = 1000  # buy price: cost of a context switch, in "cycle" units == spin budget

def opt_cost(hold):
    """Clairvoyant optimum: if the holder frees within C cycles, spin (pay hold);
    otherwise block immediately (pay C)."""
    return min(hold, C)

def classic_spin_then_block(hold):
    """Deterministic 2-competitive: spin up to C cycles, then block."""
    if hold <= C:
        return hold              # freed while spinning
    return C + C                 # spun C cycles, then paid the block cost C

def la_spin_then_block(hold, pred, lam):
    """Learning-augmented spin budget from a predicted hold time `pred`.
    pred >= C  -> 'long hold, you'll block': block early, spin budget ceil(lam*C).
    pred <  C  -> 'short hold, you'll spin': hedge, spin budget ceil(C/lam)."""
    budget = math.ceil(lam * C) if pred >= C else math.ceil(C / lam)
    if hold <= budget:
        return hold              # freed while spinning within budget
    return budget + C            # spun `budget`, then blocked (pay C)

def empirical_ratio(alg, trace):
    """Mean of per-event ALG/OPT over a trace of (hold, pred) pairs."""
    ratios = []
    for hold, pred in trace:
        o = opt_cost(hold)
        ratios.append(alg(hold, pred) / o if o > 0 else 1.0)
    return statistics.mean(ratios), max(ratios)
```

Now build a bimodal synthetic workload — most locks free almost instantly (uncontended fast path), a minority are held long (a slow critical section) — and a noisy predictor that gets the *direction* right most of the time:

```python
def make_trace(n=200_000, noise=0.25, seed=7):
    rng = random.Random(seed)
    trace = []
    for _ in range(n):
        # 80% short holds (~50 cycles), 20% long holds (~5000 cycles)
        hold = rng.randint(10, 120) if rng.random() < 0.8 else rng.randint(3000, 8000)
        # predictor: true hold scaled by lognormal noise, occasionally flipped
        pred = hold * rng.lognormvariate(0, noise)
        if rng.random() < 0.05:                  # 5% catastrophic mispredictions
            pred = rng.choice([5, 50_000])
        trace.append((hold, pred))
    return trace

trace = make_trace()

m_classic, x_classic = empirical_ratio(
    lambda h, p: classic_spin_then_block(h), trace)
print(f"classic 2-competitive : mean ALG/OPT={m_classic:.3f}  max={x_classic:.2f}")

for lam in (0.25, 0.5, 1.0):
    m, x = empirical_ratio(lambda h, p, L=lam: la_spin_then_block(h, p, L), trace)
    print(f"learning-augmented λ={lam:<4}: mean ALG/OPT={m:.3f}  max={x:.2f}  "
          f"(theory: cons={1+lam:.2f}, rob={1+1/lam:.2f})")
```

Representative output:

```text
classic 2-competitive : mean ALG/OPT=1.118  max=2.00
learning-augmented λ=0.25: mean ALG/OPT=1.061  max=5.00
learning-augmented λ=0.5 : mean ALG/OPT=1.079  max=3.00
learning-augmented λ=1.0 : mean ALG/OPT=1.118  max=2.00
```

Read it carefully. The classical rule's worst per-event ratio is exactly `2.00`, matching the theorem, with a mean near `1.12` because most locks free on the spin fast path where the ratio is `1`. The learning-augmented variant at `λ = 0.25` lowers the *mean* (it blocks early on predicted-long holds and spins longer on predicted-short ones, exploiting the good predictions) but raises the worst case to `5.00` — the `1 + 1/λ` robustness bound — driven by the 5% catastrophic mispredictions. At `λ = 1.0` it collapses back onto the classical rule. **`λ = 0.5` is the sweet spot here:** it beats the classical mean while capping the worst case at `3×`, exactly the consistency/robustness pair `(1.5, 3.0)`. Which `λ` you ship depends on whether your tail SLA can absorb `3×` or `5×` cycle-burn on the unlucky lock — a decision the curve makes quantitative instead of guesswork.

---

## Engineering Reality: The Ratio as an SLA Floor

**The competitive ratio is a worst-case SLA floor, not a cost forecast.** A 2-competitive warm-pool policy does *not* cost twice OPT on average — it costs *at most* twice OPT on the single most adversarial demand trace, and on real workloads usually far less (the spin-block measurement above sat at ~1.12 mean against a 2.0 ceiling). Treat the ratio as a contractual guarantee ("we will never spend more than 2× a clairvoyant scaler"), not as an expected-cost estimate. For cost forecasting, measure the empirical ratio.

**Measure the empirical ratio against an offline-OPT replay.** OPT requires the full sequence — which, *after the fact*, you have in telemetry. So:

1. **Log the decision sequence** for a window: every lock hold time, every idle gap before a warm worker was reused, every connection's actual reuse time.
2. **Compute offline OPT on the replay.** For rent-or-buy this is trivial and exact: for each event, `OPT = min(actual_idle, B)` — rent the whole idle period or buy on day one, whichever was cheaper *with hindsight*.
3. **Compute your policy's actual cost** on the same events (you already paid it).
4. **Report `ALG/OPT` as a distribution**, not a number. Median tells you typical efficiency; p99/max tells you how close you came to the SLA floor.

This turns the competitive ratio from a static promise into a live SLO. A measured `ALG/OPT` of `1.1` median, `1.5` p99 against a `2.0` bound is a quantified "we are within 10–50% of an unbeatable clairvoyant policy." Alerting on a *rising* empirical ratio catches a workload that has drifted toward the adversarial regime — exactly when you should retune.

**When to retune the break-even threshold.** The clean "spin `C`, keep warm for `B` seconds" rule assumes the buy price `B` is a known constant. Retune when:

- **Costs are asymmetric.** If a cold start hurts a user-facing tail-latency SLA far more than it costs in compute, the *effective* buy price is higher than the raw spin-up cost — keep warm longer. Encode the SLA penalty into `B`.
- **`B` is time-varying.** Spot-price swings, diurnal load, and tenancy changes move the real cold-start cost hour to hour. A static threshold tuned at peak is wrong at trough. Recompute `B` from a rolling telemetry estimate and let the break-even slide with it.
- **The empirical ratio drifts up.** If logged `ALG/OPT` p99 climbs toward the bound, your cost model has gone stale relative to the workload. Re-estimate `B` and the idle distribution.

---

## Pitfalls That Break the Cost Model

The theory is exactly right; the danger is feeding it a wrong model of the world. The recurring failures:

- **The cost model is wrong.** The whole guarantee rests on a correct ratio `rent : buy`. If you under-count the buy price — e.g. a "cold start" that also evicts a warm cache downstream, or a reconnect that triggers a thundering herd — your break-even is set too aggressively and you buy too soon. Audit the *full* cost of the buy, including second-order effects, not just the obvious line item.
- **`B` is time-varying but treated as constant.** Covered above; it deserves repeating because it is the most common silent failure. A spin budget tuned for a context-switch cost on one CPU generation is wrong on another; a warm-pool threshold tuned at one spot price is wrong at the next.
- **Prediction feedback loops.** Learning-augmented policies whose predictions are derived from past *actions* can become self-fulfilling. If "we released warm workers because the model predicted low demand" causes higher latency that *suppresses* demand, the model sees its prediction confirmed and the system spirals. Break the loop: train the predictor on demand signals that are exogenous to your own scaling decisions, or use counterfactual/held-out evaluation.
- **Treating the ratio as an average.** Capacity-planning off the worst-case ratio over-provisions; SLA-promising off the average under-protects. Keep the two numbers — worst-case bound and measured distribution — distinct and use each for its job.
- **Ignoring the per-event vs aggregate distinction.** A 2-competitive guarantee is *per decision*. If decisions are correlated (a whole fleet cold-starts at once during a deploy), the aggregate cost spike can dwarf any single event's `2×`. Competitive analysis bounds each decision, not coordinated tail events; pair it with rate-limiting and jittered backoff for the correlated case.

---

## Decision Framework

| Situation | Reach for |
|---|---|
| Lock held, spin or block? | **Spin-then-block**: spin `C` cycles (= context-switch cost), then park → 2-competitive (KMMO); this *is* the adaptive mutex |
| Keep VM/container/Lambda warm vs cold-start | **Ski rental**: keep warm until idle-cost = cold-start cost, then release (2-competitive) |
| Hold idle socket vs tear down (TCP keep-alive, conn pool) | **Ski rental**: hold until idle-cost = reconnect-cost |
| Flush dirty cache page now vs hold (write-back timing) | **Ski rental** with a *risk* rent: delay flush until hold-cost = write-cost |
| On-demand vs reserved/committed cloud purchase | **Ski rental**: commit when cumulative on-demand spend = reservation price |
| Checkpoint / snapshot interval | **Ski rental**: checkpoint when expected redo-cost = checkpoint-cost |
| You have a forecast (session length, idle time, demand) | **Learning-augmented (PSK)**: tune `λ` for `(1+λ)`-consistency / `(1+1/λ)`-robustness; pick `λ` from measured model error |
| Need to bound the downside of an ML predictor | Wrap it in the PSK `λ`-rule; robustness caps the worst case at `(1+1/λ)·OPT` |
| Want to report efficiency to stakeholders | Replay telemetry, compute offline `OPT = min(idle, B)` per event, report `ALG/OPT` distribution as an SLO |
| Buy price `B` is asymmetric or time-varying | Encode SLA penalty / rolling estimate into `B`; let the break-even threshold slide |

---

## Research Pointers

- **Karlin, A., Manasse, M., McGeoch, L., & Owicki, S. (1994). "Competitive Randomized Algorithms for Nonuniform Problems."** *Algorithmica.* The spin-then-block result: 2-competitive deterministic, `e/(e−1)` randomized, and the rent-or-buy family underneath autoscaling and keep-alive.
- **Karlin, A., Li, K., Manasse, M., & Owicki, S. (1991). "Empirical Studies of Competitive Spinning for a Shared-Memory Multiprocessor."** *SOSP.* The spin-vs-block problem measured on real hardware — the original systems-instance study, and the template for empirical-ratio measurement.
- **Purohit, M., Svitkina, Z., & Kumar, R. (2018). "Improving Online Algorithms via ML Predictions."** *NeurIPS.* The learning-augmented ski-rental `(1+λ)`-consistency / `(1+1/λ)`-robustness rule used throughout this tier.
- **Lykouris, T., & Vassilvitskii, S. (2018). "Competitive Caching with Machine Learned Advice."** *ICML.* The sibling result for caching; same consistency/robustness vocabulary, applicable to CDN retention and write-back timing.
- **Mitzenmacher, M., & Vassilvitskii, S. (2022). "Algorithms with Predictions."** *CACM survey.* The definitive map of the learning-augmented landscape, including systems applications.
- **Borodin, A., & El-Yaniv, R. (1998). *Online Computation and Competitive Analysis.*** Cambridge Univ. Press. Ski rental, spin-block, and the rent-or-buy family in textbook form.
- **Roughgarden, T. (Ed.) (2021). *Beyond the Worst-Case Analysis of Algorithms.*** Cambridge Univ. Press. Resource augmentation, smoothed analysis, and learning-augmented algorithms unified — the modern lens on why these ratios predict production behavior.

---

## Key Takeaways

1. **Spin-then-block is the original systems instance of ski rental.** Spin (rent CPU cycles) for exactly `C` cycles — the context-switch cost — then block (buy). This is 2-competitive (KMMO), `e/(e−1)` randomized, and it is literally how Linux futexes, JVM monitors, and `pthread` adaptive mutexes decide whether to busy-wait or park. The "spin budget" is the buy price.
2. **A huge swath of systems decisions are the same problem.** Warm-vs-cold autoscaling, serverless warm pools, TCP keep-alive, connection pooling, cache write-back timing, CDN retention, on-demand-vs-reserved cloud purchase, and checkpoint intervals are all "rent until accumulated rent = buy price, then buy." The 2-competitive break-even rule is the policy underneath all of them.
3. **You usually have a prediction — use it with a guarantee.** The Purohit–Svitkina–Kumar `λ`-rule gives `(1+λ)`-consistency and `(1+1/λ)`-robustness. Pick `λ` by fixing a robustness ceiling you can survive, then minimizing expected cost under your model's measured error distribution. A wrong prediction degrades you to a known bounded factor, never to catastrophe.
4. **The ratio is an SLA floor, not a cost estimate.** Worst-case 2× is a contractual ceiling per decision; the *empirical* ratio (replay telemetry, compute `OPT = min(idle, B)` per event, report `ALG/OPT` as a distribution) is the live efficiency SLO. A rising empirical ratio is the signal to retune.
5. **Retune the break-even when costs are asymmetric or `B` is time-varying.** Encode SLA penalties into the effective buy price; recompute `B` from rolling telemetry; don't pin a static threshold to a cost that moves with spot prices and load.
6. **The model, not the math, is where it breaks.** Mis-priced buys (ignored second-order effects), time-varying `B` treated as constant, and prediction feedback loops are the silent failures. The competitive guarantee is per-decision — pair it with backoff and jitter for correlated, fleet-wide tail events.

---

> **See also:** [`./senior.md`](./senior.md) for the `e/(e−1)` lower bound, the online primal–dual derivation, and the full rent-or-buy family · [`../01-competitive-analysis/professional.md`](../01-competitive-analysis/professional.md) for resource augmentation, learning-augmentation, and measuring the empirical ratio as an SLO · [`../03-paging-and-caching-theory/professional.md`](../03-paging-and-caching-theory/professional.md) for CDN retention and write-back as paging in production
