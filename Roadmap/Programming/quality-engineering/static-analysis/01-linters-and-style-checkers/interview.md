# Linters & Style Checkers — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Linters & Style Checkers
> *A question bank that probes whether you understand what a linter can prove, why false positives are the real constraint, and how to roll one out without a revolt.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Signal vs Noise](#signal-vs-noise)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **interview questions on linters across difficulty bands, each with what the interviewer is really probing and a strong-candidate model answer.**

Linter questions look easy and separate candidates fast. Anyone can say "it catches bugs." A strong candidate distinguishes what a linter can *prove* from what it *guesses*, treats the false-positive budget as the central design constraint, names real tools with their trade-offs, and describes a legacy-codebase rollout that doesn't produce a wall of 6,000 errors. This bank is ordered from fundamentals to org-scale governance.

---

## Prerequisites

**Required**

- Working knowledge of at least one linter in production (ESLint, Ruff, golangci-lint, Clippy, or a Java tool).
- The concepts from [Junior](./junior.md) through [Senior](./senior.md): rule classes, severity, false-positive budget, adoption.

**Helpful**

- Having actually rolled a linter onto a legacy codebase — the scenario answers ring hollow without it.
- A mental model of the AST (see [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/)).

---

## Fundamentals

**Q1. What is a linter, and how is it different from a compiler or a test?**

*Testing: do you understand static vs. dynamic and the linter's distinct niche?*

**A.** A linter performs *static analysis*: it reads source code without running it, usually by parsing it into an AST and walking that tree (some checks are pure text patterns). A compiler also reads without running but its job is to *produce a program* and reject only code that can't compile; a linter's job is to flag code that compiles fine but is *likely wrong or non-conforming* — unused variables, `==` vs `===`, ineffectual assignments, style violations. A test runs the code and checks behavior on specific inputs. The three are complementary: the linter catches whole classes of defect statically across all paths at keystroke speed, the test verifies actual behavior on chosen inputs, the compiler guarantees it's a valid program.

---

**Q2. What can a linter prove versus only guess?**

*Testing: do you grasp the decidability ceiling — the single most important conceptual point?*

**A.** Some properties are *decidable* from the AST: "this local is declared and never read," "this import is unused," "two `switch` cases are identical," "there's a statement after an unconditional `return`." A good rule here is effectively certain — it rarely false-positives. Other properties reduce to runtime behavior and are *undecidable in general* (Rice's theorem): "this code is dead," "this is always null here," "this is a security vulnerability." Rules for those are *heuristics* — approximations that trade soundness (catch all) against completeness (only real ones), and they *will* sometimes be wrong. The practical upshot: you can confidently gate decidable rules; heuristic rules you must measure before gating, because their false-positive rate is intrinsic, not a config bug you can eliminate.

---

**Q3. Name the rule classes and how you'd treat each.**

*Testing: can you separate "this is a bug" from "this is taste"?*

**A.** Three classes. **Correctness** rules catch genuine bugs (unused var, `eqeqeq`, unchecked error) — gate them at `error`. **Convention** rules enforce team agreements (import ordering, no `console.log` in prod, no import cycles) — usually `warning`, promoted to `error` only with buy-in. **Style** rules are pure taste (line length, quotes, commas) — these shouldn't be in the linter at all; hand them to a *formatter*, which makes them deterministic and undebatable. Mixing the classes is the root of most linter pain: when a line-length nag blocks a PR with the same severity as a real null-deref, people stop distinguishing and start ignoring everything.

---

**Q4. Walk me through a real diagnostic and what each part means.**

*Testing: have you actually read linter output, or only heard about it?*

**A.** Take golangci-lint:

```
internal/pay/charge.go:42:2: SA4006: this value of `err` is never used (staticcheck)
```

`internal/pay/charge.go:42:2` is file:line:column. `SA4006` is the rule code — staticcheck's "ineffectual assignment" check. The message says an `err` was assigned and then overwritten or never read — a classic Go bug that passes tests whenever the error path isn't exercised. `(staticcheck)` names the sub-linter golangci-lint ran. From that line I can jump to the spot, look up the rule, decide to fix (check the error) or, rarely, suppress with `//nolint:staticcheck // reason`.

---

## Technique

**Q5. How do you choose which rules to enable on a new project?**

*Testing: do you start from evidence and a budget, or from "max strictness"?*

**A.** Start from a curated preset, not from scratch: `js.configs.recommended` (+ typescript-eslint recommended) for JS/TS, Ruff's default set (`F`,`E`) opting into groups like `B`,`I`,`UP`, golangci-lint with `staticcheck`/`errcheck`/`govet`/`ineffassign`/`unused`. Then tune deliberately by class: gate correctness, advise on conventions, delete style rules in favor of a formatter. I explicitly do *not* "enable everything" — maximum strictness buries the three rules that catch real bugs under five hundred that nag about taste, which trains the team to ignore the linter. The selection criterion is the false-positive budget: each rule has to be right often enough that a firing is worth a developer's attention.

---

**Q6. How do you roll a linter onto a large legacy codebase that's never been linted?**

*Testing: the wall-of-errors problem — a top discriminator. Weak candidates say "just fix them all."*

**A.** Never flip everything to `error` at once — that turns CI red and blocks every merge. The sequence: (1) **Autofix the mechanical violations** (`ruff check . --fix`, `eslint . --fix`) and land it as one labeled commit, added to `.git-blame-ignore-revs`. (2) **Baseline the rest** — record existing violations and configure CI to fail only on *new* ones (`new-from-rev: origin/main` in golangci-lint, betterer for ESLint). This stops the bleeding without forcing a giant cleanup. (3) **Ratchet new code** — new/changed code must comply; the backlog is exempt. (4) **Burn the baseline down** opportunistically, often as a boy-scout rule. (5) **Promote severities** (`warning` → `error`) once a rule's backlog is clear. Stop the bleeding, then treat the wound.

---

**Q7. When is suppressing a diagnostic legitimate, and how do you keep it honest?**

*Testing: do you treat suppression as a controlled tool or an escape hatch?*

**A.** Legitimate when it's a genuine false positive or a deliberate, justified exception. Keep it honest by: suppressing the **narrowest scope** (one line, not a file, not the whole rule globally), always with a **reason** comment (`// eslint-disable-next-line no-console -- intentional CLI output`), and **auditing** suppressions — fail CI on bare suppressions (`eslint-comments/require-description`) and on *stale* ones (`--report-unused-disable-directives`, Ruff `RUF100`). I also watch suppression density over time: a spike for one rule usually means that rule is mis-tuned and the team is routing around it, which is my cue to revisit the rule, not to add more suppressions.

---

**Q8. Where in the dev loop should linting run — editor, pre-commit, or CI?**

*Testing: do you understand shift-left and the bypass risk?*

**A.** All three, each doing a different job. The **editor (LSP)** gives millisecond feedback — the squiggle is the highest-leverage placement, catching things before save. **Pre-commit** runs fast, autofixable, changed-files-only checks (`lint-staged`, `pre-commit`, `lefthook`); it must stay sub-few-seconds or developers will `git commit --no-verify` and defeat it. **CI** is the source of truth and the backstop — it runs the full set on every PR and is the only enforceable gate. The principle is shift-left: catch it at the earliest point that's fast and reliable. A rule that only ever fails in CI, minutes after the dev moved on, has poor ergonomics even if it's correct. (Gating mechanics themselves — required checks, branch protection — are their own topic: [Static Analysis in CI](../09-static-analysis-in-ci/).)

---

## Signal vs Noise

**Q9. Why is "enable every rule" a bad idea? Frame it economically.**

*Testing: the false-positive budget as the central design constraint.*

**A.** Because a linter's value is bounded by how much the team trusts its output, and every false positive spends that trust. Each rule's value is roughly `bugs_prevented × cost_per_bug − false_positives × dev_time − real_findings_ignored_due_to_noise − maintenance`. The third term is why "enable everything" loses: a noisy rule doesn't just waste time on its own false positives, it degrades *every other rule* by training the team to skim past diagnostics. Noise has negative externalities across the whole set. A linter with bad signal-to-noise is worse than no linter, because it teaches the team to reflexively suppress red — including the real bugs. So you spend the budget on high-true-positive-rate rules on costly bug classes, and cut the rest.

---

**Q10. How would you decide whether a specific rule is worth keeping?**

*Testing: do you measure, or argue from preference?*

**A.** Measure its true-positive rate. Run it in `warning` mode for a sprint, sample ~30 firings, label each real/false. Roughly: TPR ≥ 80% on a high-cost bug class → promote to `error` gate; 40–80% → keep advisory or scope it to where it's accurate; < 40% → it's a noise generator, tune/scope/cut it. I'd also watch firing volume (high volume × low TPR is a trust hazard) and suppression density (rising = team routing around it). This turns "I feel this rule is good" into evidence — and it's the only defensible answer when a teammate asks why their PR is blocked: "this rule is right 9 times in 10 on bugs that have cost us hours, here's the data."

---

**Q11. A senior keeps adding their style preferences as blocking rules and citing "the linter" in reviews. How do you handle it?**

*Testing: do you recognize the linter-as-moral-authority anti-pattern?*

**A.** The linter has no authority of its own — it says exactly what someone configured it to say. "The linter says so" isn't an argument when *you* configured it to. The fix is governance: every gated rule needs a written rationale and, for heuristic rules, evidence it's worth blocking on (measured TPR, ideally an incident link). "Best practice" and "I prefer it" are not evidence. And pure style preferences shouldn't be gating linter rules at all — they belong to a formatter, which makes them deterministic and removes the debate entirely. The deeper move is separating taste (formatter), convention (discussed, usually advisory), and defect (gated with evidence) so one person's aesthetics can't ride in as everyone's blocked PR.

---

## Scenarios

**Q12. Your team's CI lint step takes 9 minutes and people have stopped running it locally. What do you do?**

*Testing: performance at scale and tool-choice judgment.*

**A.** First diagnose where the time goes. The biggest lever is usually the *tool*: if it's Pylint, moving to Ruff is often a 10–100× wall-clock win at parity for common checks — that alone can take 9 minutes to seconds, and no config tuning competes with it. Beyond tool choice: enable caching (`eslint --cache`, persisted golangci-lint cache), lint only changed files in CI (`new-from-rev`, diff-scoped file lists), and check whether expensive type-aware rules (typescript-eslint `*-type-checked`) are justified everywhere or should be scoped to source. The goal is to get the local and pre-commit runs fast enough that people actually run them — a linter people skip catches nothing.

---

**Q13. You're standardizing linting across 200 repos. How do you ship and evolve the rule set?**

*Testing: org-scale governance and rollout safety.*

**A.** Publish a **versioned shared config** (e.g. `@acme/eslint-config`, a base `ruff.toml` via `extend`, a canonical `.golangci.yml`) that repos *extend and pin* — so a config change is an intentional upgrade, not an overnight CI break. Give it a **named owner** (usually a platform team) and a change process scaled to blast radius: advisory rules via lightweight PR, gating rules via an **RFC** carrying measured TPR, cost, and rollout plan — with both entry *and* exit criteria. Roll out any new gate in **stages**: advise everywhere (this is the measurement phase) → autofix mechanical → baseline existing → gate cohort-by-cohort → burn down. Never flip an `error` rule to all 200 repos at once — that's a self-inflicted org-wide outage. Track adoption (which repos on which version), drift (silent forks), and per-rule TPR. And make rule *removal* normal: a deprecation process keeps the set from ratcheting up into noise forever.

---

**Q14. Leadership asks you to prove the linting program is worth the engineering time. What's your answer?**

*Testing: do you measure value honestly, or fall for Goodhart?*

**A.** I'd give an incident-linked story, not a finding count: "these N gated rules each correspond to a class of incident we've shipped before; last year they fired M times pre-merge at ~90% precision, catching the same class before production." That's defensible. What I'd *avoid* is "we fixed 10,000 warnings" — that's possibly pure churn, and the moment finding-count becomes a target, it gets gamed via blanket suppressions and `--no-verify` (Goodhart's law). The metric to optimize and report is bugs-prevented-per-unit-of-developer-friction, and the supporting data is per-rule true-positive rate plus the incident classes those rules guard.

---

## Rapid-Fire

*Short questions, sharp answers.*

- **`==` vs `===` rule name in ESLint?** `eqeqeq`.
- **Go ineffectual-assignment check?** `ineffassign`, and staticcheck's `SA4006`.
- **Fast Python linter replacing flake8+isort+more?** Ruff.
- **Rust's linter?** Clippy, ships with the toolchain.
- **Java: which tool finds *bugs* vs *style*?** SpotBugs/Error Prone/PMD find bugs; Checkstyle is style only.
- **One rule that's decidable; one that's heuristic?** Decidable: unused import. Heuristic: "this is dead code."
- **Soundness vs completeness?** Sound = no false negatives (catches all); complete = no false positives (only real).
- **Where do style rules belong?** A formatter, not the linter.
- **What does a false positive cost?** Team trust — the linter's whole budget.
- **Stop the wall-of-errors how?** Baseline existing violations; fail only on new.
- **Honest suppression =?** Narrowest scope + a reason + audited for staleness.
- **Bare `// nolint` with no rule/reason?** A code smell; fail review on it.
- **`error` severity means?** Blocks merge — buy it only for rules worth stopping a release for.
- **TPR threshold to gate a rule?** ~80% on a costly bug class.

---

## Red Flags / Green Flags

**Red flags (in a candidate's answers)**

- "Enable every rule for maximum safety." (Misses the false-positive budget entirely.)
- Can't distinguish what a linter proves from what it guesses.
- "Just fix all 6,000 errors" with no baseline/incremental plan.
- Treats style, convention, and correctness rules identically.
- Thinks the linter and formatter are the same tool / should fight over quotes.
- "The linter is the standard" — no notion that someone configured it.
- Measures success by finding counts, blind to Goodhart gaming.

**Green flags**

- Frames decisions around the false-positive budget and TPR.
- Names decidability as the reliability ceiling and gates accordingly.
- Has a real legacy-rollout story: autofix → baseline → ratchet → burn down.
- Sends style to a formatter; gates only evidence-backed correctness rules.
- Suppresses narrowly with reasons and audits suppression trends.
- Thinks about placement (editor/pre-commit/CI) and lint latency.
- At scale: versioned shared config, owner, RFC, staged rollout, removal process.

---

## Cheat Sheet

```
Prove vs guess:  decidable (unused var/import) -> can gate
                 heuristic (dead code/null/vuln) -> measure TPR first
Rule classes:    correctness->gate | convention->advise | style->FORMATTER
False-pos budget: every FP spends trust; noise taxes every other rule
Legacy rollout:  autofix -> baseline(new-from-rev) -> ratchet -> burn down -> promote
Placement:       editor(ms) -> pre-commit(s, changed) -> CI(min, full, gate)
Suppress:        narrowest scope + reason + audit staleness (RUF100, report-unused)
Org scale:       versioned shared config + owner + RFC(evidence) + staged rollout + removal
Value metric:    per-rule TPR + incident linkage, NOT finding counts (Goodhart)
```

---

## Summary

- Lead with **decidability**: a linter can prove some properties (unused var/import) and only guess others (dead code, vuln) — gate the former, measure the latter.
- Make the **false-positive budget** the spine of every answer: each FP spends trust, noise taxes the whole rule set, "enable everything" backfires.
- Separate **correctness (gate) / convention (advise) / style (formatter)** and never treat them alike.
- Have a concrete **legacy-rollout** story (autofix → baseline → ratchet → burn down) and a **placement** model (editor → pre-commit → CI).
- At scale, talk **governance**: versioned shared config, an owner, RFCs with evidence, staged rollout, and a removal process — and measure **TPR/incidents**, not finding counts.

---

## Further Reading

- ESLint, Ruff, golangci-lint, Clippy — official rules references (know one deeply).
- Dominik Honnef — *Staticcheck* notes on soundness/completeness.
- *Software Engineering at Google* — static analysis at scale (Tricorder) and large-scale change.
- Rice's theorem — the decidability bound behind heuristic rules.

---

## Related Topics

- [Formatters](../02-formatters/) — where every style rule you refuse to gate belongs.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — the strongest decidable static checks.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — building the rules no preset ships.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating, required checks, and ratchets.
- [Code Quality Metrics](../../code-quality-metrics/) — the measurement (and Goodhart) backdrop for rule-value claims.
- [Code Review](../../code-review/) — the human gate the linter offloads work from.
