# The DORA Four Keys — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The DORA Four Keys
> *Every team ships software. Some ship it daily and recover from outages in an hour; some ship it quarterly and spend a week firefighting when it breaks. Four numbers tell those two teams apart — and they measure the team and the system, never a person.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Four Keys, in Plain Terms](#core-concept-1--the-four-keys-in-plain-terms)
5. [Core Concept 2 — Speed and Stability: Two Groups, Not a Trade-Off](#core-concept-2--speed-and-stability-two-groups-not-a-trade-off)
6. [Core Concept 3 — The Performance Levels: Elite, High, Medium, Low](#core-concept-3--the-performance-levels-elite-high-medium-low)
7. [Core Concept 4 — These Measure the Team and the System, Never an Individual](#core-concept-4--these-measure-the-team-and-the-system-never-an-individual)
8. [Core Concept 5 — Where the Four Keys Came From](#core-concept-5--where-the-four-keys-came-from)
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

> Focus: **What are the four numbers that measure how well a team ships software?**

Ask ten engineers "is your team good at shipping software?" and you'll get ten gut feelings. Ask "*how do you know?*" and the room goes quiet. People reach for the things that are easy to count — lines of code, number of commits, story points burned — and every one of those measures *activity*, not *delivery*. A team can write a million lines and ship nothing useful, slowly, that breaks constantly.

The **DORA four keys** are the research-backed answer to "how well does this team actually deliver?" They are four numbers, and only four, that years of studying tens of thousands of engineers found genuinely separate great delivery teams from struggling ones:

1. **Deployment Frequency** — how *often* you ship to production.
2. **Lead Time for Changes** — how *long* it takes a change to go from "committed" to "running in production."
3. **Change Failure Rate** — what *percentage* of your deployments cause a problem that needs a fix.
4. **Time to Restore Service** — how *fast* you recover when something does break.

That's the whole list. No leaderboard, no "productivity score," no counting keystrokes. Two of these measure how *fast* you move; two measure how *stable* you are when you do. The single most surprising finding — and the one this whole page is built around — is that fast teams are not reckless teams. The best teams are *better at both at once*. Speed and stability are not a see-saw where pushing one down lifts the other. They rise together.

> **The mindset shift:** stop thinking "we can either move fast *or* be safe — pick one." The data says the opposite: the teams that deploy most often *also* have the lowest failure rates and the fastest recovery. Speed and stability are two sides of the same capability — good engineering practices make you both faster *and* safer at the same time.

This page teaches you what each number means in plain language, why they come in two groups, what "Elite" versus "Low" performance looks like, and the one rule you must never break: **these measure a team and its delivery system — never an individual person.**

---

## Prerequisites

- **Required:** You know what it means to **deploy** or **release** software — to put a change in front of real users (a website goes live, an app update ships, an API gets updated).
- **Required:** You've used **version control** (Git) and understand "committing" a change — saving it to the shared history of the project.
- **Helpful:** You've been on a team (or a class project) where shipping was painful — a release took all day, or something broke in production and nobody knew how to fix it fast. You'll recognize the symptoms these metrics expose.
- **Helpful:** You've heard "we need to move faster" and "we can't, it's too risky" argued in the same meeting. The four keys are how that argument gets settled with data.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Production** | The live environment real users touch — not your laptop, not staging. "In prod" means "real people can hit it." |
| **Deploy / deployment** | The act of putting a change into production. One deploy = one push of changes to the live system. |
| **Deployment Frequency** | How *often* the team deploys to production (e.g. "20 times a day" or "once a quarter"). |
| **Lead Time for Changes** | The time from a change being *committed* to that change *running in production*. Measures pipeline speed, not how long someone coded. |
| **Change Failure Rate (CFR)** | The *percentage* of deployments that cause a failure needing remediation — a hotfix, rollback, or patch. |
| **Time to Restore Service** | How long it takes to *recover* from a failure in production — from "it broke" to "it works again." |
| **MTTR** | "Mean Time To Restore/Recover" — the common shorthand for Time to Restore Service. Same idea: average recovery time. |
| **Remediation** | Any fix made *because* a deploy caused a problem — a rollback, a hotfix, a config patch. The thing CFR counts. |
| **The four keys** | The collective name for the four DORA metrics together. |

---

## Core Concept 1 — The Four Keys, in Plain Terms

Forget the jargon for a moment. Imagine watching one team for a month. You could describe how they ship with four honest questions:

**1. Deployment Frequency — "How often do you ship to production?"**

Count how many times the team pushes a change to the live system. That's it. A team practicing modern delivery might deploy *many times a day*. A team with a heavy, manual release process might deploy *once a month* or *once a quarter*.

```
Team A:  ███████ ████ ███████ ...   → deploys multiple times per day
Team B:  █                  █        → deploys once a quarter
```

Why it matters: frequent, small deploys are *safer*, not riskier. A change you ship five minutes after writing it is tiny — if it breaks, you know exactly what broke. A change that sat for three months bundles a hundred risky things together, and when it breaks, *good luck finding which one*.

**2. Lead Time for Changes — "Once you commit a change, how long until users have it?"**

Start the clock when the code is committed. Stop it when that exact change is live in production. The gap is your lead time. It captures everything *after* the code is written: code review, testing, the CI pipeline, the deploy process, and all the *waiting* in between.

```
commit ──[ review ]──[ tests ]──[ CI build ]──[ wait for release window ]──[ deploy ]──► live
└──────────────────────  lead time for changes  ─────────────────────────────────────┘
```

A short lead time (minutes to hours) means a fix or feature reaches users almost immediately. A long lead time (weeks) means even an *urgent one-line fix* crawls through the pipeline. Note carefully: this is **not** "how long the developer spent typing." It's how long the *system* takes to deliver a finished change.

**3. Change Failure Rate — "What fraction of your deploys cause a problem?"**

Of all the times you deployed, what percentage caused a failure that needed a fix — a rollback, a hotfix, a patch? If you deployed 100 times and 5 of them caused incidents, your change failure rate is **5%**.

```
CFR = (deployments that caused a failure)  ÷  (total deployments)
    = 5 bad deploys ÷ 100 deploys = 5%
```

This is a *rate*, not a count — which is the whole point. A team that deploys 1,000 times with 50 incidents (5%) is *more* reliable than a team that deploys 10 times with 3 incidents (30%), even though the first team had more total incidents. You're measuring the *quality of each deploy*, not punishing teams for shipping often.

**4. Time to Restore Service — "When it breaks, how fast are you back?"**

Things *will* break — in every system, at every company, forever. What separates teams is not whether they have incidents; it's how fast they *recover*. Measure the time from "a failure starts affecting users" to "service is healthy again."

```
incident starts ──[ detect ]──[ diagnose ]──[ fix / roll back ]──► recovered
└──────────────────  time to restore service  ─────────────────────┘
```

An elite team might recover in *under an hour* — often by simply rolling back the small change they shipped minutes ago. A struggling team might take *days*, because they don't know what changed, can't roll back safely, and have no fast path to deploy a fix.

> **Key insight:** Notice that two of these are about *going forward* (deploy often, deliver quickly) and two are about *handling trouble* (fail rarely, recover fast). A team is not "good" because it scores well on one. It's good when all four are healthy together — when it ships fast *and* stays stable. Hold that thought; it's the next concept.

---

## Core Concept 2 — Speed and Stability: Two Groups, Not a Trade-Off

The four keys split cleanly into two pairs:

| Group | Metrics | Question it answers |
|---|---|---|
| **Speed (Throughput)** | Deployment Frequency + Lead Time for Changes | *How quickly can we deliver change to users?* |
| **Stability** | Change Failure Rate + Time to Restore Service | *How well do we stay reliable while doing it?* |

Most people's intuition says these two groups *fight* each other: "If we ship faster, we'll break things more. If we want stability, we have to slow down." This feels obviously true. It is one of the most important findings in software engineering that **it is false**.

The DORA research — looking across tens of thousands of professionals over many years — found that speed and stability are **positively correlated**. The teams that deploy most frequently and have the shortest lead times *also* tend to have the *lowest* change failure rates and the *fastest* recovery. Going fast does not buy you instability; in fact, the practices that make you fast (small changes, automated tests, automated deploys, fast rollback) are the *same practices* that make you stable.

Here's the intuition for *why*:

- **Small batches are safer.** Shipping often forces each change to be small. A small change is easy to review, easy to test, and — if it breaks — easy to identify and undo. The team that ships once a quarter is forced to ship *huge* batches, which are hard to reason about and dangerous to release.
- **Automation cuts both directions.** An automated test suite and deploy pipeline make you *faster* (no manual gatekeeping) *and* *safer* (consistent, repeatable, no human forgetting a step).
- **Fast recovery comes from the same muscles as fast delivery.** If you can deploy in minutes, you can also *fix* in minutes. The team that can't deploy quickly also can't recover quickly — recovery usually *means* deploying a fix or a rollback.

```
        THE MYTH                          THE REALITY
   speed  ◄──── see-saw ────►  stability       speed  ──┐
   (push one down,                                       ├──► good practices lift BOTH
    the other goes up)                          stability ┘
```

> **Key insight:** "Move fast and break things" and "go slow to be safe" are *both wrong*. The real choice isn't speed *versus* stability — it's whether you have the engineering practices that give you *both*, or neither. Low performers are slow *and* unstable. Elite performers are fast *and* stable. They are not making a different trade-off; they are operating at a different level of capability.

This is why the four keys are always reported as a *set*. A team bragging "we deploy 50 times a day!" while quietly rolling back a third of those deploys is not elite — its speed is real but its stability is broken. The four keys keep you honest by refusing to let you optimize one group while wrecking the other.

---

## Core Concept 3 — The Performance Levels: Elite, High, Medium, Low

To make the numbers meaningful, the DORA research groups teams into four performance levels — **Elite, High, Medium, Low** — based on how all four keys cluster together. These aren't arbitrary grades; they're *clusters* the data naturally falls into. Real teams tend to be uniformly fast-and-stable or uniformly slow-and-unstable, which is exactly why the levels work.

Here's the rough shape of what each level looks like (exact thresholds shift year to year as the whole industry improves — treat these as orders of magnitude, not exam answers):

| Metric | **Elite** | **High** | **Medium** | **Low** |
|---|---|---|---|---|
| **Deployment Frequency** | On-demand, many times a day | Daily to weekly | Weekly to monthly | Monthly or less (often quarterly) |
| **Lead Time for Changes** | Less than an hour | A day to a week | A week to a month | A month or more |
| **Change Failure Rate** | Low (≈ 0–15%) | Low–moderate | Moderate | High |
| **Time to Restore Service** | Less than an hour | Less than a day | A day to a week | A week or more |

Read across the **Elite** row and across the **Low** row, and you can *feel* the two-groups insight from the last concept: Elite isn't just fast, it's fast-*and*-stable; Low isn't just slow, it's slow-*and*-fragile. The columns move together.

A few things matter more than memorizing the table:

- **The gap between top and bottom is enormous.** An elite team's lead time is measured in *hours* and a low performer's in *months* — that can be a difference of *thousands of times*. This is not a 10% efficiency story; it's a different category of operation.
- **The bands shift over time.** What counted as "Elite" a few years ago is closer to "High" today, because the whole industry keeps raising the bar with better tooling and practices. Don't anchor on a specific number; anchor on the *direction*.
- **Your goal is not a label — it's a trend.** Knowing you're "Medium" is far less useful than knowing your lead time dropped from three weeks to four days over a quarter. The levels are a *map*, not a scoreboard. (More on this trap in [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md).)

> **Key insight:** The performance levels exist to answer "where are we, roughly, and what does 'better' look like?" — not to slap a grade on a team and move on. The value is in *moving up over time*, and especially in seeing all four keys improve *together*. A team that doubled its deploy frequency while its failure rate also climbed didn't improve — it just got faster at breaking things.

---

## Core Concept 4 — These Measure the Team and the System, Never an Individual

This is the single most important rule in this entire roadmap, and it's worth stating bluntly: **the four keys measure a team and its delivery system. They are meaningless — and harmful — when pointed at a person.**

Look back at each metric and ask "whose number is this?":

- **Deployment Frequency** depends on the build pipeline, the release process, the test suite, the approval gates — *system* properties the whole team shares.
- **Lead Time for Changes** is dominated by *waiting*: code sitting in a review queue, builds queued behind other builds, changes parked until the next release window. None of that is one developer's "speed."
- **Change Failure Rate** is a property of the team's practices — its testing, its review culture, its deploy safety. Blaming the person who happened to click "deploy" on the failing change is like blaming the last person to touch a wobbly tower.
- **Time to Restore Service** depends on monitoring, alerting, runbooks, rollback tooling, and on-call setup — *organizational* capabilities, not individual heroics.

Every one of these is shaped by the *system the team works in*, far more than by any individual's effort. That's not an accident — it's the whole design. DORA deliberately chose *outcome* metrics for the *delivery system* precisely so they couldn't be turned into a personal performance review.

The moment you try, two bad things happen:

1. **The metric stops describing reality.** A developer measured on personal deploy count will deploy trivial changes to pad the number. A team measured on change failure rate will simply stop reporting incidents, or redefine "failure" so nothing counts. The number goes "up"; the actual delivery gets *worse*. (This is **Goodhart's law** — "when a measure becomes a target, it ceases to be a good measure" — covered in [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md).)
2. **You destroy the behavior you wanted.** Tell people the four keys decide their bonus or their ranking, and they'll game the keys instead of improving delivery. You wanted faster, safer software; you got a leaderboard and a culture of hiding problems.

> **Key insight:** The four keys answer *"how is our delivery system doing, and what should we improve about it?"* — never *"who is the best engineer?"* The instant they're used to rank or reward individuals, people optimize the *number* instead of the *outcome*, and the metric becomes a lie. Measure the system to *improve the system*. The DORA mantra says it in one line: **"measure to learn and improve, not to judge and reward."**

If you remember nothing else from this page, remember this: a team's DORA numbers are a thermometer for the *delivery process*. You use a thermometer to decide whether to treat a fever — not to punish the patient for having one.

---

## Core Concept 5 — Where the Four Keys Came From

The four keys aren't someone's clever opinion. They come from the largest and most rigorous research program ever run on software delivery: the **DORA** program — *DevOps Research and Assessment* — and the book that made its findings famous, ***Accelerate*** (2018), by **Nicole Forsgren, Jez Humble, and Gene Kim**.

Here's why that origin matters when someone challenges the metrics:

- **It's based on surveying tens of thousands of professionals** across thousands of organizations over many years, through the annual *State of DevOps* reports. This isn't one company's experience — it's a broad, repeated, industry-wide study.
- **The researchers used real statistics**, not vibes. They specifically looked for measures that were both *meaningful* (they actually capture delivery performance) and *statistically valid* (they hold up under scrutiny). The four keys survived that filter; lines of code, commit counts, and story points did not.
- **The headline result is the speed-and-stability finding** from Concept 2: that throughput and stability go *together*, and that elite delivery performance is linked to better *business* outcomes too — more profitable, more productive organizations. In other words, getting these numbers healthy isn't just an engineering nicety; it correlates with the company doing better overall.

The program has continued long past the book — DORA still publishes updated reports each year, and the "Elite/High/Medium/Low" thresholds you saw earlier come from that ongoing research, which is exactly why they drift over time.

> **Key insight:** When someone dismisses the four keys as "just another framework," the honest answer is: these are the metrics that *survived* a decade of rigorous, large-scale research designed to find what actually predicts good software delivery. That's a very different thing from a consultant's slide. You don't have to take the four keys on faith — you can point to the research behind them.

You don't need to read *Accelerate* to use the four keys (though the [Further Reading](#further-reading) makes the case that you should). You just need to know they're earned, not invented — and to respect the one rule that the research itself insists on: use them to *improve a system*, never to *judge a person*.

---

## Real-World Examples

**1. The daily-deployer versus the quarterly-releaser.** Team A merges small changes and deploys to production several times a day; when a bad change slips through, they spot it within minutes and roll it back, recovering in well under an hour. Team B batches three months of work into one giant quarterly release; the release day is an all-hands, white-knuckle event, and when something breaks they spend *days* untangling which of the hundred bundled changes caused it. Same industry, same kind of product. Team A is *Elite*; Team B is *Low* — and notice it's not because Team B's engineers are worse. It's because Team A's *system* lets them ship small and recover fast, and Team B's doesn't. The four keys make that invisible difference visible.

**2. The "we're fast!" team that wasn't.** A team proudly reported deploying 40 times a day and demanded to be called elite. But their change failure rate was about 35% — more than one in three deploys caused an incident — and recovery routinely took half a day. Looking at deploy frequency *alone*, they looked elite. Looking at all four keys *together*, they were fast at shipping breakage. This is exactly why the keys are reported as a set: a single metric can flatter you; the four together can't.

**3. The metric that got weaponized — and broke.** An engineering manager started posting a per-developer "deployments this week" chart in a team channel, treating it as a productivity ranking. Within a month, deploy frequency had "doubled" — and delivery had gotten *worse*. Developers were splitting one real change into five trivial deploys to climb the chart, and people quietly stopped flagging incidents because a failed deploy hurt their standing. The number went up; reality went down. The team had to throw the chart out and re-anchor on *team-level trends used for retrospectives, not rankings*. A textbook lesson in why Concept 4 exists.

---

## Mental Models

- **The car dashboard.** Speed (deployment frequency, lead time) is your *speedometer* — how fast you're moving. Stability (change failure rate, time to restore) is your *brakes and airbags* — how safely you can move at that speed. A fast car with no brakes is a death trap; brakes with no engine goes nowhere. You want a car that's *both* fast and safe, and the dashboard shows you all four gauges at once.

- **Small batches = small blast radius.** Picture each deploy as a delivery truck. Ship many small trucks and if one crashes, you lose one small load and you know exactly which truck. Ship one enormous truck once a quarter and a crash loses everything *and* you can't tell what went wrong. Frequent deploys aren't reckless — they shrink the blast radius of every mistake.

- **The thermometer, not the verdict.** The four keys are a thermometer for your delivery *system*. A high fever (long lead time, high failure rate) tells you the system is sick and *where* to look. You treat the system; you don't blame the patient. The instant you use the thermometer to punish someone, they'll learn to hide the thermometer.

- **Speed and stability climb the same ladder.** Don't picture a see-saw with speed on one end and stability on the other. Picture a ladder both go up *together*: the rungs are good practices — small changes, automated tests, automated deploys, fast rollback. Climb the ladder and both rise. Elite teams are simply higher on the same ladder, not balanced differently on a see-saw.

---

## Common Mistakes

1. **Treating the four keys as four separate scores to win individually.** Bragging about deploy frequency while your failure rate is terrible isn't "elite at speed" — it's broken. The keys are a *set*; speed and stability must be read together, or the picture lies. (See Example 2.)

2. **Believing speed and stability trade off.** "We can't deploy more often, we'll break things" is the most common and most disproven assumption here. The research is clear: the practices that make you faster make you *more* stable. Slowing down to be "safe" usually makes you both slower *and* less safe.

3. **Pointing the metrics at individuals.** Per-developer deploy counts, "who caused the most failures" — these don't measure people, and using them guarantees gaming and hidden incidents. The keys measure the *system*. (See Concept 4 and Example 3.)

4. **Confusing lead time with coding time.** Lead Time for Changes is *commit → in production* — dominated by review queues, build queues, and release windows (waiting), not by how long someone typed. A long lead time is usually a *system* problem (slow pipeline, infrequent releases), not a "slow developer."

5. **Reading change failure rate as a count instead of a rate.** A team with 50 incidents across 1,000 deploys (5%) is *more* reliable than one with 3 incidents across 10 deploys (30%). Counting raw incidents punishes teams for shipping often — exactly backwards. It's a *percentage*.

6. **Chasing a level instead of a trend.** "Are we Elite or High?" matters far less than "is our lead time dropping and our failure rate steady or falling, quarter over quarter?" The levels are a rough map; *improvement over time* is the real goal. The bands themselves shift as the industry improves.

7. **Thinking incidents should be zero.** Every system breaks. Trying to drive change failure rate to absolute zero just teaches people to *stop deploying* (or stop reporting). The stability goal is "fail rarely and recover fast," not "never fail" — which is why *time to restore* is a key at all.

---

## Test Yourself

1. Name the four DORA keys, and for each say in one sentence what it measures.
2. Which two keys make up the **Speed** group, and which two make up the **Stability** group?
3. A teammate says: "If we deploy more often, our failure rate will obviously go up — speed and stability trade off." What does the DORA research actually say, and why?
4. Team X deploys 1,000 times a quarter with 60 incidents. Team Y deploys 20 times a quarter with 6 incidents. Which has the better change failure rate, and what is each rate?
5. Your manager wants to rank developers by their personal deployment frequency to find the "most productive" engineer. Give two reasons this is a bad idea.
6. Lead Time for Changes on your team is three weeks. A developer protests, "but I write my code in a day!" Reconcile these — what is lead time actually measuring?
7. Where did the four keys come from, and why does that origin make them more trustworthy than "lines of code" as a productivity measure?

<details>
<summary>Answers</summary>

1. **Deployment Frequency** — how often you ship to production. **Lead Time for Changes** — how long from a change being committed to it running in production. **Change Failure Rate** — what percentage of deploys cause a failure needing a fix. **Time to Restore Service** — how fast you recover after a failure.
2. **Speed:** Deployment Frequency + Lead Time for Changes. **Stability:** Change Failure Rate + Time to Restore Service.
3. The research found speed and stability are **positively correlated** — they go *together*, not against each other. The practices that make you fast (small changes, automated tests, automated deploys, fast rollback) are the *same* ones that make you stable. Elite teams are fast *and* stable; low performers are slow *and* unstable.
4. **Team Y has the better (lower) change failure rate.** Team X: 60 ÷ 1,000 = **6%**. Team Y: 6 ÷ 20 = **30%**. CFR is a *rate*, so Team X is far more reliable per deploy despite having ten times as many total incidents.
5. Any two of: (a) it measures an *individual* when the keys describe a *team and system*; (b) it invites gaming — people split work into trivial deploys to pad the count (Goodhart's law); (c) it makes the number go up while real delivery gets worse; (d) it encourages hiding problems and destroys the trust the metrics need.
6. Lead Time for Changes measures the *whole pipeline from commit to production* — code review waiting in a queue, builds queued, tests running, and especially *waiting for a release window*. The one day of coding is a tiny slice; the three weeks is the *system's* delay, not the developer's speed.
7. From the **DORA** research program and the book ***Accelerate*** (Forsgren, Humble, Kim), based on surveying tens of thousands of professionals over many years using rigorous statistics. That makes them *empirically validated* predictors of delivery performance — unlike lines of code, which measures activity, is trivially gamed, and never survived that kind of scrutiny.

</details>

---

## Cheat Sheet

```
THE FOUR KEYS
  SPEED (throughput)
    1. Deployment Frequency     how OFTEN you ship to prod
    2. Lead Time for Changes    commit → running in prod (how LONG)
  STABILITY
    3. Change Failure Rate      % of deploys that cause a problem
    4. Time to Restore Service  how FAST you recover (a.k.a. MTTR)

THE BIG INSIGHT
  speed and stability go TOGETHER, not against each other.
  elite teams are fast AND stable. low teams are slow AND unstable.
  good practices (small changes, automation, fast rollback) lift BOTH.

PERFORMANCE LEVELS (rough — bands shift over time)
  ELITE   deploy on-demand · lead time < 1 hr · low CFR · restore < 1 hr
  HIGH    deploy daily–weekly · lead time < 1 week
  MEDIUM  deploy weekly–monthly · lead time weeks
  LOW     deploy monthly/quarterly · lead time > 1 month · slow restore

THE ONE RULE
  measures the TEAM + SYSTEM — NEVER an individual.
  "measure to learn and improve, not to judge and reward."
  point them at a person → people game the number → metric becomes a lie.

CFR IS A RATE, NOT A COUNT
  60 bad / 1000 deploys = 6%  is BETTER than  6 bad / 20 deploys = 30%

WHERE THEY CAME FROM
  DORA research + the book ACCELERATE (Forsgren, Humble, Kim).
  surveyed tens of thousands of pros; statistically validated.
```

---

## Summary

- The **DORA four keys** are the research-backed numbers that measure how well a team delivers software: **Deployment Frequency** (how often you ship), **Lead Time for Changes** (commit → production), **Change Failure Rate** (% of deploys that break something), and **Time to Restore Service** (how fast you recover).
- They split into two groups: **Speed** (deployment frequency + lead time) and **Stability** (change failure rate + time to restore). The central, counter-intuitive finding is that these groups go *together*, not against each other — **elite teams are fast *and* stable**, because the same good practices (small changes, automated tests and deploys, fast rollback) improve both at once.
- Teams cluster into **Elite / High / Medium / Low** performance levels. The exact thresholds drift as the industry improves, so the goal is **improving the trend over time**, not chasing a label — and all four keys should improve *together*.
- The keys measure a **team and its delivery system — never an individual**. Pointed at a person, they get gamed and become lies; pointed at the system, they drive real improvement. The rule is: *measure to learn and improve, not to judge and reward.*
- They come from the **DORA** research program and the book ***Accelerate***, built on surveying tens of thousands of professionals with real statistics — which is why they're trustworthy in a way that lines of code, commit counts, and story points never were.

You now have the skeleton of how software delivery is measured. The rest of this roadmap goes deeper: how to *decompose* lead time and find where the delay hides, how reliability and quality metrics extend the stability story, and — crucially — how all of this goes wrong when you forget the one rule about individuals.

---

## Further Reading

- ***Accelerate: The Science of Lean Software and DevOps*** (Forsgren, Humble & Kim, 2018) — the book that defined and validated the four keys. The single most important text on this page; read at least Part I.
- **The annual *State of DevOps* / DORA reports** — the ongoing research the four keys and the performance levels come from. Read the latest year for current thresholds and findings.
- **Google's *DORA* site (dora.dev)** — the official, free home of the research, including a "DORA Quick Check" to see roughly where a team lands.
- The [middle.md](middle.md) of this topic, which gets precise about *measuring* each key (what counts as a "deploy," where to start the lead-time clock, how to compute CFR) and the data sources you pull them from.

---

## Related Topics

- [middle.md](middle.md) — how to actually *measure* each of the four keys: definitions, data sources, and the measurement gotchas.
- [senior.md](senior.md) — using the four keys to *drive improvement* across an org without corrupting them, and where they fall short.
- [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/junior.md) — zooming into the speed half: decomposing the pipeline to find where a change actually waits.
- [05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/junior.md) — the stability half in depth: change failure rate, recovery, SLOs, and the speed-vs-stability "false trade-off."
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md) — what goes wrong when you measure individuals, chase vanity numbers, or turn a metric into a target.
