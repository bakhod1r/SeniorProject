# Changelogs & Release Notes — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Changelogs & Release Notes

> *The format is easy. The hard part is the policy: who writes entries, when, in what tense, and whether a machine should do it for you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Conventional Commits as a Source of Truth](#core-concept-1----conventional-commits-as-a-source-of-truth)
5. [Core Concept 2 — Mapping Commit Type to SemVer and Changelog Section](#core-concept-2----mapping-commit-type-to-semver-and-changelog-section)
6. [Core Concept 3 — Automated Generation: The Tool Landscape](#core-concept-3----automated-generation-the-tool-landscape)
7. [Core Concept 4 — PR Labels and Merge Titles as Inputs](#core-concept-4----pr-labels-and-merge-titles-as-inputs)
8. [Core Concept 5 — Automation vs Hand-Curation: The Trade-off](#core-concept-5----automation-vs-hand-curation-the-trade-off)
9. [Core Concept 6 — Release Notes Done Well](#core-concept-6----release-notes-done-well)
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

> Focus: **turning commits and PRs into changelogs automatically, and knowing when automation helps versus when it produces noise.**

At the junior level you learned the format and how to write one entry by hand. The middle-level question is structural: a team merges dozens of PRs a week. Hand-editing `CHANGELOG.md` in every PR causes merge conflicts (everyone edits the same `Unreleased` block) and gets skipped under deadline pressure. So teams reach for **automation** — derive the changelog from a structured source the team already produces.

That source is usually one of three things: **conventional commit messages**, **PR labels**, or **merge titles**. Each turns an ad-hoc note into machine-readable metadata, which a tool then groups, versions, and renders. This file covers how that machinery works, the major tools, and the central tension you'll manage for the rest of your career: **automation gives you completeness and consistency; curation gives you a readable story. You usually need both.**

---

## Prerequisites

- Junior-level changelog format (Keep a Changelog, the six groups).
- [Versioning & SemVer](../01-versioning-and-semver/): `MAJOR.MINOR.PATCH` and what forces each bump.
- Git fundamentals: commit messages, trailers, tags, merge vs squash.
- Familiarity with CI and pull-request workflows.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Conventional Commits** | A commit-message convention: `type(scope): description`. |
| **BREAKING CHANGE** | A commit footer/marker signalling a backward-incompatible change → major bump. |
| **Commit trailer** | A `Key: value` line at the end of a commit message (e.g. `BREAKING CHANGE:`). |
| **semantic-release** | A tool that fully automates version+changelog+publish from commits. |
| **release-please** | Google's tool that opens a "release PR" accumulating changes. |
| **git-cliff** | A configurable changelog generator from git history. |
| **Changesets** | A monorepo tool where authors write intent files per PR. |
| **Squash merge** | Collapsing a PR's commits into one — makes the merge title the commit. |

---

## Core Concept 1 — Conventional Commits as a Source of Truth

**Conventional Commits** is a lightweight spec that makes commit messages machine-readable. The structure:

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Real examples:

```
feat(auth): add TOTP-based multi-factor authentication

fix(parser): handle config files with a UTF-8 BOM

docs: clarify the retry-policy section in the README

feat(api)!: return camelCase keys in all responses

BREAKING CHANGE: response keys changed from snake_case to camelCase.
Clients parsing snake_case fields must update.
```

The common types:

| Type | Meaning |
|------|---------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | A performance improvement |
| `test` | Adding/correcting tests |
| `build` / `ci` | Build system or CI changes |
| `chore` | Maintenance not affecting source/tests |

Two ways to signal a **breaking change**: a `!` after the type/scope (`feat(api)!:`) **or** a `BREAKING CHANGE:` footer. Either one forces a major version bump.

> The payoff: once commits follow this format, a tool can read `git log`, classify every commit, decide the version bump, and render the changelog — with zero manual editing. The cost: discipline. Every contributor must write structured messages, usually enforced by a commit-lint hook in CI.

---

## Core Concept 2 — Mapping Commit Type to SemVer and Changelog Section

Conventional Commits is valuable precisely because it defines two mappings: commit type → **version bump**, and commit type → **changelog section**.

| Commit | SemVer bump | Keep a Changelog group |
|--------|-------------|------------------------|
| `fix:` | PATCH (`1.4.2 → 1.4.3`) | Fixed |
| `feat:` | MINOR (`1.4.2 → 1.5.0`) | Added |
| `feat!:` / `BREAKING CHANGE:` | MAJOR (`1.4.2 → 2.0.0`) | Changed / Removed |
| `perf:` | PATCH (often) | Changed |
| `docs:`, `chore:`, `ci:`, `test:` | none | usually omitted |

This is the engine behind tools like semantic-release. Given a range of commits since the last tag:

```
$ git log v1.4.2..HEAD --oneline
a1b2c3d feat(reports): add CSV export
d4e5f6a fix(auth): prevent focus loss on validation error
9z8y7x6 chore: bump dev dependencies
```

The tool reasons: one `feat` (highest non-breaking) → **MINOR bump → 1.5.0**. It then renders:

```markdown
## [1.5.0] - 2026-06-20

### Added
- **reports:** add CSV export (a1b2c3d)

### Fixed
- **auth:** prevent focus loss on validation error (d4e5f6a)
```

The `chore` commit is dropped from the changelog — it's noise to a reader. **This is the first place you see the curation problem leak in: the tool's idea of "noise" must match yours.** A `chore: upgrade lodash to patch CVE-...` arguably belongs in Security, but a naive type-only rule hides it.

---

## Core Concept 3 — Automated Generation: The Tool Landscape

Four tools dominate. They differ mainly in *what they read* and *how much of the release they automate*.

**git-cliff** — a fast, configurable changelog generator (TOML config) from git history. It generates the changelog and nothing else; you control versioning and publishing.

```bash
# Generate the full changelog from conventional commits
git cliff --output CHANGELOG.md

# Just the unreleased section, for a release PR
git cliff --unreleased --tag v1.5.0
```

**semantic-release** — fully automated. On every push to the release branch, it analyzes commits, computes the next version, generates the changelog, tags, and publishes to the registry — all in CI, no human in the loop.

```jsonc
// .releaserc.json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

**release-please** (Google) — the "release PR" model. It watches your default branch and opens/updates a PR that accumulates the changelog and version bump. Merging that PR cuts the release. This inserts a human review point: you can edit the generated notes before they ship.

```yaml
# .github/workflows/release-please.yml
- uses: googleapis/release-please-action@v4
  with:
    release-type: node
```

**Changesets** — the monorepo favorite. Authors don't rely on commit messages; they add an intent file per change:

```bash
$ npx changeset
# prompts: which packages? what bump (patch/minor/major)? summary?
```

```markdown
---
"@acme/ui": minor
"@acme/core": patch
---

Add a `<DatePicker>` component and fix a tree-shaking regression in core.
```

At release time, `changeset version` consumes these files, bumps each package, and writes per-package changelogs. The intent file *is* the human-written changelog entry — automation handles only the bookkeeping.

> Rule of thumb: **git-cliff** if you want a generator and keep control; **semantic-release** for fully hands-off single-package CI; **release-please** when you want generated-but-reviewable; **changesets** for monorepos and when you want authors to write prose.

---

## Core Concept 4 — PR Labels and Merge Titles as Inputs

Not every team adopts conventional commits. Two other structured sources are common:

**PR labels.** Tag each PR with a label (`type: feature`, `type: bugfix`, `breaking`, `skip-changelog`). A tool — GitHub's built-in *automatically generated release notes*, or `release-drafter` — groups merged PRs by label into a draft note.

```yaml
# .github/release.yml  (GitHub native)
changelog:
  categories:
    - title: Breaking Changes 🛠
      labels: [breaking]
    - title: New Features 🎉
      labels: [feature, enhancement]
    - title: Bug Fixes 🐛
      labels: [bug, fix]
    - title: Other
      labels: ["*"]
  exclude:
    labels: [skip-changelog, dependencies]
```

**Merge / squash titles.** Teams that squash-merge make the squash commit title the unit of record. If the squash title follows Conventional Commits (many repos enforce a PR-title linter), you get the commit-based pipeline for free — without requiring every intermediate commit to be clean.

```
Squash PR title:  feat(reports): add CSV export (#318)
→ becomes the single commit on main → feeds the generator
```

> The deeper point: automation needs *some* structured input. The question is only *where* you make humans add structure — in commits, in PR titles, in labels, or in intent files. Pick the one with the least friction for your team and enforce it in CI.

---

## Core Concept 5 — Automation vs Hand-Curation: The Trade-off

This is the central judgment call. Both extremes fail.

**Pure automation (every commit → an entry):**

- ✅ Nothing is forgotten; the changelog is exhaustive and always up to date.
- ✅ Consistent format; no merge conflicts on `CHANGELOG.md`.
- ❌ **Every commit is noise.** Readers drown in `fix: typo`, `refactor: rename variable`, `chore: bump deps`. The signal — the two changes that actually matter to a user — is buried.
- ❌ Entries read like commit messages, because they *are* commit messages. No narrative, no "why."

**Pure hand-curation:**

- ✅ A readable, prioritized story; highlights first; the "why" explained.
- ❌ Slow, easily skipped, prone to omissions and merge conflicts.

**The mature answer is layered:**

| Artifact | Approach |
|----------|----------|
| CHANGELOG (developers) | **Automated** from commits/PRs — completeness matters most. |
| Release notes (users) | **Curated** — a human picks 3–5 highlights and writes the narrative. |
| Migration guide | **Hand-written** — automation can't generate a safe upgrade recipe. |

So the generated changelog feeds the curator: the human reads the auto-generated list and *promotes* the important entries into the release notes, adding context. release-please and changesets are popular precisely because they leave a review step where this curation happens.

> Heuristic: **automate the complete record, curate the story.** If your "release notes" are just the raw generated changelog, you've automated the wrong artifact.

---

## Core Concept 6 — Release Notes Done Well

Release notes are not a changelog with a nicer header. They follow different rules.

1. **Lead with impact, not inventory.** Open with the one or two things a user will notice.
2. **Group by user value, not by code area.** "Faster dashboards," "New export options" — not "changes to the reporting module."
3. **Explain the *why* for behavior changes.** Users tolerate change when they understand the reason.
4. **Surface anything requiring action prominently** — breaking changes, deprecations, required migrations — and link the migration guide.
5. **Link out** to the full changelog for the completionists.

```markdown
# v3.2.0 — Cleaner logs and YAML config

**Highlights**
- 🧹 The default log level is now `info`. Your logs will be much quieter
  out of the box (set `--log-level=debug` to restore the old behavior).
- 📝 You can now write configuration in YAML as well as JSON.

**Action needed**
- `--verbose` is deprecated and will be removed in v4. Replace it with
  `--log-level=debug`. See the [v3 → v4 migration guide](…).

[Full changelog →](CHANGELOG.md#320---2026-06-15)
```

---

## Real-World Examples

**A semantic-release pipeline.** A team merges PRs to `main` all week. CI runs semantic-release on each merge: it sees three `fix:` commits since the last release, bumps `2.3.1 → 2.3.2`, generates the changelog section, tags `v2.3.2`, publishes to npm, and creates a GitHub Release — all without a human. Downside they later hit: a marketing-worthy feature shipped with the bland auto-generated note "feat: add sharing." They added a `release-please`-style review step so a human could rewrite the headline before publish.

**A monorepo with changesets.** A 40-package repo. Every PR that changes published behavior must include a changeset file (CI fails otherwise). At release, `changeset version` bumps only the affected packages and writes each one's `CHANGELOG.md`. A package with no changesets since its last release simply isn't re-released — solving the "everything bumps when one thing changes" monorepo problem.

---

## Mental Models

- **Structure once, render forever.** The work is making *one* source structured (commits, labels, or intent files). Rendering changelogs and computing versions is then free.
- **Automate the record, curate the story.** Two artifacts, two strategies.
- **The tool's "noise" filter must match yours.** Every dropped `chore` is a curation decision the tool made for you — audit it.
- **The intent file / PR title is the real changelog entry.** Write it for a reader, not as a note to yourself.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---------|-------------|-----|
| Shipping the raw generated changelog as "release notes" | Users get noise, not highlights | Curate a separate notes artifact |
| Adopting conventional commits without CI enforcement | Drift; some commits unparseable | Add commitlint / PR-title lint |
| Hiding security `chore:` bumps from the changelog | Operators miss patches | Tag security-relevant deps explicitly |
| Hand-editing `CHANGELOG.md` in every PR | Constant merge conflicts | Generate, or use per-PR intent files |
| One global changelog in a monorepo | Users of package A see package B's churn | Per-package changelogs (changesets) |
| Squash-merging with junk titles | Junk becomes the unit of record | Lint PR/squash titles |

---

## Test Yourself

1. Write a conventional commit for a breaking API change, using both signalling methods.
2. Given two `fix:` and one `feat:` commit, what version bump results and why?
3. When would you choose changesets over semantic-release?
4. Why is "every commit becomes an entry" a failure mode, not a success?
5. What review step does release-please add that semantic-release lacks?
6. How do PR-label-based notes differ in input from commit-based ones?
7. A `chore: bump openssl to fix CVE-2026-9999` is dropped from the changelog by a type-only rule. What's the fix?

---

## Cheat Sheet

```
Conventional Commit:  <type>(scope)!: description  + BREAKING CHANGE: footer
  feat → MINOR/Added   fix → PATCH/Fixed   !|BREAKING → MAJOR/Changed
  docs/chore/ci/test → no bump, usually omitted

Tools:
  git-cliff        generator only, you keep control       (TOML config)
  semantic-release fully automated in CI, no human        (single pkg)
  release-please   generated + reviewable "release PR"
  changesets       per-PR intent files, monorepo per-pkg changelogs

Inputs: commit messages | PR labels | squash titles | intent files
Strategy: AUTOMATE the changelog (record) · CURATE the release notes (story)
```

---

## Summary

- **Conventional Commits** make messages machine-readable; type maps to both a **SemVer bump** and a **changelog section**.
- The major tools — **git-cliff, semantic-release, release-please, changesets** — differ in what they read and how much they automate.
- Automation can also draw from **PR labels** or **squash titles**; the only requirement is *some* enforced structured input.
- The core tension: **automation gives completeness and consistency; curation gives a readable story.** Mature teams automate the changelog and curate the release notes.
- **Release notes are not a styled changelog** — they lead with impact, group by user value, and surface required actions.

---

## Further Reading

- Conventional Commits specification (conventionalcommits.org).
- git-cliff, semantic-release, release-please, Changesets — official docs.
- GitHub "Automatically generated release notes" — the label-based native option.

---

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/) — the bump logic behind the automation.
- [Release Automation](../08-release-automation/) — the full release pipeline these tools plug into.
- [Release Branching & Trains](../03-release-branching-and-trains/) — where the version is cut.
- [Build Systems](../../build-systems/) — running generators in CI.
