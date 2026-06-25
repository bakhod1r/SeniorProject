> Practice problems for reasoning under uncertainty. **Global constraints:** show your work; for every Bayesian problem, use the natural-frequency method (imagine a concrete population) *and* state the answer as a probability; round sensibly and call out when a "high-accuracy" detector is actually untrustworthy. Worked answers are in collapsible blocks — try each one before expanding. Concepts come from [middle.md](middle.md) and [senior.md](senior.md).

---

## Task 1 — Compute the posterior: monitoring alert

Your alert has a 95% true-positive rate and a 3% false-positive rate. Real incidents occur in **0.2%** of minutes. The alert fires. **What's the probability of a real incident?** Then state what you'd change to make the alert trustworthy.

<details><summary>Answer</summary>

Per 1,000,000 minutes:
```text
Incidents:     0.002 × 1,000,000 = 2,000  → 0.95 × 2,000 = 1,900 true positives
No incident:   998,000           → 0.03 × 998,000 = 29,940 false positives
P(incident|alert) = 1,900 / (1,900 + 29,940) = 1,900 / 31,840 ≈ 6.0%
```
**~6%.** Even a 95%-accurate alert is right only 1 time in 17. Fix: drive down the **false-positive rate** (multi-signal, longer windows, burn-rate alerting) — at a 0.2% base rate, the FP rate dominates.
</details>

---

## Task 2 — The rare-disease structure, applied to fraud

A fraud model flags transactions. True-positive rate 90%, false-positive rate 2%. **0.5%** of transactions are actually fraudulent. A transaction is flagged. **P(fraud | flagged)?** If you auto-block on a flag, what fraction of blocked users are innocent?

<details><summary>Answer</summary>

Per 100,000 transactions:
```text
Fraud:      500    → 0.90 × 500 = 450 flagged
Legit:      99,500 → 0.02 × 99,500 = 1,990 flagged
P(fraud|flagged) = 450 / (450 + 1,990) = 450 / 2,440 ≈ 18.4%
```
**~18%** are fraud; **~82% of blocked users are innocent.** Auto-blocking on this flag harms 4 legit users for every fraudster caught — usually unacceptable. Use the flag to *trigger review*, not to block.
</details>

---

## Task 3 — Update on odds (the head-math method)

Prior that a bug is in your code (vs. the library): **30%**. New evidence: the same failure reproduces on a fresh checkout of the library's own example. You judge this evidence ~6× more likely if the bug is in the library than in your code. **Posterior?**

<details><summary>Answer</summary>

```text
Prior odds (your code) = 0.30 / 0.70 = 0.43
Evidence favors library, so against "your code": LR = 1/6 ≈ 0.167
Posterior odds = 0.43 × 0.167 = 0.071
P(your code) = 0.071 / (1 + 0.071) ≈ 6.6%
```
Drops from 30% to **~7%** — strong evidence it's the library. Disconfirming evidence (LR < 1) moved you down correctly.
</details>

---

## Task 4 — Sequential updating

A latency spike appears. Prior the new deploy caused it: **40%**.
- E1: spike started 3 min after deploy. LR = 4 (toward deploy).
- E2: a service that didn't get the deploy shows the same spike. LR = 0.15 (against).

**Final probability the deploy is the cause?**

<details><summary>Answer</summary>

```text
Prior odds = 0.40/0.60 = 0.667
× 4    = 2.667
× 0.15 = 0.400
P = 0.400 / 1.400 ≈ 28.6%
```
**~29%.** E1 raised suspicion, but E2 (shared symptom on an un-deployed service) pulled it back down — look for a shared dependency instead.
</details>

---

## Task 5 — What's the real false-positive *experience*?

A security scanner has a 1% false-positive rate — "barely any false alarms," says the vendor. Your monorepo scan touches **80,000** code locations, of which ~**40** are genuine issues (caught at 100%). **How many alerts does an analyst see, and what fraction are noise?**

<details><summary>Answer</summary>

```text
False positives: 0.01 × (80,000 − 40) ≈ 800
True positives:  40
Total alerts: 840 → genuine fraction = 40 / 840 ≈ 4.8%
```
The analyst wades through **~840 alerts, ~95% noise**, to find 40 real ones. A "1% FP rate" is brutal at scale — base rate of real issues is tiny. This is why "low FP rate" must be judged against volume, not in isolation.
</details>

---

## Task 6 — Calibrate this claim

A teammate says: *"I'm 99% sure this refactor has no regressions — it passed all unit tests."* List the unstated assumptions inflating that 99%, and give a more honest figure with reasoning.

<details><summary>Answer</summary>

Assumptions hidden in "99%": tests cover the changed behavior; no integration/contract gaps; prod data resembles test data; no concurrency/timing paths untested; "passed" means meaningful coverage, not just green. Unit-test pass is *one* piece of evidence, not proof. Honest figure: maybe **80–90%**, explicitly conditioned: "high confidence on the tested paths; the untested risk is the integration with X and prod-scale data." The skill is refusing to collapse partial evidence into near-certainty.
</details>

---

## Task 7 — Point estimate that lies

Two API designs report the same **mean** latency of 100ms. Design A: p50=95, p99=130. Design B: p50=40, p99=950. **Which would you ship, and why is the mean useless here?**

<details><summary>Answer</summary>

Ship **A**. The mean (100ms, identical) hides everything that matters: B's tail (p99=950ms) means ~1% of requests are nearly 10× worse — felt acutely by real users and amplified when a request fans out to several B-like services. The mean is a point estimate that erases variance; **percentiles reveal the experience.** Never compare on mean alone for latency.
</details>

---

## Task 8 — Classify the uncertainty

For each, label **risk / uncertainty / ignorance** and name the right tool:
(a) annualized failure rate of a known SSD model;
(b) whether a 3-week-old open-source dependency will have a critical CVE this year;
(c) an attack vector no one on the team has conceived of.

<details><summary>Answer</summary>

- (a) **Risk** — measured distribution → *compute* (redundancy math, EV). 
- (b) **Uncertainty** (Knightian) — outcome known, probability genuinely unknown → *hedge*: pin versions, isolate, keep it swappable, monitor advisories. 
- (c) **Ignorance** — unknown unknown → *detect & recover*: defense-in-depth, observability, bounded blast radius, fast patch path. Matching the tool to the type is the whole point ([senior.md](senior.md)).
</details>

---

## Task 9 — Expected value flips the decision

Two deploys, each **3%** chance of failure. Deploy A: failure = 5-min auto-rollback, no data impact. Deploy B: failure = corrupts a financial ledger, multi-day manual recovery, customer trust damage. **Same probability — argue the opposite decisions.**

<details><summary>Answer</summary>

Decide on `P × cost`, not P alone. A: EV of harm ≈ 0.03 × (trivial) → **ship**, it's a two-way door. B: EV of harm ≈ 0.03 × (catastrophic, partly irreversible) → **do not ship as-is**; make it reversible first (dry-run on a copy, transactional + backup, canary on 1% of accounts), reducing either the probability or the cost-if-wrong before committing. Consequence asymmetry, not probability, drives the call.
</details>

---

## Task 10 — Why 50/50 is the wrong default

A new hire reasons: "I have no information about whether this feature flag is on in prod, so it's 50/50." Critique this, and show how a base rate changes it.

<details><summary>Answer</summary>

50/50 is a *strong claim* of maximum uncertainty, not a neutral non-answer — and it ignores cheap base-rate evidence. If 95% of flags in this service default off and are rarely enabled, the prior the flag is on is ~5%, not 50%. Defaulting to 50/50 is base-rate neglect in disguise. The fix: *find the base rate* (config defaults, deploy history) before assuming ignorance.
</details>

---

## Task 11 — Score your calibration

You logged 20 predictions you each called "**90% confident**." 14 came true. Are you calibrated? Compute a quick Brier contribution and state the correction.

<details><summary>Answer</summary>

14/20 = **70%** actual vs **90%** stated → **overconfident** (the typical engineer error). Per-prediction Brier: correct ones contribute (0.9−1)²=0.01, wrong ones (0.9−0)²=0.81. Mean = (14×0.01 + 6×0.81)/20 = (0.14+4.86)/20 = **0.25** — poor (squared term punishes confident misses). Correction: when you *feel* 90%, say ~70% until your buckets line up. (Tetlock, *Superforecasting*.)
</details>

---

## Task 12 — Communicate it honestly

Rewrite this for a VP without losing credibility: *"The migration should be fine, we've tested it a bunch."*

<details><summary>Answer</summary>

"We're ~80% confident the migration completes cleanly in the 2-hour window. The main risk (the 20%) is row volume on the `orders` table, which we couldn't fully load-test. If we hit it, recovery is a rollback to the pre-migration snapshot — about 30 minutes, no data loss. We'll run a dry-run against a prod-sized copy on Tuesday; if that's red we'll reschedule rather than risk the window." 

It has: quantified confidence, the named tail, the cost if wrong, a mitigation, and a trigger date — exactly the structure from [professional.md](professional.md).
</details>

---

**Next:** carry these into the siblings — [base rates and expected value](../02-base-rates-and-expected-value/), [risk and failure probabilities](../03-risk-and-failure-probabilities/), and [estimation under uncertainty](../04-estimation-under-uncertainty/). Back to [Probabilistic Thinking](../).
