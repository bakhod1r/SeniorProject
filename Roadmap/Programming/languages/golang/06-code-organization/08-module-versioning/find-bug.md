# Module Versioning — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1 — The Missing `v`](#bug-1--the-missing-v)
3. [Bug 2 — Major Bump Without `/v2`](#bug-2--major-bump-without-v2)
4. [Bug 3 — `+incompatible` Surprise](#bug-3--incompatible-surprise)
5. [Bug 4 — Internal Imports Forgotten During v2 Bump](#bug-4--internal-imports-forgotten-during-v2-bump)
6. [Bug 5 — `replace` Loop](#bug-5--replace-loop)
7. [Bug 6 — Pseudo-Version Pinned Forever](#bug-6--pseudo-version-pinned-forever)
8. [Bug 7 — Tag Force-Pushed to a Different Commit](#bug-7--tag-force-pushed-to-a-different-commit)
9. [Bug 8 — Pre-release Promoted to `@latest` By Mistake](#bug-8--pre-release-promoted-to-latest-by-mistake)
10. [Bug 9 — Multi-Module Repo Tag Without Prefix](#bug-9--multi-module-repo-tag-without-prefix)
11. [Bug 10 — `replace` in a Library](#bug-10--replace-in-a-library)
12. [Bug 11 — `retract` Has No Effect](#bug-11--retract-has-no-effect)
13. [Bug 12 — Indirect Dep Bumped to a Broken Major](#bug-12--indirect-dep-bumped-to-a-broken-major)
14. [Bug 13 — Tag Pushed but Build Cache Stale](#bug-13--tag-pushed-but-build-cache-stale)
15. [Bug 14 — Two Majors Imported in the Same Package](#bug-14--two-majors-imported-in-the-same-package)

---

## How to Use This File

Each section presents a misbehaving setup, a symptom, the buggy `go.mod` or code, and finally the fix and the lesson. Cover the "Fix" section before reading and try to spot the bug yourself.

The bugs are realistic — drawn from common pitfalls in production codebases.

---

## Bug 1 — The Missing `v`

### Symptom

```
$ go get example.com/lib@1.5.0
go: example.com/lib@1.5.0: invalid version: must begin with v
```

### Setup

The maintainer published version `1.5.0` (no `v`).

```bash
git tag 1.5.0
git push --tags
```

### Spot the bug

Read the tag carefully. What is missing?

### Fix

Go versions require the leading `v`. Re-tag:

```bash
git tag v1.5.0
git push --tags
git tag -d 1.5.0
git push --delete origin 1.5.0
```

### Lesson

The leading `v` is a syntax requirement. Forget it and your tag is invisible to the Go toolchain. Set up your release script to validate tags with `golang.org/x/mod/semver.IsValid`.

---

## Bug 2 — Major Bump Without `/v2`

### Symptom

```
$ go get github.com/alice/csvkit@v2.0.0
go: github.com/alice/csvkit@v2.0.0: github.com/alice/csvkit@v2.0.0:
    invalid version: module contains a go.mod file, so major version
    must be compatible: should be v0 or v1, not v2
```

### Setup

`go.mod` (in the library):

```
module github.com/alice/csvkit

go 1.22
```

```bash
git tag v2.0.0
git push --tags
```

### Spot the bug

The `module` line still claims to be the v0/v1 module. The toolchain refuses because `v2.0.0` cannot live there.

### Fix

Update `go.mod`:

```
module github.com/alice/csvkit/v2

go 1.22
```

Update every internal import (`github.com/alice/csvkit/...` → `github.com/alice/csvkit/v2/...`). Re-tag a *new* version:

```bash
git tag v2.0.1
git push --tags
```

(`v2.0.0` is already poisoned in the proxy as a non-functional release; ship `v2.0.1` cleanly.)

### Lesson

A v2+ bump means three coordinated changes: the `module` line, every internal import, and a new tag. Tools like `gomajor` automate this; do not do it by hand.

---

## Bug 3 — `+incompatible` Surprise

### Symptom

A consumer reports their `go.mod` has:

```
require github.com/legacy/lib v2.5.0+incompatible
```

They are confused why `+incompatible` is there.

### Setup

`github.com/legacy/lib`'s `go.mod`:

```
module github.com/legacy/lib

go 1.22
```

The repo has tags `v0.1.0`, `v1.0.0`, `v1.5.0`, `v2.0.0`, `v2.5.0`.

### Spot the bug

The `go.mod` does not opt into SIV (no `/v2`), but the maintainer kept tagging v2 releases. The Go toolchain compromises by adding `+incompatible` to allow consumers to use v2 at all.

### Fix (as the maintainer)

Adopt SIV: change the `module` line to `github.com/legacy/lib/v2`, update internal imports, tag `v2.6.0`. The `v2.5.0+incompatible` version remains in the proxy as a historical artefact, but new consumers fetch `v2.6.0` cleanly.

### Fix (as the consumer)

Wait for the maintainer, or pin to `v1.x.y` and avoid v2 until they migrate. Do not deeply rely on `+incompatible` — multi-major coexistence is impossible without SIV, so a future fix may force a difficult migration.

### Lesson

`+incompatible` is a marker, not an error. It quietly says "the maintainer took a shortcut." When you see it in your `go.mod`, file an issue upstream.

---

## Bug 4 — Internal Imports Forgotten During v2 Bump

### Symptom

The library now claims to be `github.com/alice/csvkit/v2`, but consumers report odd behaviour: methods on `csvkit/v2.Reader` return values of type `csvkit.Record` (the v1 type).

### Setup

```
csvkit/v2/reader.go:
    package csvkit

    import "github.com/alice/csvkit/internal/parser"  // BUG: should be /v2/internal/parser

    type Reader struct { p *parser.Parser }
```

### Spot the bug

The internal import still points at the v1 internal package. The v2 `Reader` is built on top of v1 internals.

### Fix

Update every internal import to include `/v2`:

```go
import "github.com/alice/csvkit/v2/internal/parser"
```

Use `gomajor fix` to do this automatically:

```bash
go install github.com/icholy/gomajor@latest
gomajor path github.com/alice/csvkit/v2
```

### Lesson

When bumping major, the *module's own* internal imports must be rewritten. Forgetting one creates a Frankenstein library that links its v2 surface against v1 internals.

---

## Bug 5 — `replace` Loop

### Symptom

```
$ go build
go: example.com/myapp imports
    example.com/lib: example.com/lib@v0.0.0-... (replaced by ../lib):
    open ../lib/go.mod: no such file or directory
```

### Setup

`myapp/go.mod`:

```
module example.com/myapp

go 1.22

require example.com/lib v0.0.0-20240612103515-abc123def456

replace example.com/lib => ../lib
```

The `../lib` directory does not exist (the engineer cloned only `myapp`).

### Spot the bug

The `replace` directive points at a path that does not exist on this machine. The `replace` was added during local development on another machine and accidentally committed.

### Fix

Either restore the sibling directory:

```bash
cd ..
git clone https://github.com/example/lib
```

Or remove the `replace`:

```diff
-replace example.com/lib => ../lib
```

Then `go mod tidy` to refresh requirements.

### Lesson

Never commit a local-path `replace` to the canonical branch. Use a separate branch, a `replace.local` file consumed by a wrapper, or an environment-driven workflow.

---

## Bug 6 — Pseudo-Version Pinned Forever

### Symptom

Six months ago, a developer pinned a fix:

```
require github.com/foo/bar v1.5.1-0.20240612103515-abc123def456
```

Today the upstream has shipped `v1.5.1`, `v1.5.2`, `v1.6.0`, `v1.7.0`, but the project is still on the pseudo-version. CI keeps complaining about a vulnerability that was fixed in `v1.7.0`.

### Spot the bug

A pseudo-version was added as a temporary fix and never updated. `go get -u` does not bump pseudo-versions to released tags automatically because MVS treats the pseudo-version as a specific point on the version axis.

### Fix

Manually move to the released version:

```bash
go get github.com/foo/bar@v1.7.0
```

Update the comment if there is one:

```
require github.com/foo/bar v1.7.0
```

### Lesson

Pseudo-versions are placeholders. They should always carry a comment explaining what they are waiting for. Audit pseudo-versions quarterly.

---

## Bug 7 — Tag Force-Pushed to a Different Commit

### Symptom

A consumer's CI fails:

```
verifying github.com/alice/lib@v1.4.0: checksum mismatch
    downloaded: h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
    go.sum:     h1:OldHashFromOriginalRelease=
```

### Setup

The maintainer realised `v1.4.0` had a bug, made a fix, then:

```bash
git tag -d v1.4.0
git tag v1.4.0 <new-commit>
git push --force --tags
```

### Spot the bug

The tag `v1.4.0` now points to a different commit. Consumers who pinned `v1.4.0` before the move have an old `go.sum` hash; the new bytes don't match.

### Fix

The maintainer must publish a new patch:

```bash
# Restore the original v1.4.0 commit (from reflog or local copy)
git tag v1.4.0 <original-commit>
git push --force --tags    # restores original v1.4.0 in proxy

# Ship the fix as v1.4.1
git tag v1.4.1 <new-commit>
git push --tags
```

The proxy already cached the original `v1.4.0` bytes; the force-push only confused things temporarily. Some consumers may have downloaded the new bytes (during the brief window when the proxy was confused). They need to clear their cache:

```bash
go clean -modcache
go mod download
```

### Lesson

Never force-push tags. The proxy's "first wins" cache makes this catastrophic and unfixable. Always tag a new patch.

---

## Bug 8 — Pre-release Promoted to `@latest` By Mistake

### Symptom

A user reports they ran `go get @latest` and pulled `v2.0.0-beta.1`, breaking their code.

### Setup

The library has tags: `v1.0.0`, `v1.5.0`, `v1.5.1`, `v2.0.0-beta.1`. No final `v2.0.0` yet.

### Spot the bug

Wait — `@latest` should *skip* pre-releases. Why did it pick the beta?

The actual cause: the library ALSO had a tag `v3.0.0` that was not a real release, just a marker the maintainer used internally. Some Go versions or proxy implementations may resolve `@latest` to the highest ordering version, which excluded pre-releases for `v2` but selected `v3.0.0` (which had no pre-release suffix). Confusion ensued.

### Fix

Remove the spurious `v3.0.0` tag. Ensure the only "highest non-pre-release" tag is `v1.5.1`. Re-run `@latest`.

### Lesson

`@latest` semantics: "highest stable version (no pre-release suffix), excluding retracted versions." Avoid posting tags that look like releases unless they are. Use distinct prefixes for non-release markers (e.g., `internal/<name>` rather than `vX.Y.Z`).

---

## Bug 9 — Multi-Module Repo Tag Without Prefix

### Symptom

A repo at `github.com/example/tools` has two modules: `tools/cli` and `tools/lib`. The maintainer tagged `v1.0.0` (no prefix). Consumers report:

```
go: example.com/tools/lib@v1.0.0: no matching versions for query "v1.0.0"
```

### Setup

```bash
git tag v1.0.0
git push --tags
```

But the `go.mod`s declare:

```
# in tools/cli/go.mod
module github.com/example/tools/cli

# in tools/lib/go.mod
module github.com/example/tools/lib
```

### Spot the bug

In a multi-module repo, tags must include the module subdirectory:

- `cli/v1.0.0` for `github.com/example/tools/cli`.
- `lib/v1.0.0` for `github.com/example/tools/lib`.

A bare `v1.0.0` is interpreted as the version of a *root* module, but no module lives at the repo root.

### Fix

```bash
git tag cli/v1.0.0
git tag lib/v1.0.0
git push --tags
```

(Optionally delete the bare `v1.0.0` tag.)

### Lesson

Multi-module repos use prefixed tags. State this in your release notes so contributors know.

---

## Bug 10 — `replace` in a Library

### Symptom

A library author reports: "I added a `replace` to point at a faster fork of a transitive dependency, tested it, tagged a release. My users say their builds still use the slow upstream — my replace did nothing."

### Setup

`mylib/go.mod`:

```
module github.com/me/mylib

go 1.22

require github.com/upstream/slow v1.0.0
replace github.com/upstream/slow => github.com/myorg/fast v1.0.0
```

Tagged `v1.0.0`. Consumer:

```
require github.com/me/mylib v1.0.0
```

The consumer's build uses `github.com/upstream/slow`, not the fork.

### Spot the bug

`replace` directives are honoured only in the *main module's* `go.mod`. A library's `replace` is invisible to consumers.

### Fix

Two options:

1. **Stop using `replace`.** Either contribute the fix upstream and require the upstream version, or change the import path in your library to point at the fork directly.
2. **Document it.** If consumers should use the fork, tell them to add the same `replace` to their `go.mod`.

### Lesson

`replace` is a knob for the *application*, not the library. Library authors who rely on `replace` are silently shipping non-portable code.

---

## Bug 11 — `retract` Has No Effect

### Symptom

The maintainer added a `retract` directive but consumers running `go list -m -u all` do not see the retraction.

### Setup

`go.mod` of `v1.4.1` (the latest tag):

```
module github.com/alice/csvkit

go 1.22

retract v1.4.0   // CVE-2026-12345
```

But consumers still see no retraction warning.

### Spot the bug

Two possibilities:

1. The `retract` was added in the wrong version. Retractions are read from the *latest* version of the module. If the maintainer added the `retract` in `v1.4.1`'s `go.mod` but `v1.5.0` has been released since *without* the `retract` line, the latest version's `go.mod` is silent and consumers see nothing.

2. Consumers haven't run `go list -m -u all` recently and are still seeing cached info.

### Fix

Ensure the `retract` is preserved in every subsequent release of the module:

```
# v1.4.1 go.mod
retract v1.4.0   // CVE-2026-12345

# v1.5.0 go.mod (unless v1.5 is the fix)
retract v1.4.0   // CVE-2026-12345

# v2.0.0 go.mod (in /v2 module)
retract v1.4.0   // CVE-2026-12345
```

### Lesson

Retractions live in the *latest* version of each major. Carry them forward like CHANGELOG entries.

---

## Bug 12 — Indirect Dep Bumped to a Broken Major

### Symptom

After running `go get -u ./...`, the build is broken with:

```
./main.go:42:5: cannot use foo (type *bar.Foo) as *bar.Bar value
```

### Setup

`go.mod` (before):

```
require github.com/example/lib v1.0.0   // depends on github.com/foo/bar v1
```

`go.mod` (after `go get -u`):

```
require github.com/example/lib v1.5.0   // now depends on github.com/foo/bar/v2
```

### Spot the bug

`example/lib v1.5.0` migrated its internal use of `foo/bar` from v1 to v2. Both `bar` (v1) and `bar/v2` now coexist in the build, and somewhere your code has the wrong import.

### Fix

Inspect the `go.mod`:

```bash
go mod graph | grep foo/bar
```

Locate the file that mixes `bar.Foo` and `bar/v2.Bar`. Either:

- Use `bar/v2` everywhere (pick the new major).
- Use `bar` (v1) everywhere by pinning `example/lib` to `v1.4.x` (the last v1.x version that depended on `foo/bar` v1).

### Lesson

A minor bump in a library can pull in a new *major* of a transitive dep — and that is technically allowed by semver because the library's own API didn't change. Always scan `go.mod` after `go get -u`.

---

## Bug 13 — Tag Pushed but Build Cache Stale

### Symptom

The maintainer pushed `v1.5.0` but consumers running `go get example.com/lib@v1.5.0` get:

```
go: example.com/lib@v1.5.0: no matching versions for query "v1.5.0"
```

### Setup

```bash
git tag v1.5.0
git push origin main           # branch pushed
# tag NOT pushed
```

### Spot the bug

`git push` without `--tags` does not push tags. The tag exists locally but not on the remote.

### Fix

```bash
git push --tags
# or
git push origin v1.5.0
```

### Lesson

A tag is only published when both:
1. The remote has it.
2. The Go module proxy has fetched it (warmed by any consumer's `go get`).

Always include `--tags` in your release script, or use `git push origin <tag>` explicitly.

---

## Bug 14 — Two Majors Imported in the Same Package

### Symptom

The build compiles, but at runtime values cross between the two majors and the program panics with:

```
panic: interface conversion: *csvkit.Reader is not csvkit.Reader
```

### Setup

```go
// in pkg/process.go
package pkg

import (
    csvkit "github.com/alice/csvkit"
    csvkit2 "github.com/alice/csvkit/v2"
)

func Process(r io.Reader) {
    rdr := csvkit2.NewReader(r)            // returns *csvkit/v2.Reader
    handle(rdr)                             // declared as csvkit.Reader (v1)
}

func handle(r csvkit.Reader) { /* uses v1 methods */ }
```

### Spot the bug

`csvkit.Reader` (v1) and `csvkit/v2.Reader` are *different types*. The build compiles only because of an implicit conversion path (e.g., empty interface), but at runtime the type assertion fails.

### Fix

Pick one major per package. Mix only if the package explicitly does so for migration:

```go
package pkg

import csvkit2 "github.com/alice/csvkit/v2"

func Process(r io.Reader) {
    rdr := csvkit2.NewReader(r)
    handle(rdr)
}

func handle(r csvkit2.Reader) { /* uses v2 methods */ }
```

### Lesson

`/v2` modules give you the *option* of multi-major coexistence — they do not give you free interoperability. Treat the boundary between majors as a real type boundary; convert at the edges.

---

## Lessons Recap

| Bug | Lesson |
|-----|--------|
| 1 | The leading `v` is mandatory. |
| 2 | Update `module`, internal imports, and tag — together. |
| 3 | `+incompatible` means SIV was not adopted. |
| 4 | Internal imports must include `/vN`. |
| 5 | Local-path `replace` should never be committed. |
| 6 | Pseudo-versions are placeholders, not pins. |
| 7 | Never force-push tags. |
| 8 | `@latest` skips pre-releases — but mind unrelated tags. |
| 9 | Multi-module repos use prefixed tags. |
| 10 | `replace` doesn't propagate to consumers. |
| 11 | `retract` lives in the latest version of each major. |
| 12 | Minor bumps can introduce new transitive majors. |
| 13 | `git push --tags` or the tag is invisible. |
| 14 | Two majors are different types; convert at the edges. |
