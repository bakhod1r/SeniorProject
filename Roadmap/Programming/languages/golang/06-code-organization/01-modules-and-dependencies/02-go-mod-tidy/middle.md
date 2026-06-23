# `go mod tidy` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go mod tidy` Actually Does](#what-go-mod-tidy-actually-does)
3. [The `go.mod` File After Tidying](#the-gomod-file-after-tidying)
4. [The `go.sum` File: How Tidy Updates It](#the-gosum-file-how-tidy-updates-it)
5. [Direct vs Indirect Dependencies in Depth](#direct-vs-indirect-dependencies-in-depth)
6. [Tidy and Network Access](#tidy-and-network-access)
7. [The `-go=<version>` and `-compat=<version>` Flags](#the-goversion-and-compatversion-flags)
8. [Tidy and Build Tags / Cross-platform Imports](#tidy-and-build-tags-cross-platform-imports)
9. [Tidy in CI: Drift Detection](#tidy-in-ci-drift-detection)
10. [Tidy and Workspaces (`go.work`)](#tidy-and-workspaces-gowork)
11. [Tidy and Vendoring](#tidy-and-vendoring)
12. [Common Tidy Errors and Their Real Causes](#common-tidy-errors-and-their-real-causes)
13. [When `go mod tidy` Will Not Save You](#when-go-mod-tidy-will-not-save-you)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know what `go mod tidy` does at the surface: it adds missing dependencies, removes unused ones, and keeps `go.sum` consistent. The middle-level question is *what algorithm runs underneath*, *which knobs change its behaviour*, and *which build configurations it considers when deciding what is "in use"*.

Tidy is the most-run module command in real projects. It is also one of the most misunderstood. The sentence "I just run `go mod tidy` before committing" hides a multi-stage walk over your import graph, a network resolution against the Go module proxy, an integrity check against checksum databases, and a graph-pruning algorithm that has changed between Go releases.

After reading this you will:
- Describe the internal pipeline tidy runs, in order
- Read every line of a non-trivial `go.mod` produced by tidy
- Understand why tidy sometimes pulls Windows-only or Plan 9 dependencies into your `go.sum` on a Linux laptop
- Use `-compat`, `-e`, and `-go` correctly
- Detect "tidy drift" in CI and fix it
- Explain why `go work sync` exists alongside `go mod tidy`
- Diagnose the four or five tidy errors that account for 90% of real bugs

---

## What `go mod tidy` Actually Does

Tidy is not a single operation. It is a pipeline. Roughly:

1. **Discover the build graph.** Tidy invokes the equivalent of `go list -e -deps ./...`, but with all build tags and all GOOS/GOARCH targets enabled. Every reachable `.go` file (including `_test.go` and `_*_test.go`) contributes its imports.
2. **Classify each import.** For every import path found, tidy must decide *which module provides it*. Standard-library imports are skipped. The rest go to step 3.
3. **Resolve modules with MVS.** *Minimum Version Selection*: for each required module, the toolchain picks the lowest version that satisfies every constraint in the transitive `require` graph. Tidy will upgrade only when needed; it never picks the latest by default.
4. **Update `go.mod`.** Add `require` lines for newly imported modules. Remove `require` lines for modules no longer reachable. Mark transitive-only modules with `// indirect`.
5. **Refresh `go.sum`.** Compute or fetch checksums (`h1:...`) for every module version actually selected, plus the `go.mod` of every module in the graph. Drop entries for modules no longer in the graph.
6. **Verify.** Cross-check checksums against the checksum database (`sum.golang.org`) unless `GONOSUMCHECK` or a `GOPRIVATE` rule excludes them.

A useful mental model: tidy reconciles three files — your `.go` source, your `go.mod`, and your `go.sum` — until they describe the same dependency graph.

### What tidy does *not* do

- It does not fetch the latest of anything by itself. (`go get -u ./...` does that.)
- It does not edit `replace`, `exclude`, or `retract` directives.
- It does not remove unused `replace` directives — they linger.
- It does not run your tests; it just inspects their imports.
- It does not vendor anything; you need `go mod vendor` for that.

---

## The `go.mod` File After Tidying

Before tidy, a `go.mod` may have stale lines, missing requires, or wrong indirect markers. After tidy, it should be a faithful summary of the build.

```
module github.com/alice/api

go 1.22

require (
    github.com/spf13/cobra v1.8.0
    golang.org/x/sync v0.6.0
)

require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
)
```

Things tidy guarantees here:

- Every package imported by a non-test or test file in your module is covered by some `require`.
- Every `require` block lists modules whose code is reachable in the build graph (under at least one OS/arch/build-tag combination).
- Direct deps (imported from your own code) are listed *without* `// indirect`.
- Transitive deps required to satisfy MVS are listed *with* `// indirect` (Go 1.17+).
- The `go` directive is kept as-is unless you pass `-go=<version>`.
- `replace`, `exclude`, `retract`, `toolchain`, `godebug` lines are left untouched.

### Why tidy splits `require` into two blocks

It is purely cosmetic. By convention, the first `require` block is direct deps; the second is indirect. Tidy will produce this layout. It is *not* required by the spec — a hand-written file with a single mixed block also parses — but tidy enforces the split for readability.

---

## The `go.sum` File: How Tidy Updates It

`go.sum` is a flat list of cryptographic checksums. Each module version in the graph contributes two lines:

```
github.com/spf13/cobra v1.8.0 h1:7aJaZx1B85qltLMc546zn58BxxfZdR/W22ej9CFoEf0=
github.com/spf13/cobra v1.8.0/go.mod h1:wHxEcudfqmLYa8iTfL+OuZPbBZkmvliBWKIezN3kD9Y=
```

The first hash covers the module's source tree. The second covers just the `go.mod` of that module — needed because MVS resolution requires reading transitive `go.mod` files even if their code is not selected.

### What tidy adds

Any module version that ends up in the build graph after MVS resolution. *Including* modules whose `go.mod` is read but whose source is never compiled — those still need `/go.mod` lines.

### What tidy removes

Any entries for module versions no longer reachable from the resolved graph. This is the "dropping unused checksums" behaviour that sometimes surprises people.

### When `go.sum` and `go.mod` disagree

If `go.mod` lists `cobra v1.8.0` but `go.sum` is missing the corresponding hashes, the next `go build` will refuse to proceed: *"missing go.sum entry for module providing package..."*. Tidy fixes this by re-fetching and writing the hashes. Conversely, if `go.sum` has stale entries for a module no longer used, tidy strips them.

### `go.sum` is append-only by other commands

`go get` adds checksums for new versions but does *not* remove old ones. After several `go get` runs, your `go.sum` accumulates entries for versions you no longer use. Tidy is the only command that prunes them.

---

## Direct vs Indirect Dependencies in Depth

The `// indirect` marker is small; its semantics are not.

**Direct** = imported by a `.go` file inside this module.
**Indirect** = required to build this module but not directly imported.

Indirect dependencies appear because of:

1. A direct dep transitively requires them.
2. A direct dep's `go.mod` requires them, even if they are not currently imported.
3. Go 1.17 graph pruning: your `go.mod` now records transitive go-deps so the toolchain can avoid downloading further graphs.

Tidy adds, removes, and re-marks `// indirect` automatically:

- A new file imports a previously-indirect module: tidy strips `// indirect`.
- The last file importing a module is deleted: tidy adds `// indirect` *or* removes the line entirely if no transitive need remains.
- A direct dep is upgraded and now requires a previously-unlisted indirect: tidy adds it with `// indirect`.

You should never hand-edit the `// indirect` marker. Tidy is the source of truth.

---

## Tidy and Network Access

Tidy is a *network-using* command. It contacts:

1. The configured `GOPROXY` (default `https://proxy.golang.org,direct`).
2. The checksum database `sum.golang.org` (controlled by `GOSUMDB`).
3. The version-control system directly, for paths matched by `GOPRIVATE` or `GONOSUMCHECK`.

If you are offline, tidy fails with errors like *"dial tcp: lookup proxy.golang.org: no such host"*. Workarounds:

- `GOFLAGS=-mod=mod GOPROXY=off go mod tidy` will only work if every module is already in your module cache (`$GOPATH/pkg/mod/cache/download`).
- `GOPROXY=off` plus a populated module cache lets tidy run fully offline. Useful in air-gapped CI.
- `GOPROXY=file:///path/to/local/proxy` works against an internally-mirrored proxy (Athens, JFrog, Sonatype Nexus, etc.).

`GOFLAGS` matters: setting `GOFLAGS=-mod=vendor` will *prevent* tidy from running at all — vendor mode disables module resolution. To run tidy in a vendored project, override: `GOFLAGS=-mod=mod go mod tidy`.

### Private modules

For internal modules on a private host:

```
export GOPRIVATE=corp.example.com
```

This skips the public proxy and checksum database for those paths, so tidy will reach the private VCS directly. You still need credentials configured (typically via `~/.netrc` or Git credential helpers).

---

## The `-go=<version>` and `-compat=<version>` Flags

Two flags worth knowing.

### `-go=<version>`

Sets the `go` directive in `go.mod` to a specific version *while running tidy*:

```
go mod tidy -go=1.22
```

Effect: tidy applies the resolution rules for that Go version. The most consequential rule it enables is **graph pruning** (introduced in Go 1.17). Pre-1.17 `go.mod` files only listed direct deps and the modules they directly required; 1.17+ files list the full set needed by the main module's build, which lets builds skip downloading transitive `go.mod` files.

If you upgrade `go 1.16` to `go 1.17` in your `go.mod`, the very next `go mod tidy` will add many `// indirect` lines you did not have before. This is normal.

### `-compat=<version>`

Specifies the *oldest* Go version whose builds should still work after tidy. Default in Go 1.17+: one minor version below the current `go` directive.

```
go mod tidy -compat=1.21
```

Why it matters: with graph pruning, a Go 1.17+ tidy may produce a `go.mod` that builds correctly under modern Go but breaks under 1.16. The `-compat` flag forces tidy to also keep the entries needed by the older toolchain, even if they would otherwise be pruned.

If you maintain a library that promises support for older Go versions, set `-compat` to the floor of that promise.

### `-e` ("keep going on errors")

```
go mod tidy -e
```

Tells tidy to continue past errors rather than abort on the first one. Useful when:

- A few packages have broken imports you plan to delete anyway.
- The module proxy is intermittently failing for one dep but you want everything else updated.
- You are migrating a large codebase and want the partial result.

`-e` is not a fix; it is a *diagnostic*. Inspect the warnings it prints.

---

## Tidy and Build Tags / Cross-platform Imports

This is the section most middle-level Go developers do not know about, and it explains many "why is *that* in my go.sum?" mysteries.

By default, tidy considers **all GOOS, GOARCH, and build-tag combinations**. That means:

- A file gated `//go:build windows` contributes its imports to the graph even on a Linux developer's machine.
- A file gated `//go:build cgo && linux && amd64` contributes its imports even when you build with `CGO_ENABLED=0` on macOS arm64.
- A test file gated `//go:build integration` contributes its imports even though normal tests skip it.

The reasoning: a published module must work for *all* its consumers, no matter their platform. If your library imports `golang.org/x/sys/windows` on Windows, `go.sum` must record that dep so a Windows consumer can build reproducibly.

### When this surprises you

```
go mod tidy
git diff
+ require golang.org/x/sys/windows v0.20.0 // indirect
```

You did not add Windows-specific code. But a dep you upgraded did, and tidy now records it. This is correct.

### `-compat=1.17` and platform behaviour

In Go 1.17 the default tidy behaviour changed: it still walks all platform combinations, but graph pruning means many of those entries are no longer materialised in `go.mod`. Setting `-compat=1.17` keeps the safer (larger) graph; raising `-compat` shrinks `go.mod` but increases the chance that an older toolchain encounters a missing entry.

### When you genuinely want platform-specific tidying

You do not. The toolchain does not provide a "tidy only for current GOOS/GOARCH" option. Vendoring (`go mod vendor`) is the closest option, since the vendor directory only contains files for build configurations the build needs *to compile your packages*, not for all consumers of your module.

---

## Tidy in CI: Drift Detection

The single most useful CI integration of tidy is the **drift check**:

```bash
go mod tidy
git diff --exit-code -- go.mod go.sum
```

If the diff is non-empty, the developer forgot to commit a tidy. Fail the build. This guards against:

- A new import was added but `go.mod` was not updated.
- A removed package left orphan `// indirect` entries.
- Hand-edits to `go.sum` that no longer match resolved versions.
- A team member ran a different Go version and got a different graph.

Some teams run this check as a pre-push hook *and* in CI; both are cheap and catch different kinds of drift.

### CI environment expectations

- Module cache must be populated or warm. `actions/setup-go` with cache enabled handles this.
- `GOPROXY` must be reachable, or you must pre-seed a vendor directory.
- The CI runner's Go version must match (or be compatible with) the developer's. Mismatched versions can produce different `go.mod` outputs because of graph-pruning rules.

### The "compat" CI matrix

For libraries supporting multiple Go versions, run tidy in CI on the *oldest supported version* and verify no diff. If the oldest version produces different output than the newest, your `-compat` is wrong.

---

## Tidy and Workspaces (`go.work`)

Inside a `go.work` workspace, tidy still operates on a single module at a time. There is no `go mod tidy ./modA ./modB`. Each module has its own `go.mod` and gets its own tidy.

### `go work sync` is the workspace-level command

```bash
go work sync
```

This pushes the resolved versions from the workspace's `go.work.sum` *back into* each member module's `go.mod` and `go.sum`. After `go work sync`, the member modules have a consistent view of shared dependencies.

It is *not* the same as running `go mod tidy` inside each module:

- `go work sync` propagates versions; it does not remove unused requires.
- `go mod tidy` removes unused requires; it does not coordinate across workspace members.

A common pattern: `go work sync && (cd modA && go mod tidy) && (cd modB && go mod tidy)`.

### Tidy inside a workspace can pick "wrong" versions

When a workspace `use`s a local module, tidy in another workspace member that depends on it will see the local copy. If the local copy has uncommitted changes, tidy may resolve to a version that does not exist on the proxy. Symptom: builds work locally and fail in CI. Solution: commit and tag the dependency before running tidy outside the workspace, or run tidy without the workspace active (`GOWORK=off go mod tidy`).

---

## Tidy and Vendoring

`vendor/` and `go mod tidy` interact through a defined contract.

### The canonical sequence

```
go mod tidy        # reconcile go.mod and go.sum with imports
go mod vendor      # populate vendor/ from the resolved graph
git add go.mod go.sum vendor/
```

Order matters. Vendoring before tidying produces a `vendor/` that may include entries no longer needed (or miss new ones).

### What `go mod vendor` does

It copies the source files of every module version listed in `go.mod` into `vendor/`. Only files needed for the module's build configurations are copied — `vendor/` is naturally smaller than the module cache.

After `go mod vendor`, the build defaults to `-mod=vendor`: imports are resolved from `vendor/` rather than the module cache. This produces fully offline, fully reproducible builds.

### Vendor drift

If you `go get` a new dep but forget `go mod vendor`, the build fails: *"package github.com/x/y is not in std (... ) or vendor/..."*. The CI fix is the same vendor-drift check:

```bash
go mod tidy
go mod vendor
git diff --exit-code -- go.mod go.sum vendor/
```

### Vendor and `replace`

Vendor honours `replace` directives — the replacement source is what ends up in `vendor/`. This is useful for committing a local fork as part of the vendored tree.

---

## Common Tidy Errors and Their Real Causes

### `missing go.sum entry`

```
missing go.sum entry for module providing package github.com/x/y; to add: go mod download github.com/x/y
```

Cause: `go.mod` lists the module but `go.sum` is missing the corresponding hashes. Often happens when `go.mod` was committed but `go.sum` was not, or `go.sum` was hand-edited.

Fix: run `go mod tidy` (preferred) or `go mod download`.

### `inconsistent vendoring`

```
inconsistent vendoring in /path/to/project:
  github.com/x/y@v1.2.3: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
```

Cause: `vendor/` was built against a different `go.mod`. Someone updated `go.mod` but did not re-run `go mod vendor`.

Fix: `go mod vendor`.

### `module path mismatch`

```
go: github.com/x/y@v1.2.3: parsing go.mod: module declares its path as: github.com/x/y but was required as: github.com/X/Y
```

Cause: case mismatch in the module path. macOS treats them as the same; Linux does not.

Fix: correct the casing of every import line.

### `ambiguous import`

```
github.com/x/y/v2: ambiguous import: found package github.com/x/y/v2 in multiple modules
```

Cause: two different modules at incompatible paths both claim to provide the package, often because of a botched v2 transition.

Fix: usually a `replace` directive to disambiguate, plus a real fix in the offending module.

### `unknown revision`

```
go: github.com/x/y@v1.2.3: unknown revision v1.2.3
```

Cause: the version was deleted from the upstream proxy or VCS, or never tagged in the first place.

Fix: pick a different version. If you have a copy in your module cache, you may be able to force-publish it to your private proxy.

### `verifying module: checksum mismatch`

Cause: the module's content does not match the checksum database. Either the module was tampered with or you have a stale entry.

Fix: investigate. Do *not* blindly delete `go.sum` and re-tidy — that defeats the security guarantee.

---

## When `go mod tidy` Will Not Save You

Tidy is powerful but bounded. It will not fix:

### Hand-edited `go.mod` that violates the spec

Tidy parses the file. If your edit is syntactically invalid, tidy aborts with a parse error and refuses to do anything.

### `replace` directives pointing to invalid paths

Tidy honours `replace` but does not validate that the target exists or is itself a valid module. A `replace github.com/x/y => ../missing` will surface as a different error (during build), not a tidy error.

### Retracted versions you have explicitly pinned

Since Go 1.16, retracted versions are skipped by `go get` upgrades. But if your `go.mod` already pins a retracted version, tidy will *keep* the pin. You see a warning at build time, not a tidy error. Fix: `go get module@latest` or pick a non-retracted version manually.

### Modules without proper version tags

If you depend on a private repo that has no `vX.Y.Z` tags, the module gets a *pseudo-version* (`v0.0.0-yyyymmddhhmmss-shortsha`). Tidy keeps the pseudo-version. It will not promote it to a real version. Fix: tag the upstream.

### Cross-module refactors

Tidy operates on a single `go.mod`. If you split a module into two and the import paths change, every consuming module needs its own tidy run after its imports are updated. There is no `go mod tidy ...` that walks a workspace.

### Build-time misconfigurations

If `GOFLAGS=-mod=vendor` is set in your shell, tidy refuses to run. The error is clear once you know it; the first time you hit it, it looks like tidy is broken.

---

## Best Practices for Established Codebases

1. **Run tidy before every commit that changes imports.** Make it a habit; consider a pre-commit hook.
2. **Run a tidy-drift check in CI.** A clean `git diff` after tidy is the contract.
3. **Use `-compat` matched to your minimum supported Go version.** This is a stability promise, not a curiosity.
4. **Pair `go mod tidy` and `go mod vendor` if you vendor.** Always in that order.
5. **Do not hand-edit `go.sum`.** Ever. Run tidy.
6. **Keep `replace` directives sparse and labelled.** A line comment explaining why each replace exists saves enormous future debugging time.
7. **Avoid mixing tidy across Go major versions in the same repo.** Pick one Go version for the team and lock it in CI.
8. **Audit `// indirect` markers on review.** They tell you what the dependency closure looks like.
9. **Never run tidy on a release branch without a clean checkout.** A stray edit can trigger unintended bumps.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Tidy keeps re-adding a line you delete

You delete a `require` line; you run `go build`; the build adds it back. You delete it; tidy re-adds it. The cause: a build-tagged file imports it, often a `_test.go` or a Windows-only file. Use `go mod why github.com/x/y` to trace the import.

### Pitfall 2 — Tidy keeps re-removing a line you add

The opposite case: you hand-add a `require` for a module not actually imported. Tidy removes it on the next run. Either (a) you actually need to import it from your code, or (b) you wanted a tool dependency, which is handled differently (`tools.go` with a build tag).

### Pitfall 3 — `go.sum` exploded after a small upgrade

You bumped a single dep by one minor version. Now `go.sum` has 60 new lines. The cause: the new minor version pulled in a chain of new transitive deps. Inspect with `go mod graph`. This is normal, not a bug.

### Pitfall 4 — Tidy works locally, fails in CI

The team is on Go 1.22; CI runs Go 1.21. Graph pruning differs slightly between versions. Pin the same Go version in CI as on developer machines; use `toolchain` if necessary.

### Pitfall 5 — Tidy fetches packages on a corporate network and stalls

The default `GOPROXY=https://proxy.golang.org` is blocked by corporate egress rules. Tidy hangs until timeout. Configure an internal proxy mirror: `export GOPROXY=https://goproxy.corp.example.com`.

### Pitfall 6 — Two developers tidy the same branch and get different `go.mod`s

Their module caches are different; one of them has a stale entry that the proxy has since changed. Symptom: alternating commits. Fix: `go clean -modcache && go mod tidy`. This forces a fresh fetch.

### Pitfall 7 — A `replace` pointing to a local fork breaks tidy

`replace github.com/x/y => ../localfork`. Then you delete `../localfork`. Tidy errors with an inscrutable message about the replace target. Fix: remove the replace before removing the directory, or restore the target.

### Pitfall 8 — Tests pass without tidy

A new test file imports a package not yet in `go.mod`. The build still succeeds because Go fetches the dep on-the-fly. You commit. CI fails with "missing go.sum entry." The CI drift check catches this; without one, you ship broken builds.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Describe the tidy pipeline from `go list` through MVS to checksum write
- [ ] Explain why `go.sum` needs both `h1:` lines and `/go.mod h1:` lines
- [ ] Distinguish direct from indirect deps and predict when tidy adds or removes the marker
- [ ] Explain why a Linux-only build still records Windows-only requires
- [ ] Use `-compat`, `-go`, and `-e` correctly
- [ ] Build a CI drift check and explain what it catches
- [ ] Distinguish `go mod tidy` from `go work sync` and use them together
- [ ] Coordinate `go mod tidy` and `go mod vendor` correctly
- [ ] Diagnose every error in [Common Tidy Errors](#common-tidy-errors-and-their-real-causes) from a stack trace

---

## Summary

`go mod tidy` is a multi-stage reconciliation: it walks every reachable import under every build configuration, resolves modules with MVS against the proxy, updates `go.mod` and `go.sum`, and prunes anything that is no longer needed. Around it sits a vocabulary (`// indirect`, graph pruning, `-compat`, `-go`, `-e`) and a contract with the rest of the toolchain (`go.sum`, `vendor/`, `go.work`, the proxy, the checksum database). Used well, tidy is the developer's promise to the codebase that `go.mod` matches reality. Used badly, it is the source of CI flakes, mysterious cross-platform requires, and unreproducible builds. The middle-level habit is simple: run tidy, run the drift check, commit both files together, and never hand-edit `go.sum`.
