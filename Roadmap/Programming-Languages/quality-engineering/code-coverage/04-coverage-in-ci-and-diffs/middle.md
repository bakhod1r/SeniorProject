# Coverage in CI & Diffs — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage in CI & Diffs
> *The junior page got a number to show up on a PR. This page makes that number trustworthy and useful: how diff coverage is actually computed, how to gate on new code without freezing the whole repo, and why "coverage dropped" is usually a merge-the-shards bug, not a testing failure.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How Diff/Patch Coverage Is Actually Computed](#how-diffpatch-coverage-is-actually-computed)
4. [Project vs Patch: Two Different Questions](#project-vs-patch-two-different-questions)
5. [The Ratchet — Clean as You Code](#the-ratchet--clean-as-you-code)
6. [Merging Coverage from Parallel Shards](#merging-coverage-from-parallel-shards)
7. [Flaky Coverage: Causes and Fixes](#flaky-coverage-causes-and-fixes)
8. [Configuring the Gate Without Annoying Everyone](#configuring-the-gate-without-annoying-everyone)
9. [Making the Report Actionable](#making-the-report-actionable)
10. [Worked Example — A Real codecov.yml + Shard-Merge Workflow](#worked-example--a-real-codecovyml--shard-merge-workflow)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I wire up a coverage gate that catches real gaps without becoming the thing everyone hates?**

The junior page got coverage *visible*: a tool runs, a percentage appears, a bot comments on the PR. That is the easy 20%. The hard 80% is making the gate *useful* — blocking the PRs that genuinely under-test new behaviour while staying silent on everything else.

Get this wrong and one of two things happens. Either the gate is toothless (a global "80% project" threshold that a 4-line PR can't move, so it never fails and nobody reads it), or the gate is a tyrant (it fails because a 12-job test matrix only uploaded one shard, and now you're re-running green builds and adding `# pragma: no cover` to make the bot shut up). Both outcomes train the team to *ignore* coverage, which is worse than not measuring it at all.

This page is about the machinery that separates the two outcomes: **patch coverage** (judge the diff, not the repo), the **ratchet** ("don't make it worse"), and **report merging** (combine every shard *before* you compute the number). Get those three right and the gate becomes a quiet, trusted signal instead of CI noise.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain line vs branch coverage and what a coverage report contains.
- **Required:** You know how to produce a coverage report in at least one language — see [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/middle.md).
- **Required:** Comfortable reading a CI YAML file (GitHub Actions here, but the ideas port to GitLab CI, CircleCI, etc.).
- **Helpful:** You've seen a PR blocked by a status check and wondered who decided the threshold.
- **Helpful:** A rough sense of what a unified `git diff` looks like (the `@@ -a,b +c,d @@` hunk headers matter here).

---

## How Diff/Patch Coverage Is Actually Computed

"Patch coverage" sounds like a special metric. It isn't. It's an **intersection of two sets you already have**:

1. **The changed lines** — the added/modified lines in this PR, which the coverage service reads straight from the `git diff` between the PR head and its merge base.
2. **The coverage report** — every executable line, each tagged *hit* or *missed*.

The algorithm is exactly this:

```
changed_lines      = added/modified executable lines in the diff
covered_changed    = changed_lines ∩ {lines marked HIT in the report}
uncovered_changed  = changed_lines ∩ {lines marked MISS in the report}

patch_coverage = |covered_changed| / (|covered_changed| + |uncovered_changed|)
```

Only the **changed-and-uncovered** lines can fail you. A line you didn't touch that has always been uncovered is *invisible* to patch coverage — it's not in `changed_lines`, so it never enters the calculation. Likewise a changed line that isn't executable (a comment, a blank line, a brace on its own) is dropped, because it isn't in the coverage report at all.

```diff
@@ -10,3 +10,7 @@ func Withdraw(amount int) error {
   if amount <= 0 {
       return ErrBadAmount        // line 11 — changed, HIT  ✅
   }
+  if amount > balance {
+      return ErrInsufficient     // line 14 — changed, MISS ❌  ← this is what fails you
+  }
   balance -= amount              // line 16 — changed, HIT  ✅
```

Patch coverage here is 2/3 ≈ 67%: three changed executable lines, one of them (`return ErrInsufficient`) never exercised by a test. The fix is obvious and *local* — add a test that withdraws more than the balance. That locality is the whole point: patch coverage tells you which **new** behaviour you forgot to test, and points at the exact line.

> **Key insight:** Patch coverage is `diff ∩ report`. It is not a property of your codebase — it's a property of *this change*. That's why it works on a 4-line PR where a project-wide percentage is statistically frozen: the denominator is the lines you just wrote, not the millions you didn't.

---

## Project vs Patch: Two Different Questions

Codecov ships two status checks, and they answer genuinely different questions. Conflating them is the single most common configuration mistake.

| Status | Question | Denominator | Good as a gate? |
|---|---|---|---|
| **`project`** | Did *overall* repo coverage hold or improve? | Every line in the repo | As a **ratchet** (don't regress), yes. As an absolute bar, rarely. |
| **`patch`** | Did *this PR's new/changed* code get tested? | Only the changed lines | **Yes** — this is the gate that should usually block. |

The trap is gating *only* on an absolute `project` target like "must be ≥ 80%." On a large codebase, a single PR moves total coverage by a rounding error, so the check passes regardless of how badly the PR is tested — it's not measuring the PR at all. Meanwhile a healthy repo that's legitimately at 78% can't merge *anything*, including a one-line typo fix, until someone backfills tests for unrelated code. Both failure modes come from asking the project metric to do the patch metric's job.

The `threshold` knob exists to stop the `project` check from **flapping**. Coverage isn't perfectly stable — instrumentation rounding, a test that touches one extra line, reordering — so the exact percentage drifts ±0.1% between identical-ish runs. Without tolerance, that drift fails builds at random. `threshold: 0.5%` tells Codecov: "only fail `project` if coverage drops by *more than* half a point." It absorbs noise while still catching a real regression.

```yaml
coverage:
  status:
    project:
      default:
        target: auto        # compare against the base commit, not a fixed number
        threshold: 0.5%     # allow ≤0.5% drop before failing — kills flapping
    patch:
      default:
        target: 80%         # NEW code must be ≥80% covered to merge
```

`target: auto` is the ratchet in disguise: instead of a hardcoded bar, it compares this commit against the base branch's coverage. The check fails only if you made it *worse* (beyond `threshold`). That's almost always what you actually want from the project check.

> **Key insight:** `patch` answers "is the new code tested?" and should block. `project` answers "did we backslide?" and should be a ratchet (`target: auto` + a `threshold`), not an absolute number. Use both; give them different jobs.

---

## The Ratchet — Clean as You Code

The **ratchet** is the policy that makes coverage improve monotonically without a heroic backfill: *coverage may go up or stay flat, but it may not go down.* A ratchet (the tool) only turns one way; so does this gate.

Two equivalent framings, depending on the platform:

- **Codecov / Coveralls:** `project` with `target: auto` + `threshold`. Each merge sets the new floor; the next PR is measured against it. The repo climbs as a side effect of normal work.
- **SonarQube / SonarCloud "Clean as You Code":** don't gate the whole repo at all — gate the *New Code* period. The quality gate says "Coverage on New Code ≥ 80%." Legacy code is grandfathered in; you are only ever responsible for the code you're touching *now*.

Both encode the same insight: **you cannot retroactively test a million lines of legacy, and you shouldn't have to.** What you *can* do is refuse to add new untested code. Over months, the proportion of well-tested code rises monotonically because every change either improves coverage or holds it. This is dramatically more achievable — and more honest — than picking a global "90%" that the existing codebase will never reach, then watching the team route around it.

> **Key insight:** A ratchet converts an impossible one-time project ("get the whole repo to 90%") into a sustainable per-PR habit ("don't add untested code"). The number rises because the gate only turns one way — no backfill required.

---

## Merging Coverage from Parallel Shards

Here is the bug that bites *every* team that scales their test suite. You split tests across a matrix — 8 parallel jobs, or shards by package, or by OS — to cut wall-clock time. Each job runs a *subset* of the tests, so each job's coverage report only reflects *its* subset. Job 3 ran the auth tests, so it sees `auth.go` as well covered and everything else as uncovered.

If each job uploads its partial report **as if it were the whole truth**, the coverage service may compute the number off one shard, or average them, and you get the classic symptom:

> "Coverage dropped to 12% and the PR is blocked — but we didn't delete any tests."

Coverage didn't drop. You measured one-eighth of it. The fix is to **merge first, compute second**: collect all N partial reports, combine them into one, *then* derive the percentage. A line is covered if **any** shard hit it.

There are two correct shapes for this:

**Shape A — merge on the service (let Codecov combine uploads).** Each job uploads its partial report. You tell Codecov how many uploads to expect; it waits for all of them, merges, and only then posts the status. The critical flag is `after_n_builds` (wait for N uploads before finalizing) and a per-upload `flag` so the service knows the pieces are partial, not competing:

```yaml
# codecov.yml
coverage:
  status:
    project:
      default:
        target: auto
        threshold: 0.5%

# Wait for all 8 shard uploads before computing the final number.
codecov:
  notify:
    after_n_builds: 8
```

**Shape B — merge in CI yourself, upload once.** Each shard writes its raw profile as an artifact; a final job downloads all of them, merges with the *language's own* merge tool, and uploads a single combined report. This is more work but keeps the math in your hands.

| Language | Per-shard output | Merge command |
|---|---|---|
| Go | `cover.shardN.out` (text profiles) | `go tool covdata merge` (binary fmt) / concatenate text profiles, dropping the duplicate `mode:` header |
| Python | `.coverage.shardN` | `coverage combine` then `coverage xml` |
| JS (c8/nyc) | per-shard `coverage/` dirs | `nyc merge` / `c8 --merge-async` |
| JaCoCo | `jacoco-shardN.exec` | `<merge>` Ant task / Gradle `JacocoMerge` |

> **Key insight:** Sharded tests produce *partial* coverage by construction. The number is only meaningful **after** you union all shards. "Coverage looks low" right after parallelizing the suite is almost never a testing regression — it's a missing merge step or a missing `after_n_builds`.

---

## Flaky Coverage: Causes and Fixes

A coverage gate is only as trustworthy as it is *stable*. If the same commit produces 81% on one run and 79% on the next, people stop believing the gate and start re-running until it's green. Flaky coverage has a small set of recurring causes:

- **Non-deterministic test selection.** Test sharding that splits by *timing* (fastest-first balancing) or random ordering can put a test in a different shard run-to-run. If the merge is wrong (above), the *contributing* lines change, so the number wobbles. **Fix:** merge correctly so selection can't matter, or shard deterministically (by file path hash, not by timing).
- **Races in the coverage counters themselves.** Concurrent code mutating shared counters can lose increments under the default coverage mode. In Go this is the entire reason `-covermode=atomic` exists: `-covermode=count` is not safe under `-race`/parallel execution and can under-count. **Fix:** use the atomic/thread-safe counter mode whenever tests run concurrently.
- **Untracked or conditionally-present files.** If a file only appears in *some* runs (generated code built in one job but not another, optional integration tests), the denominator changes and the percentage drifts. **Fix:** make the file set deterministic — generate it in every run, or exclude it consistently via `ignore`/`omit`.
- **Time/locale/random-seed-dependent branches.** A test that hits a "leap year" or "DST" branch only sometimes changes which lines are covered. **Fix:** freeze the clock and seed RNGs in tests so the *same* branches execute every time.
- **`carryforward` masking a real gap.** With carryforward flags (below), a shard that *failed to upload* silently reuses its previous coverage, so a genuine regression can hide. **Fix:** treat missing uploads as errors in CI; don't let carryforward paper over a broken job.

> **Key insight:** Flaky coverage is almost always non-determinism leaking into either *which tests run* or *how counters are recorded*. Stabilize the inputs (deterministic sharding, atomic counters, frozen clocks, a fixed file set) before you touch thresholds. Loosening `threshold` to hide flakiness just blinds the gate.

---

## Configuring the Gate Without Annoying Everyone

The difference between a gate people respect and one they resent is mostly configuration. The levers:

- **Informational vs blocking.** A status can be `informational: true` — it reports the number and *never* fails the build. This is how you roll a gate out: run it informational for a sprint so everyone sees the comment, *then* flip it to blocking once the team trusts it. Flipping straight to blocking on day one guarantees a backlash.
- **`threshold` tolerance.** As covered above: a small allowance (0.3–0.5%) so normal drift doesn't fail builds. Too tight → flapping; too loose → real regressions slip through. Tune to your observed noise.
- **`carryforward` flags.** For sharded or multi-language repos, `carryforward: true` on a flag means "if this component didn't upload this time, reuse its last known coverage." Useful when a PR only touches the backend and you don't want the untouched frontend's missing upload to tank the total. Dangerous if it hides a *broken* upload — pair it with a hard failure when a job that *should* upload doesn't.
- **`if_ci_failed` / requiring uploads.** Decide explicitly what happens when coverage data is missing. Defaulting to "pass" makes the gate fail-open (a broken coverage step = green PR). For a real gate you usually want missing data to *block*, so a silently-broken collector can't wave bad code through.
- **Path-scoped targets.** You can set different `patch`/`project` targets per directory (`flags` / `component_management`) — e.g., 90% on `payments/`, 60% on `cmd/`. Match the bar to the blast radius of the code.

> **Key insight:** The knobs aren't about being lenient — they're about being *believable*. `informational` for rollout, `threshold` for noise, `carryforward` for partial PRs, and explicit handling of missing data. A gate the team trusts blocks the right PRs; a gate they don't trust gets bypassed and is worthless.

---

## Making the Report Actionable

A gate that says "patch coverage 67%, failing" and stops there forces the author to go *hunting* for the untested lines. The whole value evaporates if it isn't actionable. Two features make it so:

1. **PR annotations on the exact uncovered new lines.** Codecov (and SonarCloud) post inline review comments *on the specific diff lines* that are changed-and-uncovered — the same intersection from the first section, rendered as red gutters right in the PR's Files Changed view. The author sees "this `return ErrInsufficient` you just wrote isn't tested" *at the line*, not as an aggregate they have to reverse-engineer.

2. **A focused summary, not a wall of numbers.** A good comment leads with the two numbers that matter (`patch` and the `project` delta), lists the files with uncovered new lines, and links to the full report — instead of dumping every file's percentage. Configure the comment layout to surface the diff, not the whole tree:

```yaml
comment:
  layout: "condensed_header, diff, files, condensed_footer"
  require_changes: true     # only comment when coverage actually changed
  behavior: default
```

`require_changes: true` is a small kindness: no comment on PRs that don't move coverage (docs-only, config tweaks), so the bot only speaks when it has something to say. That alone dramatically raises how seriously people take it when it *does* comment.

> **Key insight:** "67%, failing" is a verdict; a red gutter on the exact untested line is a *fix list*. Annotations turn the gate from a gatekeeper into a reviewer that points at the work — which is the difference between authors fixing the gap and authors gaming the number to escape it.

---

## Worked Example — A Real codecov.yml + Shard-Merge Workflow

Put it together: a Go service whose tests run across a 4-way shard matrix, with a `patch` gate that blocks and a `project` ratchet that tolerates noise.

**`codecov.yml`** — the policy:

```yaml
coverage:
  status:
    # Ratchet: don't regress overall coverage (with noise tolerance).
    project:
      default:
        target: auto
        threshold: 0.5%
        if_ci_failed: error      # missing/failed coverage data blocks, not passes
    # Gate: new code in this PR must be ≥80% covered. This is the one that bites.
    patch:
      default:
        target: 80%
        threshold: 0%

# Wait for ALL 4 shard uploads before computing the number.
# Without this, the status posts off shard 1 and "coverage" looks ~25%.
codecov:
  notify:
    after_n_builds: 4
  require_ci_to_pass: true

comment:
  layout: "condensed_header, diff, files"
  require_changes: true

ignore:
  - "**/*_test.go"
  - "**/mocks/**"
  - "vendor/**"
```

**`.github/workflows/coverage.yml`** — the mechanism:

```yaml
name: coverage
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]      # 4 parallel shards
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # full history — Codecov needs the merge base for the diff
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }

      # Run THIS shard's slice of the packages, atomic mode so concurrent
      # tests don't lose counter increments (count mode is unsafe here).
      - name: Test (shard ${{ matrix.shard }})
        run: |
          go test -covermode=atomic \
                  -coverprofile=cover.${{ matrix.shard }}.out \
                  $(go list ./... | awk "NR % 4 == ${{ matrix.shard }} - 1")

      # Upload this shard's PARTIAL report. The matching after_n_builds: 4
      # tells Codecov to merge all four before computing.
      - uses: codecov/codecov-action@v4
        with:
          files: cover.${{ matrix.shard }}.out
          flags: unittests
          token: ${{ secrets.CODECOV_TOKEN }}
```

What each piece buys you:

- `fetch-depth: 0` — without full history, Codecov can't find the merge base and the *diff* (hence patch coverage) is wrong or empty.
- `-covermode=atomic` — concurrent tests can't lose counter increments, killing one source of flaky numbers.
- The `awk "NR % 4 == ..."` slice is **deterministic** (by list position), so a package always lands in the same shard — no run-to-run wobble from selection.
- Four uploads + `after_n_builds: 4` — the service unions all four reports *before* computing, so the number reflects the full suite, not one shard.
- `target: 80%` on `patch`, `target: auto` on `project` — new code must be tested; the repo as a whole just isn't allowed to backslide.

This is the difference between "coverage is wired up" and "coverage is a gate I trust": every knob here is defending against a specific, real failure (wrong diff base, lost counters, partial-shard math, flapping, fail-open on missing data).

---

## Mental Models

- **Patch coverage is a set intersection, not a score.** `changed lines ∩ uncovered lines`. Only the lines that are *both* new and untested can fail you. Internalize this and "why did/didn't it fail?" answers itself.

- **`project` is a ratchet; `patch` is a gate.** A ratchet only turns one way (don't regress). A gate stops bad things at the door (new code must be tested). They are different mechanisms for different jobs — don't make one do the other's work.

- **Shards are jigsaw pieces.** Each shard's report is one piece of the picture. Judging coverage from one piece is like judging a puzzle from one piece. Always assemble all pieces (`after_n_builds` / a merge step) before reading the number.

- **A threshold is a noise gate, not a target.** `threshold` exists so random ±0.x% drift doesn't fail builds. It is not "how much regression we tolerate philosophically" — it's "how noisy our measurement is." Set it from observed variance.

- **An annotation is a fix list; a percentage is a verdict.** The red gutter on the exact uncovered new line tells the author what to do. The aggregate just tells them they failed. Always prefer the gate that points at the work.

---

## Common Mistakes

1. **Gating only on absolute `project` coverage.** On a big repo a single PR can't move the total, so the check is decorative — it never measures the PR. Gate on `patch`; use `project` as a ratchet (`target: auto`), not an absolute bar.

2. **Forgetting to merge shards (or omitting `after_n_builds`).** Each parallel job's report is *partial*. Without a merge step or `after_n_builds`, the service computes off one shard and the number craters. The classic "coverage dropped and we didn't touch tests" bug.

3. **No `threshold`, so the project check flaps.** Coverage drifts ±0.x% between runs. With zero tolerance, identical code fails at random and people learn to re-run until green. Add a small `threshold` sized to your noise.

4. **Shallow checkout breaking the diff.** Without `fetch-depth: 0` (or the right base ref), the service can't compute the PR diff, so *patch* coverage is wrong or empty. Always give the coverage step the full history / correct merge base.

5. **Using a non-atomic counter mode under concurrency.** `-covermode=count` (Go) and friends lose increments when tests run in parallel/with the race detector, producing flaky undercounts. Use the atomic/thread-safe mode whenever tests are concurrent.

6. **Flipping the gate to blocking on day one.** A gate nobody has seen, suddenly blocking merges, breeds resentment and `pragma: no cover` spam. Run it `informational` first, let the team see the comments, *then* make it block.

7. **Letting missing coverage data pass.** If a broken collector means "no data → green PR," the gate is fail-open and worthless the moment it breaks. Set `if_ci_failed: error` / require the upload so missing data blocks.

---

## Test Yourself

1. A PR adds 6 executable lines; 5 are hit by tests, 1 is not. It also leaves 200 untouched, always-uncovered legacy lines. What is the *patch* coverage, and do the 200 legacy lines affect it?
2. Why does an absolute `project: 80%` gate fail to catch a badly-tested 4-line PR on a large repo?
3. You parallelize tests into 8 shards and coverage immediately reports ~12%. Tests weren't deleted. What's the most likely cause and the fix?
4. What does `target: auto` plus `threshold: 0.5%` on the `project` status actually enforce?
5. Same commit reports 80% then 78% on a re-run. Name two plausible causes and how you'd stabilize each.
6. Why does Codecov need `fetch-depth: 0` (full git history) to compute *patch* coverage correctly?

<details>
<summary>Answers</summary>

1. Patch coverage = 5/6 ≈ 83%. The 200 legacy lines are *not* in the diff, so they're not in `changed_lines` and have zero effect on patch coverage — only changed-and-uncovered lines count.
2. A 4-line change moves total repo coverage by a rounding error, so an absolute project threshold passes (or fails) regardless of whether *those 4 lines* were tested. The project metric isn't measuring the PR; only `patch` is.
3. Each shard uploaded a *partial* report and the number was computed off one shard (or without merging). Fix: merge all shard reports before computing — via `after_n_builds: 8` on Codecov, or a CI merge step (`coverage combine`, `nyc merge`, `go tool covdata merge`, etc.).
4. It's a ratchet: compare this commit's coverage against the base branch and fail only if it drops by *more than* 0.5%. It forbids meaningful regression while tolerating sub-0.5% measurement noise — no absolute number required.
5. (a) Non-deterministic test selection/sharding → shard the suite deterministically (by path hash, not timing) and merge correctly. (b) Race in coverage counters under concurrency → use the atomic/thread-safe counter mode (e.g. Go's `-covermode=atomic`). Also possible: an inconsistently-present generated file → make the file set deterministic.
6. Patch coverage is `diff ∩ report`, and computing the diff requires the *merge base* between the PR head and the target branch. A shallow checkout lacks that history, so the service can't determine which lines are "changed," and patch coverage comes out wrong or empty.

</details>

---

## Cheat Sheet

```
PATCH vs PROJECT
  patch    = (changed ∩ hit) / (changed ∩ executable)   → GATE, should block
  project  = repo-wide coverage                          → RATCHET (target: auto)
  only changed-AND-uncovered lines can fail patch

codecov.yml ESSENTIALS
  coverage.status.patch.default.target: 80%       new code must be tested
  coverage.status.project.default.target: auto    compare to base (ratchet)
  coverage.status.project.default.threshold: 0.5% noise tolerance (stop flapping)
  if_ci_failed: error                             missing data BLOCKS (fail-closed)
  codecov.notify.after_n_builds: N                wait for all N shards, THEN compute
  comment.require_changes: true                   only comment when coverage moved

SHARDS — MERGE FIRST, COMPUTE SECOND
  Go      go test -covermode=atomic -coverprofile=...  → covdata merge / cat profiles
  Python  .coverage.N  → coverage combine && coverage xml
  JS      coverage/    → nyc merge / c8 --merge-async
  JaCoCo  *.exec       → JacocoMerge
  symptom of NOT merging: "coverage dropped, no tests removed"

FLAKY COVERAGE → STABILIZE INPUTS
  non-deterministic shards   → shard by path hash, merge correctly
  counter races              → atomic/thread-safe covermode
  inconsistent file set      → deterministic generation / ignore
  clock/RNG-dependent branch → freeze clock, seed RNG
  do NOT just loosen threshold to hide it

CI MUST-HAVES
  fetch-depth: 0     full history → correct diff/merge base for patch coverage
  informational:true roll out first, flip to blocking once trusted
```

---

## Summary

- **Patch coverage is `diff ∩ report`** — the intersection of the PR's changed lines with the uncovered lines. Only *changed-and-uncovered* lines fail you, which is why it works on tiny PRs where a repo-wide percentage is statistically frozen.
- **`patch` and `project` answer different questions.** `patch` ("is the new code tested?") should *block*. `project` ("did we backslide?") should be a *ratchet* — `target: auto` plus a `threshold` to absorb measurement noise rather than an absolute bar.
- **The ratchet / "clean as you code"** converts an impossible backfill ("get the whole repo to 90%") into a sustainable per-PR habit ("don't add untested code"). Coverage rises monotonically because the gate only turns one way.
- **Sharded tests produce partial reports** by construction. You must **merge all shards before computing** the number — via `after_n_builds` or a language merge tool. Skipping this is the classic "coverage cratered but no tests were removed" bug.
- **Flaky coverage comes from non-determinism** in which tests run or how counters are recorded. Fix the inputs — deterministic sharding, atomic counters, frozen clocks, a fixed file set — instead of loosening the threshold to hide the wobble.
- **A useful gate is a believable, actionable one:** roll out `informational` then flip to blocking, fail *closed* on missing data, and post annotations on the exact uncovered new lines so the gate hands the author a fix list, not just a verdict.

---

## Further Reading

- *Codecov documentation* — the `codecov.yml` reference: `project`/`patch` status, `threshold`, `after_n_builds`, `carryforward`, and the comment layout options.
- *SonarQube — Clean as You Code* — the canonical write-up of gating *New Code* instead of the whole repo, and why that scales.
- *TestCoverage* — Martin Fowler — the reminder that the gate measures a *diagnostic*, not quality; keep [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/middle.md) in view when you set the number.
- *Software Engineering at Google* (coverage chapter) — why Google declines a global threshold and what it does instead.
- `go help testflag` / the Go blog on code coverage — `-covermode` (`set`/`count`/`atomic`) and `go tool covdata` for merging.

---

## Related Topics

- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/middle.md) — produces the per-language reports this page feeds into CI and merges across shards.
- [02 — Mutation Coverage](../02-mutation-coverage/middle.md) — a far stronger PR signal than line coverage; runs on the diff the same way patch coverage does.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/middle.md) — why a green gate isn't proof of quality, and how gates get gamed.
- [Quality Gates](../../quality-gates/) — the broader pattern of automated merge-blocking checks; coverage is one input among many (lint, security, performance budgets).
- [senior.md](senior.md) — gate politics at scale, monorepo flag/component design, and tuning the org-wide coverage policy.
