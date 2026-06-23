# Error Handling Basics — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Predeclared error Interface](#the-predeclared-error-interface)
3. [Spec Text on Error](#spec-text-on-error)
4. [Multi-Value Returns: Spec Mechanics](#multi-value-returns-spec-mechanics)
5. [Nil Interface Values](#nil-interface-values)
6. [The errors Package: Public API](#the-errors-package-public-api)
7. [Compatibility and Versioning](#compatibility-and-versioning)
8. [Idioms Codified by the Spec or Standard Library](#idioms-codified-by-the-spec-or-standard-library)
9. [Comparing the Spec to Real Code](#comparing-the-spec-to-real-code)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [Things the Spec Does NOT Say](#things-the-spec-does-not-say)
12. [References](#references)

---

## Introduction

The Go specification defines the language. The `errors` package and idioms are convention layered on top of that small core. This file separates "what the spec actually says" from "what the community has agreed to do."

Reference: [The Go Programming Language Specification](https://go.dev/ref/spec).

---

## The Predeclared error Interface

From the **Predeclared identifiers** section of the spec:

> **Types**: any, bool, byte, comparable, complex64, complex128, error, float32, float64, int, int8, int16, int32, int64, rune, string, uint, uint8, uint16, uint32, uint64, uintptr

`error` is a predeclared *interface type*. The spec defines it as if written:

```go
type error interface {
    Error() string
}
```

It lives in the **universe block** (the outermost scope), so you can use it anywhere without importing.

Predeclared status means:
- You cannot redefine it at package scope (no `type error int`).
- You can shadow it inside a smaller scope (a local variable named `error`), but that is universally a bad idea.
- It is part of the language, not the standard library — even a program with no imports can use it.

---

## Spec Text on Error

The spec mentions `error` in only a few places:

1. **Predeclared identifiers** — listed as a type.
2. **Type assertions** — `e.(error)` is valid for asserting an interface holds an error.
3. **Type switches** — `switch e := x.(type) { case error: ... }`.

That is essentially all the spec says about `error`. The semantics — when to use it, how to wrap it, how to compare it — are *convention*, not spec.

The spec also defines `panic` and `recover` as built-in functions, and these interact with errors at runtime, but the `error` type itself is not coupled to panic.

---

## Multi-Value Returns: Spec Mechanics

The error idiom relies on **multi-valued returns**. From the spec, **Function types**:

> A function may return multiple values. The return statement may include a list of expressions whose number and types match the function's result list.

```
FunctionType   = "func" Signature .
Signature      = Parameters [ Result ] .
Result         = Parameters | Type .
Parameters     = "(" [ ParameterList [ "," ] ] ")" .
```

A signature `func() (int, error)` is two unnamed return parameters. The compiler enforces that all paths return both values.

From **Assignments**:

> The assignment proceeds in two phases. First, the operands of index expressions and pointer indirections [...] on the left and the expressions on the right are all evaluated. Second, the assignments are carried out in left-to-right order.

So `n, err := f()` evaluates `f()`, then assigns both returns simultaneously. `n` and `err` are guaranteed to be a *consistent pair* from the same call.

---

## Nil Interface Values

From the spec, **Interface types**:

> The value of an uninitialized interface is nil.

> Two interface values are equal if they have identical dynamic types and equal dynamic values or if both have value nil.

So `var err error` is nil (both type and value words are zero). `err == nil` is true.

The famous trap:

```go
type MyErr struct{}
func (*MyErr) Error() string { return "x" }
func f() error {
    var p *MyErr = nil
    return p  // returns *non-nil* interface!
}
```

This is **specified behavior**, not a bug. The interface value has dynamic type `*MyErr` (non-nil type word) and dynamic value `nil` (nil data word). Per the spec, equality requires *both* to be nil, so the interface is non-nil.

The fix: return an explicit `nil` from the function when there is no error, do not pass through a typed nil pointer.

---

## The errors Package: Public API

Defined in `$GOROOT/src/errors/`. Public surface:

```go
// errors.go
func New(text string) error

// wrap.go (Go 1.13+)
func Unwrap(err error) error
func Is(err, target error) bool
func As(err error, target any) bool

// join.go (Go 1.20+)
func Join(errs ...error) error
```

Method conventions for custom errors:

```go
type MyErr struct{ /* fields */ }
func (e *MyErr) Error() string  { /* required */ }
func (e *MyErr) Unwrap() error  { /* optional, for wrapping */ }
func (e *MyErr) Is(target error) bool  { /* optional, custom Is */ }
func (e *MyErr) As(target any) bool    { /* optional, custom As */ }
```

`errors.Is` and `errors.As` use `Unwrap` recursively. They also call the optional `Is` / `As` methods if defined.

---

## Compatibility and Versioning

Go promises strict backward compatibility within `1.x`. Errors-related additions:

| Go version | Addition |
|-----------|----------|
| 1.0 | `errors.New`, the `error` interface |
| 1.13 | `errors.Is`, `errors.As`, `errors.Unwrap`, `fmt.Errorf` `%w` verb |
| 1.20 | `errors.Join`, multiple `%w` verbs in `fmt.Errorf` |
| (future) | Ongoing community discussion of stack-trace integration |

Old code using only `errors.New` and `==` continues to compile and run unchanged. The newer features are additive.

---

## Idioms Codified by the Spec or Standard Library

Some "idioms" are *required* by tooling or stdlib behavior:

- **Error message starts lowercase, no trailing punctuation.** Codified by `golint` and the standard library. Reason: errors compose as `fmt.Errorf("op: %w", err)` and double-capitalization looks silly.
- **`error` is the last return value.** Tooling like `errcheck` assumes this.
- **`fmt.Errorf` with `%w` for wrapping.** Defined in stdlib; `%v` does *not* wrap.
- **`Is` / `As` / `Unwrap` method names.** Used by `errors.Is`/`errors.As`. If you misspell, the chain breaks silently.

---

## Comparing the Spec to Real Code

The spec is minimal: an interface and a few rules about returning values. Real code piles convention on top:

| Spec | Convention |
|------|------------|
| `error` is an interface | Use as last return value |
| Returning nil interface = no error | Always check `err != nil` |
| No language wrapping | Use `fmt.Errorf("%w", ...)` |
| No comparison rules | Use `errors.Is`, not `==`, for wrapped errors |

A rookie reading only the spec will know how to declare an error but not how to use one well. Conversely, a developer who learns only the conventions sometimes misunderstands edge cases like the typed-nil gotcha. Both layers matter.

---

## Differences Across Go Versions

Behavior worth knowing version-by-version:

- **Pre-1.13**: `errors.Unwrap`, `errors.Is`, `errors.As` did not exist. Wrapping was done via third-party packages like `github.com/pkg/errors`.
- **1.13**: Standardized wrapping via `%w` and the `errors` package functions. Old code still works; new code can adopt them.
- **1.20**: `errors.Join` for combining; multiple `%w` in `fmt.Errorf`.
- **Future**: There has been discussion (and rejected proposals) of `try` keyword and stack traces. Status: not landed.

If you maintain code that supports Go versions older than 1.13, you cannot use `%w`. For modern code (1.21+), use the full feature set.

---

## Things the Spec Does NOT Say

- **The spec does not require you to check errors.** `f()` (with no assignment) when `f` returns `(T, error)` is legal and silently discards both returns.
- **The spec does not require error messages to start lowercase.** That is convention.
- **The spec does not require `%w` formatting.** Convention.
- **The spec does not require `Unwrap`/`Is`/`As` methods.** They are an opt-in protocol.
- **The spec does not link errors to panic.** They are independent mechanisms.

This is by design. The spec keeps the language small; the convention layer keeps the ecosystem coherent.

---

## References

- [The Go Programming Language Specification — Predeclared identifiers](https://go.dev/ref/spec#Predeclared_identifiers)
- [The Go Programming Language Specification — Function types](https://go.dev/ref/spec#Function_types)
- [The Go Programming Language Specification — Interface types](https://go.dev/ref/spec#Interface_types)
- [Package errors documentation](https://pkg.go.dev/errors)
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes — errors.Join](https://go.dev/doc/go1.20#errors)
- `$GOROOT/src/errors/errors.go`
- `$GOROOT/src/fmt/errors.go`
