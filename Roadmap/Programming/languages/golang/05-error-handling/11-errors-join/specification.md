# errors.Join — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The `errors` Package: Join API](#the-errors-package-join-api)
3. [The `Unwrap() []error` Convention](#the-unwrap-error-convention)
4. [`errors.Is` and `errors.As` Walk Semantics](#errorsis-and-errorsas-walk-semantics)
5. [`fmt.Errorf` with Multiple `%w`](#fmterrorf-with-multiple-w)
6. [Documented Guarantees](#documented-guarantees)
7. [Interaction with `errors.Unwrap`](#interaction-with-errorsunwrap)
8. [Custom `Is` and `As` Methods](#custom-is-and-as-methods)
9. [Compatibility Across Versions](#compatibility-across-versions)
10. [Things the Spec Does NOT Define](#things-the-spec-does-not-define)
11. [Stable Interface Surface](#stable-interface-surface)
12. [References](#references)

---

## Introduction

The Go language specification does not mention errors at all — `error` is just a built-in interface, and `errors.Join` is a standard-library function. This document collects the *de facto* contract: what is documented in `pkg/errors`, what is stable behavior across versions, and what is implementation-specific.

Reference: [The Go Programming Language Specification](https://go.dev/ref/spec) (silent on multi-errors), [Package errors](https://pkg.go.dev/errors), and [Go 1.20 release notes](https://go.dev/doc/go1.20#errors).

---

## The `errors` Package: Join API

From `pkg/errors`:

```go
// Join returns an error that wraps the given errors.
// Any nil error values are discarded.
// Join returns nil if every value in errs is nil.
// The error formats as the concatenation of the strings obtained
// by calling the Error method of each element of errs, with a newline
// between each string.
//
// A non-nil error returned by Join implements the Unwrap() []error method.
func Join(errs ...error) error
```

Documented contract:

1. **nil filtering** — `nil` arguments are discarded.
2. **all-nil = nil** — `Join()` and `Join(nil, nil, ...)` return `nil`.
3. **`Error()` is newline-concatenated** — children's `Error()` joined with `\n`.
4. **The result implements `Unwrap() []error`** — exposing the children.

Not documented but observable (and stable since 1.20):

- The result is a pointer to an unexported type (`*errors.joinError`).
- The result of a single non-nil arg is *not* the same as the arg — it is a 1-element joinError.
- Nesting is preserved (no flattening).
- The slice returned by `Unwrap() []error` is the internal slice, not a copy.

Programs may depend on the documented contract. They should not depend on the unexported type or on the slice being shared.

---

## The `Unwrap() []error` Convention

The Go 1.20 release notes:

> The errors package adds a new Join function that returns an error wrapping a list of errors. The Is and As functions check for matches in the unwrapped tree of errors, including those returned by Join. fmt.Errorf now supports multiple occurrences of the %w verb, which will cause it to return an error which unwraps to the list of all arguments to %w.
>
> Both Join and Errorf return errors that have an Unwrap method that returns a []error.

So the convention is:

```go
type multiErrorMethod interface {
    Unwrap() []error
}
```

If your error type has this method, the standard library treats it as a multi-error.

Notes from `pkg/errors`:

> An error type might provide an Unwrap method but no Is method, in which case Is unwraps the error.
> Is also walks Unwrap() []error returns.

The same applies to `As`.

---

## `errors.Is` and `errors.As` Walk Semantics

From `pkg/errors`:

```go
// Is reports whether any error in err's tree matches target.
//
// The tree consists of err itself, followed by the errors obtained by
// repeatedly calling Unwrap. When err wraps multiple errors, Is examines
// err followed by a depth-first traversal of its children.
//
// An error is considered to match a target if it is equal to that target
// or if it implements a method Is(error) bool such that Is(target)
// returns true.
func Is(err, target error) bool

// As finds the first error in err's tree that matches target, and if one
// is found, sets target to that error value and returns true. Otherwise,
// it returns false.
//
// The tree consists of err itself, followed by the errors obtained by
// repeatedly calling Unwrap. When err wraps multiple errors, As examines
// err followed by a depth-first traversal of its children.
func As(err error, target any) bool
```

The walk:

1. Visit the current error.
2. Test it (`==` for `Is`, type-assignable for `As`, plus the optional `Is`/`As` method).
3. If no match, descend:
   - If the error implements `Unwrap() error`, recurse on the result (treated iteratively in current implementations).
   - Else if the error implements `Unwrap() []error`, recurse on each child in order.
4. Return on first match.

Order: **DFS pre-order**, left-to-right. Documented as such in the package comment.

The walk descends through *both* unwrap interfaces. A type that implements both contributes the slice version to the walk; the single-error version is unused for `Is`/`As` (though `errors.Unwrap` the function still uses it).

---

## `fmt.Errorf` with Multiple `%w`

From `pkg/fmt`:

> If the format specifier includes a `%w` verb with an error operand, the returned error will implement an Unwrap method returning the operand.
>
> If there is more than one `%w` verb, the returned error implements an Unwrap method returning a `[]error` containing all the `%w` operands in the order they appear in the arguments.
>
> It is invalid to supply the `%w` verb with an operand that does not implement the error interface. The `%w` verb is otherwise a synonym for `%v`.

So:

| Format | Return-type's `Unwrap` |
|--------|------------------------|
| no `%w` | none |
| one `%w` | `Unwrap() error` |
| two or more `%w` | `Unwrap() []error` |

The shape varies with the number of `%w` verbs in the format string. Same call site, different result type.

Compatibility note: code written before Go 1.20 that uses a single `%w` continues to work unchanged. Code that wants multiple causes can now use multiple `%w`s in the same `Errorf` call.

---

## Documented Guarantees

The standard library *guarantees* (and you may rely on these in production):

| Guarantee | Source |
|-----------|--------|
| `errors.Join(nil, nil, ...)` returns `nil`. | `pkg/errors`, `Join` doc |
| `errors.Join` discards nil arguments. | `pkg/errors`, `Join` doc |
| The result of `errors.Join` (when non-nil) implements `Unwrap() []error`. | `pkg/errors`, `Join` doc |
| `errors.Is` walks `Unwrap() []error` in addition to `Unwrap() error`. | `pkg/errors`, `Is` doc |
| `errors.As` walks `Unwrap() []error` in addition to `Unwrap() error`. | `pkg/errors`, `As` doc |
| `fmt.Errorf` with multiple `%w` returns an error implementing `Unwrap() []error`. | `pkg/fmt`, `Errorf` doc |
| The walk order is DFS pre-order, left-to-right. | `pkg/errors`, `Is`/`As` docs |

Guarantees you should *not* rely on:

| Implementation detail | Reason not to depend on it |
|----------------------|----------------------------|
| The unexported `*errors.joinError` type. | Could be renamed or replaced. |
| The exact format of the newline-concatenated message (no leading/trailing newline currently). | Could be tweaked for readability. |
| The slice returned by `Unwrap() []error` is the internal one. | Future versions might copy. |
| Two-pass implementation in `Join`. | Compiler-internal. |
| Performance numbers. | Vary by Go version, hardware, message length. |

---

## Interaction with `errors.Unwrap`

The package-level function `errors.Unwrap` is documented to follow the single-error interface only:

```go
// Unwrap returns the result of calling the Unwrap method on err, if err's
// type contains an Unwrap method returning error.
// Otherwise, Unwrap returns nil.
//
// Unwrap only calls a method of the form "Unwrap() error".
// In particular Unwrap does not unwrap errors returned by [Join].
func Unwrap(err error) error
```

That last sentence is in the documentation as of Go 1.20. The behavior is intentional:

- A multi-error has no single "next" error.
- Returning the first child would be arbitrary.
- Returning the slice would change the function signature.

Code that walks an error chain via `errors.Unwrap` therefore stops at any multi-error in the chain. To traverse the full tree, use `errors.Is`/`As` (which descend into both shapes) or write a custom walker that handles `Unwrap() []error` explicitly.

This asymmetry is the most common surprise for developers used to the Go 1.13 chain semantics. The mental model has shifted: the *walkers* are aware of multi-errors; the *single-step Unwrap* is not.

---

## Custom `Is` and `As` Methods

A type may provide:

```go
Is(target error) bool   // optional, used by errors.Is
As(target any) bool     // optional, used by errors.As
```

If present, the walker calls these *before* recursing into children. A custom `Is` lets you match by content (e.g., comparing a struct's fields) instead of identity.

```go
type ParseErr struct{ Field string }

func (p *ParseErr) Error() string { return "parse: " + p.Field }

func (p *ParseErr) Is(target error) bool {
    t, ok := target.(*ParseErr)
    return ok && t.Field == p.Field
}
```

For multi-errors, custom `Is` / `As` on the multi-error type is rarely needed — the walker already descends. Reserve them for value-equality semantics on individual leaf types.

The contract: `Is(target)` should return true iff the error semantically *is* the target. Returning true for unrelated targets (e.g., always returning true) breaks `errors.Is` for every caller.

---

## Compatibility Across Versions

| Go version | Notable change |
|-----------|----------------|
| 1.13 | `errors.Is`, `errors.As`, `errors.Unwrap` introduced. `fmt.Errorf` with single `%w`. |
| 1.20 | `errors.Join` introduced. `Unwrap() []error` convention. `fmt.Errorf` accepts multiple `%w`. `errors.Is` and `errors.As` walk slice unwraps. |
| 1.21+ | No breaking changes to multi-error API. Some performance improvements in `Is`/`As` walking. |

Code compiled with Go 1.20+ that uses `errors.Join` will *not* compile against earlier Go toolchains. Backward-compatible alternatives if you need older Go support:

- `hashicorp/multierror` — `Unwrap` returns `error` and is walked since 1.13. Not the same as `Unwrap() []error` but works for `errors.Is`/`As`.
- A custom type with `Unwrap() error` — chain-shaped, walks correctly.

`Unwrap() []error` itself is observed by the standard library only in 1.20+. Implementing it on your type in code targeting 1.19 has no effect on `errors.Is`/`As`.

The `fmt.Errorf` multi-`%w` extension is also 1.20+. Pre-1.20 versions of `Errorf` reject multiple `%w` with a malformed-format error.

---

## Things the Spec Does NOT Define

- **The exact format of `(*joinError).Error()`** beyond "newline-concatenated". A future version could add bullets or indentation; do not parse the string.
- **Whether `Unwrap() []error` returns a fresh slice or a shared one.** Treat as read-only.
- **Stack traces or location information in the joined error.** None — `Join` carries no metadata.
- **Deduplication, sorting, or flattening of children.** None — the implementation is faithful to the input.
- **Maximum number of children.** No documented limit; bounded by memory.
- **Behavior when `Error()` is called on a child that panics.** Implementation-defined; in practice the panic propagates.
- **Behavior of `errors.Is` against a `nil` `target`.** Documented to compare `err == target` — only true if both are nil.
- **Whether the walker is iterative or recursive.** Currently the multi-error branch is recursive in `Is`/`As`; this is an implementation choice.

---

## Stable Interface Surface

The set of guarantees you may depend on for code written in 2026:

```go
// Construction
func errors.Join(errs ...error) error            // 1.20+

// Walking
func errors.Is(err, target error) bool           // 1.13+, walks []error since 1.20
func errors.As(err error, target any) bool       // 1.13+, walks []error since 1.20
func errors.Unwrap(err error) error              // 1.13+, does NOT walk []error

// User-implemented interfaces
type interface{ Unwrap() error }                 // single-cause chain (1.13+)
type interface{ Unwrap() []error }               // multi-cause tree (1.20+)
type interface{ Is(error) bool }                 // custom equality (1.13+)
type interface{ As(any) bool }                   // custom type-assertion (1.13+)

// Format
fmt.Errorf("...%w...", err)                      // 1.13+: Unwrap() error
fmt.Errorf("...%w...%w...", a, b)                // 1.20+: Unwrap() []error
```

For tools that consume errors (logging libraries, frameworks, RPC layers), implement against these interfaces. The concrete types behind `errors.Join` and `fmt.Errorf` are unexported and may change across Go versions; their *behavior* is the contract.

---

## References

- [The Go Programming Language Specification](https://go.dev/ref/spec)
- [Package errors — Join, Is, As, Unwrap](https://pkg.go.dev/errors)
- [Package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Go 1.20 release notes — errors](https://go.dev/doc/go1.20#errors)
- [Go proposal #53435 — Wrapping multiple errors](https://github.com/golang/go/issues/53435)
- [Go proposal #41198 — multiple errors](https://github.com/golang/go/issues/41198) — earlier discussion
- `$GOROOT/src/errors/join.go`
- `$GOROOT/src/errors/wrap.go`
- `$GOROOT/src/fmt/errors.go`
