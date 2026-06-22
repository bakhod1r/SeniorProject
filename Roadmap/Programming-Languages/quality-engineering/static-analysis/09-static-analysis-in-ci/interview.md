# Static Analysis in CI — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Static Analysis in CI
> *A question bank for the placement spectrum, baselines/ratchets, blocking vs. advisory, SARIF, suppression discipline, and rolling the program out at org scale.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Baselines & Gating](#baselines--gating)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering, out loud and under pressure, where analyzers belong in the dev loop and how to gate on them without grinding the team to a halt.**

Interviewers probe this topic to see whether you understand *placement economics* (catch it early), the *legacy adoption problem* (baselines/ratchet), and the *human factors* (a check nobody trusts gets ignored). Strong answers are concrete — exact flags, exact failure modes — and acknowledge trade-offs rather than reciting "add a linter to CI."

Each question below gives **Q**, *what's really being tested*, and **A** (a model answer).

---

## Prerequisites

- You can speak to the junior–senior material: the spectrum, pre-commit, CI jobs, baselines, SARIF, suppressions.
- You can sketch a GitHub Actions job and a diff-aware command from memory.
- You understand required status checks live in [Quality Gates](../../quality-gates/), not in the CI YAML itself.

---

## Fundamentals

**Q1. Walk me through where a static-analysis finding can surface, from earliest to latest.**
*Testing: the central placement model and its economics.*
**A.** Editor (instant, advisory, in-loop) → pre-commit hook (fast subset on changed files, before commit, bypassable) → CI (full suite, clean server, authoritative gate). The principle is that the *same* finding should appear as early as possible, because cost grows roughly an order of magnitude at each step: editor ≈ free, CI = a context switch (you've moved on and must return), production = an incident. CI is the **backstop**, not your first contact with a rule. If CI is the first place you saw a finding, that's a signal to shift it left.

**Q2. Why are pre-commit hooks a convenience and not a gate?**
*Testing: understanding what actually enforces policy.*
**A.** Because they run locally and are trivially bypassable — `git commit --no-verify` skips them, and a teammate might never run `pre-commit install` at all. They're valuable for catching obvious issues before they enter history and reducing noise that reaches CI, but they can't *guarantee* anything. The guarantee comes from CI required status checks, which run on a server nobody can skip. Treating hooks as the gate is a classic mistake.

**Q3. What's the difference between a blocking check and an advisory check, and what's the danger with advisory?**
*Testing: gate design and human factors.*
**A.** A blocking check fails the build and locks the merge button (formatting, type errors, high-severity SAST, secrets, critical CVEs). An advisory check only annotates/comments (style nits, low-severity findings). The danger: *a warning that never blocks gets ignored.* Within weeks people scroll past it. So advisory should be deliberate and temporary — typically a rollout phase — not a permanent dumping ground. The honest options for a check are "block it" or "delete it"; permanent-advisory is the same as no check.

---

## Technique

**Q4. Sketch a GitHub Actions job that lints Go and uploads results to code scanning.**
*Testing: can you actually wire it, including SARIF and permissions.*
**A.**
```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    permissions: { security-events: write, contents: read }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }     # need history for merge-base diff
      - uses: actions/setup-go@v5
        with: { go-version: '1.22', cache: true }
      - run: golangci-lint run --out-format=sarif > out.sarif || true
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: out.sarif }
```
Key points I'd call out: `permissions: security-events: write` is required to upload SARIF; `|| true` ensures the upload runs even when findings exist; `cache: true` and parallel jobs keep it inside the time budget; `fetch-depth: 0` enables diff-aware comparison.

**Q5. How do you keep CI static analysis fast enough that people don't route around it?**
*Testing: the time-budget mindset.*
**A.** Past ~10 minutes people stop watching and context-switch, which kills the fast-feedback win. Levers, by impact: cache dependencies/build state; parallelize analyzers into independent jobs (cost = max, not sum); run diff-aware on PRs and full scans nightly/on main; in monorepos, scope to affected targets via the build graph (`nx affected`, `bazel query`); right-size the runner. I treat the time budget as an explicit SLO — a check that blows it is a regression even if it finds real bugs; I'd run it diff-aware or nightly rather than slow the whole suite.

**Q6. What is SARIF and why does it matter?**
*Testing: reporting standardization.*
**A.** SARIF (Static Analysis Results Interchange Format) is a standard JSON schema for analyzer findings — rule ID, message, location, severity, and a stable fingerprint. It matters because it decouples *any* analyzer from *any* reporting backend: every tool emits SARIF, and GitHub code scanning / GitLab ingests it to show inline PR alerts, dedup across runs via fingerprints, and trend over time. It's what lets a polyglot org have one pane of glass instead of ten output formats. It also enables "report broadly, block narrowly" — upload everything for visibility while a separate diff-aware step decides what blocks.

---

## Baselines & Gating

**Q7. You enable a useful rule on a 5-year-old repo and get 8,000 findings. What do you do?**
*Testing: the single most important adoption technique.*
**A.** I do **not** try to fix 8,000 findings or leave the gate red — that's how teams give up and disable the check. I baseline: block only **new** findings and grandfather the existing ones. For Go: `golangci-lint run --new-from-rev=<base>`; Semgrep: `--baseline-commit=<base>`; ESLint via a baseline-subtraction approach. This is the **ratchet** — the count can only hold or improve. Clean PRs pass, the backlog is invisible, and it gets paid down whenever someone touches old code. The mental shift is gating on the *delta* I introduced, not the absolute backlog.

**Q8. For diff-aware analysis, should you compare against `origin/main` or the merge base? Why?**
*Testing: a subtle correctness detail in the ratchet.*
**A.** The **merge base**: `BASE=$(git merge-base origin/main HEAD)`. Comparing against main's *tip* can flag findings introduced by someone else's merge into main as if they were in your PR, because those lines now differ from your branch. The merge base is the point where your branch diverged, so the diff is exactly *your* changes — you're judged only on your own delta. Getting this wrong produces confusing "I didn't write that" failures and erodes trust.

**Q9. Who decides which CI checks actually block a merge, and where does that live?**
*Testing: the boundary with Quality Gates.*
**A.** The CI YAML decides *whether a job passes or fails*; what makes a failing job *block the merge* is a **required status check** in branch protection — that policy lives in [Quality Gates](../../quality-gates/), not in this topic. So this topic owns where/how analyzers run and what they report; Quality Gates owns which checks are required, the exception process, and break-glass. A clean answer keeps those separate and avoids building a second, conflicting governance system inside the analysis tooling.

---

## Scenarios

**Q10. "Passes on my machine, fails in CI." How do you debug it, and how do you prevent it?**
*Testing: config drift diagnosis.*
**A.** Debug: reproduce by running the *exact* command CI ran; check the analyzer **version** (local plugin vs. CI) and the **scope** (hook ran on staged files; CI ran the whole repo). Prevent: one config file per tool checked into the repo, consumed identically by editor, hook, and CI; pin the same analyzer version everywhere. The three layers should differ only in *scope and speed*, never in *what counts as a problem*.

**Q11. A teammate added `/* eslint-disable */` at the top of a 600-line file to make CI green. What's your feedback?**
*Testing: suppression discipline.*
**A.** That's a blanket file-level disable — the canonical smell. It silences the rule for the whole file *including code not yet written*, hiding future real bugs. An honest suppression is scoped (one rule, one line: `// eslint-disable-next-line no-await-in-loop`), reasoned (a comment saying *why* it's correct), and auditable. I'd ask them to either fix the findings or add scoped, reasoned suppressions for the genuinely-justified cases. I'd also note that the finding count now *looks* clean while the debt hides in the disable — which is why I track suppression growth as a metric.

**Q12. Security wants to turn on a new SAST rule and block on it org-wide, starting Monday. How do you advise them?**
*Testing: the rollout sequence and program-trust thinking.*
**A.** Don't go straight to blocking. Run it **advisory** first for a couple of weeks to measure the false-positive rate on real code. If it's noisy (say 25%), tune it before it ever blocks anyone — a noisy check that blocks poisons trust in *every* SAST check. Then **baseline** existing findings (diff-aware), then **block** as a required check, then pay down. Roll out one check at a time and watch metrics at each step. Going advisory → baseline → block is what makes strict analysis socially acceptable instead of a revolt.

**Q13. CI keeps failing intermittently on the SAST job; the team just hits re-run. What's the real problem and the fix?**
*Testing: flakiness and program credibility.*
**A.** The real problem isn't the lost minutes — it's that re-run-on-red becomes a reflex that generalizes to *real* failures, killing the gate. Likely cause: the tool fetches rule packs over the network or is nondeterministic. Fixes: pin versions and vendor the rule pack; make analysis deterministic (sorted, no time/network dependence); split "infra failure → auto-retry" from "finding → fail" so a finding never gets silently re-run away; quarantine the flaky check to advisory with a ticket until fixed. A red check must mean something *every* time or it means nothing.

---

## Rapid-Fire

**Q14. Tool that runs hooks on staged files in JS?** lint-staged (with husky managing the Git hook); lefthook is a polyglot alternative.

**Q15. Flag to skip pre-commit hooks?** `git commit --no-verify`.

**Q16. golangci-lint flag for "new findings only"?** `--new-from-rev=<rev>` (use the merge base).

**Q17. What permission does a GitHub job need to upload SARIF?** `security-events: write`.

**Q18. One blocking check and one advisory check?** Blocking: secrets detected / type errors. Advisory: low-severity style nit.

**Q19. Biggest single CI speed-up?** Caching dependencies and build state.

**Q20. Why `|| true` after the analyzer command before a SARIF upload?** So the upload step still runs when findings exist (analyzer exits non-zero); blocking is decided separately.

**Q21. What does a stable fingerprint give you?** Dedup across runs — the same finding is shown once, recognized even when lines shift, so the PR isn't spammed.

**Q22. Polyglot aggregator dashboard tool?** SonarQube/SonarCloud; reviewdog for lightweight inline comments.

**Q23. The "ratchet" in one sentence?** The finding count can only stay flat or improve — new code is held to the standard, old code grandfathered until touched.

**Q24. What's a "paved road" for static analysis?** A central, versioned reusable workflow + golden configs that make the supported path the easiest path, so teams adopt by default rather than by mandate.

---

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**

- Treats pre-commit hooks as the enforcement mechanism.
- Wants to fix the entire legacy backlog before turning a gate on (doesn't know baselines).
- Goes straight to blocking org-wide with no advisory phase.
- Leaves checks permanently advisory and calls it "gentle."
- Sees nothing wrong with a blanket file-level suppression.
- Tolerates a flaky analyzer / re-run-on-red.
- Puts required-check policy and exceptions inside the CI YAML, duplicating Quality Gates.
- Optimizes "zero findings" without noticing it incentivizes suppressions.

**Green flags:**

- Frames everything around the placement spectrum and the cost curve.
- Reaches for baselines / diff-aware / merge-base immediately for legacy.
- Separates *report broadly* (SARIF, dashboards) from *block narrowly* (the delta gate).
- Names the advisory → baseline → block rollout.
- Has a clear suppression standard: scoped, reasoned, audited.
- Treats CI time as a defended SLO and flakiness as a credibility threat.
- Cleanly delegates required-check policy to Quality Gates.
- Measures program health (catch rate, suppression growth) not vanity counts; mentions Goodhart.

---

## Cheat Sheet

```
SPECTRUM:  editor → pre-commit hook → CI   (catch early; CI is the backstop)
COST:      free   → seconds          → context switch → (prod) incident

GATE:      hooks = convenience (--no-verify);  CI required check = real gate
CLASSIFY:  block (format/type/secrets/critical SAST/CVE)  vs  advisory (nits)
LEGACY:    baseline + diff-aware vs MERGE BASE → block NEW only (ratchet)
           golangci-lint run --new-from-rev=$(git merge-base origin/main HEAD)
REPORT:    SARIF → code scanning; report broadly, block narrowly; fingerprint dedup
SUPPRESS:  scoped + reasoned + audited;  blanket disable = smell;  watch growth
SPEED:     cache > parallelize > diff-aware > affected-targets;  defend the SLO
FLAKY:     pin + deterministic + quarantine; split infra-fail from finding-fail
ORG:       paved road (reusable workflow + golden config);  advisory→baseline→block
POLICY:    required checks/exceptions/break-glass live in Quality Gates, not here
```

---

## Summary

- The spine of every answer is the **placement spectrum** and its **cost economics**: catch the same finding as early as possible; CI is the authoritative backstop.
- Hooks are a **convenience** (bypassable); CI **required checks** are the gate — and that policy lives in [Quality Gates](../../quality-gates/).
- The decisive legacy technique is the **baseline/ratchet**: gate on the **delta vs. the merge base**, block only new findings.
- Classify checks **blocking vs. advisory**, and know that permanent-advisory ≈ no check.
- **SARIF** standardizes reporting; "report broadly, block narrowly"; fingerprints dedup.
- **Suppressions** must be scoped, reasoned, audited; suppression *growth* is a key health metric.
- Defend the **CI-time budget**, kill **flakiness**, and at org scale build a **paved road** with an **advisory → baseline → block** rollout — measuring trust, not vanity counts.

---

## Further Reading

- OASIS SARIF spec; GitHub code scanning + SARIF upload docs.
- golangci-lint `--new-from-rev`; Semgrep diff-aware scanning.
- `pre-commit`, husky + lint-staged, lefthook docs.
- reviewdog; SonarQube/SonarCloud quality gates.
- The `ci-cd-pipeline-design` skill — placing analysis in the pipeline.

---

## Related Topics

- [Quality Gates](../../quality-gates/) — required checks, exceptions, break-glass.
- [Code Coverage](../../code-coverage/) — the new-code coverage gate, same ratchet philosophy.
- [Linters & Style Checkers](../01-linters-and-style-checkers/), [Formatters](../02-formatters/), [SAST Security Scanners](../04-sast-security-scanners/), [Dependency & License Scanning](../06-dependency-and-license-scanning/) — the analyzers you wire into CI.
- Junior → Professional levels of this topic — the full progression behind these answers.
