# error interface — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing an Error Type for a Public Package](#designing-an-error-type-for-a-public-package)
3. [Sealing Error Types](#sealing-error-types)
4. [Error Type Hierarchies](#error-type-hierarchies)
5. [Behavioral vs Identity Errors](#behavioral-vs-identity-errors)
6. [Cross-Package Error Coupling](#cross-package-error-coupling)
7. [Error Type Versioning](#error-type-versioning)
8. [The Cost of Custom Error Types](#the-cost-of-custom-error-types)
9. [Error Types and Generics](#error-types-and-generics)
10. [Errors That Carry Context](#errors-that-carry-context)
11. [Errors as Domain Events](#errors-as-domain-events)
12. [The Upspin Pattern](#the-upspin-pattern)
13. [Anti-Patterns at Scale](#anti-patterns-at-scale)
14. [Summary](#summary)

---

## Introduction
> Focus: "How to architect?" and "How to evolve?"

At senior level, the question is no longer "how do I implement `Error()`?" but "what is the right *shape* for the error types in this system, given that they will outlive every developer who works on it?"

This file is about treating error types as first-class API design.

---

## Designing an Error Type for a Public Package

When your package is imported by others, your error types are *public API*. Three design rules:

1. **Make the type comparable.** Avoid slices and maps as fields. Otherwise `errors.Is` panics.
2. **Export only what callers can rely on.** Internal fields stay lowercase.
3. **Provide constructors, not raw struct literals.** This lets you change the internal shape later.

Example:

```go
package db

type Error struct {
    op   string  // private
    code Code    // public type, exported field
    err  error
}

func (e *Error) Error() string { /* compose */ }
func (e *Error) Code() Code    { return e.code }
func (e *Error) Unwrap() error { return e.err }

type Code int
const (
    ErrUnknown Code = iota
    ErrConflict
    ErrNotFound
)

// Constructor — preferred over &Error{...}
func wrap(op string, code Code, err error) error {
    return &Error{op: op, code: code, err: err}
}
```

Callers do:
```go
if errors.Is(err, db.ErrNotFound) { ... }     // compare on Code
var dbErr *db.Error
if errors.As(err, &dbErr) { use(dbErr.Code()) }
```

Note: `db.ErrNotFound` is a `Code`, not an error — to make `errors.Is` work, give `Code` an `Error()` method, or define a custom `Is` on `*Error` that compares Code values.

---

## Sealing Error Types

Sometimes you want to **prevent external implementations** of an interface. Go has no `sealed` keyword, but you can simulate it with an unexported method:

```go
package db

type Error interface {
    error
    sealed()  // unexported — only types in this package can implement
}

type internalErr struct{ /* ... */ }
func (*internalErr) Error() string { return "..." }
func (*internalErr) sealed()       {}
```

Now no external package can satisfy `db.Error`. Callers can use it as a type assertion or in switches without worrying about open-ended implementations. The standard `database/sql` package does similar tricks.

---

## Error Type Hierarchies

Real systems have *categories* of errors. Three structural choices:

### Choice A: One type, one Kind enum

```go
type Error struct {
    Kind Kind
    Op   string
    Err  error
}
type Kind int
const (
    NotFound Kind = iota
    Conflict
    Invalid
    Internal
)
```

Pros: simple, easy to switch on. Cons: all errors share the same fields.

### Choice B: Multiple types

```go
type NotFoundError struct{ Resource string }
type ConflictError struct{ Field, Existing string }
type InternalError struct{ Cause error }
```

Pros: each type carries its own data. Cons: many types to maintain; switches are verbose.

### Choice C: Sentinels + wrapping

```go
var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)
```

Pros: minimal. Cons: no structured data on the error itself.

**Real systems often blend all three.** The `os` package has `*PathError` (Choice B), `os.ErrNotExist` (Choice C), and a single `*SyscallError` with a syscall name field (a degenerate Choice A).

---

## Behavioral vs Identity Errors

Two ways to ask "is this error special?":

- **Identity**: `errors.Is(err, ErrFoo)` — does it match a specific value?
- **Behavior**: `var t Temporary; errors.As(err, &t) && t.Temporary()` — does it implement a capability?

When to use which:

| Situation | Use |
|-----------|-----|
| Caller will react differently per error *kind* | Identity (sentinel + `Is`) |
| Caller will retry/give-up based on a property | Behavior (interface + `As`) |
| Caller needs structured data | Type assertion + fields |

A real package often exposes *both*: sentinels for common conditions + a typed error for diagnostics.

---

## Cross-Package Error Coupling

If package A wraps errors from package B, A becomes *coupled* to B's error API. Three coupling levels:

1. **Tight**: A returns B's errors directly. Any caller of A may need to import B to inspect.
2. **Wrapped**: A wraps B's errors with `%w`. Callers can still `errors.Is` against B's sentinels (cross-package transitive coupling).
3. **Translated**: A converts B's errors into A's own errors. Callers see only A's API; B is fully encapsulated.

Translated is best for *boundary* packages (HTTP handlers, public SDKs). Wrapped is fine for *internal* packages where caller-side diagnosis matters.

---

## Error Type Versioning

Once your error type is published, certain changes are breaking:

- Removing or renaming a field — breaks code that reads it.
- Changing a field's type — breaks compilers.
- Adding a method — *not* breaking (interfaces are open).
- Adding a field — *not* breaking (struct literals can use named fields).
- Changing the message format — soft-breaking; some callers grep for it.

Practice: treat every exported error field as a stable contract. When a change is unavoidable, deprecate first, then break in a major version.

---

## The Cost of Custom Error Types

Each custom error type:
- Adds ~16-32 bytes per instance (the struct header).
- Allocates on the heap when escaped (almost always).
- Adds compile-time work (method dispatch tables).
- Adds maintenance: tests, doc, refactoring.

If you have 50 distinct error types in a package, you have 50 places where the error contract must be maintained. Most projects benefit from *fewer* types and richer Kind enums.

---

## Error Types and Generics

Go 1.18+ adds generics. Errors-with-generics is a niche but useful tool:

```go
type Result[T any] struct {
    Value T
    Err   error
}
```

Used for: pipelines, batch results, channel-of-results patterns. Not a replacement for `(T, error)` returns; complementary.

You can also write generic error helpers:

```go
func Must[T any](v T, err error) T {
    if err != nil { panic(err) }
    return v
}
```

(Use sparingly — `panic` on user-input errors is wrong.)

---

## Errors That Carry Context

Beyond message, error types often carry:

- **Operation name** — what was being attempted.
- **Resource identifier** — which user, file, key.
- **Timestamp** — when it happened (rarely useful unless errors are stored).
- **Trace ID** — for distributed correlation.
- **HTTP status / gRPC code** — for transport translation.
- **Retry hint** — "retry after 5s."

The challenge: keep the type small and predictable. Do not let it become a kitchen sink.

A mature pattern is to *separate* the error from its diagnostic envelope:

```go
type Diag struct {
    Err       error
    TraceID   string
    Timestamp time.Time
}
```

The error itself is small; the diagnostic envelope is added by middleware.

---

## Errors as Domain Events

In an event-driven architecture, errors can be modeled as *domain events*:

```go
type UserConflictError struct {
    UserID  int64
    Field   string
}

func (e *UserConflictError) Error() string { /* ... */ }
func (e *UserConflictError) Event() string { return "user.conflict" }
```

The error doubles as an event the system can react to: log it, increment a metric, publish to a queue. The `Event()` method is a hint to subscribers.

Optional pattern; not appropriate for every system.

---

## The Upspin Pattern

Rob Pike and Andrew Gerrand designed an error system for the Upspin file system that is widely cited:

```go
package errors

type Op string
type Kind uint8
type Path string

type Error struct {
    Path Path
    User UserName
    Op   Op
    Kind Kind
    Err  error
}

func E(args ...any) error { ... }  // smart constructor
```

`E` accepts any combination of typed arguments and assembles the error. Keys to its design:

- **Distinct types for each field** (`Op`, `Path`, `UserName`) so the constructor can dispatch by type.
- **Single struct, many kinds** — one type to maintain.
- **Composable wrapping** — passing an `Error` as an arg sets `Err`.
- **Custom `Is` and `Match`** — semantic comparison.

[Read the original blog post](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html) — it is a masterclass.

---

## Anti-Patterns at Scale

- **One global "error type"** that has 30 fields and tries to represent every possible error. Brittle and ugly.
- **Errors that contain *only* a string and no code/kind** — callers cannot react.
- **Type explosion** — 80 error types for 80 callers; nothing reusable.
- **Hidden dependencies** — error types in a low-level package leak driver-specific details all the way to the HTTP layer.
- **Reflection-heavy diagnosis** — relying on reflection to inspect errors at runtime instead of behavioral interfaces.

---

## Summary

Senior-level error design is API design. Choose between Kind enums, typed errors, and sentinels — or blend them. Seal types when you need invariants. Translate at boundaries. Carry only the context your callers actually use. Steal from the standard library and from Upspin. Above all: errors are part of your public contract, so design them with the same care you give the rest of your API.

---

## Further Reading

- [Error Handling in Upspin (Rob Pike, Andrew Gerrand)](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Stamping Out Errors in Go (Cockroach Labs)](https://www.cockroachlabs.com/blog/error-handling-and-go/)
- [Designing Error APIs (Mat Ryer)](https://medium.com/@matryer)
- `$GOROOT/src/os/error.go` — `*PathError`, `*LinkError`.
- `$GOROOT/src/syscall/error.go` — POSIX errno mapping.
