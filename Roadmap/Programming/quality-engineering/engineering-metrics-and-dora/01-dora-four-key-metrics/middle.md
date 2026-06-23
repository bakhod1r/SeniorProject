# The DORA Four Keys — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The DORA Four Keys
> *The junior page named the four keys. This page makes them measurable: exactly where each clock starts and stops, how to instrument them from real CI/CD and incident data, what counts (and what sneakily doesn't) as a "deployment" or a "failure," and why the four only mean anything when you read them as one balanced system.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Precise Definitions — Where Each Clock Starts and Stops](#precise-definitions--where-each-clock-starts-and-stops)
4. [Instrumenting the Four from Real Data](#instrumenting-the-four-from-real-data)
5. [Data-Quality Traps — What Counts as a "Deployment" and a "Failure"](#data-quality-traps--what-counts-as-a-deployment-and-a-failure)
6. [The Performance Bands — Elite, High, Medium, Low](#the-performance-bands--elite-high-medium-low)
7. [Why the Four Are Balanced — Throughput vs Stability](#why-the-four-are-balanced--throughput-vs-stability)
8. [The Four Keys as a System — Google's Four Keys Project](#the-four-keys-as-a-system--googles-four-keys-project)
9. [Worked Example — Computing and Banding a Real Team](#worked-example--computing-and-banding-a-real-team)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I measure the four keys correctly, and how do I read them together?**

At the junior level the four keys are four named numbers: how often you ship, how long change takes, how often you break things, how fast you recover. That model is correct but cartoonish — it can't yet tell you *which two timestamps* go into lead time, *what event* counts as a deployment when one merge fans out to forty pods, or *why* a team with a dazzling deployment frequency and a quietly rising change failure rate is not actually a high performer.

The answers come from three things the cartoon glossed over: **the exact clock boundaries** for each metric (which timestamps, in which order), **the instrumentation** that produces those timestamps from CI/CD and incident systems, and the **balance** between the two speed metrics and the two stability metrics that makes the set trustworthy. This page makes all three concrete — with the events you log, the formulas you compute, and the DORA performance bands you classify against — so you can turn "we deploy a lot" into "we're a High performer with an Elite deploy frequency dragged down by a 22% change failure rate."

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name all four keys and what each *roughly* measures.
- **Required:** You understand a basic CI/CD pipeline — commit, build, test, deploy — and that deploys emit events you can log.
- **Helpful:** You've been on call or handled at least one incident, so "time to restore" is concrete, not abstract.
- **Helpful:** Comfort with percentiles vs averages (covered in depth in [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/middle.md)).

---

## Precise Definitions — Where Each Clock Starts and Stops

A metric you can't pin to two timestamps is a vibe, not a measurement. Here is exactly where each clock starts and stops, using the DORA definitions.

**1. Deployment Frequency (DF) — a *rate*, not a duration.** How often the organization successfully releases code *to production* (or to end users). It is a count over a window: deploys-per-day, per-week, per-month. The unit of counting is the deployment *event*, so the whole metric hinges on agreeing what a deployment event is (see the traps section). DORA deliberately measures *production* deploys — shipping to staging fifty times a day is not deployment frequency.

**2. Lead Time for Changes (LT) — a *duration*.** The time from **first commit of a change** to that change **running successfully in production**. Start the clock at the first commit on the branch/change; stop it the moment the deploy carrying that commit is live in prod.

```
first commit ──code──► PR opened ──review──► merge ──CI──► deploy ──► LIVE IN PROD
▲                                                              ▲
START                                                          STOP
└──────────────────────  Lead Time for Changes  ──────────────┘
```

This is the DORA definition and it is narrower than the business "lead time" (idea → live) and wider than "cycle time" (often first-commit → merge). Mixing these up is the single most common reporting error; [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/middle.md) untangles the whole family. Report LT as a **median/percentile**, never a mean — one stuck PR over a weekend wrecks the average.

**3. Change Failure Rate (CFR) — a *percentage*.** The share of deployments to production that result in **degraded service requiring remediation** — a hotfix, a rollback, a forward patch, or a fix-forward. Formula:

```
CFR = (deployments that caused a failure requiring remediation) / (total deployments)  × 100%
```

The denominator is deployments, *not* time and *not* all incidents. An incident with no deploy behind it (a cloud-provider outage, a cert expiry) is real but is *not* a change failure — it didn't come from a change. CFR specifically isolates "how often does shipping break things."

**4. Time to Restore Service / Failed-Deployment Recovery Time (TTR) — a *duration*.** How long it takes to **restore service after a failure caused by a deployment**. Start the clock when the degradation begins (detection, or impact start); stop it when service is restored to users. Recent DORA reporting reframes this specifically as *failed-deployment recovery time* to keep it tied to changes rather than to any-and-all incidents, but the spirit is unchanged: when a deploy breaks prod, how fast are users whole again.

> **Key insight:** Two of the four keys are **durations** (LT, TTR) and two are **rates/ratios** (DF, CFR). Durations must be reported as **percentiles** (p50/p85), never means, because delivery-time and recovery-time distributions are violently right-skewed — a handful of nightmare cases would otherwise dominate an average and hide the typical experience.

---

## Instrumenting the Four from Real Data

Every key reduces to **timestamped events** you already emit; the work is capturing and joining them. You need exactly three event streams.

**Deploy events (the spine).** Every successful production deploy should emit one event carrying: a deploy ID, a timestamp, the environment (`production`), the service, and — critically — the **commit SHA(s)** it shipped. This is the source of truth for DF (count them) and the *stop* timestamp for LT. Emit it from the deploy job itself:

```bash
# at the end of a successful prod deploy step
curl -X POST "$METRICS_URL/deployments" -d '{
  "deploy_id":   "'"$CI_PIPELINE_ID"'",
  "service":     "checkout",
  "environment": "production",
  "sha":         "'"$GIT_COMMIT"'",
  "timestamp":   "'"$(date -u +%FT%TZ)"'"
}'
```

**Commit → deploy timestamps (for lead time).** LT needs the *first-commit* time for every change in a deploy. Given the deployed `sha`, git already knows the authored/committed time of that commit and its ancestors; join "first commit of this change" against the deploy timestamp:

```bash
# first-commit time of the change shipped in this deploy
git log --format=%cI "$PREV_DEPLOY_SHA..$GIT_COMMIT" | tail -1   # → oldest commit's commit-date
```

Lead time for that deploy = `deploy.timestamp − first_commit.timestamp`. Aggregate across deploys in the window and take the median.

**Failure signal (for CFR and TTR).** You need to know *which deploys failed and for how long*. The cleanest signal is to link **incidents/rollbacks back to a deploy**: tag every incident with the deploy it was caused by (or default to "the last deploy to that service before impact began"). A rollback is itself an unambiguous failure signal — if you rolled back deploy X, deploy X is a change failure, and `restore_time − impact_start` is its TTR. Concretely:

- **CFR signal:** any deploy that was rolled back, hotfixed, or had an incident attributed to it → mark `failed = true`. `CFR = failed_deploys / total_deploys`.
- **TTR signal:** for each failure, `incident.resolved_at − incident.started_at` (or `rollback.completed_at − degradation.detected_at`). Take the median across failures in the window.

> **Key insight:** All four keys are computable from **deploy events joined to commit timestamps and incident/rollback records** — nothing exotic. If you can answer "when did we deploy, what SHA, did it break, and how long to fix," you can compute all four. The hard part is never the math; it's the consistency of the events (next section).

---

## Data-Quality Traps — What Counts as a "Deployment" and a "Failure"

The formulas are trivial; the **definitions you encode** are where teams quietly lie to themselves. Two questions decide everything.

**What counts as a "deployment"?** Pick one definition and apply it everywhere, because the choice moves your numbers by an order of magnitude:

- **One merge → forty pods rolling out.** That's **one** deployment event (one change reaching prod), not forty. Count the *release of a change to users*, not the number of replicas updated.
- **Re-deploying the same artifact (a restart, a config-only rollout, an autoscale).** Usually *not* a code deployment — no new change reached users. Counting these inflates DF without shipping anything.
- **A rollback.** A rollback is a deployment in the mechanical sense, but for DF most teams **don't** count it as a forward deployment (it ships no new value); it *does* count as the failure/recovery of the deploy it reverts.
- **Deploy to staging / canary-only.** Not production → not a DORA deployment. DF is explicitly *production* (or end-user) deploys.
- **Batched release of N merged PRs in one go.** That's **one** deployment carrying N changes. For LT you may compute per-change lead time (each PR's first-commit → this deploy), but it's still one deploy event for DF.

**What counts as a "failure"?** The DORA bar is specific: **a deployment that causes degraded service and *requires remediation*** — rollback, hotfix, fix-forward, or patch. That bar excludes and includes deliberately:

- **A bug found in staging / caught by CI before prod** → *not* a change failure. It never degraded production. (Counting caught bugs as failures punishes good testing — exactly backwards.)
- **A prod incident with no deploy behind it** (provider outage, DNS, expired cert, traffic spike) → *not* a change failure. Real incident, real TTR for your *reliability* metrics, but it's not a *change* failure because no change caused it.
- **A trivial cosmetic bug nobody remediates** → judgment call, but if it triggered *no* hotfix/rollback, most definitions say *not* a change failure.
- **A deploy that needed an urgent follow-up fix** → *yes*, that's a change failure, even if there was no formal "incident" — the remediation is the signal.

> **Key insight:** A DORA number is only comparable to itself if "deployment" and "failure" mean the same thing every time. The most common way teams fake being "Elite" is by **inflating the deployment count** (counting restarts, config rollouts, per-pod events) — which mechanically *lowers* CFR (more deploys in the denominator, same failures) and *raises* DF. Lock both definitions in writing before you trust a single chart.

---

## The Performance Bands — Elite, High, Medium, Low

DORA's *State of DevOps* research clusters teams into four performance profiles. The exact thresholds drift year to year (and the reports caution they're *clusters*, not a leaderboard), but the rough, widely-cited bands are:

| Metric | **Elite** | **High** | **Medium** | **Low** |
|---|---|---|---|---|
| **Deployment Frequency** | On-demand (multiple/day) | Daily → weekly | Weekly → monthly | < monthly (1/month–1/6mo) |
| **Lead Time for Changes** | < 1 hour | 1 day → 1 week | 1 week → 1 month | 1 month → 6 months |
| **Change Failure Rate** | 0–15% | 16–30% | 16–30% | 16–30%+ |
| **Time to Restore Service** | < 1 hour | < 1 day | 1 day → 1 week | > 1 week → months |

Read this table the way the researchers intend:

- The bands are **logarithmic**, not linear — each step is roughly an order of magnitude (hours → days → weeks → months). Moving up a band is a step-change in how an org operates, not a 10% tweak.
- **CFR barely separates the top bands.** In several report years CFR is statistically similar across High/Medium/Low and only clearly lower for Elite; the *speed* metrics (DF, LT, TTR) do most of the discriminating. Don't over-index on tiny CFR differences.
- A team is rarely uniformly one band. The honest classification is **per-metric**, then a holistic call — "Elite DF and LT, High TTR, Medium CFR" is far more useful than a single forced label.

> **Key insight:** The bands exist to locate a *system's* operating regime and to make "we should improve" concrete ("we restore in days; Elite restores in under an hour"). They are **not** targets to chase per se, and they are **not** for ranking individuals or even teams against each other — the research uses them to study *what practices* move a system between regimes, which is the only question that matters.

---

## Why the Four Are Balanced — Throughput vs Stability

The four keys are not four independent dials; they are two **throughput** measures (Deployment Frequency, Lead Time) and two **stability** measures (Change Failure Rate, Time to Restore). The entire reason DORA insists you watch all four is that **optimizing one pair while ignoring the other produces predictable, dangerous behaviour.**

- **Speed without stability → recklessness.** Tell a team to maximize deployment frequency and minimize lead time, and rate them on nothing else, and you will get exactly that: ship faster by skipping review, trimming tests, deploying untested changes. DF soars, LT plummets — and CFR quietly climbs while TTR balloons, because nothing is watching them. You've optimized the team into instability.
- **Stability without speed → paralysis.** Tell a team to drive CFR to zero and minimize incidents, and rate them on nothing else, and they will *stop shipping*. Massive change-advisory boards, monthly release trains, sign-off gauntlets. CFR looks pristine and TTR is irrelevant because nothing changes — but DF collapses and LT stretches into months. You've optimized the team into a freeze.

The crucial empirical finding of *Accelerate* is that **these are not a trade-off.** Elite performers are better at *all four simultaneously* — they deploy more often *and* fail less *and* recover faster. Speed and stability rise together, because the same practices (small batches, automated testing, trunk-based development, fast rollback) improve both. The four keys are balanced precisely so that *the only way to move them all the right way is to actually get better* — you cannot cheat one without the paired metric exposing you.

> **Key insight:** Watch the **pairs**, not the singles. A rising DF is only good news if CFR and TTR hold or improve alongside it; a falling CFR is only good news if DF and LT don't crater to buy it. The four keys are a system of checks: each speed metric is policed by a stability metric and vice versa. Reporting one or two of them in isolation reintroduces exactly the recklessness-or-paralysis the full set was designed to prevent.

---

## The Four Keys as a System — Google's Four Keys Project

The pattern above — events in, four metrics out, all four on one dashboard — is concrete enough that Google open-sourced a reference implementation: the **Four Keys** project. Its architecture *is* the mental model of this whole page, made into a pipeline:

```
CI/CD + incident webhooks ──► event ingestion ──► normalized "deployments"
                                                   and "incidents" tables
                                                          │
                                                          ▼
                                            queries compute DF, LT, CFR, TTR
                                                          │
                                                          ▼
                                          single dashboard, all four together
```

The design choices encode the lessons above: it ingests **events** (deploys, changes, incidents) rather than asking humans to self-report; it **derives** all four keys from those events so the definitions are applied uniformly; and it puts **all four on one dashboard** so no one can quietly admire deployment frequency while change failure rate rots. The pipeline shape — *normalize deploy + incident events, then derive the four together* — is exactly what you'd build by hand from the instrumentation section. Whether you adopt Four Keys, a vendor (LinearB, Sleuth, Haystack, the platform's built-in DORA panels), or roll your own, the architecture is the same and the discipline is the same: **derive from events, present all four together.**

> **Key insight:** Treating the four keys as a *system* — one event pipeline feeding one dashboard — is what keeps them honest. The moment the four live in four different places owned by four different people, the balancing property dies: someone will report the flattering two and bury the rest.

---

## Worked Example — Computing and Banding a Real Team

Team **Checkout**, one calendar month (30 days, ~21 working days). From the deploy/incident events:

- **30 production deployments** logged this month (config-only restarts already excluded by definition).
- Lead times per deploy (first-commit → live), sorted, in hours: mostly clustered between **3h and 30h**, with a median around **9 hours**; two outliers at 140h and 210h (stuck PRs over holidays).
- **4 deployments** were remediated: 2 rollbacks, 1 hotfix, 1 urgent fix-forward.
- One additional prod incident came from an **expired TLS cert** — no deploy behind it.
- Recovery times for the four *change* failures, in minutes: **40, 95, 20, 180** (median = 67.5 min).

Compute each key:

```
Deployment Frequency
  30 deploys / 21 working days ≈ 1.4 prod deploys per working day   → roughly daily+

Lead Time for Changes  (report the MEDIAN, not the mean)
  median ≈ 9 hours      (the 140h/210h outliers do NOT move the median;
                         they WOULD have dragged a mean up past ~25h — why we use p50)

Change Failure Rate
  failed deploys / total = 4 / 30 = 13.3%
  (the TLS-cert incident is NOT counted — no change caused it)

Time to Restore Service  (median of the 4 change-failure recoveries)
  median(40, 95, 20, 180) = 67.5 minutes ≈ ~1.1 hours
```

Now band each metric against the table:

| Metric | Value | Band |
|---|---|---|
| Deployment Frequency | ~1.4/working day (≈ daily) | **High** (borderline Elite — "on-demand" is multiple/day) |
| Lead Time for Changes | ~9 hours (median) | **High** (Elite is < 1h; < 1 day = High) |
| Change Failure Rate | 13.3% | **Elite** (0–15%) |
| Time to Restore | ~1.1 hours (median) | **Elite/High** (just over the < 1h Elite line) |

**Holistic read:** Checkout is a strong **High performer** with genuinely Elite stability (13.3% CFR, ~1h restore). The thing holding them back from Elite is **throughput cadence and lead time** — they ship about once a day, not many times a day, and median lead time is hours not minutes. The improvement conversation writes itself: this is *not* a "you're breaking too much" team (stability is excellent); it's a "let's get changes to prod faster and more often" team — smaller batches, faster review, more frequent deploys. Crucially, because their CFR and TTR are already Elite, pushing DF and LT up is **safe** to attempt; we have the stability headroom. That is the four keys working as a balanced system: the stability pair told us it's safe to optimize the speed pair.

---

## Mental Models

- **Two stopwatches and two tally counters.** Lead Time and Time to Restore are *durations* you stopwatch (and report as p50/p85). Deployment Frequency and Change Failure Rate are things you *count* (a rate and a ratio). Knowing which kind a metric is tells you how to report it — you never average a duration distribution, you take its percentile.

- **The four keys are two seesaws, not four sliders.** DF↔CFR and LT↔TTR are balanced pairs: push speed recklessly and the paired stability metric tips; freeze for stability and the paired speed metric tips. The only move that tips *nothing* the wrong way is actually getting better — which is the whole point.

- **A deployment is "a change reaching users," not "a thing the deploy tool did."** Forty pods, three replicas, one rolling update from one merge = **one** deployment. Count value reaching users, not mechanical actions. This single rule fixes most DF/CFR inflation.

- **A change failure is caused by a change.** If no deploy is behind the degradation, it's an incident for your reliability metrics but *not* a change failure. CFR isolates "how often does shipping break prod," and that isolation is its entire value.

---

## Common Mistakes

1. **Reporting lead time and time-to-restore as means.** These distributions are violently right-skewed; one stuck PR or one nightmare incident drags the mean into fiction. Use the **median (p50)** and ideally also **p85**.

2. **Inflating the deployment count.** Counting per-pod rollouts, restarts, config-only changes, or staging deploys makes DF look Elite *and* artificially lowers CFR (bigger denominator). Define "deployment" as one change reaching production, once.

3. **Counting caught bugs as change failures.** A bug stopped in CI or staging never degraded production — it is a *success* of your testing. Counting it as a change failure literally punishes good gates and rewards skipping them.

4. **Counting non-change incidents in CFR.** A provider outage or expired cert with no deploy behind it is not a *change* failure. It belongs in availability/reliability metrics ([05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/middle.md)), not in CFR's numerator.

5. **Optimizing one or two keys in isolation.** Driving DF up and LT down while ignoring CFR/TTR breeds recklessness; driving CFR to zero while ignoring DF/LT breeds paralysis. Always watch the **pairs**; report all four on one surface.

6. **Treating the bands as individual targets or a leaderboard.** The Elite/High/Medium/Low bands describe a *system's* operating regime to guide improvement. Using them to rank teams or people invites Goodhart-style gaming ([06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/middle.md)).

---

## Test Yourself

1. For Lead Time for Changes, exactly which two timestamps bound the clock (per the DORA definition), and why must you report it as a percentile rather than a mean?
2. One merge triggers a rolling update across 40 pods. How many deployments is that, and why does the answer matter for both DF and CFR?
3. A bug is caught by CI before it reaches production. Is it a change failure? A provider outage takes prod down with no deploy involved — is *that* a change failure? Explain the rule.
4. Why does DORA insist you watch all four keys together? Describe what goes wrong if you optimize only the two speed metrics.
5. A team deploys 50 times a month, has a 6% CFR, ~30-min restore, but a median lead time of three weeks. Roughly band each metric and give the one-line improvement read.
6. Why is inflating the deployment count a *double* distortion — what does it do to DF, and what does it do to CFR?

<details>
<summary>Answers</summary>

1. From the **first commit** of the change to that change **running successfully in production**. You report a percentile (p50/p85) because delivery-time distributions are heavily right-skewed — a few stuck changes would make the mean wildly unrepresentative of the typical change.
2. **One** deployment — one change reached users. It matters because counting it as 40 would inflate DF and, by enlarging the denominator, artificially lower CFR. Always count "a change reaching production," not mechanical rollout steps.
3. The CI-caught bug is **not** a change failure — it never degraded production (it's a win for your gates). The provider outage is **not** a change failure either, because no change caused it (it's a reliability/availability incident). The rule: a change failure is a *production* degradation *caused by a deployment* that *required remediation*.
4. Because the four are two balanced pairs (speed: DF/LT; stability: CFR/TTR), and optimizing one pair in isolation tips the other. Optimize only speed and you get recklessness — teams ship faster by skipping tests/review, so CFR climbs and TTR balloons while DF/LT look great. Watching all four is what makes the only winning move "actually get better."
5. DF ~50/month ≈ multiple per working day → **Elite**; CFR 6% → **Elite**; restore ~30 min → **Elite**; lead time ~3 weeks → **Medium/Low**. One-line read: stability and deploy cadence are Elite but **lead time is the bottleneck** — changes sit for weeks before shipping (likely long review/queue/wait states); attack the pipeline wait, not the deploy step.
6. It **raises DF** (more counted deploys) *and* **lowers CFR** (same number of failures over a bigger deployment denominator). So one bad definition simultaneously flatters a speed metric and a stability metric — which is exactly why "what counts as a deployment" must be locked down first.

</details>

---

## Cheat Sheet

```
THE FOUR KEYS — CLOCKS & FORMULAS
  Deployment Frequency  RATE   count of PROD deploys / window        (per day/week/month)
  Lead Time for Changes DUR    first commit ──► live in prod         (report p50/p85)
  Change Failure Rate   RATIO  failed deploys / total deploys × 100% (failed = needed remediation)
  Time to Restore       DUR    degradation start ──► service restored (report p50)

KIND TELLS YOU HOW TO REPORT
  durations (LT, TTR) → PERCENTILES, never means (right-skewed)
  rates/ratios (DF, CFR) → counts over a window

WHAT COUNTS
  deployment = ONE change reaching PROD (40 pods from 1 merge = 1 deploy)
               NOT: restarts, config-only, staging, per-pod rollouts
  failure    = PROD degradation CAUSED BY A DEPLOY that needed remediation
               NOT: bugs caught in CI/staging, provider outages w/ no deploy

BANDS (rough, from State of DevOps)
                 ELITE        HIGH         MEDIUM        LOW
  Deploy Freq    on-demand    daily–weekly weekly–monthly < monthly
  Lead Time      < 1 hour     < 1 day      < 1 month      1–6 months
  CFR            0–15%        16–30%       16–30%         16–30%+
  Restore        < 1 hour     < 1 day      < 1 week       > 1 week

BALANCE (read the PAIRS)
  speed (DF, LT) without stability (CFR, TTR) → recklessness
  stability without speed → paralysis
  Elite teams win ALL FOUR at once — speed & stability rise together
```

---

## Summary

- Each key pins to specific events: **DF** counts production deploys; **LT** runs *first commit → live in prod*; **CFR** is *failed deploys / total deploys*; **TTR** runs *degradation start → restored*. Two are durations (report percentiles), two are rates/ratios.
- All four are computable from **deploy events joined to commit timestamps and incident/rollback records** — the math is trivial; the discipline is consistent events.
- The data-quality battle is two definitions: **what counts as a deployment** (one change to prod, not per-pod/restart/staging) and **what counts as a failure** (prod degradation caused by a deploy needing remediation, not CI-caught bugs or no-deploy outages). Getting these wrong is how teams fake "Elite."
- The **Elite/High/Medium/Low** bands locate a *system's* operating regime on roughly logarithmic scales; classify **per metric**, then read holistically — they are not a leaderboard or individual target.
- The four are **balanced**: two speed metrics policed by two stability metrics. Speed without stability breeds recklessness; stability without speed breeds paralysis. Watch the **pairs**, on one surface — which is exactly what **Google's Four Keys** pipeline operationalizes: derive all four from events, present them together.

---

## Further Reading

- *Accelerate* (Forsgren, Humble & Kim) — the research behind the four keys and the performance clusters; read Chapters 1–2 for the throughput/stability balance.
- **DORA / Google Cloud — *State of DevOps* reports** — the source of the band thresholds (note they shift year to year and are clusters, not a leaderboard). See `dora.dev` for the current "Quick Check" and definitions.
- **Google Cloud — Four Keys** (open-source project on GitHub) — a reference event-pipeline-to-dashboard implementation; reading its schema is the fastest way to internalize the instrumentation.
- *DevOps Research and Assessment — metric definitions* on `dora.dev` — the authoritative, current wording for each key (including the *failed-deployment recovery time* framing of TTR).

---

## Related Topics

- [junior.md](junior.md) — the four keys named and motivated, with the throughput-vs-stability intuition.
- [senior.md](senior.md) — the four keys as an org-level improvement instrument: rollout, gaming-resistance, and pairing with flow and SPACE.
- [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/middle.md) — untangling the lead-time family and decomposing the pipeline to find where time actually goes.
- [05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/middle.md) — CFR, MTTR, SLOs and the reliability "fifth key" in depth, and where non-change incidents belong.
- [Performance → Regression Testing](../../performance/07-performance-budgets-and-regression-testing/) — catching regressions *before* they become change failures, with budgets and gates.
