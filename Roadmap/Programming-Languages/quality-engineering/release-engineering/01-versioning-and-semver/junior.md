# Versioning & SemVer — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Versioning & SemVer
> *Your first contact with version numbers: reading them, bumping them, and pinning them in a dependency file.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Anatomy of a Version Number](#core-concept-1--anatomy-of-a-version-number)
5. [Core Concept 2 — What Each Bump Means](#core-concept-2--what-each-bump-means)
6. [Core Concept 3 — Pre-release and Build Metadata](#core-concept-3--pre-release-and-build-metadata)
7. [Core Concept 4 — Where the Version Lives](#core-concept-4--where-the-version-lives)
8. [Core Concept 5 — Pinning a Dependency](#core-concept-5--pinning-a-dependency)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

## Introduction

> Focus: **reading a version string correctly and choosing the right number to bump when you change code.**

Every library, app, and container image you depend on carries a version string like `2.4.1`. That string is a promise from the author to you: it tells you whether upgrading is safe, risky, or somewhere in between. Most of the rules you will meet come from **Semantic Versioning** (SemVer), a small specification that turns a three-number string into a contract.

By the end of this page you will be able to read a version like `1.4.0-rc.2+build.55`, decide whether a code change deserves a patch, minor, or major bump, and pin a dependency in `package.json`, `go.mod`, `requirements.txt`, or `Cargo.toml` without breaking your build.

## Prerequisites

**Required**
- You can run shell commands (`npm`, `pip`, `go`, `cargo`) in a terminal.
- You have edited a dependency manifest at least once (e.g. `package.json`).
- Basic Git: you know what a tag is, even if you have not created one.

**Helpful**
- Having broken a build by upgrading a dependency (the fastest teacher).
- A sense of what an "API" is — the functions, flags, and outputs others rely on.

## Glossary

| Term | Plain-English meaning |
| --- | --- |
| SemVer | Semantic Versioning — the `MAJOR.MINOR.PATCH` rule set most ecosystems follow. |
| Release | A specific, published version of your software. |
| Bump | Increasing a version number by one component. |
| Breaking change | A change that forces callers to edit their code to keep working. |
| Pre-release | An early, not-yet-final version, e.g. `-alpha.1`, `-rc.2`. |
| Build metadata | Extra info after `+` that does not affect which version is "newer". |
| Pin | Locking a dependency to an exact version. |
| Constraint / range | A rule like `^1.2.0` saying which versions are acceptable. |
| Tag | A Git label on a commit, usually named `v1.2.3`. |

## Core Concept 1 — Anatomy of a Version Number

A SemVer version has three required numbers separated by dots:

```
   2  .  4  .  1
   │     │     │
   │     │     └── PATCH  → bug fixes only
   │     └──────── MINOR  → new features, backward-compatible
   └────────────── MAJOR  → breaking changes
```

Read it left to right, most-significant first. `2.4.1` is newer than `2.4.0`, which is newer than `2.3.9`, which is newer than `1.99.99`. A bigger MAJOR always wins, no matter how big the other numbers are: `2.0.0` beats `1.50.7`.

The numbers do **not** behave like decimals. `1.10.0` is **newer** than `1.9.0`, because `10` is greater than `9`. Each component is its own integer, not a digit after a decimal point.

## Core Concept 2 — What Each Bump Means

The whole point of SemVer is that the *number you bump* tells your users what kind of change shipped.

| You changed... | Bump | Example |
| --- | --- | --- |
| Fixed a bug, no API change | PATCH | `1.4.2 → 1.4.3` |
| Added a feature, old code still works | MINOR | `1.4.3 → 1.5.0` |
| Removed/renamed something, old code breaks | MAJOR | `1.5.0 → 2.0.0` |

Two rules trip up beginners:

- **When you bump MINOR, reset PATCH to 0.** `1.4.3` + a feature → `1.5.0`, not `1.5.3`.
- **When you bump MAJOR, reset MINOR and PATCH to 0.** `1.5.0` + a break → `2.0.0`.

Concrete example. You maintain a small Go library:

```go
// v1.2.0
func Greet(name string) string { return "Hi " + name }

// Added an optional second function — old callers unaffected → MINOR → v1.3.0
func GreetFormal(name string) string { return "Good day, " + name }

// Renamed Greet to Hello — every caller must edit → MAJOR → v2.0.0
func Hello(name string) string { return "Hi " + name }
```

## Core Concept 3 — Pre-release and Build Metadata

Before a final release, you often publish test versions. SemVer supports this with a **pre-release** suffix after a hyphen:

```
1.0.0-alpha          earliest, expect bugs
1.0.0-alpha.1        a numbered alpha
1.0.0-beta.2         feature-complete, still testing
1.0.0-rc.1           release candidate — final unless a bug appears
1.0.0                the real thing
```

The key precedence rule: **a pre-release is always *older* than the same version without a suffix.** So `1.0.0-rc.1` < `1.0.0`. This is the opposite of intuition for some people — `1.0.0` is the *finished* product, so it sorts last.

**Build metadata** comes after a `+` and is ignored when comparing versions:

```
1.0.0+20240601           a build date
1.0.0+sha.5114f85         the commit it was built from
```

`1.0.0+sha.aaa` and `1.0.0+sha.bbb` are considered **the same version** for ordering — the `+` part is informational only.

## Core Concept 4 — Where the Version Lives

The version string is usually stored in one place per project and read from there everywhere else:

```jsonc
// package.json (Node)
{ "name": "my-app", "version": "1.4.1" }
```

```toml
# Cargo.toml (Rust)
[package]
name = "my-app"
version = "1.4.1"
```

```python
# pyproject.toml (Python)
[project]
name = "my-app"
version = "1.4.1"
```

For many tools you also create a **Git tag** so the exact source for a release is recoverable:

```bash
git tag v1.4.1
git push origin v1.4.1
```

Go is special: it has no version field in a file. The version *is* the Git tag, and the module path encodes the major version (more on that in higher tiers).

## Core Concept 5 — Pinning a Dependency

When you depend on someone else's package, you state which versions you accept. The default operators differ per ecosystem:

```bash
# npm — caret means "compatible with 1.4.1": allows 1.x.x but not 2.0.0
npm install lodash@^1.4.1

# tilde means "patch updates only": allows 1.4.x but not 1.5.0
npm install lodash@~1.4.1

# exact pin — no updates at all
npm install lodash@1.4.1
```

```python
# requirements.txt (pip / PEP 440)
requests==2.31.0     # exact
requests~=2.31.0     # >=2.31.0, <2.32.0 (compatible release)
requests>=2.31.0     # 2.31.0 or anything newer
```

```toml
# Cargo.toml — bare "1.4.1" means caret by default: ^1.4.1
serde = "1.4.1"
```

For applications, prefer a **lockfile** (`package-lock.json`, `Cargo.lock`, `poetry.lock`, `go.sum`) committed to Git. The lockfile records the *exact* versions you actually installed, so teammates and CI build the same thing you did.

## Real-World Examples

- **A safe upgrade.** Your app uses `express@^4.18.0`. A new `4.18.2` ships with a bug fix. `npm update` picks it up; nothing in your code changes. That is a PATCH working as designed.
- **A scary upgrade.** `react@17` → `react@18` is a MAJOR bump. The render API changed; you must update your `ReactDOM.render` calls. SemVer warned you with the leading `18`.
- **A pre-release in the wild.** `npm install next@canary` installs versions like `15.0.0-canary.42`, deliberately not picked up by `^15.0.0` constraints, so only people who opt in get them.

## Mental Models

- **The version is a label on a sealed box.** Once published, the contents never change. To change anything, you ship a new box with a new label.
- **MAJOR is a warning siren.** When the first number changes, assume "read the migration notes before upgrading."
- **The caret `^` trusts MINOR and PATCH but not MAJOR.** It says "give me new features and fixes, but never a breaking change."

## Common Mistakes

- **Treating versions as decimals.** Thinking `1.9.0` > `1.10.0`. Wrong — `10 > 9`.
- **Bumping PATCH for a new feature.** Users who pinned `~1.4.0` will never receive it, and you have lied about what changed.
- **Forgetting to reset lower components.** `1.4.3` + feature should be `1.5.0`, not `1.5.3`.
- **Not committing the lockfile.** "Works on my machine" bugs come straight from this.
- **Editing a published version in place.** Republishing `1.4.1` with different contents breaks everyone's cache and trust. Always ship `1.4.2`.

## Test Yourself

1. Order these from oldest to newest: `1.0.0`, `1.0.0-rc.1`, `1.0.0-alpha`, `1.0.1`.
2. You fixed a typo in an error message that some users match on in their tests. PATCH, MINOR, or MAJOR?
3. What does `^2.3.0` allow that `~2.3.0` does not?

<details>
<summary>Answers</summary>

1. `1.0.0-alpha` < `1.0.0-rc.1` < `1.0.0` < `1.0.1`. Pre-releases sort before the final release; final sorts before the next patch.
2. Technically a PATCH (bug fix), but if users depend on the exact text it can break them — a preview of why SemVer is a *social* contract, covered in the senior tier. The safe default is still PATCH, with a note in the changelog.
3. `^2.3.0` allows `2.4.0`, `2.9.1`, etc. (MINOR updates). `~2.3.0` only allows `2.3.x` (PATCH updates).

</details>

## Cheat Sheet

```
MAJOR.MINOR.PATCH
  │     │     └ bug fix, no API change
  │     └────── new feature, backward-compatible
  └──────────── breaking change

PRE-RELEASE:  1.0.0-alpha.1  <  1.0.0-beta.1  <  1.0.0-rc.1  <  1.0.0
BUILD META:   1.0.0+sha.abc  ==  1.0.0+sha.def   (ignored in ordering)

npm/cargo  ^1.2.3  → >=1.2.3 <2.0.0   (minor + patch)
npm        ~1.2.3  → >=1.2.3 <1.3.0   (patch only)
pip        ~=1.2.3 → >=1.2.3 <1.3.0
exact pin  1.2.3   → only 1.2.3
```

## Summary

- A SemVer version is `MAJOR.MINOR.PATCH`; each part is its own integer.
- Bump PATCH for fixes, MINOR for backward-compatible features, MAJOR for breaking changes — and reset the lower parts to zero.
- Pre-releases (`-rc.1`) sort *before* the final release; build metadata (`+sha`) is ignored in ordering.
- Store the version in one place and tag releases in Git.
- Use `^`/`~`/`==` to control which updates you accept, and commit your lockfile.

## Further Reading

- The Semantic Versioning spec (semver.org) — short and worth reading end to end.
- npm `semver` calculator (semver.npmjs.com) — paste a range, see what it allows.

## Related Topics

- [Changelogs & Release Notes](../02-changelogs-and-release-notes/) — how to *describe* what changed in each bump.
- [Registries & Distribution](../05-registries-and-distribution/) — where published versions live.
- [Build Systems](../../build-systems/) — where the version gets embedded into artifacts.
