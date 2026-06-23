# Wrapping & Unwrapping Errors — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Spec vs Standard Library](#spec-vs-standard-library)
3. [The fmt.Errorf %w Verb](#the-fmterrorf-w-verb)
4. [The Unwrap Protocol](#the-unwrap-protocol)
5. [errors.Is](#errorsis)
6. [errors.As](#errorsas)
7. [errors.Join and Unwrap() []error](#errorsjoin-and-unwrap-error)
8. [Optional Methods on Custom Errors](#optional-methods-on-custom-errors)
9. [Behavior Across Go Versions](#behavior-across-go-versions)
10. [What the Spec Does Not Say](#what-the-spec-does-not-say)
11. [References](#references)

---

## Introduction

Error wrapping is *not* defined in the Go language specification. It is defined in the **standard library** (`fmt` and `errors` packages) and codified by Go release notes. This file separates the small spec-level facts (formatting verbs, interface implementation rules) from the larger standard-library contract.

References:
- [The Go Programming Language Specification](https://go.dev/ref/spec)
- [Package errors](https://pkg.go.dev/errors)
- [Package fmt](https://pkg.go.dev/fmt)
- [Go 1.13 release notes](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes](https://go.dev/doc/go1.20#errors)

---

## Spec vs Standard Library

The spec contributes:
- **The `error` interface** is predeclared.
- **Method sets** rules — which methods are part of an interface dispatch.
- **Type assertions and switches** — how `err.(interface{ Unwrap() error })` works at runtime.

The standard library contributes:
- **`fmt.Errorf` and the `%w` verb.**
- **`errors.Unwrap`, `errors.Is`, `errors.As`, `errors.Join`.**
- **Convention of optional methods** named exactly `Unwrap`, `Is`, `As`.

A program that does not import `errors` or `fmt` can still implement wrapping by hand: define a type with `Error() string` and `Unwrap() error`, and implement your own walk. But the *protocol* — which method names and shapes the standard helpers recognize — is fixed by the standard library.

---

## The fmt.Errorf %w Verb

From the [`fmt`](https://pkg.go.dev/fmt) package documentation:

> If the format specifier includes a `%w` verb with an error operand, the returned error will implement an `Unwrap` method returning the operand. If there is more than one `%w` verb, the returned error implements an `Unwrap` method returning a `[]error` containing all the `%w` operands in the order they appear in the arguments. It is invalid to supply the `%w` verb with an operand that does not implement the `error` interface.

Key points codified:

1. **`%w` requires the argument to implement `error`.** The spec does not enforce this at compile time; the runtime substitutes a "missing" placeholder. In practice, passing a non-error to `%w` produces an error whose `Unwrap()` returns nil.
2. **Single `%w` → `Unwrap() error`.**
3. **Multiple `%w` → `Unwrap() []error`** (Go 1.20+).
4. **The formatted string is the same as `%v`** — the wrapping does not alter the message.
5. **Order of arguments is preserved** in the `[]error` for multi-wrap.

The `%w` verb is documented but not part of the language spec. It is a contract of the `fmt` package implementation.

---

## The Unwrap Protocol

A type *participates in the wrap chain* by implementing one of:

```go
Unwrap() error
Unwrap() []error
```

The `errors` package functions (`Is`, `As`, `Unwrap`) recognize these method shapes via type assertion.

### The single-error form

```go
type MyErr struct{ inner error }
func (e *MyErr) Unwrap() error { return e.inner }
```

`errors.Unwrap(myErrInstance)` returns the inner error.

### The multi-error form (Go 1.20+)

```go
type MyMultiErr struct{ inners []error }
func (e *MyMultiErr) Unwrap() []error { return e.inners }
```

`errors.Unwrap(myMultiErrInstance)` returns **`nil`** (because `Unwrap` here returns `[]error`, not `error`). This is a subtle but documented behavior — `errors.Unwrap` only handles the single-error form. Tree traversal happens internally in `errors.Is`/`errors.As`.

### The protocol is duck-typed

Go's interface mechanism finds the methods by name and signature. There is no central registration. Standard-library types (`*fmt.wrapError`, `*os.PathError`, `*net.OpError`, etc.) all use the convention.

---

## errors.Is

Signature:

```go
func Is(err, target error) bool
```

Specification (paraphrased from `pkg.go.dev/errors`):

> `Is` reports whether any error in `err`'s tree matches `target`. The tree consists of `err` itself, followed by the errors obtained by repeatedly calling `Unwrap`. When `err` wraps multiple errors, `Is` examines `err` followed by a depth-first traversal of its children.
>
> An error is considered to match a target if it is equal to that target or if it implements a method `Is(error) bool` such that `Is(target)` returns true.

Key consequences:

- **`Is` walks the chain (or tree).**
- **Equality is `==`.** This implies the target must be a comparable value (or the layer must override with custom `Is`).
- **Depth-first** for trees from `Unwrap() []error`.
- **Custom `Is(target error) bool`** is consulted at each layer.
- **A layer with `Unwrap() []error` makes the walk branch.**

Edge cases:

- `errors.Is(err, nil)` returns true iff `err == nil`.
- A non-comparable layer skipped via `==` may still match via custom `Is`.
- Cycles in custom `Unwrap` cause infinite loops — *the standard library does not check for cycles*.

---

## errors.As

Signature:

```go
func As(err error, target any) bool
```

Specification:

> `As` finds the first error in `err`'s tree that matches `target`, and if one is found, sets `target` to that error value and returns true. Otherwise, it returns false.
>
> The tree consists of `err` itself, followed by the errors obtained by repeatedly calling `Unwrap`. When `err` wraps multiple errors, `As` examines `err` followed by a depth-first traversal of its children.
>
> An error matches `target` if the error's concrete type is assignable to the type pointed to by `target`, or if the error has a method `As(any) bool` such that `As(target)` returns true.
>
> `As` panics if `target` is not a non-nil pointer to either a type that implements `error`, or to any interface type.

Key consequences:

- **`target` must be a non-nil pointer.** Compile time does not enforce this; the function panics.
- **The pointed-to type must implement `error` or be an interface type.**
- **Assignability is the match criterion**, not equality.
- **Custom `As(any) bool`** can override with custom matching.
- **The first match wins** — `As` does not return all matches.

---

## errors.Join and Unwrap() []error

Added in Go 1.20.

Signature:

```go
func Join(errs ...error) error
```

Specification (paraphrased):

> `Join` returns an error that wraps the given errors. Any nil error values are discarded. `Join` returns nil if every value in errs is nil. The error formats as the concatenation of the strings obtained by calling the `Error` method of each element of errs, with a newline between each string.
>
> The error returned implements `Unwrap() []error`. The behavior of `errors.Is` and `errors.As` for such errors is to traverse the slice depth-first.

Key consequences:

- **Nils are filtered.** `errors.Join(nil, e1, nil, e2)` returns a 2-element join.
- **All-nil returns nil.** `errors.Join(nil, nil)` returns `nil` exactly.
- **Single-error case:** `errors.Join(e1)` returns a `*joinError` wrapping `[e1]`, *not* `e1` itself. The result has its own identity. (This may change in future versions; check release notes.)
- **`.Error()` is newline-joined.** Not user-friendly for single-line UIs.
- **`Unwrap() []error`** integrates with `errors.Is`/`errors.As`.

The `joinError` type is unexported. Callers should not attempt to type-assert it.

---

## Optional Methods on Custom Errors

The `errors` package recognizes four optional methods on user-defined error types:

```go
Error() string                // required for any error
Unwrap() error                // wrapping protocol (single)
Unwrap() []error              // wrapping protocol (multi)
Is(target error) bool         // override for errors.Is
As(target any) bool           // override for errors.As
```

The last two are *override* methods. If present, they are consulted *in addition to* the default behavior at each layer of the chain. Returning false from your `Is`/`As` does not block further walking; returning true means "this layer matches."

A type that implements both `Unwrap() error` and `Unwrap() []error` is rare and should be avoided — the protocol prefers the single form when both are present. (Spec text in the `errors.Is` documentation says it *uses Unwrap depending on its return type*, in practice the package checks for the single-form first.)

---

## Behavior Across Go Versions

| Version | Feature |
|---------|---------|
| Pre-1.13 | No standard wrapping. Third-party (`pkg/errors`) used `Cause()`. |
| 1.13 | `fmt.Errorf` `%w` introduced; `errors.Unwrap`, `errors.Is`, `errors.As` added. Single-`%w` only. |
| 1.20 | `errors.Join` added; multiple `%w` in `fmt.Errorf` allowed; `Unwrap() []error` recognized in `errors.Is`/`errors.As` walks. |
| 1.21+ | Bug fixes and minor improvements; protocol stable. |

Invalid before 1.20:
```go
fmt.Errorf("%w; %w", a, b)  // pre-1.20: invalid format, returns error mentioning the issue
```

Validity post-1.20:
```go
fmt.Errorf("%w; %w", a, b)  // 1.20+: returns a wrapErrors with Unwrap() []error
```

If you maintain code that must build on pre-1.20 toolchains, do not use multiple `%w` and do not rely on `errors.Join`.

---

## What the Spec Does Not Say

The Go *language* specification does not say:

- That you must use `%w` to wrap. (It is a stdlib formatting verb.)
- That `Unwrap`, `Is`, `As` are special method names. (They are stdlib conventions, recognized by the `errors` package via type assertion.)
- That wrap chains are linked lists or trees. (That is a structural consequence of the protocol.)
- That `errors.Is` walks. (It is defined in the standard library, not the language.)

The *standard library* does not say:

- How custom `Is` should handle non-comparable arguments. (Up to the implementer.)
- How long a chain may be. (Unbounded; cycles cause infinite loops.)
- That you should wrap. (That is a community convention.)

This separation is intentional. The language stays minimal; the standard library carries the protocol; the community carries the idioms.

---

## References

- [The Go Programming Language Specification — Predeclared identifiers](https://go.dev/ref/spec#Predeclared_identifiers)
- [The Go Programming Language Specification — Type assertions](https://go.dev/ref/spec#Type_assertions)
- [Package errors](https://pkg.go.dev/errors) — full API and behavior.
- [Package fmt — `Errorf`](https://pkg.go.dev/fmt#Errorf) — `%w` documentation.
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes — multiple wrapping and `errors.Join`](https://go.dev/doc/go1.20#errors)
- [Working with Errors in Go 1.13 (Go blog)](https://go.dev/blog/go1.13-errors)
- `$GOROOT/src/errors/wrap.go`
- `$GOROOT/src/errors/join.go`
- `$GOROOT/src/fmt/errors.go`
- [Proposal: Error Inspection (29934)](https://go.googlesource.com/proposal/+/master/design/29934-error-values.md)
- [Proposal: Multiple wrapping in fmt.Errorf (53435)](https://github.com/golang/go/issues/53435)
