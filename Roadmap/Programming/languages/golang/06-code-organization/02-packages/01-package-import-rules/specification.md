# Package Import Rules — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where Import Rules Are Specified](#where-import-rules-are-specified)
3. [The Import Declaration Grammar](#the-import-declaration-grammar)
4. [Import Path Strings](#import-path-strings)
5. [Import Spec Forms](#import-spec-forms)
6. [Package Names and Identifiers](#package-names-and-identifiers)
7. [The `init` Function Per Spec](#the-init-function-per-spec)
8. [Cyclic Import Prohibition](#cyclic-import-prohibition)
9. [The `internal/` Convention](#the-internal-convention)
10. [Resolution Mechanics](#resolution-mechanics)
11. [Differences Between Spec and Tooling](#differences-between-spec-and-tooling)
12. [References](#references)

---

## Introduction

Unlike `go mod *` commands, the rules governing package imports **are** specified by the Go language specification (`go.dev/ref/spec`), under the *Import declarations* section. The specification defines the grammar of an import declaration, the four import-spec forms, identifier visibility rules, the `init` function contract, and the prohibition against cyclic imports.

What the language specification deliberately does *not* cover:

- The syntactic constraints on import path strings beyond "string literal".
- The mapping from import path to a directory or archive on disk.
- The `internal/` and `vendor/` conventions.
- Build constraints (`//go:build`).
- Module resolution.

Those belong to the **`cmd/go` toolchain**, documented under `go help importpath`, `go help internal`, `go help build`, and the Go Modules Reference.

This file separates the two: anything quoted directly from `go.dev/ref/spec` is language-level; anything else is tooling convention.

References:
- [Go Specification — Import declarations](https://go.dev/ref/spec#Import_declarations)
- [Go Specification — Package initialization](https://go.dev/ref/spec#Package_initialization)
- [`go help importpath`](https://pkg.go.dev/cmd/go#hdr-Import_path_syntax)
- [`go help internal`](https://pkg.go.dev/cmd/go#hdr-Internal_Directories)

---

## Where Import Rules Are Specified

Import-related rules are spread across several authoritative sources:

| Concern                          | Authoritative source                                  |
|----------------------------------|-------------------------------------------------------|
| Import declaration grammar       | Go Specification, *Import declarations*               |
| Import-spec forms                | Go Specification, *Import declarations*               |
| Identifier visibility (export)   | Go Specification, *Exported identifiers*              |
| `init` function contract         | Go Specification, *Package initialization*            |
| Cyclic import prohibition        | Go Specification, *Import declarations*               |
| Path-syntax constraints          | `cmd/go` source; `go help importpath`                 |
| `internal/` directory rule       | `cmd/go`; `go help internal`                          |
| `vendor/` resolution             | Go Modules Reference, *Vendoring*                     |
| Module-aware resolution          | Go Modules Reference                                  |
| Build-tag filtering              | `go/build` package; `go help build`                   |

The reader who wants to understand a specific behaviour must first identify which row above applies.

---

## The Import Declaration Grammar

The grammar is reproduced verbatim from the Go specification:

```
ImportDecl       = "import" ( ImportSpec | "(" { ImportSpec ";" } ")" ) .
ImportSpec       = [ "." | PackageName ] ImportPath .
ImportPath       = string_lit .
```

Two surface syntaxes are permitted: a single import per `import` keyword, or a parenthesised group:

```go
import "fmt"

import (
    "fmt"
    "os"
    "strings"
)
```

The two are semantically identical. Any number of `import` declarations may appear at the top of a source file, before any other top-level declaration. Imports may not appear inside a function or after a non-import declaration.

The specification states:

> An import declaration states that the source file containing the declaration depends on functionality of the imported package and enables access to exported identifiers of that package.

Note that the dependency is **per source file**, not per package: each `.go` file in a package has its own import set.

---

## Import Path Strings

Per the specification:

> The ImportPath is a string literal whose value is the path to be imported. Its interpretation is implementation-defined but is typically a substring of the full file name of the compiled package and may be relative to a repository of installed packages.

Three observations:

1. The path is a **string literal** — either interpreted (`"fmt"`) or raw (`` `fmt` ``).
2. The path's interpretation is **implementation-defined**. The Go specification places no constraints on its content.
3. The specification refers only to "the imported package"; it does not define what counts as a package on disk.

The implementation — `cmd/go` — adds the following constraints (from `go help importpath`):

- Path elements separated by `/` (even on Windows).
- Each element is non-empty.
- Each element matches a regex roughly `[A-Za-z0-9._~+-]+` (lowercase strongly preferred).
- No leading `/`, no leading `./` outside of relative imports inside `GOPATH`.
- The leading element typically contains a dot (treated as a domain) for non-standard-library paths.
- The last element is the **default package name**, unless overridden by the `package` clause inside the source.

These rules are enforced by `cmd/go` at build time, not by the compiler reading the source.

---

## Import Spec Forms

The specification defines four forms of import spec, distinguished by what precedes the path string:

### 1. Regular import

```go
import "fmt"
```

The package is bound to the file scope under its declared package name (`fmt`). Exported identifiers are accessed as `fmt.Println`.

### 2. Aliased import

```go
import f "fmt"
```

The package is bound under the supplied identifier `f`. Exported identifiers are accessed as `f.Println`. The original name `fmt` is **not** in scope; only the alias.

Common uses: disambiguating two packages with the same name, shortening a long name, or adapting code generators.

### 3. Blank import

```go
import _ "fmt"
```

The package's exported identifiers are **not** introduced into the file scope. The package is still loaded, and its `init` functions run. This is the only form that does not introduce a binding.

Common uses: triggering side-effectful registration (`database/sql` drivers, `image/png` decoders, `net/http/pprof` handlers).

### 4. Dot import

```go
import . "fmt"
```

The exported identifiers of the package are introduced **directly into the file scope**, without qualification. `Println("hi")` refers to `fmt.Println`.

Per the specification:

> If an explicit period (.) appears instead of a name, all the package's exported identifiers declared in that package's package block will be declared in the importing source file's file block and must be accessed without a qualifier.

Discouraged in production code outside of test files.

---

## Package Names and Identifiers

The specification distinguishes three concepts:

1. **Package clause name** — the identifier in the `package` clause at the top of a source file. All files belonging to one package must repeat the same identifier.
2. **Import path** — the string used in `import`. Implementation-defined; carries no in-language semantics beyond identifying the package.
3. **Local binding** — the identifier introduced into the importing file's scope. Defaults to the package clause name; may be overridden by alias, suppressed by blank, or replaced by file-scope injection in dot form.

Crucially: the last element of an import path is **not** required to match the package clause name. The path `github.com/yuin/goldmark` declares `package goldmark`, the path `gopkg.in/yaml.v3` declares `package yaml`. The compiler binds whatever the package clause says.

When a discrepancy exists, `gofmt`, `goimports`, and IDEs typically insert an alias automatically.

---

## The `init` Function Per Spec

The specification (under *Package initialization*) defines `init` precisely:

```go
func init() { /* ... */ }
```

Rules quoted from the spec:

> The init function must have no arguments and no return values.

> Multiple such functions may be defined per package, even within a single source file. They execute in the order in which they appear in the source, possibly in multiple files, as presented to the compiler.

> Variables may also be initialized using functions named init declared in the package block, with no arguments and no result parameters.

`init` is unique in several ways:

- It cannot be referenced by name (you cannot call `init()` from your code, nor take its address).
- It is run automatically by the runtime, **after** package-level variable initialisation.
- It runs exactly once per program execution, regardless of how many goroutines or how many import paths reach the package.
- Multiple `init` functions in the same file run in source order; across files, the order is the order in which the file names are presented to the compiler — for `cmd/go` this is alphabetical by filename.

A package's `init` is guaranteed to run **after** the `init` of every package it imports, transitively. Cycles are forbidden (next section).

---

## Cyclic Import Prohibition

The specification states:

> It is illegal for a package to import itself, directly or indirectly, or to directly import a package without referring to any of its exported identifiers.

Two rules in one sentence:

1. **No cycles.** If package `A` imports `B`, then `B` (directly or through any chain) must not import `A`. This applies at the import-graph level, not at the symbol level. A type defined in `A` and used by `B` is fine; circular `import` directives are not.

2. **No unused imports.** A regular or aliased import that is never referenced is a compile error: `imported and not used`. The blank and dot forms are exempt — `_` because it is a deliberate side-effect import, `.` because the introduced identifiers may be used without qualification.

The cycle check is performed by the loader during type-checking; the unused-import check is performed by the compiler. Both errors are caught at compile time, not at runtime.

---

## The `internal/` Convention

Note: `internal/` is **not** part of the language specification. It is a convention enforced by `cmd/go`. From `go help internal`:

> An import of a path containing the element "internal" is disallowed if the importing code is outside the tree rooted at the parent of the "internal" directory.

The rule:

- A path `a/b/c/internal/d/e/f` may be imported only by code rooted at `a/b/c` or below.
- `a/b/c` is the parent of `internal`; everything inside `a/b/c` (including parallel directories like `a/b/c/cmd/foo`) may import the internal package.
- Code at `a/b/x` cannot.

This is enforced by the `go` tool at build time. The compiler itself accepts internal imports; only the orchestration layer rejects them. A direct invocation of `go tool compile` with the right `-I` flags would compile such code without complaint — which is why the rule is "convention enforced by tooling," not "language."

The standard library uses `internal/` extensively (e.g., `internal/cpu`, `internal/poll`, `internal/abi`).

---

## Resolution Mechanics

Resolution — the mapping from a string-literal path to a directory of `.go` files — is `cmd/go`'s responsibility. The algorithm, simplified:

1. **Standard library check.** If the path matches an entry in the standard library tree (`$GOROOT/src/<path>`), use it.
2. **Module mode.** If `go.mod` exists at or above the current directory:
   - The module containing the import path is determined from `go.mod`'s `require` directives plus the implicit dependency on the main module itself.
   - The version is resolved by minimum-version selection.
   - The package is fetched from the module proxy or local cache (`$GOPATH/pkg/mod`).
3. **Vendored mode.** If a `vendor/` directory exists at the module root and `-mod=vendor` is in effect (the default since Go 1.14 when `vendor/` is present), the import is resolved against `vendor/<path>`.
4. **GOPATH mode (legacy).** If `GO111MODULE=off`, the import is resolved against `$GOPATH/src/<path>`.

Each step also applies build-tag filtering: a `.go` file is included only if its `//go:build` constraint is satisfied for the current GOOS, GOARCH, and supplied tags.

None of this is in the language specification.

---

## Differences Between Spec and Tooling

A condensed comparison:

| Aspect                                | Language spec                              | `cmd/go` tooling                              |
|---------------------------------------|--------------------------------------------|-----------------------------------------------|
| Import declaration grammar            | Defines it precisely                       | Parses it via `go/parser`                     |
| Import path interior syntax           | "implementation-defined"                   | Slash-separated, restricted character set     |
| Path-to-directory mapping             | Not specified                              | Defined by module/GOPATH/vendor logic         |
| Four import-spec forms                | Defines all four                           | Parses all four                               |
| `init` execution order                | Source order within package                | Filenames alphabetical for ordering input     |
| Cyclic imports                        | Forbidden                                  | Detected and reported                         |
| Unused regular/aliased imports        | Compile error per spec                     | Surfaced by the compiler, not the tool        |
| `internal/` rule                      | Not mentioned                              | Enforced at build orchestration level         |
| `vendor/` rule                        | Not mentioned                              | Enforced; documented in modules reference     |
| Build constraints (`//go:build`)      | Not mentioned                              | Enforced via `go/build`                       |
| Major-version suffix in import path   | Not mentioned                              | Required for v2+ in module mode               |
| `replace` directive effects           | Not mentioned                              | Rewrites import resolution                    |

The line is sharp: the *shape* of imports — what the source text may say — is in the specification. The *meaning* of imports — what disk artefact the path resolves to — is in the tooling.

---

## References

- [Go Specification — Import declarations](https://go.dev/ref/spec#Import_declarations)
- [Go Specification — Package initialization](https://go.dev/ref/spec#Package_initialization)
- [Go Specification — Exported identifiers](https://go.dev/ref/spec#Exported_identifiers)
- [Go Specification — Source file organization](https://go.dev/ref/spec#Source_file_organization)
- [`go help importpath`](https://pkg.go.dev/cmd/go#hdr-Import_path_syntax)
- [`go help internal`](https://pkg.go.dev/cmd/go#hdr-Internal_Directories)
- [`go help packages`](https://pkg.go.dev/cmd/go#hdr-Package_lists_and_patterns)
- [Go Modules Reference — Vendoring](https://go.dev/ref/mod#vendoring)
- [Go Modules Reference — Module-aware commands](https://go.dev/ref/mod#mod-commands)
- [Source: `go/build/build.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/go/build/build.go)
- [Source: `cmd/go/internal/load/pkg.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/load/pkg.go)
