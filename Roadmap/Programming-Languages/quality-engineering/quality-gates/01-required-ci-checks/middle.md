# Required CI Checks — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Required CI Checks
> *The junior page said "make the tests block the merge." This page is about the machinery that makes that sentence true: the check API a status flows through, the branch-protection rule that reads it, why renaming a job silently strands every PR, and how to keep the blocking set fast, reliable, and free of flakes — because a required check is a tax every teammate pays on every PR.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Status / Check API: What a "Check" Actually Is](#core-concept-1--the-status--check-api-what-a-check-actually-is)
5. [Core Concept 2 — Branch Protection: How a Status Becomes a Gate](#core-concept-2--branch-protection-how-a-status-becomes-a-gate)
6. [Core Concept 3 — Designing the Required Set](#core-concept-3--designing-the-required-set)
7. [Core Concept 4 — Pre-Commit vs CI: Layered Enforcement](#core-concept-4--pre-commit-vs-ci-layered-enforcement)
8. [Core Concept 5 — Security Checks as Gates](#core-concept-5--security-checks-as-gates)
9. [Core Concept 6 — Speed: The Required-Check Budget](#core-concept-6--speed-the-required-check-budget)
10. [Core Concept 7 — Flaky Required Checks: The Team-Wide Tax](#core-concept-7--flaky-required-checks-the-team-wide-tax)
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

> Focus: **How does a required check actually work, and how do I design a set that protects the branch without grinding the team to a halt?**

At the junior level a required check is "the green tick that has to be there before Merge un-greys." That model is correct but it can't yet explain *why* a job that ran perfectly yesterday now reports as **Expected — Waiting for status to be reported** and freezes every open PR, *why* the platform team tells you to take your end-to-end suite *out* of the required set, or *why* one intermittently-failing test costs the whole team an afternoon.

The answers live one layer down: in the **check API** that a result travels through, the **branch-protection rule** that reads that result by *name*, and a small set of engineering disciplines — fast, reliable, actionable — that separate a required check that protects the codebase from one that just punishes it. This page makes that machinery concrete with real GitHub Actions workflows, a real branch-protection configuration, a `.pre-commit-config.yaml`, and a security-scan job you can lift directly.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say what a quality gate is and why CI gates a merge.
- **Required:** You can write a basic GitHub Actions (or GitLab CI) workflow — jobs, steps, `runs-on`.
- **Helpful:** You've configured branch protection on at least one repository, even a personal one.
- **Helpful:** You've been blocked by a flaky test and felt the cost firsthand.

---

## Glossary

| Term | Meaning |
|---|---|
| **Commit status** | The original, flat GitHub API: a `state` (`success`/`failure`/`pending`/`error`) attached to a commit SHA under a string **context**. |
| **Check Run** | The newer, richer API: a check tied to a commit with a `name`, `status`, `conclusion`, annotations, and a re-run button. GitHub Actions jobs surface here. |
| **Context / check name** | The *string identity* a branch-protection rule matches against. This is what "required" is keyed on — not the workflow, the **name**. |
| **Branch protection rule** | Per-branch policy that can require checks, reviews, linear history, and up-to-date branches before merge. |
| **Required check** | A check whose passing `conclusion` is a precondition for merge, enforced server-side — the merge button stays disabled without it. |
| **Strict / up-to-date** | "Require branches to be up to date" — the PR branch must contain the latest base commit before merge, re-running checks against it. |
| **Advisory check** | A check that runs and reports but does **not** block merge. Signal without veto. |
| **Quarantine** | Moving a flaky test/check out of the blocking set (with a fix ticket) so it stops blocking the team while staying visible. |
| **Shift-left** | Catching a class of failure earlier — e.g. in a local pre-commit hook instead of in CI. |

---

## Core Concept 1 — The Status / Check API: What a "Check" Actually Is

A green tick is not a primitive. It is a row written through one of **two distinct GitHub APIs**, and knowing which one you're looking at explains most "why is this stuck" mysteries.

**Commit Statuses** — the original API. You `POST` a `state` to a commit SHA under a free-form **context** string:

```bash
# A bare commit status, posted by any token with repo:status scope
curl -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/acme/web/statuses/$SHA \
  -d '{"state":"success","context":"ci/coverage","description":"82% (+0.3%)","target_url":"https://..."}'
```

The context (`ci/coverage`) *is* the identity. There is no concept of steps, annotations, or a re-run button — it's a flat key→state map per commit. External tools (older Jenkins, Codecov, custom scripts) still post here.

**Check Runs** — the richer API that GitHub Actions uses. A Check Run has a `name`, a lifecycle `status` (`queued` → `in_progress` → `completed`), a `conclusion` (`success`, `failure`, `cancelled`, `skipped`, `timed_out`, `neutral`), inline file **annotations**, and a **Re-run** button. When your Actions workflow defines `jobs: build:`, each job becomes a Check Run whose name defaults to the job's display name.

> **Key insight:** Branch protection does not care which API produced the result. It matches on the **string name/context** and reads the pass/fail. Both APIs converge to the same question the gate asks: *"Is there a successful result for the name I require, on this commit?"* If no result with that exact name ever arrives, the gate waits forever — `Expected`.

The practical consequence is the single most common required-checks outage:

```yaml
# .github/workflows/ci.yml
jobs:
  unit-tests:          # ← branch protection requires the NAME "unit-tests"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
```

If branch protection requires `unit-tests` and someone renames the job to `unit`, the check `unit-tests` is *never reported* on new commits. GitHub doesn't error — it sits at **Expected — Waiting for status to be reported**, and every PR is stuck until you either rename the job back or update the rule. Renaming a required job is a breaking change to the merge gate.

---

## Core Concept 2 — Branch Protection: How a Status Becomes a Gate

A status by itself is inert; it's a label on a commit. It becomes a *gate* only when a **branch protection rule** (or its modern superset, a **ruleset**) names it as required. The relevant toggles:

- **Require status checks to pass before merging** — the core switch. You then pick the named checks that must be `success`.
- **Require branches to be up to date before merging** (the *strict* flag) — the PR branch must contain the latest commit on the base branch; merging an out-of-date branch is blocked until you update it, which **re-runs the required checks** against the new merge result.

Here is the rule expressed via the API (the same shape the UI writes):

```bash
curl -X PUT \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/acme/web/branches/main/protection \
  -d '{
    "required_status_checks": {
      "strict": true,
      "checks": [
        { "context": "build" },
        { "context": "unit-tests" },
        { "context": "lint" },
        { "context": "type-check" }
      ]
    },
    "required_pull_request_reviews": { "required_approving_review_count": 1 },
    "enforce_admins": true,
    "restrictions": null
  }'
```

Two things deserve emphasis. First, `enforce_admins: true` — without it, admins can merge red, and "required" quietly becomes "required for everyone but the people most likely to be in a hurry." Second, the `"strict": true` flag has a hidden cost that scales badly.

**The cost of strict up-to-date with many PRs.** With `strict` on, only a branch built on the *current* `main` may merge. So PR A merges, advancing `main`; now PRs B, C, D are all out of date and must each update + re-run the full required suite; B merges, advancing `main` again, and C, D must update + re-run *again*. On a busy repo this becomes a serialized convoy where each merge invalidates everyone behind it — CI minutes balloon and the queue crawls.

> **Key insight:** `strict` buys you a real guarantee — *the exact code that merges was tested against the exact base it merges into*, eliminating the "two green PRs that conflict semantically and break `main` together" failure. But it serializes merges. The scalable resolution is not to drop the guarantee; it's to hand serialization to a **merge queue**, which batches and tests speculatively so contributors stop fighting over who rebases first. That's the subject of [topic 02](../02-branch-protection-and-merge-policies/middle.md).

---

## Core Concept 3 — Designing the Required Set

Not every job deserves veto power. The discipline is to sort jobs into **blocking** (required) and **advisory** (runs, reports, never blocks) against one rule:

> **A required check must be fast, reliable, and actionable.** If it's slow it taxes every PR. If it's flaky it blocks people for reasons unrelated to their change. If a red result doesn't tell the author what to fix, blocking on it just breeds the habit of merging around it.

| Job | Typically | Why |
|---|---|---|
| **Build / compile** | Required | If it doesn't build, nothing else is meaningful. Fast and deterministic. |
| **Unit tests** | Required | Fast, reliable, directly tied to the diff. The backbone gate. |
| **Lint** | Required | Seconds to run, deterministic, the diff caused it. |
| **Format check** (`prettier --check`, `gofmt -l`) | Required | Near-instant, zero false positives, mechanically fixable. |
| **Type-check** (`tsc --noEmit`, `mypy`) | Required | Catches a whole class of bugs cheaply and deterministically. |
| **Fast integration tests** | Required | If they're reliable and bounded in time. |
| **Full E2E / browser suite** | Often advisory | Slow and the most flake-prone; blocking on it taxes and frustrates everyone. Gate it pre-deploy or via merge queue instead. |
| **Informational scans** (perf trend, bundle-size report) | Advisory | Useful signal; not a per-PR veto. Surface as a PR comment. |

The cost of getting the boundary wrong runs both ways. Make the set too thin and `main` breaks anyway, eroding trust in the green tick. Make it too thick — fold in the 25-minute E2E suite and three slow scanners — and you've built a gate people route around: they merge admin, disable the check "just this once," and the protection decays. **A gate is only as strong as the team's willingness to keep it on.**

---

## Core Concept 4 — Pre-Commit vs CI: Layered Enforcement

Fast feedback and hard enforcement are different jobs, and they belong in different layers.

**Local hooks** (the [`pre-commit`](https://pre-commit.com/) framework, or `husky` + `lint-staged`) run on the developer's machine before a commit or push. They give *shift-left* feedback in seconds — fix the formatting now, not after a 6-minute CI round-trip. A `pre-commit` config:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-merge-conflict
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff            # lint
      - id: ruff-format     # format
  - repo: local
    hooks:
      - id: type-check
        name: mypy
        entry: mypy .
        language: system
        pass_filenames: false
```

```bash
pre-commit install        # wire it into .git/hooks
pre-commit run --all-files
```

The JS equivalent — `husky` runs the hook, `lint-staged` runs tools only on staged files so it stays fast:

```jsonc
// package.json
{
  "lint-staged": {
    "*.{js,ts,tsx}": ["eslint --fix", "prettier --write"]
  }
}
```

But local hooks share one fatal property: **they are bypassable.** `git commit --no-verify` (or `-n`) skips every hook, no permission required. They are a convenience, not a control.

> **Key insight:** Treat local hooks as a *fast mirror* of CI, never as a *substitute*. Anything that **must** hold — the format check, the lint rules, the type-check — runs in CI as a required check too. The hook makes the common case fast; the CI job makes the guarantee real. Same tool, two layers: the hook so you find out in seconds, the gate so `--no-verify` can't smuggle it past.

The matching CI job for the config above:

```yaml
jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - uses: pre-commit/action@v3.0.1   # runs the SAME .pre-commit-config.yaml in CI
```

Now the exact hooks a developer can skip locally are re-run server-side where they can't be skipped. Lint and format defined *once*, enforced in *both* places.

---

## Core Concept 5 — Security Checks as Gates

Security scanning belongs in the gate, but blocking indiscriminately is the fastest way to get the whole gate disabled. The categories and the blocking decision:

| Category | Tools | Block or advise? |
|---|---|---|
| **Secret scanning** | gitleaks, trufflehog, GitHub secret scanning + **push protection** | **Block.** A leaked credential is already a live incident — never let it land. |
| **SAST** (static app security testing) | CodeQL, Semgrep | Block on **high/critical**; advise the rest. |
| **Dependency / vuln scanning** | Dependabot, `npm audit`, `govulncheck`, Snyk | Block on **critical** (especially reachable/exploitable); advise lower severities. |
| **License compliance** | `license-checker`, FOSSA | Block disallowed licenses (e.g. GPL in a proprietary product); advise the rest. |

The governing principle:

> **Key insight:** Block on **secrets and critical, reachable vulnerabilities**; make everything else advisory. A gate that fails on every transitive `moderate` advisory trains the team to ignore it — and a security gate the team has learned to ignore is worse than none, because it manufactures false confidence. Reserve the veto for the failures that are unambiguous and urgent; report the rest as signal.

A required secret-scan + SAST job:

```yaml
# .github/workflows/security.yml
name: security
on: [pull_request]

permissions:
  contents: read
  security-events: write   # CodeQL/Semgrep upload SARIF to the Security tab

jobs:
  secret-scan:             # REQUIRED — a leaked secret must never merge
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }       # scan full history of the PR range
      - uses: gitleaks/gitleaks-action@v2
        env: { GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }} }

  sast:                    # REQUIRED on high/critical; lower severities are advisory
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@v3

  deps:                    # ADVISORY — report, don't block, on non-critical
    runs-on: ubuntu-latest
    continue-on-error: true            # informational: failure won't fail the job
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=critical   # only criticals exit non-zero
```

GitHub **secret scanning push protection** is the strongest variant: it rejects the *push* if a known secret pattern is detected, so the credential never reaches the server in the first place — prevention rather than after-the-fact detection. Enable it at the org or repo level alongside the gitleaks gate (defense in depth: push protection catches known providers; gitleaks catches custom patterns).

---

## Core Concept 6 — Speed: The Required-Check Budget

Required checks run on **every PR and every push** to it. Their wall-clock time is multiplied by your team's PR throughput and paid in human waiting. So a required suite has a **budget** — pick one and defend it. A useful target: **required checks complete in under ~10 minutes**; past that, context-switch cost dominates and people stop waiting for green before moving on.

The levers, roughly in order of payoff:

- **Parallelize jobs.** Independent jobs (`lint`, `type-check`, `unit`) run concurrently on separate runners — total time becomes the *slowest* job, not the *sum*.
- **Cache dependencies and build output.** `actions/cache` keyed on a lockfile hash turns a 90-second `npm ci` into a few seconds on a hit.
- **Shard tests.** Split a 12-minute suite across 4 shards (`--shard=1/4 … 4/4`) on a matrix → ~3 minutes wall-clock.
- **Run only what's affected.** Monorepo tools — Bazel, Nx, Turborepo — and simple `paths:` filters skip work whose inputs didn't change. A docs-only PR shouldn't run the backend test matrix.
- **Fail fast.** `fail-fast: true` on a matrix cancels siblings on the first failure, returning the red signal sooner.

```yaml
jobs:
  test:
    strategy:
      fail-fast: true
      matrix:
        shard: [1, 2, 3, 4]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm                       # restore ~/.npm keyed on package-lock.json
      - run: npm ci
      - run: npx jest --shard=${{ matrix.shard }}/4
```

Path filtering so unrelated PRs skip heavy jobs:

```yaml
on:
  pull_request:
    paths: ['src/**', 'package.json', 'package-lock.json']   # skip on docs-only diffs
```

> **Key insight:** Required-check latency is a *throughput multiplier*, not a per-run cost. A 6-minute suite across a team merging 40 PRs/day is four wasted engineer-hours a day of staring at a spinner — every day. Optimizing the required path is one of the highest-leverage things a platform team does; treat the budget as a tracked SLO, not a vague aspiration. (The full speed-vs-safety trade-off is [topic 05](../05-gate-design-speed-vs-safety/middle.md).)

A caveat on `paths:` filtering and required checks: if a required check is *skipped* because of a path filter, GitHub treats a skipped required check as **not satisfied**, and the PR can hang at `Expected`. The fix is a "stub" job that always reports the required name (returning success on the skip path) — covered in [senior.md](senior.md).

---

## Core Concept 7 — Flaky Required Checks: The Team-Wide Tax

A **flaky** check is one that passes or fails non-deterministically on identical code — the test that fails when two suites race a shared fixture, the E2E that fails when the page renders 50 ms slow. A flaky *advisory* check is an annoyance. A flaky *required* check is a **team-wide tax**: it blocks unrelated PRs at random, and there is no fix the blocked author can make, because their change didn't cause it.

The lifecycle for handling it:

**1. Detect.** A check that *fails, then passes on re-run with no code change* is flaky by definition. Track it: a re-run that flips red→green is a flake signal, not a fluke to ignore. Tooling (CI flaky-test dashboards, or simply logging every retry that changed outcome) turns anecdote into a ranked list of offenders.

**2. Quarantine.** The moment a required test is confirmed flaky, **remove it from the blocking set** and open a fix ticket — same hour, not "next sprint." It moves to a non-required lane (or is `skip`-tagged) so it keeps running and stays visible without holding the whole team hostage. Quarantine is not deletion; it's "stop bleeding now, fix with intent."

> **Key insight:** A flaky required check fails *open* for the team in the worst way — people learn to mash **Re-run** until it goes green. Once "re-run until green" is the reflex, the check has stopped testing anything: a *real* regression also goes green on the third try, because nobody can tell signal from noise anymore. A flaky required check doesn't just waste time — it silently disables the gate it pretends to be.

**3. Auto-retry — carefully.** Automatic retries (`jest --retries`, retry wrappers) hide flakes to keep the pipeline moving, and that's exactly the danger: a retry that masks a flaky test *also* masks a genuinely failing one. If you must auto-retry, do it **narrowly and visibly** — retry only known-flaky tests, and emit a loud warning on every retry so flakiness stays measured, not buried. Blanket "retry the whole suite 3×" converts your test signal into noise and your green tick into a coin flip.

```yaml
# Acceptable: a SINGLE automatic re-run, logged loudly, never silent
- name: tests (with one visible retry)
  run: |
    npm test || {
      echo "::warning::Test suite failed; retrying once — investigate for flakiness."
      npm test
    }
```

---

## Real-World Examples

**1. The renamed-job freeze.** A team requires the check `Tests`. During a refactor someone renames the workflow job to `Unit Tests` for clarity. Instantly every open PR shows **Expected — Waiting for status** and nothing can merge; the new commits report `Unit Tests`, but protection still waits for `Tests`, which never arrives. The fix is one of: rename the job back, or update the rule to the new name (and, going forward, treat required-check names as a stable contract — see the merge-queue and ruleset discussion in [topic 02](../02-branch-protection-and-merge-policies/middle.md)).

**2. The strict-flag convoy.** A repo with 30 active contributors turns on **Require branches to be up to date**. Mornings become a traffic jam: every merge invalidates every other open PR, each must rebase and re-run an 8-minute suite, and people race to be next. CI minutes triple. The resolution isn't to drop the guarantee — it's a **merge queue** that batches PRs and tests them speculatively against the projected base, so contributors stop manually rebasing in a convoy.

**3. The leaked key that almost merged.** A developer commits a `.env` with a live AWS key. The required `gitleaks` job fails the PR; GitHub **push protection** had already flagged it at push time. Because the secret scan is *blocking*, the key never lands on `main`. Contrast a shop where secret scanning is advisory: the key merges, gets pushed to a deploy, and is now a rotation-and-incident exercise instead of a red check.

**4. The flaky test that disabled the gate.** A timing-dependent E2E test, kept required "because it's important," fails ~15% of runs. The team's reflex becomes **Re-run jobs** until green. One Tuesday a *real* regression ships to `main`: the author hit Re-run three times, got a green on the flaky test masking the real one, and merged. The flaky required check didn't protect anything — it had trained everyone to ignore red. Quarantine + a fix ticket would have cost one test's coverage for a few days; instead it cost a production regression.

---

## Mental Models

- **A required check is a tax on every teammate, paid on every PR.** Before you make something required, ask: is it worth charging the entire team this much time, on every change, forever? If it's slow, flaky, or vague, the answer is no — make it advisory.

- **The check name is an API contract.** Branch protection binds to a *string*. Renaming a required job is a breaking API change to your merge gate; treat it with the same care as renaming a public function everyone calls.

- **`strict` (up-to-date) is a serialization lock.** It guarantees you tested exactly what you merge, but it makes merges line up single-file. A merge queue is the concurrent data structure that gives you the guarantee without the lock contention.

- **Local hooks are a fast mirror; CI is the real gate.** The mirror (pre-commit) tells you in seconds. The gate (CI) makes it true even when someone runs `--no-verify`. Define the rule once; enforce it in both.

- **A flaky required check fails open, not closed.** It doesn't make the gate stricter — it teaches the team to re-run until green, which is the same as having no gate, but with extra steps and false confidence.

---

## Common Mistakes

1. **Renaming a required job without updating the rule.** The check name is the binding key. Rename the job → the required check is "missing" → every PR hangs at `Expected`. Update the protection rule in the same change, or don't rename.

2. **Leaving `enforce_admins` off.** "Required for everyone except admins" is "required for nobody who's in a hurry." The people most tempted to merge red are often the ones with admin. Turn it on.

3. **Making the slow E2E suite a required check.** It's the slowest and flakiest thing you own. Blocking every PR on it taxes the team and trains them to route around the gate. Make it advisory or gate it pre-deploy.

4. **Treating pre-commit hooks as enforcement.** `git commit --no-verify` skips them, no permission needed. Hooks are fast feedback; the CI job is the control. Anything that must hold runs in both.

5. **Blocking on every vulnerability and every lint nit.** A gate that fails on transitive `moderate` advisories and stylistic warnings gets disabled "temporarily" and never re-enabled. Block on secrets and criticals; advise the rest.

6. **Auto-retrying the whole suite silently.** Blanket retries hide real failures along with flaky ones and turn the green tick into a coin flip. Retry narrowly, log loudly, and quarantine flakes instead of papering over them.

7. **Skipping a required check via `paths:` and expecting it to pass.** A *skipped* required check counts as *unsatisfied*; the PR hangs. You need a stub that always reports the required name on the skip path.

---

## Test Yourself

1. What's the difference between a *commit status* and a *Check Run*, and what does branch protection actually match on?
2. You renamed a CI job and now every PR is stuck at "Expected — Waiting for status to be reported." What happened, and what are the two fixes?
3. What guarantee does "Require branches to be up to date" buy you, and what is its cost as PR volume grows? What's the scalable resolution?
4. State the three-word rule for what belongs in the required set, and apply it to decide whether a 25-minute E2E suite should block.
5. Pre-commit hooks run lint and format locally. Why must the same lint and format *also* run as a CI required check?
6. For security scanning, which categories should block a merge and which should be advisory — and why does over-blocking backfire?
7. Why is a flaky *required* check worse than a flaky *advisory* one, and what's the first action when you confirm one?

<details>
<summary>Answers</summary>

1. A *commit status* is the flat original API — a `state` under a string *context* on a SHA. A *Check Run* is the richer API (name, conclusion, annotations, re-run button) that Actions jobs use. Branch protection doesn't care which API produced the result; it matches on the **string name/context** and reads pass/fail.
2. Branch protection binds to the job *name*. Renaming the job means the old required name is never reported on new commits, so the gate waits forever (`Expected`). Fix by either renaming the job back, or updating the protection rule to the new name.
3. It guarantees the exact code that merges was tested against the exact base it merges into — killing the "two green PRs that conflict and break `main` together" failure. The cost: it serializes merges (each merge invalidates every other open PR, forcing rebase + re-run), which scales badly. The resolution is a **merge queue** that tests batches speculatively.
4. **Fast, reliable, actionable.** A 25-minute E2E suite is slow and typically the flakiest thing you own, so it fails "fast" and "reliable" — make it advisory or gate it pre-deploy, not on every PR.
5. Local hooks are bypassable with `git commit --no-verify`. The hook is fast feedback; the CI job is the actual enforcement that `--no-verify` can't skip. Define the rule once, enforce it in both layers.
6. **Block:** secrets (a leaked key is a live incident) and critical/reachable vulnerabilities. **Advise:** SAST findings below high, non-critical dependency advisories, most license checks. Over-blocking (failing on every `moderate`) trains the team to ignore the gate, producing false confidence — worse than no gate.
7. A flaky *required* check blocks unrelated PRs at random with no fix the author can make, and trains everyone to "re-run until green" — which hides real regressions too, silently disabling the gate. First action: **quarantine** it (remove from the blocking set) and open a fix ticket immediately.

</details>

---

## Cheat Sheet

```
THE CHECK API
  Commit Status   flat: state + context string on a SHA (older tools)
  Check Run       rich: name + conclusion + annotations + re-run (Actions jobs)
  Branch protection matches on the NAME/context — not the workflow

BRANCH PROTECTION (require checks)
  required_status_checks.checks: [ {context: "build"}, ... ]   ← by NAME
  strict: true        require up-to-date branch (serializes merges → use a queue)
  enforce_admins: true  or "required" means "required except for admins"

DESIGN THE SET  (required = fast + reliable + actionable)
  REQUIRED   build · unit tests · lint · format · type-check · fast integ
  ADVISORY   slow/flaky E2E · perf trend · bundle-size · low-sev scans

LAYERS
  pre-commit / husky+lint-staged   fast, local, BYPASSABLE (--no-verify)
  CI required job                  the real gate — same tools, can't skip

SECURITY GATES
  BLOCK    secrets (gitleaks/trufflehog + push protection) · CRITICAL vulns
  ADVISE   SAST < high · non-critical deps (npm audit/govulncheck) · licenses

SPEED  (budget ~<10 min)
  parallelize jobs · cache deps/build · shard tests · run-only-affected
  fail-fast · paths: filters   (skipped required check = UNSATISFIED → stub it)

FLAKES  (a flaky required check = team-wide tax, fails OPEN)
  detect: red→green on re-run with no code change
  quarantine: pull from required + fix ticket SAME hour
  auto-retry: narrow + loud only; blanket silent retry = coin-flip gate

CLASSIC GOTCHA
  rename a required job → required check "missing" → all PRs stuck at Expected
```

---

## Summary

- A green check is a row written through one of two APIs — flat **commit statuses** or rich **Check Runs** — and branch protection matches on the **string name/context**, not the workflow. This is why renaming a required job strands every PR at `Expected`.
- A status becomes a **gate** only when a branch-protection rule names it required. Set `enforce_admins` or the gate leaks; understand that `strict` (up-to-date) guarantees you tested what you merge but **serializes merges**, which a merge queue ([topic 02](../02-branch-protection-and-merge-policies/middle.md)) resolves.
- Design the required set against one rule — **fast, reliable, actionable.** Build, unit tests, lint, format, type-check block; slow/flaky E2E and informational scans advise. Too thin breaks `main`; too thick gets the gate disabled.
- **Pre-commit hooks** give fast, shift-left feedback but are bypassable (`--no-verify`), so anything that must hold runs in CI too — same tools, two layers.
- **Security gates:** block on secrets and critical vulnerabilities; advise the rest. Over-blocking trains the team to ignore the gate and manufactures false confidence.
- Required checks are a **throughput multiplier** — optimize the path (parallelize, cache, shard, run-only-affected) to a tracked budget, and treat **flaky required checks** as a team-wide tax: quarantine immediately, retry only narrowly and loudly.

---

## Further Reading

- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks) — GitHub's primary docs on required checks and the status/Check Run APIs.
- [pre-commit framework](https://pre-commit.com/) — the multi-language hook manager, with the `.pre-commit-config.yaml` schema and `pre-commit/action` for CI.
- [CodeQL docs](https://codeql.github.com/docs/) and [Semgrep](https://semgrep.dev/docs/) — SAST you can wire as required (high/critical) gates.
- [gitleaks](https://github.com/gitleaks/gitleaks) and [GitHub secret scanning push protection](https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations) — secret detection at scan time and at push time.
- [senior.md](senior.md) — org rulesets and governance, the skipped-required-check stub pattern, merge-queue re-runs against the latest base, and required-check SLOs at scale.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md) — the rule that reads your checks, the `strict`-flag convoy, and merge queues that fix it.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/middle.md) — turning coverage and quality numbers into pass/fail gates without ratcheting noise.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/middle.md) — the full trade-off space behind "required = fast + reliable + actionable."
- [Testing](../../testing/) — the suites that feed your required checks; shaping them to be fast and reliable.
- [Static Analysis & Linting](../../static-analysis/) — the lint, format, type-check, and SAST tools you wire into the gate.
