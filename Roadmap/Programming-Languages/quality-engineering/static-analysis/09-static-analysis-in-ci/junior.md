# Static Analysis in CI — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Static Analysis in CI
> *The same check should greet you in your editor, again before you commit, and one last time in CI — each layer a cheaper place to catch a problem than the next.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Placement Spectrum](#core-concept-1----the-placement-spectrum)
5. [Core Concept 2 -- Why Earlier Is Cheaper](#core-concept-2----why-earlier-is-cheaper)
6. [Core Concept 3 -- Your First Pre-Commit Hook](#core-concept-3----your-first-pre-commit-hook)
7. [Core Concept 4 -- The CI Backstop](#core-concept-4----the-ci-backstop)
8. [Core Concept 5 -- Reading a Failed CI Check](#core-concept-5----reading-a-failed-ci-check)
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

> Focus: **where the analyzers you already know run — the editor, a pre-commit hook, and CI — and why the same finding should reach you as early as possible.**

You already know what a linter, a formatter, and a type checker do: they read your code without running it and tell you what looks wrong. This page is not about *those tools* — it is about *where they run*.

A finding (say, "this variable is unused") can reach you at three different moments:

1. **In your editor**, the instant you type it — a squiggly underline.
2. **When you try to commit**, via a hook that runs the check on your changed files.
3. **In CI**, after you push, where a server runs the full suite and can *block your pull request from merging*.

The whole game is to surface the same problem at the **earliest** of those three places. Catching it in the editor costs you nothing. Catching it in CI costs you a context switch — you've moved on to the next task, and now you have to come back. Catching it in *production* costs an incident. CI is the **backstop**, not the first place you should ever hear about a problem.

---

## Prerequisites

**Required**

- You can run a linter or formatter locally from the terminal (see [Linters & Style Checkers](../01-linters-and-style-checkers/) and [Formatters](../02-formatters/)).
- You use Git and can make a commit and push a branch.
- You have opened a pull request (PR) or merge request before.

**Helpful**

- You've seen a green check or red X next to a commit on GitHub or GitLab.
- A rough idea of what "CI" (continuous integration) means: a server that runs your tests and checks automatically on every push.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| CI | Continuous Integration — a server that runs checks automatically on every push/PR. |
| Pre-commit hook | A script Git runs before recording a commit; can block the commit if a check fails. |
| Gate | A check that must pass before code is allowed to merge. |
| Advisory | A check that reports a problem but does **not** block — informational only. |
| Status check | The green check / red X shown next to a commit or PR by CI. |
| Required check | A status check that must be green before the PR's merge button unlocks. |
| Changed files | The files different in your branch — running checks on just these is faster. |
| `--no-verify` | A Git flag that skips your pre-commit hooks (use sparingly and honestly). |
| Workflow / job | A unit of work CI runs (e.g. a "lint" job, a "test" job). |
| Backstop | The last safety net — here, CI catches what slipped past earlier layers. |

---

## Core Concept 1 -- The Placement Spectrum

There is one model that organizes this entire topic. Picture the same check moving left to right, from cheapest to most authoritative:

```
EDITOR              PRE-COMMIT HOOK          CI
(instant,           (fast subset,            (full suite,
 in-loop,            before commit,           authoritative,
 advisory)           local)                   blocks merge)

  cost: ~0     →     cost: seconds      →     cost: a context switch
```

- **Editor** — runs as you type. Instant feedback, never blocks anything, easy to ignore. This is where you *want* to learn about a problem.
- **Pre-commit hook** — runs a **fast subset** of checks right before Git records your commit. It's a convenience that stops obvious mistakes from ever entering history. It is **not** a hard gate — anyone can bypass it.
- **CI** — runs the **full suite** on a clean server after you push. This is the **authoritative** layer. CI is what actually decides whether your PR can merge.

The principle: **the same finding should appear as early as possible.** If your linter flags something in CI that your editor *could* have flagged, you've wasted a round trip. CI's job is to be the backstop that catches what slipped through — not to be your first contact with the rule.

---

## Core Concept 2 -- Why Earlier Is Cheaper

The reason we care so much about *placement* is economics. The cost of a defect grows the longer it survives:

| Where caught | What it costs you |
|---|---|
| Editor | Almost nothing — you fix it before the thought has left your head. |
| Pre-commit | A few seconds — you fix it before it's even a commit. |
| CI | A **context switch** — you've pushed, moved to the next task, and now must return. |
| Code review | A reviewer's time *and* yours — a whole round trip of comments. |
| Production | An **incident** — debugging, a hotfix, possibly users affected. |

Every step right is roughly an order of magnitude more expensive. This is why teams invest in the left side of the spectrum: not because CI is bad, but because the *cheapest fix is the earliest fix*. CI exists to guarantee nothing slips all the way to production — it is the floor, not the goal.

---

## Core Concept 3 -- Your First Pre-Commit Hook

The most popular way to manage hooks is the **`pre-commit` framework** (a tool named `pre-commit`, written in Python, that works for any language). You describe the hooks you want in a file called `.pre-commit-config.yaml`, and the framework installs and runs them.

A minimal config:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace      # strip trailing spaces
      - id: end-of-file-fixer        # ensure files end in a newline
      - id: check-yaml               # validate YAML syntax

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff                     # lint Python (fast)
      - id: ruff-format              # format Python
```

Set it up once per clone:

```bash
pip install pre-commit
pre-commit install            # wires it into .git/hooks/pre-commit
```

Now every `git commit` runs those hooks on your **staged files only**, which keeps them fast. To check the whole repo on demand (useful the first time):

```bash
pre-commit run --all-files
```

**Key truth:** hooks must be *fast* (sub-second to a couple of seconds) and they are a **convenience, not a gate**. Anyone can skip them with `git commit --no-verify`. That's fine — the real gate is CI, which nobody can bypass.

---

## Core Concept 4 -- The CI Backstop

CI runs the **full** check suite on a server, so it doesn't matter if a teammate forgot to install hooks or used `--no-verify`. Here is a GitHub Actions job that lints a Go project:

```yaml
# .github/workflows/lint.yml
name: lint
on: [push, pull_request]

jobs:
  golangci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: v1.59
```

When this job fails, the PR shows a red X and (if the team configured it as a **required check**) the merge button is locked until it goes green. The *policy* of which checks are required lives in branch protection settings — that's covered in [Quality Gates](../../quality-gates/). For now, just know: CI is where "you can't merge this yet" actually gets enforced.

---

## Core Concept 5 -- Reading a Failed CI Check

A red CI check is not a punishment — it's the same diagnostic you'd see in your editor, just delivered later. To read it:

1. **Open the failed job's logs.** On GitHub, click the red X → "Details". Look for the linter's output, which names the file, line, and rule.
2. **Reproduce locally.** Run the *exact same command* CI ran. For the Go example: `golangci-lint run`. If it fails on your machine too, good — you can iterate fast.
3. **Fix and re-push.** CI re-runs automatically.

A good CI setup makes the finding appear **inline on your PR diff** — a comment right on the offending line — so you don't have to dig through logs. (How tools do that, via a format called SARIF, is a senior-level topic.)

The lesson for a junior: if CI is the *first* time you saw a finding, ask whether your editor or a pre-commit hook could have shown it sooner. Usually the answer is yes, and wiring that up saves you the next ten round trips.

---

## Real-World Examples

**You forget to format before pushing.** Your editor has format-on-save off. You push; the CI `gofmt`/`prettier` check fails. Fix: turn on format-on-save *and* add a formatter to your pre-commit hook. Now the problem dies two layers before CI.

**A teammate's commit has trailing whitespace.** They committed with `--no-verify` in a hurry. CI's `trailing-whitespace` check catches it anyway. This is the backstop doing exactly its job — hooks are skippable, CI is not.

**Lint passes locally but fails in CI.** Almost always a *version mismatch*: your local linter is v1.55, CI runs v1.59, and a new rule fired. Fix: pin the same version in both places (note how the workflow above pins `version: v1.59`).

---

## Mental Models

- **The three nets.** Editor, hook, CI are three nets stacked under a tightrope. Each catches what the one above missed. CI is the bottom net — nothing should reach it that the top nets could have caught, but if it does, the floor holds.
- **Shift left.** "Moving a check earlier in the loop." A junior's whole goal here is to shift findings left: from CI into the hook, from the hook into the editor.
- **Convenience vs. gate.** Hooks are a polite reminder you can ignore. CI is the bouncer at the door. Don't confuse the two.

---

## Common Mistakes

- **Treating CI as your linter.** Pushing half-finished code "to see what CI says." That's a context switch per iteration; run the check locally first.
- **Not installing pre-commit hooks.** Cloning a repo and skipping `pre-commit install`, then wondering why CI keeps catching whitespace.
- **Using `--no-verify` as a habit.** It exists for genuine emergencies, not for routinely skipping checks you find annoying. If a hook is too slow or wrong, fix the hook.
- **Ignoring editor squiggles.** The cheapest layer is the one most often muted. The underline is free advice — read it.
- **Different versions everywhere.** Editor plugin, hook, and CI all running different linter versions guarantees "works on my machine" failures.

---

## Test Yourself

1. Name the three places on the placement spectrum, from earliest to latest. Which one is the authoritative gate?
2. Why is catching a bug in your editor "cheaper" than catching it in CI?
3. What does `pre-commit run --all-files` do, and when would you run it?
4. Can a pre-commit hook stop a determined teammate from committing? Why or why not?
5. Lint passes on your laptop but fails in CI. What's the most likely cause?

---

## Cheat Sheet

```bash
# pre-commit framework
pip install pre-commit
pre-commit install            # activate hooks for this clone
pre-commit run --all-files    # run every hook on the whole repo
git commit --no-verify        # skip hooks (emergencies only)

# reproduce a CI lint failure locally
golangci-lint run             # Go
ruff check .                  # Python
npx eslint .                  # JS/TS
```

| Layer | Speed | Blocks? | Skippable? |
|---|---|---|---|
| Editor | Instant | No | n/a (advisory) |
| Pre-commit hook | Seconds | Locally only | Yes (`--no-verify`) |
| CI | Minutes | Yes (if required) | No |

---

## Summary

- The same finding can appear in three places: **editor → pre-commit hook → CI**. Aim to catch it at the earliest.
- **Earlier is cheaper:** editor ≈ free, CI = a context switch, production = an incident.
- **Pre-commit hooks** (via the `pre-commit` framework) run a fast subset on changed files. They are a *convenience* and are bypassable with `--no-verify`.
- **CI is the authoritative backstop.** It runs the full suite on a clean server and can block merges via required checks.
- If CI is the *first* place you see a finding, shift it left into a hook or your editor.

---

## Further Reading

- `pre-commit` framework documentation — `.pre-commit-config.yaml` and hook repos.
- GitHub Actions / GitLab CI quickstart guides.
- *Continuous Delivery*, Humble & Farley — the economics of fast feedback.
- The `ci-cd-pipeline-design` skill — for how CI jobs fit a larger pipeline.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the checks you're wiring into CI.
- [Formatters](../02-formatters/) — the easiest thing to enforce in a hook.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — another check that belongs on the spectrum.
- [Quality Gates](../../quality-gates/) — where required checks and merge policy live.
- Middle level of this topic — the pre-commit framework, CI jobs, and blocking vs. advisory in depth.
