# Custom Error Types — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Sentinel vs Type vs Behavior — Choosing the Right Shape](#sentinel-vs-type-vs-behavior--choosing-the-right-shape)
3. [Implementing `Is` and `As`](#implementing-is-and-as)
4. [The Op / Kind / Path Pattern](#the-op--kind--path-pattern)
5. [Error Categories and Codes](#error-categories-and-codes)
6. [Wrapping with Custom Types](#wrapping-with-custom-types)
7. [`Unwrap()` and `Unwrap() []error`](#unwrap-and-unwrap-error)
8. [Formatting: `%v`, `%+v`, and `Format`](#formatting-v-v-and-format)
9. [Pointer vs Value Receivers Revisited](#pointer-vs-value-receivers-revisited)
10. [Composition vs Embedding](#composition-vs-embedding)
11. [Stack-Bearing Custom Errors](#stack-bearing-custom-errors)
12. [Translating to HTTP and gRPC](#translating-to-http-and-grpc)
13. [Patterns That Show Up Everywhere](#patterns-that-show-up-everywhere)
14. [Common Anti-Patterns](#common-anti-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the *mechanics*: implement `Error()`, return a struct, and use `errors.Is` / `errors.As`. At middle level the questions get harder. Should I expose a public type or hide it? Should I implement a custom `Is`? Should errors carry stacks? Should each layer wrap, or translate, or replace? How do I evolve an error type without breaking my consumers?

This file gives you the working answer set: when each shape (sentinel, custom type, behavior interface) is the right one; how to wire `Is`/`As` so callers can match without learning your internals; and how to build the **Op / Kind** pattern that the standard library and large code bases (Upspin, Cockroach, Hashicorp tools) converge on.

---

## Sentinel vs Type vs Behavior — Choosing the Right Shape

There are three idiomatic ways to expose a failure category in Go:

| Shape | Looks like | Best for |
|-------|-----------|----------|
| **Sentinel** | `var ErrNotFound = errors.New("not found")` | One fixed failure that is the same wherever it appears (e.g. `io.EOF`). |
| **Type** | `type NotFoundError struct{ ID int }` | Per-instance data, multiple distinguishable members. |
| **Behavior** | `interface{ Temporary() bool }` | "Treat anything with this property the same." Used by `net.Error.Timeout()`. |

The three are *complementary*, not competing.

```go
// Sentinel
var ErrNotFound = errors.New("not found")

// Type carrying data
type NotFoundError struct {
    Resource string
    ID       int
}
func (e *NotFoundError) Error() string  { return fmt.Sprintf("%s %d not found", e.Resource, e.ID) }
func (e *NotFoundError) Is(target error) bool { return target == ErrNotFound }

// Behavior interface
type temporary interface{ Temporary() bool }
```

A handler can then ask any of three questions:

```go
errors.Is(err, ErrNotFound)             // "is this any not-found?"
var nf *NotFoundError
errors.As(err, &nf)                     // "give me the not-found data"
var t temporary
if ok := errors.As(err, &t); ok && t.Temporary() { /* retry */ }
```

**Heuristic:**

| Question | Shape |
|----------|-------|
| Does each occurrence carry different data? | Custom type |
| Is the failure always identical? | Sentinel |
| Do we want to react to a *property* (timeout, retryable) regardless of concrete type? | Behavior interface |

---

## Implementing `Is` and `As`

`errors.Is(err, target)` walks the chain calling `Unwrap()` until it either:
1. Finds an error that is `==` target, or
2. Finds an error whose `Is(target) bool` method returns true.

`errors.As(err, &targetPtr)` walks the chain looking for an error that:
1. Is assignable to `*targetPtr`, or
2. Has an `As(any) bool` method that returns true.

This means you can give your custom type its own match semantics.

### `Is` for "any of these sentinels"

```go
type NotFoundError struct{ Resource string; ID int }

var (
    ErrNotFound        = errors.New("not found")
    ErrUserNotFound    = errors.New("user not found")
    ErrSessionNotFound = errors.New("session not found")
)

func (e *NotFoundError) Is(target error) bool {
    switch target {
    case ErrNotFound, ErrUserNotFound, ErrSessionNotFound:
        return true
    }
    return false
}
```

`errors.Is(err, ErrUserNotFound)` works whether the error is the sentinel or a populated `*NotFoundError`.

### `As` for "give me the most specific carrier"

The default `As` behavior — "look for an assignable type" — is usually enough. You almost never need to write a custom `As`. The one case that justifies it: you have a *generated* container type that holds the concrete error and you want `As` to pull the inner one out.

```go
type Outer struct{ inner error }
func (o *Outer) Error() string { return o.inner.Error() }
func (o *Outer) As(target any) bool {
    return errors.As(o.inner, target)
}
```

This is how some adapters expose multiple typed errors through a single envelope.

---

## The Op / Kind / Path Pattern

Pioneered by Rob Pike on the [Upspin](https://github.com/upspin/upspin) project and popularised by Dave Cheney, this is the most repeated pattern in serious Go error handling.

```go
package errors

type Op string

type Kind uint8
const (
    KindOther Kind = iota
    KindNotExist
    KindExist
    KindPermission
    KindIO
    KindInvalid
    KindInternal
)

type Error struct {
    Op   Op
    Kind Kind
    Path string
    User string
    Err  error
}

func (e *Error) Error() string {
    var b strings.Builder
    if e.Op != "" {
        b.WriteString(string(e.Op))
        b.WriteString(": ")
    }
    if e.Path != "" {
        b.WriteString(e.Path)
        b.WriteString(": ")
    }
    if e.Err != nil {
        b.WriteString(e.Err.Error())
    } else if e.Kind != KindOther {
        b.WriteString(e.Kind.String())
    }
    return b.String()
}

func (e *Error) Unwrap() error { return e.Err }
```

A constructor accepts variadic arguments and assembles the struct, optionally inheriting from an inner `*Error`:

```go
func E(args ...any) error {
    e := &Error{}
    for _, a := range args {
        switch v := a.(type) {
        case Op:    e.Op = v
        case Kind:  e.Kind = v
        case string:
            if e.Path == "" { e.Path = v } else { e.User = v }
        case *Error:
            cp := *v
            e.Err = &cp
        case error:
            e.Err = v
        }
    }
    return e
}
```

Usage in business code is then very pleasant:

```go
const op = errors.Op("user.Get")

func Get(id int) (*User, error) {
    u, err := db.GetUser(id)
    if err != nil {
        return nil, errors.E(op, errors.KindIO, err)
    }
    if u == nil {
        return nil, errors.E(op, errors.KindNotExist, fmt.Sprintf("id=%d", id))
    }
    return u, nil
}
```

The printed error reads like a path: `user.Get: id=42: not exist`. The `Kind` lets a top-level handler translate to a status code in *one* switch:

```go
func httpStatus(err error) int {
    var e *errors.Error
    if !errors.As(err, &e) { return 500 }
    switch e.Kind {
    case errors.KindNotExist:   return 404
    case errors.KindPermission: return 403
    case errors.KindInvalid:    return 400
    default:                    return 500
    }
}
```

This is the single biggest payoff for a custom error type in a non-trivial Go codebase.

---

## Error Categories and Codes

You will see three flavors of "category":

1. **`Kind` enum** — small, internal, exhaustive. Switchable.
2. **String code** — `"NOT_FOUND"`, `"INVALID_INPUT"`. Stable; can travel over the wire.
3. **Numeric code** — for protocols (gRPC `codes.NotFound`, HTTP statuses).

A real custom error often carries all three, *deriving* the latter two from the first:

```go
type Code uint16
const (
    CodeOK Code = iota
    CodeInvalid
    CodeNotFound
    CodePermission
    CodeInternal
)

func (c Code) String() string {
    switch c {
    case CodeInvalid:    return "INVALID"
    case CodeNotFound:   return "NOT_FOUND"
    case CodePermission: return "PERMISSION_DENIED"
    case CodeInternal:   return "INTERNAL"
    }
    return "OK"
}

func (c Code) HTTP() int {
    switch c {
    case CodeInvalid:    return 400
    case CodeNotFound:   return 404
    case CodePermission: return 403
    case CodeInternal:   return 500
    }
    return 200
}
```

The `Code` is the source of truth; everything else is derived. That keeps your error → wire mapping in one file.

---

## Wrapping with Custom Types

`fmt.Errorf("...: %w", inner)` creates an *anonymous* wrap — useful for ad-hoc messages, but the consumer cannot get any structured data from it. Custom types let you add structure:

```go
type RequestError struct {
    URL    string
    Status int
    Err    error
}

func (e *RequestError) Error() string {
    return fmt.Sprintf("request %s status=%d: %v", e.URL, e.Status, e.Err)
}
func (e *RequestError) Unwrap() error { return e.Err }
```

Compared to `fmt.Errorf("request %s status=%d: %w", url, status, err)` your version costs one struct allocation but gives the caller two addressable fields (`URL`, `Status`). For a service boundary where the caller will react to the status, that is worth the allocation.

**Rule of thumb:** if a single field of the wrap is interesting to a consumer, build a type. If only the *string* matters, `fmt.Errorf` is enough.

---

## `Unwrap()` and `Unwrap() []error`

Since Go 1.20 there are two valid `Unwrap` shapes:

```go
Unwrap() error      // single inner error
Unwrap() []error    // multiple
```

The multi-error form lets `errors.Is`/`errors.As` walk *all* branches. `errors.Join(a, b, c)` returns a value with `Unwrap() []error`. You can build your own:

```go
type MultiError struct {
    Op   string
    Errs []error
}

func (m *MultiError) Error() string {
    msgs := make([]string, len(m.Errs))
    for i, e := range m.Errs {
        msgs[i] = e.Error()
    }
    return fmt.Sprintf("%s: %s", m.Op, strings.Join(msgs, "; "))
}
func (m *MultiError) Unwrap() []error { return m.Errs }
```

Use cases: validation errors, parallel work, batch operations. Just remember that `errors.Is` will fan out across all children, and so the result might match unexpectedly if the same sentinel is in two places.

---

## Formatting: `%v`, `%+v`, and `Format`

By default `%v` calls `Error()`. To get a *richer* form for `%+v` (line breaks, fields, stack), implement `fmt.Formatter`:

```go
func (e *Error) Format(s fmt.State, verb rune) {
    switch verb {
    case 'v':
        if s.Flag('+') {
            fmt.Fprintf(s, "%s\n", e.Error())
            if e.Stack != nil {
                fmt.Fprintf(s, "%s\n", e.Stack)
            }
            if e.Err != nil {
                fmt.Fprintf(s, "caused by:\n%+v", e.Err)
            }
            return
        }
        fallthrough
    case 's':
        io.WriteString(s, e.Error())
    case 'q':
        fmt.Fprintf(s, "%q", e.Error())
    }
}
```

This is the same trick `pkg/errors` and `github.com/cockroachdb/errors` use. `%v` stays one line for logs, `%+v` gives the full diagnostic dump.

---

## Pointer vs Value Receivers Revisited

You saw this at junior level. At middle level here is the rule of thumb that scales:

- **Pointer receiver, almost always.** Identity comparisons work (`err == ErrSentinel`), no copies, future-proof if the struct grows.
- **Value receiver only when** the type is a single small wrapper that you want callers to be able to compare by value (e.g. `type Status uint16` implementing `Error()`). This is rare.
- **Mixing receivers on the same type is a code smell.** Pick one and stay consistent.

The other consequence: with pointer receivers you can have nil-safe methods if you guard at the entry:

```go
func (e *Error) Error() string {
    if e == nil { return "<nil>" }
    return e.Op + ": " + e.Err.Error()
}
```

Generally you should not need the guard — but if your error is part of a public API, defensive nil checks save you when an over-eager caller assigns `var nilErr *Error` and then prints it.

---

## Composition vs Embedding

You have two ways to put one error inside another:

```go
// Composition — explicit field
type DBError struct {
    Op  string
    Err error
}

// Embedding — anonymous field
type DBError struct {
    Op string
    error
}
```

Both work, both compile, but they have different consequences:

| Aspect | Composition | Embedding |
|--------|-------------|-----------|
| `Error()` | Must write your own | Promoted from inner |
| `Unwrap()` | Must write your own | Not promoted automatically — you still need `func (e *DBError) Unwrap() error { return e.error }` |
| Renaming the field | Free | Field name *is* the type, harder to refactor |
| Recommended | Yes | Generally no |

**Recommendation:** prefer composition with an explicit `Err` field. Embedding looks clever in tutorials but breaks down once you need `Unwrap`, custom formatting, or JSON marshalling.

---

## Stack-Bearing Custom Errors

A common middle-level addition: capture a stack at error creation. The cheap way (covered in 08-stack-traces-debugging) is `runtime.Callers`:

```go
type Error struct {
    Op   Op
    Kind Kind
    Err  error
    pcs  [16]uintptr
    npcs int
}

func New(op Op, kind Kind, err error) *Error {
    e := &Error{Op: op, Kind: kind, Err: err}
    e.npcs = runtime.Callers(2, e.pcs[:])
    return e
}

func (e *Error) Stack() string {
    if e.npcs == 0 { return "" }
    var b strings.Builder
    frames := runtime.CallersFrames(e.pcs[:e.npcs])
    for {
        f, more := frames.Next()
        fmt.Fprintf(&b, "%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more { break }
    }
    return b.String()
}
```

The stack is only formatted when someone reads it — keeping the cost down. This is also where `pkg/errors.Wrap` and `cockroachdb/errors` got their fame: cheap capture, lazy display.

A common trap: capture *only at the leaf*. If every wrap layer also captures a stack, you end up with five stacks per error and no idea which one to look at. Capture once, at the source.

---

## Translating to HTTP and gRPC

Custom errors shine at API boundaries. Here is a typical end-to-end:

```go
// Domain layer
return errors.E(op, errors.KindNotExist, "id=42")

// HTTP layer
func writeError(w http.ResponseWriter, err error) {
    var e *errors.Error
    if !errors.As(err, &e) {
        http.Error(w, "internal", 500)
        return
    }
    status := map[errors.Kind]int{
        errors.KindNotExist:   404,
        errors.KindExist:      409,
        errors.KindPermission: 403,
        errors.KindInvalid:    400,
        errors.KindIO:         502,
        errors.KindInternal:   500,
    }[e.Kind]
    if status == 0 { status = 500 }
    json.NewEncoder(w).Encode(map[string]any{
        "error": e.Error(),
        "code":  e.Kind.String(),
    })
    w.WriteHeader(status)
}

// gRPC layer
func grpcStatus(err error) error {
    var e *errors.Error
    if !errors.As(err, &e) { return status.Error(codes.Internal, err.Error()) }
    code := codes.Internal
    switch e.Kind {
    case errors.KindNotExist:   code = codes.NotFound
    case errors.KindExist:      code = codes.AlreadyExists
    case errors.KindPermission: code = codes.PermissionDenied
    case errors.KindInvalid:    code = codes.InvalidArgument
    }
    return status.Error(code, e.Error())
}
```

The domain code never imports `net/http` or `google.golang.org/grpc`. Translation lives at the boundary, in one place.

---

## Patterns That Show Up Everywhere

### Pattern 1: Constructor families

```go
func NewNotFound(resource string, id any) error {
    return &Error{Op: Op("?"), Kind: KindNotExist, Err: fmt.Errorf("%s %v", resource, id)}
}
func NewInvalid(field, why string) error {
    return &Error{Kind: KindInvalid, Err: fmt.Errorf("%s: %s", field, why)}
}
func NewIO(op Op, err error) error {
    return &Error{Op: op, Kind: KindIO, Err: err}
}
```

A library of constructors is much easier to use than `&Error{Op: ..., Kind: ..., Err: ...}`.

### Pattern 2: `errors.E` variadic

Already shown — accepts `Op`, `Kind`, `string`, `error` in any order. Slightly magical but ergonomic. Pin the contract in tests.

### Pattern 3: `Match(template, err) bool`

Upspin uses this: provide a "template" error and ask whether `err` looks like it. Useful for tests:

```go
func Match(template, err error) bool {
    var t, e *Error
    if !errors.As(template, &t) || !errors.As(err, &e) { return false }
    if t.Kind != KindOther && t.Kind != e.Kind { return false }
    if t.Op != "" && t.Op != e.Op { return false }
    return true
}
```

### Pattern 4: `RetryableError`

```go
type Retryable struct{ error }
func (Retryable) Retry() {}

func IsRetryable(err error) bool {
    var r interface{ Retry() }
    return errors.As(err, &r)
}
```

Behavior interface as a marker. Anything that wants to opt in just embeds `Retryable{innerErr}`.

### Pattern 5: Lazy fields

A common mistake is to format expensive context at error creation. Defer it:

```go
type DBError struct {
    Op    string
    query string // *not* the formatted query, the raw template
    args  []any
    Err   error
}

func (e *DBError) FormattedQuery() string {
    return formatPlaceholder(e.query, e.args) // expensive, only called on demand
}
```

You pay only when someone asks.

---

## Common Anti-Patterns

- **Using `fmt.Errorf("not found")` and grepping with `strings.Contains(err.Error(), "not found")`.** Replace with sentinel + `errors.Is`.
- **Returning a typed-nil pointer as `error`.** Always `return nil` literally.
- **Putting newlines or stack traces in `Error()`.** That string is for one-line logs; richer output goes in `Format`.
- **Embedding `error` field anonymously** so `Error()` is inherited but `Unwrap()` is missing — chain is broken.
- **Capturing a stack at every wrap.** Capture once, at the leaf.
- **Marshalling internal errors directly to JSON for clients.** Use a dedicated DTO.
- **Defining sentinel and type with the *same name*.** Confuses readers; pick one or differentiate clearly (`ErrNotFound` sentinel + `NotFoundError` type).
- **One giant `type Error struct` with optional fields for everything.** Split by responsibility.

---

## Summary

At middle level the question is no longer "how do I implement `error`?" but "what shape is right for *this* failure?" Three idiomatic shapes — sentinel, custom type, behavior interface — combine to give callers powerful, type-safe matching via `errors.Is`/`errors.As`. The Op/Kind pattern unifies many ad-hoc errors under one struct that translates cleanly to HTTP and gRPC. Wrap with explicit `Err` fields, expose them via `Unwrap`, format richly with `fmt.Formatter`, and resist the urge to capture stacks at every layer. The art is consistency: pick a shape per failure category, write a constructor, lock it in with tests.

---

## Further Reading

- [Upspin error package](https://github.com/upspin/upspin/tree/master/errors) — the canonical Op/Kind implementation
- [Rob Pike — Errors are values](https://go.dev/blog/errors-are-values)
- [Dave Cheney — Stack traces and the errors package](https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package)
- [The Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors) — production-grade error library
- [pkg/errors](https://github.com/pkg/errors) — the predecessor to the standard library wrap support
