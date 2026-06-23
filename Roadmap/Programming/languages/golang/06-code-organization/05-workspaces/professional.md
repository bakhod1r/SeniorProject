# Workspaces — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `cmd/go` Decides Whether You Are in a Workspace](#how-cmdgo-decides-whether-you-are-in-a-workspace)
3. [The Precedence Chain: `GOWORK` > `go.work` > `go.mod` > Legacy GOPATH](#the-precedence-chain-gowork--gowork--gomod--legacy-gopath)
4. [Workspace Mode and Module Mode: What Changes Inside the Toolchain](#workspace-mode-and-module-mode-what-changes-inside-the-toolchain)
5. [`GOWORK` Environment Variable Semantics](#gowork-environment-variable-semantics)
6. [`GOFLAGS=-mod=...` Inside a Workspace](#goflags-mod-inside-a-workspace)
7. [The Build Cache and Module Cache Under Workspace Mode](#the-build-cache-and-module-cache-under-workspace-mode)
8. [Minimum Version Selection in a Workspace](#minimum-version-selection-in-a-workspace)
9. [Workspace `replace` vs Module `replace`: Resolution Order](#workspace-replace-vs-module-replace-resolution-order)
10. [`go work sync` Algorithm](#go-work-sync-algorithm)
11. [`go.work.sum` Generation and Verification](#goworksum-generation-and-verification)
12. [Workspace Vendoring (Go 1.22+)](#workspace-vendoring-go-122)
13. [Toolchain Switching and `go.work`](#toolchain-switching-and-gowork)
14. [Edge Cases the Toolchain Source Reveals](#edge-cases-the-toolchain-source-reveals)
15. [Operational Notes](#operational-notes)
16. [Summary](#summary)

---

## Introduction

The professional level on workspaces is not "how to use them" but "how the toolchain decides what they mean and how that decision interacts with everything else `cmd/go` does." The implementation lives across several packages in the toolchain source: `cmd/go/internal/modload` (for workspace and module loading), `cmd/go/internal/work` (for build orchestration), and `cmd/go/internal/workcmd` (for the `go work` subcommands). Reading those packages — even briefly — disambiguates almost every workspace question.

After reading this you will:

- Know exactly when the toolchain enters workspace mode and when it does not
- Reason about precedence between `GOWORK`, `go.work`, `go.mod`, and the legacy GOPATH layout
- Understand how the build cache and module cache are unaffected by workspace mode in interesting ways
- Predict the result of a workspace `replace` colliding with a module `replace`
- Diagnose pathological cases by knowing where in the source they live

---

## How `cmd/go` Decides Whether You Are in a Workspace

The decision is made early in command initialisation, in `modload.InitWorkfile` (paraphrased):

1. If the environment variable `GOWORK` is set to `off`, workspace mode is **disabled** unconditionally.
2. If `GOWORK` is set to a path, that path is used as the workspace file, regardless of the current working directory.
3. Otherwise, the toolchain walks **up** from the current working directory looking for a `go.work` file. The walk stops at the filesystem root.
4. If a `go.work` is found, workspace mode is enabled and that file is the workspace.
5. If no `go.work` is found, the toolchain falls back to module mode (looking for `go.mod` by the same upward walk).

The walk does not cross filesystem boundaries (in the sense that it does not traverse into hidden mount points), but it does cross every regular directory boundary.

If a `go.mod` is found *before* a `go.work` during the upward walk, **module mode** is selected. The toolchain does not "keep walking past `go.mod` looking for a `go.work` higher up." This is the rule that explains the surprising case: putting `go.work` outside a module's parent does *not* enable workspace mode for builds *inside* that module unless the upward walk reaches the workspace before any `go.mod` shadow.

In practice, place `go.work` at the smallest folder that contains every module you want grouped, and ensure no intervening folder has a `go.mod`. The standard layout — workspace at the repo root, modules in subdirectories — satisfies this.

---

## The Precedence Chain: `GOWORK` > `go.work` > `go.mod` > Legacy GOPATH

The full precedence, in decreasing authority:

1. **`GOWORK=off`** — disables workspaces entirely. Plain module mode applies.
2. **`GOWORK=/path/to/go.work`** — uses exactly that file. The toolchain does not search.
3. **Discovered `go.work`** — by upward walk from the current directory.
4. **`go.mod` in current directory tree** — if no workspace was found, the nearest `go.mod` defines the build.
5. **Legacy GOPATH mode** — only if no `go.mod` exists anywhere up to the root, *and* `GO111MODULE` is set to `auto` or `off`. Modern Go (1.16+) treats this as an error in most contexts.

The legacy GOPATH layer is essentially deprecated. You will encounter it only on very old codebases or by accidentally running `go` outside any `go.mod`. For new work it can be ignored.

`GOWORK` is the master override. Any CI system that wants reproducible builds against published versions sets `GOWORK=off` for that step.

---

## Workspace Mode and Module Mode: What Changes Inside the Toolchain

Workspace mode is not a separate code path — it is a *configuration* of module mode. Once a workspace is detected, the loader builds a "workspace requirements" graph:

1. For every `use` directive, load that module's `go.mod`.
2. Take the **union** of all `require` lines from those `go.mod`s.
3. Apply workspace-level `replace` directives.
4. Apply each module's own `replace` directives, where they do not conflict with the workspace.
5. Run Minimum Version Selection (MVS) over the resulting graph to produce a single resolved version map.
6. Treat each `use`d module as if its requirements had been satisfied by its local source, not by the resolved module-cache version.

The result is one `(module path → version-or-local-path)` map that the rest of the toolchain consumes. Compilation, test discovery, vet, and so on all read this map; they do not know whether they are in workspace mode or module mode.

This is why `gopls` and `golangci-lint` "just work" with workspaces: they ask the toolchain for the resolved set, and the toolchain returns it.

---

## `GOWORK` Environment Variable Semantics

Three values matter:

- **Unset.** Default. The toolchain searches upward for `go.work`.
- **`off`.** Workspace mode disabled. Even if a `go.work` exists in the directory tree, it is ignored.
- **An absolute path.** That exact file is used. The toolchain does not search.

A common mistake: setting `GOWORK=auto`, expecting it to "auto-detect." Auto-detection is the default behaviour of an unset `GOWORK`; the literal string `auto` is not a special value (the toolchain treats it as a path and fails when the file is missing). Stick to unset, `off`, or an absolute path.

You can inspect the current setting with:

```bash
go env GOWORK
```

If a workspace is in effect, `go env GOWORK` prints the resolved path. If not, it prints empty (or `off`).

---

## `GOFLAGS=-mod=...` Inside a Workspace

The `-mod` build flag (and its env-var twin in `GOFLAGS`) controls how `go.mod` is treated. Inside a workspace, the interaction is constrained:

- **`-mod=readonly`** — default. The toolchain reads `go.mod` but refuses to update it during a build. Compatible with workspace mode.
- **`-mod=mod`** — the toolchain may update `go.mod` (and `go.sum`) during the build. Compatible with workspace mode.
- **`-mod=vendor`** — the toolchain reads from a `vendor/` directory and ignores the network. **Inside a workspace, `-mod=vendor` is rejected unless you use the workspace-level vendor (Go 1.22+).** Per-module `vendor/` directories are silently ignored when the workspace is active.

The workspace-level vendor (Go 1.22+) is created by `go work vendor`. It produces a top-level `vendor/` containing every dependency used by every listed module. With it, `-mod=vendor` works at the workspace level.

Setting `GOFLAGS=-mod=vendor` globally and then running `go build` inside a workspace without the workspace vendor produces:

```
go: -mod=vendor cannot be used in workspace mode
```

The fix is `GOWORK=off` (use the per-module vendor) or `go work vendor` (use the workspace vendor).

---

## The Build Cache and Module Cache Under Workspace Mode

A frequent question: "Does workspace mode pollute my caches?"

**Module cache (`$GOMODCACHE`, default `$GOPATH/pkg/mod`).** Unaffected by workspace mode. The cache stores `(module-path, version) → bytes`. Workspace mode bypasses cache entries for `use`d modules (using the local files directly), but it does *not* delete or alter cache entries. Other versions of the same module path remain cached.

**Build cache (`$GOCACHE`, default `~/.cache/go-build`).** Workspace mode does affect cache *keys* — the input set of a build action under workspace mode includes the local file contents of `use`d modules. A workspace build and a `GOWORK=off` build of the same module produce different cache keys, so they coexist without interference. Cache entries from one are not invalidated by the other.

This is why `GOWORK=off` builds are quick to run alongside workspace builds: the build cache holds both versions.

**Cache concurrency.** The module cache is shared across `go` invocations on the same machine. Workspace mode does not change locking semantics. Two developers running parallel workspace builds against the same `$GOMODCACHE` are fine; the cache is content-addressed and lock-protected.

---

## Minimum Version Selection in a Workspace

MVS in workspace mode runs over the union of `require` lines from every listed module. The algorithm:

1. Start with the set of direct requirements: all `require` entries from every `use`d module's `go.mod`.
2. For each requirement, fetch the corresponding module's `go.mod` (transitively) and add its `require` entries.
3. For each module path, select the **maximum** of all listed versions.
4. If a `replace` directive (workspace-level or module-level) targets a module, the replaced path/version is used instead.
5. The final set is the build's resolved versions.

Two interesting properties:

- **A workspace can pick a higher transitive version than any single `go.mod` would.** If `auth` requires `golang.org/x/text v0.10.0` and `server` requires `v0.14.0`, the workspace picks `v0.14.0` — even though `auth/go.mod` alone would build with `v0.10.0`. This is one motivation for `go work sync`: align the per-module `require` lines with the workspace's chosen versions.
- **MVS is monotonic in the workspace.** Adding a module to the workspace can only *increase* required versions, never decrease. Removing a module can only *decrease*. This makes the workspace's behaviour predictable.

---

## Workspace `replace` vs Module `replace`: Resolution Order

When both a workspace and a module declare `replace` for the same module path, the workspace wins. The toolchain logs the override but uses the workspace value.

In source: `modload.editBuildList` first applies workspace replaces, then module replaces, with a check that any conflicting module-level replace is silently dropped.

This is why a workspace is a clean way to override a `replace` that lives in a `go.mod`: simply add a competing `replace` (or a `use`) to `go.work`, and the module-level one is inert while the workspace is active.

A subtlety: a `replace` in a `go.mod` of a module that is **not** in the workspace's `use` list is honoured as part of MVS. The workspace only overrides replaces of *listed* modules.

---

## `go work sync` Algorithm

The `go work sync` command (in `cmd/go/internal/workcmd/sync.go`) does the following:

1. Load the workspace and run MVS to compute the resolved version map.
2. For each module listed under `use`:
    a. Open its `go.mod`.
    b. For every `require` directive, compare the version against the resolved map.
    c. If the resolved version is higher, rewrite the `require` line.
    d. Add new `require` directives for transitive modules whose versions were resolved at the workspace level but were not in the module's own `go.mod`.
    e. Write the file back, preserving comments where possible.
3. Update each module's `go.sum` for any newly-added requires.

`go work sync` does **not**:

- Remove unused requires from any module (that is `go mod tidy`).
- Modify `go.work` itself.
- Affect modules outside the workspace.
- Change indirect-vs-direct annotations beyond the strict need.

Running `go work sync` after every dependency upgrade keeps each module's `go.mod` honest about what versions the workspace's tests have actually exercised.

---

## `go.work.sum` Generation and Verification

`go.work.sum` is structurally identical to `go.sum` — newline-separated lines of the form:

```
<module-path> <version> h1:<hash>
<module-path> <version>/go.mod h1:<hash>
```

The toolchain consults `go.work.sum` for hashes of modules that appear in the workspace's resolved set but are not covered by any listed module's `go.sum`. When a missing hash would otherwise force a re-fetch with checksum verification, `go.work.sum` provides the cached value.

Generation:

1. Whenever a workspace build verifies a module against the checksum database, the resulting hash is checked against any existing entry.
2. If no listed module's `go.sum` has the entry, it is appended to `go.work.sum`.
3. The file is sorted on write.

Verification follows the same rules as `go.sum`. A mismatch is a security error; the build aborts.

The file's existence is correlated with workspace-level `replace` directives — those are the most common reason for hashes that no listed `go.sum` covers. A workspace with no `replace` and no extra transitive requirements typically has no `go.work.sum`.

---

## Workspace Vendoring (Go 1.22+)

`go work vendor` produces a top-level `vendor/` directory containing every dependency every listed module uses. The structure is:

```
vendor/
├── modules.txt
└── <module-path>/
    └── ...
```

`modules.txt` is a manifest listing all vendored modules with their versions, which packages are imported, and which workspace modules require them.

After `go work vendor`, builds can use `-mod=vendor` at the workspace level:

```bash
go build -mod=vendor ./...
```

This produces a fully reproducible, network-free build for the entire workspace.

Per-module `vendor/` directories are no longer used (and are ignored) when a workspace vendor exists. To get back to per-module vendoring, delete the workspace `vendor/` and run `go mod vendor` per module with `GOWORK=off`.

Workspace vendoring is most valuable for:

- CI environments that must build offline.
- Air-gapped production deploys.
- Compliance scenarios that require shipping all source with the binary.

---

## Toolchain Switching and `go.work`

Since Go 1.21, `go.work` may include a `toolchain` directive:

```
go 1.22

toolchain go1.22.4

use (
    ./api
    ./shared
)
```

The `toolchain` directive requests a specific minor toolchain. If the running `go` is older than the directive, and `GOTOOLCHAIN` is `auto` (default), the toolchain transparently switches to the requested version: it downloads a sub-toolchain into the module cache and re-execs itself.

This means a workspace can pin every developer's toolchain to a known version without requiring everyone to upgrade their Go install. The directive is workspace-scoped; outside the workspace, the developer's installed Go applies.

Caveats:

- Switching is silent unless `GOTOOLCHAIN=local` (which forbids it).
- Cached sub-toolchains live under `$GOMODCACHE/golang.org/toolchain`.
- If both `go.work` and a listed `go.mod` declare `toolchain`, the higher of the two is selected.

For CI, pin `GOTOOLCHAIN` explicitly (`GOTOOLCHAIN=go1.22.4`) so logs are clear and switching cannot regress between runs.

---

## Edge Cases the Toolchain Source Reveals

### Edge case 1 — `use` with an absolute path

Legal, but the absolute path becomes part of the file. Anyone else who clones the repo with the workspace committed gets a broken `go.work`. The toolchain does not warn — it simply fails when the path does not resolve.

### Edge case 2 — `use` without trailing newline at EOF

The file is parsed correctly, but `go work edit` may add or remove the trailing newline differently from your editor, producing noisy diffs. Let `go work edit` own the file format.

### Edge case 3 — Cyclical workspaces

A `go.work` cannot list a module whose path is the same as the workspace folder, but you can construct surprising loops: module A's `go.mod` requires B, B's requires A, both listed under `use`. MVS handles this fine because the workspace satisfies both requirements locally.

### Edge case 4 — Two `use` lines for the same module

`go.work` allows this syntactically, but `go work init` and `go work edit` deduplicate. Hand-editing can introduce duplicates that fail with `duplicate use directive`.

### Edge case 5 — `use ./somemod` where the folder has no `go.mod`

Rejected at parse time with `directory ./somemod is not a module`.

### Edge case 6 — A module's `go` directive is higher than the workspace's

Permitted. The workspace's `go` directive is a floor, not a ceiling. The build uses the highest required `go` version across the workspace and listed modules.

### Edge case 7 — Workspace and `GO111MODULE=off`

An explicit `GO111MODULE=off` disables module mode entirely, which also disables workspace mode (since workspace mode is built on module mode). The setting effectively neutralises `go.work`. Modern code rarely needs this.

### Edge case 8 — Symlinked module folders

`use` accepts symlinks. The target must be a directory containing `go.mod`. Beware of cyclic symlinks; the toolchain does not specifically protect against them in the file walker.

---

## Operational Notes

### `GOWORK=off` in production builds

Always. Production binaries should be built from the consumer module with the workspace explicitly disabled:

```bash
cd cmd/api
GOWORK=off go build -o api .
```

This guarantees the binary's dependency set is exactly what `cmd/api/go.mod` and `go.sum` describe — no local-only swaps.

### Detecting workspace `replace` lines in CI

A simple guard:

```bash
if grep -q '^replace' go.work; then
    echo "workspace replace directives are forbidden in main"
    exit 1
fi
```

Adapt to allow specific replaces; deny by default.

### Auditing the resolved version map

```bash
go list -m all
```

Inside a workspace, this prints the resolved versions across all listed modules. Compare against `go.mod` lines to spot drift; if they differ significantly, schedule `go work sync`.

### Telemetry and provenance

`go version -m <binary>` includes the directly-imported module versions in the binary. For a workspace build, the toolchain records the workspace's resolved versions, not the listed `go.mod` versions. This is correct behaviour but worth knowing for forensic analysis: a workspace-built binary may not match its `go.mod` exactly.

### The `GOPROXY` interaction

Workspace mode does not change `GOPROXY` semantics. Modules listed under `use` are taken from local source; everything else flows through `GOPROXY` as usual. A private module proxy fronts the workspace's transitive dependencies; the workspace itself is invisible to the proxy.

---

## Summary

Workspace mode is a configuration of module mode, not a parallel system. The toolchain decides whether to enter workspace mode by walking upward from the current directory and finding a `go.work` before any `go.mod`. `GOWORK` is the master override and is the right hook for CI to disable workspaces during release-quality builds. Inside the toolchain, MVS runs over the union of every listed module's requirements; workspace `replace` directives outrank module `replace` directives for listed modules; and `go work sync` is the bridge that propagates the workspace's resolved versions back into each `go.mod`. The build cache and module cache are unaffected in interesting ways — workspace builds and `GOWORK=off` builds coexist without interference. Knowing where these mechanisms live in `cmd/go` source converts a "magical" feature into one whose every behaviour is predictable.
