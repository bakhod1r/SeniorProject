# Publishing Modules — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Pre-Publish Checklist](#pre-publish-checklist)
3. [Semver in Practice](#semver-in-practice)
4. [The Tag-Push-Discover Lifecycle](#the-tag-push-discover-lifecycle)
5. [The Module Proxy and Index](#the-module-proxy-and-index)
6. [pkg.go.dev: How Indexing Works and How to Trigger It](#pkggodev-how-indexing-works-and-how-to-trigger-it)
7. [Godoc Conventions](#godoc-conventions)
8. [Tagging Strategies](#tagging-strategies)
9. [Major Version Bump Workflow](#major-version-bump-workflow)
10. [Pre-1.0 Releases and Stability Expectations](#pre-10-releases-and-stability-expectations)
11. [Retraction and Deprecation in Practice](#retraction-and-deprecation-in-practice)
12. [Vanity Import Paths](#vanity-import-paths)
13. [Common Errors When Publishing](#common-errors-when-publishing)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the mechanical fact that publishing a Go module is "tag a commit with `vX.Y.Z` and push the tag." The middle-level question is *what happens around that tag*: how the module proxy fetches and freezes your code, how pkg.go.dev finds it, how godoc and examples turn into docs, and how to navigate the day-2 events — major version bumps, retractions, vanity import hosting.

The Go publishing model is unusual because there is no central registry that you submit to. There is no `npm publish`, no `cargo publish`, no upload form. You push a Git tag, and the rest of the ecosystem discovers your module through immutable, cryptographically verified intermediaries. That design has consequences: tags are permanent, mistakes are public, and the order of operations during a release matters.

After reading this you will:
- Run a publish-readiness checklist before tagging anything
- Use semver pre-release and build-metadata tags correctly
- Trace exactly what happens between `git push --tags` and `go get` resolving the new version
- Understand what proxy.golang.org and sum.golang.org do and why
- Trigger pkg.go.dev indexing for a brand-new module
- Bump a library to v2 without breaking existing consumers
- Retract a broken release and deprecate an obsolete major

---

## Pre-Publish Checklist

Before you tag a public version, walk through this list. Each item is cheap to fix before publication and expensive to fix after.

### 1. LICENSE file at the repo root

A module without a `LICENSE` file at the repository root is, technically, all-rights-reserved. Most consumers will refuse to depend on it. pkg.go.dev will display "License: None detected" and many CI policies will block the import.

The Go ecosystem expects an SPDX-recognised license: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0. The file must be named `LICENSE`, `LICENSE.md`, `LICENSE.txt`, or `COPYING`. pkg.go.dev parses it heuristically.

### 2. README with examples

The README is the first thing pkg.go.dev shows. It should answer three questions in the first 20 lines:

- What does this module do?
- How do I install it (`go get <path>`)?
- What does a minimal use look like?

A runnable code block under a `## Usage` heading is worth more than three paragraphs of marketing.

### 3. Godoc on every exported identifier

Every package, function, type, method, and variable that begins with an uppercase letter must have a doc comment. The convention is strict: the comment starts with the identifier's name.

```go
// Greeter formats friendly messages for a named user.
type Greeter struct { ... }

// New returns a Greeter ready to format messages.
func New() *Greeter { ... }
```

This is not bureaucracy. `golint`, `go vet -vetinfo`, and external linters will flag missing comments, and pkg.go.dev shows them prominently.

### 4. Tests present and passing

A module that ships without tests is a smell. At minimum:

- `go test ./...` returns 0 on a clean checkout.
- The `go test -race ./...` variant also passes for concurrent code.
- Coverage for the public API is not zero.

Tests double as executable documentation; example functions (covered later) are particularly valuable.

### 5. CI green on the commit you intend to tag

Tag the commit *after* CI confirms it. A surprising number of broken first releases come from "I'll tag now and let CI run on the tag." If something fails, you cannot un-tag without retraction. Always tag a commit you have already verified.

### 6. Semver tag on a stable commit

The commit you are tagging should:

- Build and test cleanly on every supported Go version.
- Have no pending merge conflicts or local-only changes.
- Match the `module` directive's major version (no `v2.0.0` on a path without `/v2`).

Run a final dry-run:

```bash
git status                    # clean
go mod tidy                   # no diff
go build ./...                # passes
go test ./...                 # passes
go vet ./...                  # passes
```

Only then do you tag.

---

## Semver in Practice

Go modules require [Semantic Versioning](https://semver.org). The toolchain enforces the structure but not the *intent*: it cannot tell you whether a change is breaking. That is your judgement.

### Format

A Go version tag is `v` + semver:

```
v1.2.3
v1.2.3-alpha
v1.2.3-rc.1
v1.2.3+exp.sha.5114f85
v1.2.3-beta.2+build.456
```

The leading `v` is mandatory. `1.2.3` without the `v` is not a valid Go version tag.

### MAJOR.MINOR.PATCH

- **MAJOR** — incompatible API change. Bumping major requires changing the import path (`/v2`, `/v3`, ...).
- **MINOR** — backwards-compatible additions. New exported functions, types, or methods. No removal, no signature change.
- **PATCH** — backwards-compatible bug fixes. No API changes at all.

Removing an exported identifier is always a major bump, even if you "know nobody uses it."

### Pre-release tags

Pre-release suffixes signal "this is not stable, do not depend on it casually":

```
v1.0.0-alpha
v1.0.0-alpha.2
v1.0.0-beta
v1.0.0-rc.1
```

Sort order: `alpha < beta < rc < (no suffix)`. So `v1.0.0-rc.1 < v1.0.0`.

`go get pkg@v1.0.0` will *not* match a pre-release tag. You must explicitly say `go get pkg@v1.0.0-rc.1`. This is a feature: it lets you publish release candidates without disrupting consumers who track the latest stable.

### Build metadata

Build metadata follows a `+`:

```
v1.2.3+exp.sha.5114f85
```

The `+...` portion is *ignored* for ordering. `v1.2.3` and `v1.2.3+anything` are the same version to the toolchain. Use it for build provenance, not for differentiation.

The Go module proxy supports both pre-release and build-metadata tags, but the latter rarely earns its keep in libraries. It is more common in private artefacts.

### Choosing a version

A pragmatic decision tree:

- API broke? → bump MAJOR (and the path).
- Added something? → bump MINOR.
- Fixed a bug, no API change? → bump PATCH.
- Cutting an unstable release for early testers? → suffix `-alpha.N` or `-rc.N`.

---

## The Tag-Push-Discover Lifecycle

What actually happens between "I tagged" and "consumers can `go get` me"?

### Step 1 — Local tag

```bash
git tag v1.0.0
```

This is purely local. No network, no announcement. The tag exists only in your `.git`.

### Step 2 — Push the tag

```bash
git push origin v1.0.0
```

Or push all tags at once:

```bash
git push origin --tags
```

The tag is now on the remote (GitHub, GitLab, Bitbucket). Crucially, *nothing else has happened yet*. The Go module proxy does not subscribe to your repository. pkg.go.dev does not poll for tags.

### Step 3 — First fetch

When *any* consumer (you, a teammate, a CI bot, anyone) runs

```bash
go get github.com/alice/lib@v1.0.0
```

their toolchain contacts `proxy.golang.org`. The proxy checks its cache for that path and version. If absent, the proxy:

1. Clones your repository (or fetches the tag).
2. Resolves the tag to a commit.
3. Computes the module zip (a deterministic archive of the module tree at that commit).
4. Hashes the zip and the `go.mod`.
5. Writes the hashes to the public sum log (`sum.golang.org`).
6. Caches the result.
7. Returns it to the consumer.

The version is now permanent on the proxy. Even if you delete the tag from GitHub, the proxy still serves it. Even if you `git push --force` and rewrite history, the proxy does not change.

### Step 4 — Discovery by pkg.go.dev

pkg.go.dev tails the sum log. When it sees a new module/version pair, it queues an indexing job. Within minutes (sometimes seconds), the new version appears in search and on the module's documentation page.

### Step 5 — Subsequent consumers

Every other `go get` request hits the proxy cache, so it is fast and offline-tolerant. The original repository is no longer in the critical path.

### What this means for you

- **You do not need to "publish" your module anywhere.** Pushing a tag and letting one consumer fetch it is the entire act.
- **The first fetch is the publication event.** If you tag and push but nobody fetches, the proxy never sees it.
- **You cannot un-publish.** Once the proxy has a version, only retraction (covered later) signals "do not use this."

---

## The Module Proxy and Index

The Go module proxy is a public, read-only mirror of every Go module that anybody has fetched. Operated by Google at `proxy.golang.org`, it is what `go get` talks to by default (unless you set `GOPROXY` to bypass it).

### URL layout

For a module at path `github.com/alice/lib`, version `v1.2.3`, the proxy exposes:

```
https://proxy.golang.org/github.com/alice/lib/@v/v1.2.3.info
https://proxy.golang.org/github.com/alice/lib/@v/v1.2.3.mod
https://proxy.golang.org/github.com/alice/lib/@v/v1.2.3.zip
```

- `.info` — JSON metadata: version, time, origin.
- `.mod` — the `go.mod` file at that version.
- `.zip` — the entire module source as a zip.

Plus listing endpoints:

```
https://proxy.golang.org/github.com/alice/lib/@v/list      # all known versions
https://proxy.golang.org/github.com/alice/lib/@latest      # latest stable
```

You can `curl` these directly for debugging.

### Immutability

Once the proxy has cached a version, it is immutable. The proxy returns the same bytes forever. This is the foundation of Go's reproducible builds: a `go.sum` entry pins the exact hash of the proxy-served zip and `go.mod`.

If you discover a bug in `v1.2.3`, you cannot replace `v1.2.3` on the proxy. You must release `v1.2.4` (the fix) and optionally retract `v1.2.3` (the marker).

### The checksum database

`sum.golang.org` is an append-only, transparent log of every (module, version, hash) tuple ever fetched. It exists so that two consumers fetching the same version cannot be served different bytes by a compromised proxy. Every `go get` cross-checks the proxy's response against the sum log.

For you as a publisher, the practical effect is: once the sum log has logged your version, any future change to that version's bytes will be detected and rejected.

---

## pkg.go.dev: How Indexing Works and How to Trigger It

`pkg.go.dev` is the documentation portal. It indexes modules from the sum log and renders godoc, examples, READMEs, and license information.

### Automatic indexing

The standard flow:

1. You push a tag.
2. Someone (often you) runs `go get module@version`.
3. The proxy fetches and logs the version.
4. pkg.go.dev's indexer pulls the new entry from the log.
5. The page is generated, usually within 5–15 minutes.

For most releases, this happens before you have time to write the announcement.

### Manually triggering indexing

If pkg.go.dev does not show your module after a reasonable wait:

1. Visit `https://pkg.go.dev/<your-module-path>`.
2. If the page says "Request" or shows a button labelled "Request to index this module," click it.
3. Re-load after a couple of minutes.

You can also force the proxy to fetch by running:

```bash
GOPROXY=https://proxy.golang.org go get <module>@<version>
```

This pulls the version through the public proxy explicitly, which logs it and consequently primes pkg.go.dev.

### When indexing fails

Common reasons a module does not appear:

- The repository is private (the proxy cannot access it).
- The tag does not start with `v`.
- The `go.mod` `module` directive does not match the import path.
- The major version is `>= 2` but the path does not include `/vN`.
- The repository disallows fetching via the proxy (rare, requires explicit `<meta>` configuration).

Each of these surfaces a specific error in the proxy's `.info` endpoint, which is your debugging starting point.

---

## Godoc Conventions

Godoc is not a separate tool — it is your `.go` files, parsed for comments. pkg.go.dev renders them. Following conventions makes your docs look professional with zero extra work.

### Package-level doc

The package comment appears at the top of any `.go` file in the package, attached to the `package` clause:

```go
// Package greet formats friendly messages for users.
//
// A Greeter is constructed with New and used as follows:
//
//     g := greet.New()
//     fmt.Println(g.Hello("Alice"))
//
package greet
```

By convention, this lives in `doc.go`:

```go
// Package greet formats friendly messages for users.
package greet
```

A dedicated `doc.go` keeps the package overview separate from implementation files and makes documentation edits easy to review.

### Function and type docs

Begin every doc comment with the identifier's name:

```go
// Hello returns a greeting addressed to name.
func Hello(name string) string { ... }

// Greeter formats messages on behalf of a configured locale.
type Greeter struct { ... }
```

This pattern lets `go doc` and IDEs render the comment alongside the symbol cleanly.

### Examples

Runnable examples are functions in `*_test.go` files named `Example`, `ExampleType`, or `ExampleType_method`:

```go
func ExampleHello() {
    fmt.Println(greet.Hello("Alice"))
    // Output: Hello, Alice
}
```

The `// Output:` comment is special: `go test` runs the function and compares stdout to the expected output. Examples therefore double as tests *and* documentation. pkg.go.dev shows them next to the symbol they document.

### Best layout

```
package/
├── doc.go              ← package overview comment
├── greet.go            ← Hello, etc.
├── greeter.go          ← Greeter type
├── greet_test.go       ← unit tests
└── example_test.go     ← runnable examples
```

---

## Tagging Strategies

The right tagging strategy depends on whether your repository hosts one module or many.

### Single module per repository

The most common case. Tags are plain semver:

```bash
git tag v1.2.3
git push origin v1.2.3
```

GitHub interprets these as Releases automatically; you can attach release notes through the GitHub UI for visibility.

### Multi-module monorepo

If a repository contains several modules (e.g. `api/` and `worker/`, each with their own `go.mod`), tags must be prefixed with the sub-directory:

```bash
git tag api/v1.2.3
git tag worker/v0.5.0
```

The proxy parses the directory prefix to find the right `go.mod`. Without it, the proxy would not know which module the tag refers to.

### Release branches for old majors

When you release v2 on `main`, what happens to v1 consumers who need bug fixes?

You keep a `release/v1` branch alive:

```bash
# Maintenance fix for v1
git checkout release/v1
git cherry-pick <fix>
git tag v1.4.5
git push origin v1.4.5
```

`main` continues with v2 development; `release/v1` continues with v1 patches. Both can release tags concurrently because their import paths differ (`alice/lib` vs `alice/lib/v2`).

### GitHub Releases

GitHub Releases are *not* the same as Git tags, but they reference one. Best practice:

1. Push the tag.
2. Open a GitHub Release referencing the tag.
3. Paste a changelog: what changed, what broke, what to upgrade.

GitHub will email watchers and surface the release on the project page.

---

## Major Version Bump Workflow

Bumping to v2 is the single most error-prone publishing step. Walk through it carefully.

### The full procedure

1. **Cut a maintenance branch for v1.**
   ```bash
   git checkout main
   git checkout -b release-v1
   git push origin release-v1
   ```
   Future v1 patches live here.

2. **On `main`, update the module path.**
   ```bash
   # Edit go.mod, change the first line:
   # module github.com/alice/lib  →  module github.com/alice/lib/v2
   ```

3. **Rewrite all internal imports.**
   Inside the module, every `import "github.com/alice/lib/..."` becomes `import "github.com/alice/lib/v2/..."`. Tools that help: `gopls rename`, `goimports`, or a careful `find ... -exec sed -i ...`.

4. **Make the breaking changes.** Now is the time. The `/v2` suffix has insulated old consumers.

5. **Test thoroughly.**
   ```bash
   go mod tidy
   go build ./...
   go test ./...
   ```

6. **Tag v2.0.0.**
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

7. **Write release notes** explaining why v2, what broke, and how to upgrade.

8. **Plan a deprecation window for v1.** Document a date by which v1 will receive only critical security fixes.

### Coexistence

After v2.0.0 ships, both versions are usable simultaneously:

```go
import (
    libv1 "github.com/alice/lib"
    libv2 "github.com/alice/lib/v2"
)
```

The toolchain treats them as separate modules. A consumer can migrate gradually.

---

## Pre-1.0 Releases and Stability Expectations

Versions starting with `v0.` (e.g. `v0.3.7`, `v0.18.0`) signal *unstable*. The community accepts breakage in v0 — that is the entire point.

### What v0 lets you do

- Break the API in a minor release (`v0.3` → `v0.4` may remove or rename anything).
- Iterate on design without committing to backward compatibility.
- Skip the `/v2` rule until you reach v1.

### What v0 still requires

- Semver formatting (`v0.X.Y`).
- A `go.mod` with the correct module path.
- Working code (you are not exempt from "it must build").

### When to release v1.0.0

When you can answer "yes" to all of:

- Is the public API stable? (Renames or removals would now hurt users.)
- Have at least one or two real consumers depended on it for a few weeks?
- Have you written documentation that someone unfamiliar can use?

There is no formal ceremony. Tag `v1.0.0` and you have committed to semver discipline going forward.

---

## Retraction and Deprecation in Practice

Two distinct mechanisms for "do not use this anymore."

### Retraction

A retraction marks one or more *specific versions* as broken. Add it to the `go.mod` of the *latest* release:

```
retract v1.2.3 // bug: panics on empty input

retract [v1.4.0, v1.4.2] // entire range, security flaw
```

Then tag a new release. Consumers running `go get` will not be offered retracted versions; consumers already on a retracted version will see a warning.

Retraction does not remove the version from the proxy. The bytes are still served. It only signals "this is unsafe; pick something else."

### Deprecation

A deprecation marks an *entire module* as no longer maintained. Add a comment in the `module` directive:

```
// Deprecated: this module is unmaintained. Use github.com/alice/newlib instead.
module github.com/alice/oldlib
```

`go list -m -u` will show a deprecation notice to consumers. pkg.go.dev highlights it.

Deprecation is irreversible in spirit — a module that has been deprecated and then revived sends a confusing signal. Be sure before you deprecate.

---

## Vanity Import Paths

Vanity paths let your module live at a custom domain (`go.example.com/lib`) instead of the hosting provider's domain (`github.com/...`).

### Why

- Branding and stability — the import path survives a move from GitHub to GitLab.
- Private or alternate hosting.
- Aggregating multiple modules under a single namespace.

### How

Serve a small HTML page at the import path. When `go get` requests `https://go.example.com/lib?go-get=1`, the response must include:

```html
<meta name="go-import" content="go.example.com/lib git https://github.com/alice/lib">
```

That tells the toolchain: "the module is hosted at go.example.com/lib and its actual VCS is the GitHub repo." Pkg.go.dev follows the same redirect.

### Cost

You now own the redirect server. If `go.example.com` goes down, all your consumers see fetch failures. Consider whether the branding is worth the operational burden.

---

## Common Errors When Publishing

### Error 1 — Tag without `v` prefix

```bash
git tag 1.2.3   # WRONG
```

The Go proxy ignores tags that do not start with `v`. The version simply will not exist to the toolchain. Fix:

```bash
git tag -d 1.2.3
git tag v1.2.3
git push origin v1.2.3
```

### Error 2 — Tag from a stale commit

You tagged before the latest fix landed. Now consumers fetch broken code. Because the proxy is immutable, you cannot replace `v1.2.3`. Fix:

- Tag a new release (`v1.2.4`) with the fix.
- Optionally retract `v1.2.3`.

### Error 3 — `/v2` import path mismatch

`go.mod` says `module github.com/alice/lib`, but the tag is `v2.0.0`. The proxy errors with:

```
github.com/alice/lib@v2.0.0: invalid version: module contains a go.mod file,
so module path must match major version ("github.com/alice/lib/v2")
```

Fix: update the `module` directive to include `/v2`, rewrite imports, re-tag.

### Error 4 — Pushed tag from wrong branch

You tagged the right version on the wrong branch. The fix depends on whether the tag has been fetched:

- *Not yet fetched by anyone* → delete and re-create (rare; you almost always lose this race).
- *Already on the proxy* → release a new patch version with the correct content.

### Error 5 — go.sum missing a transitive

Your release builds locally because your machine has the sums cached. Consumers on a clean checkout fail with "missing go.sum entry." Fix: run `go mod tidy && go mod download` and commit `go.sum` before tagging.

---

## Best Practices for Established Codebases

1. **Automate releases through CI.** A workflow that runs `go test ./...`, lints, then tags is far less error-prone than a human typing `git tag`.
2. **Maintain a CHANGELOG.md.** Each release section maps to a tag. Consumers and pkg.go.dev visitors find it useful.
3. **Tag from a protected branch only.** Tagging from a feature branch is a frequent source of "wrong commit" mistakes.
4. **Run `go mod tidy` as a CI gate.** A dirty `go.mod` should not become a release.
5. **Use lightweight tags, not annotated tags, for releases** unless you have a specific reason. Both work, but lightweight tags are simpler to reason about.
6. **Sign tags** if your community expects it (`git tag -s vX.Y.Z`). Verifying tag signatures becomes a meaningful trust step.
7. **Document the supported Go versions** in the README and `go` directive. Consumers should not need to guess.
8. **Plan major releases in advance.** Communicate a roadmap; do not surprise your users with v2 the day you tag it.

---

## Pitfalls You Will Meet

### Pitfall 1 — The tag never reaches the proxy

You pushed but never fetched. pkg.go.dev shows nothing. Fix: run `go get module@version` yourself.

### Pitfall 2 — The proxy serves stale `latest`

You pushed `v1.2.3` but `proxy.golang.org/.../@latest` still returns `v1.2.2`. The proxy's `@latest` endpoint can lag a few minutes after a new tag. Wait, or hit `/@v/list` which is updated more aggressively.

### Pitfall 3 — Pre-release accidentally taken as latest

A `v2.0.0-rc.1` tag should not be `@latest`, and it is not. But a typo like `v2.0.0.rc1` (missing the dash) makes it a malformed tag the proxy ignores entirely. Always include the `-` between the version and the pre-release identifier.

### Pitfall 4 — Vanity domain DNS expires

You moved to a vanity import path, then forgot to renew the domain. All consumers' builds break. A vanity path is a long-term operational commitment.

### Pitfall 5 — Deleted a tag, expecting it to disappear

The proxy already cached it. Deleting from GitHub does not retract from the proxy. Use `retract` in `go.mod` to signal "do not use," not tag deletion.

### Pitfall 6 — Forgot to bump the import path on v2

You tagged `v2.0.0` with the same `module github.com/alice/lib` line. Consumers see "module declares its path as ..., but go.sum says ...". Fix: re-release as v1.x.y if no one has consumed v2 yet, or fix the path and re-tag a new v2.0.1.

### Pitfall 7 — License file in a sub-folder, not the root

pkg.go.dev only detects a license at the repository root. A `LICENSE` in `./docs/LICENSE` does not count. Move it to the root.

### Pitfall 8 — Examples that fail without internet

A runnable example that calls a real network endpoint can break `go test` for offline consumers. Keep examples self-contained.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Walk through the pre-publish checklist from memory and explain why each item exists
- [ ] Format a semver tag including a pre-release suffix and build metadata correctly
- [ ] Trace what proxy.golang.org and sum.golang.org do during a first fetch
- [ ] Explain why publishing a Go module does not require uploading anywhere
- [ ] Trigger pkg.go.dev indexing when automatic indexing has not happened
- [ ] Write a `doc.go`, an exported function comment, and a runnable example
- [ ] Bump a library to v2 step by step, including the maintenance branch for v1
- [ ] Decide between a retraction and a deprecation for a given scenario
- [ ] Describe the `<meta name="go-import">` redirect for vanity paths
- [ ] Diagnose every error in [Common Errors](#common-errors-when-publishing) from a build failure

---

## Summary

Publishing a Go module is a Git tag, a proxy fetch, and a documentation page — three artefacts that the ecosystem stitches together without any central submission step. The publisher's job is to ensure the inputs are right: license, README, godoc, tests, CI, a clean commit, and a properly formatted semver tag matching the module path's major version. Once the tag is pushed and one consumer fetches the module, `proxy.golang.org` freezes the version, `sum.golang.org` logs its hash, and `pkg.go.dev` indexes the documentation. From that moment on, the version is permanent. Mistakes are correctable only forward — through new releases, retractions, and deprecations, never by editing the past. Treat each tag as the public, immutable contract it is.
