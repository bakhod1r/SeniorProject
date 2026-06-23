# `go mod tidy` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `go mod tidy` Is Specified](#where-go-mod-tidy-is-specified)
3. [Synopsis](#synopsis)
4. [What Tidy Does (Per the Reference Text)](#what-tidy-does-per-the-reference-text)
5. [The `-go` Flag](#the-go-flag)
6. [The `-compat` Flag](#the-compat-flag)
7. [The `-v` and `-x` Flags](#the-v-and-x-flags)
8. [The `-e` Flag](#the-e-flag)
9. [Module Graph Pruning (Go 1.17 Reference Text)](#module-graph-pruning-go-117-reference-text)
10. [Interaction with `go.sum`](#interaction-with-gosum)
11. [Interaction with `vendor/`](#interaction-with-vendor)
12. [What Tidy Does NOT Do (Per Reference)](#what-tidy-does-not-do-per-reference)
13. [Differences Across Go Versions](#differences-across-go-versions)
14. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `go mod tidy`. The command is part of the *tooling*, not the language. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, supplemented by the output of `go help mod tidy` and the toolchain source.

This file separates three layers, in decreasing order of authority:

1. **Spec text** — what the Go Modules Reference and `go help mod tidy` actually say.
2. **Convention** — established usage patterns that are not formally normative.
3. **Implementation behaviour** — what `cmd/go/internal/modcmd/tidy.go` and `cmd/go/internal/modload` do, which is the de-facto reference where the published text is silent.

References:
- [Go Modules Reference](https://go.dev/ref/mod)
- [`go help mod tidy`](https://pkg.go.dev/cmd/go#hdr-Add_missing_and_remove_unused_modules)
- [Module graph pruning (Go 1.17)](https://go.dev/ref/mod#graph-pruning)

---

## Where `go mod tidy` Is Specified

`go mod tidy` is documented officially in two places:

1. **`go help mod tidy`** — terse, command-line oriented, normative for flag list.
2. **Go Modules Reference, Section "`go mod tidy`"** — detailed, normative for behaviour.

Paraphrased output of `go help mod tidy` (Go 1.22; the wording below is faithful to the published text but is not a verbatim transcription — verify against your local toolchain with `go help mod tidy`):

```
usage: go mod tidy [-e] [-v] [-x] [-go=version] [-compat=version]

Tidy makes sure go.mod matches the source code in the module. It adds any
missing module requirements necessary to build the current module's
packages and dependencies, and it removes requirements on modules that
don't provide any relevant packages. It also adds any missing entries
to go.sum and removes any unnecessary ones.

The -v flag causes tidy to print information about removed modules
to standard error.

The -e flag causes tidy to attempt to proceed despite errors
encountered while loading packages.

The -go=version flag causes tidy to update the 'go' directive in
the go.mod file to the indicated version, enabling or disabling
module graph pruning and lazy module loading according to that
version.

The -compat=version flag preserves any additional checksums needed
for the 'go' command from the indicated major Go release to
successfully load the module graph, and causes tidy to error out if
that version of the 'go' command would load any imported package
from a different module version than is selected. By default,
tidy acts as if the -compat flag were set to the version prior to
the one indicated by the 'go' directive in the go.mod file.

The -x flag causes tidy to print the commands tidy executes.

See https://golang.org/ref/mod#go-mod-tidy for more about 'go mod tidy'.
```

Everything beyond this terse description flows from the Go Modules Reference and the source.

---

## Synopsis

```
go mod tidy [-e] [-v] [-x] [-go=version] [-compat=version]
```

- All flags are optional; `go mod tidy` with no arguments is the common form.
- Exit code 0 on success; non-zero on a load error (subject to `-e`) or an inconsistency that `-compat` enforces.
- Output: progress messages on stderr; `go.mod` and `go.sum` rewritten in place if needed.

The command takes no positional arguments. It always operates on the module rooted at the current `go.mod`.

---

## What Tidy Does (Per the Reference Text)

The Go Modules Reference describes `go mod tidy` as performing four conceptual operations:

1. **Add missing requirements.** For every package imported (transitively) by packages in the main module, ensure `go.mod` requires the providing module at a sufficient version.
2. **Remove unnecessary requirements.** Drop `require` lines that no longer correspond to a module providing a package reachable from the main module.
3. **Update `go.sum`.** Add hash entries for every module version that the build needs; remove entries for module versions that are no longer referenced.
4. **Preserve compatibility under the chosen `-compat` version.** Keep any additional `go.sum` entries an older `go` command would need to load the same module graph.

The set of "packages reachable from the main module" includes:

- All packages in the main module, including `_test.go` files of those packages.
- All packages imported (directly or transitively) by those packages.
- Test dependencies of all in-module packages.

Test dependencies of packages outside the main module are *not* included in the build list maintained by tidy under graph pruning (Go 1.17+); see [Module Graph Pruning](#module-graph-pruning-go-117-reference-text).

---

## The `-go` Flag

```
-go=version
```

Sets the `go` directive in `go.mod` to the supplied version (e.g. `-go=1.21`). Effects:

- The on-disk `go.mod` is rewritten with the new `go` line.
- The pruning regime is selected by the new value: `< 1.17` selects the unpruned graph; `>= 1.17` selects pruned graphs (lazy loading).
- When raising the version into the pruned regime, tidy may add additional `require` lines that were previously implicit in the unpruned graph.
- When lowering the version out of the pruned regime, tidy may remove indirect requirements that the older toolchain would have computed transitively.

Without `-go`, tidy preserves the current `go` directive value.

---

## The `-compat` Flag

```
-compat=version
```

Default: `-compat=<current_go - 1>`, where `<current_go>` is the value of the `go` directive in `go.mod`. That is, by default tidy preserves checksums needed by the *previous* major Go release to load the same module graph.

Semantics, per the modules reference:

- `-compat=1.N` means: `go.sum` must contain everything the Go 1.N toolchain would need to load the module graph for this module without contacting the network or proxy.
- It also means: if Go 1.N would resolve any imported package to a different module version than the current toolchain selects, tidy fails with an error rather than silently producing a graph that compiles only on newer toolchains.
- `-compat` can be lowered (e.g. `-compat=1.16`) to support older toolchains.
- `-compat` can equal the `go` directive (e.g. `-compat=1.21` when `go 1.21`) to drop the back-compat checksums.

The default is conservative: it ensures that downgrading the toolchain by one minor release does not break consumers.

---

## The `-v` and `-x` Flags

```
-v   verbose: print info about removed modules to stderr
-x   trace: print every external command tidy executes
```

- `-v` is a *content* flag; it changes what tidy prints (the names of dropped modules) but does not change `go.mod`/`go.sum`.
- `-x` is a *trace* flag; it surfaces the underlying download/`git`/`hg` invocations that the module loader performs. Useful for diagnosing proxy or network issues.

Neither flag changes the on-disk result.

---

## The `-e` Flag

```
-e   continue despite package-loading errors
```

Without `-e`, a package-loading error (unresolvable import, syntax error during loading, etc.) aborts tidy. With `-e`, tidy:

- continues processing the remainder of the package graph;
- still rewrites `go.mod`/`go.sum` based on what it could load;
- may produce a less-than-complete result.

This flag is used in CI/diagnostic contexts where a partial tidy is more useful than a hard failure.

---

## Module Graph Pruning (Go 1.17 Reference Text)

Go 1.17 introduced **module graph pruning**, formally described in the Go Modules Reference under *Module graph pruning*. The rules, in their normative form:

1. A module declaring `go 1.17` or higher in its `go.mod` is said to be at the **pruned** language version.
2. For a pruned main module, `go.mod` lists `require` directives for **every module** that supplies a package or test imported (directly or indirectly) by a package or test in the main module — not only direct imports.
3. Indirect requirements are marked with the `// indirect` comment.
4. The build list is computed using the *lazy* loading algorithm: only the requirements of pruned modules at the level of the main module are read; the `go.mod` files of transitive dependencies are not consulted unless needed to resolve a specific import.
5. Modules at `go < 1.17` ("unpruned" modules) still have all their requirements loaded transitively; if such a module appears in the graph of a pruned main module, its full `go.mod` is read.

Consequences for tidy:

- In a pruned module, tidy adds many `// indirect` lines that were previously implicit. The `go.mod` becomes longer but builds become faster and more deterministic.
- In a pruned module, tidy removes a `// indirect` line as soon as the import path that introduced it is no longer reachable.

---

## Interaction with `go.sum`

`go.sum` is co-managed by `go mod tidy`. The reference text states:

- Every module version listed in the build list (including for `-compat` purposes) must have an entry in `go.sum`.
- Entries in `go.sum` for modules not in the build list (under the active `-compat` choice) are removed.
- `go.sum` is sorted; tidy preserves canonical ordering.
- `go.sum` lines come in pairs: one `h1:` hash for the module zip, one `h1:` hash for the `go.mod` file.

If `go.sum` is missing entries that tidy needs to verify, tidy contacts the module proxy / sum database (per `GOPROXY` and `GOSUMDB`) and adds them.

---

## Interaction with `vendor/`

`go mod tidy` does **not** modify `vendor/`. The reference text explicitly delegates that responsibility to `go mod vendor`.

Recommended workflow (convention, not spec):

```
go mod tidy
go mod vendor
```

After tidy, the `vendor/` directory may be stale. Running `go mod vendor` re-creates it from the now-updated module graph. Running them in the wrong order (`vendor` then `tidy`) is a no-op for vendor: tidy will not detect that vendor is out of date.

In modules with `-mod=vendor` set in their toolchain configuration, tidy still operates from the module cache and proxy, not from `vendor/`.

---

## What Tidy Does NOT Do (Per Reference)

The Go Modules Reference and `go help mod tidy` are explicit about scope. Tidy does **not**:

- Upgrade direct requirements past the minimum needed to build (it does **not** select latest versions; that is `go get -u`).
- Downgrade requirements past what is needed (it does **not** purge older-than-needed versions actively; it only removes unreachable ones).
- Modify the `module` directive.
- Modify `replace` or `exclude` directives.
- Modify `retract` directives.
- Modify `vendor/` (see above).
- Initialize a `go.mod` (that is `go mod init`).
- Touch source files (`.go`, `_test.go`).
- Format `go.mod` cosmetically beyond what is needed for the diff (whitespace and grouping changes are minimal).

Conversely, behaviours that *are* spec'd:

- Adding missing direct and indirect requirements.
- Removing unreachable requirements.
- Adding/removing `go.sum` entries.
- Honouring `-go`, `-compat`, `-e`, `-v`, `-x`.
- Failing under `-compat` mismatches.

---

## Differences Across Go Versions

Reference table of versioned behaviour (each row indicates the minimum Go version where the behaviour applies):

| Version | Change to `go mod tidy` |
|---------|-------------------------|
| Go 1.11 | `go mod tidy` introduced as part of the modules experiment. |
| Go 1.13 | Module proxy and sum DB introduced; tidy now consults `GOPROXY`/`GOSUMDB`. |
| Go 1.14 | `vendor/` auto-detected; tidy still leaves vendor untouched. |
| Go 1.16 | Modules become default outside GOPATH. Tidy will *not* implicitly add missing requirements during `go build`; missing requirements become hard errors, making tidy mandatory after import changes. |
| Go 1.17 | **Module graph pruning** introduced. Tidy adds many `// indirect` lines for `go 1.17+` modules. `-compat` flag introduced. Default `-compat` is the previous major release. |
| Go 1.18 | Workspaces (`go.work`) introduced; tidy operates per-module, not across the workspace. `go work sync` is the workspace-level analogue. |
| Go 1.19 | Improved error messages; no behavioural change to tidy. |
| Go 1.21 | `toolchain` directive introduced. Tidy preserves and may rewrite the `toolchain` line; the `-go` flag interaction with `toolchain` is documented in the reference. |
| Go 1.22 | No major changes to tidy itself. |
| Go 1.23 | Iterator support; tidy follows imports of `iter` and updates the graph accordingly. |

The mechanical behaviour — add missing, remove unused, sync `go.sum` — has been stable since Go 1.11. The pruning and `-compat` semantics introduced in Go 1.17 are the largest substantive change.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [`go mod tidy` (reference)](https://go.dev/ref/mod#go-mod-tidy)
- [Module graph pruning](https://go.dev/ref/mod#graph-pruning)
- [`go.sum` files](https://go.dev/ref/mod#go-sum-files)
- [Go 1.17 release notes — Module graph pruning](https://go.dev/doc/go1.17#go-command)
- [Source: `cmd/go/internal/modcmd/tidy.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modcmd/tidy.go)
- [Source: `cmd/go/internal/modload/init.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/init.go)
- [Source: `cmd/go/internal/modload/buildlist.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/buildlist.go)
- [Tutorial: Managing module dependencies](https://go.dev/doc/modules/managing-dependencies)
