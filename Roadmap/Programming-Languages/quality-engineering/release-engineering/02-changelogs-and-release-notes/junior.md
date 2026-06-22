# Changelogs & Release Notes — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Changelogs & Release Notes

> *Every release ships two things: the code, and the story of what changed. The second one is not optional.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Three Artifacts, Three Audiences](#core-concept-1----three-artifacts-three-audiences)
5. [Core Concept 2 — The Keep a Changelog Format](#core-concept-2----the-keep-a-changelog-format)
6. [Core Concept 3 — The Six Change Groups](#core-concept-3----the-six-change-groups)
7. [Core Concept 4 — Writing a Good Entry](#core-concept-4----writing-a-good-entry)
8. [Core Concept 5 — Linking to Issues, PRs, and Commits](#core-concept-5----linking-to-issues-prs-and-commits)
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

> Focus: **what a changelog is, what shape it takes, and how to add a correct entry without breaking the format.**

A changelog is a file — almost always `CHANGELOG.md` at the root of the repository — that records what changed in each release, in human language, newest first. It is not the git log. The git log is a transcript of *how* the code got built (hundreds of commits like `fix typo`, `wip`, `address review`). The changelog is a *curated summary* of what a reader actually needs to know.

The single most important idea at this level: **write the changelog for a person, not for a machine, and write it as you make the change, not six months later.** By the time you try to reconstruct a changelog from memory, the details are gone.

This file teaches you the standard format, the categories changes fall into, and how to write one clean entry. The harder questions — should this be automated, who signs off, is the changelog a contract — come in the higher tiers.

---

## Prerequisites

- Basic Git: commits, branches, pull/merge requests, and `git log`.
- A rough understanding of versioning (e.g. `1.4.2`). See [Versioning & SemVer](../01-versioning-and-semver/).
- Comfort editing Markdown.
- Knowing the difference between a *user* of your software and a *developer* who reads your code.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Changelog** | A file listing notable changes per version, for developers/integrators. |
| **Release notes** | A user-facing summary of a release: highlights, impact, upgrade advice. |
| **Migration guide** | Step-by-step instructions for upgrading across a breaking change. |
| **Unreleased** | The section holding changes merged but not yet shipped in a tagged version. |
| **Entry** | A single bullet point describing one change. |
| **SemVer** | Semantic Versioning: `MAJOR.MINOR.PATCH`. |
| **Diff link** | A URL comparing two versions (e.g. GitHub `compare/v1.0...v1.1`). |
| **Keep a Changelog** | The de-facto standard changelog format (keepachangelog.com). |

---

## Core Concept 1 — Three Artifacts, Three Audiences

People say "changelog" loosely, but there are really **three different documents**, written for three different readers, with three different jobs. Conflating them is the most common beginner mistake.

| Artifact | Audience | Answers the question | Tone |
|----------|----------|---------------------|------|
| **CHANGELOG** | Developers, library integrators | "What exactly changed in this version?" | Terse, complete, technical |
| **Release notes** | End users, customers | "Why should I care about this release?" | Highlights, benefit-focused |
| **Migration guide** | Operators upgrading across a breaking change | "How do I move from old to new safely?" | Step-by-step, prescriptive |

A concrete example. Suppose you renamed a configuration key from `timeout` to `request_timeout_ms`.

- **CHANGELOG** entry: `Renamed config key timeout to request_timeout_ms (#812).`
- **Release notes** line: `Timeouts are now specified in milliseconds for clarity.`
- **Migration guide** step: `1. In your config file, rename timeout: 30 to request_timeout_ms: 30000. 2. Restart the service.`

Same change, three audiences. The CHANGELOG reader wants completeness. The release-notes reader wants the headline. The migration reader wants a recipe they can follow without thinking.

> At small scale these may live in the same file or even the same release post. That is fine — but you should still know *which sentence is doing which job*. Conflating them fails when an entry like "refactored the timeout subsystem" is useless to a user and dangerous to someone upgrading.

---

## Core Concept 2 — The Keep a Changelog Format

You almost never need to invent a changelog format. The community standard is **Keep a Changelog**. It looks like this:

```markdown
# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Dark mode toggle in the settings page (#341).

## [1.4.0] - 2026-05-12

### Added
- CSV export for the reports view (#318).

### Fixed
- Login form no longer loses focus on validation error (#327).

## [1.3.1] - 2026-04-28

### Security
- Patched XSS in the comment renderer (CVE-2026-12345).
```

The rules that matter at this level:

1. **Newest first.** Readers care about the latest release; they scroll to find older ones.
2. **An `## [Unreleased]` section at the top.** This is where you add your entry today. When a release is cut, `Unreleased` gets renamed to the new version with a date.
3. **Version headers are `## [x.y.z] - YYYY-MM-DD`.** Use ISO dates (`2026-05-12`), not `May 12` — they sort and they are unambiguous worldwide.
4. **Changes are grouped under `###` headings** (Added, Changed, etc. — next concept).

When you finish a feature and open a PR, your job is usually one line: add a bullet under the right group in `## [Unreleased]`.

---

## Core Concept 3 — The Six Change Groups

Keep a Changelog defines exactly six categories. Memorize them; they cover everything.

| Group | Use for |
|-------|---------|
| **Added** | New features. |
| **Changed** | Changes to existing behavior. |
| **Deprecated** | Features still working but on their way out — warn now. |
| **Removed** | Features that are gone. |
| **Fixed** | Bug fixes. |
| **Security** | Vulnerability fixes. Always call these out separately. |

Why these six and not free-form headings? Because a reader scanning a release wants to answer specific questions fast: *Did anything break (Removed/Changed)? Do I need to patch urgently (Security)? Is something I rely on going away (Deprecated)?* Fixed-vocabulary groups make that scan instant.

```markdown
## [2.0.0] - 2026-06-01

### Added
- Multi-factor authentication via TOTP (#401).

### Changed
- API responses now use camelCase keys instead of snake_case (#410).

### Deprecated
- The /v1/legacy-search endpoint; use /v2/search instead (#415).

### Removed
- Dropped support for Node 16 (#420).

### Security
- Upgraded the JSON parser to fix a prototype-pollution issue (CVE-2026-22000).
```

> Notice the version is `2.0.0` — a major bump. The `Changed`, `Removed`, and camelCase break are *breaking changes*, which forces the major version. Versioning and the changelog move together.

---

## Core Concept 4 — Writing a Good Entry

A changelog entry is one sentence. Make it count.

**Use the imperative or simple-present, describing the change from the reader's view.** Most projects write entries describing *what the release does for you*:

```markdown
✅ Added CSV export to the reports view.
✅ Fixed crash when opening an empty project.
```

Some projects prefer past tense ("Added", "Fixed" read as past participles either way — both are common). What matters is **consistency within a file** and that the subject is the *change*, not your internal process.

**Write user-facing language, not internal jargon:**

```markdown
❌ Refactored the FooManager singleton to use the new DI container.
✅ Reduced memory usage on the dashboard by ~30%.

❌ Bumped lodash.
✅ Updated dependencies to patch a known security issue (CVE-2026-12345).

❌ Fixed bug.
✅ Fixed timestamps showing in UTC instead of the user's local timezone.
```

The test for every entry: **would a reader who has never seen your codebase understand what changed and whether it affects them?** If the entry only makes sense to someone who knows your class names, rewrite it.

---

## Core Concept 5 — Linking to Issues, PRs, and Commits

A changelog entry should let a curious reader dig deeper. Link to the source of truth.

```markdown
### Fixed
- Login form no longer loses focus on validation error ([#327](https://github.com/acme/app/issues/327)).
```

Conventions:

- **Issue or PR number** in parentheses at the end: `(#327)`. On GitHub/GitLab, `#327` autolinks inside the repo.
- **Security entries link to the CVE or advisory:** `(CVE-2026-12345)` or a `GHSA-xxxx` GitHub Security Advisory.
- **Diff links per version.** Many changelogs put compare links at the bottom so a reader can see the full diff between two releases:

```markdown
[Unreleased]: https://github.com/acme/app/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/acme/app/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/acme/app/compare/v1.3.0...v1.3.1
```

These links make the version headers (`## [1.4.0]`) clickable and turn the changelog into a navigable index of your release history.

---

## Real-World Examples

**A well-kept open-source changelog (abbreviated):**

```markdown
## [Unreleased]

### Added
- `--dry-run` flag to preview changes without writing (#1203).

### Fixed
- Config files with BOM markers are now parsed correctly (#1198).

## [3.2.0] - 2026-06-15

### Added
- Support for YAML config in addition to JSON (#1180).

### Changed
- Default log level is now `info` instead of `debug` (#1175).

### Deprecated
- `--verbose`; use `--log-level=debug` instead (#1176).
```

**A user-facing release note for the same release (different document):**

> **v3.2.0 — YAML config and quieter logs**
> You can now write your configuration in YAML. We also switched the default log level to `info`, so your logs will be much cleaner out of the box. The old `--verbose` flag still works for now but will be removed in v4.

Same release. The changelog is exhaustive and links every PR. The release note picks two highlights and speaks to the user's benefit.

---

## Mental Models

- **The changelog is a diary you keep daily, not a memoir you write at the end.** Add the entry when you make the change.
- **Six bins.** Every change drops into Added / Changed / Deprecated / Removed / Fixed / Security. If you can't pick a bin, you don't yet understand the change.
- **Unreleased is the inbox.** Entries land there during development; cutting a release just relabels the inbox with a version and date.
- **Translate, don't transcribe.** A commit is for you; a changelog entry is for the reader. Translate from "how I built it" to "what changed for you."

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---------|-------------|-----|
| Pasting raw `git log` into the changelog | Full of `wip`, `merge`, internal noise | Curate one entry per notable change |
| Writing entries at release time | Details forgotten; rushed | Add to `Unreleased` in the same PR |
| Internal jargon (`FooManager`, `bumped deps`) | Reader can't tell if it affects them | Describe user-visible effect |
| Forgetting a date or using `May 12` | Ambiguous, unsortable | Use `YYYY-MM-DD` |
| Hiding security fixes inside `Fixed` | Operators miss urgent patches | Always use a `Security` group + CVE link |
| Inconsistent tense within the file | Looks sloppy | Pick one tense, keep it |

---

## Test Yourself

1. Name the three artifacts and the audience each one serves.
2. What are the six Keep a Changelog groups?
3. Where do you add an entry while a feature is still in development?
4. Rewrite this entry to be user-facing: `Refactored AuthService to async.`
5. Why use `2026-06-15` instead of `June 15, 2026` in a version header?
6. A teammate puts a fixed XSS bug under `Fixed`. What would you change and why?
7. What does a diff/compare link at the bottom of a changelog give the reader?

---

## Cheat Sheet

```markdown
## [Unreleased]
### Added       — new features
### Changed     — changes to existing behavior
### Deprecated  — soon-to-be-removed
### Removed     — gone now
### Fixed       — bug fixes
### Security    — vulnerability fixes (+ CVE link)

## [x.y.z] - YYYY-MM-DD   ← newest first, ISO date

Entry rules:
- One sentence, user-facing, consistent tense
- Link the issue/PR: (#327)
- Security entries link the CVE/advisory
- Compare links at the bottom make versions clickable
```

---

## Summary

- A changelog is a **curated, human-readable** record of changes — not a git log dump.
- There are **three artifacts**: CHANGELOG (developers, complete), release notes (users, highlights), migration guide (upgraders, steps). Know which is which.
- Use the **Keep a Changelog** format: newest first, an `Unreleased` section, `## [x.y.z] - YYYY-MM-DD` headers, and the six groups.
- Write each entry as **one user-facing sentence** with a link to the issue/PR, and call out security fixes separately.
- Add entries **as you work**, in the same PR — not from memory at release time.

---

## Further Reading

- Keep a Changelog (keepachangelog.com) — the format this file teaches.
- Semantic Versioning (semver.org) — how versions and changelogs move together.
- The code-craft `documentation` material — writing for an audience.

---

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/) — how change type drives the version bump.
- [Release Automation](../08-release-automation/) — generating changelogs automatically.
- [Release Branching & Trains](../03-release-branching-and-trains/) — when a release is "cut."
- [Documentation Quality](../../documentation-quality/) — measuring docs that include release notes.
