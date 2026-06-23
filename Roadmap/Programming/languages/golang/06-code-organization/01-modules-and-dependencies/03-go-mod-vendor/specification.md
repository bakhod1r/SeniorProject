# `go mod vendor` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `go mod vendor` Is Specified](#where-go-mod-vendor-is-specified)
3. [Synopsis](#synopsis)
4. [What Vendor Does (Per the Reference Text)](#what-vendor-does-per-the-reference-text)
5. [The `-e`, `-v`, `-o` Flags](#the-e-v-o-flags)
6. [The `vendor/modules.txt` File: Specified Format](#the-vendormodulestxt-file-specified-format)
7. [Vendor Auto-Detection Rules (Go 1.14+)](#vendor-auto-detection-rules-go-114)
8. [The `-mod=vendor` and `-mod=mod` Flags (and `GOFLAGS`)](#the-modvendor-and-modmod-flags-and-goflags)
9. [What Is and Is NOT Vendored (Per Reference)](#what-is-and-is-not-vendored-per-reference)
10. [Vendor and `replace` Directives](#vendor-and-replace-directives)
11. [Vendor Consistency Errors](#vendor-consistency-errors)
12. [Differences Across Go Versions](#differences-across-go-versions)
13. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `go mod vendor`. The command is part of the *tooling*, not the language. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, supplemented by the toolchain source.

Sources of truth, in decreasing formality:

1. **Go Modules Reference** — `go.dev/ref/mod`, in particular the *"Vendoring"* and *"`go mod vendor`"* sections.
2. **`go help mod vendor`** — terse, command-line oriented.
3. **Toolchain source** — `cmd/go/internal/modcmd/vendor.go` (the command driver) and `cmd/go/internal/modload/vendor.go` (the consistency checker for build-time use).

This file separates "what the modules reference says" from convention and tooling implementation. Where the reference is silent, the toolchain source is the de-facto specification.

---

## Where `go mod vendor` Is Specified

`go mod vendor` is documented in three places officially:

1. **`go help mod vendor`** — the help text.
2. **Go Modules Reference, Section "`go mod vendor`"** — detailed prose.
3. **Go Modules Reference, Section "Vendoring"** — describes the build-time consumption rules.

A paraphrase of `go help mod vendor` (paraphrased; consult `go help mod vendor` for the exact current text):

> `go mod vendor` resets the main module's `vendor/` directory to contain all packages needed to build and test packages of the main module. Packages of the standard library and packages from modules in the workspace are excluded. With `-v`, the names of vendored modules and packages are printed to standard error. With `-e`, errors that occur while loading packages are reported but do not stop the command. With `-o`, the vendor directory is written to the named output directory; note that vendor consumption by the `go` build tool only honours the standard `vendor/` location.

That paraphrase is the substance; the reference page expands on every clause.

---

## Synopsis

```
go mod vendor [-e] [-v] [-o outdir]
```

- All flags are optional.
- The command operates on the **main module** (the module containing the current directory). It refuses to run if there is no `go.mod`.
- Exit code 0 on success, non-zero on I/O error or (when `-e` is not set) on a package-loading error.
- Output:
  - A `vendor/` directory at the module root (or `outdir` if `-o` is set).
  - A `vendor/modules.txt` file with the format described in section 6.
  - With `-v`, a list of vendored modules and packages on stderr.

---

## What Vendor Does (Per the Reference Text)

The Go Modules Reference describes the operation as follows (paraphrased):

1. The main module is loaded from `go.mod`.
2. The set of build-time and test-time package imports of the main module is computed for the **default build list** — the set of platforms relevant to the current `GOOS`/`GOARCH` plus those reachable through the main module's package graph.
3. For each imported package outside the standard library and outside the main module, the toolchain copies the source files needed for the build into `vendor/<import-path>/`.
4. A `vendor/modules.txt` file is generated, recording (a) every module that contributed packages, (b) the list of packages drawn from each module, and (c) markers describing the role of each module.
5. The previous contents of `vendor/` (if any) are removed.

The reference is explicit on three properties:

- The operation is **deterministic**: the same module graph and `go.mod` produce the same `vendor/` tree.
- The operation is **idempotent**: running it twice in succession leaves no diff on the second run.
- The operation **does not modify `go.mod` or `go.sum`**.

---

## The `-e`, `-v`, `-o` Flags

| Flag | Reference behaviour | Added in |
|------|---------------------|----------|
| `-e` | Continue on errors that occur while loading packages. The exit code is still non-zero if any error was encountered, but the partial `vendor/` is still written. | Go 1.16 |
| `-v` | Verbose. Names of vendored modules and packages are printed to standard error, one per line. | Go 1.11 (initial) |
| `-o outdir` | Write the vendor directory to `outdir` instead of `<module>/vendor`. The `outdir` is created if absent and reset if present. **Important:** the build tool's auto-detection of `vendor/` (section 7) still requires the standard `<module>/vendor` location; an `-o`-produced tree is not consulted by builds unless renamed. | Go 1.18 |

The reference notes that `-o` is intended for inspection, packaging, and CI artifacts — not as a substitute for the on-disk `vendor/` location at the module root.

---

## The `vendor/modules.txt` File: Specified Format

The Go Modules Reference defines the format of `vendor/modules.txt`. The grammar (paraphrased; informal):

```
modulesTxt   = { ModuleBlock } .
ModuleBlock  = ModuleHeader { Marker } { PackageLine } .
ModuleHeader = "# " ModulePath " " Version
             | "# " ModulePath " " Version " => " TargetPath " " TargetVersion
             | "# " ModulePath " => " TargetPath
             .
Marker       = "## explicit"
             | "## explicit; go " GoVersion
             | "## go " GoVersion
             .
PackageLine  = PackageImportPath "\n" .
```

Concretely:

- A **module header** begins with `# ` and names a module and its selected version. If the module is the target of a `replace` directive, the `=>` form is used and both sides are recorded.
- The `## explicit` marker indicates the module is a **direct dependency** (it appears in a `require` directive of the main module's `go.mod`). Without this marker, the module is an indirect dependency.
- The `## explicit; go <version>` marker (Go 1.17+) records the dependency module's own `go` directive value, which the toolchain uses for language-version-dependent semantics during compilation.
- **Package lines** list the import paths of packages from this module that are needed by the build. One per line, no leading `#`.

The file is consumed by the build tool to (a) verify consistency with `go.mod` and (b) restrict the set of packages available from each vendored module.

---

## Vendor Auto-Detection Rules (Go 1.14+)

Per the Go Modules Reference, **the `go` build tool defaults to `-mod=vendor`** when **all** of the following hold:

1. The current directory is inside a module (a `go.mod` is found upward).
2. A `vendor/modules.txt` file exists at the module root.
3. The `go` directive in `go.mod` is `1.14` or higher.

If any condition fails, the default is `-mod=readonly` (Go 1.16+) or `-mod=mod` (older). The auto-detection check happens before each invocation of `go build`, `go test`, `go run`, `go install`, etc.

A `vendor/` directory **without** a `modules.txt` file is treated as if vendoring were not enabled — older-style `vendor/` directories from pre-modules tooling will not trigger auto-detection.

A `go.mod` with a `go` directive lower than `1.14` will not auto-enable vendoring even if `vendor/modules.txt` is present; the user must opt in with `-mod=vendor`.

---

## The `-mod=vendor` and `-mod=mod` Flags (and `GOFLAGS`)

The `-mod` flag controls how the `go` command resolves dependencies. Specified values:

| Value | Meaning |
|-------|---------|
| `mod` | Fetch missing modules from the network/module cache. May modify `go.mod` and `go.sum`. |
| `readonly` | Use `go.mod` as-is; fail if any module is missing or requires a change. (Default outside vendor mode since Go 1.16.) |
| `vendor` | Use the `vendor/` tree exclusively. Network access is disabled for module resolution. The `vendor/modules.txt` file must agree with `go.mod` (section 11). |

The flag may be set:

- On the command line: `go build -mod=vendor ./...`
- Via the environment variable `GOFLAGS`: `GOFLAGS='-mod=vendor'`
- Implicitly by auto-detection (section 7).

In vendor mode, the `go` command does **not** consult the module cache or any network proxy for the modules listed in `modules.txt`.

---

## What Is and Is NOT Vendored (Per Reference)

Included by `go mod vendor`:

- All non-test `.go` source files of every package imported, transitively, by the main module's packages and tests.
- Test files (`_test.go`) of packages **of the main module** — but not of dependencies.
- Embedded files (`//go:embed` targets) of vendored packages.
- `LICENSE`, `LICENSE.txt`, `LICENCE`, `COPYING`, `PATENTS`, and `NOTICE` files at the module root and at each package directory of vendored modules (these are copied verbatim).

Excluded by `go mod vendor`:

- `_test.go` files of dependency packages — the reference is explicit that **dependency tests are not vendored**.
- Files inside `testdata/` directories of dependency packages.
- Files outside the build graph for any combination of `GOOS`/`GOARCH` reached from the main module — purely platform-specific files for unreachable platforms are skipped.
- Documentation-only files (`.md`, `README`, etc.) — except the legal files listed above.
- The `vendor/` directories of vendored modules themselves (no nesting).
- Source files of the standard library.
- Source files of modules within the same workspace (`go.work`-mode only).

The exclusion rule for tests has practical consequence: a vendored module cannot be re-tested in isolation from its vendored copy.

---

## Vendor and `replace` Directives

The `replace` directive in `go.mod` redirects a module path to another path or to a local directory. `go mod vendor` honours `replace` as follows:

1. The **content copied** into `vendor/<module-path>/` comes from the **replacement target** (the right-hand side of `=>`).
2. The **directory name** under `vendor/` is the **original module path** (the left-hand side of `=>`).
3. The `vendor/modules.txt` module header records both: `# orig.path v1.0.0 => target.path v1.0.0` (or `=> ../local/dir`).

Local-directory replacements (replacements whose right-hand side is a filesystem path) are also copied — the local directory is treated as a module and its packages are vendored normally. The relative path is preserved in `modules.txt` for diagnostic purposes.

Replacement of the main module is not meaningful in vendor mode.

---

## Vendor Consistency Errors

Per the Go Modules Reference, vendor mode requires that `vendor/modules.txt` agree with `go.mod`. Specifically:

- Every module required by `go.mod` (transitively, via the module graph as `go.mod` records it) must appear in `modules.txt` with the **same selected version**.
- Every module marked `## explicit` in `modules.txt` must appear in a `require` directive of `go.mod`.
- The `## explicit; go <version>` markers (Go 1.17+) must match the `go` directive of the corresponding dependency's `go.mod` as recorded.
- Replacement entries must agree: a `replace` in `go.mod` must produce a `=>` line in `modules.txt`, and vice versa.

A mismatch is an error. The error message names the offending module and recommends `go mod vendor` to regenerate. The build does not proceed.

The reference frames this strictness as a deliberate guarantee: in vendor mode, the source of truth is the `vendor/` tree, but it must be exactly the tree that `go.mod` describes.

---

## Differences Across Go Versions

The behaviour of `go mod vendor` has evolved:

- **Go 1.11** — `go mod vendor` introduced. `-mod=vendor` exists as an opt-in flag; vendoring is **not** auto-detected.
- **Go 1.12** — Bug fixes to `modules.txt` formatting; no behavioural change.
- **Go 1.13** — Module proxy and sum DB introduced (downstream).
- **Go 1.14** — `vendor/` becomes **auto-detected**: builds in a module with `vendor/modules.txt` and `go >= 1.14` use vendor mode by default.
- **Go 1.16** — `-e` flag added (continue on errors). `-mod=readonly` becomes the default outside vendor mode.
- **Go 1.17** — `## explicit; go <version>` markers added to `modules.txt`. The dependency's `go` directive is recorded.
- **Go 1.18** — `-o outdir` flag added. Workspaces (`go.work`) introduced; vendoring is per-module, not per-workspace.
- **Go 1.21** — `toolchain` directive interaction documented; `modules.txt` unaffected.
- **Go 1.22** — `go work vendor` added as a separate command for workspace-level vendoring; `go mod vendor` itself is unchanged.
- **Go 1.23** — Minor improvements to error messages on consistency mismatch.

The mechanical command — `go mod vendor` writes a `vendor/` tree and `vendor/modules.txt` — has remained stable since Go 1.11. The auto-detection and the marker format have been the principal additions.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [Vendoring (reference)](https://go.dev/ref/mod#vendoring)
- [`go mod vendor` (reference)](https://go.dev/ref/mod#go-mod-vendor)
- [`vendor/modules.txt` format (reference)](https://go.dev/ref/mod#go-mod-vendor)
- [Build commands and `-mod` flag](https://go.dev/ref/mod#build-commands)
- [Source: `cmd/go/internal/modcmd/vendor.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modcmd/vendor.go)
- [Source: `cmd/go/internal/modload/vendor.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/vendor.go)
- [`go help mod vendor`](https://pkg.go.dev/cmd/go#hdr-Make_vendored_copy_of_dependencies)
