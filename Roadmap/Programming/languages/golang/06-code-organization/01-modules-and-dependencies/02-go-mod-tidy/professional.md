# `go mod tidy` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go mod tidy` Actually Does, Step by Step](#what-go-mod-tidy-actually-does-step-by-step)
3. [Build List Construction and MVS Inside Tidy](#build-list-construction-and-mvs-inside-tidy)
4. [The `-compat` Flag and Module Graph Pruning (Go 1.17+)](#the-compat-flag-and-module-graph-pruning-go-117)
5. [Cross-Build-Configuration Import Discovery](#cross-build-configuration-import-discovery)
6. [The `go.sum` Update Algorithm](#the-gosum-update-algorithm)
7. [Network Interaction: Proxy, Sumdb, Cache](#network-interaction-proxy-sumdb-cache)
8. [Performance Profile of Tidy](#performance-profile-of-tidy)
9. [Programmatic Equivalents](#programmatic-equivalents)
10. [Tidy in CI/CD Pipelines](#tidy-in-cicd-pipelines)
11. [Hermetic Builds and `-mod=readonly`](#hermetic-builds-and-modreadonly)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

`go mod tidy` is the toolchain's *reconciliation engine*: it makes `go.mod` and `go.sum` faithfully describe the project's actual import graph. Where `go mod init` is a single bootstrap write, `tidy` is a multi-pass loop that loads every package across every relevant build configuration, runs Minimum Version Selection (MVS), prunes or unprunes the module graph depending on the declared Go version, fetches anything missing from a proxy, verifies it against the checksum database, and writes the canonical result back to disk.

This file is for engineers who maintain Go infrastructure, build tooling on top of the module system, run private proxies, or are responsible for hermetic-build correctness at scale. The focus is *what the toolchain actually does inside `go mod tidy`*, with references to source-code structure and protocol behaviour.

After reading this you will:
- Know the exact phases the implementation in `cmd/go/internal/modcmd/tidy.go` and `cmd/go/internal/modload` runs.
- Reason about the cross-platform import discovery that surprises Linux-only teams with `darwin`-only deps.
- Predict the network shape of a tidy run from cache state and `GOPROXY` configuration.
- Use `golang.org/x/mod` and `golang.org/x/tools/go/packages` to reproduce tidy's effects programmatically.
- Configure CI to enforce tidiness without making cold-cache runs unbearably slow.
- Diagnose the "tidy diff in CI" class of failure from first principles.

---

## What `go mod tidy` Actually Does, Step by Step

The command is implemented in [`cmd/go/internal/modcmd/tidy.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modcmd/tidy.go) but most of the work happens inside [`cmd/go/internal/modload`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/). The high-level flow:

1. **Load the main module's `go.mod`.** Parse `module`, `go`, `toolchain`, `require`, `exclude`, `replace`, `retract` directives.
2. **Determine the module graph mode.** Pruned (Go 1.17+) or unpruned (Go 1.16 or earlier).
3. **Enumerate every package in the main module.** Walk the file tree under the module root, skip `_*`, `.*`, and `testdata` directories.
4. **For each package, parse imports under every (GOOS, GOARCH, build-tag) combination.** Crucially, this is the union of all platforms by default — see Section 5.
5. **Resolve each import to a module.** Match the longest module-path prefix from the build list; if no match, query the proxy for candidates.
6. **Run MVS.** Walk the transitive `require` graph from the main module, picking the maximum required version per module path.
7. **Apply `replace` and `exclude` directives.** Substitute or filter accordingly.
8. **Reconcile `require` entries.** Add missing direct/indirect requires; remove unused ones; mark each as `// indirect` if no main-module package imports it directly.
9. **Optionally re-run MVS at `-compat` Go version.** If `-compat=1.17` is set, verify that an older toolchain produces the same build list; if not, write extra explicit requires to keep it consistent.
10. **Compute and write `go.sum` entries** for every module in the resulting build list (and their `go.mod` files).
11. **Format and write `go.mod`.** Through `golang.org/x/mod/modfile`, preserving comments and directive ordering.

There is no "minimal change" mode. Tidy always writes the canonical full result.

### Pseudocode

```go
func runTidy(ctx context.Context, args []string) error {
    main := loadMainModule()                  // parses ./go.mod
    pruned := main.GoVersion >= "1.17"

    // Phase 1: discover all packages and imports across all build configs.
    allImports := map[string]struct{}{}
    for _, pkg := range walkMainModulePackages(main.Root) {
        for _, cfg := range allBuildConfigs() { // GOOS x GOARCH x tags
            for _, imp := range parseImports(pkg, cfg) {
                allImports[imp] = struct{}{}
            }
        }
    }

    // Phase 2: resolve imports -> modules, building requirements.
    rs := initialRequirements(main.GoMod)
    for imp := range allImports {
        mod, ver := resolveImportToModule(imp, rs)
        if ver == "" {
            ver = queryLatestSuitable(mod)   // proxy round-trip if uncached
        }
        rs.add(mod, ver)
    }

    // Phase 3: MVS.
    buildList := mvs(rs, pruned)

    // Phase 4: optional compatibility check.
    if compat != "" {
        compatList := mvs(rs, /*pruned=*/ compat >= "1.17")
        rs = ensureConsistent(rs, buildList, compatList)
    }

    // Phase 5: classify direct vs indirect.
    direct := importedDirectlyByMainModule(allImports, buildList)
    rs.markIndirect(buildList, direct)

    // Phase 6: write go.sum.
    sums := computeSums(buildList)            // hashes zip + go.mod
    mergeSums("go.sum", sums)

    // Phase 7: write go.mod.
    return writeModFile("go.mod", rs.toModFile())
}
```

The real implementation has more bookkeeping (workspace handling, vendor consistency, retracted-version warnings) but the shape is identical.

### Why tidy is multi-pass

Resolving an import requires a build list. Building the list requires the `go.mod` files of the candidates. Fetching those files requires MVS to know which versions to fetch. The toolchain breaks this circularity by iterating: start with whatever is already in `go.mod`, resolve, fetch missing pieces, re-run MVS, repeat until fixed point. In practice it converges in 1–3 iterations for typical projects.

---

## Build List Construction and MVS Inside Tidy

The Minimum Version Selection algorithm — defined in Russ Cox's 2018 design notes and implemented in [`golang.org/x/mod/modfile`](https://pkg.go.dev/golang.org/x/mod/modfile) plus `cmd/go/internal/mvs` — is the heart of every module-aware Go command. Tidy materialises its result into `go.mod`.

### MVS in plain terms

Given:
- A *root* module with a `require` set.
- For each required module, transitively, its own `require` set.

Compute:
- The build list: one selected version per module path, defined as the **maximum** version *required* by any module in the graph.

The word "minimum" refers to the fact that the algorithm never picks a version higher than something explicitly required. It does not solve constraints; it does not search a SAT space; it picks the maximum of a finite list of explicitly-requested versions per module.

### What tidy uses MVS for

Three independent times in a tidy run:

1. **To compute which `go.mod` files to fetch.** The current build list determines whose transitive requires to load.
2. **To compute the canonical build list.** Once all requires are loaded, MVS produces the final selection.
3. **To run the optional compatibility check.** With `-compat=1.x`, MVS is run with that older Go's pruning rules.

### Determinism

MVS is deterministic given inputs. Two engineers with the same `go.mod` *and* the same `go.mod` files of all requires get the same build list. This is the property that makes `go.sum` viable as a lockfile-equivalent: nothing in the algorithm depends on wall-clock time, registry order, or network state.

### Selection asymmetry

Tidy never *downgrades* a module unless the constraints actually require it. Adding a new dependency that requires `foo@v1.5.0` when `foo@v1.7.0` was already in the build list does not bump anything down. This is an explicit design choice: existing builds stay green when new dependencies are added.

---

## The `-compat` Flag and Module Graph Pruning (Go 1.17+)

Go 1.17 introduced *module graph pruning*, a substantial change to how the build list is constructed and to what `go.mod` records.

### Pre-1.17 (unpruned)

`go.mod` listed only the *direct* requires. The toolchain transitively walked every dependency's `go.mod` to compute the build list. Reproducing the build list required reading every transitive `go.mod`.

### 1.17+ (pruned)

If the main module's `go` directive is `1.17` or higher, `go.mod` is required to record the **complete build list** — every selected module, direct or indirect. The toolchain only loads transitive `go.mod` files when an import lands in a module that itself declares `go 1.17+`. For older modules in the graph, it conservatively assumes their requires are already represented.

The trade-off:
- *Pro*: dramatically smaller working set during builds; `go.mod` is now self-describing.
- *Con*: `go.mod` is bigger (all indirect deps appear with `// indirect` comments).

### What tidy does for pruning

Tidy *enforces* the graph rule for the declared Go version. If you bump `go 1.16` to `go 1.17` and run tidy, the `go.mod` file gains many new `// indirect` lines. Conversely, downgrading the directive removes them.

### `-compat=1.x` flag

The flag means: "produce a `go.mod` whose build list is also valid under Go version `1.x`'s rules." Concretely, with `-compat=1.17` (the default in modern Go), tidy verifies that a Go 1.17 toolchain reading the same `go.mod` would reach the same build list. If it would not, tidy adds extra explicit `require` entries to bridge the gap.

This matters for projects that declare `go 1.21` but want to remain buildable by 1.17 users, since the build list must reconcile both pruning regimes.

### When to set it lower

If your team has not yet upgraded everyone past 1.17, leave `-compat=1.17` (the default). If you require `go 1.21`+ for everyone, you can set `-compat=1.21` to slim `go.mod` further. The flag does not affect runtime semantics — only the contents of `go.mod`.

---

## Cross-Build-Configuration Import Discovery

The single most surprising thing about tidy is its **default cross-platform scope**.

### What "all configurations" means

By default, tidy parses every `.go` file under every plausible combination of:
- `GOOS` (linux, darwin, windows, freebsd, openbsd, netbsd, dragonfly, solaris, plan9, aix, js, ios, android, illumos, wasip1, ...)
- `GOARCH` (amd64, arm64, arm, 386, ppc64, ppc64le, mips, mipsle, mips64, mips64le, riscv64, s390x, wasm, ...)
- `// +build` and `//go:build` constraints (custom tags as expressions over GOOS/GOARCH/Go version).

Every `import` directive that is reachable in *any* such configuration gets resolved.

### Why

Because `go.mod` and `go.sum` should describe the entire reproducible build surface of the module — not just the build the human happens to be running today. A library that imports `golang.org/x/sys/unix` in non-Windows builds and `golang.org/x/sys/windows` in Windows builds genuinely depends on both modules.

### The Linux-only-team trap

Teams whose CI and developers all run Linux are still expected to keep `darwin`-only and `windows`-only deps in `go.mod`. Tidy will faithfully add them. Removing them by hand to keep `go.mod` small leads to CI flap when someone runs `go build` on macOS.

### Mitigation strategies

If you genuinely want to scope your module to a subset of platforms:

- **Keep tidy's defaults.** The cost is a few extra `// indirect` lines.
- **Use build tags to gate imports.** Custom tags like `//go:build internal_only` are excluded from tidy's default scan.
- **`-e` flag.** Tells tidy to keep going past missing-package errors. Does not change the platform scope, but tolerates partial failures.
- **Custom `GOFLAGS` per environment.** Some teams set `GOFLAGS=-tags=production` and accept that tidy must still see the full set.

Do **not** edit `go.mod` by hand to delete platform-specific deps. The next tidy run will re-add them.

### Test packages

Tidy also scans `_test.go` files. Test-only dependencies show up in `go.mod` exactly like production ones; the `// indirect` marker is the only differentiator, and even then it reflects whether the *main module* imports the package, not whether it is test-only.

---

## The `go.sum` Update Algorithm

`go.sum` is the local checksum lockfile. Tidy is the canonical writer.

### Per-module records

For every module `<path>@<version>` in the build list, tidy writes two `go.sum` lines:

```
<path> <version> h1:<base64-sha256-of-zip>
<path> <version>/go.mod h1:<base64-sha256-of-gomod>
```

The first line hashes the *module zip* — the canonical archive a proxy serves. The second hashes the module's *own* `go.mod` file. Both are required.

### Hash algorithm

`h1:` denotes "hash version 1": SHA-256 over a tree-structured manifest of all files in the archive (or just the `go.mod` bytes for the second line). Defined in [`golang.org/x/mod/sumdb/dirhash`](https://pkg.go.dev/golang.org/x/mod/sumdb/dirhash). Output is Base64-encoded with no padding.

### Merge semantics

Tidy does not silently delete `go.sum` entries. It:

1. Computes the required entries from the new build list.
2. Reads the existing `go.sum`.
3. Writes a sorted union, omitting entries that are no longer reachable from the build list.

If an entry already exists with a *different* hash for the same `<path> <version>` line, tidy aborts with a checksum mismatch — never overwrites. This is the integrity guarantee.

### Workspace `go.work.sum`

In workspace mode (`go.work` present), tidy may also write to `go.work.sum`, recording sums for modules used across multiple workspace members but not present in any single member's `go.mod`.

### Why both zip and `go.mod` hashes

The `go.mod`-only hash lets the toolchain trust a module's *requirements* without downloading the full zip. This is critical for MVS: traversing the graph needs every transitive `go.mod`, but not every transitive zip. Verifying just `go.mod` keeps the network footprint small.

---

## Network Interaction: Proxy, Sumdb, Cache

A tidy run's network shape depends entirely on cache state.

### Cold cache

Every module that lands in the build list triggers up to four proxy round-trips:

```
GET $GOPROXY/<path>/@v/list           # available versions
GET $GOPROXY/<path>/@v/<version>.info # JSON metadata
GET $GOPROXY/<path>/@v/<version>.mod  # go.mod
GET $GOPROXY/<path>/@v/<version>.zip  # source archive
```

Plus a sum-DB inclusion-proof query per `(path, version)` against `$GOSUMDB` (default `sum.golang.org`):

```
GET $GOSUMDB/lookup/<path>@<version>
GET $GOSUMDB/tile/...                 # transparency-log tile fetches
```

### Warm cache

If `$GOPATH/pkg/mod/cache/download/...` already contains the artifact, no network call is issued. The cache is content-addressed and immutable, so a hit is authoritative.

### `GOPROXY` chain

```
GOPROXY=https://corp.example.com/proxy,https://proxy.golang.org,direct
```

Tidy tries each entry in order. Failure with a 404 falls through; failure with a 5xx aborts unless followed by a comma. `direct` means clone the source repo via VCS — the slowest path.

### `GOFLAGS=-insecure`

Permits HTTP proxies. Almost never appropriate outside developer tinkering.

### `GONOSUMCHECK`/`GOSUMDB=off`

Suppresses sum-DB verification. Required for private modules not on the public log. Combine with `GOPRIVATE` for the right semantic: matching modules skip both proxy and sumdb.

### Observability

`GODEBUG=goproxy=verbose` in newer toolchains emits a log line per proxy interaction. `GODEBUG=netdns=go+1` shows DNS resolution for proxy hostnames. Use these to debug "why is tidy slow" in CI.

---

## Performance Profile of Tidy

Tidy's runtime has two regimes — cache-hit and cache-miss — and they differ by orders of magnitude.

### Warm cache, no work

A repeat `go mod tidy` in a project with no source changes:

| Phase | Cost |
|------|------|
| Parse `go.mod` | < 1 ms |
| Walk packages | 10–100 ms (filesystem) |
| Parse imports | tens of ms (bounded by file count) |
| MVS over cached graph | low ms |
| `go.sum`/`go.mod` write | < 10 ms |
| **Total** | **~100 ms** for a small project |

### Cold cache, modest project

A first tidy after `go clean -modcache` on a project with ~50 transitive deps:

| Phase | Cost |
|------|------|
| Proxy roundtrips (50 × ~4 calls) | seconds |
| Sumdb verification | seconds |
| Zip extraction and hashing | seconds |
| MVS | < 1 s |
| **Total** | **5–60 s** depending on bandwidth and proxy latency |

### Pathological: deep transitive graphs

A few well-known modules pull in hundreds of transitive deps (Kubernetes API libraries, OpenTelemetry, gRPC). Cold-cache tidy on such projects can hit 2–5 minutes on a slow link. Mitigations:

- **Run a local Athens proxy** to amortise.
- **Cache `$GOPATH/pkg/mod` between CI runs.** The single highest-leverage CI optimisation.
- **Run tidy infrequently in CI** — only as a drift gate, not on every commit.

### Non-linear surprises

Tidy is roughly O(*build-list-size* × *proxy-RTT*) for cold-cache work. The build-list size grows non-linearly with direct dep count when those deps share large transitive subgraphs (e.g., adding two libraries each pulling all of `k8s.io/...` does not double the cost — most modules are shared).

---

## Programmatic Equivalents

Tooling sometimes needs to do tidy-like work without invoking the binary.

### `go list -m -json all`

Emits a JSON document per module in the build list:

```bash
go list -mod=mod -m -json all
```

Each record carries `Path`, `Version`, `Time`, `Indirect`, `GoMod`, `Replace`, and more. This is the public API for "what is in the build list?" and is stable across Go versions.

### `golang.org/x/mod/modfile`

Programmatic read/write of `go.mod`:

```go
import "golang.org/x/mod/modfile"

data, _ := os.ReadFile("go.mod")
f, _ := modfile.Parse("go.mod", data, nil)
f.AddRequire("github.com/x/y", "v1.2.3")
out, _ := f.Format()
os.WriteFile("go.mod", out, 0644)
```

The same library the toolchain uses internally. Comments and directive ordering are preserved.

### `golang.org/x/mod/sumdb/dirhash`

Compute the same `h1:` hashes tidy writes:

```go
import "golang.org/x/mod/sumdb/dirhash"

h, _ := dirhash.HashDir("/path/to/extracted/module", "<path>@<version>", dirhash.Hash1)
fmt.Println(h) // h1:<base64>
```

### `golang.org/x/tools/go/packages`

Loads the import graph the way the compiler sees it:

```go
import "golang.org/x/tools/go/packages"

cfg := &packages.Config{Mode: packages.NeedImports | packages.NeedDeps | packages.NeedModule}
pkgs, _ := packages.Load(cfg, "./...")
```

For a tool that wants tidy's *effect* without running tidy, this is the closest equivalent: load packages, walk imports, decide what to add to `go.mod`.

### `golang.org/x/mod/modfile` plus MVS

Re-implementing MVS is a few hundred lines and is not recommended; instead, drive `go list` and parse its JSON. The tested implementation in the toolchain is the source of truth for any tooling that aspires to round-trip with `go.mod`.

---

## Tidy in CI/CD Pipelines

Tidy is the most common module-aware operation in CI, second only to `go build` and `go test`.

### Pattern: drift gate

```yaml
- name: Verify go.mod and go.sum are tidy
  run: |
    go mod tidy
    git diff --exit-code go.mod go.sum
```

If tidy produces a diff, fail the job. This catches forgotten `go mod tidy` calls and prevents drift between developer machines and CI.

### Pattern: cache the module cache

```yaml
- uses: actions/cache@v4
  with:
    path: ~/go/pkg/mod
    key: gomod-${{ hashFiles('**/go.sum') }}
```

Keyed on `go.sum` so cache invalidates exactly when deps change. This single optimisation turns 5-minute cold tidy runs into sub-second warm ones.

### Pattern: parallel pipelines and lock contention

`$GOPATH/pkg/mod/cache/lock` coordinates concurrent module operations. Two parallel CI jobs sharing a runner's module cache will serialise on this lock. Mitigations:

- **Per-job module caches** keyed by go.sum.
- **Runner-shared but pre-warmed** caches.
- **A local Athens proxy** so that cache-miss work does not contend on disk locks.

### Pattern: tidy as a separate job

For monorepos with many modules:

```yaml
tidy-check:
  strategy:
    matrix:
      module: [ apps/api, apps/worker, libs/shared ]
  steps:
    - run: cd ${{ matrix.module }} && go mod tidy && git diff --exit-code go.mod go.sum
```

Each matrix cell is independent and can run in parallel.

### Pattern: bootstrap from a private proxy

```yaml
env:
  GOPROXY: https://athens.corp.example.com,https://proxy.golang.org,direct
  GOPRIVATE: corp.example.com/*
```

Tidy in CI hits the corp proxy first, which is geographically close and pre-warmed.

### Pattern: forbid network in CI

```yaml
env:
  GOFLAGS: -mod=readonly
```

`go build`/`go test` fail if `go.mod` is incomplete. Forces drift to be caught before CI burns minutes on a broken dep.

---

## Hermetic Builds and `-mod=readonly`

A *hermetic* build produces identical bytes given identical inputs. Tidy's role is twofold: as the writer of the `go.sum` lockfile (a positive contribution), and as a potential threat (since tidy mutates `go.mod`).

### The `-mod` flag

Three values:
- `-mod=mod` — the toolchain may modify `go.mod` and `go.sum`. Default in development.
- `-mod=readonly` — the toolchain refuses to write `go.mod`/`go.sum`; if a build would require an update, it errors. The right default for CI.
- `-mod=vendor` — read deps from `vendor/`; `go.mod` and `go.sum` are not consulted for resolution.

Set via `GOFLAGS=-mod=readonly` or per-command. Tidy itself runs only in implicit `-mod=mod` mode (it cannot operate as readonly — its job is to write).

### The hermetic recipe

1. Pin the toolchain via `toolchain` directive in `go.mod`.
2. Pin every dependency via `go.mod` plus `go.sum`.
3. Vendor or run a private proxy so network state cannot drift.
4. Run `go build` with `-mod=readonly` (or `-mod=vendor`) so no implicit mutation is possible.
5. Run `go mod tidy` only as a check, never as a build step.

### What hermetic does *not* mean

- Reproducible binary bytes still require `-trimpath`, deterministic embedded build info, and fixed CGO settings.
- Tidy-generated `go.mod` is deterministic *given the inputs*, but the inputs include the cross-platform import scan — a new module published upstream can change tidy's output even with no local code change.

---

## Edge Cases the Source Reveals

Reading `cmd/go/internal/modload/buildlist.go`, `tidy.go`, and `init.go` surfaces edges most users never hit.

### Direct ↔ indirect transitions

A dependency starts as `// indirect` (added because some other module imports it). Later, you import it directly in your own code. The next tidy run drops the `// indirect` comment. Conversely, removing the direct import re-adds it. This is purely a comment change but version-controlled diffs reflect it.

### Pruned vs unpruned interaction

Bumping the `go` directive from `1.16` to `1.17` (or higher) triggers a *massive* `go.mod` diff: every transitively-required module suddenly appears explicitly. Tidy does not "smooth" this — it writes the full pruned build list. Review carefully and commit as a single, well-labeled diff.

### Ambiguous imports

Two modules can technically provide a package at the same import path — most commonly across major-version boundaries (`example.com/foo` and `example.com/foo/v2` if both are required and both supply the bare `foo` package). Tidy fails with `ambiguous import: found package X in multiple modules`. The fix is almost always to drop the older major version from your code.

### Retracted versions

If a transitive dep retracts the version you currently select, tidy emits a warning to stderr but does not fail. Subsequent `go get -u` selects the next non-retracted version. Tidy will not auto-bump for you; the retraction is informational.

### `+incompatible` versions

Modules without a `go.mod` file can be selected with a `+incompatible` version suffix. Tidy preserves these but any move toward a properly-modularised release should be done manually.

### Go-version differences

Tidy output differs across Go toolchain versions for two reasons: (a) the pruning rules evolved across 1.17/1.18/1.21, and (b) new directives (`toolchain`, `godebug`) appear. Pin the toolchain via `toolchain go1.22.4` in `go.mod` to make tidy's output stable across machines.

### Workspace shadowing

In a `go.work`-rooted project, tidy on a member module can produce a different result than tidy on the same module outside the workspace, because workspace `use` directives shadow `replace` resolution. Always tidy with the workspace-relevant working directory.

### Empty packages

A directory containing only `_test.go` files counts as a package for tidy purposes. Test-only imports land in `go.mod` even if the production package never references them.

### `replace` with a local path

`replace example.com/foo => ../foo` removes `foo` from network resolution but *not* from `go.sum`: tidy still hashes the local replacement's content. The hash anchors the *replaced* module, so any change to `../foo`'s `go.mod` triggers a `go.sum` change.

---

## Operational Playbook

A condensed reference for common tidy scenarios.

| Scenario | Recipe |
|----------|--------|
| Add a new dependency | Import it, then `go mod tidy` |
| Remove an unused dependency | Delete the import, then `go mod tidy` |
| Bump Go version with pruning change | Edit `go` directive, `go mod tidy`, review diff carefully |
| Force a specific minor version | `go get example.com/foo@v1.2.3 && go mod tidy` |
| Constrain to platform-specific deps | Use build tags; tidy still scans, but tags gate imports |
| Drift gate in CI | `go mod tidy && git diff --exit-code go.mod go.sum` |
| Cache cold-tidy in CI | Cache `~/go/pkg/mod` keyed by `hashFiles('**/go.sum')` |
| Pre-warm a local proxy | Run Athens; set `GOPROXY=athens,...,direct` |
| Suppress sumdb for private deps | `GOPRIVATE=corp.example.com/*` |
| Hermetic build verification | Build with `-mod=readonly`; tidy is not part of the build |
| Diagnose mysterious tidy diff | Check `go` directive change, new transitive deps, `-compat` setting |
| Diagnose slow tidy | `GODEBUG=goproxy=verbose go mod tidy` |
| Multi-module monorepo tidy | Loop over each `go.mod` directory; tidy independently |
| Reproduce tidy programmatically | `go list -mod=mod -m -json all` plus `golang.org/x/mod/modfile` |
| Recover from corrupt `go.sum` | Delete `go.sum`, run `go mod tidy`, review the new hashes |

---

## Summary

`go mod tidy` is the toolchain's reconciliation pass: it loads every package across every plausible build configuration, resolves each import to a module, runs MVS, and materialises the canonical `go.mod` and `go.sum` for the current source tree. Internally it is a multi-pass loop driven by the [`cmd/go/internal/modload`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/) package, sharing its core algorithms with `go build` and `go list`.

The professional engineer's understanding includes the things tidy hides: the cross-platform import scan that surprises Linux-only teams, the pruning rules that change with the `go` directive, the `-compat` flag that keeps older toolchains workable, the `go.sum` merge that never silently drops entries, the proxy-and-sumdb network shape, the cache-warm vs cache-cold performance gap, the `golang.org/x/mod` libraries that let tools do tidy-like work without spawning the binary, and the CI patterns (drift gates, module-cache caching, `-mod=readonly`) that turn tidy into a reliable invariant rather than a flaky chore.

Tidy is not the simplest module command, but its rules are deterministic and its source code is approachable. Mastering its phases — load, scan, resolve, MVS, classify, hash, write — lets you predict its behaviour in advance, and that prediction is the difference between a build pipeline that quietly works and one that drifts.
