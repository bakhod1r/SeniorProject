# Coverage in CI & Diffs — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage in CI & Diffs
> *A coverage number sitting on your laptop helps nobody. The place coverage actually changes behaviour is the pull request — where a bot reads your diff, does the math, and tells the whole team whether the lines you just wrote got tested.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Coverage Runs in CI, Not on Your Laptop](#core-concept-1--coverage-runs-in-ci-not-on-your-laptop)
5. [Core Concept 2 — The PR Comment and the Status Check](#core-concept-2--the-pr-comment-and-the-status-check)
6. [Core Concept 3 — Diff Coverage vs Project Coverage](#core-concept-3--diff-coverage-vs-project-coverage)
7. [Core Concept 4 — The Ratchet: Don't Let It Go Down](#core-concept-4--the-ratchet-dont-let-it-go-down)
8. [Core Concept 5 — Coverage Gates: A Check That Can Block Merge](#core-concept-5--coverage-gates-a-check-that-can-block-merge)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How coverage shows up in your pull requests.**

You already know what coverage *is* — a measure of which lines your tests run. This page is about where that number actually lands in your daily work: on a **pull request**, posted by a bot, after your tests run on a server you never see.

Here is the flow, start to finish. You push a branch and open a PR. A **CI** server (GitHub Actions, GitLab CI, CircleCI) checks out your code, runs your tests with coverage turned on, and produces a **report** — a small file listing every line and whether a test touched it. CI uploads that report to a service like **Codecov** or **Coveralls**. Minutes later, a comment appears on your PR: *"Patch coverage 92% · Project coverage 78% (+0.1%)."* Sometimes there's also a green check or a red X next to your PR title — and if it's red, the **Merge** button might be greyed out.

That last part is where coverage stops being trivia and starts being a thing that blocks your afternoon. So the question every junior eventually asks is: *"Why is this bot complaining about coverage when I only changed 20 lines of a huge old project?"* The answer is the single most important idea on this page — **diff coverage** — and once it clicks, the whole system makes sense.

> **The mindset shift:** stop thinking "my job is to raise the project's total coverage percentage." Start thinking "my job is to test *the lines I just changed*." The bot is not grading the whole repo against you. It is asking one fair question — *did the code in this PR get tested?* — and judging the **diff**, not the whole repo.

---

## Prerequisites

- **Required:** You can write a test and run your test suite locally (examples use **Go**, **Python**, and a little **JavaScript**).
- **Required:** You've opened a pull request on GitHub (or a merge request on GitLab) and seen the checks that run on it.
- **Helpful:** You've seen a coverage tool produce a percentage locally — `go test -cover`, `pytest --cov`, `jest --coverage`. If not, read [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/junior.md) first; it's the natural prequel to this page.
- **Helpful:** You've had a PR check go red and weren't sure whether it was *your* fault. (You'll know how to read it by the end.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **CI** | Continuous Integration — a server that automatically runs your tests on every push / pull request. |
| **Coverage report** | A file your test run produces listing each line and whether a test executed it (`coverage.out`, `coverage.xml`, `lcov.info`). |
| **Codecov / Coveralls** | Services that receive your coverage report and post the results onto your PR as a comment and a check. |
| **Project coverage** | The percentage of the **whole codebase** covered by tests. One big number for the entire repo. |
| **Diff / patch coverage** | The percentage of **only the lines this PR changed** that are covered by tests. The fair, local number. |
| **Status check** | A pass/fail mark (✓ or ✗) reported onto a commit or PR by an automated tool. |
| **Coverage gate** | A status check based on coverage that is allowed to **block merge** when it fails. |
| **Ratchet** | A rule that lets coverage go *up* or stay flat but never *down* — like a wrench that only turns one way. |
| **Threshold / target** | The minimum percentage a check requires to pass (e.g. "patch must be ≥ 80%"). |

---

## Core Concept 1 — Coverage Runs in CI, Not on Your Laptop

You *can* measure coverage on your laptop — and you should, while writing tests, to see what you missed. But the coverage that the **team** acts on is measured in **CI**, on every pull request, automatically. There's a good reason: a number is only trustworthy if it's produced the same way every time, on a clean machine, for everyone. Your laptop has half-finished edits and uncommitted files; CI has exactly what's in the PR.

The CI job that does this is almost always the **test job** you already have, with two extra steps bolted on: **(1)** run the tests with coverage enabled so they emit a report, and **(2)** upload that report somewhere that can comment on the PR.

Here is a real, minimal GitHub Actions workflow that does exactly that for a Go project:

```yaml
# .github/workflows/test.yml
name: tests
on: [pull_request]          # run on every PR

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"

      # 1. run tests AND write a coverage report to a file
      - name: Test with coverage
        run: go test ./... -coverprofile=coverage.out

      # 2. send that report to Codecov, which will comment on the PR
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage.out
```

Two lines do the real work. `-coverprofile=coverage.out` tells `go test` to write a coverage report to a file instead of just printing a percentage. The `codecov-action` step picks that file up and ships it to Codecov. That's the entire mechanism: **test → report file → upload.** The Python equivalent is `pytest --cov --cov-report=xml` then the same upload step; the JavaScript equivalent is `jest --coverage` (which writes `coverage/lcov.info`) then upload. Different commands, identical shape.

> **Key insight:** coverage in CI is not a separate, scary system. It is your normal test job plus *"write the result to a file"* plus *"upload the file."* If you understand those three steps, you understand 90% of coverage-in-CI. Everything fancy is layered on top of this skeleton.

---

## Core Concept 2 — The PR Comment and the Status Check

Once the report is uploaded, Codecov (or Coveralls, or SonarCloud) posts results onto your pull request in **two distinct places** — and beginners constantly confuse them.

**The PR comment** is a human-readable summary that the bot writes (and edits in place on each push) in the conversation thread. It looks roughly like this:

```
Codecov Report
All modified lines are covered by tests ✅

  @@            Coverage Diff            @@
  ##            main      #142     +/-   ##
  =========================================
  + Coverage   78.40%   78.51%   +0.11%
  =========================================
    Files          63       64       +1
    Lines        4120     4159      +39
  =========================================
  + Hits         3230     3265      +35
    Misses        890      894       +4

Components   Coverage Δ
src/auth/    91.20%   (+0.30%)  ✅

Patch coverage: 92.30% of diff (36 / 39 lines)
```

Read it slowly, because every line is information. **Project coverage** went from 78.40% to 78.51% — barely moved, because 39 new lines is a drop in a 4159-line bucket. **Patch coverage is 92.30%**: of the 39 lines this PR added or changed, 36 were hit by a test and 3 were not. *That* is the number that's actually about you. The bot is even telling you it's 3 lines short — that's your to-do list if the check is failing.

**The status check** is the separate ✓ / ✗ mark that appears in the checks list at the bottom of the PR (and next to the commit). It's a single pass/fail verdict — no prose, just a state. Codecov typically posts two: `codecov/project` and `codecov/patch`. Each is green or red based on whether coverage cleared its configured target.

```
Some checks were not successful
  ✓  tests / test (ubuntu-latest)
  ✓  codecov/project — 78.51% (+0.11%)
  ✗  codecov/patch   — 92.30% (target 95%)   Details
```

The comment *explains*; the check *decides*. A red check is what can stop a merge (next concepts cover this). The comment is where you look to find out *why* it's red and *which lines* to fix.

> **Key insight:** the **comment** and the **check** are not the same thing. The comment is a paragraph you read; the check is a boolean the platform can enforce. When someone says "coverage is blocking my PR," they mean a red **check** — and the **comment** is where you go to find the three untested lines causing it.

---

## Core Concept 3 — Diff Coverage vs Project Coverage

This is the heart of the page. There are two coverage numbers, they answer two different questions, and confusing them is the source of nearly every junior's frustration with coverage gates.

**Project coverage** — *what fraction of the entire codebase is covered?* One number for the whole repo: 78%. It moves glacially. Your 39-line PR nudged it by 0.11%. It is useful as a slow-moving health trend for the codebase, and almost useless as a verdict on *your* work — because you didn't write most of the repo.

**Diff coverage** (also called **patch coverage**) — *of the lines this PR changed, what fraction are covered?* This number is **only about your diff**. If you added 39 lines and tests hit 36 of them, patch coverage is 36/39 ≈ 92%. It says nothing about the 4,120 lines you didn't touch. It is laser-focused on the work in front of the reviewer.

Here's the same PR seen both ways, to make the difference concrete:

```
PR #142 — adds a password-reset endpoint (39 new/changed lines)

  PROJECT view:  78.40% → 78.51%   (the whole repo, barely moved)
  DIFF view:     92.30%            (36 of YOUR 39 lines covered, 3 missed)
```

Now the punchline — **why diff coverage is the sane default.** Imagine you join a team with a 200,000-line app that has 40% coverage built up (or not built up) over a decade. If the gate were *project coverage ≥ 80%*, your tiny bugfix PR would be rejected forever through no fault of yours — you can't single-handedly test 120,000 lines of legacy code you've never seen, and it would be insane to ask you to. But it is entirely fair to expect that the **20 lines you just wrote** come with tests. Diff coverage asks exactly that and nothing more. It scales the expectation to the size of *your* contribution, which is the only thing you actually control.

> **Key insight:** project coverage judges the whole repo (mostly other people's code); diff coverage judges *your* lines. You can't be reasonably forced to retroactively test a giant legacy codebase — but you *can* be expected to test the new code you're adding right now. That's why mature teams gate on **diff/patch coverage** and treat project coverage as a trend line, not a pass/fail bar.

---

## Core Concept 4 — The Ratchet: Don't Let It Go Down

Even with diff coverage doing the day-to-day judging, teams want a guarantee about the *overall* trend: coverage should not quietly rot over time. The tool for that is the **ratchet**.

A ratchet is a wrench mechanism that turns one way only — it never slips backward. Applied to coverage, the rule is: **a PR may raise project coverage or keep it flat, but it may not lower it.** You don't have to *improve* the big number; you just aren't allowed to *erode* it. New code arrives with its own tests (enforced by the diff gate), so the percentage holds steady or creeps up, and it's protected from sliding down.

The reason this matters is the slow-leak failure mode. Without a ratchet, each PR can shave off a fraction of a percent — a new untested helper here, a deleted test there — and nobody notices any single drop. A year later coverage has quietly fallen from 80% to 62% and there's no one moment to point at. The ratchet stops the leak by rejecting the *step down* the instant it happens, while it's one PR you can still reason about.

Codecov expresses the ratchet with a small allowed-slip **threshold** so trivial rounding noise doesn't fail builds:

```yaml
# codecov.yml — project ratchet with a tiny tolerance
coverage:
  status:
    project:
      default:
        target: auto        # "auto" = compare against the base branch
        threshold: 0.5%      # allow at most a 0.5% dip (noise), no real backslide
    patch:
      default:
        target: 80%          # every PR's diff must be ≥ 80% covered
```

`target: auto` is the ratchet: it means "the bar is wherever `main` currently sits," so any real drop fails the check, while `threshold: 0.5%` forgives sub-percent jitter. Notice the two work together — `patch` makes sure new code is tested, and `project: auto` makes sure the total never quietly slides.

> **Key insight:** the ratchet protects you from *slow rot*, not from a single bad day. It says "today's coverage becomes tomorrow's floor." Each PR brings its own tests (diff gate) and isn't allowed to drag the total down (ratchet) — so coverage trends flat-or-up without anyone running a heroic "let's fix coverage" sprint.

---

## Core Concept 5 — Coverage Gates: A Check That Can Block Merge

A **coverage gate** is simply a status check, based on coverage, that the repository is configured to *require* before a PR can merge. Without the gate, the red ✗ is just advice — a suggestion you can ignore and merge anyway. *With* the gate, that same ✗ greys out the **Merge** button until it turns green.

The gate is not magic and it's not part of Codecov — it's a GitHub (or GitLab) setting called a **branch protection rule**. You tell the platform: "PRs targeting `main` must have these checks passing." Once `codecov/patch` is in that list, a failing patch-coverage check physically blocks the merge:

```
Branch protection for `main`:
  ✅ Require status checks to pass before merging
       Required checks:
         • tests / test
         • codecov/patch        ← this is the GATE

On PR #142:
  ✗ codecov/patch — 92.30% (target 95%)
  ⛔ "Merge" button disabled until required checks pass
```

So a gate is two ingredients clicked together: **a coverage status check** (from Codecov) **+ a branch-protection rule that requires it** (from GitHub). Remove either ingredient and it's no longer a gate — just feedback.

The crucial junior takeaway is *which* coverage number a sane gate is built on. Gating on **project coverage at a fixed high number** (say 90%) on a low-coverage codebase blocks every PR forever and teaches everyone to hate coverage. Gating on **patch coverage** asks each PR to test its own new lines — achievable, fair, and exactly what you control. Healthy teams put the hard gate on **patch/diff coverage** and let project coverage be a soft, informational check (or just the gentle ratchet from Concept 4).

> **Key insight:** a gate turns *feedback* into a *rule*. It is the coverage check **plus** a branch-protection setting that requires it. Gate on **patch coverage** (test your new lines) — fair and under your control. Don't gate on a fixed-high **project** number on a legacy repo — it punishes people for code they never wrote, and that's how coverage gets a bad reputation.

---

## Real-World Examples

**1. "Why is the bot mad — I only changed 20 lines?"** A junior fixes a one-line bug and adds a small 19-line helper to a mature service, no test. Project coverage doesn't budge (78.4% → 78.4%), so the `codecov/project` check is green. But `codecov/patch` reads **0%** — none of the 20 new lines were tested — and it's red. The PR comment spells it out: *"Patch coverage: 0% (0 / 20 lines)."* The fix isn't to test the whole service; it's to write one small test that exercises the new helper, pushing patch coverage up and turning the check green. This is diff coverage doing its job: scaling the ask to the change.

**2. The slow leak the ratchet caught.** A team without a ratchet watched coverage drift from 81% to 64% over eighteen months — no single guilty PR, just a fraction lost each time. After turning on `project: target: auto` (the ratchet), the very next PR that *removed* a test without replacing it failed immediately with *"Coverage decreased 0.4%."* The drop was caught while it was still one reviewable change instead of a year-long mystery.

**3. The legacy app that couldn't meet a global threshold.** A new hire's first PR to a 200k-line, 35%-covered codebase was blocked by a `project ≥ 80%` gate someone had set optimistically — there was no way a normal PR could lift the whole repo to 80%. The team swapped the hard gate to **patch coverage ≥ 80%** and made project coverage informational. New code now arrives tested, the legacy debt gets paid down gradually as files are touched, and PRs stop being held hostage to a number nobody could move alone.

---

## Mental Models

- **The bot is a fair grader, not a hostile one.** It grades the *diff* — the work you handed in — not the entire textbook (the whole repo). When the patch check is red, it's pointing at *your* untested lines, which is exactly the thing you can fix.

- **Project coverage is the thermostat; diff coverage is the new room you just built.** The thermostat reading (whole-house temperature) barely moves when you add one room. To know if *your* room is up to code, you inspect the room — the diff — not the house average.

- **The ratchet is a one-way wrench.** It lets the number turn up or hold; it physically won't let it turn back. Today's coverage becomes the floor for tomorrow. No drop slips through unnoticed.

- **A check is advice; a gate is a law.** The same red ✗ is a suggestion until a branch-protection rule *requires* it — then it's a wall. The difference between "you might want to" and "you cannot merge" is one repository setting.

- **Test what you ship.** You can't be expected to retroactively cover a codebase you didn't write. You *can* be expected to cover the lines in your PR. Diff coverage is that principle turned into a number.

---

## Common Mistakes

1. **Reading project coverage as a grade on your PR.** It isn't — it's mostly other people's code. When a check is red, look at **patch/diff** coverage; that's the number about *your* lines. Chasing the project percentage is chasing something you barely influence.

2. **Trying to fix a red patch check by testing unrelated code.** Adding tests to some random old file won't help — patch coverage only counts the lines *this PR* changed. Read the comment, find the specific missed lines (often shown in red in the file view), and test *those*.

3. **Confusing the PR comment with the status check.** The comment explains; the check decides. Editing your way to a green *comment* doesn't matter if the *check* is still red — and the check is what the gate enforces. Look at the checks list to see your real merge status.

4. **Forgetting the upload step.** A test job that runs coverage but never uploads the report leaves Codecov with nothing — the comment never appears, or shows "no report found." Coverage in CI is *two* steps: produce the report **and** upload it. Missing the second is the most common "why is there no comment?" cause.

5. **Setting a fixed-high project gate on a low-coverage repo.** A `project ≥ 90%` gate on a 40%-covered codebase blocks every PR and breeds resentment. Gate on **patch coverage** instead, and let project coverage ratchet or stay informational.

6. **Gaming the number instead of testing behaviour.** Writing assertion-free tests just to make lines "covered" turns the check green while testing nothing real. The point is a tested change, not a green badge — a trap covered in depth in [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md). (Coverage also can't tell you the test *asserts* anything — see [05](../05-what-coverage-does-not-tell-you/junior.md).)

---

## Test Yourself

1. In one sentence each, what does **project coverage** measure, and what does **diff/patch coverage** measure?
2. Your PR adds 30 lines to a huge repo. The `codecov/project` check is green but `codecov/patch` is red. What does that tell you, and what should you do?
3. Why is diff coverage a *fairer* default than project coverage for blocking a PR?
4. What two steps must a CI test job do for a coverage comment to appear on your PR?
5. What is a **ratchet**, and what failure mode does it prevent?
6. What turns a coverage *status check* into a coverage *gate* that can block merge?

<details>
<summary>Answers</summary>

1. **Project coverage** = the percentage of the *entire codebase* covered by tests (one number for the whole repo). **Diff/patch coverage** = the percentage of *only the lines this PR changed* that are covered.
2. Project is green because 30 new lines barely move a big repo; **patch is red because your 30 new lines aren't (sufficiently) tested.** Write tests that exercise *those* new lines — read the comment to see exactly which ones were missed.
3. Because you can't reasonably be forced to retroactively test a large codebase you didn't write, but you *can* be expected to test the new lines you're adding. Diff coverage scales the expectation to the size of your contribution — the only part you control.
4. (a) Run the tests **with coverage enabled** so they write a report file (e.g. `coverage.out`, `coverage.xml`, `lcov.info`), and (b) **upload that report** to a service like Codecov/Coveralls that can comment on the PR.
5. A rule that lets coverage go up or stay flat but **never down** (`target: auto`). It prevents *slow rot* — coverage quietly leaking a fraction of a percent per PR until it has fallen far with no single drop to blame.
6. A **branch-protection rule** that marks the coverage check as *required*. Check + required-setting = gate; without the required setting the red ✗ is just advice and you can merge anyway.

</details>

---

## Cheat Sheet

```
THE CI COVERAGE FLOW
  push PR → CI runs tests w/ coverage → writes report file → uploads → bot comments + posts check

THE TWO NUMBERS
  PROJECT coverage = whole repo (one big number, moves slowly) → a TREND
  DIFF / PATCH     = only the lines THIS PR changed            → about YOU
  rule of thumb: red patch check? → test YOUR new lines, not random old files

REPORT FILES BY LANGUAGE
  Go      go test ./... -coverprofile=coverage.out
  Python  pytest --cov --cov-report=xml        (→ coverage.xml)
  JS/TS   jest --coverage                       (→ coverage/lcov.info)
  ...then: upload to Codecov/Coveralls (the SECOND, often-forgotten step)

COMMENT vs CHECK
  comment = the paragraph that EXPLAINS (which lines missed, the +/- delta)
  check   = the ✓ / ✗ that DECIDES (what a gate can enforce)

THE RATCHET (codecov.yml)
  project: target: auto, threshold: 0.5%   # never drop (forgive tiny noise)
  patch:   target: 80%                      # new code must be tested

GATE = check + branch-protection "required"
  gate on PATCH coverage  → fair, you control it
  do NOT gate on fixed-high PROJECT % on a legacy repo → blocks everyone forever
```

---

## Summary

- Coverage that matters to the team is measured in **CI**, on every pull request — your normal **test job** plus two steps: **write a report file** and **upload it** to Codecov/Coveralls.
- The bot reports in two places: a **PR comment** (human-readable, explains *which* lines missed and the +/- delta) and a **status check** (a ✓/✗ that decides pass/fail). The comment explains; the check decides.
- There are **two coverage numbers**. **Project coverage** = the whole repo (a slow trend, mostly other people's code). **Diff/patch coverage** = *only the lines your PR changed* (the number that's actually about you).
- **Diff coverage is the sane default** for blocking PRs: you can't be forced to test a 200k-line legacy app, but you *can* be expected to test the 20 lines you just wrote. It scales the ask to your contribution.
- A **ratchet** (`target: auto`) lets coverage go up or stay flat but never down — it stops *slow rot* by failing the step-down while it's still one reviewable PR.
- A **coverage gate** is a status check **plus** a branch-protection rule that requires it — that's what greys out the Merge button. Gate on **patch coverage** (fair, under your control); don't gate on a fixed-high **project** number on a legacy codebase.

You now know exactly what that bot on your PR is doing and how to make it green the right way — by testing your own diff. The middle tier goes deeper: combining coverage from parallel test shards, taming flaky coverage, and the politics of choosing thresholds.

---

## Further Reading

- [Codecov docs — *About Code Coverage* and *Status Checks*](https://docs.codecov.com/docs) — the canonical explanation of project vs patch status and how the comment is generated.
- [Coveralls documentation](https://docs.coveralls.io/) — the other major service; same model (report → upload → PR comment), slightly different config.
- *TestCoverage* — Martin Fowler (martinfowler.com) — why coverage is a diagnostic, not a target; essential context for *why* diff coverage beats a global threshold.
- [GitHub docs — *About protected branches / required status checks*](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) — how a check becomes a merge-blocking gate.
- The [middle.md](middle.md) of this topic — merging parallel coverage shards, flaky coverage, and choosing thresholds without a revolt; and [senior.md](senior.md) for the org-wide rollout and politics of gates.

---

## Related Topics

- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/junior.md) — the prequel: how each language *produces* the report file CI uploads.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md) — a green patch check means lines *ran*, not that your tests *assert* anything.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/junior.md) — why gaming the gate (assertion-free tests) defeats the point.
- [Quality Gates](../../quality-gates/) — coverage gates are one kind of automated merge gate; this section covers the broader family (lint, security, performance budgets).
