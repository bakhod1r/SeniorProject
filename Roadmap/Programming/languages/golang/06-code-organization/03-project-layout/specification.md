# Project Layout — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Spec Covers and What It Does Not](#what-the-spec-covers-and-what-it-does-not)
3. [Package Organization (Language Spec)](#package-organization-language-spec)
4. [Module Path and Directory Mapping (Modules Reference)](#module-path-and-directory-mapping-modules-reference)
5. [The `internal/` Rule (Documented Behaviour)](#the-internal-rule-documented-behaviour)
6. [`vendor/` Mode (Documented Behaviour)](#vendor-mode-documented-behaviour)
7. [Major-Version Suffixes and Layout](#major-version-suffixes-and-layout)
8. [Build Tags and File Selection](#build-tags-and-file-selection)
9. [Workspace Mode (`go.work`)](#workspace-mode-gowork)
10. [What `cmd/go` Says](#what-cmdgo-says)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go *language specification* (`go.dev/ref/spec`) does not specify project layout. The shape of the directory tree is governed by the *Go modules reference* (`go.dev/ref/mod`) and by `cmd/go` documentation, supplemented by a handful of tooling conventions.

This file separates "what the references say" from "what the community has agreed on." Where the references are silent, the toolchain source code (`cmd/go/internal/...`) is the de-facto specification. The references for the rest of this document:

1. **Go Modules Reference** at `go.dev/ref/mod` — sections "Module directories", "internal directives" (informally), "vendoring", "build constraints", "workspaces".
2. **`go help build` / `go help packages`** — terse, command-line documentation built into the toolchain.
3. **Toolchain source** — `cmd/go/internal/load/pkg.go` and `cmd/go/internal/modload/...`.

---

## What the Spec Covers and What It Does Not

Covered (normatively):
- The relationship between `go.mod`'s module path and the import paths of packages inside the module.
- The `internal/` import-restriction rule.
- The `vendor/` directory's role in build-time package resolution.
- The `//go:build` syntax and the file-suffix conventions for conditional compilation.
- The format of `go.mod` and `go.sum`.
- The semantics of `go.work` workspaces.

Not covered (the community decides):
- Whether to use `cmd/`, `pkg/`, `api/`, `configs/`, `scripts/`, etc.
- The naming convention for packages and directories.
- Whether to group code by domain or by technical role.
- Monorepo vs polyrepo.
- Where `Dockerfile`, `Makefile`, CI configs go.
- The `golang-standards/project-layout` template — explicitly *not* an official Go artifact.

---

## Package Organization (Language Spec)

The language specification, in section "Source file organization", states (paraphrased):

> A Go program is constructed by linking together packages. A package is in turn constructed from one or more source files that together declare constants, types, variables, functions, and methods belonging to the package and which are accessible in all files of the same package. Those elements may be exported and used in another package.

Key normative consequences:

- A package is a directory's worth of `.go` files all sharing a single `package` clause.
- The package name is the identifier in the `package` clause; it is *not* required to match the directory name, though it almost always does in practice.
- Files in a package may declare top-level identifiers freely; files within a package see each other's unexported identifiers without import.
- Two directories with the same package name are nonetheless separate packages — identity is by import path, not name.

The spec does not prescribe a directory tree above the package. That is a tooling concern.

---

## Module Path and Directory Mapping (Modules Reference)

Per `go.dev/ref/mod#go-mod-file`:

> Each module is identified by a *module path*, declared with the `module` directive ... A module's package paths are the module path concatenated with the directory paths of its packages within the module.

Normative consequences:
- Given a module rooted at `<dir>` with `module <M>` in `go.mod`, a package directory at `<dir>/a/b/c` has import path `<M>/a/b/c`.
- The mapping is an exact concatenation; there are no aliases, intermediate prefixes, or rewrite rules in `go.mod`.
- A `replace` directive can substitute a different on-disk path for a given module path, but the package-within-module mapping is preserved.

Per `go.dev/ref/mod#module-cache`:

> Downloaded module sources are stored under `$GOPATH/pkg/mod`, with paths derived from the module path and version. Path elements containing uppercase letters are encoded by replacing each uppercase letter with `!` followed by the lowercase letter.

This case-encoding is what allows case-insensitive filesystems to host modules whose paths differ only in case.

---

## The `internal/` Rule (Documented Behaviour)

The `internal/` rule is documented in `cmd/go`'s import-path documentation and is referenced in the modules reference (under "Module directories" and in the import-path discussion).

Quoted from `go help packages` (paraphrased to reflect current wording):

> An import of a path containing the element `internal` is disallowed if the importing code is outside the tree rooted at the parent of the `internal` directory.

Normative consequences:
- A package whose import path contains `internal` as any path segment is *only* importable by packages whose path is rooted at the parent of that `internal` segment.
- The rule applies to every `internal` segment in a path. A path with two `internal/` segments enforces both constraints simultaneously.
- The rule applies regardless of whether the `internal` directory is in the main module, a dependency module, or a vendored module.
- Test files (`_test.go`) are subject to the same rule, evaluated with the test-package's import path.

Examples (per `cmd/go` documentation conventions):
- `a/b/c/internal/d/e/f` is importable by `a/b/c/...` (and only by those).
- `a/b/c/internal/d/e/f` is *not* importable by `a/b/x` (sibling of `c`).
- A package at `a/b/c/d/e/f` (no `internal` segment) is importable by anyone.

---

## `vendor/` Mode (Documented Behaviour)

Per `go.dev/ref/mod#vendoring`:

> If the main module contains a top-level directory named `vendor`, it will be used to satisfy dependencies (provided the `go` directive in the main module's `go.mod` file specifies Go 1.14 or higher).

Normative consequences:
- The presence of `vendor/` triggers vendor mode by default for `go 1.14+` modules; the user can opt out with `-mod=mod`.
- `vendor/modules.txt` is the manifest listing every vendored module and the import paths it contributes.
- If a build's needed packages are not consistent with `vendor/modules.txt`, the build fails with an "inconsistent vendoring" error.
- `internal/` rules apply *within* vendored modules with the vendored module's path as the root for the `internal/` check.
- Build operations in vendor mode do not access `$GOPATH/pkg/mod` for the vendored modules.

Per `go help mod vendor`:

> `go mod vendor` resets the main module's vendor directory to include all packages needed to build and test all of the main module's packages. It does not include test code for vendored packages.

This is why `vendor/` does not contain `_test.go` files for dependencies by default; only their non-test source.

---

## Major-Version Suffixes and Layout

Per `go.dev/ref/mod#major-version-suffixes`:

> A module path must have a major version suffix at the end if its major version is 2 or higher. The suffix takes the form of `/vN` where N is the major version.

Layout consequences:
- A module declared as `module example.com/foo/v2` lives at the root of the v2 source tree, with `go.mod` declaring the suffix-bearing path.
- The same source tree may produce multiple major versions over time, distinguished by tags (`v1.0.0`, `v2.0.0`) and by the `module` directive in each tag's `go.mod`.
- Two common layout strategies for v2:
  - **Major branch.** Maintain `v2` as a branch separate from `main`. The `main` branch keeps `module example.com/foo`; the `v2` branch updates `go.mod` to `module example.com/foo/v2`.
  - **Major subdirectory.** Keep all majors in `main`, with a `v2/` subdirectory that has its own `go.mod`. The subdirectory is a sub-module of the repository.
- The `+incompatible` notation applies to modules that publish v2+ tags without renaming. The toolchain accepts this for legacy code; new modules should always use the `/vN` suffix.

---

## Build Tags and File Selection

Per `go.dev/ref/mod#build-constraints` (and `go help build constraint`):

> Build constraints, also known as build tags, control which files are included in a package and may be used to limit which files are processed for a particular build environment.

Two equivalent forms:

1. **`//go:build` line** at the top of a file (preferred since Go 1.17):
   ```go
   //go:build linux && amd64
   ```
2. **Filename suffix**, where one or two of the underscore-separated tokens before `.go` are recognized: `_GOOS.go`, `_GOARCH.go`, or `_GOOS_GOARCH.go`. Examples: `fs_linux.go`, `arch_amd64.go`, `fs_linux_amd64.go`.

Normative consequences:
- A file is included in a build only if all build constraints evaluate to true.
- If both `//go:build` and a filename suffix apply, the file is included only when both succeed.
- Build constraints are evaluated against the active build environment (`GOOS`, `GOARCH`, custom `-tags`).
- Files with a build constraint that fails are *not* parsed beyond their header; their content does not contribute to package symbol resolution.

Filename special cases:
- A file whose name begins with `_` or `.` is ignored entirely, regardless of build tags.
- A file inside a directory named `testdata`, `_*`, or `.*` is ignored.
- A file with a `_test.go` suffix is included only by test commands (`go test`).

---

## Workspace Mode (`go.work`)

Per `go.dev/ref/mod#workspaces`:

> Workspaces are a feature of the go command that lets you work with multiple modules simultaneously. A workspace is described by a `go.work` file at the root of the workspace.

Normative consequences:
- A `go.work` file's `use` directives list the module directories participating in the workspace.
- When the toolchain is in workspace mode, imports that resolve to a workspace module use the on-disk source of that module rather than the cached version listed in `require` directives.
- `internal/` rules apply between workspace modules. A workspace module cannot import another workspace module's `internal/` packages unless their import paths satisfy the standard rule.
- Workspace mode is mutually exclusive with vendor mode.
- Workspace mode is enabled when the toolchain finds a `go.work` file in the current working directory or any ancestor; it can be disabled with `GOWORK=off`.

The `go.work` file's grammar (paraphrased):

```
go.work :=
    "go" GoVersion
    [ "toolchain" ToolchainVersion ]
    { "use" UsePath }
    { "replace" ReplaceDirective }
```

`go.work.sum` records hashes for modules required by the workspace that are not covered by any `use` module's `go.sum`.

---

## What `cmd/go` Says

`go help packages` (paraphrased) is the primary specification of how packages are discovered and matched:

> The `go` commands operate on a list of import paths. ... A package's import path identifies it within a module and across modules; the module's path concatenated with the package's relative directory yields the import path.

The pattern syntax for `./...`:

> The `...` wildcard matches any number of path elements. `./...` means the current directory and all subdirectories. The wildcard does not match across module boundaries: `./...` invoked at a workspace root expands to packages in the current module only.

The directory-exclusion rules:

> Subdirectories whose names begin with `.` or `_`, and a directory named `testdata`, are ignored when finding packages.

---

## Differences Across Go Versions

The behaviour of project layout has evolved:

- **Go 1.0** — `GOPATH` mode. Code lives under `$GOPATH/src/<import-path>`. There is no `go.mod`. Project layout is implied by import paths.
- **Go 1.4** — `internal/` rule introduced for the standard library, then generalized.
- **Go 1.5** — `vendor/` directory recognized experimentally.
- **Go 1.6** — `vendor/` becomes default-on for builds inside `$GOPATH/src`.
- **Go 1.11** — Modules introduced behind `GO111MODULE=on`. `go.mod` joins the layout. Module-aware mode supports `internal/` and `vendor/` semantics.
- **Go 1.13** — Module proxy and checksum database. Layout itself unchanged; resolution behaviour shifts.
- **Go 1.14** — `vendor/` mode auto-activates if `go.mod` declares `go 1.14`.
- **Go 1.16** — Modules become the default. `GOPATH` mode is deprecated for new code. `go install pkg@version` separates tool installation from `go.mod` mutation.
- **Go 1.17** — `//go:build` syntax replaces the older `// +build` form (the older form continues to be accepted and is still synthesized for compatibility with old tools).
- **Go 1.18** — Workspaces (`go.work`) introduced. Multi-module monorepos become first-class.
- **Go 1.21** — `toolchain` directive in `go.mod` interacts with workspace mode.
- **Go 1.22 / 1.23** — Refinements; the layout-affecting rules (`internal/`, `vendor/`, build tags, workspaces) are stable.

The directory-tree rules (`internal/`, `vendor/`, the package-per-directory invariant) have been stable since Go 1.11. The surrounding tooling (workspaces, toolchain switching, tag forms) has grown.

---

## References

- [Go Language Specification — Source file organization](https://go.dev/ref/spec#Source_file_organization)
- [Go Modules Reference](https://go.dev/ref/mod) — authoritative for `go.mod`, `vendor/`, `internal/`, workspaces.
- [Go Modules Reference — Module directories](https://go.dev/ref/mod#module-directories)
- [Go Modules Reference — Major version suffixes](https://go.dev/ref/mod#major-version-suffixes)
- [Go Modules Reference — Vendoring](https://go.dev/ref/mod#vendoring)
- [Go Modules Reference — Workspaces](https://go.dev/ref/mod#workspaces)
- [Go Modules Reference — Build constraints](https://pkg.go.dev/cmd/go#hdr-Build_constraints)
- [`cmd/go` Documentation](https://pkg.go.dev/cmd/go)
- [`go help packages`](https://pkg.go.dev/cmd/go#hdr-Package_lists_and_patterns)
- [Source: `cmd/go/internal/load/pkg.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/load/pkg.go) — the de-facto specification for `internal/` enforcement.
- [Source: `cmd/go/internal/modload/load.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modload/load.go) — module loading and import resolution.
- [Go 1.18 release notes — workspaces](https://go.dev/doc/go1.18#go-work)
- [Go 1.17 release notes — `//go:build`](https://go.dev/doc/go1.17#build-lines)
