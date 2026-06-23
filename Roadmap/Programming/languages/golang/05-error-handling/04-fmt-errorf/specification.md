# fmt.Errorf — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Signature and Position in the Language](#signature-and-position-in-the-language)
3. [Documented Behavior](#documented-behavior)
4. [Format Verbs Recognized by `fmt.Errorf`](#format-verbs-recognized-by-fmterrorf)
5. [The `%w` Verb](#the-w-verb)
6. [Multiple `%w` (Go 1.20+)](#multiple-w-go-120)
7. [Returned Concrete Types](#returned-concrete-types)
8. [Interaction with `errors.Is` / `errors.As` / `errors.Unwrap`](#interaction-with-errorsis-errorsas-errorsunwrap)
9. [Version History](#version-history)
10. [Relationship to `fmt.Sprintf`](#relationship-to-fmtsprintf)
11. [Things the Spec / Documentation Does NOT Guarantee](#things-the-spec-documentation-does-not-guarantee)
12. [References](#references)

---

## Introduction

The Go language specification does not mention `fmt.Errorf` — it is a standard-library function, not a language feature. What the *spec* gives us is the `error` interface and the predeclared types. What the `fmt` package and the release notes give us is the contract of `fmt.Errorf`: how it formats, how it wraps, and which concrete types it returns.

This file separates language-level guarantees from package-level documentation.

References:
- [package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Go 1.13 release notes](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes](https://go.dev/doc/go1.20#errors)
- `$GOROOT/src/fmt/errors.go`

---

## Signature and Position in the Language

```go
package fmt
func Errorf(format string, a ...any) error
```

- Takes a format string and a variadic `...any` (alias for `...interface{}` since Go 1.18).
- Returns an `error` (the predeclared interface).
- Lives in the standard library `fmt` package.
- Stable signature since Go 1.0; behavior extended in 1.13 (`%w`) and 1.20 (multiple `%w`).

The signature is identical in shape to `fmt.Sprintf`, except the return type is `error` instead of `string`. This intentional symmetry makes it natural to switch between the two.

---

## Documented Behavior

From the package documentation:

> **`func Errorf(format string, a ...any) error`** — Errorf formats according to a format specifier and returns the string as a value that satisfies error.
>
> If the format specifier includes a `%w` verb with an error operand, the returned error will implement an `Unwrap` method returning the operand. If there is more than one `%w` verb, the returned error implements an `Unwrap` method returning a `[]error` containing all the `%w` operands in the order they appear in the arguments. It is invalid to supply the `%w` verb with an operand that does not implement the `error` interface. The `%w` verb is otherwise a synonym for `%v`.

That paragraph is the entire contract. Let us unpack each clause.

---

## Format Verbs Recognized by `fmt.Errorf`

`fmt.Errorf` shares the format-verb language with the rest of `fmt`. All the standard verbs work:

- **General**: `%v`, `%+v`, `%#v`, `%T`, `%%`
- **Boolean**: `%t`
- **Integer**: `%b`, `%c`, `%d`, `%o`, `%O`, `%q`, `%x`, `%X`, `%U`
- **Floating-point**: `%b`, `%e`, `%E`, `%f`, `%F`, `%g`, `%G`, `%x`, `%X`
- **String / slice**: `%s`, `%q`, `%x`, `%X`
- **Pointer**: `%p`
- **Special to Errorf**: `%w`

Width and precision modifiers (`%5d`, `%.3f`) work as in `Sprintf`.

The full reference is in [package fmt overview](https://pkg.go.dev/fmt). Anything `Sprintf` accepts, `Errorf` accepts.

---

## The `%w` Verb

The `%w` verb is unique to `fmt.Errorf`. Its specification:

1. The operand must implement `error`. If not, the output contains `%!w(<type>=<value>)`. (No panic, no compile error.)
2. The operand is *also* formatted as if `%v`. So the resulting message text contains the same content as if `%v` had been used.
3. The argument index is recorded so the resulting error implements an `Unwrap` method.

Pre-Go 1.20: at most one `%w` per call. A second `%w` was treated as `%!w(...)`.

Post-Go 1.20: any number of `%w` verbs. Each operand becomes part of an `Unwrap() []error` return.

Outside `fmt.Errorf` (e.g. `fmt.Sprintf`, `fmt.Printf`), `%w` is *not* a recognized verb — it produces `%!w(...)` and does not wrap.

Documentation lifts this last point explicitly:

> The `%w` verb is otherwise a synonym for `%v`.

That is, in terms of *text output* it equals `%v`. The wrapping is the side-effect that `errors.Is` and `errors.As` care about.

---

## Multiple `%w` (Go 1.20+)

From the Go 1.20 release notes:

> The `Errorf` function now supports multiple occurrences of the `%w` format verb, which will cause it to return an error that unwraps to the list of all arguments to `%w`.

Behavior:
- Each `%w` records its argument index.
- The resulting error implements `Unwrap() []error`.
- The slice contains the wrapped operands in the order their argument indices appear (after sort/deduplication).
- `errors.Is` / `errors.As` walk every branch of the slice.

Same rules apply: each `%w`'s argument must implement `error`; the textual output is as if `%v` had been used.

---

## Returned Concrete Types

`fmt.Errorf` returns one of three concrete types depending on the format string:

| Number of `%w` | Concrete type | `Unwrap` method |
|----------------|---------------|-----------------|
| 0 | `*errors.errorString` (unexported but equivalent to `errors.New`'s result) | none |
| 1 | `*fmt.wrapError` (unexported) | `Unwrap() error` |
| ≥ 2 | `*fmt.wrapErrors` (unexported) | `Unwrap() []error` |

These types are *not* part of the public API — they are implementation details. You should not assert them directly:

```go
// BAD: relies on unexported type
if w, ok := err.(*fmt.wrapError); ok { ... }
```

Instead, use `errors.Unwrap`, `errors.Is`, `errors.As` to inspect the chain.

---

## Interaction with `errors.Is` / `errors.As` / `errors.Unwrap`

The `errors` package defines the protocol; `fmt.Errorf` is the producer.

### `errors.Unwrap`

```go
func Unwrap(err error) error
```

Returns `err.Unwrap()` if the method exists with signature `Unwrap() error`. For an `Unwrap() []error` (multi-wrap), `errors.Unwrap` returns `nil` — there is no single parent.

### `errors.Is`

```go
func Is(err, target error) bool
```

Walks the chain via either `Unwrap() error` or `Unwrap() []error`. Equality is `==`, with an opt-in `Is(error) bool` method on the wrapped error. Returns true on first match; for multi-wrap, traverses every branch.

### `errors.As`

```go
func As(err error, target any) bool
```

Same traversal rules as `Is`. Assigns the first matching branch to `*target` if assignable, with an opt-in `As(any) bool` method on the wrapped error.

The crucial property: **`fmt.Errorf` with `%w` is the standard way to make wrapping discoverable by `errors.Is` and `errors.As`.** Any custom type that implements `Unwrap` participates in the same protocol.

---

## Version History

| Go version | Change |
|-----------|--------|
| 1.0 | `fmt.Errorf` exists; equivalent to `errors.New(fmt.Sprintf(...))`. |
| 1.13 | `%w` verb added. `errors.Is`, `errors.As`, `errors.Unwrap` introduced. Standard wrapping protocol. |
| 1.18 | Generics; `interface{}` aliased to `any` in stdlib signatures. `Errorf`'s signature shifted from `...interface{}` to `...any`. |
| 1.20 | Multiple `%w` allowed. `errors.Join` introduced. `Unwrap() []error` recognized. |
| 1.21+ | Behavior of `Errorf` itself unchanged. Other `errors`-package additions (e.g. `errors.Join` performance tweaks). |

Old code using `fmt.Errorf` with no `%w` continues to work indefinitely. Adding `%w` is non-breaking — old callers see the same printed text. Multiple `%w` requires Go 1.20+ to compile and run as documented; pre-1.20 it produces `%!w(...)` for the extra ones.

---

## Relationship to `fmt.Sprintf`

`fmt.Errorf(format, args...)` is *almost* equivalent to:

```go
errors.New(fmt.Sprintf(format, args...))
```

with two important differences:

1. **`%w` does not exist** in `fmt.Sprintf`. It produces `%!w(...)` there. So if your format has `%w`, you cannot translate the call to `errors.New(fmt.Sprintf(...))`.
2. **Concrete return type differs**: `fmt.Errorf` may return `*fmt.wrapError` or `*fmt.wrapErrors`, neither of which `errors.New` would produce.

For format strings without `%w`, the two are observationally equivalent. The implementation of `fmt.Errorf` even calls `errors.New(formattedString)` in that branch.

---

## Things the Spec / Documentation Does NOT Guarantee

- **Specific allocation count.** The docs say "returns the string as a value that satisfies error." They do not promise *how many* allocations.
- **Concrete types.** The docs do not promise that single-`%w` returns `*fmt.wrapError`. The implementation could change the unexported type without breaking the contract.
- **Order of arguments and `%w` evaluation.** The order is "in the order they appear in the arguments," but the exact deduplication behavior is implementation detail.
- **Pre-1.20 behavior of multiple `%w`.** Officially: "at most one `%w` verb." In practice: extras render as `%!w(...)`. Do not rely on the exact text of the error verb.
- **Performance characteristics.** No guarantee `fmt.Errorf` is fast or slow. Benchmark on your platform.
- **Behavior with non-error `%w` operands.** Documented as "invalid"; the implementation tolerates with `%!w(...)` but the docs do not promise a specific output format.

---

## References

- [package fmt documentation](https://pkg.go.dev/fmt)
- [package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [package errors](https://pkg.go.dev/errors)
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes — errors](https://go.dev/doc/go1.20#errors)
- [Working with errors in Go 1.13 (blog)](https://go.dev/blog/go1.13-errors)
- `$GOROOT/src/fmt/errors.go`
- `$GOROOT/src/errors/wrap.go`
- `$GOROOT/src/errors/join.go`
