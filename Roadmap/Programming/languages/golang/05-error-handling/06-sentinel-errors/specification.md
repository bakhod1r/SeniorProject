# Sentinel Errors — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Sentinels Are Not in the Spec](#sentinels-are-not-in-the-spec)
3. [The Underlying Spec Mechanics](#the-underlying-spec-mechanics)
4. [Standard Library Conventions](#standard-library-conventions)
5. [The Naming Convention](#the-naming-convention)
6. [`errors.Is` Semantics](#errorsis-semantics)
7. [Wrapping with `%w`](#wrapping-with-w)
8. [Cross-Package Aliases](#cross-package-aliases)
9. [Differences Across Go Versions](#differences-across-go-versions)
10. [What the Convention Does NOT Promise](#what-the-convention-does-not-promise)
11. [References](#references)

---

## Introduction

The Go specification defines the language. Sentinel errors are *not* a language feature — they are a community-and-stdlib convention layered on the small core defined by the spec. This file separates "what is in the spec" from "what is in stdlib practice."

Reference: [The Go Programming Language Specification](https://go.dev/ref/spec).

---

## Sentinels Are Not in the Spec

A search of the Go specification for the word "sentinel" returns zero results. The specification mentions:

- The predeclared `error` interface.
- Multi-valued returns.
- Interface equality.
- Variable declarations.

…but says nothing about a "sentinel error pattern." The pattern is built entirely on top of these primitives:

```go
var ErrFoo = errors.New("foo")
return ErrFoo
errors.Is(err, ErrFoo)
```

…uses only:

- A package-level `var` declaration (spec: **Variable declarations**).
- A call to `errors.New` (defined by the `errors` package, not by the spec).
- An interface assignment in the return.
- The `errors.Is` function (defined by the `errors` package, not by the spec).

Implication: every rule about sentinels in this section is a *standard library or community* rule, not a language rule.

---

## The Underlying Spec Mechanics

Three spec rules make the sentinel pattern work:

### Rule 1: Package-level variables persist for the program's lifetime

From the spec, **Package initialization**:

> Within a package, package-level variable initialization proceeds stepwise, with each step selecting the variable earliest in declaration order which has no dependencies on uninitialized variables. [...] Variables may also be initialized using functions named `init` declared in the package block, with no arguments and no result parameters.

A package-level `var ErrFoo = errors.New("foo")` is initialized exactly once, before `main` runs. The resulting interface value is stable for the entire process.

### Rule 2: Interface equality compares dynamic type and value

From the spec, **Interface types**:

> Two interface values are equal if they have identical dynamic types and equal dynamic values or if both have value nil.

Sentinel comparison with `==` reduces to "are these the same dynamic type and the same dynamic value?" For two distinct calls returning the same `ErrFoo`, both conditions hold and `==` returns true.

For wrapped errors, the *outer* error has dynamic type `*fmt.wrapError`, not `*errors.errorString`, so `==` against the sentinel is false. This is why `errors.Is` exists — to walk the chain instead of comparing only the outer header.

### Rule 3: The `error` interface admits any type with `Error() string`

From the spec, **Predeclared identifiers**:

> error

The `error` type is predeclared. Any package-level variable declared as `error` (or assigned an `error` value via `errors.New`) is a valid sentinel candidate.

That is the entire spec contribution. Everything else is convention.

---

## Standard Library Conventions

The standard library encodes a few rules by example. They are not mandatory but breaking them confuses every other Go programmer.

### Convention 1: Package-level `var` block

Sentinels live in a single `var (...)` block, usually at the top of `errors.go`:

```go
package mypkg

import "errors"

var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)
```

### Convention 2: Lowercase, no trailing punctuation

```go
errors.New("not found")    // good
errors.New("Not found.")   // bad: capitalized, period
```

The Go standard library's error strings are *fragments* that compose into longer messages via wrapping. Capitalization and punctuation in the middle of a wrapped chain look wrong:

```
load config: Parse error.: invalid character
```

vs

```
load config: parse error: invalid character
```

### Convention 3: Documented as exported

```go
// ErrNotFound is returned by Get when no record matches the key.
var ErrNotFound = errors.New("not found")
```

The doc comment explains *when* the sentinel is returned, not just what it says.

### Convention 4: Consistent within a package

A package picks *one* error pattern (sentinels, typed errors, kinds) and uses it throughout. Mixing without good reason confuses callers.

---

## The Naming Convention

Sentinels start with `Err` (capitalized for export, lowercase for package-private):

```go
var ErrNotFound = errors.New("not found")  // exported
var errCacheMiss = errors.New("cache miss") // unexported
```

Codified by:

- The standard library's actual practice (every stdlib sentinel starts with `Err`).
- `golangci-lint` style checks.
- Go community style guides (Effective Go, Google Go Style Guide).

Historical exceptions in the stdlib:
- `io.EOF` — predates the convention; kept for compatibility.

If you write a new sentinel today, prefix it with `Err`. Anything else fights the ecosystem.

---

## `errors.Is` Semantics

From the documentation of `errors.Is` in `pkg/errors`:

> `Is` reports whether any error in `err`'s tree matches `target`.
>
> The tree consists of `err` itself, followed by the errors obtained by repeatedly calling `Unwrap`. When `err` wraps multiple errors, `Is` examines `err` followed by a depth-first traversal of its children.
>
> An error is considered to match a target if it is equal to that target or if it implements a method `Is(error) bool` such that `Is(target)` returns true.

Three semantics worth memorizing:

1. **Equality (`==`)** is the base check. Two interface values are equal iff dynamic types and values match.
2. **Custom `Is` method** can broaden matching: a typed error can declare it matches a sentinel.
3. **`Unwrap` traversal** lets the check pass through wrappers transparently.

Edge cases per the docs:

- `errors.Is(nil, nil)` is `true`.
- `errors.Is(err, nil)` is `true` only if `err == nil`.
- `errors.Is(nil, target)` is `false` for non-nil `target`.

---

## Wrapping with `%w`

From `fmt`'s documentation:

> The verb `%w` is a special directive that wraps the supplied error. It calls the `Errorf` function and the resulting error implements an `Unwrap` method returning the wrapped error.

Rules:

- `%w` is only valid in `fmt.Errorf`, not `fmt.Sprintf` or `fmt.Printf`.
- Up to one `%w` per format string in Go 1.13–1.19.
- *Multiple* `%w` allowed in Go 1.20+ (the resulting error implements `Unwrap() []error`).
- If `%w` is given a non-error argument, the result is the literal `%!w(...)` — always pass an `error`.

The wrap preserves the wrapped value for `errors.Is` and `errors.As` traversal.

---

## Cross-Package Aliases

When the standard library wants two packages to share a sentinel, it does so by *value assignment*:

```go
// io/fs/fs.go
var ErrNotExist = errInvalid  // wraps an internal value

// os/error.go
var ErrNotExist = fs.ErrNotExist  // alias to fs's value
```

The second `var` re-uses the first's interface value. `errors.Is(err, fs.ErrNotExist)` and `errors.Is(err, os.ErrNotExist)` both succeed when the underlying error is the shared one.

Implication for your own code: if you want package `B` to extend package `A`'s vocabulary, do not redeclare the sentinel — alias it:

```go
// b/errors.go
import "myorg/a"

var ErrNotFound = a.ErrNotFound  // aliased; same interface value
```

This is the recognized way to extend an error vocabulary across packages without breaking identity.

---

## Differences Across Go Versions

| Go version | Relevant change |
|-----------|-----------------|
| 1.0 | `errors.New` and the convention of using package-level `var` for sentinels. |
| 1.13 | `errors.Is`, `errors.As`, `errors.Unwrap`, `fmt.Errorf` `%w`. The wrap chain becomes the canonical way to attach context to a sentinel. |
| 1.16 | `io/fs` introduced; `fs.ErrNotExist` etc. aliased to existing `os` sentinels. |
| 1.20 | `errors.Join` for combining errors; multiple `%w` in `fmt.Errorf`; tree-shaped wrap chains. |
| Modern (1.21+) | The implementation continues to evolve; behavior is stable. |

Old code that uses `==` against sentinels (pre-1.13 idiom) still compiles and runs unchanged. New code can adopt `errors.Is` everywhere; the cost is identical for unwrapped errors.

---

## What the Convention Does NOT Promise

The sentinel convention is convention. Specifically *not* guaranteed:

- **The compiler does not enforce sentinel use.** You can declare `var X = errors.New("x")` and never return it; the compiler will not warn.
- **The compiler does not warn for `==` against a sentinel.** It is legal Go; only linters flag it.
- **No tooling enforces the `Err` prefix.** Convention only.
- **`errors.Is` is not part of the language.** It is a regular function in the `errors` package; you can write your own.
- **Wrapping is not automatic.** A package can return a sentinel bare or wrapped — readers must check the docs.
- **Cross-package sentinels work via pointer identity.** Plugins, multiple imports, and dynamic linking can produce duplicates and break detection.
- **No language-level stack traces.** A wrap chain shows what *operations* failed; not *where* in source code.

This is by design: the spec keeps the language small; conventions and stdlib idioms keep the ecosystem coherent.

---

## References

- [The Go Programming Language Specification — Predeclared identifiers](https://go.dev/ref/spec#Predeclared_identifiers)
- [The Go Programming Language Specification — Variable declarations](https://go.dev/ref/spec#Variable_declarations)
- [The Go Programming Language Specification — Package initialization](https://go.dev/ref/spec#Package_initialization)
- [The Go Programming Language Specification — Interface types](https://go.dev/ref/spec#Interface_types)
- [Package errors documentation](https://pkg.go.dev/errors)
- [Package fmt documentation — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.16 release notes — io/fs](https://go.dev/doc/go1.16#fs)
- [Go 1.20 release notes — errors.Join](https://go.dev/doc/go1.20#errors)
- `$GOROOT/src/errors/errors.go`
- `$GOROOT/src/errors/wrap.go`
- `$GOROOT/src/io/io.go`
- `$GOROOT/src/io/fs/fs.go`
- `$GOROOT/src/os/error.go`
- `$GOROOT/src/database/sql/sql.go`
