# The SPACE Framework — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The SPACE Framework
> *Someone, somewhere, is about to judge a developer by how many commits they pushed this week. The SPACE framework exists because that one number — and every other single number people reach for — lies about something as human and tangled as "productivity."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why One Number Always Fails](#core-concept-1--why-one-number-always-fails)
5. [Core Concept 2 — The Five Dimensions of SPACE](#core-concept-2--the-five-dimensions-of-space)
6. [Core Concept 3 — Activity Is the Most Misleading Dimension](#core-concept-3--activity-is-the-most-misleading-dimension)
7. [Core Concept 4 — Pick Across Dimensions, Including Feelings](#core-concept-4--pick-across-dimensions-including-feelings)
8. [Core Concept 5 — SPACE Measures Teams, Not Individuals](#core-concept-5--space-measures-teams-not-individuals)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why "developer productivity" is more than one number.**

Every few months a manager, an executive, or a well-meaning dashboard tries to answer one question: *how productive is this developer, or this team?* And almost every time, the answer comes out as a single number — lines of code written, tickets closed, commits pushed, story points burned down. It feels objective. It fits in a spreadsheet. It is also, reliably, wrong.

The **SPACE framework** is the research-backed antidote. Published in 2021 by a team of researchers from GitHub, Microsoft, and the University of Victoria (Forsgren, Storey, Maddila, Zimmermann, Butler, and Houck), it makes one central claim: developer productivity is **multi-dimensional**, and any attempt to capture it with one metric will mislead you. SPACE names **five** dimensions you should look at instead — **S**atisfaction, **P**erformance, **A**ctivity, **C**ommunication, and **E**fficiency — and gives you a simple rule: pick metrics from *several* of them, including at least one that captures how developers actually *feel*.

This page teaches you the five dimensions in plain terms, why the single-number habit is so seductive and so harmful, and the two lessons that matter most at this level: **activity counts are the easiest thing to measure and the easiest thing to misread**, and **SPACE describes teams and systems, never a leaderboard of individuals**. Get these straight now and you'll spot a bad metric — in a dashboard, a performance review, or a board slide — long before it does damage.

> **The mindset shift:** productivity isn't one number — and it *especially* isn't activity. Stop asking "what's the one metric that tells me who's productive?" Start asking "which few signals, across different dimensions, together give me an honest picture — and what would each one *miss* on its own?"

---

## Prerequisites

- **Required:** You've worked on at least one software project with other people — you've opened a pull request, had code reviewed, or closed a ticket.
- **Required:** You understand basic version-control vocabulary: commit, pull request (PR), code review, merge.
- **Helpful:** You've seen a "productivity dashboard," a velocity chart, or a performance review that used a number to describe how much work someone did — and it felt off.
- **Helpful:** You've skimmed [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md). SPACE and DORA are complementary, not competing; DORA measures delivery, SPACE measures the broader human picture.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **SPACE** | A framework saying productivity has five dimensions, not one. The letters are the five. |
| **S — Satisfaction & wellbeing** | Are developers happy and healthy, or burning out? How they *feel* about the work and tools. |
| **P — Performance** | The *outcome* of the work. Did what got built actually work and deliver value? |
| **A — Activity** | Counts of things done — commits, PRs, builds, reviews. Easy to count, easy to misuse. |
| **C — Communication & collaboration** | How well people work together — reviews, knowledge sharing, how findable information is. |
| **E — Efficiency & flow** | Can a developer make progress with few interruptions, hand-offs, and waiting? |
| **Perceptual metric** | A measure of how people *feel* or *perceive* something — usually from a survey, not a tool. |
| **Dimension** | One of the five "angles" you look at productivity from. SPACE has five. |

---

## Core Concept 1 — Why One Number Always Fails

The dream is a single dial labelled "productivity" that goes up when things are good and down when they're not. It does not exist, and it cannot, for a simple reason: **productivity is not one thing.** It's a bundle of outcomes, effort, collaboration, and human wellbeing — and a single number can only ever reflect one slice of that bundle while hiding the rest.

Look at the popular single-number candidates and what each one quietly ignores:

```
Lines of code (LOC)   → rewards VOLUME, ignores value. 500 lines of copy-paste
                        "beats" a 5-line fix that deletes a bug. More code is
                        often WORSE — it's more to maintain.

Commits per day       → rewards FREQUENCY, ignores size and worth. One engineer
                        squashes a feature into 2 clean commits; another splits
                        the same work into 40. The 40 "win." Nonsense.

Tickets/story points   → rewards CLOSING things, ignores whether the right things
                        got built, or whether estimates were just inflated.

Hours worked          → rewards PRESENCE, ignores everything that matters. The
                        person who fixed it in an hour "loses" to the one who
                        flailed for eight.
```

Every one of these measures **activity or volume** and calls it **productivity**. The gap between those two words is where the damage lives. Worse, the moment people *know* they're judged by one of these numbers, they optimize the number instead of the work — split commits, pad estimates, write verbose code. (That failure mode has a name, Goodhart's law, and its own page: [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md).)

> **Key insight:** A single productivity metric isn't just *incomplete* — it's *actively misleading*, because it presents one narrow slice as the whole picture, and because people will optimize whatever you measure. The fix isn't a *better* single number. There is no better single number. The fix is to look at **several dimensions at once** so that gaming or distorting one becomes visible in the others.

---

## Core Concept 2 — The Five Dimensions of SPACE

SPACE says: instead of one number, look at productivity from **five different angles**. No single dimension is "the real one" — they're meant to be read *together*, the way you'd judge a car by speed *and* safety *and* fuel economy, not by any one alone. Here are the five, in plain terms, each with one concrete example metric.

**S — Satisfaction & wellbeing.** Are developers happy with their work, their tools, and their team — and are they sustaining a healthy pace, not burning out? This is about how people *feel*, and you usually measure it by *asking* them.
> *Example metric:* a survey question — *"How satisfied are you with the tools and processes you use to do your job?"* (1–5), or a periodic burnout / "would you recommend this team as a place to work?" pulse.

**P — Performance.** The *outcome* of the work — did what the team produced actually work and deliver value? Crucially, this is about *results*, not effort or output volume.
> *Example metric:* change failure rate (what fraction of deploys cause an incident), or customer-reported defect rate, or a feature's actual adoption versus what was expected.

**A — Activity.** Counts of the things developers do: commits, pull requests opened, code reviews completed, builds run, documents written. These are genuinely useful as *context* — but, as the next concept hammers home, dangerous when read as productivity on their own.
> *Example metric:* number of pull requests merged per week (team-level), or count of deployments.

**C — Communication & collaboration.** How well does the team work *together*? How discoverable is knowledge, how healthy is the review process, how easily can someone find the answer or the right person?
> *Example metric:* code-review turnaround time (how long a PR waits for first review), or the share of PRs that get a meaningful review, or how quickly newcomers find what they need.

**E — Efficiency & flow.** Can a developer make steady progress with minimal interruptions, hand-offs, and waiting? This is about the *system* getting out of the developer's way — few context-switches, short waits, little blocking.
> *Example metric:* the amount of uninterrupted "focus time" per day, or how much of a task's total time is spent *waiting* (on a review, a build, an approval) versus actively worked on.

```
S  Satisfaction & wellbeing  →  Are devs happy and not burning out?      (ask them)
P  Performance               →  Did the work produce good outcomes?      (results)
A  Activity                  →  Counts of things done                    (commits, PRs)
C  Communication & collab    →  How well does the team work together?    (reviews, sharing)
E  Efficiency & flow         →  Can devs make progress without waiting?  (focus, wait time)
```

> **Key insight:** The five dimensions are deliberately *different kinds* of things — feelings (S), outcomes (P), counts (A), teamwork (C), and flow (E). That variety is the point. Each one catches what the others miss. A team can be churning out activity (A) while quietly burning out (S) and shipping bugs (P) — and only by looking across dimensions do you see the whole, honest story.

---

## Core Concept 3 — Activity Is the Most Misleading Dimension

Of the five, **Activity** deserves a warning label, because it's the one almost every broken metric is secretly made of. Activity is *easy* — commits, PRs, and lines of code are sitting right there in your Git history, free to count, no survey required. That ease is exactly the trap: because activity is the simplest thing to measure, it's the thing people measure, and then mistake for productivity.

Here is the core problem in one line: **more activity is not more value.**

- More commits can mean a developer split one change into many — or that they're thrashing, repeatedly trying and reverting because the task is poorly understood.
- More lines of code can mean more *features* — or more *copy-paste*, more bloat, more to maintain and to break. The best fix often *deletes* code.
- More pull requests can mean steady delivery — or work being chopped into artificially tiny pieces to make a chart go up.

Activity tells you *that things happened*, never *whether the right things happened* or *whether they were any good*. A developer can have a spectacular activity week — 60 commits, 12 PRs, 2,000 lines — and have built the wrong feature, introduced three bugs, and left teammates blocked the whole time. The activity numbers will glow green.

This doesn't mean activity is useless. It's valuable as **context** and as a *signal of change*: a sudden drop in deployments might hint the pipeline is broken; a spike in reverts might hint at instability. But activity is a flashlight, not a verdict — it shows you where to *look*, never what something is *worth*.

> **Key insight:** Activity is the easiest dimension to measure and the easiest to misuse — and those two facts are the same fact. Treat every activity count as a *question* ("why did commits spike?"), never an *answer* ("commits are up, so we're productive"). The instant an activity number becomes a target — a quota, a review score — people will inflate it, and you'll have taught your team to be busy instead of effective.

---

## Core Concept 4 — Pick Across Dimensions, Including Feelings

SPACE doesn't ask you to measure all five dimensions exhaustively — that would drown you. The actual guidance is sharper and more practical: **pick a small set of metrics that spans *several* dimensions, and make sure at least one captures how developers *feel*.** Two or three dimensions, chosen well, beat one dimension measured in obsessive detail.

Why *across* dimensions? Because dimensions **check each other**. Watch what one dimension hides and another reveals:

- Activity (A) is up, but Satisfaction (S) is cratering → you're shipping volume by burning people out. Unsustainable; you'll pay for it in attrition.
- Performance (P) is great, but Efficiency (E) is terrible → the team delivers good outcomes *despite* constant interruptions and waiting. Imagine what they'd do if you fixed the flow.
- Activity (A) and Performance (P) both look fine, but Communication (C) is poor → output depends on one or two heroes; knowledge isn't shared, and you have a bus-factor problem waiting to bite.

A single dimension can't expose any of these. *Pairs and triples* can.

And the most-skipped piece: **perceptual metrics** — measures of how developers *feel* and *perceive* their work, gathered by *asking* them, usually with a short survey. Organizations love system metrics (counts from tools) because they're automatic, and they routinely ignore perceptual ones because asking feels "soft." This is backwards. Developers *know* things the tools can't see — that the build is painfully slow, that the on-call rotation is brutal, that reviews sit ignored for days. A two-question survey often surfaces a productivity-killer that no dashboard would ever catch.

> **Key insight:** A healthy SPACE picture is a *small basket* of metrics drawn from *different dimensions*, with **at least one perceptual (how-they-feel) signal** in the basket. The dimensions cross-check each other so no single number can quietly lie to you — and the perceptual signal catches the human problems (burnout, friction, frustration) that system metrics are blind to.

---

## Core Concept 5 — SPACE Measures Teams, Not Individuals

This is the rule that, broken, does the most harm — so internalize it now: **SPACE is designed to measure teams and systems, not to rank individuals.** The framework's own authors are explicit that turning these dimensions into a per-person scorecard is a misuse.

Why is individual measurement so dangerous here?

1. **Software is a team sport.** A feature ships because someone wrote it, someone reviewed it, someone tested it, someone fixed the pipeline, and someone answered a question in chat. Attribute the outcome to one person's commit count and you've erased everyone whose contribution doesn't show up as a commit — the reviewers, the mentors, the unblockers.

2. **It destroys collaboration.** The moment people are *ranked* against each other on activity, helping a teammate becomes a cost — it raises *their* number, not yours. Code review, pairing, knowledge sharing — the Communication dimension itself — all quietly collapse, because the metric rewards hoarding work, not sharing it.

3. **Individuals are too small a sample, full of noise.** One person's week is dominated by what landed on their plate — a gnarly bug, a week of on-call, a hard design problem with little code to show. At the *team* level, that noise averages out and trends become meaningful. At the individual level, you're mostly measuring luck and circumstance.

4. **It punishes exactly the work you most want.** The senior engineer who spends a week unblocking four teammates and mentoring a junior produces *few commits* and *huge value*. An individual activity metric marks them as your *least* productive person. You will have built a machine that penalizes your best contributors.

> **Key insight:** SPACE answers *"how is this team and its system doing?"*, never *"who is my best/worst developer?"* The instant you point a SPACE metric at one person — especially an activity metric, and *especially* in a performance review — you stop measuring productivity and start corrupting it: you teach people to optimize their personal numbers at the expense of the team. Measure the team; improve the system.

---

## Real-World Examples

**1. The commit-count leaderboard that broke a team.** A manager, wanting to "reward top performers," posts a weekly leaderboard of commits per engineer. Within a month, behavior shifts: people stop pairing (it splits credit), stop reviewing promptly (reviews don't count), and start splitting work into tiny commits to climb the board. Activity (A) soars; Communication (C) and Satisfaction (S) quietly collapse; outcomes (P) don't improve at all. The single number went *up* while the team got *worse* — the exact failure SPACE predicts when you measure one dimension, on individuals.

**2. The "high-performing" team that was burning out.** A team's dashboards look fantastic — deployments up, PR throughput up. Leadership is thrilled. Then two senior engineers quit in the same month. A belated satisfaction survey (the perceptual signal nobody had been collecting) reveals the team had been crunching for a quarter to hit those numbers. Activity (A) and even Performance (P) were green; Satisfaction (S) was deep red — and because no one measured S, the whole thing looked healthy until it wasn't. A single S-dimension question would have caught it months earlier.

**3. The slow review that no count could see.** A team's activity and output metrics are unremarkable, so leadership assumes the team is "just average." A quick survey asks one question: *"What slows you down most?"* The overwhelming answer — *pull requests sit unreviewed for two or three days*. That's an Efficiency/flow (E) and Communication (C) problem, invisible in any activity count, surfaced instantly by a perceptual metric. They set a "first review within four hours" norm; lead time drops and satisfaction rises. The fix came from a *feeling*, not a dashboard.

---

## Mental Models

- **Productivity is a dashboard, not a speedometer.** A car has speed, fuel, temperature, and oil-pressure gauges — and you'd never judge a road trip by speed alone. Developer productivity is the same: SPACE is the dashboard, and any one gauge read in isolation will eventually drive you off a cliff.

- **Activity is a flashlight, not a verdict.** Activity counts show you *where to look* — a spike, a drop, a strange pattern worth investigating. They never tell you what something is *worth*. Point the flashlight; don't mistake it for the judge.

- **The five dimensions are checks and balances.** Like branches of a government, no single dimension gets absolute power. Activity is held in check by Satisfaction; Performance is held in check by Efficiency. When one tries to lie ("look how busy we are!"), another exposes it ("...and everyone's burning out").

- **Perceptual metrics are the smoke detector.** Tools see what already happened in the code. Developers *feel* the fire — the slow build, the brutal on-call, the ignored reviews — often before it shows up anywhere measurable. Asking them is the cheapest early-warning system you have, and the one orgs most often switch off.

- **Measure the orchestra, not the violinist.** You judge an orchestra by the music it makes together, not by counting each player's notes. Counting one musician's notes would just reward whoever plays fastest, not whoever makes it beautiful. SPACE measures the music — the team — on purpose.

---

## Common Mistakes

1. **Reducing productivity to one number anyway.** "We'll just track velocity / commits / LOC." Every single-number scheme measures one slice (usually activity) and hides the rest. The whole point of SPACE is that no such number exists — pick across dimensions instead.

2. **Treating activity counts as productivity.** More commits, PRs, or lines is *more activity*, not more value — and often the opposite (bloat, thrashing, work chopped fine to inflate a chart). Read activity as a *question to investigate*, never an *answer*.

3. **Measuring individuals.** Pointing SPACE at one person — especially activity, especially in a review — destroys collaboration, punishes unblocking and mentoring, and measures mostly noise. SPACE is for *teams and systems*.

4. **Skipping the perceptual (feelings) dimension.** Ignoring Satisfaction because asking feels "soft" means missing burnout and friction entirely — the very problems that tank productivity and that no tool-based metric can see.

5. **Picking metrics all from one dimension.** Five activity metrics is still *one dimension* — you've just measured the same narrow slice five ways. Spread your picks across *several* dimensions so they cross-check each other.

6. **Using SPACE to judge and reward instead of to learn and improve.** The instant a SPACE metric becomes a target for rewards or punishment, people optimize the number, not the work (Goodhart's law). SPACE is a lens for *improvement conversations*, not a stick — see [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md).

---

## Test Yourself

1. Name the five SPACE dimensions and, in one phrase each, say what they measure.
2. Your lead proposes ranking engineers by commits per week to find "top performers." Give two distinct reasons this is a bad idea.
3. Why is Activity called the most misleading dimension? Give one example of more activity meaning *less* value.
4. What is a *perceptual* metric, and why does SPACE insist you include at least one?
5. A team's deployment and PR-throughput numbers look great, yet two seniors just quit. Which SPACE dimension was probably being ignored, and how would you have caught the problem earlier?
6. Is SPACE meant to measure individuals or teams? Defend your answer in one sentence.

<details>
<summary>Answers</summary>

1. **S**atisfaction & wellbeing (are devs happy / not burning out — how they *feel*); **P**erformance (the *outcome* — did the work deliver value); **A**ctivity (counts of things done — commits, PRs); **C**ommunication & collaboration (how well the team works together — reviews, knowledge sharing); **E**fficiency & flow (can devs progress without interruptions and waiting).
2. Any two of: (a) it's an *activity* count, so it rewards volume, not value, and people will game it by splitting commits; (b) it measures *individuals*, which destroys collaboration (helping a teammate no longer "counts") and punishes high-value low-commit work like reviewing and unblocking; (c) one person's week is mostly noise — luck and what landed on their plate.
3. Because it's the easiest thing to measure (it's right there in Git), it's the thing people measure and then mistake for productivity — yet **more activity is not more value**. Example: more lines of code can mean copy-paste and bloat (more to maintain and break), and the best fix often *deletes* code.
4. A measure of how developers *feel* or *perceive* their work, gathered by *asking* them (a survey) rather than counting tool output. SPACE insists on one because developers can sense productivity-killers — slow builds, burnout, ignored reviews — that no tool-based metric can see.
5. **Satisfaction & wellbeing (S).** Activity (A) and Performance (P) were green while the team crunched itself into burnout; a periodic satisfaction/burnout survey — even one question — would have surfaced the red months earlier.
6. **Teams.** Software is collaborative, individual numbers are noisy and punish unblocking/mentoring, and ranking people on these metrics corrupts the very collaboration that produces good work.

</details>

---

## Cheat Sheet

```
THE BIG IDEA
  Productivity is NOT one number. One metric measures one slice and hides
  the rest — and people game whatever you measure. Look at FIVE dimensions.

THE FIVE DIMENSIONS (SPACE)
  S  Satisfaction & wellbeing  happy? not burning out?      ASK them (survey)
  P  Performance               did the OUTCOME deliver value? results, not effort
  A  Activity                  counts: commits, PRs, builds  context, NOT a verdict
  C  Communication & collab    teamwork, reviews, knowledge  how well they work together
  E  Efficiency & flow         progress without interruption focus time, wait time

THE TWO BIG LESSONS
  1. Activity ALONE is misleading   more commits / LOC ≠ more value
  2. Pick across SEVERAL dimensions including at least one PERCEPTUAL (feelings) one

WHO IT MEASURES
  TEAMS and SYSTEMS — never an individual leaderboard.
  Measuring individuals destroys collaboration & punishes unblocking/mentoring.

HOW TO READ A METRIC
  activity number → a QUESTION ("why the spike?"), never an ANSWER
  one dimension up, another down → that's the honest story; look across

PURPOSE
  Measure to LEARN and IMPROVE the system — never to JUDGE and REWARD people.
```

---

## Summary

- **Productivity cannot be captured by one number.** Lines of code, commits, tickets, and hours each measure a single slice — usually activity or volume — and hide everything else; the moment they become targets, people game them. There is no "better single number."
- **SPACE names five dimensions to look at instead:** **S**atisfaction & wellbeing (are devs happy, not burning out — how they *feel*), **P**erformance (did the work deliver good *outcomes*), **A**ctivity (counts of things done), **C**ommunication & collaboration (how well the team works together), and **E**fficiency & flow (can devs progress without interruptions and waiting).
- **Activity is the most misleading dimension** — easiest to measure, easiest to misread. *More activity is not more value.* Treat every activity count as a question to investigate, never a verdict.
- **Pick a small basket of metrics across *several* dimensions, including at least one perceptual (how-they-feel) signal.** The dimensions cross-check each other so no single number can lie to you, and the perceptual signal catches human problems — burnout, friction — that tools can't see.
- **SPACE measures teams and systems, not individuals.** Pointing it at one person destroys collaboration, punishes high-value low-commit work like reviewing and mentoring, and measures mostly noise. Measure the team; improve the system.

You now have the core idea: productivity is a *dashboard*, not a speedometer. Everything deeper in this topic — choosing concrete metrics per dimension, combining SPACE with DORA and flow, and building a measurement program that resists gaming — builds on these five dimensions and the rule that you read them *together*.

---

## Further Reading

- *The SPACE of Developer Productivity* — Forsgren, Storey, Maddila, Zimmermann, Butler & Houck (ACM Queue, 2021). The original, and very readable. Read at least the introduction and the table of example metrics.
- *Accelerate* — Forsgren, Humble & Kim. The DORA companion to SPACE; explains why system-level, team-owned metrics beat individual ones.
- Martin Fowler — *CannotMeasureProductivity*. A short, blunt essay on why the single-number dream fails.
- *DevEx: What Actually Drives Productivity* — Noda, Storey, Forsgren & Greiler (2023). The developer-experience follow-up; deepens the Satisfaction and Efficiency dimensions.
- The [middle.md](middle.md) of this topic, which turns these five dimensions into concrete, defensible metrics and shows how to combine them with DORA.

---

## Related Topics

- [middle.md](middle.md) — choosing real metrics for each dimension, mixing perceptual + system + workflow signals, and pairing SPACE with DORA.
- [senior.md](senior.md) — designing and running a SPACE-based measurement program that drives improvement and resists gaming.
- [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) — the complementary delivery-performance metrics; DORA measures *delivery*, SPACE measures the broader human picture.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md) — *why* single numbers and individual measurement go wrong, and how metrics get gamed.
