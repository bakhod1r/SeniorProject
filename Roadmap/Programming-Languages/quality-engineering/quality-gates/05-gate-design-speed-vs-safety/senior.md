# Gate Design: Speed vs Safety — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Gate Design: Speed vs Safety
> *The middle page taught you which gate goes where. This page is about the economics underneath: every gate is a classifier with a precision and a recall, every red is a bet with an expected value, and the DORA evidence shows that "speed vs safety" is usually a false dichotomy invented by bad gates.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Gate Is a Binary Classifier](#core-concept-1--a-gate-is-a-binary-classifier)
5. [Core Concept 2 — The Base-Rate Trap (Bayes Eats Your Precision)](#core-concept-2--the-base-rate-trap-bayes-eats-your-precision)
6. [Core Concept 3 — A Gate's P&L: The Expected-Value Model](#core-concept-3--a-gates-pl-the-expected-value-model)
7. [Core Concept 4 — The Feedback-Cost Gradient and Queue Theory](#core-concept-4--the-feedback-cost-gradient-and-queue-theory)
8. [Core Concept 5 — The DORA "No Trade-Off" Evidence](#core-concept-5--the-dora-no-trade-off-evidence)
9. [Core Concept 6 — Gate Telemetry and the Bypass Signal](#core-concept-6--gate-telemetry-and-the-bypass-signal)
10. [Core Concept 7 — Risk-Based Gating and Defense in Depth](#core-concept-7--risk-based-gating-and-defense-in-depth)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The quantitative reasoning a senior engineer uses to decide which gates earn their place — and why "go faster" and "stay safe" stop fighting once the gates are good.**

By the middle level you can place a gate sensibly: unit tests block the PR, smoke tests run before deploy, expensive end-to-end suites move to a nightly or a canary. That is taste, and it is correct. The senior jump is that you stop reasoning by taste and start reasoning by *numbers*, because at scale the costs are large enough that taste systematically misprices them.

The reframe that unlocks everything: **a quality gate is a binary classifier.** Its job is to answer "is this change bad?" and like any classifier it has true positives, false positives, true negatives, and false negatives — each with a wildly different cost. A false negative is an escaped defect that becomes an incident at 2 a.m. A false positive is a green change marked red: wasted cycle time, a re-run, and a slow corrosion of trust that ends with engineers reflexively hitting "re-run" or "merge anyway." Once you see gates this way, three results follow that contradict intuition: (1) when real defects are rare, even an *accurate* gate produces mostly false alarms; (2) most gates added "after the incident" are never re-evaluated and quietly go cash-flow-negative; and (3) the famous speed/safety trade-off is, at the system level, mostly an artifact of *bad* gates — slow, noisy, or misplaced ones. This page makes all three precise.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — required vs optional gates, where in the pipeline each check belongs, blocking vs advisory, and the basic shift-left idea.
- **Required:** You can read a CI pipeline and state, for each step, its wall-clock cost and whether it blocks merge or deploy.
- **Helpful:** Working intuition for conditional probability (Bayes' rule) and basic queueing (utilization, Little's Law). We re-derive what we use.
- **Helpful:** You've personally bypassed a flaky required check at least once and felt the small guilt that this page names as *normalization of deviance* (see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md)).

---

## Glossary

| Term | Meaning |
|---|---|
| **Gate** | An automated (or manual) check that can block a change from advancing — merge, deploy, or release. |
| **Base rate** | The prior probability that a given change is actually defective, *before* any gate runs. Typically low (1–10%). |
| **Precision** | Of the changes a gate flags red, the fraction that are *genuinely* bad. `TP / (TP + FP)`. "When it cries wolf, is there a wolf?" |
| **Recall (sensitivity)** | Of the genuinely bad changes, the fraction the gate catches. `TP / (TP + FN)`. "Of the wolves, how many does it catch?" |
| **False positive (FP)** | Gate is red, change is fine. Cost = wasted cycle time + re-run + trust erosion. |
| **False negative (FN)** | Gate is green, change is bad. Cost = escaped defect → incident, rollback, customer impact. |
| **Cost of delay** | The economic loss per unit time from a change *not* being in production (Reinertsen). Drives why latency is a real, quantifiable cost. |
| **Bypass rate** | Fraction of gate executions that engineers override (merge-anyway, skip, force-push). A direct measure of mis-design. |
| **Blast radius** | How much breaks if the change is bad — users affected × severity. |
| **Reversibility** | How fast and cheaply a bad change can be undone (flag flip vs data migration). |
| **Progressive delivery** | Releasing to a small slice first (canary, percentage rollout) with automated rollback — a *shift-right* gate. |

---

## Core Concept 1 — A Gate Is a Binary Classifier

Drop the word "check" for a moment and call a gate what it mechanically is: a **binary classifier** over the population of changes, predicting the label *bad* or *not bad*. Every classifier produces a 2×2 confusion matrix, and the entire economics of gating lives in that matrix:

| | **Change is actually BAD** | **Change is actually FINE** |
|---|---|---|
| **Gate says RED (block)** | True Positive — caught it | **False Positive** — false alarm |
| **Gate says GREEN (pass)** | **False Negative** — escaped defect | True Negative — correct pass |

The two error cells are not symmetric, and confusing them is the original sin of gate design:

- A **false negative** (FN) is an *escaped defect*: the gate said green, the change was bad, it ships. Cost = incident response + rollback + customer impact + reputation. This is the cost everyone fears and the reason gates exist.
- A **false positive** (FP) is a *false alarm*: the gate said red, the change was fine. Cost = the engineer's wasted cycle time + the re-run compute + investigating a non-bug + a small, cumulative withdrawal from the trust account. This is the cost everyone *under*-weights.

Two metrics summarize a classifier's behavior, and you must keep them distinct because they trade off:

- **Recall** = TP / (TP + FN) — "of the truly bad changes, what fraction do we catch?" High recall = few escapes. This is the *safety* knob.
- **Precision** = TP / (TP + FP) — "of the changes we flag, what fraction are truly bad?" High precision = few false alarms. This is the *trust* knob.

You can almost always trade one for the other by moving the gate's threshold. Tighten a coverage gate from 70% to 95% and you raise recall (catch more under-tested changes) but tank precision (block many perfectly safe ones). A senior designs each gate to the *cost ratio* of its two errors, not to a round number.

> **Key insight:** A gate is not "on" or "off"; it's a classifier sitting at a *threshold*, and where you put that threshold is a deliberate bet on the relative cost of its two error types. "Make the gate stricter" without naming which error you're trading is not engineering — it's superstition.

---

## Core Concept 2 — The Base-Rate Trap (Bayes Eats Your Precision)

Here is the result that surprises even strong engineers, and it explains *why noisy gates get ignored* better than any appeal to discipline.

Suppose a gate is genuinely good: **recall 90%** (catches 90% of real defects) and a **false-positive rate of 5%** (it wrongly flags 5% of *fine* changes). Now apply it to a realistic population where the **base rate of real defects is 2%** — i.e., 98% of changes are fine, which is normal for a team with decent upstream practices. Run 1,000 changes through it:

| | Actually bad (20) | Actually fine (980) | Total flagged |
|---|---|---|---|
| **Gate says RED** | 18 (TP, 90% of 20) | 49 (FP, 5% of 980) | **67** |
| **Gate says GREEN** | 2 (FN) | 931 (TN) | 933 |

The gate fires red **67** times. Of those, only **18** were real. So the **precision is 18 / 67 ≈ 27%.** *Nearly three out of four red builds are false alarms* — and this is for a gate we called "good" (90% recall, 5% FP rate). This is Bayes' rule in action: when the base rate is low, the false positives drawn from the huge "fine" population swamp the true positives drawn from the tiny "bad" population.

The math is unforgiving as the base rate drops further. Hold recall at 90% and FP rate at 5%:

| Base rate of defects | Precision (P(real \| red)) |
|---|---|
| 10% | 67% |
| 5% | 49% |
| 2% | **27%** |
| 1% | 15% |
| 0.5% | 8% |

At a 1% base rate, **85% of your red builds are false alarms.** No human stays vigilant against an alarm that is wrong six times out of seven — they learn, correctly and rationally, to ignore it. This is *alarm fatigue*, and it is not a discipline problem; it is the predictable response to a low-precision signal.

There are exactly three levers to escape the trap:

1. **Raise the base rate the gate sees** — run it only on the riskier subset of changes (a migration gate that fires only on migration PRs sees a far higher defect base rate than one that fires on everything).
2. **Crush the false-positive rate** — kill flakiness, tighten the gate so a red means a real, reproducible problem. Precision-first design.
3. **Accept the trust cost explicitly** — keep the gate advisory, not blocking, so a false alarm costs attention but not a hard stop.

> **Key insight:** Even an accurate gate produces mostly false alarms when real defects are rare — and they usually are. This is the Bayesian reason flaky and over-tuned gates get ignored, and it is why a senior optimizes gates for **precision**, not just recall. A 99%-accurate gate on a 1%-base-rate population is still wrong most of the times it fires.

---

## Core Concept 3 — A Gate's P&L: The Expected-Value Model

If a gate is a classifier and its errors have costs, then a gate has a **profit-and-loss statement**. You can write its expected value per change, and a gate is worth keeping only when that value is positive. Define:

- `b` = base rate of real defects (P the change is bad)
- `r` = recall (P caught | bad)
- `f` = false-positive rate (P flagged | fine)
- `C_fn` = cost of an escaped defect (incident, rollback, customer impact)
- `C_fp` = cost of a false alarm (wasted time + re-run + a slice of trust erosion)
- `L` = latency this gate adds to **every** change (cost of delay × wall-clock added)

Then the **expected value of running the gate**, versus not running it, per change:

```
EV(gate) =   r · b · C_fn          ← value: real defects caught (benefit of recall)
           − f · (1 − b) · C_fp    ← cost: false alarms on good changes
           − L                     ← cost: latency tax on every change, good or bad
```

The first term is the only *credit*; the other two are *debits*. Read the structure:

- The benefit scales with `b`. **When defects are rare, the credit term shrinks** — there's simply less to catch — while the false-alarm debit (driven by the huge `1 − b` population) does not. Low base rate doesn't just hurt precision; it directly erodes the gate's EV.
- `L` is paid on **every change**, forever, including the 98% that are fine and the times the gate is right. A 40-minute required gate doesn't tax the bad changes; it taxes *all* throughput. We quantify that in the next concept.

**Worked example — a flaky end-to-end gate.** Suppose: `b = 2%`, `r = 60%` (E2E is decent but not great at catching real defects), `f = 8%` (flaky — fails on good changes often), `C_fn = $40,000` (a serious escaped defect), `C_fp = $600` (an hour of engineer time chasing a flake + re-run + trust), and it adds `L = $300` of cost-of-delay latency to every change (it's slow). Per change:

```
credit  =  0.60 · 0.02 · 40,000  =  $480
fp cost = − 0.08 · 0.98 · 600     = −$47
latency = − 300                    = −$300
                                    ─────────
EV(gate per change)               =  +$133   → keep it (barely)
```

Now suppose the same gate becomes *flakier* (`f = 25%`, common when E2E rots) and *slower* (`L = $700`, the suite grew):

```
credit  =  0.60 · 0.02 · 40,000  =  $480
fp cost = − 0.25 · 0.98 · 600     = −$147
latency = − 700                    = −$700
                                    ─────────
EV(gate per change)               =  −$367   → DELETE or fix it
```

Same gate, same defects caught — but flakiness and latency flipped its P&L negative. It is now *destroying* value while feeling like "safety." This is the typical fate of the gate someone added after an incident and nobody re-evaluated: the incident justified `C_fn`, the gate went in, and then `f` and `L` drifted upward unmonitored until the gate became a net liability that everyone resents and routinely bypasses.

> **Key insight:** Most "we added it after an incident" gates are never re-evaluated, and most of those have gone EV-negative. The `C_fn` that justified the gate is a *one-time* fright; the `f` and `L` costs are paid *every single change, forever*. Review the gate portfolio like a backlog with a P&L, and **sunset gates whose EV has gone negative** — keeping a negative-EV gate is not caution, it's waste dressed as caution.

---

## Core Concept 4 — The Feedback-Cost Gradient and Queue Theory

The latency term `L` deserves its own treatment, because it hides two distinct costs: the cost of *delayed feedback* (a quality cost) and the cost of *long gates clogging the pipeline* (a throughput cost from queue theory).

**The cost-of-delayed-feedback gradient.** The cost to find and fix a defect grows roughly an order of magnitude per stage it survives — the often-cited ~10×-per-stage curve. A bug caught by a linter in the editor costs seconds. The same bug caught in PR CI costs minutes plus a context switch. In staging, an hour plus a redeploy. In production, an incident: pager, rollback, customer impact, postmortem — easily 100–1000× the editor cost. The exact multipliers vary, but the *shape* is robust and it dictates gate placement:

> **Place each check at the earliest stage that *can* catch its defect class.** This is the real content of "shift-left." A type error belongs in the editor/pre-commit, not in CI. A contract mismatch belongs in PR CI, not in staging. But the corollary matters just as much: **what cannot be cheaply pre-tested should shift *right*** — caught by canary analysis, observability, and error budgets in production rather than by an expensive, low-precision pre-merge gate trying to simulate production. Load behavior, real-traffic edge cases, and emergent interactions are cheaper to detect with a 1% canary than to gate on before merge.

**Why a 40-minute required pipeline destroys throughput — the queue-theory argument.** A long required gate doesn't just delay one change; it changes engineers' *behavior* in ways that compound:

- **Batching.** If the pipeline takes 40 minutes, engineers stop pushing small changes — the feedback loop is too slow to iterate. They batch many changes into one big PR to amortize the wait. Big batches are *harder to review, riskier, and slower to debug when red* — the opposite of what the gate wanted. Reinertsen's flow economics: large batch sizes inflate cycle time, risk, and rework non-linearly.
- **Work-in-progress (WIP) and context-switching.** A 40-minute gate means you can't sit and wait, so you start a second task. Now you have WIP ≥ 2, and when the gate comes back red you must *context-switch back* — and context switches cost 10–20+ minutes of re-immersion each. Little's Law (`WIP = throughput × cycle time`) says that inflating cycle time at fixed throughput inflates WIP, and high WIP is where flow goes to die.
- **Queueing at the merge point.** With a required serial gate (and especially a merge queue that re-runs the suite per merge), changes line up. As utilization of the build farm approaches 100%, queue wait time explodes hyperbolically (the M/M/1 result: expected wait ∝ `ρ / (1 − ρ)`). A pipeline at 85% utilization already has changes waiting roughly 5–6× the service time; at 95% it's ~19×. Long gates push utilization up *and* lengthen each service time — a double hit.

The throughput math is stark. If a required gate adds 40 minutes and a team merges 50 changes a day, that's ~33 engineer-hours/day of pure wait *if serialized* — but the real cost is the batching and WIP behavior it induces, which is larger and harder to see. This is why fast feedback is not a luxury: a sub-10-minute pipeline keeps batch sizes small and WIP at 1, and small batches are themselves safer.

> **Key insight:** Latency is not a flat tax — it's a behavior-changer. Slow gates force batching (bigger, riskier changes) and high WIP (context-switch tax), and at high build-farm utilization the queue wait explodes super-linearly. A fast gate buys you *small batches*, which are independently safer. This is the first crack in the "speed vs safety" dichotomy: speed (fast feedback) *produces* safety (small batches).

---

## Core Concept 5 — The DORA "No Trade-Off" Evidence

The intuition that you must trade speed for safety is so strong it feels like physics. The largest body of evidence on software delivery performance — the **DORA** research program behind *Accelerate* (Forsgren, Humble, Kim) and the annual *State of DevOps* reports — says it is false at the system level.

DORA measures delivery performance on four key metrics, two for **throughput** and two for **stability**:

| Dimension | Metric | What it measures |
|---|---|---|
| Throughput | **Deployment frequency** | How often you deploy to production |
| Throughput | **Lead time for changes** | Commit → running in production |
| Stability | **Change failure rate** | % of deployments that cause a failure/rollback |
| Stability | **Time to restore service** | How fast you recover from a failure |

The central finding: **elite performers are better at *both* simultaneously.** They deploy far more frequently *and* have a lower change failure rate *and* restore service faster. Speed and stability are **positively correlated, not traded off** — high performers do not buy speed by accepting more failures, and they do not buy stability by slowing down. They are not on a frontier where moving right means moving down; they have moved the whole frontier outward.

How? Not by adding gates. The capabilities DORA finds *drive* elite performance are:

- **Fast feedback** — short, reliable pipelines (the queue-theory and batch-size argument above).
- **Comprehensive automated testing** — high recall *and* high precision tests engineers trust, run early.
- **Trunk-based development / loose coupling** — small batches, few long-lived branches, architecture that lets teams deploy independently.
- **Continuous delivery and deployment automation** — a repeatable, low-variance path to production.
- **Progressive delivery and good monitoring** — shift-right gates (canary, error budgets) that catch what pre-merge gates can't.

And the most pointed result for gate design: **heavyweight, formal change-approval processes — change advisory boards (CABs), mandatory manager sign-off, external approval tickets — are *negatively* correlated with performance.** They slow delivery (worse lead time and deploy frequency) *and do not improve stability* (no better change failure rate). They cost throughput and buy nothing in safety. What *does* correlate with both speed and stability is **lightweight change control**: peer review (the PR), automated checks, and clear rollback.

> **Key insight:** "Speed vs safety" is largely a *false dichotomy* at the system level — and that's an empirical result, not an opinion. Elite teams get both by making gates *fast, precise, well-placed, and lightweight*, plus relying on fast rollback. Only **bad** gates (slow, noisy, heavyweight, misplaced) force the trade-off. The lever is not *more* gating; it's *better* gating. When someone proposes adding a heavyweight approval gate "for safety," the evidence says it will likely cost speed and deliver no safety.

---

## Core Concept 6 — Gate Telemetry and the Bypass Signal

You cannot manage a gate's P&L if you don't measure it. Yet most organizations have rich telemetry on their *application* and none on their *gates*. A senior instruments every gate so it can be reviewed like a portfolio. The minimum telemetry per gate:

| Metric | What it tells you | Healthy range (rule of thumb) |
|---|---|---|
| **Fire rate** | How often it goes red | Calibrate to base rate; chronically green ⇒ maybe redundant |
| **Precision** | Did red correspond to a *real* problem? (sample reds and label) | Want high; < ~50% ⇒ alarm-fatigue territory |
| **Flaky rate** | % of reds that pass on a no-change re-run | < 1%; this is `f` from the EV model, the trust-killer |
| **Latency (p50/p95)** | Wall-clock the gate adds | The `L` term; watch p95, not just median |
| **Bypass rate** | % of executions overridden / merged-anyway / skipped | **The master signal** — see below |
| **MTTR contribution** | When this gate's class of defect *did* escape, the incident cost | Calibrates `C_fn` |

**The bypass rate is the single most diagnostic number**, because it is the *revealed preference* of your engineers integrated over every override decision. A gate that is bypassed often is a gate that the people closest to the work have collectively judged to be wrong — too slow, too flaky, or too low-signal. High bypass is not an engineering-discipline problem to be solved with stricter enforcement; it is the gate *telling you it is mis-designed.* The correct response to a high-bypass gate is to fix or delete it, not to remove the bypass escape hatch (removing the hatch just converts bypass into worse behaviors: revert-and-resubmit, or merge-blocking pile-ups). Bypass is the pressure-relief valve that also happens to be your best telemetry — see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md).

Treat the **set** of gates as a portfolio with a backlog and explicit **sunset criteria.** Review quarterly. Concrete deletion/fix triggers:

```
SUNSET / FIX a gate when ANY of:
  • EV per change has gone negative (recompute with current f, L, b)
  • flaky rate > ~1% for two review periods  → fix flakiness or demote to advisory
  • bypass rate > ~10%                        → it's mis-designed; fix or delete
  • precision < ~50% (most reds are noise)    → tighten threshold or narrow scope
  • zero true positives in N periods AND another gate covers the same defect class
                                              → redundant; delete (see defense-in-depth)
```

> **Key insight:** A gate you don't measure is a gate you can't price, and an unpriced gate drifts toward negative EV by default (flakiness and latency only ever creep up). Instrument fire rate, precision, flakiness, latency, and above all **bypass rate** — and run the gate portfolio like a backlog with sunset criteria. The gates you're proudest of adding are the ones most likely to need deleting later.

---

## Core Concept 7 — Risk-Based Gating and Defense in Depth

Not all changes carry the same risk, so applying the same gate weight to all of them is miscalibrated by construction — you over-gate the safe majority (paying `L` and `C_fp` for nothing) and may *under*-gate the dangerous few. The senior move is **risk-based, change-tiered gating**: classify each change by **blast radius × (in)reversibility** and apply gate weight accordingly.

The two axes:

- **Blast radius** — if this is bad, how much breaks? (one internal tool vs the checkout path for all users)
- **Reversibility** — how fast and cheap is undo? (a feature-flag flip with instant rollback vs an irreversible, already-applied data migration)

The interaction is the whole point: **reversibility is a substitute for up-front gating.** If a change can be undone in seconds, the cost of an escaped defect `C_fn` collapses, which (per the EV model) shrinks the value of catching it *before* merge — you can afford to gate it less and rely on fast rollback. If a change is irreversible (a destructive migration, a public API you can't unpublish, a payment you can't un-charge), `C_fn` is enormous and *cannot* be bought back by rollback, so heavy up-front gating is justified. A **change-tier → gate-set matrix**:

| Change tier | Example | Blast × reversibility | Gate weight |
|---|---|---|---|
| **T0 — trivial / reversible** | Flag flip behind kill switch; copy change | Low blast, instant undo | Lint + unit; **auto-merge** on green; rely on rollback |
| **T1 — standard** | Typical feature behind a flag | Medium blast, fast undo | Unit + integration + 1 reviewer; canary on deploy |
| **T2 — high blast, reversible** | Change on the checkout path, flag-guarded | High blast, fast undo via flag | Above + E2E on the path + **progressive rollout** (1%→10%→100%) + auto-rollback on SLO breach |
| **T3 — irreversible / regulated** | Destructive data migration; money movement; public API removal | High blast, **no cheap undo** | Above + migration review + dry-run on prod snapshot + staged backfill + named human approval + tested reverse-migration |

The deep consequence, which closes the loop with DORA: **progressive delivery makes changes more reversible, which lets you gate *less* up front.** If every change ships behind a flag with a 1% canary and automated rollback on an SLO breach, you have converted a slow, low-precision *pre-merge prediction* problem ("will this be bad in production?") into a fast, high-precision *post-merge measurement* problem ("is this bad in the 1% we just exposed?"). Measurement beats prediction. This is precisely the shift-right half of the feedback gradient, and it is how elite teams get safety *without* slow gates.

**Defense in depth vs redundancy.** Layered gates are good *only when each layer catches a distinct defect class.* The mental tool is **coverage of defect classes**, not "more layers = safer":

- **Defense in depth (good):** linter catches style/simple-bug classes, unit tests catch logic, integration catches contract mismatches, security scan catches vuln classes, canary catches load/emergent behavior. Each layer's `C_fn` is for a *different* escape; they compound to cover the space.
- **Redundancy (pure cost):** two gates that catch the *same* defect class. The second one adds `L` and `f` (latency and flakiness, paid always) while adding almost no new recall (its true positives are already caught by the first). Per the EV model its credit term is near zero and its debit terms are not — it is reliably negative-EV. Delete it.

So the design question for each candidate gate is never "is this gate good?" in isolation but "**what defect class does this cover that nothing else covers, and is its EV positive given the base rate of *that* class?**"

> **Key insight:** Gate by **blast radius × reversibility**, not uniformly — a reversible flag flip needs almost no gating, an irreversible migration needs a lot. And because **progressive delivery manufactures reversibility**, it lets you move risk from expensive pre-merge prediction to cheap post-merge measurement — gating *less* while being *safer*. Add layers only to cover *new* defect classes; a second gate catching the same class is just cost.

---

## Real-World Examples

**1. The post-incident gate that quietly went negative.** A team has a production incident traced to a bad config. The fix: a mandatory, 12-minute config-validation E2E gate on *every* PR. It works — until two quarters later the suite has rotted to a 30% flaky rate and the team merges 60 PRs/day. Running the P&L: `b ≈ 0.5%` for *config-related* defects on a typical PR (most PRs touch no config), `r ≈ 0.7`, `f ≈ 0.30`, `C_fn ≈ $30k`, `C_fp ≈ $500`, `L ≈ $400`. The credit term is `0.7 · 0.005 · 30,000 = $105`; the debits are `0.30 · 0.995 · 500 = $149` and `$400`. EV ≈ **−$444/PR.** The fix is risk-based scoping: fire the gate *only on PRs that touch config* — raising the base rate it sees from 0.5% to ~15%, multiplying the credit term ~30× and slashing the latency tax to near-zero on the 90% of PRs that don't touch config. Same safety, EV flips strongly positive.

**2. Elite team, no CAB, lower failure rate.** A high-performing org deploys to production 50+ times/day with a change failure rate under 5% and a median restore time in minutes — and has *no* change advisory board. Their "gate" is: trunk-based development, a sub-8-minute PR pipeline (unit + integration + targeted E2E + security scan), one peer reviewer, and *every* deploy progressively rolled out behind flags with automated rollback on SLO breach. A competitor with a weekly CAB, manual sign-offs, and a 45-minute pipeline deploys once a week, has a *higher* change failure rate, and takes hours to restore. This is the DORA "no trade-off" finding as a lived A/B: the team with *lighter, faster* gates is both faster and safer.

**3. The merge-queue utilization cliff.** A monorepo team adds a merge queue that re-runs the full 22-minute suite per merge to guarantee a green trunk — sound in principle. As the team grows, merge volume pushes the queue's build-farm utilization to ~92%. By the M/M/1 wait formula (`wait ∝ ρ/(1−ρ)`), expected queue wait is now ~11.5× the service time — changes that took 22 minutes now sit for hours. Engineers respond by *batching* (bigger PRs, riskier), and `change failure rate rises*. The fix is throughput-aware: shard the suite by affected targets (run only what the change can break), add build-farm capacity to drop `ρ` below ~70% (where wait is ~2.3× service time), and cache aggressively. Speed *and* safety both recover — same lesson, mechanical cause.

**4. Irreversible vs reversible, same blast radius.** Two changes both touch the billing path (high blast). Change A is a price-display tweak behind a flag — instantly reversible. Change B is a schema migration that drops a column — irreversible once applied. Identical blast radius, *opposite* gate weight: A merges with unit + integration + a 1% canary (rely on the flag for rollback); B gets migration review, a dry-run against a production snapshot, a staged expand/contract rollout, a tested reverse-migration, and a named approver. Gating by blast radius alone would have over-gated A and possibly under-gated B; gating by blast × reversibility gets both right.

---

## Mental Models

- **Every gate is a classifier with a threshold.** It has precision and recall, and tightening it trades one for the other. "Make it stricter" is meaningless until you say *which error* you're trading. Reason from the confusion matrix.

- **Bayes is undefeated: rare defects mean noisy gates.** When the base rate is low, false positives drawn from the huge "fine" population swamp true positives. A 99%-accurate gate on a 1%-base-rate stream is *still* wrong most times it fires. To fix precision, raise the base rate the gate sees (narrow its scope) or crush its false-positive rate.

- **A gate has a P&L; price it.** `EV = r·b·C_fn − f·(1−b)·C_fp − L`. The credit (caught defects) is paid rarely; the debits (false alarms, latency) are paid always. Negative-EV gates *feel* like safety and *are* waste. Re-run the number; sunset the losers.

- **Latency is a behavior-changer, not a flat tax.** Slow gates cause batching (bigger, riskier changes) and high WIP (context-switch tax), and at high utilization the queue wait explodes super-linearly. Fast feedback *produces* safety via small batches.

- **There is usually no speed/safety frontier — bad gates invent it.** DORA: elite teams are better at *both* via fast, precise, lightweight gates plus fast rollback; heavyweight approval is negatively correlated with performance. The lever is *better* gates, not *more*.

- **Reversibility is a substitute for prediction.** If you can undo a change in seconds, you don't need to perfectly predict its badness beforehand. Progressive delivery manufactures reversibility, letting you gate less up front and *measure* in a canary instead.

- **Layers must cover distinct defect classes.** Defense in depth = different classes caught at each layer (compounds). Redundancy = same class re-checked (pure cost, near-zero added recall, reliably negative EV). Ask what *new* class each gate covers.

---

## Common Mistakes

1. **Optimizing gates for recall and ignoring precision.** "Catch everything" sounds safe but produces a low-precision, high-false-alarm gate that — by Bayes, on a low base rate — engineers rationally learn to ignore. A bypassed gate has *zero* recall in practice. Tune to the error-cost ratio, and protect precision.

2. **Never re-evaluating a post-incident gate.** The incident justified the gate once (`C_fn`); nobody re-prices it as `f` and `L` creep up, and it silently goes EV-negative. Put every gate on a portfolio review with sunset criteria.

3. **Treating latency as free because "the build runs in the background."** It isn't background — it sets batch size and WIP. A 40-minute pipeline manufactures big, risky PRs and context-switch tax, and pushes the merge queue toward the utilization cliff. Budget pipeline wall-clock as a first-class metric (target sub-10-minute PR feedback).

4. **Adding a heavyweight approval gate "for safety."** The DORA evidence is direct: change advisory boards and mandatory sign-offs slow delivery and *do not* lower change failure rate. You pay throughput and buy no safety. Prefer lightweight change control (peer review + automated checks + rollback).

5. **Applying uniform gate weight to all changes.** A reversible flag flip and an irreversible migration get the same 30-minute gate — over-gating the safe majority and under-serving the dangerous few. Tier by blast radius × reversibility.

6. **Stacking redundant gates and calling it defense in depth.** Two gates catching the *same* defect class add latency and flakiness while adding almost no recall — reliably negative EV. Defense in depth means each layer covers a *distinct* class.

7. **Responding to high bypass by removing the bypass.** High bypass is the gate telling you it's mis-designed; removing the escape hatch converts bypass into worse behaviors (revert/resubmit, merge pile-ups) and destroys your best telemetry. Fix or delete the gate instead — and treat normalizing the bypass as the warning it is (see [07](../07-break-glass-and-bypass/senior.md)).

---

## Test Yourself

1. A gate has 90% recall and a 5% false-positive rate. Applied to a change stream with a 2% defect base rate, what is its precision, and what does that imply for how engineers will treat its red builds?
2. Write the expected-value formula for a gate and name which terms are paid *rarely* vs *on every change*. Why does that asymmetry make low-base-rate gates fragile?
3. A required gate's wall-clock grows from 8 to 40 minutes. Beyond the direct wait, name two *behavioral* costs and the queue-theory reason wait can explode as the build farm fills.
4. State the DORA "no trade-off" finding in one sentence, and the specific finding about heavyweight change-approval processes.
5. You own a flaky 12-minute E2E gate that fires on every PR but only ~0.5% of PRs touch the relevant subsystem. Give the *risk-based* fix and explain, via the EV model, why it works.
6. Two changes both touch the payments path (same blast radius): one is a flag-guarded display tweak, one is a destructive migration. Justify giving them very different gate weights.
7. Distinguish defense in depth from redundancy for gates, and explain why a redundant gate is reliably negative-EV.

<details>
<summary>Answers</summary>

1. Precision ≈ **27%** (per 1,000 changes: 18 TP vs 49 FP ⇒ 18/67). Nearly three of four reds are false alarms, so engineers will *rationally* learn to distrust/ignore red builds (alarm fatigue) — a low-precision gate has near-zero *effective* recall because people stop acting on it.
2. `EV = r·b·C_fn − f·(1−b)·C_fp − L`. The **credit** `r·b·C_fn` (caught real defects) is paid *rarely* (gated by the low base rate `b`); the **debits** `f·(1−b)·C_fp` (false alarms) and `L` (latency) are paid on *every* change. Because the only positive term shrinks with `b`, a low base rate erodes the credit while the always-paid debits dominate — the gate easily goes negative.
3. (a) **Batching** — a slow loop pushes engineers to bundle many changes into big, riskier PRs. (b) **WIP / context-switching** — you start other work while waiting and pay a re-immersion cost when it returns red (Little's Law inflates WIP as cycle time grows). Queue reason: as utilization `ρ → 1`, expected wait scales like `ρ/(1−ρ)` (M/M/1) — it explodes super-linearly; at 95% utilization wait is ~19× the service time. Long gates raise `ρ` *and* lengthen service time.
4. Elite performers achieve *both* high throughput (deploy frequency, lead time) and high stability (change failure rate, restore time) simultaneously — speed and stability are positively correlated, not traded off. And heavyweight change-approval (CABs, mandatory sign-off) is *negatively* correlated with performance: it slows delivery and does not reduce change failure rate.
5. **Scope the gate to fire only on PRs that touch the subsystem.** This raises the *base rate the gate sees* from ~0.5% to (say) ~15%, multiplying the credit term `r·b·C_fn` ~30×, while removing the latency tax `L` from the ~99% of PRs that don't touch it. The EV per *relevant* PR jumps positive and the org-wide latency cost collapses — same safety, far better P&L. (Also fix the flakiness to lower `f`.)
6. Same blast radius, *opposite reversibility*. The flag-guarded tweak is instantly reversible ⇒ `C_fn` is small (roll back in seconds) ⇒ EV of pre-merge catching is low ⇒ gate lightly and rely on a canary + rollback. The destructive migration is irreversible ⇒ `C_fn` is huge and *cannot* be bought back by rollback ⇒ heavy up-front gating (dry-run, staged backfill, reverse-migration, named approver) is justified. Reversibility, not blast radius alone, sets gate weight.
7. **Defense in depth** = layered gates each catching a *distinct* defect class (lint→logic→contracts→vulns→load); their recalls compound to cover the space. **Redundancy** = two gates catching the *same* class. The redundant gate's true positives are already caught by the first, so its added recall (its credit term) is ~0, while it still pays `L` and `f` (latency + flakiness) on every change — credit ≈ 0, debits > 0 ⇒ reliably negative EV. Delete it.

</details>

---

## Cheat Sheet

```
GATE = BINARY CLASSIFIER (confusion matrix)
  RED+bad = TP    RED+fine = FALSE POSITIVE (wasted time + trust)
  GREEN+bad = FALSE NEGATIVE (escaped defect/incident)   GREEN+fine = TN
  recall = TP/(TP+FN)   "catch rate"   = SAFETY knob
  precision = TP/(TP+FP) "is red real?" = TRUST knob

BASE-RATE TRAP (Bayes)
  low defect rate ⇒ FPs swamp TPs ⇒ precision tanks ⇒ alarm fatigue
  90% recall, 5% FP-rate, 2% base rate ⇒ precision ≈ 27% (most reds false)
  fix: raise base rate gate SEES (narrow scope) | crush FP-rate | go advisory

GATE P&L (keep only if EV > 0)
  EV = r·b·C_fn  −  f·(1−b)·C_fp  −  L
       catch(rare)   false alarm     latency tax (EVERY change)
  credit paid rarely; debits paid always ⇒ low b ⇒ fragile
  re-price post-incident gates; SUNSET negative-EV ones

FEEDBACK GRADIENT + QUEUES
  ~10× cost per stage a defect survives ⇒ shift-LEFT to earliest catching stage
  what can't be pre-tested ⇒ shift-RIGHT (canary, error budgets, observability)
  slow gate ⇒ batching (big risky PRs) + WIP/context-switch + queue cliff
  M/M/1 wait ∝ ρ/(1−ρ): 85%→~5.7×, 95%→~19× service time. keep ρ < ~70%

DORA: NO TRADE-OFF
  elite = faster (deploy freq, lead time) AND safer (CFR, restore time)
  drivers: fast feedback + automated tests + loose coupling + progressive delivery
           + LIGHTWEIGHT change control
  heavyweight approval (CAB) = NEGATIVELY correlated; slow, no safety gain

TELEMETRY (price every gate)
  fire rate | precision | flaky rate (=f) | latency p95 (=L) | BYPASS rate
  bypass high = mis-designed (fix/delete, don't remove the hatch)
  SUNSET if: EV<0 | flaky>1% | bypass>10% | precision<50% | redundant

RISK-BASED GATING (blast radius × reversibility)
  reversible flag flip → lint+unit, auto-merge, rollback
  irreversible migration → review+dry-run+staged backfill+reverse-migration+approver
  progressive delivery MANUFACTURES reversibility ⇒ gate LESS, measure in canary
  layers must cover DISTINCT defect classes; same-class = redundant = -EV
```

---

## Summary

- A quality gate is a **binary classifier** with a confusion matrix; its two errors are asymmetric (FN = escaped defect, FP = wasted time + trust erosion) and summarized by **recall** (safety) and **precision** (trust), which trade off at the threshold.
- **Bayes' base-rate trap:** when real defects are rare, even an accurate gate fires mostly false alarms (90% recall + 5% FP-rate + 2% base rate ⇒ ~27% precision). This is the mathematical reason noisy gates get ignored — optimize for **precision** (narrow scope to raise the base rate, or crush the false-positive rate).
- Every gate has a **P&L**: `EV = r·b·C_fn − f·(1−b)·C_fp − L`. The credit (caught defects) is paid rarely; the debits (false alarms + latency) are paid on every change. Most post-incident gates are never re-priced and drift **negative** — sunset them.
- **Latency is a behavior-changer:** the ~10×-per-stage feedback gradient says shift-left to the earliest catching stage and shift-right (canary/error budgets) for what can't be pre-tested; slow required gates induce batching, WIP, and a super-linear queue-wait cliff.
- The **DORA evidence** shows speed and stability are positively correlated — elite teams get both via fast, precise, lightweight gates plus fast rollback, while heavyweight change-approval is *negatively* correlated with performance. "Speed vs safety" is a false dichotomy invented by **bad** gates.
- Instrument every gate (fire rate, precision, flakiness, latency, and especially **bypass rate**) and run the portfolio like a backlog. Gate by **blast radius × reversibility**; progressive delivery manufactures reversibility so you can gate *less* and *measure* instead. Add layers only to cover **distinct** defect classes.

You now reason about gates as priced bets in a portfolio, not as ceremonies. The next layer — [professional.md](professional.md) — is about operating that portfolio across an organization: governance, audit, regulated change control, and the politics of deleting a gate someone added after an incident.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* — Forsgren, Humble & Kim. The statistical case for the "no trade-off" finding and the four key metrics; read this before arguing about gates.
- The annual **DORA / *State of DevOps* reports** (dora.dev) — the ongoing evidence base, including the negative correlation of heavyweight change-approval with performance.
- *Continuous Delivery* — Humble & Farley. Deployment pipelines, progressive delivery, and why fast feedback and small batches are the core of safe, frequent release.
- *The Principles of Product Development Flow* — Donald Reinertsen. Cost of delay, batch-size economics, and queueing theory applied to development — the quantitative spine of the latency argument.
- *The Challenger Launch Decision* — Diane Vaughan. The origin of *normalization of deviance*: how routine bypass of a safety check becomes invisible. The human side of the bypass signal.
- *Site Reliability Engineering* (Google) — error budgets and progressive rollout as shift-right gates; the operational form of "reversibility substitutes for prediction."

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/senior.md) — the mechanics of the blocking gates whose precision, latency, and bypass rate you're now pricing.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/senior.md) — a worked case of the precision/recall threshold trade-off, and why a round coverage number is the wrong objective.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md) — the bypass signal in depth, and normalization of deviance when overriding a gate becomes routine.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the four key metrics, SPACE, and how to measure the speed/stability outcomes this page optimizes.
- [Testing](../../testing/) — building the high-precision, high-recall automated tests that make fast, trustworthy gates possible in the first place.
