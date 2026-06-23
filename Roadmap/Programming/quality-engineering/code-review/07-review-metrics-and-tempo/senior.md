# Review Metrics & Tempo — Senior Level

> **Roadmap:** [Code Review](../README.md) → Review Metrics & Tempo
> *The middle page taught you which numbers to watch. This page is about why those numbers behave the way they do: the PR pipeline is a queue obeying Little's Law, the doom-loop is a formal positive-feedback system, every metric you pick is a corruptible proxy, and the only safe way to measure tempo is in balanced, system-level pairs that make gaming visible instead of profitable.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Review as a Queueing System (Little's Law)](#core-concept-1--review-as-a-queueing-system-littles-law)
5. [Core Concept 2 — Why TTFR Dominates Cycle Time](#core-concept-2--why-ttfr-dominates-cycle-time)
6. [Core Concept 3 — The Doom-Loop as a Feedback System](#core-concept-3--the-doom-loop-as-a-feedback-system)
7. [Core Concept 4 — Cost of Delay and WIP (Reinertsen)](#core-concept-4--cost-of-delay-and-wip-reinertsen)
8. [Core Concept 5 — The Metric Set, Defined (with Pitfalls)](#core-concept-5--the-metric-set-defined-with-pitfalls)
9. [Core Concept 6 — The Speed/Quality Frontier](#core-concept-6--the-speedquality-frontier)
10. [Core Concept 7 — Goodhart, Campbell, and Surrogation](#core-concept-7--goodhart-campbell-and-surrogation)
11. [Core Concept 8 — Counter-Metrics and the Balanced Set](#core-concept-8--counter-metrics-and-the-balanced-set)
12. [Core Concept 9 — Instrumentation and the Review Clock](#core-concept-9--instrumentation-and-the-review-clock)
13. [Real-World Examples](#real-world-examples)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The quantitative and statistical reasoning a senior engineer uses to make code-review tempo a managed system rather than a folk belief.**

By the middle level you can name the core metrics — time-to-first-review, cycle time, PR size, review iterations — and you know that small PRs reviewed quickly are healthier than big PRs reviewed slowly. That makes you a competent contributor and a useful reviewer. The senior jump is different: you now reason about the review pipeline as a *system with dynamics*, and you decide *what the org measures and what it must never measure*.

That requires three things the middle page only gestured at. First, a model: the PR pipeline is a queueing system, and Little's Law tells you exactly how work-in-progress, arrival rate, and cycle time relate — which is why the *wait*, not the *work*, is where your latency hides. Second, statistical literacy: review-time distributions are heavy-tailed, so a mean is a lie and you live on the p90. Third, and most important, **measurement ethics under Goodhart's law**: every review metric is a proxy for "good code shipped safely," and the instant you put individual pressure on a proxy, people optimize the proxy and abandon the goal — drive-by LGTMs, nitpick wars, PR-splitting to inflate counts. This page gives you the math to find the bottleneck and the discipline to measure it without destroying the thing you're measuring.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the named metrics, percentiles vs means, the small-PR/fast-review intuition.
- **Required:** Comfort with basic rates and ratios (throughput, arrival rate) and the difference between a median and a mean on a skewed distribution.
- **Helpful:** You've felt the doom-loop personally — a PR that sat for three days, grew conflicts, and turned into a rebase slog.
- **Helpful:** Exposure to [DORA's four keys](../../engineering-metrics-and-dora/) and at least a passing acquaintance with Goodhart's law.

---

## Glossary

- **Little's Law** — for a stable system, `L = λ × W`: average work-in-progress equals average arrival rate times average time-in-system. The load-bearing identity for any queue, including the PR pipeline.
- **TTFR (Time To First Review)** — wall-clock from "PR ready for review" to the first substantive reviewer action. The dominant, most actionable component of review latency.
- **Cycle time (review)** — wall-clock from PR opened (ready) to merged. Decomposes into wait + work segments.
- **WIP (Work In Progress)** — the number of PRs concurrently open and awaiting review or rework. The `L` in Little's Law.
- **Review iterations** — count of distinct review→revise round-trips before approval. A proxy for friction and PR clarity.
- **Goodhart's law** — "When a measure becomes a target, it ceases to be a good measure." The central hazard of all review metrics.
- **Campbell's law** — the social-science twin: the more a quantitative indicator is used for decision-making, the more it distorts and corrupts the process it monitors.
- **Surrogation** — the cognitive substitution of the *metric* for the *goal*; the team optimizes "PRs merged per day" and forgets "good code shipped safely."
- **Counter-metric (guardrail)** — a paired metric that gets *worse* when you cheat the primary metric, making the trade-off visible (e.g., escaped-defect rate paired with cycle time).
- **Cost of Delay (CoD)** — the economic cost per unit time of a deliverable not being done; the basis for Reinertsen's queueing economics.
- **SPACE** — a productivity framework (Forsgren et al.) insisting productivity is multidimensional: Satisfaction, Performance, Activity, Communication, Efficiency — never one number.

---

## Core Concept 1 — Review as a Queueing System (Little's Law)

Stop thinking of a pull request as a task and start thinking of it as a *customer in a queue*. PRs arrive at some rate, wait for a server (a reviewer), get serviced (reviewed), and depart (merge). This reframing is not a metaphor — it lets you import a century of queueing theory, and the most useful import is **Little's Law**:

```
L = λ × W

  L = average number of items in the system   (open PRs awaiting review/rework = WIP)
  λ = average arrival rate                     (PRs opened per unit time)
  W = average time in the system              (review cycle time, open → merge)
```

Little's Law is almost unreasonably general: it holds for *any* stable system regardless of arrival distribution, service distribution, or queue discipline, as long as the system isn't growing without bound. That makes it a hard constraint on your pipeline. Rearranged:

```
W = L / λ        cycle time = WIP / throughput
```

Read that again, because it is the lever. **Cycle time is WIP divided by throughput.** If you want PRs to merge faster (lower `W`) and you can't add reviewers (can't raise effective `λ` of *service*), your only remaining move is to *lower WIP* — fewer PRs open at once. This is the queueing-theory justification for WIP limits, and it is why "just tell people to review faster" fails: it doesn't change `L` or `λ`, so `W` can't move.

Worked example. A 6-person team opens **λ = 30 PRs/week**. At any moment **L = 24 PRs** sit open awaiting review or rework. Then:

```
W = L / λ = 24 / 30 = 0.8 weeks ≈ 4 working days per PR
```

Four days from open to merge — and most of that is queue, not keystrokes. Now suppose the team imposes a WIP limit that holds open PRs to **L = 9**:

```
W = 9 / 30 = 0.3 weeks ≈ 1.5 working days per PR
```

Same throughput, same people, *less than half the cycle time* — purely by lowering WIP. No one reviewed faster; the queue just got shorter, so each PR waited less.

> **Key insight:** Cycle time is WIP over throughput. You cannot exhort your way to faster reviews; you change `W` by changing `L` (limit concurrent PRs) or by raising service throughput (smaller PRs, faster pickup). "Review faster" is a wish; "cap WIP and shrink PRs" is a control input.

There's a sharper version. As any server approaches 100% utilization, queueing time explodes non-linearly — the classic M/M/1 result is that expected wait scales with `1 / (1 − ρ)`, where `ρ` is utilization. A reviewer who is 90% utilized has *ten times* the expected queue wait of one at 50% utilization. This is why a team where every senior is maxed out has catastrophic, spiky TTFR even though "everyone is busy and productive." High utilization and low latency are mathematically in tension. Slack in the reviewer pool is not waste; it is what keeps the queue from diverging.

---

## Core Concept 2 — Why TTFR Dominates Cycle Time

Decompose the review cycle into its segments and measure each:

```
PR opened ──► first review ──► last revision ──► approved ──► merged
   │   T_wait    │   T_iterate   │   T_approve   │  T_merge  │
   └─────────────┴───────────────┴───────────────┴───────────┘
                       total cycle time W
```

Now instrument a real team and the shape is almost always the same: **`T_wait` (time to first review) is the largest single segment**, frequently a majority of total cycle time. The actual reading-and-commenting *work* of a review is typically minutes to an hour; the PR sitting untouched in a queue is hours to days. The latency is in the *idle wait*, not in the *service*.

A representative decomposition:

| Segment | What it measures | Typical p50 | Typical p90 | Share of cycle |
|---|---|---|---|---|
| `T_wait` (TTFR) | open → first review | 4 h | 28 h | **~55%** |
| `T_iterate` | first review → last revision | 3 h | 20 h | ~25% |
| `T_approve` | last revision → approval | 1 h | 8 h | ~10% |
| `T_merge` | approval → merge | 0.5 h | 6 h | ~10% |

The strategic consequence is decisive: **if you only get to fix one thing, fix TTFR.** It is the largest segment, it is the most actionable (pickup is a scheduling/notification problem, not a code problem), and — as the next section shows — it is the trigger that drives the entire doom-loop. Optimizing `T_iterate` by, say, faster CI helps, but it's polishing the smaller segment. Optimizing `T_merge` by auto-merge helps the tail. Neither moves the needle like collapsing the wait.

> **Key insight:** Review latency is overwhelmingly *queue time*, not *work time*. The reviewer's eyes-on-code is cheap; the PR's wait-for-a-reviewer is expensive. This is why TTFR is the master metric of tempo — it is both the biggest segment and the lever on everything downstream.

One statistical warning, because it changes the conclusion: **use percentiles, never means.** Review-time distributions are heavy-tailed — most PRs are picked up quickly, but a long tail of PRs (cross-team, unclear ownership, Friday-afternoon, large) wait days. A mean is dragged around by that tail and describes no actual PR. The p90 (and p95) *is the pain* — it's the experience that makes engineers batch work and avoid opening PRs. Report TTFR and cycle time as p50 **and** p90; the gap between them is your tail risk, and the tail is what poisons morale.

---

## Core Concept 3 — The Doom-Loop as a Feedback System

The "big PRs are slow" intuition undersells the danger. Slow review and big PRs are not two independent problems — they are coupled in a **positive feedback loop**, and positive feedback loops don't degrade gracefully; they spiral.

Trace the causal chain:

```
   slow review (high TTFR)
        │
        ▼
   author batches more work while waiting   ◄── "the PR is open anyway"
        │
        ▼
   bigger PRs
        │
        ▼
   reviews take longer + reviewers procrastinate on the big scary diff
        │
        ▼
   PRs sit longer → more merge conflicts → more rebase/rework
        │
        ▼
   even slower effective review, more WIP
        │
        └──────────────► (back to: slow review) ── REINFORCING
```

This is a *reinforcing loop*: each trip around makes the next trip worse. In control-systems terms the loop gain is greater than one, so a small initial slowdown amplifies instead of damping out. The lived experience is a team that was "fine last quarter" and is now drowning, with no single decision to blame — the system drifted into the spiral.

Three amplifiers make the gain worse than it looks:

- **Conflict growth is super-linear in wait.** The longer a branch lives, the more the base moves, and the probability of conflict rises with both branch age and the number of concurrently open branches. More WIP (Little's Law again) means more concurrent branches means more conflicts means more rework time folded back into `W`.
- **Reviewer avoidance is non-linear in size.** A 50-line diff gets picked up in minutes; a 1,500-line diff triggers "I'll do it after lunch" — which becomes tomorrow. Big PRs *self-select for procrastination*, lengthening `T_wait` precisely on the PRs where it hurts most.
- **Context decay.** While a PR waits, the author's mental model of the change evaporates. Rework after a 3-day wait costs more than the same rework after 3 hours because the author has to page the change back in.

The crucial corollary: **you break a reinforcing loop by attacking its driver, not its symptoms.** The driver here is TTFR. Collapse pickup time and the chain never starts — authors don't batch (the PR merges before they'd add more), branches stay young (few conflicts), context stays warm (cheap rework). Small PRs and fast pickup are the *same* intervention viewed from two ends, and together they flip the loop gain below one, turning the spiral into a stable, fast pipeline.

> **Key insight:** The PR doom-loop is a reinforcing feedback system, not a collection of bad habits. Telling people to "write smaller PRs" while review stays slow fights the symptom; the loop will regrow it. Attack the driver — TTFR — and the whole loop collapses, because fast pickup removes the incentive to batch that creates big PRs in the first place.

---

## Core Concept 4 — Cost of Delay and WIP (Reinertsen)

A blocked PR *feels* free — the work is "done," it's just waiting. Donald Reinertsen's *Principles of Product Development Flow* demolishes that intuition: holding work in a queue carries real, quantifiable cost, and the most expensive thing a knowledge-work pipeline does is let inventory (WIP) pile up.

**Cost of Delay (CoD)** is the economic cost per unit time of a deliverable not being finished. For a PR it isn't only "the feature ships later." It bundles:

- **Context-switch cost.** The author, blocked, starts something else. When the review finally lands, they pay the re-immersion tax to return — and the reviewer, arriving cold to a stale PR, pays it too. Context switching is one of the most expensive and under-counted costs in software, and a slow review *manufactures* context switches.
- **Conflict/rework cost.** As Concept 3 showed, waiting PRs accumulate merge conflicts; that rebasing is pure waste created by the delay.
- **Compounding-blockage cost.** A blocked PR often blocks *other* work that depends on it, so its CoD is multiplied across a dependency chain. The queue's cost is not the sum of individual waits; it's worse.
- **Morale cost.** Nothing corrodes engineering motivation like finished work rotting in a review queue. This is diffuse and unmeasured but real, and it feeds back into the doom-loop (a demoralized team batches and disengages).

Reinertsen's punchline, expressed as queueing economics: **the cost of a queue is proportional to its size and to the cost of delay of the items in it.** Reducing batch size (smaller PRs) and limiting WIP (fewer open PRs) directly reduce that cost — which is exactly the lever Little's Law identified, now justified economically rather than only mathematically. Small batches also have a second-order win Reinertsen emphasizes: they *reduce variability*, and variability is what makes queues spike. A pipeline of uniformly small PRs has a tighter, more predictable cycle-time distribution than one mixing 20-line and 2,000-line PRs.

> **Key insight:** A blocked PR is not free inventory; it is a liability accruing context-switch, conflict, blockage, and morale costs every hour it waits. Reinertsen's economics and Little's Law converge on the same prescription — **small batches, limited WIP** — from two directions, which is why it's the most robust intervention in the whole topic.

---

## Core Concept 5 — The Metric Set, Defined (with Pitfalls)

Here is the working senior's metric set. Each entry has a *precise definition* (ambiguous definitions are how dashboards lie) and a *pitfall* (the Goodhart failure of naive targeting, detailed in Concept 7).

| Metric | Definition | Read as | Pitfall when targeted |
|---|---|---|---|
| **TTFR** (p50/p90) | open(ready) → first substantive review | the master tempo signal | drive-by "LGTM" to stop the clock |
| **Cycle time** (p50/p90) | open(ready) → merged | end-to-end flow | merge-without-real-review; gaming the clock stops |
| **Cycle-time decomposition** | the four segments above | *where* the time goes | — (diagnostic, hard to game) |
| **Review iterations** | distinct review→revise round-trips | friction / PR clarity | suppressing legitimate iterations to look "clean" |
| **PR size** (lines, files) | net diff per PR | the upstream driver of everything | splitting one logical change into noise to look "small" |
| **Reviewer load** | reviews per reviewer per unit time | distribution of effort | none direct; informs balancing |
| **Reviewer concentration** | share of reviews done by top-k reviewers | bus factor + bottleneck | — (structural signal) |
| **Reopen / rework rate** | PRs reopened or reverted after merge | escaped-review quality | hiding reverts; re-landing under new PRs |

A few of these deserve emphasis because seniors under-weight them.

**PR size is the upstream cause, not a peer metric.** It sits *causally before* TTFR, iterations, and cycle time — small PRs are picked up faster, reviewed more thoroughly, and bounce less. If you could change exactly one input to the whole system, change PR size; everything downstream improves. (This is the entire thesis of [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md), and the reason it and this topic are inseparable.)

**Cycle-time decomposition is more valuable than cycle time itself.** A single cycle-time number tells you the patient is sick; the segment breakdown tells you *which organ*. Is the wait in pickup (TTFR — a scheduling/ownership problem), in iteration (a PR-clarity or CI-speed problem), or in merge (a gate/permissions problem)? You can't prescribe without the decomposition. Always carry the segments, not just the total.

**Reviewer load and concentration are bus-factor instruments.** If three people do 80% of reviews, you have simultaneously a bottleneck (their queue dominates TTFR) and a risk (they leave, knowledge leaves). The fix — spreading review load, growing reviewers — is an organizational move, and you can't make the case without the concentration number.

**Reopen/rework rate is your cheapest quality counter-signal.** Code that comes back — reverted, reopened, hotfixed within days — is review that didn't catch what it should have. It pairs naturally with the speed metrics (Concept 8) and ties directly to DORA's **change-failure rate** and **lead time for changes** (see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)): review cycle time is a sub-component of DORA lead time, and reopen/rework is a leading indicator of change failure.

> **Key insight:** Treat PR size as the *cause* and the rest as *effects*, and always carry cycle time as its four segments, not one number. A dashboard that shows total cycle time without decomposition can tell you something's wrong but never what to do about it.

---

## Core Concept 6 — The Speed/Quality Frontier

The folk wisdom says speed and thoroughness trade off: review faster and you catch fewer bugs. At the level of a *single PR in a fixed system*, that's true — there is a per-PR frontier, and rushing one review does sacrifice rigor. The senior insight is that **this trade-off does not hold at the system level**, and conflating the two is the root of bad metric decisions.

```
Quality
(thoroughness)
  ▲
  │   ·  ·  ·   ← per-PR frontier (fixed tooling/process):
  │  ·       ·     within ONE review, faster = less thorough
  │ ·         ·
  │·           ·_______________
  │              ·              ·    ← the FRONTIER ITSELF moves out
  │                ·              ·     when you change the system:
  │                  ·             ·    small PRs + fast pickup + good
  │                    ·            ·   tooling + good test coverage
  │                                     give MORE speed AND MORE quality
  └──────────────────────────────────────► Speed (tempo)
```

The per-PR curve is real but local. The system-level move is to **push the whole frontier outward** so you get more speed *and* more quality simultaneously:

- **Small PRs** raise both axes: faster to review (speed) *and* easier to review thoroughly because the reviewer can hold the whole change in their head (quality). Size is a frontier-shifter, not a point on the curve.
- **Fast pickup (low TTFR)** raises speed without costing quality — the review work is unchanged; only the idle wait shrinks.
- **Good tooling** — linters, static analysis, formatters, CI gates, [quality gates](../../quality-gates/) — moves mechanical checks off the human, so the reviewer spends their fixed attention budget on design and correctness. More quality per minute of review.
- **Good test coverage** lets reviewers trust behavior and focus on intent rather than re-deriving edge cases by hand.

This is the *exact parallel* to DORA's central finding in *Accelerate*: high performers don't trade speed for stability — they get both, because the practices that make deployment fast (small batches, automation, fast feedback) are the *same* practices that make it safe. Code review is the micro-scale version of the same law. The teams with the fastest TTFR also tend to have the *best* escaped-defect rates, not the worst, because the practices that produce speed (small PRs, automation, fast pickup) are the practices that produce quality.

> **Key insight:** Speed and quality trade off *within one PR in a fixed system*, but not *across the system over time*. Small PRs, fast pickup, and good tooling push the entire frontier outward — you buy both at once. The classic failure is optimizing one metric in isolation and "winning" it by sliding *down* the per-PR curve, when the real move is to shift the curve.

---

## Core Concept 7 — Goodhart, Campbell, and Surrogation

This is the senior core. Internalize it or every dashboard you build will eventually do harm.

**Goodhart's law:** *when a measure becomes a target, it ceases to be a good measure.* **Campbell's law** is the sociologist's twin: *the more any quantitative indicator is used for decision-making, the more it will distort and corrupt the process it is meant to monitor.* Both say the same thing: a metric is a *proxy* for a goal, and the proxy and the goal only stay correlated while no one is pushing on the proxy. Push on it, and people optimize the proxy *directly* — including by the cheap, goal-destroying paths the metric can't distinguish from real improvement.

Every review metric is a proxy for one true goal: **good code, shipped safely, sustainably.** Watch each proxy break under pressure:

| Metric as target | What people do to "win" it | What's lost (the real goal) |
|---|---|---|
| **TTFR** ("review within 2h") | drive-by **LGTM** to stop the clock | review *quality* — the clock stopped, the review didn't happen |
| **Comment count** ("engaged reviewers comment more") | manufacture **nitpicks**; adversarial pile-on | signal-to-noise; reviews turn hostile and slow |
| **Approval rate / throughput** (individual KPI) | **rubber-stamp** to keep approving | the entire defect-catching purpose of review |
| **PRs reviewed per person** (individual KPI) | **split PRs** to inflate counts; race to claim easy reviews | thoroughness; review becomes a numbers game |
| **Low review iterations** ("clean PRs") | suppress legitimate revision requests | the corrective function — bugs ship to "stay clean" |
| **Lines reviewed** | skim huge diffs to rack up volume | the inverse of thoroughness; rewards exactly the wrong thing |

Notice the pattern: **the gaming path is always cheaper than the genuine path, and the metric can't tell them apart.** "Review within two hours" is satisfied identically by a careful two-hour review and a two-second LGTM — so under pressure, the LGTM wins. That's not a moral failing of your engineers; it's the metric handing them a cheaper way to score, and people, sensibly, take it.

The deepest version of the failure is **surrogation** — the cognitive substitution of the *metric* for the *goal*. After enough quarters of "drive TTFR down," the team stops experiencing TTFR as a *proxy* for healthy flow and starts experiencing it *as the objective itself*. They optimize the number and genuinely forget what it stood for. Surrogation is insidious precisely because it doesn't feel like cheating — it feels like doing your job. The defense is to keep the goal explicit and *always* visible next to the proxy, which is what counter-metrics (Concept 8) enforce.

(For the full treatment of Goodhart and proxy corruption across all of engineering measurement, see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — these are the same forces that ruin velocity, story points, and lines-of-code, applied to review.)

> **Key insight:** Every review metric is a proxy, and the gaming path is always cheaper than the genuine path. Pressure on a proxy doesn't produce the goal; it produces the cheapest behavior that moves the number — drive-by LGTMs, nitpick wars, rubber-stamping. Goodhart isn't a risk to manage occasionally; it is the *default outcome* of targeting any single review metric, and you design against it or you cause it.

---

## Core Concept 8 — Counter-Metrics and the Balanced Set

If targeting any single metric guarantees Goodhart corruption, the engineering answer is structural: **never ship a speed metric without a quality counter-metric that gets worse when you cheat the speed metric.** A counter-metric (or guardrail) is chosen precisely so that the cheap gaming path *spends* it — making the trade-off visible instead of free.

The pairing rule: for each thing you want to make faster, find the quality signal the *cheap* way of going faster would degrade, and watch them together.

| Primary (speed/flow) | Counter-metric (quality guardrail) | Why the pair defeats gaming |
|---|---|---|
| TTFR ↓ | **escaped-defect rate** / **change-failure rate** | drive-by LGTM lowers TTFR but defects/CFR rise — the cheat shows up |
| Cycle time ↓ | **reopen / rework / revert rate** | merge-without-review is fast but comes back — rework exposes it |
| PRs merged ↑ | **post-merge incident rate** | rubber-stamping raises throughput but incidents climb |
| Review iterations ↓ | **defects found post-merge** | suppressing iterations is "clean" but bugs escape — defects spike |

Concrete reading: TTFR drops from 28h to 4h *and* change-failure rate holds steady or improves → genuine improvement, the frontier moved out (Concept 6). TTFR drops to 4h *but* reopen rate doubles → you've bought speed by sacrificing quality; the LGTM machine is running. You cannot tell these two apart from the speed number alone — that's the whole point of the counter-metric. **A speed metric without a guardrail is an invitation to game.**

This generalizes to the **SPACE framework** (Forsgren, Storey, Noda, Butler, Houck — *The SPACE of Developer Productivity*). SPACE's core thesis is that productivity is *multidimensional* and reducing it to a single number is always misleading. It names five dimensions you should sample *across*, never collapse:

- **S**atisfaction & well-being — do reviewers feel the load is sustainable? (survey/perceptual)
- **P**erformance — outcomes: quality, reliability (change-failure rate, escaped defects)
- **A**ctivity — counts: PRs, reviews, comments (the easy-to-game ones — use sparingly)
- **C**ommunication & collaboration — review participation, knowledge spread, bus factor
- **E**fficiency & flow — TTFR, cycle time, WIP, interruptions

A healthy review dashboard deliberately mixes **flow (E), quality (P), and perceptual (S)** signals. The balance is itself the defense: it is hard to game *all* dimensions at once, and any single-metric cheat (LGTM, nitpicking, PR-splitting) shows up as a degradation in a *different* dimension. A team that "improved" flow while satisfaction craters and change-failure climbs has not improved — and only a balanced set reveals it.

> **Key insight:** Counter-metrics convert Goodhart from a hidden corruption into a visible trade-off. Pair every speed metric with the quality signal its cheap gaming path would spend, and sample across SPACE's dimensions rather than collapsing to one number. You can't win the balanced set by sacrificing one axis — and that's exactly what makes it safe to watch.

---

## Core Concept 9 — Instrumentation and the Review Clock

Metrics are only as honest as their definitions and their data. Seniors get this right because subtle definitional choices change the numbers by factors, and biased data points you at the wrong bottleneck.

**Where the data comes from.** Every metric in Concept 5 is reconstructable from the version-control / PR-platform event stream — GitHub, GitLab, Bitbucket all emit the timeline as API events or webhooks:

```
pull_request: opened, ready_for_review, converted_to_draft, closed, merged, reopened
pull_request_review: submitted (state: commented | approved | changes_requested), dismissed
pull_request_review_comment: created
review_request: requested, removed       # re-requests matter (see below)
push / synchronize                        # new commits after review = an iteration
```

You materialize each PR's timeline from these events and compute segments as timestamp differences. No human bookkeeping; the system already records the truth — your job is to read it correctly.

**When does the review clock start and stop?** This is where naive dashboards lie:

- **Start at "ready for review," not "opened."** Drafts and WIP PRs are not waiting on a reviewer — counting draft time inflates TTFR with author thinking-time and slanders the reviewers. Start the clock at `ready_for_review` (or first real review-request); pause it whenever the PR is `converted_to_draft`.
- **"First review" must be a *substantive* action.** A bot comment, a CI status, or an auto-assignment is not a review. Count the first human `pull_request_review` (commented / approved / changes_requested) or the first human review comment. Get this wrong and TTFR looks great while real review still lags.
- **Handle re-requests correctly.** When an author re-requests review after pushing changes, a *new* wait segment begins. A single open→merge span hides multiple distinct waits; the second and third pickups are often the slow ones (the PR is now "old news"). Measure each request→response gap, not just the first.
- **Stop the clock at the right event per segment.** TTFR stops at first review; cycle time stops at `merged`, not `approved` (approval-to-merge is its own segment and sometimes the hidden cost when gates or permissions stall).

**Survivorship and selection bias** — the trap that makes good-looking dashboards dangerous:

- **Survivorship bias.** If you only compute cycle time over *merged* PRs, you systematically exclude the PRs so painful they were *abandoned* — the worst experiences vanish from the data, and the dashboard looks healthier than the lived reality. Track abandonment/closure-without-merge rate alongside, or your metrics are computed on the survivors only.
- **Selection bias by PR type.** Trivial PRs (typo fixes, dependency bumps) merge in minutes and, if numerous, drag your medians down, masking that *substantive* PRs wait days. Segment by size or type before drawing conclusions, or the easy PRs will hide the hard ones.
- **The denominator problem.** "PRs reviewed per person" is meaningless without normalizing for PR size/complexity — one 2,000-line review is not one 5-line review, and treating them as equal is exactly what rewards PR-splitting (Concept 7).

> **Key insight:** The definition *is* the metric. Start the clock at "ready," count only substantive human review, measure each re-request as its own wait, and stop at merge — and always check for survivorship (abandoned PRs) and selection (trivial-PR dilution) bias. A precisely-defined p90 TTFR is worth more than a dozen vague averages, because the vague averages will confidently point you at the wrong bottleneck.

---

## Real-World Examples

**1. The team that "improved" TTFR and shipped more bugs.** Leadership set an individual OKR: every engineer's median TTFR under 2 hours. TTFR plummeted within a sprint — and so did review quality. Engineers, watched individually on the clock, learned to fire off "LGTM 👍" within minutes to stop the timer, then maybe actually look later (or not). Three weeks in, the reopen rate had doubled and two production incidents traced to changes that were "reviewed" in under a minute. The metric improved; the goal regressed. **The fix:** drop the individual target entirely, move TTFR to a *team* signal, and pair it with reopen/change-failure rate as a guardrail (Concept 8). TTFR settled higher than 2h but genuine, and defects fell. Textbook Goodhart + individual-measurement failure.

**2. Finding the bottleneck with decomposition.** A platform team's cycle-time p90 was a brutal 5 days and morale was sinking. The instinct was "reviewers are too slow — add review SLAs." But the *decomposition* (Concept 5) told a different story: TTFR p90 was a healthy 6 hours; the giant segment was `T_merge` — **approval-to-merge averaged 3+ days**. The cause: a flaky, 90-minute required CI suite that engineers re-ran repeatedly after approval, plus a manual release-gate sign-off. The bottleneck wasn't human review at all. They stabilized CI and automated the gate; p90 cycle time dropped from 5 days to under 1 — *without touching review behavior*. Without decomposition they'd have imposed reviewer SLAs and fixed nothing.

**3. WIP limit beats an exhortation campaign.** A 5-team org tried "please review faster" emails for two quarters; cycle time didn't budge (predictably — it changed neither `L` nor `λ`). Then one team applied Little's Law directly: a hard WIP limit of 1–2 open PRs per author and a "review before you open the next" norm. WIP (`L`) dropped from ~20 to ~8; with throughput unchanged, `W = L/λ` predicted a >2x cycle-time drop, and that's roughly what happened — p50 cycle time fell from ~4 days to ~1.5. Same people, same hours; the queue just got shorter. The other teams adopted it after seeing the numbers.

**4. Reviewer concentration as an early bus-factor alarm.** A staff engineer ran a concentration analysis: the top 3 reviewers were doing 78% of all reviews, and one of them was on every critical-path PR. The metric surfaced two problems at once — a TTFR *bottleneck* (everything funneled through three queues) and a *bus-factor risk* (knowledge concentrated in three heads). The response was deliberate load-spreading: pairing junior reviewers with seniors, rotating review ownership, and codifying review knowledge. Six months later concentration was down to ~45% across the top 3, TTFR p90 improved (more parallel servers), and the team survived a key reviewer's departure without a TTFR spike. None of this was visible from cycle time alone.

---

## Mental Models

- **The PR pipeline is a queue, and `W = L/λ` is the law.** Cycle time is WIP over throughput. When someone says "make reviews faster," translate it into "lower WIP or raise service throughput" — those are the only inputs that move `W`. Exhortation moves neither.

- **The wait is the work — almost.** Review latency is mostly idle queue time (TTFR), not eyes-on-code. Optimize the wait before the work; the wait is bigger *and* it's the doom-loop's trigger.

- **The doom-loop is a feedback amplifier, not a list of bad habits.** Slow review → batching → big PRs → slower review is a reinforcing loop with gain > 1. Attack the driver (TTFR) and the loop collapses; fight the symptoms and it regrows.

- **Every metric is a proxy, and the cheat is always cheaper than the goal.** A target on a proxy buys the cheapest behavior that moves it — LGTM, nitpick, rubber-stamp. Assume Goodhart by default; design counter-metrics so the cheat costs something visible.

- **Pair every speed number with the quality it would spend.** A speed metric alone is an invitation to game. The counter-metric turns a hidden corruption into a visible trade-off, and a balanced SPACE set can't be won by sacrificing one axis.

- **Measure the system, not the person.** Aggregate, trend, find bottlenecks. Individual review metrics are the canonical Goodhart trap and they destroy the psychological safety that makes review work at all (see [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/senior.md)).

---

## Common Mistakes

1. **Targeting an individual's review metrics.** TTFR-per-person, PRs-reviewed-per-person, approval-rate-as-KPI — these are the canonical Goodhart traps. They produce drive-by LGTMs, PR-splitting, and rubber-stamping, and they poison psychological safety so review stops catching anything. **Measure at the team/system level, for improvement and bottleneck-finding, never for stack-ranking.**

2. **Reporting means instead of percentiles.** Review-time distributions are heavy-tailed; the mean describes no real PR and hides the tail that actually hurts. Always report **p50 and p90** — the p90 is the pain, and the p50–p90 gap is your tail risk.

3. **Shipping a speed metric with no quality counter-metric.** TTFR or cycle time alone can be "won" by skipping real review. Without a paired guardrail (escaped-defect / change-failure / reopen rate), you can't tell genuine improvement from gaming. **Never ship a speed metric naked.**

4. **Optimizing one metric in isolation.** Crushing TTFR while ignoring quality slides you *down* the per-PR frontier (Concept 6). The system-level win is to shift the frontier (small PRs + fast pickup + tooling), getting speed *and* quality — not to trade one for the other.

5. **Carrying total cycle time without decomposition.** A single number tells you something's wrong but never *what*. The bottleneck might be pickup (TTFR), iteration (CI/clarity), or merge (gates) — and the fixes are completely different. Always carry the four segments.

6. **Sloppy clock definitions.** Counting draft time in TTFR, treating a bot comment as "first review," or measuring only the first wait (ignoring re-requests) all produce confidently-wrong numbers. Start at *ready*, count only *substantive human* review, measure *each* request→response gap, stop at *merge*.

7. **Computing metrics on survivors only.** Cycle time over merged PRs alone excludes the abandoned-because-painful PRs — the worst experiences vanish and the dashboard flatters you. Track abandonment rate and segment by PR type so trivial PRs don't dilute the medians.

8. **Treating PR size as a peer metric instead of the upstream cause.** Size sits causally before TTFR, iterations, and cycle time. If you fix one input, fix size — everything downstream follows. (See [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md).)

---

## Test Yourself

1. A team opens 40 PRs/week and holds 32 open at any time. What's the average cycle time by Little's Law? If they cap WIP at 12 with throughput unchanged, what's the new cycle time — and *why* did it drop without anyone reviewing faster?
2. Why is TTFR considered the master tempo metric? Give both the *decomposition* reason and the *feedback-loop* reason.
3. Draw the PR doom-loop and explain why it's a *reinforcing* loop. What single lever breaks it, and why does attacking the symptoms (e.g., "write smaller PRs") fail?
4. State Goodhart's law and give three different review metrics, the gaming behavior each produces when targeted, and what real goal is lost in each case.
5. What is a counter-metric? Pair counter-metrics with (a) TTFR and (b) PRs-merged-per-week, and explain how each pair makes gaming visible.
6. Speed and quality trade off per-PR but not at the system level. Explain the difference and name three things that push the whole frontier outward.
7. Your TTFR dashboard looks great but engineers complain reviews are slow. List three instrumentation/bias problems that could explain the gap.

<details>
<summary>Answers</summary>

1. `W = L/λ = 32/40 = 0.8 weeks ≈ 4 working days`. With `L = 12`: `W = 12/40 = 0.3 weeks ≈ 1.5 days`. It dropped because cycle time is WIP over throughput — shrinking the queue (`L`) means each PR *waits* less, even though service (review) speed is unchanged. Lowering WIP is one of only two ways to move `W` (the other is raising service throughput).
2. **Decomposition reason:** TTFR (the open→first-review wait) is the largest single segment of cycle time — review latency is mostly idle queue time, not eyes-on-code work. **Feedback-loop reason:** TTFR is the *trigger* of the doom-loop — slow pickup is what makes authors batch into bigger PRs, so collapsing TTFR prevents the whole spiral from starting. It's both the biggest segment and the lever on everything downstream.
3. slow review (high TTFR) → author batches more work while waiting → bigger PRs → longer/avoided reviews → PRs sit → more conflicts/rework → even slower → (back to slow review). It's *reinforcing* because each loop makes the next worse (gain > 1), so a small slowdown amplifies. The lever is **TTFR** — fast pickup removes the incentive to batch, keeps branches young (few conflicts), and keeps context warm (cheap rework). Attacking symptoms fails because the loop regrows them: tell people to write smaller PRs while review stays slow, and slow pickup will push them right back to batching.
4. **Goodhart:** when a measure becomes a target, it ceases to be a good measure. (a) **TTFR** targeted → drive-by LGTM to stop the clock → review *quality* lost. (b) **Comment count** targeted → manufactured nitpicks / adversarial reviews → signal-to-noise and collaboration lost. (c) **PRs-reviewed-per-person** targeted → PR-splitting and rubber-stamping to inflate counts → thoroughness lost; review becomes a numbers game. In every case the cheap gaming path moves the number without serving the goal of good code shipped safely.
5. A **counter-metric** is a paired quality signal chosen so it *degrades* when you cheat the primary metric, making the trade-off visible. (a) TTFR ↓ paired with **escaped-defect / change-failure rate** — a drive-by LGTM lowers TTFR but raises defects, exposing the cheat. (b) PRs-merged ↑ paired with **post-merge incident / reopen rate** — rubber-stamping raises throughput but raises incidents/reopens. Each pair means you can't win the speed number by sacrificing quality without it showing up in the guardrail.
6. **Per-PR:** within one review in a fixed system, going faster means less thoroughness — a real local trade-off. **System-level:** changing the system shifts the entire frontier so you get more speed *and* more quality at once. Three frontier-shifters: small PRs (faster *and* easier to review thoroughly), fast pickup/low TTFR (less wait, same review work), and good tooling/test coverage (mechanical checks automated, so human attention goes to design/correctness). Parallels DORA's "speed and stability aren't a trade-off" finding.
7. Likely culprits: (a) **clock starts at "opened" not "ready,"** so draft/author time is counted as reviewer wait (or the reverse — counting a bot/CI action as "first review" makes TTFR look artificially good). (b) **Re-requests ignored** — you measure only the first pickup, but the slow waits are the *second/third* re-reviews after changes. (c) **Selection/survivorship bias** — trivial PRs (typos, dep bumps) dilute the medians, and abandoned-because-painful PRs are excluded if you compute over merged PRs only, so the dashboard flatters the survivors while the substantive PRs lag.

</details>

---

## Cheat Sheet

```
QUEUEING MODEL (the law of the pipeline)
  L = λ × W        WIP = arrival-rate × cycle-time
  W = L / λ        cycle time = WIP / throughput   ← lower WIP OR raise throughput
  utilization ρ→1  ⇒ wait ∝ 1/(1−ρ) blows up        ← maxed reviewers = spiky TTFR
  "review faster"  moves nothing; cap WIP + shrink PRs are the real inputs

TTFR DOMINATES
  cycle = T_wait(TTFR) + T_iterate + T_approve + T_merge
  TTFR ≈ majority of cycle; the WAIT, not the work, is the latency
  report p50 AND p90 — heavy-tailed; the p90 is the pain, never use the mean

DOOM-LOOP (reinforcing, gain > 1)
  slow review → batch → bigger PR → slower/avoided → conflicts/rework → slower…
  break it at the DRIVER: TTFR. fast pickup ⇒ no batching ⇒ small PRs ⇒ fast review

COST OF DELAY / WIP (Reinertsen)
  blocked PR ≠ free: context-switch + conflict-rework + blockage + morale cost
  small batches + WIP limits cut queue cost AND variability

GOODHART (every metric is a proxy; the cheat is always cheaper)
  TTFR target          → drive-by LGTM
  comment-count target → nitpicking / adversarial
  approval/PRs-per-person KPI → rubber-stamp, PR-splitting, numbers game
  surrogation: team optimizes the metric and forgets "good code shipped safely"

COUNTER-METRICS (never ship a speed metric naked)
  TTFR ↓        ⇄ escaped-defect / change-failure rate
  cycle time ↓  ⇄ reopen / rework / revert rate
  PRs merged ↑  ⇄ post-merge incident rate
  SPACE: mix Flow(E) + Quality(P) + Satisfaction(S); never one number

MEASURE THE SYSTEM, NOT THE PERSON
  team/system level, aggregate + trend, for bottleneck-finding — NEVER stack-rank
  individual review metrics = canonical Goodhart trap + kills psychological safety

INSTRUMENTATION (from VCS/PR API events)
  clock START = ready_for_review (pause on draft);  STOP = merged
  "first review" = first SUBSTANTIVE human action (not bot/CI/auto-assign)
  measure EACH re-request→response gap (not just the first wait)
  watch survivorship (abandoned PRs) + selection (trivial-PR dilution) bias
```

---

## Summary

- The PR pipeline is a **queueing system** governed by **Little's Law** (`L = λW`, so `W = L/λ`): cycle time is WIP over throughput. You change cycle time by lowering WIP or raising service throughput — *not* by telling people to review faster.
- Review latency is overwhelmingly **queue time, not work time**: **TTFR** is both the largest cycle-time segment and the trigger of the doom-loop, which makes it the master tempo metric. Report it as **p50 and p90** — the distribution is heavy-tailed and the p90 is the pain.
- The **doom-loop** (slow review → batching → bigger PRs → slower review → conflicts/rework) is a *reinforcing feedback system*; you break it by attacking the driver (TTFR), not the symptoms, because fast pickup removes the incentive to batch.
- A blocked PR carries real **cost of delay** — context-switch, conflict-rework, blockage, and morale costs (Reinertsen). Little's Law and CoD economics converge on the same prescription: **small batches, limited WIP**.
- Speed and quality trade off **per-PR but not system-wide**: small PRs + fast pickup + good tooling push the whole **frontier** outward (the DORA "no trade-off" parallel). Optimizing one metric in isolation is the failure mode.
- Every metric is a **proxy**, and under **Goodhart/Campbell** the cheap gaming path (LGTM, nitpicks, rubber-stamping, PR-splitting) is always cheaper than the goal; **surrogation** is the team forgetting the goal entirely. Defend with **counter-metrics** — pair every speed metric with the quality signal its cheat would spend — and a **balanced SPACE set**.
- Measure at the **team/system level for improvement, never the individual for ranking** (the canonical Goodhart trap that destroys psychological safety). Get **instrumentation** right: clock starts at *ready*, counts only substantive human review, measures *each* re-request, stops at *merge*; and check for survivorship and selection bias.

You now reason about review tempo as a managed queueing system with corruptible instruments — able to find the real bottleneck with math and measure it without destroying the behavior you care about. The next layer — [professional.md](professional.md) — is about operating these metrics across an organization: rolling them out, defending them politically, and keeping them honest under leadership pressure.

---

## Further Reading

- *The Principles of Product Development Flow* — Donald G. Reinertsen. The definitive treatment of queueing economics, cost of delay, batch size, and WIP for knowledge work — the theoretical spine of this entire topic.
- *Accelerate: The Science of Lean Software and DevOps* — Forsgren, Humble, Kim, and the annual **DORA** reports. The four keys, lead time, change-failure rate, and the empirical "speed and stability are not a trade-off" finding.
- *The SPACE of Developer Productivity* — Forsgren, Storey, Noda, Butler, Houck (ACM Queue, 2021). Why productivity is multidimensional and must never be reduced to one number; the source of the balanced-set discipline.
- Goodhart's law (Charles Goodhart) and **Campbell's law** (Donald T. Campbell) — the foundational statements on proxy corruption; pair with Marilyn Strathern's compact phrasing, "when a measure becomes a target, it ceases to be a good measure."
- *The Art of Computer Systems Performance Analysis* — Raj Jain, and any solid queueing-theory primer — for Little's Law, utilization/wait curves, and percentile reasoning beyond the back-of-envelope here.
- [professional.md](professional.md) — operating these metrics in an organization: rollout, governance, and resisting the pressure to weaponize them.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md) — PR size is the upstream driver of every tempo metric; the two topics are inseparable.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/senior.md) — why individual metrics destroy the psychological safety that makes review function.
- [08 — Review Anti-patterns](../08-review-anti-patterns/senior.md) — drive-by LGTM, nitpicking, rubber-stamping: the Goodhart failures as concrete anti-patterns.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the four keys, lead time, change-failure rate, and the full Goodhart/proxy-corruption treatment.
- [Quality Gates](../../quality-gates/) — the automation that shifts mechanical checks off humans and pushes the speed/quality frontier outward.
