# Error Design — Best Practices — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The `error` Interface](#the-error-interface)
3. [The `errors` Package API](#the-errors-package-api)
4. [The `fmt.Errorf` Contract](#the-fmterrorf-contract)
5. [Convention: Error Strings](#convention-error-strings)
6. [Convention: Exported Error Identifiers](#convention-exported-error-identifiers)
7. [Convention: When to Panic](#convention-when-to-panic)
8. [`Unwrap`, `Is`, and `As` Method Contracts](#unwrap-is-and-as-method-contracts)
9. [`errors.Join` and Multi-Errors](#errorsjoin-and-multi-errors)
10. [Compatibility Across Versions](#compatibility-across-versions)
11. [Things the Spec Does NOT Define](#things-the-spec-does-not-define)
12. [References](#references)

---

## Introduction

The Go specification defines the `error` interface and the `panic`/`recover` mechanism. It says nothing about message style, sentinel design, wrapping conventions, or testing strategy. Those are *conventions* established by:

- The standard library's own usage.
- The Go team's blog posts (notably the Go 1.13 errors post).
- The `gofmt`-style consensus document at [https://github.com/golang/go/wiki/CodeReviewComments](https://github.com/golang/go/wiki/CodeReviewComments).
- Years of discussion on the `golang-nuts` and `golang-dev` lists.

This document collects what is *contractual* (the `error` interface, `Unwrap`, `Is`, `As`) and what is *conventional* (message style, naming).

---

## The `error` Interface

From the Go spec:

```go
type error interface {
    Error() string
}
```

That is it. Anything that implements a method `Error() string` is an `error`. The spec does not say:
- Whether `Error()` should be pure (no side effects).
- Whether `Error()` should be safe for concurrent use.
- Whether `Error()` should always return the same string.

The *convention* is yes to all three. A non-pure, non-thread-safe, non-stable `Error()` is a bug.

### `nil` errors

The spec defines that an interface value is `nil` only when both its dynamic type and value are nil. Therefore:

```go
var p *MyErr  // (type: *MyErr, value: nil)
var e error = p
e == nil  // false
```

This is the [typed-nil pitfall](https://go.dev/doc/faq#nil_error). To avoid it:

```go
if condition {
    return p  // BAD: e != nil
}
return nil   // GOOD: dynamic type also nil
```

---

## The `errors` Package API

From `pkg/errors`:

```go
// New returns an error that formats as the given text.
// Each call to New returns a distinct error value even if the text is identical.
func New(text string) error

// Unwrap returns the result of calling the Unwrap method on err, if err's type
// contains an Unwrap method returning error. Otherwise, Unwrap returns nil.
//
// Unwrap returns nil if the Unwrap method returns []error.
func Unwrap(err error) error

// Is reports whether any error in err's chain matches target.
//
// The chain consists of err itself followed by the sequence of errors obtained
// by repeatedly calling Unwrap.
//
// An error is considered to match a target if it is equal to that target or if
// it implements a method Is(error) bool such that Is(target) returns true.
func Is(err, target error) bool

// As finds the first error in err's chain that matches target, and if one is
// found, sets target to that error value and returns true. Otherwise, it
// returns false.
//
// The chain consists of err itself followed by the sequence of errors obtained
// by repeatedly calling Unwrap.
//
// An error matches target if the error's concrete type is assignable to the
// type pointed to by target, or if the error has a method As(any) bool such
// that As(target) returns true. As panics if target is not a non-nil pointer
// to either a type that implements error, or to any interface type.
func As(err error, target any) bool

// Join returns an error that wraps the given errors. Any nil error values are
// discarded. Join returns nil if every value in errs is nil. The error formats
// as the concatenation of the strings obtained by calling the Error method of
// each element of errs, with a newline between each string.
//
// A non-nil error returned by Join implements the Unwrap() []error method.
func Join(errs ...error) error
```

**Key contracts:**

- `Is` and `As` walk the chain via `Unwrap()` (single-error form) or `Unwrap() []error` (multi-error form).
- `As` panics if `target` is not a non-nil pointer to an error-implementing type. Always pass `&t` where `t` is the typed error variable.
- Two `errors.New("x")` calls are *not* equal: each has its own pointer.

---

## The `fmt.Errorf` Contract

From `pkg/fmt`:

```go
// Errorf formats according to a format specifier and returns the string as a
// value that satisfies error.
//
// If the format specifier includes a %w verb with an error operand, the
// returned error will implement an Unwrap method returning the operand.
// If there is more than one %w verb, the returned error will implement an
// Unwrap method returning a []error containing all the %w operands in the
// order they appear in the arguments. It is invalid to supply the %w verb
// with an operand that does not implement the error interface. The %w verb
// is otherwise a synonym for %v.
func Errorf(format string, a ...any) error
```

**Key points:**

- `%w` is the only way `fmt.Errorf` produces a wrapping error. Any other format verb (`%v`, `%s`, `%d`) does not wrap.
- One `%w`: returns `*fmt.wrapError` whose `Unwrap()` returns one `error`.
- Multiple `%w` (Go 1.20+): returns `*fmt.wrapErrors` whose `Unwrap()` returns `[]error`.
- A `%w` with a non-error operand: panic at runtime (in some Go versions) or returns an error string mentioning `%!w(BADTYPE)`.

Pre-Go-1.20 code with multiple `%w` is a compile-time concern: it was disallowed. Post-1.20 it is allowed.

### Example: multiple `%w`

```go
errA := errors.New("a")
errB := errors.New("b")
err := fmt.Errorf("two: %w, %w", errA, errB)

errors.Is(err, errA)  // true
errors.Is(err, errB)  // true
```

The chain has *two* parallel branches. `errors.Is` walks both.

---

## Convention: Error Strings

From `https://github.com/golang/go/wiki/CodeReviewComments#error-strings`:

> Error strings should not be capitalized (unless beginning with proper nouns or acronyms) or end with punctuation, since they are usually printed following other context. That is, use `fmt.Errorf("something bad")` not `fmt.Errorf("Something bad")`, so that `log.Printf("Reading %s: %v", filename, err)` formats without a spurious capital letter mid-message.

Additional conventions, less formally documented:

- No `error:` or `Error:` prefix. The reader knows it is an error.
- No `\n` at the end. Loggers add their own newlines.
- Verb-noun ordering: "open `path`", "read `id`", "validate `field`" — not "`path` could not be opened".
- Include relevant identifiers (path, ID, key) but **not** secrets (password, token, PII).

### Examples

| Bad | Good |
|-----|------|
| `Could not connect to database!` | `connect mysql: timeout` |
| `Error: file not found.` | `open /etc/x.conf: no such file or directory` |
| `unauthorized` (no context) | `auth user 42: token expired` |
| `failed.` | `parse config: unexpected end of file` |

---

## Convention: Exported Error Identifiers

From the standard library and community usage:

- **Sentinel name**: `ErrSomething`. Examples: `io.EOF`, `os.ErrNotExist`, `sql.ErrNoRows`.
- **Type name for typed errors**: `SomethingError` or `Error` if the package is small. Examples: `*os.PathError`, `*url.Error`, `*json.SyntaxError`.
- **Place at the top of the file** that owns them, after imports.
- **Document each one**:

```go
// ErrNotFound is returned when the requested resource does not exist.
var ErrNotFound = errors.New("not found")
```

The Go team has been explicit that exported error identifiers are part of the package's public API and follow the same compatibility rules.

---

## Convention: When to Panic

From `https://github.com/golang/go/wiki/PanicAndRecover`:

> Panics should not be used for normal error handling. Use error returns. Panics are for programmer errors and unrecoverable situations.

Practical guidance:

- Panic at startup if configuration is missing or invalid (or use `log.Fatal` / `os.Exit(1)` — same effect from the user's perspective).
- Panic in a function when the caller has violated the function's contract (nil where non-nil is required).
- Panic when continuing would corrupt state.
- *Do not* panic in library code on user-supplied input. Return an error.
- *Do not* recover and ignore. Recovering implies you know the panic is benign; if you do, log it.

The runtime spec defines panic behavior. The convention defines when to use it.

---

## `Unwrap`, `Is`, and `As` Method Contracts

A custom error type can implement any of these to control walking and matching.

### `Unwrap`

```go
type MyErr struct{ inner error }

func (e *MyErr) Error() string { return "..." }
func (e *MyErr) Unwrap() error { return e.inner }
```

`errors.Is` and `errors.As` walk the chain via `Unwrap()`. If you do not implement it, the chain stops at your error.

For multi-errors, the alternate form:

```go
func (e *MultiErr) Unwrap() []error { return e.errs }
```

`errors.Is`/`As` walk *all* branches of a multi-error.

### `Is`

```go
type MyErr struct{ kind Kind }

func (e *MyErr) Error() string { return "..." }
func (e *MyErr) Is(target error) bool {
    if t, ok := target.(*MyErr); ok {
        return e.kind == t.kind
    }
    return target == ErrFamilyMembership
}
```

When `errors.Is(err, target)` walks the chain and reaches your error, it calls `your.Is(target)`. If it returns true, the match succeeds. This is how families work.

### `As`

```go
func (e *MyErr) As(target any) bool {
    if t, ok := target.(**OtherType); ok {
        *t = convertTo(e)
        return true
    }
    return false
}
```

Rare. Used when you want to expose your error *as* a different type (an interface, a wrapper). Most code does not need this.

The default behavior of `errors.As` is type-assignable matching, which works for most cases without a custom method.

---

## `errors.Join` and Multi-Errors

From Go 1.20:

```go
err := errors.Join(err1, err2, err3)
```

- Returns nil if all arguments are nil.
- Returned error implements `Unwrap() []error`.
- `Error()` returns each error's text joined by newline.
- `errors.Is(err, target)` walks all branches.
- `errors.As(err, &t)` finds the first matching branch.

```go
type joinError struct {
    errs []error
}

func (e *joinError) Error() string {
    var b []byte
    for i, err := range e.errs {
        if i > 0 { b = append(b, '\n') }
        b = append(b, err.Error()...)
    }
    return string(b)
}

func (e *joinError) Unwrap() []error { return e.errs }
```

This is roughly the implementation. Custom multi-error types that pre-existed (uber-go/multierr, hashicorp/go-multierror) work the same way; the standard library now bundles the same idea.

For ordered batching, multi-errors are the right tool. For *streaming* errors (e.g., a worker pool), prefer a channel-based design or `errgroup`.

---

## Compatibility Across Versions

| Go version | Notable change |
|-----------|----------------|
| 1.0 | `error` interface, `errors.New`. |
| 1.13 | `errors.Is`, `errors.As`, `errors.Unwrap`, `%w` in `fmt.Errorf`. |
| 1.20 | Multiple `%w` in `fmt.Errorf`; `errors.Join`; `Unwrap() []error`. |
| 1.21 | Minor improvements; some error types in stdlib gained `Is`/`As` methods. |
| 1.22 | More stdlib types adopted `Is`. Internal `fmt` performance improvements. |

Code that targets pre-1.13 must use `pkg/errors` or do manual chain walking. Code that targets 1.13-1.19 can use single-`%w` wrapping but not `errors.Join`. Code targeting 1.20+ has the full vocabulary.

The error contract is otherwise stable. Adding `errors.Join` was an additive change; it did not break any existing code.

---

## Things the Spec Does NOT Define

- **Error string format.** Conventions only.
- **Whether errors carry stacks.** They do not, by default. `runtime/debug` and third-party libraries can add them.
- **Whether errors are safe for concurrent use.** Convention says yes.
- **Whether `Error()` may have side effects.** Convention says no.
- **Whether sentinel errors are public API.** Convention says yes.
- **The depth of the chain `errors.Is` walks.** No bound; design wraps to be shallow.
- **The order of `Unwrap() []error` walking.** Implementation-defined; do not rely on order.
- **Error code stability across processes.** That is your API design problem.
- **Localization or i18n of error messages.** Errors are English; localization happens at the boundary.
- **Whether errors should be panic-able for control flow.** Convention says no, strongly.

This is consistent with Go's overall design: the spec defines the language; conventions and the standard library define the idiom. Error design is largely in the second category.

---

## References

- [The Go Programming Language Specification](https://go.dev/ref/spec) — the authoritative source on `error` and `panic`/`recover`.
- [Package errors](https://pkg.go.dev/errors)
- [Package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Go Wiki — CodeReviewComments — Error strings](https://github.com/golang/go/wiki/CodeReviewComments#error-strings)
- [Go Wiki — CodeReviewComments — Indent error flow](https://github.com/golang/go/wiki/CodeReviewComments#indent-error-flow)
- [Go Wiki — CodeReviewComments — Don't panic](https://github.com/golang/go/wiki/CodeReviewComments#dont-panic)
- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Go Blog — Error Values FAQ](https://go.dev/blog/go1.13-errors)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Effective Go — Panic](https://go.dev/doc/effective_go#panic)
- `$GOROOT/src/errors/errors.go`
- `$GOROOT/src/errors/wrap.go`
- `$GOROOT/src/errors/join.go`
- `$GOROOT/src/fmt/errors.go`
