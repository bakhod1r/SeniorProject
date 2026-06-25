> Practice tasks for experiments and A/B testing. Each is a *design*, *spot-the-flaw*, or *compute* exercise. Work the numbers by hand where asked; use the approximation `n ≈ 16·p(1−p) / MDE_abs²` per arm (two-sided, 5% significance, 80% power). Don't peek at the hints until you've committed an answer. Tasks build from concrete to platform-scale.

---

## Task 1 — Design a clean experiment from a vague ask

A PM says: "I think the new onboarding flow is better. Let's ship it." Turn this into a runnable experiment. Produce: the hypothesis (falsifiable, with direction), the **unit of assignment**, the **primary metric**, two **guardrail metrics**, the **MDE** you'd target, and the **decision rule**. State one thing you deliberately did *not* change.

<details><summary>Hint</summary>
e.g. Primary: day-7 retention of new users. Unit: user (new signups only). Guardrails: signup completion rate, p95 onboarding latency. Decision: ship if retention up ≥1pp absolute, CI excludes 0, guardrails flat. Hold everything else (copy, pricing) constant so the flow is the only variable.
</details>

## Task 2 — Compute a sample size

Baseline checkout conversion is **5%**. You want to detect a **10% relative** lift (5% → 5.5%). Compute the per-arm and total sample size. Then recompute for a **2% relative** lift and state the ratio between the two totals.

<details><summary>Answer</summary>
10% rel: MDE_abs = 0.005. n ≈ 16·0.05·0.95 / 0.005² = 0.76 / 0.000025 = **30,400/arm → 60,800 total**.
2% rel: MDE_abs = 0.001. n ≈ 0.76 / 0.000001 = **760,000/arm → 1,520,000 total**.
Ratio = 25×. Detecting an effect 5× smaller costs 25× the traffic (1/MDE²). Lesson: pick the MDE by what's worth shipping, then check you have the traffic.
</details>

## Task 3 — Will this test even finish in time?

You get **40,000 eligible users per week**. Your computed requirement is 760,000 per arm (Task 2's 2% case). How many weeks to power the test? Is running it a good idea? What are your real options?

<details><summary>Answer</summary>
1,520,000 total / 40,000 per week = **38 weeks**. Almost a year — not viable; the product and population will drift underneath you. Options: (a) target a bigger MDE you actually have traffic for; (b) reduce variance with CUPED to cut required n; (c) get more traffic into the experiment; (d) decide this change another way (judgment/qualitative). Do **not** run it underpowered and read "flat" as "no effect."
</details>

## Task 4 — Spot the flaw: the early winner

A teammate posts: "Treatment is up 8% after 6 hours, p = 0.03. Shipping it." List every problem you can find.

<details><summary>Hint</summary>
(1) **Peeking/early stop** — 6 hours is one arbitrary look; p = 0.03 from a single early glance is unreliable. (2) **No full weekly cycle** — 6 hours isn't representative. (3) **Possible novelty effect** inflating the early number. (4) No mention of **sample size**, **CI**, or **guardrails**. (5) Was the horizon pre-registered, or did they stop *because* it looked good (optional-stopping)? Twyman's law: an 8% lift in 6 hours smells like a bug or noise.
</details>

## Task 5 — Spot the flaw: Simpson's paradox / SRM

| Segment | Control conv | Treatment conv |
|---------|--------------|----------------|
| Mobile | 2% (n=2,000) | 4% (n=18,000) |
| Desktop | 40% (n=8,000) | 50% (n=2,000) |

Treatment wins both segments. Compute the pooled rates. Explain the reversal and what it tells you about the experiment's validity.

<details><summary>Answer</summary>
Pooled control = (40 + 3,200)/10,000 = 32.4%. Pooled treatment = (720 + 1,000)/20,000 = **8.6%**. Treatment wins each segment but loses pooled — Simpson's paradox. Cause: treatment got mostly mobile traffic (low-converting), control got mostly desktop. The arms have **different segment mixes**, which shouldn't happen under valid randomization → this is a **sample-ratio mismatch**. Verdict: the experiment is **invalid**; find why assignment/logging skewed the split. Don't ship either pooled or per-segment number until fixed.
</details>

## Task 6 — Interpret a confidence interval

Three experiments report a lift and 95% CI on conversion. For each, state your decision and reasoning. Your practical threshold (MDE) is +1pp absolute.

- A: +2.5pp, CI [+1.8pp, +3.2pp]
- B: +0.3pp, CI [+0.1pp, +0.5pp]
- C: +2.0pp, CI [−1.5pp, +5.5pp]

<details><summary>Answer</summary>
**A:** ship — CI excludes 0 (significant) *and* the whole interval clears the +1pp practical bar. **B:** statistically significant (CI excludes 0) but the entire interval is below +1pp — **not practically significant**, don't ship for it. **C:** point estimate looks great but CI spans 0 — **not significant**, underpowered/noisy; promising enough to rerun bigger, not to ship. Lesson: significance and practical importance are separate gates.
</details>

## Task 7 — The p-value misread

A stakeholder says: "p = 0.01, so there's a 99% chance the new design is better — let's go." Correct them precisely, then say what statement *would* support shipping.

<details><summary>Answer</summary>
Wrong: p is P(data this extreme | no effect), not P(effect is real | data). p = 0.01 means "this data would be surprising if there were no difference," not "99% chance B wins." What supports shipping: a **confidence interval** that (a) excludes 0 and (b) lies above your practical threshold, with guardrails intact and the test adequately powered and run to its planned horizon.
</details>

## Task 8 — Choose the unit of assignment

For each scenario pick the assignment unit (request / session / user / cluster) and justify:

1. New ranking algorithm on a search page.
2. A "refer a friend" viral feature.
3. Surge-pricing change in a ride-hailing app.
4. Button-color change on a checkout page.

<details><summary>Answer</summary>
1. **User** — metric (e.g. queries/user, satisfaction) is per user; per-request would flip the experience and correlate units. 2. **Cluster** (social/ego-network) — referrals spill across users, breaking SUTVA; user-level randomization contaminates control. 3. **Switchback** (time-sliced, whole-system) — all drivers/riders share one supply pool; user-level leaks across arms. 4. **User** — consistent UX, conversion measured per user.
</details>

## Task 9 — Design an A/A test and read its result

Describe an A/A test you'd run before trusting a new experimentation platform. You run it and the primary metric shows a "significant" difference (p = 0.02) between the two identical arms. List the likely causes and your next step.

<details><summary>Hint</summary>
A/A = split traffic, both arms identical experience, expect no difference. A significant result ⇒ platform bug: **biased/unstable hashing**, **logging fires on only one arm**, **correlated units inflating confidence** (e.g. per-request analysis), **population/timing mismatch**, or an **SRM** in the split itself. Next step: **stop trusting A/B results**, run the SRM chi-squared check, audit the assignment and logging path, and re-run A/A until it's clean. One "significant" A/A in 50 can be chance — but investigate, don't wave it away.
</details>

## Task 10 — Multiple comparisons

A change that genuinely does nothing is scored on **25 independent metrics** at p < 0.05. What's the probability at least one shows a "significant" result? Your colleague found exactly one green metric and wants to ship on it. Respond.

<details><summary>Answer</summary>
P(≥1 false positive) = 1 − 0.95²⁵ ≈ 1 − 0.277 = **0.72 (72%)**. Finding one green metric out of 25 on a null change is *expected*, not evidence. Respond: the primary metric should have been **pre-registered**; a post-hoc green slice is a **hypothesis to test in a fresh experiment**, not a ship signal. If many comparisons are genuinely planned, correct with Benjamini–Hochberg (FDR) or Bonferroni.
</details>

## Task 11 — Detect and handle a novelty effect

A UI redesign shows +6% engagement week 1, +3% week 2, +1% week 3. The owner averaged the three weeks to "+3.3%" and wants to ship. Diagnose and propose a better read.

<details><summary>Answer</summary>
The declining trend is a classic **novelty effect** — the lift is decaying toward steady state, so the average overstates the durable effect. Averaging across the decay is misleading. Better reads: **run longer** until the weekly effect stabilizes; analyze **new users only** (no prior UI to react to) for a novelty-free estimate; or hold a **long-term holdback** and measure the effect months out. The honest forecast is closer to the asymptote (~1% or lower), not 3.3%.
</details>

## Task 12 — Design a canary analysis

You're rolling out a rewrite of a payment service. Design the canary: traffic ramp, the metrics that decide promote/rollback, the statistical checks reused from A/B testing, and the auto-rollback conditions. Note one way a canary can *silently* mislead you.

<details><summary>Hint</summary>
Ramp 1% → 5% → 25% → 100%, holding at each stage for metrics to stabilize. Decision metrics (guardrails): error rate, p50/p95/p99 latency, success rate, CPU/memory, downstream timeouts. Reuse: **SRM check** (did the canary actually get its intended traffic share?), **CIs** on canary-vs-baseline differences, automatic **guardrail breach → rollback**. Silent-mislead trap: **survivorship/SRM** — if the new service crashes for some users, those requests never log, so the canary's error rate looks *better* than reality. Always verify the canary received its expected request volume before trusting its metrics.
</details>

---

## Self-check

You're ready to move on if you can, without notes: compute a sample size from a baseline and MDE and explain the `1/MDE²` scaling; state what a p-value is and isn't; name three reasons a statistically significant result can still be wrong (peeking, SRM/Simpson's, network effects/SUTVA, novelty); pick the right assignment unit for a network-effect feature; and explain why a confidently-flat, well-powered result is a valid and valuable outcome.

[Back to overview](../) · [interview.md](./interview.md) · [Measure before optimize](../03-measure-before-optimize/) · [Engineering Thinking roadmap](../../README.md)
