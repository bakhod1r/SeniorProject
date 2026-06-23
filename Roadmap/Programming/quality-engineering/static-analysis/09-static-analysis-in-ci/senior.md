# Static Analysis in CI — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Static Analysis in CI
> *Making strict analysis stick on a large, messy codebase: ratchet baselines, SARIF and centralized reporting, suppression discipline that survives audit, and a CI-time budget you actually defend.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Ratchet for Legacy at Scale](#core-concept-1----the-ratchet-for-legacy-at-scale)
5. [Core Concept 2 -- SARIF, the Lingua Franca of Findings](#core-concept-2----sarif-the-lingua-franca-of-findings)
6. [Core Concept 3 -- Aggregation and Centralized Reporting](#core-concept-3----aggregation-and-centralized-reporting)
7. [Core Concept 4 -- PR Annotations and Dedup Across Runs](#core-concept-4----pr-annotations-and-dedup-across-runs)
8. [Core Concept 5 -- Suppression Discipline](#core-concept-5----suppression-discipline)
9. [Core Concept 6 -- The CI-Time Budget](#core-concept-6----the-ci-time-budget)
10. [Core Concept 7 -- Diff-Aware and Affected-Targets at Scale](#core-concept-7----diff-aware-and-affected-targets-at-scale)
11. [Core Concept 8 -- Flaky Analyzers and Not Crying Wolf](#core-concept-8----flaky-analyzers-and-not-crying-wolf)
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

> Focus: **the techniques that let strict static analysis survive contact with a real, large codebase — the ratchet, SARIF-based reporting and aggregation, audited suppressions, and a defended time budget.**

At the middle level you can stand up CI jobs and introduce a baseline. The senior job is making the program *durable*: keeping the ratchet honest as dozens of engineers push daily, normalizing findings from a dozen analyzers into one report (SARIF), surfacing them inline on the diff without re-notifying about the same issue every run, holding the line on suppression hygiene so `nolint` doesn't quietly metastasize, and protecting the CI-time budget so the whole apparatus doesn't get bypassed for being too slow. Strategy and org-wide rollout are the professional level; this level is about engineering the machinery correctly.

---

## Prerequisites

**Required**

- Middle level: pre-commit framework, parallel/cached CI jobs, blocking vs. advisory, baselines.
- You can read and write GitHub Actions / GitLab CI YAML and understand required status checks.
- You understand merge bases and diff computation in Git.

**Helpful**

- Exposure to a polyglot or monorepo build (Bazel, Nx, Turborepo).
- Familiarity with at least one SAST tool's output and one aggregator (SonarQube/SonarCloud, reviewdog).

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| SARIF | Static Analysis Results Interchange Format — a JSON schema all analyzers can emit. |
| Code scanning | GitHub's feature that ingests SARIF and shows findings as PR alerts. |
| Ratchet | Policy where the finding count can only decrease or hold; new findings blocked. |
| Fingerprint | A stable hash of a finding so the same issue is deduped across runs. |
| reviewdog | A tool that turns analyzer output into inline PR review comments. |
| Aggregator | A system (SonarQube, etc.) that ingests many analyzers and reports as one. |
| Suppression | An in-code annotation telling an analyzer to ignore a specific finding. |
| Suppression debt | The accumulated, unaudited mass of suppressions across a codebase. |
| Affected targets | The subset of a monorepo a given change can possibly impact. |
| Patience threshold | The CI duration past which developers stop watching and multitask. |

---

## Core Concept 1 -- The Ratchet for Legacy at Scale

A baseline on day one is easy. Keeping the ratchet honest over a year, across many contributors, is the senior challenge. Three failure modes erode it:

1. **Baseline rot.** A static baseline file (a snapshot of findings) drifts: line numbers shift, files move, and the diff becomes noisy. *Mitigation:* prefer **diff-aware computation** (`--new-from-rev=origin/main`, Semgrep `--baseline-commit`) over a checked-in snapshot, so "new" is always computed against live `main`, never a stale file. Where a snapshot is unavoidable (some tools), regenerate it on a cadence and review the diff.

2. **The merge-base trap.** `--new-from-rev=origin/main` compares against the *tip* of main, which can flag findings introduced by *someone else's* merge as if they were yours. Compare against the **merge base** instead so each PR is judged only on its own delta:

```bash
BASE=$(git merge-base origin/main HEAD)
golangci-lint run --new-from-rev="$BASE"
```

3. **Silent ratchet reversal.** Someone bulk-disables a rule or widens a config exclude, and the gate goes green while the backlog grows. *Mitigation:* treat analyzer config and suppression counts as **tracked metrics** (Concept 5) and review config changes like code.

The ratchet's promise to the team: *touch old code, you may have to clean it up; leave it alone, it won't block you.* That asymmetry is what makes a strict ruleset socially acceptable on a codebase you didn't write.

---

## Core Concept 2 -- SARIF, the Lingua Franca of Findings

Every analyzer has its own output format. **SARIF** (Static Analysis Results Interchange Format, an OASIS-standard JSON schema) is the common denominator: a finding has a rule ID, a message, a location (file/region), a severity, and a stable **fingerprint** for deduplication. Emitting SARIF lets you plug *any* tool into *any* reporting backend.

Most analyzers can emit it directly:

```bash
golangci-lint run --out-format=sarif > results.sarif
semgrep --sarif --output=results.sarif
```

Upload it to GitHub code scanning so findings appear as PR alerts and in the Security tab:

```yaml
# .github/workflows/sast.yml  (excerpt)
  sast:
    runs-on: ubuntu-latest
    permissions:
      security-events: write          # required to upload SARIF
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: golangci-lint (SARIF)
        run: |
          golangci-lint run --out-format=sarif > results.sarif || true
      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

Note `|| true`: the upload step must run even when the analyzer found issues, so the findings reach the dashboard. Whether the *job* fails (blocks the merge) is then a separate decision — you can let SARIF report everything for visibility while a different, diff-aware step decides what blocks. This separation — *report broadly, block narrowly* — is a senior signature.

GitLab has the equivalent via report artifacts (`sast`, `dependency_scanning` report types) surfaced in the merge-request widget.

---

## Core Concept 3 -- Aggregation and Centralized Reporting

In a polyglot org, ten analyzers producing ten formats is unmanageable. Two consolidation strategies:

- **SARIF + native code scanning.** Every tool emits SARIF; GitHub/GitLab is the single pane of glass. Cheap, no extra infrastructure, but reporting depth is limited to what the platform offers.
- **A dedicated aggregator (SonarQube / SonarCloud).** A polyglot platform that ingests many analyzers (or runs its own), tracks **trends over time**, computes its own quality gate (e.g. "new code coverage ≥ 80%, zero new bugs"), and gives dashboards across repos. More power, more to operate, and its quality-gate concept overlaps with — and must be reconciled against — your CI required checks and [Quality Gates](../../quality-gates/) policy.

The senior decision is *not* "which tool is best" but *where the authoritative gate lives*. Pick one place that fails the build. If both SonarQube's gate **and** a CI required check can block, you have two sources of truth and confused engineers. Usually: let CI required checks be the gate; let the aggregator be the *dashboard and trend* layer.

For inline reporting without a heavy platform, **reviewdog** is the workhorse: it consumes an analyzer's output and posts it as inline PR review comments, with a `-filter-mode=diff` so it only comments on changed lines — a lightweight, diff-aware annotator.

---

## Core Concept 4 -- PR Annotations and Dedup Across Runs

Findings are only useful if they land **where the engineer is looking** — inline on the diff, on the offending line — not buried in a 4,000-line job log. SARIF + code scanning, or reviewdog, both deliver this.

The subtle problem is **dedup across runs**. Without stable fingerprints, every push re-reports the same finding as if new, and the PR fills with duplicate comments — noise that trains people to collapse the conversation. SARIF's `partialFingerprints` (and the platform's own dedup) tie a finding to a content hash rather than a line number, so:

- An unchanged finding is shown **once**, not on every re-run.
- A finding that *moves* because lines were inserted above it is recognized as the same issue.
- A genuinely *new* finding is the only thing that generates a fresh notification.

When you write or wire custom analyzers (see [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/)), emitting a stable fingerprint is the difference between a tool people trust and a tool people mute.

---

## Core Concept 5 -- Suppression Discipline

Every analyzer offers an escape hatch:

```go
result, _ := doThing() //nolint:errcheck // best-effort cleanup; failure is logged by doThing itself
```
```python
value = cfg["key"]  # type: ignore[index]  # key guaranteed present by schema validation above
```
```java
@SuppressWarnings("unchecked") // reflection boundary; cast verified by the registry contract
List<T> items = (List<T>) raw;
```
```js
// eslint-disable-next-line no-await-in-loop -- sequential by requirement: each call depends on the prior id
const next = await fetchNext(prev.id);
```

An **honest suppression has three properties**:

1. **Scoped** — it disables *one rule* on *one line* (`disable-next-line`, `nolint:errcheck`), never a blanket file-level or repo-level disable.
2. **Reasoned** — it carries a comment explaining *why* this is correct, not just *that* it's suppressed. A bare `//nolint` is a smell; a reviewer can't tell intent from accident.
3. **Auditable** — you can count and review them over time.

A **blanket disable** (`/* eslint-disable */` at the top of a file, a directory-wide exclude in config) is the canonical smell: it silences the rule for code you haven't even looked at yet, including code written *after* the disable.

**Auditing suppressions as a metric.** Count them and watch the trend:

```bash
# How many suppressions, and are they growing?
git grep -c "nolint" -- '*.go' | awk -F: '{s+=$2} END {print s}'
grep -rEn "eslint-disable|# type: ignore|@SuppressWarnings" src/ | wc -l
```

A steadily rising suppression count means the gate is being *routed around* rather than satisfied — the finding count looks great while the real debt hides in annotations. Some teams enforce **expiring suppressions** (a tool or convention that fails the build when a suppression's TODO date passes), forcing a periodic "is this still needed?" review. The goal is not zero suppressions — some are legitimate — it's *zero unexplained, unscoped, unaudited* suppressions.

---

## Core Concept 6 -- The CI-Time Budget

Treat CI duration as a **budget you defend**, not a number you observe. Past the patience threshold (~10 min for the analysis suite; ideful target is well under that), engineers context-switch away, and the fast-feedback advantage you built evaporates. Worse, a slow suite invites bypass culture — admins merge past it "just this once."

Defending the budget, in order of impact:

1. **Cache aggressively** — dependency caches, tool binaries, and incremental analysis state.
2. **Parallelize** analyzers into independent jobs; the suite costs the max, not the sum.
3. **Diff-aware on PRs** — analyze only changed files / new findings; reserve the full scan for `main` or a nightly schedule.
4. **Affected-targets in monorepos** (Concept 7).
5. **Right-size the runner** — a 2× larger runner is often cheaper than an engineer's idle wait.

Publish the budget ("static analysis must complete in under 6 minutes on a PR") as an explicit SLO, and alert when a new check pushes you over it. A check that blows the budget is a *regression*, even if it finds real bugs — find a cheaper way to run it (diff-aware, nightly full scan) rather than letting the whole suite slow down.

---

## Core Concept 7 -- Diff-Aware and Affected-Targets at Scale

On a large monorepo, scanning everything on every PR is both slow and pointless — 95% of the code can't be affected by a three-file change. Two complementary scopings:

- **Diff-aware (file/line level).** Run the analyzer only on changed files (or report only new findings via `--new-from-rev` against the merge base). Good for linters/type checkers where a finding is local to a file.
- **Affected-targets (build-graph level).** Use the build tool's dependency graph (`bazel query`, `nx affected`, `turbo run --filter`) to compute which *packages/targets* a change can impact, and run analysis only on those. Necessary when a change in a shared library should re-analyze its dependents but nothing else.

Combine them: affected-targets narrows *which packages* to look at; diff-aware narrows *which findings* count. On `main` and on a nightly cron, run the **full** scan so nothing hides forever behind diff scoping — diff-aware can miss a finding whose trigger is in unchanged code that interacts with your change.

---

## Core Concept 8 -- Flaky Analyzers and Not Crying Wolf

A check that fails *intermittently* — network timeouts pulling rule packs, a tool that's nondeterministic, a memory limit hit on large files — is corrosive. Every spurious red trains the team to reflexively re-run, and the reflex generalizes: soon *real* failures get a re-run too, and the gate is dead.

Senior hygiene:

- **Pin versions** of every analyzer and rule set. An auto-updating tool that silently adds a rule will "spontaneously" fail builds.
- **Make analysis deterministic** — same input, same output. Sort outputs; avoid time/network dependence in custom rules.
- **Quarantine flaky checks** — move a flaky check to advisory (or off the required list) until fixed, with a tracked ticket, rather than letting it block randomly.
- **Distinguish infra failure from finding failure.** A job that fails because it *couldn't run* (network) should be retried automatically; a job that fails because it *found something* should not. Conflating them teaches re-run-on-red.

The credibility of the entire program rests on this: a red check must *mean something every single time*, or it means nothing.

---

## Real-World Examples

**Report broadly, block narrowly.** A platform team uploads full-repo SARIF from five analyzers to code scanning for visibility, but the *required* CI check runs only `--new-from-rev=$(git merge-base origin/main HEAD)`. Dashboards show the whole landscape; the gate only stops *new* problems. Adoption succeeds because no PR is blocked by ancient debt.

**Suppression debt audit.** A quarterly script counts `//nolint` across the repo; it jumped 40% in one quarter, traced to one team blanket-disabling `errcheck` in a new service. The fix was scoping the suppressions to the genuine best-effort cases and turning the rule back on for the rest — the finding count had looked clean the whole time.

**The flaky SAST job.** A SAST tool fetched rule packs from the network at runtime and failed ~5% of the time. The team pinned the rule pack as a vendored artifact and split "infra error → auto-retry" from "finding → fail." Re-run-on-red culture disappeared within two sprints.

---

## Mental Models

- **Report broadly, block narrowly.** Two different scopes: dashboards see everything; the gate sees only the delta.
- **The ratchet must be tamper-evident.** Track config and suppression counts as metrics; a green gate with rising suppressions is a regression in disguise.
- **A finding is a notification, not a log line.** It must land inline, once, deduped by fingerprint, where the author is looking.
- **Red must always mean something.** The instant a red check is sometimes-noise, every red becomes noise.

---

## Common Mistakes

- **Comparing against main's tip, not the merge base** — blaming a PR for findings someone else merged.
- **Two authoritative gates** — SonarQube's quality gate *and* a CI required check both blocking, with no agreement on which wins.
- **No fingerprint dedup** — the same finding re-comments on every push; the PR becomes unreadable.
- **Blanket file/dir suppressions** — silencing rules for code not yet written.
- **Never auditing suppressions** — finding count looks clean while debt accumulates in `nolint` comments.
- **Letting a check blow the time budget** because "it finds real bugs" — run it diff-aware or nightly instead.
- **Conflating infra failure with finding failure** — training the team to re-run-on-red.

---

## Test Yourself

1. Why compare against the *merge base* rather than `origin/main`'s tip for diff-aware analysis?
2. What is SARIF, and what does "report broadly, block narrowly" mean in terms of SARIF upload vs. the blocking step?
3. Your aggregator (SonarQube) and your CI required checks can both block a merge. Why is that a problem, and how do you resolve it?
4. Give the three properties of an honest suppression. Why is a file-level `eslint-disable` a smell?
5. Suppression count is up 40% but findings are flat. What's happening, and how would you detect it?
6. Why is a flaky analyzer more dangerous to the program than a slow one?

---

## Cheat Sheet

```bash
# Ratchet against the merge base (per-PR delta only)
BASE=$(git merge-base origin/main HEAD)
golangci-lint run --new-from-rev="$BASE"
semgrep ci --baseline-commit="$BASE"

# Emit + upload SARIF (report broadly)
golangci-lint run --out-format=sarif > results.sarif || true
# -> github/codeql-action/upload-sarif@v3

# Audit suppressions (watch the trend)
grep -rEn "nolint|eslint-disable|# type: ignore|@SuppressWarnings" . | wc -l

# Monorepo affected targets
nx affected --target=lint
bazel query 'rdeps(//..., set('"$CHANGED"'))'
```

| Concern | Lever |
|---|---|
| Legacy backlog | Diff-aware ratchet vs. merge base |
| Many formats | SARIF → code scanning, or SonarQube |
| Inline comments | reviewdog / code scanning, fingerprint dedup |
| Escape hatches | Scoped + reasoned + audited suppressions |
| Slow suite | Cache, parallelize, diff-aware, affected-targets |
| Flaky check | Pin versions; quarantine; split infra vs. finding failure |

---

## Summary

- Keep the **ratchet** honest at scale: compute "new" against the **merge base**, prefer diff-aware over snapshot baselines, and treat config/suppression changes as tracked, reviewable metrics.
- **SARIF** normalizes every analyzer's output; upload it for visibility and adopt **report broadly, block narrowly** — dashboards see everything, the gate sees only the delta.
- Consolidate via **SARIF + code scanning** or a **SonarQube-style aggregator**, but keep **one** authoritative gate. Use **reviewdog** / fingerprint dedup so findings land inline, once.
- Enforce **suppression discipline**: scoped, reasoned, audited; blanket disables are a smell; watch the suppression trend and consider expiring suppressions.
- Defend the **CI-time budget** as an SLO; a check that blows it is a regression — run it diff-aware or nightly.
- A **flaky analyzer** kills the program faster than a slow one: pin, make deterministic, quarantine, and split infra failure from finding failure so red always means something.

---

## Further Reading

- OASIS SARIF specification; GitHub "Uploading a SARIF file to code scanning".
- golangci-lint `--new-from-rev` / new-issues docs; Semgrep diff-aware scanning.
- reviewdog documentation; SonarQube/SonarCloud quality gate concepts.
- GitLab merge request report types (SAST, dependency scanning, code quality).
- The `ci-cd-pipeline-design` skill — placing analysis stages and caching in the pipeline.

---

## Related Topics

- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — emitting stable fingerprints from your own rules.
- [SAST Security Scanners](../04-sast-security-scanners/) and [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the deeper analyzers you're reporting.
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA findings in the same SARIF pipeline.
- [Quality Gates](../../quality-gates/) — required checks and the authoritative blocking policy.
- [Code Coverage](../../code-coverage/) — another diff-aware "new code" gate that pairs with these.
- Professional level of this topic — the paved-road strategy, rollout sequence, governance, and program metrics.
