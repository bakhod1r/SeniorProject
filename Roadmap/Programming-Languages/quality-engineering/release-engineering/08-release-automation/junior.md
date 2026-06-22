# Release Automation — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Release Automation

*Get the human out of the release path: turn a merge into a published, versioned release with one command — or none at all.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why manual releases hurt](#core-concept-1--why-manual-releases-hurt)
5. [Core Concept 2 — What an automated release does](#core-concept-2--what-an-automated-release-does)
6. [Core Concept 3 — Conventional commits as the input](#core-concept-3--conventional-commits-as-the-input)
7. [Core Concept 4 — Your first semantic-release run](#core-concept-4--your-first-semantic-release-run)
8. [Core Concept 5 — Your first goreleaser run](#core-concept-5--your-first-goreleaser-run)
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

> Focus: **understanding why we automate releases and running your first automated release with one of two popular tools.**

A "release" is the moment your code stops being a branch on someone's machine and becomes a thing users can install: a version number, a tag, a changelog, a published artifact. For most of software history, a person did this by hand — bumping a version file, writing release notes, running build commands, uploading a zip, clicking "Publish." Every one of those steps is a place to make a mistake, and all of them live in one person's head.

**Release automation** is the practice of encoding that whole sequence into a pipeline so that merging code is enough to ship it. The goal is simple and a little subversive: make releasing so boring and reliable that nobody thinks about it. When releasing is boring, you do it often. When you do it often, each release is small, and small releases are safe.

This page gets you from "I release by hand" to "I ran my first automated release" with two of the most beginner-friendly tools: `semantic-release` for JavaScript/npm projects and `goreleaser` for Go projects.

---

## Prerequisites

- You can use `git` for everyday work: commit, push, branch, tag.
- You know what a CI service is (GitHub Actions, GitLab CI) — a robot that runs your commands on a server when you push.
- You understand version numbers loosely (`1.2.3`). If not, read [Versioning and SemVer](../01-versioning-and-semver/) first — it is the foundation everything here builds on.
- You have a project that publishes *something*: an npm package, a binary, a container image.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Release** | A published, versioned snapshot of your software users can install. |
| **Artifact** | The built thing you ship: a `.tgz`, a binary, a Docker image, a `.jar`. |
| **Tag** | A git label like `v1.4.0` marking the exact commit a release was built from. |
| **Changelog** | A human-readable list of what changed between versions. |
| **Conventional Commit** | A commit message in a fixed format (`feat:`, `fix:`) a tool can parse. |
| **SemVer** | Semantic Versioning: `MAJOR.MINOR.PATCH` with rules for when to bump each. |
| **Registry** | Where artifacts live for download: npm, Docker Hub, GitHub Releases. |
| **Pipeline** | The ordered sequence of automated steps from merge to published release. |
| **Idempotent** | Running it twice has the same effect as running it once (no double-publish). |

---

## Core Concept 1 — Why manual releases hurt

Picture the manual release. It is Friday. You open the project, edit `package.json` to bump `1.3.2` → `1.3.3`, paste a hand-written changelog, run `npm publish`, then tag git and push. It works — until it doesn't:

- **It is slow.** Twenty minutes of careful clicking that you dread, so you batch up changes and release rarely. Rare releases are huge, and huge releases are scary.
- **It is error-prone.** You forgot to bump the version. You published before tagging. You wrote the changelog from memory and missed three fixes. You ran the build on your laptop with a different Node version than CI.
- **It is irreproducible.** "How did we build 1.3.2?" Nobody knows. The exact commands lived in your terminal history, now gone.
- **It gates on one person.** The one engineer who knows the ritual is on vacation. Now nobody can ship a hotfix.

Automation fixes all four at once. The steps are written down (as code), they run the same way every time (on CI, not a laptop), anyone can trigger them, and the machine never forgets to tag.

> The deepest benefit is psychological: **automation makes releasing frequent because it makes releasing boring.** Frequent small releases are the single biggest lever for safe delivery.

---

## Core Concept 2 — What an automated release does

Every automated release tool, regardless of language, performs roughly the same sequence. Learn this shape once and you understand all of them:

```
merge to main
     │
     ▼
1. derive the next version   ← from commit messages or intent files
2. generate the changelog    ← grouped by change type
3. create a git tag          ← e.g. v1.4.0
4. build the artifacts        ← binaries, packages, images
5. sign + attest             ← prove who built it (advanced)
6. publish to a registry      ← npm, Docker Hub, GitHub Releases
7. create a GitHub release    ← notes + downloadable assets
8. notify                     ← Slack, email
```

Two properties make this trustworthy:

- **Each step is observable.** When step 6 fails, you see *which* step and why in the CI logs.
- **The pipeline is idempotent.** Re-running a release that already published version `1.4.0` must not publish it again. Tools enforce this by checking "does this version already exist?" before publishing.

As a junior, you do not need to build this pipeline from scratch. You pick a tool that does it for you. Your job is to feed it good input (clean commit messages) and wire it into CI.

---

## Core Concept 3 — Conventional commits as the input

How does a tool know whether your change is a `1.3.3` (a bugfix) or a `1.4.0` (a new feature) or a `2.0.0` (a breaking change)? It reads your **commit messages** — *if* you write them in a structured format called **Conventional Commits**.

The format is a one-line prefix:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer]
```

The common types and what they do to the version:

| Commit prefix | Meaning | Version bump |
|---------------|---------|--------------|
| `fix:` | A bug fix | PATCH (`1.3.2` → `1.3.3`) |
| `feat:` | A new feature | MINOR (`1.3.2` → `1.4.0`) |
| `feat!:` or `BREAKING CHANGE:` footer | Breaking change | MAJOR (`1.3.2` → `2.0.0`) |
| `docs:`, `chore:`, `test:`, `refactor:` | No user-facing change | No release |

Examples:

```
feat(auth): add password reset flow
fix(api): handle null user in /profile endpoint
docs: fix typo in README
feat(api)!: rename `userId` field to `accountId`
```

That last one — the `!` — signals a breaking change and forces a MAJOR bump. The tool reads all commits since the last release, finds the *highest* bump implied, and that becomes your new version. The same commits become your changelog, grouped by type.

> This is the input contract. The discipline cost is real: everyone on the team has to write commits this way. The payoff is that the version and changelog become free, automatic, and never wrong. See [Changelogs and Release Notes](../02-changelogs-and-release-notes/) for how the changelog gets shaped.

---

## Core Concept 4 — Your first semantic-release run

[`semantic-release`](https://semantic-release.gitbook.io/) is the canonical fully-automated tool for the JavaScript ecosystem. You write conventional commits; it does *everything else* with zero version numbers ever typed by a human.

**Step 1 — install:**

```bash
npm install --save-dev semantic-release
```

**Step 2 — configure.** Create `release.config.js` in your repo root:

```js
// release.config.js
module.exports = {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",    // reads commits → decides bump
    "@semantic-release/release-notes-generator", // builds the changelog
    "@semantic-release/changelog",           // writes CHANGELOG.md
    "@semantic-release/npm",                 // bumps package.json + npm publish
    "@semantic-release/github",              // creates the GitHub release
  ],
};
```

**Step 3 — run it in CI.** Add a GitHub Actions workflow at `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    branches: [main]

permissions:
  contents: write       # to push tags + create releases
  id-token: write       # for npm trusted publishing (no token needed)

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # semantic-release needs full history
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Now merge a PR whose commit is `feat: add CSV export`. On push to `main`, semantic-release runs, sees the `feat:`, bumps `1.3.0` → `1.4.0`, writes the changelog, tags `v1.4.0`, publishes to npm, and creates the GitHub release. You typed no version number anywhere. That is the whole point.

> Note `fetch-depth: 0`: a forgotten setting that causes the single most common first-time failure. The tool needs the *entire* git history to find the last release and read all commits since.

---

## Core Concept 5 — Your first goreleaser run

For Go projects, [`goreleaser`](https://goreleaser.com/) is the standard. It is tag-driven: *you* create the tag (often the only manual step you keep at first), and goreleaser cross-compiles, archives, signs, and publishes.

**Step 1 — install and init:**

```bash
go install github.com/goreleaser/goreleaser/v2@latest
goreleaser init      # creates a starter .goreleaser.yaml
```

**Step 2 — a minimal `.goreleaser.yaml`:**

```yaml
# .goreleaser.yaml
version: 2

builds:
  - main: ./cmd/mytool
    binary: mytool
    goos: [linux, darwin, windows]   # cross-compile for 3 OSes
    goarch: [amd64, arm64]

archives:
  - formats: [tar.gz]
    name_template: "{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"

release:
  github:
    owner: myorg
    name: mytool
```

**Step 3 — trigger on a tag in CI** at `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ["v*"]        # runs only when you push a tag like v1.4.0

permissions:
  contents: write

jobs:
  goreleaser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: stable
      - uses: goreleaser/goreleaser-action@v6
        with:
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Now to release, you run two commands locally:

```bash
git tag v1.4.0
git push origin v1.4.0
```

CI sees the tag, goreleaser builds six binaries (3 OSes × 2 architectures), archives them, generates release notes from your commits, and uploads everything to a GitHub Release. Before pushing a real tag, run `goreleaser release --snapshot --clean` locally to do a dry run — it builds everything but publishes nothing.

> The difference in trigger style matters. semantic-release decides the version *for* you from commits (push-to-main triggered). goreleaser expects *you* to decide the version by tagging. Both are valid; you'll learn when each fits at the middle tier.

---

## Real-World Examples

**A solo npm library.** You maintain a small utility package. You set up semantic-release once. From then on, every merged PR with a `fix:` or `feat:` automatically ships a new version to npm with a clean changelog. You never run `npm publish` again, never touch `package.json`'s version, never forget to tag.

**A CLI tool written in Go.** Your team ships a developer CLI. With goreleaser, a single `git tag v2.1.0 && git push --tags` produces binaries for macOS, Linux, and Windows on both Intel and ARM, plus a Homebrew formula so users can `brew install yourtool`. The release that used to take an afternoon now takes four minutes of CI.

**The vacation test.** The one person who knew the manual release is away. A critical bug needs a hotfix. Because releasing is now `merge a PR with a fix: commit`, *anyone* on the team ships the patch. The bus factor went from one to everyone.

---

## Mental Models

- **Releasing is just CI.** A release is not a special ceremony; it is another job in your pipeline, triggered by a merge or a tag, running the same commands every time.
- **Commit messages are the source code of your changelog.** Sloppy commits → sloppy releases. The discipline you pay at commit time is the changelog you get for free at release time.
- **The version number is an output, not an input.** In a fully automated flow you never *choose* the version; you describe your changes (via commit types) and the version is computed.
- **Make it boring.** A good release pipeline is one nobody talks about because it never surprises anyone.

---

## Common Mistakes

- **Shallow git checkout.** Forgetting `fetch-depth: 0` so the tool can't see history. The number-one first-run failure.
- **Inconsistent commit messages.** Half the team writes `feat:`, the other half writes "fixed stuff." The tool can't compute the right version. Add commitlint to enforce the format (covered at middle tier).
- **Bumping the version by hand anyway.** Editing `package.json`'s version while also running semantic-release — they fight. Let the tool own the version completely.
- **Publishing from your laptop "just this once."** This recreates every problem automation was meant to solve. The release should only ever happen on CI.
- **Skipping the dry run.** Pushing a real tag to "see if it works." Always `--snapshot`/dry-run first.

---

## Test Yourself

1. Name three concrete problems with releasing software by hand.
2. What commit prefix produces a MINOR version bump? A PATCH? A MAJOR?
3. In the automated pipeline shape, what comes *between* "create a tag" and "publish to a registry"?
4. Why does semantic-release need the full git history (`fetch-depth: 0`)?
5. What is the difference in how semantic-release vs goreleaser decides the version number?
6. What does "idempotent" mean for a release pipeline, and why does it matter?

---

## Cheat Sheet

```text
THE PIPELINE SHAPE
  commit → version → changelog → tag → build → sign → publish → release → notify

CONVENTIONAL COMMITS → VERSION
  fix:        → PATCH   (1.2.3 → 1.2.4)
  feat:       → MINOR   (1.2.3 → 1.3.0)
  feat!: / BREAKING CHANGE: → MAJOR (1.2.3 → 2.0.0)
  docs/chore/test/refactor → no release

SEMANTIC-RELEASE (JS, fully automatic, push-to-main)
  npm i -D semantic-release
  release.config.js + npx semantic-release in CI
  YOU NEVER TYPE A VERSION

GORELEASER (Go, tag-driven)
  goreleaser init
  goreleaser release --snapshot --clean   # dry run
  git tag v1.4.0 && git push --tags        # real release

ALWAYS
  fetch-depth: 0    run on CI, never laptop    dry-run first
```

---

## Summary

Manual releases are slow, error-prone, irreproducible, and gated behind one person. Release automation encodes the whole merge-to-published sequence as a pipeline so releasing becomes boring, reliable, and frequent. Every tool follows the same shape: derive version → changelog → tag → build → sign → publish → release → notify. The input to that machine is your commit messages, written as Conventional Commits, where `fix:`/`feat:`/`feat!:` decide the version bump. You met two beginner-friendly tools: `semantic-release` (JavaScript, fully automatic, version computed from commits) and `goreleaser` (Go, tag-driven, cross-compiles everything). The rest of your growth is learning when each tool fits and how to make the pipeline reproducible, governed, and safe at scale.

---

## Further Reading

- [Conventional Commits specification](https://www.conventionalcommits.org/)
- [semantic-release documentation](https://semantic-release.gitbook.io/)
- [goreleaser documentation](https://goreleaser.com/)
- [Semantic Versioning](https://semver.org/)

---

## Related Topics

- [Versioning and SemVer](../01-versioning-and-semver/) — the rules automation applies to compute the next version.
- [Changelogs and Release Notes](../02-changelogs-and-release-notes/) — what the automated changelog step produces.
- [Artifact Signing and Provenance](../04-artifact-signing-and-provenance/) — the sign + attest step.
- [Registries and Distribution](../05-registries-and-distribution/) — where the publish step puts your artifacts.
- [Build Systems](../../build-systems/) — the build step that produces the artifacts being released.
