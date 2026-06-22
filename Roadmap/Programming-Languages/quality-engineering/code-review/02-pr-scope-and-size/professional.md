# PR Scope & Size — Professional Level

> **Roadmap:** [Code Review](../README.md) → PR Scope & Size
> *Every engineer agrees small PRs are better. Almost none of them ship small PRs by default. The gap between that universal belief and that universal behavior is where the staff engineer works — because the cause isn't ignorance, it's incentives, and you don't fix incentives with a wiki page.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Big-PR Doom Loop Is a Tempo Problem, Not a Discipline Problem](#core-concept-1--the-big-pr-doom-loop-is-a-tempo-problem-not-a-discipline-problem)
5. [Core Concept 2 — Trunk-Based Development and Flags Are the Enabler, Not the Goal](#core-concept-2--trunk-based-development-and-flags-are-the-enabler-not-the-goal)
6. [Core Concept 3 — Stacked Diffs and When the Tooling Investment Pays Off](#core-concept-3--stacked-diffs-and-when-the-tooling-investment-pays-off)
7. [Core Concept 4 — PR Size as a Tracked Health Metric](#core-concept-4--pr-size-as-a-tracked-health-metric)
8. [Core Concept 5 — Policy for the Unavoidable Big PR](#core-concept-5--policy-for-the-unavoidable-big-pr)
9. [Core Concept 6 — Coaching the People Who Default Big](#core-concept-6--coaching-the-people-who-default-big)
10. [Core Concept 7 — Selling Small PRs to Leadership](#core-concept-7--selling-small-prs-to-leadership)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Making "small" the path of least resistance across an org — through tooling, norms, and metrics — instead of exhorting individuals to be more disciplined.**

The senior page taught you how to split a change: refactor-first, vertical slices, the parts that decompose cleanly and the parts that don't. That's a skill, and at the senior level the skill is enough — you control your own PRs. At staff and principal level you don't write most of the PRs; you're accountable for the *distribution*. And the distribution is brutal: survey any engineering org and you'll find median PR sizes of 300–800 changed lines and p90s in the thousands, while the same engineers will tell you, sincerely, that small PRs are better.

That contradiction is the whole problem. Small PRs are *obvious in theory and rare in practice*, and the reason isn't that engineers forgot — it's that the environment punishes small. When review takes a day, splitting one change into four PRs means four day-long waits instead of one. So people batch to amortize the wait, the batches get bigger, the big PRs take even longer to review, and the wait gets worse. That feedback loop — the **big-PR doom loop** — is a system property, and you cannot lecture your way out of a system property.

This page is about the levers that actually move the distribution: fixing review *tempo* first (so small stops being penalized), giving people *tooling* that makes small cheap (stacked diffs, flag infrastructure, codemod tools), establishing *norms* that make "split this" a routine review response rather than an insult, and *measuring* the distribution so you can find the teams stuck in the loop. It is also about the honest tensions — the genuinely unavoidable big PR, the contractor who ships 4,000 lines, the flag graveyard that becomes its own incident — and how to handle them at policy level rather than case by case.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the splitting techniques (refactor-first, vertical slice, behavior-preserving separation) and why reviewer effort scales super-linearly with diff size.
- **Required:** You've reviewed PRs across more than one team and seen the size distribution vary wildly between them.
- **Helpful:** You've owned or influenced a CI pipeline, a feature-flag system, or a release process.
- **Helpful:** You've tried to change a team norm and watched it fail because the underlying incentive didn't move.

---

## Glossary

- **Trunk-based development (TBD):** every developer integrates to a single shared branch (`main`) at least daily, behind flags if incomplete. The opposite of long-lived feature branches that diverge for weeks.
- **Stacked diffs:** a chain of small, dependent PRs where each builds on the previous, reviewed independently and merged in order. Native to Phabricator/Graphite/Sapling; awkward on vanilla GitHub.
- **Feature flag (flag):** a runtime toggle that lets incomplete or risky code ship to `main` (and even to production) while staying inactive until deliberately enabled.
- **Flag debt / flag rot:** flags that outlive their purpose and are never removed, accumulating dead branches and risk in the codebase.
- **Review latency (cycle time component):** wall-clock time from "PR opened / review requested" to "first substantive review" and to "merged."
- **PR size distribution:** the statistical spread of changed-line counts across an org's PRs, tracked as median and p90 — the central health metric of this page.
- **The big-PR doom loop:** slow review → engineers batch to amortize the wait → bigger PRs → even slower review → more batching. A self-reinforcing cycle.
- **Codemod:** an automated, large-scale source transformation (e.g., via `jscodeshift`, `gofmt -r`, `comby`, OpenRewrite) that produces a large but mechanical diff.

---

## Core Concept 1 — The Big-PR Doom Loop Is a Tempo Problem, Not a Discipline Problem

If you take one thing from this page, take this: **before you tell anyone to write smaller PRs, fix how fast PRs get reviewed.** Almost every "we can't seem to keep PRs small" culture is downstream of slow review, and intervening on PR size while review stays slow is pushing on the symptom while the cause pulls the other way.

The mechanism is an economic one. A PR has a fixed *latency cost* — the wait for a reviewer — that is roughly independent of size. If that wait is 20 minutes, splitting a change into four PRs costs four cheap waits; small is nearly free. If that wait is a day, splitting into four costs four day-long context-switch-laden waits, and the rational individual response is to *batch* — fold four changes into one PR to pay the latency tax once. Every individual making that locally-rational choice produces the globally-bad outcome: a population of large PRs.

```
The doom loop (self-reinforcing):

   slow first review  ──▶  engineers batch to amortize the wait
          ▲                              │
          │                              ▼
   even slower review  ◀──  PRs get bigger ◀──  bigger diffs
   (big diffs take longer)

Break it HERE ──┐
                ▼
   fast first review  ──▶  splitting is cheap  ──▶  PRs shrink
          ▲                              │
          │                              ▼
   faster review  ◀────────  small diffs  ◀──────  smaller diffs
   (small diffs are quick)         (virtuous loop)
```

So the intervention order is non-obvious and matters enormously:

1. **First, fix review tempo.** Establish and *staff* a review SLA — e.g., "first review within 2 hours during working hours." Make reviewing a first-class, scheduled responsibility, not an interrupt people resent. This is the domain of [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md), and it is the *precondition* for everything else here. A small-PR push on top of slow review will fail and you'll wrongly conclude "our culture just doesn't do small PRs."
2. **Then, make small cheap.** Tooling (stacked diffs, flag infra) so authors don't fight the workflow.
3. **Then, set the norm.** A soft size guideline and "split this" as a normal review response.
4. **Then, measure.** Track the distribution to find teams still stuck.

Do these out of order and the org learns the wrong lesson. Do them in order and the loop runs in reverse: fast review makes small cheap, small diffs review fast, the virtuous loop reinforces itself, and within a quarter the median drops without anyone being nagged.

> **The staff insight:** "write smaller PRs" is advice to *individuals*; the doom loop is a property of the *system*. You cannot exhort your way out of a system problem. Change the incentive — the review wait — and the behavior follows. Lead with tempo, not with size.

---

## Core Concept 2 — Trunk-Based Development and Flags Are the Enabler, Not the Goal

Small PRs and long-lived feature branches are fundamentally incompatible. If a feature lives on its own branch for three weeks, it *must* merge as one giant PR — there's nowhere small to merge *to*. The structural enabler of small PRs is **trunk-based development**: everyone integrates to `main` at least daily, and incomplete work ships *behind a flag* rather than waiting on a branch.

This isn't a stylistic preference. The DORA / *Accelerate* research repeatedly finds that **trunk-based development and small batch sizes are among the strongest predictors of elite software-delivery performance** — teams doing TBD with short-lived branches and frequent integration outperform on deployment frequency, lead time, change-fail rate, *and* restore time simultaneously. Small PRs aren't a quality nicety traded off against speed; they correlate with being faster *and* safer at once. That dual result is the entire basis of the leadership pitch in Concept 7.

The chain of enablement is concrete:

```
Trunk-based development  ──requires──▶  incomplete work can merge safely
                                                    │
                                          (because) │
                                                    ▼
                                          feature flags hide it
                                                    │
                                          (so)      ▼
                              a feature becomes a SEQUENCE of small,
                              independently-shippable PRs behind one flag
                                                    │
                                                    ▼
                              small PRs become natural, not heroic
```

At org scale, flags stop being an ad-hoc `if (FEATURE_X)` and become *infrastructure* — and this is where staff work concentrates:

- **A flag platform.** A real flag-management system (LaunchDarkly, Unleash, Flagsmith, or a solid in-house one) with typed flags, targeting rules, audit logs, and a kill switch. Without it, flags are scattered booleans nobody can inventory — and the lack of good flag infra is one of the top *hidden* reasons teams batch: if flagging is painful, people hide incomplete work on branches instead.
- **Flag lifecycle discipline.** Every flag needs an owner and an expiry. The default failure mode is **flag rot**: flags that ship, succeed, and are never removed, leaving dead branches and stale code paths forever. A flag graveyard is real risk (see the War Story) — it's the supply-chain cost of buying small PRs with flags.
- **Cleanup tooling and norms.** Codemod-based flag removal, a "stale flag" report, and a norm that *removing* a flag is part of *done*, not optional follow-up that never happens.

> **The professional reality:** you cannot get a small-PR culture without trunk-based development, and you cannot get safe trunk-based development without flag infrastructure. The order of investment is flags-platform → TBD-norm → small-PR culture. Skip the flag platform and people will route around the pain by hiding work on long branches — straight back to big PRs. The flag debt that results is a *known, managed* cost, not a surprise: budget for cleanup from day one.

---

## Core Concept 3 — Stacked Diffs and When the Tooling Investment Pays Off

Stacked diffs are the highest-leverage workflow for keeping PRs small — and the most over-prescribed. They let you build a chain of small dependent PRs (`refactor` → `add API` → `wire UI` → `enable flag`), each reviewed and merged independently, without the soul-crushing GitHub dance of manually rebasing four interdependent branches every time one changes. On Phabricator, Graphite, or Sapling this is native and fluid; on vanilla GitHub it is genuinely painful, and that pain is the entire decision.

The honest framing: **stacked diffs are worth it when the platform supports them and the team's velocity is high enough that the manual cost of *not* having them exceeds the cost of adopting the tooling.** They are not a default to impose everywhere.

When the investment pays off:

| Signal | Why stacked diffs help |
|---|---|
| **High-velocity team** | Many interdependent changes in flight; manual rebasing of branch chains is a constant tax. |
| **Monorepo** | Cross-cutting changes naturally decompose into ordered, dependent steps. |
| **Already on Graphite/Sapling/Phabricator** | The tooling cost is near zero; just adopt the workflow. |
| **Frequent "this PR is big because the refactor and the feature are tangled"** | Stacking is the clean separation: refactor PR, then feature PR on top. |

When it's not worth it:

| Signal | Why to skip (for now) |
|---|---|
| **Vanilla GitHub, no tooling budget** | Manual stacked PRs are error-prone; the friction can *increase* batching. |
| **Low PR volume / small team** | The doom loop is mild; simpler interventions (tempo + flags) suffice. |
| **Team not fluent in rebasing** | Stacks demand comfortable history rewriting; force it on the unready and they'll revolt. |

The two real costs are **the platform gap** (adopting Graphite or migrating tooling is a non-trivial org decision, not a `brew install`) and **training** — stacked diffs change the mental model from "one branch, one PR" to "a stack I restack as it evolves," and people need real hand-holding through the first few. Budget for the training explicitly; the tool without the training produces abandoned half-stacks and frustration.

> **The staff discipline:** stacked diffs are a *force multiplier for teams already moving fast*, not a fix for teams that aren't. Diagnose first: if the median is high because review is slow, fix tempo — stacking won't help and may hurt. If the median is high because changes are genuinely interdependent and the team is fast, *that's* when the stacked-diff tooling investment returns multiples. Match the tool to the actual constraint.

---

## Core Concept 4 — PR Size as a Tracked Health Metric

You cannot manage a distribution you don't measure, and "are our PRs small?" answered by vibes is worthless. Treat **PR size distribution as a tracked engineering-health metric**, the same way you track deploy frequency or incident rate. The two numbers that matter:

- **Median changed lines per PR** — the typical experience. A healthy target is roughly **< 200 lines**; many elite teams sit well below 100.
- **p90 changed lines per PR** — the tail, where the doom loop and the rubber-stamps live. This is often *more* diagnostic than the median, because a team can have a fine median and a horrifying p90 of giant PRs nobody actually reads.

The second, decisive correlation to track is **review latency vs. PR size** — and it is reliably, steeply positive. Plot time-to-first-review (or time-to-merge) against changed lines and you get the empirical shape of the doom loop: big PRs wait longer, which is *exactly* why they're dangerous. This is the data that lets you connect the two halves and is sourced from the same pipeline as [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).

```
Review latency vs. PR size (the doom-loop signature)

 merge   │                                          ╱ ← p90 PRs sit
 latency │                                      ╱       here, for days,
         │                              ╱╱╱             often rubber-stamped
         │                    ╱╱╱╱
         │          ╱╱╱╱
         │   ╱╱╱
         └─────────────────────────────────────────▶  changed lines
            <100   200    500   1000   2000   4000

  The curve is super-linear: latency rises faster than size.
  Find teams living on the right side → they're in the loop.
```

How to *use* the metrics (this is the staff part — metrics exist to drive action, not decorate dashboards):

- **Find the stuck teams.** Sort teams by p90 PR size and review latency. The teams high on both are in the doom loop — that's where you intervene with tempo + tooling.
- **Track the intervention.** When you fix a team's review SLA, watch the median *and* latency drop together over the following weeks. That's your proof the lever worked.
- **Keep it soft, and watch for Goodharting.** The moment PR size becomes a hard target or a performance metric, people will game it — splitting one logical change into ten meaningless PRs to hit a number, which is *worse* than one coherent PR. Size is a *health signal for the system*, never a *grading metric for individuals*. (This is the Goodhart's-law trap covered in [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — measure the system, not the people.)

> **The audit reality:** "what's your PR size distribution and how does latency correlate with it?" should have a real answer backed by a dashboard, not "they're mostly reasonable." If you can't show the distribution, you can't tell a healthy team from one quietly drowning in 2,000-line rubber-stamps. Measure the distribution; use it to find the loop; never use it to grade humans.

---

## Core Concept 5 — Policy for the Unavoidable Big PR

Some large PRs are legitimate and no amount of culture will (or should) shrink them: a **codemod** that renames a symbol across 800 files, an autogenerated client from an updated schema, a `package-lock.json` churn, a framework migration that can't be half-applied. The staff mistake is treating these the same as a hand-written 2,000-line feature PR. They need a *different review protocol*, defined at policy level so every team handles them consistently.

The core move: **separate mechanical change from semantic change, and review each appropriately.** A line-by-line review of a 50,000-line codemod is theater — no human reads 50,000 lines, so "approved" means "rubber-stamped," the worst of both worlds. Instead:

| Big-PR type | Review protocol |
|---|---|
| **Pure codemod / mechanical** | Review *the transformation script* line-by-line (that's the real logic), then **spot-check** a representative sample of outputs + rely on the test suite. Label `mechanical-change`. |
| **Generated code** (clients, protobuf, lockfiles) | Don't review generated bytes; review the *generator input/config* and confirm regeneration is reproducible. Often exclude from diff stats. |
| **Mixed (codemod + hand edits)** | **Split it.** Land the pure codemod as one labeled mechanical PR; land the hand-written follow-ups as small normal PRs. Never bury manual edits inside a giant mechanical diff — that's exactly where bugs hide unreviewed. |
| **Migration that can't be staged** | Pair-review or mob-review; require a written rollback plan; gate behind a flag if at all possible. |

The enabling mechanism is **labels and norms**. A `mechanical-change` or `codemod` label tells reviewers "review the script + spot-check, don't pretend to read every line," and tells your metrics pipeline to *exclude these from the size distribution* so they don't pollute the median you're tracking in Concept 4. Make the policy explicit and written, because the default — an unlabeled 50,000-line PR with one "LGTM" — is indistinguishable from negligence and conditions everyone to rubber-stamp big things.

> **The principle:** the goal was never "all PRs are small." It was "every PR gets *real* review proportional to its actual risk." A codemod's risk lives in the script, not the output; review the script hard and spot-check the rest. A hand-written change's risk lives in every line; keep it small enough to read. Match the review effort to where the risk actually is — and *never* let manual changes ride inside a mechanical diff.

---

## Core Concept 6 — Coaching the People Who Default Big

There's a persistent, predictable tension: **juniors and contractors tend to produce the biggest PRs**, and they're the people for whom the doom loop's "split this" feedback lands hardest. Juniors batch because they don't yet *see* the seams — to a novice the change is one indivisible blob, and "split it" without showing *how* is just discouraging. Contractors and offshore teams often batch because of the latency loop on steroids: if their review wait spans a timezone gap, a day's wait becomes effectively two, so amortizing into one big PR is even more rational for them than for anyone else.

Coaching this is a staff/EM responsibility, and the technique is *teach the seams, fix the loop, don't shame*:

- **Make "split this" routine and kind, not a verdict.** The norm has to be that *everyone's* PRs get split sometimes — when it's a normal, expected part of review rather than a mark against you, juniors absorb it as a skill instead of a failure. If only the junior's PRs get the "split this" comment, you've created a status signal, not a teaching moment.
- **Show the split, don't just demand it.** "This is big — could you land the rename as a separate PR first, then the new endpoint?" teaches the seam. "Too big, split it" teaches nothing and breeds resentment.
- **Fix the contractor latency loop directly.** If a vendor team's wait spans timezones, assign them a same-timezone reviewer or a dedicated review window. Their big PRs are usually a *rational response to your tempo*, not carelessness — fix the tempo and the size follows, exactly as in Concept 1.
- **Pair on the first few splits.** For a junior, walking through *together* how one change becomes a refactor PR + a feature PR is worth ten review comments. They learn to see seams by doing it with you once.

> **The coaching frame:** big PRs from juniors and contractors are almost never a discipline failure — they're a *skill gap* (can't see the seams) or an *incentive response* (the latency loop is worse for them). Diagnose which, then teach the seam or fix the loop. Shaming does neither and poisons the review culture you're trying to build.

---

## Core Concept 7 — Selling Small PRs to Leadership

Engineering culture changes that cost tooling budget and process time need leadership backing, and "small PRs are cleaner" is not an argument that survives a budget meeting. The staff job is to translate the engineering case into the language leadership prioritizes: **speed and risk.** The good news is that the data does the work, because small PRs are one of the rare interventions that improves *both* simultaneously — you are not asking leadership to trade speed for quality, you're showing them they get both.

The pitch, in their terms:

- **The flow case (speed):** small batches reduce cycle time, full stop. The DORA / *Accelerate* research ties trunk-based development and small batch sizes directly to elite delivery performance — higher deploy frequency *and* shorter lead time. Show your own latency-vs-size curve: "our big PRs sit for days; halving median PR size measurably cuts our lead time." That's a delivery-speed argument, which leadership funds.
- **The defect case (risk):** big PRs get rubber-stamped because no one can review thousands of lines properly, so bugs ship that a smaller, readable PR would have caught (you have the War Story to prove it). Smaller PRs = more thorough review = fewer escaped defects = lower change-fail rate and better restore time. That's a risk-reduction argument, which leadership also funds.
- **The combined frame:** "this makes us ship *faster and safer at the same time* — it's not a tradeoff, it's a Pareto improvement, and the DORA data backs it." That sentence is the one that gets the flag-platform budget and the review-SLA mandate approved.

Bring receipts: your org's own PR-size distribution, your latency-vs-size curve, your change-fail rate, and one concrete incident a split would have caught. Abstract appeals to cleanliness lose; "here is our data, here is the industry data, here is the dollar cost of the loop" wins.

> **The leadership reality:** leadership doesn't buy "code hygiene." It buys "ships faster" and "breaks less." Small PRs deliver both, the DORA research proves both, and your local metrics make it concrete. Frame the ask as a flow-and-defect investment with a Pareto payoff — backed by [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — not as a developer-experience nicety.

---

## War Stories

**The doom loop broken by fixing SLAs first.** A platform team was convinced their engineers "just didn't write small PRs" — median was ~700 lines and every retro lamented it. The actual cause surfaced in the data: time-to-first-review averaged 1.5 *days*. Engineers were rationally batching to pay that wait once. The lead resisted the urge to launch a "small PR initiative" and instead fixed tempo: a 2-hour first-review SLA, reviewing made a scheduled daily responsibility, a round-robin assignment bot. Within six weeks median PR size fell to ~250 lines *with no instruction to write smaller PRs* — the loop simply ran in reverse once splitting stopped being penalized. The lesson that stuck: the team that "couldn't do small PRs" did them automatically the moment small stopped costing a day.

**The 4,000-line PR that shipped a bug a split would have caught.** A 4,000-line PR — a new billing flow tangled together with a refactor — sat for two weeks (nobody had a free day to review it), accumulated merge conflicts, and was finally approved with a single "LGTM, huge but looks fine" after a 20-minute skim. It shipped a logic bug in a discount-calculation branch buried in the middle of the diff that overcharged a segment of customers. The post-incident review was unambiguous: at 200 lines that branch would have been the *focus* of review; at 4,000 it was scenery. The fix wasn't "review harder" — humans don't review 4,000 lines, ever. The org adopted a soft 400-line guideline and, more importantly, made "this is too big to review properly — please split" a standard, blameless review response.

**Stacked diffs + flags: 600 → 90 LOC, cycle time halved.** A high-velocity product team in a monorepo was drowning in interdependent branches and manual rebasing. They adopted Graphite for stacked diffs and stood up a real flag platform so features could land as ordered sequences of tiny PRs behind one flag. Median PR size dropped from ~600 lines to ~90 over a quarter, and cycle time roughly halved — because 90-line PRs got reviewed in under an hour while 600-line ones had waited a day. The non-obvious precondition: it worked *because the team was already fast and already in a monorepo*. They'd previously tried imposing the same stacked workflow on a low-velocity team on vanilla GitHub, where it flopped — the manual friction there made things worse. Same tool, opposite outcome, decided entirely by fit.

**The codemod reviewed as "mechanical + spot-check."** A library upgrade required a codemod touching ~30,000 lines across 900 files. The first instinct was to assign two senior engineers to "review it" — i.e., to rubber-stamp 30,000 lines, since no human reads that. Instead the team rewrote the protocol: one engineer reviewed the *transformation script* line-by-line (a tight 80 lines — the real logic), spot-checked 25 representative output files, and leaned on the full test suite; the PR was labeled `mechanical-change` and excluded from the size dashboard. Review took two focused hours instead of two days of theater, and it was *more* rigorous — the actual risk (the script) got genuine scrutiny instead of being lost in 30,000 lines of noise.

**The flag graveyard that caused an incident.** A team had bought small PRs with flags — and never removed any. Years of dead flags accumulated: ~200 flags, most permanently on or off, nobody owning them. An on-call engineer, debugging an outage at 2 a.m., flipped a flag they believed was inert; it re-activated a long-abandoned code path that hadn't been maintained in two years and made the incident worse. The post-mortem named flag rot as a direct contributing cause. The org instituted flag-lifecycle discipline: every flag gets an owner and an expiry date, a weekly stale-flag report, codemod-assisted removal, and "remove the flag" as a tracked part of *done*. Small PRs via flags is a great trade — but the flag debt is a real liability you must actively service, not a free lunch.

---

## Decision Frameworks

**PR-size guideline by change type** (soft guidance, never a hard gate):

| Change type | Target size | Notes |
|---|---|---|
| Bug fix | < 100 lines | Should be tight and focused; one fix per PR. |
| Feature increment (behind flag) | < 300 lines | One vertical slice or one stacked step. |
| Refactor (behavior-preserving) | < 400 lines | Land *separately* from feature work, before it. |
| Codemod / mechanical | unbounded, **labeled** | Review the script + spot-check; exclude from size metrics. |
| Generated code | unbounded, **excluded** | Review the generator config, not the output. |

**Split strategy — pick by the shape of the change:**

| The change is… | Strategy | What lands first |
|---|---|---|
| Refactor tangled with a feature | **Refactor-first** | Behavior-preserving refactor PR, then the feature on a clean base. |
| One feature touching many layers | **Vertical slice** | Smallest end-to-end working slice (behind a flag), then more slices. |
| A chain of dependent steps, team is fast | **Stacked diffs** | The whole stack, each PR reviewed/merged in order. |
| Risky or incomplete work | **Flag-gated** | Code behind an off flag; enable in a tiny final PR. |

**When stacked diffs are worth the tooling investment:**

| Adopt stacked diffs when… | Hold off when… |
|---|---|
| High velocity + many interdependent changes | Low PR volume / small team |
| Monorepo with cross-cutting work | Vanilla GitHub, no tooling budget |
| Already on Graphite / Sapling / Phabricator | Team not yet fluent in rebasing |
| Refactors constantly tangle with features | Doom loop is mild — fix tempo first |

**Reviewing the unavoidable big PR:**

| Question | If yes → |
|---|---|
| Is it purely mechanical (codemod)? | Review the *script* line-by-line; spot-check outputs; label `mechanical-change`. |
| Is it generated code? | Review the *generator config*; exclude the output from review and metrics. |
| Does it mix mechanical + hand edits? | **Split** — mechanical PR, then small hand-written PRs. Never bury manual edits. |
| Is it a migration that can't be staged? | Mob/pair review; require rollback plan; flag-gate if possible. |

**Diagnosing the big-PR doom loop:**

| Symptom | Likely cause | First lever |
|---|---|---|
| High median + high review latency | Classic doom loop | **Fix tempo / review SLA** (Concept 1) — *not* a size mandate. |
| Fine median, terrible p90 | Big rubber-stamped PRs in the tail | Big-PR review protocol + soft guideline (Concepts 4–5). |
| Long-lived branches, giant merges | No TBD / no flag infra | Flag platform → trunk-based norm (Concept 2). |
| Only juniors/contractors run big | Skill gap or timezone latency | Coach the seams / fix their review tempo (Concept 6). |
| Median fine but flags everywhere, never removed | Flag rot | Flag-lifecycle discipline; cleanup tooling (Concept 2). |

---

## Mental Models

- **The doom loop is the master model.** Slow review → batching → big PRs → slower review. Almost every "we can't do small PRs" is this loop. Break it at *tempo*, and it reverses itself. Lead with review speed, never with a size mandate.

- **Small PRs are an *incentive* outcome, not a *willpower* outcome.** People batch because the system penalizes splitting (latency). Change the incentive (fast review, good tooling) and small happens by itself. Exhortation fails; incentives work.

- **Trunk-based + flags is the structural enabler; stacked diffs is the workflow accelerant.** TBD makes small *possible*; flags make incomplete work *safe* on `main`; stacked diffs make the chain of small PRs *cheap to manage*. They're a stack, in that order of dependency.

- **Match review effort to where the risk lives.** A codemod's risk is in the script; a feature's risk is in every line. Review the script hard and spot-check the codemod; keep the feature small enough to actually read. "All PRs small" was never the goal — "real review proportional to risk" was.

- **PR size is a health signal for the system, never a grade for the human.** Track median and p90 to find the stuck teams; the instant it becomes an individual target, it's Goodharted into meaningless PR-splitting. Measure the system, fix the system.

- **Flags are debt you choose to take on.** Buying small PRs with flags is a great trade — *if* you service the debt. Unmanaged flags rot into an incident waiting to happen. Owner + expiry + cleanup, from day one.

---

## Common Mistakes

1. **Launching a "small PR initiative" before fixing review tempo.** The doom loop pulls the other way; the initiative fails, and you wrongly conclude "our culture can't do small PRs." Fix the review SLA *first* — then small becomes cheap and largely automatic.

2. **Mandating PR size as a hard gate.** A 400-line CI block just gets gamed — people split one logical change into meaningless fragments, which is worse. Keep size a *soft* guideline and a *health metric*, never an enforced limit or a performance grade.

3. **Pushing small PRs without trunk-based development and flag infra.** With long-lived branches there's nowhere small to merge to. If flagging is painful, people hide work on branches → big merges. Stand up the flag platform and the TBD norm *first*.

4. **Imposing stacked diffs everywhere.** They're a force multiplier for fast teams with the right tooling, and pure friction for slow teams on vanilla GitHub. Diagnose fit before adopting; the same tool helps one team and hurts another.

5. **Reviewing codemods line-by-line.** No human reads 30,000 lines, so "approved" means rubber-stamped. Review the *script*, spot-check outputs, label it mechanical, exclude it from metrics. And never let hand-written edits ride inside a mechanical diff.

6. **Shaming juniors/contractors for big PRs.** It's a skill gap (can't see seams) or an incentive (worse latency loop), not carelessness. Make "split this" routine for everyone, *show* the seam, and fix their review tempo. Shaming poisons the culture you're building.

7. **Buying small PRs with flags and never paying the debt.** Flag rot accumulates silently until a dead flag causes an incident. Every flag needs an owner and an expiry; "remove the flag" is part of *done*; run a stale-flag report.

8. **Pitching leadership on "cleaner code."** Leadership funds speed and risk reduction, not hygiene. Frame it as the DORA-backed flow-and-defect Pareto win — faster *and* safer — with your own metrics as proof.

---

## Test Yourself

1. A team insists they "just can't keep PRs small" despite everyone agreeing small is better. What's the most likely systemic cause, and what do you fix *first* — and why not a small-PR mandate?
2. Explain why trunk-based development and feature flags are the structural enabler of small PRs, and what happens to PR size if you push TBD without good flag infrastructure.
3. Your org runs vanilla GitHub, low PR volume, and a team isn't fluent in rebasing. Should you adopt stacked diffs? What single factor most changes the answer?
4. You track PR-size distribution. Why is p90 often more diagnostic than the median, and what second metric must you plot alongside size to see the doom loop?
5. A 40,000-line codemod PR arrives. Describe the review protocol, what you actually review line-by-line, and how it interacts with your size-distribution dashboard.
6. A contractor team consistently ships 3,000-line PRs. Before assuming carelessness, what two explanations should you check, and what's the fix for each?
7. You need leadership to fund a flag platform and a review-SLA mandate. What's the argument, and what's wrong with "it'll make our code cleaner"?
8. Why is making PR size a hard CI gate or an individual performance metric a mistake, and what's the term for the failure mode?

<details>
<summary>Answers</summary>

1. The systemic cause is almost always the **big-PR doom loop**: slow review → engineers batch to amortize the wait → bigger PRs → slower review. You fix **review tempo first** (a staffed first-review SLA, reviewing as a scheduled responsibility). A small-PR mandate on top of slow review pushes against the incentive and fails — and teaches the org the wrong lesson ("we can't do small"). Fix tempo and the loop reverses; small becomes cheap and largely automatic.
2. Long-lived feature branches *must* merge as one giant PR — there's nowhere small to merge to. **TBD** (integrate to `main` daily) plus **flags** (hide incomplete work safely) turns one big merge into a *sequence* of small independently-shippable PRs behind one flag. Without good flag infra, flagging is painful, so people route around it by hiding work on long branches → straight back to big merges. Order of investment: flag platform → TBD norm → small-PR culture.
3. **No — hold off.** Stacked diffs are a force multiplier for *fast* teams with native tooling (Graphite/Sapling/Phabricator) and become pure friction on vanilla GitHub for teams not fluent in rebasing; the manual cost can *increase* batching. The single biggest factor is **fit** — platform support + team velocity. Fix tempo and flags first.
4. The **median** can look fine while a horrifying **p90** of giant, rubber-stamped PRs hides in the tail — and the tail is where escaped defects live, so p90 catches what the median masks. Plot **review latency vs. PR size** alongside it; the steep, super-linear positive curve *is* the doom-loop signature (big PRs wait longer).
5. Review the **transformation script line-by-line** (that's the real logic), **spot-check** a representative sample of output files, and lean on the **test suite**. Label it **`mechanical-change`** and **exclude it from the size distribution** so it doesn't pollute your tracked median. Do *not* read all 40,000 lines (that's rubber-stamp theater), and never let hand-written edits hide inside the mechanical diff — split those out as small normal PRs.
6. Check (a) **skill gap** — they may not see the seams to split on; fix by *showing* the split and pairing on the first few; and (b) **timezone latency loop** — if their review wait spans a timezone gap, batching is doubly rational; fix by assigning a same-timezone reviewer or dedicated review window. Their big PRs are usually a rational response to your tempo, not carelessness.
7. Frame it as a **flow-and-defect Pareto win**: DORA/*Accelerate* ties TBD + small batches to elite delivery (faster lead time *and* deploy frequency) *and* fewer escaped defects (lower change-fail rate) — faster **and** safer at once, backed by your own PR-size distribution, latency-vs-size curve, and a concrete incident a split would have caught. "Cleaner code" is wrong because leadership funds **speed and risk reduction**, not hygiene; it loses the budget meeting.
8. A hard gate or individual grade gets **gamed** — people split one logical change into meaningless fragments to hit the number, which is *worse* than a coherent PR. The failure mode is **Goodhart's law** ("when a measure becomes a target, it ceases to be a good measure"). Keep size a *soft* guideline and a *system* health signal; measure the system, never grade the human.

</details>

---

## Cheat Sheet

```
THE DOOM LOOP (the master diagnosis)
  slow review → batch to amortize wait → big PRs → slower review
  BREAK IT AT: review tempo (SLA), NOT a size mandate
  fast review → splitting is cheap → small PRs → faster review (reverses)

INTERVENTION ORDER (do NOT reorder)
  1. fix review tempo / SLA          (07-review-metrics-and-tempo)
  2. make small cheap: tooling       (stacked diffs, flag platform)
  3. set the norm: soft guideline + "split this" as routine
  4. measure the distribution        (find stuck teams)

TRUNK-BASED + FLAGS (the enabler)
  TBD: integrate to main daily; incomplete work behind a flag
  flag platform → TBD norm → small-PR culture  (this order)
  DORA: TBD + small batches → elite (faster AND safer)
  flag debt is real: owner + expiry + cleanup, or it rots → incident

STACKED DIFFS (force multiplier, not a default)
  worth it: fast team + monorepo + Graphite/Sapling/Phabricator
  skip:     vanilla GitHub + low volume + not fluent in rebasing
  budget for TRAINING, not just the tool

METRICS (health signal, NOT a grade)
  median changed lines   target < 200 (elite < 100)
  p90 changed lines      the tail — often MORE diagnostic
  latency vs size curve  steep positive = doom-loop signature
  NEVER a hard gate / perf metric → Goodhart's law

UNAVOIDABLE BIG PRs (match review to risk)
  codemod    → review the SCRIPT line-by-line + spot-check; label mechanical
  generated  → review generator config; exclude output from metrics
  mixed      → SPLIT: mechanical PR + small hand-written PRs
  migration  → mob/pair review + rollback plan + flag-gate

SELLING TO LEADERSHIP
  pitch: faster AND safer (DORA flow + defect data) = Pareto win
  bring: your size distribution + latency curve + 1 real incident
  NOT: "cleaner code" (loses the budget meeting)
```

---

## Summary

- The **big-PR doom loop** — slow review → batching → big PRs → slower review — is the master diagnosis, and it's a *system* property, not a discipline failure. **Fix review tempo first** ([07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md)); a small-PR mandate on top of slow review fails. The intervention order is tempo → tooling → norms → metrics, and reordering it teaches the org the wrong lesson.
- **Trunk-based development + feature flags** are the structural enabler — DORA/*Accelerate* ties TBD and small batches to elite delivery (faster *and* safer). At scale this means a **flag platform**, and **flag-lifecycle discipline** to service the flag debt before it rots into an incident. Invest flag platform → TBD norm → small-PR culture.
- **Stacked diffs** are a force multiplier for fast teams on the right platform (monorepo, Graphite/Sapling/Phabricator), and pure friction elsewhere. Diagnose fit; budget for training; don't impose them everywhere.
- Track **PR size distribution** (median and especially **p90**) and the **latency-vs-size curve** as a *system health metric* to find stuck teams — drawing on [Engineering Metrics & DORA](../../engineering-metrics-and-dora/). Never make it a hard gate or an individual grade; that's Goodharted into meaningless PR-splitting.
- Handle the **unavoidable big PR** at policy level: review the *script* for codemods + spot-check, exclude generated code, split mixed PRs, label `mechanical-change`, and exclude mechanical changes from the metrics. The goal was always *review proportional to risk*, never "all PRs small."
- **Coach** juniors/contractors who default big by teaching the seams and fixing their tempo, not shaming. **Sell** small PRs to leadership as a DORA-backed flow-and-defect Pareto win — faster and safer — never as "cleaner code."

You can now move an org's PR-size distribution by changing its incentives and tooling rather than exhorting individuals. The final tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone genuinely understands the doom loop and the levers that break it.

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) and the **DORA State of DevOps** reports — the empirical case that trunk-based development and small batch sizes predict elite delivery performance on both speed and stability.
- [Google Engineering Practices — "Small CLs"](https://google.github.io/eng-practices/review/developer/small-cls.html) — the canonical guide to why and how to keep changes small, from an org that lives it at scale.
- [Trunk Based Development](https://trunkbaseddevelopment.com/) (Paul Hammant) — the definitive reference on TBD, short-lived branches, and flag-gated incomplete work.
- A **stacked-diff case study** — engineering blogs from Graphite, Meta (Phabricator/Sapling), or teams that publish before/after median-PR-size and cycle-time numbers; read for the *fit* conditions, not just the wins.
- Feature-flag platform docs (LaunchDarkly, Unleash) on **flag lifecycle and cleanup** — the discipline that prevents flag rot from becoming an incident.
- [interview.md](interview.md) — the same material distilled into interview questions that test real understanding of the doom loop and the levers.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/professional.md) — how review effort is spent inside a PR, which small PRs make tractable.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md) — the review-SLA and tempo work that is the *precondition* for breaking the doom loop.
- [08 — Review Anti-patterns](../08-review-anti-patterns/professional.md) — rubber-stamping and the other failure modes that big PRs reliably produce.
- [Quality Gates](../../quality-gates/) — where the soft size guideline and mechanical-change labels live as policy.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the metrics pipeline behind PR-size distribution, the latency curve, and the Goodhart's-law caution.
