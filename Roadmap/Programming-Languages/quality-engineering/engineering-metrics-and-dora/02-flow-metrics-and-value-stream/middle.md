# Flow Metrics & Value Stream — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Flow Metrics & Value Stream
> *The junior page told you work flows and queues are the enemy. This page gives you the instruments: the five Flow Framework metrics defined precisely, Little's Law as the equation that links them, value-stream mapping with real numbers, and the one question that decides where to spend your improvement budget — where is the constraint?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Flow Framework — Five Metrics, Defined Precisely](#the-flow-framework--five-metrics-defined-precisely)
4. [Flow Distribution — the Metric That Catches Starved Debt](#flow-distribution--the-metric-that-catches-starved-debt)
5. [Little's Law Applied to Flow](#littles-law-applied-to-flow)
6. [Value-Stream Mapping in Practice](#value-stream-mapping-in-practice)
7. [Theory of Constraints — Improve the Bottleneck, Nothing Else](#theory-of-constraints--improve-the-bottleneck-nothing-else)
8. [Reading a Cumulative Flow Diagram](#reading-a-cumulative-flow-diagram)
9. [Connecting Flow to DORA](#connecting-flow-to-dora)
10. [Worked Example — Map, Measure, Predict](#worked-example--map-measure-predict)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the Flow Framework metrics, and how do I use a value-stream map to find — and fix — the real bottleneck?**

At the junior level you learned the *intuitions*: work moves through stages, queues are where time disappears, and lots of work-in-progress makes everything slower. Correct, but unmeasurable. You can't run an improvement program on "feels slow."

This page turns those intuitions into numbers. Mik Kersten's **Flow Framework** (from *Project to Product*) defines five metrics that describe a value stream the way vital signs describe a patient: **Flow Velocity, Flow Time, Flow Efficiency, Flow Load, and Flow Distribution**. Behind them sits one equation — **Little's Law** — that ties work-in-progress, throughput, and time together so tightly that you can *predict* the effect of a change before you make it. And to know *which* change is worth making, you'll use **value-stream mapping** plus the **theory of constraints**, whose central, counter-intuitive claim is that optimizing anything other than the bottleneck is wasted effort. By the end you'll be able to draw a value-stream map with real numbers, read a cumulative flow diagram at a glance, and connect all of it back to the DORA metrics from [01](../01-dora-four-key-metrics/middle.md).

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can describe a value stream, WIP, and a queue/wait state.
- **Required:** You're comfortable with the four DORA metrics from [01 — DORA Four Keys](../01-dora-four-key-metrics/middle.md), especially lead time.
- **Helpful:** You've watched work move on a real Kanban board and seen items pile up in one column.
- **Helpful:** Arithmetic comfort with rates and averages — nothing beyond multiply and divide.

---

## The Flow Framework — Five Metrics, Defined Precisely

The Flow Framework measures **flow items** — the units of business value moving through a value stream. Kersten defines four item *types* (Features, Defects, Risks, Debt — more on these shortly) and five *metrics* that describe how those items flow. Precision matters here: each metric has an exact definition, and conflating them is the most common way teams misread their own data.

| Metric | Exact definition | What it answers | Unit |
|---|---|---|---|
| **Flow Velocity** | Flow items *completed* per unit time | How much value are we delivering? (throughput) | items / week |
| **Flow Time** | Elapsed time from when an item **starts** active work to **done** — *including all wait time* | How long does work actually take, start to finish? | days |
| **Flow Efficiency** | Active (value-add) time ÷ total Flow Time, as a % | How much of that time was real work vs waiting? | % |
| **Flow Load** | Flow items currently **in progress** (active or waiting) | How much work-in-progress is in the system? | items (WIP) |
| **Flow Distribution** | The *mix* of completed item types: Features / Defects / Risk / Debt | Where is our capacity actually going? | proportions |

Two definitions trip people up. **Flow Time** is wall-clock from work-start to done, *wait time included* — it is not "how many hours of effort." A two-day task that sat in a review queue for a week has a Flow Time of ~9 days. **Flow Velocity** is *completed* items only; work that's still in progress doesn't count, no matter how much effort has gone into it. This is deliberate: flow rewards *finishing*, not starting.

**Flow Efficiency** is the metric that exposes the truth most teams resist. If an item's Flow Time is 10 days but it was actively worked for only 2, its Flow Efficiency is 2 / 10 = **20%** — meaning 80% of the elapsed time was waiting in queues. Industry Flow Efficiency is shockingly low; figures of 5–15% are common, and even "good" knowledge-work streams often sit below 40%. The lesson is permanent: **most lead time is wait time, not work time.** You don't speed delivery primarily by making people type faster — you speed it by killing queues.

> **Key insight:** The five metrics aren't independent dials. Flow Load (WIP), Flow Velocity (throughput), and Flow Time are bound together by a law of nature — Little's Law — and Flow Efficiency tells you how much of your Flow Time is recoverable waste. Read them as a *system*, not a scorecard. A single metric in isolation lies.

---

## Flow Distribution — the Metric That Catches Starved Debt

The other four metrics describe *how fast* and *how much*. **Flow Distribution** describes *what you spent it on*, and it's the one most teams have never measured. Every completed item is one of four types:

- **Features** — new value for the customer. The work everyone wants to do.
- **Defects** — fixing quality problems. Visible, customer-facing.
- **Risks** — security, compliance, privacy, regulatory work. Invisible until it isn't.
- **Debt** — refactoring, upgrades, paying down architectural shortcuts. Invisible *and* unrewarded.

Flow Distribution is the percentage of capacity each type consumed over a period — say, "this quarter: 70% Features, 15% Defects, 10% Risk, 5% Debt." The power of the metric is that it makes an *invisible trade-off visible*.

Here's the trap it catches. A team under feature pressure runs a quarter at **95% Features, 5% everything else.** Velocity looks fantastic; the roadmap is flying. But Debt didn't go to zero because the *need* for it went to zero — it went to zero because it was **starved**. The architectural shortcuts taken to ship those features are still accruing. The bill is deferred, not cancelled. A few quarters of this and Flow Efficiency quietly drops (more rework, more coupling, slower changes), Defect rate climbs, and the same team that was "so productive" can no longer ship anything quickly. Flow Distribution is the early-warning instrument: an all-Features quarter is *visibly* an unsustainable quarter, and you can see it in the chart before you feel it in the velocity.

> **Key insight:** A quarter spent entirely on Features is not a productive quarter — it's a *loan*. Flow Distribution turns "we're not doing enough refactoring" from an opinion you have to argue into a number you can point at. There's no single correct mix, but a *flat zero* in Debt or Risk is always a deliberate decision to borrow, and it should be made deliberately.

This ties directly to [Technical Debt Management](../../technical-debt-management/): Flow Distribution is how you *budget* debt paydown and prove it's happening.

---

## Little's Law Applied to Flow

**Little's Law** is the most useful equation in all of flow metrics, and it requires no calculus. For any stable system (work arrives at roughly the rate it leaves, averaged over time):

```
WIP = Throughput × Flow Time
```

In Flow Framework terms:

```
Flow Load = Flow Velocity × Flow Time
```

Average work-in-progress equals the rate of completion times the average time each item spends in the system. It's true regardless of process, priority order, or task size — it's arithmetic, not a model you can argue with. Rearranged, it becomes a *lever*:

```
Flow Time = WIP / Throughput
```

This is the single most important consequence: **if your completion rate (throughput) is fixed, the only way to cut Flow Time is to cut WIP.** Pile more work into the system and Flow Time rises in lockstep; pull work *out* (lower WIP limits) and Flow Time drops — *without anyone working faster.* This is precisely why Kanban WIP limits work, and why "start less, finish more" is not a slogan but a theorem.

A concrete read: a team completes **10 items/week** (throughput) and carries **30 items in progress** (WIP). Little's Law gives Flow Time = 30 / 10 = **3 weeks**. Cut WIP to 15 with the *same* throughput and Flow Time falls to 15 / 10 = **1.5 weeks** — a 2× speedup from doing nothing but limiting how much you start. (The honest caveat: cutting WIP often *raises* throughput too, because less context-switching and less coordination overhead means people finish faster — so real-world gains usually beat the naive prediction.)

> **Key insight:** Little's Law makes flow *predictive*. You don't have to guess what WIP limits will do — you can compute it. The lever that's almost always available and almost always under-used is **reducing WIP**, because it cuts Flow Time even when you can't change anything about how the actual work gets done.

---

## Value-Stream Mapping in Practice

A **value stream** is the full sequence of steps to take a unit of value from request to delivered. **Value-stream mapping (VSM)** is the technique — borrowed from Lean manufacturing — for drawing that sequence and measuring where time goes. The method is mechanical:

1. **Map the stages.** List every step an item passes through, end to end: e.g. *Backlog → Analysis → Dev → Code Review → QA → Deploy → Done.* Be honest about the real path, including the steps nobody likes to admit exist.
2. **Measure two times per stage.** For each stage, capture **Process Time (PT)** — active, value-adding work — and **Wait Time (WT)** — time the item sits idle (in a queue, blocked, waiting for a handoff). These are different numbers and the gap between them is the whole point.
3. **Compute Flow Efficiency.** Sum all PT and all WT across the stream. Flow Efficiency = ΣPT / (ΣPT + ΣWT). This is the same Flow Efficiency from the framework, computed bottom-up from the map.
4. **Find the constraint.** The stage with the largest **Wait Time before it** (the biggest queue) is your bottleneck — work piles up *in front of* the slowest step. That queue, not the slow step's own duration, is usually where most of the lead time is hiding.

A small map with numbers:

```
Stage          Process Time   Wait Time (queue before stage)
─────────────────────────────────────────────────────────────
Analysis           1.0 d           0.5 d
Development        3.0 d           1.0 d
Code Review        0.5 d           4.0 d   ← huge queue before review
QA                 1.0 d           2.0 d
Deploy             0.5 d           0.5 d
─────────────────────────────────────────────────────────────
TOTALS  ΣPT = 6.0 d        ΣWT = 8.0 d

Total Flow Time = 6.0 + 8.0 = 14.0 days
Flow Efficiency = 6.0 / 14.0 = 43%
```

Read it: the team *works* an item for 6 days but it takes **14 days** to get through, because **8 of those days are spent waiting** — and **half of all waiting (4 days) is the queue before Code Review.** Note what the map reveals that intuition would not: Code Review's own Process Time is the *smallest* in the stream (0.5 d), yet it's the biggest source of delay, because items pile up waiting for a reviewer to be free. The slow part isn't the review — it's the *queue* for review. That distinction is the entire value of mapping.

> **Key insight:** Don't optimize the step with the longest *Process Time* — optimize the step with the longest *queue in front of it*. A map separates "this work is slow" from "this work waits," and they call for completely different fixes. The first needs better tools or smaller batches; the second needs more capacity, fewer handoffs, or a WIP limit.

---

## Theory of Constraints — Improve the Bottleneck, Nothing Else

Eli Goldratt's **Theory of Constraints (ToC)**, from *The Goal*, supplies the strategy for what to do with the map. Its central claim is blunt and frequently ignored: **a system's throughput is governed entirely by its single bottleneck (the constraint). Any improvement that is not at the constraint produces no improvement in the system at all — it is wasted.**

The plumbing metaphor is exact: the flow rate of a pipe is set by its narrowest section. Widening any *other* section changes nothing — water still backs up at the same narrow point. Worse, speeding up a stage *upstream* of the constraint actively harms you: it dumps work faster into the queue in front of the bottleneck, growing WIP and Flow Time without raising throughput one bit.

So the discipline is to **find the one constraint and pour all improvement effort there**, ignoring the temptation to optimize the stages that are already fast. In the map above, the constraint is Code Review (the 4-day queue). The high-leverage moves are all about *that* stage: add reviewers or rotate the duty, set a WIP limit that forces reviews to be pulled before new dev starts, shrink PR size so each review is faster, or automate the mechanical parts (linting, formatting) so humans review only what matters. Buying the team faster laptops to speed up Development — the stage with the most Process Time — would feel productive and accomplish *nothing*, because items would just wait longer in the review queue.

There's a second-order subtlety ToC insists on: once you fix the current bottleneck, **the constraint moves.** Relieve the review queue and suddenly QA's 2-day queue is the new constraint. Improvement is therefore never "done" — it's a loop of *find the constraint → fix it → find the next one.* Goldratt's five focusing steps formalize this (identify → exploit → subordinate everything else → elevate → repeat), but the engineering takeaway is simple: always be improving the *current* slowest point, and re-measure after every change because the slowest point will have changed.

> **Key insight:** Optimizing a non-bottleneck is not a small win — it's a *zero* win, and if it's upstream of the constraint, it's a *loss* (it inflates WIP). Spend your scarce improvement budget on the one stage with the biggest queue, then re-measure, because fixing it relocates the constraint somewhere new.

---

## Reading a Cumulative Flow Diagram

The **Cumulative Flow Diagram (CFD)** is the single chart that shows all of flow at once. The x-axis is time; the y-axis is the cumulative count of items. Each workflow stage is a coloured **band** stacked on top of the others, where each band's running total is the number of items that have *entered* that stage by that date. The result is a set of stacked, generally rising areas.

The skill is reading the *shapes*:

- **The vertical thickness of a band = the WIP currently in that stage.** A band that's getting *thicker over time* means items are entering that stage faster than they leave it — a **queue is growing.** This is your bottleneck, shown visually and continuously rather than from a one-time map.
- **The vertical gap between the top line and the bottom line = total WIP** in the whole system at that moment.
- **The horizontal distance across the bands at a given height = approximate Flow Time** (how long it took an item to traverse from "started" to "done"). Bands spreading apart horizontally means Flow Time is rising.
- **Parallel, roughly constant-width bands = a healthy, stable system** — work enters and leaves each stage at matched rates, so nothing is piling up.

So a CFD where one band — say "In Review" — steadily fattens while the others stay thin is the *same diagnosis* as the value-stream map's 4-day review queue, but live: you can watch the constraint form day by day instead of discovering it in a workshop. When you see any band *widening*, read it as "WIP and queue are growing here" and go look at that stage.

> **Key insight:** On a CFD, **widening bands are the alarm.** A band growing thicker means arrivals are outpacing departures at that stage — a queue is forming and Flow Time is climbing. Healthy flow looks like parallel ribbons of roughly constant width; a fattening band is the bottleneck announcing itself.

---

## Connecting Flow to DORA

Flow metrics and DORA metrics measure the same delivery system from two angles, and they reconcile cleanly:

- **Flow Time relates to DORA Lead Time.** Both measure elapsed time through the delivery process. The difference is where the clock starts: DORA's *lead time for changes* conventionally runs from **code committed → running in production**, while Flow Time can start earlier (at *work-start*, before the first commit) and covers the whole flow item. Think of DORA lead time as a *segment* of the broader Flow Time, focused on the commit-to-deploy portion. When you decompose lead time into stages — as [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/middle.md) does — you're doing value-stream mapping on the DORA clock.
- **Flow Velocity relates to DORA Deployment Frequency / throughput.** Both are completion-rate measures: how much finished work leaves the system per unit time.
- **Flow Distribution explains the *health* behind the DORA numbers.** DORA tells you the system is fast and stable *today*; Flow Distribution tells you whether that's *sustainable*. A team with great DORA metrics but a Flow Distribution showing zero Debt and zero Risk for several quarters is borrowing against its future — the architectural debt being starved will eventually drag lead time up and change-failure rate with it. Flow Distribution is the leading indicator that protects the DORA numbers from quietly rotting.

The practical synthesis: use **DORA** to measure outcomes (fast? stable?), use **flow** to diagnose *why* (where's the queue? what's starved?), and use **value-stream mapping + ToC** to decide *where to act*. They're complementary instruments on one dashboard, not rival frameworks.

> **Key insight:** DORA measures the *outcome* of your delivery system; flow metrics measure its *mechanics*. When a DORA number is bad, flow metrics tell you which stage to fix; when a DORA number is *good*, Flow Distribution tells you whether it'll stay that way. Don't pick one — pair them.

---

## Worked Example — Map, Measure, Predict

A team's lead time has crept to two weeks and leadership wants it halved. Instead of guessing, you map the stream and apply the math.

**Step 1 — Map and measure.** You instrument the board and gather two weeks of stage data:

```
Stage          Process Time   Wait Time
──────────────────────────────────────────
Analysis           1.0 d         0.5 d
Development        3.0 d         1.0 d
Code Review        0.5 d         4.0 d   ← biggest queue
QA                 1.0 d         2.0 d
Deploy             0.5 d         0.5 d
──────────────────────────────────────────
ΣPT = 6.0 d     ΣWT = 8.0 d
Flow Time = 14 d        Flow Efficiency = 6/14 = 43%
```

**Step 2 — Read the diagnosis.** Flow Efficiency is 43% — over half the time is waiting. The single largest queue is the **4 days before Code Review**, and the live CFD confirms it: the "In Review" band has been steadily fattening for two weeks while every other band holds constant width. By the theory of constraints, **Code Review is the constraint** — and note it has the *smallest* Process Time in the stream, so any instinct to "speed up coding" would have been pure waste.

**Step 3 — Confirm with Little's Law.** The team completes **5 items/week** (Flow Velocity) and currently carries **10 items in progress** (Flow Load). Sanity-check: Flow Time = WIP / Throughput = 10 / 5 = **2 weeks** — exactly the 14 days the map showed. The math and the map agree, which means your data is trustworthy.

**Step 4 — Predict the intervention.** The review queue is fed by too much concurrent work: with 10 items open, reviewers can never keep up, so PRs sit. You propose a **WIP limit that cuts Flow Load from 10 to 5**. Holding throughput constant, Little's Law predicts:

```
New Flow Time = WIP / Throughput = 5 / 5 = 1 week
```

A predicted **2 weeks → 1 week** — the halving leadership asked for — achieved *not* by anyone working faster but by *starting less so the review queue drains.* And the prediction is conservative: with fewer items in flight, reviewers context-switch less and finish reviews faster, so throughput will likely *rise* above 5/week, pushing Flow Time even lower than the predicted week.

**Step 5 — Re-measure and repeat.** After the change ships, you re-map. The review queue has shrunk, Flow Efficiency has climbed — but now the **2-day QA queue is the largest remaining wait.** The constraint moved, exactly as ToC predicts. The next improvement cycle targets QA, and you'll re-measure again after that. This is the engine: *map → find constraint → predict with Little's Law → fix → re-measure.* You never argued about it; you computed it.

---

## Mental Models

- **The five metrics are vital signs, not a scorecard.** Flow Velocity (pulse rate), Flow Time (how long a visit takes), Flow Efficiency (how much of the visit was treatment vs waiting room), Flow Load (how many patients in the building), Flow Distribution (what they're being treated for). You read them together to diagnose a system, never one alone to grade a person.

- **Little's Law is a thermostat for speed, and WIP is the dial.** Flow Time = WIP / Throughput. When you can't change how fast work gets done, you can *always* turn the WIP dial down — and Flow Time falls in proportion. Start less, finish sooner.

- **Most of lead time is the waiting room, not the operating table.** Flow Efficiency is usually low (often under 40%) because work spends most of its life in queues between stages, not being actively worked. Hunt queues, not keystrokes.

- **The constraint is the narrow part of the pipe.** Throughput is set entirely by the bottleneck. Widening any other section moves nothing; widening an *upstream* section makes it worse by flooding the bottleneck's queue. Fix the narrow part, then find the new narrow part.

- **A CFD is the bottleneck on a live monitor.** Parallel ribbons = healthy. A band fattening over time = a queue forming = your constraint, announcing itself in real time.

---

## Common Mistakes

1. **Confusing Flow Time with effort.** Flow Time is wall-clock from work-start to done, *including all waiting.* An item with 2 days of effort that sat in a queue for a week has a Flow Time of ~9 days, not 2. Reporting effort hours as "how long it took" hides the queues that are your actual problem.

2. **Counting started work as velocity.** Flow Velocity counts *completed* items only. Half-done work is WIP (Flow Load), not throughput. A team "very busy" with everything in progress and nothing finished has high Load and low Velocity — a flashing warning, not a success.

3. **Optimizing the fast stage.** Pouring effort into a non-bottleneck produces *zero* system improvement; speeding up a stage *upstream* of the constraint makes things *worse* by inflating WIP. Always locate the constraint (biggest queue) first, and aim there.

4. **Reducing Flow Distribution to "more features = good."** A quarter at 95% Features looks productive and is actually a debt loan. Starved Debt and Risk don't disappear — they compound and surface later as falling Flow Efficiency and rising defects. Watch for a flat zero in any non-feature type.

5. **Adding people to go faster, ignoring WIP.** More people often means more concurrent work, which raises WIP, which (Little's Law) raises Flow Time. Capacity at a non-constraint stage just feeds the bottleneck's queue. Often the faster fix is to *lower* WIP, not raise headcount.

6. **Reading a CFD's bands as progress instead of queues.** A thickening band isn't "lots of healthy activity" — it's arrivals outpacing departures, i.e. a growing queue. Widening = alarm, not achievement.

---

## Test Yourself

1. Define Flow Time and Flow Efficiency precisely. If an item's Flow Time is 10 days and it was actively worked for 2, what's its Flow Efficiency, and what does that number tell you?
2. State Little's Law in flow terms. A team completes 8 items/week and carries 24 in progress — what's the average Flow Time? If they hold throughput and cut WIP to 12, what's the new Flow Time?
3. On a value-stream map, which stage is the constraint — the one with the longest Process Time, or the one with the longest queue in front of it? Why does the distinction matter?
4. A team posts excellent DORA metrics but its Flow Distribution has shown 0% Debt for four straight quarters. Why is that a problem the DORA numbers won't show yet?
5. On a cumulative flow diagram, what does a single band that's steadily getting thicker over time mean, and what should you do about it?
6. Why is speeding up a stage *upstream* of the bottleneck actively harmful rather than merely useless?

<details>
<summary>Answers</summary>

1. **Flow Time** = wall-clock from work-start to done, including all wait time. **Flow Efficiency** = active time ÷ total Flow Time. Here 2 / 10 = **20%** — meaning 80% of the elapsed time was spent waiting in queues, so the leverage for going faster is in killing queues, not working harder.
2. Little's Law: **Flow Load = Flow Velocity × Flow Time**, i.e. WIP = Throughput × Flow Time. Flow Time = 24 / 8 = **3 weeks.** Cut WIP to 12 at the same throughput: 12 / 8 = **1.5 weeks** — halved by starting less, with no one working faster (and likely better, since throughput tends to rise as WIP falls).
3. The constraint is the stage with the **longest queue in front of it**, not the longest Process Time. They call for different fixes: a long *Process Time* needs better tooling or smaller batches; a long *queue* needs more capacity, fewer handoffs, or a WIP limit. Optimizing the wrong one wastes the budget.
4. Debt at a flat 0% means refactoring/upgrades are being *starved*, not that none is needed. The architectural shortcuts keep compounding; the bill is deferred. Eventually Flow Efficiency drops and change-failure rate rises, dragging the DORA numbers down — but Flow Distribution shows the danger *now*, as a leading indicator, before DORA reflects it.
5. A steadily thickening band means items are entering that stage faster than they leave it — a **queue is growing** and that stage is the bottleneck. Go improve *that* stage (add capacity, set a WIP limit, shrink batch size), then re-measure, because fixing it will move the constraint elsewhere.
6. Because the system's throughput is capped by the bottleneck regardless. Speeding up an upstream stage just dumps work into the bottleneck's queue *faster*, raising WIP and Flow Time (Little's Law) while throughput stays flat. You've made flow worse, not better.

</details>

---

## Cheat Sheet

```
THE FIVE FLOW METRICS (Flow Framework, Kersten)
  Flow Velocity      items COMPLETED / time            (throughput)
  Flow Time          work-start → done, WAIT INCLUDED   (elapsed)
  Flow Efficiency    active ÷ total Flow Time           (usually <40% — most is wait)
  Flow Load          items IN PROGRESS                  (WIP)
  Flow Distribution  mix of Feature / Defect / Risk / Debt

LITTLE'S LAW (the equation that ties it together)
  WIP = Throughput × Flow Time      →      Flow Time = WIP / Throughput
  Lever: throughput fixed? cut WIP → cut Flow Time, no one working faster

VALUE-STREAM MAPPING (method)
  1 map stages   2 measure Process Time vs Wait Time per stage
  3 Flow Efficiency = ΣPT / (ΣPT + ΣWT)
  4 constraint = stage with the BIGGEST QUEUE before it (not biggest PT)

THEORY OF CONSTRAINTS (where to act)
  throughput is set by the ONE bottleneck
  improve the bottleneck   → real gain
  improve anything else    → ZERO gain
  improve UPSTREAM of it    → NEGATIVE (floods the queue, ↑WIP)
  fix it → constraint MOVES → re-measure → repeat

CUMULATIVE FLOW DIAGRAM (read the shapes)
  band thickness          = WIP in that stage
  band WIDENING           = queue growing  ← the alarm
  top-to-bottom gap       = total WIP
  horizontal span         ≈ Flow Time
  parallel constant bands = healthy

FLOW ↔ DORA
  Flow Time  ~ DORA lead time (DORA = commit→prod segment of it)
  Flow Velocity ~ deployment frequency / throughput
  Flow Distribution = is the good DORA score SUSTAINABLE? (starved debt = no)
```

---

## Summary

- The **Flow Framework** defines five metrics precisely: **Flow Velocity** (items completed / time), **Flow Time** (work-start → done, *wait included*), **Flow Efficiency** (active ÷ total time, usually low because most time is queue), **Flow Load** (WIP), and **Flow Distribution** (the Feature/Defect/Risk/Debt mix). Read them as a system, never one alone.
- **Flow Distribution** is the under-used metric that catches starved debt: an all-Features quarter isn't productive, it's a loan, and the chart shows it before the velocity does.
- **Little's Law** — `WIP = Throughput × Flow Time` — makes flow predictive. Its key lever: with throughput fixed, *cutting WIP cuts Flow Time proportionally*, with nobody working faster.
- **Value-stream mapping** measures Process Time vs Wait Time per stage, computes Flow Efficiency from the bottom up, and locates the constraint as the stage with the **biggest queue in front of it** — which is often *not* the stage with the most actual work.
- **Theory of constraints**: throughput is governed by the single bottleneck. Improving anything else yields zero gain; improving *upstream* of it is a loss. Fix the constraint, then re-measure, because fixing it moves the constraint.
- A **cumulative flow diagram** shows all of this live: widening bands are growing queues (the alarm); parallel constant-width bands are health.
- **Flow and DORA are complementary**: Flow Time maps to DORA lead time, Flow Velocity to deployment frequency, and Flow Distribution reveals whether a good DORA score is *sustainable* or borrowed against starved debt.

---

## Further Reading

- *Project to Product* — Mik Kersten. The Flow Framework's primary source: the five metrics, the four item types, and the flow-vs-project argument.
- *The Goal* — Eliyahu Goldratt. The theory of constraints as a novel; the bottleneck argument that underpins value-stream improvement.
- *Actionable Agile Metrics for Predictability* — Daniel Vacanti. Little's Law, Flow Efficiency, and reading CFDs and scatterplots rigorously.
- *Learning to See* — Mike Rother & John Shook. The original Lean value-stream-mapping workbook; where Process Time vs Wait Time comes from.
- *Accelerate* — Forsgren, Humble & Kim. For the DORA side of the flow↔DORA connection.

---

## Related Topics

- [junior.md](junior.md) — the intuitions this page formalizes: value streams, WIP, queues, wait states.
- [senior.md](senior.md) — instrumenting flow at scale, multi-stream portfolios, and the limits of the metrics.
- [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/middle.md) — decomposing the DORA clock stage-by-stage; value-stream mapping applied to commit→deploy.
- [01 — DORA Four Keys](../01-dora-four-key-metrics/middle.md) — the outcome metrics that flow diagnoses and protects.
- [Performance → Latency & Throughput](../../performance/03-latency-and-throughput/) — Little's Law and queueing applied to *running systems* rather than delivery pipelines; the same math, a different domain.
