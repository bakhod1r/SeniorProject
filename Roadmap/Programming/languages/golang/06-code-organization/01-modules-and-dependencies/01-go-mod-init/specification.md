# `go mod init` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `go mod init` Is Specified](#where-go-mod-init-is-specified)
3. [Synopsis](#synopsis)
4. [Module Path Syntax](#module-path-syntax)
5. [The `go.mod` File: Grammar](#the-gomod-file-grammar)
6. [The `module` Directive](#the-module-directive)
7. [The `go` Directive](#the-go-directive)
8. [Auto-Detection of Module Path](#auto-detection-of-module-path)
9. [Module Path Validation Rules](#module-path-validation-rules)
10. [Major Version Suffix Rule](#major-version-suffix-rule)
11. [What `go mod init` Does NOT Do (Per Spec)](#what-go-mod-init-does-not-do-per-spec)
12. [Differences Across Go Versions](#differences-across-go-versions)
13. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify `go mod init`. The command is part of the *tooling*, not the language. The authoritative reference is the **Go Modules Reference** at `go.dev/ref/mod`, which is maintained alongside the toolchain source.

This file separates "what the modules reference says" from convention and tooling behaviour. Where the reference is silent, the toolchain source code (`cmd/go/internal/modcmd/init.go`) is the de-facto specification.

References:
- [Go Modules Reference](https://go.dev/ref/mod)
- [`go help mod init`](https://pkg.go.dev/cmd/go#hdr-Initialize_new_module_in_current_directory)
- [The `go.mod` file](https://go.dev/ref/mod#go-mod-file)

---

## Where `go mod init` Is Specified

`go mod init` is documented in two places officially:

1. **`go help mod init`** — terse, command-line oriented.
2. **Go Modules Reference, Section "Initializing a new module"** — detailed.

The output of `go help mod init`:

```
usage: go mod init [module-path]

Init initializes and writes a new go.mod file in the current directory,
in effect creating a new module rooted at the current directory. The
go.mod file must not already exist.

Init accepts one optional argument, the module path for the new module.
If the module path argument is omitted, init will attempt to infer the
module path using import comments in .go files, vendoring tool
configuration files (such as Gopkg.lock), and the current directory
(if in GOPATH).

If a configuration file for a vendoring tool is present, init will
attempt to import module requirements from it.

See https://golang.org/ref/mod#go-mod-init for more about 'go mod init'.
```

That is the official text. Everything else flows from the modules reference and the source.

---

## Synopsis

```
go mod init [module-path]
```

- `module-path` is optional; when omitted, the command attempts auto-detection.
- Exit code 0 on success, non-zero on validation or I/O error.
- Output: a confirmation line on stderr; a newly-created `go.mod` file in the current directory.

---

## Module Path Syntax

Per the Go Modules Reference (section *Module paths*), a module path is a sequence of components separated by `/`. Each component must conform to the following grammar:

```
ModulePath   = PathComponent { "/" PathComponent } [ MajorVersion ] .
PathComponent = letter { letter | digit | "-" | "." | "_" | "~" } .
MajorVersion = "/v" digit { digit } .  // Required for major >= 2.
letter       = lowercase ASCII letter | digit | one of [.-_~].
                                  ^^^ first char of the first component must be a letter or digit
```

(Simplified; the actual grammar is in the source of `golang.org/x/mod/module`.)

Concrete rules:

1. The path must contain at least one component.
2. The first component must contain a dot (for non-local module paths).
3. Each component is non-empty.
4. Each component contains only ASCII lowercase letters, digits, and the punctuation `. - _ ~`.
5. No path component is `.` or `..`.
6. Trailing slashes are forbidden.
7. The path must not exceed 256 bytes.
8. If the major version is 2 or greater, the last component must be `vN` where `N` is the major version.

---

## The `go.mod` File: Grammar

The grammar of a `go.mod` file (informal, per Go Modules Reference):

```
GoMod      = { Directive } .
Directive  = ModuleStmt | GoStmt | ToolchainStmt | RequireStmt | ReplaceStmt
           | ExcludeStmt | RetractStmt | GodebugStmt | Comment .

ModuleStmt    = "module"   QuotedString .
GoStmt        = "go"       Version .
ToolchainStmt = "toolchain" ToolchainName .
RequireStmt   = "require" ( ModuleVersion | "(" { ModuleVersion } ")" ) .
ReplaceStmt   = "replace" ModuleVersion "=>" ModuleVersion .
ExcludeStmt   = "exclude" ModuleVersion .
RetractStmt   = "retract" ( Version | VersionRange | "(" { Version } ")" ) .
GodebugStmt   = "godebug"  GodebugSetting .

ModuleVersion = ModulePath [ Version ] .
Version       = "v" Number "." Number "." Number [ "-" PreRelease ] [ "+" Build ] .
```

A fresh `go.mod` from `go mod init` contains exactly:

```
ModuleStmt
GoStmt
```

— in that order, separated by a blank line.

---

## The `module` Directive

```
module <module-path>
```

Quoting:

- The path may be unquoted if it contains only the *safe* characters (letters, digits, `/`, `.`, `-`, `_`, `~`).
- Otherwise it must be enclosed in double quotes. (This is rare; the safe set covers all valid paths.)

Number of `module` directives per file: exactly **one**.

A missing `module` directive is an error: the file is not a valid `go.mod`.

---

## The `go` Directive

```
go <version>
```

Where `<version>` is one of:

- `1.N` — major.minor
- `1.N.P` — major.minor.patch (legal but uncommon for the `go` directive)

Semantic rules:

- Indicates the **minimum Go language version** required by this module.
- The toolchain refuses to compile a module whose `go` directive exceeds the running toolchain's version.
- Since Go 1.21, the directive also affects some library behaviours via the *language version selection* mechanism (see `runtime/debug.SetGCPercent` semantics, `for`-loop variable semantics, etc.).

Number of `go` directives: exactly **one**.

A missing `go` directive is, since Go 1.17, treated as an implicit `go 1.16` and prints a warning.

---

## Auto-Detection of Module Path

When the user runs `go mod init` without an argument, the command's auto-detection logic runs in this order (per `cmd/go/internal/modcmd/init.go` and `cmd/go/internal/modload/init.go`):

1. **Existing `go.mod` upward.** If a `go.mod` is found in any ancestor directory, init refuses (you are inside another module).
2. **`// import` comments in `.go` files.** Specifically, the toolchain reads the first `.go` file and looks for a comment of the form:
    ```go
    package foo // import "github.com/alice/foo"
    ```
    If found, that path is used.
3. **Legacy lockfiles.** Files left by old vendoring tools — `Gopkg.lock`, `glide.yaml`, `vendor.conf`, `vendor.json` — may contain a module path. The toolchain extracts it.
4. **`$GOPATH/src` location.** If the current directory is under `$GOPATH/src/<X>`, the path defaults to `<X>`.
5. **Failure.** If none of the above succeed, return an error: `cannot determine module path for source directory ...`.

There is **no Git remote inspection** in the public toolchain (despite folklore). The `git` URL of the working directory is not consulted by `go mod init` itself.

---

## Module Path Validation Rules

The path passed to `go mod init` is validated by `golang.org/x/mod/module.CheckPath`. The rules:

```go
// From golang.org/x/mod/module:

func CheckPath(path string) error {
    // Each path element separately validated:
    //   1. non-empty
    //   2. begins with letter or digit
    //   3. uses only allowed characters
    //   4. no consecutive dots
    //   5. no leading dot in element
    //   6. last element may be a major-version suffix
    // Whole path:
    //   1. <= 256 bytes
    //   2. first element contains a dot (for non-local paths)
    //   3. no Windows-reserved names
}
```

Examples of valid paths:

- `github.com/alice/lib`
- `example.com/test`
- `lib.example.com/csvkit`
- `example.com/lib/v2`
- `example.com/lib/sub/v3`

Examples of *invalid* paths:

- `github.com/Alice/Lib` (uppercase)
- `lib` (no dot in first element — accepted but treated as local-only)
- `github.com//lib` (empty component)
- `github.com/.lib` (leading dot)
- `github.com/lib/v0` (v0 suffix is not allowed; only `v2+`)
- `github.com/CON/lib` (Windows-reserved name `CON`)

---

## Major Version Suffix Rule

For modules with major version 2 or greater, the path must end with `/vN`. The rule from the Go Modules Reference:

> A module that has been declared at major version 2 or higher must have a major version suffix at the end of its path. This requirement implements the **import compatibility rule**: any two versions of a module that have the same import path must be backwards compatible.

Examples:

| Major version | Required path suffix |
|---------------|----------------------|
| v0.x.x or v1.x.x | none |
| v2.x.x | `/v2` |
| v3.x.x | `/v3` |
| ... | ... |

`/v0` and `/v1` are explicitly forbidden suffixes. `/v2` is the smallest allowed.

Within a `go.mod` file, the `module` directive must agree with the tag major version of the surrounding repository for releases to be discoverable.

---

## What `go mod init` Does NOT Do (Per Spec)

The Go Modules Reference is explicit about scope:

- It does not download dependencies.
- It does not resolve a module graph.
- It does not contact the network.
- It does not initialize a VCS repository.
- It does not create directories.
- It does not create `go.sum` (which is created by `go get` or `go mod tidy`).
- It does not enforce that the path corresponds to a real network resource.

Conversely, behaviours that *are* spec'd:

- Refusal if `go.mod` exists.
- Validation of the supplied path against `module.CheckPath`.
- Auto-detection in the order described above.
- Writing `module` and `go` directives, in that order.

---

## Differences Across Go Versions

The behaviour of `go mod init` has evolved:

- **Go 1.11** — Modules introduced as opt-in, behind `GO111MODULE=on`. `go mod init` requires the env var.
- **Go 1.13** — Module proxy and sum DB introduced. `go mod init` is unchanged but downstream operations begin using them.
- **Go 1.14** — `vendor/` becomes auto-detected when present and `-mod=vendor` not specified.
- **Go 1.16** — Modules become the default; `GO111MODULE=on` no longer required outside GOPATH.
- **Go 1.17** — `go.mod` directive parsing strengthened; missing `go` directive treated as implicit `go 1.16`.
- **Go 1.18** — Workspaces introduced (`go.work`). `go mod init` unaware of workspaces.
- **Go 1.19** — Minor improvements to error messages.
- **Go 1.21** — `toolchain` directive added. `go` directive's semantics expanded (language version selection).
- **Go 1.22** — `for`-loop variable semantics tied to `go` directive value.
- **Go 1.23** — `range`-over-func iterators tied to `go` directive value.

The mechanical command — `go mod init <path>` writes a two-directive `go.mod` — has not changed since Go 1.11. The *semantics* of the directives it writes have grown.

---

## References

- [Go Modules Reference](https://go.dev/ref/mod) — authoritative.
- [The `go.mod` file (reference)](https://go.dev/ref/mod#go-mod-file)
- [Module paths](https://go.dev/ref/mod#module-path)
- [Major version suffixes](https://go.dev/ref/mod#major-version-suffixes)
- [Source: `cmd/go/internal/modcmd/init.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modcmd/init.go)
- [Source: `golang.org/x/mod/module/module.go`](https://pkg.go.dev/golang.org/x/mod/module)
- [Tutorial: Create a Go module](https://go.dev/doc/tutorial/create-module)
