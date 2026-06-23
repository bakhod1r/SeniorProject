# Formatters — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Formatters
> *Formatter questions are a tell. A candidate who says "the formatter and linter both enforce style" hasn't internalized the split; one who explains idempotency, the no-config philosophy, and `.git-blame-ignore-revs` unprompted has run this at scale. This page is the question bank that separates the two.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Formatter vs Linter](#formatter-vs-linter)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The questions interviewers actually ask about formatters, what each one is really probing, and model answers that show senior judgment.**

Formatters come up in interviews for backend, platform, infrastructure, and tech-lead roles — usually folded into a broader question about code quality, CI, or "how does your team keep the codebase consistent?" The questions look simple, which is exactly why they discriminate well: the *concepts* are easy to state and hard to fake having operated.

The recurring themes interviewers probe: do you understand the **formatter/linter division of labor**, can you explain **idempotency** and why CI depends on it, do you grasp the **no-config philosophy** as a feature rather than a limitation, and — for senior roles — have you actually *adopted* a formatter on a legacy codebase, *upgraded* one across a major version, and kept **`git blame` readable** through it? Those last three are the experience tells; you can't bluff the details.

Each question below gives the question, *what's really being tested*, and a model answer at roughly the depth a strong senior would give. Calibrate up or down for the role.

---

## Prerequisites

- **Required:** All four tier pages — [junior](junior.md), [middle](middle.md), [senior](senior.md), [professional](professional.md). This page assumes you can already explain the concepts; it drills how to *present* them.
- **Required:** Hands-on use of at least one formatter (gofmt, Prettier, Black, rustfmt) in a real project with CI.
- **Helpful:** [01 — Linters & Style Checkers](../01-linters-and-style-checkers/interview.md) — the most common companion question.
- **Helpful:** [09 — Static Analysis in CI](../09-static-analysis-in-ci/interview.md) — where the CI-gate questions overlap.

---

## Fundamentals

**Q1. What's the difference between a formatter and a linter?**
*What's really being tested:* the single most fundamental distinction in this topic. Conflating them is an instant junior signal.
**A.** A formatter **rewrites** source into a canonical layout — it changes whitespace, line breaks, and punctuation, never behavior, and it's deterministic and idempotent. A linter **reports** problems — unused variables, possible bugs, complexity, API misuse — and some can auto-fix a subset, but its core job is analysis, not reformatting. The clean division: the formatter owns *layout*, the linter owns *logic/correctness*. The practical consequence is you should disable the linter's layout rules (e.g. `eslint-config-prettier`) so the two don't fight over the same characters.

**Q2. Why is it safe to let a formatter rewrite an entire file unsupervised?**
*What's really being tested:* understanding that formatting touches only what the language ignores.
**A.** Because a formatter parses code to an AST — a structural representation that captures *meaning*, not layout — and reprints from that tree. Whitespace between tokens and line-break choices are invisible to the compiler/interpreter, so the reprinted program is behaviorally identical. The formatter knows the grammar (e.g. Black preserves Python's meaningful indentation structure while normalizing its style), so it never changes which block a statement belongs to. Output depends only on the input's meaning, which is also why it's deterministic.

**Q3. What does idempotency mean for a formatter and why does it matter?**
*What's really being tested:* whether you connect the property to the workflow.
**A.** Idempotency is `format(format(x)) == format(x)` — formatting already-formatted code does nothing; the formatted output is a fixed point. It matters because **check mode depends on it**: `black --check` asks "would running the formatter change anything?" If formatting weren't idempotent, already-formatted code would still register as needing changes and the check could never pass. It also guarantees no churn — two people formatting the same file get byte-identical output. A formatter bug where formatting oscillates between two shapes is a critical defect for exactly this reason.

**Q4. Explain the "no config" philosophy. Is having no options a bug or a feature?**
*What's really being tested:* whether you see configuration as a liability, the senior framing.
**A.** It's the feature. gofmt has *no* style options; Black launched "uncompromising" with essentially one. The reasoning: every option is a decision teams can argue about, the arguments are unwinnable because there's no objectively correct answer (two vs four spaces is arbitrary), so configurability manufactures recurring bikeshedding for zero value — *any* consistent choice is fine. Remove the knob and the argument can't happen. The cost is giving up house preferences, which for almost every team is a trade worth making. Prettier takes a middle path with a tiny option set, only for the few places ecosystems were irreconcilably split (semicolons, quotes), and it deliberately refuses to add more.

---

## Technique

**Q5. Where should a formatter run, and why more than one place?**
*What's really being tested:* defense-in-depth thinking about integration.
**A.** Three points, each with a distinct role. **Editor on save** — where formatting *should* happen; instant and invisible. **Pre-commit hook** — a local backstop for code that wasn't formatted on save (web editors, scripts), but bypassable with `--no-verify`, so it's a convenience not a guarantee. **CI in check mode** — the real gate, unbypassable because it runs on the server and blocks the merge. You want all three because each catches what the previous missed: editor is where it happens, hook is the local net, CI is the wall that doesn't move. The "format on save is the only place that matters" argument is aspirationally true but ignores unconfigured editors and bypassed hooks — which is exactly why CI must exist.

**Q6. How do you adopt a formatter on a large legacy codebase that's never had one?**
*What's really being tested:* the experience tell — have you actually done this?
**A.** The **one giant formatting commit**: reformat the entire tree in a single, isolated commit containing nothing else. Sequence: land the config and a *warn-only* CI gate first; run the big-bang format on a clean branch; verify it's pure formatting (a reviewer plus `git diff -w` shows no logic changed); **add that commit's SHA to `.git-blame-ignore-revs`**; flip the CI gate to blocking; push format-on-save and the pre-commit hook. Time it right after a release and warn anyone with open branches — they'll rebase across a commit that touched every file. The key insight is *concentrate the churn* into one ignorable commit rather than smearing it across months of feature PRs via "format as you touch it," which makes every diff noisy.

**Q7. What is `.git-blame-ignore-revs` and when do you use it?**
*What's really being tested:* blame hygiene — a strong senior tell almost no junior knows.
**A.** A file listing commit SHAs that `git blame` should see through. After a bulk reformat, blame would otherwise attribute every touched line to the reformat commit and its author/date, destroying the real authorship history. You add the bulk-format SHA to `.git-blame-ignore-revs`, set `git config blame.ignoreRevsFile .git-blame-ignore-revs` (and GitHub/GitLab read it automatically), and blame attributes each line to the commit *before* the reformat. You add a SHA to it on the initial adoption *and* on every formatter version bump that reformats the world.

**Q8. You upgraded Black/Prettier and suddenly thousands of files want reformatting. What happened and how do you handle it?**
*What's really being tested:* understanding a formatter version as a function identity.
**A.** A formatter is a function; a new major version is a *different* function with a different fixed point, so the same code formats differently. This is expected. Handle it like a dependency major bump: do the reformat as a **standalone commit** (never bundled with logic — the churn would bury a bug), review it with `git diff -w` to confirm it's pure formatting, add the SHA to `.git-blame-ignore-revs`, and time it for a quiet window with branch-holders warned. Read the tool's stability policy first (Black batches changes into an annual style migration). And pin the version everywhere — lockfile, pre-commit rev, CI image — so local and CI never disagree.

---

## Formatter vs Linter

**Q9. A teammate wants to enforce indentation and line length as ESLint rules. What do you tell them?**
*What's really being tested:* the ownership boundary, concretely.
**A.** Those are *layout* rules wearing a linter costume. If a formatter (Prettier) is in play, layout has one owner — the formatter — and putting indentation/line-length in the linter means two tools have an opinion about the same characters; they'll reformat each other's output and CI will flicker. The fix is `eslint-config-prettier`, whose only job is to disable all of ESLint's formatting rules. Let the linter focus on what it's uniquely good at: unused vars, possible bugs, complexity, API misuse. One-liner: "Is this a layout rule or a logic rule? Layout belongs to the formatter and shouldn't be a lint rule at all."

**Q10. Can a formatter ever change behavior? Can a linter's autofix?**
*What's really being tested:* precision about safety guarantees.
**A.** A correct formatter never changes behavior — by design it only touches layout, and its round-trip (parse → format → re-parse) preserves meaning. (A *bug* could, but that's a critical defect, not normal operation.) A linter's **autofix is different** — some autofixes are purely cosmetic, but others rewrite logic (e.g. "prefer `const`," "remove unused variable," "use optional chaining") and *can* subtly change behavior or at least require human judgment. That's the deeper reason to keep them separate: you can trust a formatter to run unsupervised on save and in bulk; you should review a linter's autofixes. This overlap is covered in [01 — Linters & Style Checkers](../01-linters-and-style-checkers/interview.md).

**Q11. Why not just have one tool that both formats and lints?**
*What's really being tested:* understanding the conceptual split even when tools converge.
**A.** Some tools *do* bundle both well — Ruff (Python) and Biome (JS/TS) ship a formatter and a linter behind one binary. But internally they keep the *concerns* separate: the formatter component owns layout and is idempotent/deterministic; the linter component reports/fixes logic. The bundling is a packaging and performance win (one fast Rust binary, shared parse), not a merging of responsibilities. The danger of *conceptually* merging them is that you lose the guarantee that "the formatter never changes behavior" — which is the property that lets you run it unsupervised everywhere. Even in a bundled tool, you reason about the two parts separately.

---

## Scenarios

**Q12. Your CI formatting gate fails on code a developer says they "just formatted." Diagnose.**
*What's really being tested:* the #1 real-world formatter problem.
**A.** Almost certainly a **version mismatch**: CI runs one formatter version, the developer's machine has another (often a global install), and the two have different fixed points, so the developer's "formatted" output isn't CI's. Fix by pinning the exact version in all three places — lockfile/dev-dependency, pre-commit rev, and CI image — and ensuring everyone runs the *local* pinned install (`npx`/the venv), never a global one. Secondary possibilities: the gate is full-tree while local was changed-files-only and a config change drifted other files, or generated/vendored files aren't excluded consistently.

**Q13. A PR is 1,200 lines. How do you tell if it's reviewable?**
*What's really being tested:* churn-vs-logic review hygiene.
**A.** First move: `git diff -w main..feature` (ignore whitespace). If it collapses to nothing, it's pure formatting churn — approve the layout on sight and there's no logic to review. If logic *is* mixed into the churn, push back: ask for the reformat to be a separate commit (review per-commit) or a separate PR, because a real change hidden in 1,000 lines of reflow is effectively unreviewed and a bug will slip through. Org-wide, you prevent this by being fully gated (every file already formatted, so feature diffs are pure logic) and by labeling format-only PRs so they're fast-tracked.

**Q14. How do you handle generated and vendored code with a formatter?**
*What's really being tested:* the ownership principle for non-hand-written files.
**A.** Usually *exclude* both. Generated code (protobuf, codegen) is overwritten on regeneration, so formatting it is churn and risks a diff war between "regenerate" and "format"; vendored code belongs to upstream and reformatting it breaks clean re-vendoring. Add them to `.prettierignore`/`force-exclude` and mark generated files `linguist-generated=true` in `.gitattributes` so review collapses them. The principle: *the producer owns the formatting*. The exception is generated code that humans read in PRs — then format it *inside the codegen step* so the producer and formatter agree, and the repo-wide gate still ignores it. Never let two pipelines own the same file.

**Q15. You're the platform lead. How do you roll a formatter across 100 repos?**
*What's really being tested:* governance and org-scale judgment.
**A.** Distribute the config as a **single versioned, consumed artifact** (e.g. an npm `@acme/prettier-config` package, a shared Ruff base config, a central Spotless plugin, or a pinned toolchain for gofmt/rustfmt) — *consumed, never copied*, so there's no drift. Govern versions centrally: bump once in the shared config, let Renovate open grouped, **non-automerged** PRs in each repo (they reformat code, so a human must review and add the blame-ignore SHA). Run adoption as a waved migration with a turnkey script (add config → giant commit → blame-ignore → gate warn-then-block). Make "style is solved, formatting is not negotiable" a written handbook axiom. Measure success as *silence*: zero formatting review comments, pure-logic diffs, the argument simply gone.

---

## Rapid-Fire

**Q. Write the idempotency equation.** — `format(format(x)) == format(x)`.

**Q. gofmt check-mode flag?** — `gofmt -l .` (lists unformatted files; empty = OK).

**Q. Prettier check-mode flag?** — `prettier --check .`.

**Q. Black check + show-diff?** — `black --check --diff .`.

**Q. rustfmt check?** — `cargo fmt --check` (or `rustfmt --check`).

**Q. One package that stops ESLint and Prettier fighting?** — `eslint-config-prettier`.

**Q. Go tool that also sorts/removes imports?** — `goimports`.

**Q. Python import sorter?** — `isort` (or `ruff check --select I --fix`).

**Q. Fast Rust-based Black/Prettier alternatives?** — Ruff (Python), Biome (JS/TS).

**Q. Java formatter usually run via Spotless?** — `google-java-format`.

**Q. File that keeps blame readable after a bulk reformat?** — `.git-blame-ignore-revs`.

**Q. Reviewer command to detect pure-whitespace diffs?** — `git diff -w`.

**Q. Why pin the formatter version?** — Different versions are different functions; unpinned, local and CI disagree.

**Q. Should CI auto-format and push, or check?** — Check. CI is a gate, not an author.

**Q. The three integration points?** — Editor-on-save, pre-commit hook, CI check.

**Q. Why exclude vendored code?** — It's upstream's; reformatting breaks clean re-vendoring and adds churn you didn't author.

---

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**
- Says a formatter and linter are "basically the same thing" or both "enforce style."
- Thinks a formatter can change behavior in normal operation, or can't explain why it's safe to run unsupervised.
- Wants maximum configurability and sees no-config as a limitation.
- Has CI *auto-format and commit* rather than check-and-gate.
- Never heard of `.git-blame-ignore-revs`; would bulk-reformat without protecting blame.
- Would bundle a formatter upgrade into a feature PR.
- Leaves ESLint's `indent`/`max-len` on alongside Prettier and doesn't know why CI flickers.

**Green flags:**
- States the rewrite-vs-report split crisply and disables the linter's layout rules.
- Explains idempotency and ties it directly to check mode.
- Frames no-config as conflict prevention, with the honest cost named.
- Describes the giant-format-commit + blame-ignore-revs adoption playbook unprompted.
- Treats a version bump as a function-identity change and a standalone, ignore-rev'd commit.
- Uses `git diff -w` as a review reflex and keeps churn out of logic diffs.
- At scale: consumed-not-copied shared config, central version governance, "style is solved" as a written axiom, success measured as silence.

---

## Cheat Sheet

```bash
# Check-mode flags (CI gates)
gofmt -l .              prettier --check .      black --check --diff .
cargo fmt --check       clang-format --dry-run --Werror

# Write-mode flags (save / fix)
gofmt -w .   goimports -w .   prettier --write .   black .   cargo fmt   clang-format -i

# The four interview-defining facts
# 1. Formatter REWRITES layout; linter REPORTS logic. Disable linter layout rules.
# 2. Idempotent: format(format(x)) == format(x)  -> this is why --check works.
# 3. No-config (gofmt/Black) ends bikeshedding; cost = no house preference.
# 4. Bulk reformat -> standalone commit -> .git-blame-ignore-revs -> blame stays readable.

# Stop ESLint+Prettier fighting:   extends: ["...", "prettier"]  (LAST)
# Detect pure churn in review:      git diff -w
# Version mismatch = the #1 CI formatting failure -> pin in lockfile + pre-commit + CI
```

---

## Summary

- The defining question is the **rewrite-vs-report split**; conflating formatter and linter is the clearest junior signal, and disabling the linter's layout rules is the senior follow-through.
- **Idempotency** (`format(format(x)) == format(x)`) is the property to name and tie to check mode; **determinism** is why there's no churn.
- Present **no-config** as a feature (conflict prevention) with the honest cost (no house preference); know Prettier's middle path and why it exists.
- The experience tells are **legacy adoption** (one giant commit), **`.git-blame-ignore-revs`** (blame hygiene), and treating a **version bump as a function-identity change** (standalone, ignore-rev'd, pinned everywhere).
- The #1 real-world failure to diagnose: **version mismatch** between local and CI — pin in all three places.
- At scale, talk **consumed-not-copied shared config**, **central version governance**, the **"style is solved, formatting is not negotiable"** axiom, and **silence as the success metric**.

---

## Further Reading

- [Prettier — Why Prettier?](https://prettier.io/docs/en/why-prettier.html) and [Option Philosophy](https://prettier.io/docs/en/option-philosophy.html).
- [Go blog — gofmt](https://go.dev/blog/gofmt) — the original no-config argument.
- [Black — code style & stability policy](https://black.readthedocs.io/en/stable/the_black_code_style/) — what "uncompromising" decides and the upgrade model.
- [Git — `blame.ignoreRevsFile`](https://git-scm.com/docs/git-blame) — blame hygiene through bulk reformats.
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) — the canonical "stop the fight" config.

---

## Related Topics

- [01 — Linters & Style Checkers](../01-linters-and-style-checkers/interview.md) — the most common companion question (rewrite vs report, autofix safety).
- [09 — Static Analysis in CI](../09-static-analysis-in-ci/interview.md) — where the gate-design questions overlap.
- [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md) — the concepts this page drills you on presenting.
- [Static Analysis Roadmap](../README.md) — the category in context.
