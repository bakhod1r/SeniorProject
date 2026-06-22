# Required CI Checks — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Required CI Checks
> *The middle page showed you how to mark a check required and tune a workflow. This page is about the system underneath: the status/check data model the contract is actually keyed on, why a path-filtered required job deadlocks a PR forever, the `p^k` math that makes "everything required" collapse, and how to treat the required set as a latency SLO rather than a junk drawer of accumulated rules.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Status/Check Data Model](#core-concept-1--the-statuscheck-data-model)
5. [Core Concept 2 — The Required-but-Never-Runs Deadlock](#core-concept-2--the-required-but-never-runs-deadlock)
6. [Core Concept 3 — The Aggregate Gatekeeper Pattern](#core-concept-3--the-aggregate-gatekeeper-pattern)
7. [Core Concept 4 — "Up to Date" Serialization vs Merge Queues](#core-concept-4--up-to-date-serialization-vs-merge-queues)
8. [Core Concept 5 — Speed Engineering the Critical Path](#core-concept-5--speed-engineering-the-critical-path)
9. [Core Concept 6 — Flakiness as a Quantitative Problem](#core-concept-6--flakiness-as-a-quantitative-problem)
10. [Core Concept 7 — Security Gates That Stay Trusted](#core-concept-7--security-gates-that-stay-trusted)
11. [Core Concept 8 — Determinism and the Observability of the Gate](#core-concept-8--determinism-and-the-observability-of-the-gate)
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

> Focus: **Required checks as a system you design and operate — its data model, its failure modes, its latency budget, and its probabilistic behavior at scale.**

By the middle level you can configure required checks: you know required vs advisory, you can mark `build`, `test`, `lint`, and `type-check` as required in branch protection, and you've fought a flaky job or two. That makes you effective on one repository.

The senior jump is that you now own the *gate as a contract* across many repositories and a whole engineering org. The set of required checks is the single most-trafficked piece of infrastructure you own — it sits on the critical path of every merge, every engineer, every day — and almost every property that matters about it is non-obvious from the UI. The contract is keyed on a *string* (the check name) per *commit SHA*, which produces deadlocks the docs don't warn you about. The reliability of the gate is governed by `p^k` compounding, which means adding "one more required check" can quietly make green builds *rarer*. The cost of the gate is a latency SLO, which means parallelism, caching, and test-impact analysis are not optimizations but core design. And security gates have a trust half-life: the day a SAST gate's false-positive rate crosses a threshold, engineers route around it, and a disabled gate protects nothing.

This page is that layer — the data model, the math, and the engineering that keep a required-check system fast, trustworthy, and defensible.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — required vs advisory checks, configuring branch protection, pre-commit vs CI, and the basic shape of a flaky-test problem.
- **Required:** You can read and write a non-trivial GitHub Actions or GitLab CI workflow — jobs, `needs:`/`dependencies:`, matrix builds, `if:` conditions, and path filters.
- **Helpful:** You've operated a merge queue or felt the pain of "require branches up to date" serializing merges on a busy repo.
- **Helpful:** A working sense of the deployment pipeline from [Continuous Delivery](../../release-engineering/) — where in the pipeline a gate belongs and what it costs.

---

## Glossary

- **Commit status** — the original GitHub API model: a `(state, context)` tuple posted against a commit SHA, where `state ∈ {pending, success, failure, error}` and `context` is a free-form string (e.g., `ci/circleci: build`). Flat, no rich UI.
- **Check Run** — the richer GitHub Checks API unit: a named run with status (`queued`/`in_progress`/`completed`), a `conclusion` (`success`/`failure`/`neutral`/`cancelled`/`skipped`/`timed_out`/`action_required`), inline annotations, and a re-run button.
- **Check Suite** — a collection of Check Runs produced by a single app (e.g., the GitHub Actions app) for one commit.
- **Required check / required status check** — a check *name* (status context or Check Run name) that branch protection requires to be `success` on the head commit before merge is permitted.
- **Required-but-never-runs deadlock** — a required check name that, for a given PR, no system ever reports, leaving the PR blocked on an "Expected — Waiting for status" that never resolves.
- **Aggregate / gatekeeper job** — a single required job that `needs:` all real jobs and reports their combined result, decoupling the required-check name from churn in the underlying jobs.
- **Strict / "up to date"** — a branch-protection option requiring the PR branch to contain the latest base commit before merge, forcing a re-test against the new base.
- **Test Impact Analysis (TIA)** — selecting only the tests affected by a change, from a dependency graph between source and tests, instead of running the whole suite.
- **Quarantine** — moving a flaky test out of the blocking required set into a non-gating bucket, with an owner and an SLA to fix and re-promote it.
- **Push protection** — secret-scanning enforcement at `git push` time, rejecting the push before the secret ever lands in history (vs detecting it later on the PR).

---

## Core Concept 1 — The Status/Check Data Model

Everything about required checks follows from one fact: **the contract is keyed on a string, per commit SHA.** Branch protection does not require *a job*, *a workflow*, or *a pipeline*. It requires that a check with a specific *name* report `success` against the *head commit of the PR*. Understanding the two underlying data models and that keying is the difference between configuring gates that work and debugging phantom "waiting" states for an afternoon.

There are two generations of the model on GitHub, and they coexist:

| | Commit Status (legacy) | Check Run (Checks API) |
|---|---|---|
| Unit posted | `(state, context)` on a SHA | named Check Run in a Check Suite |
| Terminal values | `success` / `failure` / `error` | `conclusion`: `success`/`failure`/`neutral`/`cancelled`/`skipped`/`timed_out`/`action_required` |
| Identity used by required checks | the `context` string | the Check Run `name` |
| Rich UI | none (flat list) | annotations, line-level comments, re-run |
| Who posts | webhooks/Status API (older CIs) | GitHub Apps incl. GitHub Actions |

The crucial subtlety lives in the terminal values. For required-check satisfaction, **`neutral` and `skipped` count as "not failing" — they do *not* block merge — but they also are not `success`.** GitHub treats a *required* check that resolves to `success` *or* `skipped`/`neutral` as satisfied; what it will *not* tolerate for a required check is a name that *never reports at all*. That distinction — "reported neutral" vs "never reported" — is the entire ballgame for the deadlock in the next section.

> **Key insight:** A required check is a *promise that a named status will appear and be non-failing on the head SHA*. It is not a promise that a job ran. The instant you internalize that the contract is a `(name, SHA)` lookup, the deadlocks, the aggregate pattern, and the merge-queue re-test all become obvious consequences rather than surprises.

One more consequence of per-SHA keying: every push to the PR creates a *new* head SHA, which means all required checks must report again for that SHA. A check that passed on the previous commit does not transfer. This is why "require branches up to date" (Concept 4) is expensive — it forces a fresh SHA, hence a fresh full run.

---

## Core Concept 2 — The Required-but-Never-Runs Deadlock

This is the single most common self-inflicted outage in a required-check system, and it follows directly from per-name keying.

You make `integration-tests` a required check. To save time, the `integration-tests` job has a path filter so it only runs when `services/**` changes:

```yaml
# THE TRAP — required check + path filter
on:
  pull_request:
    paths: ["services/**"]   # job's workflow only triggers on these paths
jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps: [ ... ]
```

Now someone opens a PR that only edits `README.md`. The workflow's `paths` filter means it **never triggers**, so the `integration-tests` Check Run is **never created**. Branch protection is still looking for a check named `integration-tests` on this SHA. It finds nothing — not a failure, not a neutral, *nothing* — so the PR sits on **"Expected — Waiting for status to be reported"** forever. The merge button is disabled. The author is blocked on a check that, by design, was never supposed to run for this change.

This is a *deadlock*, not a flake. No re-run fixes it, because there is nothing to re-run. The three standard fixes, in increasing order of robustness:

**Fix A — `if:` + always report (per-job).** Keep the workflow triggering always, gate the *work* with `if:`, and emit a synthetic success on the skip path so the name *always* reports:

```yaml
on: pull_request           # always trigger; decide inside
jobs:
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            svc: ["services/**"]
      - if: steps.changes.outputs.svc == 'true'
        run: ./run-integration-tests.sh
      - if: steps.changes.outputs.svc != 'true'
        run: echo "No service changes — integration tests not applicable."
    # job ALWAYS runs and ALWAYS reports success → required check always satisfied
```

**Fix B — sentinel/synthetic job.** A tiny always-running job carries the required *name*; the real work lives in a differently-named, path-filtered job that is *not* itself required. The required name is therefore always reported.

**Fix C — require the aggregate, not the leaf (the right answer).** Don't make `integration-tests` required at all. Make a single `ci-required` gatekeeper job required, and let *it* compute the combined result of whatever did or didn't run (Concept 3). This is the only fix that doesn't multiply as your matrix grows.

> **Key insight:** GitHub's "required" model has no concept of "required *only when applicable*." A required name must resolve on *every* head SHA or the PR deadlocks. Path-filtered jobs and required checks are therefore fundamentally in tension — and the durable resolution is to stop requiring leaf jobs and require an aggregate that is itself unconditional.

A close cousin of this deadlock: a required check whose *workflow file does not exist on the PR's base branch yet* (you added it in the PR) — GitHub may never schedule it for the first run, or schedule it inconsistently. And renaming a required job's `name` without updating branch protection leaves you requiring a name nothing produces — same deadlock, different cause. Both are symptoms of binding protection to volatile leaf names.

---

## Core Concept 3 — The Aggregate Gatekeeper Pattern

The fix for almost every required-check pathology is the same architectural move: **require exactly one job, and make that job a fan-in over all the real jobs.** This decouples the *stable required name* (`ci-required`) from the *churning set of underlying jobs* (matrix shards, OS variants, optional scanners) that change weekly.

```yaml
jobs:
  lint:        { runs-on: ubuntu-latest, steps: [ ... ] }
  unit:        { runs-on: ubuntu-latest, steps: [ ... ] }
  typecheck:   { runs-on: ubuntu-latest, steps: [ ... ] }
  integration: # path-filtered or matrixed — may be skipped/neutral
    runs-on: ubuntu-latest
    steps: [ ... ]

  ci-required:                       # ← the ONLY required check in branch protection
    if: always()                     # MUST run even if dependencies failed/were skipped
    needs: [lint, unit, typecheck, integration]
    runs-on: ubuntu-latest
    steps:
      - name: Decide combined result
        run: |
          # Fail if any needed job FAILED or was CANCELLED.
          # Treat SKIPPED as acceptable (path-filtered, not-applicable).
          results='${{ join(needs.*.result, ",") }}'
          echo "upstream results: $results"
          case "$results" in
            *failure*|*cancelled*) echo "::error::a required upstream job failed"; exit 1 ;;
            *) echo "all required upstream jobs passed or were skipped"; exit 0 ;;
          esac
```

The two non-negotiable details:

1. **`if: always()`** — without it, a *failed* or *skipped* upstream job causes `ci-required` itself to be skipped, and a skipped required job that never *fails* might look "satisfied" while masking an upstream failure. `always()` forces the gatekeeper to run and *decide* on every SHA.
2. **Explicit treatment of `skipped`.** You choose the policy: here, `skipped` is acceptable (the matched-this-PR-didn't-touch-it case), while `failure`/`cancelled` is fatal. A common bug is the naive `if: needs.unit.result == 'success'` chain, which treats a *skipped* path-filtered job as a failure and re-introduces the deadlock from the other side.

The payoff is operational: you can add, remove, rename, shard, and matrix the underlying jobs *all day* without ever touching branch protection, because the required name `ci-required` never changes. The GitHub-recommended pattern for matrices is exactly this — a single "all checks passed" job downstream of the matrix — precisely because requiring each matrix leg (`unit (ubuntu, 3.11)`, `unit (ubuntu, 3.12)`, …) means re-editing protection every time you add a Python version.

> **Key insight:** The required-check *name* is an API your branch protection depends on. Treat it like any other public interface: keep it stable and small (ideally one), and let an aggregate job absorb the churn behind it. "What is required" should be a *policy* decision (the gatekeeper's logic), not a *list of job names* you maintain by hand.

A subtle hazard worth flagging: with the aggregate pattern, if the *whole workflow* fails to trigger (e.g., a YAML parse error, or a fork PR with no permissions), `ci-required` also never reports — and you're back to a deadlock. Defend it by also enabling "require workflows to run" semantics where available, or a scheduled audit (Concept 8) that flags PRs stuck in "Expected" for over N minutes.

---

## Core Concept 4 — "Up to Date" Serialization vs Merge Queues

Branch protection offers "Require branches to be up to date before merging" (the *strict* option). It sounds obviously safe: it guarantees each PR is tested against the *exact* base it will merge into, eliminating the *semantic merge conflict* (two PRs that each pass alone but break when combined — A renames a function, B adds a caller of the old name). The cost is brutal and quadratic in disguise.

With strict mode on a busy repo: PR #1 and PR #2 are both green and up to date. You merge #1. Now #2 is no longer up to date — its base moved. #2 must pull `main`, producing a new SHA, which re-runs *all* required checks. Meanwhile #3…#10 are now also stale. Every merge invalidates every other open PR's "up to date" status. The result is a **thundering herd of re-tests** and a *serialization* of merges: effectively one PR can land per full-CI-duration, because each must re-validate against the freshly-moved base. On a repo doing 200 merges/day with a 20-minute CI, the math doesn't close — engineers spend the day clicking "Update branch" and waiting.

```
strict mode, N PRs ready, CI takes T:
  merge #1  → #2..#N all go stale → each re-runs CI (T) before it can merge
  serialized landing rate ≈ 1 PR per T   (a hard throughput ceiling)
  re-test work ≈ O(N) per merge          (the thundering herd)
```

**Merge queues** solve this without giving up correctness. Instead of testing each PR against the *current* base and racing to merge, the queue *speculatively builds the future*: it forms a candidate sequence `[main + A]`, `[main + A + B]`, `[main + A + B + C]` and tests each *combined* state in parallel. If all pass, they merge as a batch in order. If `B` fails in the `A+B` state, only `B` is ejected and the queue re-forms `A+C`. This gives you the *exact* safety of strict mode (every change is tested against precisely what it merges into) while keeping throughput high through *parallel speculation* rather than *serial re-testing*. Native GitHub merge queue, Mergify, and Bazel-based systems all implement variants of this.

The deep detail covered in [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/senior.md): the queue, not the human, becomes the entity that satisfies required checks — checks run on the *queue's* speculative commits, and your branch-protection required set must be the set the *queue* knows to run. Misconfiguring this (requiring a check the queue doesn't execute on its speculative branches) is its own deadlock.

> **Key insight:** "Require branches up to date" buys correctness with throughput, and the bill is `O(N)` re-tests per merge — a self-inflicted serialization. A merge queue buys the *same* correctness with parallel speculation instead, which is why every high-volume monorepo eventually replaces strict mode with a queue rather than just turning strict off and accepting semantic merge breaks.

---

## Core Concept 5 — Speed Engineering the Critical Path

The required set is on *every developer's* critical path, every merge, every day. Its wall-clock duration is not a build-team metric — it is a **latency SLO for the entire engineering org's flow**. A 25-minute required suite, multiplied by the re-runs strict mode or flakiness forces, is the difference between a team that ships continuously and one that batches. Treat the critical path with the discipline you'd apply to a user-facing p95.

The levers, roughly in order of leverage:

**Parallelism and sharding.** Split a long test suite across N runners (`--shard`, matrix, or test-runner native sharding). The win is bounded by your *slowest shard*, so **shard by historical timing, not by file count** — a "test balancing" step that records per-test duration and packs shards to equal wall-time. Unbalanced sharding leaves one shard at 18 minutes while nine finish in 4.

**Remote build & test caching.** This is the biggest structural lever on a large repo. Bazel/Gradle/Nx/Turbo remote caches mean an unchanged target is *never rebuilt or re-tested* — CI downloads the prior result keyed on a hash of inputs. The GitHub Actions `cache` action does the coarse version (dependency caches, compiled artifacts); content-addressed build systems do the fine-grained version (per-target). The requirement is *hermeticity* (Concept 8): a cache is only safe if identical inputs guarantee identical outputs.

**Test Impact Analysis (run-only-affected).** Build a dependency graph from changed source files to the tests that exercise them, and run only the affected subset on PRs (running the *full* suite on `main` post-merge as a safety net). Nx (`affected`), Bazel (`bazel test` of reverse-dependencies of changed targets), and language-specific tools (e.g., test-impact in .NET, `jest --changedSince`) implement this. TIA can cut a PR's test time by 90%+ on a large monorepo where any single PR touches a tiny fraction of the graph.

**Warm pools.** Cold runner startup, image pulls, and `npm install`/dependency restore can dominate a short job. Pre-warmed runner pools, pre-baked container images with toolchains and dependencies, and persistent caches turn a 90-second cold start into a 5-second warm one. On short jobs this is the majority of wall time.

**Fail-fast vs full-signal.** A genuine trade-off. `fail-fast: true` (matrix default) cancels siblings on the first failure — *fastest feedback*, *least cost*, but the author sees only one failure and may fix it only to hit the next. `fail-fast: false` runs everything for a *complete* failure report — better for "tell me everything wrong at once," worse for latency and cost. The senior choice is usually fail-fast on PRs (fast iteration) and full-signal on the merge-queue/`main` run (complete signal where it counts).

```yaml
strategy:
  fail-fast: true          # PR: stop at first failure for fast feedback
  matrix:
    shard: [1, 2, 3, 4, 5, 6, 7, 8]   # balance by recorded timing, not count
steps:
  - uses: actions/cache@v4
    with: { path: ~/.cache/build, key: build-${{ hashFiles('**/lockfile') }} }
  - run: ./test --shard=${{ matrix.shard }}/8
```

> **Key insight:** The cost of the required gate is *p95 critical-path latency × merge volume × re-run multiplier*. Caching and TIA attack the first factor (do less work); a merge queue attacks the re-run multiplier; warm pools attack the fixed overhead. Optimizing the gate is not gold-plating — every minute on the required path is a minute taxed on every engineer, every day.

---

## Core Concept 6 — Flakiness as a Quantitative Problem

Flakiness is not a nuisance to be tolerated; at scale it is an *arithmetic* that breaks your gate. The model is simple and unforgiving.

Suppose you have `k` independent required checks, each of which passes (when the code is actually correct) with probability `p`. The probability that *all* `k` pass — i.e., that a correct PR comes up green on the first try — is:

```
P(all green) = p^k
```

Run the numbers. A per-check pass rate of **99%** feels excellent. But:

| per-check `p` | k = 5 | k = 10 | k = 20 | k = 50 |
|---|---|---|---|---|
| 0.99 | 95.1% | 90.4% | **81.8%** | 60.5% |
| 0.995 | 97.5% | 95.1% | 90.5% | 77.8% |
| 0.999 | 99.5% | 99.0% | 98.0% | 95.1% |

At `k = 20` required checks each at 99%, **nearly one in five correct PRs fails spuriously** and must be re-run. At `k = 50` it's two in five. The reason "everything required" feels miserable on a big repo is not vibes — it's `p^k` compounding. And note the *feedback loop*: every spurious failure trains engineers to *re-run without reading*, which is exactly how a real failure gets re-run into a green and merged.

This math forces three disciplines:

**A flaky-rate budget.** Decide your target `P(all green)` (say 99%) and your `k`, and that *back-solves* the required per-check reliability. For `k = 50` and a 99% target, each check needs `p ≥ 0.9998` — a *budget*, like an error budget, that any check must meet to stay in the required set. A check that can't meet it gets fixed or quarantined; it does not get to tax everyone.

**Detection.** The clean signal for flakiness is **re-run-and-pass**: a check that fails, then passes on the identical SHA with no code change, is flaky by definition. Instrument this — record every (test, SHA, outcome) and flag any test with both a fail and a pass on the same SHA. Flaky-test dashboards (built in to many platforms; Buildkite Test Analytics, Datadog CI Visibility, or homegrown) rank tests by flip rate so you fix the worst offenders first.

**Quarantine + governance.** When a test is confirmed flaky, *quarantine* it: move it out of the blocking required set into a non-gating bucket (e.g., Bazel `flaky`/`manual` tags, a `@quarantine` annotation the runner excludes from the gate) so it stops failing merges — but **with an owner and an SLA to fix and re-promote it.** Auto-deflake bots can do the mechanical part (detect → open issue → tag quarantine → assign owner). The governance is the hard part: quarantine must be a *temporary* state with a deadline, not a graveyard where coverage quietly dies.

> **Key insight:** Retrying flaky tests *masks* the problem and *spends* reliability you didn't measure. A blanket "retry up to 3×" turns a 90%-reliable test into an apparently-99.9% one — and hides a real regression behind the same retry. Retries are acceptable *only* as a measured, logged signal feeding quarantine, never as a silent band-aid. The honest move is to *quarantine and fix*, because the alternative is a gate that's green by accident.

The deepest danger is the *interaction* with Concept 5: people add retries to hit a latency/pass-rate target, which masks flakiness, which erodes trust, which leads to "just re-run it" culture, which lets real failures through. The math says the only stable equilibrium is *few required checks, each genuinely reliable*.

---

## Core Concept 7 — Security Gates That Stay Trusted

Security checks — SAST, secret scanning, dependency/vulnerability gating — are the required checks most likely to be *added with good intentions and disabled within a quarter*, because they have a brutal trust dynamic: **false positive → ignored → routed around → disabled.** A security gate that engineers don't trust is worse than no gate, because it provides false assurance while training people to click past warnings. The design goal is therefore not "maximum coverage" but "maximum *trusted, acted-on* coverage."

**SAST (CodeQL / Semgrep): required but diff-scoped.** Running a full SAST scan on the whole repo on every PR is slow (latency) and noisy (thousands of pre-existing findings the author didn't cause). The senior pattern is **diff-scoped enforcement**: the gate *fails the PR only for new findings introduced by this diff*, while the full-repo baseline is tracked separately and burned down on its own schedule. This cuts both latency and the false-positive blast radius, and — critically — it ties each finding to a change someone can actually fix *now*.

```yaml
# Diff-scoped SAST: block on NEW findings, not the whole backlog
jobs:
  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # need history for the diff baseline
      - uses: returntocorp/semgrep-action@v1
        with:
          config: p/ci
          # compare against the merge base → only findings the PR introduces gate
        env:
          SEMGREP_BASELINE_REF: ${{ github.event.pull_request.base.sha }}
```

(CodeQL's equivalent: run on `pull_request`, and use the PR-diff alerts / "new alerts in this PR" as the gating signal, while full-database alerts feed the security backlog.)

**Secret scanning: push protection, not just PR scanning.** Detecting a leaked credential on the *PR* is already too late — the secret is in git history, on every fork and clone, and must be *rotated*, not just removed. **Push protection** moves the gate to `git push`: the secret is *rejected before it enters history*. This is a categorical improvement, not an incremental one — it changes the remediation from "rotate the compromised key and rewrite history" to "the leak never happened." Enable push protection org-wide; treat PR-time secret detection as the backstop, not the primary line.

**Dependency / vulnerability gating: policy, not absolutism.** "Block any PR with a CVE" is unworkable — the noise floor of low-severity, unreachable advisories will bury the gate. A defensible policy is *tiered*:

- **Block** on *critical* severity *and* known-exploited (e.g., on the CISA KEV list) vulnerabilities — these are non-negotiable.
- **Advise** (warn, file an issue, but don't block) on the long tail of medium/low advisories.
- **Cut false positives with reachability analysis** — many SCA tools (and tools like Semgrep's reachability, or Endor/Snyk reachability) determine whether the vulnerable *function* is actually called from your code. A CVE in a dependency you import but never exercise on the vulnerable path is *advise*, not *block*. Reachability is the single biggest lever for keeping dependency gates trusted, because it removes the "yes the library has a CVE but we don't even call that code" false alarms that destroy credibility.

**Waivers as code.** Every security gate needs a *legitimate, auditable* escape hatch, or people will build illegitimate ones. Express waivers as version-controlled policy — an allowlist entry with an *expiry date*, an *owner*, and a *justification*, reviewed like any code change — rather than a click-to-dismiss button. This ties directly into [06 — Policy as Code](../06-policy-as-code/senior.md): the gate's rules *and its exceptions* live in Rego/Conftest, are tested, and are reviewable. A waiver with an expiry is a *temporary* exception; a click-to-ignore is a permanent hole.

> **Key insight:** A security gate's value is `coverage × trust`, and trust is the scarce factor. Diff-scoping (act on what's new), reachability (act on what's real), and triage SLAs (act *quickly*) are all mechanisms to keep the false-positive rate below the threshold where engineers stop reading. The day they stop reading, the gate is decorative — so you spend your engineering budget on *precision*, not *recall*.

---

## Core Concept 8 — Determinism and the Observability of the Gate

Two cross-cutting properties separate a required-check system you can trust from one you merely have.

**Determinism / hermeticity.** A required check is only meaningful if *the same input always produces the same result*. A check that passes or fails based on the wall clock, network availability, an unpinned dependency version, ambient environment state, or test-ordering is not a gate — it's a coin flip with extra steps, and it manufactures the flakiness Concept 6 then has to clean up. The discipline is the same one [build-systems reproducibility](../../build-systems/) demands: pin toolchains and dependency versions, run in clean hermetic sandboxes (no network unless explicitly provided), seed any randomness, and isolate tests so order doesn't matter. Hermeticity is also the precondition for *caching* (Concept 5): you can only safely reuse a cached result if identical inputs are *guaranteed* to yield identical outputs. Determinism, low flakiness, and cacheability are three views of the same property.

**Observability — the gate as a service with SLOs.** You cannot manage what you don't measure, and the required set is infrastructure. Track, per required check and for the aggregate:

- **Pass rate** (and specifically the *first-attempt* pass rate vs after-retry — the gap *is* your flake rate).
- **Duration p50 / p95 / p99** — the latency SLO from Concept 5; alert when p95 crosses budget.
- **Flake rate** — re-run-and-pass incidents per 100 runs, per check; this is the input to the quarantine pipeline.
- **"Stuck in Expected" PRs** — a scheduled audit that flags any PR blocked on a required check that hasn't reported in N minutes catches the deadlocks of Concept 2 *before* an engineer files a ticket.

These are *platform SLOs*: the gate has a latency budget, a reliability budget, and an availability budget, exactly like a production service. The aggregate gatekeeper job is a natural place to emit these metrics (it sees every leg's result and timing).

> **Key insight:** A required-check system without observability degrades silently — flakiness creeps up, p95 drifts out, deadlocks accumulate — until trust collapses all at once. Instrument the gate as the production service it is: pass rate, p95 duration, and flake rate are the three numbers that tell you whether your gate is helping or just taxing.

---

## Real-World Examples

**Example 1 — The README-only PR that couldn't merge.** A team made `e2e-tests` required and path-filtered it to `app/**`. Documentation PRs began hanging on "Expected — Waiting for status," and authors learned to make a trivial `app/` edit to "wake up" CI — corrupting their diffs to defeat the gate. The fix was Concept 3: drop `e2e-tests` from required, introduce `ci-required` with `if: always()` over all jobs, and treat `skipped` as acceptable. Doc PRs merged again; the e2e job still ran when it mattered. The lesson the team wrote down: *never make a path-filtered or matrixed job directly required.*

**Example 2 — Strict mode at 150 merges/day.** A monorepo with "require up to date" on and a 22-minute CI ground to a halt mid-morning: every merge invalidated dozens of open PRs, and engineers spent the day in a "Update branch → wait 22 min → someone else merged → repeat" loop. The throughput ceiling (`1 PR / 22 min ≈ 27/day`) was far below demand. Replacing strict mode with the native merge queue — which speculatively batches and tests combined states in parallel — restored throughput *and* kept the semantic-merge safety strict mode was there for. (Detail in [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/senior.md).)

**Example 3 — The `p^k` audit.** A platform team measured first-attempt green rate at 71% and couldn't understand why — every individual check looked "fine." Counting `k = 34` required checks at a median 99% reliability gave `0.99^34 ≈ 71%` — the number matched exactly. They set a per-check flaky budget, quarantined the worst eight offenders (each with an owner + two-week SLA), and collapsed redundant checks via the aggregate pattern down to `k` effective-12. First-attempt green rose to 94% with *no* change to actual code quality — they'd been failing correct PRs by arithmetic.

**Example 4 — The SAST gate everyone ignored.** A full-repo CodeQL gate surfaced 1,800 findings on its first PR run (all pre-existing) and added 14 minutes to every PR. Within three weeks engineers had an "admin merge past CodeQL" ritual. The team re-scoped it to *diff-only* (block on new findings, backlog the rest) and moved the full scan to a nightly run feeding a burndown. New-finding count per PR dropped to single digits, latency to under four minutes, and the gate became trusted enough that nobody bypassed it — *fewer* findings enforced, but every one of them acted on.

---

## Mental Models

- **A required check is a `(name, SHA)` lookup, not "a job ran."** Branch protection asks "is there a non-failing status with this name on this commit?" Every deadlock, the aggregate pattern, and per-push re-runs fall out of that one sentence.

- **Required leaf jobs are a brittle public API; require the aggregate instead.** Job names churn (matrix legs, renames, path filters); branch-protection config shouldn't. One unconditional gatekeeper job absorbs the churn behind a stable name.

- **The required set is a latency SLO on everyone's flow.** Its p95 is taxed on every merge by every engineer. Caching, TIA, sharding, and warm pools aren't optimizations — they're the design.

- **Green-on-first-try is `p^k`.** Reliability *compounds multiplicatively* across required checks. Adding "one more required check" can make green builds *rarer*; the math, not taste, caps how many checks you can require.

- **Retries spend reliability you didn't measure.** A silent retry converts a flaky test into a deceptively-green one and hides real regressions. Retry only as a logged signal feeding quarantine.

- **A security gate's currency is trust, and trust is precision.** Diff-scope, reachability, and fast triage keep false positives below the threshold where people stop reading. Past that threshold the gate is theater.

---

## Common Mistakes

1. **Making a path-filtered or matrixed job directly required.** The classic deadlock: on a PR that doesn't match the filter, the check never reports and the PR hangs on "Expected" forever. Require an `if: always()` aggregate that treats `skipped` as acceptable; never require leaf jobs that can be skipped.

2. **Building the aggregate with `if: needs.x.result == 'success'` chains.** This treats a *skipped* path-filtered job as a failure, re-creating the deadlock from the other side. The gatekeeper must run with `if: always()` and *explicitly* decide that `skipped` ≠ `failure`.

3. **Requiring every matrix leg by name.** `unit (ubuntu, 3.11)`, `unit (ubuntu, 3.12)`, … means editing branch protection every time you add a version. Require one downstream "all checks passed" job over the matrix.

4. **Leaving "require branches up to date" on for a high-volume repo.** It serializes merges (`~1 PR per CI duration`) and triggers `O(N)` re-tests per merge. Use a merge queue, which gives the same correctness via parallel speculation.

5. **"Everything required."** `p^k` collapse: 20+ required checks at 99% each means ~1-in-5 correct PRs fail spuriously, training "re-run without reading." Keep the required set small and genuinely reliable; demote the rest to advisory.

6. **Required flaky E2E tests.** End-to-end tests are the least deterministic and the most expensive — the worst possible thing to put on the blocking path. Run E2E post-merge or in a quarantined/advisory bucket; gate on fast, hermetic unit/integration tests.

7. **Retrying flaky tests silently to hit a pass rate.** Masks regressions and inflates apparent reliability. Quarantine with an owner + SLA instead; if you retry, log it as a flake signal.

8. **A monolith "ci" check (no signal) or 50 micro-checks (config sprawl).** One giant check tells you only "something broke"; fifty required checks are an unmaintainable surface with `p^k` collapse. Aim for a *small* set of *meaningful* checks behind one stable aggregate name.

9. **Full-repo SAST as a blocking PR gate.** Slow and drowns the author in pre-existing findings → routed around → disabled. Diff-scope it; backlog the baseline on its own schedule.

10. **Non-deterministic checks.** A gate that depends on the clock, network, or test order is a coin flip that manufactures flakiness. Hermeticity is the precondition for both trustworthy gating *and* caching.

---

## Test Yourself

1. Branch protection requires a check named `integration`. A PR edits only docs, and `integration` is path-filtered to `services/**`. What state is the PR stuck in, *why* exactly, and what is the most durable fix?
2. Write (or describe precisely) the `if:` condition and the result logic an aggregate `ci-required` job needs so that it (a) always runs and (b) treats a skipped path-filtered upstream job as acceptable but a failed one as fatal.
3. You require 30 checks, each genuinely 99.5% reliable. What's the probability a correct PR is green on the first attempt, and what does that imply for how engineers will behave?
4. Explain why "require branches up to date" serializes merges and produces `O(N)` re-tests, and how a merge queue achieves the *same* correctness without that cost.
5. A teammate proposes adding `retries: 3` to a flaky required test "to stop it blocking merges." Give the precise reason this is dangerous and the alternative that actually fixes it.
6. Why is *push protection* for secrets categorically better than detecting the same secret on the PR? What changes about remediation?
7. Your full-repo CodeQL gate is being bypassed via admin merges within weeks. Diagnose the failure cycle and describe the redesign that restores trust.

<details>
<summary>Answers</summary>

1. The PR is stuck on **"Expected — Waiting for status to be reported."** The workflow's `paths` filter means the `integration` job's Check Run is *never created* for this SHA, so branch protection's `(name=integration, head SHA)` lookup finds *nothing* — not a failure, not a neutral, nothing — and there is no re-run to perform (it's a deadlock, not a flake). Durable fix: stop requiring the leaf job; introduce an `if: always()` aggregate `ci-required` that is itself unconditional and treats the skipped `integration` job as acceptable.
2. `if: always()` (so the job runs even when upstreams failed or were skipped). The logic: fail if any `needs.*.result` is `failure` or `cancelled`; otherwise (including `success` and `skipped`) pass. The trap to avoid is `== 'success'` chains, which wrongly treat `skipped` as failing.
3. `0.995^30 ≈ 0.860` — about **86%**, so roughly **1 in 7 correct PRs fails spuriously**. Engineers will learn to re-run failures reflexively without reading them, which is exactly how a *real* failure gets re-run into a green and merged. The `p^k` math caps how many checks you can require.
4. Strict mode tests each PR against the *current* base; merging any PR moves the base, making every other open PR stale, each of which must pull, get a new SHA, and re-run *all* required checks — `O(N)` re-tests per merge and a throughput ceiling of ~1 PR per CI duration. A merge queue instead *speculatively* builds combined future states (`main+A`, `main+A+B`, …) and tests them in *parallel*, merging the batch in order — identical correctness (each change tested against exactly what it merges into) without the serial re-test.
5. Silent retries *spend reliability you never measured*: 3 retries make a 90%-reliable test look ~99.9%, hiding both the flakiness *and* any genuine regression behind the same retry. The fix is to **quarantine** the test (out of the blocking set) with an *owner and an SLA* to fix and re-promote it; if you retry at all, log each retry as a flake signal feeding the quarantine pipeline — never as a silent band-aid.
6. Detecting a secret on the PR is too late — it's already in git history, on every clone/fork, and must be *rotated*. **Push protection** rejects the push *before* the secret enters history, so the leak never happened: remediation drops from "rotate the compromised key and rewrite history" to "nothing to do." It's a categorical, not incremental, improvement.
7. The cycle: full-repo scan surfaces a huge pre-existing baseline + adds latency → authors see noise unrelated to their diff → they route around it (admin merge) → the gate is effectively disabled. Redesign: **diff-scope** the gate (block only on findings the PR *introduces*), move the full scan to a nightly burndown, and add reachability/triage so the few enforced findings are real. Fewer findings enforced, each acted on → trust restored, bypasses stop.

</details>

---

## Cheat Sheet

```
THE CONTRACT
  required check = (name, head-SHA) lookup → must be non-failing on that SHA
  success / skipped / neutral = NOT blocking;  NEVER-REPORTED = DEADLOCK
  every push = new SHA = all required checks re-report (nothing transfers)

DEADLOCK (required + path filter)
  symptom: "Expected — Waiting for status…" forever (no re-run helps)
  fix A: if: + always-report a synthetic success on the skip path
  fix B: sentinel job carries the required name unconditionally
  fix C (best): require ONE aggregate, not the leaf

AGGREGATE GATEKEEPER (the right default)
  ci-required:  if: always()   needs: [all real jobs]
    fail if join(needs.*.result) contains failure|cancelled
    treat 'skipped' as acceptable    ← do NOT use == 'success' chains
  → stable required name; matrix/jobs churn freely behind it

STRICT vs QUEUE
  "require up to date" → 1 PR / CI-duration + O(N) re-tests per merge
  merge queue → speculative parallel batches (main+A, main+A+B…) = same safety, high throughput

SPEED (critical-path latency SLO)
  shard by RECORDED TIMING (not file count) | remote cache (Bazel/Nx/Turbo/GHA cache)
  test-impact analysis (run-only-affected) | warm runner pools / pre-baked images
  fail-fast on PR (fast) ; full-signal on main/queue (complete)

FLAKINESS MATH
  P(green) = p^k    0.99^20 ≈ 82%   0.99^50 ≈ 60%
  set a per-check flaky budget → back-solve required p
  detect via re-run-and-pass on same SHA → quarantine (owner + SLA) → re-promote
  retries MASK regressions — log them, don't rely on them

SECURITY GATES (value = coverage × TRUST)
  SAST: diff-scoped (block NEW findings; backlog baseline)
  secrets: PUSH PROTECTION (block at push, before history) > PR scan
  deps: block critical+known-exploited; advise the rest; reachability cuts FPs
  waivers as code: expiry + owner + justification (policy-as-code, topic 06)

OBSERVE (gate = a service)
  first-attempt pass rate | p50/p95 duration | flake rate | "stuck in Expected" audit
```

---

## Summary

- A required check is a **`(name, SHA)` contract**: branch protection wants a non-failing status with a specific *name* on the PR's *head commit*. `skipped`/`neutral` don't block; *never-reported* deadlocks the PR. Every property below follows from that.
- **Required leaf jobs + path filters/matrices = deadlocks.** The durable fix is the **aggregate gatekeeper**: one `if: always()` job that fans in over all real jobs, treats `skipped` as acceptable and `failure` as fatal, and gives branch protection a single stable required name to depend on.
- **"Require branches up to date" serializes merges** (`~1 PR / CI duration`) with `O(N)` re-tests per merge; a **merge queue** buys the same semantic-merge safety with parallel speculation instead of serial re-testing.
- The required set is a **latency SLO on every engineer's flow** — attack it with parallel timing-balanced sharding, remote/content-addressed caching, **test-impact analysis**, and warm pools; fail-fast on PRs, full-signal on `main`.
- Flakiness is **arithmetic**: `P(green) = p^k`, so 99% per check at `k = 20` is only ~82% — adding required checks can make green *rarer*. Set a flaky budget, detect via re-run-and-pass, **quarantine with an owner + SLA**, and never let silent retries mask regressions.
- Security gates live or die by **trust = precision**: diff-scope SAST to new findings, use **push protection** for secrets, gate dependencies on critical/known-exploited with **reachability** to cut false positives, and express **waivers as code** with expiry. Keep checks **deterministic/hermetic** (the precondition for both trust and caching) and **observe** the gate as the production service it is.

You now reason about required checks as a *system* — a contract with deadlock modes, a latency budget, probabilistic behavior, and a trust economy. The next layer — [professional.md](professional.md) — is about operating that system across an organization: rollout, governance, cost accounting, and incident response when the gate itself fails.

---

## Further Reading

- [GitHub Checks API — Check Runs and Check Suites](https://docs.github.com/en/rest/checks) — the authoritative data model: statuses, conclusions (`neutral`/`skipped`), and how required-check satisfaction is computed.
- [GitHub — About merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) and the Mergify merge-queue design notes — speculative batching vs strict-mode serialization.
- John Micco (Google), *Flaky Tests at Google and How We Mitigate Them*, and the related research (e.g., *An Empirical Analysis of Flaky Tests*, Luo et al.) — the data behind quarantine and the `p^k` reality at scale.
- [CodeQL documentation](https://codeql.github.com/docs/) and [Semgrep CI / baseline scanning](https://semgrep.dev/docs/) — diff-scoped SAST as a required-but-precise gate.
- [GitHub secret scanning — push protection](https://docs.github.com/en/code-security/secret-scanning/about-push-protection) — blocking secrets at push time rather than detecting them after the fact.
- The matrix "all checks passed" job pattern (GitHub Actions docs / community) — the canonical aggregate-gatekeeper recipe.
- For operating this across an org — cost accounting, rollout, governance — continue to [professional.md](professional.md).

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/senior.md) — how the merge queue becomes the entity that satisfies required checks, and CODEOWNERS/linear-history interplay.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/senior.md) — coverage and complexity as required gates, diff vs absolute, and the Goodhart trap.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/senior.md) — the explicit cost/signal trade-off that decides *which* checks earn a place on the required path.
- [Testing](../../testing/) — the test pyramid that determines which tests are fast and hermetic enough to gate on (and why E2E usually shouldn't).
- [Static Analysis & Linting](../../static-analysis/) — the SAST/lint/type tooling that these required checks invoke, and how to keep its signal high.
