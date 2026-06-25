> **What?** The quantitative core of an A/B test: a **metric** you're trying to move, **statistical power** and **sample size** that decide whether the test can even detect a real change, and **p-values / confidence intervals** that tell you how much to trust the result. An underpowered test isn't a small test — it's a misleading one.
>
> **How?** At this level you design tests, not just read them. You compute the sample size *before* launching from a target MDE, pick a primary metric plus guardrails, run an A/A test to trust your pipeline, and interpret results without committing the classic p-value and peeking sins.

---

## 1. Metrics: primary, guardrail, OEC

Not all metrics are equal. You need to be deliberate about which one decides the experiment.

| Metric type | Role | Example |
|-------------|------|---------|
| **Primary / decision metric** | The one number that decides ship/no-ship | Checkout conversion rate |
| **Guardrail metric** | Must *not* get worse, even if primary improves | p95 latency, error rate, refund rate, unsubscribe rate |
| **OEC** (Overall Evaluation Criterion) | The long-term goal the primary is a proxy for | Revenue per user, retained active days |
| **Debug / drill-down** | Help explain *why* the primary moved | Clicks per step, funnel drop-off |

The **OEC** is the concept from Kohavi et al.'s *Trustworthy Online Controlled Experiments* (2020) worth internalizing: a *single* criterion that captures what the business actually wants, chosen so that improving it is genuinely good. The danger is optimizing a proxy that diverges from the goal — e.g. you boost "clicks" but the clicks are rage-clicks on a broken page. Guardrails exist precisely to catch the case where the primary went up but something important went down.

> Rule: a "win" is *primary up* **and** *every guardrail flat or better*. One broken guardrail can veto a ship.

## 2. The unit of assignment — and why it matters

You can randomize at different granularities:

- **Per request** — each HTTP call independently bucketed.
- **Per session** — one bucket per visit.
- **Per user** — one bucket forever (hash of user ID).

The choice is not cosmetic. Two rules:

1. **Randomize at the level your metric is measured.** If your metric is "users who convert," randomize per user. Mixing levels breaks the statistics, because the math assumes independent units and one user's many requests are not independent.
2. **Randomize coarsely enough that the user's experience is consistent.** If you bucket per request, a user sees the new button on one page and the old on the next. That's a broken UX *and* it pollutes the comparison — the user is partly in both arms.

Coarser units (user) give cleaner UX but need more total users for the same power, because the *effective sample size* is the number of independent units, not the number of events. Finer units (request) give huge sample counts but the units are correlated, which inflates your apparent confidence — a trap covered in [senior.md](./senior.md).

## 3. Sample size and power — the part everyone skips

Before launching, ask: *if there really is an effect of size X, will this test have enough data to see it?* That's **statistical power** — the probability of detecting a true effect. The convention is 80% power.

Three quantities are linked:

- **MDE (minimum detectable effect)** — the smallest change you care about. Set this by what's *worth shipping*, not what's convenient.
- **Baseline rate** — the control's current metric value.
- **Sample size per arm** — what you solve for.

A workable approximation for a conversion-rate test (two-sided, 5% significance, 80% power):

$$ n \approx \frac{16 \cdot p(1-p)}{(\text{MDE}_{abs})^2} \quad \text{per arm} $$

where `p` is the baseline rate and MDE is **absolute**. The constant 16 bundles the z-values for 95% confidence and 80% power.

### Worked example

Baseline conversion `p = 0.10`. You want to detect a **1% relative** lift, i.e. 0.10 → 0.101, so `MDE_abs = 0.001`.

$$ n \approx \frac{16 \times 0.10 \times 0.90}{(0.001)^2} = \frac{1.44}{0.000001} = 1{,}440{,}000 \text{ per arm} $$

That's **2.88 million users total** to detect a 1% relative lift on a 10% baseline. Now flip it: you want a **10% relative** lift (0.10 → 0.11, `MDE_abs = 0.01`):

$$ n \approx \frac{16 \times 0.09}{(0.01)^2} = 14{,}400 \text{ per arm} $$

A factor of 10 in MDE costs a factor of 100 in sample size, because `n` scales as `1/MDE²`. This is the single most useful intuition in experiment design: **small effects are extraordinarily expensive to detect.**

### Why underpowered tests are worse than no test

Suppose you have traffic for only 14,400 users per arm but you're chasing a 1% lift — you're running at ~10% power instead of 80%. Two things happen:

1. **You'll usually miss real effects** (90% false-negative rate) and wrongly conclude "no difference," killing good changes.
2. **The wins you *do* report are inflated.** With low power, the only way to clear significance is to catch a lucky, exaggerated sample — so significant results from underpowered tests systematically *overstate* the effect (the "winner's curse"). You ship, the lift evaporates in production, and you've burned trust.

A test you don't have the traffic to power should not be run as an A/B test. Pick a bigger MDE, get more traffic, or decide another way.

## 4. p-values and confidence intervals, stated honestly

A **p-value** is: *if there were truly no difference, how likely is data at least this extreme?* A small p (conventionally < 0.05) means "this would be surprising under no-effect, so we doubt no-effect."

What a p-value is **not**:

- ❌ The probability the null is true. (`p = 0.04` does **not** mean "96% chance B is better.")
- ❌ The probability your result will replicate.
- ❌ A measure of effect size. A tiny, useless effect can be highly significant with enough data.

A **confidence interval** is more useful for decisions. "Lift = +1.2%, 95% CI [+0.1%, +2.3%]" tells you the effect is probably positive *and* roughly how big. Always prefer reporting an interval over a bare p-value or a bare point estimate — the width tells you how much you actually know.

```
Treatment:  12.0% (n = 200,000)
Control:    11.4% (n = 200,000)
Lift:       +0.6 percentage points  (+5.3% relative)
95% CI:     [+0.2pp, +1.0pp]
p-value:    0.004
→ CI excludes 0, effect is positive; magnitude is modest but real.
```

## 5. Peeking and early stopping — quantified

Standard p-values assume you look **once**, at the pre-planned end. Each time you peek and would-stop-if-significant, you get another chance to cross p < 0.05 by luck. The false-positive rate compounds:

| Number of peeks | Actual chance of a false "significant" |
|-----------------|----------------------------------------|
| 1 (correct)     | ~5% |
| 5               | ~14% |
| 10              | ~19% |
| continuous      | →100% eventually |

If you watch a null test long enough and stop the moment it's "significant," you are **guaranteed** to eventually declare a false win. Two honest options:

1. **Fixed-horizon:** decide the sample size up front, look once at the end. Simple, what you should default to.
2. **Sequential testing:** use methods designed for repeated looks (e.g. always-valid p-values, group-sequential boundaries) that spend your error budget across peeks. More flexible, but you must use the right statistics — you can't just look at ordinary p-values repeatedly.

## 6. A/A tests — validate the pipeline first

Before trusting any A/B result, run an **A/A test**: split traffic into two groups that get the *identical* experience. There should be no difference. If your A/A test shows a "significant" difference, your experimentation system is broken — bad randomization, a logging bug, a population mismatch, or correlated units inflating confidence.

A/A tests also tell you your *natural variance*: how much the metric wiggles between two truly-identical groups. If A/A swings ±2% routinely, a 1% "lift" in an A/B is within noise. Run A/A tests periodically, not just once — they're the smoke detector for your whole platform.

## 7. Statistical vs practical significance

These are different questions:

- **Statistically significant:** the effect is probably not zero. (A p-value / CI question.)
- **Practically significant:** the effect is big enough to be worth shipping. (A judgment call about cost vs benefit.)

With millions of users, a 0.05% lift can be wildly statistically significant and completely not worth the engineering cost, added complexity, or guardrail risk. Conversely, a promising 3% lift with a CI of [−1%, +7%] is not significant — you can't ship on it, but it may be worth a bigger, better-powered rerun. Decide your **practical** threshold (the MDE) up front so significance alone never makes the call.

---

## Key takeaways

- Separate **primary**, **guardrail**, and **OEC** metrics; a win needs primary up *and* guardrails intact.
- **Unit of assignment** = the level your metric is measured at, coarse enough for consistent UX; mismatches break the stats.
- Compute **sample size from MDE before launch**; `n ∝ 1/MDE²`, so small effects are very expensive.
- **Underpowered tests are worse than none** — they miss real effects and inflate the ones they report.
- A p-value is *not* the probability the change is better; **report confidence intervals**.
- **Don't peek-and-stop** on ordinary p-values; the false-positive rate compounds. Run **A/A tests** to validate the pipeline.
- Distinguish **statistical** from **practical** significance.

## Where to go next

- [senior.md](./senior.md) — multiple comparisons, Simpson's paradox, novelty and network effects, SUTVA.
- [Measure before optimize](../03-measure-before-optimize/) — baselines and instrumentation.
- [Probabilistic thinking](../../06-probabilistic-thinking/) — p-values, base rates, expected value.
- [Section root](../) · [Engineering Thinking roadmap](../../README.md)
