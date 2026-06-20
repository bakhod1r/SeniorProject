# Lead Time & Cycle Time — Interview Questions

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Lead Time & Cycle Time
> *A flow-metrics interview rarely asks "what is cycle time." It asks "your average cycle time is four days but stakeholders say delivery is slow — what's going on?" and then watches whether you reach for the tail instead of the mean, whether you can name the clock, and whether you forecast with a distribution instead of adding up story points. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Definitions and the Clock](#theme-1--definitions-and-the-clock)
3. [Theme 2 — Decomposition: Where Time Is Lost](#theme-2--decomposition-where-time-is-lost)
4. [Theme 3 — Distribution and Percentiles](#theme-3--distribution-and-percentiles)
5. [Theme 4 — Forecasting](#theme-4--forecasting)
6. [Theme 5 — Queueing: Why Cutting WIP Cuts Cycle Time](#theme-5--queueing-why-cutting-wip-cuts-cycle-time)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Pitfalls and Anti-Patterns](#theme-7--pitfalls-and-anti-patterns)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **lead time vs cycle time** (the customer's wait vs the team's active work)
- **mean vs the distribution** (a single number vs a heavy-tailed shape that the mean lies about)
- **estimation vs forecasting** (a point guess in story points vs a probabilistic answer with a confidence level)
- **symptom vs cause** (long cycle time is the *reading*; queues, WIP, and batch size are the *mechanism*)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the clock and the distribution* before quoting a number — and who treat these as flow diagnostics, not a stick to rank people with.

---

## Theme 1 — Definitions and the Clock

### Q1.1 — Define lead time and cycle time. Be precise about where each clock starts and stops.

> **Testing:** Whether you can pin the boundaries, or you use the two terms interchangeably the way most people do.

**A.** Both measure elapsed wall-clock time for a unit of work, but over different intervals.

- **Lead time** is the *customer's* clock: from the moment a request is **made** (idea logged, ticket created, customer asks) to the moment it is **delivered** (in their hands, in production). It includes all the waiting *before* anyone starts working.
- **Cycle time** is the *team's* clock: from the moment work **actively starts** on an item (it enters "In Progress" / is pulled by an engineer) to the moment it is **done**. It excludes the upstream queue.

The crucial relationship: **lead time = wait-in-backlog + cycle time**. A team can have a fast cycle time (four days of active work) and a terrible lead time (six weeks, because items sat in the backlog for a month before anyone touched them) — and the customer only feels the lead time. The single most common error is quoting cycle time and calling it "how long we take to deliver," which silently drops the queue the customer is actually waiting in.

The discipline a senior brings: **state the two timestamps explicitly** ("start = first move to In Progress, end = merged-and-deployed") because every team draws these lines differently, and a metric whose boundaries you can't name is uncomparable and ungameable-against.

### Q1.2 — What does DORA's "lead time for changes" measure specifically, and how is that clock different from the classic product lead time?

> **Testing:** Whether you know the DORA metric is a *narrowed, deploy-pipeline* definition — not the idea-to-customer lead time.

**A.** DORA's **lead time for changes** is deliberately scoped to the *delivery* pipeline, not the *discovery* pipeline. It measures the time from **code committed** to **code successfully running in production**. The clock starts at the **first commit** of a change (in practice often the commit that the eventual deploy is traced back to) and stops at **successful deployment**.

So it is *not* the product manager's idea-to-customer lead time, and it deliberately excludes design, grooming, prioritization, and time the ticket spent in the backlog. It is a measurement of your **engineering delivery capability**: how fast can a committed change get safely to users? That's why it pairs so naturally with deployment frequency — both are about the throughput of the path from `git commit` to production.

The senior nuance: because the start is "commit," DORA lead time **hides the time spent coding before the first commit** and hides backlog wait entirely. That's a feature for benchmarking delivery pipelines (it isolates the part engineering controls) but a trap if a stakeholder hears "lead time" and thinks it means "time from when I asked." Always disambiguate: *DORA lead time (commit→deploy)* versus *flow/product lead time (request→delivery)*. They answer different questions and you should never quietly substitute one for the other.

### Q1.3 — DORA's elite band for lead time for changes is "less than one day." A team reports a 30-minute average. Are they elite? What would you check?

> **Testing:** Whether you read a benchmark critically and check the *measurement* before believing the *number*.

**A.** Maybe — but a 30-minute *average* should make me suspicious, not impressed, until I check three things.

1. **What's the clock?** If they're measuring from "merge to main" to "deploy," they've quietly excluded the entire PR review window, which is usually where the time goes. The honest DORA clock is *first commit* to deploy; redefining the start to "merge" can manufacture an elite number out of a slow process.
2. **Mean or percentile?** A 30-minute *mean* on a heavy-tailed distribution can hide a p85 of two days. DORA bands are best read against a percentile (commonly the median, with the tail reported alongside), because the mean is the wrong summary for this data (Theme 3).
3. **What counts as a "change"?** If they only count trivial config flips and route real features through a separate slow path, the metric is measuring the easy traffic and ignoring the hard traffic.

So my answer is: a 30-minute clean commit→deploy *median*, on representative changes, with a visible tail, is genuinely elite. A 30-minute *average* with an undefined start point is a measurement artifact. The benchmark is a conversation starter, not a verdict — and importantly, DORA itself frames these as capability indicators, not a leaderboard.

### Q1.4 — Why does the *unit* you measure (story, PR, deploy, epic) change the number so much? How do you keep cycle time comparable over time?

> **Testing:** Whether you understand that flow metrics are only meaningful relative to a fixed, consistent unit of flow.

**A.** Cycle time is "elapsed time per *unit of work*," so the number is meaningless until the unit is fixed. PR cycle time (open→merge) measures review latency in hours; story cycle time (start→done) measures feature delivery in days; epic cycle time measures initiative delivery in weeks. They're different metrics with the same name.

The thing that keeps the metric trustworthy over time isn't picking the "right" unit — it's **picking one unit and holding the boundaries constant**. The classic failure is silent definitional drift: a team tightens its definition of "started" or starts excluding "blocked" time, the number improves, and everyone celebrates a measurement change as a process improvement. So I'd: (1) write down the start/stop events for the chosen unit, (2) keep item *sizes* roughly consistent (so "one item" means something stable — which is also why right-sizing work beats estimating it), and (3) watch for definition changes whenever a trend shifts, because a step-change in a flow metric is far more often a measurement change than a real one.

---

## Theme 2 — Decomposition: Where Time Is Lost

### Q2.1 — Decompose cycle time into its stages. Which stages typically dominate, and which do teams wrongly focus on?

> **Testing:** Whether you know that active coding is usually the *small* part, and the wins are in the waits.

**A.** A useful decomposition of an item's journey:

1. **Coding** — active development.
2. **Pickup / pre-review wait** — PR is open, waiting for a reviewer to start.
3. **Review** — reviewer actively reading + the back-and-forth round trips.
4. **CI / pipeline** — automated build and test time, plus any flaky-test reruns.
5. **Deploy / release wait** — merged but waiting for a release window, manual approval, or a batched release train.
6. **Generic wait / blocked** — dependencies, environments, "waiting on another team," handoffs.

The empirical pattern across most teams: **active work is the minority of cycle time; waiting dominates.** Items spend far more time *idle in a queue* (waiting for review, waiting for deploy, blocked on a dependency) than being worked on. Teams instinctively try to make engineers code faster — the one stage that's already efficient — while the PR sits unreviewed for two days and the merged change waits four more for the Thursday release. The senior move is to compute **flow efficiency** (active time ÷ total cycle time); when it's 15%, you stop optimizing the 15% and go attack the queues.

### Q2.2 — A team's PRs sit open for 2–3 days before anyone reviews them. Which sub-metric exposes this, and what does it tell you about the system?

> **Testing:** Whether you can isolate *pickup time* (a pure queue) from *review time* (actual work).

**A.** The sub-metric is **pickup time** (a.k.a. time-to-first-review): from PR opened to first review activity. It's a near-pure measure of *queue*, separate from **review time** (first review to merge), which mixes work and round trips.

A long pickup time tells me the system has a **WIP and prioritization problem, not a skill problem**: reviewing isn't anyone's current priority because everyone is busy starting their *own* next item (high WIP, Theme 5). It's a queue forming in front of a shared resource (reviewer attention). The fixes are systemic, not exhortations to "review faster": cap WIP so finishing (including reviewing) beats starting; make review a daily standup commitment ("review before you start new work"); shrink PRs so reviewing one is a 15-minute task someone will pick up rather than a two-hour slog they avoid; add review SLAs/alerts. The distinction matters because if you misread a long pickup time as slow *reviewing*, you'll push people to rubber-stamp — degrading quality without touching the actual queue.

### Q2.3 — Why is "merged but not deployed" wait often the most invisible — and the most fixable — chunk of lead time?

> **Testing:** Whether you connect cycle-time decomposition to deployment frequency and batch size.

**A.** It's invisible because everyone *feels* done at merge — the engineer moved on, the ticket looks closed — so nobody is watching the clock that's still running between merge and production. But if you deploy weekly, a change merged on Monday waits until Friday: four days of pure lead time added to *every* change, with zero work happening.

It's the most fixable because it's almost entirely a **batch-size and automation** problem, not a people problem. Deploying more often (smaller batches, ideally continuous deployment) directly shrinks this wait toward zero — which is exactly why DORA pairs lead time with **deployment frequency**: they move together because the merge→deploy gap is a function of how often you ship. The lever is engineering practice (trunk-based development, automated pipelines, feature flags to decouple deploy from release), and it converts a multi-day wait into minutes without anyone working faster. This is the cleanest example of cutting cycle time by attacking a *queue* rather than the *work*.

### Q2.4 — How do you actually measure these stages? What's the data source, and what makes the data lie?

> **Testing:** Practical instrumentation literacy — and skepticism about timestamp quality.

**A.** The data sources are the **state transitions** in your tools: issue-tracker status changes (Jira/Linear board columns give "In Progress" → "In Review" → "Done") for the work-item view, and **git/PR events** (commit, PR opened, first review, merge) plus **CI/CD events** (pipeline start/finish, deploy completed) for the delivery view. You stitch these into per-item timelines and difference the timestamps.

What makes the data lie:
- **Backdated status changes** — engineers drag a card to "Done" on Friday for three tickets finished across the week, collapsing real cycle time to near-zero.
- **Tickets that skip columns** — work done outside the board ("I just fixed it") never generates the transitions, so it's invisible.
- **Reopened / bounced items** — does the clock reset, accumulate, or ignore the bounce? Pick a rule and apply it consistently.
- **"Blocked" not modeled** — if there's no blocked state, dependency wait masquerades as active work and inflates apparent coding time.
- **Bot/automation noise** in git events (e.g. a bot's commit, squash-merges that rewrite commit timestamps) distorting the commit→deploy clock.

So the senior posture is: trust *event streams* over *self-reported status*, validate by spot-checking a few items end to end, and treat any suspiciously clean number as a measurement question first.

---

## Theme 3 — Distribution and Percentiles

### Q3.1 — Why is cycle time almost always heavy-tailed (right-skewed), and why does that make the mean the wrong summary?

> **Testing:** The single most important statistical fact about flow metrics.

**A.** Cycle time is bounded below (an item can't take negative time, and there's a practical floor) but **unbounded above** — an item can get blocked, bounce through review, hit a dependency, or sit forgotten, stretching to weeks. So the distribution is **right-skewed with a long tail**: a big cluster of fast items and a thin tail of slow ones that runs far to the right. It's typically closer to log-normal or Weibull than normal.

For that shape, the **mean is dragged toward the tail and represents almost nobody** — it sits above most items yet below the worst, describing neither the typical experience nor the risk. A handful of 30-day outliers can pull a "4-day average" well above a 2-day reality. The honest summaries are **percentiles**: the **median (p50)** for the typical item, and **p85/p95** for "how bad does it get" — the number you can actually make a promise around. Reporting a mean cycle time signals you haven't looked at the histogram; the first thing a strong candidate does is *plot the distribution* and quote percentiles off it.

### Q3.2 — What is a Service Level Expectation (SLE), and how do you derive one from cycle-time data?

> **Testing:** Whether you can turn a distribution into a *promise* a team can make and keep.

**A.** An **SLE** is a forecast of how long an item should take, stated as a **time *and* a probability** — e.g., "85% of our work items finish within 8 days." It's the flow-metric equivalent of an SLO: a commitment grounded in your own historical distribution, not a wish.

You derive it empirically: take a recent, representative window of completed items, build the cycle-time distribution, and read the percentile you want off it. If p85 = 8 days, your SLE is "8 days at 85%." You pick the percentile by how much certainty the commitment needs — p85 for a normal team promise, p95 when you're making a harder guarantee. Two senior points: (1) it's **descriptive then prescriptive** — you measure what you actually do, *then* commit to it, rather than inventing a target; and (2) it becomes an operational tool — when an in-flight item *ages past* the SLE threshold, that's an automatic signal to swarm it before it becomes a tail outlier. The SLE turns the percentile from a report into a control.

### Q3.3 — Two teams both report a median cycle time of 3 days. Team A's p95 is 6 days; Team B's p95 is 25 days. What does that tell you, and which would you rather depend on?

> **Testing:** Whether you understand that *predictability lives in the tail*, not the central tendency.

**A.** Same median, completely different systems. The median tells me the *typical* item is identical, but the p95 tells me about **variability and predictability** — and that's what actually matters for planning.

Team A (p95 = 6 days) is **predictable**: almost everything lands in a tight 3–6 day band, so I can make commitments and they'll hold. Team B (p95 = 25 days) has a **fat tail** — most items are fine, but a meaningful fraction blow up to 25 days, which means dependencies, frequent blocking, large items, or rework lurking in the tail. I'd rather depend on **Team A**, because dependability is a function of the *spread*, not the center. A narrow distribution lets you promise dates; a fat tail means every commitment is a gamble even though the average looks fine. This is also why I'd push Team B to investigate its tail items specifically (what do the 25-day items have in common?) rather than celebrate its respectable median.

### Q3.4 — Stakeholders ask "what's our cycle time?" expecting one number. How do you answer responsibly without a statistics lecture?

> **Testing:** Communication judgment — conveying a distribution to a non-technical audience honestly.

**A.** I give them **two numbers and a sentence**, not one number and not a histogram: *"Typically about 3 days, and 85% of the time within 8."* That single phrasing carries the median (the normal case) and a percentile (the realistic worst case) — which is everything they need to plan against, without the word "percentile."

If they push for "just one number," I give the **p85, not the mean**, because a promise should be the number you can keep, and the mean is the number you can't reason about. I'd also show them a **scatterplot of cycle time over time** if they want more — each dot an item, so they can *see* the tail and the consistency rather than trust a summary. The skill being tested is resisting the false comfort of a single average: the responsible answer is to make the *spread* visible, because the spread is what determines whether their plans will survive contact with reality.

---

## Theme 4 — Forecasting

### Q4.1 — "When will this 30-item backlog be done?" Walk me through forecasting it *without* story points.

> **Testing:** The flagship flow-forecasting skill — Monte Carlo over historical throughput.

**A.** I'd run a **Monte Carlo simulation** driven by **historical throughput**, not by summing estimates. The procedure:

1. **Gather history:** take how many items the team *actually completed* per week (or per day) over a recent representative window — say the last 10–12 weeks of throughput samples.
2. **Simulate one future:** to "finish 30 items," repeatedly draw a random week's throughput from that history and accumulate until I've reached 30, counting how many weeks it took. That's one possible future, built from how the team really behaves.
3. **Simulate many futures:** repeat that thousands of times. Each run gives a number of weeks; together they form a *distribution* of completion dates.
4. **Read the percentiles:** "There's an 85% chance we finish within 9 weeks; a 50% chance within 7." I report a date *with a confidence level*, not a single date.

The reason this beats estimation: it uses the team's **actual delivery variability** (including the bad weeks) instead of optimistic point guesses, and it outputs a **probability distribution** so the business can choose its own risk tolerance. It also needs no story points at all — just a count of items finished per period — which sidesteps the whole estimation tax.

### Q4.2 — Why is Monte Carlo with throughput generally more reliable than summing story-point estimates and dividing by velocity?

> **Testing:** Whether you can articulate *why* the probabilistic method dominates, not just that it exists.

**A.** Three reasons.

1. **It models variability instead of erasing it.** "Sum the points, divide by average velocity" produces a single point answer that implicitly assumes every future week is average — but weeks aren't average, and the variance is exactly what makes deadlines slip. Monte Carlo *samples* the real spread (good weeks and bad weeks both), so the tail risk shows up in the forecast.
2. **It outputs a probability, not a promise.** A point estimate ("8 weeks") has no confidence attached, so it's almost always read as a commitment and almost always wrong. "85% chance by week 9" tells the business the *risk*, letting them decide whether to plan to the p50 or the p85.
3. **It removes the estimation error.** Story points are a noisy, biased, gameable human guess; throughput is a *count of things that actually happened*. Forecasting from counts skips the entire layer of estimation inaccuracy — and the empirical finding (Vacanti, and the #NoEstimates work) is that **item *count* forecasts as well as or better than summed estimates**, because for right-sized work the variation in item size washes out across a backlog.

The honest caveat: Monte Carlo assumes the future resembles the past, so it breaks if the team, scope, or item-size profile changes mid-flight — which is why you re-forecast continuously rather than once.

### Q4.3 — What inputs does a throughput Monte Carlo forecast need, and what assumptions can quietly invalidate it?

> **Testing:** Whether you know the method's failure modes, not just its happy path.

**A.** The inputs are minimal: a **history of throughput** (items completed per time bucket) and the **count of items remaining**. That's it — no estimates. Optionally you split by work type if classes of work behave very differently.

The assumptions that quietly break it:
- **Stationarity** — it assumes future throughput is drawn from the same distribution as the past. A reorg, attrition, a new domain, or a tech migration changes the underlying rate and the forecast silently goes stale. Re-run it often.
- **Stable scope** — the "30 items" must not balloon. If discovery keeps adding items (scope creep), you're forecasting a moving target; track scope growth as its own line.
- **Comparable item size** — if items range from 1 hour to 3 weeks, the count-based draw gets noisy. The method is most accurate when work is *right-sized* into a consistent band, which is also independently good practice.
- **Independence / no structural blockers** — a single hard dependency that gates many items isn't captured by sampling typical weeks; the model assumes items flow roughly independently.

So I'd present a Monte Carlo forecast *with* its assumptions stated and a commitment to re-forecast as data arrives — a forecast is a living estimate, not a one-time oracle.

### Q4.4 — A PM wants a single committed date for a launch. How do you give a probabilistic forecast that's still actionable?

> **Testing:** Translating a distribution into a business decision without surrendering the honesty of the distribution.

**A.** I reframe "a date" as "a date *and* a confidence," and let the PM pick the confidence the situation deserves. Concretely: *"50/50 we hit October 7th; 85% confident by October 21st; 95% confident by October 28th. Which risk level do you want to commit externally?"*

Then I guide the choice by **consequence of being late**: for a low-stakes internal milestone, commit to the p50 and accept the coin-flip. For a marketing launch, a conference, or a contractual date — where being late is expensive — commit externally to the **p85 or p95** and let the team beat it, rather than commit to the p50 and miss half the time. The actionable artifact is a single chosen date *backed by a stated confidence*, plus a commitment to re-forecast weekly so the date tightens as we burn down the backlog. The skill being tested is refusing the false dichotomy of "a number or a lecture": you give them a decision, but it's an *informed* one with the risk made explicit.

---

## Theme 5 — Queueing: Why Cutting WIP Cuts Cycle Time

### Q5.1 — State Little's Law and apply it to a software team. Why is it the theoretical backbone of flow metrics?

> **Testing:** Whether you can wield the one equation that ties WIP, throughput, and cycle time together.

**A.** **Little's Law:** for a stable system, **average WIP = average throughput × average cycle time** — or rearranged, **cycle time = WIP ÷ throughput**. (More precisely, work-in-progress equals arrival/completion rate times the average time an item spends in the system, under steady state.)

Applied to a team: if you have **20 items in progress** and you finish **5 per week**, your average cycle time is 20 ÷ 5 = **4 weeks**. The reason it's the backbone: it makes the WIP→cycle-time relationship *arithmetic*, not opinion. Holding throughput roughly constant (your team's capacity doesn't change overnight), **cycle time is directly proportional to WIP**. Cut WIP from 20 to 10 and cycle time halves to 2 weeks — same people, same capacity, just less work open at once. That's the mathematical justification for "stop starting, start finishing": you can't speed people up easily, but you can *shrink the queue*, and the law guarantees the cycle time falls with it. The caveats matter (it's an *average*, *steady-state* relationship, and it assumes you don't just churn WIP), but as a lever it's the most reliable one in flow.

### Q5.2 — Mechanically, *why* does high WIP increase cycle time? Where does the extra time actually go?

> **Testing:** Whether you understand the mechanism (queueing) beneath the equation, not just the formula.

**A.** The extra time goes into **waiting in queues**, and high WIP creates queues two ways.

First, **directly via Little's Law**: more items open against fixed throughput means each item, on average, waits longer in the system — the math above.

Second, and more viscerally, high WIP **fragments attention and multiplies handoffs**. When an engineer juggles five items, each one spends most of its life *parked* while attention is elsewhere; context-switching adds re-orientation overhead every time they return. PRs pile up unreviewed because everyone's busy starting their own work, so *pickup time* balloons (Theme 2). Every parked item is sitting in an invisible queue waiting for a person to come back to it. So the extra cycle time isn't extra *work* — it's **idle time in queues plus switching overhead**. This is why flow efficiency craters at high WIP: the active-work fraction shrinks as the waiting fraction grows. The fix isn't "work harder"; it's "have fewer things open so each one flows instead of waiting."

### Q5.3 — How do utilization and batch size affect cycle time? Why can a "100% utilized" team be *slower*?

> **Testing:** The counterintuitive queueing result that high utilization destroys flow — and the batch-size lever.

**A.** **Utilization:** queueing theory says wait time rises *non-linearly* with utilization, and explodes as you approach 100%. The relationship is roughly proportional to **ρ ÷ (1 − ρ)**, where ρ is utilization — so going from 80% to 95% busy doesn't add a little wait, it adds a *lot*, because a fully-loaded system has no slack to absorb variability and every new arrival waits behind a full queue. A team kept at "100% utilized" looks maximally efficient on a capacity report but has the **longest** cycle times, because there's no slack and queues never drain. Deliberate slack is what keeps flow fast — counterintuitive to managers who equate idle time with waste.

**Batch size:** large batches inflate cycle time directly. A big PR, a big release, a big epic worked as one lump all mean nothing is "done" until the whole thing is done, so the cycle time of every part is the cycle time of the slowest part, and the work sits in queues longer (reviewing a 2,000-line PR is a task people defer). **Small batches flow faster**: smaller PRs get reviewed sooner, smaller releases deploy sooner, right-sized stories finish sooner — each is a smaller unit moving through each queue with less wait. So the two highest-leverage moves on cycle time are **lower WIP** and **smaller batches**, and they reinforce each other.

### Q5.4 — Given Little's Law, what are the only three ways to reduce cycle time? Rank them by feasibility.

> **Testing:** Whether you can reason *from* the equation to a prioritized action list.

**A.** From `cycle time = WIP ÷ throughput`, there are exactly three levers:

1. **Reduce WIP** (shrink the numerator) — *most feasible, fastest payoff.* Set explicit WIP limits, enforce "finish before you start," cut the number of parallel initiatives. It's a policy change, free, and the effect is immediate per Little's Law. This is always where I start.
2. **Increase throughput** (grow the denominator) — *real but slower.* Remove bottlenecks (un-stick review and deploy queues), automate CI/deploy, reduce rework by improving quality upstream, right-size work. These genuinely raise completion rate but take time to land and some cost money or people.
3. **Reduce variability / batch size** — *the enabler under both.* Smaller batches and less variable item sizes make the *averages* in Little's Law behave and keep queues from spiking; they don't change the formula's terms directly but they make 1 and 2 actually work and tame the tail.

The ranking insight is that everyone *wants* to do (2) by "going faster," but (1) is cheaper, faster, and mathematically guaranteed — so a strong answer leads with cutting WIP and treats throughput gains as the slower, structural follow-up.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — "Our average cycle time is 4 days and looks fine, but stakeholders keep complaining delivery is slow." Diagnose it.

> **Testing:** The headline scenario — can you reach past the mean to the tail, the clock, and the queue?

**A.** A "fine average" colliding with "it feels slow" is almost always one of four things, and I'd check them in order:

1. **The mean is hiding the tail.** Cycle time is heavy-tailed (Theme 3); a 4-day *mean* can sit on top of a p85 of 15 days. Stakeholders don't remember the average item — they remember the **painful tail items** that took three weeks, and those are what shape the perception of "slow." I'd plot the distribution; if the tail is fat, that's the answer. The fix is investigating tail items, not the median.
2. **Wrong clock — they feel lead time, you're quoting cycle time.** Cycle time (active work) might be 4 days while **lead time** (from when they *asked*) is six weeks, because items sit in the backlog before anyone starts (Theme 1). The customer experiences the whole wait, including the queue your cycle-time clock ignores. I'd measure lead time and the backlog-wait portion.
3. **The merge→deploy gap.** Work is "done" in 4 days but ships on a weekly train, so delivery to the user lags merge by days (Theme 2). Stakeholders see the deploy, not the merge.
4. **Throughput, not speed.** Each *item* is fast, but with high WIP and low throughput the *flow of completed value* is a trickle — lots started, little finished. They feel the absence of completed things, not per-item latency.

So the diagnosis is: the average is the wrong summary, and "slow" is a statement about the **tail, the upstream queue, or the deploy gap** — none of which a mean cycle time can see. I'd answer with the distribution and the lead-time breakdown, not a better average.

### Q6.2 — You're asked to cut lead time. Walk me through how you'd find the biggest win.

> **Testing:** Whether you optimize by *measurement* (find the dominant queue) instead of by reflex ("hire more, code faster").

**A.** I'd refuse to guess and instead **decompose and measure first**, because the win is almost never where people assume.

1. **Break lead time into stages** (backlog wait → coding → pickup → review → CI → deploy wait, per Theme 2) and measure how long items spend in each.
2. **Find the dominant queue.** Compute flow efficiency; if it's ~15%, the time is in *waiting*, and one stage usually dominates. The empirically common culprits are **pickup time** (PRs waiting for review) and **deploy wait** (merged-but-not-shipped) — both queues, neither solved by coding faster.
3. **Attack that one stage:**
   - If it's pickup/review → lower WIP, smaller PRs, review SLAs, "finish before you start."
   - If it's deploy wait → deploy more often, automate the pipeline, feature-flag to decouple deploy from release (this is the deployment-frequency lever).
   - If it's backlog wait → that's a prioritization/WIP problem upstream, not an engineering-speed one.
4. **Re-measure** to confirm the bottleneck actually moved (and watch for it relocating to the next stage).

The judgment being tested: lead time is a *system* property dominated by its worst queue, so you find the constraint, fix that, and re-measure — rather than uniformly pushing everyone to "be faster," which loads the stages that were never the problem.

### Q6.3 — You inherit a 30-item backlog, the team has no estimates and refuses to make them. Forecast a delivery date. Defend your method.

> **Testing:** Whether you reach for throughput Monte Carlo under real constraints and can justify it to a skeptic.

**A.** No estimates is fine — I don't need them. I'd forecast with **throughput Monte Carlo** (Theme 4): pull the team's historical items-completed-per-week over the last ~10–12 weeks, simulate "finish 30 items" thousands of times by repeatedly sampling weekly throughput until the count is reached, and read the date percentiles off the resulting distribution. I'd report it as *"50% by week 7, 85% by week 9,"* and let the stakeholder pick the confidence to commit to.

Defending it against a skeptic:
- **"It's just guessing."** No — it's built entirely from *what the team actually delivered*, not opinions. The only assumption is that next quarter resembles last quarter, which I'll re-validate by re-forecasting weekly.
- **"You can't forecast without estimating size."** For a backlog of roughly right-sized items, **item count forecasts as well as summed points** because size variation averages out across 30 items — and counting is objective where estimating is biased and gameable.
- **"What if items are wildly different sizes?"** Then I right-size the largest few or forecast classes of work separately; I don't reintroduce story points to fix a slicing problem.

The defense rests on one point: a forecast from *historical throughput* is more honest and usually more accurate than one from *human estimates*, and it costs the team nothing because they don't have to estimate anything.

### Q6.4 — Cycle time has been creeping up for three sprints. How do you investigate the cause?

> **Testing:** Systematic diagnosis using the decomposition and the queueing model — not jumping to a conclusion.

**A.** I treat a rising trend as a question and work it systematically.

1. **First, rule out measurement drift.** A step-change is more often a definition change than a real one — did "started" get redefined, did blocked-time handling change, did the item mix shift toward bigger work? Confirm the clock is unchanged before believing the trend.
2. **Decompose the trend.** Is the increase in coding, pickup, review, CI, or deploy wait? Plotting each stage over the three sprints localizes it immediately — a creeping *pickup* time points at WIP/review; creeping *CI* time points at a slow or flaky test suite.
3. **Check WIP and throughput together** (Little's Law). If WIP rose while throughput held flat, cycle time *must* rise by the equation — the cause is simply too much started at once, and the fix is a WIP limit. If throughput *fell* at constant WIP, something is reducing completion rate (attrition, rework, a new bottleneck).
4. **Inspect the tail.** Is the median stable but the tail fattening? Then a class of items is getting stuck (new dependency, flaky integration) — investigate what the slow items share.
5. **Correlate with events.** Map the timeline against a reorg, a new dependency, onboarding, or a process change.

The discipline: localize *which stage*, check the *WIP/throughput* arithmetic, separate *median* from *tail*, and only then form a hypothesis — rather than declaring "the team got slower," which is a conclusion, not a diagnosis.

---

## Theme 7 — Pitfalls and Anti-Patterns

### Q7.1 — Your director wants to rank teams by raw cycle time and reward the fastest. What do you tell them?

> **Testing:** Whether you understand that cross-team cycle-time comparison is statistically and behaviorally invalid.

**A.** I'd push back firmly, because raw cross-team cycle time is **not comparable** and ranking on it backfires.

- **Different units, different work.** Team A's "items" might be small frontend tweaks; Team B's might be platform changes with cross-team dependencies. Their cycle times measure different things; comparing the numbers is comparing hours to weeks (Theme 1).
- **Different definitions.** Each team draws "started" and "done" differently, so the clocks aren't the same clock. Normalizing them across an org is nearly impossible.
- **It's a context metric, not a performance score.** Cycle time reflects the *system* a team works in (dependencies, domain complexity, tech debt), not how hard they try. Ranking on it punishes teams with harder systems and rewards teams with easier ones.
- **Goodhart's Law / gaming.** The moment cycle time becomes the reward, teams optimize the *number*, not the flow — splitting tickets, gaming the board, cherry-picking easy work (Q7.3). The metric stops measuring reality.

What I'd offer instead: let each team watch **its own cycle time as a trend** (is *our* flow improving?), use the distribution for forecasting and SLEs, and reserve org-level comparison for *outcomes* (DORA's balanced set), never a single speed metric used as a leaderboard.

### Q7.2 — Why is using cycle time (or throughput) to evaluate *individuals* especially dangerous?

> **Testing:** Whether you know flow metrics are *system* diagnostics that collapse when pointed at people.

**A.** It's dangerous because flow metrics are **team/system measures**, and individualizing them is both invalid and corrosive.

- **They measure the system, not the person.** An engineer's items move slowly mostly because of queues, dependencies, review waits, and WIP they don't control — not personal pace. You'd be scoring people on the system's constraints.
- **It destroys collaboration.** If my number depends on *my* items finishing fast, I stop reviewing others' PRs, stop pairing, stop helping with the hard shared problem — all the team behaviors that *actually* improve flow become things that hurt my score. You'd optimize away the cooperation that makes the team fast.
- **It rewards gaming over value.** Individuals will inflate item counts, avoid risky/ambiguous work, and split tickets to look productive (Q7.3) — classic Goodhart's-Law dysfunction. The metric stops reflecting reality the instant it's used to judge.
- **The data is too noisy per-person.** Per-individual samples are small and dominated by the heavy tail, so the "rankings" are mostly statistical noise.

The principle: these are **diagnostics to improve a system, not a performance-management tool.** Pointed at a team's process, they reveal queues to fix; pointed at a person, they produce fear, gaming, and worse flow. I'd treat any request to put them in a performance review as a red line.

### Q7.3 — How do teams game cycle time, and how do you design metrics so gaming is harder?

> **Testing:** Whether you can anticipate Goodhart's Law concretely and counter it.

**A.** **The Goodhart pattern** — "when a measure becomes a target, it ceases to be a good measure" — shows up here as:

- **Ticket-splitting / item inflation.** Slice one feature into ten tiny tickets so throughput shoots up and per-item cycle time drops, with zero change in delivered value. Pure number theater.
- **Backdating / status manipulation.** Drag cards to "Done" in a batch, or open the ticket only when work is nearly finished, collapsing measured cycle time.
- **Cherry-picking easy work** and avoiding hard, ambiguous, or risky items that would lengthen the number — exactly the items that often matter most.
- **Redefining the clock** to start later or stop earlier so the interval shrinks without the work changing.

Counter-designs:
1. **Never tie the metric to rewards or individual evaluation** — remove the incentive and most gaming evaporates (Q7.1, Q7.2).
2. **Use balanced sets, not a single number** — pair speed (cycle time, lead time) with *stability* (change-fail rate, defects). Gaming throughput by splitting tickets or skipping quality shows up as rising failures; the counter-metric makes the cheat visible. This is exactly why DORA is **four** metrics, not one.
3. **Anchor on outcomes** (value delivered, customer impact) alongside flow, so "more tickets" isn't automatically "better."
4. **Watch for the tells** — a sudden throughput spike with flat value, or cycle time that drops the week after it became a target, is usually gaming, not improvement.

The meta-point: you don't defeat gaming with better tracking; you defeat it by **not weaponizing the metric** and by **balancing it with a counter-metric** that punishes the obvious cheats.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Lead time vs cycle time in one line?** A: Lead time is the customer's wait (request→delivery); cycle time is the team's active work (start→done); lead time includes the backlog queue, cycle time doesn't.
- **Q: Where do DORA's lead-time-for-changes clock start and stop?** A: Code committed → code running in production; it excludes backlog wait and pre-commit coding.
- **Q: Why report median + p85 instead of the mean?** A: Cycle time is right-skewed, so the mean is dragged by the tail and represents nobody; the median is the typical case and p85 is the keepable promise.
- **Q: What is an SLE?** A: A Service Level Expectation — "X% of items finish within N days," derived from your own cycle-time percentile.
- **Q: Little's Law?** A: WIP = throughput × cycle time, i.e. cycle time = WIP ÷ throughput for a stable system.
- **Q: Fastest way to cut cycle time?** A: Reduce WIP — it's a free policy change with an immediate, math-guaranteed effect via Little's Law.
- **Q: Why does 100% utilization slow a team down?** A: Wait time scales like ρ/(1−ρ) and explodes near full load; no slack means queues never drain.
- **Q: How do you forecast without estimates?** A: Monte Carlo over historical throughput — sample weekly completions to finish the backlog, repeat thousands of times, read date percentiles.
- **Q: Why Monte Carlo over points÷velocity?** A: It models real variability and outputs a probability with a confidence level instead of a single point answer that ignores the tail.
- **Q: What's flow efficiency?** A: Active work time ÷ total cycle time; usually low (often <30%), proving the time is in queues, not in working.
- **Q: One reason not to rank teams on cycle time?** A: It's a context/system metric with inconsistent units and definitions — ranking punishes harder systems and invites gaming.
- **Q: How is cycle time gamed most simply?** A: Ticket-splitting — slice one item into many to inflate throughput and shrink per-item time with no added value.
- **Q: Why pair speed metrics with a stability metric?** A: A counter-metric (change-fail rate, defects) makes gaming visible — you can't fake speed by skipping quality without the failure number rising.
- **Q: Pickup time vs review time?** A: Pickup = PR-open→first-review (pure queue); review = first-review→merge (work + round trips).

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Using "lead time" and "cycle time" interchangeably, or not stating where the clock starts.
- Reporting a *mean* cycle time, or treating cycle time as roughly normal.
- Forecasting by summing story points and dividing by average velocity, with no confidence attached.
- "Just make engineers code faster" as the answer to a long cycle time.
- Wanting to rank teams or evaluate individuals on cycle time / throughput.
- Not knowing what WIP has to do with cycle time (missing Little's Law).
- Thinking 100% utilization is the goal.

**Green flags:**
- Naming the clock explicitly and distinguishing DORA lead time (commit→deploy) from product lead time (request→delivery).
- Reaching for the *distribution* — plotting it, quoting median + p85/p95, talking about the tail.
- Forecasting with Monte Carlo over throughput and reporting a date *with a confidence level*.
- Diagnosing slow delivery by decomposing into stages and attacking the dominant *queue* (pickup, deploy wait).
- Leading with "reduce WIP" and justifying it from Little's Law.
- Treating these as system diagnostics and refusing to weaponize them against people.
- Pairing speed with a stability counter-metric to defeat gaming (the DORA-balanced instinct).

---

## Summary

- The bank reduces to four distinctions in costumes: **lead time vs cycle time**, **mean vs the distribution**, **estimation vs forecasting**, and **symptom vs cause (queues)**. Name the clock and the distribution before quoting a number.
- **Definitions:** lead time is the customer's clock (request→delivery, includes backlog wait); cycle time is the team's clock (start→done). DORA's lead-time-for-changes is the *narrowed* commit→deploy pipeline clock — disambiguate it from product lead time, always.
- **Decomposition:** cycle time = coding + pickup + review + CI + deploy wait + blocked, and **waiting usually dominates active work** (low flow efficiency). The biggest, most-fixable chunks are pickup time and the merge→deploy gap — both queues, neither solved by coding faster.
- **Distribution:** cycle time is heavy-tailed, so the **mean lies**; report **median (typical) + p85/p95 (the promise)**, derive **SLEs** from percentiles, and remember that predictability lives in the *tail*, not the median.
- **Forecasting:** answer "when will it be done" with **Monte Carlo over historical throughput** — a *date with a confidence level*, no story points needed — because it models real variability and beats summed estimates for right-sized work.
- **Queueing:** **Little's Law** (cycle time = WIP ÷ throughput) makes cutting WIP the cheapest, fastest, math-guaranteed lever; high utilization and large batch sizes inflate cycle time via queues; smaller batches and lower WIP are the top two levers.
- **Pitfalls:** these are **system diagnostics** — comparing teams' raw cycle time, ranking individuals, and any single-number target invite Goodhart-style gaming (ticket-splitting, backdating, cherry-picking). Defend with balanced sets and by never weaponizing the metric.

---

## Further Reading

- *Actionable Agile Metrics for Predictability* — Daniel Vacanti. The reference for cycle time, the distribution view, SLEs, and throughput-based Monte Carlo forecasting.
- *When Will It Be Done?* — Daniel Vacanti. The practitioner's guide to probabilistic forecasting without estimates.
- *Accelerate* — Forsgren, Humble, Kim. The DORA research, including lead time for changes as a capability metric and why the four metrics are balanced.
- *The Principles of Product Development Flow* — Donald Reinertsen. The deep treatment of queues, batch size, utilization, and WIP as economic levers.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/interview.md) — flow efficiency, value-stream mapping, and the broader flow-metric set these questions sit inside.
- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/interview.md) — lead time for changes in its native four-metric context, and why balance defeats gaming.
- [Engineering Metrics & DORA README](../README.md) — where lead time and cycle time fit in the broader metrics landscape.
