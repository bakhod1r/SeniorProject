# Review Anti-patterns — Middle Level

> **Roadmap:** [Code Review](../README.md) → Review Anti-patterns
> *The junior page named the smells. This page diagnoses them: for each anti-pattern, the mechanism that produces it, the root cause that feeds it, and the systemic fix that removes it — because almost none of these are solved by telling people to "be better."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Unifying Diagnosis](#core-concept-1--the-unifying-diagnosis)
5. [Core Concept 2 — Reviewer-Side Anti-patterns](#core-concept-2--reviewer-side-anti-patterns)
6. [Core Concept 3 — Author-Side Anti-patterns](#core-concept-3--author-side-anti-patterns)
7. [Core Concept 4 — Systemic & Cultural Anti-patterns](#core-concept-4--systemic--cultural-anti-patterns)
8. [Core Concept 5 — Root Cause → Systemic Fix](#core-concept-5--root-cause--systemic-fix)
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

> Focus: **Why does each anti-pattern happen, and what change to the system — not the person — actually stops it?**

At the junior level an anti-pattern is a behaviour you recognize and avoid: don't bikeshed, don't rubber-stamp, don't be a jerk in comments. Correct advice — but it's the cartoon version, because it locates the problem in *individual willpower*. Tell a tired reviewer "read more carefully" and next week, just as tired, they'll LGTM another 900-line PR.

The senior insight is that **review anti-patterns are overwhelmingly produced by the system the review runs inside**, not by bad people. A reviewer bikesheds because trivial things are the only things easy to have opinions on. A reviewer rubber-stamps because they're drowning. An author writes a giant PR because nobody told them where the ceiling is. Each behaviour is a *rational local response* to a broken incentive or a missing guardrail. This page works through the catalog the way you'd debug a flaky test: name the symptom, find the mechanism, trace it to the root cause, then fix the cause. The recurring punchline is that the fix is structural — automate the style, shrink the PR, cap the load, write the norm — not a motivational poster.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the common anti-patterns on sight.
- **Required:** You've both given and received reviews on a real team ([05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md)).
- **Helpful:** You've felt the pain personally — waited days for a review, or drowned in nitpicks on a PR you were proud of.
- **Helpful:** A rough sense of how your team measures review (or that it doesn't) ([07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/middle.md)).

---

## Glossary

- **Anti-pattern** — a common response to a recurring problem that looks helpful but is reliably counter-productive. The pairing matters: it's a *solution* that backfires, not just a bad habit.
- **Root cause** — the structural condition that makes the anti-pattern the path of least resistance. Remove it and the behaviour stops being rational.
- **Systemic fix** — a change to tooling, process, scope, or norms that removes the root cause. Contrasted with *exhortation* ("try harder"), which leaves the root cause intact.
- **Law of triviality (bikeshedding)** — Parkinson's observation that a committee spends more time on a trivial item (the colour of the bike shed) than a consequential one (the nuclear reactor it's attached to), because everyone *can* have an opinion on the trivial thing.
- **Review theatre** — a review process that produces approvals reliably but catches defects rarely; it exists to satisfy a process or audit requirement, not to improve the code.
- **Goodhart's law** — "when a measure becomes a target, it ceases to be a good measure." Why gamifying review counts corrodes review.
- **SLA (review)** — an agreed maximum response time for a review request (e.g. "first response within one business day").

---

## Core Concept 1 — The Unifying Diagnosis

Before the catalog, the thesis — because it's what turns a list of don'ts into a strategy. Trace any review anti-pattern back far enough and it lands in one of five structural conditions:

```text
(a) STYLE IS NOT AUTOMATED   → reviewers argue formatting, naming, import order
(b) PRs ARE TOO BIG          → reviewers skim, rubber-stamp, give late design feedback
(c) REVIEWERS ARE OVERLOADED → LGTM-without-reading, ghosting, slow turnaround
(d) NO NORMS / NO CALIBRATION→ inconsistent bar, preference-blocking, pile-ons, ego
(e) BAD METRICS              → comment-count gaming, approval-count gaming, theatre
```

Every entry in the catalog below maps to one or more of these. That's the payoff: you don't need to memorize twenty behaviours and twenty fixes. You need to recognize which of the five conditions you're in, and apply the corresponding lever — automate, shrink, cap, norm, or fix the metric.

> **Key insight:** "Be a better reviewer" is not a fix; it's a wish. It asks individuals to repeatedly overcome a system that rewards the opposite. Durable fixes change what the *easy* path is — they make the good behaviour the path of least resistance and the bad behaviour either impossible or visibly accountable. If your only tool is exhortation, the anti-pattern returns the moment people are busy.

---

## Core Concept 2 — Reviewer-Side Anti-patterns

These originate with the reviewer. For each: **mechanism → root cause → systemic fix.**

### Bikeshedding (Parkinson's law of triviality)

**Mechanism.** The review fills with comments about formatting, naming bikesheds, import ordering, and brace placement — while the actual logic gets a glance. **Root cause.** Trivial things are the easiest things to have an opinion on. Evaluating a concurrency change demands real thought and risks being wrong; demanding `camelCase` over `snake_case` is effortless and feels productive. Attention flows to where opinions are cheap. **Systemic fix.** *Make style un-reviewable.* Run a deterministic auto-formatter (Prettier, gofmt, Black, clang-format) in CI and a linter for naming/ordering rules ([Static Analysis & Linting](../../static-analysis/)). If the formatter owns whitespace and the linter owns the conventions, there is *nothing left to bikeshed* — humans literally cannot comment on what a machine has already decided. The fix is to delete the category, not to ask reviewers to ignore it.

### Rubber-stamping (LGTM-without-reading)

**Mechanism.** An approval lands minutes after a large PR opens, with no comments. The reviewer didn't read it. **Root cause.** Almost always *overload plus social pressure plus size*: too many review requests, time pressure to unblock a colleague, trust ("they're senior, it's probably fine"), and a PR too big to read in the time available. Skimming-then-approving is the rational move when reading carefully has no enforced value and ignoring the request feels rude. **Systemic fix.** Three levers, none of which is "read more": cap reviewer load so careful reading is *possible* ([07](../07-review-metrics-and-tempo/middle.md)); cap PR size so reading is *fast* ([02 — PR Scope & Size](../02-pr-scope-and-size/middle.md)); and make approval *accountable* — "you approved it, you own the incident review with the author." Accountability converts a free signature into a real claim.

> **Key insight:** Rubber-stamping isn't a character flaw, it's a throughput equation. A reviewer with 15 pending reviews and a 900-line PR *cannot* review carefully; LGTM is the only way to clear the queue. You fix the equation (fewer, smaller PRs; capped load), not the character. An approval should mean "I read this and I'll stand behind it," and the system should make that the only kind of approval that's cheap to give.

### Blocking on personal preference

**Mechanism.** A reviewer marks the PR "request changes" because they'd have written it differently — a different (equivalent) helper, a style they prefer — though nothing is *wrong*. **Root cause.** Conflating *taste* with *correctness*. The reviewer experiences "I wouldn't do it that way" as "this is a defect," and the tool's binary block/approve makes the soft preference a hard gate. **Systemic fix.** Install the **fact-vs-preference discipline** and the **"approve if correct and reasonable" rule** ([05](../05-feedback-giving-and-receiving/middle.md)). A reviewer may *suggest* a preference (clearly labelled `nit:` or `optional:`) but may only *block* on a fact: a bug, a missing test, a real maintainability or security problem. A written style guide ends the recurring taste debates by making the team's choice authoritative — you appeal to the guide, not to each other's preferences.

### The nitpick pile-on (death by a thousand nits)

**Mechanism.** Three reviewers each leave fifteen tiny comments; the author spends a day addressing trivia while the design question goes unasked. **Root cause.** No severity signal (every comment looks equally mandatory) and no ownership boundary (everyone nitpicks everything). **Systemic fix.** **Severity labels** so blocking and optional are visibly different; the norm that **one reviewer's nits suffice** (others focus on design/correctness); and a formatter/linter that *eliminates* the most common nits before a human sees them. Batch remaining style notes into a single "minor: feel free to address or not" comment instead of scattering twenty blockers.

### Ego / showboating comments and adversarial review

**Mechanism.** Comments that perform the reviewer's cleverness ("obviously you'd use a trie here") or treat the review as a contest to win against the author. **Root cause.** Review framed as *the author vs the reviewer* rather than *both vs the defect*, often amplified by a culture that rewards looking smart over shipping. **Systemic fix.** **Explicit norms** — comment on the code, never the coder; assume competence; ask rather than accuse — backed by leaders who model them and call out violations privately. Attention belongs on the change and on helping the author, not on the reviewer's standing. Norms only stick when they're written down and enforced by example, not left implicit.

### Design feedback too late

**Mechanism.** The author finishes a 1,500-line implementation; the reviewer responds "I don't think we should take this approach at all." Days of work die. **Root cause.** The first time anyone saw the *approach* was on a *finished PR*. The design decision and the review of it happened in the wrong order. **Systemic fix.** **Shift design review left** ([Correctness & Design Review](../03-correctness-and-design-review/middle.md)): agree the approach via a design doc, an RFC, or a small spike *before* the big implementation. Code review then checks execution, not whether the whole direction was a mistake. The cheapest place to reject an approach is before it's built.

### The inconsistent reviewer

**Mechanism.** The same reviewer blocks an unrelated PR on missing tests on Monday, then waves through an untested change on Thursday. Authors can't predict the bar. **Root cause.** No shared, written standard, so each review reflects the reviewer's mood, energy, and how much they like the author that day. **Systemic fix.** **Calibration**: a written review checklist/standard, periodic sessions where reviewers review the *same* PR and compare notes, and a style guide that pins the non-negotiables. A predictable bar is more valuable than a perfect-but-random one — authors can only meet a target they can see.

### The ghost / slow reviewer

**Mechanism.** A review request sits for days; the author context-switches away, the branch drifts, the work stalls. **Root cause.** *No SLA and no clear ownership* — review is everyone's optional side-task, so it loses every priority contest against "real work." **Systemic fix.** **Review SLAs** (e.g. first response within one business day), **auto-assignment** via `CODEOWNERS` or round-robin so requests have a name attached, and **team tempo norms** that treat reviewing as first-class work, not an interruption ([07](../07-review-metrics-and-tempo/middle.md)). Make turnaround time visible so slowness is a known signal, not an invisible default.

---

## Core Concept 3 — Author-Side Anti-patterns

Anti-patterns are not only a reviewer disease. Authors create many of the conditions that produce reviewer anti-patterns — a giant PR *manufactures* rubber-stamping. Same structure: **mechanism → root cause → systemic fix.**

### The giant PR

**Mechanism.** A 2,000-line, multi-concern PR lands. It's unreadable, so it gets skimmed and rubber-stamped. **Root cause.** No size guidance, work batched up "to land it all at once," or a feature never decomposed into shippable slices. **Systemic fix.** A **team size norm** (e.g. aim under ~400 lines), **incremental PRs / stacked diffs** that ship a feature as a reviewable sequence, and a culture of decomposition ([02 — PR Scope & Size](../02-pr-scope-and-size/middle.md)). The single highest-leverage lever in this entire catalog: small PRs structurally prevent rubber-stamping, late design feedback, and pile-ons at once.

### The no-context PR

**Mechanism.** A PR opens with an empty description (or just `fix`). The reviewer has to reverse-engineer the *why* from the diff. **Root cause.** No description template and no expectation that authors explain intent — the author already has the context in their head and forgets the reviewer doesn't. **Systemic fix.** A **PR template** that prompts for *what changed, why, and how it was tested*, plus the norm that an empty description is a reason to send it back. Context is the author's cheapest gift to the reviewer and the largest single boost to review quality.

### The defensive author

**Mechanism.** Every comment gets an argument; the reviewer spends more energy litigating than reviewing, and eventually gives up and approves to escape. **Root cause.** Feedback experienced as a personal attack, ego invested in the first draft, or unclear norms about who decides. **Systemic fix.** The **receiving-feedback discipline** — assume good intent, separate self from code, disagree-and-commit on preferences, reserve push-back for substance ([05](../05-feedback-giving-and-receiving/middle.md)) — plus a tie-break rule (escalate to a third reviewer or the style guide) so debates *terminate*. Decision rights, written down, end the war of attrition.

### Pushing back on everything / never self-reviewing

**Mechanism.** The author treats reviewers as their personal QA — submits without reading their own diff, then resists every fix. **Root cause.** No self-review habit and an implicit belief that catching problems is the reviewer's job, not the author's. **Systemic fix.** Make **author self-review** an explicit step (read your own diff in the PR UI before requesting review) and let CI catch the mechanical issues so humans never see them. An author who self-reviews first is the cheapest reviewer the change will ever get, and they remove the noise that breeds reviewer fatigue.

> **Key insight:** Reviewer and author anti-patterns are coupled, not independent. A giant, context-free PR *produces* the rubber-stamp and the late design feedback. A defensive author *produces* reviewer burnout and escape-hatch approvals. Fix the author side and a chunk of the reviewer side disappears for free — which is why the cheapest leverage is almost always upstream, at how the PR is shaped before anyone reviews it.

---

## Core Concept 4 — Systemic & Cultural Anti-patterns

These live in the team, not in any one person — and they're the most dangerous because they're invisible from inside.

### Review theatre

**Mechanism.** Every PR gets an approval; defects sail through anyway. The review *ritual* runs flawlessly and catches nothing. **Root cause.** The review exists to satisfy a *process or compliance* requirement ("two approvals required by policy"), not to improve code. People optimize for the green check, not the catch. **Systemic fix.** Tie review to **outcomes, not the ritual** — and make the [Quality Gates](../../quality-gates/) carry the weight they can: tests, coverage, and static analysis as *automated* gates so the human review is freed to do the thing only humans can (design, intent, subtle correctness). If approvals are required, make them *mean* something by sampling whether reviews actually catch defects, not by counting that they happened.

> **Key insight:** The deadliest anti-pattern is the one that produces a green check while catching nothing, because it manufactures *false confidence*. A team with no review at least knows it has no safety net; a team with review theatre believes it's protected while shipping the same defects. Measure whether review *catches* things ([07](../07-review-metrics-and-tempo/middle.md)) — escaped-defect rate, not approval count — or you're measuring the ritual, not the result.

### Gatekeeping / power-tripping

**Mechanism.** A reviewer uses the approval gate as personal power — withholding approval to assert dominance, demanding their preferences as the price of merge. **Root cause.** Approval power concentrated with no accountability and no appeal path; the blocker pays no cost for blocking. **Systemic fix.** Distribute review authority, install an **escalation/appeal path** (a second reviewer can break a tie), and anchor decisions in the **written style guide** so "because I said so" isn't a valid block. Authority without accountability reliably corrupts; the fix is to add the missing accountability and the missing exit.

### The bottleneck reviewer (bus factor)

**Mechanism.** One person reviews everything in an area; when they're on leave, the area freezes; their judgment is a single point of failure. **Root cause.** Knowledge and review authority concentrated in one head — no deliberate spreading. **Systemic fix.** **Spread the load deliberately** — `CODEOWNERS` with multiple owners per area, pairing juniors with the expert to grow more reviewers, rotation. A healthy review system has *redundancy*; a bus factor of one is an operational risk, not a sign of a strong reviewer.

### Gamified metrics driving bad behaviour

**Mechanism.** The team tracks "comments per review" or "PRs approved per week" on a dashboard. Reviewers manufacture comments to hit the number; approvers race to inflate their count. **Root cause.** **Goodhart's law** — the moment a proxy becomes a target, people optimize the proxy and abandon the goal. Counting comments rewards *noise*; counting approvals rewards *rubber-stamping*. **Systemic fix.** Measure **flow and outcomes, not activity** ([07](../07-review-metrics-and-tempo/middle.md)): time-to-first-review, time-to-merge, escaped-defect rate — used to find *system* bottlenecks, never to rank individuals. The instant a review metric becomes a personal performance target, it stops measuring quality and starts manufacturing the anti-pattern it was meant to detect.

---

## Core Concept 5 — Root Cause → Systemic Fix

The whole catalog, compressed into the table that earns the page. Read it as: *find the symptom, fix the cause — the cause is almost never "the person."*

| Anti-pattern | Root cause | Systemic fix (not exhortation) |
|---|---|---|
| Bikeshedding | Trivia is easy to opine on | Auto-format + lint → style is un-reviewable |
| Rubber-stamping | Overload + big PR + no accountability | Cap load, cap PR size, "you approve it, you own it" |
| Preference-blocking | Taste confused with correctness | Fact-vs-preference rule; style guide; approve-if-reasonable |
| Nitpick pile-on | No severity, no ownership boundary | Severity labels; one reviewer's nits suffice; linter |
| Ego / adversarial | Author-vs-reviewer framing | Written norms; comment on code not coder; model it |
| Late design feedback | Approach first seen on finished PR | Shift design review left (RFC/doc before build) |
| Inconsistent bar | No written standard | Calibration sessions + checklist + style guide |
| Ghost / slow reviewer | No SLA, no ownership | Review SLA + auto-assignment + tempo norms |
| Giant PR | No size norm, batched work | Size limit + stacked/incremental PRs |
| No-context PR | No template, intent unstated | PR template (what/why/how-tested) |
| Defensive author | Feedback felt as attack; no tie-break | Receiving-feedback norms + escalation rule |
| No self-review | "Reviewer is my QA" belief | Mandatory author self-review + CI for mechanics |
| Review theatre | Review for compliance, not quality | Automated quality gates; measure catches, not approvals |
| Gatekeeping | Power without accountability | Distributed authority + appeal path + style guide |
| Bottleneck reviewer | Knowledge concentrated | CODEOWNERS redundancy + pairing + rotation |
| Gamified metrics | Goodhart on activity counts | Measure flow/outcomes; never rank individuals |

> **Key insight:** Read the right-hand column top to bottom and the same five levers repeat: **automate the trivial, shrink the unit, cap the load, write the norm, fix the metric.** That's the entire defence. You are not trying to produce twenty different virtuous behaviours by force of will; you are pulling five structural levers that make the virtuous behaviour the easy one.

---

## Real-World Examples

**The bikeshed that wrote itself out of existence.** A team's reviews were 70% formatting comments and endless `tabs vs spaces` threads. They added Prettier to a pre-commit hook and CI. Within a week, formatting comments dropped to *zero* — not because reviewers grew discipline, but because there was nothing left to comment on; the formatter had already decided. Attention reallocated to logic. The fix was deleting the category, exactly as the law of triviality predicts: remove the trivial-but-opine-able item and the energy goes to the reactor.

```diff
- "your formatting is fine!" ... 14 comments on brace style, import order, spacing
+ CI: prettier --check  (fails build on any deviation)
+ Reviewers now comment only on what a machine cannot decide: logic, design, naming intent
```

**The rubber-stamp that owned an outage.** A senior with a dozen pending reviews LGTM'd a 1,100-line PR in four minutes; a null-deref slipped through and paged the team at 2am. The retro's instinct was "review more carefully." The actual fix was structural: a soft 400-line PR norm, a cap on concurrent review assignments, and a new rule — the approver joins the author in every incident review for code they signed off. Skim-approving stopped being free. Notice the lever wasn't a lecture; it was load + size + accountability.

**The metric that manufactured noise.** A manager put "average comments per review" on a dashboard to "encourage thorough reviews." Within a sprint, reviews filled with empty nitpicks (`consider renaming x to y`) as reviewers gamed the number, and authors drowned. They killed the metric and switched to team-level time-to-first-review and escaped-defect rate, never attributed to individuals. Goodhart in miniature: the proxy became a target and instantly stopped measuring quality.

**The bus factor that froze a service.** All payments-service reviews routed to one expert. She took two weeks of leave; the team's payments work stalled because nobody else felt authorized to approve. The fix was deliberate redundancy — three `CODEOWNERS`, plus pairing two mid-level engineers with her on reviews for a month to transfer judgment. Within a quarter the bus factor was three, and turnaround actually *improved* because the queue had more than one server.

---

## Mental Models

- **Anti-patterns are symptoms; root causes are the disease.** Treating the symptom ("stop bikeshedding") is like taking aspirin for an infection — the fever drops until the next busy week. Cure the cause (automate style) and the symptom can't recur because the conditions that produced it are gone.

- **Make the good path the lazy path.** Humans take the path of least resistance under load — always. Don't fight that; *re-grade the terrain* so the easy path is the right one. A formatter makes "consistent style" easier than inconsistent. A 400-line cap makes "reviewable PR" easier than a giant one. Design the slope, not the willpower.

- **The bike shed and the reactor.** Attention flows to where opinions are cheap, not to where stakes are high. If style is reviewable, it *will* absorb the attention the architecture needed. Remove the bike shed (automate the trivial) and the energy has nowhere to go but the reactor.

- **Coupled failures, upstream leverage.** Reviewer and author anti-patterns reinforce each other; the giant PR causes the rubber-stamp. So the cheapest intervention is usually the furthest upstream — shape the PR (small, with context) and a cluster of downstream pathologies never gets the chance to form.

- **A green check is not a catch.** An approval proves the ritual ran, not that a defect was caught. Confusing the two is how review theatre survives. Always ask "is this review *catching* anything?" — measured by what escapes, not by how many approvals were stamped.

---

## Common Mistakes

1. **Prescribing exhortation for a structural problem.** "Let's all review more carefully / nitpick less / respond faster" feels like a fix and changes nothing, because it leaves the root cause (overload, big PRs, no SLA) untouched. If your remedy is a feeling, not a change to tooling/process/scope/norms, it will fail by next sprint.

2. **Automating nothing, then blaming reviewers for bikeshedding.** If your CI doesn't format and lint, you have *built a bike shed* and then you're surprised people paint it. Style debates are a tooling gap, not a discipline gap.

3. **Letting PR size float and expecting careful review.** You cannot have both giant PRs and non-rubber-stamped reviews; the throughput math forbids it. Capping size is upstream of half this catalog.

4. **Gamifying any review metric at the individual level.** The instant "comments" or "approvals" becomes a personal target, Goodhart guarantees the metric is gamed and the behaviour worsens. Measure flow at the *team* level to find bottlenecks; never rank people by review activity.

5. **Mistaking review theatre for safety.** A 100% approval rate that catches nothing is *more* dangerous than no review, because it manufactures false confidence. Audit whether reviews actually catch defects; don't trust the green checks.

6. **Tolerating a bus factor of one because the reviewer is excellent.** A single irreplaceable reviewer is an operational risk no matter how good they are. Redundancy (CODEOWNERS, pairing, rotation) is the fix; "they're really good" is not a continuity plan.

7. **Reviewing the approach on a finished PR.** Rejecting the whole design after 1,500 lines are written wastes the work and breeds defensive authors. Move the design decision *before* the implementation; code review is for execution.

---

## Test Yourself

1. A reviewer leaves twelve formatting comments and one vague note on the logic. Name the anti-pattern, its root cause, and the fix that *removes the category* rather than asking the reviewer to ignore it.
2. Why is "read PRs more carefully" not a real fix for rubber-stamping? What three structural levers actually address it?
3. Distinguish *blocking on a preference* from *blocking on a fact*. What rule lets a reviewer voice a preference without gating the merge on it?
4. A manager adds "comments per review" to a dashboard and review quality drops. Which law explains this, and what should be measured instead?
5. Your team has 100% approval rate and a steady stream of escaped defects. What's the anti-pattern, why is it *more* dangerous than no review, and how do you detect it?
6. Give the five structural levers that, between them, address almost every anti-pattern in this catalog.

<details>
<summary>Answers</summary>

1. **Bikeshedding** (Parkinson's law of triviality). Root cause: trivial things are the easiest to have opinions on, so attention flows there. Fix: run an **auto-formatter + linter** in CI so style is *un-reviewable* — there's nothing left to comment on. You delete the category rather than asking for restraint.

2. Because it asks individuals to repeatedly beat a system that rewards skimming. Rubber-stamping is a throughput equation: overload + big PR + no accountability. The three levers are **cap reviewer load**, **cap PR size**, and **make approval accountable** ("you approve it, you own it").

3. A **fact** is a bug, missing test, security hole, or real maintainability problem — objectively wrong. A **preference** is "I'd write it differently" with no defect. The rule: you may *suggest* a preference (labelled `nit:`/`optional:`) but may only *block* on a fact — **"approve if it's correct and reasonable."** A written style guide settles recurring taste debates.

4. **Goodhart's law** — when a measure becomes a target it stops being a good measure; reviewers manufacture comments to hit the number. Measure **flow and outcomes at the team level** instead: time-to-first-review, time-to-merge, escaped-defect rate — to find bottlenecks, never to rank individuals.

5. **Review theatre** — approvals that catch nothing because review exists for process/compliance, not quality. It's *more* dangerous than no review because it manufactures **false confidence**: the team believes it's protected while shipping defects. Detect it by measuring whether reviews actually *catch* things (escaped-defect rate), not by counting approvals; lean on **automated quality gates** for what machines can check.

6. **Automate the trivial** (format/lint), **shrink the unit** (small PRs), **cap the load** (limit concurrent reviews + SLAs), **write the norm** (style guide, calibration, feedback norms), **fix the metric** (measure team flow/outcomes, never gamified individual counts).

</details>

---

## Cheat Sheet

```text
THE FIVE ROOT CONDITIONS (every anti-pattern maps here)
  (a) style not automated   → bikeshedding
  (b) PRs too big           → rubber-stamp, late design feedback, pile-on
  (c) reviewers overloaded  → LGTM-without-reading, ghosting
  (d) no norms/calibration  → preference-block, ego, inconsistent bar
  (e) bad metrics           → comment/approval gaming, theatre

THE FIVE LEVERS (the whole defence)
  1. AUTOMATE the trivial   format + lint  → style un-reviewable
  2. SHRINK   the unit      small/stacked PRs (~<400 LOC)
  3. CAP      the load      limit concurrent reviews + review SLA
  4. WRITE    the norm      style guide + calibration + feedback norms
  5. FIX      the metric    team flow/outcomes, never rank individuals

REVIEWER-SIDE                AUTHOR-SIDE
  bikeshedding                 giant PR        ← worst offender, fix first
  rubber-stamping              no-context PR
  preference-blocking          defensive author
  nitpick pile-on              never self-reviews
  ego / adversarial
  late design feedback        CULTURAL
  inconsistent bar             review theatre  ← deadliest (false confidence)
  ghost / slow                 gatekeeping
                               bottleneck (bus factor)
                               gamified metrics (Goodhart)

THE TEST FOR A REAL FIX
  Does it change tooling / scope / load / norms / metrics?  → real
  Is it just "try harder / be better"?                      → wish, will fail
```

---

## Summary

- Review anti-patterns are produced by the **system**, not by bad individuals; each is a rational local response to a broken incentive or a missing guardrail. So the fix is almost always **systemic**, not exhortation.
- Every anti-pattern traces to one of **five root conditions**: style not automated, PRs too big, reviewers overloaded, no norms/calibration, or bad metrics — and is removed by one of **five levers**: automate the trivial, shrink the unit, cap the load, write the norm, fix the metric.
- **Reviewer-side** (bikeshedding, rubber-stamping, preference-blocking, pile-ons, ego, late design feedback, inconsistent bar, ghosting) and **author-side** (giant PR, no-context PR, defensive author, no self-review) anti-patterns are *coupled* — a giant, context-free PR manufactures rubber-stamping — so the cheapest leverage is upstream, in how the PR is shaped.
- **Cultural** anti-patterns are the most dangerous: **review theatre** manufactures false confidence (a green check is not a catch), **gatekeeping** is power without accountability, the **bottleneck reviewer** is an operational risk, and **gamified metrics** corrode review via Goodhart's law.
- The single test for any proposed fix: does it change tooling, scope, load, norms, or metrics? If it's "be better," it's a wish and it will fail the next busy week.

---

## Further Reading

- *Software Engineering at Google* (Winters, Manshreck, Wright) — **Chapter 9, Code Review.** The reference treatment of healthy review at scale, including small-CL culture and the social dynamics behind these anti-patterns.
- Google Engineering Practices — **"Code Review Developer Guide"** (the reviewer guide and the CL-author guide). Concrete, opinionated norms that directly counter the patterns above.
- C. Northcote Parkinson — the **"law of triviality"** (bikeshedding): the original essay on why committees argue the bike shed and wave through the reactor.
- *The Tyranny of Metrics* (Jerry Z. Muller) — Goodhart's law in the wild; why gamified activity metrics corrupt the behaviour they measure.
- [senior.md](senior.md) — diagnosing anti-patterns at the org level, designing the incentive system, and measuring whether review actually catches defects.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/middle.md) — the fact-vs-preference discipline, severity labels, and receiving-feedback norms that fix the interpersonal anti-patterns.
- [02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) — small/stacked PRs, the single highest-leverage lever against rubber-stamping and late design feedback.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/middle.md) — SLAs, load management, and outcome metrics that avoid Goodhart and surface review theatre.
- [Static Analysis & Linting](../../static-analysis/) — automating style and the trivial so they become un-reviewable, killing bikeshedding at the source.
- [Quality Gates](../../quality-gates/) — automated gates that carry the mechanical load so human review is freed for what only humans can catch.
