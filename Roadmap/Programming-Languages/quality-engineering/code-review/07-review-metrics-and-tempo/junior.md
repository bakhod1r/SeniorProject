# Review Metrics & Tempo — Junior Level

> **Roadmap:** [Code Review](../README.md) → Review Metrics & Tempo
> *A pull request that sits unreviewed for two days isn't just "waiting." You've moved on, you have to context-switch back, it grows merge conflicts, and your next task is blocked behind it. The speed and rhythm of review is a real thing that helps or hurts you every single day — and you can measure it, as long as you don't break it in the process.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Review Latency: The Pain You Already Feel](#core-concept-1--review-latency-the-pain-you-already-feel)
5. [Core Concept 2 — The Virtuous Cycle and the Doom Loop](#core-concept-2--the-virtuous-cycle-and-the-doom-loop)
6. [Core Concept 3 — Reviewer Attention Is Finite](#core-concept-3--reviewer-attention-is-finite)
7. [Core Concept 4 — A Few Metrics Worth Knowing](#core-concept-4--a-few-metrics-worth-knowing)
8. [Core Concept 5 — Goodhart's Law: Why Metrics Turn Toxic](#core-concept-5--goodharts-law-why-metrics-turn-toxic)
9. [Core Concept 6 — Tempo Habits You Can Start Today](#core-concept-6--tempo-habits-you-can-start-today)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How fast and how steadily does review happen — and how do you measure that without wrecking it?**

You wrote some code. You opened a pull request. Now you wait. Sometimes someone looks in twenty minutes; sometimes it's still untouched the next morning. That waiting time has a name — **review latency** — and it shapes your day more than almost anything else in the review process.

This page is not about *how to review* (that's spotting bugs, asking good questions, writing kind comments). It's about the **speed** and **rhythm** of review: how long PRs wait, how big they should be, how much one person can review well, and how to put a few honest numbers on all of it. The numbers matter because they tell you *where work is getting stuck*. But numbers are dangerous: the moment a team turns one into a scoreboard, people start gaming it, and the metric stops meaning anything.

So this page has two jobs. First, give you simple habits that keep review fast and smooth — for you *and* your teammates. Second, teach you to read a handful of metrics the right way: as a flashlight for finding bottlenecks, never as a ruler for measuring people.

> **Mindset shift:** stop optimizing for "I finished my code." Start optimizing for "my change moved smoothly from my keyboard to production, and I helped my teammates' changes do the same." **Fast, small, and steady beats big and slow** — every time. And when you measure, measure to *help the flow*, never to *judge the person*. A metric is a thermometer, not a report card.

---

## Prerequisites

- **Required:** You've opened a pull request (PR) / merge request (MR) and had someone review it. You know the basic loop: open → review → revise → approve → merge.
- **Required:** You've felt at least one of these: a PR blocked for days, a review you couldn't finish because it was huge, or a "LGTM" that clearly didn't read your code.
- **Helpful:** You've seen a team dashboard with charts about PRs and wondered what they were for (or worried they were watching you).
- **Helpful:** You know roughly what a merge conflict is and why a stale branch grows them.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Pull request (PR)** | A proposed change submitted for review before it's merged (also called a merge request, MR). |
| **Review latency** | How long a PR waits before review happens. The pain you feel as "why hasn't anyone looked?" |
| **Time-to-first-review (TTFR)** | The clock from when you open the PR until the *first* reviewer comments or approves. |
| **Cycle time (PR)** | The clock from PR opened until PR merged. The whole journey, not just the first response. |
| **WIP (work in progress)** | How many things are open and unfinished at once — your open PRs, the team's open PRs. |
| **Reviewer workload** | How much review one person is being asked to do. Attention is finite; this can be overloaded. |
| **SLA (service-level agreement)** | A promise about timing — here, a soft team norm like "first response within 4 hours." |
| **Rubber-stamp** | Approving without really reading. "LGTM" on a 900-line PR thirty seconds after it opened. |
| **Nitpick** | A trivial, low-value comment (a space, a name preference) that doesn't affect correctness. |
| **Goodhart's Law** | "When a measure becomes a target, it stops being a good measure." People game any number you score them on. |
| **Bottleneck** | The one slow stage that holds up everything behind it. Metrics exist to *find* this. |
| **Context switch** | The mental cost of dropping what you're doing to pick a task back up. Re-loading a PR you wrote days ago is expensive. |

---

## Core Concept 1 — Review Latency: The Pain You Already Feel

You've lived this. You open a PR at 4 p.m., you're proud of it, the change is fresh in your head — every line, every reason, every edge case. Then nobody reviews it. By the time feedback arrives two days later, you've shipped three other tasks, the code has faded from your memory, and you have to **context-switch** all the way back to reconstruct what you were thinking. Worse, `main` has moved, so your branch now has **merge conflicts** you have to untangle. And the whole time, your next task — which builds on this one — was **blocked**.

That waiting time is **review latency**, and the single most useful slice of it is **time-to-first-review (TTFR)**: how long until *someone first looks*. Not "fully approved" — just "a human engaged."

Why is TTFR the one to watch? Because the first response is what *unblocks the conversation*. Until then, you're stuck in limbo — you can't address feedback that doesn't exist yet, and you don't know whether to start something new or stay nearby. A PR that gets a first comment in 30 minutes keeps you in flow. A PR that waits a day yanks you out of it.

Here's what latency quietly costs, laid out:

```
PR opened, code fresh in your head
   │
   │   ← short wait (under an hour): you're still "in" the change.
   │     Feedback lands, you fix it in minutes. Smooth.
   │
   │   ← long wait (1–2+ days): you've moved on.
   ▼
Feedback finally arrives
   • You must context-switch back  (mental cost, ~15–20 min just to reload)
   • Branch has drifted from main  (merge conflicts to resolve)
   • Your blocked next task is late (it was waiting on this merge)
   • Reviewer also lost context     (they have to re-understand it too)
```

Notice the cost isn't *one* thing — it's a pile of small taxes that all come from the same root: the change waited too long.

> **Key insight:** The expensive part of review latency is rarely the waiting itself — it's the **context-switching and drift** that long waits force on *both* people. A fast first response is cheap to give and saves a disproportionate amount of pain. This is why TTFR, not "total time," is the number most teams feel first.

---

## Core Concept 2 — The Virtuous Cycle and the Doom Loop

Review speed and PR size are locked in a feedback loop. The loop can spin in a good direction or a bad one, and which way it spins is largely up to habits — yours included.

**The virtuous cycle** (small + fast):

```
  small PR  ──►  easy to review  ──►  reviewed fast  ──►  merged fast
     ▲                                                        │
     └──────────  you stay unblocked, so your next  ◄─────────┘
                  PR is also small and timely
```

A 40-line PR is *inviting*. A reviewer can pick it up between meetings, understand all of it, give real feedback, and approve — in minutes. You merge, you're unblocked, you open your next small PR. Everything flows.

**The doom loop** (slow → big → slower):

```
  slow review  ──►  "ugh, why bother opening a PR for 30 lines,
                     it'll just sit there — I'll batch more in"
       ▲                              │
       │                              ▼
  even slower  ◄──  huge PR  ◄──  reviewer dreads the 800-line wall,
   review            (800+ lines)   so they put it off even longer
```

This is the trap, and it's seductive because each step feels rational *in the moment*. "Reviews are slow anyway, so I'll bundle three changes into one PR to save round-trips." But a big PR is *harder* and *scarier* to review, so it waits *longer*, which "proves" reviews are slow, which makes you batch *even more* next time. The loop tightens until PRs are enormous and review is a chore everyone avoids.

You break the doom loop from *both* ends: keep your own PRs small (so they're easy to say yes to), and review others' PRs promptly (so nobody feels the need to batch). One person doing both makes the whole team's loop spin the right way.

> **Key insight:** PR size and review speed *cause each other*. Small PRs get fast reviews; fast reviews remove the temptation to batch into big PRs. You don't have to fix the whole team — keeping *your* PRs small and reviewing *promptly* nudges the loop toward the virtuous direction. (PR size has its own deep treatment in [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).)

---

## Core Concept 3 — Reviewer Attention Is Finite

A reviewer is a human with a fixed budget of careful attention per day. You cannot pour unlimited code into that budget and expect unlimited care to come out. Past a certain point, the brain simply stops catching things — and the reviewer, often without realizing it, slides into **rubber-stamping**: approving without really reading.

The classic data point comes from a large SmartBear/Cisco study of code review: defect-finding drops sharply once a review exceeds roughly **400 lines of code**, and reviewers' effectiveness falls off after about **60 minutes** of focused reviewing. Treat these as soft guideposts, not laws of physics — but the *shape* is real and you've felt it: somewhere past a few hundred lines, your eyes glaze and you start skimming.

What "too much" looks like in practice:

| What you ask of one reviewer | Realistic outcome |
|---|---|
| 40-line PR | Careful, line-by-line read. Real feedback. |
| ~200-line PR in one sitting | Still good, if focused. |
| ~400+ lines in one sitting | Quality drops; later parts skimmed. |
| 800-line PR | Mostly skimmed; "LGTM" risk high. |
| 20 PRs queued for one person today | Each gets a glance, not a review. Rubber-stamps. |

Two separate things overload a reviewer, and it's worth keeping them distinct:

- **Per-PR size** — one PR that's too big to hold in your head at once.
- **Queue depth** — too many PRs piled on one person, even if each is small. Twenty small PRs in a day is still twenty context-loads.

Both end in the same failure: attention runs out, and review degrades into a stamp. And a rubber-stamp is worse than slow review, because it *looks* like review happened — the PR is approved, the box is ticked — while no actual checking occurred. The bug ships with a green checkmark on it.

> **Key insight:** A reviewer's careful attention is a finite daily budget (~an hour, ~a few hundred lines before it degrades). Overload it — with one giant PR *or* a deep queue — and you don't get worse review, you get *fake* review: approvals with no checking behind them. Protect the budget by keeping PRs small and spreading review load across the team.

---

## Core Concept 4 — A Few Metrics Worth Knowing

You don't need a dashboard with forty charts. At a junior level, three numbers tell you almost everything about where review is healthy and where it's stuck. Each one is just a clock measuring a different span of a PR's life.

```
   PR opened                first review                 merged
      │ ─────────────────────── │ ───────────────────────── │
      │ ◄── time-to-first ──►   │                           │
      │       review (TTFR)     │                           │
      │ ◄────────────── cycle time ──────────────────────►  │
```

| Metric | What it measures | What it tells you |
|---|---|---|
| **Time-to-first-review (TTFR)** | Opened → first reviewer engages | Are PRs waiting too long to even be looked at? (responsiveness) |
| **PR cycle time** | Opened → merged | How long the *whole* journey takes. Catches slow back-and-forth, not just first response. |
| **PR size** | Lines / files changed | Whether you're feeding reviewers digestible pieces (it strongly affects the other two). |
| **WIP / open PRs** | How many PRs are open at once | Whether work is piling up unfinished instead of flowing through. |

A worked example — read these as a story, not a grade:

```
Team A:  TTFR ≈ 30 min,  cycle time ≈ 4 hours,   median PR ≈ 60 lines
         → healthy. Small PRs, fast first look, quick merge. Flow is smooth.

Team B:  TTFR ≈ 1.5 days, cycle time ≈ 5 days,   median PR ≈ 600 lines
         → stuck. Big PRs scare reviewers → long wait → slow merge.
           The metrics point straight at the bottleneck: PR size + first-response time.
```

The point of Team B's numbers is *not* "Team B is bad" or "find who's slow." It's: **the numbers point at a bottleneck** — here, PRs are too big and first responses are too slow. That's an actionable, blame-free finding. Maybe the team agrees to split work into smaller PRs and set a soft response norm. The metric did its job: it showed *where* to look. (These ideas connect to the broader DORA / flow metrics in [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).)

> **Key insight:** Metrics are a **flashlight, not a ruler**. TTFR and cycle time exist to answer one question — *where is work getting stuck?* — so the team can fix the *system* (smaller PRs, clearer ownership, a response norm). The instant you use them to rank people, they break (next section explains exactly why).

---

## Core Concept 5 — Goodhart's Law: Why Metrics Turn Toxic

Here is the warning that matters most, and it has a name. **Goodhart's Law:** *"When a measure becomes a target, it stops being a good measure."* The moment you score people on a number, people optimize the *number* — not the *thing the number was supposed to represent*. The metric goes up; the real goal goes down.

This isn't cynicism about people being lazy. It's a predictable response to incentives. Show me how you're measured, and I'll show you how I'll behave. Watch each review metric break the instant it becomes a target:

| Measure this as a target… | …and you get this gamed result |
|---|---|
| **Number of review comments** | Pointless **nitpicks** — comments on whitespace and naming to pad the count. Real issues drowned out. |
| **Approval speed** | **Rubber-stamps** — fast "LGTM" with no reading, because speed is what's rewarded. |
| **PRs reviewed per person** | Quick skims and stamps to boost the count; careful, slow reviews get *punished* for being slow. |
| **Lines of code written** | Bloated, copy-pasted code; nobody deletes anything (deleting *lowers* your score). |
| **PRs merged per person** | Work sliced artificially or pushed through without real review to inflate the tally. |

Every one of these *looks* like improvement on the dashboard and *is* a degradation in reality. The team's "review comments" chart climbs — because it's full of nitpicks. "Approval speed" improves — because nobody's reading. You optimized the proxy and lost the goal.

So what's the rule? **Use these metrics to find bottlenecks in the *system*, never to judge or rank *individuals*.** A healthy use: "Our team's TTFR crept up to a day — let's figure out *why* and fix the process." A toxic use: "Sara's TTFR is higher than Tom's — Sara needs to review faster." The first improves the system; the second teaches Sara to rubber-stamp and resent the dashboard.

> **Key insight:** **Goodhart's Law** guarantees that any review metric you turn into a personal scoreboard will be gamed into meaninglessness — comment-count → nitpicks, speed → rubber-stamps, count → skims. Measure the *system*, fix the *process*, and keep the numbers *off* individual people. The metric's only legitimate job is to point you at a bottleneck.

---

## Core Concept 6 — Tempo Habits You Can Start Today

Knowing the theory is useless without habits. None of these require permission, a dashboard, or a process change — you can adopt every one of them this week, and each one nudges the team's loop toward the virtuous direction.

**1. Review before you start big new work.** This is the highest-leverage habit. When you finish a task and before you dive deep into the next, check for PRs waiting on you and review them. Why? Because *your review unblocks a teammate*, and you're about to disappear into focused work for hours. A two-minute review now saves a colleague a day of waiting. Reviewing is not an interruption to "real work" — for your teammates, it *is* the thing unblocking their real work.

**2. Keep your own PRs small.** A small PR is a gift to your reviewer and a favor to yourself: it gets reviewed faster, so *you* stay unblocked. If a change is growing past a few hundred lines, look for a seam to split it. (How to split well is the whole of [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).)

**3. Respect a soft SLA on first response.** Many teams adopt a gentle norm: *"first response within a few hours"* (say, by end of half-day). This is an **SLA** — a service-level agreement, a promise about timing. "First response" is doing a lot of work here: it does **not** mean "fully review everything." It means *engage* — a comment, a question, or "looks good, merging." Even "I can't get to this until tomorrow, ping Alex if it's urgent" is a valid first response, because it unblocks the *waiting* — the author now knows what's happening instead of staring at silence.

**4. Don't overload one reviewer.** If one person is on every PR, they become a bottleneck and their attention budget blows out. Spread reviews around; tag a second reviewer; rotate. This protects both *quality* (no rubber-stamps from an exhausted reviewer) and *flow* (no single point everything queues behind).

**5. When you're the author, make the PR easy to review fast.** A clear title, a short description of *what and why*, and small size are the difference between a 5-minute review and a 50-minute one. Fast review starts with you handing over something easy to say yes to.

> **Key insight:** Tempo is built from tiny, voluntary habits — **review before starting big work**, keep PRs small, honor a soft *first-response* norm, spread the load. You don't need authority to do any of them, and each one quietly speeds up the whole team. The single biggest lever is reviewing promptly *before* you submerge into your own deep work.

---

## Real-World Examples

**1. The two-day PR that grew teeth.** A junior dev opens a clean 50-line PR on Monday afternoon. The team has no first-response norm, everyone's heads-down, and it sits. By Wednesday: `main` has moved, the PR has three merge conflicts, the author has forgotten half the reasoning, and a teammate's task that depended on it is now late. The *code* was fine on Monday. The **latency** is what cost a day of rework. A soft "respond within half a day" norm would have caught it while it was still a clean 50 lines.

**2. The 1,500-line "LGTM."** Under pressure to ship, a developer bundles a week of work into one 1,500-line PR. The reviewer opens it, sees the wall, and — being human and busy — skims the first few files, sees nothing alarming, and approves with "LGTM 👍" in four minutes. Two weeks later a bug surfaces in file #11, which nobody actually read. This is the **finite-attention** problem and the **rubber-stamp** failure in one event: a PR too big to review well got a *fake* review with a real green checkmark.

**3. The comment-count scoreboard.** A well-meaning manager puts up a dashboard ranking engineers by "review comments left this month," hoping to encourage thorough review. Within two weeks the comments are 80% nitpicks — "extra blank line," "prefer single quotes" — because that's the cheapest way to climb the chart. Real, substantive review *drops*, because a thoughtful "this needs a different approach" counts the same as "missing semicolon" but takes ten times the effort. Textbook **Goodhart's Law**: the measure became a target and stopped measuring anything.

**4. The reviewer everyone tagged.** One senior engineer was the unofficial reviewer for everything. Every PR queued behind her. Her TTFR ballooned to two days not because she was slow, but because **queue depth** was crushing her — twenty PRs a day is twenty context-loads. The fix wasn't "review faster" (that would have meant rubber-stamping); it was *spreading the load*: a review rotation so no one person was the bottleneck.

---

## Mental Models

- **Review latency as a freshness clock.** Code is freshest in your head the moment you open the PR, and it spoils over time — like produce. Review it while it's fresh and it's effortless to fix. Let it sit and it rots into context-switches and merge conflicts. Fast first response = catch it fresh.

- **The virtuous cycle as a flywheel.** Small + fast review is a flywheel: each smooth merge makes the next one easier to keep small and timely. The doom loop is the same flywheel spun backward — slow review feeds big PRs feed slower review. You're always pushing the wheel one way or the other; small PRs and prompt reviews push it the *good* way.

- **Attention as a daily fuel tank.** A reviewer starts the day with a tank of careful attention — roughly an hour, a few hundred lines, before it runs low. Pour a 1,000-line PR in and the tank empties mid-read; what comes out the back half is fumes (skimming, then a stamp). Small PRs sip; giant PRs and deep queues guzzle.

- **Metrics as a thermometer, not a report card.** A thermometer tells you the patient has a fever so you can find the cause. It doesn't *blame* the patient for the temperature, and you don't treat the fever by smashing the thermometer to read 98.6. TTFR and cycle time are thermometers: they reveal where the system is unhealthy. Point them at the *system*; never at the person.

- **First response as "I see you."** A first response — even "can't get to this till tomorrow" — is the review equivalent of waving back at someone. It costs almost nothing and ends the worst part: the silence. The author stops refreshing the page and gets on with their day.

---

## Common Mistakes

1. **Letting PRs sit because "it's not urgent."** Latency compounds quietly into context-switches, merge conflicts, and blocked teammates. The cost is invisible until you add it up. A fast *first response* is cheap and prevents almost all of it.

2. **Batching changes into one big PR to "save round-trips."** This feeds the doom loop. Big PRs review *slower*, not faster, and tempt the reviewer into rubber-stamping. Smaller, more frequent PRs are faster end-to-end even though they feel like more overhead.

3. **Overloading one reviewer (or being that reviewer).** Whether it's one giant PR or twenty small ones queued on one person, the result is the same: attention runs out and reviews degrade to stamps. Spread the load.

4. **Treating "LGTM" as review.** Approval is not evidence that anyone read the code. A rubber-stamp is *worse* than no review, because it ships the bug wearing a green checkmark — everyone assumes it was checked.

5. **Turning a metric into a personal scoreboard.** Ranking people by comments, approval speed, or PRs-reviewed guarantees gaming (nitpicks, rubber-stamps, skims) per **Goodhart's Law**. Metrics are for finding system bottlenecks, never for judging individuals.

6. **Chasing the metric instead of the goal.** "Get TTFR down" can be achieved by rubber-stamping faster — and now your number looks *great* while review quality collapsed. Always ask: did the *real* thing (fast *and* careful flow) improve, or just the proxy?

7. **Reviewing only your own corner and ignoring the queue.** If everyone only writes and nobody prioritizes reviewing, *every* PR is slow and the whole team grinds. Reviewing others' PRs promptly is part of your job, not a distraction from it.

---

## Test Yourself

1. What is the difference between **time-to-first-review (TTFR)** and **PR cycle time**? Why do many teams feel TTFR first?
2. Describe the **doom loop** between review speed and PR size in one or two sentences. How do you break it?
3. Roughly where does a reviewer's defect-finding start to drop off (lines and minutes)? What failure happens when you push well past that?
4. Your manager wants to "improve code review" by ranking engineers on number of review comments. What will predictably happen, and what's the name of the law that explains it?
5. You're about to start a big, multi-hour task. There are two PRs waiting on you. What should you do first, and why?
6. A teammate's metric says "TTFR = 2 days," but it turns out they're tagged on *every* PR. Is "review faster" the right fix? What is?
7. What is the legitimate purpose of TTFR and cycle time, and what's the one thing you must never use them for?

<details>
<summary>Answers</summary>

1. **TTFR** = opened → *first reviewer engages*; **cycle time** = opened → *merged* (the whole journey). Teams feel TTFR first because the first response is what *unblocks the conversation* and stops the author from context-switching away — until someone looks, the PR is in limbo.
2. **Doom loop:** slow reviews tempt you to batch changes into bigger PRs → big PRs are scarier/harder, so they're reviewed even *slower* → which "proves" reviews are slow → so you batch even more. **Break it from both ends:** keep your own PRs small *and* review others' PRs promptly.
3. Defect-finding drops off past roughly **400 lines** and after about **60 minutes** of focused review (soft SmartBear/Cisco guideposts). Push well past it and you get **rubber-stamping** — a fake review (approved with no real checking), so bugs ship with a green checkmark.
4. You'll get a flood of **nitpicks** (whitespace, naming) to pad the count, while substantive review *drops*. The law is **Goodhart's Law**: "when a measure becomes a target, it stops being a good measure."
5. **Review the two waiting PRs first.** You're about to disappear into deep work for hours; reviewing now *unblocks your teammates* at low cost, whereas if you start the big task first, those PRs wait hours for a response that's cheap to give now.
6. **No** — "review faster" just pushes them toward rubber-stamping. The real problem is **queue depth** (they're a bottleneck). The fix is to *spread the load*: a review rotation, a second reviewer, so no one person is on every PR.
7. **Legitimate purpose:** find where work is getting *stuck* (bottlenecks) so the team can fix the *system/process*. **Never** use them to judge, rank, or compare *individuals* — that triggers gaming and destroys the metric.

</details>

---

## Cheat Sheet

```
THE CORE METRICS (a flashlight, not a ruler)
  time-to-first-review (TTFR)  opened → first reviewer engages   (responsiveness)
  PR cycle time                opened → merged                   (whole journey)
  PR size                      lines/files changed               (drives the other two)
  WIP / open PRs               how much is open & unfinished      (is work flowing?)

LATENCY HURTS BECAUSE
  long wait → context-switch back + merge conflicts + blocked teammates
  → fast FIRST response is cheap and prevents most of the pain

THE LOOP
  virtuous:  small PR → easy review → fast merge → stay unblocked → small PR
  doom:      slow review → batch into big PR → even slower review → ...
  break it:  keep YOUR PRs small  +  review OTHERS' PRs promptly

ATTENTION IS FINITE (soft SmartBear/Cisco guideposts)
  ~400 lines / ~60 min  → defect-finding drops; past that = rubber-stamps
  overload = one giant PR  OR  a deep queue on one person
  rubber-stamp = WORSE than slow (bug ships with a green checkmark)

GOODHART'S LAW — measure becomes target → metric gets gamed
  comment count   → nitpicks
  approval speed  → rubber-stamps
  PRs reviewed    → skims
  RULE: measure the SYSTEM, fix the PROCESS, never rank PEOPLE

TEMPO HABITS (no permission needed)
  1. review before starting big new work  (unblock teammates)
  2. keep your own PRs small
  3. soft SLA: first RESPONSE in a few hours (≠ full review)
  4. don't overload one reviewer — spread the load
  5. make your PR easy to review: clear title, short why, small size
```

---

## Summary

- **Review latency** — and especially **time-to-first-review (TTFR)** — is the review pain you already feel. Its real cost isn't the wait; it's the **context-switching, branch drift, and blocked teammates** a long wait forces on both author and reviewer. A fast *first response* is cheap and prevents most of it.
- Review speed and PR size form a loop. The **virtuous cycle** (small PRs → fast review → fast merge) spins one way; the **doom loop** (slow review → batched big PRs → slower review) spins the other. Break it from both ends: keep *your* PRs small and review *others'* PRs promptly.
- A reviewer's careful attention is a **finite daily budget** (~an hour, ~400 lines before quality drops — soft SmartBear/Cisco data). Overload it with one giant PR *or* a deep queue and you get **rubber-stamping**: fake review wearing a real green checkmark, which is worse than slow review.
- A few honest metrics — **TTFR, cycle time, PR size, WIP** — work as a **flashlight to find bottlenecks**, telling you *where work gets stuck* so you can fix the *system*.
- **Goodhart's Law** guarantees that any metric you turn into a personal scoreboard gets gamed (comments → nitpicks, speed → rubber-stamps, counts → skims). Measure the system, fix the process, **never rank people**.

The junior takeaways are three: **review latency hurts flow → review promptly and keep PRs small; attention is finite → don't overload anyone; measure to find where things get stuck → never to score people.** Get those three into your daily habits and you make every teammate's day faster — including your own.

---

## Further Reading

- *Accelerate* (Forsberg, Humble & Kim) and the annual **DORA reports** — the research foundation for flow, cycle time, and why fast feedback correlates with high performance. Start here for *why* tempo matters at a team level.
- **Google Engineering Practices — "The Speed of Code Reviews"** (part of the Code Review Developer Guide) — short, practical, and the canonical argument that *fast* review is part of *good* review. Required reading; it pairs directly with this page.
- **SmartBear / Cisco code review study** — the source of the ~400-line / ~60-minute defect-detection numbers. Skim it to internalize *why* small PRs review better.
- The [middle.md](middle.md) of this topic, which formalizes these metrics (percentiles vs averages, queue theory and WIP limits, batch size, and how to instrument tempo without triggering Goodhart effects).

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md) — the *cause* behind half of these metrics: small PRs are the lever that makes fast, careful review possible.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — fast tempo is worthless if the feedback itself is unhelpful; this is the quality side of speed.
- [08 — Review Anti-patterns](../08-review-anti-patterns/junior.md) — rubber-stamping, nitpick floods, and the bottleneck reviewer, treated as the anti-patterns they are.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — where TTFR and cycle time fit into the bigger picture of flow and delivery metrics.
- [Quality Gates](../../quality-gates/) — the automated checks that run *alongside* human review, so reviewers spend their finite attention on what humans do best.
