# Module Versioning — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Semantic Import Versioning (SIV)](#semantic-import-versioning-siv)
3. [The `/v2` Path Rule in Depth](#the-v2-path-rule-in-depth)
4. [Repository Layout for Multi-Major](#repository-layout-for-multi-major)
5. [The `+incompatible` Marker](#the-incompatible-marker)
6. [Releasing Breaking Changes Gracefully](#releasing-breaking-changes-gracefully)
7. [Compatibility Promises](#compatibility-promises)
8. [Coordinating with Consumers](#coordinating-with-consumers)
9. [Cross-Module Coexistence Strategies](#cross-module-coexistence-strategies)
10. [Detecting Compatibility Breaks Mechanically](#detecting-compatibility-breaks-mechanically)
11. [Anti-Patterns at Major Bump Time](#anti-patterns-at-major-bump-time)
12. [Senior Checklist](#senior-checklist)
13. [Summary](#summary)
14. [Related Topics](#related-topics)

---

## Introduction

A senior engineer is no longer asking "how do I tag a release?" They are asking: *should this be a major bump? what does a major bump cost the ecosystem? what is the migration story? can the breaking change be expressed without a major at all?*

This file is about answering those questions well. The mechanics of `git tag v2.0.0` and the `/v2` path rule are tools; the senior question is when to use them, what alternatives exist, and how to release a major version that consumers do not resent.

---

## Semantic Import Versioning (SIV)

Go applies a strict version of semver: **the major version is part of the import path for v2 and beyond.** This is called Semantic Import Versioning.

The rule:

| Major version | Module path | Import |
|---------------|-------------|--------|
| `v0.x.x` | `github.com/alice/csvkit` | `import "github.com/alice/csvkit"` |
| `v1.x.x` | `github.com/alice/csvkit` | `import "github.com/alice/csvkit"` |
| `v2.x.x` | `github.com/alice/csvkit/v2` | `import "github.com/alice/csvkit/v2"` |
| `v3.x.x` | `github.com/alice/csvkit/v3` | `import "github.com/alice/csvkit/v3"` |

`v0` and `v1` share a path because no breaking-change promise has been made yet (`v0`) or has just been made for the first time (`v1`).

### Why SIV exists

Two problems would hurt Go without it:

1. **Diamond dependency conflicts.** If lib A pinned `csvkit v1` and lib B pinned `csvkit v2`, MVS would have to pick one — and one of them would break. Different paths for different majors mean both can be imported simultaneously.

2. **Silent breaking-change rollouts.** Without SIV, a consumer running `go get -u csvkit` could be moved from v1 to v2 silently. The path change forces an explicit decision: *"I am opting into v2 by changing my imports."*

### The cost of SIV

- **Migration is more work.** A `v1`→`v2` bump means rewriting every import line in every consumer.
- **Tooling sees two paths as two libraries.** Some IDEs and refactoring tools do not realise `csvkit` and `csvkit/v2` are siblings.
- **First-time newcomer friction.** "Why does the import path have a `/v2`?" is one of the most-asked questions in Go.

The benefits outweigh the costs at scale. They feel disproportionate at small scale.

---

## The `/v2` Path Rule in Depth

### Where the suffix appears

Three places must agree:

1. The `module` line in `go.mod`:
    ```
    module github.com/alice/csvkit/v2
    ```

2. Every internal import within the module:
    ```go
    import "github.com/alice/csvkit/v2/internal/parser"
    ```

3. Every external consumer's import:
    ```go
    import "github.com/alice/csvkit/v2"
    ```

If any of the three disagrees, the build fails or links the wrong major.

### Where the suffix does *not* appear

- **The Git repo URL.** It is still `github.com/alice/csvkit`, regardless of major.
- **The package name inside the source.** Most packages still declare `package csvkit` regardless of major.
- **Prose in the README.** You can say "csvkit v2" colloquially.

### When the rule kicks in

Only at `vN >= 2`. Within `v0` and `v1`, the suffix is forbidden. At `v2`, it becomes mandatory.

### What `go.mod` looks like at v2

```
module github.com/alice/csvkit/v2

go 1.22

require (
    github.com/...
)
```

The `module` line carries the `/v2`. The rest is identical to a v1 `go.mod`.

### What internal imports look like at v2

```go
package csvkit

import (
    "github.com/alice/csvkit/v2/internal/parser"
    "github.com/alice/csvkit/v2/internal/buffer"
)
```

Every internal import gains the `/v2`. Forgetting one means that file silently links against the v1 version of the helper, which is almost always a bug. Tools like `gomajor` automate this rewrite.

### What consumers see

```go
import (
    csvkit "github.com/alice/csvkit/v2"  // explicit alias optional
)
```

Some consumers alias to `csvkit` to avoid `v2.Reader` everywhere. The package's declared name (`package csvkit`) is unchanged, so the alias is rarely needed.

---

## Repository Layout for Multi-Major

Two layouts are recognised by the Go toolchain.

### Subfolder layout

```
github.com/alice/csvkit/
├── go.mod                    (module github.com/alice/csvkit)
├── reader.go                 (v1 code)
└── v2/
    ├── go.mod                (module github.com/alice/csvkit/v2)
    └── reader.go             (v2 code)
```

Both versions live on `main`. Consumers import each by its path. Tags: `v1.5.3` is shared (they look at the `go.mod` to know what major is meant — actually a tag like `v1.5.3` applies to the v1 module, while a tag `v2.0.0` is read against the `v2/go.mod`). Effectively each major has its own independent tag namespace, distinguished by Go reading the `go.mod`.

**Pros:** one branch to reason about; refactoring across versions is easy; CI is straightforward.
**Cons:** the `v2/` directory in the source tree confuses some linters; large diff for a major bump.

### Branch layout

```
main branch (v2):
├── go.mod                    (module github.com/alice/csvkit/v2)
└── reader.go                 (v2 code)

release-v1 branch:
├── go.mod                    (module github.com/alice/csvkit)
└── reader.go                 (v1 code)
```

The major version lives in the module path of each branch's `go.mod`. Tags: `v1.5.3` on `release-v1`, `v2.0.0` on `main`. Each branch is its own world.

**Pros:** main is always the latest major; cleaner repo layout; mirrors how the Go project itself is structured for some modules.
**Cons:** more branch hygiene; backporting fixes is per-branch.

### Choosing between them

| If you... | Pick... |
|-----------|---------|
| Want one mental model, one branch | Subfolder |
| Plan to maintain v1 for years after v2 | Branch |
| Have a small library | Subfolder |
| Already have a long-lived `release-vN` workflow | Branch |
| Use vendoring or specialised IDE tooling | Test both with your tools first |

---

## The `+incompatible` Marker

`+incompatible` is what Go invented for repos that ignored SIV.

### How it appears

If a Git repo at `github.com/legacy/lib` has tags `v0.x.x`, `v1.x.x`, *and* `v2.x.x` *and* its `go.mod` does **not** declare the `/v2` path, Go labels v2+ versions as "incompatible":

```
require github.com/legacy/lib v2.5.0+incompatible
```

The `+incompatible` suffix means: "I am importing v2 of this module, but the module is not opt-ed into SIV. Buyer beware."

### When does Go emit `+incompatible`?

When all three are true:
1. There is a tag `vN.x.x` for `N >= 2`.
2. There is no `/vN` directory or branch with a `go.mod` declaring the `/vN` path.
3. A consumer asks for the `vN.x.x` version.

### Why is it a problem?

`+incompatible` modules cannot have multi-major coexistence. A consumer cannot have both `v1.5.0` and `v2.0.0+incompatible` of the same library in one build — they have the same import path, so MVS picks one (the higher one), and the older code may break.

### Common causes

- A repo that existed before Go modules and never adopted SIV.
- A maintainer who tagged `v2.0.0` without updating the module path.
- A maintainer who deliberately avoided `/v2` because "the import path is uglier."

### How to fix it (as the maintainer)

1. Choose subfolder or branch layout for v2.
2. Update `go.mod` to declare `module github.com/.../v2`.
3. Update every internal import to include `/v2`.
4. Tag a *new* v2.x.y release. The `+incompatible` versions remain in the proxy but are now "history."

### How to handle it (as a consumer)

Use the `+incompatible` version if you must, but plan to migrate. Pin the version explicitly:

```
require github.com/legacy/lib v2.5.0+incompatible
```

If a fix exists upstream (someone has done the SIV opt-in), switch to the SIV version on the same release.

### When `+incompatible` is acceptable

For small, internal-only modules with one consumer: shrug. For widely-published libraries: it is always worth the migration.

---

## Releasing Breaking Changes Gracefully

A major bump is the loudest possible release. Senior engineers minimise the noise.

### Rule 1 — Break only when the design demands it

Most breaking changes can be deprecated in place:

```go
// Deprecated: use ReadAll instead. Will be removed in v3.0.0.
func ReadCSV(r io.Reader) ([][]string, error) { return ReadAll(r) }

func ReadAll(r io.Reader) ([][]string, error) { ... }
```

The old function still works. Linters warn callers. v3.0.0 (months or years later) removes it.

If you cannot model the change as a deprecation, then a major bump is justified.

### Rule 2 — Pre-release, then release

Two weeks before v2.0.0:

```bash
git tag v2.0.0-rc.1
git push --tags
```

Announce. Collect feedback. Fix issues in `rc.2`. Tag `v2.0.0` only after a quiet `rc`.

### Rule 3 — Migration guide

A migration guide is *the* deliverable of a major bump. It should:

- List every breaking change with before/after examples.
- Provide a search-and-replace recipe for common patterns (`sed` snippets, `gomajor` invocations).
- Estimate migration effort for a typical consumer.

A migration guide that says "v2 is mostly compatible with v1" is usually a lie; consumers will discover the gaps the hard way.

### Rule 4 — Automate the rewrite when possible

For renames and signature changes, ship a [`gopls` rewrite rule](https://pkg.go.dev) or a `go fix`-style tool. The fewer manual steps a consumer has to make, the more of them will upgrade.

### Rule 5 — Maintain v1 for a stated window

Most consumers will not migrate immediately. Continue to ship security fixes on `v1.x.x` for at least 6 months after v2.0.0. State this policy publicly.

### Rule 6 — Tag deliberately

Once `v2.0.0` is tagged, you cannot withdraw it. The proxy caches it forever. Tag only when:

- The CI is green on every supported platform.
- The CHANGELOG is complete.
- The migration guide is published.
- The maintenance branch (`release-v1`) is set up.

---

## Compatibility Promises

Library authors publish (implicitly or explicitly) a *compatibility promise*. The strictness of the promise is your choice; consumers calibrate trust to the promise.

### The Go 1 promise as a model

The Go core team's promise: *code that compiles against Go 1 will continue to compile and run against every later 1.x release.* Behaviour is preserved; new features are additive.

This is the gold standard for libraries. Variants:

| Promise level | Description |
|---------------|-------------|
| **Go 1 strict** | Source-compatible across all minors. Bug fixes preserve documented behaviour. |
| **Go 1 with grey zone** | Source-compatible, but performance characteristics may change; some bug fixes alter undocumented behaviour. |
| **Major-only stable** | Compatibility within a major; pre-releases of the next major may break. |
| **No promise** | v0 lifestyle. Can break in any release. |

State your promise in the README.

### What counts as "the surface"

- Every exported package, type, function, method, variable, constant.
- The signature of every exported function.
- The fields of every exported struct that consumers might construct directly.
- The methods of every exported interface that consumers might implement.
- The set of named errors comparable with `errors.Is`.

### What does not count

- Internal helpers (use `internal/` to enforce this).
- Unexported fields.
- Implementation details of interface satisfaction.
- Performance characteristics, unless documented.
- Documentation prose itself, unless it makes specific guarantees.

### Adding a method to an interface

This is the classic stealth break. If your library exports `type Reader interface { Read(...) }` and you add `Close()` to it, every external implementation of `Reader` is now broken.

Workaround: define a new interface that embeds the old one.

```go
type Reader interface {
    Read(p []byte) (int, error)
}

type ReadCloser interface {
    Reader
    Close() error
}
```

`ReadCloser` is purely additive. `Reader` is unchanged. Functions that need close-capability declare `ReadCloser`; functions that do not still take `Reader`.

### Adding a field to a struct

Generally safe *if* consumers always construct the struct via a constructor or always treat it as opaque. Unsafe if consumers do:

```go
v := lib.Config{Name: "x", Port: 8080}
```

Adding a field changes the keyed-literal-without-defaults contract: the new field defaults to zero, which is fine, but if a future field cannot have a sensible zero value, you have a problem.

The safe pattern: an opaque-by-convention struct with constructor and option functions.

```go
cfg := lib.NewConfig(lib.WithName("x"), lib.WithPort(8080))
```

---

## Coordinating with Consumers

### Pre-announcement

For projects with significant adoption: announce the upcoming major two to four weeks before tagging it. Include:

- The motivation for the major bump.
- The scope of breaking changes.
- A rough migration timeline.
- The window during which v1 will continue to receive fixes.

Channels: a blog post, the project's mailing list, an issue pinned in the tracker.

### Migration guide

Concrete before/after for every breaking change. Example:

```
v1: csvkit.Read(r) returns ([][]string, error).
v2: csvkit.Read(r) returns (*csvkit.Records, error).

Migration:
  -records, err := csvkit.Read(r)
  +rec, err := csvkit.Read(r)
  +records := rec.Rows()
```

A `MIGRATING.md` file at the repo root is the canonical place. Link it from the v2 release notes.

### Maintenance branch

```bash
git checkout main
git checkout -b release-v1
git push -u origin release-v1
```

Future v1.x.y fixes go on this branch. Tag from this branch.

### Release-day mechanics

1. Tag `v2.0.0-rc.1`. Push.
2. Wait two weeks. Collect feedback.
3. Tag `v2.0.0-rc.2` if needed. Wait one more week.
4. Tag `v2.0.0`. Push.
5. Same day: tag `v1.X.0` (the final v1 minor) on `release-v1`, marking the v1 line "feature-frozen."
6. Publish blog post / changelog / migration guide.
7. Pin the migration guide in the issue tracker.

---

## Cross-Module Coexistence Strategies

Two strategies for making the v1→v2 migration painless.

### Strategy 1 — Adapter package

Inside v2, ship a `compat/` sub-package that mirrors the v1 API and translates calls to v2 internally.

```go
// in github.com/alice/csvkit/v2/compat
package compat

import "github.com/alice/csvkit/v2"

// Read mirrors v1's Read. Use only during migration.
func Read(r io.Reader) ([][]string, error) {
    rec, err := csvkit.Read(r)
    if err != nil {
        return nil, err
    }
    return rec.Rows(), nil
}
```

Consumers can import `csvkit/v2/compat` initially and migrate package-by-package.

### Strategy 2 — Allow simultaneous import

Because the import paths differ, `csvkit` (v1) and `csvkit/v2` can coexist in the same binary. A consumer can:

1. Add a v2 import alongside the v1 import.
2. Migrate one file at a time.
3. Remove the v1 import once nothing references it.
4. Run `go mod tidy`.

This works as long as the two majors do not share types via interface surface (each has its own type system).

---

## Detecting Compatibility Breaks Mechanically

You should not rely on humans to spot every breaking change.

### `gorelease`

```bash
go install golang.org/x/exp/cmd/gorelease@latest
gorelease -base=v1.5.0 -version=v1.6.0
```

Reports whether the proposed change between two refs is compatible with the version bump rule. Catches:

- Removed exported symbols.
- Changed signatures.
- Removed methods from interfaces.
- Removed struct fields.

Use in CI to fail on accidental breaks before tagging.

### `apidiff`

A lower-level tool from `golang.org/x/tools` that computes a structural API diff between two snapshots. Useful when you need to understand exactly what changed.

### `golangci-lint` with `staticcheck`

Catches `Deprecated:` comment uses, missing comments on exported symbols, and other markers of poor compatibility hygiene.

### Runtime contract tests

Some breaking changes are behavioural, not surface-level. A "tightened input validation" change may compile but reject inputs that previously worked. Maintain a contract test suite that exercises every documented use case; run it against every release candidate.

---

## Anti-Patterns at Major Bump Time

- **Bumping major to "clean up names."** Use `Deprecated:` and add new names alongside.
- **Bumping major because the dependency you use bumped major.** That is your library leaking implementation details. Hide the dependency behind your own interface.
- **Going `v2.0.0` straight from `v1.0.0` without RCs.** Untested change is risky change.
- **Tagging `v2.0.0` before updating the module path.** Produces an unusable release.
- **Forgetting `/v2` in *internal* imports.** New module silently links against old version.
- **Removing v1 from the proxy.** You cannot. Even retraction does not remove the bytes. Plan for v1 to exist forever.
- **No migration guide.** Adoption stalls.
- **No maintenance branch.** Consumers on v1 cannot get security fixes; they may abandon you instead of migrating.
- **Multiple breaking changes per major.** Combine reasons, but do not invent reasons. Consumers should perceive each major bump as paying for one big improvement, not five small ones.

---

## Senior Checklist

Before tagging any major version:

- [ ] The motivation is documented and not aesthetic
- [ ] Every breaking change has a `MIGRATING.md` entry
- [ ] At least one release candidate has been tagged and tested
- [ ] `gorelease` has been run and confirms the bump is correct
- [ ] The `module` path in `go.mod` ends with `/vN`
- [ ] Every internal import inside the module includes `/vN`
- [ ] The maintenance branch (`release-v(N-1)`) exists
- [ ] A v(N-1) maintenance window is publicly stated
- [ ] CHANGELOG is complete
- [ ] CI is green on every supported platform
- [ ] An adapter package or migration helper is published if migration is large
- [ ] The release announcement is queued
- [ ] The proxy is warmed for the new tag (`go list -m <path>@vN.0.0`)

For ongoing compatibility hygiene:

- [ ] `gorelease` runs in CI on every PR
- [ ] `apidiff` snapshots stored against every released minor
- [ ] `Deprecated:` markers used aggressively in place of major bumps
- [ ] `internal/` used aggressively to reduce surface area
- [ ] Compatibility promise stated in README

---

## Summary

Major-version strategy is the senior frontier of module versioning. SIV (the `/vN` path rule) makes coexistence possible at the cost of migration ceremony. `+incompatible` is what Go does for repos that ignored the rule; it is acceptable only as a transitional state. Releasing a major version is a project event with announcement, RC cycle, migration guide, and maintenance branch — not a casual `git tag`.

Avoid major bumps when you can express the change as a deprecation. When you must, do it loudly and slowly. Your compatibility promise is the contract between your library and every consumer who has ever depended on you; the promise outlasts the code.

---

## Related Topics

- [middle.md](middle.md) — pseudo-versions, pre-releases, replace, retract
- [professional.md](professional.md) — MVS algorithm internals
- [6.2.3 Publishing Modules — Senior](../02-packages/03-publishing-modules/senior.md) — overlapping content on stability tiers, deprecations, and security releases
- The Go blog post "Go Modules: v2 and Beyond" at `go.dev/blog/v2-go-modules`
- `gorelease` and `gomajor` tools for major-bump automation
