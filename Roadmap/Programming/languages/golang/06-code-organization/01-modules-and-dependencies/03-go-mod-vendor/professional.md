# `go mod vendor` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go mod vendor` Actually Does, Step by Step](#what-go-mod-vendor-actually-does-step-by-step)
3. [The `vendor/modules.txt` Format in Detail](#the-vendormodulestxt-format-in-detail)
4. [The Auto-Detection Algorithm](#the-auto-detection-algorithm)
5. [The `-mod`, `-modfile`, and `GOFLAGS` Interactions](#the-mod-modfile-and-goflags-interactions)
6. [Build List Construction Inside Vendor](#build-list-construction-inside-vendor)
7. [Cross-Build-Configuration Discovery](#cross-build-configuration-discovery)
8. [What Is Excluded From `vendor/`](#what-is-excluded-from-vendor)
9. [Vendor and Embedded Files (`//go:embed`)](#vendor-and-embedded-files-goembed)
10. [Vendor Verification (`go mod verify`, hash checks)](#vendor-verification-go-mod-verify-hash-checks)
11. [Performance Profile](#performance-profile)
12. [Programmatic Equivalents](#programmatic-equivalents)
13. [Vendor in CI/CD Pipelines](#vendor-in-cicd-pipelines)
14. [Hermetic Builds with Vendor + Toolchain Pinning](#hermetic-builds-with-vendor-toolchain-pinning)
15. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
16. [Operational Playbook](#operational-playbook)
17. [Summary](#summary)

---

## Introduction

The professional level treats `go mod vendor` not as a single command but as the surface area of a contract between three subsystems: the module graph resolver, the package loader, and the build toolchain. The command writes a directory tree, but every byte it writes is later consumed by the loader under strict consistency checks. Misunderstanding those checks is the single most common source of opaque "inconsistent vendoring" failures in CI.

This file is for engineers who maintain Go infrastructure, build vendor-aware tooling, run private build farms, or own the correctness of hermetic builds. After reading you will:

- Know what `go mod vendor` does internally, in pseudocode, end-to-end.
- Reason about `vendor/modules.txt` as a grammar with consistency invariants.
- Understand exactly when the toolchain auto-selects `-mod=vendor` and when it does not.
- Know which files are copied, which are excluded, and why.
- Build vendor-aware tooling without re-implementing the toolchain.
- Operate hermetic build farms whose only network event is `git clone`.

`go mod vendor` is conceptually simple — copy dependencies into the repo — but its details govern reproducibility for the next decade of the project. Treating it as "just a copy" misses the consistency machinery that makes it safe.

---

## What `go mod vendor` Actually Does, Step by Step

The command lives in `cmd/go/internal/modcmd/vendor.go` of the Go distribution. Stripped to essentials, the flow is:

1. **Load `go.mod`.** Parse the module file and apply `replace` and `exclude` directives.
2. **Run MVS** to produce the build list — exactly one version per module path.
3. **Enumerate the import graph** of the main module, across every supported `(GOOS, GOARCH, build-tag)` triple, to find the transitive set of packages that *could* be imported by any build of this module.
4. **Locate each package** in the module cache at `$GOPATH/pkg/mod/<module>@<version>/<sub-package>/`.
5. **Copy `.go` files** plus a fixed set of license-like files (`LICENSE`, `LICENSE.*`, `COPYING`, `COPYING.*`, `PATENTS`, `NOTICE`) and any embedded assets referenced by `//go:embed`.
6. **Write `vendor/modules.txt`** describing the build list, the explicit dependencies, the Go directive, and the package list per module.
7. **Delete the previous `vendor/`** if it existed, atomically replacing it with the new state.

There are no network calls *if* the module cache is already populated. If it is not, `go mod vendor` first triggers downloads via the proxy, just like any other module-aware command.

### Pseudocode

```go
func runVendor(ctx context.Context) error {
    modFile := loadGoMod()
    buildList := mvs.BuildList(modFile)            // one version per module
    pkgs := loadAllPackagesAcrossPlatforms(modFile)// every (GOOS,GOARCH,tag)

    if err := os.RemoveAll("vendor"); err != nil {
        return err
    }
    for _, pkg := range pkgs {
        srcDir := modCachePath(pkg.Module, pkg.Version, pkg.Subpath)
        dstDir := filepath.Join("vendor", pkg.ImportPath)
        copyGoSources(srcDir, dstDir)              // .go but not _test.go
        copyLicenses(pkg.Module.Root, dstDir)
        copyEmbedAssets(pkg, srcDir, dstDir)       // //go:embed targets
    }
    writeModulesTxt("vendor/modules.txt", buildList, pkgs, modFile)
    return nil
}
```

The actual implementation has more polish — temporary-directory atomicity, deterministic ordering of `modules.txt`, error reporting — but the shape is identical. Reading `vendor.go` and `modload/build.go` together gives you the whole story in well under a thousand lines.

---

## The `vendor/modules.txt` Format in Detail

`vendor/modules.txt` is the only "metadata" file in `vendor/`. It is not optional — without it the toolchain refuses to use vendor mode. Its grammar, paraphrased from `cmd/go/internal/modload/vendor.go`:

```
modules.txt   := { module-block }
module-block  := module-header { marker } { package-line }
module-header := "# " modulepath " " version [ " => " replacement ] "\n"
marker        := "## explicit\n"
              |  "## explicit; go " version "\n"
              |  "## go " version "\n"
package-line  := modulepath "/" subpackage "\n"
```

Worked example:

```
# github.com/google/uuid v1.6.0
## explicit; go 1.19
github.com/google/uuid
# golang.org/x/sys v0.18.0
## explicit; go 1.18
golang.org/x/sys/unix
golang.org/x/sys/internal/unsafeheader
# rsc.io/quote v1.5.2 => ./local/quote
## explicit; go 1.12
rsc.io/quote
```

Three semantic layers:

- **Module headers** identify the resolved version. A `=>` clause indicates a `replace` directive — local path or alternate module — that the toolchain will look up at *vendor* path, not the original module path.
- **Markers** record metadata. `## explicit` means the parent `go.mod` has a `require` line for this module (i.e., a *direct* dependency). `go <ver>` records the dependency module's own `go` directive — needed for language-version compatibility checks.
- **Package lines** list every importable sub-package of that module that is reached by any build configuration of the main module.

### Why `modules.txt` exists

The format duplicates information that is already in `go.mod`. The duplication is intentional. When the toolchain runs in vendor mode, it must decide:

1. Is the vendor tree consistent with the requirements declared in `go.mod`?
2. For each import, which module owns it, at which version?

`go.mod` answers (1). `modules.txt` answers (2) without the toolchain having to walk the module cache. The vendor tree is then *self-describing* — a build can proceed with no module cache present at all.

### The consistency check

Before each vendor-mode build, the toolchain compares `vendor/modules.txt` against `go.mod`:

- Every direct dependency in `go.mod` must appear with `## explicit` in `modules.txt`.
- Every required module/version in `go.mod` must be declared by a header in `modules.txt`.
- Every `replace` directive must be reflected in the corresponding header's `=>` clause.
- The Go directives must be consistent.

Mismatch produces the canonical error: `inconsistent vendoring in <dir>: ... run 'go mod vendor' to sync`. This is the toolchain's way of refusing to run with a stale or hand-edited vendor tree.

---

## The Auto-Detection Algorithm

Since Go 1.14, the toolchain selects `-mod=vendor` automatically when two conditions hold:

1. `vendor/modules.txt` exists.
2. The main module's `go` directive is `1.14` or later.

If either fails, the default is `-mod=readonly` (Go 1.16+) or `-mod=mod` (older).

In pseudocode:

```go
func defaultMode(modFile *modfile.File) string {
    if exists("vendor/modules.txt") &&
       semver.Compare("v"+modFile.Go.Version, "v1.14") >= 0 {
        return "vendor"
    }
    if goVersion >= "1.16" {
        return "readonly"
    }
    return "mod"
}
```

Implications:

- A repo with a `vendor/` directory but `go 1.13` in `go.mod` does *not* auto-select vendor mode. Bumping the `go` directive to 1.14+ is the supported way to opt in.
- A repo whose `vendor/modules.txt` is deleted but whose `vendor/` source tree remains will *not* use vendor mode — the metadata file is the trigger.
- Downstream consumers of a library do not inherit the library's vendor mode. Vendor is a property of the *main module* of a build, not of dependencies.

### Explicit override

`-mod=mod`, `-mod=readonly`, or `-mod=vendor` on the command line, or `GOFLAGS=-mod=...`, override auto-detection. This is the recommended approach in CI: be explicit so a deleted `modules.txt` does not silently change the build's behaviour.

---

## The `-mod`, `-modfile`, and `GOFLAGS` Interactions

Three orthogonal switches govern module-aware behaviour:

| Flag | Effect |
|------|--------|
| `-mod=mod` | Read and *write* `go.mod`. Network is allowed. Used during `go get` workflows. |
| `-mod=readonly` | Read `go.mod`. Refuse to write it. Network is allowed for read-only fetch. |
| `-mod=vendor` | Use only `vendor/`. Refuse network. Requires `vendor/modules.txt`. |
| `-modfile=path` | Use `path` as `go.mod` instead of the file in the working directory. |

In vendor mode:

- The module cache is **not consulted** for source code. Even if a module is in the cache at the right version, vendor wins.
- Network access for module fetch is **disabled**. The toolchain treats vendor as authoritative.
- `go.sum` is still consulted for `go.mod` checksums of dependencies (their `go.mod` text is hashed into `go.sum`), but module zip hashes are skipped because no zip is fetched.

`GOFLAGS=-mod=vendor` is the recommended way to lock CI into vendor mode regardless of what files happen to exist on disk. This protects against a botched checkout that leaves `vendor/modules.txt` missing.

---

## Build List Construction Inside Vendor

When the toolchain runs in vendor mode, it does *not* rerun MVS. The build list is read directly from `vendor/modules.txt`. This is a deliberate design choice:

- It guarantees that the build sees exactly the versions that were resolved when `go mod vendor` last ran.
- It removes any dependency on the network or the module cache.
- It makes the build list inspectable as a plain text file.

The price is that any time `go.mod` changes — a new `require`, a new `replace`, a version bump — `go mod vendor` must be re-run to refresh `modules.txt`. The consistency check enforces this discipline at build time.

---

## Cross-Build-Configuration Discovery

`go mod vendor` does not just copy the packages reached by *your current platform's* build. It copies the packages reached by *any* platform's build of the main module. Specifically, the loader iterates over every relevant `(GOOS, GOARCH)` pair plus declared build tags and gathers the union of imports.

This is necessary because vendor must support cross-compilation. If you `go mod vendor` on Linux and then run `GOOS=windows go build`, the Windows-only package must already be in `vendor/`. The loader pre-emptively pulls all of them.

Files within a vendored package are also kept whole — even `linux_amd64`-suffixed source files end up in `vendor/`. The build constraint system filters them at compile time, not at vendor time.

### Implication

Vendoring tends to copy *more* code than a single-platform build needs. For projects targeting only one platform, this is acceptable overhead. For repository size budgets, be aware that exotic platform support in dependencies (e.g., `golang.org/x/sys`) materially inflates the vendor tree.

---

## What Is Excluded From `vendor/`

`go mod vendor` is selective. The following are *not* copied:

- **Test files of dependencies.** Files matching `*_test.go` in any vendored package are skipped. Your own test files in your main module are unaffected.
- **`testdata/` directories of dependencies.** The Go convention reserves `testdata` for test fixtures; not needed for builds.
- **Example sub-packages** that are reachable only from tests.
- **`internal/` directories of *other* modules** that could not have been imported anyway. (The `internal` rule blocks cross-module imports of `.../internal/...` paths, so vendoring them would be wasted bytes.)
- **Non-Go, non-license, non-embedded files.** A `README.md` or a `Dockerfile` from a dependency does not get copied.
- **Hidden files** (`.git`, `.travis.yml`, etc.).
- **Build artifacts** that accidentally landed in the module cache (rare in practice, since the cache is content-addressed from a clean zip).

The license files specifically copied are matched by name: `LICENSE`, `LICENSE.txt`, `LICENSE.md`, `COPYING`, `COPYING.LIB`, `PATENTS`, `NOTICE`, and a handful of common variants. This is the toolchain's hand-rolled allowlist; it is not a regex. The intent is to preserve license attribution for the redistributed source.

---

## Vendor and Embedded Files (`//go:embed`)

`//go:embed foo.txt` declares that a `.go` file embeds a file at compile time. The vendor command reads each package's `embed` directives and copies every referenced asset to the vendor tree. Without this, embedded assets would be missing at vendor-mode build time.

The implementation:

1. Parse each `.go` file with `go/parser` to find `//go:embed` directives.
2. Resolve glob patterns against the module's source directory.
3. Add each resolved file to the copy list.

Edge cases:

- `//go:embed dir/*` glob expansion is performed at vendor time. The resolved file list is what gets copied, not the directory.
- Embedded files inside `testdata/` of a dependency are still skipped, because the package containing the embed must be a non-test package for the embed directive to be valid.
- Symlinks within embed targets are followed; the target file is copied, not the link.

This is the only situation where `go mod vendor` copies non-Go, non-license content from dependencies.

---

## Vendor Verification (`go mod verify`, hash checks)

A common misconception is that vendoring bypasses checksum verification. It does not.

`go mod verify` re-hashes everything in the module cache against `go.sum`. It does not directly hash `vendor/`, because `vendor/` files have been transformed (test files removed, layout reorganised). But:

- The `go.mod` file of every dependency is still hashed into `go.sum`. Vendor or not, that hash is verified on every build.
- `go mod vendor` itself reads from the module cache; if the cache contents diverge from `go.sum`, vendor refuses to run.
- Hand-edits to `vendor/` source files do not change `go.sum`. They will pass `go mod verify` (because verify hashes the cache, not vendor) but they will fail `go mod vendor` consistency at the next refresh, because the source-of-truth cache will overwrite them.

The professional rule: never hand-edit `vendor/`. Treat it as a build artifact, even though it lives in version control. If you need to patch a dependency, use a `replace` directive pointing to a fork or a local path, then `go mod vendor` again.

---

## Performance Profile

Vendor is mostly file I/O. The work is:

- Parse `go.mod` — milliseconds.
- Run MVS over the module graph — typically tens of milliseconds.
- Enumerate packages across platform configurations — proportional to the number of build configurations times the number of packages.
- Walk and copy each package directory — bounded by disk write speed.
- Format and write `modules.txt` — milliseconds.

A 50-dependency project on warm cache: ~1 second. A 500-dependency project: a few seconds. With cold cache, the dominant cost shifts to the proxy fetches that populate the cache before vendoring proceeds — minutes for a large dependency graph on a slow connection.

After the initial run, repeat invocations of `go mod vendor` are roughly idempotent and fast: same input produces the same output, and the toolchain wholesale-replaces the directory rather than performing a diff. This makes "is `vendor/` in sync?" cheap to check in CI: re-run `go mod vendor` and `git diff --exit-code vendor/`.

### Comparison

| Operation | Cold cache | Warm cache |
|-----------|------------|------------|
| `go mod download` (50 deps) | 30–60 s | < 1 s |
| `go mod vendor` (50 deps) | 30–60 s + ~1 s | ~1 s |
| `go build ./...` (vendor mode) | network-free; CPU-bound | network-free; CPU-bound |
| `go build ./...` (mod mode, cold) | minutes | seconds |

Vendor's value proposition: trade disk space and check-in size for build-time network independence.

---

## Programmatic Equivalents

When tooling needs to inspect or replicate vendor behaviour without shelling out, three building blocks help:

### `go list -m -json all`

Emits the full build list as JSON. Each record includes `Path`, `Version`, `Replace`, `Indirect`, and `GoMod` (cache path). This is the safest way to enumerate dependencies in the same order MVS resolves them.

```bash
go list -m -json all | jq -r 'select(.Main != true) | "\(.Path) \(.Version)"'
```

### `golang.org/x/mod/modfile`

Parses `go.mod` programmatically. Useful for tools that read `require` and `replace` directives without re-implementing the grammar.

```go
data, _ := os.ReadFile("go.mod")
f, _ := modfile.Parse("go.mod", data, nil)
for _, r := range f.Require {
    fmt.Println(r.Mod.Path, r.Mod.Version)
}
```

### `golang.org/x/mod/module` and `golang.org/x/mod/modfile`

Together they cover module-path validation, version comparison (`semver`), and `go.mod` round-tripping. The toolchain itself uses these packages, so reusing them yields identical behaviour.

### When to shell out

Building a `vendor/` tree from scratch with these libraries alone is brittle: the MVS implementation, embed parsing, license-file enumeration, and `modules.txt` generation are non-trivial and will drift between Go releases. The supported approach is to shell out to `go mod vendor` and parse its output, not to re-implement it.

---

## Vendor in CI/CD Pipelines

Vendor is most useful in CI when the build pipeline has high reliability requirements: no network during the build, no proxy outage exposure, byte-stable artifacts.

### Pattern: vendor-only CI

```yaml
- run: go env -w GOFLAGS=-mod=vendor
- run: go build ./...
- run: go test ./...
```

The build is fully hermetic from the moment the source is checked out.

### Pattern: vendor freshness gate

```yaml
- run: go mod vendor
- run: git diff --exit-code vendor/ go.mod go.sum
```

If `go mod vendor` would change anything, fail the build. Forces developers to keep `vendor/` in sync.

### Pattern: cache `vendor/` artifact

```yaml
- uses: actions/cache@v4
  with:
    path: vendor
    key: vendor-${{ hashFiles('go.sum') }}
```

`vendor/` is content-derivable from `go.sum`, so a cache keyed on `go.sum` hash is correct by construction. A cache hit eliminates even the initial `go mod download` cost.

### Pattern: skip the module cache entirely

Once `vendor/` is present and `-mod=vendor` is the mode, `$GOPATH/pkg/mod` is not read. Pruning it on the CI runner saves disk and proves no dependency on cache state.

### Pattern: `go.sum`-locked vendor in monorepo

In multi-module monorepos, each `go.mod` directory may have its own `vendor/`. Tooling must either iterate per-module or adopt workspaces; vendor in workspaces is supported as of Go 1.22.

---

## Hermetic Builds with Vendor + Toolchain Pinning

True hermeticity requires more than vendor:

- **Toolchain pin.** Use the `toolchain go1.22.4` directive in `go.mod`, or pin via the runner image. The toolchain version affects code generation, optimisation, and even the contents of generated reflection metadata.
- **Vendor.** Locks dependency *source bytes*.
- **Build flags.** `-trimpath` removes absolute file paths from the binary; `-buildvcs=false` removes VCS state. Both improve reproducibility.
- **Environment.** Pin `CGO_ENABLED`, `GOOS`, `GOARCH`, and any `LDFLAGS`/`CFLAGS`.

A reproducibility CI gate:

```yaml
- run: go build -trimpath -buildvcs=false -o build1 ./cmd/app
- run: go clean -cache
- run: go build -trimpath -buildvcs=false -o build2 ./cmd/app
- run: cmp build1 build2
```

If the binaries differ, something — often `go:generate` time embedding, embedded VCS state, or non-deterministic source — is escaping the pin. Vendor alone fixes the dependency dimension; the others must be addressed independently.

### Vendor + offline build

A complete offline build requires:

1. `vendor/` populated.
2. `GOFLAGS=-mod=vendor`.
3. `GOPROXY=off` (refuse any accidental fetch).
4. The toolchain installed locally.

With these four, `go build` is provably hermetic against the network. This is the standard for regulated environments and reproducible scientific builds.

---

## Edge Cases the Source Reveals

A close reading of `cmd/go/internal/modcmd/vendor.go` and `modload/vendor.go` exposes corners most users never hit:

- **`replace` to a local path.** `replace foo => ./local/foo`: vendor copies the local directory's source under `vendor/foo`. The `=>` clause in `modules.txt` records the replacement. CI must check the local path into the same repository, or the vendor tree alone is incomplete.
- **`replace` to another module.** `replace foo => bar v1.0.0`: vendor places `bar`'s source at `vendor/foo`, with `modules.txt` recording the path swap. The build still imports `foo` paths.
- **Non-canonical module paths.** A module whose canonical path differs from its filesystem location (legacy GOPATH-era code) will be vendored at its canonical path, not its disk path.
- **Case-insensitive filesystems.** macOS default and Windows can collide modules that differ only in case. The toolchain warns; CI should run on a case-sensitive filesystem to detect this.
- **Embedded directories** with thousands of files balloon the vendor tree. Audit dependencies' `//go:embed` patterns.
- **Modules whose `go` directive is newer than your toolchain.** Vendoring records the version in `modules.txt`; the build may fail with a clearer message than without vendor.
- **A retracted version.** `go mod vendor` will still vendor a retracted version if `go.mod` requires it. `go mod tidy` is the command that surfaces retraction warnings; vendor is downstream of tidy.
- **Empty packages.** A package with zero `.go` files (only docs) is not vendored. Importing it would fail anyway.

These are not facts to memorise but pointers to *reach for the source* when something unexpected happens. The vendor implementation is well-commented and tractable in an afternoon's reading.

---

## Operational Playbook

A condensed reference for common operational scenarios.

| Scenario | Recipe |
|----------|--------|
| Adopt vendor for a fresh module | Bump `go` directive to 1.14+, run `go mod vendor`, commit `vendor/`. |
| Verify vendor is in sync | `go mod vendor && git diff --exit-code vendor/ go.mod go.sum`. |
| Force vendor mode in CI | `GOFLAGS=-mod=vendor` at the job level. |
| Forbid network during build | `GOPROXY=off` plus `-mod=vendor`. |
| Patch a dependency locally | Add `replace foo => ./forks/foo` in `go.mod`; `go mod vendor`. |
| Resolve "inconsistent vendoring" error | `go mod tidy && go mod vendor`; commit. |
| Reduce vendor size | Drop unused dependencies via `go mod tidy`; vendor again. |
| Audit license attribution | Walk `vendor/**/{LICENSE,COPYING,NOTICE}` files; aggregate. |
| Reproducibility check | Build twice with `go clean -cache` between; `cmp` the binaries. |
| Debug a missing import in vendor | `grep -r '<package>' vendor/modules.txt`; if absent, the package wasn't reached by any `(GOOS, GOARCH)` enumeration — check build tags. |
| Remove vendor opt-in | Delete `vendor/`; set `GOFLAGS=-mod=mod` or rely on `-mod=readonly` default. |
| Vendor in a workspace | Go 1.22+: `go work vendor` builds a workspace-level `vendor/`. |

---

## Summary

`go mod vendor` is a deceptively simple command: copy dependencies into the repository so builds work offline. The professional engineer's understanding includes the contract that copy creates with the rest of the toolchain — `vendor/modules.txt` as a self-describing build list, the auto-detection rule that ties vendor to `go ≥ 1.14`, the consistency check that refuses stale vendor trees, the cross-platform package enumeration that vendors more than a single build needs, the embed-aware copy step, and the precise rules that exclude tests, examples, and other modules' `internal/`.

Mastering those layers turns vendor from a black-box convention into a precise tool: a way to convert "my build depends on the network" into "my build depends on bytes already in my repository." Combined with toolchain pinning, `-trimpath`, and `GOPROXY=off`, vendor produces builds that are reproducible across machines and across years — which, for infrastructure engineers, is the whole point.

The simplicity of the command is by design. Complexity lives in the consistency machinery and in the cross-configuration package walk, not in the byte-copy. Knowing where the complexity actually sits is itself the senior insight.
