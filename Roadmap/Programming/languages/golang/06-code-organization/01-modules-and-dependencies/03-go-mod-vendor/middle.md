# `go mod vendor` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go mod vendor` Actually Does (Step-by-Step)](#what-go-mod-vendor-actually-does-step-by-step)
3. [The `vendor/modules.txt` File: Format and Role](#the-vendormodulestxt-file-format-and-role)
4. [Auto-Detection: How Go Decides Whether to Use `vendor/`](#auto-detection-how-go-decides-whether-to-use-vendor)
5. [The `-mod` Flag (`mod`, `vendor`, `readonly`)](#the-mod-flag-mod-vendor-readonly)
6. [Vendoring and Build Tags / Cross-Platform Imports](#vendoring-and-build-tags-cross-platform-imports)
7. [What Is and Is NOT Vendored](#what-is-and-is-not-vendored)
8. [Vendor + Tidy Workflow Discipline](#vendor-tidy-workflow-discipline)
9. [Vendor in CI (the Deterministic-Build Case)](#vendor-in-ci-the-deterministic-build-case)
10. [Vendor and Workspaces (`go.work` Complications)](#vendor-and-workspaces-gowork-complications)
11. [Vendor and `replace` Directives](#vendor-and-replace-directives)
12. [Common Vendor Errors and Their Real Causes](#common-vendor-errors-and-their-real-causes)
13. [When Vendoring Is Right and When It Is Wrong](#when-vendoring-is-right-and-when-it-is-wrong)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the mechanical effect of `go mod vendor`: it copies dependencies into a `vendor/` folder, and once that folder exists the build uses it automatically. The middle-level question is *what does that folder actually contain*, *how does it stay synchronised with `go.mod`*, and *what does the toolchain do differently when it is present*.

This file zooms out from the command itself to the surrounding decisions: how vendoring interacts with build tags, with `replace` directives, with workspaces, and with CI; what is and is not copied; and when vendoring is the right answer versus an artefact of habit.

After reading this you will:
- Know exactly which files end up in `vendor/` and why
- Read and edit `vendor/modules.txt` confidently
- Diagnose every "inconsistent vendoring" error from first principles
- Decide between `-mod=mod`, `-mod=vendor`, and `-mod=readonly` for each environment
- Use the tidy-then-vendor workflow without drift
- Know when *not* to vendor

---

## What `go mod vendor` Actually Does (Step-by-Step)

The command is more interesting than its one-line description.

### Step 1 — Resolve the build list

Before copying anything, Go computes the *build list*: the exact set of `(module, version)` pairs that participate in this module's build. The build list is what `go list -m all` prints. It is the same list `go build` would use.

This step reads `go.mod`, `go.sum`, the module cache, and possibly the network (proxy or VCS) to fill in what is missing.

### Step 2 — Walk the package graph

For each module in the build list, Go walks the *packages actually imported* by your module — directly or transitively, across all GOOS/GOARCH/build-tag combinations it can see. Packages no one imports are skipped. Modules whose every package is unused are skipped entirely.

### Step 3 — Copy `.go` files (and a few siblings) per package

For each used package, the `.go` files reachable via the build graph are copied from `$GOPATH/pkg/mod/<module>@<version>/<pkg>/` into `vendor/<module>/<pkg>/`. Embedded files referenced by `//go:embed` are copied alongside them. License files (`LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `PATENTS`, with various extensions) are copied too — by heuristic, not by formal rule.

### Step 4 — Write `vendor/modules.txt`

This is the bookkeeping file. It records which modules are at which versions, which were depended on directly versus indirectly, and which packages from each were actually used. The `go` tool consults it on every subsequent build.

### Step 5 — Delete what is not needed

Any directory under `vendor/` that no longer corresponds to a used package is removed. `go mod vendor` is a *full rebuild* of `vendor/`, not an incremental update. If you delete `go.mod` and re-run, everything in `vendor/` will reflect that.

You can mostly think of `go mod vendor` as: read `go.mod`, then idempotently produce a `vendor/` that matches.

---

## The `vendor/modules.txt` File: Format and Role

Open `vendor/modules.txt` once and the whole vendoring system stops feeling magical.

A representative excerpt:

```
# github.com/spf13/cobra v1.8.0
## explicit; go 1.15
github.com/spf13/cobra
github.com/spf13/cobra/doc
# github.com/spf13/pflag v1.0.5
## explicit; go 1.12
github.com/spf13/pflag
# golang.org/x/sys v0.15.0
golang.org/x/sys/unix
golang.org/x/sys/windows
```

Line-by-line meaning:

| Line | Meaning |
|------|---------|
| `# <module> <version>` | A header introducing one module in the build list. |
| `## explicit` | Marker meaning the parent `go.mod` lists this module *directly* in `require`, not just transitively. |
| `## explicit; go 1.15` | Same as above, plus the `go` directive value from the dependency's own `go.mod`. |
| `<package path>` | A package from the module that was actually vendored. |

Rules to remember:

- The order of module headers matches `go.mod`.
- Modules with no used packages do not appear.
- A module that appears must be at the same version as `go.mod` says — otherwise the build is *inconsistent*.
- `## explicit` controls a subtle thing: whether the dep is allowed to disappear from the build without removing it from `go.mod`. Direct deps stay; indirect deps come and go.

You can read `vendor/modules.txt` to answer questions you would otherwise ask `go list -m`: what versions are pinned, what is direct, what is transitive.

You should not hand-edit it. The file is regenerated by `go mod vendor`, and any drift you create will show up as an inconsistent-vendoring error on the next build.

---

## Auto-Detection: How Go Decides Whether to Use `vendor/`

This is the part that surprises everyone the first time.

Since Go 1.14 the rule is: **if `vendor/modules.txt` exists and the module's `go` directive is `1.14` or newer, the build defaults to `-mod=vendor`**. No flag, no environment variable. The mere existence of the folder switches mode.

Concretely:

- `go build`, `go test`, `go run` — read from `vendor/`, ignore the module cache for build-list packages.
- `go mod tidy`, `go list -m`, `go get` — still read from the module cache and the network. They do not consult `vendor/`.
- `go vet`, `gopls` — follow the same `-mod` rule as `go build`, so they read from `vendor/`.

You can override the auto-detection in three places:

1. Command line: `go build -mod=mod`.
2. Environment: `GOFLAGS=-mod=mod`.
3. Tool config: editor settings for `gopls`, CI runner config.

Two consequences worth internalising:

- **Adding a `vendor/` folder silently changes build semantics.** If you commit a `vendor/` folder you did not intend, the next CI run will use it. If it is stale, the build breaks.
- **Removing `vendor/modules.txt` (alone) silently changes build semantics back.** Some sloppy `.gitignore` rules lead to this state; the `vendor/` folder ships but `modules.txt` does not, so Go falls back to the module cache and the vendored copies are dead weight.

The pair `vendor/modules.txt` + `vendor/<module>/...` is what activates vendor mode. Treat it as one artefact.

---

## The `-mod` Flag (`mod`, `vendor`, `readonly`)

`-mod` controls how the build interacts with `go.mod` and `vendor/`. Three values:

| Value | Behaviour |
|-------|-----------|
| `-mod=mod` | Use the module cache. May modify `go.mod` and `go.sum` (e.g., add a `require` if you import a new package). |
| `-mod=vendor` | Use `vendor/`. Refuse to build if `vendor/modules.txt` is inconsistent with `go.mod`. |
| `-mod=readonly` | Use the module cache. *Refuse* to modify `go.mod` and `go.sum`. Fail the build if they would have to change. |

Decision tree for picking one:

- *Local development on a clean machine with internet:* let auto-detection decide. If you do not have `vendor/`, you are in `-mod=mod` (or readonly, depending on Go version defaults).
- *Local development on a vendored project:* leave it alone — auto-detect picks `-mod=vendor`.
- *CI on a vendored project:* leave it alone — `-mod=vendor` again. Optionally add `-mod=vendor` explicitly for clarity.
- *CI on a non-vendored project:* `-mod=readonly` is the safety belt. It catches tidy drift instead of silently rewriting `go.mod`.
- *A script that genuinely should download a missing dep (`go get` flows):* `-mod=mod`.

In Go 1.16+ the *default* for `go build` outside vendor mode is already `-mod=readonly`. You only need to set it explicitly to override an inherited `GOFLAGS=-mod=mod`.

---

## Vendoring and Build Tags / Cross-Platform Imports

`go mod vendor` does not vendor *only* what your current GOOS/GOARCH builds. It walks the import graph across **all build-tag combinations the toolchain considers**. So a package that imports `golang.org/x/sys/unix` only on Linux *and* `golang.org/x/sys/windows` only on Windows will pull both into `vendor/`.

Why: a vendored project must build on every platform a non-vendored one would. The toolchain therefore vendors the union.

Practical consequences:

- `vendor/` is bigger than the packages your local build actually uses.
- A platform-specific bug fix upstream may not visibly land in your build, but the source is still in `vendor/` and a reviewer may grep it.
- Custom build tags (`-tags=integration`) *are* considered. If a file is tagged with `integration` and another file imports it, the dependency graph includes both branches.

The `-go` flag (`go mod vendor -go=1.21`) lets you pin the language version used to interpret build tags. It is rarely needed, but exists so that older codebases can produce reproducible vendor folders.

If you find a package missing from `vendor/` after a tidy+vendor cycle, the cause is almost always: that package is reached only by a build-tag combination the toolchain currently does not consider. Either the tag is not in `// +build` form Go understands, or the file lives in a `_test.go` (which is not part of the production build graph — see below).

---

## What Is and Is NOT Vendored

This is where surprise compiles come from.

### Vendored

- `.go` source files reachable through your module's *non-test* import graph.
- Files referenced by `//go:embed` directives in those `.go` files (templates, SQL, static assets, etc.).
- License-like files: `LICENSE*`, `COPYING*`, `NOTICE*`, `PATENTS*`, by heuristic match.
- Assembly files (`.s`) and cgo helpers (`.c`, `.h`) belonging to vendored packages.

### NOT vendored

- Test files (`*_test.go`) of your dependencies. Their imports are also not pulled in.
- Example files (`example_test.go`).
- Documentation (`README`, `CHANGELOG`, manpages, generated HTML).
- Files under directories the build system would never consider: `testdata/`, `_*` directories, `.*` directories.
- Tools your dependency uses for code generation (`go generate` targets).
- Sub-packages of a dependency that no one in your module imports.

The asymmetry around tests is the most common source of confusion. If you depend on `github.com/foo/bar` and want to run `go test github.com/foo/bar/...` from inside your project, you cannot — its test files are not in your `vendor/`. To test an upstream you must work in a clone of that module, not in a consumer that vendors it.

The `//go:embed` rule is the most useful one to remember in 2024+: vendoring no longer breaks templated/asset-heavy libraries the way it used to in early Go modules. If a library puts SQL migrations inside the package directory and embeds them, those migrations will land in `vendor/` automatically.

---

## Vendor + Tidy Workflow Discipline

The two commands form a pair. They should run together every time the dependency graph changes:

```bash
go mod tidy
go mod vendor
```

Mental model: `tidy` is the source of truth for `go.mod` and `go.sum`. `vendor` is a *projection* of those onto disk. Run them in this order, always.

What goes wrong if you do not:

- **Tidy without vendor:** `go.mod` updates but `vendor/modules.txt` falls behind. The next build (in `-mod=vendor`) fails with "inconsistent vendoring."
- **Vendor without tidy:** stale `require` lines, including `// indirect` markers, persist in `go.mod`. The vendored output is *consistent* but the dependency graph it reflects is bloated.
- **Tidy on one machine, vendor on another:** different Go toolchain versions can produce different `vendor/modules.txt` content (e.g., presence/absence of `## explicit; go 1.x` lines). Pin the toolchain.

A small wrapper script avoids drift:

```bash
#!/usr/bin/env bash
set -euo pipefail
go mod tidy
go mod vendor
git diff --exit-code -- go.mod go.sum vendor/
```

Run that locally before commit. Run the same in CI to catch the case where someone forgot.

---

## Vendor in CI (the Deterministic-Build Case)

For shops that vendor, CI typically follows one of two patterns.

### Pattern A — Vendor as gate

```bash
go mod tidy
go mod vendor
git diff --exit-code
```

If anything in `go.mod`, `go.sum`, or `vendor/` changed, fail the build. The author forgot to commit something.

This is fast (a no-op when up to date) and uncompromising. Adopt it for libraries and applications where deterministic dependencies are a contractual requirement.

### Pattern B — Trust the vendor folder

```bash
go build -mod=vendor ./...
go test  -mod=vendor ./...
```

No tidy, no regeneration. CI assumes the developer ran the workflow correctly and just builds. Faster on cold runners (no module cache warmup), but lets drift slip through if discipline lapses.

Most teams that vendor combine both: gate on regeneration in a "lint" job, then build with `-mod=vendor` in the actual test jobs.

The reason vendor mode shines in CI: **no network**. A vendored build is fully reproducible from the checked-out source tree. Outages of `proxy.golang.org` do not affect you. Air-gapped build agents work without proxy mirrors. SBOM generation reads from the working tree, not from the cache.

---

## Vendor and Workspaces (`go.work` Complications)

Workspaces and vendoring fight each other on first principles.

A workspace says "treat these N modules as one logical build, with each one able to see the others' source directly." Vendoring says "this single module's dependencies are frozen on disk, exactly as `go.mod` describes." If you mix the two, two questions arise:

1. Whose `vendor/` wins?
2. What about cross-workspace edges that go through a vendored copy?

Until Go 1.22, the answer was simply "`go build` ignores vendor when a `go.work` is active." The workspace took precedence. This was confusing and led many teams to delete `go.work` before running `go mod vendor`.

Go 1.22 added `go work vendor`. It produces a top-level `vendor/` folder consistent with all the modules in the workspace, treating the workspace as one big module. Caveats:

- All workspace modules share one `vendor/`. If two members depend on different versions of the same library, the workspace resolution wins (which is what `go work sync` would have done anyway).
- Per-module `vendor/` folders inside workspace members are ignored once `go work vendor` is in play.
- Tooling support is uneven — some IDE plugins still assume per-module vendoring.

Practical recommendation: in a workspace setup, treat `go.work` as a development-time overlay and do not commit `vendor/`. If you genuinely need vendored builds for a workspace, use `go work vendor` and pin the Go version.

---

## Vendor and `replace` Directives

`replace` and vendoring interact in a useful but counterintuitive way.

When `go.mod` says

```
replace github.com/old/lib => ../local-fork
replace github.com/old/other => github.com/myorg/other v0.5.1-fork
```

`go mod vendor` follows the replacement and copies the *target's* source into `vendor/`. But it preserves the *original* module path on disk:

```
vendor/github.com/old/lib/...           ← contents from ../local-fork
vendor/github.com/old/other/...         ← contents from github.com/myorg/other@v0.5.1-fork
```

Imports in your code keep saying `github.com/old/lib`. Consumers reading your `vendor/modules.txt` see the replaced version recorded as a comment.

Implications:

- A `replace` to a *local path* (`=> ../something`) lands in `vendor/` as a snapshot of that local path *at vendor time*. Future edits to `../something` are not reflected until you re-run `go mod vendor`.
- A `replace` to another module version is recorded with the replaced version metadata; reproducibility is preserved.
- Removing the `replace` and re-vendoring restores the original upstream source.

This makes vendoring a reasonable place to "freeze" a fork without publishing it. The downside is that the fork's provenance is hidden from anyone who doesn't read `go.mod` carefully — they will think they are looking at upstream code.

---

## Common Vendor Errors and Their Real Causes

A short field guide.

### `go: inconsistent vendoring`

The toolchain found a mismatch between `go.mod` and `vendor/modules.txt`. Most common causes:

1. Someone ran `go get` or hand-edited `go.mod` without re-running `go mod vendor`.
2. A merge conflict was resolved in `go.mod` but `vendor/` was not regenerated.
3. The `go` directive in `go.mod` was bumped, changing what counts as `## explicit; go 1.x`.

Fix: `go mod tidy && go mod vendor`. Commit the result.

### `cannot find package "..." in any of: ..., vendor/...`

The package is in `go.mod` but not in `vendor/`. Cause: vendor was generated when that import did not exist (e.g., another developer added the import without re-vendoring). Fix: same — tidy + vendor.

### `package X imports Y: cannot find module providing package Y`

Less common in vendor mode. Cause: a dependency you vendor in turn imports a package you do not have in `go.mod`. Possibly a build-tag or `_test.go` issue, or an unintentional import added during a refactor. Fix: add the missing module to `go.mod`, re-vendor.

### `go: updates to go.mod needed; to update it: go mod tidy`

You ran a build with `-mod=readonly` (the default in Go 1.16+) and the build wants to write to `go.mod`. You added an import without telling the module system. Fix: `go mod tidy`. The error is *protective*, not arbitrary.

### Silent duplication of vendored copies

`go mod vendor` produced two near-identical folders for what looks like the same dependency. Cause: a `replace` redirected one path to another version, but both paths still appear in your build graph. Resolution: rewrite imports to use one canonical path, then re-vendor.

---

## When Vendoring Is Right and When It Is Wrong

A decision matrix you can use during a design review.

| Situation | Vendor? | Why |
|-----------|---------|-----|
| Air-gapped or offline build environment | Yes | No proxy access at build time. |
| Compliance requirement: source of all dependencies in repo | Yes | Auditable, signed-off, no surprises. |
| Build farm with strict reproducibility (cryptographic signing) | Yes | The repo is the only input. |
| Slow or unreliable proxy / VCS | Yes | Avoids flakey builds. |
| Sealed-air container images that should never reach the internet | Yes | Same reason. |
| Team standardised on a private GOPROXY with full mirror | Maybe | The proxy already gives you reproducibility; vendor adds disk cost only. |
| Cloud-native CI with a warm module cache | No | The cache is faster than your `vendor/` in IO terms. |
| Personal or small library with public consumers | No | Vendoring leaks 100MB of `vendor/` into every clone. |
| Project under active dependency churn | No | Vendor diff noise drowns code review. |
| Monorepo with `go.work` | Probably no | Workspaces and vendoring fight. |

The pattern: **vendor when you need the build to be reproducible from the checked-out source alone**. Otherwise, do not.

---

## Best Practices for Established Codebases

1. **Treat `vendor/` as generated, not authored.** Never hand-edit a vendored file. If you need a patch, use `replace` and put the patch in a fork. The vendor folder regenerates from that.
2. **Run tidy and vendor as a pair.** Encode it in a `Makefile` target, a `justfile`, or a pre-commit hook. Document in `CONTRIBUTING.md`.
3. **Pin the Go toolchain.** Different toolchain versions emit slightly different `vendor/modules.txt`. The `toolchain` directive (Go 1.21+) avoids drift.
4. **Add a CI gate.** `git diff --exit-code` after `go mod tidy && go mod vendor` catches every mistake.
5. **Use `-mod=vendor` explicitly in CI scripts.** The auto-detection works, but explicit beats implicit when reading a build log.
6. **Do not vendor in libraries published for others.** Consumers generally do not want your `vendor/` folder; they have their own.
7. **Review `vendor/modules.txt` in PRs.** It is the most compact summary of what the dependency graph actually contains. Cheaper than reading every diff hunk under `vendor/`.
8. **Keep `vendor/` out of code search** in your IDE if possible. Most editors can be told to exclude it; most reviewers want to ignore it.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Vendor folder accidentally checked in by a junior

Someone ran `go mod vendor` to debug a build and committed the result. The next CI run silently switches to `-mod=vendor` and starts using stale dependencies. Symptom: build behaviour diverges from intent. Fix: delete `vendor/`, add it to `.gitignore` if your project does not vendor.

### Pitfall 2 — Vendored project broken after a `go get` update

Developer ran `go get -u ./...`, committed, did not re-vendor. The next checkout fails with "inconsistent vendoring." Fix: workflow discipline. The CI gate above catches this.

### Pitfall 3 — `replace ../local` vendored at the wrong moment

Developer pointed `replace` at a local path mid-refactor, ran `go mod vendor`, and committed. Now `vendor/` contains a half-baked version of the local fork. Fix: never vendor a `replace ../local`. Either fork-and-tag, or drop the replace before vendoring.

### Pitfall 4 — Embed assets missing from `vendor/`

A library uses `//go:embed templates/*.html`. After vendoring you discover a template is missing. Cause: the template lives in a sub-folder not imported as a Go package, but referenced via embed. Older Go versions did not vendor embedded files. Fix: ensure the project's `go` directive is at least `go 1.16` and re-run `go mod vendor`.

### Pitfall 5 — Tests pass on the developer's machine, fail in CI

The developer has the modules cached in `$GOPATH/pkg/mod`. CI runs in `-mod=vendor` (because `vendor/` is in the repo) but `vendor/` is incomplete. Cause: the package the test imports is reached only via a build tag CI uses. Fix: re-vendor under the same toolchain version CI uses.

### Pitfall 6 — `go test ./...` slowness from a huge `vendor/`

Test discovery walks the working tree. A 200MB `vendor/` slows down even unrelated commands. Fix: most tools respect `vendor/` exclusion automatically; for ad-hoc scripts, exclude `./vendor/...` explicitly. For repo size itself, decide whether vendoring is still worth it.

### Pitfall 7 — Two contributors regenerate `vendor/` with different toolchains

Person A on Go 1.21 produces one `modules.txt`; Person B on Go 1.22 produces a slightly different one. Their PRs alternately revert each other. Fix: pin the toolchain (`toolchain go1.22.4` in `go.mod`) and document the version in `CONTRIBUTING.md`.

### Pitfall 8 — A `go.work` file silently disabling vendor

A workspace is active in the repo root (`go.work` committed by accident). Builds use the workspace, not `vendor/`. The folder is on disk but unused. Fix: delete `go.work` from the repo, or migrate intentionally to `go work vendor`.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Describe the five steps `go mod vendor` performs internally
- [ ] Read `vendor/modules.txt` and explain every line
- [ ] State the auto-detection rule for vendor mode and the three ways to override it
- [ ] Choose between `-mod=mod`, `-mod=vendor`, and `-mod=readonly` for any given environment
- [ ] List what is and is not vendored (test files, examples, embed assets, licenses)
- [ ] Explain why `go mod tidy` and `go mod vendor` must run as a pair
- [ ] Build a CI gate that catches vendor drift
- [ ] Reason about how vendoring interacts with `replace`, `go.work`, and build tags
- [ ] Diagnose every error in the "Common Vendor Errors" section from a one-line message
- [ ] Articulate when vendoring is right and when it is over-engineering

---

## Summary

`go mod vendor` is mechanically simple — copy the build list's used packages into `vendor/<module>/<pkg>/` and write a `modules.txt` ledger — but it imposes a contract on the rest of the project. From the moment `vendor/modules.txt` lands on disk, every build silently prefers vendored sources, every drift between `go.mod` and `vendor/` becomes a build error, and every dependency change requires the tidy-then-vendor pair to stay consistent. Around the command sit the auto-detection rule, the `-mod` flag triad, the build-tag completeness guarantee, the embed-files inclusion, the workspace and `replace` interactions, and a small set of CI patterns that turn vendoring into either a reproducibility win or a recurring source of friction. Vendor when reproducibility from source matters more than disk; do not vendor by default; and once you do vendor, treat `vendor/` as a generated artefact that the toolchain owns.
