# Module Versioning — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What does the string `v1.2.3` actually mean to Go, and how do I get one of those onto my own module?"

A Go module is *just code* until it has a version. A version turns code into something other people can rely on, point to, pin against, upgrade from, or roll back to. The Go toolchain reads versions, records versions, sorts versions, and refuses to build when versions disagree. If you do not understand how versions work, every dependency error looks like magic.

The good news: Go's versioning system is surprisingly small. There are exactly three rules that cover the 90% case:

1. **Versions look like `v1.2.3`** — three numbers, separated by dots, with a leading lowercase `v`.
2. **A "version" of your module is a Git tag** with that exact shape pointing at a commit.
3. **The `MAJOR.MINOR.PATCH` numbers carry meaning** — they tell consumers what to expect when they upgrade.

Everything else (`/v2` paths, pseudo-versions, pre-release tags, `+incompatible`) is a corner case layered on top of those three rules.

This file walks you from "no version" to "I tagged `v1.0.0` and someone else can `go get` it." It is the absolute floor.

After reading you will:
- Read a Go version string and tell `MAJOR.MINOR.PATCH` apart
- Understand why the leading `v` is mandatory
- Tag a Go module with `git tag v0.1.0` and explain what that does
- Know the difference between `v0`, `v1`, and `v2+`
- Bump from `v0.1.0` to `v0.2.0` to `v1.0.0` correctly
- Recognise when you must bump major and when minor or patch is enough
- Read a `go.mod` `require` line and explain the version it pins

You do **not** need to know about `+incompatible`, pseudo-versions, MVS internals, or `replace` directives yet. Those are middle and senior topics.

---

## Prerequisites

- **Required:** A Go installation (1.16 or newer; 1.21+ ideal). Check with `go version`.
- **Required:** A working Go module (you have run `go mod init` and `go.mod` exists). Without a module, there is nothing to version.
- **Required:** Git. Versions are Git tags; you cannot publish a Go version without committing and tagging.
- **Required:** A public Git host (GitHub, GitLab, Bitbucket) **or** a willingness to use a local module path for practice. You can tag locally too — it just is not visible to the world.
- **Helpful:** Comfort reading a `go.mod` file. Open one if you have one and notice the `require` lines.
- **Helpful:** Familiarity with semantic versioning (`MAJOR.MINOR.PATCH`) from any other language ecosystem. Go's rules are stricter, but the shape is the same.

If you can run `git tag` and `go mod init` without errors, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Version** | A string of the form `vMAJOR.MINOR.PATCH` (or `vMAJOR.MINOR.PATCH-prerelease`) that identifies a specific release of a module. |
| **Semver / Semantic Versioning** | The convention that `MAJOR.MINOR.PATCH` numbers carry meaning. Go modules require it. |
| **Tag** | A named pointer to a Git commit. In Go, a tag like `v1.2.3` *is* the version. |
| **`v` prefix** | The required lowercase letter `v` before every Go module version. `v1.2.3` is valid; `1.2.3` is not. |
| **MAJOR** | The first number. Bumps signal **breaking** changes. From `v1.x.x` to `v2.0.0`. |
| **MINOR** | The middle number. Bumps add features without breaking existing users. From `v1.2.3` to `v1.3.0`. |
| **PATCH** | The last number. Bumps fix bugs without breaking or adding. From `v1.2.3` to `v1.2.4`. |
| **`v0`** | The "anything goes" major. Pre-1.0 modules can break in any release. |
| **`v1`** | The first stable major. Once you tag `v1.0.0`, you commit to no breaking changes inside `v1.x.x`. |
| **`v2+`** | Any major from `v2` onwards. Has special rules — the import path must end with `/vN`. |
| **`go.mod`** | The file at the root of every module. Lists the module path, the Go version, and the version of every dependency. |
| **`require` line** | A line in `go.mod` that pins a dependency to a specific version. `require github.com/foo/bar v1.6.0`. |
| **Tagged release** | A version that has a real Git tag pointing at it. The opposite of a pseudo-version. |
| **Module path** | The string after `module` at the top of `go.mod`. For modules at `v2+`, the path includes `/vN`. |

---

## Core Concepts

### A version is a string with three numbers

`v1.2.3` means major=1, minor=2, patch=3. Read it left-to-right; bigger numbers on the left win in comparisons. `v1.10.0` is *newer* than `v1.9.99` — these are not decimal numbers.

### The `v` is part of the syntax

`v` is not optional, not capitalised, not stylistic. The Go toolchain sees `1.2.3` and treats it as garbage. It sees `v1.2.3` and parses it as a version. This is the single most common first-time mistake — both for tagging your own module and for pinning someone else's.

### A tag in Git becomes a version in Go

```bash
git tag v0.1.0
git push --tags
```

Two commands. Now `v0.1.0` of your module exists. Anyone with the URL can:

```bash
go get example.com/yourmodule@v0.1.0
```

There is no `go publish`. There is no registry to upload to. The Git tag *is* the publish.

### `MAJOR` carries the breaking-change promise

Semver compresses your release notes into a number. The audience reads only the number:

| You bumped... | Consumers expect... |
|---------------|---------------------|
| **PATCH** (`v1.2.3` → `v1.2.4`) | Bug fixes only. Safe to upgrade without reading the changelog. |
| **MINOR** (`v1.2.3` → `v1.3.0`) | New features, possibly internal performance improvements. No removals. Safe to upgrade. |
| **MAJOR** (`v1.x.x` → `v2.0.0`) | Breaking changes. Read the changelog. Possibly rewrite calls. |

Break the contract — bump major when you should have bumped minor, or rename a function in a patch release — and consumers stop trusting your numbers. You do not get the trust back.

### `v0.x.x` is the "I am still figuring it out" zone

While your module is at `v0`, you are excused from the no-breaking-changes rule. `v0.1.0` to `v0.2.0` may break the API completely. The community knows this; new projects start at `v0` for a reason.

The moment you tag `v1.0.0`, the floor changes. From then on, breaking changes mean a new major.

### `v2+` requires a path change

This is the rule that surprises everyone the first time. When you bump to `v2`:

- The module path in `go.mod` must end with `/v2`: `module github.com/alice/csvkit/v2`.
- Consumers must change their imports to include `/v2`.
- You tag `v2.0.0` on the same repo, but it lives at a "new" import path.

`v0`, `v1` — no path suffix. `v2`, `v3`, ... — path suffix mandatory. We dig into this rule in [middle.md](middle.md) and [senior.md](senior.md). For now: know it exists, know it bites if forgotten.

### `go.mod` records every dependency's version

Open any `go.mod` and you will see lines like:

```
require (
    github.com/google/uuid v1.6.0
    github.com/spf13/cobra v1.8.0
    github.com/stretchr/testify v1.9.0
)
```

Each line says: "I want exactly this module at exactly this version." When you build, the toolchain finds those exact versions in the cache, hashes them against `go.sum`, and links them in. Versions are not negotiable at build time; they are decided when the line is written.

---

## Real-World Analogies

**1. Editions of a book.** A book on a shelf might say "Second Edition, Revised Printing." Major edition = backwards-incompatible (chapters reordered, new title). Minor revision = added a chapter. Patch printing = fixed a typo. Readers cite specific editions when accuracy matters; pinning a Go version is the same.

**2. Software updates on your phone.** When iOS goes from 17 to 18, apps may break. From 17.5 to 17.6, they should not. From 17.5.1 to 17.5.2, you barely notice. Go versions encode the same expectation in a number you can read.

**3. Recipe revisions.** A recipe v1.0.0 says "two cups of flour." v1.1.0 adds an optional vanilla note (additive, safe). v1.0.1 corrects a typo from "tablespoon" to "teaspoon" (bug fix). v2.0.0 swaps butter for olive oil — a different dish. The same dish identifier across major versions would be misleading; that is why Go enforces a path change.

**4. Train timetables.** A timetable update at midnight is patch — the trains still run, just the leaflet is corrected. A new line added is minor. A new station replacing an old one is major — your old route is broken. Riders need to know which kind of change happened.

---

## Mental Models

### Model 1 — A version is a *promise*, not just a number

`v1.2.3` is shorthand for "I promise this code is backwards-compatible with everything I shipped under `v1.0.0`." If the code does not honour that promise, the number is a lie. Numbers in semver are contracts, not labels.

### Model 2 — Versions are *immutable*

Once you tag `v0.1.0` and push, that tag is forever. Move it to a different commit and you have created a parallel reality where two builds with the same version number have different bytes. The Go module proxy will catch you (it caches the first set of bytes it ever sees), and consumers will get checksum errors. Never move a tag.

### Model 3 — `v0` is special; everything else follows the same rules

`v0` is the lab. `v1` and beyond are production. The transition `v0.x` → `v1.0.0` is the most important release in your library's life — you are saying "I am ready to keep promises now." Take it seriously.

### Model 4 — The number on the left wins

`v1.10.0` > `v1.9.0`. `v2.0.0` > `v1.99.99`. `v1.2.3-alpha.1` < `v1.2.3` (pre-releases sort *before* the release). When in doubt about ordering, walk the numbers left-to-right.

### Model 5 — Major bumps are *project events*, not commits

A major bump is a release-wide event: rename the module path, edit every internal import, write a migration guide, communicate to consumers. It is not "fix bug, bump major." Treat major bumps the way you would treat a product relaunch.

---

## Pros & Cons

### Pros

- **Predictability.** A version number tells you what kind of change to expect before you read a single line of code.
- **Reproducibility.** A `go.mod` + `go.sum` plus public tags = bit-identical builds on any machine, forever.
- **Tool-friendly.** `go list -m -u all` can compare versions and tell you what is new, because the format is fixed.
- **Coordinated upgrades.** Major bumps allow side-by-side coexistence (the `/v2` rule), so a big repo can upgrade incrementally.
- **No registry needed.** Versions are Git tags. No central authority can take your library down.

### Cons

- **One mistake is forever.** A wrongly-tagged release stays in the proxy. You can `retract` but not remove.
- **The `v2` path rule confuses newcomers.** "Why does the import path end in `/v2`?" is a perennial Stack Overflow question.
- **Strictness can feel pedantic.** Go refuses to build if a version is missing a `v`, even though you know what you mean.
- **Pseudo-versions look ugly.** `v0.0.0-20240612103515-abc123def456` is not human-friendly.

The pros are why Go's module system is famously stable. The cons are the price.

### When to care about versioning:
- The moment you publish a module to a public host.
- The moment you upgrade a dependency.
- The moment you depend on a library at a specific commit instead of a tag.

### When you can mostly ignore it:
- You are writing a single-file script in a throwaway folder. (Even then, have a `go.mod`; you will thank yourself.)

---

## Use Cases

- **Tagging your first release.** `git tag v0.1.0 && git push --tags`. The library can now be `go get`'d at a stable version.
- **Bumping a dependency.** `go get github.com/foo/bar@v1.6.0` rewrites the `require` line.
- **Pinning to a fix.** A bug was fixed in `v1.4.2`; you upgrade from `v1.3.0` to `v1.4.2`.
- **Going stable.** You move from `v0.7.0` to `v1.0.0` after a year of `v0` releases. Consumers know they can now depend on you.
- **Breaking the API.** You bump from `v1.x.x` to `v2.0.0`, change the module path to `/v2`, and announce a migration.

---

## Code Examples

### Example 1 — Tagging a fresh module

```bash
mkdir hello && cd hello
go mod init github.com/alice/hello
cat > hello.go <<'EOF'
package hello

// Greet returns a greeting for name.
func Greet(name string) string { return "Hello, " + name + "!" }
EOF

git init
git add .
git commit -m "initial"
git tag v0.1.0
git push origin main --tags
```

`v0.1.0` of `github.com/alice/hello` now exists. Anyone with the URL can run `go get github.com/alice/hello@v0.1.0`.

### Example 2 — A `go.mod` after `v0.1.0`

```
module github.com/alice/hello

go 1.22
```

That is the whole file. Module path, Go version. No `require` lines (no dependencies yet). Versioning lives in Git, not in `go.mod`.

### Example 3 — Bumping to `v0.2.0` after adding a feature

```go
// hello.go (additive change: new exported function)
package hello

func Greet(name string) string { return "Hello, " + name + "!" }

// GreetFormal returns a more polite greeting.
func GreetFormal(name string) string { return "Good day, " + name + "." }
```

```bash
git add hello.go
git commit -m "add GreetFormal"
git tag v0.2.0
git push --tags
```

Even though `v0` does not require strict semver, you can still follow it — and you should. Habits formed at `v0` make `v1` easier.

### Example 4 — Bumping to `v1.0.0`

You have iterated enough. The API feels right. You commit to it.

```bash
git tag v1.0.0
git push --tags
```

From this commit onwards:
- Patch: `v1.0.1`, `v1.0.2`, ... — bug fixes only.
- Minor: `v1.1.0`, `v1.2.0`, ... — new features.
- Major: `v2.0.0` — only if you are willing to change the module path.

### Example 5 — A patch release for a bug fix

```go
// before
func Greet(name string) string { return "Hello,  " + name + "!" } // bug: two spaces

// after
func Greet(name string) string { return "Hello, " + name + "!" }
```

```bash
git commit -am "fix double space in Greet"
git tag v1.0.1
git push --tags
```

API is unchanged. Behaviour matches the docs more closely. Patch is correct.

### Example 6 — A minor release for a new feature

```go
// new exported function — additive
func GreetMany(names []string) []string { ... }
```

```bash
git tag v1.1.0
git push --tags
```

Existing callers of `Greet` and `GreetFormal` are untouched. Minor bump is correct.

### Example 7 — Reading a `require` line

```
require (
    github.com/google/uuid v1.6.0
    golang.org/x/text v0.14.0
)
```

Translation:
- "I depend on `github.com/google/uuid` at exactly `v1.6.0`."
- "I depend on `golang.org/x/text` at exactly `v0.14.0`."

The build will fail loudly if those exact versions cannot be located.

### Example 8 — Looking at a tagged version remotely

```bash
go list -m -versions github.com/google/uuid
```

Output (excerpt):

```
github.com/google/uuid v1.0.0 v1.1.0 v1.2.0 v1.3.0 v1.4.0 v1.5.0 v1.6.0
```

Every tagged release of the module, sorted oldest-to-newest. Useful for "is there a newer version?" without leaving the terminal.

### Example 9 — The `v2+` import path

Suppose you bump `csvkit` to `v2`. Your `go.mod` becomes:

```
module github.com/alice/csvkit/v2

go 1.22
```

Note the `/v2`. Consumers now write:

```go
import "github.com/alice/csvkit/v2"
```

The repository URL on GitHub is unchanged (`github.com/alice/csvkit`), but the *import path* gains `/v2`. This is the rule that catches everyone the first time.

### Example 10 — A `go.mod` that depends on multiple majors

```
require (
    github.com/alice/csvkit v1.5.0
    github.com/alice/csvkit/v2 v2.0.0
)
```

Both can coexist in one binary, because Go treats them as different modules. Usually a code smell — you are migrating from v1 to v2 and you have not finished — but legal.

---

## Coding Patterns

### Pattern 1 — Start at `v0.1.0`, not `v0.0.1` and not `v1.0.0`

`v0.1.0` says "this is the first published thing, and I am still iterating." It gives you minor and patch room (`v0.1.1`, `v0.2.0`) without committing to stability. Going straight to `v1.0.0` on the first commit is a promise you cannot keep.

### Pattern 2 — Tag on `main`, not on a feature branch

Tags should point at a commit on the line of code people will see. Tagging a feature branch creates orphan versions that confuse consumers and tools.

### Pattern 3 — Bump deliberately, in a separate commit

A "release commit" is often:

```
chore(release): v1.2.0
```

Empty content (or just a CHANGELOG update). Tag immediately after. This makes the release point obvious in `git log`.

### Pattern 4 — Write down the change category before tagging

Ask yourself: "Is this change additive, a bug fix, or a breaking change?" The answer dictates which number bumps. Do not rush this — once tagged, the contract is set.

### Pattern 5 — Treat `v1.0.0` as a milestone

It deserves a CHANGELOG entry, a README "stable" note, and a public announcement. Most libraries do not skip from `v0.x` to `v1.0.0` casually.

---

## Clean Code

- **Use exact tags.** `v1.2.3`, not `1.2.3`, not `v1.2.3-final`, not `v1.2.3.0`. The Go toolchain only understands the canonical form.
- **One tag per release.** Do not create both `v1.0` and `v1.0.0` for the same commit; pick the canonical `vMAJOR.MINOR.PATCH`.
- **Annotated tags are fine but not required.** `git tag -a v1.0.0 -m "..."` adds a tag message; `git tag v1.0.0` does not. Both work for Go.
- **Sign tags if you can.** `git tag -s v1.0.0` produces a GPG-signed tag. This is good hygiene for serious projects.
- **Write a CHANGELOG.** Each release entry should list what changed in plain English, even for v0.

---

## Product Use / Feature

When you ship a product:

- The version of every dependency is recorded in the binary. `go version -m ./your-binary` reveals it; consumers and security scanners read this.
- Choosing your own module's version influences when a partner team can adopt your library.
- Stability tiers (`v0`, `v1`, `v2+`) signal *to whoever reads your `go.mod`* what level of commitment you offer.
- A bumped major version forces every consumer to do work. That cost is a product cost. Plan it like a product feature.

The version number is part of the product surface, not just a dev detail.

---

## Error Handling

Common version-related errors and what they mean.

### "invalid version: must begin with v"

```
go get github.com/foo/bar@1.2.3
go: github.com/foo/bar@1.2.3: invalid version: must begin with v
```

You forgot the `v`. Use `@v1.2.3`.

### "no matching versions for query"

```
go get github.com/foo/bar@v9.9.9
go: github.com/foo/bar@v9.9.9: no matching versions for query "v9.9.9"
```

That tag does not exist on the upstream. Run `go list -m -versions github.com/foo/bar` to see what is available.

### "module declares its path as ... but was required as ..."

```
require github.com/alice/csvkit/v2 v2.0.0
go: github.com/alice/csvkit/v2@v2.0.0: module declares its path as: github.com/alice/csvkit
```

The library's `go.mod` still says `module github.com/alice/csvkit` (no `/v2`), but you are trying to import `/v2`. The maintainer forgot to update the module path when bumping to v2. They need to fix it; you cannot.

### "checksum mismatch"

```
verifying github.com/foo/bar@v1.2.3: checksum mismatch
```

The bytes downloaded for `v1.2.3` do not match what `go.sum` recorded earlier. Possible causes: a maintainer force-pushed the tag (illegal), the proxy was tampered with (rare), or your local cache is corrupted. Try `go clean -modcache` and retry. If it persists, do not trust the source.

### Tag missing the `v`

```bash
git tag 1.2.3
go list -m github.com/me/lib@v1.2.3
go: github.com/me/lib@v1.2.3: no matching versions
```

Your tag is `1.2.3`. Go cannot see it. Re-tag as `v1.2.3` and push.

---

## Security Considerations

- **`go.sum` is your tamper detector.** Every version that appears in `go.mod` has a hash entry in `go.sum`. If anyone swaps the bytes for a published version, the hashes will not match and your build fails. Commit `go.sum`.
- **Never reuse a tag.** Force-pushing `v1.0.0` to a different commit is a supply-chain hazard. Some users will get the old bytes (cached); some the new. The proxy may even refuse the move. If you need to fix `v1.0.0`, ship `v1.0.1`.
- **Pin majors carefully.** A bot that auto-bumps minor versions of your dependencies is a small risk; one that auto-bumps majors is a large risk. Major bumps mean the API may have changed and the new code may behave differently.
- **Watch for typo-squat majors.** `github.com/foo/bar/v22` is not the same module as `github.com/foo/bar/v2`. Copy-paste import paths from authoritative sources.
- **Treat `v0` libraries with mild suspicion in production.** A `v0` library has no stability promise. That does not make it unsafe, but it does mean the next minor release may break your code. Read the README for the project's stance.

---

## Performance Tips

- **A bumped version invalidates the proxy cache for that path.** If you tag `v1.0.1`, the next `go get` populates the cache for `v1.0.1`. Existing builds that pin `v1.0.0` are unaffected.
- **Listing versions is one round-trip.** `go list -m -versions github.com/foo/bar` is a single proxy request; cheap, scriptable, useful in CI to detect drift.
- **A bigger version number is not slower.** `v1` and `v17` build at the same speed. Performance has nothing to do with the version string.
- **Pseudo-versions cost the proxy slightly more on first fetch** (it has to compute one), but for everyday work the difference is invisible.

---

## Best Practices

1. **Always use `v` prefix.** `v1.2.3`, never `1.2.3`.
2. **Tag on the canonical branch (`main` / `master`).** Not on feature branches.
3. **One tag per release.** No `v1.0`, no `v1.0.0-final`, just `v1.0.0`.
4. **Start at `v0.1.0`.** Iterate. Bump to `v1.0.0` only when you are ready to keep promises.
5. **Bump major only when you must.** Renaming a function for aesthetics is not a major-bump reason.
6. **Patch fixes bugs. Minor adds features. Major breaks. Stick to the pattern.**
7. **Tag annotated and (ideally) signed.** `git tag -a -s vX.Y.Z -m "..."`.
8. **Push tags explicitly.** `git push --tags` (or `git push origin vX.Y.Z`).
9. **Never move a tag.** Once it is pushed, it is forever.
10. **Write a CHANGELOG.** A short note per release saves future-you from rediscovery.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting the `v` in a tag

You ran `git tag 1.0.0`. From Git's perspective everything is fine. From Go's perspective, no `v1.0.0` tag exists for your module. Re-tag as `v1.0.0` and push. The bad tag can stay or be removed; Go ignores it either way.

### Pitfall 2 — Tagging the wrong commit

You tagged `v1.0.0` on a draft commit, not on the polished one. The fix is *not* to move the tag — it is to make a new commit and tag `v1.0.1`. Moving tags breaks the immutability promise.

### Pitfall 3 — Skipping `v0` and going straight to `v1.0.0`

Nothing in Go forbids it, but if your API has not stabilised, you will regret it. Spend at least one round of `v0.x` releases before committing.

### Pitfall 4 — Bumping minor when the change is breaking

You renamed a function. You think it is a minor change because the *intent* is the same. It is not — your consumers' code no longer compiles. That is the textbook definition of a breaking change. Bump major.

### Pitfall 5 — Releasing `v2.0.0` without changing the module path

Tagging `v2.0.0` on a `go.mod` that still says `module github.com/alice/csvkit` produces an unusable release. Go's toolchain will reject it with "module declares its path as ... but was required as ...". The fix is to update the module path to include `/v2` and re-tag.

### Pitfall 6 — Tagging `v1` instead of `v1.0.0`

Some Git workflows use short tags like `v1` or `v1.0`. Go expects exactly three numbers. `v1.0` is not a Go module version. Always use `vMAJOR.MINOR.PATCH`.

### Pitfall 7 — Confusing release tag with annotation tag

`git tag v1.0.0` (lightweight) and `git tag -a v1.0.0 -m "..."` (annotated) both work for Go. The proxy does not care. Annotated tags are nicer for humans because they carry a message; pick one and be consistent.

### Pitfall 8 — Pushing without `--tags`

```bash
git tag v1.0.0
git push origin main
```

The branch is pushed. The tag is *not*. Consumers cannot find `v1.0.0` because no remote tag exists. Use `git push origin v1.0.0` or `git push --tags`.

---

## Common Mistakes

- **Writing `1.2.3` instead of `v1.2.3` in a `go get` command.**
- **Tagging on a branch other than `main` and forgetting which branch the tag lives on.**
- **Releasing a major bump as a patch because "the change feels small."**
- **Going from `v0` to `v1` without a CHANGELOG entry — consumers do not know what stabilised.**
- **Moving a tag after release because "we found a bug." (Make a new patch instead.)**
- **Forgetting `/v2` in the module path when bumping major.**
- **Pushing the branch but not the tag.**
- **Tagging a commit that does not build.**
- **Using `v1.0.0-rc1` (pre-release) and then never publishing `v1.0.0` — leaves consumers stuck on a release candidate.**

---

## Common Misconceptions

> *"`go.mod`'s `go 1.22` line is the version of my module."*

No. That line is the *minimum Go toolchain version* needed to build the module. The version of your module is whatever Git tag you push.

> *"Bigger version number means newer release, always."*

Mostly. Pre-release tags (`v1.2.3-alpha.1`) sort *before* the corresponding release (`v1.2.3`). Pseudo-versions can sit between two real versions.

> *"`v1.0` and `v1.0.0` are the same."*

Not to Go. Go expects `vMAJOR.MINOR.PATCH` — three numbers. `v1.0` is not a recognised Go module version.

> *"I have to use semver — Go enforces it."*

Go enforces the *format*. It does not enforce the *meaning*. Nothing stops you from breaking compatibility in a patch release. Consumers (and `go mod`) will be deeply confused, and your reputation will pay, but Go itself will not stop you. Discipline is on you.

> *"Once I publish `v1.0.0`, I can never break the API again."*

You can — but only by bumping to `v2.0.0` and changing the module path to `/v2`. The path change is the safety mechanism that lets `v1` and `v2` coexist.

---

## Tricky Points

- **The leading `v` is part of the version everywhere except in some prose.** Some docs write "version 1.2.3"; the toolchain wants `v1.2.3`. When in doubt, include the `v`.
- **Pre-releases sort before the matching release.** `v1.2.3-alpha.1 < v1.2.3 < v1.2.4-alpha.1`.
- **`v0.x.x` sorts below `v1.0.0-anything`.** Major dominates everything.
- **Comparing versions is left-to-right numeric, not string-lexicographic.** `v1.10.0` > `v1.9.99`.
- **Pseudo-versions are a Go invention, not part of upstream semver.** Looks like `v0.0.0-20240612103515-abc123def456`. We cover them in [middle.md](middle.md).
- **A tag that already exists upstream is **immutable** for you.** Do not retag; ship a patch.
- **The path to `v2+` modules contains `/v2`, but the *Git repo URL* does not.** The repo is still `github.com/alice/csvkit`; the *import* is `github.com/alice/csvkit/v2`.

---

## Test

Do this in a scratch folder.

```bash
mkdir versiontest && cd versiontest
go mod init example.com/versiontest
cat > greet.go <<'EOF'
package versiontest

func Greet() string { return "hello" }
EOF
git init -q
git add .
git commit -q -m "v0.1.0"
git tag v0.1.0
```

You now have a tagged module at `v0.1.0`. Verify:

```bash
git tag --list
# v0.1.0
```

Now make an additive change:

```bash
cat > greet.go <<'EOF'
package versiontest

func Greet() string { return "hello" }
func GreetLoud() string { return "HELLO!" }
EOF
git commit -am "add GreetLoud"
git tag v0.2.0
```

Two tags, both valid versions.

Answer:

1. Why is the new release `v0.2.0` and not `v0.1.1`? (It added a feature. Bug fixes are patches; features are minor.)
2. If you renamed `Greet` to `Hello`, would the next tag be `v0.3.0` or `v1.0.0`? (Renaming is breaking. At v0, breaking changes are still allowed in minor bumps — `v0.3.0` is fine but `v1.0.0` would commit you to stability afterwards.)
3. If you removed `GreetLoud` after declaring `v1.0.0`, what would the next tag be? (`v2.0.0` — and you would also need to change the module path to end with `/v2`.)
4. What does `git push --tags` do? (Sends every local tag to the remote. Without it, your tags are local-only and Go cannot see them.)

---

## Tricky Questions

**Q1.** I tagged my module `1.0.0` (no `v`). Does `go get github.com/me/lib@v1.0.0` work?

A. No. Go requires the leading `v` in the tag too. Re-tag as `v1.0.0` and push.

**Q2.** What is the difference between `v1` and `v1.0.0`?

A. To Go's module system, only `v1.0.0` is a valid version string. `v1` and `v1.0` are not recognised. Always use the three-number form.

**Q3.** I bumped from `v1.5.0` to `v2.0.0` and tagged it. Why does `go get example.com/lib@v2.0.0` fail?

A. Almost certainly because you forgot to update the module path in `go.mod` to end with `/v2`. The Go toolchain enforces the SIV rule: modules at `v2+` must declare the `/v2` suffix in their module path *and* be imported with that suffix.

**Q4.** Can I have `v1.0.0` and `v1.0.1` of my module pointing at the same commit?

A. Technically Git lets you, but it is a bad idea. Two versions implying two different commits but pointing at one is misleading. Pick one canonical version per commit.

**Q5.** What happens if I delete a tag?

A. `git tag -d v1.0.0` removes the local tag. `git push --delete origin v1.0.0` removes the remote tag. The Go module proxy may still have the bytes cached forever (it does, in fact). Existing consumers will continue to work; new fetches may fail or succeed depending on cache. Do not delete published tags.

**Q6.** Why does my `go.mod` show `// indirect` next to a version?

A. `// indirect` means "this version is required by one of my dependencies, not by my code directly." It is part of the lockfile, not a comment about the version itself. Leave it alone; `go mod tidy` will regenerate it.

**Q7.** Is `v1.0.0-rc1` a "version 1.0.0 release candidate" or a "version 1.0.0-rc1"?

A. To Go, it is a *pre-release* of `v1.0.0`. It sorts before `v1.0.0` and is excluded from `@latest` queries by default. Consumers must explicitly ask for it (`@v1.0.0-rc1`) to use it.

**Q8.** Can two modules under the same Git repo have different versions?

A. Yes. A monorepo can host multiple modules, each with its own `go.mod` and its own tags. The tag must include the module's subdirectory: `tools/cli/v1.2.3` for a module rooted at `tools/cli`. This is more advanced; covered briefly in [middle.md](middle.md).

**Q9.** Is `v0.0.0` a valid Go version?

A. Yes, it is syntactically valid, and Go uses `v0.0.0-` as the leading prefix of pseudo-versions. As a real release, `v0.0.0` is unusual but legal — most projects start at `v0.1.0`.

**Q10.** What does `go.mod`'s `go 1.22` line have to do with my module's version?

A. Nothing directly. `go 1.22` declares the language version your code is written for. Your module's version is decided by the tag you push.

---

## Cheat Sheet

```bash
# Tag a new version
git tag v0.1.0
git push --tags

# Annotated, signed tag (preferred)
git tag -s -a v1.0.0 -m "first stable release"
git push --tags

# List local tags
git tag --list

# List versions of an upstream module
go list -m -versions github.com/foo/bar

# See what version of a module you are using
go list -m github.com/foo/bar

# See the full graph of your dependencies' versions
go list -m all
```

```
Version anatomy:

   v 1 . 2 . 3 - rc . 1
   │ │   │   │   │ │
   │ │   │   │   │ └── pre-release counter (optional)
   │ │   │   │   └──── pre-release identifier (optional)
   │ │   │   └──────── PATCH (bug fixes)
   │ │   └──────────── MINOR (additive features)
   │ └──────────────── MAJOR (breaking changes)
   └────────────────── mandatory leading 'v'
```

```
Bump decision tree:

   Did anything break?
        │
   ┌────┴────┐
   │         │
  yes       no
   │         │
   ▼         ▼
  major     Did you add anything?
              │
         ┌────┴────┐
         │         │
        yes       no
         │         │
         ▼         ▼
        minor    patch
```

| Tag form | Valid Go version? |
|----------|-------------------|
| `v1.2.3` | Yes |
| `1.2.3` | No |
| `v1.2` | No |
| `v1` | No |
| `v1.2.3-alpha.1` | Yes (pre-release) |
| `v1.2.3+meta` | Yes but ignored by Go ordering |
| `V1.2.3` | No (capital `V`) |
| `v1.2.3.4` | No (four numbers) |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] State what `vMAJOR.MINOR.PATCH` means in one sentence
- [ ] Explain why the leading `v` is required
- [ ] Tag and push your first version (`v0.1.0`)
- [ ] Decide between patch, minor, and major for any change
- [ ] Read a `require` line and identify the version
- [ ] Explain why `v0` and `v1+` are different
- [ ] Recognise the `/v2` import path rule (without yet doing a v2 bump)
- [ ] Identify three formats Go does *not* accept (e.g. `1.2.3`, `v1.0`, `V1.2.3`)
- [ ] Run `go list -m -versions <path>` to inspect upstream tags
- [ ] Avoid moving a tag once published

---

## Summary

A Go module's version is a Git tag of the form `vMAJOR.MINOR.PATCH`. The leading `v` is mandatory; the three numbers carry meaning. Patch bumps fix bugs; minor bumps add features; major bumps break things. Until you tag `v1.0.0`, you are in the `v0` "anything goes" zone. Once you tag `v1.0.0`, you have signed a contract with consumers. Going to `v2+` requires changing the module path to include `/vN`.

You do not need a registry, a publish command, or special permissions. `git tag v1.0.0 && git push --tags` is the entire publish step. The Go module proxy discovers your module the first time anyone runs `go get` on it, caches the bytes, and serves them forever.

Treat versions like contracts. Never move a tag. Bump deliberately. Write down what changed. Your future self and your library's consumers will thank you.

---

## What You Can Build

After learning this:

- **A library that other people can `go get` at a stable version.**
- **A small CLI tool with versioned releases for download.**
- **A Go module that you bump from `v0.1.0` to `v0.2.0` to `v1.0.0` over a few iterations and feel comfortable with each step.**
- **A multi-tag repository where bug fixes get patches and new features get minor bumps.**

You cannot yet:
- Use pseudo-versions to depend on an unreleased commit (next: middle.md)
- Pre-release tags (`v1.0.0-rc.1`, `v1.0.0-alpha.2`) and how they interact with `@latest` (middle.md)
- Major version migrations (`v1` → `v2` with the `/v2` rule) at scale (senior.md)
- The MVS algorithm under the hood (professional.md)

---

## Further Reading

- The Go modules reference at `go.dev/ref/mod` — section "Version queries" and "Module versions". Authoritative.
- `go.dev/blog/v2-go-modules` — the original blog post on the `/v2` rule.
- `semver.org` — the upstream semver specification. Go follows it with stricter rules.
- `pkg.go.dev` — bookmark and search any module to see its version history.
- The "Versions and Compatibility" chapter in the Go documentation under modules.

---

## Related Topics

- [6.2.3 Publishing Modules — Junior](../02-packages/03-publishing-modules/junior.md) — the publish workflow that tagging is part of
- [6.2.2 Using 3rd Party Packages — Junior](../02-packages/02-using-3rd-party-packages/junior.md) — how versions appear from the consumer side
- [6.1.1 `go mod init`](../01-modules-and-dependencies/01-go-mod-init/junior.md) — start a module before you can version it
- [6.1.2 `go mod tidy`](../01-modules-and-dependencies/02-go-mod-tidy/junior.md) — keeps `go.mod` honest as versions change
- [middle.md](middle.md) — pseudo-versions, pre-releases, upgrades, `replace`
- [senior.md](senior.md) — major-version strategy and `/vN`

---

## Diagrams & Visual Aids

```
A version is a Git tag:

   commit abc123  ←── git tag v0.1.0
   commit def456  ←── git tag v0.2.0
   commit 789xyz  ←── git tag v1.0.0
        │
        └── proxy.golang.org sees the tag on first `go get`
            and caches the bytes forever.
```

```
The semver promise:

   PATCH  v1.2.3 → v1.2.4   bug fix; safe to upgrade
   MINOR  v1.2.3 → v1.3.0   new feature; safe to upgrade
   MAJOR  v1.x.x → v2.0.0   breaking; rewrite calls; new module path
```

```
Major-version path rule:

   v0.x.x  →  github.com/alice/csvkit          (no suffix)
   v1.x.x  →  github.com/alice/csvkit          (no suffix)
   v2.x.x  →  github.com/alice/csvkit/v2       (suffix mandatory)
   v3.x.x  →  github.com/alice/csvkit/v3       (suffix mandatory)
```

```
Tag mistakes Go does not accept:

   1.2.3        ← missing leading v
   v1.2         ← only two numbers
   v1           ← only one number
   V1.2.3       ← capital V
   v1.2.3.4     ← four numbers
   v1.2.3-      ← trailing dash
```

```
What you commit, what you tag:

   git add  go.mod go.sum *.go
   git commit -m "release"
   git tag v1.0.0          ← the version is the tag
   git push --tags          ← without --tags, the world cannot see it
```

```
Healthy versioning checklist:

   [ ] Every release has a `vMAJOR.MINOR.PATCH` tag
   [ ] No tags ever moved
   [ ] CHANGELOG entry per release
   [ ] v0 → v1 transition documented
   [ ] v2+ has /v2 in the module path
   [ ] Patches and minors don't break consumers
   [ ] Tags pushed (`git push --tags`)
```
