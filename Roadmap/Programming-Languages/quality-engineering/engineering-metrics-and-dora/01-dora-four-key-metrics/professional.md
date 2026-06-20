# The DORA Four Keys — Professional Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The DORA Four Keys
> *The senior page taught you what the four keys mean and how the clusters cluster. This page is about rolling DORA out across an org without it backfiring — instrumenting deploys and incidents centrally, governing what "deployment" and "failure" even mean, and keeping the program a learning tool instead of the day it quietly turns into a stick and the numbers go fictional.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Implementing a DORA Measurement Program](#implementing-a-dora-measurement-program)
4. [Build vs Buy — Four Keys, the Platforms, or DIY](#build-vs-buy--four-keys-the-platforms-or-diy)
5. [Definitions Governance — One Meaning of "Deployment" and "Failure"](#definitions-governance--one-meaning-of-deployment-and-failure)
6. [Using DORA to Drive Improvement, Not Judgment](#using-dora-to-drive-improvement-not-judgment)
7. [The Political Failure Modes](#the-political-failure-modes)
8. [Pairing DORA with Value and Outcome Metrics](#pairing-dora-with-value-and-outcome-metrics)
9. [Benchmarking Honestly](#benchmarking-honestly)
10. [The Exec Conversation — What DORA Can and Can't Promise](#the-exec-conversation--what-dora-can-and-cant-promise)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running DORA as an org-wide program — the data pipeline, the governance, the politics — so it accelerates teams instead of teaching them to lie to you.**

The senior page framed the four keys as engineering tradeoffs: throughput (deployment frequency, lead time) versus stability (change failure rate, time to restore), and the *Accelerate* finding that elite teams refuse the trade and get both. At the professional level the four keys show up in different meetings: a VP who wants "a DORA dashboard for all forty teams by Q3"; a platform team asked to instrument deploys across a dozen CI systems that each define "deploy" differently; a director who, with the best intentions, puts deployment frequency in a quarterly OKR — and three months later every team is shipping no-op deploys to make the number move.

None of these are new *concepts*. They're the four keys you already understand, now multiplied by an org chart, an exec audience, and Goodhart's law. The skill here is judgment under those constraints: knowing that the measurement is the easy 20% and the governance is the hard 80%; that DORA measures *how well you deliver*, never *whether you delivered the right thing*; that the instant the numbers are tied to a performance review, they stop describing reality and start describing what people want you to see. This page is the pragmatic, battle-tested layer — how to roll DORA out so it survives contact with humans.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the four keys' precise definitions, the throughput/stability pairing, the Elite→Low clusters, and the *Accelerate* capability model.
- **Required:** You've worked inside a real delivery pipeline — CI, deploys, an on-call rotation, an incident.
- **Helpful:** You've watched a metric get gamed, or owned a dashboard an executive read.
- **Helpful:** You've sat in the meeting where someone proposed measuring engineers and you felt the room get quiet.

---

## Implementing a DORA Measurement Program

The four keys are deceptively cheap to *define* and expensive to *measure consistently*. The whole program reduces to: capture two event streams reliably, derive four numbers from them the same way everywhere, and surface those numbers to the people who can act on them. Most of the failures are in "reliably" and "the same way."

**The two event streams you must instrument:**

1. **Deployments.** Every time code reaches production (or your defined production boundary), emit an event: `service`, `commit SHA`, `timestamp`, `environment`, `success/fail`. Throughput's two keys (deployment frequency, lead time for changes) are computed entirely from this stream plus commit timestamps.
2. **Incidents / failures.** Every time a deployment causes a degradation requiring remediation, emit an event: `service`, `start time`, `restore time`, `the deploy that caused it` (if known). Stability's two keys (change failure rate, time to restore) come from this stream joined to the deploy stream.

**Where the data actually lives** — and the joins you'll fight:

| Key | Source of truth | The hard part |
|---|---|---|
| Deployment frequency | CI/CD deploy events, GitOps merges, release tags | One *deploy event* per env per service, deduped — not per pipeline run, not per pod restart |
| Lead time for changes | commit timestamp → that commit's prod deploy timestamp | *Joining a commit to the deploy that shipped it* — trivial with trunk + tags, painful with long-lived branches and cherry-picks |
| Change failure rate | deploy events ⋈ incidents caused by a deploy | Attributing an incident *to a deploy* — and agreeing what counts as a failure |
| Time to restore | incident start → service restored | A trustworthy *start* time (detection lag hides here) and a clear "restored" |

> **The professional reality:** lead time and change failure rate are the two that break, because both are *joins across systems*. Deployment frequency is a count and time-to-restore is a subtraction; those are easy. Lead time needs your VCS and your deploy system to agree on "which commit went out when," and CFR needs your deploy system and your incident system to agree on "which deploy broke things." Get the event schema and the join keys (commit SHA, service name, environment, deploy ID) right on day one, or you'll be reconciling spreadsheets forever.

**Instrument centrally, not per-team.** If each team builds its own DORA collection, you get forty incomparable definitions and a maintenance swamp. The durable pattern is a small **platform-owned pipeline**: a deploy event emitted by the shared CI/CD templates (so every team gets it for free), an incident event emitted by the shared incident tooling, both flowing into one store, with the four keys computed once in one place. Teams *consume* dashboards; they don't each *reimplement* the metric. This is also the only way governance (next sections) can hold.

---

## Build vs Buy — Four Keys, the Platforms, or DIY

There are three honest ways to stand up DORA, and the right one depends on how much of the pipeline you already control and how much you want to own.

**Option A — Google's Four Keys (open source).** The reference implementation: a set of Cloud Functions / BigQuery / Looker pieces that ingest deploy and incident events (via webhooks from GitHub, GitLab, Cloud Build, PagerDuty…) and compute the four keys with the *canonical* definitions. Cheap, transparent, and definitionally trustworthy — you can read exactly how each number is derived. Cost: it's GCP-shaped, it's a system *you* now operate, and adapting ingestion to a heterogeneous CI estate is real work.

**Option B — A commercial platform (LinearB, Sleuth, Faros, DX, Jellyfish, Swarmia…).** They integrate with your VCS, CI, and incident tools and give you DORA dashboards in days, plus extras: flow metrics, PR analytics, investment/allocation views, survey-based DevEx (DX in particular is grounded in the SPACE/DevEx research). Cost: money, plus the bigger risk — **many of these surface per-developer and per-team comparisons by default**, and a tool that makes individual leaderboards a click away is a loaded gun in the wrong manager's hands. If you buy, you are also buying a *culture risk* you must actively defuse (see the political failure modes).

**Option C — DIY from CI + incident data.** Pull deploy events from your CI/CD, incidents from PagerDuty/Opsgenie/your incident tool, into your existing warehouse (BigQuery/Snowflake/Redshift) and compute the four keys in dbt/SQL on a dashboard you already run (Grafana, Looker, Metabase). Cost: you build and maintain the joins. Benefit: *you control every definition*, the data lives next to your other org data, and there's no per-seat bill or vendor-default leaderboard.

| | Four Keys (OSS) | Commercial platform | DIY |
|---|---|---|---|
| Time to first dashboard | Weeks | Days | Weeks–months |
| Definitional control | Total (read the code) | Vendor's defaults, some config | Total |
| Ongoing cost | Ops time | Per-seat \$\$ | Ops + maintenance time |
| Beyond DORA (flow, DevEx) | No | Yes, often a lot | Build it yourself |
| Individual-leaderboard risk | Low (you'd add it) | **High (often default)** | Low (you'd add it) |
| Best when | You want canonical + cheap, on GCP | You want fast + breadth, accept the culture risk | You have a warehouse and want full control |

> **The decision:** if your goal is *learning fast with a small team*, Four Keys or DIY keeps the definitions honest and the leaderboard temptation absent. If your goal is *org-wide breadth* (DORA + flow + DevEx + investment views) and you have budget, a platform gets you there faster — but you must turn off, hide, or socially forbid the individual views, or the tool will do your culture's thinking for it. **The build-vs-buy axis that actually matters is not cost; it's who controls the definitions and whether the tool nudges you toward judging people.**

---

## Definitions Governance — One Meaning of "Deployment" and "Failure"

This is the unglamorous work that decides whether your program is trustworthy or theater. If "deployment" means a prod release to one team and a merge-to-main to another, and "failure" means a customer-facing outage to one and any rollback to another, then your org-wide dashboard is comparing nonsense, and the first time someone notices, the whole program loses credibility.

**Write the definitions down, version them, and govern them like an API contract.** Concretely, a DORA definitions doc owned by the platform/metrics team must pin:

- **What is a "deployment"?** A change reaching *production* and serving real traffic — not a staging push, not a merge, not a pod restart, not a re-deploy of an unchanged artifact. If you run progressive delivery, decide the moment: first canary, or full rollout? (Pick one; document it.)
- **What is a "change failure"?** A deployment that results in *degraded service requiring remediation* — a rollback, a hotfix, a patch, or an incident. Crucially, **CFR's denominator is deployments, not incidents**, and a failure is *caused by a change* — a third-party outage or a capacity event that no deploy triggered is reliability noise, not a change failure. Write down the inclusion/exclusion rules.
- **When does the lead-time clock start?** *Code committed* (the DORA canonical) — not ticket-created, not PR-opened. Document the start event so "lead time for changes" isn't silently "idea to prod" for one team and "merge to prod" for another.
- **When does the restore clock start and stop?** Start at *detection* or at *customer impact*? (Detection is more honest; it exposes your detection lag.) Stop at *service restored*, not "ticket closed." Document it.
- **What's the unit of aggregation?** Per service, per team, per value stream? And the window (rolling 30/90 days) and the statistic (median, not mean — these distributions are skewed)?

**Govern changes to these definitions.** When someone proposes "let's count canaries as deploys now," that's a definition change that breaks the time series — treat it like a schema migration: review it, version it, annotate the dashboards at the cutover date so nobody reads a definitional jump as a real trend.

> **The professional reality:** the single most common reason a DORA rollout produces distrust is *uncontrolled definitions*. The fix is boring and decisive: one owned, versioned definitions document; the metric computed once from those definitions in one pipeline; and any change to them handled like a contract change. "Deployment" and "failure" meaning exactly one thing org-wide is worth more than any dashboard polish.

---

## Using DORA to Drive Improvement, Not Judgment

DORA's entire value is *diagnostic*: it tells a team which of its capabilities to work on next. The *Accelerate* research is explicit that the four keys are outcomes of underlying technical and cultural **capabilities** (trunk-based development, test automation, continuous integration, loosely coupled architecture, a generative culture). The keys are the thermometer; the capabilities are the medicine.

**The framing that works: "what capability would move our weakest key?"**

- *Lead time is high?* Decompose it (coding → review pickup → review → CI → deploy → wait). The dominant slice points at the capability: slow CI → test/build investment; long review pickup → WIP limits, smaller PRs, review SLAs; manual deploy steps → deployment automation. (This decomposition is exactly [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/professional.md)'s subject.)
- *Deploy frequency is low?* Usually batch size and manual gates. The capability is CI + trunk-based development + smaller changes — not "deploy more," which just games the count.
- *Change failure rate is high?* Test automation, smaller deploys, better pre-prod signal.
- *Time to restore is high?* Observability, fast rollback, feature flags, on-call readiness — restore the service, *then* fix forward.

**How teams should actually consume it:**

- **Team-owned dashboards.** The team that owns the service owns and reads its own four keys. They look at their *own trend* and ask "what's our constraint?"
- **A standing retro input.** The keys are a recurring agenda item in the team's retro — "lead time crept up this sprint, why?" — feeding their own improvement backlog. Improvement is *pulled* by the team, not *pushed* by a dashboard above them.
- **Aimed at the system, never the people.** The question is always "what in our *process* is slow/fragile?" — never "who is slow?" DORA is a measure of the delivery *system*; a high lead time is a property of the pipeline and the WIP and the review culture, not of an individual's effort.

> **The line you do not cross:** DORA must **never** be an executive leaderboard ranking teams against each other, and — this one is fatal — **never** a measure of individuals. The four keys are *team/system* outcomes; a single engineer has no "deployment frequency," and the moment you imply they do, you've invited gaming and destroyed the signal. The legitimate exec view is *aggregate trend and capability investment* ("are we getting faster and more stable over time, and where should we invest?"), not a ranked list of teams or names.

---

## The Political Failure Modes

DORA dies the same way everywhere: someone with authority turns it from a mirror the team holds up to itself into a stick someone holds over the team. Goodhart's law then does the rest — *"when a measure becomes a target, it ceases to be a good measure."* (This is the heart of [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/professional.md); here we trace the specific ways the four keys rot.)

**The gaming modes, by key:**

- **Deployment frequency → no-op deploys.** Target deploys-per-day and you'll get them: empty deploys, README-change deploys, artifact re-pushes, a pipeline that "deploys" nothing. The number soars; the actual flow of value doesn't move. You optimized a counter.
- **Lead time → branch-timestamp games.** Measure commit-to-prod and people commit late, or rebase to reset timestamps, or split work so the "real" commit lands just before deploy. The clock looks fast; the work wasn't.
- **Change failure rate → hidden failures and redefinition.** This is the most corrosive. Make CFR a target to *minimize* and the rational responses are: stop calling things incidents, fix in production quietly without a rollback record, lower the severity, or redefine "failure" so it excludes what just broke. **You haven't improved stability; you've blinded yourself to it** — and now your incident data is fiction too.
- **Time to restore → clock manipulation.** Mark incidents "resolved" before they are, start the clock at detection-minus-the-detection-lag, or close the ticket while the fix is still rolling out.

**The structural failure: tying DORA to performance reviews.** The instant the four keys feed compensation, promotion, or stack-ranking, three things happen, fast and irreversibly: (1) the numbers stop describing reality and start describing what people want their manager to see; (2) cross-team help collapses, because helping another team doesn't move *your* number; (3) trust between engineers and the metrics program evaporates — and once engineers believe the dashboard is a weapon, they manage the dashboard, not the system. **DORA tied to individual performance reviews is not a degraded program; it's a dead one.** You cannot un-ring that bell easily — the gaming behaviors and the distrust outlast the policy.

> **The professional discipline:** state, loudly and in writing, that the four keys are *for the teams' own improvement* and are *never* an input to performance management or inter-team ranking. Say it before the first dashboard ships, repeat it when an exec asks "so which team is best?", and *mean* it — because the first time a number is used to punish, every subsequent number is theater. The credibility of the entire program is spent the moment it's weaponized once.

---

## Pairing DORA with Value and Outcome Metrics

Here is the limitation that even careful DORA programs forget: **DORA measures delivery speed and stability — it says nothing about whether you built the right thing.** A team can be *Elite* on all four keys while shipping features nobody uses, at a flawless cadence, with perfect rollback hygiene, straight into irrelevance. Fast, stable delivery of the wrong product is still the wrong product, delivered impeccably.

This is the **McNamara fallacy** in miniature: optimizing the measurable (delivery throughput) while ignoring the thing that actually matters but is harder to measure (customer and business value). DORA is a *delivery* instrument, not a *value* instrument, and treating Elite DORA as "we're doing great" is a category error.

**The pairing.** DORA answers *"how well do we deliver?"* — you must pair it with metrics that answer *"are we delivering the right thing?"*:

- **Product/usage outcomes:** feature adoption, activation, retention, the metric the product bet was supposed to move.
- **Business outcomes:** revenue, conversion, churn, cost-to-serve — whatever your org's North Star is.
- **Customer outcomes:** NPS/CSAT, support ticket volume, task success.
- **Flow distribution** (from [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/professional.md)): *what kind* of work you ship — features vs defects vs debt vs risk. Elite delivery throughput that's 80% rework tells a very different story than 80% new value.

The healthy executive scorecard reads as a *pair*: "We deliver fast and safely (DORA) **and** that delivery is moving the outcomes we care about (product/business)." Either half alone misleads. DORA without outcomes optimizes the factory while ignoring whether anyone wants the product; outcomes without DORA can't tell you whether a flat metric is a delivery problem or a product-bet problem.

> **The principle:** DORA is necessary, not sufficient. It tells you your *delivery engine* is healthy — fast, stable, low-friction. It cannot tell you you're pointed in the right direction. Pair it with outcome metrics, or you'll build the ability to ship the wrong thing faster than anyone in the industry.

---

## Benchmarking Honestly

Every DORA rollout hits the same temptation: take the State of DevOps report's Elite/High/Medium/Low thresholds and grade your teams against them. **Resist it.** The published benchmarks are useful for *orientation* and *vocabulary*, and almost useless as a *grading rubric for your specific org* — because the definitions underneath the numbers aren't comparable to yours.

**Why cross-org benchmarking is definitionally broken:**

- **"Deployment" isn't the same event.** The survey aggregates orgs that variously count prod releases, merges, canaries, and per-service vs per-monolith deploys. Their "deploys per day" and yours are measuring subtly different things.
- **"Failure" isn't the same event.** One org's change failure rate counts any rollback; another counts only customer-facing SEV1s. The denominators and inclusion rules differ.
- **It's self-reported survey data**, clustered into bands — not instrumented telemetry with a fixed schema. The bands describe a *population's self-description*, not a precise measurement you can be ranked within.
- **Context dominates.** A regulated bank, a consumer SaaS, and an embedded-firmware shop have structurally different ceilings. "Elite" thresholds derived across all of them don't set a fair bar for any one.

**What to benchmark instead: yourself, over time.** The only comparison that's definitionally sound is *your own metric, computed your own consistent way, trending across months.* "Our lead time dropped from 9 days to 4 over two quarters after we invested in CI" is a true, actionable, defensible statement. "We're High, not Elite, per the report" is a comparison across incompatible definitions that invites the exact leaderboard thinking you're trying to avoid.

> **The professional reality:** use the State of DevOps clusters to *learn the shape* of the space (that throughput and stability move together, that elite teams refuse the trade) — not to *grade* your teams. **Your trend over time, on your own consistent definitions, is the only honest benchmark.** When an exec asks "are we Elite?", the right answer redirects to "we're 40% faster and 30% more stable than two quarters ago, and here's the capability we're investing in next" — a real claim, not a cross-org cosplay.

---

## The Exec Conversation — What DORA Can and Can't Promise

Sooner or later you brief a VP or a board, and how you frame DORA determines whether the program helps teams or gets turned into a stick. The job is to set expectations precisely: sell what DORA genuinely delivers, and refuse — clearly, up front — the things it can't, before someone assumes it can.

**What DORA *can* promise:**

- A research-backed, *system-level* read on **delivery speed and stability**, and whether they're improving over time.
- A **diagnostic** that points investment at the right capability (CI, test automation, deployment automation, architecture) instead of guessing.
- A shared, honest vocabulary for "are we getting faster and safer?" — replacing LOC, velocity, and commit-count theater.
- Early warning: a stability key sliding is a real signal that quality or operability is degrading.

**What DORA *cannot* promise — say this explicitly:**

- It is **not a productivity score for engineers.** It's a team/system measure; there is no per-person DORA, and asking for one breaks it.
- It does **not tell you if you're building the right thing.** That needs outcome metrics (pair them — see above).
- It is **not a cross-org or cross-team ranking.** The honest comparison is your own trend; grading teams against each other or against the report invites gaming.
- It will **not survive being tied to compensation or reviews.** Make this a stated condition of running the program, not a footnote.

> **The framing that protects the program:** "DORA gives us an honest, improving read on *how well we deliver* — fast and safe — and points us at what to fix next. It does *not* rank engineers, rank teams, or tell us if we picked the right features; for that we pair it with product outcomes. And it only stays honest if we keep it out of performance reviews." Deliver that on day one. The expectations you *don't* set are the ones that come back as a weaponized leaderboard six months later.

---

## War Stories

**The deployment-frequency OKR gamed with empty deploys.** A director, wanting to "be more like the Elite teams," set a quarterly OKR: every team raises deployment frequency by 50%. Within a sprint the number was climbing beautifully — and engineers had quietly added pipeline steps that re-deployed unchanged artifacts, shipped no-op README commits to prod, and split one release into five "deploys." Flow of actual value was flat; the counter wasn't. The metric became a target and instantly ceased to measure anything. The fix wasn't a better deploy-counter — it was deleting the OKR and reframing deployment frequency as a *team-owned diagnostic* with the capability ("smaller batches via trunk-based development") as the real goal.

**DORA on performance reviews destroying trust.** An org wired the four keys into individual performance dashboards — each engineer's name next to "their" lead time and change failure rate. The damage was fast and lasting: engineers stopped picking up risky-but-important work (bad for *their* CFR), stopped helping other teams (no credit for it in *their* numbers), and started logging incidents as "maintenance" to keep CFR down. Within a quarter the incident data was unreliable, cross-team collaboration had measurably dropped, and trust in the entire metrics program was gone. Leadership reversed the policy — but the gaming reflexes and the distrust outlasted the reversal by far. The lesson the org learned the hard way: **you can weaponize DORA exactly once; after that, every number is theater.**

**The team that found its review-latency bottleneck and genuinely improved.** A backend team owned its own DORA dashboard and made the four keys a standing retro item. Lead time was stubbornly high, so they decomposed it and found the dominant slice wasn't coding or CI — it was *review pickup*: PRs sat 30+ hours waiting for a first reviewer. No one was "slow"; the *system* had no review SLA and too much WIP. They responded with a capability change — a WIP limit, smaller PRs, a "review before you start new work" norm, and a team review-pickup target *they set for themselves*. Pickup latency fell from ~30 hours to under 4; lead time roughly halved over two months. Same metric, opposite outcome from the OKR story — because the team *pulled* the improvement and aimed it at the *process*, and no one above them turned the number into a stick.

---

## Decision Frameworks

**Build vs buy? Ask:**
- Do I want canonical definitions, cheap, and I'm on GCP? → **Google's Four Keys** (read the code; the numbers are trustworthy).
- Do I need org-wide breadth (DORA + flow + DevEx) fast and have budget? → a **platform** — but *disable or socially forbid the individual/leaderboard views*.
- Do I already have a warehouse and want total definitional control with no vendor leaderboard nudge? → **DIY** in dbt/SQL on a dashboard you run.
- The deciding axis is *who controls the definitions and whether the tool nudges toward judging people* — not the sticker price.

**Is this metric being used to improve or to judge? Ask:**
- Who reads it, and what can they *do* with it? Team reading its own trend to find a constraint → improvement. Exec ranking teams or an engineer's name next to a number → judgment. If judgment, stop.
- Is it tied to reviews/comp/promotion in any way? → if yes, it's already dead; sever the link before anything else.

**Should this go in front of an exec, and how? Ask:**
- Is it framed as *aggregate trend + capability investment* (safe) or *a ranked list of teams/people* (toxic)? → only present the former.
- Did I pair it with an outcome metric so "Elite delivery" can't be misread as "succeeding"? → if not, add one.

**Benchmark against what? Default to:**
- *Your own metric, your own consistent definition, your own trend over time.* Use the State of DevOps clusters for vocabulary and shape, never as a grading rubric.

**Are my definitions governed? Default to:**
- One owned, versioned definitions doc for "deployment," "failure," and the clocks; metric computed once from it; changes handled like a schema migration with dashboard annotations at the cutover.

---

## Mental Models

- **The keys are a thermometer; the capabilities are the medicine.** DORA tells you *which* number is bad; the *Accelerate* capabilities (CI, test automation, trunk-based dev, loose coupling, generative culture) are what you actually change. "What capability would move our weakest key?" is the only useful question.

- **A measure becomes a target → it stops measuring (Goodhart).** Every key has a gaming mode (no-op deploys, timestamp games, hidden failures, clock manipulation). The defense isn't a cleverer metric; it's keeping the metric a *diagnostic the team owns*, never a target imposed from above.

- **DORA is a delivery instrument, not a value instrument.** You can be Elite at shipping the wrong thing. Pair the four keys with product/business outcomes, or you'll perfect a factory that builds what nobody wants.

- **The honest benchmark is your own past.** Cross-org State of DevOps numbers rest on incompatible definitions and self-reported bands. "Faster and safer than last quarter, on our own consistent definitions" is the only defensible claim.

- **Weaponize it once and it's theater forever.** The moment a key feeds a review or ranks a person, the numbers describe what people want you to see, not reality — and the distrust outlives the policy. The program's credibility is spent on the first punishment.

---

## Common Mistakes

1. **Letting "deployment" and "failure" mean different things per team.** An org-wide dashboard built on uncontrolled definitions compares nonsense and loses credibility the first time someone notices. Fix: one owned, versioned definitions doc; metric computed once; changes governed like a schema migration.

2. **Computing the keys per-team instead of centrally.** Forty teams reimplementing DORA gives you forty incompatible numbers and a maintenance swamp. Instrument deploys and incidents once in the shared platform; teams *consume* dashboards, not reimplement metrics.

3. **Putting a key in an OKR or performance review.** This is the canonical kill shot — it converts the measure into a target (no-op deploys, hidden failures) and destroys trust. The keys are team-owned diagnostics, *never* targets imposed from above or inputs to comp.

4. **Building an exec leaderboard that ranks teams — or, fatally, individuals.** There is no per-person DORA; ranking teams invites gaming and cross-team hoarding. The only legitimate exec view is *aggregate trend + capability investment*.

5. **Reading Elite DORA as "we're succeeding."** DORA measures *how well you deliver*, not *whether you built the right thing*. Without paired outcome metrics, you optimize delivery of features nobody uses (the McNamara fallacy).

6. **Grading teams against the State of DevOps thresholds.** Those benchmarks rest on incompatible definitions and self-reported bands. Benchmark your own trend over time on your own consistent definitions; use the published clusters only for vocabulary.

7. **Buying a platform and leaving its individual views on.** Many tools default to per-developer and per-team comparisons — a loaded gun for the wrong manager. If you buy, you must actively disable, hide, or socially forbid those views as part of the rollout.

---

## Test Yourself

1. Of the four keys, which two are the hardest to instrument reliably across an org, and *why* (in terms of the data sources involved)?
2. Give the canonical definition you'd write down for "deployment" and for "change failure," and explain why CFR's denominator matters.
3. Compare Google's Four Keys, a commercial platform, and DIY for standing up DORA. What's the axis that matters more than cost?
4. A director sets "increase deployment frequency 50%" as a team OKR. Predict the specific gaming behavior and give the correct reframing.
5. Why is tying DORA to individual performance reviews described as *fatal* rather than merely *suboptimal*? Name the three things that happen.
6. A team is Elite on all four keys. Why might the business still be failing, and what must you pair DORA with?
7. An exec asks "are we Elite per the State of DevOps report?" Why is grading against that benchmark unsound, and what do you answer instead?

<details>
<summary>Answers</summary>

1. **Lead time for changes** and **change failure rate** — both are *joins across systems*, not single-system counts/subtractions. Lead time joins VCS (commit timestamp) to the deploy system (the deploy that shipped that commit); CFR joins the deploy system to the incident system (which deploy caused which failure). Deployment frequency is just a count and time-to-restore is a subtraction, so they're comparatively trivial. The join keys (commit SHA, service, environment, deploy ID) must be right on day one.
2. **Deployment:** a change reaching *production* and serving real traffic — not a staging push, a merge, a pod restart, or a re-deploy of an unchanged artifact (and for progressive delivery, pick first-canary or full-rollout and document it). **Change failure:** a deployment that results in *degraded service requiring remediation* (rollback, hotfix, incident) and is *caused by a change*. The **denominator is deployments, not incidents** — CFR is "what fraction of our deploys broke something," so a third-party outage with no deploy behind it isn't a change failure.
3. **Four Keys (OSS):** canonical definitions, cheap, GCP-shaped, you operate it. **Platform:** fast and broad (DORA + flow + DevEx) but \$\$ and often defaults to individual/team leaderboards. **DIY:** total definitional control in your warehouse, but you build the joins. The axis that matters more than cost: **who controls the definitions, and whether the tool nudges you toward judging people.**
4. Teams will hit the number with **no-op deploys** — empty/README commits, re-deploys of unchanged artifacts, one release split into five "deploys." Flow of value stays flat; the counter climbs. Reframe: delete the OKR; make deployment frequency a **team-owned diagnostic**, and target the *capability* (smaller batches via trunk-based development + CI), not the count.
5. Because it's irreversible and it kills the signal, not just dents it. Three things happen: (1) the numbers stop describing reality and start describing what people want their manager to see; (2) cross-team help collapses (helping doesn't move *your* number); (3) trust in the program evaporates — and the gaming reflexes and distrust outlast the policy reversal. You can weaponize DORA once; after that every number is theater.
6. DORA measures *delivery* speed and stability, not *whether you built the right thing* — the team can be shipping features nobody uses, flawlessly (the McNamara fallacy). Pair the four keys with **outcome metrics**: product/usage (adoption, retention), business (revenue, churn), customer (CSAT), and flow *distribution* (feature vs rework).
7. Cross-org benchmarking is definitionally broken: "deployment" and "failure" aren't the same events across orgs, it's self-reported survey data clustered into bands (not instrumented telemetry), and context (regulated vs consumer vs embedded) dominates the ceiling. Answer with **your own trend on your own consistent definitions**: "we're 40% faster and 30% more stable than two quarters ago, and here's the capability we're investing in next." Use the report's clusters for *shape and vocabulary*, never as a grading rubric.

</details>

---

## Cheat Sheet

```
THE PROGRAM (instrument centrally, compute once)
  deploy events    service, SHA, ts, env, ok/fail   → deploy freq, lead time
  incident events  service, start, restore, cause    → CFR, time to restore
  HARD JOINS: lead time = VCS⋈deploy ; CFR = deploy⋈incident
  platform owns the pipeline; teams CONSUME dashboards

BUILD vs BUY
  Four Keys (OSS)  canonical, cheap, GCP, you operate it
  Platform         fast + broad (flow/DevEx), $$, leaderboards ON by default → turn OFF
  DIY (warehouse)  total control, you build the joins
  axis that matters: who controls definitions + does it nudge toward judging people

DEFINITIONS GOVERNANCE (one meaning, org-wide)
  deployment = reaches PROD, real traffic (not merge/staging/restart/no-op)
  failure    = deploy causing remediation; denominator = DEPLOYS not incidents
  lead-time clock starts at COMMIT ; restore clock at DETECTION → restored
  versioned doc; change = schema migration + annotate dashboards

IMPROVE, NOT JUDGE
  team owns its own dashboard + reads its OWN trend
  standing retro input: "what CAPABILITY moves our weakest key?"
  NEVER: exec leaderboard of teams ; FATAL: per-individual DORA

GAMING MODES (Goodhart per key)
  deploy freq → no-op/empty deploys
  lead time   → commit-timestamp games
  CFR         → hide failures / redefine "incident"   (most corrosive)
  restore     → mark resolved early / clock games
  tie to reviews/comp → program is DEAD, distrust outlasts the policy

PAIR WITH OUTCOMES
  DORA = how well you DELIVER ; NOT whether you built the right thing
  pair: product (adoption/retention) + business (rev/churn) + flow distribution

BENCHMARK
  your OWN trend, your OWN definitions, over time
  State of DevOps bands = vocabulary/shape ONLY, never a grading rubric
```

---

## Summary

- A DORA program reduces to **two reliably-instrumented event streams** (deploys, incidents) and four numbers derived from them **the same way everywhere**. **Lead time and change failure rate are the hard ones** because they're *joins across systems* — get the event schema and join keys right on day one, and instrument **centrally** so teams consume one dashboard rather than reimplement forty.
- **Build vs buy** is real: Google's **Four Keys** (canonical, cheap), a **commercial platform** (fast, broad, but leaderboards-on-by-default — disable them), or **DIY** in your warehouse (total control, you build the joins). The axis that matters is **who controls the definitions and whether the tool nudges toward judging people**, not cost.
- **Definitions governance** is the unglamorous work that decides trust: one owned, versioned doc pinning "deployment," "failure," and the clocks; metric computed once from it; changes handled like a schema migration. "Deployment" and "failure" meaning *one thing* org-wide beats any dashboard polish.
- Use DORA to **drive improvement, not judgment**: team-owned dashboards, a standing retro input, "what capability would move our weakest key?" — aimed at the *system*, never the people. **Never an exec leaderboard, and — fatal — never a per-individual measure.**
- Know the **political failure modes**: every key has a gaming mode (no-op deploys, timestamp games, hidden/redefined failures, clock manipulation), and **tying DORA to performance reviews kills it** — the numbers go fictional, collaboration collapses, trust evaporates, and the damage outlasts the policy.
- **Pair DORA with outcome metrics** — it measures *how well you deliver*, never *whether you built the right thing* (the McNamara fallacy); a team can be Elite at shipping the wrong features. And **benchmark honestly**: your own trend on your own definitions, never the cross-org State of DevOps thresholds.

You can now roll DORA out as an org-wide program that accelerates teams instead of teaching them to lie to you. The remaining tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone truly understands the four keys and the politics around them.

---

## Further Reading

- **Forsgren, Humble & Kim — *Accelerate*** and the annual **State of DevOps / DORA reports** — the four keys, the performance clusters, and (crucially) the *capabilities* that drive them.
- [Google Cloud — Four Keys (open-source reference implementation)](https://github.com/dora-team/fourkeys) — the canonical definitions made concrete, plus ingestion patterns for VCS/CI/incident webhooks.
- **The DORA Quick Check and capability catalog** (dora.dev) — the diagnostic framing of "which capability to invest in next."
- **Goodhart's law and Campbell's law** — the theory behind every gaming mode in this page; see [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/professional.md).
- **The McNamara fallacy** — why optimizing the measurable (delivery) while ignoring the harder-to-measure (value) misleads.
- **Vendor docs and critiques** of LinearB / Sleuth / Faros / DX / Jellyfish — read them *with* the individual-leaderboard risk in mind, not just the feature list.

---

## Related Topics

- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/professional.md) — the full treatment of how metrics rot: Goodhart, measuring individuals, vanity and weaponized metrics, the McNamara fallacy.
- [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/professional.md) — flow distribution (feature vs rework) and value-stream mapping, the natural pairing that tells you *what kind* of work your Elite delivery is shipping.
- [junior.md](junior.md) — what the four keys are, in plain terms.
- [senior.md](senior.md) — precise definitions, the throughput/stability pairing, the Elite→Low clusters, and the *Accelerate* capability model.
- [interview.md](interview.md) — the questions that probe real understanding of the keys and the politics.
