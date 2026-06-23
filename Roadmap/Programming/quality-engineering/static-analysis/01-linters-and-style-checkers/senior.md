# Linters & Style Checkers — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Linters & Style Checkers
> *Reasoning about a rule set under real constraints: scale, signal economics, placement in the dev loop, and the line between "this is a bug" and "this is my taste imposed on everyone."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Decidability: What a Linter Can and Cannot Prove](#core-concept-1----decidability-what-a-linter-can-and-cannot-prove)
5. [Core Concept 2 -- The Economics of a Rule](#core-concept-2----the-economics-of-a-rule)
6. [Core Concept 3 -- Designing the Rule Set as a System](#core-concept-3----designing-the-rule-set-as-a-system)
7. [Core Concept 4 -- Severity, Gating, and the Cost of `error`](#core-concept-4----severity-gating-and-the-cost-of-error)
8. [Core Concept 5 -- Placement: Editor, Pre-Commit, CI](#core-concept-5----placement-editor-pre-commit-ci)
9. [Core Concept 6 -- Performance at Scale](#core-concept-6----performance-at-scale)
10. [Core Concept 7 -- Suppression Discipline and Auditing](#core-concept-7----suppression-discipline-and-auditing)
11. [Core Concept 8 -- The Linter-as-Moral-Authority Anti-Pattern](#core-concept-8----the-linter-as-moral-authority-anti-pattern)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **treating the rule set as an engineered system with a measurable value function, and making decisions about decidability, gating, placement, and performance that hold up under scale and scrutiny.**

A senior engineer doesn't ask "should we enable rule X?" in isolation. They ask: *what does this rule prove, how often is it right, what does a firing cost the team, where in the dev loop should it fire, and who decided?* The rule set is a product with users (the team), a quality metric (true-positive rate), a latency budget (lint time), and a failure mode (trust collapse). This page treats it that way.

The recurring tension is between two true statements: a good linter prevents real incidents, and a bad linter is a vector for one person's aesthetics to become everyone's blocked PR. Holding both is the senior skill.

---

## Prerequisites

**Required**

- You can own and tune a multi-rule config across a real codebase (see [Middle](./middle.md)).
- You understand correctness/convention/style classes and the false-positive budget.
- You've felt the pain of a noisy rule set and a flaky gate.

**Helpful**

- A working model of your language's AST and how rules traverse it (see [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/)).
- Exposure to CI gating mechanics (see [Static Analysis in CI](../09-static-analysis-in-ci/)).

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| Decidable check | A property the linter can determine with certainty from the AST. |
| Undecidable / heuristic | A property the linter can only approximate; it will sometimes be wrong. |
| Soundness | Catching *all* real instances (no false negatives). |
| Completeness | Flagging *only* real instances (no false positives). |
| True-positive rate (TPR) | Real problems ÷ total firings, for one rule. |
| Gate | A check that blocks merge/release when it fails. |
| Ratchet | A mechanism that allows existing violations but forbids new ones. |
| Suppression density | Number of inline `disable`/`nolint` comments per KLOC. |
| Shift-left | Moving a check earlier (editor < pre-commit < CI). |
| Caching / incremental lint | Re-linting only changed files to keep runs fast. |

---

## Core Concept 1 -- Decidability: What a Linter Can and Cannot Prove

A linter's reliability is governed by a theoretical ceiling. Some properties of code are **decidable** by static inspection; others are not, and any rule for an undecidable property is a *heuristic* that must trade soundness against completeness.

- **Decidable, near-perfectly:** "this local is declared and never read," "this import is unused," "two `case` labels are identical," "this function has an unreachable statement after `return`." These are syntactic or simple data-flow facts. A well-implemented rule here is both sound and complete in practice.
- **Decidable but expensive:** "this `err` is assigned and overwritten before any read" (intra-procedural data flow). Tools like `ineffassign` and staticcheck's `SA4006` do this within a function reliably; across functions it gets harder fast.
- **Undecidable in general (Rice's theorem territory):** "this code is dead," "this will always be null here," "this is a security vulnerability." These reduce to questions about *runtime behavior*, which static analysis cannot decide in full generality. Every such rule is an approximation.

The senior consequence: **classify each rule by where it sits on this scale, and set expectations accordingly.** Decidable rules can be `error`-gated with confidence. Heuristic rules carry an inherent false-positive (or false-negative) rate that no amount of config removes — gate them only after you've measured that rate and decided it's acceptable. Treating a heuristic rule like a decidable one is how you ship a gate that randomly blocks correct code.

---

## Core Concept 2 -- The Economics of a Rule

Every rule has a value equation. Make it explicit before enabling:

```
value(rule) = (bugs_prevented × cost_per_bug)
            − (false_positives × developer_time_per_FP)
            − (real_findings_ignored_due_to_noise)
            − config_and_maintenance_cost
```

The third term is the subtle one and the reason "enable everything" loses: a noisy rule doesn't just waste time on its own false positives, it *degrades the value of every other rule* by training the team to skim. Noise has negative externalities across the whole rule set.

To make this operational, **instrument firings.** For a candidate rule, run it in `warning` mode for a sprint, sample 30 firings, and label each true/false positive:

- TPR ≥ ~80% on a high-cost bug class → promote to `error` gate.
- TPR 40–80% → keep as `warning`, or scope to where it's accurate.
- TPR < ~40% → it's a noise generator; tune the rule, scope it tightly, or cut it.

This converts "I feel like this rule is good" into evidence. It's also the only defensible answer when a teammate asks why their PR is blocked: *the rule is right 9 times in 10 on bugs that cost us hours, here's the data.*

---

## Core Concept 3 -- Designing the Rule Set as a System

A rule set is not a flat list; it's layered, with each layer doing a distinct job and overlapping as little as possible.

```js
// eslint.config.js — layered, intentional
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

export default [
  // Layer 1: language-level correctness (decidable, gated)
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Layer 2: project conventions (team agreements, gated)
  {
    plugins: { import: importPlugin },
    rules: {
      "import/no-cycle": "error",          // architectural rule: no import cycles
      "no-restricted-imports": ["error", { paths: [
        { name: "lodash", message: "use lodash-es for tree-shaking" },
      ]}],
    },
  },

  // Layer 3: style — delegated to the formatter, NOT enforced here
  // (Prettier/dprint owns whitespace; see ../02-formatters/)

  // Layer 4: scoped exceptions
  { files: ["**/*.test.ts"], rules: { "no-console": "off" } },
];
```

Principles:

- **No overlap with the formatter.** If a rule is about whitespace, quotes, or commas, delete it; a formatter does it deterministically and without debate (see [Formatters](../02-formatters/)).
- **Architectural rules earn their place.** `import/no-cycle`, restricted imports, and boundary rules encode design decisions and catch problems no human reviewer reliably will at scale. These are often the highest-value convention rules.
- **Scope, don't globally disable.** Tests, generated code, and legacy modules get `files`-scoped overrides — never a repo-wide `off`.

For Go, the analogous system is a curated `.golangci.yml` where `staticcheck` carries correctness and a small set of others (`errcheck`, `bodyclose`, `gosec` if you've measured its noise) carry specific concerns — not the full sixty-linter menu.

---

## Core Concept 4 -- Severity, Gating, and the Cost of `error`

`error` is expensive. It blocks a merge, which means it can block a release, an incident fix, or a colleague at 6pm. That cost is justified only when the rule is (a) decidable or high-TPR and (b) catching something worth stopping for.

A useful three-tier policy:

| Tier | Severity | Criteria | Examples |
|---|---|---|---|
| **Gate** | `error`, blocks CI | decidable OR measured TPR ≥ ~80% on real bugs | unused var, `eqeqeq`, unchecked error, import cycle |
| **Advise** | `warning`, visible, non-blocking, *tracked* | useful but heuristic, or mid-rollout | complexity thresholds, `any` usage, naming nudges |
| **Off** | disabled, documented | low value or high noise for this codebase | rules superseded by the formatter, pedantic lints |

The critical discipline: **the Advise tier must not be a junk drawer.** A `warning` that nobody will ever act on should be `off`. Track the warning count and trend it; if it only grows, the tier is failing. Some teams enforce "warnings may not increase" as its own ratchet so the Advise tier stays meaningful.

Deep gating mechanics — required checks, branch protection, fail-fast vs. report — belong to [Static Analysis in CI](../09-static-analysis-in-ci/). The senior point here is *which* rules deserve to be a gate at all, decided by decidability and measured TPR, not by strictness vibes.

---

## Core Concept 5 -- Placement: Editor, Pre-Commit, CI

The same rule has wildly different value depending on *when* it fires. Place each check at the earliest point where it's both fast and reliable.

| Location | Latency to feedback | Best for | Caveat |
|---|---|---|---|
| **Editor (LSP)** | milliseconds | all fast rules; the squiggle is the highest-leverage feedback | per-developer; not enforceable |
| **Pre-commit hook** | seconds | fast, autofixable, changed-files-only checks | must stay fast or devs `--no-verify` |
| **CI** | minutes | the source of truth; everything, on the full set | slowest feedback; last line, not first |

The guiding principle is **shift-left**: catch it in the editor if you can, at commit if you must, in CI as the backstop. A rule that only ever fails in CI — minutes after the developer moved on — has poor ergonomics even if it's correct. Pre-commit on *changed files only* (via `lint-staged`, `pre-commit`, or `lefthook`) is the sweet spot for fast rules:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]   # autofix on commit, only staged files
```

One hard rule: **pre-commit must be fast (sub-few-seconds) or developers will bypass it.** A slow hook trains `git commit --no-verify`, which defeats the whole point. Heavy, slow, or whole-repo checks belong in CI, not the commit path.

---

## Core Concept 6 -- Performance at Scale

On a large monorepo, lint time becomes a real constraint — a 10-minute lint is a 10-minute tax on every PR and a reason people skip the local run.

Levers, roughly in order of impact:

- **Lint only what changed.** In CI, lint files in the diff, not the world. golangci-lint's `--new-from-rev`, ESLint over a computed file list, Ruff's speed making whole-repo cheap anyway.
- **Caching.** ESLint's `--cache`, golangci-lint's build cache, Ruff's incremental behavior. Persist the cache across CI runs.
- **Pick fast tools.** Ruff (Rust) over Pylint (Python) is often a 10–100× wall-clock difference at parity for the common checks. For a team feeling lint pain, switching tools can dwarf any config tuning.
- **Type-aware rules are slow.** `typescript-eslint`'s `*-type-checked` configs run the type checker; they're powerful but multiply lint time. Reserve them for where the extra power pays.
- **Parallelism.** golangci-lint runs its sub-linters concurrently; ESLint can be sharded across CI jobs for huge repos.

The trade is explicit: type-aware and deep-flow rules cost wall-clock time but catch a class of bug syntactic rules can't. Buy that power where the bug cost justifies the latency, not everywhere by default.

---

## Core Concept 7 -- Suppression Discipline and Auditing

Suppressions are load-bearing — they're how honest false positives and deliberate exceptions get handled — but they're also where rule sets quietly rot. A senior treats suppressions as a tracked metric.

- **Require a reason.** Bare `// eslint-disable-next-line` or `//nolint` with no rule and no rationale should fail review (and can be linted for — `eslint-comments/require-description`).
- **Scope to the narrowest unit.** Line over block over file over repo. A file-level disable hides every future instance.
- **Audit suppression density.** Track `disable`/`nolint`/`noqa` per KLOC over time. A rising count is a signal that a rule is mis-tuned (the team is routing around it) or that the codebase is fighting a rule it shouldn't have to.
- **Find dead suppressions.** A `// noqa` on a line that no longer triggers anything is misleading clutter. ESLint's `--report-unused-disable-directives` and Ruff's `RUF100` flag these; gate on them so suppressions stay honest.

```bash
eslint . --report-unused-disable-directives   # fail on stale disables
ruff check . --extend-select RUF100           # flag unused noqa
```

A spike in suppressions for one rule is your earliest signal to revisit that rule's economics (Core Concept 2) — often the team is telling you, in code, that the rule is wrong for this codebase.

---

## Core Concept 8 -- The Linter-as-Moral-Authority Anti-Pattern

The most common senior-level failure isn't technical. It's a person — sometimes well-intentioned, sometimes not — turning the linter into a delivery vehicle for personal preference, then citing "the linter" as if it were objective law. Symptoms:

- Rules added without discussion, justified by "best practice" with no evidence and no measured TPR.
- Style preferences (that a formatter should own) shipped as blocking `error` rules.
- PR comments that read "the linter says so" as the end of an argument, when the linter says so only because *they* configured it to.
- A rule set that grows monotonically — rules only ever get added, never removed.

The antidote is **governance** (covered in depth at the [Professional](./professional.md) level): rules are a shared asset with an owner, an add/remove process, and a value bar. At the senior level, the practical move is to insist that *every gated rule have a written rationale and, for heuristic rules, evidence it's worth blocking on.* "Because I prefer it" is not a rationale; "this fired on 23 PRs last quarter and 21 were real null-deref bugs" is. The linter is a tool for catching defects, not a proxy for whoever holds the config file's commit access.

---

## Real-World Examples

**The type-aware rule that paid for itself.** A TS team enabled `@typescript-eslint/no-floating-promises` (a type-checked rule). It tripled lint time but caught dozens of unawaited async calls — a class of bug that had caused two production data-loss incidents. They scoped it to source (not tests) to bound the cost and gated it. Decidability + measured value justified the latency.

**The suppression spike that exposed a bad rule.** A Go team noticed `//nolint:gosec` density doubling in a quarter. Investigation showed `gosec`'s G104 (unhandled errors) was firing on intentional best-effort `defer x.Close()` calls. They scoped G104 away from defers rather than letting the team paper over it — and the suppression count fell back to baseline.

**The formatter ended the quote war.** A repo had three ESLint style rules (`quotes`, `semi`, `comma-dangle`) that generated endless review nits. Deleting all three and adopting Prettier eliminated the entire category of diagnostic and review comment overnight. Style was never the linter's job.

**Lint time as a PR tax.** A monorepo's Pylint run hit 9 minutes and people stopped running it locally. Switching to Ruff dropped it to ~8 seconds; local runs resumed and the CI signal arrived in time to matter. No config change could have closed that gap — the tool was the bottleneck.

---

## Mental Models

- **Decidability sets the ceiling.** A rule can be no more reliable than the property it checks is decidable. Gate the decidable; measure the heuristic.
- **A rule is an investment with externalities.** Its noise taxes every other rule by eroding attention.
- **Severity is a cost decision.** `error` spends a release-blocking option; only buy it for rules worth stopping for.
- **Earliest reliable point wins.** Shift checks left until they'd be slow or flaky, then stop.
- **Suppressions are a signal, not just an escape hatch.** Their trend tells you which rules are mis-tuned.
- **The linter has no authority of its own.** It says what someone configured it to say. Demand a rationale.

---

## Common Mistakes

- **Gating a heuristic rule** as if it were decidable — random PR blocks erode trust faster than any bug.
- **A bloated Advise tier** of warnings nobody acts on, drowning the few that matter.
- **Letting lint time grow unbounded** until the local run dies and CI becomes the only (and slowest) signal.
- **Ignoring suppression trends** — missing the codebase telling you a rule is wrong.
- **Style rules in the linter** that a formatter should own, producing churn and review nits.
- **Monotonic rule sets** that only grow, with no process to remove a rule that's stopped earning its keep.
- **"The linter says so"** used to win an argument the configurer should actually have to justify.

---

## Test Yourself

1. Why can "is this code dead?" never be a fully sound *and* complete static rule? Which theorem bounds this?
2. Write the value equation for a rule and explain why the "ignored real findings" term makes "enable everything" lose.
3. A candidate rule has measured TPR of 55%. Which severity tier, and what's your follow-up?
4. Give two checks that belong in the editor, two in pre-commit, and two only in CI — and the criterion that sorts them.
5. Your `//nolint:gosec` density doubled this quarter. What does that tell you and what do you do?
6. Why is a file-level `eslint-disable` worse than a line-level one beyond the obvious scope difference?
7. When is tripling your lint time with type-aware rules the right call?

---

## Cheat Sheet

```
Decide gate-ability:  decidable? -> can gate.  heuristic? -> measure TPR first.
Severity policy:      Gate(error) | Advise(warning,tracked) | Off(documented)
Placement (shift-left): editor(ms) -> pre-commit(s, changed files) -> CI(min, full)
```

```bash
# Performance
eslint . --cache
golangci-lint run --new-from-rev origin/main
# Suppression hygiene
eslint . --report-unused-disable-directives
ruff check . --extend-select RUF100
```

| Watch this metric | Healthy signal |
|---|---|
| Per-rule TPR | ≥ 80% for gated rules |
| Warning count trend | flat or decreasing |
| Suppression density / KLOC | stable; spikes flag a bad rule |
| Lint wall-clock | fast enough that locals run it |

---

## Summary

- **Decidability** sets a rule's reliability ceiling; gate decidable rules confidently, measure heuristic ones before gating.
- Treat each rule as an **investment with negative externalities** — noise taxes the whole set; instrument TPR to decide its fate.
- Build the rule set as a **layered system** (correctness / conventions / scoped exceptions) with **zero overlap with the formatter**.
- Use a **Gate / Advise / Off** severity policy and keep the Advise tier from becoming a junk drawer.
- **Shift left**: place each check at the earliest fast, reliable point; keep pre-commit fast or it gets bypassed.
- Manage **performance** (caching, changed-files, fast tools) and **suppressions** (reasons, scope, density trends) as first-class concerns.
- Resist the **linter-as-moral-authority** trap: every gated rule needs a rationale and evidence, not a preference.

---

## Further Reading

- Dominik Honnef — *Staticcheck* design notes on soundness/completeness trade-offs.
- *typescript-eslint* — documentation on type-checked (type-aware) rules and their cost.
- ESLint — `--cache`, `--report-unused-disable-directives`, and shareable configs.
- golangci-lint — `new-from-rev`, caching, and per-linter configuration.
- Henry Ford / lean references on "stop the line" — the gating mindset, applied to CI.

---

## Related Topics

- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — when no off-the-shelf rule encodes your architectural constraint.
- [Formatters](../02-formatters/) — the tool that should own every style rule you delete.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — the strongest class of decidable static checks.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating mechanics, required checks, ratchets.
- [Dead Code & Complexity](../05-dead-code-and-complexity/) — the heuristic-heavy rules and their measurement.
- [Code Quality Metrics](../../code-quality-metrics/) and [Code Review](../../code-review/) — the metric and human systems linting feeds.
