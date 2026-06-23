# Ski Rental and Rent-or-Buy — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Randomization](#randomization)
3. [Applied: The Famous Mappings](#applied-the-famous-mappings)
4. [Learning-Augmented Ski Rental](#learning-augmented-ski-rental)
5. [Gotcha / Trick Questions](#gotcha--trick-questions)
6. [Rapid-Fire Q&A](#rapid-fire-qa)
7. [Common Mistakes](#common-mistakes)
8. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: State the ski-rental problem and its offline optimum. *(Easy)*

**Answer**: You will ski for an **unknown** number of days `D`, revealed one day at a time — each morning you learn whether you ski again. Renting costs **`1` per day**; buying costs **`B` once** and then skiing is free forever. Each day you must rent or buy *before* knowing whether the season continues, and the purchase is irrevocable. Minimize total cost.

The **offline optimum** — chosen by someone who already knows `D` — is

```
OPT = min(D, B).
```

If `D < B`, rent the whole time for `D`; if `D ≥ B`, buy on day 1 for `B`. The online difficulty is precisely that you must decide *without* knowing which side of `B` the true `D` falls on. This is the archetypal **rent-or-buy** problem: a one-time investment `B` versus a recurring cost `1`.

### Q2: What is the break-even strategy? *(Easy)*

**Answer**: **Rent for the first `B − 1` days; if you are still skiing on day `B`, buy that morning.** Equivalently: keep renting until your accumulated rent would equal the purchase price, then buy. The name is exact — you buy at the moment cumulative rent hits the break-even point with the purchase cost. It is the optimal deterministic hedge: commit neither so early that a short season wastes the purchase, nor so late that a long season wastes rent.

### Q3: Prove the break-even strategy is `(2 − 1/B)`-competitive. *(Medium — the classic)*

**Answer**: Analyze by cases on the true number of days `D`.

- **Case `D < B`** (season ends before the buy day): you only ever rent, paying `D`. The optimum also rents: `OPT = D`. Ratio `= 1`.
- **Case `D ≥ B`** (you reach the buy day): you rent `B − 1` days, then buy for `B`, total `ALG = (B − 1) + B = 2B − 1`. The optimum buys on day 1: `OPT = B`. Ratio `= (2B − 1)/B = 2 − 1/B`.

In every case `ALG ≤ (2 − 1/B)·OPT`, and `2 − 1/B < 2`. So break-even is **`(2 − 1/B)`-competitive** (strictly, with additive constant `0`), which tends to `2` as `B → ∞`.

### Q4: Show no deterministic algorithm beats `2 − 1/B`. *(Hard — the lower bound)*

**Answer**: A deterministic algorithm with identical history every run is pinned down by a single number: the day `k` on which it would buy (`k = ∞` if it never buys). The adversary **stops the season the day after you commit**.

- **It buys on day `k`** (`k ≤ B` is the worst choice): the adversary sets `D = k`. The algorithm paid `(k − 1)` rent plus `B` to buy `= k − 1 + B`, while `OPT = min(k, B)`. The ratio `(k − 1 + B)/min(k, B)` is maximized at `k = B`, giving `ALG = 2B − 1`, `OPT = B`, ratio `= 2 − 1/B`. (Buying *later* than `B` only over-rents and is worse.)
- **It never buys** (`k = ∞`): the adversary lets `D → ∞`, so `ALG = D → ∞` while `OPT = B` — an **unbounded** ratio.

Either way the adversary forces ratio `≥ 2 − 1/B`. Hence no deterministic algorithm is better than `(2 − 1/B)`-competitive, and break-even **matches the bound** — it is optimal among deterministic strategies. See [./middle.md](./middle.md) for the full case algebra.

---

## Randomization

### Q5: How does randomized ski rental beat 2? *(Hard)*

**Answer**: A randomized algorithm draws its **buy-day from a probability distribution** instead of committing to a fixed `k`. The adversary, choosing `σ` in advance and knowing only your *distribution* (not your coin flips), can no longer "stop the season the day after you buy" — it must do well against your **expected** cost. Optimizing the buy-day distribution (probabilities weighted roughly like `(1 + 1/(B−1))^day`, whose continuous limit is an exponential/`e^{x/B}` density) gives an expected competitive ratio of

```
e / (e − 1) ≈ 1.582,
```

a strict improvement over the deterministic `2`. And `e/(e−1)` is **optimal**: no randomized algorithm does better against an oblivious adversary (the matching lower bound is proved via Yao's principle — see [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md)). The headline: randomization buys roughly `2 → 1.58` *because* it hides the decision day from the adversary.

### Q6: Why does randomization only help against an *oblivious* adversary? *(Hard)*

**Answer**: The `e/(e−1)` bound is an **oblivious-adversary** result — the adversary fixes `σ` in advance, blind to your realized coin flips. Against an **adaptive-offline** adversary that observes each random outcome as it happens, the hidden buy-day is exposed the instant it's drawn, so it can again stop the season the day after — and randomization gives no asymptotic advantage (the best randomized ratio collapses back to the deterministic `2`). The general theorem: against an adaptive-offline adversary, randomization never beats the best deterministic algorithm. So **always name the model** when you quote `1.58`.

---

## Applied: The Famous Mappings

Ski rental is famous less for the toy story than for being the abstract skeleton of dozens of real **rent-or-buy** decisions: pay a small recurring cost now, or a large one-time cost to make the recurring cost vanish.

### Q7: Map spin-then-block locks to ski rental. *(Medium)*

**Answer**: A thread waiting on a contended lock can either **spin** (busy-wait, burning CPU cycles) or **block** (deschedule, then get woken). Mapping:

| Ski rental | Spin-then-block lock |
|------------|----------------------|
| Rent `1`/day | Spin one more cycle (recurring CPU cost) |
| Buy for `B` | Block: the one-time context-switch cost |
| Days `D` | How long until the lock is actually released |
| Buy on day `B` | **Block after spinning ~`B` cycles** |

The **competitive-spinning** rule: spin for about `C` cycles, where `C` is the cost of blocking (one context switch), then block. This is exactly break-even, and it is `2`-competitive against an adversary controlling release times — you never pay more than twice the optimum of "would-have spun" vs "should-have-blocked-immediately." Real adaptive mutexes and `futex` implementations use precisely this bounded-spin-then-block heuristic.

### Q8: "When should a futex stop spinning and block?" *(Medium)*

**Answer**: **After roughly `C` cycles of spinning, where `C` is the cost of a block-and-wake (the context switch).** Reasoning: if the lock releases within `C` cycles, spinning was the right call and you paid less than `C`; if it takes longer, you've now spent `C` spinning *and* still must block, paying ~`2C` — exactly the `2`-competitive worst case of break-even with `B = C`. Spinning indefinitely is unbounded-bad (a long hold burns CPU forever); blocking immediately is bad when the lock frees in a few cycles (you eat a needless context switch). Break-even at `B = C` is the optimal hedge.

### Q9: Give two more rent-or-buy mappings. *(Medium)*

**Answer**:

- **TCP keep-alive / idle connections**: keeping a connection open costs a trickle of resources per unit time (**rent**); tearing it down and later re-establishing (handshake, slow-start) is a one-time **buy**. How long to hold an idle connection before closing? Hold for about the re-establishment cost, then drop — break-even again.
- **Cloud warm-vs-cold start (serverless)**: keeping a function instance warm costs idle compute per second (**rent**); letting it go cold and paying the **cold-start** latency/cost on the next request is the **buy**. The keep-warm window should be ~the cold-start cost. The same template covers VM/spot keep-alive, cache-line retention, and "renew the lease vs re-acquire" decisions.

In all of these the engineer's takeaway is identical: **set the threshold equal to the one-time cost `B`, and you are `2`-competitive without ever needing to predict the future.**

---

## Learning-Augmented Ski Rental

### Q10: How do predictions help, and what are consistency and robustness? *(Hard)*

**Answer**: **Learning-augmented** (algorithms-with-predictions) ski rental hands the algorithm a *prediction* of `D` — say, from an ML model — and a trust parameter `λ ∈ (0, 1]`. The algorithm buys earlier when the prediction says the season is long, later when it says short. The two guarantees are:

- **Consistency `1 + λ`**: the competitive ratio when the prediction is **perfect**. Small `λ` ⇒ near-optimal (`→ 1`).
- **Robustness `1 + 1/λ`**: the worst-case ratio when the prediction is **arbitrarily wrong**. It stays bounded — you never do worse than `1 + 1/λ`, regardless of how bad the predictor is.

The **tradeoff** is exactly the tension between these: trusting the prediction more (smaller `λ`) sharpens consistency toward `1` but loosens robustness toward `∞`; trusting it less (larger `λ`) caps the downside but forfeits the upside. At `λ = 1` you recover roughly the classical `2`-competitive worst case. The point of the framework: beat the worst-case `2` *when predictions are good*, while never blowing up *when they're bad* — best-of-both-worlds, with `λ` as the dial.

---

## Gotcha / Trick Questions

### Q11: "Buy immediately or rent forever — why are both bad?" *(Easy)*

**Answer**: They are the two **extreme** strategies and each is defeated by the opposite adversary:

- **Buy on day 1**: if `D = 1` (one ski day), you paid `B` while `OPT = 1` — ratio `B`, unboundedly bad for large `B`.
- **Rent forever**: if `D → ∞`, you pay `D → ∞` while `OPT = B` — an **unbounded** ratio.

Each extreme is great on its favored input and catastrophic on the other. Break-even is the optimal compromise: it caps the ratio at `2 − 1/B` against *every* `D`. The lesson — hedging beats betting on either tail.

### Q12: "A 2-competitive algorithm is within 2× on average, right?" *(Medium)*

**Answer**: **No — `2`-competitive is a *worst-case* ceiling, not an average.** It means `ALG(σ) ≤ 2·OPT(σ)` for *every* sequence, including the adversary's nastiest one (here, stopping the day after you buy). On ordinary inputs break-even usually does far better — frequently near-optimal. The ratio bounds *how bad it can ever get*; it makes no claim about typical or expected performance. (Same trap as the worst-case-vs-average confusion in [../01-competitive-analysis/interview.md](../01-competitive-analysis/interview.md).)

### Q13: "Can ski rental's competitive ratio be below 1?" *(Easy)*

**Answer**: **No.** `OPT = min(D, B)` is the *offline optimum* — the best achievable cost on that exact `σ` — so `ALG ≥ OPT` for any algorithm, online or not. The ratio is always `≥ 1`. A derived value below `1` means you compared against the wrong benchmark (e.g., another online player) or flipped the min.

### Q14: "If `B = 1`, what's the competitive ratio?" *(Medium)*

**Answer**: With `B = 1`, break-even buys on day 1 (you rent `B − 1 = 0` days), so `ALG = OPT = min(D, 1)` and the ratio is `2 − 1/B = 2 − 1 = 1` — **perfectly competitive**. It's the degenerate case: when buying costs the same as one day's rent, there is no real decision. The `2 − 1/B → 2` worst case only emerges as `B` grows, where the rent-vs-buy gap is wide and the future genuinely matters.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | Offline optimum for ski rental? | `OPT = min(D, B)` |
| 2 | Break-even strategy? | Rent `B − 1` days, then buy on day `B` |
| 3 | Deterministic competitive ratio? | `2 − 1/B` (→ `2`); tight |
| 4 | Why is the lower bound `2 − 1/B`? | Adversary stops the day after you buy |
| 5 | Optimal deterministic strategy? | Break-even — matches the lower bound |
| 6 | Randomized competitive ratio? | `e/(e−1) ≈ 1.58` |
| 7 | Against which adversary is `1.58`? | **Oblivious** only |
| 8 | What does randomization hide? | The buy-day (drawn from a distribution) |
| 9 | Spin-then-block: spin how long? | ~`C` cycles, `C` = block (context-switch) cost |
| 10 | Why is "buy immediately" bad? | Ratio `B` if `D = 1` |
| 11 | Why is "rent forever" bad? | Unbounded ratio as `D → ∞` |
| 12 | Learning-augmented consistency? | `1 + λ` (prediction perfect) |
| 13 | Learning-augmented robustness? | `1 + 1/λ` (prediction wrong) |
| 14 | The `λ` tradeoff? | Smaller `λ` = sharper consistency, weaker robustness |
| 15 | Ratio when `B = 1`? | `1` (degenerate, no real decision) |
| 16 | Three real rent-or-buy apps? | Spin-vs-block, TCP keep-alive, warm-vs-cold start |

---

## Common Mistakes

1. **Reading `2`-competitive as an average.** It is a worst-case ceiling over all `σ`; typical inputs do far better.
2. **Stating the lower bound as `2` instead of `2 − 1/B`.** The clean bound is `2 − 1/B`; it only *tends to* `2` as `B → ∞`.
3. **Quoting `1.58` without the adversary model.** `e/(e−1)` holds against the **oblivious** adversary; against adaptive-offline, randomization gives nothing.
4. **Claiming break-even buys on day `B − 1`.** It *rents* `B − 1` days and *buys on day `B`** — off-by-one here breaks the `2B − 1` total.
5. **Setting the spin threshold to the lock hold time.** You can't know that online; set it to the *block cost* `C` — that's the `B` in the mapping.
6. **Confusing consistency and robustness.** Consistency `1 + λ` is the good-prediction ratio; robustness `1 + 1/λ` is the bad-prediction cap — they move oppositely in `λ`.
7. **Treating "buy immediately" as safe.** It is `B`-competitive (ratio `B` when `D = 1`) — as bad as renting forever, just on the opposite input.

---

## Tips & Summary

- **Lead with `OPT = min(D, B)` and the break-even rule.** Stating the optimum and "rent `B−1`, buy on day `B`" upfront frames every follow-up cleanly.
- **Memorize the four constants**: deterministic `2 − 1/B` (tight), randomized `e/(e−1) ≈ 1.58` (oblivious), learning-augmented consistency `1 + λ` and robustness `1 + 1/λ`.
- **Narrate the lower-bound adversary**: a deterministic algorithm is pinned by its buy-day `k`, and the adversary stops the season the day after — buy early and the season ends, buy late and you've over-rented; break-even is the optimal hedge.
- **Always reach for the engineering mapping** when asked something practical: spin-vs-block, TCP keep-alive, serverless warm-vs-cold — *set the threshold to the one-time cost `B` and you're `2`-competitive with no forecasting*.
- **Name the adversary model** the instant you say `1.58`, and remember randomization helps *only* against the oblivious adversary.
- **Frame learning-augmented as a dial**: `λ` trades consistency (good predictions) against robustness (bad predictions) — best-of-both-worlds, never worse than `1 + 1/λ`.

**Related:** [Competitive Analysis — Interview](../01-competitive-analysis/interview.md) · [Paging & Caching Theory — Interview](../03-paging-and-caching-theory/interview.md) · [Ski Rental & Rent-or-Buy — Middle](./middle.md)
