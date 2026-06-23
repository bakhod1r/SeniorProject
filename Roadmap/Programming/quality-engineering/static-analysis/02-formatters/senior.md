# Formatters — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Formatters
> *The hard part of formatting was never the formatting. It's enforcing it without becoming the team's most hated CI job, introducing it to a 200k-line codebase without burning a week of blame history, and surviving the day a formatter upgrade reformats every file you own. This page is about operating a formatter at the seam where tooling meets human process.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Enforcing in CI Without It Being a Nuisance](#core-concept-1--enforcing-in-ci-without-it-being-a-nuisance)
5. [Core Concept 2 — Version Pinning and the Day the World Reformats](#core-concept-2--version-pinning-and-the-day-the-world-reformats)
6. [Core Concept 3 — Adopting on a Legacy Codebase](#core-concept-3--adopting-on-a-legacy-codebase)
7. [Core Concept 4 — Keeping Blame Readable with .git-blame-ignore-revs](#core-concept-4--keeping-blame-readable-with-git-blame-ignore-revs)
8. [Core Concept 5 — Splitting Format Churn from Logic in Review](#core-concept-5--splitting-format-churn-from-logic-in-review)
9. [Core Concept 6 — Generated and Vendored Code](#core-concept-6--generated-and-vendored-code)
10. [Core Concept 7 — Performance and Scoping to Changed Files](#core-concept-7--performance-and-scoping-to-changed-files)
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

> Focus: **Operating a formatter at scale — CI enforcement that doesn't annoy people, surviving version bumps, introducing it to legacy code, and keeping `git blame` and code review usable through all of it.**

By now the mechanics are settled: formatters rewrite, they're idempotent, you wire them into save/hook/CI. The senior-level questions are all about *operating* this on a real, large, long-lived codebase with many contributors and years of history.

Three problems dominate. First, **enforcement without friction**: a CI gate that fails with a cryptic message and no obvious fix breeds resentment and `--no-verify` muscle memory; a well-designed gate fails with the exact command to fix it and is forgotten in ten seconds. Second, **version churn**: a formatter is a function, and a new major version is a *different function* with a different fixed point — upgrading Black or Prettier can reformat thousands of files, and you need a strategy that contains the blast radius. Third, **legacy adoption**: turning a formatter on for the first time across an old codebase produces one gigantic diff that, handled naively, destroys `git blame` for everyone and makes the introducing PR unreviewable.

The thread connecting all three is *human process*. The formatter is solved technology; the senior skill is integrating it so that the team experiences it as relief, not as one more hoop. We'll cover the giant-formatting-commit, `.git-blame-ignore-revs`, separating churn from logic in review, handling generated and vendored code (which you usually must *exclude*), and scoping the formatter to changed files so CI stays fast.

---

## Prerequisites

- **Required:** [Middle Level](middle.md) — determinism, idempotency, the no-config philosophy, the three integration points.
- **Required:** Solid `git` — you can read `git log`, understand commit SHAs, and have seen `git blame`.
- **Required:** You've configured a CI pipeline and understand exit codes as gates.
- **Helpful:** [09 — Static Analysis in CI](../09-static-analysis-in-ci/senior.md) — the broader CI-gate design this fits into.
- **Helpful:** Experience reviewing large diffs and feeling the pain of mixed churn-and-logic PRs.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Giant formatting commit** | A single commit that reformats the entire codebase at once, isolated from any logic change. |
| **`.git-blame-ignore-revs`** | A file listing commit SHAs that `git blame` should "see through" so bulk-format commits don't pollute blame. |
| **Version pinning** | Locking the formatter to an exact version so everyone (and CI) formats identically. |
| **Blast radius** | How many files/lines a change touches; for a formatter upgrade, potentially all of them. |
| **Churn** | Diff lines that are pure formatting, carrying no logic change. |
| **Vendored code** | Third-party source copied into your repo (e.g. `vendor/`, `node_modules/`). |
| **Generated code** | Source produced by a tool (protobuf, codegen, ORM models) that you don't hand-edit. |
| **Scoping** | Running the formatter only on changed files rather than the whole tree, for speed. |

---

## Core Concept 1 — Enforcing in CI Without It Being a Nuisance

A formatting gate is the easiest CI check to *implement* and the easiest to make *hated*. The difference is entirely in the failure experience.

The bad gate fails like this:

```text
✗ format-check (exit code 1)
Process completed with exit code 1.
```

No one knows what failed or how to fix it. They re-run the job, dig through logs, and eventually grumble their way to the answer. Multiply by every contributor and you've manufactured resentment toward a tool that's supposed to *reduce* friction.

The good gate fails with the **exact remediation**:

```yaml
# CI: show the diff AND the one-line fix
- name: Check formatting
  run: |
    if ! black --check --diff .; then
      echo "::error::Code is not formatted. Run 'black .' locally and commit."
      exit 1
    fi
```

```text
✗ Check formatting
--- app.py
+++ app.py
-def add(a,b): return a+b
+def add(a, b):
+    return a + b
::error::Code is not formatted. Run 'black .' locally and commit.
```

Now the failure is self-service: the message *is* the fix. The design principles for a non-nuisance gate:

- **Always print the diff** (`--diff`, `--Werror` dry-run), so the author sees exactly what's wrong.
- **State the fix command** in the failure message. The author should never have to guess.
- **Make the fix one command** — never "manually adjust line 42." The whole point is that formatting is mechanical.
- **Pin the version** (next concept) so CI and local produce identical output; otherwise a developer runs `black .`, it passes locally, and CI *still* fails because CI has a different Black. This single mismatch generates more rage than any other formatter issue.
- **Keep it fast** so it's not the slow link (later concept on scoping).

> **The cultural framing that makes it stick:** "Style is solved, formatting is not negotiable." The gate isn't a matter of taste you might lose an argument about — it's plumbing. Nobody argues with the spell-checker. When the team internalizes that formatting is *automated infrastructure*, not *someone's opinion enforced on them*, the gate stops feeling like a nuisance and starts feeling like the dishwasher: you'd never go back. The broader gate-design discipline is [09 — Static Analysis in CI](../09-static-analysis-in-ci/senior.md).

---

## Core Concept 2 — Version Pinning and the Day the World Reformats

A formatter is a function. Black 23 and Black 24 are *different functions* — they have different fixed points. The same file, formatted by two versions, can come out differently. This has two consequences, one daily and one occasional.

**The daily consequence: pin the version, or CI and local will disagree.** If your CI runs Black 24.4.2 and a developer has Black 23.1 installed globally, they will format locally, commit, and watch CI fail on code they *just formatted*. The fix is to pin an exact version everywhere:

```toml
# pyproject.toml — pin the formatter as a dev dependency, exact version
[tool.poetry.group.dev.dependencies]
black = "24.4.2"
```

```yaml
# .pre-commit-config.yaml — pin the hook revision to match
- repo: https://github.com/psf/black
  rev: 24.4.2   # MUST match the version CI and devs use
```

Pin it in the lockfile, the pre-commit rev, and the CI image. They must all be the same version. (`gofmt` and `rustfmt` sidestep this by shipping with the toolchain — pin the *toolchain* version instead, e.g. via `go.mod`'s `go` directive or `rust-toolchain.toml`.)

**The occasional consequence: an upgrade reformats the world.** When you bump Black or Prettier across a major version, the new function's fixed point differs, so running it touches potentially every file. Handle this exactly like the legacy adoption below — as a **dedicated, isolated commit**:

```bash
git switch -c chore/black-24-upgrade
# bump the pin in pyproject.toml / pre-commit / CI
black .                          # reformats everything to the new style
git add -A
git commit -m "chore: reformat with Black 24.x (no logic changes)"
# then add this commit's SHA to .git-blame-ignore-revs (next concept)
```

The PR is huge but *trivially reviewable* — the reviewer confirms it's pure formatting (no logic diffs hiding in it) and that CI passes, then approves. Never bundle a formatter upgrade with feature work; the churn will bury the logic.

> **Stability policies help.** Black has a "stability policy" and an annual style migration; Prettier documents breaking changes per major. Read these before upgrading so you know the blast radius and can time it for a quiet week, not the day before a release.

---

## Core Concept 3 — Adopting on a Legacy Codebase

Turning a formatter on for a codebase that's never had one produces one enormous diff. The right move is the **one giant formatting commit**: reformat everything in a single, isolated commit that contains *nothing else*.

```bash
git switch -c chore/adopt-prettier
npx prettier --write .          # reformat the entire tree
git add -A
git commit -m "chore: format entire codebase with Prettier (no logic changes)

Pure formatting. No behavior changes. Reviewers: confirm zero logic diffs.
This commit's SHA goes into .git-blame-ignore-revs."
```

Why one commit and not "format as you touch files"? The incremental approach sounds gentler but is worse: it spreads churn across hundreds of unrelated PRs for months, so every feature diff is half formatting, every review is noisy, and you can never tell logic from layout. The big-bang commit concentrates *all* the churn into one reviewable, ignorable place and then it's done forever.

Sequence the adoption:

1. **Land the config and the CI gate first**, but in *warn-only* mode (don't fail the build yet), so you're not blocked while preparing.
2. **Run the giant formatting commit** on a clean branch, with no other changes.
3. **Verify it's pure formatting** — a reviewer (and ideally a script) confirms no logic changed.
4. **Add the commit SHA to `.git-blame-ignore-revs`** (next concept).
5. **Flip the CI gate to blocking.** From now on, the repo stays formatted.
6. **Push format-on-save and the pre-commit hook** so contributors never produce unformatted code again.

The timing matters: do this right after a release or during a quiet period, and warn everyone with open branches — they'll need to rebase across a commit that touched every file, which can mean merge conflicts. Coordinate so people merge or rebase before the big commit lands.

---

## Core Concept 4 — Keeping Blame Readable with .git-blame-ignore-revs

The giant formatting commit has one nasty side effect: `git blame` now attributes every reformatted line to *that commit and its author*, on *that date*. You lose the real history — who actually wrote this logic and when. For a large codebase this is a serious loss; blame is how engineers find context and the right person to ask.

Git solves this with `--ignore-rev` and, better, a checked-in file:

```bash
# .git-blame-ignore-revs — one commit SHA per line, with a comment
# Reformat entire codebase with Prettier
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2

# Upgrade to Black 24.x (annual style migration)
9f8e7d6c5b4a9f8e7d6c5b4a9f8e7d6c5b4a9f8e
```

Tell git to use it (once per clone, but you can document it so it's standard):

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Now `git blame` *sees through* those commits — it attributes each line to the commit *before* the reformat, restoring the real authorship and date. GitHub, GitLab, and most hosts read `.git-blame-ignore-revs` automatically in their blame UI, so the web view is fixed for everyone too.

Every time you do a bulk reformat — initial adoption *and* every formatter version bump — add that commit's SHA to this file. It's a permanent, growing record of "these commits are pure formatting, please ignore them for blame purposes."

> **Why this is non-optional at scale.** Without it, six months after adoption someone runs `git blame` to understand a tricky function and every line says "Reformat codebase — DevOps Bot — Jan 3." The history is gone. The two-line config and the SHA list are the cheapest insurance you'll ever buy for a codebase's long-term archaeology.

---

## Core Concept 5 — Splitting Format Churn from Logic in Review

The reviewability principle generalizes beyond the big commit: **never mix formatting churn with logic changes in the same diff.** A reviewer's attention is finite, and a 50-line logic change hidden inside 600 lines of reflow is effectively unreviewed — the eye glazes, the real bug slips through.

Concrete tactics:

- **Format the file *before* you start the logic change**, in its own commit. Then your feature commit contains only logic. If the file was already formatted (because the repo is gated), this is a non-issue — which is the whole reason to gate.
- **If you must reformat and change logic in one PR, use two commits** and tell the reviewer to review them separately. GitHub lets reviewers view per-commit.
- **Reviewers: when you see a giant diff, check whether it's pure churn first.** `git diff -w` (ignore whitespace) collapses pure-formatting diffs to nothing — if `git diff -w` is empty, the change is *only* whitespace and you can approve on sight.

```bash
# Reviewer's first move on a suspiciously large diff:
git diff -w main..feature -- path/to/file
# Empty output? It's pure formatting churn. Approve the layout, focus elsewhere.
```

- **Don't let "drive-by reformatting" into feature PRs.** A developer who reformats an unrelated file "while they're in there" adds churn that obscures their actual change and pollutes blame. If the repo is gated, those files are already formatted, so this temptation disappears — another argument for getting fully formatted early.

The cultural win is the same one from the CI concept: once everything is always formatted, *every diff is pure logic*, because there's never any layout left to change. The formatter doesn't just save the writer's time — it permanently makes every future diff easier to review.

---

## Core Concept 6 — Generated and Vendored Code

Two categories of files should usually be *excluded* from formatting: **generated code** and **vendored code**.

**Generated code** (protobuf output, ORM models, OpenAPI clients, codegen) is produced by a tool and regenerated, not hand-edited. Formatting it is pointless churn: the next regeneration overwrites your formatting, and if the generator's output style differs from your formatter's, you get a perpetual diff war between "regenerate" and "format." Exclude it, and ideally mark it so reviewers and blame ignore it too:

```gitattributes
# .gitattributes — mark generated files (collapses them in PR review, GitHub)
*.pb.go            linguist-generated=true
src/generated/**   linguist-generated=true
```

```jsonc
// .prettierignore  /  pyproject [tool.black] force-exclude  /  etc.
src/generated/
**/*.pb.go
```

**Vendored code** (`vendor/`, `node_modules/`, copied third-party source) belongs to someone else. Reformatting it makes your vendor directory diverge from upstream, breaks clean re-vendoring, and adds enormous churn you didn't author. Always exclude it:

```
# .prettierignore
node_modules/
vendor/
```

(`gofmt`/`goimports` already skip `vendor/` by convention; most tools have an ignore file or a `force-exclude` setting.)

> **The exception that proves the rule:** if generated code is *committed and humans read it in PRs*, some teams *do* format it for readability — but then they must format it *as part of the generation step*, so the formatter and generator agree and there's no churn. The principle: whoever *produces* the file owns its formatting. If a tool produces it, the tool's pipeline should format it; your repo-wide formatter should leave it alone.

---

## Core Concept 7 — Performance and Scoping to Changed Files

On a large monorepo, formatting the entire tree on every CI run is wasteful — and slow CI is the second-biggest source of formatter resentment after version mismatch. Two levers:

**Use a fast formatter.** Ruff and Biome are Rust-based and 10–100× faster than Black/Prettier on large trees; for a big repo this alone can turn a 90-second check into a sub-second one.

**Scope to changed files.** For pre-commit and PR checks, format only what the diff touched, not the whole repo:

```bash
# Format only files changed vs the base branch
git diff --name-only --diff-filter=ACM origin/main... | \
  grep -E '\.(py)$' | xargs --no-run-if-empty black --check --diff
```

```yaml
# pre-commit already scopes to staged files automatically — that's a key reason to use it
```

A nuance: scoping to changed files is great for *speed* but you still want a *periodic full-tree check* (e.g., on `main` nightly, or on the merge commit) to catch files that drifted due to a config change or a formatter upgrade — a changed-files-only gate can miss those. The pattern: **changed-files check on PRs (fast), full-tree check on main (thorough).**

> **Caching helps too.** Cache the formatter binary/venv in CI so you're not reinstalling it each run. And remember `gofmt`/`rustfmt` ship with the toolchain you already have cached — zero install cost. The deeper CI-performance treatment is in [09 — Static Analysis in CI](../09-static-analysis-in-ci/senior.md).

---

## Real-World Examples

**1. The version-mismatch rage spiral.** A team's CI ran Prettier 3.2; half the developers had 2.x globally. Every other PR failed formatting on code that "looked formatted," and developers started cargo-culting `// prettier-ignore`. The fix was pinning Prettier in `package.json` *and* running it via `npx`/the local install everywhere — never the global. CI failures dropped to near zero overnight.

**2. The unreviewable upgrade PR.** A Black 24 upgrade was bundled into a feature branch. The PR was 4,000 lines; the reviewer rubber-stamped it; a real bug rode in on the churn and shipped. Postmortem rule: *formatter upgrades are always a standalone commit*, reviewed with `git diff -w` to confirm pure churn, and the SHA goes in `.git-blame-ignore-revs`.

**3. The blame that pointed at a bot.** A year after adopting gofmt, an on-call engineer ran `git blame` on a flaky function and every line read "format codebase — ci-bot." They couldn't find who understood it. The team retroactively added the format commit to `.git-blame-ignore-revs`; blame snapped back to the real authors. Now it's standard for every bulk reformat.

---

## Mental Models

- **A formatter version is a function identity.** Upgrading isn't a tweak; it's swapping the function. Treat it like a dependency major bump, because it is one.
- **Concentrate churn, don't smear it.** One giant commit you can ignore beats a thousand small ones you can't.
- **Blame is archaeology; protect the strata.** `.git-blame-ignore-revs` keeps the layers readable through every bulk reformat.
- **`git diff -w` is the churn detector.** Empty? Pure formatting. It's the reviewer's first move on any large diff.
- **The producer owns the formatting.** Generated/vendored code is formatted (or not) by whoever produces it, not by your repo-wide gate.
- **Fast gate, full gate.** Changed-files check for speed on PRs; full-tree check for safety on main.

---

## Common Mistakes

- **Not pinning the version.** The single biggest source of "I formatted it and CI still fails." Pin in lockfile, pre-commit rev, and CI image — all the same version.
- **Bundling a formatter upgrade with logic.** The churn buries the logic and a bug ships. Always standalone.
- **Skipping `.git-blame-ignore-revs`.** Six months later, blame is useless and the history is gone. Add the SHA every bulk reformat.
- **Formatting generated or vendored code.** Perpetual diff wars and churn you didn't author. Exclude both.
- **A CI gate with no remediation message.** "Exit code 1" breeds resentment. Print the diff and the one fix command.
- **Full-tree formatting on every PR of a huge monorepo.** Slow CI → resentment → `--no-verify`. Scope to changed files; use a fast formatter; keep a periodic full check.
- **Incremental "format as you touch it" adoption.** Spreads churn across every PR for months. Do the big-bang commit instead.

---

## Test Yourself

1. Why must the formatter version be pinned, and in how many places?
2. Walk through the six steps of adopting a formatter on a legacy codebase.
3. What does `.git-blame-ignore-revs` do, mechanically, and when do you add to it?
4. A reviewer faces a 1,200-line diff. What's the one command that tells them whether it's pure formatting?
5. Why exclude generated and vendored code from the repo-wide formatter? What's the exception?
6. Design a CI formatting gate that developers *won't* resent. Name three properties.
7. Why is "format only changed files" insufficient as your *only* check on main?

---

## Cheat Sheet

```bash
# --- Pin everywhere (example: Black) ---
# pyproject.toml: black = "24.4.2"
# .pre-commit-config.yaml: rev: 24.4.2
# CI image: pip install black==24.4.2

# --- Legacy adoption: the one giant commit ---
git switch -c chore/adopt-formatter
black .                      # or prettier --write . / cargo fmt / etc.
git commit -am "chore: format entire codebase (no logic changes)"
git rev-parse HEAD           # copy SHA into .git-blame-ignore-revs

# --- Blame hygiene ---
# .git-blame-ignore-revs  <-- one bulk-format SHA per line
git config blame.ignoreRevsFile .git-blame-ignore-revs

# --- Reviewer's churn detector ---
git diff -w main..feature    # empty = pure formatting

# --- Scope to changed files (fast PR check) ---
git diff --name-only --diff-filter=ACM origin/main... \
  | grep '\.py$' | xargs -r black --check --diff

# --- Exclude generated/vendored ---
# .prettierignore / .gitignore-style exclude:  node_modules/  vendor/  src/generated/
# .gitattributes:  *.pb.go linguist-generated=true
```

| Problem | Senior move |
|---|---|
| CI fails on "formatted" code | Pin version in all 3 places |
| Upgrade reformats everything | Standalone commit + ignore-rev |
| Blame points at the format bot | `.git-blame-ignore-revs` |
| Giant PR, can't tell logic from layout | `git diff -w` |
| Generated/vendored churn | Exclude from the formatter |
| Slow CI on a monorepo | Changed-files scope + fast tool |

---

## Summary

- A formatting **CI gate** is trivial to build and easy to make hated; the difference is the failure experience — **print the diff, state the one-line fix, pin the version** so local and CI agree.
- A formatter version is a **function identity**; pin it in the lockfile, pre-commit rev, and CI image. A major **upgrade reformats the world** and must be a standalone, ignore-rev'd commit.
- Adopt on legacy code with **one giant formatting commit** — concentrate churn, don't smear it across months of feature PRs.
- Protect history with **`.git-blame-ignore-revs`**: add every bulk-format SHA so blame sees through it.
- **Never mix churn and logic** in a reviewable diff; `git diff -w` is the reviewer's churn detector.
- **Exclude generated and vendored code** — the producer owns its formatting, not your repo-wide gate.
- Keep the gate **fast** (scope to changed files on PRs, fast tools, caching) but keep a **periodic full-tree check** on main.

---

## Further Reading

- [Git — `--ignore-rev` and `blame.ignoreRevsFile`](https://git-scm.com/docs/git-blame#Documentation/git-blame.txt---ignore-revltrevgt) — the blame-hygiene mechanism.
- [Black stability policy](https://black.readthedocs.io/en/stable/the_black_code_style/index.html#stability-policy) — how to reason about upgrades.
- [Prettier — Ignoring Code](https://prettier.io/docs/en/ignore.html) and [.prettierignore](https://prettier.io/docs/en/ignore.html) — excluding generated/vendored files.
- [GitHub — Ignore commits in the blame view](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files#ignore-commits-in-the-blame-view) — host-side support for the ignore-revs file.
- The **code-smell-detection** skill — for the logic issues the formatter deliberately won't touch.

---

## Related Topics

- [09 — Static Analysis in CI](../09-static-analysis-in-ci/senior.md) — gate design, caching, and changed-files scoping in depth.
- [01 — Linters & Style Checkers](../01-linters-and-style-checkers/senior.md) — enforcing logic rules at scale, alongside the formatter.
- [Professional Level](professional.md) — org/monorepo shared config, governance, and the cultural win.
- [Interview Level](interview.md) — the question bank.
