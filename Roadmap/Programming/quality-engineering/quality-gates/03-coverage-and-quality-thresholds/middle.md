# Coverage & Quality Thresholds — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Coverage & Quality Thresholds
> *The junior page argued that "80% coverage" is a vanity number. This page replaces it with a defensible design: gate the **diff**, not the project; ratchet upward, never backward; pair coverage with mutation testing so the gate measures verification rather than execution; and treat noisy performance gates as advisory until the statistics earn them the right to block.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Project vs Patch Coverage, and Why Diff Wins](#core-concept-1--project-vs-patch-coverage-and-why-diff-wins)
5. [Core Concept 2 — The Ratchet: Monotonic Coverage](#core-concept-2--the-ratchet-monotonic-coverage)
6. [Core Concept 3 — Configuring a Real Coverage Gate](#core-concept-3--configuring-a-real-coverage-gate)
7. [Core Concept 4 — Goodhart, Surrogation, and the Mutation-Testing Fix](#core-concept-4--goodhart-surrogation-and-the-mutation-testing-fix)
8. [Core Concept 5 — Other Quality Thresholds as Gates](#core-concept-5--other-quality-thresholds-as-gates)
9. [Core Concept 6 — SonarQube Quality Gates and Clean as You Code](#core-concept-6--sonarqube-quality-gates-and-clean-as-you-code)
10. [Core Concept 7 — Performance Gates and the Noise Problem](#core-concept-7--performance-gates-and-the-noise-problem)
11. [Core Concept 8 — Setting a Defensible Threshold](#core-concept-8--setting-a-defensible-threshold)
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

> Focus: **Which number do I gate on, how do I keep it honest, and how do I set it so the team doesn't disable it?**

At the junior level you learned the trap: a coverage percentage measures which lines *ran*, not which lines were *verified*, and a round target like 80% is a number someone invented, not a number the codebase earned. That diagnosis is correct but it leaves you stuck — you still have to ship a gate, and "don't gate on coverage" is not a policy a reviewer can enforce.

This page is the constructive answer. There are three moves. First, change *what* you measure: gate the **diff** (the lines this pull request touched), not the **project** (the whole repository), so a legacy module with 12% coverage never blocks an unrelated bug fix. Second, change *how* the bar moves: use a **ratchet** so coverage can rise but never fall, which converts a hard absolute target into a soft "leave it better than you found it." Third, change *what coverage means*: pair it with **mutation testing**, which deliberately breaks your code and checks that a test fails — the only automated signal that distinguishes a real assertion from a test that merely executed a line. Around the coverage gate sit sibling gates — complexity ceilings, duplication, lint budgets, bundle size, type coverage, and performance — each with the same failure mode (a too-strict or too-noisy gate gets switched off) and the same cure (base the threshold on current data, scope it to new code).

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why coverage measures execution, not verification.
- **Required:** You can read a CI status check and a pull-request diff, and you've configured at least one [required CI check](../01-required-ci-checks/middle.md).
- **Helpful:** You've run a coverage tool (`go test -cover`, `jest --coverage`, `pytest --cov`, JaCoCo) and seen a coverage report.
- **Helpful:** You've felt the pain of a flaky gate — a check that fails on a re-run with no code change.

---

## Glossary

| Term | Meaning |
|---|---|
| **Project / absolute coverage** | Percentage of *all* lines in the repository covered by tests. |
| **Patch / diff coverage** | Percentage of the lines *added or modified in this change* that are covered. |
| **Ratchet** | A monotonic gate: the metric may improve or hold, never regress below the baseline. |
| **Threshold** | The allowed slack around a target (e.g. coverage may drop at most 0.5% before the gate fails). |
| **Line vs branch coverage** | Line: was this line executed? Branch: was each side of each conditional taken? |
| **Mutation testing** | Inject small faults ("mutants") into code; a test suite "kills" a mutant if some test fails because of it. |
| **Mutation score** | Killed mutants ÷ total non-equivalent mutants — a proxy for how *verifying* the suite is. |
| **Surrogation** | Mistaking the metric for the goal: optimizing coverage instead of correctness. |
| **Clean as You Code** | SonarQube's model: gate on *new* code only; let existing debt decay through normal churn. |
| **benchstat** | Go tool that compares benchmark runs statistically and reports a p-value and delta. |

---

## Core Concept 1 — Project vs Patch Coverage, and Why Diff Wins

Every coverage gate must answer one question before any other: **the percentage of *what*?** There are two answers, and choosing wrong is the single most common reason coverage gates get disabled.

- **Project (absolute) coverage** — the fraction of *every* line in the repository that is covered. Codecov calls this the `project` status. It answers "how well-tested is the whole codebase?"
- **Patch (diff) coverage** — the fraction of *the lines this pull request added or changed* that are covered. Codecov calls this the `patch` status; the standalone tool [`diff-cover`](https://github.com/Bachmann1234/diff_cover) computes the same thing from a coverage report plus a `git diff`. It answers "is the *new* work tested?"

The difference is decisive in any real repository. Suppose the project sits at 62% and someone fixes a one-line null check in a 4,000-line legacy module that has 8% coverage. A *project* gate set at "must be ≥ 65%" blocks this fix — the author is now responsible for the sins of code they didn't write, so they either bolt on a pile of low-value tests for legacy code they don't understand, or (far more likely) they get the gate disabled "just for this PR" and it never comes back. A *patch* gate set at "90% of changed lines covered" asks only: did you test the line you touched? That is a request the author can actually satisfy.

> **Key insight:** Diff coverage is the default-right choice because it scopes responsibility to authorship. It targets new and changed lines, never punishes you for inherited debt, and operationalizes the **Clean as You Code** principle: you can't fix the whole codebase today, but you *can* refuse to make it worse with this change. Absolute coverage is a *health dashboard*; diff coverage is a *gate*. Don't confuse the thermometer with the door.

This does not mean absolute coverage is useless — it's a fine *informational* trend to watch on a dashboard, and a fine thing to ratchet (Concept 2) so it can't slide. But the line that *blocks merge* should almost always be diff coverage. A pragmatic policy: **gate on patch coverage; report project coverage informationally; ratchet project coverage so it can't regress.**

---

## Core Concept 2 — The Ratchet: Monotonic Coverage

A **ratchet** is a gate with a memory. Instead of comparing your number against a fixed target, it compares against the **base** — the coverage of the commit you branched from — and enforces "no worse than base." Coverage can climb freely; it simply may not fall. Like a socket wrench, it turns one way.

This solves the central tension of absolute targets. A hard "≥ 80%" is wrong on both ends: a repo at 95% can rot ten points and still pass, while a repo at 60% blocks every change until someone does a giant test-backfill nobody schedules. A ratchet has no magic number. It says: *wherever you are today is the new floor.* Coverage drifts upward naturally as new code is tested and legacy code is touched, and it can never silently erode.

Codecov implements the ratchet with two settings working together:

- `target: auto` — compare against the base commit's coverage instead of a fixed percentage. "Auto" *means* "no worse than the parent."
- `threshold` — the tolerance band. `threshold: 0.5%` means a drop of up to half a percent passes (so trivial rounding and a deleted well-tested file don't trip the gate), but a real regression fails.

```yaml
coverage:
  status:
    project:
      default:
        target: auto        # ratchet: compare against base commit
        threshold: 0.5%      # allow ≤0.5% drop (noise tolerance)
```

The threshold is what makes a ratchet usable rather than tyrannical. Without it, deleting a fully-covered helper or a benign refactor that moves covered lines around can nudge the percentage down by 0.1% and fail an honest PR. With a small band, the gate ignores noise and fires only on genuine erosion.

> **Key insight:** A ratchet converts an *absolute* policy ("hit 80%") into a *relative* one ("don't regress"), which is both more defensible and more durable. Nobody argues about whether 80 or 85 is correct; everyone agrees "this change shouldn't make things worse." The ratchet also degrades gracefully: a brand-new repo and a legacy monolith use the *same* config, because the floor is always wherever you happen to be.

---

## Core Concept 3 — Configuring a Real Coverage Gate

Here is a complete, production-shaped `codecov.yml` that combines everything so far — a ratcheted project gate, a strict patch gate, a noise threshold, exclusions, and a per-component target.

```yaml
coverage:
  precision: 2
  round: down
  range: "60...90"          # red/yellow/green coloring on the dashboard

  status:
    project:
      default:
        target: auto         # ratchet against base
        threshold: 0.5%      # noise band
        informational: false # this one BLOCKS merge
    patch:
      default:
        target: 85%          # 85% of CHANGED lines must be covered
        threshold: 0%        # no slack on new code

# Don't measure code you didn't write or can't meaningfully test
ignore:
  - "**/*.pb.go"             # generated protobuf
  - "**/mocks/**"            # generated mocks
  - "vendor/**"              # vendored deps
  - "**/*_test.go"           # the tests themselves

# Per-component targets: hold the security package to a higher bar
component_management:
  individual_components:
    - component_id: auth
      paths: ["internal/auth/**"]
      statuses:
        - type: project
          target: 90%
```

Three configuration decisions deserve emphasis.

**Line vs branch gating.** Line coverage asks "did this line run?"; branch coverage asks "was each side of each `if`/`switch`/`?:` taken?" A function with an untested error branch can show 100% *line* coverage while leaving the failure path completely unexercised — and failure paths are exactly where bugs hide. Where your tooling supports it, prefer branch (a.k.a. condition or decision) coverage for the gate. In Go, `go test -covermode=atomic` records statement coverage; tools like JaCoCo (Java) and `coverage.py --branch` (Python) give true branch coverage.

**Excluding generated and vendored code.** Generated files (protobuf, gRPC stubs, ORM models, mocks) and vendored third-party code shouldn't count toward your coverage — you don't author them, and testing generated code tests the generator, not your logic. Exclude them via the `ignore` block (Codecov), `-coverpkg` scoping (Go), or `.coveragerc` `omit` (Python). Forgetting this is a classic way to make the denominator lie: a megabyte of generated, untested code drags the percentage down and tempts people to lower the gate.

**Per-flag / per-component targets.** Not all code deserves the same bar. A payment or auth package warrants 90%+ on new code; an internal CLI tool might be fine at 70%. Codecov's `component_management` (and the older `flags`) let you set different targets per path. This is more honest than a single repo-wide number and keeps the gate's strictness proportional to risk.

```bash
# The standalone alternative: diff-cover, CI-tool-agnostic.
# 1) produce a coverage report (Cobertura XML here)
pytest --cov=app --cov-report=xml
# 2) fail the build if <85% of the diff vs main is covered
diff-cover coverage.xml --compare-branch=origin/main --fail-under=85
```

`diff-cover` is worth knowing because it needs no SaaS account and runs anywhere: it intersects a standard coverage report (Cobertura, LCOV, JaCoCo XML) with `git diff` and reports patch coverage locally or in CI. It's the portable way to get a diff gate when you can't or won't adopt Codecov/Coveralls.

---

## Core Concept 4 — Goodhart, Surrogation, and the Mutation-Testing Fix

Goodhart's Law, in its sharpened form: *when a measure becomes a target, it ceases to be a good measure.* Coverage is the textbook case, and the failure mechanism has a name — **surrogation**, mistaking the proxy (coverage %) for the goal (correctness). The moment a percentage gates merge, the cheapest path to passing it is to raise the number *without* improving the tests, and engineers under deadline pressure will find that path:

```go
// A test that adds coverage and verifies nothing.
func TestProcessOrder(t *testing.T) {
    ProcessOrder(order)   // line executed → counted as "covered"
    // ...no assertion. Any bug ProcessOrder has, this test still passes.
}
```

That test moves the coverage bar and catches zero bugs. The other surrogation behaviors are just as corrosive: writing trivial tests for getters and setters to pad the number, asserting on incidental output instead of the contract, and — the most damaging — *deleting hard-to-cover error-handling paths* because untested code drags the percentage down. The metric pushes you to remove exactly the defensive code most likely to matter.

The root cause is structural, not moral: **coverage proves execution, never verification.** A covered line is a line that *ran during a test*. Whether any test would *fail* if that line were wrong is a completely separate question that coverage cannot answer. That separate question is what **mutation testing** measures.

Mutation testing deliberately introduces small faults — flip `>` to `>=`, replace `+` with `-`, change `true` to `false`, delete a statement — producing "mutants" of your code. It then runs your suite against each mutant. If some test *fails*, the mutant is **killed** (good — a test actually checks that logic). If every test still *passes*, the mutant **survives** (bad — that logic is executed but unverified). The **mutation score** (killed ÷ total) is a far better proxy for suite quality than coverage, because a survived mutant is concrete proof of an assertion-free or wrong test.

```bash
# Go: gremlins. Java: PIT (pitest). JS/TS: Stryker. Python: mutmut/cosmic-ray.
go install github.com/go-gremlins/gremlins/cmd/gremlins@latest
gremlins run ./internal/pricing/...
# OUTPUT:
#   Mutation testing completed in 41s
#   Killed: 47, Lived: 6, Timed out: 2, Not covered: 11
#   Mutation score: 75.81%
#   --- LIVED at internal/pricing/discount.go:42:14 ---
#   -   if total >= threshold {
#   +   if total >  threshold {        ← no test caught the boundary change
```

That `LIVED` mutant at `discount.go:42` is the assertion-free test made visible: the boundary condition is *covered* (the line ran) but *unverified* (no test pins down `>=` vs `>`). Mutation testing surfaces precisely what coverage hides.

> **Key insight:** The fix for Goodharting coverage is not a better coverage number — it's a *different question*. Gate merge on **diff coverage plus human review** (cheap, fast, runs on every PR), and use **mutation testing** (slower, run nightly or on critical packages) to audit whether the tests behind that coverage actually verify behavior. Coverage tells you what *wasn't* tested; mutation testing tells you whether what *was* tested is worth anything. See the [Code Coverage](../../code-coverage/) section for the depth on both. Never let an absolute coverage percentage be the *only* thing standing between a change and production.

---

## Core Concept 5 — Other Quality Thresholds as Gates

Coverage is one threshold among several, and the same gate mechanics — a ceiling, a ratchet, a "no new X" rule — apply across the board. The most useful sibling gates:

| Gate | What it bounds | Typical tool | Sensible default |
|---|---|---|---|
| **Cyclomatic complexity** | Independent paths through a function | `gocyclo`, ESLint `complexity`, SonarQube | Warn > 10, fail > 15 |
| **Cognitive complexity** | How hard code is to *read* (nesting, breaks in flow) | SonarQube, `gocognit` | Fail > 15 |
| **Duplication** | % of duplicated lines/blocks | SonarQube, `jscpd`, PMD CPD | Fail > 3% on new code |
| **Maintainability rating** | Composite A–E grade | SonarQube | Require ≥ A on new code |
| **Lint errors** | Style/correctness rule violations | ESLint, golangci-lint, Ruff | 0 errors; ratchet warnings |
| **Bundle size** | Shipped JS/CSS bytes | `size-limit`, `bundlesize` | Fail if > budget + margin |
| **Type coverage** | % of code with non-`any` types | `type-coverage`, mypy `--strict` | Ratchet upward |

Two patterns recur. The **ceiling** caps a per-unit metric — *no single function may exceed cognitive complexity 15* — which prevents the worst outliers without auditing the whole codebase. The **"no new warnings" ratchet** is the lint analogue of coverage's ratchet: you may have 4,000 existing lint warnings (paying them all down at once is unrealistic), but a PR may not *add* any. This is how a team adopts a strict linter on a legacy codebase without a flag-day rewrite — freeze the debt, forbid new debt, let churn erode the rest.

Bundle-size budgets deserve special note because they're a *user-facing* quality gate: every kilobyte of JavaScript is parse-and-execute time on a phone. `size-limit` fails CI when a gzipped entry point crosses a budget, catching the accidental `import lodash` (full library) or a heavyweight dependency before it reaches users.

```yaml
# .size-limit.yml — fail the build if the main bundle exceeds budget
- name: "main bundle (gzip)"
  path: "dist/main.*.js"
  limit: "180 kB"
- name: "vendor (gzip)"
  path: "dist/vendor.*.js"
  limit: "240 kB"
```

```yaml
# golangci-lint: turn the linter into a gate, with a complexity ceiling
linters:
  enable: [gocyclo, gocognit, dupl, errcheck, revive]
linters-settings:
  gocyclo:
    min-complexity: 15      # fail any function above 15
  gocognit:
    min-complexity: 20
issues:
  new-from-rev: origin/main # RATCHET: only flag issues new vs main
```

That `new-from-rev: origin/main` line is the whole "no new warnings" ratchet in one setting: golangci-lint reports only issues introduced relative to `main`, so the legacy backlog is invisible to the gate and only fresh violations block the merge.

---

## Core Concept 6 — SonarQube Quality Gates and Clean as You Code

SonarQube packages all of the above into a single named construct — the **Quality Gate** — and built its entire philosophy on the diff-coverage insight from Concept 1. Its model is **Clean as You Code**: the gate's conditions apply to **new code** (code added or changed in a period or a pull request), *not* the whole project. This is the same move as patch coverage, generalized to every metric, and it's why SonarQube can be adopted on a decade-old monolith without first paying down all its debt.

The default **"Sonar way"** quality gate fails a pull request if, *on new code*, any of these is true:

| Condition (on **new code**) | Default |
|---|---|
| Coverage | < 80% |
| Duplicated lines | > 3% |
| New bugs | > 0 |
| New vulnerabilities | > 0 |
| Security hotspots reviewed | < 100% |
| Maintainability (new code smells) rating | worse than A |

The crucial word in every row is *new*. A PR fails because **the code it introduced** dropped below 80% coverage or added a bug — never because the surrounding legacy file is a mess. An engineer can always satisfy the gate, because it only asks about work they actually did. Over time, as files are touched, the "new code" of today becomes the clean baseline of tomorrow, and the project improves through normal churn rather than a heroic, unschedulable cleanup sprint.

> **Key insight:** "Clean as You Code" is the same principle as diff coverage, scaled to *every* quality dimension. It resolves the legacy-code paradox — *how do you raise quality without halting feature work?* — by gating the flow of new code instead of auditing the existing stock. Tighten the *new-code* conditions over time and the codebase converges on the standard without anyone ever scheduling a "fix everything" project.

---

## Core Concept 7 — Performance Gates and the Noise Problem

A performance-regression gate is the riskiest gate to add, because the signal it gates on is **inherently noisy**. CI runners are shared, virtualized machines: neighbor tenants, CPU frequency scaling, thermal throttling, GC pauses, and cold caches make the *same* benchmark vary by single-digit percentages run to run. A naive gate — "fail if this benchmark is slower than last time" — fails *randomly*, which makes it **flaky**, and a flaky gate is worse than no gate: people learn to hit "re-run" until it goes green, which trains them to ignore it entirely.

The cure is statistics, not a stricter cutoff. You cannot conclude "slower" from a single before/after pair — you need *distributions* and a test of whether the difference is real or noise.

```bash
# Go: run each benchmark MANY times so you have a distribution, not one sample
go test -bench=BenchmarkPricing -count=10 -benchmem ./pricing/ > new.txt
git stash && go test -bench=BenchmarkPricing -count=10 ./pricing/ > old.txt && git stash pop

# benchstat reports the delta AND a p-value — is the change statistically real?
benchstat old.txt new.txt
# name         old time/op    new time/op    delta
# Pricing-8     1.24µs ± 2%    1.27µs ± 3%    ~     (p=0.190 n=10+10)
#                                             ^^^   not significant → DON'T fail
```

`benchstat` runs a Mann-Whitney U test and reports `~` when the change isn't statistically significant (here `p=0.190`, above the 0.05 conventional threshold). A 2-3% wobble between runs is noise, and the gate correctly refuses to call it a regression. Only a delta that's both *significant* (low p-value) and *large* enough to matter should block.

The mitigations that turn a flaky perf gate into a reliable one:

1. **Multiple runs + statistics.** `-count=10` (or more) plus `benchstat`'s p-value. Never gate on n=1. This is non-negotiable.
2. **A relative threshold with margin.** Fail on a *significant* regression beyond, say, 5-10% — not on any slowdown. The margin absorbs residual noise.
3. **Dedicated, quiet runners.** Bare-metal or pinned, isolated runners (no neighbors, frequency scaling disabled) cut variance dramatically. Tools like [`bencher`](https://bencher.dev) and CodSpeed exist specifically to provide stable measurement.
4. **Compare against base, watch the trend.** Like the coverage ratchet, compare to the base commit and track the trend over many commits — a single point is noise; a sustained drift is a regression.
5. **Start advisory.** Run the perf gate as **informational** (reports, doesn't block) until you've watched its false-positive rate for a few weeks. Promote it to blocking only once it's demonstrably reliable.

> **Key insight:** A performance gate's enemy is **variance**, not slowness. Until you've controlled variance — many runs, a statistical test, quiet runners, a margin — a perf gate is a flakiness generator that trains the team to ignore red. Treat it as **advisory until proven reliable**, then promote it. The same discipline applies to any gate whose underlying signal is noisy.

---

## Core Concept 8 — Setting a Defensible Threshold

A threshold is **defensible** when you can answer "why that number?" with data instead of "it felt right." The round numbers — 80%, 90%, 100% — are almost always indefensible, because they were pulled from the air rather than derived from the codebase. The procedure for a number you can defend:

1. **Measure current state first.** Run the metric on the codebase as it is today. If diff coverage on recent PRs has been averaging 78%, that is your evidence base — not someone's opinion of what's "good."
2. **Set the floor at (or just below) current, then ratchet.** If you're at 78%, set the gate at 75% (a small buffer for noise) and let the ratchet pull it up, or set patch coverage at 80% to nudge new code slightly above the historical norm. The bar should be *reachable today* and *trend upward* — not a cliff that blocks every PR on day one.
3. **Scope to the diff to avoid blocking on legacy.** Whatever the number, apply it to *changed* lines. A 90% bar is easy on a 20-line PR and impossible on the whole repo; diff-scoping makes the same number fair.
4. **Add a noise band.** A `threshold` (Codecov) or margin (perf) so trivial fluctuation doesn't fail honest changes.
5. **Weigh the false-positive cost explicitly.** This is the decisive consideration. A gate that fires *wrongly* — too strict, too noisy — gets disabled, and a disabled gate protects nothing. The cost of a false positive is not one annoyed engineer; it's the *eventual removal of the entire gate*. When in doubt, set the bar slightly looser than feels ideal and ratchet up, rather than slightly tighter and watch it get switched off.

> **Key insight:** The most defensible threshold is **current data plus a small upward ratchet**, scoped to the diff, with a noise band. Round numbers signal that nobody did the measurement. And always optimize against the *failure mode that kills the gate*: a too-strict or too-noisy gate doesn't make quality higher — it makes the gate disappear. A slightly lenient gate that *stays on* and ratchets upward beats a strict gate that gets deleted in three weeks.

---

## Real-World Examples

**1. The legacy fix blocked by a project gate.** A team runs Codecov with `project: target: 70%`; the repo sits at 68% after years of debt. Every PR fails, including a critical one-line security fix to an untested legacy module. The team flips the project gate to `target: auto` (ratchet) and adds a `patch: target: 85%`. Now legacy fixes pass (they don't lower the base), new code is held to 85%, and project coverage climbs on its own as files get touched. The gate stops being the enemy.

**2. Coverage at 92%, mutation score at 61%.** A service proudly reports 92% line coverage, yet a production incident traces to an untested boundary condition. Running `gremlins` reveals a mutation score of 61% — a third of the "covered" logic has no verifying assertion. The team adds mutation testing nightly on the two critical packages and discovers a cluster of assertion-free tests written long ago to hit a coverage target. Coverage was high; *verification* was not.

**3. The perf gate that cried wolf.** A team adds "fail if any benchmark slows down." Within a week it has failed eleven PRs, none of which touched performance — pure runner noise. Engineers now reflexively re-run until green. The team switches to `benchstat` with `-count=10`, a 7% significance margin, and `informational: true` for a month. False positives drop to near zero; only then do they make the most critical benchmarks blocking.

**4. Adopting a strict linter on a 4,000-warning monolith.** A team wants golangci-lint with a complexity ceiling but can't fix 4,000 existing warnings. They set `new-from-rev: origin/main` and `gocyclo.min-complexity: 15`. The 4,000 legacy warnings are invisible to the gate; only *new* violations block merge. Complexity stops growing immediately, and the backlog shrinks as files are refactored during normal work.

---

## Mental Models

- **The thermometer vs the door.** Absolute coverage is a *thermometer* — a health reading you watch on a dashboard. Diff coverage is a *door* — the thing that blocks merge. Don't put the thermometer on the door; you'll either freeze everyone out or let everything through.

- **The ratchet wrench.** A good quality gate turns one way. Coverage, type coverage, lint warnings — each ratchets: it can tighten but never loosen. Wherever you are today is the new floor. No magic number, no flag-day rewrite, no silent erosion.

- **Coverage is a smoke detector with no batteries until you add assertions.** A covered line proves the wire is connected (the line ran). Whether the alarm actually *sounds* on a fault (a test fails) is what mutation testing checks. High coverage with a low mutation score is a smoke detector with the batteries pulled out.

- **A flaky gate is a snooze button.** Every false positive teaches the team to hit "re-run" and ignore red. A noisy perf gate doesn't raise quality; it trains people to dismiss the very signal it exists to provide. Reliability is a precondition for a gate having *any* value.

- **Clean as You Code is a flow gate, not a stock audit.** You can't clean the whole warehouse (the stock) today. You *can* inspect everything coming through the door (the flow). Gate the flow; the stock improves as it cycles through.

---

## Common Mistakes

1. **Gating on project coverage instead of diff coverage.** A repo-wide absolute target punishes authors for inherited debt and blocks unrelated fixes. Gate the *diff*; report the project number informationally. This is the most common reason coverage gates get disabled.

2. **Picking a round number with no data behind it.** "80%" is indefensible if you didn't measure. Base the threshold on current coverage plus a small ratchet; a number you can't justify is a number people will argue down.

3. **Trusting coverage as proof of verification.** Coverage proves a line *ran*, never that a test would *fail* if it were wrong. Assertion-free tests give high coverage and catch nothing. Pair coverage with mutation testing on critical code.

4. **No threshold (noise band) on the ratchet.** A 0% threshold means deleting a covered file or a benign refactor fails an honest PR. Set `threshold: 0.5%` so trivial fluctuation passes and only real regressions fail.

5. **Counting generated and vendored code.** Protobuf stubs, mocks, and `vendor/` drag the denominator down and tempt you to lower the gate. Exclude them via `ignore` / `omit` / `-coverpkg`.

6. **Gating performance on a single run.** Benchmarks vary run to run; `n=1` makes the gate flaky. Run `-count=10`, use `benchstat`'s p-value, add a margin, and start advisory. Never gate on one sample.

7. **Setting every gate to blocking on day one.** A brand-new, untested-reliability gate that blocks merge will fire wrongly and get disabled. Start `informational`, watch the false-positive rate, then promote.

8. **Line coverage where branch coverage is needed.** 100% line coverage can hide an entirely untested error branch. Prefer branch/condition coverage for the gate where the tooling supports it — failure paths are where bugs live.

---

## Test Yourself

1. What is the difference between *project* and *patch* coverage, and why is patch coverage the default-right thing to gate on?
2. What does `target: auto` in `codecov.yml` do, and what problem does the `threshold` setting solve?
3. Coverage proves *execution*. What does it *not* prove, and which tool measures the missing property?
4. A test calls the function under test but has no assertion. What happens to coverage, and what happens to the mutation score?
5. Why is a "fail if any benchmark is slower" gate flaky, and what four mitigations make a perf gate reliable?
6. Your repo sits at 68% coverage with years of debt. How do you add a coverage gate without blocking every PR?
7. What is "Clean as You Code," and how does it let you adopt a strict quality gate on a legacy codebase without a rewrite?

<details>
<summary>Answers</summary>

1. *Project* coverage = the fraction of *all* repository lines covered; *patch* coverage = the fraction of the *lines this PR changed* that are covered. Patch coverage is the default-right gate because it scopes responsibility to authorship — it tests the new work and never blocks a change for inherited legacy debt, operationalizing "Clean as You Code." Absolute coverage is a dashboard reading, not a door.

2. `target: auto` makes the gate a **ratchet**: it compares against the base commit's coverage ("no worse than the parent") instead of a fixed percentage, so coverage can rise but not fall. `threshold` adds a noise band (e.g. `0.5%`) so trivial fluctuations — a deleted covered file, a benign refactor — don't fail an honest PR.

3. It does not prove **verification** — whether any test would *fail* if the covered line were wrong. A line can run during a test that asserts nothing. **Mutation testing** measures the missing property: it injects faults and checks that some test fails (kills the mutant); the mutation score is the proxy for how verifying the suite is.

4. Coverage *goes up* (the line executed, so it's counted as covered). The mutation score is *unaffected or reveals survivors* — mutants in that code survive because no assertion catches the injected fault. This is exactly how coverage and mutation testing diverge: the assertion-free test inflates coverage while contributing nothing to the mutation score.

5. CI runners are shared/virtualized, so benchmarks vary several percent run to run; a single before/after comparison can't distinguish a real regression from noise, so the gate fails randomly. Mitigations: (a) **multiple runs + statistics** (`-count=10`, `benchstat` p-value); (b) a **relative threshold with margin** (fail only on a *significant* regression beyond ~5-10%); (c) **dedicated/quiet runners** to cut variance; (d) **compare against base / watch the trend** and start **advisory** until proven reliable.

6. Switch the project gate to `target: auto` (a ratchet — 68% becomes the floor, can't regress) and add a `patch` gate (e.g. 85% of changed lines). Legacy fixes pass because they don't lower the base; new code is held to a real bar; project coverage climbs on its own as files are touched. Never set a fixed absolute target above current state — it blocks every PR.

7. "Clean as You Code" (SonarQube) gates only on **new code** — code added or changed in a PR/period — not the whole project. It lets you adopt a strict gate on legacy because the existing debt is invisible to the gate; only the new code must meet the bar, which an author can always satisfy. As files churn, today's new code becomes tomorrow's clean baseline, so quality improves without a scheduled rewrite.

</details>

---

## Cheat Sheet

```
WHAT TO GATE ON
  diff / patch coverage   ← BLOCK merge on this (scopes to authorship)
  project coverage        ← report informational + ratchet (don't block on absolute)
  branch > line           ← prefer branch coverage; line hides untested error paths

THE RATCHET (codecov.yml)
  project: { target: auto, threshold: 0.5% }   no worse than base, small noise band
  patch:   { target: 85%,  threshold: 0% }     new code held to a real bar
  ignore: generated / mocks / vendor           keep the denominator honest

COVERAGE ≠ VERIFICATION
  coverage   = line RAN          (execution)
  mutation   = test FAILS if wrong (verification)   ← gremlins/PIT/Stryker/mutmut
  fix Goodhart: diff-coverage + review to gate; mutation testing to audit

OTHER GATES
  cyclomatic/cognitive complexity ceiling   gocyclo/gocognit, fail >15
  duplication %                             jscpd/SonarQube, fail >3% new
  lint "no new warnings"                    golangci-lint: new-from-rev=origin/main
  bundle size budget                        size-limit / bundlesize
  type coverage                             type-coverage, ratchet up

SONARQUBE QUALITY GATE (on NEW code)
  coverage <80% | dup >3% | new bugs >0 | new vulns >0 | maintainability <A → FAIL

PERF GATE (noisy → be careful)
  go test -bench=X -count=10 ... | benchstat old.txt new.txt   (read the p-value)
  p<0.05 AND delta>margin → regression; else noise (~)
  start informational → quiet runners → blocking once reliable

DEFENSIBLE THRESHOLD
  measure current → floor at/below current → ratchet up → diff-scope → noise band
  optimize against the FALSE-POSITIVE COST: a too-strict gate gets DISABLED
```

---

## Summary

- A coverage gate must first decide **percentage of what**. Gate the **diff** (patch coverage — the lines this PR changed), report **project** coverage informationally. Diff coverage scopes responsibility to authorship and never blocks a fix for inherited debt — the operational meaning of "Clean as You Code."
- The **ratchet** (Codecov `target: auto` + `threshold`) replaces a magic absolute number with "no worse than base": coverage may rise, never fall, and the same config works for a new repo and a legacy monolith.
- Coverage proves **execution, not verification**. Used as a target it Goodharts into assertion-free tests, getter tests, and deleted error paths (**surrogation**). The fix is a *different question*: gate on diff coverage + review, and audit with **mutation testing**, which breaks code and checks that a test fails.
- The same gate mechanics apply to **complexity ceilings, duplication, lint budgets ("no new warnings"), bundle size, and type coverage**. **SonarQube Quality Gates** package these and gate them on **new code only**.
- **Performance gates** fight **variance, not slowness**. A naive "fail if slower" gate is flaky; use **multiple runs + `benchstat` p-values**, a **margin**, **quiet runners**, and **start advisory**.
- A **defensible threshold** = current data + a small upward ratchet, diff-scoped, with a noise band. Always optimize against the failure mode that kills the gate: **a too-strict or too-noisy gate gets disabled**, and a disabled gate protects nothing.

For the deeper treatment — coverage instrumentation internals, mutation-testing operators and equivalent-mutant handling, statistically rigorous performance gating, and rolling these gates out org-wide without revolt — see [senior.md](senior.md).

---

## Further Reading

- [Codecov — Coverage Configuration & Status Checks](https://docs.codecov.com/docs/commit-status) — `project` vs `patch`, `target: auto`, `threshold`, flags, and components.
- [SonarQube — Clean as You Code](https://docs.sonarsource.com/sonarqube/latest/user-guide/clean-as-you-code/) — the new-code model and the "Sonar way" quality gate conditions.
- [`diff-cover` documentation](https://github.com/Bachmann1234/diff_cover) — CI-agnostic diff coverage from any Cobertura/LCOV/JaCoCo report.
- [Go `benchstat` documentation](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — statistically comparing benchmark runs (deltas and p-values).
- [PIT (pitest)](https://pitest.org/) and [Stryker Mutator](https://stryker-mutator.io/) — mutation-testing references for the JVM and JS/TS; the conceptual home for "does a test catch a bug?"
- [`size-limit`](https://github.com/ai/size-limit) — bundle-size budgets as a CI gate.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/middle.md) — making coverage and threshold checks *required* so they actually block merge.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/middle.md) — where to run slow gates (mutation, perf) so safety doesn't wreck cycle time.
- [Code Coverage](../../code-coverage/) — the depth on coverage types, instrumentation, and mutation testing.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity, duplication, and maintainability as first-class metrics.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — why surrogation (Goodhart) plagues *every* engineering metric, not just coverage.
