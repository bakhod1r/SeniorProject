# Review Metrics & Tempo — Middle Level

> **Roadmap:** [Code Review](../README.md) → Review Metrics & Tempo
> *The junior page argued that fast review is a team kindness. This page turns that intuition into instrumentation: the handful of metrics that actually measure review flow, the queueing model that explains why slow review compounds, and the Goodhart traps that turn every one of those metrics into a weapon the moment you point it at a person.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Metrics That Matter](#core-concept-1--the-metrics-that-matter)
5. [Core Concept 2 — Review Is Work in Progress (The Flow Model)](#core-concept-2--review-is-work-in-progress-the-flow-model)
6. [Core Concept 3 — Fixing Tempo: SLAs, WIP Limits, and Review Windows](#core-concept-3--fixing-tempo-slas-wip-limits-and-review-windows)
7. [Core Concept 4 — Reviewer Load and the Attention Ceiling](#core-concept-4--reviewer-load-and-the-attention-ceiling)
8. [Core Concept 5 — Goodhart-Proofing Review Metrics](#core-concept-5--goodhart-proofing-review-metrics)
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

> Focus: **Which review numbers tell you the truth, and how do you keep them honest?**

At the junior level, "review faster" is a feeling — you've waited two days for an approval and felt the cost in your bones. That feeling is correct, but a feeling can't be put on a dashboard, can't justify an SLA to a skeptical manager, and can't tell you *which* part of your review process is broken.

This page formalizes it. There are exactly five or six review metrics worth tracking, and each one answers a specific question: *how responsive are we?* (time-to-first-review), *how long does the whole loop take?* (cycle time), *how much rework per change?* (iterations), *are some people drowning?* (reviewer load). Underneath them sits one organizing idea: **a PR in review is work in progress that blocks its author**, and the queueing behaviour of WIP explains the entire "slow review → bigger PRs → slower review" doom loop.

But every metric here is a loaded gun. Measure comment count and you breed nitpicking; rank people by PRs reviewed and quality collapses overnight. So the second half of this page is about *Goodhart-proofing*: measure flow and system health, use the numbers to find bottlenecks, and never — not once — turn a review metric into an individual performance score.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and understand why review latency matters to an author.
- **Required:** You've participated in code review on a team with a PR tool (GitHub, GitLab, Gerrit, or similar).
- **Helpful:** A rough grasp of [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) — size is the single biggest driver of the metrics here.
- **Helpful:** Any exposure to DORA / delivery metrics (see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)); review latency is a large slice of lead time.

---

## Glossary

| Term | Meaning |
|---|---|
| **TTFR** | Time-to-first-review — wall-clock time from "PR ready for review" to the first substantive reviewer response. The responsiveness signal. |
| **Review cycle time** | Time from PR opened (ready) to merged. Includes review *and* author rework and all waiting. |
| **Iterations / round-trips** | Number of review → revise → re-review loops before merge. A rework signal. |
| **PR size** | Lines changed (added + deleted), or files touched. The dominant input to every other metric. |
| **Reviewer load** | Reviews assigned/completed per reviewer per unit time. The fatigue signal. |
| **WIP** | Work in progress — here, the count of open PRs awaiting review or rework. |
| **SLA** | Service-level agreement — a team commitment, e.g. "first response within 4 working hours." |
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure." |
| **Counter-metric** | A quality/outcome metric paired with a speed metric to detect gaming (e.g. escaped defects beside merge speed). |
| **p50 / p90** | Median and 90th-percentile of a distribution. p90 exposes the bad tail that the average hides. |

---

## Core Concept 1 — The Metrics That Matter

There are not twenty review metrics. There are about six that carry signal; the rest are vanity or noise. Define each precisely, and — more importantly — know what question it answers and how to *read* it.

**1. Time-to-first-review (TTFR).** Wall-clock from "PR marked ready" to the first substantive reviewer comment or approval. This is the **responsiveness** metric — the single best proxy for "does this team treat review as a priority?" Read it at **p50 and p90**, never as a mean: the mean is dragged around by one PR that sat over a weekend, while p90 tells you "one in ten authors waits *this* long," which is what actually erodes morale.

**2. Review cycle time (PR open → merge).** Total wall-clock from ready-for-review to merged. This is the **end-to-end loop** and it decomposes cleanly:

```
cycle time  =  TTFR              (waiting for first look)
            +  review duration   (reviewer reading + commenting)
            +  rework time       (author addressing feedback)
            +  re-review waits    (waiting again, per iteration)
```

Most teams are shocked to learn that **waiting**, not reading, dominates cycle time. The reviewer's actual attention might be 20 minutes; the PR was open for 26 hours. That gap is pure queueing — and it's the cheapest thing to fix.

**3. Review iterations / round-trips.** How many review→revise cycles before merge. One or two is healthy. Five-plus signals one of: a too-large PR, unclear requirements, a reviewer relitigating scope, or design disagreement that should have happened *before* coding. Iterations are a **rework** signal; pair them with size before drawing conclusions.

**4. PR size distribution.** Lines changed, read as a distribution (p50/p90), not an average. Size is the **master variable**: it drives TTFR (big PRs intimidate reviewers into procrastinating), iterations (more surface area, more findings), and defect-catch rate (attention degrades past a few hundred lines — see Concept 4). Almost every other metric improves when the size distribution shrinks. This is why [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) is upstream of everything on this page.

**5. Reviewer load.** Reviews completed (and pending) per reviewer per week. Read as a *distribution across people*, because the failure mode is concentration: a healthy team average can hide one senior who is doing 60% of reviews and is one bad week away from rubber-stamping everything (Concept 4).

**6. The DORA connection.** DORA's **lead time for changes** measures commit → production. Review latency is one of its largest, most controllable components — frequently 30–50% of the time a change spends in flight. So review cycle time is not a "nice to have" team metric; it is a *direct input* to an industry-standard delivery metric. Shrinking TTFR and cycle time is one of the highest-leverage moves on lead time, far cheaper than re-architecting your pipeline. (See [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).)

> **Key insight:** Read every one of these as a **distribution (p50/p90)**, never as an average. Averages hide the tail, and the tail — the PR that waited three days, the reviewer doing triple load — is exactly where the pain and the signal live. A team can have a great average TTFR and a quietly miserable p90.

---

## Core Concept 2 — Review Is Work in Progress (The Flow Model)

Here is the idea that turns these metrics from a report card into a diagnostic tool: **an open PR awaiting review is work in progress, and it blocks its author.**

The author finished the work — the value is *built* — but until it merges, that value is shipping nothing, and the author is in a worse spot than "idle." They are holding state in their head, defending a diff against a moving `main`, and deciding whether to start something new on top of code that might still change. A PR sitting in review is the most expensive kind of inventory: finished but undelivered.

**The doom loop.** Slow review doesn't stay slow — it gets *worse*, through a self-reinforcing cycle:

```
slow review  →  author batches more work into one PR
             →  (because opening a new small PR just adds to the pile)
             →  bigger PR  →  harder to review  →  even slower review
             →  merge conflicts pile up while it waits
             →  reviewer dreads the big PR, procrastinates  →  slower still
                                    ↑__________________________________|
```

Every link is real. Big PRs are slower to review (more to read). Slow review makes authors batch (why open three small PRs that all queue?). Batching makes PRs bigger. And a PR that waits accumulates conflicts against everything else that merged, adding rework that further delays it.

**Little's Law gives the intuition.** From queueing theory:

```
average WIP  =  throughput  ×  average cycle time
            ⇒   cycle time  ∝  WIP / throughput
```

Read it backwards: for a fixed team throughput, **the more PRs in flight at once, the longer each one takes**. Open review WIP and cycle time move together. This is *why* WIP limits work — capping in-flight reviews directly caps cycle time. It's also why "everyone has eight PRs open" feels chaotic and slow even when everyone is busy: high WIP *is* high latency, mathematically.

> **Key insight:** Optimize the *flow of PRs through review*, not the *utilization of reviewers*. A team where reviewers are 100% busy but PRs sit for two days is a slow team. A team that clears review fast — even with reviewers occasionally "idle" between PRs — is a fast team. High utilization and high WIP are how queues form; low cycle time is the actual goal.

---

## Core Concept 3 — Fixing Tempo: SLAs, WIP Limits, and Review Windows

Knowing review is WIP tells you the levers. There are three, and they work together.

**Lever 1 — Response-time SLAs.** A team agreement on *first response*, e.g. **"a PR gets a first review within 4 working hours, or by end of next morning at the latest."** Note the careful wording: the SLA targets **first response**, not merge. You can't promise a merge time — that depends on how much rework a PR needs — but you *can* promise the author won't be left wondering whether anyone has even looked. Google's own guidance frames it this way: respond *fast*, even if the response is "I can't do a full review until tomorrow, but here's a first pass."

The trade-off is sharp and you must name it: **an SLA on speed, unbalanced, becomes a rubber-stamping incentive.** If "respond within 4 hours" is enforced and "catch real defects" is not measured, the path of least resistance is LGTM-without-reading. An SLA is only safe when paired with a quality counter-metric (Concept 5).

**Lever 2 — WIP limits.** Cap how many PRs a person (or team) has in flight. The most powerful version is a discipline, not a tool setting:

> **"Review before you pull new work."** Before starting a new task, clear the reviews waiting on you. This caps team WIP at its source and directly attacks the doom loop — it keeps PRs moving instead of accumulating.

By Little's Law, capping WIP caps cycle time. Many teams encode this as a board policy ("no more than N PRs in the *In Review* column") or a personal rule ("two open PRs max; finish one before opening a third").

**Lever 3 — Review windows vs constant interruption.** This is the **maker-time tension**. Review is interrupt-shaped work; deep coding needs uninterrupted blocks. Two strategies, each with a cost:

| Strategy | How | Pro | Con |
|---|---|---|---|
| **Constant / ASAP** | Review as PRs arrive | Lowest TTFR | Shreds maker focus; context-switch tax all day |
| **Batched windows** | e.g. review at 10:00 and 16:00 daily | Protects focus blocks | Higher TTFR (a PR can wait for the next window) |

The pragmatic answer is **batched windows tuned to the SLA**: two or three review windows a day usually keeps TTFR within a same-day SLA while preserving large maker blocks. The exact cadence is a team negotiation between responsiveness and focus — but make it a *deliberate* choice, not an accident of who happens to be staring at notifications.

**Lever 4 — Reviewer rotation / load-balancing.** Don't let review concentrate on whoever is most senior or most helpful. Rotate assignment (round-robin, load-aware auto-assignment, or a rotating "reviewer of the day") so the queue is shared and no single person becomes the bottleneck *or* burns out. This is largely an automation concern — see [tooling 06](../06-review-tooling-and-automation/middle.md) for auto-assignment and load-balancing mechanics.

---

## Core Concept 4 — Reviewer Load and the Attention Ceiling

Review quality is gated by a physical fact: **human inspection has a finite, measurable ceiling.**

The most-cited number comes from SmartBear's large Cisco study: review effectiveness collapses past roughly **400–500 lines of code in one sitting**, and past about **60 minutes** of continuous reviewing. Beyond those limits, defect-detection rate falls off a cliff — the reviewer is still scrolling, but no longer *seeing*. Recommended inspection rate lands around **300–500 LOC per hour**; push faster and you're skimming, not reviewing.

This ceiling is the mechanism behind two failures:

1. **The LGTM-without-reading failure.** An overloaded reviewer with twelve PRs in their queue and a focus block to protect will, predictably, approve without real inspection. Not because they're lazy — because the alternative (genuinely inspecting twelve PRs today) is impossible. **Overload manufactures rubber-stamps.** The fix isn't exhortation ("review more carefully!"); it's reducing the load.

2. **The big-PR collapse.** A 1,200-line PR cannot be reviewed well in one pass — it's three times past the attention ceiling. The reviewer either spends hours (expensive, and still degraded by fatigue) or skims (cheap, and misses defects). Either way, large PRs *guarantee* worse review. This is the hard, quantified version of [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md)'s argument.

The practical controls are **caps and rotation**:

- Cap reviews-per-person-per-day at a sane number (and watch the *distribution*, not the average, to catch concentration).
- Rotate reviewers so load is shared, not heaped on the willing.
- Keep PRs under the attention ceiling (~400 LOC) so each review *can* be done well within budget.

> **Key insight:** A reviewer has a fixed daily budget of real attention — roughly a few sub-400-LOC reviews done well, not a dozen. Exceed that budget and you don't get more review; you get **the same approvals with the inspection silently removed.** Reviewer load is therefore a *quality* control, not just a fairness one: overloading reviewers doesn't slow quality down, it deletes it.

---

## Core Concept 5 — Goodhart-Proofing Review Metrics

This is the most important section on the page, and the easiest to get catastrophically wrong.

**Goodhart's law:** *when a measure becomes a target, it ceases to be a good measure.* Review metrics are unusually vulnerable because they're cheap to game and the gaming *looks like* the desired behaviour. Here is the field guide of how each metric perverts the moment it becomes an individual target:

| Metric used as a target | What people optimize | The perverse result |
|---|---|---|
| **Comment count** ("engaged reviewers comment more") | Leaving more comments | **Nitpicking** — trivial style notes to pad the count; signal-to-noise collapses |
| **Approval / merge speed** ("fast reviewers are good") | Approving faster | **Rubber-stamping** — LGTM without reading; defects sail through |
| **PRs reviewed per person** (ranked) | Reviewing *more* PRs | **Quality collapse + gaming** — skim everything, claim reviews, real inspection gone |
| **"Reviews approved" as a KPI** | Accumulating approvals | **Perverse incentive** — reviewers stop blocking bad PRs because blocking lowers their number |
| **Lines reviewed** | Reviewing big PRs fast | Rewards exactly the unreviewable big-PR behaviour you want to discourage |

Notice the pattern: **every speed/volume metric, when targeted at an individual, optimizes itself by removing the actual review.** The metric goes up and the value goes down — the defining shape of a Goodhart failure.

**The principle, stated as a rule:**

> **Measure flow and system health (TTFR, cycle time, WIP) to find bottlenecks and improve the *system*. Never use review metrics as individual performance scores.**

Two corollaries make this operational:

**A. Team-level, not individual-level.** The unit of measurement is the *team* and the *process*, not the person. "Our team's p90 TTFR is 26 hours — why, and how do we fix the queue?" is a healthy question. "Priya reviewed 4 PRs and Sam reviewed 11, so Sam is the better engineer" is a guaranteed way to destroy review quality, because it teaches everyone to optimize the number instead of the outcome. (See the deeper treatment in [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) on Goodhart and metric misuse.)

**B. Pair every speed metric with a quality counter-metric.** This is the structural defense against gaming. If you watch *how fast* reviews happen, you must simultaneously watch *whether quality held*:

| Speed metric | Counter-metric (watch together) |
|---|---|
| TTFR / cycle time ↓ | **Escaped defects** (bugs found after merge) — did we get fast by getting sloppy? |
| Merge speed ↑ | **Rework / change-failure rate** — are merged PRs bouncing back? |
| PRs reviewed ↑ | **Defects caught in review** — is inspection still happening? |

If speed improves *and* the counter-metric holds, you genuinely got better. If speed improves *and* escaped defects climb, you didn't get faster — you stopped reviewing. The pair is the truth; either number alone is a lie waiting to be gamed.

> **Key insight:** A review metric is a **thermometer, not a thermostat, and never a scoreboard.** Use it to *diagnose the system* — find the slow queue, the overloaded reviewer, the oversized PR. The instant you attach it to a person's performance review, you've converted a diagnostic into an incentive, and people will optimize the number by deleting the very thing it was meant to measure.

---

## Real-World Examples

**1. A review-metrics dashboard (team-level).** What a healthy review dashboard actually shows — flow and distributions, no per-person leaderboard:

```
TEAM REVIEW HEALTH — last 30 days          target
────────────────────────────────────────  ──────
Time to first review   p50   3.1 h          < 4 h
                       p90   19.0 h    ⚠     < 8 h     ← the tail is the problem
Review cycle time      p50   8.0 h
                       p90   2.4 d    ⚠
PR size (lines)        p50   78
                       p90   640     ⚠     < 400      ← drives the tails above
Review iterations      p50   1.0
                       p90   4.0
Open review WIP (now)        17 PRs                    ← high → expect long cycle time
─── counter-metrics ───────────────────────
Escaped defects / wk         2 (flat)                  ← speed not bought with quality
Change-failure rate          11%
```

The story reads itself: p50 is fine, but the **p90 tail is bad and PR size is driving it** — the fix is smaller PRs and clearing the WIP, not "review faster." Crucially, the counter-metrics are flat, so the team isn't trading quality for speed. No name appears anywhere.

**2. A concrete SLA.** A team's written review SLA, phrased to dodge the rubber-stamp trap:

```
REVIEW SLA
• First response within 4 working hours of "ready for review",
  or by 11:00 next working day if opened late.
• "Response" = a real first pass OR an explicit "starting at 2pm,
  here's an initial skim." A bare 👍 does NOT count.
• Review before you pull new work: clear your queue first.
• Counter-metric: we track escaped defects monthly; if they rise
  while TTFR falls, the SLA is being gamed and we revisit it.
```

It commits to *responsiveness*, not merge time; it defines "response" so an emoji can't satisfy it; and it pre-commits to watching the counter-metric so the SLA can't quietly degrade into rubber-stamping.

**3. The leaderboard that backfired.** A team adds a "PRs reviewed this sprint" leaderboard to spur engagement. Within two sprints, the top "reviewer" is approving PRs in under 90 seconds, review comments have dropped, and escaped defects are climbing. The metric went up; review went away. They kill the leaderboard, switch to team-level TTFR + escaped-defects, and quality recovers. Textbook Goodhart, observed in the wild — and exactly why review metrics stay off individual scorecards.

---

## Mental Models

- **A PR in review is inventory on a shelf.** It's finished goods that haven't shipped — the most expensive kind, because the value is built but delivering nothing while it ages and collects conflicts. The goal is to move inventory *through*, not to keep the warehouse (reviewers) maximally busy.

- **TTFR is a heartbeat; cycle time is the full breath.** TTFR tells you the team is *alive and responsive*. Cycle time tells you how long the whole respiratory loop takes. You want a quick heartbeat *and* an efficient breath — and most of the breath is holding (waiting), not the active part (reading).

- **Little's Law is a speed limit you can't argue with.** Cycle time ∝ WIP / throughput. For fixed throughput, more PRs in flight *mathematically* means slower review. You cannot "try harder" your way out of high WIP; you cap it or you wait.

- **A reviewer has a fuel tank, not an infinite engine.** A few sub-400-LOC reviews of real attention per day, then the tank's empty. Past empty you still get approvals — just with the inspection burned off. Load is a quality control because the tank is finite.

- **A targeted metric is a genie's wish.** Ask for "more comments" and you get nitpicks. Ask for "faster approvals" and you get rubber-stamps. The genie grants the *literal number*, not the intent — so never wish on a metric you can't pair with a counter-metric.

---

## Common Mistakes

1. **Reporting averages instead of p50/p90.** A mean TTFR of "5 hours" can hide a p90 of two days. The tail is where authors suffer and where the signal is. Always read review metrics as distributions.

2. **Optimizing reviewer utilization instead of PR flow.** "Our reviewers are always busy" is not the goal; "PRs clear review fast" is. Maxing utilization *creates* the queue (Little's Law) that slows everything down.

3. **Setting a speed SLA with no quality counter-metric.** "Respond in 4 hours," enforced and alone, trains rubber-stamping. Every speed target needs a paired escaped-defects or change-failure metric or it will be gamed.

4. **Treating cycle time as a reviewer problem.** Most cycle time is *waiting*, not reading — and a huge share is driven by PR *size*, which is an authoring choice. Telling reviewers to "go faster" misdiagnoses a queueing-and-size problem.

5. **Ranking people by review volume.** PRs-reviewed-per-person as a ranked KPI is the single most reliable way to destroy review quality. It rewards skimming and punishes the reviewer who blocks a bad PR. Keep all review metrics team-level.

6. **Ignoring reviewer-load concentration.** A healthy *average* load can hide one senior carrying 60% of reviews. Watch the distribution; concentration produces both a bottleneck and a burnout-driven rubber-stamp.

7. **Confusing "more comments" with "better review."** Comment count rewards nitpicking. A great review might be three substantive comments; a terrible one might be twenty style nits. Volume is not quality.

---

## Test Yourself

1. Define TTFR and review cycle time. Why should both be read at p90, not as a mean?
2. Decompose review cycle time into its parts. Which part usually dominates, and what does that imply about where to focus?
3. State Little's Law for review and explain *why* high open-PR WIP makes each review slower.
4. Walk through the "slow review → bigger PRs" doom loop. Name at least three links in the cycle.
5. A team adds an SLA: "approve every PR within 2 hours." What failure mode does this invite, and what one addition makes it safe?
6. Roughly what are the SmartBear attention limits (LOC and minutes), and what *quality* failure do caps-and-rotation prevent?
7. Your lead wants to rank engineers by "PRs reviewed per sprint." Give the Goodhart argument against it and the counter-metric you'd pair with any speed metric instead.

<details>
<summary>Answers</summary>

1. **TTFR** = time from "PR ready" to first substantive reviewer response (responsiveness). **Cycle time** = time from ready to merged (the full loop). Read at **p90** because the mean hides the tail — one PR that waited the weekend skews the average, while p90 tells you what one-in-ten authors actually experiences, which is what erodes morale.
2. cycle time = TTFR + review duration + rework time + re-review waits. **Waiting dominates** (TTFR + re-review waits), not active reading. Implication: the cheapest wins are in *reducing queueing* (WIP limits, SLAs), not in reviewers reading faster.
3. **cycle time ∝ WIP / throughput.** For fixed throughput, more PRs in flight at once means each spends longer waiting in the queue — it's queueing, not effort. Capping WIP directly caps cycle time.
4. Slow review → authors batch more into one PR (why open small PRs that all queue?) → PRs get bigger → bigger PRs are harder/slower to review → they accumulate merge conflicts while waiting → reviewers dread and procrastinate on the big PR → review gets slower still → loop. (Any three of: batching, larger size, slower review, conflicts, reviewer dread.)
5. It invites **rubber-stamping** — a 2-hour merge SLA with no quality check makes LGTM-without-reading the path of least resistance. Make it safe by (a) targeting *first response* not merge, and (b) pairing it with a quality counter-metric like escaped defects, watched together.
6. Roughly **~400–500 LOC** and **~60 minutes** per sitting before defect-detection collapses (~300–500 LOC/hour effective rate). Caps-and-rotation prevent the **overload-induced rubber-stamp** — an overloaded reviewer doesn't review worse *slowly*, they approve without inspecting at all. Load is a quality control.
7. Goodhart: ranking PRs-reviewed makes people optimize the *count* by skimming everything and claiming reviews — quality collapses and reviewers stop blocking bad PRs (blocking lowers the number). It's also individual-level, which weaponizes a flow metric. Instead keep metrics **team-level**, and pair any speed metric (TTFR, merge speed) with a **quality counter-metric** (escaped defects, change-failure rate) so gaming shows up immediately.

</details>

---

## Cheat Sheet

```
THE METRICS (read as p50/p90 distributions, team-level)
  TTFR              ready → first response     responsiveness signal
  cycle time        ready → merged            full loop (mostly WAITING)
  iterations        review→revise round-trips rework signal
  PR size           lines changed             MASTER variable; drives all others
  reviewer load     reviews/person/week       fatigue; watch DISTRIBUTION not avg
  → DORA lead time  review latency = 30–50% of commit→prod

FLOW MODEL
  open PR = WIP that BLOCKS the author (expensive inventory)
  Little's Law:  cycle time ∝ WIP / throughput   (more WIP ⇒ slower)
  doom loop:  slow review → bigger PRs → slower review → conflicts → ...
  optimize PR FLOW, not reviewer UTILIZATION

FIXING TEMPO
  SLA        first RESPONSE in N hours (not merge)   ⚠ pair w/ quality metric
  WIP limit  "review before you pull new work"
  windows    batched (2–3/day) protects maker time vs ASAP lowest TTFR
  rotation   round-robin / load-aware (see tooling 06)

ATTENTION CEILING (SmartBear)
  ~400–500 LOC and ~60 min per sitting → then detection COLLAPSES
  overload → LGTM-without-reading (load is a QUALITY control)

GOODHART-PROOFING  (most important)
  measure FLOW + SYSTEM health → find bottlenecks → fix the SYSTEM
  NEVER an individual performance score          TEAM-level only
  comment count   → nitpicking
  approval speed  → rubber-stamping
  PRs reviewed    → skim + quality collapse
  reviews approved KPI → stop blocking bad PRs
  RULE: pair every SPEED metric with a QUALITY counter-metric
        (escaped defects / change-failure / defects-caught)
```

---

## Summary

- There are about six review metrics worth tracking: **TTFR** (responsiveness), **cycle time** (the full open→merge loop), **iterations** (rework), **PR size** (the master variable that drives the rest), **reviewer load** (fatigue), and the **DORA lead-time** connection (review latency is 30–50% of commit→prod). Read every one as a **p50/p90 distribution**, never an average — the tail is the signal.
- The organizing model is **flow**: an open PR is **work in progress that blocks its author**. Little's Law (cycle time ∝ WIP / throughput) explains why high WIP means slow review, and the **doom loop** (slow review → bigger PRs → slower review) explains why slowness compounds. Optimize PR *flow*, not reviewer *utilization*.
- Fix tempo with **response-time SLAs** (on first response, not merge), **WIP limits** ("review before you pull new work"), deliberate **review windows** (batched vs ASAP — the maker-time tension), and **reviewer rotation** for load-balancing.
- Reviewer attention is finite — **~400 LOC / ~60 min** before detection collapses (SmartBear). Overload doesn't slow quality, it **deletes** it via LGTM-without-reading; caps and rotation are quality controls.
- **Goodhart-proof everything.** Every review metric perverts when targeted at a person: comment count → nitpicking, approval speed → rubber-stamping, PRs-reviewed → quality collapse. Measure **flow and system health to find bottlenecks**, keep metrics **team-level**, and **pair every speed metric with a quality counter-metric** so gaming surfaces immediately.

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) and the annual **DORA reports** — lead time / cycle time as delivery metrics, and why review latency is a controllable slice of them.
- Google Engineering Practices — *"The Speed of Code Reviews"* — the canonical argument for fast first response and the responsiveness-over-merge-speed framing.
- **DX / SPACE framework** (Forsgren et al., *"The SPACE of Developer Productivity"*) — why developer-productivity (and review) metrics must be multi-dimensional and never single-number individual scores.
- **SmartBear / Cisco code-review study** — the empirical source for the ~400-LOC / ~60-minute inspection ceiling and recommended review rate.
- [senior.md](senior.md) — designing a review-metrics program org-wide: bottleneck analysis, metric-system design, and resisting Goodhart at scale.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) — the master variable upstream of every metric here; small PRs fix the tails.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) — comment *quality* is what volume metrics fail to capture.
- [08 — Review Anti-patterns](../08-review-anti-patterns/middle.md) — rubber-stamping, nitpicking, and the bottleneck reviewer as concrete failures.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead/cycle time, and the deep treatment of Goodhart and metric misuse.
- [Quality Gates](../../quality-gates/) — where review SLAs and counter-metrics fit alongside automated gates.
