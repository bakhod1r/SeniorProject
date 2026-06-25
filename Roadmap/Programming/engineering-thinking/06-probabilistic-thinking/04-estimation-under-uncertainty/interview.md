> Interview questions on estimation under uncertainty. Interviewers probe two things: can you *reason quantitatively* without exact data (Fermi/capacity), and do you have the *judgment* to express, defend, and calibrate uncertainty instead of throwing out a number. Answers below are tight; the traps and follow-ups are where senior candidates separate.

---

## Q1. Why give a range instead of a single number?

A single number is a *distribution collapsed to one point* — it discards how uncertain you are, which is the most decision-relevant information you have. A range with a confidence level ("2–8 days, 80%") tells the listener both the likely case and the case they must plan for. A point estimate is also heard as a *commitment*, silently anchoring everyone to the optimistic end.

**Trap:** "But my manager needs one number." Answer: give *two* — p50 to plan against, p90 to commit to. Refusing all numbers is as wrong as giving a fake-precise one.

---

## Q2. Estimate the QPS for a service handling 50 million requests per day. (Worked Fermi)

Decompose to seconds and divide:

```
Seconds per day ≈ 86,400 ≈ 10^5
Average QPS = 50,000,000 / 86,400 ≈ 50M / 86.4k ≈ 580 QPS  (~10^3)
```

So **~580 QPS average**. Then state the peak: traffic isn't flat, so peak ≈ 3–10× average ⇒ **plan for ~2,000–5,000 QPS**. Mention what that implies: low thousands of QPS is comfortably one well-tuned service with a couple of replicas, not an exotic scaling problem.

**Follow-up — "what if it's 50 billion/day?"** That's `5×10^10 / 8.64×10^4 ≈ 580,000 QPS` (~10^6). Now you're in distributed-fleet, sharded, edge-cached territory — a different architecture *class*. The value of the Fermi estimate is telling you which class you're in.

---

## Q3. Estimate the storage for 10 years of logs from a service doing 1,000 writes/sec, each log ~500 bytes. (Worked Fermi)

```
Per second:  1,000 × 500 B            = 500,000 B/s = 0.5 MB/s
Per day:     0.5 MB/s × 86,400 s      ≈ 43,200 MB   ≈ 43 GB/day
Per year:    43 GB × 365              ≈ 15.7 TB/year  (~1.6×10^13 B)
10 years:    15.7 TB × 10             ≈ 157 TB raw
```

**~160 TB over 10 years.** Then add the senior judgment: nobody keeps 10 years hot. Tier it — days hot, months warm, years cold/compressed (compression on logs is often 5–10×, so cold might be ~20–30 TB). The estimate's job was to make retention and tiering an *explicit decision* up front.

**Trap:** forgetting peak-vs-average, compression, or that raw ≠ stored. State each assumption so the *inputs* are debatable, not the conclusion.

---

## Q4. What is three-point / PERT estimation and why does the weighting matter?

You give three numbers — **O**ptimistic, most **L**ikely (M), **P**essimistic — and combine:

```
Expected E = (O + 4M + P) / 6        Std dev σ = (P − O) / 6
```

The `4M` weights the realistic case, but crucially **E ends up above M** whenever P−M > M−O — i.e., when the bad case is farther from likely than the good case. That asymmetry is real: tasks rarely finish wildly early, often finish wildly late. PERT bakes the long right tail into a single planning number, and σ quantifies how unsure you are.

**Follow-up — "what's wrong with summing per-task PERT means for a project?"** It ignores correlation (shared risks hit many tasks at once) and discrete disasters (a 10%-chance rebuild isn't a wider triangle, it's bimodal). Prefer Monte Carlo over the decomposition.

---

## Q5. Explain the Cone of Uncertainty.

From McConnell's *Software Estimation*: early in a project even a careful estimate can be off by up to **4× either direction** (0.25×–4×); the cone narrows to ~1.5× after requirements, ~1.25× after design, and 1× only near completion. Two implications: (1) an early estimate is *wide because of where you are*, not because you're bad; (2) the cone narrows **only if you do uncertainty-reducing work** — it does not shrink just from time passing.

**Trap:** treating a kickoff estimate as final. The senior move is to report the current cone width and re-forecast at each phase boundary.

---

## Q6. What is the planning fallacy, and how do you counter it?

The **planning fallacy** (Kahneman & Tversky) is the systematic tendency to underestimate time/cost because we build estimates from the imagined *successful* path (the **inside view**) and ignore how often things go sideways. The counter is the **outside view** / **reference-class forecasting** (Flyvbjerg): instead of imagining steps, look at how long *similar* past work actually took, and anchor on that distribution.

**Follow-up — "your inside-view estimate is half your reference class. Which wins?"** The reference class, unless you can name a *specific, defensible* reason this one is genuinely faster. The inside view feels more accurate because it's detailed; the outside view *is* more accurate because it's data.

---

## Q7. What does "calibrated" mean, and are most engineers calibrated?

Calibrated means your stated confidence matches reality: your 90% intervals contain the truth ~90% of the time. Most untrained estimators are badly **overconfident** — Hubbard's work shows their "90%" intervals capture the answer only ~50–60% of the time. Calibration is *trainable*: track estimate vs actual, and use the **equivalent-bet test** (would I rather bet on my range or on a 90%-payout wheel?) to widen intervals until honest.

**Trap:** confusing precision with accuracy. A narrow interval that's usually wrong is worse than a wide one that's usually right.

---

## Q8. A stakeholder asks you to commit to the optimistic end of your range. What do you say?

"I can commit to the **p90 — 9 weeks**. The 5-week figure is the lucky case; if I commit to it, by definition I miss roughly half the time. If 5 weeks is a hard external need, then we're choosing *scope*, not estimate — here's what fits in 5 weeks at p90." The move is: **never surrender the distribution, trade scope instead.** Date, scope, and confidence are the levers; probability isn't negotiable.

---

## Q9. How should the precision of an estimate relate to the decision?

Precision should match what the decision *needs*, no more. The test: **"would I act differently if this estimate were 2× higher or lower?"** If not, stop estimating — you've gathered enough. A reversible two-way-door choice (pick a library) deserves a gut call; an irreversible one-way door (a contractual date, a hot-path datastore) deserves a real distribution. Over-estimating a cheap, reversible decision is waste dressed as rigor. (This is value-of-information thinking from Hubbard.)

---

## Q10. Estimate the monthly bandwidth cost to serve a 2 MB page to 10 million visitors/day. (Worked Fermi)

```
Per day:    10,000,000 × 2 MB        = 20,000,000 MB = 20 TB/day
Per month:  20 TB × 30               = 600 TB/month  (~6×10^14 B)
CDN egress at ~$0.05/GB:
            600 TB = 600,000 GB × $0.05 ≈ $30,000/month  (~10^4 $/mo)
```

**~$30k/month** in egress, order of magnitude 10^4. Now the senior point: that number alone justifies an engineering investment in shrinking the page (2 MB → 500 KB is a 4× saving ≈ $22.5k/mo) or better caching. The estimate turned "should we optimize?" into a quantified ROI.

**Trap:** mixing TB/GB powers (10^12 vs 10^9). Keep the magnitudes explicit.

---

## Q11. What is Hofstadter's Law and what does it imply about padding?

*"It always takes longer than you expect, even when you take into account Hofstadter's Law"* (Hofstadter, *Gödel, Escher, Bach*). It captures that naive self-correction under-corrects — adding a flat fudge factor doesn't save you because the fudge is also optimistic. The implication: don't pad secretly with a gut multiplier; use **calibrated p90s from reference-class actuals**. At org scale, a VP adding a blanket 30% buffer is just re-introducing optimism one level up.

---

## Q12. How do you communicate an estimate so stakeholders don't hear only the optimistic end?

Always pair the number with its uncertainty and lead with the *commit* figure: **"Most likely 3 weeks; I'd commit to 5. The risk is the billing API I haven't integrated — give me 3 days to spike it and I'll tighten the range."** That delivers median, commit date, top risk, and a path to less uncertainty in one sentence. State the **load-bearing assumptions** so people argue the inputs, not the conclusion. Never give a single number to leadership unlabeled — it collapses to the floor instantly.

---

## Q13. When you finish a task, what should you record, and why?

Record the **original estimate (with its range), the actual, and the key assumptions.** Over time this ledger reveals your *systematic* bias (almost everyone discovers ~1.5–2× optimism) so you can correct future estimates, and it builds the **reference classes** that power the outside view. Without measured feedback you never calibrate — you just stay confidently wrong. (One caution at org scale: keep it blameless; if calibration is used to grade people, they sandbag — Goodhart's Law.)

---

## Q14. Estimate how much RAM you'd need to cache 100 million user sessions, each ~2 KB. (Worked Fermi)

```
100,000,000 × 2 KB = 200,000,000 KB = 200 GB  (~2×10^11 B)
```

**~200 GB.** Judgment to add: that exceeds a single commodity box's comfortable RAM, so it's a *distributed cache* (Redis cluster / sharded) decision, plus overhead (data-structure bookkeeping easily adds 2×, so budget ~400 GB across nodes), plus a TTL/eviction policy so it doesn't grow unbounded. The Fermi number again chose the *architecture*: not "a cache," but "a sharded cache cluster with eviction."

**Follow-up — "what if sessions are 50 KB?"** `100M × 50 KB = 5 TB` — now caching *everything* is likely the wrong design; you'd cache hot sessions only and store the rest. The estimate exposed a design flaw before any code.

---

## Q15. Your estimate was "wrong" — actual came in above your p90. Were you a bad estimator?

Not necessarily. A p90 is *supposed* to be exceeded ~10% of the time — that's what 90% means. One overrun is a data point, not a verdict; you judge an estimator over *many* estimates by their **hit rate** (do ~90% of actuals fall within the p90?), not by any single outcome. The bad-estimator signals are *systematic*: consistently overconfident intervals or consistent directional bias. Treating every single overrun as failure is exactly the pressure that makes people sandbag and destroys honest forecasting.

---

### See also
- Concepts in depth: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · practice: [tasks](tasks.md)
- [reasoning under uncertainty](../01-reasoning-under-uncertainty/) · [base rates & expected value](../02-base-rates-and-expected-value/) · [risk & failure probabilities](../03-risk-and-failure-probabilities/) · [probabilistic thinking](../) · [engineering thinking roadmap](../../README.md)
