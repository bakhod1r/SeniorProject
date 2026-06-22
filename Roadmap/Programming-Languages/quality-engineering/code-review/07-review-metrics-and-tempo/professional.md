# Review Metrics & Tempo — Professional Level

> **Roadmap:** [Code Review](../README.md) → Review Metrics & Tempo
> *The senior page taught you which numbers mean what. This page is about running them across an org without the numbers running the org — where "let's add a review dashboard" stops being a tooling task and becomes a negotiation about whether you'll hand leadership the one metric that quietly turns your reviewers adversarial.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Central Tension: Flow Insight Without Individual Surveillance](#core-concept-1--the-central-tension-flow-insight-without-individual-surveillance)
5. [Core Concept 2 — What to Measure at the System and Team Level](#core-concept-2--what-to-measure-at-the-system-and-team-level)
6. [Core Concept 3 — Every Speed Metric Needs a Quality Counter-Metric](#core-concept-3--every-speed-metric-needs-a-quality-counter-metric)
7. [Core Concept 4 — What Not to Measure, and the Conversation With Leadership](#core-concept-4--what-not-to-measure-and-the-conversation-with-leadership)
8. [Core Concept 5 — Improving Tempo at Scale](#core-concept-5--improving-tempo-at-scale)
9. [Core Concept 6 — Using the Data: Diagnose, Don't Manage People](#core-concept-6--using-the-data-diagnose-dont-manage-people)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Instrumenting and improving review tempo across an org while refusing the metrics that corrupt the behavior you're trying to improve.**

The senior page framed metrics as feedback: time-to-first-review, cycle time, PR size, rework. At the professional level those same numbers arrive in a different room. A VP asks for "a code-review productivity dashboard, ideally per-engineer." A director wants to know "who our slowest reviewers are." A well-meaning EM proposes ranking the team by PRs reviewed because "what gets measured gets managed." Every one of these requests is reasonable on its face and toxic in practice — and your job is to deliver the flow insight they actually need while declining the instrument that would poison it.

This is not a measurement problem; the measurement is easy. It's a judgment-and-politics problem. The dominant professional risk is not "we lack data" — it's **Goodhart's Law**: the moment a review metric becomes an individual target, people optimize the number and abandon the goal. Mandate comments-per-review and you get nitpicking. Reward approvals-per-day and you get rubber stamps and a spike in escaped defects. The staff engineer's value here is knowing exactly which metrics are safe to surface, which are radioactive, and how to have the conversation that keeps the radioactive ones off the dashboard. This page is that judgment, battle-tested.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the definitions of TTFR, cycle time, PR size, rework/reopen rate, and how to read each one.
- **Required:** You've owned, or been measured by, an engineering metric — and seen what people did to it.
- **Helpful:** You've been asked by leadership for "individual productivity numbers" and had to respond.
- **Helpful:** You've sat in a retro where a metric was used as evidence (well or badly).

---

## Glossary

- **TTFR (Time-to-First-Review):** wall-clock time from "PR ready for review" to the first substantive reviewer action. The single highest-leverage tempo metric, because it's where idle time hides.
- **Cycle time:** total time from PR opened (or first commit) to merged. Decomposes into *pickup* (open → first review), *review* (first review → approval), and *merge* (approval → merged).
- **Goodhart's Law:** "When a measure becomes a target, it ceases to be a good measure." The governing failure mode of all review metrics.
- **Counter-metric (guardrail metric):** a quality measure paired with a speed measure so that gaming the speed number shows up as damage somewhere visible. E.g., change-fail rate paired with cycle time.
- **Change-fail rate (CFR):** the DORA metric — fraction of deployments causing a degraded service / requiring remediation. The standard quality counter-metric for review speed.
- **Reviewer-load concentration:** how unevenly review work is distributed; the inverse of bus-factor. "Two people do 70% of reviews" is a concentration (and resilience) problem.
- **SPACE:** a framework (Satisfaction, Performance, Activity, Communication, Efficiency) arguing productivity is multi-dimensional and must not be reduced to one number or measured per-individual.
- **DevEx / DX survey:** periodic perceptual data ("is review painful? how long does it block you?") that complements system-extracted numbers with how it *feels* to the people in the loop.
- **Flow metric:** a team/system-level throughput-or-latency measure (cycle time, WIP, TTFR) — about the *system's* movement, not an individual's output.

---

## Core Concept 1 — The Central Tension: Flow Insight Without Individual Surveillance

There is one structural conflict at the center of this entire topic, and naming it is the job:

> **Leadership wants a dashboard that compares people. The system genuinely needs flow insight. The same raw events feed both — and the staff engineer must deliver the second while refusing the first.**

Both desires are legitimate. Leadership isn't malicious; they're accountable for delivery speed and they reach for the tool they know — individual measurement — because it's how most of the rest of a business is run. The flow need is also real: review *is* often the slowest, most variable segment of the path to production, and you can't improve what you can't see. The error is collapsing the two into "measure each engineer's review output," which satisfies neither: it doesn't speed the system up (the bottleneck is usually structural, not a slow individual), and it actively degrades the behavior (Goodhart).

The resolution is a hard line drawn at the **unit of measurement**:

- **Measure the system and the team.** TTFR for the team, cycle-time decomposition for a service, load concentration across the group. These describe *the flow*, and improving them is a process change, not a performance conversation.
- **Never attribute review metrics to individuals as a score.** Not because individuals don't vary, but because the instant the number is *about a person and visible*, it becomes a target they optimize — at the cost of the goal.

This isn't squeamishness; it's the documented finding of the **SPACE framework** ("don't measure individuals; don't rely on a single metric") and the long-running argument Martin Fowler makes in *CannotMeasureProductivity*: you can measure *activity* trivially and *value* almost never, so activity-as-productivity is a category error that gets weaponized. The staff engineer's deliverable is a flow dashboard plus the organizational agreement that it is *never* an input to performance reviews. That agreement is harder to win than the dashboard is to build — and it's the actual work.

> **The professional reality:** the dashboard is a day of work; the policy that it won't be used to rank humans is a quarter of relationship capital. Spend it. A flow dashboard with no guardrail on its use is a loaded weapon you handed to whoever owns the next reorg.

---

## Core Concept 2 — What to Measure at the System and Team Level

These are the metrics that are *safe and useful* at the team/system level. Each answers a flow question and resists gaming because no individual can move it alone.

**1. TTFR — p50 and p90.** Report the distribution, not the mean. The mean hides the tail; the tail is the pain. A team with p50 of 2 hours and p90 of 3 *days* doesn't have a fast-review culture — it has a fast common case and a brutal tail where PRs rot. The p90 is where bus-factor and load concentration show up.

**2. Cycle-time decomposition.** A single "cycle time = 26 hours" number is useless for action. Split it:

```
Cycle time = pickup (open → first review)
           + review (first review → approval)
           + merge  (approval → merged / deployed)
```

You almost always find one segment dominates. If *pickup* is 80% of it, you have a TTFR/assignment problem (tooling, load-balancing). If *review* dominates, PRs are too big or feedback rounds too many (link the size driver, [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md)). If *merge* dominates, your gates/CI are slow ([Quality Gates](../../quality-gates/)). The decomposition *is* the diagnosis.

**3. PR size distribution.** Track the distribution (e.g., lines changed, files touched) p50/p90 — because PR size is the *upstream cause* of most slow reviews. Large PRs get worse, slower, more superficial reviews. This is the highest-leverage lever you have and it's a property of the *system's habits*, not a reviewer's diligence.

**4. Reviewer-load concentration / bus-factor.** What fraction of reviews are done by the top 1–2 people? A Gini-style concentration or a simple "top-2 share" surfaces the resilience risk: when those two are on vacation, TTFR p90 explodes. This is a *team-health* metric, never a "look how much Priya carries" leaderboard.

**5. Rework / reopen rate.** How often does an approved-and-merged change get reverted or immediately re-touched? Rising rework can mean reviews are getting shallow (often a *symptom* of pushing speed too hard — see the next concept).

> **Report distributions and trends, not point values.** A snapshot number invites comparison and target-setting; a 12-week trend invites the right question — "what changed?" Whenever you can choose, ship the trend line, not the gauge.

---

## Core Concept 3 — Every Speed Metric Needs a Quality Counter-Metric

Here is the rule that keeps a tempo program honest:

> **You may never display a speed metric without a quality counter-metric next to it. Speed unpaired is an invitation to buy velocity with defects.**

If the dashboard shows "cycle time down 40%!" and nothing else, you've created a one-dimensional incentive, and the cheapest way to hit it is to review less carefully — approve faster, look harder for nothing. The counter-metric makes that trade *visible*: if speed went up because quality went down, the paired number moves and the win is exposed as a loan against production.

The canonical pairings (the speed/quality balance is exactly DORA's design — throughput metrics always reported alongside stability metrics):

| Speed metric | Required counter-metric | What the pair protects against |
|---|---|---|
| Cycle time ↓ | Change-fail rate / escaped defects | Faster merges achieved by shallower review |
| TTFR ↓ | Rework / reopen rate | "Fast first response" that's a drive-by approval |
| PRs merged per week ↑ | Revert rate, post-merge bug rate | Throughput bought by lowering the bar |
| Approval latency ↓ | Defect-escape rate, incident rate | Rubber-stamping to clear the queue |

The counter-metric doesn't have to be perfect — escaped-defect counting is noisy, CFR has lag — but it has to be *present and watched*, because its job is not precision, it's *deterrence*. A team that knows escaped defects are tracked alongside cycle time will not solve a speed target by gutting review quality, because the damage has somewhere to surface.

> **The staff move:** when leadership asks to "speed up reviews," your first response is "absolutely — and we'll watch change-fail rate alongside it, so we know we're getting *faster*, not just *looser*." This both delivers what they want and quietly installs the guardrail that keeps it from backfiring. Speed and quality are not opposites; *unmeasured* speed and quality are.

---

## Core Concept 4 — What Not to Measure, and the Conversation With Leadership

These are the metrics that *feel* productive and reliably corrupt behavior the moment they're attached to individuals. Know them cold, because you will be asked for every one.

| Tempting individual metric | What you actually get (the Goodhart failure) |
|---|---|
| **PRs reviewed per person** | Reviewers cherry-pick tiny PRs, skim large ones, race for count. Hard PRs get avoided. |
| **Comments per review** | Adversarial nitpicking — comments manufactured to hit a number; signal drowns in noise; authors demoralized. |
| **Approval speed (per reviewer)** | Rubber stamps. "LGTM" in 90 seconds. Defects escape. The fastest approver looks "best." |
| **Lines of code reviewed** | Reviewers claim credit for skimming huge PRs; incentive runs *opposite* to the small-PR goal you want. |
| **Approvals given per person** | Same as approval speed — quantity over scrutiny; the careful reviewer who blocks a bad change scores worse than the one who waves it through. |

The pattern is identical every time: the metric measures *activity* that correlates loosely with the *goal*, so optimizing the activity decouples from — and eventually opposes — the goal. This is precisely Fowler's *CannotMeasureProductivity* point and SPACE's "don't measure individuals" rule, stated operationally.

**The conversation to have when leadership asks for these** matters as much as the refusal. Don't say "no, that's bad." Redirect to the legitimate need underneath and offer the safe instrument:

- **Name the real question.** "You want to know if review is slowing us down and where. That's a great question." (Almost always the real driver is *flow*, dressed up as *people*.)
- **Predict the failure concretely.** "If we rank people by comments-per-review, within two weeks we'll have manufactured nitpicking and authors who dread reviews — I've watched it happen. We'll move the number and lose the thing." Specificity beats principle.
- **Offer the equivalent safe metric.** "Here's the team's TTFR p90 trend and cycle-time decomposition — that tells us *exactly* where the slowness is, and we can fix it without a leaderboard."
- **Cite the external authority.** "This is the explicit guidance in the SPACE framework and Google's own DevEx research — measure the system, not the individual, and never on one metric." Borrowed authority de-personalizes your refusal.
- **Offer the perceptual complement.** "If you want to know whether review is *painful*, a DevEx survey question gets you that directly — and honestly — in a way a productivity number never will."

> **The hardest version:** sometimes leadership insists. Then the staff engineer's job is to make the cost explicit and on the record — "we can build it; here is the behavior change I expect and the counter-metric that will show the damage" — and to instrument the counter-metric hard, so when escaped defects rise, the data ends the experiment for you. You don't always win the argument up front; you make sure the data wins it for you within a quarter.

---

## Core Concept 5 — Improving Tempo at Scale

Once you can see the flow, you change it. The levers, roughly in order of leverage:

**1. Attack PR size — the upstream driver.** The single most effective tempo intervention is usually *not* about review at all; it's making PRs smaller, because small PRs get faster, better, more-frequent reviews. A norm of "PRs under ~400 lines / one logical change" compounds across every other metric. This is why [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) is the highest-ROI link on this page — fixing the input fixes the queue.

**2. Make review responsiveness a team norm — carefully.** A TTFR expectation ("first review within one business day, or say why") sets a shared cadence. The trade-offs are real and must be managed:
- A hard SLA can produce *fast-but-shallow* reviews to beat the clock — which is exactly why it must be paired with a quality counter-metric and framed as a *team* norm, not an *individual* SLA.
- It collides with **maker-time**: every review request is a potential interrupt to someone in deep work. The norm should encourage *batching* review into a couple of protected windows a day, not "drop everything," so you trade a slightly slower TTFR for preserved focus. The right SLA respects the maker's schedule.

**3. Load-balance and rotate reviewers — the bus-factor fix.** When two people carry most reviews, both tempo (their queue is the bottleneck) and resilience (vacations spike p90) suffer. Fixes: round-robin or load-aware auto-assignment, a reviewer rotation, and deliberately routing some reviews to *grow* secondary reviewers' context. This widens the bus-factor and flattens the load-concentration metric at the same time. Tooling does the assignment ([06 — Tooling & Automation](../06-review-tooling-and-automation/professional.md)).

**4. Tooling: auto-assignment, reminders, nudges.** Auto-assign reviewers (CODEOWNERS + load-aware routing) so no PR waits to be *noticed*; SLA reminders ("this PR has waited 18h") so nothing rots silently; surface the queue where people already are (chat). Tooling removes the *idle* time that dominates cycle time without asking anyone to work faster.

**5. Async / timezone tempo.** Distributed teams pay a TTFR tax in handoffs across timezones. Levers: overlap-window expectations, designating a "review buddy" timezone for fast PRs, and explicitly accepting that a global team optimizes for *handoff quality* (rich PR descriptions, self-review notes) over raw TTFR. Don't measure a follow-the-sun team against a colocated team's p90 — the floor is different.

> **The leverage order is the point.** Teams reach for SLAs and reminders first because they're visible. But if PRs are 1,500 lines, no reminder saves you — the reviewer rationally procrastinates. **Fix size and load concentration first; SLA and tooling second.** The biggest cycle-time wins come from attacking the *input* (size) and the *distribution* (load), not from leaning on the reviewers to hurry.

---

## Core Concept 6 — Using the Data: Diagnose, Don't Manage People

The metrics exist to find and fix *system* bottlenecks. Three legitimate uses, one forbidden one.

**Use 1 — Bottleneck-finding.** Read the decomposition and the distributions to localize the problem:
- *Which cycle-time segment dominates?* Pickup → assignment/TTFR problem. Review → size/rounds problem. Merge → gates/CI problem.
- *Which team has a TTFR tail?* p90 by team surfaces the one squad where PRs rot — usually a load-concentration or staffing issue specific to them, not a company-wide one.
- *Where's the concentration?* If one team's reviews are 80% one person, that's the resilience fix to make *before* they burn out or take leave.

**Use 2 — Retro input.** Bring the team's *own* trend to its *own* retro: "our TTFR p90 crept from 1 day to 3 over the quarter — what changed?" The team interprets and owns the fix. This is the metric working as designed — a mirror the team holds up to itself, not a verdict handed down.

**Use 3 — Perceptual data (DevEx/DX survey).** System data tells you review is *slow*; it can't tell you it's *painful, confusing, or demoralizing*. A short periodic survey ("How long does waiting for review typically block you? Is review feedback usually helpful?") captures the human signal that numbers miss — and sometimes *contradicts* them (fast TTFR but reviews feel hostile is a [feedback-culture](../05-feedback-giving-and-receiving/professional.md) problem no latency metric reveals). The mature program runs *both* and triangulates.

**The forbidden use — performance management.** Never feed review metrics into a performance review, a stack-rank, or a PIP. The moment an individual's TTFR or PR count is "on their record," every metric on the dashboard becomes a target and the whole instrument decoheres into theater. This is the one hard prohibition; everything else is judgment.

> **System data and perceptual data are complements, not substitutes.** The numbers tell you *what and where*; the survey tells you *how it feels and why*. A team can have great cycle-time numbers and a miserable review culture — and only the survey will tell you, before attrition does.

---

## War Stories

**The "comments per review" mandate.** A director, wanting "more rigorous reviews," set a team OKR around average comments per review. Within three weeks comment volume tripled — and almost all of it was nitpicking: style opinions, "consider renaming this," reflexive questions manufactured to hit the number. Authors started dreading reviews; one senior engineer began pre-emptively padding PRs with TODOs to give reviewers easy comments to make. Real defects didn't get caught any better; signal drowned in noise. The metric was killed after a retro where the team showed, with examples, that the *content* of the new comments was empty. The lesson stuck: **measuring comment quantity manufactures comment quantity, and nothing else.**

**The p90 of three days that was two people.** A platform org's review TTFR looked fine at p50 (4 hours) but p90 was 3 days, and PRs to one subsystem regularly stalled. Decomposition showed the slowness was *all* pickup, and concentration analysis showed 70% of that subsystem's reviews went to two engineers — who were also its on-call and its meeting-heaviest. The fix wasn't to tell them to review faster; it was a reviewer rotation that deliberately grew three more people into that subsystem's context over a quarter. p90 dropped to under a day, the bus-factor went from 2 to 5, and the two original reviewers got their focus time back. **The tempo problem was a load-concentration problem wearing a latency costume.**

**The "reviews approved" KPI and the escaped-defect spike.** An eng leader, under delivery pressure, started tracking approvals-given-per-reviewer-per-week and praising the top of the list in all-hands. Approval counts rose nicely. So did the escaped-defect rate and the revert rate — because the fastest path to "more approvals" is to read less and stamp more. The team had *no counter-metric*, so the damage was invisible for two months until a string of production bugs traced back to rubber-stamped PRs. The KPI was retired and replaced with team cycle time *paired with change-fail rate*. **Approvals were a speed metric with no quality counterweight — exactly the unbalanced incentive Concept 3 warns about.**

**Cutting cycle time 60% by attacking size and TTFR together.** A product team with a 4-day median cycle time ran the decomposition: roughly half was pickup, half was review, and PR size p90 was ~1,200 lines. They did two things at once — a "small PR" norm (split work, stack PRs) and load-aware auto-assignment with an 18-hour reminder bot. PR size p90 fell to ~350 lines, pickup collapsed (auto-assignment killed the "waiting to be noticed" time), and review time fell too because smaller PRs review faster. Median cycle time went from 4 days to ~1.5. Crucially they watched change-fail rate the whole time — it held flat, proving the speed was real. **The win came from the upstream driver (size) plus the idle-time killer (assignment), not from anyone reviewing faster.**

**The productivity dashboard that tanked morale.** Leadership rolled out a per-engineer dashboard: PRs authored, PRs reviewed, comments made, average approval time — visible to all managers. Within a month, behavior visibly distorted: people split work to inflate PR count, avoided reviewing hard PRs that would hurt their approval-time average, and trust between teammates dropped because everyone knew they were being ranked. An engagement-survey dip and two regretted departures got leadership's attention. The dashboard was replaced with a *team-level* flow view (cycle time, TTFR p90, no individual breakdown) plus a quarterly DevEx survey question on review pain. Morale recovered; the *flow* problems it had been meant to solve were actually addressed for the first time, because now people cooperated instead of gaming. **Individual review metrics didn't just fail to help — they actively destroyed the cooperation that makes review work.**

---

## Decision Frameworks

**Measure (system) vs never-measure (individual). Memorize this table:**

| Safe — measure at system/team level | Radioactive — never as an individual score |
|---|---|
| TTFR p50/p90 (team) | PRs reviewed per person |
| Cycle-time decomposition (service) | Comments per review |
| PR size distribution (team) | Approval speed per reviewer |
| Reviewer-load concentration / bus-factor | Lines of code reviewed |
| Rework / reopen rate (team) | Approvals given per person |
| Change-fail rate, escaped defects (team) | Any of the above attributed to a name |

**Speed metric → required counter-metric pairing. Never ship the left without the right:**

| Speed metric (what you want to improve) | Counter-metric (what keeps it honest) |
|---|---|
| Cycle time ↓ | Change-fail rate |
| TTFR ↓ | Rework / reopen rate |
| Throughput (PRs merged) ↑ | Revert rate / post-merge bug rate |
| Approval latency ↓ | Escaped-defect / incident rate |

**Diagnosing a slow-review org — which segment, which cause:**

| Dominant cycle-time segment | Likely cause | First lever |
|---|---|---|
| **Pickup** (open → first review) | No assignment, load concentration, queue invisible | Auto-assignment + reminders ([06](../06-review-tooling-and-automation/professional.md)); rotation |
| **Review** (first review → approval) | PRs too big, too many feedback rounds | Small-PR norm ([02](../02-pr-scope-and-size/professional.md)); review-depth alignment |
| **Merge** (approval → merged) | Slow/flaky CI, heavy gates | Fix the gate pipeline ([Quality Gates](../../quality-gates/)) |
| Fine p50, brutal p90 | Bus-factor / specific team or subsystem | Concentration analysis → rotation |

**Responding to "give me individual review numbers":**

| They ask for… | You deliver instead | The line |
|---|---|---|
| "Who reviews the most?" | Team load *concentration* | "Here's whether load is healthy — ranking people just hides hard PRs." |
| "Who's slowest to review?" | Team TTFR p90 + decomposition | "Slowness is structural; here's *where* it is, and it's not a person." |
| "Comments per reviewer" | DevEx survey on review helpfulness | "Quantity manufactures nitpicking; this tells us if reviews actually help." |
| "A per-engineer dashboard" | Team flow dashboard + survey | "Per-engineer numbers Goodhart instantly — SPACE/DevEx research is explicit on this." |

**Tempo levers by bottleneck (in leverage order):**

| Bottleneck | Lever | Trade-off to manage |
|---|---|---|
| Big PRs | Small-PR norm, stacked PRs | Author overhead; needs tooling/habit |
| Idle pickup time | Auto-assignment + reminders | Don't let reminders become nagging |
| Load concentration | Rotation, load-aware routing | Short-term context-growth cost |
| Slow first response | Team TTFR norm (not individual SLA) | Maker-time interrupts; pair with quality counter-metric |
| Timezone handoffs | Overlap windows, richer PR descriptions | Accept higher TTFR floor than colocated teams |

---

## Mental Models

- **The unit of measurement decides everything.** The *same* event stream is healthy at the team level and toxic at the individual level. Where you draw the boundary — system vs person — is the entire ethical and practical question.

- **A speed metric without a counter-metric is an instruction to cut corners.** People optimize what you show them. Show only speed, and the cheapest path is less rigor. The guardrail metric makes "faster by being looser" visible, so it stops being free.

- **Goodhart is not a risk to mitigate; it's a law to design around.** Assume every individual metric *will* be gamed the instant it's a target — because it will. Choose metrics that *can't* be moved by one person gaming alone.

- **Most tempo problems are upstream of the reviewer.** Slow reviews are usually caused by big PRs and lopsided load, not lazy reviewers. Pushing people to hurry treats the symptom; fixing size and distribution treats the cause.

- **System data is *what and where*; perceptual data is *how it feels*.** A team can have great numbers and a miserable review culture. Run the survey, or you'll learn the truth from the exit interview.

- **The dashboard is easy; the agreement about how it's used is the real artifact.** A flow dashboard with no policy against ranking humans is a weapon waiting for the wrong hand. Ship the policy with the dashboard.

---

## Common Mistakes

1. **Handing leadership individual review numbers because they asked nicely.** The request is reasonable; the instrument is toxic. Redirect to the real (flow) question and offer the team-level metric. The dashboard you decline to build is sometimes your highest-value deliverable.

2. **Shipping a speed metric with no quality counter-metric.** Cycle-time-down with nothing beside it is an order to review less carefully. Always pair speed with change-fail rate / escaped defects so bought velocity is visible.

3. **Reporting means and point values instead of distributions and trends.** The mean hides the tail where the pain lives; a snapshot invites target-setting. Ship p50/p90 and a trend line, not a gauge.

4. **Optimizing review tempo without touching PR size.** The reviewer rationally procrastinates on a 1,500-line PR no reminder will rescue. Fix the upstream driver — small PRs — before leaning on SLAs and nudges.

5. **Setting a hard individual TTFR SLA.** It produces fast-but-shallow reviews to beat the clock and shreds maker-time. Make responsiveness a *team* norm, batch-friendly, paired with a quality counter-metric.

6. **Ignoring load concentration until someone takes leave.** A p90 that's "two people" is a resilience bomb. Rotate and grow secondary reviewers *before* the bus-factor failure, not during it.

7. **Treating system metrics as a substitute for asking people.** Numbers can't tell you review is *demoralizing*. Run a DevEx survey; triangulate. Fast-and-hostile is a real, common, metrics-invisible state.

8. **Using review metrics in performance reviews "just a little."** There is no "a little." The moment a metric touches someone's record, the whole dashboard becomes a target and decoheres into theater.

---

## Test Yourself

1. A VP asks you to build a per-engineer code-review dashboard showing PRs reviewed, comments made, and average approval time. Walk through your response — what you decline, what you offer instead, and why.
2. Leadership wants to "speed up reviews" and proposes tracking cycle time as the team's goal. What's the one addition you insist on, and what does it protect against?
3. A team's TTFR is p50 = 3h, p90 = 3 days. Which single number do you act on, and what are the two most likely structural causes?
4. Name three individual review metrics that reliably Goodhart, and state the specific bad behavior each one produces.
5. You decompose a team's 4-day cycle time and find pickup is 80% of it. What's the diagnosis, and which two levers do you pull first?
6. System data says a team's review tempo is excellent, but attrition is rising on that team. What instrument is missing, and what might it reveal?
7. Why is attacking PR size often a more effective tempo intervention than adding review SLAs and reminder bots?

<details>
<summary>Answers</summary>

1. **Decline** the per-engineer view: PRs-reviewed, comments-made, and approval-time all Goodhart instantly (cherry-picking tiny PRs, manufactured nitpicking, rubber-stamping). **Name the real question** ("you want to know if review slows us down and where — that's flow, not people"). **Offer instead** a team-level dashboard: TTFR p90, cycle-time decomposition, load concentration, paired with change-fail rate; plus a DevEx survey question on review pain. **Cite** SPACE / DevEx research: measure the system, not the individual, never on one metric. If they insist, make the predicted behavior change and the counter-metric explicit and on the record.
2. Insist on a **quality counter-metric** (change-fail rate or escaped-defect rate) reported alongside cycle time. It protects against buying speed with quality — "faster by reviewing less carefully" — by making that trade visible: if speed rose because rigor fell, the paired number moves.
3. Act on **p90** (the mean/p50 hides the painful tail). The two most likely causes: **load concentration / bus-factor** (a couple of reviewers' queue is the bottleneck) and a **specific team or subsystem** whose PRs rot — both surfaced by concentration analysis and per-team p90, fixed by rotation, not by telling people to hurry.
4. Any three: **PRs reviewed per person** → cherry-picking small PRs, avoiding hard ones; **comments per review** → adversarial/manufactured nitpicking; **approval speed / approvals per person** → rubber-stamping and escaped defects; **lines reviewed** → claiming credit for skimming huge PRs (incentive opposite to small-PR goal).
5. Diagnosis: a **pickup / assignment** problem — PRs wait to be *noticed*, not to be reviewed. First two levers: **auto-assignment** (load-aware + CODEOWNERS) so nothing waits unassigned, and a **reminder/SLA bot** for PRs idle past a threshold — plus check **load concentration**, since concentrated load also inflates pickup.
6. The missing instrument is **perceptual data — a DevEx/DX survey.** Great numbers with rising attrition is the signature of a *fast but hostile/painful* review culture: reviews land quickly but feel adversarial or demoralizing — a feedback-culture problem no latency metric reveals. The survey ("is review feedback usually helpful?") surfaces it before more people leave.
7. Because PR size is the **upstream driver** of slow reviews: large PRs get slower, shallower, more-procrastinated reviews, and no reminder fixes a reviewer's rational reluctance to take on 1,500 lines. Shrinking PRs improves pickup, review time, *and* review quality simultaneously — whereas SLAs/reminders only attack idle time and can backfire into shallow reviews. Fix the input before pressuring the throughput.

</details>

---

## Cheat Sheet

```
THE CENTRAL TENSION
  leadership wants per-person numbers  ·  system needs flow insight
  → deliver TEAM/SYSTEM metrics, REFUSE individual scores
  unit of measurement decides everything

MEASURE (system/team — safe)
  TTFR p50/p90 (distribution, not mean)
  cycle-time decomposition: pickup + review + merge
  PR size distribution        (the upstream driver)
  reviewer-load concentration / bus-factor
  rework / reopen rate
  ALWAYS + a quality counter-metric

NEVER MEASURE (individual — Goodharts)
  PRs reviewed / person     → cherry-pick small, dodge hard
  comments per review        → manufactured nitpicking
  approval speed / approvals → rubber stamps, escaped defects
  lines reviewed             → credit for skimming

SPEED → REQUIRED COUNTER-METRIC
  cycle time ↓   →  change-fail rate
  TTFR ↓         →  rework / reopen
  throughput ↑   →  revert / post-merge bugs
  approval ↓     →  escaped-defect / incident

DIAGNOSE (which segment dominates?)
  pickup → assignment/load   → auto-assign + reminders + rotation
  review → big PRs / rounds   → small-PR norm (link 02)
  merge  → slow gates/CI      → fix gates (quality-gates)
  fine p50 / bad p90 → bus-factor → rotation

TEMPO LEVERS (leverage order)
  1. shrink PR size (upstream driver)   2. load-balance / rotate
  3. auto-assign + reminders            4. team TTFR norm (not indiv SLA)
  5. timezone: overlap + rich PR descs

USE THE DATA FOR
  bottleneck-finding · retro input · DevEx survey (how it FEELS)
  NEVER for performance management

"GIVE ME INDIVIDUAL NUMBERS"
  name real question → predict the gaming → offer team metric
  → cite SPACE/DevEx → offer survey for "is it painful?"
```

---

## Summary

- **The central tension is leadership wanting individual numbers vs the system needing flow insight** — fed by the same events. Deliver the team/system view; refuse the individual score. The **unit of measurement** is the whole question.
- **Measure at the system/team level:** TTFR p50/p90, cycle-time decomposition (pickup/review/merge), PR-size distribution, reviewer-load concentration/bus-factor, rework rate — as **distributions and trends**, never point values that invite target-setting.
- **Every speed metric needs a quality counter-metric.** Cycle-time-down beside change-fail-rate; TTFR-down beside rework. Unpaired speed is an instruction to cut corners; the counter-metric makes bought velocity visible. This is DORA's throughput-with-stability design.
- **Don't measure individuals** on PRs-reviewed, comments, approval-speed, or lines — each Goodharts into a specific pathology (nitpicking, rubber-stamping, dodging hard PRs). When leadership asks, **name the real flow question, predict the gaming, offer the team metric, cite SPACE/DevEx, and offer a survey** for the "is it painful?" question.
- **Improve tempo upstream-first:** shrink PRs ([02](../02-pr-scope-and-size/professional.md)) and fix load concentration before reaching for SLAs and reminders ([06](../06-review-tooling-and-automation/professional.md)). Make responsiveness a *team* norm that respects maker-time, not an individual SLA.
- **Use the data to diagnose bottlenecks and feed retros, complemented by DevEx perceptual data — never for performance management.** System data is *what and where*; the survey is *how it feels*. The dashboard is a day's work; the agreement that it won't rank humans is the real deliverable.

You can now run review metrics across an org as a force for flow, not a weapon against people. The remaining tier — [interview.md](interview.md) — consolidates this into the questions that probe whether someone can hold the line on metrics under leadership pressure.

---

## Further Reading

- ["The SPACE of Developer Productivity"](https://queue.acm.org/detail.cfm?id=3454124) (Forsgren, Storey, et al.) — the foundational argument that productivity is multi-dimensional, must not be a single metric, and must not be measured per-individual.
- *Accelerate* and the [DORA](https://dora.dev) metrics — the canonical speed-with-stability pairing (throughput always reported alongside change-fail rate), the model for every counter-metric on this page.
- [Martin Fowler, "CannotMeasureProductivity"](https://martinfowler.com/bliki/CannotMeasureProductivity.html) — why activity-as-productivity is a category error, and why the measurements get weaponized.
- DX / DevEx research (the [DevEx framework](https://queue.acm.org/detail.cfm?id=3595878) — feedback loops, cognitive load, flow state) — the case for perceptual data alongside system data, and how to ask the survey questions.
- Your VCS analytics tooling's docs (review/cycle-time dashboards) — read them for *what they make easy to misuse* as much as for what they measure.
- [interview.md](interview.md) — the same material as the questions that test whether you'll defend the culture under a "just give me the numbers" mandate.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) — the upstream driver of review tempo; the highest-ROI lever for cycle time.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/professional.md) — the culture that "fast but hostile" metrics can hide; what the DevEx survey surfaces.
- [08 — Review Anti-patterns](../08-review-anti-patterns/professional.md) — the nitpicking, rubber-stamping, and bottleneck behaviors that bad metrics manufacture.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the broader speed-with-stability metric program review tempo plugs into.
- [Quality Gates](../../quality-gates/) — where the "merge" segment of cycle time lives, and the quality counter-metrics come from.
