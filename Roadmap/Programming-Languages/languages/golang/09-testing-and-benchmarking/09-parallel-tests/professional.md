---
layout: default
title: Parallel Tests — Professional
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/professional/
---

# Parallel Tests — Professional

[← Back](../)

This page is about turning `t.Parallel` from a per-file optimisation into a team-wide discipline. The material assumes you are technical lead, EM, or staff engineer responsible for a Go codebase larger than one person can fit in their head.

## Parallel-by-default as a team norm

The default in idiomatic modern Go projects (Kubernetes, etcd, Prometheus, the Go standard library itself) is parallel-by-default. Every new `TestXxx` calls `t.Parallel` unless there is a written reason not to. This norm matters because:

- A test that is fast today may become slow tomorrow; opt-in parallelism rewards retroactive work.
- Reviewers stop having to ask "should this be parallel?" — the question becomes "why isn't it?".
- Race conditions surface in CI rather than production, because parallel tests amplify shared-state bugs that serial tests hide.

Enforce it with a lightweight `go/analysis` linter (see Task 12 on the tasks page) wired into `golangci-lint`. False positives — tests that legitimately can't be parallel — get a one-line `// noparallel: t.Setenv` comment that the linter accepts.

## Race detector in CI

Treat `-race` as production-equivalent. Recommended setup:

1. PR CI: `go test -race -parallel $(nproc) -count=1 ./...`.
2. Nightly: `go test -race -count=10 -parallel $(nproc) ./...` to catch low-probability races.
3. Pre-release: `go test -race -tags=integration ./...`.

Memory budget matters. A `-race` binary uses ~10x the RAM of a regular binary; CI runners with 2 GB may need `-parallel` capped well below `GOMAXPROCS`. Document the memory ceiling per repo.

When `-race` reports a finding:

- Open a P1 issue. Do not merge code that triggers a race in CI, even if "the test still passes".
- A `-race` report is a real bug, not a test bug. It would happen in production under the right schedule.
- File a postmortem if a race made it to main; investigate why the parallel-by-default norm failed.

## Flake budgets and quarantine

A flake budget caps acceptable per-week test failures that are not real bugs. Teams set numbers like "≤5 unrelated flakes per 1000 runs". Above the budget, the test is quarantined (`-skip=TestFlaky`) and an issue auto-filed.

Parallel tests are responsible for the majority of flakes in busy repos because:

- Time-sensitive code (sleeps, deadlines) interacts with the scheduler unpredictably.
- Shared external services (Postgres, S3) accumulate state across tests.
- Goroutine leaks compound, eventually OOMing the runner.

Mitigations:

- Replace `time.Sleep` with explicit synchronisation (`<-ready`, `t.Context().Done()`).
- Run integration tests in their own DB schema (use `t.TempDir`-style schema names).
- Add `goleak.VerifyTestMain(m)` to every package with `t.Parallel`.

## CI wiring

A representative CI matrix for a serious Go project:

```yaml
jobs:
  unit:
    run: go test -parallel 16 -count=1 ./...
  race:
    run: go test -race -parallel 8 -count=1 ./...
  integration:
    run: go test -tags=integration -parallel 4 ./...
  fuzz-smoke:
    run: go test -fuzz=Fuzz -fuzztime=1m -count=1 ./...
```

Run `unit` on every commit, `race` on every PR, `integration` on PRs touching integration-tagged packages, and `fuzz-smoke` nightly. The four jobs run in parallel, so total wall-clock is the slowest job, typically `race` or `integration`.

Coverage: collect with `-coverprofile` only on the `unit` job; `-race` plus `-cover` doubles the slowdown.

## Resource governance

Production-grade test suites declare their resource budgets explicitly. Examples:

- Postgres: a pool of 16 connections; tests acquire via a buffered channel.
- Redis: separate logical databases (`SELECT 0..15`) handed out by a pool.
- HTTP: `httptest.Server` instances pooled with `t.Cleanup` returning them.
- Files: every path rooted in `t.TempDir`, never `/tmp` directly.

The pool size is a deliberate decision, not the default. A pool too small slows the suite; too large exhausts the external service. Set it from a CI benchmark, not a guess.

## Monitoring suite health

Track three metrics per CI run:

1. **Total wall time** — should grow sub-linearly with test count when parallel tests are tuned.
2. **Per-test runtime distribution** — outliers in the top decile usually indicate `time.Sleep` or external-service latency.
3. **Flake count** — failures not caused by changed code; alarm if >budget over a week.

`go test -json` emits structured timing per test. Aggregate with `tparse`, GoConvey, or a custom script. Plot the top 20 slowest tests; optimise them first.

## Code-review heuristics

When reviewing a Go PR, look for:

- New `TestXxx` without `t.Parallel`. Comment: "Can this be parallel? If not, why?"
- `t.Setenv` next to `t.Parallel`. Will panic; reject.
- Package-level mutable state introduced in tests. Reject; pass through context or struct fields.
- `defer cleanup()` inside a parallel test. Suggest `t.Cleanup`.
- `time.Sleep(N)` waiting for async work. Reject; replace with channel or `t.Context()`.
- New goroutines without `defer wg.Done()` or `<-ctx.Done()` exit. Suggest goleak.

## Documenting non-parallel tests

When a test genuinely cannot be parallel, document the reason inline:

```go
// TestSignalHandler is intentionally serial; signal.Notify modifies a
// process-global table that races with sibling tests.
func TestSignalHandler(t *testing.T) {
    // no t.Parallel
    ...
}
```

The comment serves three purposes: it survives linter suppression, it teaches the next reader, and it forces the author to justify the choice.

## Migration: from serial-only to parallel-by-default

Adopting parallel-by-default in a legacy repo is a multi-week project:

1. **Baseline**: Run the full suite with `-race -count=10`, record every failure.
2. **Triage**: Categorise failures into (a) real races, (b) test-only races, (c) flakes due to time/network.
3. **Fix real races first**: They are production bugs.
4. **Add `t.Parallel` package by package**: One PR per package keeps reviews small.
5. **Enable linter in warn mode** for two weeks, then promote to error.
6. **Monitor wall time**: Expect 3–10x speedup. If wall time *increases*, a hidden contention point (logger mutex, package init) needs profiling.

Teams that have done this report 30% reduction in CI minutes and a measurable bump in PR throughput.

## Cultural artifacts

Mature Go teams publish:

- A one-page "tests in this repo" doc explaining parallel-by-default, the race policy, the flake budget, and the resource pools.
- A linter config in version control that future contributors don't have to discover.
- A "how to debug a flake" runbook (steps: `-race`, then `-count=100 -run=X`, then `goleak`, then profile).
- A quarterly review of the slowest 20 tests, with named owners.

These artifacts pay off when onboarding new engineers and during incident postmortems where a flaky test masked the real bug.

## When parallel is the wrong tool

Acknowledge cases where serial wins:

- Tests of `init` order, package-level state, or `signal.Notify`.
- Tests that fork subprocesses (`os/exec`) and rely on file-system ordering.
- Microbenchmarks (`*testing.B` ignores `b.Parallel` differently — see the benchmarks subsection).
- Tutorial / example tests where readability beats speed.

Document them. Then mark every *other* test parallel.

## Auditing the suite for parallel-readiness

Before mandating parallel-by-default, conduct an audit:

1. **Inventory**: count tests; categorise as "parallel candidate", "needs refactor", or "intentionally serial".
2. **Identify the blockers**: env-var-driven config, `os.Chdir`, package-level state, integration tests with shared fixtures.
3. **Prioritise**: leaf packages first (smallest blast radius), shared-fixture packages last.
4. **Track**: a simple spreadsheet showing % parallel by package per week communicates progress to management.

Audits typically reveal that 60–80% of a legacy suite is already parallel-safe and just needs `t.Parallel` added. The remaining 20–40% is the real work — refactoring production code so its tests can be parallel.

## The flake budget in detail

A flake budget is a written agreement between engineering and the platform team:

> Up to N% of CI runs may fail due to flaky tests in a rolling 7-day window. Above that, the offending test is quarantined and an issue is auto-filed against the owning team.

Sample values:

- High-velocity team: 1% flake budget.
- Average team: 3% flake budget.
- Legacy / under-investment: 5%, with a roadmap to reduce.

Measurement requires CI infrastructure that records test results per run, identifies the failing test, and compares against historical pass/fail. Tools: Buildkite Test Analytics, Datadog CI Visibility, custom scripts on `go test -json`.

When a test exceeds budget:

1. **Quarantine**: `-skip=TestFlaky` in CI; the test still runs locally for development.
2. **File an issue**: assigned to the test's owner, P2 priority.
3. **SLA**: fixed or removed within 2 weeks; not allowed to sit in quarantine forever.
4. **Postmortem if it caused a missed bug**: a flaky test masking a real failure is a process issue, not just a tech debt issue.

## Resource budgets per package

A serious Go monorepo declares resource budgets per package in a config file:

```yaml
# .testbudgets.yaml
pkg/users:
  parallel: 8
  db_connections: 4
pkg/billing:
  parallel: 4
  db_connections: 2
pkg/notifications:
  parallel: 16
  http_clients: 8
```

CI loads this and applies `-parallel N` per package. The budgets reflect actual external-service limits (Postgres `max_connections`, Stripe rate limits, etc.). Updating a budget is a deliberate PR with justification.

## Documentation as artefact

Mature teams ship a `TESTING.md` at the repo root, covering:

```markdown
# Testing in this repo

## Defaults
- Every new test calls `t.Parallel` unless documented otherwise.
- `-race` runs on every PR.
- Postgres tests use the pool helper; max 16 connections per package.

## Tools
- `goleak` is wired in `TestMain` for packages with goroutines.
- `tparse` is the CI output format.

## When in doubt
- Run `go test -race -count=10 -parallel 16 ./pkg`.
- Ask in #engineering-testing channel.
```

The document is the source of truth. New engineers read it on day one. CI failures point to it. PR templates link to it. The artefact's existence is more important than its perfection.

## CI cost economics

A 10-minute CI suite on a team of 50 engineers costs roughly:

- 50 engineers × 10 commits/day × 10 minutes = 5000 CI-minutes/day.
- At $0.008/minute (typical SaaS pricing), that's $40/day or $14k/year for compute alone.
- Engineer time waiting: 50 × 10 × 10 = 5000 minutes/day × $1/minute (loaded cost) = $50k/year.

Cutting CI from 10 to 3 minutes via parallelism saves >$45k/year in engineer time. Most of that comes from `t.Parallel` and tuning `-p` and `-parallel`. The cost of the parallel-readiness audit pays back in weeks.

## Onboarding new engineers

The first thing a new engineer should write is a passing parallel test. Concretely:

1. Day 1 task: read `TESTING.md`, run the test suite locally, observe the parallel scheduling.
2. Day 2 task: write a small change with a parallel test; run with `-race`.
3. Day 3 task: shadow a code review focusing on tests.

By the end of week 1, the new engineer should be able to spot common parallel-test mistakes in PRs. Frame it as a hard skill, not optional polish.

## Code-review checklist (formalised)

Distribute this as a Markdown checklist or as a PR template section:

```markdown
### Test review
- [ ] New tests call `t.Parallel` unless documented
- [ ] No `t.Setenv` next to `t.Parallel`
- [ ] No package-level mutable state added
- [ ] `t.Cleanup` used instead of `defer` for resources
- [ ] No `time.Sleep` in test code; use channels or `t.Context`
- [ ] Goroutines have explicit lifecycle (context, channel)
- [ ] `t.TempDir` for any file-system writes
- [ ] Ports are `:0` or via `httptest`
```

When a reviewer ticks all boxes, the parallel-safety of the new code is high. When one is unchecked, the review comment is a one-liner pointing at the unchecked item.

## Monitoring parallel-test health

Three dashboards every serious team maintains:

**Dashboard 1: Wall-clock per package.** Top 20 slowest packages, plotted weekly. Spot regressions when a package suddenly slows.

**Dashboard 2: Flake rate.** Per-test, per-package, per-team. Sorted by recent flake count. Issues auto-filed when budget is exceeded.

**Dashboard 3: `-race` findings.** Every CI race report logged with stack trace, deduplicated. Track time-to-fix.

The dashboards are the team's lens into the suite's health. Without them, parallel-test discipline decays silently.

## The "expensive but rare" pattern

Some tests are intrinsically slow and serial — integration tests against a real third-party API, end-to-end browser tests, large fuzzing campaigns. These belong in a separate suite:

```bash
go test -tags=integration ./... # daily/nightly
go test -tags=e2e ./...         # weekly
go test ./...                   # every commit, parallel
```

Build tags partition the suite. The fast suite stays parallel and runs on every commit. The slow suite runs on a schedule and doesn't block PRs.

Communicate this to the team explicitly: "if your test is over 1 second, ask whether it belongs in the integration suite". The fast-suite-as-default discipline is the foundation of PR throughput.

## Risk: the all-green illusion

A passing parallel suite can hide bugs that production exposes. The race detector catches most, but not all:

- Races on memory through `unsafe.Pointer`.
- Races on shared resources outside the Go process (e.g., a database row touched by two replicas).
- Logical races (a missed update due to a bug, not a memory order issue).

Counter: don't rely solely on `-race`. Pair it with chaos testing, load testing, and production monitoring. The CI suite is necessary but not sufficient.

## Risk: leaked goroutines compound

A test that leaks one goroutine isn't visibly broken; the suite continues. But 1000 tests with one leak each create 1000 stuck goroutines. Memory grows; CI eventually OOMs.

Mitigation: `goleak` in `TestMain` of every package. Treat any leak report as a blocker.

## Risk: time-based assumptions break under load

A test that calls `time.Sleep(100ms)` assumes the goroutine runs within 100ms. Under heavy CI scheduling pressure, that assumption breaks; tests flake.

Mitigation: ban `time.Sleep` from test code. Replace with channels, `t.Context()`, or polling on a condition:

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if condition() {
        return
    }
    select {
    case <-t.Context().Done():
        t.Fatal("timed out")
    case <-time.After(10 * time.Millisecond):
    }
}
t.Fatal("condition never became true")
```

Two seconds of polling is more reliable than a single 100 ms sleep.

## Risk: external service flakiness

Tests against Postgres, Redis, S3, etc., depend on the external service's health. CI flakes when DNS hiccups, when a transient AWS issue strikes, when the test container is slow to start.

Mitigation:

- Retry transient failures with exponential backoff.
- Health-check fixtures before declaring them ready.
- Pre-warm shared services in `TestMain` so the first test isn't slow.
- Separate the "test the code" suite from the "test the integration" suite.

## Putting it together: a team policy template

A one-page document a tech lead can paste into the repo:

```markdown
# Parallel testing policy

## Defaults
- `t.Parallel()` on every new test unless `// noparallel:` reason documented.
- `-race` runs on every PR; failures block merge.
- Goleak in `TestMain` for any package with goroutines.

## Resource budgets
- Postgres: max 16 connections per package.
- Redis: max 4 connections per package.
- Files: use `t.TempDir`; never `/tmp` directly.
- Ports: `127.0.0.1:0` or `httptest.NewServer`.

## CI
- Unit suite: `go test -parallel 16 -count=1 ./...`
- Race suite: `go test -race -parallel 8 -count=1 ./...`
- Integration: `go test -tags=integration -parallel 4 ./...`

## Flake policy
- Budget: <3% in rolling 7 days.
- Above budget: quarantine, file issue, fix within 2 weeks.

## Code review
- See the checklist in TESTING.md.

## Tooling
- Linter: `paralleltest` enabled in golangci-lint.
- Test runner: `gotestsum` for human-readable output.
- Telemetry: `-json` parsed into the team dashboard.
```

The policy is short, specific, and enforceable. It exists. New hires get it on day one. Reviewers cite it. Drift is caught early.

## Summary

- Parallel-by-default is a team norm, enforced by linter + reviewer culture.
- `-race` on every PR catches concurrency bugs while authors remember the code.
- Flake budgets cap acceptable instability; over-budget tests get quarantined.
- Resource budgets are deliberate, sized to match external limits.
- Documentation (`TESTING.md`, code-review checklist, dashboards) is the artefact that survives engineer churn.
- Monitor wall time, flake rate, and race findings continuously.
- Acknowledge serial-only cases; document them; mark everything else parallel.

## Appendix A: example CI workflow (GitHub Actions)

```yaml
name: tests

on: [pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - run: go test -parallel 16 -count=1 ./...

  race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - run: go test -race -parallel 8 -count=1 ./...

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - run: go test -tags=integration -parallel 4 ./...
```

Three required jobs, all in parallel. Each fails independently. Total wall time is the slowest job.

## Appendix B: a `paralleltest` linter configuration

```yaml
# .golangci.yml
linters:
  enable:
    - paralleltest
    - tparallel
    - gocritic

linters-settings:
  paralleltest:
    ignore-missing: false
    ignore-missing-subtests: false
```

`paralleltest` requires `t.Parallel` on every test; `tparallel` validates that subtests are properly parallel. Combined, they enforce the parallel-by-default norm at PR time.

## Appendix C: example `TESTING.md`

```markdown
# Testing this repo

## Parallel-by-default

Every new test calls `t.Parallel()` unless it has a documented reason.
Reasons are:

- Uses `t.Setenv` (env vars are process-global).
- Tests signal handling.
- Tests `init` order.

Add a comment in the test: `// noparallel: uses t.Setenv`.

## Race detector

`-race` runs on every PR. Findings block merge. Treat them as production bugs.

## Resource budgets

- Postgres: 16 connections per package, via the pool in `internal/testdb`.
- Redis: 8 connections per package.
- HTTP clients: unlimited but use `httptest.Server`.

## Goleak

Every package with goroutines has `goleak.VerifyTestMain(m)` in `TestMain`.

## Flake budget

3% over 7 days. Above budget, the test is quarantined.

## Tools

- `golangci-lint` runs in CI; `paralleltest` enabled.
- `gotestsum` formats CI output.
- `tparse` analyses slow tests.
```

The doc is short, specific, and enforceable. New hires read it day one.

## Appendix D: example postmortem template for a parallel-test bug

```markdown
# Postmortem: TestUserCreate flaky in CI

**Date**: 2026-04-15
**Author**: ...
**Severity**: P2 (flake budget exceeded for the third week)

## Summary
TestUserCreate failed in 4% of CI runs over the last week.

## Root cause
The test set a package-level `var userIDCounter` and three parallel subtests incremented it. The increments raced, occasionally producing duplicate IDs that failed the UNIQUE constraint.

## Resolution
- Replaced the package-level counter with `atomic.Int64`.
- Added a regression test that runs 100 parallel subtests.
- Wired `paralleltest` linter to catch package-level vars in test files.

## Prevention
- Audit other tests for similar package-level state. Found 3 more; refactored.
- Updated TESTING.md to forbid package-level mutable state in test files.

## Lessons
- A flake is a real bug; we should have escalated when it first appeared.
- Linter would have caught this at PR time; we didn't have one configured.
```

Postmortems are how the team learns. File them, share them, link them from PR templates.

## Appendix E: team-level metrics dashboard sample

A simple but useful dashboard:

```
Suite Health (7-day rolling)
─────────────────────────────────────────────
Wall time (unit):           4.2 min   ↓ 0.3
Wall time (race):           11.8 min  ↓ 0.5
Wall time (integration):    7.1 min   ↑ 0.4 [investigate]
Flake rate:                 2.1%      ↓ 0.5
Goleak findings:            0
Race findings:              0
Test count:                 5234      ↑ 47
Slowest test (unit):        TestSchedulerStress (1.8s)
Slowest package:            ./internal/scheduler (45s)
```

The arrows show 7-day delta. Anything trending up gets investigated; anything trending down is celebrated.

## Appendix F: handover checklist when onboarding a new test-discipline owner

When a new engineer becomes the test-discipline owner (often the tech lead), hand over:

- Access to the CI dashboards.
- The `TESTING.md` and linter config.
- The pending quarantine list with owners.
- The flake budget agreement with stakeholders.
- The list of known serial-only tests.
- The current resource budgets per package.
- The postmortems from the last quarter.

A new owner who reads this in an hour is ready to take over. Without the handover artefacts, they spend weeks rediscovering everything.

## Appendix G: cost-benefit framing for stakeholders

When asking for engineering time to invest in parallel-test discipline, frame the ask in business terms:

- **Current state**: CI averages 12 minutes per PR. 50 engineers × 10 PRs/week × 12 min = 6000 engineer-minutes/week waiting for CI = 100 hours/week.
- **After investment**: CI averages 3 minutes per PR. Same volume = 1500 engineer-minutes/week = 25 hours/week.
- **Savings**: 75 hours/week, equivalent to ~2 full-time engineers' time.
- **Investment**: 2-week project for one tech lead = 80 hours one-time.
- **Payback period**: 1.1 weeks.

Stakeholders fund easily-justified projects. The above framing makes the investment trivial to approve.

## Appendix H: a calendar for sustained discipline

Beyond the initial migration, a sustained calendar:

- **Daily**: CI is green; flake alarms reviewed.
- **Weekly**: dashboard review; top-5 slowest tests inspected.
- **Monthly**: linter config reviewed; new lint rules considered.
- **Quarterly**: full audit of quarantined tests; full audit of `noparallel` exceptions.
- **Annually**: review the test-design discipline document; update for new Go versions.

The calendar is the team's commitment to test quality over time. Without it, discipline decays.

## Appendix I: red flags during PR review

A short list of patterns a senior reviewer recognises in a single glance:

- A new `_test.go` file with no `t.Parallel` calls anywhere.
- `defer cleanup()` inside a function that calls `t.Parallel`.
- `time.Sleep` in any test code.
- `var foo` at package level inside a test file.
- `os.Setenv` or `os.Chdir` direct calls.
- Hardcoded port numbers or `/tmp/...` paths.
- `httptest.NewServer` without `t.Cleanup(srv.Close)`.
- Goroutines without a clear exit mechanism.
- `log.Fatal` or `os.Exit` in test code (other than `TestMain`).
- A `t.Run("...", ...)` loop without `t.Parallel` inside.

Any of these in a PR is a comment opportunity. The reviewer's job is to teach the team's norms, one PR at a time.

## Appendix J: a final note on craft

Test code is code. It deserves the same care as production code: clear naming, small functions, sensible error messages, no copy-paste. A test suite that's been crafted with intention pays back every time someone reads it, debugs a failure, or onboards a new engineer.

Parallel-by-default is not the whole craft, but it's a load-bearing wall. Build it well, maintain it consistently, and the rest of the suite grows on solid foundations.
