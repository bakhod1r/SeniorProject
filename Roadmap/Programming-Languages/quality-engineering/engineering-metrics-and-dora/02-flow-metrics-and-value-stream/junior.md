# Flow Metrics & Value Stream — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Flow Metrics & Value Stream
> *Watch one ticket from the moment someone has the idea to the moment a user can click it. The shocking part isn't how long the coding takes — it's how much of the clock the ticket spends sitting in a queue, touched by no one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Value Stream](#core-concept-1--the-value-stream)
5. [Core Concept 2 — Work Waits: Flow Efficiency](#core-concept-2--work-waits-flow-efficiency)
6. [Core Concept 3 — WIP: Why Too Much Slows Everything](#core-concept-3--wip-why-too-much-slows-everything)
7. [Core Concept 4 — The Bottleneck Sets the Pace](#core-concept-4--the-bottleneck-sets-the-pace)
8. [Core Concept 5 — Value Stream Mapping](#core-concept-5--value-stream-mapping)
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

> Focus: **Follow one piece of work from idea to delivered — and notice where it just waits.**

Pick any feature your team shipped last month. Before a user could touch it, it went through a chain of steps: someone *had the idea*, someone *designed it*, someone *wrote the code*, someone *reviewed* that code, it got *tested*, it got *deployed*, and finally it went *live*. That chain — every step a piece of work passes through on its way to a user — is the **value stream**.

Most juniors picture that chain as a smooth conveyor belt: idea goes in one end, working feature pops out the other, and the time it takes is "however long the work takes." That picture is almost entirely wrong, and discovering *why* it's wrong is the single most useful thing on this page.

Here is the truth that surprises nearly everyone the first time they measure it: a piece of work spends **most of its life waiting**, not being worked on. It sits in a backlog waiting to be picked up. It sits in a pull request waiting for review. It sits in a "ready for QA" column waiting for a tester to free up. The actual *typing-code, doing-the-thing* time is often a tiny sliver of the total. Teams routinely discover that a ticket which took **two weeks** to go from start to finish contained only **a day or two** of real work. The other eight or nine days? Pure queue.

This page gives you five ideas that, together, explain that gap and tell you what to do about it: the **value stream** (the steps), **flow efficiency** (how much of the time is real work vs waiting), **WIP** (work in progress, and why too much of it jams everything), the **bottleneck** (the one slow step that secretly sets the pace for the whole stream), and **value stream mapping** (drawing the steps, marking the waits, and attacking the biggest one).

> **The mindset shift:** stop asking *"how do we work faster?"* and start asking *"where does work wait, and why?"* On almost every team, the clock is dominated by queue time, not effort time. You cannot type fast enough to fix a problem that is 85% *waiting* — but you can attack the waiting directly, and that's where the huge wins hide.

---

## Prerequisites

- **Required:** You've worked a ticket through a board (To Do → In Progress → Done) on at least one team, even a small or student one.
- **Required:** You understand the basic shape of shipping software — that code gets written, then reviewed, then tested, then deployed.
- **Helpful:** You've opened a pull request and waited for someone to review it. (That wait *is* the lesson.)
- **Helpful:** You've felt the frustration of a "nearly done" feature that took forever to actually ship. We're going to explain that feeling.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Value stream** | Every step a piece of work passes through from idea to live-for-users. |
| **Flow time** | How long one item takes from start to finish (start the clock when work begins, stop it when it's delivered). |
| **Flow efficiency** | The fraction of flow time that was *active work*, not waiting: `active ÷ total`. |
| **WIP (work in progress)** | The number of items being worked on at once — started but not yet finished. |
| **Bottleneck** | The slowest step in the stream; the one that limits how fast the whole stream can deliver. |
| **Queue / wait state** | Any place an item sits idle, waiting for the next person or step to be free. |
| **Backlog** | The pile of work that hasn't been started yet — the queue at the front of the stream. |

---

## Core Concept 1 — The Value Stream

A **value stream** is the full sequence of steps a piece of work travels through to become something a user can actually use. Not the steps in your head — the *real* steps, including the boring administrative ones and the invisible waiting ones.

For a typical feature, the stream looks something like this:

```
idea  →  design  →  code  →  review  →  test  →  deploy  →  live
```

Each arrow is a hand-off, and each box is a step where work either *happens* or *sits*. The word "value" is the important part: the stream is named for the user, not the team. A feature only delivers value when it reaches the **live** box — not when the code is written, not when it's merged, not when it's "done" on someone's board. Code sitting in `main` un-deployed has delivered exactly zero value to anyone.

This is why "I finished my part" is a junior way to think and "the work reached a user" is a senior way to think. Your code passing review is a *step*, not the *finish line*. The finish line is the rightmost box.

The first real skill is just being able to *name your own stream honestly*. Most teams, asked to draw it, list four clean steps. When they watch an actual ticket, they discover ten — including a two-day "waiting for the design to be approved" step and a three-day "waiting in the QA queue" step that nobody had ever named, because nobody was *working* during them so nobody noticed.

> **Key insight:** the value stream is defined from the *user's* point of view and ends when the user can use the thing — not when your task is marked done. Half of all delivery delay hides in steps the team never bothered to name, precisely because those steps are *waiting*, and waiting is invisible until you go looking for it.

---

## Core Concept 2 — Work Waits: Flow Efficiency

Here is the concept that reframes everything. For any single piece of work, the total time it took (its **flow time**) is made of two kinds of time:

- **Active time** — someone is actually working on it: writing the code, doing the review, running the tests.
- **Wait time** — it's sitting in a queue: waiting to be picked up, waiting for a reviewer, waiting for a free tester, waiting for the next deploy window.

**Flow efficiency** is simply the ratio of the good kind to the total:

```
flow efficiency = active time ÷ total flow time
```

Now the gut-punch. Sit down and measure this on a real ticket and you will almost always find flow efficiency is **shockingly low — 15% or less is completely normal**. Many teams measure in the single digits. That means *85% or more* of the time your work existed, **no one was touching it**. It was in a queue.

Make it concrete. A ticket takes **10 working days** start to finish. You add up the time anyone actually spent on it:

```
  coding:        1.0 day   (active)
  code review:   0.5 day   (active)
  testing:       0.5 day   (active)
  ----------------------------------
  active total:  2.0 days

  waiting in backlog before pickup:   3 days   (wait)
  waiting for a reviewer to start:     2 days   (wait)
  waiting in the "ready for QA" queue: 2 days   (wait)
  waiting for the next deploy window:  1 day    (wait)
  ----------------------------------
  wait total:    8.0 days

  flow time = 2 + 8 = 10 days
  flow efficiency = 2 ÷ 10 = 20%
```

Only **two of the ten days** were real work. The feature wasn't slow because anyone was slow — it was slow because it spent eight days in queues.

This is why the instinct "we need to code faster" is usually the *wrong* lever. Suppose your developers somehow worked twice as fast, cutting that 1 day of coding to half a day. Total flow time drops from 10 days to 9.5 — a measly 5% improvement, for an impossible amount of effort. But cut the *waiting* in half — from 8 days to 4 — and flow time drops from 10 to 6, a **40% improvement**, often by changing nothing more than *how work is queued*.

> **Key insight:** flow efficiency is `active ÷ total`, and on real teams it is usually 15% or less. The lever with leverage is almost never "work faster" — it's "wait less." When 85% of the clock is queue time, attacking the queue is where the speed actually lives.

---

## Core Concept 3 — WIP: Why Too Much Slows Everything

**WIP** stands for **work in progress**: the number of things your team has *started but not finished* at any given moment. Five tickets all "in progress" at once is a WIP of five.

The counter-intuitive truth: **the more work you start at once, the slower each piece finishes.** Starting more does not get more done — it gets everything done *later*.

Why? Two reasons, both simple.

**1. Queues form.** If everyone is busy on three things each, then a new item — say, a pull request needing review — joins a *queue* behind all the other things everyone is already juggling. More things in flight means longer queues at every step, and longer queues mean more *wait time*, which (from Concept 2) is the thing that dominates flow time. High WIP literally *manufactures* the wait time that wrecks flow efficiency.

**2. Context-switching is expensive.** A person juggling five tasks is not doing five tasks at 100% speed. They're paying a tax every time they put one down and pick another up — reloading the problem into their head, re-reading the code, remembering where they were. Five half-done things finish far later than five things done one-after-another.

A small picture says it best. Same six tasks, two strategies:

```
HIGH WIP — start everything at once (all six in progress):
  every task drags on; the FIRST finished thing appears very late
  A ====================  done (day 18)
  B ====================  done (day 18)
  C ====================  done (day 19)   ... nothing delivered for ages

LOW WIP — limit to two at a time, finish before starting more:
  A ======  done (day 6)        ← value delivered EARLY
  B ======  done (day 6)
  C       ======  done (day 12)
  ... finished work starts flowing out almost immediately
```

Both strategies do the same total amount of work. But low WIP *finishes things*, and finished things are the only things that deliver value. High WIP keeps everything "almost done" — which is worth nothing to a user.

This is the reasoning behind **WIP limits**: a team rule like "no more than 3 items in the 'In Progress' column." It feels like it should slow you down (you're "allowed" to do less!). It does the opposite. By forcing people to *finish* before they *start*, it drains the queues and gets value out the door sooner. The most powerful instinct a junior can build is: **stop starting, start finishing.**

> **Key insight:** high WIP doesn't increase throughput — it just spreads the same work over more half-done items, lengthening every queue and taxing every brain with context-switching. Limiting WIP feels like doing less and reliably delivers more. "Stop starting, start finishing" is the whole idea in four words.

---

## Core Concept 4 — The Bottleneck Sets the Pace

Every value stream has one step that is slower than the rest — the **bottleneck**. And the bottleneck has a property that feels unfair until you see it: **the slowest step sets the pace for the entire stream.** No matter how fast everything else goes, work can only leave the stream as fast as it gets through the slowest step.

Think of a highway that's three lanes wide except for one stretch where it narrows to a single lane. It doesn't matter how wide or fast the rest of the road is — the whole highway's throughput is decided by that one-lane pinch. Cars pile up behind it. The pinch is the bottleneck, and it governs everyone.

Software streams work the same way. Picture this one:

```
code (fast)  →  review (FAST)  →  test (SLOW — one QA person, huge queue)  →  deploy (fast)
```

If testing can only clear two tickets a day, then the whole stream delivers two tickets a day — *even if* developers produce ten and reviewers approve ten. The extra eight just pile up in front of testing, growing the "ready for QA" queue (and, not coincidentally, growing wait time and tanking flow efficiency). Speeding up coding here is pointless: you'd just grow the pile in front of the bottleneck faster.

This gives you two rules worth tattooing on your brain:

- **Improving anything that *isn't* the bottleneck makes no difference to overall delivery.** Faster coding upstream of a clogged QA step just enlarges the queue. The non-bottleneck steps already have spare capacity.
- **To speed up the whole stream, find the bottleneck and widen *it*.** Add a second tester, automate the slow tests, split the work — whatever relieves *that specific step*. That, and only that, moves the needle.

How do you spot the bottleneck? Look for **where work piles up**. The step with the longest queue in front of it — the column on your board with the most cards waiting, the place items sit longest — is almost always your bottleneck. The queue is the symptom; the slow step is the cause.

> **Key insight:** the slowest step sets the pace for the whole stream, so effort spent improving any *other* step is wasted. Find the bottleneck by looking for where work piles up, fix *that*, and only that — then look again, because relieving one bottleneck always reveals the next.

---

## Core Concept 5 — Value Stream Mapping

**Value stream mapping** sounds like a heavyweight consultant exercise. In its junior, useful form, it is three steps and a whiteboard:

1. **Draw the steps** — every box from idea to live, honestly, including the boring and invisible ones.
2. **Mark how long each step takes — and crucially, mark the *waits between* the boxes.** The gaps between steps are where the time hides.
3. **Attack the biggest wait first.** Not the biggest *step* — the biggest *wait*.

That's it. The entire value of the exercise is that it *makes the waiting visible*, and you cannot fix what you cannot see. Here is a simple, realistic sketch for a feature, with active work in the boxes and wait time on the arrows:

```
                wait 3d              wait 2d           wait 2d            wait 1d
[backlog] --------------> [code] -----------> [review] --------> [test] ----------> [deploy] --> LIVE
                          (1d work)          (0.5d work)        (0.5d work)         (fast)

  ACTIVE work total:  ~2 days
  WAIT  time  total:  ~8 days   ← the whole problem is here
  FLOW time (start→live): 10 days
  FLOW EFFICIENCY: 2 / 10 = 20%

  Biggest single wait: 3 days in the backlog before anyone starts.
  → ATTACK THAT FIRST.  (Why does work sit 3 days before pickup? Too much WIP?
    No clear priority? A weekly planning cadence? Fix the cause of the biggest wait.)
```

Notice what the map reveals that a feeling never could. Every *box* (the active work) is small — a day here, half a day there. Every *arrow* (the wait) is large. A team staring at this map stops arguing about whether developers code fast enough (they clearly do — coding is one day) and starts asking the *right* question: *why does a finished, reviewed change wait two days for a tester, and why does a fresh idea sit three days before anyone touches it?*

The discipline is to attack waits **in order of size**. The 3-day backlog wait is the biggest, so it's first. Maybe the cause is WIP that's too high (everyone's busy, nothing gets picked up) — and now Concepts 3, 4, and 5 connect: high WIP grows queues, the longest queue marks the bottleneck, and the map makes that longest queue impossible to ignore. They're four views of one truth.

> **Key insight:** value stream mapping is just *draw the steps, mark the waits between them, attack the biggest wait first*. Its power is purely that it makes queue time visible — and almost every map reveals the same punchline: the boxes are small, the arrows are huge, and the win is in the arrows.

---

## Real-World Examples

**1. The two-week ticket that was two days of work.** A team complains they're "slow." A junior is asked to follow one shipped ticket and tally where the time went. Total: 11 calendar days. Actual hands-on-keyboard work: under 2 days. The rest — 3 days waiting in the backlog, 2 waiting for review, 3 waiting in a QA queue, 1 waiting for the Thursday deploy. Flow efficiency: ~18%. The team's reflexive fix had been "hire more developers to code faster." The map showed coding was *never* the problem — the queues were. The actual fix (a WIP limit and reviewing PRs within a day) cut delivery time roughly in half without anyone writing a single line of code faster.

**2. The pull request that aged like milk.** A developer opens a PR Monday morning. It's small — 30 minutes to review. It gets reviewed Wednesday afternoon. Those two days of pure wait happened because every reviewer was buried in their own in-progress work (high WIP) and an open PR is *invisible* — it makes no noise while it waits. Multiply that 2-day review wait across every ticket and it's one of the largest waits in the whole stream, created entirely by *not looking at the queue*. The team's fix was a simple agreement: review open PRs before starting new coding. Review wait dropped from days to hours.

**3. The one-lane QA bridge.** A team's developers and reviewers each clear about eight tickets a day, but there's a single QA person who can verify two. Predictably, work delivers at two tickets a day, and a giant "ready for QA" pile grows in front of testing. Management's instinct was to push developers to go faster — which would only have grown the pile. The bottleneck was QA, and *only* relieving QA mattered: they automated the repetitive regression checks and trained a second person to test. Throughput jumped — by widening the one-lane bridge, not by speeding up the wide-open road in front of it.

---

## Mental Models

- **The clock is mostly queue.** When you imagine a ticket's life, don't picture continuous work — picture a long line at the post office with brief moments of being served. The line *is* the flow time. Active work is the few minutes at the counter. Flow efficiency measures the counter-time against the whole visit, and it's almost always small.

- **Stop starting, start finishing.** WIP is a measure of how many things you've *started*. Value comes only from things you've *finished*. Every new thing you start before finishing an old one lengthens a queue and taxes a brain. Lower WIP feels like doing less; it reliably delivers more.

- **The bottleneck is the one-lane bridge.** Widening any other lane does nothing; cars still funnel through the bridge. Find the bridge (where work piles up), widen *it*, and ignore the lanes that already have spare room — until relieving the bridge reveals the next one.

- **The map's arrows, not its boxes, hold the time.** When you sketch a value stream, the boxes (active steps) look reassuringly small and the arrows (the waits between them) look alarmingly large. That contrast *is* the insight: the delay lives in the gaps between steps, where no one is working and no one is watching.

- **Faster typing can't beat a queue.** If 85% of the clock is waiting, then doubling the speed of the 15% that's work barely moves the total. The only big lever is the wait. Internalize this and you'll stop reaching for the wrong tool.

---

## Common Mistakes

1. **Thinking "faster delivery" means "code faster."** It almost never does. With flow efficiency at 15–20%, the work-time is a sliver; the wait-time is the whole game. Optimizing the sliver is effort spent where there's no leverage. Attack the queues.

2. **Measuring only the active work and calling it the lead time.** "It only took me a day" ignores the eight days the ticket waited around that day of work. Flow time runs from *start* to *delivered* — wall-clock, queues included — not just the hours you had it open in your editor.

3. **Treating "merged" or "done on the board" as the finish line.** Value is delivered when a *user* can use it — the rightmost box, *live*. Code merged but un-deployed has delivered nothing. Define the stream from the user's end, not the developer's.

4. **Maxing out WIP because "everyone should be busy."** Keeping every person 100% utilized maximizes *started* work and lengthens every queue. A team that's always 100% busy is a team where work waits the longest. Idle capacity at the right step is what *drains* queues.

5. **Improving a step that isn't the bottleneck.** Speeding up coding when QA is the choke just grows the pile in front of QA. Find where work *piles up* first; that's the only step worth improving until it's no longer the slowest.

6. **Never drawing the map, so the waits stay invisible.** Waiting time makes no noise — no one is working during it, so no one notices it. If you don't deliberately draw the steps and mark the gaps, the largest delays in your whole process remain literally unseen, and you'll keep "fixing" the wrong thing.

---

## Test Yourself

1. In one sentence, what is a *value stream*, and at which step does it actually deliver value to a user?
2. A ticket takes 10 days from start to live. People spent 1.5 days actually working on it. What is its flow efficiency, and what does that number tell you?
3. Your team's instinct is "we need to code faster." Flow efficiency is 15%. Why is "code faster" probably the wrong lever, and what's the better one?
4. What is WIP, and explain in two sentences why *lowering* it tends to make work finish *sooner*.
5. Coding and review each clear 8 tickets/day; testing clears 2/day. How many tickets per day does the whole stream deliver, and where should you focus to improve it?
6. List the three steps of a simple value-stream map, and say which thing you attack first.

<details>
<summary>Answers</summary>

1. A value stream is **every step a piece of work passes through from idea to live-for-users**; it delivers value only at the final **live** step, when a user can actually use the thing — not when code is merged or a board says "done."
2. **Flow efficiency = 1.5 ÷ 10 = 15%.** It tells you only 15% of the ticket's life was real work; the other **85% was waiting in queues** — so the delay is dominated by wait time, not effort.
3. Because at 15% efficiency, work-time is a tiny sliver of the clock — even doubling coding speed barely moves the total. The better lever is **reducing wait time** (shorter queues: lower WIP, faster review pickup, more frequent deploys), where the other 85% lives.
4. **WIP is the number of items started but not yet finished.** Lowering it shortens every queue (so items wait less) and reduces context-switching (so each item gets finished faster) — both of which get work *out the door* sooner.
5. The whole stream delivers **2 tickets/day** — the slowest step (testing) sets the pace. Focus on **the bottleneck, testing** (e.g., automate slow tests, add a second tester); improving coding or review does nothing because they already outpace testing.
6. **(1)** Draw the steps, **(2)** mark how long each takes *and the waits between them*, **(3)** attack the biggest **wait** first (the biggest gap, not the biggest step).

</details>

---

## Cheat Sheet

```
THE VALUE STREAM (typical)
  idea → design → code → review → test → deploy → LIVE
  value is delivered ONLY at LIVE (user can use it) — not at "merged" or "done"

THE TWO KINDS OF TIME
  active time = someone is working on it
  wait time   = it's sitting in a queue (backlog, review, QA, deploy window)
  flow time   = active + wait  (start → delivered, wall-clock)

FLOW EFFICIENCY
  flow efficiency = active time ÷ total flow time
  reality check: 15% or less is NORMAL  →  ~85% of the clock is WAITING
  example: 2 active days / 10 total days = 20%

THE BIG LEVER
  cut WAIT time, not work time.
  halving 8 days of wait beats halving 1 day of coding, every time.

WIP (work in progress) = items started but not finished
  high WIP → longer queues + context-switching → everything finishes LATER
  rule: "stop starting, start finishing"  → limit items in progress

THE BOTTLENECK
  the slowest step sets the pace for the WHOLE stream
  find it: where does work PILE UP? (longest queue / fullest column)
  improving any OTHER step changes nothing — widen the bottleneck only

VALUE STREAM MAPPING (3 steps)
  1. draw the steps (boxes)
  2. mark each step's time AND the waits BETWEEN them (arrows)
  3. attack the BIGGEST WAIT first
  punchline: boxes are small, arrows are huge — the time is in the arrows
```

---

## Summary

- A **value stream** is every step a piece of work passes through from idea to live — and it delivers value only at the *end*, when a user can actually use it. Naming your stream *honestly* (including the invisible waiting steps) is the first skill.
- Work spends **most of its life waiting**, not being worked on. **Flow efficiency** (`active ÷ total flow time`) is usually **15% or less** — meaning ~85% of the clock is pure queue time. The big lever for speed is therefore **cutting wait**, not coding faster.
- **WIP** is items started-but-not-finished. High WIP doesn't get more done — it lengthens every queue and taxes every brain with context-switching, so everything finishes *later*. Lowering WIP ("stop starting, start finishing") delivers value *sooner*.
- Every stream has a **bottleneck** — the slowest step — and it sets the pace for the whole stream. Find it by spotting where work *piles up*; improving any other step is wasted effort. Relieve the bottleneck, then look for the next.
- **Value stream mapping** is just *draw the steps, mark the waits between them, attack the biggest wait first*. Its power is making queue time visible — and the map almost always shows small boxes and huge arrows: the delay hides in the gaps.

You now have the lens. Once you can *see* where work waits, the natural next questions are how to define and measure those durations precisely, and how this connects to the headline delivery numbers — which is exactly where [middle.md](middle.md) and the lead-time and DORA topics pick up.

---

## Further Reading

- *Project to Product* — Mik Kersten. The Flow Framework (flow time, efficiency, load, distribution) explained from the ground up; the source of the value-stream framing used here.
- *The Phoenix Project* — Gene Kim, Kevin Behr, George Spafford. A novel, but it teaches WIP, bottlenecks, and "the Theory of Constraints" better than most textbooks — read it for the one-lane-bridge intuition.
- *This is Lean* — Niklas Modig & Pär Åhlström. The clearest short explanation of flow efficiency vs resource efficiency anywhere.
- The [middle.md](middle.md) of this topic, which puts precise definitions on flow time, flow load, and flow distribution, and shows how to actually measure them.

---

## Related Topics

- [middle.md](middle.md) — the Flow Framework formalized: measuring flow time, load, efficiency, and distribution.
- [senior.md](senior.md) — driving real change with flow metrics, and the traps (gaming, local optimization) to avoid.
- [04 — Lead Time & Cycle Time › Junior](../04-lead-time-and-cycle-time/junior.md) — where exactly to start and stop the clock, and how to decompose flow time step by step.
- [01 — The DORA Four Keys › Junior](../01-dora-four-key-metrics/junior.md) — how flow connects to the headline delivery metrics (lead time for changes, deployment frequency).
