# Identifying & Quantifying — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → Identifying & Quantifying
> *The junior page taught you to recognize debt by feel. This page replaces the feeling with a number: a code-smell catalog you can scan for, a churn × complexity hotspot list that ranks files by where pain actually lands, and a debt ratio you can put in front of a product manager.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Code-Smell Catalog as a Detection Lens](#the-code-smell-catalog-as-a-detection-lens)
4. [Static Analysis Signals — Turning Code into Numbers](#static-analysis-signals--turning-code-into-numbers)
5. [The Hotspot Technique — Churn × Complexity](#the-hotspot-technique--churn--complexity)
6. [Coverage Gaps and Dependency Staleness as Debt](#coverage-gaps-and-dependency-staleness-as-debt)
7. [Quantifying — SQALE, the Debt Ratio, and Remediation Effort](#quantifying--sqale-the-debt-ratio-and-remediation-effort)
8. [Lead-Time and Defect Density as Debt Proxies](#lead-time-and-defect-density-as-debt-proxies)
9. [Worked Example — Building a Hotspot List from git](#worked-example--building-a-hotspot-list-from-git)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I find debt concretely, and how do I turn "this code is bad" into a defensible number?**

At the junior level, identifying debt is qualitative: you read code, it feels tangled, you flag it. That works for the file in front of you and fails at the scale of a real codebase. You cannot read 4,000 files. You cannot rank them by gut. And "it feels bad" does not survive contact with a product manager deciding whether to fund a cleanup or a feature.

This page gives you two upgrades. First, **detection at scale**: a code-smell catalog as a structured lens, plus static-analysis tools that scan the whole repo and emit measurable signals — complexity, duplication, coverage. Second, **quantification**: the SQALE method and SonarQube's debt ratio, which convert a pile of issues into a single percentage and a remediation estimate in hours.

The throughline is the **hotspot technique** — mining your `git log` for *change frequency* and crossing it with *complexity*. It is the single highest-leverage idea here because it answers the question raw metrics cannot: not "where is the code worst?" but "where does the bad code actually *hurt*?" A horrifying file nobody touches costs you nothing this quarter. The number you want is the one that finds the file that is both awful and on fire.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain principal vs interest in your own words.
- **Required:** You can read [What Is Technical Debt → middle](../01-what-is-technical-debt/middle.md) and distinguish debt from a plain bug.
- **Required:** Comfortable with `git log` and basic shell pipelines (`sort`, `uniq`, `awk`).
- **Helpful:** You've seen a static-analysis report (SonarQube, ESLint, golangci-lint) at least once.
- **Helpful:** A rough sense of what cyclomatic complexity counts.

---

## The Code-Smell Catalog as a Detection Lens

A **code smell** is a surface symptom that *often* signals a deeper design problem — Kent Beck and Martin Fowler's word for "this looks wrong, investigate." Smells are not bugs and not certainties; they are *named patterns* that turn vague unease into a checklist you can actually apply.

The value of the catalog is that it makes detection **repeatable and teachable**. Instead of "this feels off," you say "this is a Long Method with Feature Envy," and now two engineers point at the same thing and a tool can sometimes flag it automatically. The canonical catalog (treated in depth at [Code Smells](../../../code-craft/refactoring/01-code-smells/)) includes:

| Smell | What you see | Debt it usually signals |
|---|---|---|
| **Long Method** | a function that scrolls off the screen | one unit doing many jobs; hard to test or change |
| **Large Class / God Object** | a class with 40 methods and 20 fields | missing decomposition; every change risks it |
| **Duplicated Code** | the same logic copy-pasted in 5 places | a fix must be made 5 times; one will be missed |
| **Feature Envy** | a method that reaches into another object's data constantly | behaviour living in the wrong place |
| **Shotgun Surgery** | one logical change forces edits across many files | poor cohesion; high cost per change |
| **Primitive Obsession** | `string`/`int` everywhere instead of domain types | weak modeling; validation scattered |

> **Key insight:** A smell is a *hypothesis*, not a verdict. The catalog's job is to convert "something's wrong here" into a *named, searchable, sometimes-measurable* thing — which is the first step to counting it. You can't quantify what you can't name. The smells you can detect mechanically (duplication, long methods, high complexity) are exactly the ones static analysis will hand you as numbers in the next section.

---

## Static Analysis Signals — Turning Code into Numbers

Static analysis reads your source *without running it* and emits measurable signals. Three signals carry most of the weight for debt detection.

**Cyclomatic complexity** counts the number of linearly independent paths through a function — effectively, one plus the number of decision points (`if`, `for`, `case`, `&&`, `||`). A function scoring 1 is a straight line; a function scoring 25 has 25 independent ways to flow through it, which means at least 25 test cases to cover it and 25 ways for a change to go wrong. It is a direct proxy for *how hard this is to test and reason about*.

**Cognitive complexity** (SonarSource's refinement) measures how hard code is for a *human* to follow, not a machine. It penalizes nesting and breaks in linear flow more than a flat `switch`. A 10-case `switch` has high cyclomatic but low cognitive complexity — it's tedious, not confusing; deeply nested conditionals score high on both. Cognitive complexity is the better signal when your goal is "what will slow a developer down."

**Duplication** is reported as a percentage of lines that appear in clone blocks elsewhere. Duplication is debt with compound interest: every copy is a place a future fix can be forgotten.

Linters (ESLint, golangci-lint, RuboCop, Checkstyle) add rule violations — unused variables, missing error handling, banned patterns. Individually trivial; in aggregate, a density signal.

```bash
# Go: cyclomatic complexity per function, worst first
gocyclo -top 10 .
# 32 payments  processRefund  internal/billing/refund.go:88:1
# 28 orders     applyDiscount  internal/orders/discount.go:140:1
# 19 auth       validateToken  internal/auth/token.go:55:1
```

Anything above ~10–15 is worth a look; above ~25 is a near-certain refactor candidate. **SonarQube** rolls these signals into a dashboard and — confusingly — labels a specific subset of rule violations as "**Code Smells**" (its term for maintainability issues, distinct from Bugs and Vulnerabilities). A typical report line reads:

```
Code Smell · Major · "processRefund" has a Cognitive Complexity of 41 (limit 15)
  → Effort: 31min   File: internal/billing/refund.go:88
```

That `Effort: 31min` is not decoration — it is SonarQube's **remediation effort**, the estimated time to fix this one issue. Sum those estimates across the project and you have the raw material for the debt ratio in section 7.

> **Key insight:** Static analysis converts qualitative smells into *scalars you can sort, threshold, and trend over time*. But a scalar alone misleads — a file with complexity 40 that nobody has touched in three years is not your problem. The number becomes actionable only when you cross it with **change frequency**, which is the entire point of the next section.

---

## The Hotspot Technique — Churn × Complexity

This is the most important idea on the page. Complexity tells you where the code is *hard*; it says nothing about where the *work* is. Adam Tornhill's **hotspot** technique (*Software Design X-Rays*) fixes that by adding a second axis you already have in your version-control history: **churn**, the number of times a file has changed.

The model is a 2×2:

| | Low complexity | High complexity |
|---|---|---|
| **Low churn** | healthy, leave it | scary but dormant — *low priority* |
| **High churn** | active but simple — fine | **HOTSPOT — fix first** |

The top-right quadrant — files that are *both* complex *and* changed constantly — is where your team is paying interest every single sprint. A complex file nobody edits is paid-off debt sitting in a vault; a simple file edited daily is just normal work. The intersection is where complexity *multiplies* by frequency into real, recurring cost.

You mine churn straight from `git log`. The frequency is "how many commits touched this file":

```bash
# Change frequency per file, most-changed first
git log --format=format: --name-only --since="12 months ago" \
  | grep -v '^$' \
  | sort | uniq -c | sort -rg | head -10
```

```
 312 internal/billing/refund.go
 188 internal/orders/discount.go
 141 internal/api/handlers.go
  37 internal/auth/token.go
```

Reading this: `refund.go` was touched in 312 commits in a year — roughly six times a week. That is a file the team cannot leave alone. Now cross it with the complexity numbers from `gocyclo`: `refund.go` is *both* the most-changed file *and* near the top on complexity. That intersection is your number-one hotspot. You did not need to read a single line to find it; the history and the complexity scanner found it for you.

> **Key insight:** Prioritize by **churn × complexity, not complexity alone.** The scariest file in the codebase might be inert; the file quietly draining your team is the one that is *both* tangled *and* edited constantly. Hotspot analysis is how "where's the worst code?" becomes the far more useful "where is the worst code we keep paying for?" — and it costs nothing because the data is already in `git`.

---

## Coverage Gaps and Dependency Staleness as Debt

Two more signals are debt even though they live outside your source files.

**Coverage gaps.** A hotspot with *low test coverage* is the most dangerous combination there is: code that changes constantly, is hard to reason about, *and* has no safety net to catch regressions. Coverage alone is a weak metric (90% coverage of trivial code proves little), but **coverage cross-referenced with hotspots** is sharp. A complex, high-churn file at 12% coverage tells you exactly where the next production incident is incubating. Pull coverage from your test run and overlay it on the hotspot list:

```bash
go test ./... -coverprofile=cover.out
go tool cover -func=cover.out | sort -k3 -n | head
# internal/billing/refund.go:88:  processRefund   11.4%   ← hotspot + barely tested
```

**Dependency staleness.** Out-of-date dependencies are debt whose interest is paid in security exposure and upgrade pain. Each major version you fall behind makes the eventual upgrade larger and riskier — the textbook "interest compounding" because you didn't pay principal. Most ecosystems report it directly:

```bash
npm outdated          # Current / Wanted / Latest per package
go list -u -m all     # shows [available] upgrades inline
```

A package three majors behind with a known CVE is not "we'll get to it" — it is quantifiable, scheduled-or-exploited debt. Tools like Dependabot/Renovate make this stream continuous so it never silently accumulates.

> **Key insight:** Debt is not only the shape of your code. **Untested hotspots** and **stale, vulnerable dependencies** are debt with some of the highest interest rates in the whole system, and both are fully measurable from data you already produce — your coverage report and your lockfile.

---

## Quantifying — SQALE, the Debt Ratio, and Remediation Effort

Now we turn the pile of signals into a single defensible number. The standard model is **SQALE** (Software Quality Assessment based on Lifecycle Expectations), which underpins SonarQube's debt metrics.

The core formula is a ratio:

```
Technical Debt Ratio = Remediation Cost ÷ Development (Rebuild) Cost
```

- **Remediation cost** — the estimated effort to fix all the detected issues. SonarQube computes this by summing the per-issue **remediation effort** (the `31min` you saw earlier) across every issue in the project. Each rule carries a fixed effort estimate (e.g. "remove this duplicated block: 15 min").
- **Development / rebuild cost** — the estimated effort to *rebuild the code from scratch*, derived from size. SonarQube's default is **30 minutes per line of code**. So a 10,000-line project has a rebuild cost of `10,000 × 30 min = 5,000 hours`.

Put them together. Say the scanner sums remediation effort to **250 hours** on that 10,000-line project:

```
Debt Ratio = 250h / 5,000h = 0.05 = 5%
```

SonarQube maps that ratio to a **Maintainability Rating** (its SQALE rating): ≤5% = **A**, ≤10% = B, ≤20% = C, ≤50% = D, >50% = E. So "we're a B, debt ratio 8%, ~400 hours of remediation" is a sentence a product manager can act on — it has a grade, a percentage, and an hour count. A typical project summary:

```
Maintainability:  B
Technical Debt:    412h
Debt Ratio:        8.2%
Code Smells:       1,847   (Blocker 3 · Critical 41 · Major 612 · …)
```

The point of the ratio over a raw hour count is that it is **size-normalized**: 412 hours of debt is alarming in a 5k-line service and routine in a 500k-line monolith. The ratio lets you compare a tiny library against a huge platform on the same scale, and lets you watch a *single* codebase trend up or down release over release.

> **Key insight:** A debt *ratio* beats a debt *hour-count* because it's normalized to size — you can compare services and track a trend. But treat the absolute numbers as **order-of-magnitude, not precision**. "30 minutes per line" is a convention, not a measurement; the value is in *consistency and trend* (is 8% becoming 12%?), not in believing the project is exactly 412.0 hours from clean.

---

## Lead-Time and Defect Density as Debt Proxies

The metrics above measure debt by inspecting the *code*. You can also measure it by its *symptoms* — what debt does to your delivery — which is often the more persuasive number because it's denominated in business outcomes, not engineering opinion.

**Defect density** — defects per unit of code (per KLOC, or per file). Overlay it on your hotspots and a pattern jumps out: bugs cluster. The files that generate the most defects are almost always your high-churn, high-complexity hotspots. Defect density turns "this code is risky" into "this file produced 23% of our production incidents," which funds a rewrite far faster than a complexity score does.

**Lead time / cycle time** — how long a change takes to go from "started" to "in production" (cycle time) or "requested" to "delivered" (lead time). This is a DORA metric, and it is debt's clearest economic fingerprint. When debt accumulates, the *same size* of change takes longer: more files to touch (Shotgun Surgery), more fear (no tests), more rework. A rising cycle-time trend on a stable team and backlog is debt taxing every delivery. You can even localize it — measure cycle time for changes touching the hotspot files versus the rest of the codebase; a 2–3× gap is the interest rate, quantified.

> **Key insight:** Code-inspection metrics (complexity, debt ratio) tell you debt *exists*; delivery metrics (cycle time, defect density) tell you what it *costs the business*. The second kind funds the work. "Refactor X to cut its cognitive complexity from 41 to 12" is an engineering wish; "changes to X take 3× longer and cause a quarter of our incidents" is a budget request — and it's the same debt, measured by its shadow.

---

## Worked Example — Building a Hotspot List from git

Let's build a real, ranked hotspot list from scratch and read the result. The recipe: get **churn** from git, get **complexity** from a scanner, join them, sort by the product.

```bash
# 1. CHURN — commits per file over the last year → churn.txt as "count path"
git log --format=format: --name-only --since="12 months ago" \
  | grep '\.go$' \
  | sort | uniq -c | sort -rg > churn.txt

head -4 churn.txt
#  312 internal/billing/refund.go
#  188 internal/orders/discount.go
#  141 internal/api/handlers.go
#   94 internal/orders/cart.go
```

```bash
# 2. COMPLEXITY — worst function complexity per file via gocyclo
gocyclo -avg . | sort -rg > complexity.txt   # "score package func file:line"
```

Now join the two by hand into the table that matters. Churn × max-complexity gives a single priority score:

| File | Churn (commits) | Complexity | Churn × Complexity | Verdict |
|---|---|---|---|---|
| `billing/refund.go` | 312 | 32 | **9,984** | top hotspot — fix first |
| `orders/discount.go` | 188 | 28 | 5,264 | second priority |
| `api/handlers.go` | 141 | 9 | 1,269 | busy but simple — fine |
| `auth/token.go` | 37 | 19 | 703 | complex but stable — defer |
| `orders/cart.go` | 94 | 6 | 564 | healthy |

Read the table the way a senior engineer does:

- **`refund.go` wins decisively** — highest churn *and* highest complexity. This is where the team bleeds time every sprint. Now overlay coverage (section 6): it sits at 11%. Hotspot + untested = your number-one paydown target, no debate.
- **`handlers.go` is a trap for the naive.** It's the third-most-changed file, so a churn-only list flags it — but its complexity is 9. It changes a lot because it's the API surface, not because it's tangled. Churn alone would have sent you to refactor a file that's fine.
- **`token.go` is the opposite trap.** Complexity 19 looks scary on a complexity-only list, but 37 commits in a year means it's stable. It's paid-off debt; defer it.

The two "traps" are exactly why you multiply the axes instead of sorting on either one. The single number `churn × complexity` filtered both the busy-but-simple and the scary-but-dormant files out of your top slots and left you with the file that is genuinely costing you. That ranked list — not a feeling, not a single metric — is what you carry into [Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md).

---

## Mental Models

- **A code smell is a hypothesis; a metric is its measurement.** "This feels long" → "Long Method" (named) → "cognitive complexity 41" (measured). Each step makes the debt more countable and harder to wave away.

- **Complexity is potential energy; churn is the force that releases it.** A complex file at rest costs nothing. Multiply it by how often it's disturbed and you get the actual recurring cost. Hotspot = the product, never one factor alone.

- **The debt ratio is a fuel gauge, not an odometer.** It's a normalized, directional reading — "8% and climbing" — not a precise distance. Trust the trend and the comparison; don't over-trust the third significant figure.

- **Inspection metrics prove debt exists; delivery metrics prove it's expensive.** Complexity and debt ratio convince engineers. Cycle time and defect density convince whoever controls the budget. You usually need both, pointed at the same files.

- **The data is already in `git`.** You don't need a tool license to start. `git log` plus a complexity scanner plus `sort` gets you a ranked hotspot list today.

---

## Common Mistakes

1. **Ranking by complexity alone.** The scariest file may be dormant. Without crossing complexity with churn, you'll spend a sprint refactoring code nobody touches while the real hotspot keeps burning. Always multiply by change frequency.

2. **Ranking by churn alone.** The most-changed file is often a stable API surface or config that *should* change often. High churn + low complexity is healthy, not debt. Churn is only half the signal.

3. **Believing the debt ratio's precision.** "412 hours" is an estimate built on "30 min/line" and fixed per-rule efforts. Quote it as order-of-magnitude and lean on the *trend*, not the exact figure, or you'll lose credibility when someone audits it.

4. **Chasing a coverage number instead of coverage *on hotspots*.** Driving global coverage from 80% to 85% by testing trivial getters is theater. The 12%-covered hotspot is where coverage actually buys you safety. Target coverage where churn and complexity are high.

5. **Treating every SonarQube "Code Smell" as urgent.** SonarQube labels thousands of minor issues as Code Smells. Most are noise. Filter to Blocker/Critical on hotspot files; an unprioritized 1,847-issue list paralyzes rather than guides.

6. **Measuring debt only in code, never in delivery.** If you never look at cycle time or defect density, you can describe the debt but can't price its impact — and "the complexity is high" rarely wins a funding argument that "changes here take 3× longer" wins easily.

---

## Test Yourself

1. Why is churn × complexity a better priority signal than complexity alone? Give the two failure modes of using either factor by itself.
2. Write the git command that produces a per-file change-frequency list, and explain what each stage does.
3. State the technical-debt ratio formula and compute it for a 20,000-line project with 600 hours of remediation effort, using SonarQube's default rebuild cost.
4. What is the difference between cyclomatic and cognitive complexity, and when does the gap between them matter?
5. You have a file with complexity 35, 200 commits/year, and 9% test coverage. Why is this the worst-case combination, and what does it predict?
6. Your manager won't fund a refactor based on a complexity score. What *kind* of metric should you bring instead, and why is it more persuasive?

<details>
<summary>Answers</summary>

1. Complexity says where code is *hard*; churn says where the *work* is. Complexity-only flags scary-but-dormant files that cost nothing this quarter (e.g. a stable parser). Churn-only flags busy-but-simple files that *should* change often (e.g. an API handler or config). Only the *product* isolates the file that is both tangled and constantly edited — where interest is actually paid.
2. `git log --format=format: --name-only --since="12 months ago" | grep -v '^$' | sort | uniq -c | sort -rg`. `git log --name-only` lists changed files per commit with empty format lines; `grep -v '^$'` drops the blanks; `sort` groups identical paths; `uniq -c` counts each path; `sort -rg` orders by count descending.
3. `Debt Ratio = Remediation Cost ÷ Rebuild Cost`. Rebuild cost = 20,000 lines × 30 min = 600,000 min = 10,000 hours. Ratio = 600 / 10,000 = **0.06 = 6%** → Maintainability B.
4. Cyclomatic counts independent paths (decision points) — a machine/test-count proxy. Cognitive counts how hard code is for a *human*, penalizing nesting and flow breaks. The gap matters for a flat 10-case `switch`: high cyclomatic (tedious, many paths) but low cognitive (not confusing). Use cognitive when the goal is "what slows a developer down."
5. It's a hotspot (high complexity × high churn) *with no safety net* (9% coverage). It changes constantly, is hard to reason about, and has nothing to catch regressions. It predicts the next production incident — and is your top paydown target.
6. A **delivery / business** metric: cycle time for changes touching that file, or its defect density (share of incidents it causes). It's more persuasive because it's denominated in outcomes the manager owns — slower delivery, more incidents — not engineering aesthetics. Same debt, measured by its cost rather than its shape.

</details>

---

## Cheat Sheet

```
DETECT (qualitative → measurable)
  code smells     named symptoms: Long Method, God Object, Duplication, Feature Envy
  cyclomatic      independent paths (decision points); >10–15 watch, >25 refactor
  cognitive       human difficulty; penalizes nesting > flat switch
  duplication     % of lines in clone blocks — compounding debt
  linters         rule-violation density (ESLint, golangci-lint, RuboCop)

CHURN (the missing axis — from git, free)
  git log --format=format: --name-only --since="12 months ago" \
    | grep -v '^$' | sort | uniq -c | sort -rg
  → commits-per-file = change frequency

HOTSPOT
  priority = churn × complexity      (top-right of the 2×2 = fix first)
  high churn + low complexity  → healthy, leave it
  low  churn + high complexity → dormant, defer
  overlay coverage: hotspot + low coverage = #1 danger

QUANTIFY (SQALE / SonarQube)
  Debt Ratio = Remediation Cost ÷ Rebuild Cost
  Rebuild Cost = LOC × 30 min (default)
  Rating:  ≤5% A · ≤10% B · ≤20% C · ≤50% D · >50% E
  remediation effort = sum of per-issue fix estimates

DEBT BY ITS SHADOW (funds the work)
  defect density  defects/KLOC — bugs cluster on hotspots
  cycle time      DORA; rising = debt taxing delivery; 2–3× on hotspots = the interest rate
  dependency lag  npm outdated · go list -u -m all — compounding upgrade/security debt
```

---

## Summary

- **Code smells** are named, repeatable hypotheses that turn vague unease into something searchable — and, for the mechanical ones, measurable.
- **Static analysis** converts smells into scalars: cyclomatic complexity (paths/test-count), cognitive complexity (human difficulty), duplication, and linter density. SonarQube labels a subset of these "Code Smells" and attaches a per-issue **remediation effort**.
- The **hotspot technique** is the key move: cross *complexity* with *churn* (commits per file, straight from `git log`). The high-churn × high-complexity files are where interest is actually paid; either factor alone misleads.
- **Coverage gaps on hotspots** and **stale dependencies** are debt with high interest rates, both measurable from data you already produce.
- **SQALE** quantifies it: `Debt Ratio = Remediation Cost ÷ Rebuild Cost`, with rebuild cost defaulting to 30 min/line, mapped to an A–E rating. Trust the *trend and the normalization*, not the exact hours.
- **Cycle time and defect density** measure debt by its symptoms — the persuasive, business-denominated numbers that fund the cleanup the code-metrics merely justify.

---

## Further Reading

- *Software Design X-Rays* — Adam Tornhill. The definitive treatment of behavioral hotspots, churn × complexity, and mining version control for design signals.
- *Your Code as a Crime Scene* — Adam Tornhill. The earlier, gentler introduction to the same forensic techniques.
- *Refactoring* (2nd ed.) — Martin Fowler. The authoritative code-smell catalog, with the refactoring for each.
- **SonarQube / SQALE documentation** — the precise definitions of remediation effort, the debt ratio, and the maintainability rating used above.
- *Accelerate* — Forsgren, Humble, Kim. The research behind lead time and cycle time as the metrics that predict delivery performance.

---

## Related Topics

- [junior.md](junior.md) — recognizing debt by feel, before the metrics.
- [senior.md](senior.md) — running hotspot analysis at org scale, trend dashboards, and the limits of every metric here.
- [01 — What Is Technical Debt](../01-what-is-technical-debt/middle.md) — the principal/interest model these numbers quantify.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md) — turning this ranked hotspot list into a funded, ordered backlog.
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — the full catalog used as the detection lens here, with the fix for each smell.
- [Code Review](../../code-review/) — the gate where many of these smells get caught before they become hotspots.
