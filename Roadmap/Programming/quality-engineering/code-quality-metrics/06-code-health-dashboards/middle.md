# Code Health Dashboards — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Health Dashboards
> *The junior page showed you a dashboard and named its widgets. This page opens the machinery underneath: how SonarQube turns a pile of issues into an A–E rating, how a quality gate decides to block your PR, and why the single sanest way to use any of these tools is to grade the diff — not the codebase.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [SonarQube's Model — Issues, Ratings, and the SQALE Debt Ratio](#sonarqubes-model--issues-ratings-and-the-sqale-debt-ratio)
4. [The Quality Gate — How a Dashboard Blocks a PR](#the-quality-gate--how-a-dashboard-blocks-a-pr)
5. [Clean as You Code — Gate the Diff, Not the History](#clean-as-you-code--gate-the-diff-not-the-history)
6. [How Other Platforms Compute Their Headline](#how-other-platforms-compute-their-headline)
7. [The Aggregation Trap — One Grade Hides the Hotspot](#the-aggregation-trap--one-grade-hides-the-hotspot)
8. [Trends Over Snapshots](#trends-over-snapshots)
9. [Wiring It Into CI — The Scanner and PR Decoration](#wiring-it-into-ci--the-scanner-and-pr-decoration)
10. [Worked Example — A Sane New-Code Gate and a SQALE Rating](#worked-example--a-sane-new-code-gate-and-a-sqale-rating)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do the major platforms turn raw metrics into one headline grade, and how do I configure a gate that actually helps?**

At the junior level a dashboard is a wall of numbers with a letter grade in the corner. That model is enough to read the screen, but it can't yet explain *where* the letter came from, *why* a project rated **A** can still contain a file that will page you at 3 a.m., or *why* a gate that demands "80% coverage on the whole repo" gets switched off within a month while a gate that demands "80% coverage on *new* code" survives for years.

The answers come from three ideas the junior page glossed over. First, a **rating is a function of a measured quantity against fixed thresholds** — most importantly SonarQube's **SQALE technical-debt ratio**, which is `remediation cost ÷ rebuild cost`, mapped to an A–E letter. Second, a **quality gate is a boolean** evaluated over conditions, and the only durable version of it scopes those conditions to the **new code** in the change. Third, **aggregation lies by construction**: collapsing a distribution of per-file numbers into one project grade is exactly the operation that buries the outlier. This page makes each concrete, with real config and the CI plumbing — `sonar-scanner`, PR decoration — that puts the gate in front of a merge button.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the headline metrics a dashboard shows (complexity, coverage, duplication, issues).
- **Required:** You understand cyclomatic complexity at the [01 middle](../01-cyclomatic-and-cognitive-complexity/middle.md) level — ratings are built on top of these primitives.
- **Helpful:** You've opened a pull request on a repo with a CI status check and seen a check go red.
- **Helpful:** A rough sense of what "technical debt" means as a cost, not just a vibe — see [Technical Debt Management](../../technical-debt-management/).

---

## SonarQube's Model — Issues, Ratings, and the SQALE Debt Ratio

SonarQube is the reference implementation of "metrics → dashboard → gate," so it's worth understanding precisely. Everything it shows is built from one primitive: the **issue**.

When the analyzer parses your code it raises issues against rules. Each issue is typed and severity-ranked, and — critically — each carries an estimated **remediation effort** (e.g. "10 min to fix"). Issues fall into a few families:

- **Bug** — code that is demonstrably wrong and will misbehave at runtime (a possible NPE, a resource never closed). Feeds the **Reliability** rating.
- **Vulnerability** — a security weakness an attacker could exploit (SQL injection, a hard-coded credential). Feeds the **Security** rating.
- **Code Smell** — code that *works* but is harder than necessary to maintain (a function that's too long, a confusing name, dead code). Feeds the **Maintainability** rating. This is the bulk of what a dashboard surfaces day to day.
- **Security Hotspot** — security-sensitive code that needs a human to *review* whether it's actually a problem; not automatically a defect.

> **Key insight:** A "code smell" in SonarQube is not a vague design opinion — it is a *concrete issue with a rule ID and a remediation-time estimate*. That estimate is what makes the whole rating system possible: once every issue has a cost in minutes, you can sum them, and a dashboard's job becomes arithmetic rather than judgement.

The **Reliability** and **Security** ratings work the simplest way: the letter is driven by the *worst* issue present, not a sum. One Blocker bug → Reliability **E**, full stop. The logic is "you cannot be reliable if there's a known catastrophic bug, no matter how clean everything else is."

| Rating | Reliability / Security (worst issue) |
|---|---|
| **A** | 0 bugs / 0 vulnerabilities |
| **B** | at least 1 Minor |
| **C** | at least 1 Major |
| **D** | at least 1 Critical |
| **E** | at least 1 Blocker |

**Maintainability** is the interesting one, because it's a *ratio*, not a worst-case. This is the **SQALE** model (Software Quality Assessment based on Lifecycle Expectations). Two quantities:

- **Remediation cost** — the sum of every code-smell's estimated fix time. SonarQube calls this the **technical debt** and reports it in days/hours.
- **Development cost** (the "rebuild cost") — what it would cost to write the code from scratch, estimated as `lines of code × a fixed cost-per-line` (default **30 minutes per line**).

The **SQALE technical-debt ratio** is simply:

```
debt ratio = remediation cost / development cost
           = (minutes to fix all smells) / (LOC × 30 min)
```

That single percentage maps to the Maintainability letter on a fixed scale:

| Maintainability rating | SQALE debt ratio |
|---|---|
| **A** | ≤ 5% |
| **B** | > 5% and ≤ 10% |
| **C** | > 10% and ≤ 20% |
| **D** | > 20% and ≤ 50% |
| **E** | > 50% |

So an **A** means "fixing all the maintainability issues would cost less than 5% of what it cost to build this in the first place." The ratio normalizes by size, which is the point — 40 hours of debt is fine in a 200-kLOC monolith and a disaster in a 2-kLOC service, and the ratio captures that automatically.

> **Key insight:** SonarQube's Maintainability grade is a *cost ratio*, not a code-goodness score. It deliberately doesn't ask "is this code beautiful" — it asks "how expensive is the known debt relative to the asset's value." That framing is its strength (it's an honest, comparable number) and its weakness (a low ratio over a huge codebase can still hide an absolute mountain of debt — see [the aggregation trap](#the-aggregation-trap--one-grade-hides-the-hotspot)).

---

## The Quality Gate — How a Dashboard Blocks a PR

A **quality gate** is a named set of **conditions**, each a threshold on a metric. After an analysis, the gate evaluates to **Passed** or **Failed** — a single boolean. That boolean is what gets wired to your CI status check; a failed gate turns the check red and (if the branch is protected) blocks the merge.

A condition is just `metric — operator — threshold`. For example:

```
Coverage on New Code           is less than   80%      → fail
Duplicated Lines on New Code    is greater than 3%      → fail
Maintainability Rating on New Code  is worse than  A    → fail
Security Hotspots Reviewed      is less than   100%     → fail
```

The gate **fails if *any* condition fails** — it's an AND of "all conditions OK." There's no weighting and no partial credit; this is deliberate, because a gate has to produce an unambiguous merge/no-merge decision and "73% of a healthy score" can't gate anything.

The mechanism that connects this to your PR is **PR decoration**: the scanner runs against the PR's branch, computes the gate, and the SonarQube/SonarCloud integration posts the result back to GitHub/GitLab/Azure DevOps as a **commit status** plus an inline summary comment listing exactly which conditions failed and on which lines. Branch protection rules then make that status *required*, so a red gate physically disables the merge button.

> **Key insight:** The gate's power isn't the metrics it measures — it's that it collapses them into one binary that a branch-protection rule can consume. A dashboard that only *shows* numbers is advisory; a gate that *blocks the merge* is policy. The entire art of dashboards-in-practice is choosing conditions strict enough to matter but scoped narrowly enough that engineers don't route around them.

---

## Clean as You Code — Gate the Diff, Not the History

Here is the single most important configuration decision, and the one teams get wrong most often. You have a five-year-old codebase. Its overall coverage is 41% and it has 200 days of accumulated debt. If your gate says "fail under 80% overall coverage," **every PR fails on day one**, including a one-line typo fix that touches nothing. The debt is too large to ever climb out of in a single PR, so the gate becomes noise, then gets disabled, and you're back to no gate at all.

SonarSource's answer is **Clean as You Code**: the gate's conditions are scoped to **new code** — the lines added or changed in this PR (or since a chosen baseline) — and ignore the legacy ocean entirely. The bet is simple and correct: if every change is clean, the proportion of clean code rises monotonically over time *as a side effect of normal work*, with no doomed "fix everything" project.

Concretely, almost every condition in a healthy gate is a `*_on_new_code` metric:

| Overall metric (the trap) | New-code metric (the fix) |
|---|---|
| `coverage` | `new_coverage` |
| `duplicated_lines_density` | `new_duplicated_lines_density` |
| `reliability_rating` | `new_reliability_rating` |
| `sqale_rating` (maintainability) | `new_maintainability_rating` |
| `security_hotspots_reviewed` | `new_security_hotspots_reviewed` |

The "new code" period is defined by a **New Code Definition** — typically *"reference branch"* (everything different from `main`) for PR analysis, or *"previous version"* / *"number of days"* for the long-lived branch. SonarQube uses the SCM blame data to attribute each line to a commit and decide whether it counts as new.

> **Key insight:** Clean as You Code converts an unwinnable absolute target into a winnable marginal one. You are never asked to fix the past — only to not *add* to it. This is why a new-code gate survives in a real org and a whole-repo gate doesn't: it's the difference between "achieve 80% coverage" (impossible this sprint) and "don't merge new untested code" (entirely reasonable for one PR).

This is the same philosophy as the *Boy Scout Rule* — leave the code cleaner than you found it — but mechanized into a gate so it doesn't depend on discipline. It pairs naturally with churn-based thinking ([04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/middle.md)): the code you're changing *now* is, by definition, the code that's churning, which is exactly where quality investment pays off most.

---

## How Other Platforms Compute Their Headline

SonarQube isn't the only model, and the others make different bets worth knowing.

**Code Climate** leads with a **Maintainability** grade (A–F) and a **technical-debt ratio** in the same SQALE spirit — remediation time over an estimated implementation time — surfaced per file and rolled up to the repo. Its more distinctive idea is the **churn-vs-complexity quadrant**: it plots every file with *complexity* on one axis and *churn* (how often it changes) on the other. The top-right quadrant — high complexity **and** high churn — is where it tells you to look first, because that's where hard-to-change code keeps being changed. (This is the same hotspot insight as [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/middle.md), promoted to the headline view.)

**CodeScene** goes furthest from "static snapshot." Its headline is a **Code Health** score (roughly 1–10) computed from *behavioral* data — it mines your version-control history and fuses **churn + complexity + a battery of code-smell detectors** to find the files that are both deteriorating and actively worked on. Its premise (Adam Tornhill's *Your Code as a Crime Scene*) is that **history predicts risk better than any single static measurement**: a gnarly file nobody touches is cheap; a gnarly file five people edit weekly is a fire. It also models **knowledge distribution** (bus-factor) and inter-file *change coupling* — things a pure AST analyzer cannot see.

| Platform | Headline metric | Computed from |
|---|---|---|
| **SonarQube** | A–E ratings + SQALE debt ratio | Issues (rule violations) with remediation cost; coverage; duplication |
| **Code Climate** | Maintainability grade (A–F) + debt ratio | Static smells + a churn×complexity quadrant |
| **CodeScene** | Code Health (1–10) | VCS history: churn + complexity + smells + change coupling |

> **Key insight:** The three platforms disagree on a deep question — *is code quality a property of the code, or of how the code is being treated over time?* SonarQube measures the code as it sits; CodeScene measures the code's *behavior in history*. Neither is wrong, but if you only ever look at the static snapshot you are blind to the single best defect predictor there is — change history.

---

## The Aggregation Trap — One Grade Hides the Hotspot

Every dashboard's headline is the result of **rolling up per-file (or per-function) metrics into one project number** — averaging, summing, or worst-casing across hundreds of files. That roll-up is genuinely useful for tracking direction, and genuinely treacherous as a measure of *risk*, because a single number throws away the **distribution**.

Consider two services, each rated Maintainability **A** because each has an overall SQALE debt ratio of 4%:

- **Service X:** debt spread evenly — every file sits around 4%. Uniformly fine.
- **Service Y:** 99 pristine files at ~1%, and one 3,000-line `PaymentProcessor` at 60% debt that handles all the money. Averaged over the codebase, the ratio is still ~4% — so the headline is still **A**.

Service Y's grade is technically honest and operationally a lie. The one file that will actually hurt you is invisible in the aggregate; the 99 boring files *dilute* it into an A. This is the structural flaw in any single-grade dashboard: the metric most teams act on (the headline) is precisely the one that smooths away the outlier you most need to find.

> **Key insight:** A project grade answers "how is the codebase *on average*," but defects and incidents don't come from the average file — they come from the **tail**. Always drill from the headline into the *per-file distribution* and sort by absolute debt / complexity / churn. The A is a summary; the ranked file list is the actionable artifact. Treating the grade as the answer is how an "A-rated" repo ships a catastrophic file.

The practical defense is **risk-weighting**: don't rank files by their metric alone, rank them by `metric × exposure`, where exposure is churn, traffic, or blast radius. A 60%-debt file nobody calls is a footnote; a 60%-debt file on the payment path is the top of the backlog. This is exactly why CodeScene's history-aware ranking and Code Climate's churn quadrant exist — they re-introduce the distribution and the exposure that the headline grade discards.

---

## Trends Over Snapshots

A single snapshot — "Maintainability: B" — tells you almost nothing actionable, because you can't tell whether B is a codebase climbing out of a hole or sliding into one. The **trend** is the signal.

This is why mature dashboards foreground time series: debt over the last 90 days, new-code coverage per release, the count of open issues week over week. A rising debt curve on a project rated **A** is a more urgent finding than a flat curve on a project rated **C** — the absolute grade is lagging, the slope is leading.

It also reframes the new-code gate. The gate enforces the *derivative* — "the change you're making right now is clean" — and the trend visualizes the *integral* of all those gated changes — the slow, compounding improvement in the proportion of healthy code. A green gate on every PR is what *produces* a downward-sloping debt trend; the two views are the same policy seen as rate-of-change and as accumulation.

> **Key insight:** Grade the slope, not the snapshot. An absolute rating tells you where you are; the trend tells you where you're going, and "going" is the only thing you can still change. A dashboard used for snapshots becomes a scoreboard; a dashboard used for trends becomes a control system.

---

## Wiring It Into CI — The Scanner and PR Decoration

A dashboard is worthless if the analysis only runs when someone remembers to click it. The point is to make it automatic and to put the gate *in the PR*.

The analyzer is the **scanner** — `sonar-scanner` for generic projects, or a build-integrated variant (the Maven/Gradle plugin, `dotnet-sonarscanner`). It reads a small config file, analyzes the code, uploads the results to the SonarQube/SonarCloud server, and — for PR analysis — fails the CI step if the gate fails.

```properties
# sonar-project.properties — committed at the repo root
sonar.projectKey=acme_payments
sonar.sources=src
sonar.tests=test
sonar.javascript.lcov.reportPaths=coverage/lcov.info   # coverage from YOUR test run
sonar.qualitygate.wait=true                            # block CI until the gate verdict returns
```

Two details carry most of the value:

1. **The scanner does not run your tests.** Coverage is computed by *your* test runner, written to a report (LCOV, JaCoCo, Cobertura), and merely *ingested* by the scanner via `sonar.*.reportPaths`. If that path is wrong, coverage reads as 0% and your new-code coverage gate fails for a reason that has nothing to do with the code. This is the single most common setup bug.
2. **`sonar.qualitygate.wait=true`** makes the CI step *block* on the gate result instead of firing and forgetting. Without it the scanner uploads and exits green, and your "gate" never actually gates anything — the merge proceeds before the verdict is even computed.

For pull requests, the CI runs the scanner in **PR mode** (it passes the PR key, base, and branch). The server computes the *new-code* gate for just that diff and **decorates** the PR: a required commit status (red/green) plus an inline comment naming the failed conditions and the offending lines. Branch protection makes that status required, so the loop is: *push → CI runs scanner → server computes new-code gate → status posted → merge button enabled only if green.* That is the whole "dashboard blocks a PR" story, end to end.

---

## Worked Example — A Sane New-Code Gate and a SQALE Rating

**Part 1 — design a gate for a five-year-old repo.** You want quality to improve without failing every PR on legacy debt. So scope *everything* to new code and keep conditions few and unambiguous:

```
Quality Gate: "Clean as You Code"  (applied on New Code)

  New Coverage                         <  80%   → FAIL
  New Duplicated Lines (%)             >  3%    → FAIL
  New Maintainability Rating           worse than A   → FAIL   (new smells must be cheap)
  New Reliability Rating               worse than A   → FAIL   (no new bugs)
  New Security Rating                  worse than A   → FAIL   (no new vulnerabilities)
  New Security Hotspots Reviewed       <  100%  → FAIL
```

Read it as a sentence: *"You may merge as long as the code you added is 80%-tested, near-duplicate-free, and introduces no bug, no vulnerability, and no expensive smell."* It says **nothing** about the 41% legacy coverage or the 200 days of old debt — those are out of scope by design, so a one-line typo fix sails through and a sloppy new feature is blocked. That asymmetry is the whole point.

**Part 2 — compute a Maintainability rating from SQALE.** A service has **12,000 lines** of code. SonarQube estimates **18 hours** of remediation effort (the sum of all code-smell fix-times = the technical debt).

```
development cost = 12,000 LOC × 30 min/LOC = 360,000 min = 6,000 hours
remediation cost = 18 hours = 1,080 min

debt ratio = 1,080 / 360,000 = 0.003 = 0.3%
```

0.3% is well under the 5% threshold → **Maintainability A**. Now suppose a rewrite bloats the same logic to **3,000 lines** of tangled code carrying **40 hours** of debt:

```
development cost = 3,000 × 30 min = 90,000 min = 1,500 hours
remediation cost = 40 hours = 2,400 min

debt ratio = 2,400 / 90,000 = 0.0267 = 2.67%  → still A?!
```

Smaller *and* worse, yet still an **A**, because the ratio normalizes by size and 40 hours over 1,500 is under 5%. This is the aggregation trap in miniature: the rating is mathematically correct and operationally misleading. The fix is to *not stop at the grade* — drill into the file list, find the file carrying most of that 40 hours, and risk-weight it by churn. The grade told you "fine on average"; the ranked list tells you which file to open.

---

## Mental Models

- **A rating is a thermometer, not a thermostat.** It *reports* a measured quantity against fixed thresholds (debt ratio → letter); it doesn't decide anything. The quality *gate* is the thermostat — the boolean that actually acts on the world by blocking a merge.

- **The SQALE ratio is "repair bill ÷ replacement value."** Debt in minutes over the cost to rebuild from scratch. A 4% ratio means repairs cost 4% of the asset's value. It's an insurance-adjuster's number, deliberately blind to whether the code is *pretty* — only to what fixing it costs relative to what it's worth.

- **Clean as You Code grades the derivative.** Don't gate the absolute state of a legacy codebase (unwinnable); gate the *change* you're adding right now (winnable every time). The codebase improves as the integral of many clean diffs — no heroic cleanup project required.

- **One grade is a mean; incidents live in the tail.** Rolling per-file metrics into a project letter is exactly the operation that hides the one catastrophic file behind ninety-nine fine ones. The headline is for direction; the ranked, risk-weighted file list is for action.

- **History beats the snapshot.** A static rating sees the code as it sits. Churn-aware tools (CodeScene, Code Climate's quadrant) see how it's *treated over time* — and a file's change history predicts its defects better than any single static metric.

---

## Common Mistakes

1. **Gating on whole-repo metrics for a legacy codebase.** "Fail under 80% overall coverage" fails every PR on day one because the legacy debt is too deep to climb out of per-PR. The gate becomes noise and gets disabled. Scope conditions to **new code** instead.

2. **Trusting the headline grade and stopping there.** An **A** can hide one 60%-debt file on the payment path — the average dilutes it. The grade is a summary; always drill into the per-file distribution and sort by absolute risk.

3. **Forgetting the scanner doesn't run your tests.** Coverage comes from *your* test runner's report (LCOV/JaCoCo); the scanner only ingests it via `reportPaths`. A wrong path reads as 0% coverage and fails the gate for a non-reason. This is the #1 setup bug.

4. **Omitting `sonar.qualitygate.wait=true`.** Without it the CI step uploads and exits green before the gate verdict exists — the "gate" never blocks anything. The merge proceeds regardless of the result.

5. **Reading a snapshot instead of a trend.** "Maintainability B" is meaningless without slope. A rising-debt **A** is more urgent than a flat **C**. Grade the direction, not the still frame.

6. **Treating the dashboard as a target.** The moment a team's bonus depends on "raise the grade," people game the metric (suppress rules, exclude files, chase the number) instead of improving the code — Goodhart's law in action. The gate should enforce a *floor on new code*, not a *score to maximize*.

---

## Test Yourself

1. Write out the SQALE technical-debt ratio formula and explain what each side represents.
2. A project has 8,000 LOC and 12 hours of estimated remediation effort. Using the default 30 min/LOC, compute the debt ratio and give the Maintainability rating.
3. Why does a quality gate scoped to *new code* survive in a real org while a whole-repo gate gets disabled?
4. A repo is rated Maintainability **A** but its single payment file is a 3,000-line tangle. How is the A possible, and what should you do about it?
5. Your new-code coverage gate fails at 0% even though you have tests that pass. What's the most likely cause?
6. SonarQube and CodeScene can disagree about which file is riskiest. What fundamental difference in *what they measure* explains this?

<details>
<summary>Answers</summary>

1. `debt ratio = remediation cost / development cost`. Remediation cost = the summed estimated minutes to fix all code smells (the "technical debt"). Development cost = the estimated cost to rebuild the code from scratch, `LOC × 30 min` by default. It's "repair bill ÷ replacement value."
2. `development cost = 8,000 × 30 = 240,000 min`; `remediation = 12 h = 720 min`; `ratio = 720/240,000 = 0.003 = 0.3%`. Under 5% → **Maintainability A**.
3. A whole-repo gate demands fixing accumulated legacy debt that's too large to address per-PR, so every PR fails and the gate is switched off. A new-code gate asks only that *this change* is clean — winnable on every PR — and the codebase improves as the sum of clean diffs. It converts an unwinnable absolute target into a winnable marginal one.
4. The rating is an *average* (the SQALE ratio over the whole codebase), so 99 clean files dilute the one terrible file under the 5% threshold. The fix: don't stop at the grade — drill into the per-file list, find the file carrying most of the debt, and risk-weight by churn/exposure. The grade is direction; the ranked list is action.
5. The scanner doesn't run your tests — it ingests a coverage *report* your test runner produced. A wrong or missing `sonar.*.reportPaths` (or a report never generated in CI) makes coverage read as 0%, failing the new-code coverage condition for a reason unrelated to the code.
6. SonarQube measures the code as it *currently sits* (static issues/ratings). CodeScene measures the code's *behavior over version-control history* (churn + complexity + change coupling). A gnarly-but-untouched file looks risky to a static tool and cheap to a history-aware one — because history (how often code changes) is a better defect predictor than a static snapshot.

</details>

---

## Cheat Sheet

```
SONARQUBE ISSUE → RATING
  Bug          → Reliability rating   (worst issue: 1 Blocker = E)
  Vulnerability→ Security rating      (worst issue: 1 Blocker = E)
  Code Smell   → Maintainability      (SQALE debt RATIO, not worst-case)
  Hotspot      → needs human review; not auto a defect

SQALE DEBT RATIO  = remediation cost / development cost
                  = (Σ smell fix-minutes) / (LOC × 30 min)
  A ≤5%   B ≤10%   C ≤20%   D ≤50%   E >50%

QUALITY GATE = AND of conditions (metric op threshold) → Passed/Failed
  fails if ANY condition fails → red CI status → blocks protected merge

CLEAN AS YOU CODE — scope every condition to NEW code
  new_coverage          ≥ 80%
  new_duplicated_lines  ≤ 3%
  new_maintainability_rating  = A
  new_reliability_rating      = A
  new_security_rating         = A
  new_security_hotspots_reviewed = 100%

CI WIRING
  sonar-scanner reads sonar-project.properties
  coverage = YOUR test runner's report (LCOV/JaCoCo) via *.reportPaths
  sonar.qualitygate.wait=true   ← or the gate never blocks
  PR mode → server computes new-code gate → decorates PR + commit status

TRAPS
  whole-repo gate on legacy → fails everything → gets disabled
  headline grade hides the tail → drill into per-file distribution
  snapshot ≠ trend → grade the slope
  dashboard as target → Goodhart → people game the number
```

---

## Summary

- SonarQube builds everything from the **issue** — a rule violation with a *remediation-time estimate*. Bugs drive the **Reliability** rating, vulnerabilities the **Security** rating (both **worst-issue**: one Blocker = E), and code smells the **Maintainability** rating.
- Maintainability is the **SQALE technical-debt ratio** = `remediation cost ÷ development cost` = `(minutes to fix all smells) ÷ (LOC × 30 min)`, mapped to A–E on fixed thresholds (≤5% = A). It's a *cost ratio*, deliberately blind to aesthetics.
- A **quality gate** is an AND of conditions that evaluates to one boolean; failing it turns a CI status red and blocks a protected merge. Its power is collapsing metrics into something a branch-protection rule can consume.
- **Clean as You Code** scopes every condition to **new code**, converting an unwinnable absolute target ("fix the legacy") into a winnable marginal one ("don't add new debt"). This is why new-code gates survive and whole-repo gates get disabled.
- Other platforms make different bets: **Code Climate** adds a churn×complexity quadrant; **CodeScene** scores **Code Health** from *version-control history* (churn + complexity + coupling), on the premise that history predicts risk better than a static snapshot.
- Every headline grade is an **aggregation** that hides the distribution — an **A** can mask one catastrophic file. Drill into the per-file list, **risk-weight by churn/exposure**, and watch **trends over snapshots** — grade the slope, never the still frame, and never let the dashboard become the target.

---

## Further Reading

- *Your Code as a Crime Scene* and *Software Design X-Rays* — Adam Tornhill. The behavioral-analysis foundation behind CodeScene: churn + complexity as a defect predictor.
- **SonarQube docs — Clean as You Code** and **Quality Gates / Metric Definitions** — the authoritative description of new-code conditions, the SQALE model, and the rating thresholds.
- *The SQALE Method for Managing Technical Debt* — Jean-Louis Letouzey. The original model SonarQube's debt ratio implements.
- **Code Climate docs — Maintainability and the Churn vs. Quality quadrant** — how a second major platform computes and presents its grade.

---

## Related Topics

- [02 — Maintainability Index](../02-maintainability-index/middle.md) — the composite index dashboards often graph alongside the SQALE rating, and why composite scores are seductive and weak.
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/middle.md) — the history/churn signal that risk-weighting and CodeScene's Code Health are built on.
- [Code Coverage](../../code-coverage/) — the new-code coverage number a gate enforces, computed by your test runner and ingested by the scanner.
- [Quality Gates](../../quality-gates/) — the gate concept generalized beyond a single dashboard into a CI/CD policy layer.
- [junior.md](junior.md) — reading the dashboard and naming its widgets, before this page opened the machinery.
- [senior.md](senior.md) — designing org-wide gate policy, custom rules, and rolling dashboards across hundreds of repos without them becoming targets.
