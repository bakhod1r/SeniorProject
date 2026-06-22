# Required CI Checks — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Required CI Checks
> *Every team has one rule that quietly holds everything together: nothing broken gets into the main branch. A required CI check is the robot that enforces that rule — and once you understand it, the greyed-out merge button stops being a wall and becomes a checklist.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — CI Runs Jobs on Your Pull Request](#core-concept-1--ci-runs-jobs-on-your-pull-request)
5. [Core Concept 2 — A Check Reports a Status](#core-concept-2--a-check-reports-a-status)
6. [Core Concept 3 — Required vs Optional Checks](#core-concept-3--required-vs-optional-checks)
7. [Core Concept 4 — The Common Required Set](#core-concept-4--the-common-required-set)
8. [Core Concept 5 — Pre-Commit Hooks: The Local Early-Warning Layer](#core-concept-5--pre-commit-hooks-the-local-early-warning-layer)
9. [Core Concept 6 — Reading and Fixing a Red Check](#core-concept-6--reading-and-fixing-a-red-check)
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

> Focus: **What is a required check, and why won't the merge button light up?**

You open a pull request. At the bottom of the page sits a list with little circles next to it — some spinning yellow, then turning green ✓ or red ✗. The big green "Merge" button is greyed out. You wait. Maybe one check goes red. The button stays dead. You ask a teammate, "why can't I merge?" and they say, "tests are failing." That list, those circles, that locked button — that is the system of **required CI checks**, and it is one of the most important pieces of teamwork in software that nobody explains to you on day one.

Here's the plain version. **CI** stands for **continuous integration**: a server that, every time you push code or open a pull request, automatically runs a batch of jobs — it builds your code, runs the tests, runs the linter, checks formatting, checks types. Each job reports back a **status**: pass (green ✓) or fail (red ✗). A **required check** is one your platform — GitHub, GitLab, whatever you use — *refuses to let you merge until it is green*. Not a suggestion. A gate.

Why does a team bother? Because of one shared promise that keeps everyone productive: **the main branch always works**. If `main` always builds and always passes its tests, then anyone can branch off it, anyone can deploy from it, and nobody wakes up to "the build is broken and I didn't break it." Required checks are how that promise is *enforced by a machine* instead of *hoped for by humans*. People call it the **green-build contract**: code only gets in if it's green, so the trunk is always safe to build and release from.

> **Mindset shift:** A red `main` is not "that one person's problem" — it is *everyone's* problem. When the main branch is broken, every teammate who pulls it inherits the breakage, every deploy is blocked, and the whole team slows down. So the gate is not there to slow *you* down or to judge your code; it's there to protect the *team* from any one change quietly poisoning the shared branch. The day you internalize "the gate protects all of us, including future-me" is the day required checks stop feeling like bureaucracy and start feeling like a seatbelt.

This page teaches you what each piece is — the jobs, the status, "required" vs "optional," the common set of checks teams require, the local hooks that warn you *before* CI does, and the exact loop for turning a red check green again.

---

## Prerequisites

- **Required:** You've used **git** lightly — you can make a commit and push a branch. (`git add`, `git commit`, `git push`.)
- **Required:** You've opened a **pull request** (or merge request) at least once, even if you didn't fully understand what happened next.
- **Helpful:** You can run your project's tests locally with one command (`go test ./...`, `npm test`, `pytest`).
- **Helpful:** You've seen a red ✗ on a PR and felt unsure what to do about it. (You'll have a recipe by the end.)
- **Not required:** Any prior knowledge of "branch protection," YAML, or CI configuration. We define all of it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **CI (continuous integration)** | A server that automatically builds and tests your code on every push / pull request. |
| **Pull request (PR)** | A proposal to merge your branch into another (usually `main`); where checks and review happen. |
| **Job** | One unit of work CI runs (e.g. "run the tests," "run the linter"). |
| **Check / status check** | The pass/fail result a job reports back to the PR — the green ✓ or red ✗. |
| **Required check** | A check that *must* be green before the platform allows merging. |
| **Optional / advisory check** | A check that runs and reports but does *not* block merging. |
| **Branch protection** | The setting that marks certain checks as required on a branch (e.g. `main`). |
| **Workflow** | A file (often YAML) describing what CI should run and when. |
| **Pre-commit hook** | A check that runs on *your machine* before a commit is recorded. |
| **Flaky test** | A test that passes or fails randomly without the code changing. |
| **Green / red** | Slang for "all checks passing" (green) vs "something failing" (red). |
| **Artifact** | A file CI produces and saves (a build output, a log, a coverage report). |

---

## Core Concept 1 — CI Runs Jobs on Your Pull Request

When you push a branch and open a pull request, you trigger an **event**. A CI system is configured to *listen* for that event and run a set of **jobs** in response. Nobody clicks anything — it's automatic.

What tells CI to do this? A **workflow file** that lives in your repository. On GitHub, these live in `.github/workflows/`. Here is a small, real one:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:          # run this whenever a PR is opened or updated
  push:
    branches: [main]     # also run on pushes to main

jobs:
  test:                  # one job, named "test"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4      # 1. download the code
      - uses: actions/setup-go@v5      # 2. install Go
        with:
          go-version: '1.22'
      - run: go test ./...             # 3. run every test in the project
```

Read it top to bottom in English: *"This workflow is named CI. Run it on every pull request, and also on pushes to main. It has one job called `test` that runs on a fresh Ubuntu machine: check out the code, install Go, then run all the tests."*

A JavaScript project's job looks almost identical — only the tools change:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci          # install dependencies cleanly
      - run: npm test        # run the test suite
```

The key idea: **CI is just running the same commands you'd run on your laptop**, but on a clean, neutral machine, automatically, on every change. There's no magic. `go test ./...` is the same command whether you type it in your terminal or CI runs it for you. That fact is your superpower later: if CI can run it, *you can run the exact same thing locally* to reproduce a failure.

> **Key insight:** CI is not a separate, mysterious thing that "tests your code differently." It runs *your* commands on a *clean* machine. A clean machine is the whole point — it has none of the half-installed tools, leftover files, or "works because of something only on my laptop" state that fools you. CI is the honest second opinion.

---

## Core Concept 2 — A Check Reports a Status

Each job, when it finishes, reports a **status** back to the pull request. There are three you'll see constantly:

- 🟡 **Pending / running** — the job is still going (a spinning circle).
- ✅ **Success** — the job's command exited cleanly (return code `0`).
- ❌ **Failure** — the job's command failed (non-zero return code) — a test failed, the build broke, the linter found a problem.

This is the secret behind pass/fail: a check is green if its command **exits with code 0**, and red otherwise. `go test ./...` exits `0` when all tests pass and non-zero when one fails. That's it. The green ✓ literally means "the command CI ran came back clean."

Here is what the checks section of a real PR looks like — five checks, one of them red:

```
✔  build           Successful in 48s          Details
✘  test            Failing in 1m 12s          Details      ← the problem
✔  lint            Successful in 22s          Details
✔  format-check    Successful in 9s           Details
✔  type-check      Successful in 31s          Details

   ⚠  This branch has failing checks
   [ Merge pull request ]   ← greyed out, you cannot click it
```

You read this in one glance: build is fine, lint/format/types are fine, but **`test` is red**, so the merge button is disabled. The "Details" link next to each check is your way in — click the red one and it takes you straight to the log of that failed job.

> **Key insight:** The list of checks on a PR is a *diagnosis*, not just a verdict. It tells you not only *that* something is wrong but *which category* — a red `lint` is a style/quality problem, a red `test` is a behavior problem, a red `build` means it doesn't even compile. Always read *which* check is red before you start fixing; it tells you what kind of problem you have, exactly like a build error tells you which stage of the pipeline broke.

---

## Core Concept 3 — Required vs Optional Checks

Not every check blocks merging. There are two flavors, and the difference is set by an admin, not in the workflow file.

- **Required checks** *block* the merge. The platform greys out the merge button until they're green. These are configured through **branch protection** — a rule on the `main` branch that says "these named checks must pass."
- **Optional (advisory) checks** *run and report* but do **not** block. They give you information — "coverage dropped 2%," "bundle size grew," "here's a preview deployment link" — without standing in your way.

Why have optional checks at all? Because some signals are *useful but not pass/fail*. A "spelling check on the docs" or "performance benchmark" is helpful context, but you might not want a typo in a comment to block a critical bug fix. So the team marks the must-not-break checks as required and leaves the nice-to-know ones advisory.

On GitHub, an admin makes a check required in **Settings → Branches → Branch protection rules**, by ticking *"Require status checks to pass before merging"* and selecting the check names:

```
Branch protection rule for: main
  [x] Require a pull request before merging
  [x] Require status checks to pass before merging
        Required checks:
          ☑ build
          ☑ test
          ☑ lint
        (format-check and type-check exist but are NOT ticked → advisory)
  [x] Require branches to be up to date before merging
```

In that example, `build`, `test`, and `lint` are **required** (they block); `format-check` and `type-check` run but are **advisory**. Same PR, same checks list — but only three of them control the merge button.

> **Key insight:** "Is this check red?" and "Does this check *block* me?" are two different questions. A red advisory check is annoying but won't stop a merge; a red required check is a hard stop. When you're confused why you *can* merge despite a red ✗ (or why you *can't* despite everything looking fine), the answer is almost always in the branch protection settings — which checks are marked *required*.

---

## Core Concept 4 — The Common Required Set

Across most teams, a similar set of checks ends up required because each one protects a different property of "main always works." Here's the typical lineup and what each one is actually checking:

| Check | What it runs | What a red ✗ means |
|---|---|---|
| **build** | `go build ./...`, `npm run build`, `mvn compile` | The code doesn't even compile / bundle. Nothing else matters until this is green. |
| **tests** | `go test ./...`, `npm test`, `pytest` | The code compiles but behaves wrong — a test caught a regression. |
| **lint** | `golangci-lint run`, `eslint .` | Style or likely-bug patterns (unused variable, suspicious code) the linter flags. |
| **format-check** | `gofmt -l .`, `prettier --check .` | The code isn't formatted to the team's standard. Usually a one-command auto-fix. |
| **type-check** | `tsc --noEmit`, `mypy .` | The types don't line up (in typed or gradually-typed languages). |

Increasingly, teams also require **security checks**, because some mistakes are too dangerous to merge:

| Security check | What it does | Why it's required |
|---|---|---|
| **Secret scanning** | Scans your diff for things that look like passwords, API keys, tokens | So you never commit a live credential. A leaked key in git history is a real incident — even if you delete it, it's in the history forever. |
| **Dependency / vulnerability scan** | Checks your libraries against a database of known vulnerabilities (`npm audit`, Dependabot, `govulncheck`) | So you don't pull in a library version with a known, exploitable hole. |

A workflow that bundles a few of these reads naturally — each `run:` is one check:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build         # → "build" check
      - run: npm test              # → "test" check
      - run: npx eslint .          # → "lint" check
      - run: npx prettier --check .# → "format-check" check
      - run: npx tsc --noEmit      # → "type-check" check
```

> **Key insight:** Each required check guards a *different failure*, and they form a natural order of importance: if it doesn't **build**, nothing else can even run; if it builds but **tests** fail, it's broken behavior; lint/format/types are quality and consistency; security checks stop dangerous content. When several go red at once, fix **build first** — many of the others are red only *because* the build failed and they never got to run cleanly.

---

## Core Concept 5 — Pre-Commit Hooks: The Local Early-Warning Layer

Waiting for CI to tell you that you forgot to format a file is slow — you push, wait two minutes, see red, fix one line, push again. There's a faster way to catch the easy stuff: run quick checks **on your own machine before you even commit**. Those are **pre-commit hooks**.

A pre-commit hook is a script git runs *automatically* right before it records a commit. If the script fails, the commit is blocked, and you fix the problem before it ever leaves your laptop. Two popular tools manage these:

- **`pre-commit`** — a framework (originally from the Python world, language-agnostic) configured by a `.pre-commit-config.yaml` file.
- **husky** — the common choice in JavaScript/Node projects.

A `pre-commit` config looks like this:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace      # strip trailing spaces
      - id: end-of-file-fixer        # ensure files end in a newline
      - id: check-added-large-files  # block accidentally committing huge files
  - repo: local
    hooks:
      - id: gofmt
        name: gofmt
        entry: gofmt -w
        language: system
        types: [go]
```

You install it once, and from then on:

```bash
pre-commit install        # wire the hook into this repo (one time)

git commit -m "add feature"
# trailing-whitespace.................Passed
# end-of-file-fixer...................Passed
# gofmt...............................Failed      ← commit is blocked
#   - files were modified by this hook
# ... gofmt reformatted your file; just `git add` and commit again
```

Now the formatting problem is fixed *before* CI ever sees it. You catch the small stuff in seconds instead of in a two-minute CI round-trip.

But here is the part juniors must understand clearly:

> **Key insight:** Pre-commit hooks are a **convenience, not the gate**. They run on *your* machine, and anyone can skip them — `git commit --no-verify` bypasses every local hook, and a teammate who never ran `pre-commit install` doesn't have them at all. That's exactly why the *real* enforced gate must live in **CI**, on a server nobody can bypass. The pattern almost every team uses: run the *same* checks in *both* places — locally (fast feedback, skippable) **and** in CI (slow-ish, unskippable, authoritative). Local hooks save you round-trips; the required CI check is what actually protects `main`.

---

## Core Concept 6 — Reading and Fixing a Red Check

Here is the single loop that turns "I'm stuck, my PR is red" into a routine you do without thinking. A required check went red. Do this:

**1. Open the log.** Click **Details** next to the red check. CI logs are long, but the failure is almost always near the bottom, or you can search the page for `FAIL`, `Error`, or `✗`.

```
--- FAIL: TestCalculateDiscount (0.00s)
    discount_test.go:42: got 15.0, want 20.0
FAIL
FAIL    shop/pricing   0.013s
exit status 1
```

That tells you *exactly* what broke: the test `TestCalculateDiscount`, at line 42 of `discount_test.go`, expected `20.0` but got `15.0`.

**2. Reproduce it locally.** Run the *same command* CI ran, on your machine. This is why "CI just runs your commands" matters:

```bash
go test ./shop/pricing/ -run TestCalculateDiscount -v
# --- FAIL: TestCalculateDiscount (0.00s)   ← same failure, now in your control
```

If you can reproduce it locally, you can fix it locally with your debugger and your full speed. If it *passes* locally but *fails* in CI, that's a clue too — often a missing file you forgot to commit, or a flaky test (more below).

**3. Fix, commit, push.** Fix the code, run the test again locally until it's green, then push.

```bash
# ... edit the code ...
go test ./shop/pricing/ -run TestCalculateDiscount   # PASS locally
git add -A && git commit -m "fix discount rounding" && git push
```

**4. CI re-runs automatically.** Because your workflow listens on `pull_request`, pushing a new commit **re-triggers the checks**. You don't re-open anything. Watch the circle go yellow, then (hopefully) green. The merge button lights up.

That's the entire loop: **read the log → reproduce locally → fix → push → CI re-runs.** Run the checks locally *before* you push and you skip the slow round-trip entirely.

A special, maddening case: the **flaky test**. This is a test that fails *randomly* — pass, pass, FAIL, pass — even though nobody changed the code. Maybe it depends on timing, or network, or the order tests run in. A flaky test in a *required* check is poison: it blocks merges for the whole team for reasons nobody can fix by changing their code. The short-term move is to re-run the job; the real fix is to make the test reliable (a topic the middle tier digs into). For now, know the symptom: *if a required check is red but your change couldn't possibly have caused it, and a re-run makes it green, you've met a flaky test.*

> **Key insight:** A required check must be **reliable** and **fast**, because it runs on *every* PR for *everyone*. A flaky check erodes trust until people start ignoring red — and a slow check (20 minutes) tempts people to skip running it locally and to context-switch away while they wait, killing flow. "Reliable and fast" isn't a nice-to-have for a required gate; it's the thing that makes the gate respected instead of resented.

---

## Real-World Examples

**1. The merge button that won't light up.** A junior opens their first PR, sees `test ✘`, and pings the team: "GitHub is broken, I can't merge." It isn't broken — a required check is red, and that's the gate doing its job. They click **Details**, find `assert 4 == 5` in a test they accidentally broke, fix the off-by-one, push, and the button turns green on its own a minute later. The "wall" was a checklist all along.

**2. The leaked API key that secret scanning caught.** A developer pastes a config snippet into the repo to "test something real quick," including a live cloud access key. They open a PR. The required **secret-scanning** check goes red and refuses the merge: *"a possible secret was detected."* That red ✗ just prevented a security incident — a key in a merged commit lives in git history forever, even if you delete the line later. The fix: remove the key, rotate it (assume it's compromised), and use an environment variable / secret store instead.

**3. The flaky test that blocked everyone.** A team's `test` check fails on roughly one PR in five — always a different test, always involving a 100ms `sleep` and a timer. Nobody's change is actually broken, but every author has to re-run the job and wait again. Productivity tanks because a *required* check is *unreliable*. The lesson lands hard: a required check is only as valuable as it is trustworthy, so the team prioritizes fixing (or quarantining) the flaky test over new features for a day.

**4. The format-check that became a pre-commit hook.** A repo's `format-check` kept going red on PRs because people forgot to run the formatter — costing a two-minute CI round-trip each time. The team added a `pre-commit` hook running `gofmt`/`prettier` locally. Now formatting is fixed *at commit time* on everyone's machine, the CI `format-check` is green by default, and the slow round-trip mostly disappeared — while CI still enforces it for anyone who skips the hook.

---

## Mental Models

- **CI is the bouncer; `main` is the venue.** Anyone can walk *up* (open a PR), but the bouncer checks the list (the required checks) before letting you *in*. The bouncer isn't being mean — they're keeping the venue safe for everyone already inside. A red required check is "you're not on the list yet."

- **The green-build contract.** Picture a signed agreement everyone on the team made: *"I will not put anything into `main` that isn't green."* Required checks are that contract enforced by a robot instead of by trust. The payoff is enormous — anyone can branch off `main` or deploy it at any moment, confident it works.

- **A clean machine is an honest witness.** Your laptop is a crime scene full of fingerprints — half-installed tools, cached files, env vars only you have. CI runs on a fresh machine with none of that, so its verdict is the honest one. "It works on my machine" is exactly the lie CI exists to catch.

- **Local hooks are a smoke alarm; CI is the fire department.** The smoke alarm (pre-commit hook) warns *you*, fast, in your own home, and you can rip the battery out (`--no-verify`). The fire department (CI) is the institution that actually responds and can't be silenced by one person. You want both: the alarm for speed, the department for guarantee.

- **Required vs optional = blocking vs informing.** Required checks have *teeth* (they stop the merge). Optional checks have a *voice* (they tell you something) but no teeth. When deciding "should this check be required?", ask: *is breaking this bad enough to stop a merge?* If not, leave it advisory.

---

## Common Mistakes

1. **Thinking a red check means "the tool is broken."** It almost never is. A red check means the command CI ran came back non-zero — a real test failed, real code didn't compile, the real linter found something. Read the log before assuming CI is wrong; CI is usually the honest one.

2. **Not opening the log.** The single most common junior stall is staring at a red ✗ without clicking **Details**. The log contains the exact file, line, and reason. Fixing a failure you haven't read is guessing.

3. **Force-pushing or merging around a red required check.** If you find yourself trying to bypass the gate, stop. The gate is protecting the *team's* branch, not blocking *you* personally. Bypassing it means shipping something the team agreed shouldn't ship.

4. **Relying on pre-commit hooks as the real gate.** Hooks run locally and can be skipped (`--no-verify`) or simply not installed by a teammate. They're for fast feedback, not enforcement. The *required CI check* is the gate; the hook is the convenience.

5. **Ignoring (or normalizing) flaky checks.** "Oh, that one always fails, just re-run it" is how a team slides into ignoring red entirely. A required check that's unreliable should be *fixed*, because every flaky failure trains people to stop trusting the gate.

6. **Letting required checks get slow.** A 25-minute required suite kills the feedback loop — people context-switch, lose flow, and stop running checks locally. Required checks run on *every* PR, so speed isn't a luxury; the [05 — Gate Design](../05-gate-design-speed-vs-safety/junior.md) topic is all about this trade-off.

7. **Not running checks locally before pushing.** Pushing and *then* discovering a lint error wastes a full CI round-trip. Run the same commands locally first (`go test ./...`, `npm run lint`); fix it before CI ever sees it.

---

## Test Yourself

1. In plain English, what is a *required* CI check, and what specifically does it prevent you from doing?
2. A check is green ✓. In terms of *exit codes*, what does that literally mean about the command CI ran?
3. Your PR has `build ✘ test ✘ lint ✘` all red. Which one do you investigate first, and why?
4. What's the difference between a *required* check and an *optional/advisory* check, and where (not in the workflow file) is that difference configured?
5. You committed a file, but the team's CI `format-check` is red anyway. Your teammate suggests adding a pre-commit hook. Does that *replace* the CI check? Why or why not?
6. A required `test` check fails on your PR, but you didn't touch any test, and re-running the job makes it pass. What did you most likely hit, and why is it dangerous in a *required* check?
7. You see a red required check. Write the four-step loop you'd follow to get it green.

<details>
<summary>Answers</summary>

1. A required check is an automated CI check (build, tests, lint, etc.) that **must be green before the platform allows your PR to merge**. It prevents you from merging a change that breaks the check into the protected branch — protecting the "main always works" promise for the whole team.
2. A green ✓ means the command **exited with code 0** (clean). Red means it exited with a **non-zero** code (`go test` returns non-zero when a test fails, the compiler returns non-zero when the build fails, and so on).
3. **`build` first.** If the code doesn't compile, the tests and linter often can't run properly and go red *as a consequence*. Fixing the build may turn the others green for free; fixing tests while the build is broken is backwards.
4. A **required** check blocks the merge; an **optional/advisory** check runs and reports but does *not* block. The difference is set in **branch protection settings** (e.g. GitHub → Settings → Branches → "Require status checks to pass"), *not* in the workflow YAML — the same job can be required on one branch and advisory on another.
5. **No, it doesn't replace it.** A pre-commit hook runs on *your machine* and can be skipped (`git commit --no-verify`) or not installed by a teammate. It's fast local feedback, but the **CI check is the enforced gate** that can't be bypassed. The right pattern is to run the formatter in *both* places.
6. You most likely hit a **flaky test** — one that passes/fails randomly (often due to timing, network, or test order). It's dangerous in a *required* check because it blocks merges for the whole team for reasons no one can fix by changing code, and it trains people to ignore red ✗.
7. **(1)** Open the log via *Details* and find the failure. **(2)** Reproduce it locally by running the same command CI ran. **(3)** Fix the code, confirm it passes locally, commit. **(4)** Push — CI re-runs the checks automatically; watch them go green.

</details>

---

## Cheat Sheet

```
WHAT IS A REQUIRED CHECK?
  An automated CI check (build/test/lint/...) that MUST be green
  before the platform lets you merge. Set via BRANCH PROTECTION.

THE STATUS YOU SEE ON A PR
  🟡 pending/running   ✅ success (exit 0)   ❌ failure (non-zero exit)
  merge button is GREYED OUT while any REQUIRED check is red.

REQUIRED vs OPTIONAL
  required = BLOCKS the merge (has teeth)
  optional = runs + reports, does NOT block (has a voice)
  configured in branch protection, NOT in the workflow file

THE COMMON REQUIRED SET (fix build first!)
  build        → doesn't compile / bundle
  tests        → behavior is wrong (a regression)
  lint         → style / likely-bug patterns
  format-check → not formatted (usually 1-command fix)
  type-check   → types don't line up
  secret-scan  → a password/key/token in the diff   (security)
  dep-scan     → a library with a known vulnerability (security)

LOCAL EARLY WARNING (pre-commit hooks)
  pre-commit / husky → run quick checks BEFORE you commit
  pre-commit install        # wire it up once
  git commit --no-verify    # bypasses local hooks (so CI is the REAL gate)

THE RED-CHECK FIX LOOP
  1. open the log  (Details → search FAIL / Error)
  2. reproduce locally  (run the SAME command CI ran)
  3. fix → confirm green locally → commit
  4. push → CI re-runs automatically → watch it go green

GOLDEN RULES
  • a clean CI machine is the honest witness ("works on my machine" = the lie)
  • required checks must be FAST + RELIABLE (they run on every PR for everyone)
  • a flaky required check blocks the whole team — fix it, don't normalize it
  • run checks locally BEFORE pushing to skip the round-trip
```

---

## Summary

- A **required CI check** is an automated check (build, tests, lint, format, type-check, security) that **must pass before the platform lets you merge**. It's the difference between a green ✓ that *informs* and one that *gates*.
- **CI runs your commands on a clean machine** on every push/PR. There's no magic — `go test ./...` is the same command locally and in CI, which is exactly why you can reproduce any failure on your own machine.
- A check is green when its command **exits 0** and red otherwise. The list of checks on a PR is a **diagnosis** — read *which* check is red to know *what kind* of problem you have, and **fix the build first** when several are red.
- **Required vs optional** is the difference between *blocking* the merge and merely *informing* you. It's set in **branch protection**, not in the workflow file.
- **Pre-commit hooks** (`pre-commit`, husky) are the **local early-warning layer** — fast, but skippable, so they're a convenience, *not* the gate. The enforced gate lives in CI on a server nobody can bypass.
- The whole point is the **green-build contract**: nothing broken gets into `main`, so the trunk is always safe to build and release from. That's a *team* protection, which is why a flaky or slow required check (which erodes trust or flow) is a real problem, not a minor annoyance.

You now know what the greyed-out merge button means and exactly how to make it light up. Everything deeper in this section — *who* can mark checks required, *how* to design a gate that's both safe and fast, *what* thresholds to enforce — builds on this foundation.

---

## Further Reading

- [GitHub Docs — About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks) — the official explanation of how checks appear on a PR.
- [GitHub Docs — About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — how a check is actually made *required*.
- [The `pre-commit` framework](https://pre-commit.com/) — set up local hooks that catch problems before CI does.
- [GitHub Actions — Quickstart](https://docs.github.com/en/actions/writing-workflows/quickstart) — write your first `on: pull_request` workflow.
- The [middle.md](middle.md) of this topic, which formalizes branch protection rules, status-check APIs, required-but-non-blocking patterns, and how to keep a required suite fast and reliable.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/junior.md) — *how* a check becomes "required" and what other merge rules a branch can enforce.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/junior.md) — required checks that enforce a *number* (e.g. test coverage) rather than just pass/fail.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/junior.md) — why required checks must be fast, and how to balance safety against feedback speed.
- [Testing](../../testing/) — the tests that the most important required check actually runs.
- [Static Analysis & Linting](../../static-analysis/) — what the `lint` and `type-check` required checks are doing under the hood.
