# Mutation Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Mutation Testing
>
> *Rolling mutation testing out across an org: where it earns its keep, gating it without triggering Goodhart, validating suites through refactors, and governing the cost.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Cost-Aware Adoption Policy](#core-concept-1--a-cost-aware-adoption-policy)
5. [Core Concept 2 — Diff-Based Mutation in CI](#core-concept-2--diff-based-mutation-in-ci)
6. [Core Concept 3 — Mutation Score as a Gate, and the Goodhart Trap](#core-concept-3--mutation-score-as-a-gate-and-the-goodhart-trap)
7. [Core Concept 4 — Validating a Suite During a Refactor](#core-concept-4--validating-a-suite-during-a-refactor)
8. [Core Concept 5 — Auditing Legacy Tests](#core-concept-5--auditing-legacy-tests)
9. [Core Concept 6 — Org Rollout and Cost Governance](#core-concept-6--org-rollout-and-cost-governance)
10. [Core Concept 7 — Mutation Testing in the Quality System](#core-concept-7--mutation-testing-in-the-quality-system)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the org-level decisions — what to mutate, how to gate it, how to govern its cost, and how to keep the score a diagnostic instead of a number people game.**

At the senior tier you learned to make mutation testing *affordable and trustworthy* on a module. At the professional tier the question is organizational: **how do you deploy it across many teams without it becoming either a useless badge or a hated tax?**

The failure modes are predictable. Mandate a global mutation-score gate and teams will game it (delete survivors, suppress aggressively, write tautological tests) — textbook Goodhart. Run it full-repo on every PR and CI becomes unbearably slow and gets disabled. Skip governance and the tool's expensive runs balloon your CI bill. This tier is about the policy, the gating design, and the rollout that avoid all three.

---

## Prerequisites

- Senior tier: equivalent mutants, cost mitigations, test selection, diff-scoping, survivor triage.
- You own or influence CI/CD policy and quality gates ([Quality Gates](../../quality-gates/) if present in your tree).
- You understand metric pathologies (Goodhart's law); see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).
- You've led or scoped a non-trivial refactor of code with an existing test suite.

---

## Glossary

| Term | Meaning |
|---|---|
| **Diff gate** | A CI check that fails the PR if mutation score on *changed* lines is below a threshold. |
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure." |
| **Surface area** | The set of modules/packages mutation testing is configured to target. |
| **Baseline run** | A full-repo mutation run that establishes the current score before changes. |
| **Suppression budget** | A reviewed, bounded set of ignored mutants with justifications. |
| **Cost governance** | Policies controlling compute spend on mutation runs (scope, schedule, parallelism). |
| **Suite validation** | Using mutation testing to confirm a test suite actually pins behavior. |

---

## Core Concept 1 — A Cost-Aware Adoption Policy

Mutation testing is too expensive to apply uniformly. A professional policy answers *where* before *how much*. Tier your codebase by the cost of a missed bug:

```text
Tier A — load-bearing correctness  (pricing, billing, tax, auth, validation,
         core algorithms, state machines)
         → mutation-tested, diff-gated in CI, periodic full-repo baseline.

Tier B — important but lower-risk  (most business services)
         → mutation tested on demand / nightly trend, no hard gate.

Tier C — glue, DTOs, generated, trivial  (getters, mappers, scaffolding)
         → NOT mutation-tested. Coverage + review is enough.
```

The policy lives in config, not in heads. PIT `targetClasses` / `excludedClasses`, Stryker `mutate` globs, gremlins/cargo-mutants path filters — encode the surface area explicitly so the tool never wanders into Tier C and drowns the signal.

The framing for stakeholders: mutation testing is **a correctness audit on your riskiest code**, priced accordingly — not a universal metric. You spend the compute where a survivor would mean lost money, a breach, or data corruption.

---

## Core Concept 2 — Diff-Based Mutation in CI

The per-PR form is always **diff-scoped**: mutate only the lines this PR changed. This keeps feedback fast and the signal maximally relevant — *"are the lines you just wrote actually tested?"*

```yaml
# PR pipeline (Tier A modules only)
mutation:
  stage: test
  script:
    - npx stryker run --incremental --since=origin/${CI_MERGE_REQUEST_TARGET_BRANCH}
  rules:
    - changes: ["src/billing/**", "src/auth/**"]   # only Tier A
```

Equivalent on the JVM with PIT + a git-diff scoping plugin:

```text
$ mvn -P mutation test
[INFO] Analysing 31 mutants across 3 changed files (diff vs origin/main)
[INFO] >> Generated 31 mutations Killed 28 (90%)

  billing/Invoice.java:142  boundary (amount > limit → amount >= limit)  SURVIVED
  billing/Invoice.java:151  removed call to audit.record(...)            SURVIVED
  auth/Policy.java:67       negated conditional                          SURVIVED

[INFO] Diff mutation score: 28/31 = 90.3%  (gate: 85%)  → PASS
```

Design notes:

- **Gate on the diff, report on the repo.** The PR check uses diff score; a dashboard tracks whole-module score over time.
- **Keep it under a few minutes.** Diff-scoping + test selection + parallelism. If a PR's diff is huge, that's a PR-size problem, not a mutation problem.
- **Full-repo runs go nightly/weekly,** parallelized, with history enabled, feeding the trend — never on the PR critical path.

---

## Core Concept 3 — Mutation Score as a Gate, and the Goodhart Trap

A mutation-score gate is powerful and dangerous. Powerful: it's far harder to game than coverage — you can't pass it with assertion-free tests. Dangerous: *any* hard numeric gate invites the behaviors that satisfy the number instead of the intent. This is **Goodhart's law**, and it's covered in depth in [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).

How a mutation gate gets gamed:

```text
- Suppress survivors wholesale (mark "equivalent" without checking).
- Write tautological tests that assert the implementation back to itself.
- Narrow the mutated surface to easy code until the number looks good.
- Add asserts that technically kill a mutant but encode no real spec.
```

Guardrails that keep the gate honest:

1. **Gate on the diff, not absolute repo score.** "New code must be 85% mutation-tested" is a *quality-of-new-work* contract; a global "repo must be 90%" target rewards gaming.
2. **Make suppressions reviewable.** Every `// pitest:skip` / `// Stryker disable` requires a reason and shows up in code review as a deliberate decision, not a silent escape hatch. Track a **suppression budget** — a sudden spike is a smell.
3. **Set the threshold from observed baseline, not aspiration.** Measure where good modules already are; gate slightly below that. A threshold teams can't hit honestly will be defeated dishonestly.
4. **Pair the gate with code review.** The reviewer, not the number, judges whether a killed mutant reflects a real assertion. The score routes attention; humans judge.
5. **Prefer "no new survivors" over "hit 90%."** Framing the gate as *don't regress on changed lines* is more robust than a fixed target.

The honest summary: use the score to **start conversations and route review attention**, and gate the *diff* lightly. The moment leadership turns a global mutation score into an OKR, you've created an incentive to lie to the tool.

---

## Core Concept 4 — Validating a Suite During a Refactor

This is one of mutation testing's highest-value uses, and it's a *professional* move because it changes how you de-risk large changes.

A refactor's entire safety argument is "the tests will catch a behavior change." But coverage can't tell you whether the tests *would*. Mutation testing can. The workflow:

```text
1. BEFORE touching the code, mutation-test the existing suite on the module.
   → This is the real strength of your safety net, in a number + survivor list.

2. If the score is low, the suite is NOT a safe net.
   → Strengthen tests (kill the survivors) FIRST, on the unchanged code.

3. Now refactor. The suite — proven to pin behavior — guards the change.

4. Re-run mutation testing after. Score should hold; survivors should be
   the same equivalents you triaged before, not new holes.
```

The key insight: you must validate the suite **before** you change the code, on the *original* behavior. A green test run on a refactored codebase only proves the tests pass — not that they'd have failed on a regression. Mutation testing on the pre-refactor suite is what converts "we have tests" into "we have a net that holds." This pairs directly with characterization tests and the *working-with-legacy-code* discipline.

---

## Core Concept 5 — Auditing Legacy Tests

Inherited a service with 92% coverage and no idea whether the tests are real? Mutation testing is the audit.

Run it (scoped to the critical modules) and the survivor list is an inventory of false confidence:

```text
$ pitest report (legacy OrderService, scoped run)
  Line coverage:    92%
  Mutation score:   41%
  Test strength:    44%   (low even over covered code)

  Top survivor clusters:
   - 23 mutants in TaxCalculator      → tests assert "total > 0", never the rate
   - 17 mutants in DiscountEngine     → no boundary tests at all
   -  9 removed-void-call mutants     → side effects (audit, email) unverified
```

A 92% coverage / 41% mutation score gap is the quantified statement *"most of this suite asserts nothing meaningful."* That's an actionable audit: you now know precisely which modules' tests to invest in, ranked by survivor density, instead of "the tests feel weak." Feed it into your [Technical Debt](../../technical-debt-management/) backlog if that section exists in your tree.

---

## Core Concept 6 — Org Rollout and Cost Governance

Rolling mutation testing across many teams is a change-management problem as much as a technical one. A workable sequence:

```text
1. PILOT   — one team, one Tier-A module. Prove value (find real holes),
             measure CI cost, tune operator set + thresholds.
2. PATTERN — package the config: shared CI template, agreed thresholds,
             suppression conventions, the "Tier A/B/C" surface policy.
3. EXPAND  — opt-in per team, Tier-A modules first. Diff-gate new code.
4. NORMALIZE — nightly full-repo trend dashboards; review suppression budgets;
             mutation score becomes a *signal in review*, never an OKR.
```

**Cost governance** is explicit, because the runs cost real compute:

- **Bound the surface** (Tier A only) so mutant counts stay sane.
- **Diff-scope per PR; full-run nightly** — keep the expensive job off the critical path.
- **Parallelize the nightly run** across shards; cap parallelism to your CI budget.
- **Sample huge legacy modules** for trend-only tracking rather than full runs.
- **Track CI minutes spent on mutation** as a line item; if it spikes, re-scope.

Cultural framing matters most: present mutation testing as **a tool that finds where your tests lie**, owned by engineers, not as a management dashboard. The fastest way to kill adoption is to weaponize the score in performance reviews — that guarantees gaming and resentment.

---

## Core Concept 7 — Mutation Testing in the Quality System

Mutation testing isn't standalone; it's the **sufficiency check** that sits above the rest of your quality stack:

```text
Coverage        → did the line run?            (necessary floor)
Mutation        → would a test fail if wrong?  (sufficiency on Tier A)
Property-based   → do invariants hold widely?   (mutation grades their strength)
Code review      → is the assertion meaningful? (human judgment on survivors)
Quality gates    → enforce the above on the diff (policy)
```

- vs **[Code Coverage](../../code-coverage/):** coverage is the cheap, broad floor; mutation is the expensive, narrow sufficiency check on top. Run coverage everywhere; run mutation where correctness is load-bearing. Coverage caps the mutation score, so you need both.
- vs **[Property-Based Testing](../06-property-based-testing/):** PBT widens input space; mutation validates that the properties are strong enough to catch faults. They compound.
- vs **[Engineering Metrics & DORA](../../engineering-metrics-and-dora/):** mutation score is a *team-owned diagnostic*, not a delivery metric. Keep it out of cross-team leaderboards to avoid Goodhart.

Use the **`unit-testing-patterns`** skill to standardize the assertion patterns that kill mutants across teams — a shared vocabulary of "assert the value, the boundary, the side effect" makes the gate teachable rather than punitive.

---

## Real-World Examples

**The payments org.** Tier-A modules (`billing/`, `pricing/`, `tax/`) are diff-gated at 85% mutation score on changed lines; everything else uses coverage + review. Nightly full-repo PIT runs across 16 shards in ~22 minutes feed a trend dashboard. Suppressions require a reviewer-approved reason. In year one, the diff gate caught dozens of boundary survivors in new pricing rules that coverage had blessed as 100%.

**The refactor that didn't blow up.** Before splitting a monolithic `RiskEngine`, the team mutation-tested the suite: 52%. They spent a sprint killing survivors (to 84%) *on the unchanged engine*, then refactored. Two genuine regressions were caught by tests that, pre-strengthening, would have stayed green. Mutation testing paid for itself in one refactor.

**The gamed gate (anti-pattern).** A different org mandated a global 90% mutation score as a quarterly target. Teams hit it by suppressing survivors en masse and writing tautological tests. The number looked great; a production billing bug shipped through a suppressed mutant. They moved to a diff-only gate with reviewed suppressions — the textbook Goodhart correction.

---

## Mental Models

- **Tier your surface; pay for correctness, not coverage.** Mutation testing is a scalpel budgeted for Tier-A code.
- **Gate the diff, trend the repo.** New work must be tested; the whole-repo number is a dashboard, never a target.
- **Suppressions are decisions, not escapes.** Reviewed, reasoned, budgeted — or the gate is theater.
- **Validate the net before you trust it.** Mutation-test the suite *before* a refactor, on the original behavior.
- **The score routes attention; humans judge.** It points review at weak assertions; it does not replace the reviewer.
- **Make it the number become a target and it dies.** Goodhart is not optional folklore here — mutation gates are unusually easy to game dishonestly.

---

## Common Mistakes

- **A global mutation-score OKR.** Guarantees gaming. Gate the diff; keep the global number a trend.
- **Running it on the whole repo, per PR.** CI grinds, teams disable it. Tier the surface; diff-scope; nightly full-run.
- **Unreviewed suppressions.** A growing pile of `disable` comments silently hides the holes the gate exists to find.
- **Trusting a green suite for a refactor.** Green proves tests pass, not that they'd catch a regression — mutation-test *first*.
- **Weaponizing the score in performance review.** Fastest possible way to destroy adoption and trust.
- **Setting the threshold by aspiration.** A gate teams can't pass honestly gets defeated dishonestly. Baseline first.
- **Skipping cost governance.** Mutation runs are pricey; un-scoped, they become a budget problem nobody owns.

---

## Test Yourself

1. Design a per-PR vs nightly mutation strategy for a 200k-line monorepo with three Tier-A services.
2. Why is gating on *diff* mutation score more robust against Goodhart than a global repo target?
3. A team's mutation score jumped from 60% to 94% in one sprint with no new tests. What do you check?
4. You're about to lead a big refactor. State the exact order of mutation-testing steps and why pre-refactor validation matters.
5. List three concrete cost-governance levers and the failure each prevents.

<details>
<summary>Answers</summary>

1. Per-PR: diff-scoped mutation on Tier-A paths only (`changes:` filters), gated at a baseline-derived threshold on changed lines, kept under a few minutes via test selection + parallelism. Nightly: full-repo runs on Tier-A modules, sharded/parallelized, history enabled, feeding a trend dashboard — no hard gate. Tier-C excluded entirely.
2. A global target rewards raising the *number* anywhere — including by suppressing, narrowing surface, or tautological tests across old code. A diff gate constrains only *new/changed* lines to be genuinely tested, which aligns the incentive with the actual goal (don't ship untested new logic) and limits the blast radius for gaming.
3. Suppressions (a spike in `disable`/`skip` annotations), a narrowed mutated surface (config excludes more code), and tautological tests added to kill mutants without encoding real specs. Audit the diff and the suppression budget.
4. (1) Mutation-test the existing suite on the unchanged module to measure the real safety net. (2) Kill survivors to strengthen it *before* changing code. (3) Refactor. (4) Re-run; expect the score to hold and only known equivalents to survive. Pre-refactor validation matters because a green run on refactored code only proves tests pass, not that they'd have caught a regression — you must prove the net on the original behavior.
5. Bound the surface to Tier A (prevents mutant-count explosion / drowned signal); diff-scope per PR + nightly full-run (prevents slow CI on the critical path); sample/parallelize huge legacy runs (prevents runaway compute cost). Track CI minutes spent as a line item.

</details>

---

## Cheat Sheet

```text
SURFACE POLICY (tier by cost-of-missed-bug):
  Tier A  pricing/billing/auth/validation/algorithms → diff-gate + nightly full
  Tier B  most services                              → nightly trend, no gate
  Tier C  DTOs/glue/generated                        → excluded entirely

CI SHAPE:
  per-PR   diff-scoped, Tier-A only, gate on CHANGED lines, < few min
  nightly  full-repo Tier-A, sharded/parallel, history on, TREND only

GATING (anti-Goodhart):
  gate the DIFF, not global repo score
  suppressions = reviewed + reasoned + budgeted
  threshold from observed BASELINE, not aspiration
  prefer "no new survivors" framing
  pair gate with code review; score routes attention, humans judge
  NEVER a global OKR or a performance-review metric

REFACTOR PLAY:
  mutation-test suite BEFORE → strengthen → refactor → re-run

LEGACY AUDIT:
  coverage 92% / mutation 41% = "most tests assert nothing" — ranked backlog

COST GOVERNANCE: bound surface · diff-scope · parallelize · sample legacy · track CI minutes
```

---

## Summary

Across an org, mutation testing succeeds or fails on policy, not tooling. **Tier your surface** by the cost of a missed bug and aim the tool only at load-bearing code (Tier A: pricing, auth, algorithms), excluding glue entirely. Run it **diff-scoped per PR** (fast, relevant, gating only changed lines) and **full-repo nightly** (parallelized, trend-only, off the critical path). Treat the score as a **diagnostic that routes review attention**, never a global OKR — a hard global target invites Goodhart gaming (mass suppression, tautological tests, surface narrowing), so gate the diff lightly, make suppressions reviewed and budgeted, and set thresholds from observed baselines. Its highest-leverage uses are **validating a suite before a refactor** (prove the net on the original behavior) and **auditing legacy tests** (the coverage-vs-mutation gap quantifies false confidence). Position it in the quality system as the *sufficiency check* above coverage and beside property-based testing — owned by engineers, governed for cost, and kept out of management leaderboards.

---

## Further Reading

- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart's law and metric pathologies in depth.
- [Code Coverage](../../code-coverage/) — the floor; mutation is the sufficiency check above it.
- [Property-Based Testing — Professional](../06-property-based-testing/professional.md) — pairing PBT and mutation in a quality system.
- [Unit Testing — Professional](../02-unit-testing/professional.md) — suite design that makes mutation affordable.
- The **`unit-testing-patterns`** skill — shared assertion vocabulary for killing mutants org-wide.
- arcmutate / PIT incremental analysis case studies; Stryker dashboard docs.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the suite mutation testing audits and grades.
- [Property-Based Testing](../06-property-based-testing/) — invariant strength, validated by mutation.
- [Code Coverage](../../code-coverage/) — coverage floor; mutation sufficiency.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — keeping the score a diagnostic, not a target.
