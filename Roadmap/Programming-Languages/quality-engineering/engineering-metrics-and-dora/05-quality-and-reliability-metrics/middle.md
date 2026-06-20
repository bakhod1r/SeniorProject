# Quality & Reliability Metrics — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Quality & Reliability Metrics
> *The junior page named the metrics. This page makes them computable: the exact arithmetic of Change Failure Rate, where the clock sits in every member of the MTTR family, the nines→downtime table with real numbers, and the error-budget policy that turns "be reliable" into a number you can spend.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Stability Pair — CFR and Time to Restore, Precisely](#the-stability-pair--cfr-and-time-to-restore-precisely)
4. [The MTTR Family — Where the Clock Sits](#the-mttr-family--where-the-clock-sits)
5. [Availability and the Nines](#availability-and-the-nines)
6. [SLI, SLO, SLA — Three Words People Use Interchangeably and Shouldn't](#sli-slo-sla--three-words-people-use-interchangeably-and-shouldnt)
7. [Error Budgets and Burn Rate](#error-budgets-and-burn-rate)
8. [Quality Metrics Beyond Reliability](#quality-metrics-beyond-reliability)
9. [Balancing Speed and Stability — Why All Four Keys Travel Together](#balancing-speed-and-stability--why-all-four-keys-travel-together)
10. [Worked Example — Availability and Remaining Error Budget for One Service](#worked-example--availability-and-remaining-error-budget-for-one-service)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I define and compute the reliability metric set — and what does each number's clock actually measure?**

At the junior level "quality and reliability" is a set of names: change failure rate, MTTR, availability, SLO. That vocabulary is correct but inert — it can't yet tell you *what fraction* counts as a failure, *which two timestamps* you subtract to get a restore time, *how many minutes* "three nines" buys you, or *when* a burned error budget should stop a release train.

This page replaces the names with arithmetic. We define the **stability DORA pair** (Change Failure Rate and Time to Restore) down to the events you count; we lay out the **MTTR family** (MTBF, MTTF, MTTD, MTTA, MTTR) as a single incident timeline so you stop confusing them; we derive **availability** and print the real nines→downtime table; and we make **SLI / SLO / SLA and error budgets** concrete enough to compute a month's remaining budget and decide whether to ship. The throughline: a reliability metric is only as useful as your precision about *where its clock starts and stops*.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the four DORA keys.
- **Required:** You know what a deployment and an incident are in your own org.
- **Helpful:** You've been on call, or watched an incident timeline get reconstructed afterward.
- **Helpful:** Comfort with basic ratios and percentages — that's all the math here is.

---

## The Stability Pair — CFR and Time to Restore, Precisely

DORA's four keys split into two **throughput** measures (deployment frequency, lead time) and two **stability** measures. The stability pair is what this section pins down, because it is the pair people compute wrong.

**Change Failure Rate (CFR)** — the fraction of deployments to production that result in a degraded service requiring remediation (a rollback, hotfix, patch, or forward-fix).

```
                deployments that caused a failure
CFR  =  ───────────────────────────────────────────
                total deployments to production
```

The numerator and denominator must cover the **same window and the same environment**. Three rules keep it honest:

1. **Count deployments, not commits or PRs.** The unit is "a release reached prod." If you batch ten merges into one deploy, that's one deployment.
2. **A "failure" is remediation-worthy, not any blemish.** A cosmetic typo nobody rolls back is not a change failure; a deploy that triggers a rollback, hotfix, or incident is. Write the definition down once so the count is reproducible.
3. **Attribute the failure to the deploy that caused it**, in the period the *deploy* happened (some teams use the period the failure was detected — pick one and never mix).

Worked: 50 production deployments this month, 4 of which required a rollback or hotfix → CFR = 4 / 50 = **8%**. DORA's *Elite* band is 0–15%; *Low* performers sit far higher. Note the unit is *deployments*, which is why a team that deploys rarely can post a deceptively low *count* of failures while having a terrible *rate*.

**Time to Restore Service** (also called *failed-deployment recovery time* in recent DORA reports) — how long it takes to recover from a production failure: the clock runs from when the failure **begins to affect users** (or is detected) to when **normal service is restored**.

```
Time to Restore (one incident)  =  service_restored_at  −  failure_started_at
```

Report this as a **distribution** (median and a high percentile like p90/p95), not a single mean — one 14-hour outage will drag a mean far above what a typical recovery looks like. The Elite band restores in **under one hour**; Low performers measure it in weeks.

> **Key insight:** CFR and Time to Restore are the *guardrails* on the throughput keys. Deployment frequency and lead time push speed; CFR and recovery time tell you whether that speed is *safe*. Optimizing speed while ignoring the stability pair is how you turn "we ship fast" into "we ship fast *and break prod*" — the two pairs are only meaningful read together.

---

## The MTTR Family — Where the Clock Sits

The single biggest source of confusion in reliability metrics is the alphabet soup of "mean time to X." They are not interchangeable; each measures a *different segment* of one incident timeline. Lay them on a line and the confusion evaporates:

```
   service        failure       someone        someone        service
   healthy        starts        DETECTS        ACKNOWLEDGES   RESTORED        next failure
      │              │              │              │              │                 │
      ├──────────────┤              │              │              │                 │
      │   uptime     ├──── MTTD ────┤              │              │                 │
      │              │   (detect)   ├──── MTTA ────┤              │                 │
      │              │              │ (acknowledge)│              │                 │
      │              │              │              ├──── MTTR ────┤  (repair/       │
      │              │              │              │              │   restore)      │
      │              ├─────────────────── downtime ──────────────┤                 │
      └──────────────────────────── MTBF (failure→failure) ────────────────────────┘
```

| Term | Stands for | Clock starts | Clock stops | Measures |
|---|---|---|---|---|
| **MTBF** | Mean Time **Between** Failures | one failure | the *next* failure | how often a *repairable* system breaks |
| **MTTF** | Mean Time **To** Failure | put into service | first (terminal) failure | lifespan of a *non-repairable* thing |
| **MTTD** | Mean Time **To Detect** | failure starts | someone/something notices | blind spot in monitoring |
| **MTTA** | Mean Time **To Acknowledge** | alert fires | a human owns it | on-call responsiveness |
| **MTTR** | Mean Time **To Repair/Restore/Recover** | failure (or detection) | service restored | how fast you recover |

Two traps live in this table.

**Trap 1 — "MTTR" is overloaded.** The same acronym is used for *repair*, *recover*, *restore*, and *respond*, and they don't share endpoints. *Time to recover* (service usable again) is what DORA tracks; *time to repair* (root cause fully fixed) can be much longer. State which one you mean, every time.

**Trap 2 — MTBF vs MTTF.** MT**B**F is for things you fix and keep running (a service, a server); MT**T**F is for things you replace (a disk, a single process instance). Mixing them produces nonsense like "the MTBF of this lightbulb," when a lightbulb is non-repairable and wants MTTF.

> **Key insight:** Every reliability metric is a *segment* of one timeline; the only thing that distinguishes them is **which two events bound the clock**. If a dashboard reports "MTTR" without telling you whether the clock stops at *service restored* or *root cause fixed*, the number is uninterpretable — demand the endpoints before you trust the value.

---

## Availability and the Nines

**Availability** is the fraction of time a system is operational. Expressed through the MTTR family, it's the share of the failure–repair cycle spent *up*:

```
            MTBF                 uptime
A  =  ─────────────────  =  ─────────────────
        MTBF + MTTR          uptime + downtime
```

The intuition: a system that rarely breaks (high MTBF) and recovers fast when it does (low MTTR) is highly available. You can raise availability from *either* lever — break less often **or** recover faster — which is why MTTR is itself a reliability investment, not just a postmortem statistic.

Availability is quoted in **"nines."** The translation from a percentage to *allowed downtime* is the table every engineer should have memorized, because "we want four nines" sounds cheap until you see it buys **~52 minutes a year**:

| Availability | "Nines" | Downtime / year | Downtime / month (30d) | Downtime / day |
|---|---|---|---|---|
| 90% | one nine | 36.5 days | 72 hours | 2.4 hours |
| 99% | two nines | 3.65 days | 7.2 hours | 14.4 min |
| 99.9% | three nines | 8.76 hours | 43.2 min | 1.44 min |
| 99.95% | three and a half | 4.38 hours | 21.6 min | 43 s |
| 99.99% | four nines | 52.6 min | 4.32 min | 8.6 s |
| 99.999% | five nines | 5.26 min | 25.9 s | 864 ms |

Read the table as a *budget of permitted downtime*. Three nines (99.9%) — a common, sane target for an internal or non-critical service — allows **43 minutes of downtime per month**. Five nines (99.999%) allows **26 seconds per month**, which is why it usually demands multi-region failover, automated recovery, and a cost that only a few systems justify. Each added nine roughly **10×'s** the engineering effort while **10×'ing down** the permitted downtime.

> **Key insight:** Availability targets are *downtime budgets in disguise*. Don't argue about "how many nines" in the abstract — translate the proposed nine into minutes-per-month from this table and ask whether the business actually needs *that few* minutes of allowed outage, given what the next nine costs. Most teams over-target because "more nines" sounds responsible until it's priced in engineer-years.

---

## SLI, SLO, SLA — Three Words People Use Interchangeably and Shouldn't

These three form a precise hierarchy. Confusing them is the most common reliability-vocabulary error, so nail the distinction:

- **SLI — Service Level *Indicator*.** The thing you actually **measure**: a number derived from real traffic. *"The proportion of HTTP requests that returned non-5xx in under 300 ms."* An SLI is a ratio of *good events* to *valid events*.
- **SLO — Service Level *Objective*.** The **target** you set for an SLI, over a window. *"99.9% of requests succeed under 300 ms, measured over 30 rolling days."* Internal, chosen by the team, the thing you actually engineer toward.
- **SLA — Service Level *Agreement*.** A **contract** with a customer that carries **consequences** (refunds, credits) if breached. *"If monthly availability drops below 99.5%, the customer gets a 10% credit."*

```
SLI  =  what you measure          (success rate, latency, freshness)
SLO  =  the internal target       (≥ 99.9% over 30 days)
SLA  =  the external promise       (< 99.5% → financial penalty)
```

The right ordering of the numbers is **SLA < SLO < SLI-you-aim-for**: your *internal* objective (SLO) is deliberately **stricter** than your *contractual* obligation (SLA), so you get an early warning and a buffer before you ever breach the contract. A team that sets SLO = SLA has no margin: the first time they miss their target, they're already paying penalties. A good SLI is also a **proxy for user happiness** — pick indicators users would actually feel (request success, latency, data freshness), not internal vanity numbers like CPU.

> **Key insight:** SLI is a *measurement*, SLO is a *target*, SLA is a *contract with teeth*. The whole reliability program hangs on this: you engineer toward the **SLO**, you measure with **SLIs**, and you keep the SLO tighter than the SLA so the contract is never the thing that warns you. Get these three muddled and every downstream conversation — alerting, budgets, prioritization — inherits the confusion.

---

## Error Budgets and Burn Rate

The SLO gives you something most reliability talk lacks: a **number you are allowed to fail**. That number is the **error budget**.

```
error budget  =  1 − SLO
```

If your SLO is 99.9% availability, your error budget is **0.1%** of the window — the unreliability you're *permitted* to spend. Over a 30-day month that's exactly the 43 minutes from the nines table. This reframes reliability from a vague virtue into a **quota**: you don't have to be perfect, you have to stay within budget.

This is the heart of the **Google SRE model**, and it resolves the oldest fight in software — devs want to ship features, SRE wants stability — by making it arithmetic instead of opinion:

- **Budget remaining → ship.** If you haven't spent your error budget, you're being *too cautious*; deploy features, take risks, the budget is there to be used.
- **Budget exhausted → freeze.** When the budget is burned, the **error-budget policy** kicks in: feature work pauses and the team's effort redirects to reliability (hardening, fixing flaky deploys, paying down the cause) until the service is back inside its SLO. The freeze is agreed *in advance*, so it's a pre-committed policy, not a fight during the incident.

That single rule aligns incentives: shipping fast *spends* budget, so the people pushing speed now have skin in keeping the service reliable.

**Burn rate** makes the budget actionable for alerting. It's how fast you're consuming the budget *relative to the rate that would exhaust it exactly at the window's end*:

```
                       observed error rate
burn rate  =  ──────────────────────────────────────
              error rate that exhausts budget in window
```

A burn rate of **1×** means you'll spend the whole month's budget in exactly a month — sustainable. **10×** means you'll exhaust it in a tenth of the window (~3 days for a monthly budget) — page someone. **Multi-window, multi-burn-rate alerting** (the SRE-workbook pattern) pairs a *fast* burn condition (e.g. 14.4× over 1 hour → page now) with a *slow* one (e.g. 3× over 6 hours → ticket), so you catch both sudden outages and slow leaks without paging on every blip.

> **Key insight:** The error budget converts "be reliable" into "you may fail this much, and here's exactly how fast you're using it up." It's the only mechanism that makes the speed-vs-stability trade-off *self-regulating*: spend the budget and you've earned a freeze; bank it and you've earned the right to move faster. Alert on the **burn rate**, not on every error — the budget is what tells you which errors actually matter.

---

## Quality Metrics Beyond Reliability

Reliability is *runtime* behaviour. **Quality** is broader — it includes defects that never cause an outage but still cost users and engineers. Three quality metrics complement the reliability set and are worth computing:

**Escaped-defect rate (defect escape ratio)** — the fraction of defects that reach **production** rather than being caught earlier (in review, CI, QA, staging):

```
                     defects found in production
escaped-defect rate  =  ──────────────────────────────────
                        total defects found (all phases)
```

A rising escape ratio means your earlier gates are leaking — testing and review aren't catching what they should. It's the quality counterpart to CFR: CFR asks "how many *deploys* broke prod," escape ratio asks "how many *defects* reached prod."

**Defects by phase found** — a histogram of where each defect was *caught* (design / code review / unit test / integration / staging / production). The shape tells you where your net has holes; the principle is that a defect caught in review is dramatically cheaper than the same defect caught in production, so you want the distribution heavily weighted toward the *early* phases.

**Reopen rate** — the fraction of resolved bugs that get **reopened** because the "fix" didn't actually fix them:

```
                reopened defects
reopen rate  =  ─────────────────────
                total resolved defects
```

A high reopen rate signals shallow fixes, missing tests on the fix, or poor reproduction — work that *looked* done but wasn't. It's a quiet tax on throughput that velocity charts never show.

> **Key insight:** Reliability metrics measure *outages*; quality metrics measure *defects that may never become outages but still erode trust and speed*. A service can hit its SLO while shipping a steady stream of escaped, reopened bugs — green dashboards, frustrated users. Track both families, or you'll optimize one and quietly degrade the other.

---

## Balancing Speed and Stability — Why All Four Keys Travel Together

The most damaging myth in delivery is that speed and stability **trade off** — that to ship faster you must accept more breakage, and to be stable you must slow down. The DORA research found the opposite: **elite performers are better at all four keys at once.** Speed and stability are *correlated*, not opposed, because the same practices (small batches, automated testing, fast rollback, trunk-based development) improve both.

This is why you must read the four keys as **two pairs in tension, not four independent dials**:

| Pair | Keys | Pulls toward | Without its counterpart… |
|---|---|---|---|
| **Throughput** | Deployment frequency, Lead time | speed | speed *that breaks things* — high deploy rate, high CFR |
| **Stability** | Change failure rate, Time to restore | safety | safety *via stagnation* — nothing breaks because nothing ships |

CFR and Time to Restore are the **guardrails** that keep the throughput keys honest. A team bragging about deploy frequency while hiding a 30% CFR isn't elite — it's reckless, and the stability pair is what exposes it. A team with zero failures that deploys quarterly isn't safe — it's frozen, and the throughput pair exposes *that*. You **report all four together** precisely so neither failure mode can hide behind a flattering half of the picture.

> **Key insight:** Never optimize one DORA key in isolation. The four keys are a *balanced* set by design — the stability pair guards the throughput pair and vice versa. The goal isn't "maximize deploy frequency" or "minimize CFR"; it's to **move all four in the right direction together**, because the practices that genuinely improve delivery improve speed and stability *simultaneously*. Any "win" on one key bought by sacrificing another is not a win.

---

## Worked Example — Availability and Remaining Error Budget for One Service

A payments API has an SLO of **99.9% availability over a 30-day rolling window**. It's the 20th of the month. Two incidents have occurred. What's the availability so far, and how much error budget is left?

**Step 1 — Establish the monthly budget.** SLO 99.9% → error budget = 1 − 0.999 = **0.1%** of the window. For a 30-day month:

```
total minutes in window = 30 × 24 × 60 = 43,200 min
error budget            = 0.1% × 43,200 = 43.2 min of allowed downtime
```

(This matches the nines table: three nines ≈ 43 min/month.)

**Step 2 — Sum the downtime spent.** Reconstruct each incident's clock — *failure started* to *service restored*:

```
Incident A:  09:14 → 09:31   = 17 min
Incident B:  22:03 → 22:14   = 11 min
                      total  = 28 min downtime so far
```

**Step 3 — Compute availability so far.** Elapsed window = 20 days = 28,800 min; uptime = 28,800 − 28 = 28,772 min:

```
            uptime          28,772
A  =  ─────────────────  =  ─────────  =  0.99903…  ≈  99.90%
        uptime+downtime      28,800
```

Right at the line — but availability-to-date isn't the decision; the **remaining budget** is.

**Step 4 — Compute remaining error budget.** Budget is for the *whole* 30-day window, so measure spend against the full 43.2 min:

```
budget spent     = 28 min  /  43.2 min  =  64.8%
budget remaining = 43.2 − 28 = 15.2 min  =  35.2% remaining
```

**Step 5 — Decide.** There are **15 minutes** of downtime budget left and **10 days** still to run. The budget isn't exhausted, so the error-budget policy says: **keep shipping, but carefully** — you've burned ~65% in two-thirds of the month, slightly ahead of a sustainable 1× pace. A third incident of similar size (~14 min) would blow the budget and trigger the **feature freeze**. The action: ship lower-risk changes, hold the risky migration until next window, and watch the **burn rate**. If a single bad deploy now causes a 20-minute outage, the budget is gone and features stop until the service is provably back inside SLO.

That's the whole loop: SLO → budget in minutes → downtime spent → budget remaining → a *policy-driven* ship/freeze decision. No opinions, just arithmetic.

---

## Mental Models

- **Every reliability metric is a clock between two events.** MTTD, MTTA, MTTR, MTBF differ *only* in which two timestamps bound them. Draw the incident timeline once and each metric is just a bracket on it — that picture prevents 90% of the confusion.

- **Availability is a downtime budget, not a virtue.** "99.9%" isn't a vibe; it's "43 minutes a month." Always convert nines to minutes-per-month before agreeing to a target — and remember each extra nine roughly 10×'s the cost.

- **SLI measures, SLO targets, SLA penalizes.** A measurement, a goal, a contract. Keep the SLO tighter than the SLA so your *target* warns you long before your *contract* fines you.

- **The error budget makes reliability spendable.** 1 − SLO is a quota of permitted failure. Budget left → ship and take risks; budget gone → freeze and fix. The trade-off regulates itself.

- **The four DORA keys are two pairs in tension.** Throughput (frequency, lead time) is guarded by stability (CFR, restore time). Optimize one key alone and you've just moved the failure somewhere the dashboard isn't looking.

---

## Common Mistakes

1. **Computing CFR over commits or PRs instead of deployments.** The denominator is *production deployments*. Counting merges inflates or deflates the rate arbitrarily and makes it incomparable to DORA's bands.

2. **Reporting MTTR as a mean.** One 12-hour outage drags the mean far above a typical recovery. Report the **median and a high percentile** (p90/p95); the distribution is the signal, the mean hides it.

3. **Saying "MTTR" without stating the endpoints.** *Recover* (service usable) and *repair* (root cause fixed) are different clocks. An unlabeled MTTR is uninterpretable — always state where the clock stops.

4. **Confusing MTBF and MTTF.** MTBF is for *repairable* systems (failure→next failure); MTTF is for *non-repairable* ones (birth→death). Using the wrong one for the thing you're measuring produces meaningless numbers.

5. **Setting SLO equal to SLA.** Then your internal target and your contractual penalty trip at the same instant — no buffer, no early warning. The SLO must be *stricter* than the SLA.

6. **Picking SLIs users don't feel.** CPU%, memory, queue depth are *causes*, not *experience*. SLIs should track what a user would notice: success rate, latency, freshness. Internal vanity metrics make green dashboards while users suffer.

7. **Alerting on raw error count instead of burn rate.** A flat threshold pages on every blip and misses slow leaks. Alert on **burn rate** (multi-window) so you page on what actually threatens the budget.

8. **Treating speed and stability as a trade-off.** They're correlated, not opposed. Optimizing deploy frequency while ignoring CFR/restore time doesn't buy speed — it buys *unmeasured fragility*.

---

## Test Yourself

1. Write the CFR formula. Why must the unit be *deployments* rather than commits, and over what scope must numerator and denominator agree?
2. On an incident timeline, where does MTTD's clock stop and MTTR's clock start? Why can "MTTR" mean two different durations?
3. State the availability formula in terms of MTBF and MTTR. From the nines table, how much monthly downtime does 99.9% allow?
4. Define SLI, SLO, and SLA in one sentence each. Why should the SLO be *stricter* than the SLA?
5. Your SLO is 99.95% over 30 days. What is the error budget in minutes? If you've spent 14 minutes of downtime, what fraction of the budget remains, and what does the error-budget policy say to do?
6. Why does DORA insist on reporting all four keys together rather than optimizing deployment frequency on its own?

<details>
<summary>Answers</summary>

1. **CFR = (deployments that caused a failure) / (total production deployments)** over the same window and environment. The unit is *deployments* because the metric measures the failure rate *of releases reaching prod*; counting commits/PRs is arbitrary (batching changes the count without changing reality) and breaks comparability to DORA's bands.
2. MTTD's clock stops when the failure is **detected**; MTTR's clock starts at the **failure (or detection)** and stops at **service restored**. "MTTR" is ambiguous because it's used for both *recover* (service usable again) and *repair* (root cause fully fixed) — different endpoints, different durations.
3. **A = MTBF / (MTBF + MTTR)** = uptime / (uptime + downtime). 99.9% allows **~43.2 minutes per 30-day month** (and ~8.76 hours/year).
4. **SLI** = the indicator you measure (e.g. request success rate). **SLO** = the internal target for that SLI (e.g. ≥99.9% over 30 days). **SLA** = the customer contract with penalties for breach. The SLO is stricter so you get a buffer and early warning *before* you ever breach the (looser) contractual SLA and owe penalties.
5. 99.95% → budget = 0.05% × 43,200 = **21.6 minutes**. Spent 14 → remaining = 21.6 − 14 = **7.6 min ≈ 35% remaining**. Budget isn't exhausted, so the policy says **keep shipping but carefully** — you're over halfway through the budget; favour low-risk changes and a third sizeable incident would trigger a feature freeze.
6. Because the four keys are *two pairs in tension*: throughput (frequency, lead time) optimized alone produces speed that breaks things, which only the stability pair (CFR, restore time) reveals. Reporting all four prevents either failure mode — reckless speed or safe stagnation — from hiding behind a flattering half of the picture.

</details>

---

## Cheat Sheet

```
STABILITY DORA PAIR
  CFR              = failed deployments / total prod deployments   (Elite 0–15%)
  Time to Restore  = service_restored − failure_started           (Elite < 1h)
                     report MEDIAN + p90/p95, never the mean

MTTR FAMILY (segments of one incident timeline)
  MTBF  failure → next failure      how often a REPAIRABLE system breaks
  MTTF  in-service → death          lifespan of a NON-repairable thing
  MTTD  failure  → detected         monitoring blind spot
  MTTA  alert    → acknowledged     on-call responsiveness
  MTTR  failure  → restored         recovery speed (state: recover vs repair!)

AVAILABILITY = MTBF / (MTBF + MTTR) = uptime / (uptime + downtime)
  99%      two nines    7.2 h / month
  99.9%    three nines  43.2 min / month
  99.95%                21.6 min / month
  99.99%   four nines   4.32 min / month
  99.999%  five nines   25.9 s / month
  (each extra nine ≈ 10× cost, 10× less allowed downtime)

SLI / SLO / SLA   (order: SLA < SLO < what-you-aim-for)
  SLI = measured indicator   (success rate, latency, freshness)
  SLO = internal target      (≥ 99.9% over 30d)
  SLA = external contract    (< 99.5% → credits/penalty)

ERROR BUDGET = 1 − SLO
  budget left  → SHIP (you're too cautious)
  budget gone  → FREEZE features, fix reliability (Google SRE policy)
  burn rate = observed error rate / rate-that-exhausts-budget-in-window
              1× sustainable · 10× page · multi-window multi-burn-rate alerts

QUALITY (not just reliability)
  escaped-defect rate = prod defects / all defects found
  defects by phase found  → want weight EARLY (review/test, not prod)
  reopen rate = reopened / resolved   → shallow fixes

FOUR KEYS = two pairs in tension
  throughput (freq, lead time)  guarded by  stability (CFR, restore)
  → move all four together; never optimize one alone
```

---

## Summary

- The **stability DORA pair** is computable: **CFR** = failed deployments / total production deployments (count *deployments*, define "failure" as remediation-worthy, keep scope consistent); **Time to Restore** = restored − failure-started, reported as a **distribution** (median + p90/p95), not a mean.
- The **MTTR family** (MTBF, MTTF, MTTD, MTTA, MTTR) are *segments of one incident timeline*, distinguished only by which two events bound the clock. State endpoints explicitly — "MTTR" alone is ambiguous between *recover* and *repair*, and MTBF (repairable) ≠ MTTF (non-repairable).
- **Availability = MTBF/(MTBF+MTTR)**, quoted in nines. Always translate the nine to minutes-per-month: 99.9% ≈ **43 min/month**; each added nine roughly 10×'s cost. Targets are downtime *budgets*, not virtues.
- **SLI / SLO / SLA** is a precise hierarchy: the **measured indicator**, the **internal target**, the **external contract with penalties** — kept in the order SLA < SLO so the target warns you before the contract fines you.
- The **error budget = 1 − SLO** turns reliability into a spendable quota: budget left → ship; budget burned → the **error-budget policy** freezes features and redirects to reliability (the Google SRE model). Alert on **burn rate**, multi-window, not raw error count.
- **Quality metrics** (escaped-defect rate, defects-by-phase, reopen rate) catch defects that never become outages — a green SLO can still ship leaky, reopened bugs.
- The **four keys are two pairs in tension**: stability (CFR, restore time) guards throughput (frequency, lead time). Speed and stability are *correlated*, not a trade-off — move all four together and never optimize one in isolation.

---

## Further Reading

- *Site Reliability Engineering* (Beyer, Jones, Petoff, Murphy — Google) — the definitive treatment of SLIs, SLOs, error budgets, and the freeze policy. Read the "Service Level Objectives" and "Embracing Risk" chapters first.
- *The Site Reliability Workbook* (Google) — the practical companion; the chapter on alerting on SLOs is the source for multi-window, multi-burn-rate alerting.
- *Accelerate* (Forsgren, Humble, Kim) — the research behind the four keys and the finding that speed and stability rise *together*.
- The annual **DORA / State of DevOps reports** — current performance bands for CFR and time-to-restore, and the evolving definition of the stability keys.
- *Implementing Service Level Objectives* (Alex Hidalgo) — a book-length, hands-on guide to choosing SLIs and setting honest SLOs.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/middle.md) — the full four-key set; this page is the deep dive on its stability/quality half.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/middle.md) — how reliability targets get gamed (and why an SLO is a target, never an individual's performance score).
- [Diagnostics](../../../diagnostics/) — the runtime-debugging side: turning a breached SLO or a long MTTR into a found root cause.
- [junior.md](junior.md) — the names and intuitions this page turned into formulas.
- [senior.md](senior.md) — composite SLOs, dependency error budgets, and running a reliability program across many services.
