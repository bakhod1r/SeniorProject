> Interview questions on experiments and A/B testing. Answers are short and precise; each flags the **trap** interviewers probe and the **follow-up** they'll push on. The prime traps are p-value misreads, sample-size/power, and peeking — expect at least one of each.

---

## Q1. What does randomization buy you that a before/after comparison doesn't?

Randomization makes control and treatment statistically identical *on average* across all confounders — known and unknown — so any post-launch difference is attributable to the change (Fisher). A before/after comparison confounds your change with everything else that varied over time (seasonality, marketing, outages). **Trap:** claiming you can "adjust for confounders" instead of randomizing — you can only adjust for the ones you *know and measured*; randomization handles the rest. **Follow-up:** "What if you literally can't randomize users?" → quasi-experiments / diff-in-diff, weaker causal claims.

## Q2. A test shows treatment converts 12% vs control 11.4%. Is treatment better?

Unanswerable as stated. Need: **sample size** (600 vs 570 is noise; 600k each may be real), the **confidence interval** on the difference, the **time window**, and the **guardrails**. **Trap:** treating two point estimates as a conclusion. The right reflex is to ask for the CI and n before saying anything.

## Q3. What is a p-value, in one honest sentence — and what is it *not*?

The probability of observing data at least this extreme *if there were truly no effect*. It is **not** the probability the null is true, **not** the probability the result replicates, and **not** a measure of effect size. **Trap:** "p = 0.04 means 96% chance B is better" — false. **Follow-up:** "So what should you report instead?" → the confidence interval, which gives direction *and* magnitude.

## Q4. Why is peeking at the dashboard and stopping when it's significant wrong?

Standard p-values assume a single look at a fixed sample size. Each peek-and-maybe-stop is another chance to cross p < 0.05 by luck, so the real false-positive rate compounds — ~14% at 5 peeks, →100% if you watch a null test forever. **Fix:** fixed horizon (look once at the end) or proper sequential testing (always-valid p-values / group-sequential boundaries). **Trap:** thinking "I'll just check daily, no harm." It inflates false positives badly.

## Q5. What is statistical power and what's a sensible default?

The probability of detecting a true effect of a given size; convention is **80%**. It's set by sample size, baseline rate, and MDE. **Follow-up:** "Why is an underpowered test worse than no test?" → it usually misses real effects (false negatives) *and* the significant wins it does report are inflated (winner's curse), so you ship lifts that vanish in production and lose trust.

## Q6. Sample size scales how with the effect you want to detect?

As **1/MDE²**. Halving the detectable effect quadruples the users needed; a 10× smaller MDE costs 100× the sample. **Trap:** promising to detect a 0.5% lift on modest traffic — usually impossible. The senior move is to compute required n *before* launch and refuse or rescope if the traffic isn't there.

## Q7. Difference between statistical and practical significance?

Statistical = the effect is probably not zero. Practical = the effect is big enough to be worth shipping given cost and risk. With millions of users a meaningless 0.02% lift can be highly significant. **Trap:** shipping anything green. Decide the practical threshold (the MDE) up front so significance alone never decides.

## Q8. What's a guardrail metric and why do you need one?

A metric that must *not* regress even if the primary improves — latency, error rate, refunds, unsubscribes. It catches the case where you "won" the primary by harming something important. **Follow-up:** "Primary up 2%, p95 latency up 200ms — ship?" → usually no; a guardrail breach can veto a primary win.

## Q9. You randomize per request instead of per user. What breaks?

Two things: (1) the user sees treatment on one page, control on the next — broken UX and they're in both arms; (2) requests from one user are correlated, so they're not independent units — your variance is understated and CIs are too narrow, producing false positives. **Rule:** randomize at the level your metric is measured (usually the user). **Trap:** bragging about "10M observations" that are really 200k correlated users.

## Q10. Explain Simpson's paradox in an experiment and what it implies.

A treatment can win in *every* segment yet lose in the pooled data (or vice versa) when the segment mix differs between arms. In a properly randomized test the mix should match, so seeing it signals a **sample-ratio mismatch** — your split came out unequal, meaning assignment or logging is broken. **Fix:** chi-squared SRM check; debug, don't cherry-pick the segment that agrees with you.

## Q11. What is an A/A test and what does it catch?

Two groups getting the *identical* experience — there should be no difference. A "significant" A/A result means the platform is broken (bad randomization, logging bug, correlated units, population mismatch). A/A also reveals natural variance, so you know how big a swing is just noise. **Follow-up:** "When do you run it?" → before trusting a new pipeline, and periodically as a continuous health check.

## Q12. Your new social feature shows a huge lift. Why might it be fake, even with clean stats?

**Network effects break SUTVA** — treating user A changes control user B's behavior, contaminating the control and distorting the measured effect (often understated for messaging, overstated for marketplaces draining shared inventory). User-level randomization is invalid. **Fix:** cluster randomization (by geo/community) or switchback tests, accepting the big power hit. **Also consider** novelty effect inflating the early read.

## Q13. What's the novelty effect and how do you control for it?

Users engage with a change *because* it's new; the lift spikes then decays toward steady state, so an early-stopped test overstates it. **Controls:** run longer and plot effect over time; analyze **new users only** (no "old" to react to); keep a **long-term holdback** to measure the durable effect. Primacy/change-aversion is the mirror image — a good change dips first as power users relearn.

## Q14. State Twyman's law and how it changes your behavior.

"Any figure that looks interesting or different is usually wrong." A surprising result (e.g. +40% lift) should trigger a **pipeline audit** — re-run A/A, check SRM, confirm metric definitions, look for a coincident deploy — *before* you believe it. Most "too good to be true" results are instrumentation bugs, not breakthroughs. **Trap:** celebrating the outlier instead of suspecting it.

## Q15. How is a canary release the same as an A/B test, and how does it differ?

Same machinery: a feature flag splits traffic, you compare a small treatment (the canary) against the baseline fleet using CIs, SRM, and guardrails, with auto-rollback on breach. **Difference:** the primary metric is operational safety (error rate, latency, resource use) rather than a product metric, and the goal is "did we break anything," not "did engagement rise." **Follow-up:** "Why ramp 1→5→25→100 instead of straight to 100?" → bound blast radius and let metrics stabilize at each stage before widening.

---

## Rapid-fire traps to recall

- p = 0.04 is **not** "96% chance B wins." Report the **CI**.
- `n ∝ 1/MDE²` — small effects are very expensive.
- **Underpowered ≠ no effect.** Don't read "flat" as "ineffective."
- **Peeking inflates false positives**; lock the horizon or use sequential stats.
- **Simpson's paradox / SRM** ⇒ broken split, not a free answer.
- **Network effects ⇒ SUTVA broken** ⇒ user-level randomization invalid.
- Surprising result ⇒ **suspect the pipeline** (Twyman's law).

[Back to overview](../) · [tasks.md](./tasks.md) · [Engineering Thinking roadmap](../../README.md)
