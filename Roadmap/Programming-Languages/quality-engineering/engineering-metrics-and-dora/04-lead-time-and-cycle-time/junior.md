# Lead Time & Cycle Time — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Lead Time & Cycle Time
> *Two of the most useful words in software delivery — and two of the most confused. One measures the customer's wait. The other measures the team's working time. Mixing them up will quietly mislead every conversation you have about "how fast are we?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Lead Time vs Cycle Time](#core-concept-1--lead-time-vs-cycle-time)
5. [Core Concept 2 — Putting Both on a Timeline](#core-concept-2--putting-both-on-a-timeline)
6. [Core Concept 3 — DORA's "Lead Time for Changes"](#core-concept-3--doras-lead-time-for-changes)
7. [Core Concept 4 — Most of It Is Waiting](#core-concept-4--most-of-it-is-waiting)
8. [Core Concept 5 — Look at the Spread, Not Just the Average](#core-concept-5--look-at-the-spread-not-just-the-average)
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

> Focus: **How long does work take — and which clock are you actually reading?**

Somebody asks, "How long does it take us to ship a feature?" It sounds like a simple question. It isn't — because there are two honest, very different answers, and most teams accidentally give the wrong one.

The first answer is the **whole wait**: from the moment a customer (or a product manager, or a teammate) *asked* for the thing, to the moment it was actually *in their hands*. That's **lead time** — the customer's clock. It includes all the time the request sat in a backlog before anyone touched it.

The second answer is the **working time**: from the moment your team *started* on it, to the moment it was *done*. That's **cycle time** — the team's clock. It ignores the wait before work began.

These two numbers can differ wildly. A request might sit in a backlog for three weeks, then get built in two days. Lead time: 23 days. Cycle time: 2 days. Both are true. They answer different questions, and confusing them is the single most common mistake in this whole topic.

This page teaches you to keep the two clocks straight, place them on a shared timeline, and read what they're telling you. You'll also meet the DORA metric most people mean when they say "lead time" — and learn the uncomfortable truth that powers this entire field: **most of the time, nothing is happening.** The work is just *waiting*.

> **The mindset shift:** the clock includes the waiting, not just the typing. When you imagine how long a feature "takes," your instinct is to count the hours of coding. But from the customer's chair, the time the request spent ignored in a queue counts exactly as much as the time spent building it. Start measuring the whole wait, and the biggest, easiest improvements suddenly become visible.

---

## Prerequisites

- **Required:** You've worked on a task that went through stages — backlog → in progress → review → merged → deployed — even informally. (A ticket on a board is enough.)
- **Required:** You understand what a code review and a deployment to production are, roughly.
- **Helpful:** You've felt the frustration of a finished change sitting *waiting* — for a review, for a release window, for "the next sprint." That waiting is the star of this page.
- **Helpful:** You've seen the term "lead time for changes" in a DORA or DevOps context and weren't sure exactly where the clock starts and stops.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Lead time** | The **whole** wait, from when work is *requested* to when it's *delivered*. The customer's clock. Includes time in the backlog. |
| **Cycle time** | The **working** time, from when the team *starts* a task to when it's *done*. The team's clock. Excludes the backlog wait. |
| **Lead time for changes** | DORA's specific metric: from **code committed** to that code **running in production**. A *narrow slice* of the engineering pipeline — not the full request-to-delivery lead time. |
| **Queue time / wait time** | Time an item spends sitting idle, waiting for someone to pick it up (a backlog, a review queue, a release window). Nobody is working on it. |
| **Active / touch time** | Time someone is *actually* working on the item. Usually a small fraction of the total. |
| **Done / delivered** | "In the customer's hands" — for software, usually *running in production*, not "merged" or "code complete." |
| **Backlog** | The list of requested-but-not-yet-started work. Items here are accruing lead time but not cycle time. |

---

## Core Concept 1 — Lead Time vs Cycle Time

These are the two words people mix up, so let's nail them down before anything else.

**Lead time** is the **whole wait** as the *requester* experiences it. The clock starts when the work is **requested** (the ticket is created, the customer asks, the commitment is made) and stops when the work is **delivered** (it's live, in their hands). Crucially, this clock runs *even while the item is sitting untouched in a backlog*. The customer doesn't know or care that nobody has picked it up yet — to them, the wait is the wait.

**Cycle time** is the **working time** as the *team* experiences it. The clock starts when the team **starts working** on the item (it moves to "In Progress") and stops when it's **done**. It deliberately ignores the time before work began.

Here's the relationship in one line:

```
lead time  =  (time waiting in the backlog)  +  cycle time
```

Cycle time is *inside* lead time. Lead time is always greater than or equal to cycle time — it can never be smaller, because it includes everything cycle time includes, plus the wait that came before.

A quick way to remember which is which:

- **Lead time → "the customer's clock."** Starts when *they* asked. Answers: *"How long until I get what I requested?"*
- **Cycle time → "the team's clock."** Starts when *we* began. Answers: *"Once we start, how long until it's done?"*

Why have both? Because they drive different actions:

- If **cycle time** is long, the problem is in *how you do the work* — slow reviews, big batches, a clunky pipeline. The fix is inside the team's working process.
- If **lead time** is much longer than cycle time, the problem is *before* the work even started — things pile up in the backlog faster than you can pull them through. The fix is about prioritization, work-in-progress limits, and capacity, not coding speed.

> **Key insight:** lead time minus cycle time tells you how long things sit *waiting to be started*. If a feature takes 23 days of lead time but only 2 days of cycle time, your team isn't slow at building — your customers are waiting 21 days *before you even begin*. No amount of "code faster" fixes that. You'd have spent three weeks optimizing the wrong thing.

A note on vocabulary: these terms come from manufacturing (Lean), and you'll see slightly different start/stop points in different teams. That's fine and expected. What matters is not the dictionary definition — it's that **everyone in your conversation agrees where the clock starts and stops**. The next concept makes that concrete.

---

## Core Concept 2 — Putting Both on a Timeline

Definitions get slippery in the abstract. Put them on a timeline and they snap into place.

Imagine a single feature: *"Add a dark-mode toggle."* Here's its life, day by day:

```
        REQUESTED                  STARTED            DONE (in prod)
            │                         │                    │
            ▼                         ▼                    ▼
  ──────────●─────────────────────────●────────────────────●──────────►  time
            │                         │                    │
            │◄──── waiting in ───────►│◄──── working ─────►│
            │      the backlog        │                    │
            │      (14 days)          │     (4 days)       │
            │                                              │
            │◄────────────── LEAD TIME (18 days) ─────────►│
                                      │◄ CYCLE TIME (4d) ──►│
```

Read it left to right:

1. **Day 0 — Requested.** A product manager files the ticket. The lead-time clock starts *now*. The team is busy with other things, so nobody picks it up.
2. **Days 0–14 — Waiting in the backlog.** The ticket sits. No one touches it. This is pure **queue time** — and the customer is waiting through every minute of it.
3. **Day 14 — Started.** A developer pulls the ticket into "In Progress." The **cycle-time** clock starts now.
4. **Days 14–18 — Working.** Coding, review, CI, deploy. Four days of actual progress (though, as we'll see, even *this* stretch is mostly waiting too).
5. **Day 18 — Done.** It's live. Users can flip dark mode. Both clocks stop.

The two numbers:

- **Lead time = 18 days** (Day 0 → Day 18). What the customer waited.
- **Cycle time = 4 days** (Day 14 → Day 18). What the team spent once it started.

The gap between them — **14 days** — is the backlog wait. If your goal is "deliver dark mode faster," that 14-day gap is by far your biggest lever. Shaving the 4-day cycle time down to 3 saves one day. Pulling the ticket from the backlog a week sooner saves seven.

> **Key insight:** the same piece of work has *two* legitimate durations, and a timeline is the only way to keep them straight. Whenever someone quotes you "our lead time is X," your first question should be: *where did you start the clock — when it was requested, or when we started working?* If they started it at "we started working," they're quoting cycle time and calling it lead time. That mislabel hides the entire backlog wait.

---

## Core Concept 3 — DORA's "Lead Time for Changes"

Here's where it gets confusing in a *useful* way. The DORA research (from *Accelerate* and the State of DevOps reports) defines one of its four key metrics as **lead time for changes** — and it means something more specific than the broad "request-to-delivery" lead time above.

**DORA lead time for changes = from when code is *committed* to when that code is *running in production*.**

```
  CODE COMMITTED                              RUNNING IN PROD
        │                                            │
        ▼                                            ▼
  ──────●──────────────────────────────────────────●──────────►  time
        │                                            │
        │◄────── DORA "lead time for changes" ──────►│
        │     commit → merge → CI → deploy → live    │
```

Notice what this *doesn't* include: the time the request sat in the backlog, the time spent designing, even the time spent writing the code *before the first commit*. DORA's clock starts at **commit**, not at "requested" and not at "started coding." It's deliberately measuring one specific thing: **how good is your team at getting committed code safely into production?**

That's a narrow slice on purpose. It isolates the *engineering delivery pipeline* — version control, CI, testing, deployment — from the messier, more human stages of prioritization and design. Two reasons this slice is the one DORA picked:

1. **It's measurable from tools you already have.** A commit timestamp and a deploy timestamp both live in systems (Git, your CI/CD platform) that record them automatically. You don't need anyone to manually log when a request was "made."
2. **It's the part engineering most directly controls.** A team can't always control how long product takes to prioritize something. But it *can* control whether shipping committed code takes ten minutes or ten days. That makes it a fair, actionable target.

So when someone in a DevOps context says "lead time," they almost always mean *this* — commit-to-prod — not the full customer-clock lead time from Concept 1. Both are called "lead time." They are not the same span. Knowing which one is on the table is, again, the whole game.

> **Key insight:** "lead time" is overloaded. The Lean / product version starts the clock at *requested* (the full customer wait). The DORA version starts it at *code committed* (just the delivery pipeline). When you read a number, the first thing to pin down is *where the clock started* — because a "2-hour lead time" (DORA, commit-to-prod) and a "3-week lead time" (full request-to-delivery) can describe the very same team without either being wrong.

A team can have an *excellent* DORA lead time — committed code reaches production in under an hour — while its *full* lead time is still weeks, because requests sit in the backlog forever. Both facts are true and both matter. They just point at different problems.

---

## Core Concept 4 — Most of It Is Waiting

Here is the lesson that reframes everything. Take any of those timelines and zoom in on the time. You will almost always find the same shocking pattern:

**The work spends most of its life doing nothing. It's waiting in a queue.**

Not being designed. Not being coded. Not being tested. Just *sitting* — waiting for a person to become free, waiting for a review, waiting for a release window, waiting for "next sprint." The time someone is *actively* working on it (the **touch time**) is usually a small fraction of the total.

Zoom into that 4-day cycle time from Concept 2 and it often looks like this:

```
  CYCLE TIME (4 days = ~32 working hours)

  coding        ████████████  ~6h  (active)
  wait for review            ░░░░░░░░░░░░░░░░░░░░░░░░  ~18h  (WAITING)
  in review     ██  ~1h  (active)
  wait to merge  ░░░░  ~2h  (WAITING)
  CI pipeline   ████  ~1h  (mostly machine, but you wait on it)
  wait for deploy window      ░░░░░░░░  ~4h  (WAITING)

  active (████) ≈ 8h     waiting (░░░░) ≈ 24h
```

Three-quarters of the cycle time — and that's *before* counting the two weeks it sat in the backlog — is pure waiting. The developer did about a day of real work, spread across four days of mostly idle waiting.

This is not a sign of lazy people. It's the natural behavior of any system where work passes between people and stages. Each handoff is an opportunity to sit in a queue. The more stages and handoffs, the more queues, the more waiting. (This idea — that work flows through stages and gets stuck in the gaps between them — is the heart of [flow metrics](../02-flow-metrics-and-value-stream/junior.md), where you'll learn to measure exactly this.)

Why does this matter so much? Because it tells you *where to look* to go faster:

- If most of the time is **waiting**, then "work harder / code faster" barely helps. You'd be optimizing the small active slice and ignoring the giant waiting slice.
- The real wins come from **removing waits**: review code faster, make smaller changes that review quickly, deploy more often so there's no "release window" to wait for, limit how many things are in progress so each one moves instead of stalling.

> **Key insight:** most of lead time is *waiting*, not *working*. So the fastest way to shorten lead time is almost never "make people work faster" — it's "make work *wait* less." Find the longest queue (usually code review, or the gap before a release) and attack *that*. Optimizing the active work while ignoring the waiting is like speeding up the one green light on a road full of red ones.

---

## Core Concept 5 — Look at the Spread, Not Just the Average

One more habit, and it's the one that separates people who *use* these metrics well from people who get fooled by them: **don't trust the average alone. Look at the spread.**

Say someone reports, *"Our average lead time is 4 days."* Sounds tidy. But averages hide the story. Consider two teams, both with a 4-day average:

```
  TEAM A — tight spread                TEAM B — wide spread
  most changes:  3–5 days              most changes:  1 day
  worst case:    6 days                worst case:    30 days
  average:       4 days                average:       4 days  (same!)

  3 ▇▇▇▇▇▇▇                            1 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
  4 ▇▇▇▇▇▇▇▇▇▇▇                        2 ▇▇▇▇
  5 ▇▇▇▇▇▇▇                            5 ▇▇
  6 ▇▇                                30 ▇▇  ← the long tail
```

Same average. Completely different reality. **Team A is predictable** — you can promise a stakeholder "about a week" and be right. **Team B is a lottery** — most things are fast, but every so often something takes a *month*, and the average quietly buries those disasters. If you only ever quote "4 days," you'd never see Team B's problem, and you'd be blindsided every time one of those 30-day items happened.

So look at the **distribution**:

- **"Most changes take X"** — the typical case. A good number to use is the **median** (the middle value: half are faster, half are slower). The median ignores a few wild outliers, so it describes "normal" better than the average does.
- **"But the slow ones take Y"** — the tail. Look at, say, the slowest 10% (the **85th or 95th percentile**: "9 out of 10 changes were faster than this"). This is where the pain and the surprises live.

You don't need to compute percentiles by hand yet — that's a [middle-level skill](middle.md). For now, just build the *instinct*: whenever you see a single average, ask **"what's the spread?"** Ask what the typical change looks like *and* what the worst ones look like. The gap between those two tells you how *predictable* your delivery is — and predictability is often more valuable to a business than raw speed.

> **Key insight:** an average is one number pretending the world is uniform. Delivery times are not uniform — they're usually a fast cluster plus a long, ugly tail. The tail is where missed deadlines and angry stakeholders come from, and the average hides it. Always ask for *both* "the typical case" *and* "the slow case." Two numbers beat one every time.

---

## Real-World Examples

**1. The feature that was "done" for three weeks.** A team finishes a checkout improvement — coded, reviewed, merged. But it ships behind the monthly release train, so it sits, complete, for 23 days waiting for the next window. The *cycle time* (start of coding to merged) was 3 days. The *lead time* (requested to actually live for users) was over a month. When the team only tracked cycle time, everything looked healthy. The customer experience — "we asked for this ages ago, where is it?" — was invisible in their metrics. The fix wasn't faster coding; it was deploying more often so finished work didn't pile up waiting for a train.

**2. Great DORA number, terrible delivery.** An engineering team proudly reports a DORA lead time for changes of **40 minutes** — committed code reaches production in under an hour. Genuinely elite. Yet product leadership is furious about how slow features arrive. No contradiction: the *commit-to-prod* pipeline is excellent, but requests sit in the backlog for *weeks* before anyone commits the first line. The 40-minute number is real and good — it just measures a tiny slice near the end. The full request-to-delivery lead time is the number product cares about, and it's dominated by backlog wait the DORA metric never sees.

**3. The average that lied.** A manager reports "our average lead time is 5 days" and promises a stakeholder a feature "in about a week." It ships in *four* weeks. What happened? Most changes really were ~2 days, but a quarter of them hit a flaky integration test and a slow external review, dragging out to 20+ days — and this feature drew the short straw. The average (5 days) was pulled up by the long tail but still sounded fast. Had the manager looked at the spread — "median 2 days, but the slowest 15% take 20+" — they'd have promised differently and looked for the cause of the tail (the flaky test) instead of being surprised by it.

---

## Mental Models

- **Two stopwatches on one race.** Lead time is the stopwatch that starts when the *spectator* (customer) first wants to know "is it done yet?" — the moment they asked. Cycle time is the stopwatch that starts when the *runner* (team) actually leaves the starting line. The runner's time is always shorter, because the spectator was waiting before the gun even fired.

- **An airport, not a flight.** Your two-hour flight (the active work) is a small part of your trip. Check-in queue, security line, sitting at the gate, baggage carousel — that's the waiting, and it usually dwarfs the flight. "How long does it take to travel?" is a lead-time question; "how long is the flight?" is a cycle-time question. Most of the delay is queues, not air time.

- **Lead time = backlog wait + cycle time.** Keep this equation in your head. If lead time is huge but cycle time is small, the problem lives in the *first term* — work piling up before it's started. If cycle time itself is large, the problem is in *how the work is done*. The equation tells you which half to investigate.

- **The average is a single weather number for a whole year.** "The average temperature here is 18°C" tells you nothing about whether to pack a coat — it hides the freezing nights and the scorching afternoons. A single average lead time hides the fast cluster and the brutal tail the same way. Always ask for the range.

---

## Common Mistakes

1. **Confusing lead time and cycle time.** The big one. Lead time = the *whole* wait from *requested* to *delivered* (customer's clock, includes backlog). Cycle time = the *working* time from *started* to *done* (team's clock, excludes backlog). They are not interchangeable, and they point at different problems. Always say which one you mean.

2. **Quoting cycle time but calling it lead time.** A team measures from "started coding" to "merged," then reports it as "lead time." This silently erases the (often huge) time work spent waiting in the backlog *and* any time after merge. The number looks great while customers wait weeks. Name your start and stop points explicitly.

3. **Assuming "DORA lead time" means the full customer wait.** DORA's *lead time for changes* is **commit → production**, a narrow end-of-pipeline slice. It does *not* include backlog, design, or pre-commit coding. A fantastic DORA lead time can coexist with a terrible full lead time. Don't let one stand in for the other.

4. **"Done" meaning "merged" instead of "in production."** If your clock stops at "code merged" but the change isn't *live* for users, you're not measuring delivery — you're measuring up to the point where the change still can't help anyone. For lead/cycle time, "done" should mean *running in production* (or wherever users actually feel it).

5. **Trying to fix lead time by making people work faster.** Most of lead time is *waiting*, not *working*. "Code faster" optimizes the small active slice and ignores the giant queue slice. The real wins are removing waits — faster reviews, smaller changes, more frequent deploys, fewer things in progress at once.

6. **Trusting the average and ignoring the spread.** A 4-day average can mean "reliably 3–5 days" or "usually 1 day but sometimes 30." Those are completely different teams with the same average. Always look at the typical case (median) *and* the slow case (the tail) — the gap between them is your *predictability*.

---

## Test Yourself

1. In one sentence each, define **lead time** and **cycle time**, and say which clock — the customer's or the team's — each one represents.
2. A ticket is created on March 1. A developer starts on it March 20. It goes live March 24. What is the lead time? What is the cycle time? What is the backlog wait?
3. DORA's "lead time for changes" measures from *what event* to *what event*? Name one thing it deliberately leaves out.
4. A team reports a DORA lead time of 30 minutes but product says features take months to arrive. Explain how both can be true at once.
5. Someone says, "Just make the engineers code faster to cut our lead time." Why is this usually the wrong instinct? What should you look at instead?
6. Two teams both have an average lead time of 5 days. Why might you still strongly prefer one over the other? What two numbers would you ask for to tell them apart?

<details>
<summary>Answers</summary>

1. **Lead time** = the whole wait from when work is *requested* to when it's *delivered* — the **customer's** clock (it includes time in the backlog). **Cycle time** = the working time from when the team *starts* to when it's *done* — the **team's** clock (it excludes the backlog wait).
2. **Lead time = 23 days** (March 1 → March 24, requested → delivered). **Cycle time = 4 days** (March 20 → March 24, started → done). **Backlog wait = 19 days** (March 1 → March 20), which is lead time minus cycle time.
3. From **code committed** to that code **running in production**. It deliberately leaves out (any one of): time the request sat in the backlog, design/planning time, and the coding time *before* the first commit.
4. The DORA metric measures only the **commit-to-production** pipeline, which is excellent (30 min). But requests sit in the **backlog for weeks/months before anyone commits code** — that wait is outside DORA's clock. The full request-to-delivery lead time is what product feels, and it's dominated by backlog time the DORA number never sees.
5. Because **most of lead time is waiting in queues, not active work** — speeding up the small active slice barely moves the total. Instead, look for the **biggest waits** (often code review or the gap before a release) and remove them: smaller changes, faster reviews, more frequent deploys, fewer things in progress.
6. Because the **average hides the spread**. One team might be reliably 4–6 days (predictable); the other usually 1 day but occasionally 30 (a lottery). Ask for the **typical case (median)** and the **slow case (e.g., the 85th/95th percentile, or "how long do the slowest ~10% take?")** — the gap between them shows how predictable each team is.

</details>

---

## Cheat Sheet

```
THE TWO CLOCKS
  lead time   = REQUESTED  → DELIVERED   (customer's clock; includes backlog wait)
  cycle time  = STARTED    → DONE        (team's clock; excludes backlog wait)
  relationship:  lead time = backlog wait + cycle time   (lead ≥ cycle, always)

WHICH PROBLEM IS IT?
  lead >> cycle   → work piles up BEFORE it's started  → prioritize / limit WIP / capacity
  cycle is large  → the WORKING process is slow         → reviews, batch size, pipeline

DORA "LEAD TIME FOR CHANGES" (a narrow slice!)
  = CODE COMMITTED → RUNNING IN PRODUCTION
  excludes: backlog wait, design, pre-commit coding
  measures: how good you are at shipping committed code safely

THE BIG LESSON
  most of the time, work is WAITING in a queue, not being worked on.
  to go faster → remove WAITS (faster review, smaller changes, deploy often, less WIP)
  NOT → "code faster" (that's the small active slice)

READING THE NUMBERS
  never trust the average alone → ask for the SPREAD
  typical case  → MEDIAN  (middle value; ignores wild outliers)
  slow case     → the TAIL (e.g. 85th/95th percentile; "slowest ~10%")
  gap between them = how PREDICTABLE your delivery is

"DONE" MEANS
  running in PRODUCTION (users feel it) — NOT "merged", NOT "code complete"
```

---

## Summary

- **Lead time** and **cycle time** are the two words everyone mixes up. **Lead time** is the *whole* wait from *requested* to *delivered* — the **customer's clock**, and it includes time spent waiting in the backlog. **Cycle time** is the *working* time from *started* to *done* — the **team's clock**, and it excludes that backlog wait.
- They relate by a simple equation: **lead time = backlog wait + cycle time**. Lead time is always ≥ cycle time. The gap between them tells you how long work waits *before anyone starts it* — often the single biggest, most ignored delay.
- **DORA's "lead time for changes"** is a *specific, narrow* metric: **code committed → running in production**. It measures the delivery pipeline, not the full customer wait. A team can have a brilliant DORA lead time while its full request-to-delivery lead time is still weeks — both can be true and both matter.
- The lesson that reframes everything: **most of lead time is *waiting*, not *working***. Work sits in queues — backlog, review, release windows — far longer than anyone actively touches it. So the way to go faster is to **remove waits**, not to "code faster." This is the doorway to flow.
- **Look at the spread, not just the average.** A single average hides whether you're predictable (tight cluster) or a lottery (long tail). Always ask for the *typical* case (median) *and* the *slow* case (the tail). The gap between them is your predictability — often worth more to a business than raw speed.

You now have the two clocks straight, you know where DORA starts its clock, and you know the uncomfortable truth that most of the time nothing is happening. Everything else in this topic — decomposing the pipeline stage by stage, computing percentiles properly, and systematically shrinking each wait — builds directly on these foundations.

---

## Further Reading

- *Accelerate* (Forsgren, Humble & Kim) — the research behind DORA's four keys, including lead time for changes; read the chapter on what the metric is and why this slice was chosen.
- *The Principles of Product Development Flow* (Donald Reinertsen) — the definitive case for why queues (waiting) dominate delivery time, and why managing them beats working faster.
- *This Is Lean* (Modig & Åhlström) — a short, clear book on flow vs resource efficiency; the airport/queue intuition for why "most of it is waiting" comes alive here.
- The [middle.md](middle.md) of this topic — decomposes lead time into pipeline stages (coding, pickup, review, CI, deploy, wait) and shows how to compute medians and percentiles properly instead of averages.

---

## Related Topics

- [middle.md](middle.md) — decompose the pipeline stage by stage and measure each wait; percentiles, not means.
- [senior.md](senior.md) — start the clock where it matters, reduce lead time systematically, and avoid gaming it.
- [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) — where "lead time for changes" sits among deployment frequency, change failure rate, and time to restore.
- [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/junior.md) — the deeper study of *why most of the time is waiting*, and how to find and fix the biggest queue.
