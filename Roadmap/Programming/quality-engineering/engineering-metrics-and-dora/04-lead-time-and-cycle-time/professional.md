# Lead Time & Cycle Time — Professional Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Lead Time & Cycle Time
> *The senior page taught you to decompose the pipeline and read percentiles. This page is about running delivery on those numbers at org scale — replacing story-point roadmaps with probabilistic forecasts, hunting the bottleneck that's almost always a queue between two teams, and surviving the political reality that the answer to "go faster" is "start fewer things," which nobody wants to hear.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Replacing Estimation with Cycle-Time Forecasting](#replacing-estimation-with-cycle-time-forecasting)
4. [Attacking the Org-Wide Bottleneck](#attacking-the-org-wide-bottleneck)
5. [Improvement, Not Judgment — The Scatterplot in the Retro](#improvement-not-judgment--the-scatterplot-in-the-retro)
6. [The Change-Management Reality — WIP and Batch Size](#the-change-management-reality--wip-and-batch-size)
7. [Instrumentation and Data Hygiene at Scale](#instrumentation-and-data-hygiene-at-scale)
8. [Tying Lead-Time Improvement to Business Value](#tying-lead-time-improvement-to-business-value)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Using lead and cycle time to run delivery, set stakeholder expectations, and drive improvement across many teams — where the numbers stop describing your pipeline and start changing how the org plans, commits, and behaves.**

The senior page framed lead/cycle time as a diagnostic: decompose the pipeline, find the slow stage, read the 85th percentile instead of the mean. At the professional level those same numbers leave the engineering retro and walk into the rooms where commitments are made — the quarterly planning meeting, the stakeholder update, the "when will it ship?" conversation with a customer on the line.

That changes everything. A cycle-time *distribution* is no longer just a chart; it's a forecasting instrument that can replace story-point estimation with "85% confidence we ship by March 14." A bottleneck is no longer a slow stage; it's usually a *queue between two teams* — review-pickup latency, a deploy gate, a hand-off to a platform team — and attacking it means changing other people's process, not your own. And the moment a cycle-time number gets attached to a team's name on a slide, [Goodhart's law](../06-metrics-anti-patterns-and-goodhart/professional.md) starts pulling: the metric becomes a target, the target gets gamed, and you've taught the org to lie to you.

This page is the pragmatic layer: how to forecast with cycle time and earn stakeholder trust, how to find and kill the org-wide bottleneck, how to use the data for improvement without it curdling into judgment, and how to win the change-management fight that lead-time reduction always turns out to be.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — pipeline decomposition (coding/pickup/review/CI/deploy/wait), percentiles vs means, the flow-efficiency calculation.
- **Required:** You've owned delivery for a team — run planning, made a commitment to a stakeholder, and missed one.
- **Helpful:** You've watched a metric get weaponized and seen the behaviour it produced.
- **Helpful:** You've read enough of [DORA's lead time for changes](../01-dora-four-key-metrics/professional.md) to know it measures a narrower window (commit→deploy) than the business "idea→live" lead time.

---

## Replacing Estimation with Cycle-Time Forecasting

The single highest-leverage professional move is to stop *estimating* delivery and start *forecasting* it from your own historical cycle time.

Story-point estimation asks engineers to predict the future by sizing work that hasn't been understood yet. It's slow (estimation meetings), inaccurate (points don't map to time, and everyone knows it), and it produces a single-number commitment — "12 sprints" — that carries no honesty about uncertainty. The result is the planning theatre every senior engineer recognizes: precise-looking dates that are wrong, padded silently, and missed predictably.

**Cycle-time forecasting** inverts this. Instead of asking "how big is this work?", it asks "given how fast we *actually* finish items, and how many items remain, when will we be done?" The two inputs are empirical:

1. Your historical **cycle-time distribution** (or throughput — items completed per week).
2. The number of items remaining (a count, not an estimate of size).

The output is a **probabilistic forecast**, not a date: *"50% chance by Feb 20, 85% by March 14, 95% by April 2."* You commit at a confidence level the business chooses, and you're explicit that earlier dates are bets, later ones are near-certain.

### Monte Carlo: the workhorse

The mechanism is a Monte Carlo simulation, and it's almost embarrassingly simple:

```
INPUT:  history = throughput per week for the last ~10–12 weeks, e.g. [6, 9, 4, 7, 11, 5, 8, 6, 10, 7]
        remaining = 80 items
RUN 10,000 trials:
    days = 0
    todo = remaining
    while todo > 0:
        sample a week's throughput at random from history   # resample with replacement
        todo -= that throughput
        days += 7
    record days
OUTPUT: the distribution of "days" across 10,000 trials
        → 50th percentile, 85th percentile, 95th percentile
```

That's it. You resample your *own* recent throughput thousands of times to build a distribution of completion dates. No story points, no velocity averaging, no estimation meeting. It naturally captures your variability: a team with erratic throughput gets a wider forecast (the 50→95 spread is large), which is *honest* — erratic teams genuinely can't promise tight dates, and the forecast says so out loud.

A throughput-based Monte Carlo needs only a *count* of remaining items, so you can forecast before anything is sized. A cycle-time-based variant (sample per-item cycle times, sum until done) is equivalent and useful when item-level data is cleaner than weekly counts.

### Service Level Expectations (SLEs)

The same distribution gives you an **SLE** — a forecast for a *single* item: "we complete 85% of stories within 9 days of starting them." That's not an SLA you'll be punished for; it's a published expectation derived from data, and it does two things. It sets stakeholder expectations without per-item estimation ("most things take about a week and a half"), and it becomes an *exception trigger*: an item past its 85th-percentile age is, statistically, stuck — surface it on the board and intervene, rather than discovering it in standup three days later.

### The credibility this buys

This is the part that matters at org scale. The first time you tell a skeptical stakeholder "85% confidence by March 14" *and then hit it*, something shifts. You've replaced a number they'd learned to distrust (the padded estimate) with one that came true. Do it twice and you've bought a currency that's scarce between engineering and the business: **calibrated trust**. Stakeholders stop demanding date-certainty they know is fake and start working with confidence ranges, because the ranges are honest and they hold.

It's worth being precise about what this is and isn't. It is *not* "no estimates" as a slogan — you still scope, slice, and sequence work; you've just stopped pretending point-sizing predicts dates. It's a shift from *estimating effort* to *forecasting flow*, and it only works if your cycle-time data is clean (see [data hygiene](#instrumentation-and-data-hygiene-at-scale)) and your work is sliced small enough that item *count* is a reasonable unit — which, conveniently, is the same discipline that reduces lead time anyway.

> **The professional reality:** the resistance to forecasting is rarely technical — the math is a twenty-line script. It's that estimation feels like control and forecasting feels like admitting you can't predict the future precisely. The reframe that wins the room: *you were never predicting it precisely; you were just hiding the uncertainty. This shows it — and turns out to be more accurate.*

---

## Attacking the Org-Wide Bottleneck

When you aggregate cycle-time decomposition across many teams, the data tells a remarkably consistent story, and it's almost never the one people expect. Engineers assume the slow part is *coding*. The data says coding is usually a minority of total lead time. The dominant costs are **wait states** — work sitting in a queue, owned by no one, between two stages:

- **Review-pickup latency** — the gap between "PR opened" and "someone starts reviewing." This is, across a huge range of orgs, the single largest controllable chunk of cycle time. A PR that takes 30 minutes to review can sit *eight hours* waiting to be picked up.
- **Deploy queues / release gates** — work that's merged but waiting: a batched release train, a manual change-approval board, an environment held by another team's test run.
- **Cross-team hand-offs** — "blocked on platform," "waiting on the API team," "needs a DBA." Every hand-off is a queue with a context-switch tax on both sides.

The professional skill is to *use the aggregated data to locate the org's bottleneck and attack it where it actually is*, not where intuition points. This is Theory-of-Constraints thinking: there is one dominant constraint at a time, and optimizing anything other than the constraint is wasted effort (worse — speeding up an upstream stage just makes the queue at the constraint *longer*).

### The three highest-yield interventions

**1. Review SLAs.** If review-pickup latency dominates (it usually does), set an explicit expectation: *PRs get a first review within N hours during working hours.* Back it with mechanics, not exhortation — review rotations or a "review duty" role, auto-assignment, a bot that pings stale PRs, WIP limits that force finishing reviews before opening new work, smaller PRs (which get reviewed faster, a virtuous loop). Then *measure pickup latency before and after* — this is the intervention with the best ROI in most orgs, and it's measurable within two weeks.

**2. Automate the deploy path.** If the queue is between "merged" and "live" — manual approvals, batched releases, change-advisory boards — the fix is [continuous delivery](../01-dora-four-key-metrics/professional.md): automated deployment, trunk-based flow, small frequent releases. A manual deploy gate doesn't just add its own duration; it forces *batching* (you save up changes for the release), which inflates batch size, which (next section) inflates everything.

**3. Reduce hand-offs.** Every cross-team hand-off is a queue. The structural fixes are organizational: cross-functional teams that own a slice end-to-end, embedding the scarce specialist (DBA, security, SRE) into the team or replacing the hand-off with self-service (a paved-road platform the team can use without filing a ticket). This is the hardest and highest-leverage, because it's [Conway's-law](../03-space-framework/professional.md) work — you're changing the org chart, not the process.

> **The principle:** *measure the queues, not the work.* Active time (coding, reviewing, deploying) is usually a fraction of lead time; the rest is items waiting in queues between stages. Flow efficiency — active ÷ total — is often 15% or less, which means **85% of your lead time is pure waiting that no amount of "code faster" touches.** Find the biggest queue, attack it, re-measure, repeat. The constraint moves when you fix one; chase it.

---

## Improvement, Not Judgment — The Scatterplot in the Retro

Here is the line that, crossed, turns a healthy metric into a corrosive one: **cycle time is a tool for a team to improve its own system, never a tool to compare teams or rank individuals.**

The right use is intimate and team-owned. The instrument is the **cycle-time scatterplot**: every completed item plotted by completion date (x) against cycle time in days (y), with percentile lines overlaid. The team pulls it up *in their own retro* and asks generative questions:

- "What were these three dots way up high — the items that took four weeks? What happened?" (Usually: a hand-off, a reopened ticket, an item that should've been split.)
- "Our 85th percentile crept from 9 to 14 days this month — what changed?"
- "These clustered low — what made them flow? Can we do more of that?"

The scatterplot is diagnostic and *owned by the people who can act on it*. It drives experiments ("let's try a review rotation for two weeks and watch the pickup latency") and the team judges itself against its own past, which is the only fair comparison.

### Why you must never compare teams' raw cycle time

The instinct — "let's put every team's cycle time on a dashboard and see who's fastest" — is one of the most common and most damaging metric mistakes, for reasons that are *structural*, not motivational:

- **The work is incomparable.** A team doing greenfield CRUD has a fundamentally different cycle-time distribution than a team doing gnarly migrations in a 15-year-old monolith with a mandatory security review. Ranking them by cycle time ranks their *work*, not their *performance*, and punishes the team with the harder problem.
- **It's trivially gamed.** Tell a team their cycle time is being compared and watch it drop — by slicing tickets into meaninglessly tiny pieces (cycle time per ticket plummets, nothing ships faster), by gaming the start point (don't move the ticket to "In Progress" until you're nearly done), by quietly skipping review. You optimized the number and degraded the system. This is [Goodhart's law](../06-metrics-anti-patterns-and-goodhart/professional.md) in its purest form.
- **It destroys the data.** The instant a metric is used to judge, the people generating it start managing the metric instead of doing the work honestly. Your cycle-time data — the thing you needed for forecasting and improvement — becomes fiction. You've burned the instrument to read it once.

Ranking *individuals* by cycle time is worse on every axis: software is collaborative, individual cycle time is noise, and the behaviour it incentivizes (hoard work, avoid the hard tickets, skip helping teammates) is exactly backwards from what makes a team fast.

> **The non-negotiable rule:** present cycle time to the team that owns it, for that team's own learning, compared to that team's own history. Aggregate *trends* (is the org's flow improving?) are fine for leadership; *rankings* and *individual* numbers are not. The test: would showing this number to this audience make someone want to game it? If yes, you're about to break your own data.

---

## The Change-Management Reality — WIP and Batch Size

Now the uncomfortable truth, because it's the one that determines whether any of this actually moves the needle. The most effective levers for reducing lead time are **limiting work-in-progress (WIP)** and **reducing batch size** — and both fight the deepest instinct in most organizations: *start more things.*

The math is **Little's Law**, and it is not negotiable:

```
Average Cycle Time = Average WIP / Average Throughput
```

Read it carefully. For a given throughput (how fast the team actually finishes things), cycle time is *directly proportional to WIP*. Double the number of items in flight and you double how long each one takes — without finishing one extra thing. More work-in-progress doesn't mean more gets done; it means everything in flight takes longer, because each item spends more of its life waiting behind the others while people context-switch between them.

So the single most reliable way to reduce cycle time is to **start fewer things and finish them**. Stop starting, start finishing. Lower WIP, and Little's Law drops cycle time mechanically.

**Batch size** is the same disease in another organ. A big-bang release (three months of changes shipped at once) has a *long* lead time by construction, a huge blast radius when it breaks, and a brutal debugging session ("which of these 200 changes did it?"). Small batches — trunk-based development, feature flags, continuous deployment — slash lead time, shrink the blast radius, and make every failure trivially bisectable. Smaller is faster *and* safer, which sounds too good to be true and isn't.

### Why this is a cultural fight, not a technical one

Every fibre of organizational instinct resists this:

- **Starting feels like progress; finishing is invisible.** Executives see "we kicked off 12 initiatives" as momentum. Starting work generates the *feeling* of productivity while generating none of the *output*. Saying "we're going to start fewer things" sounds, to a stakeholder, like "we're going to do less" — when it means the opposite.
- **High utilization feels efficient and is the enemy of flow.** A manager who sees an idle engineer feels they're wasting money, so they assign more work — raising WIP, raising cycle time. But a system run at 100% utilization has *infinite* queue times (this is queuing theory, not opinion — wait time explodes as utilization approaches 100%). Slack is what lets work *flow*; a fully-loaded system is a gridlocked one.
- **Every stakeholder wants *their* thing started now.** WIP limits mean telling someone "no, not yet" — and that's a political act. The pushback ("are you saying my project waits?") is why WIP limits are abandoned more often than any other practice that works.

The change-management lift is therefore mostly *re-educating the people who fund and prioritize the work* — using the cycle-time data and Little's Law as the evidence. You're not asking for trust; you're showing the scatterplot: "every time WIP spiked here, cycle time spiked here two weeks later. Lower WIP, faster delivery. The data, not my opinion."

> **The professional reality:** the engineering fixes (CI, feature flags, smaller PRs) are the *easy* half. The hard half is the conversation where you tell leadership that "go faster" means "start fewer things," that a busy team is a slow team, and that the fix for missed dates is *less* work in flight, not more pressure. Win that conversation with data, or the metrics change nothing.

---

## Instrumentation and Data Hygiene at Scale

Everything above — forecasting, bottleneck-hunting, scatterplots — is only as trustworthy as the data underneath, and at org scale the data is *messy by default*. The professional job is as much data engineering as it is delivery management.

### The tooling landscape

You graduate from a hand-built spreadsheet to instrumentation:

- **Engineering-analytics platforms** (LinearB, Swarmia, Jellyfish, Code Climate Velocity, Haystack, Sleuth, and the DORA-focused tools) pull from Git, the issue tracker, and CI/CD to compute cycle time, its decomposition, and DORA metrics automatically. They're worth it at scale because manually maintaining accurate flow data across dozens of teams is a full-time job.
- **Build-it-yourself** off the source systems' APIs (GitHub/GitLab events, Jira changelog, deployment events) into a warehouse, when you need custom stage definitions or want to own the data. More control, more maintenance.

The platform is the easy decision. The hard part is the data feeding it.

### The data-quality problems that wreck the numbers

**Inconsistent stage definitions.** If Team A's "In Progress" means "I've started coding" and Team B's means "it's in the backlog and assigned," their cycle times are measuring different things and *cannot* be aggregated or compared. The most important and least glamorous work is forcing **consistent, documented workflow-state definitions** across teams: exactly when does the clock start (first commit? moved to In Progress? sprint start?), exactly what counts as "done" (merged? deployed? released?). Without this shared definition, every downstream number is noise dressed as signal.

**Status bounces and reopened tickets.** Real workflows are not clean left-to-right marches. Tickets get reopened, bounced back from review to In Progress, moved to Blocked and back, pulled into a sprint and dropped. Each bounce wreaks havoc on naive cycle-time calculation:

- A ticket reopened after being "done" — does its cycle time include the gap before reopening? (It shouldn't, usually — but naive tooling counts wall-clock from first-start to final-done and reports a 40-day cycle time for an item that was actively worked for 4.)
- A ticket that sat in "Blocked" for two weeks — is that wait counted? (For *lead* time, yes; for *active* time, no — and conflating them hides the bottleneck.)
- A ticket dragged straight from "To Do" to "Done" in one jump — zero cycle time, which is fake.

These produce the classic symptoms: a long tail of impossibly-large cycle times (reopened/bounced items), a spike of near-zero ones (skipped states), and bimodal distributions that are *artifacts of the tracker*, not the work. You learn to spot them and to clean them — clamp or exclude obvious outliers with documented rules, decide explicitly how reopens and blocks are handled, and validate the distribution against reality ("does a 60-day item match a real story? or is it a ticket someone forgot to close?").

> **The discipline:** treat your flow data like any production dataset — with a schema (documented states), validation (outlier and bounce detection), and a definition of "clean." A cycle-time number computed from inconsistent states and uncleaned bounces is worse than no number: it's a confident lie that people will plan against. Garbage in, *confident* garbage out.

---

## Tying Lead-Time Improvement to Business Value

Reducing lead time is not a vanity engineering goal; it's a business lever, and the professional must be able to say *why* in the language of the people who fund the work. The chain is direct:

- **Faster feedback → less waste.** A short idea-to-live lead time means you learn whether a feature works *quickly*. Long lead time means you build for months before reality touches the work, and you discover the bad bets late, having spent the most. Short lead time is *cheaper learning* — the core economic argument for flow.
- **Faster time-to-market → competitive advantage.** The team that ships a response to a market shift in days beats the one that ships in quarters. Lead time *is* responsiveness, and responsiveness is the business case.
- **Smaller blast radius → lower risk.** Small batches (the same lever that cuts lead time) mean each change is small, isolated, and easily reverted. Lead-time reduction and *stability* improve together — directly refuting the "go fast and break things, or go slow and be safe" false trade-off that [Accelerate](../01-dora-four-key-metrics/professional.md) demolished. Elite performers are faster *and* more stable, and small-batch flow is why.
- **Predictability → trust and better decisions.** A team with a tight, well-understood cycle-time distribution can be *forecast* (the SLE/Monte Carlo machinery), which lets the business plan, sequence, and commit with confidence. Predictability is itself a deliverable.

> **The reframe for the executive room:** lead time isn't an engineering hygiene metric — it's the speed of your build-measure-learn loop and the size of your failure blast radius. Cutting it makes the company learn faster, respond faster, fail smaller, and plan more honestly. That's the sentence that gets the WIP-limit and deploy-automation work funded.

---

## War Stories

**The Monte Carlo forecast that beat story points and rebuilt trust.** A platform team had burned its credibility with the business — quarter after quarter of point-based roadmaps that slipped, with the now-ritual "engineering is always late" eye-roll in planning. The new lead quietly stopped estimating and ran a Monte Carlo on the team's last 12 weeks of throughput against the backlog: *"50% by Feb 20, 85% by March 14."* They committed publicly to the 85% date and explained the confidence framing. They shipped on March 11. Next quarter the business *asked* for the confidence ranges instead of demanding single dates, and the planning meeting stopped being a negotiation about padding. The forecast didn't just predict better — it changed the relationship. The lesson: a probabilistic forecast that comes true is worth a hundred precise estimates that don't.

**The review SLA that halved lead time.** A team measured its cycle-time decomposition and found the result that surprises everyone the first time: coding was ~20% of lead time; *review-pickup latency* — PRs sitting open before anyone looked — was the largest single chunk, averaging over a day. No code got faster; PRs just *waited*. They introduced a review rotation (a daily "review duty" owner), auto-assignment, and a bot nagging PRs idle past four working hours, and they shrank PRs to make review fast. Median lead time roughly halved in a month — entirely by draining a queue, with zero change to how fast anyone wrote code. The lesson: the bottleneck is almost never where engineers assume; measure the queues, attack the biggest, re-measure.

**The cycle-time leaderboard that backfired.** A director, delighted to finally have flow data, built a dashboard ranking eight teams by average cycle time and reviewed it monthly with team leads. Within two months the rankings improved beautifully — and delivery didn't change at all. The teams had learned the game: split tickets into trivially small pieces (cycle time per ticket cratered, nothing shipped faster), delay moving tickets to "In Progress" until nearly done (gaming the start clock), and quietly cut review corners on low-risk changes (faster cycle time, latent risk). One team with genuinely hard migration work looked permanently "slow" and morale tanked. The data became fiction; the forecasting capability it could have powered was gone. They killed the leaderboard and moved cycle time *into each team's own retro* — and over the next quarter the real numbers, now honest again, actually started to move. The lesson: the moment you rank teams by cycle time, you stop measuring delivery and start measuring their ability to game you — and you destroy the data in the process.

**The WIP limit nobody wanted and everybody needed.** A team drowning in missed dates was running 25+ items in flight for eight engineers. The lead proposed a WIP limit of 10 and was met with "but then most of our projects are *waiting*." They held the line for a month and tracked it: cycle time dropped sharply, throughput *rose* (less context-switching, fewer half-finished things rotting), and — the part that converted the skeptics — *more* shipped, not less. Little's Law had been quietly taxing them the whole time. The lesson: "start fewer things" feels like doing less and is the most reliable way to deliver more; you win the argument with the before/after data, not the theory.

---

## Decision Frameworks

**Should we forecast or estimate? Ask:**
- Do we have ~8–12 weeks of reasonably clean throughput/cycle-time history? → forecast with Monte Carlo; the data is more honest than estimates.
- Is the work sliced small enough that *item count* is a sane unit? → yes → throughput forecasting works directly. No → slice smaller first (which helps lead time anyway).
- Does the stakeholder need a single date or can they work with confidence ranges? → push for ranges; commit at the 85th percentile if a hard date is required.
- Is this genuinely novel work with no historical analog? → estimation has a role for the *first* iteration; switch to forecasting as soon as you have flow data.

**Where is the bottleneck — what do I attack? Decompose lead time, then:**
- Is review-pickup latency the biggest chunk? → review SLA + rotation + smaller PRs (usually the answer, best ROI).
- Is the queue between merged and live? → automate the deploy path; kill manual gates and batched releases.
- Is it cross-team hand-offs ("blocked on X team")? → reduce hand-offs: embed the specialist, build self-service, or restructure ownership (Conway's law).
- Is coding *actually* the biggest chunk? → rare; check for oversized items, unclear requirements, or a missing test/CI safety net before assuming "we need to type faster."

**Is it safe to show this number to this audience? Ask:**
- Is it being compared *across teams* or used to rank *individuals*? → stop; you'll get gaming and destroy the data.
- Is it this team's own scatterplot, in this team's own retro, vs its own history? → safe and useful.
- Is it an aggregate *trend* for leadership (is the org's flow improving)? → fine, as a trend, never as a ranking.
- Would seeing it make someone want to game it? → if yes, you're about to break your own instrument.

**How do I reduce lead time? In priority order:**
- Limit WIP (Little's Law: cycle time ∝ WIP) — the highest-leverage, hardest-culturally lever.
- Reduce batch size (small PRs, trunk-based, feature flags, frequent deploys) — faster *and* safer.
- Drain the biggest queue (review SLA, deploy automation, fewer hand-offs).
- *Then*, far down the list, the "code faster" interventions everyone reaches for first.

---

## Mental Models

- **Forecast flow, don't estimate effort.** You were never predicting dates precisely — you were hiding the uncertainty inside a padded point estimate. Monte Carlo on your own throughput shows the uncertainty honestly *and* predicts better. "85% by March 14" beats "12 sprints" because it's true.

- **Measure the queues, not the work.** Active time is usually a fraction of lead time; the rest is items waiting in queues between stages. Flow efficiency is often ≤15%. The bottleneck is a queue (review pickup, deploy gate, hand-off), almost never the coding.

- **Cycle time is a mirror for a team, a weapon against it.** Shown to the team that owns it, against its own history, it drives improvement. Used to rank teams or individuals, it produces gaming and burns the data. Same number, opposite outcomes — the difference is the audience and the intent.

- **Little's Law is not negotiable: cycle time ∝ WIP.** For a fixed throughput, more work-in-progress means everything takes proportionally longer, with *nothing* extra finished. "Stop starting, start finishing" is the most reliable lead-time lever there is.

- **A busy system is a slow system.** Queuing theory: wait times explode as utilization approaches 100%. Slack is what lets work flow. The idle-looking engineer isn't waste; the fully-loaded team is gridlock.

- **Smaller is faster *and* safer.** Small batches cut lead time, shrink blast radius, and make failures bisectable. The "fast vs safe" trade-off is false — small-batch flow gives you both, which is why elite performers lead on speed and stability simultaneously.

---

## Common Mistakes

1. **Clinging to story-point estimation when you have flow data.** Points don't map to time, the meetings are expensive, and the single-number commitment is a lie of false precision. Forecast from throughput; commit at a confidence level. The math is a twenty-line script.

2. **Optimizing the wrong stage.** Engineers attack coding speed because that's what they control; the data says the bottleneck is review pickup or a deploy queue. Speeding up a non-constraint just lengthens the queue at the real constraint. Decompose first, attack the biggest queue.

3. **Comparing teams' raw cycle time or ranking individuals.** The work is incomparable, it's trivially gamed (tiny tickets, late "In Progress," skipped review), and the act of ranking destroys the honesty of the data. Team-owned scatterplots vs own history only.

4. **Treating lead-time reduction as a tooling problem and ducking the WIP fight.** CI and feature flags are the easy half. If you don't win the "start fewer things, a busy team is a slow team" conversation with leadership — using Little's Law and your own before/after data — the metrics change nothing.

5. **Forecasting on dirty data.** Inconsistent stage definitions across teams, uncleaned reopens and status bounces, and skipped states produce a confident lie. Document when the clock starts and stops, detect and handle outliers/bounces, validate against reality *before* you forecast against the numbers.

6. **Reporting means instead of percentiles.** A mean cycle time is dragged around by the long tail and answers no useful question. The 85th percentile ("85% of items finish within N days") is what you forecast, set SLEs from, and communicate. (Carried up from senior — it's the foundation everything here stands on.)

7. **Confusing high utilization with efficiency.** Loading every engineer to 100% feels efficient and guarantees long queues (utilization → 100% means wait time → ∞). Slack enables flow. The manager who assigns work to the idle engineer is raising WIP and slowing delivery.

---

## Test Yourself

1. A stakeholder wants a single delivery date for 80 remaining items. You have 12 weeks of throughput history. Walk through how you'd produce a *forecast* instead, what you'd commit to, and why that's more trustworthy than a point-based estimate.
2. Explain Little's Law and use it to justify a WIP limit to a skeptical manager who believes the team should "start more projects to get more done."
3. You decompose lead time across the org and coding is only ~20% of it. Name the three wait states that usually dominate, and the highest-ROI intervention for each.
4. A director proposes a dashboard ranking teams by average cycle time. Give three concrete reasons this backfires, and what you'd do with cycle time instead.
5. Two teams report wildly different cycle times. Before concluding anything about performance, what data-quality questions must you ask?
6. A naive tool reports a 45-day cycle time for an item that was actively worked for 3 days. What probably happened, and how should the calculation handle it?
7. Make the business case for cutting lead time to a CFO who sees it as "engineering wanting to move fast." Tie it to money and risk.

<details>
<summary>Answers</summary>

1. Run a **Monte Carlo**: resample the 12 weeks of throughput thousands of times, subtracting from 80 until done, to build a distribution of completion dates; report percentiles ("50% by X, 85% by Y, 95% by Z"). Commit at the **85th percentile** if a hard date is required, explicitly framed as confidence. It's more trustworthy because it's derived from how the team *actually* delivers (not a guess about size), it surfaces uncertainty honestly via the range, and — empirically — it predicts better than padded point estimates. The first time it comes true, it buys calibrated trust.
2. **Cycle Time = WIP / Throughput.** For a fixed throughput, cycle time is directly proportional to WIP — doubling items in flight doubles how long each takes, with nothing extra finished, because items wait behind each other and people context-switch. So a WIP limit *reduces* cycle time (and usually *raises* throughput by cutting context-switching). "Start more projects" raises WIP, lengthens cycle time, and finishes no more — it feels like progress but produces none. Show the before/after data.
3. **Review-pickup latency** → review SLA + rotation/auto-assignment + smaller PRs (best ROI). **Deploy queues / release gates** → automate the deploy path, trunk-based, small frequent releases, kill manual gates. **Cross-team hand-offs** → embed the specialist, build self-service, restructure ownership (Conway's law). Measure each before/after.
4. (a) The **work is incomparable** — different teams do different difficulty work; you'd rank their problems, not their performance, and punish the hard-problem team. (b) It's **trivially gamed** — tiny tickets, delayed "In Progress," skipped review all drop the number without shipping anything faster (Goodhart). (c) Ranking **destroys the data** — people manage the metric instead of working honestly, so it becomes fiction and you lose it for forecasting. Instead: team-owned scatterplots in retros, vs own history; aggregate *trends* for leadership, never rankings.
5. Do they use the **same workflow-state definitions** (when does the clock start — first commit? In Progress? — and when is it "done" — merged? deployed?)? Are **reopens, blocks, and status bounces** handled the same way? Are **outliers** (forgotten-open tickets, skipped states) cleaned consistently? Different cycle times across teams usually reflect different *measurement*, not different performance — you cannot compare until the definitions and cleaning match (and even then, see Q4).
6. The item was almost certainly **reopened, bounced back from review, or sat in "Blocked,"** and a naive tool counted wall-clock from first-start to final-done — including the dead time. Handle it by defining explicit rules: exclude or clamp time spent in Blocked/reopened states for *active* cycle time, decide consistently whether reopens reset or extend the clock, and validate the distribution's long tail against real items before trusting it.
7. Lead time is the **speed of the build-measure-learn loop** and the **size of the failure blast radius**. Short lead time = cheaper learning (you find bad bets early, having spent less), faster time-to-market (responsiveness = competitive advantage), and — via small batches — *smaller, safer, easily-reverted* changes (lower risk, not higher). It's not "move fast and break things"; small-batch flow makes delivery faster *and* more stable simultaneously. Cutting lead time makes the company learn faster, respond faster, fail smaller, and plan more honestly — that's money and risk, not engineering vanity.

</details>

---

## Cheat Sheet

```
FORECAST, DON'T ESTIMATE
  Monte Carlo: resample recent throughput → distribution of dates
    INPUT: throughput history + remaining item COUNT (no sizing)
    OUTPUT: 50% / 85% / 95% completion dates → commit at 85th
  SLE: "85% of items finish within N days" (single-item forecast + exception trigger)
  WHY: honest uncertainty, predicts better, buys calibrated trust when it holds

THE BOTTLENECK (measure the QUEUES, not the work)
  flow efficiency = active / total → often <=15% (85% is waiting)
  usual culprits, by ROI:
    review-pickup latency  → review SLA + rotation + smaller PRs   (best ROI)
    deploy queue / gate    → automate deploy, trunk-based, small releases
    cross-team hand-off    → embed specialist / self-service / restructure
  Theory of Constraints: optimize the constraint ONLY; chase it when it moves

IMPROVEMENT, NOT JUDGMENT
  team-owned scatterplot (date x cycle-time, percentile lines) IN THE RETRO
  vs OWN history only
  NEVER: rank teams by raw cycle time | rank individuals  → gaming + dead data
  TEST: would this audience want to game this number? yes → don't show it

LITTLE'S LAW (not negotiable)
  Cycle Time = WIP / Throughput     → cycle time ∝ WIP
  reduce lead time, in priority order:
    1. limit WIP        ("stop starting, start finishing")  ← hardest culturally
    2. shrink batch size (small PRs, trunk, flags, frequent deploy) faster+safer
    3. drain biggest queue
    4. ...far later: "code faster"
  utilization → 100%  ⇒  wait time → ∞   (a busy system is a slow system)

DATA HYGIENE
  consistent stage definitions across teams (when clock starts/stops) = #1
  clean reopens / status bounces / skipped states (the long tail + near-zeros)
  dirty data → confident lies people plan against. Treat flow data as production data.

PERCENTILES, NOT MEANS
  report/forecast the 85th pct, never the mean (long tail drags the mean)
```

---

## Summary

- **Replace estimation with forecasting.** Run a **Monte Carlo** on your own recent throughput against the remaining item *count* to produce probabilistic dates ("85% by March 14"), and publish **SLEs** for single items. It's more honest than padded point estimates, predicts better, and — the first time it comes true — buys scarce **calibrated trust** with stakeholders. This is "no-estimates" in substance: forecast flow, don't estimate effort.
- **Attack the org-wide bottleneck where it actually is.** Aggregated decomposition almost always shows **wait states** — review-pickup latency, deploy queues, cross-team hand-offs — dominating, while coding is a minority. Set **review SLAs**, **automate the deploy path**, **reduce hand-offs**, and *measure the improvement*. Flow efficiency ≤15% means most of lead time is waiting that "code faster" never touches.
- **Use cycle time for improvement, never judgment.** Team-owned **scatterplots in retros**, compared to the team's own history, drive real change. **Never** rank teams by raw cycle time or rank individuals — the work is incomparable, the number is trivially gamed, and the act of ranking [destroys the data](../06-metrics-anti-patterns-and-goodhart/professional.md).
- **Win the change-management fight.** Per **Little's Law**, cycle time is proportional to **WIP**, so the highest-leverage levers — **limiting WIP** and **reducing batch size** — fight the "start more things" instinct. The engineering work is easy; the cultural work (a busy team is a slow team) is the real job, won with before/after data.
- **Keep the data clean.** Consistent **stage definitions** across teams and disciplined handling of **reopens/status-bounces** are the unglamorous foundation. Dirty flow data is a confident lie people plan against.
- **Tie it to business value.** Lead time is the speed of the **build-measure-learn loop** and the size of the **failure blast radius**: cutting it means cheaper learning, faster time-to-market, smaller safer changes, and honest predictability — faster *and* more stable, not a trade-off.

The next tier — [interview.md](interview.md) — distills the whole topic into the questions that reveal whether someone can actually run delivery on these numbers, or has only memorized the definitions.

---

## Further Reading

- **Daniel Vacanti — *Actionable Agile Metrics for Predictability* and *When Will It Be Done?*** — the definitive treatment of cycle-time scatterplots, Monte Carlo forecasting, SLEs, and flow-based delivery. The source text for this page's forecasting half.
- **Donald Reinertsen — *The Principles of Product Development Flow*** — the economics of batch size, WIP, queues, and why high utilization kills flow. The rigorous "why small batches win" argument.
- **Eliyahu Goldratt — *The Goal*** — Theory of Constraints as narrative; why you optimize the bottleneck and nothing else.
- **Forsgren, Humble & Kim — *Accelerate*** — the speed-and-stability-together evidence and the business case for lead-time reduction; pairs with [DORA](../01-dora-four-key-metrics/professional.md).
- **Mik Kersten — *Project to Product*** — flow metrics and value-stream thinking at the org scale, including wait states and hand-offs.
- **The engineering-analytics vendors' methodology docs** (LinearB, Swarmia, Jellyfish) — concrete, if vendor-flavored, treatments of cycle-time decomposition and the data-hygiene pitfalls at scale.

---

## Related Topics

- [The DORA Four Keys — Professional](../01-dora-four-key-metrics/professional.md) — lead time for changes (commit→deploy) as one of the four keys, continuous delivery, and the speed/stability evidence the business case rests on.
- [Metrics Anti-Patterns & Goodhart — Professional](../06-metrics-anti-patterns-and-goodhart/professional.md) — why ranking teams/individuals by cycle time corrupts behaviour and destroys the data; the law this whole "improvement not judgment" section is built on.
- [junior.md](junior.md) — the definitions: what lead time and cycle time mean and where the clock starts.
- [senior.md](senior.md) — pipeline decomposition, percentiles vs means, and flow efficiency — the diagnostic foundation this page operationalizes.
- [interview.md](interview.md) — the questions that probe whether you can run delivery on these numbers.
