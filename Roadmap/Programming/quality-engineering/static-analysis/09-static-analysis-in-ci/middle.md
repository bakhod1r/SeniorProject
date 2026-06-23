# Static Analysis in CI — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Static Analysis in CI
> *Wiring linters, type checkers, and SAST into pre-commit and CI — deciding which checks block the build, which only annotate, and how to turn a gate on without fixing 10,000 old findings first.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Placement Spectrum, Revisited](#core-concept-1----the-placement-spectrum-revisited)
5. [Core Concept 2 -- The Pre-Commit Framework in Depth](#core-concept-2----the-pre-commit-framework-in-depth)
6. [Core Concept 3 -- CI Jobs for Lint, Type, SAST, and SCA](#core-concept-3----ci-jobs-for-lint-type-sast-and-sca)
7. [Core Concept 4 -- Blocking vs. Advisory Gates](#core-concept-4----blocking-vs-advisory-gates)
8. [Core Concept 5 -- The Legacy Problem and Baselines](#core-concept-5----the-legacy-problem-and-baselines)
9. [Core Concept 6 -- Keeping CI Fast](#core-concept-6----keeping-ci-fast)
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

> Focus: **operating the full spectrum — a real pre-commit config, CI jobs for each analyzer class, the blocking/advisory distinction, and the baseline pattern that makes adoption possible.**

At the junior level you learned the model: editor → pre-commit → CI, with CI as the authoritative backstop. Now you put it to work. The middle-level skills are: configure a real pre-commit setup that runs only on changed files; stand up CI jobs for linting, type-checking, security (SAST), and dependency scanning (SCA); decide deliberately which of those *fail the build* versus *just comment*; and — the single most important technique in this whole topic — introduce a check to a legacy codebase **without** having to fix the thousands of findings that already exist, by **baselining** them and blocking only what's *new*.

---

## Prerequisites

**Required**

- You've completed the junior level: the placement spectrum, the `pre-commit` framework basics, and reading a CI failure.
- You can edit a GitHub Actions or GitLab CI YAML file and trigger a run.
- You've used at least one linter, formatter, and type checker from the command line.

**Helpful**

- Familiarity with Git refs (`origin/main`, merge bases) — baselines are computed relative to a ref.
- A sense of what SAST and SCA mean (see [SAST Security Scanners](../04-sast-security-scanners/) and [Dependency & License Scanning](../06-dependency-and-license-scanning/)).

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| SAST | Static Application Security Testing — analyzers that hunt for security bugs in source. |
| SCA | Software Composition Analysis — scanning your *dependencies* for known vulnerabilities/licenses. |
| Baseline | A recorded snapshot of *existing* findings, so future runs report only new ones. |
| Diff-aware | A run that only considers changes relative to a base ref (the PR's diff). |
| Ratchet | A policy that only allows the metric to improve — new findings blocked, old ones grandfathered. |
| Blocking gate | A check whose failure stops the merge. |
| Advisory check | A check that reports/annotates but never blocks. |
| Cache | Reusing downloaded deps / analysis state across CI runs to save time. |
| Matrix | Running the same job across several configurations (languages, versions). |
| `--new-from-rev` | golangci-lint flag: report only findings introduced since a given Git revision. |

---

## Core Concept 1 -- The Placement Spectrum, Revisited

The spectrum is the same — editor → pre-commit → CI — but now think about it as a **deduplication problem across three configs**. The cardinal sin is *configuration drift*: your editor runs ESLint with one ruleset, your hook runs another, CI runs a third. When the three disagree, "passes locally, fails in CI" becomes a daily tax.

The fix is a **single source of truth** for each tool's config (`.eslintrc`, `ruff.toml`, `.golangci.yml`), checked into the repo and consumed *identically* by all three layers:

- The editor's plugin reads the same config file.
- The pre-commit hook invokes the same binary against the same config.
- CI invokes the same binary against the same config.

When that holds, the three layers differ only in *scope and speed*, not in *what counts as a problem*. The hook runs a fast subset on changed files; CI runs everything on a clean checkout. Same rules, three checkpoints.

---

## Core Concept 2 -- The Pre-Commit Framework in Depth

A production `.pre-commit-config.yaml` runs several tools, each scoped so the hook stays fast:

```yaml
# .pre-commit-config.yaml
default_install_hook_types: [pre-commit, pre-push]
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-merge-conflict
      - id: check-added-large-files
        args: [--maxkb=500]

  - repo: https://github.com/golangci/golangci-lint
    rev: v1.59.0
    hooks:
      - id: golangci-lint            # runs on changed Go files only

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]                # autofix what it can
      - id: ruff-format

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.4
    hooks:
      - id: gitleaks                 # block secrets before they enter history
```

The framework passes hooks the **list of staged files**, so each tool runs only on what changed — that's what keeps a commit fast. Tools that don't support per-file invocation can set `pass_filenames: false` and scope themselves.

**Other ecosystems:** in JavaScript the common pair is **husky** (manages the Git hook) + **lint-staged** (runs tools on staged files only); **lefthook** is a fast, language-agnostic alternative popular in polyglot repos. They all implement the same idea: *fast, changed-files-only, before commit*.

Remember the boundary: hooks are bypassable (`--no-verify`). They reduce noise reaching CI; they do not replace CI.

---

## Core Concept 3 -- CI Jobs for Lint, Type, SAST, and SCA

In CI you run the **full** suite, usually as parallel jobs so the total wall-clock time is bounded by the slowest one rather than the sum. A GitHub Actions workflow with several analyzer classes:

```yaml
# .github/workflows/static-analysis.yml
name: static-analysis
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
          cache: true                       # cache the module/build cache
      - uses: golangci/golangci-lint-action@v6
        with:
          version: v1.59

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit            # type errors fail the job

  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with:
          config: p/default

  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Trivy vuln + license scan
        uses: aquasecurity/trivy-action@0.24.0
        with:
          scan-type: fs
          scanners: vuln,license
```

Two performance levers appear here and matter a lot:

- **Caching.** `cache: true` / `cache: npm` reuses the dependency and build caches across runs. Without it, half your CI time is re-downloading the world.
- **Parallelism.** Four independent jobs run concurrently. If lint takes 2 min and SAST takes 4 min, the suite finishes in ~4 min, not 6+.

A **matrix** runs one job across several configs — e.g. type-checking on Node 18, 20, and 22, or linting each language in a polyglot monorepo.

---

## Core Concept 4 -- Blocking vs. Advisory Gates

Not every finding deserves to stop a merge. The discipline is to **classify** checks:

| Class | Examples | Behaviour |
|---|---|---|
| **Blocking** | Formatting drift, compile/type errors, high-severity SAST, secrets detected, known-critical CVE in a dependency | **Fail the build.** Merge button locked. |
| **Advisory** | Style nits, low-severity SAST, complexity warnings, "consider refactoring" | **Annotate the PR.** Never blocks. |

How blocking is *enforced* is not in the YAML — it's in **required status checks** (branch protection). Marking the `lint` job as required is what actually locks the merge button. That policy machinery lives in [Quality Gates](../../quality-gates/); here you just decide *which jobs* should be required.

**The hard truth about advisory checks:** *a warning that never blocks gets ignored.* If a check only ever comments and never fails anything, within weeks the team learns to scroll past it. So advisory should be a *deliberate, temporary* status (e.g. "we're rolling this out, watch the noise for two weeks") or reserved for genuinely subjective nits — not a permanent dumping ground for checks you couldn't be bothered to make pass. The senior level covers the rollout sequence that resolves this tension.

---

## Core Concept 5 -- The Legacy Problem and Baselines

Here is the situation that defeats most static-analysis rollouts: you turn on a useful new rule, and CI reports **8,000 findings** across code nobody has touched in years. You cannot fix them all before merging, and you cannot leave the gate red forever. Teams that hit this usually just *turn the check off* — and lose the value entirely.

The technique that solves it: **baseline the existing findings and block only NEW ones.** This is the "ratchet" — the count can only go down or stay flat; every *new* commit must be clean, while history is grandfathered.

**Go (golangci-lint), diff-aware against the main branch:**

```bash
# Report ONLY findings introduced by this branch since it diverged from main.
golangci-lint run --new-from-rev=origin/main
```

This computes the diff against `origin/main` and suppresses any finding on a line you didn't change. A teammate's 8,000 historical issues are invisible; your three new ones block the build.

**Other tools, same pattern:**

```bash
# Semgrep, diff-aware: scan only what changed vs. the base ref.
semgrep ci --baseline-commit=$(git merge-base origin/main HEAD)

# ESLint with a baseline file (modern ESLint / via eslint-plugin-baseline-style tools)
# 1. snapshot existing findings once:
eslint . --format json > eslint-baseline.json
# 2. on each run, subtract the baseline and fail only on net-new findings.
```

The mental shift: you are not gating on *the absolute number of findings*; you are gating on *the delta you introduced*. This makes it possible to adopt a strict ruleset on a messy codebase **today**, then pay down the baseline gradually whenever someone touches old code.

---

## Core Concept 6 -- Keeping CI Fast

CI static analysis competes with developers' patience. Past roughly **10 minutes**, people stop watching the run and start multitasking — which reintroduces the context-switch cost you were trying to avoid. Levers, cheapest first:

- **Cache** dependencies and analysis state (shown above). Biggest single win.
- **Parallelize** independent analyzers into separate jobs.
- **Run diff-aware on PRs** (only changed files / `--new-from-rev`), and run the full scan on a schedule or on `main`.
- **Scope to affected targets** in a monorepo — only analyze the packages your change touches (Bazel/Nx/Turborepo can compute this).
- **Don't cry wolf.** A flaky analyzer that fails intermittently trains people to hit "re-run" reflexively, which is just as bad as a slow run. Pin versions and quarantine flaky checks.

---

## Real-World Examples

**Onboarding a new linter on a 5-year-old repo.** You enable `errcheck` in golangci-lint; full run shows 1,200 unchecked errors. Instead of a 1,200-line PR, you switch CI to `golangci-lint run --new-from-rev=origin/main`. The gate is green, and from now on every PR that *adds* an unchecked error fails. The backlog gets chipped away as files are edited.

**The advisory check nobody reads.** A team added a complexity warning as advisory "to start gently." Six months later it has 400 annotations and zero have been fixed. Lesson: pick a target, baseline the rest, and *block* on new — advisory-forever is the same as not having the check.

**Passes in the hook, fails in CI.** The hook ran ESLint on staged files; CI ran it on the whole repo and found an error in a file the dev hadn't staged. Both used the same `.eslintrc` — the difference was scope. Expected behaviour: the hook is a fast subset; CI is authoritative.

---

## Mental Models

- **Single source of truth, three checkpoints.** One config file per tool, consumed identically by editor, hook, and CI. Drift is the enemy.
- **The ratchet.** Findings can only get better, never worse. New code is held to the standard; old code is grandfathered until touched.
- **Delta, not absolute.** Gate on what *this change* introduced, not on the total backlog. This is what makes strict rules adoptable.
- **Patience budget.** CI has a time budget (~10 min). Spend it; don't blow it.

---

## Common Mistakes

- **Trying to fix the whole backlog to turn a gate on.** This is the mistake baselines exist to prevent. Baseline first, pay down later.
- **Config drift across layers.** Three different rulesets guarantee "works on my machine." Share one config.
- **No caching.** Re-downloading dependencies every run; CI takes 12 minutes; people stop watching.
- **Permanent advisory checks.** A warning that never blocks is decoration. Decide: block it or delete it.
- **Serial jobs.** Running lint, then type, then SAST sequentially when they could run in parallel.
- **Tolerating a flaky analyzer.** "Just re-run it" is how teams learn to ignore CI entirely.

---

## Test Yourself

1. Why must the editor, the pre-commit hook, and CI share one config file? What goes wrong if they don't?
2. Give one blocking check and one advisory check, and justify each classification.
3. You enable a rule and get 8,000 findings on legacy code. What's the technique, and what's the exact golangci-lint flag?
4. What two CI levers most reduce wall-clock time, and why?
5. Why is a permanently-advisory check often no better than having no check at all?

---

## Cheat Sheet

```bash
# Pre-commit (changed files, fast subset)
pre-commit run --all-files
git commit --no-verify              # bypass (emergencies)

# Baseline / diff-aware (block NEW findings only)
golangci-lint run --new-from-rev=origin/main
semgrep ci --baseline-commit=$(git merge-base origin/main HEAD)

# Reproduce a CI job locally
golangci-lint run                   # full run, like CI's main-branch scan
npx tsc --noEmit
```

| Check | Typical class |
|---|---|
| Formatting | Blocking (auto-fixable, zero ambiguity) |
| Type errors | Blocking |
| High-severity SAST / secrets | Blocking |
| Critical CVE in dependency | Blocking |
| Style nits, low-severity SAST | Advisory (and ideally baselined → blocking) |

---

## Summary

- Share **one config per tool** across editor, hook, and CI; they differ in scope and speed, not in what's a problem.
- A real **pre-commit** config runs several tools on changed files; husky+lint-staged and lefthook are the JS/polyglot equivalents.
- In CI, run analyzers as **parallel, cached jobs**; use a matrix across languages/versions.
- **Classify** checks into blocking vs. advisory; enforce blocking via required status checks (see Quality Gates). A permanent advisory check gets ignored.
- **Baselines / diff-aware runs** (`golangci-lint --new-from-rev`, Semgrep `--baseline-commit`) let you adopt strict rules on legacy code by gating on the *delta*, not the backlog. This is the key adoption technique.
- Keep CI under the patience budget with caching, parallelism, diff-aware runs, and monorepo affected-targets.

---

## Further Reading

- golangci-lint docs — `--new-from-rev` and the "new issues" workflow.
- Semgrep CI / diff-aware scanning documentation.
- `pre-commit`, husky + lint-staged, and lefthook documentation.
- GitHub Actions caching and matrix strategy guides.
- The `ci-cd-pipeline-design` skill — fitting analysis jobs into a full pipeline.

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — what the `sast` job runs.
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — the `sca` job.
- [Linters & Style Checkers](../01-linters-and-style-checkers/) and [Formatters](../02-formatters/) — the `lint`/format checks.
- [Quality Gates](../../quality-gates/) — required status checks and blocking policy.
- Senior level of this topic — baselines at scale, SARIF/aggregation, suppression discipline, CI-time budgets.
