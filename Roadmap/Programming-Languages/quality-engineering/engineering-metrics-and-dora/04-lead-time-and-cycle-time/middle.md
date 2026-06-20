# Lead Time & Cycle Time — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Lead Time & Cycle Time
> *The junior page told you "faster delivery is better" and gave you one number. This page shows that "lead time" is three or four different numbers wearing the same name — and that the only useful one is the one whose clock you can state out loud, decompose into stages, and report as a distribution rather than an average.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Definitional Minefield — State Your Clock or the Number Is Meaningless](#the-definitional-minefield--state-your-clock-or-the-number-is-meaningless)
4. [Decomposing the Pipeline into Measurable Sub-Times](#decomposing-the-pipeline-into-measurable-sub-times)
5. [Where Teams Actually Lose Time](#where-teams-actually-lose-time)
6. [Measuring It from Real Data](#measuring-it-from-real-data)
7. [The Distribution Matters — Medians and Percentiles, Never Means](#the-distribution-matters--medians-and-percentiles-never-means)
8. [Reducing Cycle Time — Batch Size, WIP, Review SLAs, CI](#reducing-cycle-time--batch-size-wip-review-slas-ci)
9. [Worked Example — Decomposing a PR's Cycle Time](#worked-example--decomposing-a-prs-cycle-time)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I measure delivery time precisely — decompose it, source it from real data, and report it honestly?**

At the junior level, "lead time" is a single dial you want to turn down. That model is correct in spirit and useless in practice, because the moment two people quote a lead-time number they are almost always measuring different things. One started the clock when a customer filed the request; the other started it at the first commit. Their numbers differ by *weeks*, and neither is wrong — they answer different questions.

This page does three things the dial can't. First, it pins down **which clock** you are running, because an unstated clock makes every comparison a category error. Second, it **decomposes** the time between clock-start and clock-stop into stages you can each measure — coding, PR pickup, review, CI, merge-to-deploy — so you can see *where* the time goes instead of just *how much* there is. Third, it insists on the **distribution**: cycle time is heavy-tailed, the mean lies, and the long tail is where your team actually feels pain. Get these three right and the metric becomes a map of your bottleneck. Get them wrong and you have a number that sounds rigorous and means nothing.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say why fast, safe delivery correlates with team performance.
- **Required:** You understand the DORA four keys at a basic level — especially *lead time for changes* ([01 — DORA Four Keys](../01-dora-four-key-metrics/middle.md)).
- **Helpful:** You've opened, reviewed, and merged pull requests on GitHub or GitLab and have a feel for the timestamps they emit.
- **Helpful:** A rough sense of percentiles (p50/p85/p95) versus the arithmetic mean.

---

## The Definitional Minefield — State Your Clock or the Number Is Meaningless

"Lead time" is borrowed from manufacturing, where it means *order placed → product delivered*. Software inherited the phrase and then quietly forked it into several incompatible measurements. The disagreement is entirely about **where the clock starts**.

| Name | Clock starts | Clock stops | Question it answers |
|---|---|---|---|
| **Total lead time** (product) | customer request / idea created | running in production | "How long from *want* to *have*?" |
| **DORA lead time for changes** | **first commit** on the change | **change deployed** to production | "How fast does committed code reach users?" |
| **Cycle time** (flow) | work *actively started* (e.g. moved to In Progress) | work *done* (merged or deployed) | "How long is the *active-work* phase?" |
| **PR cycle time** (tooling) | pull request opened | pull request merged | "How fast does a change clear review + merge?" |

These are not interchangeable. **DORA lead time for changes is precisely *first commit → deploy*** — it deliberately excludes the messy, hard-to-attribute "thinking about it / waiting in the backlog" time, so it isolates *delivery* throughput from *prioritisation*. **Cycle time** starts later than total lead time (it skips the backlog wait) and is the flow community's term for the active-work span. **PR cycle time** is what most engineering-analytics tools actually compute, because PR open/merge timestamps are clean and universally available — but it's a *subset* of DORA lead time (it stops at merge, not deploy, and starts at PR-open, not first commit).

```
idea ──[backlog wait]── start ──[coding]── PR open ──[review]── merge ──[deploy]── prod
 │                        │                   │                  │                   │
 └──────── total lead time ──────────────────────────────────────────────────────┘
                          └─────────────── cycle time ──────────────────────────┘
                                           first commit ─[DORA lead time]─ deploy
                                            └── PR cycle time ──┘
```

> **Key insight:** A lead-time number with no stated clock is not a measurement — it's a Rorschach test. Before you quote, compare, or set a target on a number, write down its two endpoints in one sentence: *"from \_\_\_\_ to \_\_\_\_."* If you can't, you don't have a metric; you have a vibe. Most "our lead time went up but it feels faster" arguments are two people running different clocks.

---

## Decomposing the Pipeline into Measurable Sub-Times

The total span is useful for trend-watching, but it can't tell you *what to fix*. For that you split the journey into stages, each bounded by an event you can timestamp. A workable decomposition for a commit-to-deploy pipeline:

| Stage | From event | To event | What it captures |
|---|---|---|---|
| **Pre-work / queue** | work prioritised | work started | backlog wait before anyone touches it |
| **Coding time** | first commit | PR opened | the actual authoring of the change |
| **PR pickup (wait)** | PR opened | first review action | the change sitting *idle*, waiting for a reviewer |
| **Review time** | first review | approved | the active back-and-forth of review |
| **Merge wait** | approved | merged | waiting on CI gates, merge queue, or a human to click merge |
| **CI / build time** | merge (or push) | pipeline green | automated build + test on the merge commit |
| **Merge → deploy** | merged | live in production | release queue, deploy windows, manual gates |

Two things make this decomposition powerful. First, **the stages sum to the whole** — if they don't, you've missed an event or double-counted one, which is itself a useful audit. Second, each stage is one of two *kinds*: **active work** (someone is doing something — coding, reviewing) or **wait** (the change is idle in a queue — pickup, merge wait, deploy queue). This distinction is the heart of flow analysis: see [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/middle.md) for *flow efficiency* = active ÷ (active + wait), which on most teams is shockingly low (often under 15%).

> **Key insight:** "Cycle time is too high" is not actionable; "PR pickup wait is the median 18-hour stage and CI is 6 minutes" is. The decomposition converts a single scary number into a ranked list of suspects. You optimise the *biggest stage*, re-measure, and move to the next — exactly the bottleneck discipline from value-stream mapping, applied to the delivery pipeline instead of the factory floor.

---

## Where Teams Actually Lose Time

Engineers' intuition is that delivery is slow because *coding* is slow, so they reach for faster machines, better autocomplete, or "just give me more focus time." The data from large-scale PR studies says otherwise. On most teams, **coding time is a minority of cycle time**, and the time sinks are the *wait* stages between active work:

- **PR pickup latency** — the gap between "I opened the PR" and "someone started reviewing it" — is repeatedly the single largest stage. A PR that takes 40 minutes to review can sit *untouched* for a day first. The change is done; it's just *waiting* for attention.
- **Deploy queues and release windows** — code is merged and green, then waits for a Thursday release train, a change-approval board, or a manual deploy that only certain people can run. This wait is invisible in PR-only metrics, which is exactly why DORA's clock runs all the way to *deploy*.
- **Rework loops** — a large PR triggers several rounds of review, each adding a full pickup-wait cycle. The time lost isn't the review itself; it's the *re-queuing* after each round.

Why does this matter so much? Because **wait time is where context dies.** While a PR sits in pickup, the author moves on to something else; when review finally lands, they must page their mental model back in, and the reviewer is reverse-engineering intent that was obvious the day it was written. Wait stages don't just add elapsed time — they multiply the *cost* of the active stages around them.

> **Key insight:** Look at *wait* before you look at *work*. If pickup latency and deploy queues dominate your decomposition — and they usually do — then hiring faster typists or buying faster laptops moves a number that was never the bottleneck. The lever is **reviewer responsiveness and deployment automation**, not coding speed. Optimising coding time when wait time dominates is the textbook mistake of accelerating a non-bottleneck.

---

## Measuring It from Real Data

You don't need a vendor to start — the source systems already emit the timestamps. The trick is knowing which event maps to which stage boundary.

**From the Git host (GitHub / GitLab).** Every PR/MR carries the timestamps that bound the review stages:

- `created_at` — PR opened → start of **PR pickup**.
- first `review` / first review *comment* — end of pickup, start of **review time**. (You usually compute "first review activity," not just formal reviews, since a comment counts as engagement.)
- `merged_at` — end of the PR's life → bounds **review** and **merge wait**.
- the change's **first commit** `authored_date` → start of **coding time** (and the start of DORA lead time).

```bash
# GitHub: pull the timestamps that bound a PR's review stages
gh pr list --state merged --limit 200 \
  --json number,createdAt,mergedAt,reviews,commits \
  > prs.json
# pickup_wait = (first review activity) - createdAt
# review_time = mergedAt - (first review activity)   # approximation
# coding_time = createdAt - (first commit authoredDate)
```

**From CI/CD.** The deploy half of the clock lives in your pipeline tooling:

- CI start/finish timestamps on the merge commit → **CI/build time**.
- the deployment event's timestamp (a GitHub *deployment*, a tagged release, a CD-tool record) → **merge → deploy**, and the stop event for **DORA lead time for changes**.

The standard way to wire deploy data into DORA without bespoke plumbing is the **CNCF `dora` / Four Keys** project, or vendor connectors that read your deploy events directly.

**Engineering-analytics tools** compute this decomposition for you by ingesting Git + CI + issue-tracker webhooks: **LinearB** (PR-centric cycle-time stages and review SLAs), **Sleuth** and **Swarmia** (DORA-first, deploy-aware), and **Code Climate Velocity** (PR and review analytics). They're worth it once you want the breakdown *continuously and per-team* rather than via a one-off script — but understand the formula first, or you'll trust a dashboard you can't sanity-check.

> **Key insight:** The endpoints you can *measure cleanly* (PR open, merge) are not always the endpoints that *matter* (first commit, production deploy). PR-only tools quietly redefine your metric to fit their data. Always ask a dashboard *"where exactly does this clock start and stop?"* — if it stops at merge, it's PR cycle time, not DORA lead time, and it's blind to your deploy queue.

---

## The Distribution Matters — Medians and Percentiles, Never Means

Cycle time is **heavy-tailed**: most changes flow through quickly, and a minority get stuck — blocked on a dependency, caught in a review stalemate, abandoned and resurrected. That shape breaks the arithmetic mean. One PR that sat open for three weeks while its author was on leave can drag the *average* far above what a typical change experiences, so the "average cycle time" describes a PR that doesn't exist.

Report the **distribution** instead:

- **Median (p50)** — the typical experience. Half of changes are faster, half slower. This is your headline number.
- **p85 / p95** — the tail. "95% of changes ship within N days." This is what sets expectations and surfaces the stuck work.
- **Mean** — avoid as a headline. It's pulled around by outliers and gives a false read on a skewed distribution.

```
Cycle time, last 30 days (hours)        ← heavy right tail
p50  ████████ 8h           ← typical change: under a day
p75  ████████████ 21h
p85  ██████████████████ 44h
p95  ████████████████████████████████████ 96h   ← the tail: where the pain lives
mean ███████████████ 31h   ← > p75, dragged up by the tail → misleading
```

The gap between p50 and p95 is itself a metric: a **wide** gap means *unpredictability* — most work is fast but you can't promise a date, because some fraction falls off a cliff. Often a tight p50 hides a brutal p95, and the right goal isn't "lower the median" but "pull in the tail" — find what the p95 changes have in common (usually: they were large, or they stalled in pickup).

> **Key insight:** Stop asking "what's our cycle time?" (a single number) and start asking "what's our *cycle time distribution*?" (p50 *and* p95). The median tells you the common case; the tail tells you the failure mode. Improvement work lives in the tail — the long pole is where engineers feel "everything takes forever," even when the median looks fine.

---

## Reducing Cycle Time — Batch Size, WIP, Review SLAs, CI

Once the decomposition names the dominant stage, the interventions are well-understood. They map cleanly onto the stages above.

- **Smaller PRs (reduce batch size).** A 50-line PR is reviewed in minutes; an 800-line PR triggers multiple rounds, each adding a fresh pickup-wait. Smaller batches shrink review time, slash rework loops, and tighten the tail — this is the single highest-leverage habit because it improves *several* stages at once. (Little's Law: smaller items flow faster through the same pipeline.)
- **WIP limits.** Capping work-in-progress forces the team to *finish* before starting, which cuts the pre-work queue and stops changes from rotting half-done. More parallel work doesn't deliver faster; it just spreads the same throughput over more half-finished items, inflating everyone's cycle time. See [02 — Flow Metrics](../02-flow-metrics-and-value-stream/middle.md).
- **Review SLAs.** Attack the usual #1 stage — pickup latency — directly. A team norm like "PRs get a first review within 2 hours during working hours," reinforced by reviewer rotations and PR-pickup alerts, can collapse the largest wait stage without touching how anyone codes.
- **Faster CI.** If CI is a real stage (minutes-to-tens-of-minutes), speeding it removes wait from *every* change and shortens the merge-wait feedback loop. This is a direct hand-off to build-system work — caching, incremental builds, test parallelism, remote execution. See [Build Systems → Build Performance](../../build-systems/10-build-performance/).
- **Automated deploy.** If merge → deploy is dominated by a manual release train or approval board, the fix is a reliable automated deployment pipeline so merged code flows to production continuously instead of waiting for a window. This is the stage PR-only metrics can't even see.

> **Key insight:** The interventions are not a menu to pick from at random — they are *targeted at the stage your decomposition flagged*. Shrinking PRs when CI is your bottleneck, or speeding CI when pickup is, is motion without progress. Measure → find the dominant stage → apply the matching lever → re-measure. The decomposition is what makes the optimisation *aimed* instead of hopeful.

---

## Worked Example — Decomposing a PR's Cycle Time

A team feels "review is killing us" and wants evidence. They pull timestamps for one representative PR and decompose it.

**The PR's raw events:**

```
first commit authored   Mon 09:10
PR opened               Mon 11:30
first review comment     Tue 14:05    ← reviewer finally looks
approved                Tue 15:00
merged                  Tue 15:40
CI green (on merge)     Tue 15:52
deployed to prod        Thu 10:00    ← next release train
```

**Decomposed into stages:**

| Stage | Span | Duration | Kind |
|---|---|---|---|
| Coding time | commit → PR open | 2h 20m | active |
| **PR pickup (wait)** | PR open → first review | **26h 35m** | **wait** |
| Review time | first review → approved | 55m | active |
| Merge wait | approved → merged | 40m | wait |
| CI / build | merge → green | 12m | active |
| **Merge → deploy (wait)** | merged → prod | **~42h** | **wait** |

**Reading the breakdown.** The team's story was "review is killing us," but review time is *55 minutes*. The actual time sinks are **PR pickup (26h)** and the **deploy wait (42h)** — both pure *wait*. Flow efficiency here is roughly (2h20 + 55m + 12m) ÷ (~72h total) ≈ **5%**: the change spends 95% of its life idle in queues. The fix isn't "review faster" — review is already fast — it's a **review-pickup SLA** plus moving off the twice-weekly release train toward continuous deploy.

**Now the percentile view, not one PR.** One PR proves nothing; the team computes the distribution over 30 days:

```
                 p50      p85      p95
coding time      2.0h     5h       9h
PR pickup        9h       28h      52h    ← dominant stage, brutal tail
review time      0.8h     2h       4h
CI/build         11m      14m      22m
merge→deploy     20h      44h      68h    ← release-train wait, also bad
─────────────────────────────────────
total cycle time 17h      61h      120h
```

The single PR wasn't a fluke: pickup and deploy dominate at *every* percentile, and the p95 (120h vs p50's 17h) shows the unpredictability the team feels. Targets fall out naturally: a 4-hour pickup SLA and continuous deploy would attack both dominant stages and pull in the tail — and the team will *re-measure the same table* to prove it worked.

---

## Mental Models

- **The clock is the metric.** A lead-time number is defined entirely by its two endpoints. Change the start event and you've changed the metric, even if the name is identical. "From \_\_\_\_ to \_\_\_\_" is the first sentence of any honest report.

- **Decomposition turns a number into a map.** "Cycle time = 3 days" is a destination with no directions. The stage breakdown is the map that shows *where* the 3 days went — and the map almost always points at a wait stage you weren't looking at.

- **Wait is the enemy, not work.** Most delivery time is changes sitting idle in queues, not engineers being slow. Flow efficiency (active ÷ total) on a typical team is in the low double digits. Hunt the idle time first.

- **The mean is a liar on a skewed distribution.** Cycle time has a heavy right tail, so the average describes a change that doesn't exist. Median is the typical case; p95 is the failure mode. Lead with both.

- **The tail is where the pain lives.** Teams *feel* their p95, not their p50. "Everything takes forever" usually means "a memorable fraction of things fall off a cliff." Improvement work targets the long pole.

---

## Common Mistakes

1. **Quoting a lead-time number with no stated clock.** Two people compare numbers that start at different events and conclude something false. Always state the two endpoints before comparing or target-setting.

2. **Confusing DORA lead time with PR cycle time.** DORA's clock is *first commit → deploy*; most tools report *PR open → merge*. The tool's number is blind to coding time and the entire deploy queue. Know which one your dashboard shows.

3. **Reporting the mean.** Cycle time is heavy-tailed; the mean is dragged above the typical experience by a few stuck PRs. Report p50 and p95 instead.

4. **Optimising coding time when wait dominates.** Faster machines and better autocomplete move a stage that was never the bottleneck. Check the decomposition first; the lever is usually reviewer responsiveness or deploy automation.

5. **Stopping the clock at merge.** "Done" is *in production*, not *merged*. A change that's merged but waiting three days for a release train has a real lead time of three days, and your users are still waiting. Measure to deploy.

6. **Treating the single-number trend as actionable.** "Cycle time went up 10%" tells you nothing about *what to fix*. Without the stage breakdown, you're optimising blind. Decompose before you act.

---

## Test Yourself

1. Someone says "our lead time is 4 days." What's the very first question you ask, and why does the number mean nothing without the answer?
2. State the exact start and stop events for *DORA lead time for changes*. How does it differ from PR cycle time?
3. Your cycle time decomposes to: coding 2h, pickup 20h, review 1h, CI 10m, deploy wait 30h. Where do you intervene, and which interventions are *wrong* to reach for?
4. Why is the mean a poor headline for cycle time, and what two numbers should you report instead?
5. A team has p50 = 6h but p95 = 90h. What does that gap tell you, and where does improvement work belong?
6. Which timestamps from a GitHub PR bound the *pickup wait* and *review time* stages?

<details>
<summary>Answers</summary>

1. *"Where does the clock start and stop?"* "Lead time" maps to several different measurements (total lead time, DORA lead time, cycle time, PR cycle time) that start at different events and can differ by weeks. Without the endpoints the number is uncomparable.
2. **First commit on the change → that change deployed to production.** PR cycle time runs *PR opened → merged* — it starts later (after coding) and stops earlier (at merge, not deploy), so it's blind to coding time and the entire deploy queue.
3. Pickup (20h) and deploy wait (30h) dominate — both *wait*. Intervene with a review-pickup SLA and automated/continuous deploy. *Wrong* levers: speeding up coding, faster CI, or "review faster" — review is already 1h and CI is 10m; those aren't the bottleneck.
4. Cycle time is heavy-tailed, so a few stuck PRs drag the mean above the typical experience — it describes a change that doesn't exist. Report the **median (p50)** for the typical case and **p95** for the tail/failure mode.
5. A wide p50–p95 gap means **unpredictability**: most work is fast, but a meaningful fraction falls off a cliff, so you can't promise dates. Improvement work belongs in the **tail** — find what the p95 changes share (usually large size or a long pickup stall).
6. **Pickup wait** = (first review activity timestamp) − `created_at`. **Review time** = `merged_at` − (first review activity) as a common approximation (or approved − first review, if you track approval separately).

</details>

---

## Cheat Sheet

```
STATE YOUR CLOCK (the metric IS its endpoints)
  total lead time   idea/request ─────────────────────────► prod
  DORA lead time    first commit ───────────────────────► deploy   ← DORA's definition
  cycle time        work started ──────────────────────► done
  PR cycle time     PR opened ──────────► merged                    ← what most tools show

DECOMPOSE (stages sum to the whole; tag each active vs wait)
  pre-work queue | coding | PR pickup* | review | merge wait* | CI | merge→deploy*
  (* = wait stages — usually where the time actually goes)
  flow efficiency = active / (active + wait)   ← often < 15%

WHERE TIME GOES (usually)
  #1 PR pickup latency   (PR sits unreviewed)
  #2 deploy queue        (merged, waiting for a release window)
  NOT coding speed

REPORT THE DISTRIBUTION (cycle time is heavy-tailed)
  p50  = typical experience   ← headline
  p95  = the tail / pain      ← where improvement lives
  mean = LIAR on skew         ← do not headline
  wide p50→p95 gap = unpredictability

REDUCE (aim at the dominant stage)
  smaller PRs → shrinks review + rework + tail   (highest leverage)
  WIP limits  → cut queue, finish before starting
  review SLA  → kill pickup latency
  faster CI   → build-systems/10-build-performance
  auto deploy → kill the release-train wait
```

---

## Summary

- **"Lead time" is several metrics sharing a name**, distinguished only by where the clock starts. **DORA lead time for changes is *first commit → deploy*.** Cycle time is the active-work span; PR cycle time (*open → merge*) is what most tools actually compute. State your two endpoints or the number is meaningless.
- **Decompose** the span into measurable, timestamp-bounded stages — coding, PR pickup, review, merge wait, CI, merge→deploy — and tag each as **active work** or **wait**. The decomposition turns an unactionable number into a ranked list of suspects.
- **Wait dominates.** On most teams the time sinks are **PR pickup latency** and **deploy queues**, not coding. Flow efficiency is often under 15%. Optimise the bottleneck stage, not the one your intuition blames.
- **Measure from real data:** PR `created_at` / first-review / `merged_at` from GitHub/GitLab; commit→deploy from CI and deployment events; engineering-analytics tools (LinearB, Sleuth, Swarmia, Code Climate Velocity) compute the breakdown continuously — but know the formula so you can sanity-check the dashboard.
- **Report the distribution, never the mean.** Cycle time is heavy-tailed; lead with **p50** (typical) and **p95** (the tail, where the pain lives). A wide p50–p95 gap is unpredictability.
- **Reduce it with stage-matched levers:** smaller PRs, WIP limits, review SLAs, faster CI, and automated deploy — each aimed at the stage your decomposition flagged. Measure, find the dominant stage, apply the matching lever, re-measure.

---

## Further Reading

- *Accelerate* (Forsgren, Humble & Kim) — the research behind lead time for changes as a key, and why throughput and stability rise together.
- *Project to Product* (Mik Kersten) — the Flow Framework: flow time, flow efficiency, and the active-vs-wait distinction this page leans on.
- DORA / *State of DevOps* reports — the canonical definitions of the four keys and the Elite→Low performance clusters.
- *Principles of Product Development Flow* (Donald Reinertsen) — batch size, queues, and WIP from first principles; why small batches and wait reduction dominate.
- LinearB / Sleuth / Swarmia engineering blogs — practical PR-cycle-time decompositions, review SLAs, and worked dashboards.

---

## Related Topics

- [01 — DORA Four Keys](../01-dora-four-key-metrics/middle.md) — where lead time for changes sits among the four keys, and how it pairs with deployment frequency.
- [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/middle.md) — flow efficiency, WIP, wait states, and finding the bottleneck across the whole value stream.
- [Build Systems → Build Performance](../../build-systems/10-build-performance/) — cutting CI/build time, the one delivery stage you fix with faster builds.
- [junior.md](junior.md) — the one-number view of delivery speed this page decomposes.
- [senior.md](senior.md) — driving lead time as a system, statistical rigour on the distribution, and avoiding metric corruption.
