# Coverage in CI & Diffs — Senior Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage in CI & Diffs
> *The middle page taught you to wire up patch coverage and post a status check. This page is about designing the coverage-gate as a system: how patch coverage is actually computed against a base that keeps moving, how it survives rebases and parallel shards, how it scales to a monorepo with hundreds of owners, and how to build a ratchet that stops erosion without freezing your legacy code forever.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Patch Coverage Against a Moving Base](#patch-coverage-against-a-moving-base)
4. [Carryforward — Surviving Shards, Flakes, and Skipped Jobs](#carryforward--surviving-shards-flakes-and-skipped-jobs)
5. [Coverage at Monorepo Scale](#coverage-at-monorepo-scale)
6. [The Ratchet, Implemented Correctly](#the-ratchet-implemented-correctly)
7. [Gate Design — Blocking vs Advisory, Thresholds, and Exclusion Governance](#gate-design--blocking-vs-advisory-thresholds-and-exclusion-governance)
8. [Determinism — Flaky Coverage Under Parallelism and `-race`](#determinism--flaky-coverage-under-parallelism-and--race)
9. [Performance — Instrumentation Cost on Every PR](#performance--instrumentation-cost-on-every-pr)
10. [Why the Gate Can Be Defeated — and What Backs It Up](#why-the-gate-can-be-defeated--and-what-backs-it-up)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Designing a coverage gate that scales to a large org and stays trustworthy — the mechanics, the failure modes, and the governance.**

By the middle level you can produce a coverage profile, upload it to Codecov or Coveralls, and turn on a patch-coverage status check that blocks a PR if the new lines aren't tested. That works on a small repo with one CI job. It quietly falls apart at scale, and the failures are subtle: the gate flips red on a force-push for no reason anyone can explain; a flaky shard drops a report and the whole project number craters; a thousand-package monorepo shows a package at 0% the day someone renames a file in it; a team games an 80% threshold with assertion-free tests and the number looks great while the suite tests nothing.

The senior jump is to treat the gate as a *system* with inputs that move underneath it. Patch coverage is a join of two things that both change — a **diff** computed against a base commit, and a **coverage profile** computed by tests that run in parallel and sometimes don't run at all. Get the join wrong and the gate is worse than nothing: it trains engineers that red means "retry CI," which is exactly the lesson you don't want them to learn. This page is the join, the edge cases, and the design decisions — base-diff computation, carryforward, monorepo flags, a correct ratchet, and the governance that keeps the whole thing honest.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — what a coverage profile is, project vs patch coverage, and how to upload to a coverage service from CI.
- **Required:** You can read a unified diff and you understand `git merge-base`, three-dot vs two-dot diff ranges, and what a force-push does to a branch's history.
- **Helpful:** You've operated CI for a repo big enough to have sharded tests and multiple independent build targets.
- **Helpful:** You've felt the pain of a flaky gate — a status check that's red for reasons unrelated to the change in front of you.

---

## Patch Coverage Against a Moving Base

Patch coverage answers one question: *of the lines this PR added or changed, what fraction did the tests execute?* The denominator is the diff; the numerator is the diff lines that the coverage profile marks as hit. Both halves are harder than they look, and almost every mysterious gate failure traces back to one of them being computed against the wrong reference.

**Computing the diff against the merge-base, not the branch tip.** The naive diff is "head of the PR branch vs head of `main`." That is the wrong diff, and it produces phantom coverage requirements. Consider: you branch off `main` at commit `A`, write your feature, and meanwhile `main` advances to `C` because a teammate merged unrelated work. A two-dot diff (`git diff main..feature`, equivalently `main feature`) shows *both* your changes *and the inverse of your teammate's changes* — lines that look added or removed in your PR but that you never touched. The gate then demands you cover code you've never seen.

The correct denominator is the **three-dot diff**, which diffs against the *merge-base* — the most recent common ancestor of the two branches:

```bash
# WRONG: two-dot — diff vs the literal tip of main, contaminated by main's own advance
git diff origin/main..HEAD

# RIGHT: three-dot — diff vs the merge-base (common ancestor), only YOUR changes
git diff origin/main...HEAD

# what the three dots resolve to, made explicit:
BASE=$(git merge-base origin/main HEAD)
git diff "$BASE" HEAD          # identical to the three-dot form above
```

Every credible coverage service computes patch coverage against the merge-base for exactly this reason. When you see a service report that the "base" of a PR is some commit that is *not* the current head of `main`, that is the merge-base, and it is correct. The base is a point in history, not "wherever `main` is right now."

**Line mapping when surrounding code shifts.** A coverage profile records "line 42 of `auth.go` was hit." But "line 42" is meaningless without a commit — if someone inserts ten lines above your function, your code is now at line 52, and a profile that still says "line 42" points at the wrong statement. This is why patch coverage must map *diff hunks* (which carry old-file and new-file line numbers in their `@@ -old,count +new,count @@` headers) onto the coverage profile computed *for the head commit*. The profile and the diff's "new" side must agree on what the head commit looks like. Mismatches here are the source of "coverage shows a line uncovered that I can see is tested": the profile was generated against a slightly different tree than the diff was computed against — a stale checkout, a generated file regenerated differently, or a profile uploaded from the wrong commit SHA.

**Rebases and force-pushes.** Interactive feature development force-pushes constantly — rebasing onto a newer `main`, squashing fixup commits, amending. Each force-push replaces the branch's commits with *new* SHAs. A coverage gate that keyed its stored results on the old head SHA now has no result for the new head, and a gate that re-derives the merge-base will compute a *different* base (because you rebased onto a newer ancestor) and therefore a *different* diff. Two consequences a senior must design for:

- The patch set genuinely changed: rebasing onto a `main` that touched the same file legitimately changes which lines are "new." The gate *should* recompute. The new number is the correct number; it is not a bug that it differs.
- The stored base/head SHAs are now dangling. A robust gate stores coverage results keyed by commit SHA in a content-addressed way and re-resolves the merge-base on every CI run, rather than caching "the base is commit X" across force-pushes. If your CI checks out a shallow clone (`--depth=1`), `git merge-base` can fail outright because the common ancestor isn't in the shallow history — a classic cause of "merge-base not found" that silently falls back to a two-dot or whole-file diff. Fetch enough history (or `--unshallow`) before computing the base.

```bash
# CI on a shallow checkout: deepen until the merge-base exists, then compute it
git fetch --no-tags --prune --depth=50 origin main
git merge-base origin/main HEAD || git fetch --unshallow origin
```

> **Key insight:** Patch coverage is a join between a *diff* and a *profile*, and the entire correctness of the gate rests on both being computed against the **same head commit** and a **merge-base** (three-dot) base — never the literal branch tip. When the gate behaves "randomly" across rebases, the cause is almost always a base/head SHA mismatch or a shallow clone that broke `merge-base`, not a flaky test.

---

## Carryforward — Surviving Shards, Flakes, and Skipped Jobs

At scale, a single coverage profile is the *merge* of many partial profiles: unit tests run in shard 1, integration tests in shard 2, an e2e suite in shard 3, each on its own runner, each producing a fragment. The coverage service combines them by SHA before computing project and patch numbers. This is the correct architecture — but it introduces a brutal failure mode.

**The dropped-shard cliff.** Suppose shard 2 (which happens to exercise the payments package) flakes out, OOMs, or is skipped because of a path filter. Its fragment never uploads. The service now has fragments from shards 1 and 3 only, merges them, and concludes that the payments package has *zero* coverage — not because the tests failed, but because the report that proves they ran is simply absent. Project coverage drops by a cliff, the gate goes red, and the diff in front of the engineer touched none of payments. This is the single most common reason a large-repo coverage gate becomes untrusted: it fails for reasons orthogonal to the change.

**Carryforward** is the fix. When a coverage service can't find a fresh report for some component on the current commit, it **carries forward** the most recent successful report for that component from an ancestor commit, rather than treating the missing data as 0%. The mechanism:

- Each fragment is tagged with a **flag** (a label like `unit`, `integration`, `payments`) so the service knows *which* component each fragment represents and which one is missing.
- A flag is marked **carryforward** in config. When a commit has no fresh upload for that flag, the service substitutes the last known report for it from the commit's ancestry.
- The merged profile is therefore "fresh fragments for what ran + carried-forward fragments for what didn't," which keeps the project number stable and the gate trustworthy.

```yaml
# codecov.yml — flags with carryforward so a missing shard doesn't zero out a component
flags:
  unit:
    paths: [src/]
    carryforward: true
  integration:
    paths: [src/]
    carryforward: true
  payments:
    paths: [src/payments/]
    carryforward: true
```

The trade-off is real and worth stating plainly: carryforward trades *freshness* for *stability*. A carried-forward report can be stale — if the payments tests have been silently broken for three commits and not uploading, carryforward will keep showing the old healthy number. So carryforward must be paired with an independent signal that the test *job itself* succeeded. Carryforward is the right answer to "a shard was skipped or flaked"; it is the *wrong* answer to "a shard has been failing and nobody noticed." Don't let coverage carryforward mask a red test job — those are separate gates, and conflating them lets a broken suite hide behind a green coverage badge.

> **Key insight:** A missing fragment and a zero-coverage fragment are *not the same thing*, and a naive merge conflates them into a cliff. Carryforward restores the distinction by substituting the last-known report for components that didn't report this run — but only the test-job-success gate can tell you whether "didn't report" means "was skipped" (fine) or "is broken" (not fine).

---

## Coverage at Monorepo Scale

A single global coverage percentage across a monorepo is nearly meaningless — it's an average over wildly different codebases owned by different teams, and it moves for reasons no single team controls. Scale demands that coverage be *decomposed* along the same axes the repo is: per-package, per-owner, per-build-target.

**Path-based flags and per-owner attribution.** The same flag mechanism that drives carryforward also drives decomposition. Define a flag per ownership boundary (often mirroring `CODEOWNERS`), each with a `paths` filter, and the service computes a coverage number *per flag*. Now the payments team's gate is a function only of `src/payments/`, the gate that blocks their PR reflects their code, and a frontend team's untested experiment can't drag the payments number down. Path-based flags are how you turn "the monorepo is at 73%" (useless) into "your package's patch coverage is 91%" (actionable).

**The "untouched package shows 0%" trap.** This is the monorepo-specific version of the dropped-shard cliff, and it bites hardest in shops running **test-impact analysis** (only run the tests affected by a change). If a PR touches only `src/search/`, a smart CI runs only the search tests. Those tests produce a coverage profile for `src/search/` — and *nothing* for `src/payments/`, because payments tests were correctly *not run*. A naive service merges that lone fragment, sees no data for payments, and reports payments at 0%. The project number collapses, and the gate blocks a PR that did exactly the right thing by not re-running irrelevant tests.

The resolution is the same primitive, applied deliberately: **carryforward flags per component, plus partial-coverage attribution that only judges the components a PR actually touched.**

- Carryforward supplies payments' last-known profile so it doesn't read as 0%.
- The *gate* is scoped to patch coverage on the touched paths, so even if some global number wobbles, the blocking decision is "did you cover the lines you changed in the packages you changed."

```yaml
# Per-package flags mirroring ownership; each carries forward so only-run-affected
# tests don't zero out the packages whose tests were (correctly) skipped.
flags:
  search:
    paths: [src/search/]
    carryforward: true
  payments:
    paths: [src/payments/]
    carryforward: true
coverage:
  status:
    patch:
      default:
        # judge the diff, not the global average — this is what blocks the PR
        target: 80%
        only_pulls: true
```

**Partial coverage attribution and TIA interactions.** Test-impact analysis and coverage are in tension by construction: TIA's whole point is to *not* run tests, and coverage's instinct is to read "didn't run" as "uncovered." Reconciling them is a senior responsibility. The durable design is to make the *affected set* and the *attributed set* the same: the components whose tests TIA chose to run are exactly the components whose coverage you treat as fresh this run; everything else is carried forward and excluded from the blocking decision. If your TIA system and your coverage system disagree about which components were in scope, you get phantom 0%s — so the affected-targets list from the build graph should feed *both* the test runner and the coverage flag selection from one source of truth.

> **Key insight:** A monorepo coverage system is the decomposition primitive (path-based flags) plus the staleness primitive (carryforward) plus a *scoping* discipline (judge only the touched paths). The "untouched package shows 0%" trap is what you get when you have the decomposition but skip the staleness handling — and it's lethal in any shop doing only-run-affected-tests, which is every monorepo above a certain size.

---

## The Ratchet, Implemented Correctly

A **ratchet** is a gate whose threshold can only move in the good direction: coverage may go up freely, but a PR that drops it gets blocked. It's the standard answer to slow erosion, and it's the place teams most often build something that's either useless or unbearable. The design space has two axes, and getting both right is the whole game.

**Axis 1: ratchet on new code, or on the whole project?** These produce opposite failure modes:

- **Whole-project ratchet** ("project coverage may never decrease"): superficially appealing, operationally miserable. It couples *every* PR to the global number, which moves for reasons the author doesn't control — deleting a well-tested file *drops* project coverage (you removed covered lines), and adding a large generated file *drops* it (you added uncovered lines), neither of which is a quality regression. Worse, it creates a perverse incentive: the easiest way to *raise* project coverage is to delete hard-to-test code. Whole-project ratchets train people to game the denominator.
- **New-code (patch) ratchet** ("changed lines must meet a threshold"): this is the correct primary gate. It judges the author on what they actually wrote, is stable against unrelated churn, and is exactly the lever that *bends the curve* — if every new line is ≥80% covered, the whole project monotonically trends toward 80% as code is rewritten, with zero pressure on untouched legacy.

**Axis 2: the legacy deadlock vs the slow-erosion problem.** A pure whole-project floor creates an *impossible-to-improve* deadlock: a legacy module sits at 30%, the floor is set at the current 30%, and now nobody can refactor it — any change that touches the file risks nudging the number down, so the safest move is to never touch it, which guarantees it stays at 30% forever. Meanwhile, a gate with *no* floor at all lets coverage erode one untested PR at a time. The correct design escapes both:

1. **Patch coverage gate (high threshold, e.g. 80–90%)** on changed lines — stops *new* erosion at the source. This is the workhorse.
2. **Project coverage gate with a small tolerance threshold** (e.g. "project may not drop more than 0.1%, measured against the merge-base") — a backstop that catches mass deletions of tests without coupling every PR to the exact global number. The tolerance is what prevents the legacy deadlock: small, well-intentioned refactors that momentarily dip the number stay under the threshold.
3. **Baseline stored against the merge-base**, never against a frozen historical commit. The thing you compare to is "the project as of the common ancestor," recomputed every run.

**Baseline storage — where the comparison number lives.** The ratchet needs a trustworthy "before" number to compare against. Two viable designs:

- **Service-stored baseline (the common path):** the coverage service stores each commit's coverage keyed by SHA, and on a PR it looks up the merge-base's stored number and compares. This is what Codecov/Coveralls do; the baseline is always "the merge-base commit's coverage," recomputed by re-resolving the merge-base each run, which is exactly why it survives rebases.
- **In-repo baseline file (the self-hosted path):** commit a `coverage-baseline.json` to the repo; CI fails the PR if measured coverage is below it, and a *separate* automated job bumps the file upward when coverage improves on `main`. The subtlety: the bump must be automatic and one-directional. If humans edit the baseline, they'll edit it *down* under deadline pressure, and the ratchet rusts. The bump job is the pawl that makes the ratchet a ratchet.

```bash
# In-repo ratchet sketch: fail if below baseline; the baseline only moves up,
# and only via an automated job on the protected branch — never by hand on a PR.
MEASURED=$(go test ./... -coverprofile=cover.out >/dev/null 2>&1; \
           go tool cover -func=cover.out | awk '/^total:/ {print substr($3,1,length($3)-1)}')
BASELINE=$(jq -r .total coverage-baseline.json)

awk -v m="$MEASURED" -v b="$BASELINE" 'BEGIN { exit (m + 0.0 < b - 0.1) }' || {
  echo "Coverage regressed: ${MEASURED}% < baseline ${BASELINE}% (tolerance 0.1)"; exit 1; }

# Separate job, runs ONLY on main after merge, ONLY ratchets upward:
awk -v m="$MEASURED" -v b="$BASELINE" 'BEGIN { exit !(m + 0.0 > b + 0.0) }' \
  && jq --arg m "$MEASURED" '.total = ($m | tonumber)' coverage-baseline.json > tmp && mv tmp coverage-baseline.json
```

> **Key insight:** A correct ratchet is *two gates with different scopes*: a high patch-coverage threshold on new code (stops erosion, bends the curve) plus a low-tolerance project-coverage backstop against the merge-base (catches mass test deletion without coupling every PR to the global number). The single most common mistake — a strict whole-project floor — produces both the impossible-to-improve-legacy deadlock *and* an incentive to delete hard code, which is the opposite of what you wanted.

---

## Gate Design — Blocking vs Advisory, Thresholds, and Exclusion Governance

A coverage gate is a social instrument as much as a technical one. The mechanics are easy; the question of *what the gate does to people's behavior* is where senior judgment lives.

**Blocking vs advisory.** A *blocking* gate fails the PR's required status check and prevents merge; an *advisory* gate posts the number as a comment or a non-required check but doesn't block. The decision is not ideological:

- Make patch coverage **blocking** once the team trusts it — that requires the determinism and carryforward work below to be done first. A blocking gate that's flaky is actively harmful: it teaches "red means re-run CI," which corrodes the meaning of *every* red check, not just coverage.
- Keep project coverage **advisory** (or a low-tolerance backstop, per the ratchet) — a hard project floor is the deadlock generator.
- Roll out new gates **advisory first**, watch the numbers for a few weeks to calibrate the threshold against reality, *then* flip to blocking. Flipping a gate to blocking on day one with a guessed threshold is how you get a wave of override requests and a gate everyone resents.

**Patch threshold height.** The threshold is a dial with two failure modes. Too low (50%) and the gate doesn't change behavior — people clear it without writing meaningful tests. Too high (100%) and you've mandated covering trivial code (getters, generated stubs, defensive `if err != nil` branches that can't be provoked in a unit test), which pushes people toward exclusions and assertion-free tests just to pass. The pragmatic band most mature orgs land in is **80–90% on the patch**, often with the rule "new code meets the threshold; the *target* for a file is `auto` — the file's existing coverage — so you can't make a file worse." A subtle, humane refinement is to set the patch target to `auto` with a small allowed drop, so a PR that adds one hard-to-test line to an otherwise well-covered change isn't blocked over a single line.

**Exclusion governance — who gets to write `no cover`.** Every coverage tool has an escape hatch: `// :coverage:ignore`, `# pragma: no cover`, `/* istanbul ignore next */`, `:nocov`. These exist for legitimate reasons — genuinely unreachable defensive code, platform-specific branches that can't run on the CI OS, generated code. They are also the single easiest way to defeat the gate: annotate the untested branch as ignored and the denominator shrinks until the number is green. Governance is therefore not optional:

- **Exclusions are code review surface.** An added `no cover` should be as scrutinized as a disabled test — it's the same act (removing something from the safety net). Make exclusion-adds visible in review (they show up in the diff) and require a reason comment.
- **Centralize blanket exclusions in config, not scattered inline.** Whole-category exclusions (generated files, `*_test.go`, vendored code, `main.go` wiring) belong in `codecov.yml` / `.coveragerc` / config — reviewed once, owned by the platform team — not as a thousand inline pragmas that each erode the number invisibly.
- **Bound who can change the config.** Put the coverage config behind `CODEOWNERS` so the platform/quality team reviews threshold changes and exclusion-category changes. The failure mode you're preventing is a team under deadline lowering its own threshold or excluding its own package, then never raising it back.

```yaml
# Centralized, reviewable exclusions — owned by the quality team via CODEOWNERS.
ignore:
  - "**/*_test.go"
  - "**/mock_*.go"
  - "**/*.pb.go"          # generated protobuf
  - "cmd/**/main.go"      # thin wiring, exercised by e2e not unit
coverage:
  status:
    patch:
      default:
        target: 85%
        threshold: 1%      # allow a 1% slack so one defensive line doesn't block
    project:
      default:
        target: auto       # compare to merge-base, not a frozen floor
        threshold: 0.1%    # low-tolerance backstop against mass test deletion
```

> **Key insight:** The gate's threshold and its exclusion policy are coupled — the higher you set the threshold, the harder you push people toward exclusions and assertion-free tests. Treat `no cover` as safety-net removal that requires review, centralize blanket exclusions behind `CODEOWNERS`, and roll gates out advisory-before-blocking. A flaky blocking gate is worse than no gate, because it teaches the team to ignore red.

---

## Determinism — Flaky Coverage Under Parallelism and `-race`

A gate is only trustworthy if the same code produces the same coverage number. Coverage instrumentation is shared mutable state — a set of counters that every test increments — and at scale it runs under heavy parallelism, which means the same race conditions that plague application code can plague the *measurement itself*. Flaky coverage (the number jitters run-to-run on identical code) destroys trust faster than anything, because it makes the gate's red/green non-reproducible.

**Atomic counters under parallel and `-race` execution.** Most coverage instrumentation works by incrementing a per-statement counter when a statement executes. If tests run in parallel goroutines/threads and the counters are plain (non-atomic) increments, two threads can race on the same counter — a lost update *undercounts*, making a covered line occasionally read as uncovered. Go makes this an explicit choice with `-covermode`:

```bash
# set: did this line run at all? (1 bit, cheapest, but increments can race under -race)
go test -covermode=set ./...

# count: how many times? (race-prone counters under parallel tests)
go test -covermode=count ./...

# atomic: race-safe counters — REQUIRED when running tests in parallel or with -race
go test -covermode=atomic -race ./...
```

The rule is non-negotiable at scale: **if your tests run in parallel or under `-race`, use `-covermode=atomic`.** `set` and `count` use ordinary memory writes that are themselves data races under concurrent execution; `atomic` uses atomic increments that are correct but slightly slower. Using a non-atomic mode with `t.Parallel()` or `-race` produces coverage numbers that drift run-to-run — the textbook cause of "the same commit got 84% yesterday and 83% today." Other ecosystems have the same hazard under a different name: JVM agents and Istanbul each rely on the runtime's memory model for counter updates, and parallel test execution can perturb the merge if fragments aren't combined deterministically.

**Non-deterministic instrumentation and merge order.** Even with atomic counters, two sources of jitter remain:

- **Source-based vs SHA-keyed merges.** When N shards each emit a fragment and the service merges them, the merge must be *commutative and idempotent* — the union of "hit" sets is order-independent, but a buggy merge (e.g., one that overwrites rather than unions, or that keys fragments by job name and silently drops a duplicate) introduces order-dependence and therefore flakiness. Prefer line-set *union* semantics.
- **Tests whose execution path depends on timing, ordering, or randomness.** If a test sometimes takes a fast path and sometimes a slow path (a cache that's sometimes warm, a goroutine that sometimes wins a select), the *set of covered lines* differs between runs even though the test "passes" both times. This is real coverage flakiness rooted in the tests, not the instrumentation, and the fix is to make the tests deterministic (seed RNGs, fix clocks, drain async work) — the same discipline that makes the *suite* trustworthy makes its *coverage* trustworthy.

> **Key insight:** Coverage counters are shared mutable state, so parallel and `-race` test execution can corrupt the measurement exactly the way it corrupts application data. `-covermode=atomic` (or its per-ecosystem equivalent) is mandatory under parallelism; without it, the gate's number jitters and the team learns to disbelieve it. Determinism of coverage is downstream of determinism of the tests themselves.

---

## Performance — Instrumentation Cost on Every PR

Coverage is not free, and the cost is paid on *every PR* — it sits directly on the critical path of the edit-build-test loop and the merge queue. A senior treats coverage instrumentation as a performance budget item, not an always-on default, because an instrumented test run that's 2–3x slower than an uninstrumented one taxes every contributor every day.

**Where the cost comes from.** Instrumentation adds a counter increment (or an atomic increment, which is more expensive) at every statement or branch, inflates the binary, and disables some compiler optimizations (the instrumentation points must survive, so inlining and dead-code elimination are constrained). For interpreted/bytecode languages the overhead is a per-line callback. Typical slowdowns range from ~10–30% (Go `set`) to 2x+ (atomic count under `-race`, or line-callback profilers like Python's `coverage.py` in trace mode). On a suite that already takes twenty minutes, that's a material tax repeated thousands of times a week.

**When to sample instead of always-instrument.** The design lever is to decouple *blocking patch coverage* (must run on every PR, but only needs the diff's lines) from *full project coverage* (expensive, but doesn't need to block every PR):

- **Run instrumented coverage on the PR, but only compute the gate from the diff.** You still pay instrumentation on the PR run, but you don't need a *separate* uninstrumented run if you accept the instrumented timings — or you run the fast uninstrumented suite as the *test* gate and a parallel instrumented run only for the *coverage* number.
- **Sample full-project coverage on a schedule, not per-PR.** Compute the authoritative whole-repo number nightly (or on merge to `main`), where a 2x slowdown on one run is acceptable, and rely on patch coverage for per-PR signal. This is the standard way large orgs avoid paying full instrumentation on every PR: per-PR gets patch coverage, the dashboard gets nightly project coverage.
- **C++/Rust source-based coverage** (`llvm-cov` with `-fprofile-instr-generate -fcoverage-mapping`) is cheaper than the old gcov approach and integrates with the build, but it still inflates link time and binary size — budget it like any other build-time cost (ties directly into [Build Systems](../../build-systems/) thinking about what runs on every build).

> **Key insight:** Instrumentation cost is paid per-PR and lands on everyone's critical path. The scalable pattern is to *separate the cadences*: patch coverage (cheap, scoped to the diff) blocks every PR, while full-project coverage (expensive) is sampled nightly or on merge. Don't make every engineer pay for the whole-repo number on every push.

---

## Why the Gate Can Be Defeated — and What Backs It Up

Here is the uncomfortable truth a senior must internalize before they trust a coverage gate too much: **coverage measures execution, not verification, so an assertion-free test passes the gate while testing nothing.** The gate is satisfiable without any of the quality it's supposed to proxy for.

The defeat is trivial and looks like this:

```go
// This "test" drives 100% line and branch coverage of Withdraw — and asserts NOTHING.
// It will sail through any coverage gate while proving the function does not crash, and
// literally nothing else. The balance could be wrong, negative, or unchanged — green.
func TestWithdraw_GamesTheGate(t *testing.T) {
    acct := &Account{balance: 100}
    _ = acct.Withdraw(30)
    _ = acct.Withdraw(1000) // exercises the overdraft branch — still no assertion
}
```

Both lines and the overdraft branch are now "covered." The coverage number is perfect. The test verifies *nothing*. Multiply this across a team optimizing for a threshold and you get a suite with high coverage and near-zero defect-detection power — the exact Goodhart failure the [code-coverage README](../README.md) opens with: *when a measure becomes a target, it ceases to be a good measure.*

This is not an argument against coverage gates; it's an argument about what they can and cannot do, and what must back them up:

- **Coverage gates catch the *absence* of execution; they cannot certify the *presence* of verification.** A high patch-coverage number means "you ran this code in a test," which is necessary but wildly insufficient for "this code is tested."
- **Mutation testing is the gate that catches assertion-free tests.** It deliberately introduces faults (mutants) and checks whether your tests *fail* — an assertion-free test kills no mutants, so a low mutation score exposes exactly the gaming that coverage rewards. This is why mature setups pair a coverage gate with a mutation signal on the diff. (See [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/senior.md) for how the tools emit the profiles, and the dedicated [Mutation Testing](../../testing/07-mutation-testing/) topic for the technique.)
- **Code review is the human backstop.** A reviewer who reads the *tests*, not just the coverage badge, is the most reliable detector of assertion-free and tautological tests. The gate's job is to surface the lines that *weren't* run so review can focus; it is not a substitute for review.
- **The framing that makes all of this coherent is "coverage as signal, not target."** A gate is a forcing function to keep the signal from rotting, not a definition of done. The moment the org treats the percentage as the goal, the gaming begins. This is the through-line developed in [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/senior.md), and it is the most important idea in this entire roadmap section.

> **Key insight:** A coverage gate is *defeasible by construction* — assertion-free tests satisfy it completely while verifying nothing — so it must be backed by mutation testing (which catches non-asserting tests) and code review (which reads the tests). Coverage tells you what wasn't run; it can never tell you that what ran was actually checked. Design the gate as one layer, not the whole defense.

---

## Mental Models

- **Patch coverage is a join of two moving inputs.** A *diff* (computed three-dot, against the merge-base) and a *profile* (computed by tests, possibly sharded). Every mysterious gate behavior is a mismatch between them — wrong base, wrong head SHA, shallow clone, dropped fragment. When the gate looks flaky, suspect the join, not the tests.

- **Missing data ≠ zero coverage.** A shard that didn't upload, or a package whose tests were correctly skipped by test-impact analysis, is *unknown*, not *uncovered*. Carryforward is the primitive that restores that distinction; conflating them is the dropped-shard cliff and the "untouched package shows 0%" trap.

- **A correct ratchet is two gates with different scopes.** A high patch threshold on new code (stops erosion, bends the curve) plus a low-tolerance project backstop against the merge-base (catches mass deletion). A single strict whole-project floor produces both the legacy deadlock and an incentive to delete hard code.

- **Coverage counters are shared mutable state.** Under parallel or `-race` execution they suffer the same races as application data. `-covermode=atomic` is the fix; without it the number jitters and trust evaporates. Coverage determinism is downstream of test determinism.

- **The gate is defeasible.** Assertion-free tests pass it completely. It catches the *absence* of execution, never the *presence* of verification — so it lives inside a stack with mutation testing and code review, and under the framing "signal, not target."

---

## Common Mistakes

1. **Computing the diff two-dot (`main..HEAD`) instead of three-dot (`main...HEAD`).** The two-dot diff is contaminated by `main`'s own advance, so the gate demands coverage of lines the author never touched. Always diff against the merge-base.

2. **Shallow-cloning in CI and then computing the merge-base.** `git merge-base` fails when the common ancestor isn't in the shallow history, and the gate silently falls back to a whole-file or two-dot diff. Deepen or `--unshallow` before resolving the base.

3. **Treating a missing shard's report as 0% coverage.** A flaked or skipped shard whose fragment never uploaded craters the project number for reasons unrelated to the change. Use carryforward flags so "didn't report" doesn't read as "uncovered" — but pair it with a separate test-job-success gate so a *broken* shard can't hide behind it.

4. **A single global coverage number for a monorepo.** It averages incomparable codebases and moves for reasons no one team controls. Decompose with path-based flags per owner, and judge PRs on patch coverage of the touched paths.

5. **The "untouched package shows 0%" trap under test-impact analysis.** TIA correctly skips a package's tests, the service reads the absent fragment as 0%, and the gate blocks a correct PR. Carryforward per component, and feed the affected-targets list to *both* the test runner and the coverage flag selection from one source of truth.

6. **A strict whole-project floor as the ratchet.** It creates the impossible-to-improve-legacy deadlock (nobody dares touch the 30% module) *and* rewards deleting hard-to-test code (which raises the number). Use a high patch threshold plus a low-tolerance project backstop instead.

7. **A human-editable in-repo baseline.** If people can edit the baseline, they edit it *down* under deadline pressure and the ratchet rusts. The upward bump must be an automated, one-directional job on the protected branch.

8. **Non-atomic coverage mode under parallel/`-race` tests.** `set`/`count` use racy increments that drift run-to-run, producing "84% yesterday, 83% today" on identical code. Use `-covermode=atomic`.

9. **Flipping a gate to blocking on day one with a guessed threshold.** Roll out advisory first, calibrate against real numbers for a few weeks, then block. A flaky blocking gate teaches the team that red means "retry CI."

10. **Trusting the percentage as proof of quality.** Assertion-free tests give 100% coverage and verify nothing. Back the gate with mutation testing and review, and frame it as signal, not target.

---

## Test Yourself

1. A PR branched off `main` last week. Since then `main` advanced with unrelated work. The coverage gate demands coverage of lines the author swears they never touched. What's the likely cause and the fix?
2. Your CI runs tests in three shards. One shard flakes and its report never uploads. Project coverage drops by a cliff and the gate goes red on a PR that touched none of that shard's code. Name the mechanism that prevents this and the trade-off it introduces.
3. A monorepo runs only-affected-tests. A PR touches `src/search/` only, and the gate reports `src/payments/` at 0% and blocks. Explain the trap and the two-part fix.
4. Design a ratchet that stops slow erosion *and* doesn't deadlock a legacy module stuck at 30%. What two gates, with what scopes?
5. Why is a strict "project coverage may never decrease" gate actively harmful? Give two distinct failure modes.
6. The same commit reported 84% coverage yesterday and 83% today, with no code change. What's the most likely cause in a parallel test suite, and the fix?
7. A team's package is at 90% line coverage, and the gate is green. Why is that not evidence the code is well tested, and what two things must back up the gate?

<details>
<summary>Answers</summary>

1. The gate is computing a **two-dot diff** (`main..HEAD`) or has a stale base, so it includes the inverse of `main`'s own advance as phantom "added" lines. Fix: compute patch coverage against the **merge-base** with a **three-dot diff** (`main...HEAD`), which every credible coverage service does — the "base" is the common ancestor, not the current tip of `main`.

2. **Carryforward**: when a component's fresh report is missing for a commit, the service substitutes that component's last-known report from an ancestor commit, so "didn't report" doesn't read as "0%." The trade-off is **freshness for stability** — a carried-forward report can be stale, so it must be paired with an independent **test-job-success** gate so a *broken* (not merely skipped) shard can't hide behind a green coverage number.

3. The trap: test-impact analysis correctly skips the payments tests, so no fragment is produced for payments; a naive merge reads the absent data as 0%, collapsing the project number and blocking a correct PR. Two-part fix: (a) **per-component carryforward flags** so payments shows its last-known profile rather than 0%; (b) **scope the gate to patch coverage of the touched paths**, and feed the affected-targets list to both the test runner and the coverage flag selection from one source of truth so they agree on scope.

4. **Gate 1 — patch coverage** on changed lines with a high threshold (80–90%): stops *new* erosion at the source and bends the whole-project curve upward as code is rewritten, with zero pressure on untouched legacy. **Gate 2 — project coverage backstop** against the merge-base with a small tolerance (e.g. may not drop >0.1%): catches mass test deletion without coupling every PR to the exact global number. The tolerance is what prevents the legacy deadlock — small refactors that momentarily dip the number stay under the threshold.

5. (a) **Legacy deadlock:** a module at 30% with the floor set to 30% can never be refactored, because any change risks nudging it down, so the safe move is to never touch it — freezing it forever. (b) **Perverse incentive:** the easiest way to *raise* project coverage is to **delete hard-to-test code**, so the gate rewards removing exactly the code most in need of tests. It also flips red on benign events like deleting a well-covered file.

6. In a parallel suite the cause is almost certainly **non-atomic coverage counters** (`-covermode=set`/`count`, or the ecosystem equivalent) racing under `t.Parallel()`/`-race`, so lost updates occasionally undercount a line. Fix: **`-covermode=atomic`**, which uses race-safe atomic increments. (Secondary causes: a non-commutative fragment merge, or tests whose covered-line set depends on timing/RNG — fix by making the merge a line-set union and the tests deterministic.)

7. Coverage measures **execution, not verification** — an **assertion-free test** drives 100% coverage while checking nothing, so 90% only means those lines *ran* in some test, not that their behavior was asserted. The gate must be backed by (a) **mutation testing**, which introduces faults and checks whether tests *fail* — assertion-free tests kill no mutants and are exposed by a low mutation score; and (b) **code review** that reads the *tests*, not just the badge. Frame coverage as **signal, not target**.

</details>

---

## Cheat Sheet

```
PATCH COVERAGE = (diff lines hit) / (diff lines)   — judge the change, not the repo
  BASE  = git merge-base origin/main HEAD          (three-dot, NOT the tip of main)
  git diff origin/main...HEAD                       three-dot  = your changes only
  git diff origin/main..HEAD                        two-dot    = WRONG (incl. main's advance)
  shallow clone? git fetch --unshallow first or merge-base fails → bad fallback diff

CARRYFORWARD (missing ≠ zero)
  a shard/flag that didn't upload → carry forward its last-known report (don't read 0%)
  pair with a separate TEST-JOB-SUCCESS gate so a BROKEN shard can't hide behind green
  flags: { unit: {paths:[src/], carryforward: true}, payments: {paths:[src/payments/], carryforward: true} }

MONOREPO
  path-based flags per owner (mirror CODEOWNERS) → per-package numbers, not one average
  only-run-affected-tests → untouched pkg has no fragment → carryforward + scope gate to touched paths
  feed affected-targets list to BOTH test runner AND coverage flag selection (one source of truth)

RATCHET (two gates, different scopes)
  patch  : target 80–90% on NEW code      → stops erosion, bends the curve
  project: target auto, threshold ~0.1%   → backstop vs mass test deletion (NOT a hard floor)
  in-repo baseline: bump UP automatically on main only; humans never edit it down

DETERMINISM
  go test -covermode=atomic -race ./...    REQUIRED under parallel / -race (set/count race → jitter)
  merge fragments as a line-set UNION (commutative, idempotent) — order-independent

GATE DESIGN
  advisory first → calibrate → blocking    (flaky blocking gate teaches "red = retry CI")
  patch = blocking once trusted; project = advisory/backstop (hard floor = deadlock)
  `no cover` / pragma = safety-net removal → review it; centralize blanket excludes behind CODEOWNERS

DEFEAT & BACKUP
  assertion-free test = 100% coverage, 0 verification → coverage proves execution, not checking
  back with: mutation testing (kills non-asserting tests) + code review (reads the tests)
```

---

## Summary

- **Patch coverage is a join** of a *diff* and a *profile*. The diff must be computed **three-dot, against the merge-base** (`main...HEAD`), not against the literal tip of `main` — and on shallow clones you must deepen history first or `git merge-base` fails into a bad fallback. Rebases legitimately change the diff; a robust gate re-resolves the merge-base every run rather than caching a base SHA across force-pushes.
- **Missing data is not zero coverage.** A flaked/skipped shard or a TIA-skipped package produces *no fragment*, which a naive merge reads as 0% — the dropped-shard cliff and the "untouched package shows 0%" trap. **Carryforward** substitutes the last-known report so the distinction survives, at the cost of freshness, which is why it must be paired with a separate test-job-success gate.
- **Monorepos demand decomposition:** path-based **flags** per owner turn a meaningless global average into actionable per-package numbers, and the gate should judge patch coverage of the *touched paths*. Feed the affected-targets list to both the test runner and the flag selection from one source of truth.
- **A correct ratchet is two gates:** a high **patch threshold** on new code (stops erosion, bends the curve) plus a low-tolerance **project backstop** against the merge-base (catches mass test deletion). A strict whole-project floor produces both the legacy deadlock and an incentive to delete hard code; an in-repo baseline must ratchet upward automatically and never be human-editable.
- **Determinism is mandatory:** coverage counters are shared mutable state, so `-covermode=atomic` (or its equivalent) is required under parallel/`-race` execution, and fragment merges must be commutative line-set unions. A flaky gate teaches the team to ignore red.
- **The gate is defeasible:** assertion-free tests give perfect coverage and verify nothing. Coverage proves *execution*, never *verification*, so it must be backed by **mutation testing** and **code review**, and framed as **signal, not target**.

You can now design a coverage gate that an org will trust: correct against a moving base, stable across shards and monorepo scale, ratcheted without deadlock, deterministic, and honest about its own limits. The next page — [professional.md](professional.md) — is about operating that gate across many teams over years: the dashboards, the SLAs, the override workflow, and the cultural maintenance that keeps a gate from rotting into theater.

---

## Further Reading

- *Software Engineering at Google* — Winters, Manshreck, Wright. The coverage chapter on why Google does **not** enforce a global threshold, and how it favors per-change signal over project percentages.
- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay on coverage as a diagnostic for untested code, not a target.
- [Codecov documentation — Carryforward Flags and Components](https://docs.codecov.com/docs/carryforward-flags) — the reference for flags, carryforward, and the merge-base/patch model in a real coverage service.
- [Coveralls documentation — Parallel builds and `done` webhooks](https://docs.coveralls.io/parallel-build-webhook) — how to combine sharded reports and signal completion so a missing shard doesn't corrupt the number.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018). The argument that mutation results, surfaced as review hints, beat coverage percentages as a quality signal — the empirical backbone of "back the gate with mutation."
- `git help diff` and the Pro Git book's *Revision Selection* chapter — the precise semantics of two-dot vs three-dot ranges and `merge-base`, which underpin the entire patch-coverage computation.

---

## Related Topics

- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/senior.md) — how Go `-covermode`, JaCoCo, Coverage.py, and llvm-cov emit the profiles and report formats the gate consumes and merges.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/senior.md) — Goodhart's law in practice, gaming the number, and why the gate is a forcing function, not a definition of done.
- [Mutation Testing](../../testing/07-mutation-testing/) — the technique that catches the assertion-free tests a coverage gate rewards; the primary backup signal for any coverage gate.
- [Performance → Regression Testing](../../performance/07-performance-budgets-and-regression-testing/) — the same advisory-then-blocking, baseline-and-ratchet pattern applied to performance budgets, where the moving-base and flakiness problems recur.
- [Build Systems](../../build-systems/) — instrumentation as a build-time cost, and the test-impact-analysis machinery that drives only-run-affected-tests and the per-component coverage scoping it requires.
