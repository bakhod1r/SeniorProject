> Interview questions on reasoning under uncertainty: Bayesian updating, the base-rate fallacy, calibration, risk vs uncertainty, and communicating confidence. Answers are short and precise, each with a trap or follow-up. Have a napkin ready for the numeric ones. See also [middle.md](middle.md) and [senior.md](senior.md) for full derivations, and [tasks.md](tasks.md) to practice.

---

## Q1. What does it mean to say "I'm 70% sure" about a one-off event that can never repeat?

It's the **Bayesian / degree-of-belief** interpretation: 70% is your confidence in *this specific* claim given what you know, not a long-run frequency. The frequentist "70 out of 100 times" reading doesn't apply to a unique event, but the belief reading always does — which is why it's the right frame for most engineering decisions.

**Follow-up trap:** "Then it's just an opinion?" No — a *calibrated* belief is testable in aggregate: across all the different claims you label 70%, ~70% should turn out true.

---

## Q2. State Bayes' theorem and explain each term in engineering language.

```text
P(H|E) = P(E|H)·P(H) / [ P(E|H)·P(H) + P(E|¬H)·P(¬H) ]
```

- `P(H)` — **prior**: belief before evidence (often a base rate).
- `P(E|H)` — **likelihood / true-positive rate**: how well the hypothesis predicts the evidence.
- `P(E|¬H)` — **false-positive rate**: how often you'd see the evidence even if the hypothesis is false.
- `P(H|E)` — **posterior**: updated belief.

**Trap:** forgetting the denominator's second term (`P(E|¬H)·P(¬H)`). Dropping it is exactly how people overweight a positive test.

---

## Q3. The classic. A test for a rare disease is 99% accurate. The disease affects 1 in 10,000 people. You test positive. What's the probability you have it?

Roughly **1%**, not 99%. Natural frequencies on 1,000,000 people:

```text
Have disease:    100  → ~99 test positive   (true positives)
Don't have it:   999,900 → ~9,999 test positive (1% false positive rate)
P(disease|+) = 99 / (99 + 9,999) ≈ 99/10,098 ≈ 0.98%
```

The rarity (base rate) swamps the test's accuracy. This is the **base-rate fallacy** (Tversky & Kahneman). The identical structure governs monitoring alerts, fraud flags, and security scanners.

**Follow-up:** "What single number would you most want to lower?" The **false-positive rate** — at a tiny base rate, it dominates the result.

---

## Q4. Your monitoring alert is "99% accurate" and just fired. Is there an incident?

Almost certainly not — same math as Q3. With a low incident base rate (say 0.1% of minutes) and even a 5% false-positive rate, a fired alert is real only ~2% of the time (full calc in [middle.md](middle.md)). This is *why alert fatigue exists.*

**Follow-up:** "How do you fix it?" Crush the false-positive rate: multi-signal alerts, longer evaluation windows, burn-rate alerting on an error budget — not just "make the detector more accurate."

---

## Q5. What is the base-rate fallacy and where does it bite engineers?

Judging a probability from a test's accuracy while **ignoring how rare the thing is.** Bites in monitoring (alerts), fraud detection, security/IDS scanners, spam filters, and flaky-test detectors — anywhere a detector hunts for a rare event. Low base rate + nonzero false-positive rate = mostly false alarms, regardless of headline accuracy.

---

## Q6. What's a prior, and how should you set one?

The probability before seeing evidence. Set it, in order of preference: **(1) measured base rate** from your data, **(2) reference class** ("similar migrations failed ~20% of the time"), **(3) expert gut** — flagged as such.

**Trap:** the reflexive 50/50 "because I don't know." 50/50 is a *strong* claim of maximum uncertainty, and assuming it when the real base rate is 0.1% is precisely how base-rate neglect enters.

---

## Q7. What is calibration, and how would you improve yours?

You're calibrated when claims you label X% come true X% of the time. Improve it by **recording predictions with probabilities, then scoring outcomes** (e.g., Brier score; bucket by confidence and check hit rates). Most engineers are overconfident — 90% claims hit ~70%. Tetlock's *Superforecasting* shows it's a trainable skill, and tracking beats credentials.

**Follow-up:** "Why penalize confident wrong answers extra?" Because the Brier score squares the error — confident-and-wrong is the costliest failure and the one overconfidence produces.

---

## Q8. Distinguish risk, uncertainty, and ignorance.

- **Risk** — outcomes and probabilities known (measured disk failure rate). → *Compute* (EV, redundancy).
- **Uncertainty** (Knightian, Frank Knight 1921) — outcomes known, probabilities genuinely unknown (CVE risk of a brand-new dep). → *Hedge*: reversibility, optionality, robustness.
- **Ignorance** — unknown unknowns. → *Detect and recover*: observability, fast rollback, bounded blast radius.

**Trap:** treating uncertainty as risk by inventing a confident probability and optimizing against it — false rigor that's worse than honest "we don't know."

---

## Q9. Two changes each carry a 5% chance of failure. Why might you ship one and block the other?

Because **probability isn't the whole decision — cost of being wrong is.** A 5% chance of a minor revert is fine; a 5% chance of irreversible data loss is not. You weigh `P × cost` (expected value) and favor **reversible** decisions. Same probability, opposite call due to consequence asymmetry. See [base rates and expected value](../02-base-rates-and-expected-value/).

---

## Q10. An endpoint's "average latency is 80ms." Why is that potentially misleading?

A mean is a **point estimate that hides the distribution.** Mean 80ms can coexist with p99 = 900ms, and users feel the tail. Always report percentiles (p50/p95/p99). Bonus trap: percentiles don't add — two services each at p99=100ms don't yield a p99=200ms request; tails compound non-linearly.

---

## Q11. Evidence comes in that *contradicts* your leading hypothesis. What do you do?

**Update down.** In odds form, multiply by a likelihood ratio < 1. Disconfirming evidence is as informative as confirming evidence, and ignoring it is confirmation bias (see [cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/)) — the main reason people chase a wrong root cause for an hour.

---

## Q12. How do you communicate an uncertain estimate to your manager without losing credibility?

Structure: **most-likely outcome + quantified confidence + the dominant risk (tail) + cost if it goes bad + a trigger that resolves it.** E.g., "~70% we hit the date; the 30% risk is the payment integration; if it slips it's ~2 weeks; we'll know by the 15th and will cut feature X to hold the date." Use ranges over false precision, and pre-commit to updating so revisions read as the plan working, not flip-flopping.

---

## Q13. Does more data always reduce uncertainty?

No. More data often adds **noise** — spurious correlations and low-diagnosticity signals (Nate Silver, *The Signal and the Noise*). Only evidence with a likelihood ratio far from 1 should move your belief; evidence with LR ≈ 1 is noise no matter how much of it you collect. A wall of dashboards can *lower* signal-to-noise.

---

## Q14. What's the relationship between an SLO/error budget and reasoning under uncertainty?

An SLO is an explicit **target probability of success** (99.9%), and the error budget is the org **deciding how much uncertainty/failure it will tolerate** and spending it deliberately on velocity. It also reframes alerting to be base-rate-aware (burn-rate alerting) instead of paging on every breach. It's probabilistic thinking encoded as an operating contract — see [professional.md](professional.md).

---

## Q15. You re-run a failing CI test and it passes. How much should that update "the test is flaky"?

It's evidence *for* flakiness (real failures usually persist on re-run), so update up — but by a **bounded** amount: flaky-passes-on-rerun has a likelihood ratio, not a proof. Start from the base rate of flakiness on your suite (often low), apply the LR, and combine with other signals (timing/`sleep`, network, shared state) before quarantining. One green re-run alone shouldn't take you to certainty.

**Follow-up:** "What's the danger of auto-quarantining on one re-run?" You hide a *genuine* regression (a false-positive flaky label), which is the base-rate fallacy pointed the other way.
