# Release Automation — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Release Automation

*The full pipeline shape, the conventional-commit contract that drives it, and a clear map of which tool fits which language and team.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The full pipeline, step by step](#core-concept-1--the-full-pipeline-step-by-step)
5. [Core Concept 2 — Conventional commits as a contract](#core-concept-2--conventional-commits-as-a-contract)
6. [Core Concept 3 — Enforcing the contract with commitlint](#core-concept-3--enforcing-the-contract-with-commitlint)
7. [Core Concept 4 — The release-PR model (release-please)](#core-concept-4--the-release-pr-model-release-please)
8. [Core Concept 5 — Choosing a tool](#core-concept-5--choosing-a-tool)
9. [Core Concept 6 — Idempotency and tag-driven triggers](#core-concept-6--idempotency-and-tag-driven-triggers)
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

> Focus: **the shape of a complete release pipeline, the commit contract that feeds it, and a decision framework for picking the right tool for your stack.**

At the junior tier you ran a tool and watched a release happen. Now you need to understand the pipeline well enough to reason about it: what each step does, where it can fail, why the steps are ordered the way they are, and how to enforce the discipline that makes the whole thing work. You also need to make a real decision — there are five or six mainstream tools, and choosing the wrong one for your team's shape (single package vs monorepo, npm vs Go vs Rust, fully-automatic vs reviewed releases) costs months.

This tier builds the mental model of release automation as a sequence of small, idempotent, observable jobs, and gives you the criteria to select and configure the right one.

---

## Prerequisites

- You have run at least one automated release (see [junior tier](./junior.md)).
- Comfortable reading and writing GitHub Actions / GitLab CI YAML.
- You understand SemVer's rules — see [Versioning and SemVer](../01-versioning-and-semver/).
- Familiar with how a registry receives a publish — see [Registries and Distribution](../05-registries-and-distribution/).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Release PR** | An auto-maintained pull request that accumulates pending changes; merging it cuts the release. |
| **commitlint** | A linter that rejects commits not matching the Conventional Commits format. |
| **Squash merge** | Merging a PR as a single commit; the PR title becomes the commit message. |
| **Attestation** | Signed metadata proving how/where/by-whom an artifact was built. |
| **Trusted publishing (OIDC)** | Publishing to a registry using a short-lived CI identity, no stored token. |
| **Affected detection** | Computing which packages changed so only those are released. |
| **Snapshot / dry run** | A full build that publishes nothing — used to validate the pipeline. |
| **Prerelease** | A version like `1.4.0-beta.1` published off a non-main branch. |

---

## Core Concept 1 — The full pipeline, step by step

A complete release pipeline is a chain of steps where the output of each feeds the next. Knowing what each does — and how it fails — is the core skill of this tier.

```
┌──────────────────────────────────────────────────────────────┐
│ TRIGGER:  push to main   OR   push of a tag   OR   manual run  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
1. DERIVE VERSION      read commits since last tag → compute next SemVer
        │             failure: no releasable commits → exit cleanly (not an error)
        ▼
2. GENERATE CHANGELOG  group commits by type into release notes
        │             failure: malformed commits → ugly notes
        ▼
3. TAG                 create annotated git tag vX.Y.Z, push it
        │             failure: tag already exists → STOP (idempotency guard)
        ▼
4. BUILD ARTIFACTS     compile / package for all targets
        │             failure: build error → release aborts, nothing published
        ▼
5. SIGN + ATTEST       cosign signature + SLSA provenance
        │             see ../04-artifact-signing-and-provenance/
        ▼
6. PUBLISH             upload to npm / OCI registry / package index
        │             failure mid-publish → PARTIAL RELEASE (the hard case)
        ▼
7. CREATE RELEASE      GitHub/GitLab Release with notes + assets
        │
        ▼
8. NOTIFY              Slack / email / status page update
```

Three design principles run through every step:

- **Idempotent.** Re-running the pipeline must not double-publish. The tag-exists check at step 3 and the version-exists check at step 6 are the guards.
- **Observable.** Each step emits clear logs; a failed release tells you exactly which step and why.
- **Fail-closed early.** Cheap, reversible steps (version, build) come before expensive, irreversible ones (publish). You want failures *before* anything reaches users.

The ordering is not arbitrary: you compute and build everything *before* you publish anything, so a build failure never leaves a half-released version in the wild.

---

## Core Concept 2 — Conventional commits as a contract

Conventional Commits is not a style preference — it is a **machine-readable contract** between developers and the release tool. The developer's promise: "I will describe each change's type accurately." The tool's promise: "I will compute the correct version and a complete changelog." Break the first promise and both break.

The grammar:

```
<type>[(scope)][!]: <description>

[body]

[footer(s)]   ← e.g. "BREAKING CHANGE: ...", "Refs: #123"
```

Mapping to behavior:

| Commit | Bump | Changelog section |
|--------|------|-------------------|
| `feat: ...` | MINOR | Features |
| `fix: ...` | PATCH | Bug Fixes |
| `perf: ...` | PATCH | Performance |
| `feat!: ...` or `BREAKING CHANGE:` footer | MAJOR | ⚠ BREAKING |
| `refactor:`, `chore:`, `docs:`, `test:`, `ci:`, `style:` | none | (hidden by default) |

**The discipline cost is real and worth naming.** Every developer must learn the format. PRs get nitpicked over commit types. New hires get it wrong. Some teams resent it. The payoff: versions and changelogs that are *always correct* and *never hand-maintained*, plus a commit history that reads like documentation. For most teams shipping frequently, the trade is decidedly worth it.

**Squash-merge as the source of truth.** Many teams squash-merge PRs. In that model, individual commits inside the PR don't matter — only the **squash commit title** does, and that's usually the PR title. So the contract shifts: the *PR title* must be a conventional commit. Enforce it with a PR-title linter rather than per-commit linting. This is often easier to adopt than asking everyone to write every commit perfectly.

---

## Core Concept 3 — Enforcing the contract with commitlint

A contract nobody enforces is a suggestion. [commitlint](https://commitlint.js.org/) validates commit messages against the Conventional Commits spec and rejects bad ones.

`commitlint.config.js`:

```js
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", [
      "feat", "fix", "perf", "refactor",
      "docs", "test", "ci", "chore", "build", "revert",
    ]],
    "subject-case": [2, "never", ["upper-case", "pascal-case"]],
    "header-max-length": [2, "always", 100],
  },
};
```

Run it locally via a git hook (using husky):

```bash
npx husky init
echo 'npx --no -- commitlint --edit "$1"' > .husky/commit-msg
```

And — more importantly, because local hooks can be bypassed — enforce it in CI on the PR title:

```yaml
# .github/workflows/pr-lint.yml
name: PR Title Lint
on:
  pull_request:
    types: [opened, edited, synchronize]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> Make the CI check a **required status check** (branch protection) so a non-conforming title literally cannot merge. Local hooks improve the developer experience; the CI gate is what actually guarantees the contract. See [Quality Gates](../../quality-gates/) for required-check design.

---

## Core Concept 4 — The release-PR model (release-please)

`semantic-release` releases on *every* qualifying merge. Some teams want releases to be deliberate — a human decides *when* to cut, even though *what* goes in is still automatic. That is the **release-PR model**, exemplified by Google's [release-please](https://github.com/googleapis/release-please).

How it works:

1. You merge feature PRs to `main` with conventional commits. Nothing is released yet.
2. release-please opens (and keeps updating) a **"chore: release 1.4.0"** PR that accumulates the computed version bump and the generated changelog.
3. When you're ready to ship, you **merge the release PR**. *That* merge tags, builds, and publishes.

```yaml
# .github/workflows/release-please.yml
name: release-please
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          release-type: node
      # Only build + publish AFTER the release PR is merged:
      - uses: actions/checkout@v4
        if: ${{ steps.release.outputs.release_created }}
      - run: npm ci && npm publish
        if: ${{ steps.release.outputs.release_created }}
```

The release PR is a genuinely nice artifact: a reviewable, mergeable preview of exactly what the next version and changelog will be. It gives you an approval point and an audit trail without forcing humans to compute versions. The trade-off versus semantic-release: releases are less continuous (they happen when someone merges the PR, not automatically).

---

## Core Concept 5 — Choosing a tool

There is no universal best tool. Match the tool to your language and your release cadence.

| Tool | Ecosystem | Model | Best for |
|------|-----------|-------|----------|
| **semantic-release** | JS/npm (any via plugins) | Fully automatic on merge | Single package, continuous release, no human gate |
| **release-please** | Multi-language | Release PR (human merges) | Teams wanting an approval point + audit trail |
| **changesets** | JS monorepo | Human-authored intent files | Monorepos, multi-package, deliberate version intent |
| **goreleaser** | Go | Tag-driven | Go binaries: cross-compile, archive, Homebrew, sign |
| **cargo-release** | Rust | Command-driven | Rust crates published to crates.io |
| **Maven Release Plugin / Gradle** | JVM | Plugin-driven | Java/Kotlin artifacts to Maven Central |
| **Raw GitHub Actions** | Any | Hand-built | Custom flows the above can't express |

**changesets** deserves a closer look because it inverts the model. Instead of inferring intent from commits, contributors *declare* it by adding a markdown "changeset" file in their PR:

```markdown
---
"@myorg/ui": minor
"@myorg/utils": patch
---

Add `<Tooltip>` component and fix focus-trap edge case in `<Modal>`.
```

This file says: bump `@myorg/ui` a minor, `@myorg/utils` a patch, with this note. At release time, `changeset version` consumes all such files, bumps each package independently, and writes per-package changelogs. The explicit intent is a feature: in a monorepo where one PR touches several packages, commit-message inference is too coarse — a human stating "this PR is a minor for X, a patch for Y" is clearer and reviewable.

> Decision shortcut: **Go → goreleaser. Rust → cargo-release. JVM → Maven/Gradle. JS single package → semantic-release. JS/any monorepo → changesets. Want a human approval gate → release-please.**

---

## Core Concept 6 — Idempotency and tag-driven triggers

The scariest release bug is the **double publish** or the **partial release**. Idempotency is the property that protects you.

**Tag-driven triggers** are the cleanest way to get idempotency. The release runs only when a tag is pushed, and the tag *is* the version. A tag can only exist once, so the release for that version can only be initiated once:

```yaml
on:
  push:
    tags: ["v*"]
```

Compare with push-to-main triggers (semantic-release), which need an *internal* guard: before publishing, the tool checks whether that version already exists on the registry and on the git tags. If it does, it exits cleanly. Both approaches achieve idempotency; tag-driven makes it structural rather than logical.

**The "release is just CI" model and its limits.** It is liberating to treat a release as just another CI job. But the model has limits that distinguish a release from a normal build:

- A normal CI job is *fully* idempotent — rerun it freely. A release publishes *side effects to the outside world* (npm, a registry, a GitHub Release) that can't always be cleanly undone.
- npm forbids republishing a version (and unpublish is heavily restricted). Container registries may allow overwriting a tag — which is its own danger.
- A failure *between* publishing to the registry and creating the GitHub Release leaves a **partial release**: the package is live but undocumented. Recovery means re-running only the remaining steps, which requires the pipeline to be resumable, not just rerunnable.

So: design every step to be idempotent, order irreversible steps last, and have a documented recovery for partial releases (covered at senior tier).

---

## Real-World Examples

**A React component library on npm.** Team uses changesets. Every PR that changes a component includes a changeset file describing the bump. The CI opens a "Version Packages" PR; merging it bumps versions, writes per-package changelogs, and publishes to npm. Contributors love that the changelog is written in plain English by whoever made the change, not auto-generated from terse commits.

**A Go microservice.** Tag-driven goreleaser. `git tag v3.2.0 && git push --tags` triggers a build of multi-arch container images, signs them with cosign, generates SBOM and provenance, pushes to the org's OCI registry via OIDC (no stored credentials), and cuts a GitHub Release. Four minutes, fully reproducible.

**A platform team's API server.** release-please. Engineers merge `feat:`/`fix:` PRs all week. A standing release PR shows the accumulating 2.5.0 changelog. On Tuesday's release window, the on-call merges the release PR; that triggers the build, sign, publish, and deploy. The approval point satisfies the change-management policy.

---

## Mental Models

- **The pipeline is a ratchet.** Each step either advances cleanly or stops; nothing half-completes silently. Irreversible steps go last.
- **Commit type is a promise to the future.** You're not describing the change for yourself — you're instructing a machine and writing tomorrow's changelog.
- **Two release philosophies.** *Continuous* (semantic-release: every merge ships) vs *gated* (release-please/changesets: a human decides when). Neither is wrong; choose by your change-management needs.
- **Intent: inferred vs declared.** Commit-driven tools *infer* version intent from messages; changesets *declares* it explicitly. Monorepos favor declaration.

---

## Common Mistakes

- **No enforcement.** Adopting Conventional Commits as a "guideline" without commitlint and a required PR-title check. It decays within weeks.
- **Wrong tool for the topology.** Using semantic-release in a monorepo and fighting it forever. Reach for changesets.
- **Overwriting tags or registry versions.** Treating a release like a rerunnable build. Some registries let you; you'll regret it (consumers cached the old bits).
- **Irreversible step too early.** Publishing before all artifacts are built, so a later build failure leaves a partial release.
- **Ignoring squash-merge reality.** Linting individual commits while squash-merging — only the PR title survives. Lint the title.
- **No dry run in CI.** Every tool supports a snapshot/no-publish mode; run it on PRs to catch config errors before they reach `main`.

---

## Test Yourself

1. Why are the build steps ordered *before* the publish step in every release pipeline?
2. What is the difference between the semantic-release model and the release-please model?
3. When does changesets beat semantic-release, and why?
4. A team squash-merges all PRs. Where must the conventional-commit format live, and what enforces it?
5. Explain two different ways a pipeline can achieve idempotency.
6. What is a "partial release" and which step boundary most commonly produces one?

---

## Cheat Sheet

```text
PIPELINE (irreversible steps LAST)
  trigger → version → changelog → tag → build → sign → PUBLISH → release → notify

TRIGGER STYLES
  push-to-main   (semantic-release)  → needs internal version-exists guard
  tag push       (goreleaser)        → structurally idempotent
  release-PR merge (release-please)  → human approval point

TOOL PICKER
  Go → goreleaser     Rust → cargo-release     JVM → Maven/Gradle
  JS single pkg → semantic-release
  JS/any monorepo → changesets
  want approval gate → release-please

CONTRACT
  commitlint + REQUIRED PR-title check = enforced conventional commits
  squash merge → PR TITLE is the source of truth

IDEMPOTENCY
  tag exists? STOP.   version on registry? SKIP.   never overwrite published versions.
```

---

## Summary

A release pipeline is an ordered chain — version, changelog, tag, build, sign, publish, release, notify — engineered to be idempotent, observable, and fail-closed, with irreversible steps placed last so failures never strand a half-released version. The pipeline's input is the Conventional Commits contract, which only works when enforced by commitlint plus a required PR-title check; under squash-merge, the PR title is the source of truth. Tool choice follows topology and philosophy: semantic-release for continuous single-package JS, changesets for declarative monorepo intent, release-please for a human-gated release-PR flow, and goreleaser/cargo-release/Maven for Go/Rust/JVM. Idempotency comes either structurally (tag-driven) or logically (version-exists guards); both must be paired with a recovery plan for partial releases. Master this and you can configure, reason about, and choose release automation for any mainstream stack.

---

## Further Reading

- [Conventional Commits specification](https://www.conventionalcommits.org/)
- [changesets documentation](https://github.com/changesets/changesets)
- [release-please](https://github.com/googleapis/release-please)
- [commitlint](https://commitlint.js.org/)
- [goreleaser configuration reference](https://goreleaser.com/customization/)

---

## Related Topics

- [Versioning and SemVer](../01-versioning-and-semver/) — the rules step 1 applies.
- [Changelogs and Release Notes](../02-changelogs-and-release-notes/) — the output of step 2.
- [Release Branching and Trains](../03-release-branching-and-trains/) — how trigger branches relate to release cadence.
- [Artifact Signing and Provenance](../04-artifact-signing-and-provenance/) — the sign + attest step.
- [Registries and Distribution](../05-registries-and-distribution/) — where the publish step lands.
- [Quality Gates](../../quality-gates/) — making the PR-title and other checks required.
