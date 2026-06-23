# Linters & Style Checkers — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Linters & Style Checkers
> *Turning a linter from "tool I run" into a working policy: rule selection, severity, false-positive budgets, and adopting it on a codebase that already exists.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Rule Classes and What They Can Prove](#core-concept-1----rule-classes-and-what-they-can-prove)
5. [Core Concept 2 -- Severity as a Policy Lever](#core-concept-2----severity-as-a-policy-lever)
6. [Core Concept 3 -- The False-Positive Budget](#core-concept-3----the-false-positive-budget)
7. [Core Concept 4 -- Presets and Honest Rule Selection](#core-concept-4----presets-and-honest-rule-selection)
8. [Core Concept 5 -- The Major Tools, Honestly Compared](#core-concept-5----the-major-tools-honestly-compared)
9. [Core Concept 6 -- Adopting a Linter on an Existing Codebase](#core-concept-6----adopting-a-linter-on-an-existing-codebase)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **choosing which rules to enable, setting severities, defending a false-positive budget, and rolling a linter onto a codebase with thousands of existing violations.**

At the junior level you ran a linter and read its output. At this level you *own a configuration*. The hard part is no longer "how do I run it" — it's "which of the 300 available rules should be on, at what severity, and how do I introduce them to a repo that has never been linted without producing a wall of 6,000 errors nobody will fix."

The central insight: **a linter's value is bounded by how much the team trusts its output.** Every false positive spends trust. Every rule that flags taste-as-if-it-were-a-bug spends trust. Your job is to spend that budget on the rules that catch real defects, and to keep the noise low enough that a diagnostic is always worth reading.

---

## Prerequisites

**Required**

- You can run a linter and read its diagnostics (see [Junior](./junior.md)).
- You can edit a config file (`eslint.config.js`, `ruff.toml`, `.golangci.yml`).
- You've worked in a codebase with more than one contributor.

**Helpful**

- Familiarity with your language's AST or at least the idea that rules walk a parse tree.
- Experience with code review — you'll recognize the "style debate" the linter is meant to end.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| Rule set | The full collection of enabled rules with their severities. |
| Preset / shareable config | A curated bundle of rules (e.g. `eslint:recommended`). |
| Correctness rule | A rule that catches genuine bugs, not style. |
| Convention rule | A rule that enforces a team agreement (naming, ordering). |
| False positive | A flagged "problem" that isn't one. |
| True-positive rate | Of all firings of a rule, the fraction that were real problems. |
| Signal-to-noise | Useful diagnostics divided by total diagnostics. |
| Baseline | A recorded snapshot of existing violations, exempted so only *new* ones fail. |
| Severity | `error` / `warning` / `off` — how the linter treats a rule. |
| Flat config | ESLint's modern `eslint.config.js` array-of-objects format. |

---

## Core Concept 1 -- Rule Classes and What They Can Prove

Sort every rule into one of three classes. The class determines how aggressively you should enforce it.

| Class | Question it answers | Example | Default severity |
|---|---|---|---|
| **Correctness** | Is this a bug? | unused variable, `==` vs `===`, unhandled error, unreachable code | `error` |
| **Convention** | Does this match our agreement? | import ordering, naming case, no `console.log` in prod | `warning` or `error` |
| **Style** | Is this how we like it to look? | line length, quote style, trailing commas | hand to a *formatter*; see [Formatters](../02-formatters/) |

What a linter **can prove** vs **only guesses**:

- **Provable (decidable on the AST):** "this variable is declared and never read." "this import is unused." "this `switch` has duplicate cases." These are syntactic facts; the linter is *certain*.
- **Heuristic (the linter guesses):** "this function is too complex." "this `any` is dangerous." "this looks like a hardcoded secret." These rely on thresholds or patterns and *will* sometimes be wrong.

The provable rules are nearly free trust-wise — they rarely false-positive. The heuristic rules are where your false-positive budget gets spent, so treat them with more care.

---

## Core Concept 2 -- Severity as a Policy Lever

Severity is not a description of how you feel about a rule — it's a control on *what blocks a merge*. Three levels, used deliberately:

- **`error`** — blocks CI / blocks merge. Reserve for rules you are willing to stop a release over. Almost always correctness rules.
- **`warning`** — visible but non-blocking. Good for rules you're rolling out, or conventions you nudge toward.
- **`off`** — disabled. An honest, documented "we don't enforce this."

ESLint flat config makes the levers explicit:

```js
// eslint.config.js
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "error",     // correctness — block merge
      "eqeqeq": "error",             // correctness — block merge
      "no-console": "warn",          // convention — nudge, don't block
      "camelcase": "off",            // we use snake_case in this repo
    },
  },
];
```

A common anti-pattern is leaving everything at `warning` "to be safe." Warnings that never block accumulate forever and become invisible. If a rule is worth having, decide: block on it, or turn it off. The pile of permanent warnings is where signal goes to die.

---

## Core Concept 3 -- The False-Positive Budget

This is the most important idea on the page.

**Every false positive spends team trust.** The first time a developer is told "this is a bug" and it isn't, they're annoyed. The third time, they stop reading diagnostics. The tenth time, they add `// eslint-disable` reflexively to anything red — including the real bugs. A linter with a bad signal-to-noise ratio is *worse than no linter*, because it trains the team to ignore static analysis.

So treat false positives as a budget you are spending:

- **Measure it.** When a rule fires, was it right? A rule with a 30% true-positive rate is mostly noise and should be tuned or removed.
- **Prefer provable rules.** They almost never false-positive (Core Concept 1).
- **Be skeptical of "enable everything."** Pylint with all checks on, or ESLint with every plugin's every rule, will bury three real bugs under 500 style nags. The "max strictness" config feels rigorous and is actually counterproductive.

A concrete failure mode: a team enables a "cognitive complexity ≤ 10" rule globally. Their parser and their state machine — legitimately complex by nature — light up red. Developers learn to suppress the rule, and the suppression habit then hides a genuinely over-tangled function later. The rule had a real point but a bad budget; it should have been a `warning`, or scoped away from the parser.

---

## Core Concept 4 -- Presets and Honest Rule Selection

Don't hand-pick 300 rules from scratch. Start from a curated **preset** and adjust:

- **ESLint:** `js.configs.recommended` (the maintainers' "these catch real bugs" set), plus `typescript-eslint`'s recommended set for TS.
- **Ruff:** ships with a sensible default set (roughly pyflakes `F` + a slice of pycodestyle `E`). Opt into more by selecting rule groups:

```toml
# ruff.toml
[lint]
select = ["E", "F", "I", "B", "UP"]  # pycodestyle, pyflakes, isort, bugbear, pyupgrade
ignore = ["E501"]                    # line length — leave it to the formatter
```

- **golangci-lint:** enable a named set of linters explicitly:

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck      # unchecked errors
    - govet         # the standard vet checks
    - staticcheck   # the big one — real bug detection
    - ineffassign   # ineffectual assignments
    - unused        # dead code
```

**Suppression done honestly** is part of selection. When you suppress, scope it as narrowly as possible and say why:

```python
result = compute()  # noqa: F841  -- kept for the debugger; remove before v2
```

```go
//nolint:gosec // G204: command is built from a fixed allowlist, not user input
cmd := exec.Command(bin, args...)
```

A bare `// nolint` with no rule and no reason is a code smell of its own. Reviewers should push back on it.

---

## Core Concept 5 -- The Major Tools, Honestly Compared

| Tool | Ecosystem | Good at | Weak at |
|---|---|---|---|
| **ESLint** (flat config) | JS/TS | Huge rule/plugin ecosystem; the de-facto standard | Config sprawl; slow on big repos; overlaps with formatters historically |
| **golangci-lint** + **staticcheck** | Go | Bundles dozens of linters; `staticcheck` is excellent at real bugs | Tuning which linters to enable takes thought |
| **Pylint** | Python | Deep, thorough, many checks | Slow; noisy by default; high false-positive surface |
| **Ruff** | Python | Extremely fast (Rust-based); replaces flake8 + isort + more | Younger; not 100% feature-parity with Pylint's deepest checks |
| **Clippy** | Rust | Idiomatic-Rust guidance + bug catching; ships with toolchain | Some lints are opinion (`clippy::pedantic`) |
| **Checkstyle** | Java | Style/format conventions | Style only — finds no bugs |
| **PMD** | Java | Source-level bug patterns, complexity | Pattern-based, more false positives |
| **SpotBugs** | Java | Bytecode-level bug detection | Needs compiled classes; dated UI |
| **Error Prone** | Java | Compile-time bug detection, very low false-positive | Google-flavored; build integration effort |

Rules of thumb: in Python, reach for **Ruff** first and add Pylint only for the deep checks Ruff lacks. In Go, **golangci-lint with staticcheck** is the standard. In Java, **Error Prone** (bugs) + **Checkstyle** (style) is a strong pair. In JS/TS, ESLint is unavoidable; pair it with a formatter so ESLint stops arguing about whitespace.

---

## Core Concept 6 -- Adopting a Linter on an Existing Codebase

You enable a good rule set on a 200k-line repo that's never been linted and get **6,200 errors**. CI is red. Nobody can merge. This is the *wall-of-errors problem*, and it kills adoption if handled naively.

Three honest strategies, usually combined:

**1. Autofix the mechanical ones first.** A large fraction are formatting/style and fixable automatically:

```bash
ruff check . --fix
npx eslint . --fix
```

Land that as one clearly-labeled commit (and tell `git blame` to ignore it via `.git-blame-ignore-revs`).

**2. Baseline the rest.** Record the *current* violations and fail CI only on *new* ones, so the repo can move forward while the backlog burns down. golangci-lint has this built in:

```yaml
# .golangci.yml
issues:
  new-from-rev: origin/main   # only report issues introduced in this branch
```

For ESLint, tools like `eslint --quiet` plus a tracked baseline file (or `betterer`) achieve the same. The principle: **stop the bleeding before you treat the wound.**

**3. Adopt incrementally by directory or by rule.** Turn rules on a few at a time, or scope them to new/migrated directories first via config overrides. A rule rolled out as `warning`, then promoted to `error` once the backlog is clear, lands without a revolt.

The order that works: *autofix → baseline → ratchet new code → burn down the baseline → promote severities.*

---

## Real-World Examples

**The 4,000-warning repo.** A team enabled every recommended rule at `warning`. CI never failed, so nobody fixed anything, and the count grew. The fix: pick the ~20 correctness rules, make them `error`, baseline the rest, and delete the permanent-warning category entirely.

**staticcheck finds a real `SA4006`.** Go's staticcheck reports `SA4006: this value of err is never used` — the ineffectual-assignment bug from the junior page — in a payment handler. It had passed all tests because the error path was never exercised. One linter rule, one prevented incident.

**Ruff replaces a four-tool stack.** A Python team was running flake8 + isort + pyupgrade + pydocstyle, each in its own pre-commit hook, total ~40s. Ruff did all of it in under a second with one config, and the faster feedback meant developers actually ran it locally.

**The complexity rule that got disabled.** A "max cyclomatic complexity 8" rule fired on a legitimately complex tokenizer. Rather than tune it, the team disabled it repo-wide — and six months later shipped a genuinely tangled 200-line function the rule would have flagged. The lesson: scope the rule, don't kill it.

---

## Mental Models

- **Trust is a budget; false positives are the spend.** Keep the balance positive or the team stops reading.
- **Severity is a merge policy, not an opinion.** `error` means "I'll block a release for this." If you won't, it's not an error.
- **Provable rules are cheap; heuristic rules are expensive.** Spend your trust budget carefully on the heuristic ones.
- **Stop the bleeding, then treat the wound.** Baseline existing violations so the team can move; burn the backlog down over time.
- **The formatter and the linter are different jobs.** Let the formatter own whitespace so the linter can own bugs.

---

## Common Mistakes

- **Enabling every available rule.** Maximum strictness buries signal in noise and trains the team to ignore output.
- **Parking everything at `warning`.** Non-blocking warnings accumulate into invisibility. Decide: block or off.
- **Turning a noisy rule off globally** instead of scoping it or downgrading it to `warning`.
- **Bare suppressions** (`// nolint`, `# noqa` with no code) that hide unknown problems forever.
- **Big-bang adoption.** Flipping every rule to `error` on a legacy repo produces a red wall and a mutiny. Baseline first.
- **Letting the linter fight the formatter** over quotes and commas — two tools, one decision, endless churn.

---

## Test Yourself

1. Classify each as correctness/convention/style: `eqeqeq`, import ordering, max line length, unused variable.
2. A rule has a 25% true-positive rate. What should you do, and why?
3. Why are "provable" rules cheaper to enable than "heuristic" ones?
4. You enable a good rule set and get 6,000 errors on a legacy repo. Give the three-step adoption plan.
5. What's wrong with leaving every rule at `warning` "to be safe"?
6. When is suppression honest, and what must accompany it?
7. Why should line-length be a formatter's job, not a linter `error`?

---

## Cheat Sheet

```js
// ESLint flat config — severity as policy
rules: {
  "no-unused-vars": "error",  // block merge
  "no-console": "warn",       // nudge
  "camelcase": "off",         // documented opt-out
}
```

```yaml
# golangci-lint — bug-catching set + baseline
linters: { enable: [errcheck, govet, staticcheck, ineffassign, unused] }
issues:  { new-from-rev: origin/main }   # only new violations fail
```

```toml
# ruff.toml — start from default, opt in by group
[lint]
select = ["E","F","I","B","UP"]
ignore = ["E501"]   # line length → formatter
```

| Adoption step | Command / setting |
|---|---|
| Autofix mechanical | `ruff check . --fix` / `eslint . --fix` |
| Baseline existing | `new-from-rev` / betterer |
| Ratchet new code | rule `warning` → `error` once backlog clears |

---

## Summary

- Sort rules into **correctness / convention / style**; enforce by class, and hand style to a formatter.
- **Severity is a merge policy.** `error` blocks; `warning` nudges; `off` is an honest opt-out. Avoid the permanent-warning swamp.
- The **false-positive budget** is the central constraint: every false positive spends trust, and "enable everything" backfires.
- Start from a **preset**, tune deliberately, and suppress **narrowly with a reason**.
- Adopt on legacy code via **autofix → baseline → ratchet → burn down → promote** — never a big-bang flip to `error`.

---

## Further Reading

- ESLint — *Configuration Files (flat config)* and *Configuring Rules*.
- Ruff — *Configuring Ruff* and the rule selection (`select`/`ignore`) docs.
- golangci-lint — *Linters* reference and *new-from-rev*.
- *staticcheck* checks index (the `SA`/`S`/`ST` series).
- Dominik Honnef, *Staticcheck: Things I learned writing a Go linter.*

---

## Related Topics

- [Formatters](../02-formatters/) — own whitespace so the linter can own bugs.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — a separate, stronger class of provable checks.
- [Dead Code & Complexity](../05-dead-code-and-complexity/) — where the heuristic "too complex" rules live.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — where baselining and ratcheting actually run.
- [Code Quality Metrics](../../code-quality-metrics/) and [Code Review](../../code-review/) — the human and metric context around linting.
- The `code-smell-detection` skill — the smell taxonomy many convention rules encode.
