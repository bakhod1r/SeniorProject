# errors.New — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Spec Says](#what-the-spec-says)
3. [The `errors` Package: Public API](#the-errors-package-public-api)
4. [Documented Guarantees of `errors.New`](#documented-guarantees-of-errorsnew)
5. [Version History](#version-history)
6. [Compatibility Promise](#compatibility-promise)
7. [Things the Spec/Docs Do NOT Say](#things-the-specdocs-do-not-say)
8. [Idioms Codified by the Standard Library](#idioms-codified-by-the-standard-library)
9. [References](#references)

---

## Introduction

The Go *language specification* (https://go.dev/ref/spec) defines the language. The `errors` package is part of the **standard library**, not the language. So the rules of `errors.New` come from two sources:

1. **The spec**, which defines `error` (the interface) but does not mention `errors.New`.
2. **The `errors` package documentation**, which describes the function's behavior and guarantees.

This file separates the two, then walks through version history.

---

## What the Spec Says

The spec mentions `error` in only a few places, all about the predeclared interface type:

> **Predeclared identifiers** — Types: any, bool, byte, comparable, complex64, complex128, **error**, float32, float64, int, int8, int16, int32, int64, rune, string, uint, uint8, uint16, uint32, uint64, uintptr.

That is the spec's contribution. There is **nothing** in the language specification about `errors.New`, `errors.Is`, `errors.As`, `fmt.Errorf`, or any error constructor. Those live in the standard library.

The spec defines:
- `error` as a predeclared interface with one method `Error() string`.
- That `error` lives in the universe block (no import needed to *use* the type).

It does **not** define:
- How to create an error value.
- Sentinel patterns.
- Wrapping.
- Comparison rules beyond general interface comparison.

All of that is convention and standard-library API.

---

## The `errors` Package: Public API

As of Go 1.21, the `errors` package exports:

```go
package errors

func New(text string) error
func Unwrap(err error) error
func Is(err, target error) bool
func As(err error, target any) bool
func Join(errs ...error) error

var ErrUnsupported error
```

That is the full surface. `errors.New` is the original — present since Go 1.0. The rest is layered.

### Definition of `New` (verbatim from `errors.go`)

```go
// New returns an error that formats as the given text.
// Each call to New returns a distinct error value even if the text is identical.
func New(text string) error {
    return &errorString{text}
}
```

The doc comment is the contract. Two sentences, two guarantees:
1. The result's `Error()` method returns the given text.
2. Each call returns a *distinct* error value.

### Implementation (also part of the public observable behavior)

```go
type errorString struct {
    s string
}

func (e *errorString) Error() string {
    return e.s
}
```

`errorString` is **unexported**. You cannot import it, name it, or assert against it. Callers cannot distinguish a value returned by `errors.New` from one returned by another constructor that happens to use a similar struct, except via interface satisfaction. That is intentional: the type is an implementation detail, the function is the API.

---

## Documented Guarantees of `errors.New`

From the Go documentation and conventions, `errors.New` guarantees:

1. **Always non-nil.** `errors.New` never returns `nil`, even for an empty string argument.
2. **Distinct identity per call.** Two calls produce two values that compare unequal under `==`.
3. **Stable message.** The `Error()` method returns exactly the input string. Not "trimmed," "lowercased," or "decorated."
4. **Pointer receiver.** The dynamic type of the returned `error` has a *pointer receiver* on `Error()`.
5. **Goroutine-safe.** The returned value is safe to share across goroutines without synchronization.
6. **Allocates.** The function allocates one `*errorString` on the heap. (Not a documented guarantee, but a stable implementation property.)

The first two — non-nil and distinct identity — are explicitly documented. The rest are observable behavior that has been stable across all Go versions and form part of the de-facto contract.

---

## Version History

`errors.New` is one of the oldest functions in Go. Its history:

| Go version | Change |
|---|---|
| **Go 1.0** (March 2012) | `errors.New` shipped as part of the initial public release. The `errors` package has only `New` at this point. |
| **Go 1.13** (September 2019) | Major addition to the `errors` package: `Is`, `As`, `Unwrap`. `errors.New` itself unchanged. The `fmt` package gained the `%w` verb in the same release. |
| **Go 1.20** (February 2023) | `errors.Join` added. `errors.New` unchanged. Multi-wrapping now supported. |
| **Go 1.21** (August 2023) | `ErrUnsupported` added as a standard sentinel for "operation not supported." Pattern reinforced: ship sentinels with `errors.New`. |

The function `errors.New` has had **zero behavioral changes since Go 1.0**. That is over a decade of stability. Code written in 2012 against `errors.New` works identically in 2024.

This stability is a feature: it allows libraries with deep history to keep working unchanged.

---

## Compatibility Promise

Go's [compatibility promise](https://go.dev/doc/go1compat) covers the standard library. For `errors.New`:

- The signature `func New(text string) error` will not change.
- The doc-comment guarantees (non-nil, distinct identity, stable message) will not change.
- The implementation may evolve, but observable behavior will not.

In practice: any program that compiles and runs against `errors.New` today will compile and run against `errors.New` in any future Go 1.x release.

The standard sentinels (`io.EOF`, `sql.ErrNoRows`, `context.Canceled`, etc.) are similarly frozen in identity *and* message.

---

## Things the Spec/Docs Do NOT Say

These are common assumptions that are *not* guaranteed:

- **The dynamic type is `*errors.errorString`.** It is, but that type is unexported and not promised. Other constructors in other packages may return values that match this shape too. Do not assume.
- **The string is interned.** It is not. Two `errors.New("x")` calls allocate two distinct strings (well, two distinct `errorString` structs; the underlying string data may share via constant-folding when the literal is identical, but the struct is fresh).
- **Returns the same value for identical strings.** No — each call returns a new pointer.
- **The implementation does not allocate.** It does. One small allocation per call.
- **`errors.New("")` returns `nil`.** It does not. It returns a non-nil error whose `Error()` returns `""`.
- **`errors.New(s).Error() == s` always.** Yes, this is true and documented. No edge cases.

If you find yourself relying on something not in the documented contract, write a test for it. Implementations may shift in future versions.

---

## Idioms Codified by the Standard Library

The standard library uses `errors.New` in a few canonical ways. Studying them is the best way to understand expected usage.

### Idiom 1: Top-of-package sentinel

```go
// from io
var EOF = errors.New("EOF")
```

Single allocation at init, exposed for callers, name follows `Err...` (or in the case of `EOF`, a long-standing precedent).

### Idiom 2: Ungrouped sentinel for a specific package failure

```go
// from sql
var ErrNoRows = errors.New("sql: no rows in result set")
```

Note the `sql:` package prefix in the message. When the error is logged or printed in isolation, the prefix tells a reader where it came from.

### Idiom 3: Package sentinels gathered in a `var` block

```go
// from net/http
var (
    ErrLineTooLong         = errors.New("header line too long")
    ErrBodyNotAllowed      = errors.New("http: request method or response status code does not allow body")
    ErrHijacked            = errors.New("http: connection has been hijacked")
    // ...
)
```

Convenient, scannable, and consistent.

### Idiom 4: `ErrUnsupported` as a category

Added in Go 1.21:

```go
var ErrUnsupported = errors.New("unsupported operation")
```

Functions in `io`, `os`, and elsewhere now return errors that wrap `ErrUnsupported`. Callers do `errors.Is(err, errors.ErrUnsupported)` to know whether to fall back.

This is a hint about how Go's standard library uses `errors.New`-based sentinels: not just for "this exact thing happened" but for *categories* that callers can match on.

---

## References

- [The Go Programming Language Specification](https://go.dev/ref/spec) — defines `error`, does not define `errors.New`.
- [Standard library docs: errors package](https://pkg.go.dev/errors) — full API.
- [Go 1 Compatibility Promise](https://go.dev/doc/go1compat).
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping).
- [Go 1.20 release notes — `errors.Join`](https://go.dev/doc/go1.20#errors).
- [Go 1.21 release notes — `errors.ErrUnsupported`](https://go.dev/doc/go1.21#errors).
- Source: `$GOROOT/src/errors/errors.go`.
