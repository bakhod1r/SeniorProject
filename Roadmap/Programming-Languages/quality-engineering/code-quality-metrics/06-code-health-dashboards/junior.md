# Code Health Dashboards — Junior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Health Dashboards
> *A dashboard takes a dozen quality metrics, paints them green and red, and stamps a letter on your project. The skill that separates juniors from seniors is not reading the letter — it's knowing that the letter is a place to start looking, never a verdict on whether you're done.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Dashboard Aggregates](#core-concept-1--what-a-dashboard-aggregates)
5. [Core Concept 2 — The Quality Gate: Pass / Fail](#core-concept-2--the-quality-gate-pass--fail)
6. [Core Concept 3 — The Rating Letters (A–E)](#core-concept-3--the-rating-letters-ae)
7. [Core Concept 4 — Drilling: Red Panel → File → Fix](#core-concept-4--drilling-red-panel--file--fix)
8. [Core Concept 5 — The Caution: A Dashboard Is Not a Report Card](#core-concept-5--the-caution-a-dashboard-is-not-a-report-card)
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

> Focus: **What is a code-health dashboard, and how do you read one without being fooled?**

Every metric in this roadmap so far — cyclomatic complexity, the maintainability index, coupling, churn, duplication, plus test coverage from a sibling roadmap — is a single number computed by a single tool. A **code-health dashboard** is the screen that gathers all of those numbers, runs them on every commit, and presents them in one place: a few big tiles, some letter grades, a pass/fail badge, and trend lines.

The three you'll meet most often are **SonarQube** (and its cloud sibling SonarCloud), **Code Climate**, and **CodeScene**. They differ in detail, but the shape is the same: connect it to your repository, it analyzes the code, and it shows you a project page with panels. This page is about that page — what each panel actually means, and the one habit that makes a dashboard useful instead of decorative.

Here is the trap. A dashboard gives you a satisfying summary — "Quality Gate: Passed, Maintainability: A" — and it is *very* tempting to read that as "the code is good, my job is done." It is neither of those things. The grade is computed from rules and thresholds that someone (often the tool's defaults) chose. It can be high while the code is bad, and low while the code is fine. The number's real job is to point a finger: *look over here.*

> **The mindset shift:** a dashboard tells you **where to LOOK**, it does not tell you **you're done**. A green gate means "nothing tripped the rules we configured," not "this code is excellent." A red panel means "go investigate this," not "you have failed." Read every tile as the start of an investigation, never as a final score.

This page teaches you to read a SonarQube-style project page panel by panel, to drill from a scary red number down to the exact file and line, fix one concrete thing, and — most importantly — to stay skeptical of the summary at the top.

---

## Prerequisites

- **Required:** You've met at least one of the underlying metrics — ideally [cyclomatic complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) and [the maintainability index](../02-maintainability-index/junior.md). The dashboard just displays these; if you don't know what they measure, the panels are noise.
- **Required:** You know roughly what **test coverage** means (the percentage of code your tests run). One page is enough — see [Code Coverage](../../code-coverage/).
- **Helpful:** You've seen a CI pipeline turn a pull request red or green. A dashboard's "quality gate" plugs into exactly that mechanism.
- **Helpful:** You've used a code review tool (a GitHub PR page). A dashboard often shows up *as a comment* on your PR.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Dashboard** | One screen that aggregates many quality metrics for a project, computed automatically on each commit. |
| **Quality gate** | A pass/fail check: a set of conditions the code must meet (e.g. "coverage ≥ 80% on new code"). Fail it and the build/PR is marked failing. |
| **Rating (A–E)** | A letter grade the tool assigns per category (Reliability, Security, Maintainability). A is best, E is worst. |
| **Code smell** | A maintainability issue the tool flags — not a bug, but a sign the code is harder to change than it should be. |
| **Bug** (tool sense) | An issue the tool believes is a real defect in behavior, separate from smells. |
| **Vulnerability** | A security-relevant issue (e.g. a hardcoded password pattern). |
| **Technical debt** | The tool's *estimate* of how long it would take to fix all the smells, shown as time (e.g. "3d 4h"). |
| **Technical debt ratio** | That estimated fix-time divided by the estimated time it took to write the code. The Maintainability rating is derived from this ratio. |
| **Duplication %** | The percentage of lines the tool considers copy-pasted (clones). |
| **New code** | Code added or changed since a chosen point (a date, a version, or "since previous PR"). Modern gates judge *this*, not the whole project. |

---

## Core Concept 1 — What a Dashboard Aggregates

A dashboard does not invent metrics. It **collects** the ones you already know and lays them out together. Open a SonarQube project page and the top strip is a row of tiles, each summarizing one dimension of health:

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  Reliability │   Security   │Maintainability│  Coverage    │ Duplications │
│      A       │      A       │      C        │    74.3%     │    6.1%      │
│   0 Bugs     │ 0 Vulns      │  142 Smells   │              │  88 blocks   │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
            Quality Gate:  ✗ Failed        Technical Debt: 3d 6h
```

Read it left to right:

- **Reliability** — counts **bugs** (issues the tool thinks are real defects) and gives a letter.
- **Security** — counts **vulnerabilities** and gives a letter.
- **Maintainability** — counts **code smells** and gives a letter derived from the **technical debt ratio**.
- **Coverage** — the percentage of lines exercised by tests (pulled from your test run; the dashboard displays it, it doesn't measure it).
- **Duplications** — the percentage of lines that are clones, plus a count of duplicated *blocks*. This is exactly the [duplication % from topic 05](../05-duplication-and-similarity/junior.md), surfaced here.

Each tile is a **drill-down link**. Clicking "142 Smells" doesn't show you a bigger number — it shows you the *list* of 142 specific issues, each with a file, a line, and an explanation. That is the whole point: the tile is a summary; the value is underneath it.

The key thing to internalize as a junior: **none of these numbers are new information you have to learn.** Reliability, Maintainability, Coverage, Duplications — you've met all the underlying ideas. The dashboard's contribution is *putting them in one place, on every commit, with links down to the source.* It is a *control panel*, not a *measuring instrument*.

> **Key insight:** A dashboard is an **aggregator and a router**, not a metric. It doesn't tell you anything a careful read of the individual tools wouldn't — it tells you all of it *at once*, *continuously*, with a *click-through to the exact line*. Its superpower is convenience and consistency, not accuracy. Treat the tiles as an index into your code, not as a grade.

---

## Core Concept 2 — The Quality Gate: Pass / Fail

The single most important panel is the **quality gate** — the big `Passed` / `Failed` badge. Everything else on the page is informational; the gate is the one thing that can *block a merge*.

A quality gate is just a list of **conditions**. SonarQube's recommended default gate, called **Sonar way**, is roughly:

```
Quality Gate "Sonar way"  — conditions apply to NEW CODE:
  • Coverage on new code            ≥ 80%
  • Duplicated lines on new code    ≤ 3%
  • Maintainability rating on new code   is A
  • Reliability rating on new code       is A
  • Security rating on new code          is A
  • Security hotspots reviewed           = 100%
```

If **every** condition passes, the gate is green. If **any one** fails, the whole gate is red. There's no partial credit — it's an AND of all conditions. That's deliberate: a gate is a yes/no decision a pipeline can act on.

Notice the two words doing all the heavy lifting: **new code**. This is the most important design choice in the whole tool, and the one juniors most often miss.

A real project has years of accumulated issues. If the gate judged the *entire* codebase, it would be red forever and everyone would ignore it. So modern gates judge only the code you **added or changed** in this commit / pull request. The deal is: *we won't make you fix the whole legacy mess, but don't make it worse.* New code must hit the bar; old code is reported but doesn't fail the gate. This approach is called **"Clean as You Code"** — leave each file at least as clean as you found it. It is the difference between a gate people respect and a gate people disable.

So when your PR comes back red with "Coverage on new code is 61.2% (< 80%)," that is not a judgment on the whole repo. It means: *the lines you just wrote aren't tested enough.* The fix is local and obvious — write tests for the code you just added.

> **Key insight:** A quality gate is a **policy you chose**, applied (usually) to **new code only**, as a strict **AND of conditions**. Red doesn't mean "the project is bad" — it means "this change violated a rule we agreed to." Before you panic at a red gate, read *which condition* failed; it names the exact, usually small, thing to fix. And if the gate seems wrong, remember a human configured it — gates are editable, not laws of nature.

---

## Core Concept 3 — The Rating Letters (A–E)

The letters are the most *visible* and most *misunderstood* part of the dashboard. SonarQube assigns an **A–E rating** to each of three categories. Here's what each letter actually rests on.

**Maintainability rating** is computed from the **technical debt ratio** — the estimated time to fix all the smells, divided by the estimated time it took to write the code. The thresholds are fixed:

```
Maintainability rating  (from technical debt ratio):
  A   ≤ 5%
  B   6–10%
  C   11–20%
  D   21–50%
  E   > 50%
```

So an **A** means "fixing all the maintainability issues would cost less than 5% of what it cost to build this." The "time to fix" and "time to write" are both *estimates the tool makes* by assigning a fixed remediation time to each rule (e.g. "this smell takes ~10 minutes to fix") and estimating development cost from lines of code. They are rough by construction — useful for *comparison and trend*, not as literal hours.

**Reliability** and **Security** ratings work differently: they're driven by the **single worst issue**, not a ratio.

```
Reliability rating:
  A   0 bugs
  B   at least one MINOR bug
  C   at least one MAJOR bug
  D   at least one CRITICAL bug
  E   at least one BLOCKER bug
```

This has a sharp, counter-intuitive consequence: **one** blocker-severity bug drops you straight to **E**, no matter how clean the other 200,000 lines are. The rating answers "what's the worst thing in here?", not "what's the average quality?" That's a feature — a single blocker *is* the most important fact — but it means the letter can swing from A to E because of one issue, and back to A when you fix that one issue.

> **Key insight:** The three letters measure **different things on different scales**. Maintainability is an **average-ish ratio** (lots of small smells add up). Reliability and Security are **worst-case** (one bad issue sets the grade). So "Maintainability C, Reliability E" doesn't mean the code is uniformly mediocre — it means there are many small smells *and* one serious bug. Always read the letter together with the *count and severity* underneath it; the letter alone hides which story you're in.

---

## Core Concept 4 — Drilling: Red Panel → File → Fix

This is the skill the whole page builds toward. A dashboard is worthless if you stop at the summary. Its value is unlocked only when you **drill down** from a red tile to a specific line and change something concrete. Here is the loop, step by step, on a SonarQube page.

**Step 1 — Start at the failing gate, not the scariest number.** The gate tells you *which condition* failed. Say it's: `Maintainability rating on new code is C (required: A)`. That single line tells you the category (Maintainability) and the scope (new code). Ignore the other tiles for now.

**Step 2 — Open the issues list, filtered to that category and scope.** Click through to the **Issues** view and filter to `Type: Code Smell`, `New Code`. Instead of "142 smells" you now see a sortable, clickable list:

```
src/checkout/PriceCalculator.java   L142   Cognitive Complexity is 31 (allowed 15)   ~26 min
src/checkout/PriceCalculator.java   L88    Refactor this method to reduce nesting    ~15 min
src/orders/OrderMapper.java         L40    Remove this duplicated code block         ~10 min
...
```

**Step 3 — Sort by severity or effort, and pick *one*.** Don't try to clear the list. Sort by severity (fix BLOCKER/CRITICAL first) or, if you just want a quick win, by lowest effort. Pick the top item. Say it's `PriceCalculator.java:142 — Cognitive Complexity is 31 (allowed 15)`.

**Step 4 — Click the issue. The tool shows the exact code and *why*.** SonarQube opens the file at line 142, highlights the method, and — crucially — shows **where each complexity point came from** (each `if`, each nested loop, each `&&` gets a `+1` annotation in the margin). It also links to a rule description explaining the smell and how to fix it. You are no longer looking at a metric; you're looking at *your code with the problem circled*.

**Step 5 — Fix that one thing in the code, not on the dashboard.** Reduce the nesting, extract a helper method, delete the duplicate block — whatever the issue calls for. The fix lives in your editor and your commit. (How to actually perform these changes is the subject of [Code Craft → Refactoring](../../../code-craft/refactoring/).)

**Step 6 — Push, let analysis re-run, watch *that* issue clear.** On the next analysis the count drops, the issue disappears from the list, and — if it was the last thing failing the gate — the gate flips to green. You changed one real thing; the number moved as a *consequence*.

> **Key insight:** The correct direction of travel is always **summary → list → file → line → fix**, and you fix the **code**, never the **number**. A junior stares at "Maintainability: C" and feels bad. An effective engineer clicks it, sorts the list, opens the worst file, reduces its complexity, and lets the C become a B on its own. The grade is the *last* thing you look at, not the first — and certainly not the thing you act on.

---

## Core Concept 5 — The Caution: A Dashboard Is Not a Report Card

Now the warning that matters more than any panel. A dashboard is a **starting point for investigation, not a report card** — and because it produces a single visible number, it is the single easiest quality signal in the world to **game**.

Three ways the number lies, all of which you will see in real teams:

**1. A green gate on bad code.** Every condition can pass while the code is genuinely hard to work with. The metrics only catch what their rules *look for*. They don't understand whether your abstraction makes sense, whether the names are honest, whether the design fits the problem. A file can have low complexity, zero smells, and high coverage — and still be confusing, wrongly-factored code that the *tool has no rule for*. Green means "nothing we check for tripped," not "good."

**2. Gaming the metric directly.** Because a number is a target, people optimize the *number* instead of the *code*:

- **Coverage gaming:** write tests that *execute* code but `assert` nothing. Coverage hits 90%; the tests catch zero bugs. The line is "covered" and completely unprotected.
- **Complexity gaming:** a method is "too complex," so you chop it into five tiny methods that are only ever called in sequence and have to be read together. Per-method complexity drops under the threshold; the code is now *harder* to follow, spread across five places. The metric improved; the maintainability got worse.
- **Smell suppression:** sprinkle `// NOSONAR` comments or `@SuppressWarnings` to silence the warnings without fixing anything. The count drops; the problem stays.

This is **Goodhart's Law**: *"When a measure becomes a target, it ceases to be a good measure."* The instant a dashboard number becomes something you're *graded on*, people start moving the number by the cheapest available means — which is rarely "improve the code."

**3. Defaults aren't truth.** The thresholds (complexity ≤ 15, coverage ≥ 80%, debt ratio ≤ 5% for an A) are *defaults the tool ships*, not laws. They're reasonable starting points, not measurements of your specific codebase's needs. A red panel against a default threshold is an invitation to *think*, not proof of a defect.

So what *is* the dashboard good for? Three honest uses: (a) **routing your attention** — "of 400 files, these 5 are both complex and changed a lot, look there first"; (b) **trends** — "duplication has crept from 3% to 9% over six months" is a real, useful signal even when the absolute number is debatable; and (c) **a guardrail on new code** — "don't merge code with no tests" is a fine, low-controversy rule. What it is *not* good for is being your definition of quality or your team's scoreboard.

> **Key insight:** Treat the dashboard as a **smoke detector, not a judge**. A smoke detector going off means *go look* — it doesn't tell you what's burning, and it can be silenced by taking the battery out (the equivalent of `// NOSONAR`). The number is a **diagnostic that points at risk**, and the moment it becomes a **target you're scored on**, it stops being a good diagnostic. Use it to decide *where to look*; use your own judgment to decide *whether the code is actually good*.

---

## Real-World Examples

**1. The red PR comment that took five minutes to clear.** A developer opens a pull request; SonarCloud posts a comment: *"Quality Gate failed — Coverage on new code is 54.0% (< 80%)."* The whole *project's* coverage is fine; the gate is judging only the 40 lines this PR added, and 18 of them — a new error-handling branch — have no test. The fix isn't "lower the gate" or "argue the metric is bad." It's: write one test that exercises the error branch. Push. Coverage on new code jumps to 90%, the gate flips green, the PR merges. The dashboard did exactly its job: it pointed at untested new code, and the fix was small and local.

**2. The "A-rated" file nobody could touch.** A team proudly keeps everything at Maintainability A. One module, though, takes days to change and breaks constantly — yet the dashboard says A, zero smells. Why? Its problem is *bad design* (a tangled web of implicit ordering between methods) that no SonarQube rule detects. The lesson the team learns: the green grade was real *for what it measured*, and what it measured missed the actual problem. They stop treating "A" as "safe to ignore" and start using churn-and-complexity hotspots ([topic 04](../04-code-churn-and-hotspots/junior.md)) to find the files that *hurt*, regardless of letter.

**3. The coverage target that backfired.** Management mandates "85% coverage, enforced by the gate." Coverage climbs to 86% within a sprint. A month later a trivial bug ships to production in heavily-"covered" code. Investigation finds dozens of tests that call functions and assert *nothing* — written purely to move the number past 85%. The team had optimized the *metric*, not the *testing*. They keep the gate but stop celebrating the percentage, add review for test *quality*, and treat coverage as "did we forget to test this *at all*" rather than a score — the only honest reading of the number (see [Code Coverage](../../code-coverage/)).

---

## Mental Models

- **The dashboard as a car's instrument cluster.** Speed, fuel, oil temperature, a check-engine light. The cluster doesn't *drive* and it doesn't tell you you've arrived — it tells you *where to direct attention*. A red check-engine light means "open the hood," not "the car has failed." You'd never decide your road trip was a success by staring at the dashboard; you'd look out the window.

- **The quality gate as a bouncer with a checklist.** The bouncer isn't judging whether you're a good person — just checking the specific items on the list (ID, dress code). Pass all of them, you're in; fail one, you're out. The list was written by management (your team), it's the same for everyone, and it can be rewritten. A red gate means "you missed an item on the list," not "you're unworthy."

- **The rating letter as a restaurant hygiene grade.** An "A" on the window means the kitchen passed an *inspection against fixed criteria* — not that the food is delicious. You can have an A-grade kitchen serving food you hate, and a B-grade kitchen that's wonderful. The letter measures *what the inspector checks*, which is real but narrow.

- **Goodhart's smoke detector.** A smoke detector is a great diagnostic — until you make "no alarms this month" a target and someone removes the battery. The detector now reads green and the building is *less* safe than before. Every gamed metric is a battery pulled from a detector. The green came from defeating the measurement, not from being safe.

---

## Common Mistakes

1. **Reading the overall grade as a verdict.** "We're an A, we're fine" / "We're a C, we're bad." The grade is computed from configurable rules against default thresholds; it measures what those rules look for and nothing else. It's a pointer, not a conclusion.

2. **Stopping at the summary tile.** Seeing "142 smells" and either panicking or shrugging — without ever clicking it. The number is *useless* until you drill into the list and open a file. The whole value is in the click-through.

3. **Trying to clear the entire list at once.** Treating "142 smells → 0" as the goal leads to rushed, risky, sweeping changes. Fix the worst *one*, by severity or hotspot, and let the count drop as a side effect. A long list is a backlog, not an emergency.

4. **Judging the whole codebase by the gate.** Forgetting that modern gates score **new code only**. A red gate on a PR is about *your change*, not the legacy repo. Don't try to fix ten years of debt to turn one PR green.

5. **Gaming the number instead of improving the code.** Assertion-free tests for coverage, method-shredding for complexity, `// NOSONAR` for smells. You move the metric and leave the problem — and now the dashboard *actively lies* to the next person. This is worse than a low score.

6. **Believing the default thresholds are objective truth.** "Complexity must be ≤ 15" and "coverage ≥ 80%" are the tool's defaults, not measurements of *your* code's needs. They're starting points to discuss and tune, not commandments.

7. **Ignoring trends in favor of absolutes.** Arguing about whether 6% duplication is "good" while missing that it was 2% last quarter. The *direction* of a metric over time is usually far more informative than its absolute value at one moment.

---

## Test Yourself

1. A dashboard shows Maintainability **C** and Reliability **E**. In plain terms, what is each letter telling you, and why is it wrong to conclude "the code is uniformly mediocre"?
2. Your pull request fails the quality gate: *"Coverage on new code is 60% (< 80%)."* Is this judging your whole repository? What's the specific, local fix?
3. Why do modern quality gates judge **new code** rather than the entire codebase? What problem does that solve?
4. Describe, in order, the steps to go from a red "Maintainability" tile to actually fixing something. Where in that sequence do you look at the grade?
5. A teammate gets coverage from 70% to 90% in a day by adding tests that assert nothing. Which "law" describes what happened, and what did the number stop measuring?
6. The dashboard says a file is rated **A** with zero smells, but everyone agrees it's painful to change. How is that possible, and what would you look at instead?

<details>
<summary>Answers</summary>

1. **Maintainability C** is a *ratio-based* grade — the estimated cost to fix all smells is 11–20% of the cost to write the code, i.e. *many small smells accumulated*. **Reliability E** is *worst-case* — there is *at least one BLOCKER-severity bug*; one bad issue forces E regardless of the other code. So it's not "uniformly mediocre": it's "lots of minor maintainability issues **plus one serious defect**." The two letters use different scales (average-ish vs worst-case).
2. **No** — modern gates judge **new code only**, so this is about the lines *this PR added/changed*, not the whole repo. The fix is local: write tests covering the new lines (likely a new branch) you just added until new-code coverage clears 80%.
3. Because a real codebase has years of accumulated issues; gating the *whole* thing would keep it red forever and everyone would ignore it. Judging only new code enforces "don't make it worse" / "Clean as You Code" — achievable, so people actually respect the gate.
4. **Gate (which condition failed?) → Issues list filtered to that category/new code → sort by severity/effort, pick one → click it, read the highlighted code and the rule → fix that one thing in the code → push and watch it clear.** You look at the grade **last** (or never while fixing) — it moves as a *consequence* of fixing real code.
5. **Goodhart's Law** — "when a measure becomes a target, it ceases to be a good measure." Coverage stopped measuring *whether the code is tested* and started measuring *whether lines were executed*; assertion-free tests execute code while protecting against nothing.
6. The A and "zero smells" are real **for what the rules check** — complexity, duplication, etc. The file's actual problem (e.g. bad design, hidden coupling, dishonest names) has **no rule that detects it**. Look instead at *churn × complexity hotspots* (which files change often and break) and human code review — signals that catch what the rule set misses.

</details>

---

## Cheat Sheet

```
WHAT A DASHBOARD IS
  An AGGREGATOR + ROUTER of metrics you already know
  (complexity, maintainability, coverage, duplication, smells),
  run on every commit, with click-through to the exact line.
  NOT a new metric. NOT a measure of "good." NOT a report card.

SONARQUBE TILE STRIP  (each tile is a drill-down link)
  Reliability  → counts BUGS            → letter (worst-case)
  Security     → counts VULNERABILITIES → letter (worst-case)
  Maintainability → counts SMELLS       → letter (from debt RATIO)
  Coverage     → % lines tests ran (displayed, not measured here)
  Duplications → % cloned lines + block count

QUALITY GATE  = pass/fail policy, strict AND of conditions
  Applies to NEW CODE (added/changed), not the whole repo
  "Clean as You Code" — don't make it worse
  Red = one named condition failed → read WHICH one

RATING LETTERS (A best → E worst)
  Maintainability: from debt ratio   A ≤5%  B ≤10%  C ≤20%  D ≤50%  E >50%
  Reliability/Security: WORST issue  one BLOCKER = E (whole project)

THE DRILL LOOP  (the actual skill)
  failing gate → issues list (filter: category + new code)
    → sort by severity/effort → open ONE issue
    → read highlighted code + rule → fix the CODE → push → it clears
  Fix the code, never the number. Look at the grade LAST.

THE CAUTION  (Goodhart's Law)
  Green gate ≠ good code (rules only catch what they check)
  Gamed: assertion-free tests, method-shredding, // NOSONAR
  Defaults (≤15, ≥80%) are starting points, not truth
  GOOD FOR: routing attention, TRENDS, new-code guardrails
  BAD FOR:  defining quality, being the team scoreboard
```

---

## Summary

- A **code-health dashboard** (SonarQube, Code Climate, CodeScene) is an **aggregator and router**: it collects the metrics you already know — complexity, maintainability, coverage, duplication, smells — runs them on every commit, and links each summary tile down to the exact file and line. It is convenience and consistency, **not** a new or more accurate measurement.
- The **quality gate** is the one panel that can block a merge: a strict **AND of conditions**, applied (in modern setups) to **new code only** — "Clean as You Code." A red gate names *which condition* failed; that's almost always a small, local fix, not a verdict on the whole repo.
- The **A–E rating letters** measure different things on different scales: **Maintainability** is a *ratio* of estimated fix-time to write-time (small smells accumulate), while **Reliability** and **Security** are **worst-case** (one blocker = E). Always read the letter with the count and severity beneath it.
- The skill that matters is **drilling**: gate → issues list → sort → open one issue → read the highlighted code → fix the **code** → watch the number move. You act on the code; the grade changes as a *consequence*. Look at the grade last, never first.
- The essential caution: a dashboard is a **smoke detector, not a judge**. A green gate doesn't mean good code; the rules only catch what they look for, the thresholds are defaults, and the moment a number becomes a target it gets **gamed** (assertion-free tests, method-shredding, `// NOSONAR`) — **Goodhart's Law**. Use it to decide *where to look*; use your own judgment to decide *whether the code is good*.

A dashboard tells you **where to look**. It never tells you you're **done**. Hold onto that one sentence and you'll already read these tools better than most engineers twice your experience.

---

## Further Reading

- [SonarQube documentation — Quality Gates](https://docs.sonarsource.com/sonarqube/latest/user-guide/quality-gates/) — the official definition of conditions, the "Sonar way" gate, and new-code scope.
- [SonarSource — "Clean as You Code"](https://docs.sonarsource.com/sonarqube/latest/user-guide/clean-as-you-code/) — the philosophy behind judging new code rather than the whole repo.
- [SonarQube — Metric Definitions](https://docs.sonarsource.com/sonarqube/latest/user-guide/metric-definitions/) — exactly how each rating letter and the technical debt ratio are computed.
- *Your Code as a Crime Scene* — Adam Tornhill. Why behavioral data (churn, hotspots) routes attention better than a static grade; the thinking behind CodeScene.
- Charles Goodhart's law, popularized as *"When a measure becomes a target, it ceases to be a good measure"* (Marilyn Strathern's phrasing) — the one idea to keep in mind every time you read a dashboard.
- The [middle.md](middle.md) of this topic — how gates are configured, how ratings map to the SQALE model, and how to design a gate your team won't disable.

---

## Related Topics

- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) — the metric behind most "code smell" complexity warnings on the dashboard.
- [02 — Maintainability Index](../02-maintainability-index/junior.md) — a composite score in the same spirit as a dashboard's Maintainability rating.
- [05 — Duplication & Similarity](../05-duplication-and-similarity/junior.md) — exactly what the "Duplications %" tile is showing.
- [Code Coverage](../../code-coverage/) — the coverage tile in depth: what the percentage does and doesn't tell you, and how it gets gamed.
- [Technical Debt Management](../../technical-debt-management/) — what to actually *do* with a long issues list: prioritizing and paying it down without halting feature work.
- [middle.md](middle.md) · [senior.md](senior.md) — configuring gates, ratings internals, and rolling dashboards out across many teams without them becoming a scoreboard.
