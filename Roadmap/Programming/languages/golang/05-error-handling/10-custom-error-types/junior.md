# Custom Error Types — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a custom error type?" and "Why would I write one?"

In Go, `error` is just an interface — the smallest interface in the language:

```go
type error interface {
    Error() string
}
```

Anything that has a method `Error() string` *is* an error. That single line is the entire contract. `errors.New("boom")` returns a tiny built-in struct that satisfies it. `fmt.Errorf("user %d not found", id)` returns another. Both are fine for one-line messages, but they hide a problem: **a string is not data**. If your caller wants to know *which* user, *which* path, or *which* error code came back, they have to scrape your message with `strings.Contains` — and that is a recipe for bugs.

A **custom error type** is your own concrete type that implements `error`. It carries fields the caller can read directly. It can be tagged so `errors.Is` and `errors.As` find it. It can wrap a deeper cause so the chain is preserved. It can format itself nicely with `%v` or `%+v`. And it can be constructed by helper functions that make error creation just as ergonomic as `errors.New`.

After reading this file you will:
- Be able to declare a struct type that satisfies the `error` interface
- Know when to use a sentinel error vs a custom type
- Understand pointer-vs-value receivers for error types and the famous "nil pointer is not nil error" trap
- Know how to add an `Unwrap()` method so the error plays nicely with the standard library
- Recognise the Op/Kind/Path pattern used in real Go code
- Be able to write a constructor like `NewNotFound(id)` that returns a typed error
- Avoid the most common beginner mistakes (exposing internals, comparing by string, returning nil pointer as error)

```go
package main

import "fmt"

type NotFoundError struct {
    Resource string
    ID       int
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %d not found", e.Resource, e.ID)
}

func main() {
    var err error = &NotFoundError{Resource: "user", ID: 42}
    fmt.Println(err) // user 42 not found
}
```

That is the entire idea. Everything in this file is variations on it.

---

## Prerequisites

- **Required:** Methods and interfaces — you must understand "this struct has a method, therefore it implements this interface".
- **Required:** Pointer vs value receivers — the difference between `func (e ErrX)` and `func (e *ErrX)`.
- **Required:** Basic error handling (`if err != nil`).
- **Required:** `errors.New` and `fmt.Errorf` — what the standard library already gives you.
- **Helpful but not required:** `errors.Is`, `errors.As`, and `%w` (covered properly in the middle level here).
- **Helpful but not required:** Knowing what `Unwrap()` is for (we explain it from scratch).

---

## Glossary

| Term | Definition |
|------|-----------|
| **error interface** | `interface { Error() string }`. Anything with that method is an `error`. |
| **custom error type** | A user-defined struct (or named type) that implements `error`. |
| **sentinel error** | A package-level variable like `var ErrNotFound = errors.New("not found")` used as a fixed value to compare against. |
| **wrap** | Embedding an inner error inside another so the chain is preserved. |
| **Unwrap** | Method `Unwrap() error` that returns the wrapped inner error; lets `errors.Is`/`errors.As` walk the chain. |
| **`errors.Is`** | Reports whether any error in a chain equals a target. |
| **`errors.As`** | Finds an error of a target *type* in the chain and assigns it to a pointer. |
| **Op** | A short label naming the operation that failed, e.g. `"db.GetUser"`. Common in custom errors. |
| **Kind** | A category tag (e.g. `KindNotFound`, `KindPermission`) used to switch on error class. |
| **typed nil** | A pointer of type `*T` whose value is `nil`, but which — when stored in an `error` interface — is *not* equal to a bare `nil`. The classic Go gotcha. |
| **value receiver** | A method declared on `T`. The caller copies the struct. |
| **pointer receiver** | A method declared on `*T`. Mutations and identity comparisons work; the value can be `nil`. |

---

## Core Concepts

### Concept 1: `error` is just an interface

There is nothing magical about the `error` type. You can implement it yourself the same way you'd implement `fmt.Stringer`:

```go
type MyErr struct{ msg string }
func (e *MyErr) Error() string { return e.msg }
```

That is a valid Go error. The compiler does not even need to know about `errors.New` — it only needs the method.

### Concept 2: Sentinels vs types

A **sentinel** is a fixed error value:

```go
var ErrNotFound = errors.New("not found")
```

You compare against it with `errors.Is(err, ErrNotFound)`. Sentinels are great when there is exactly one "this thing" — like `io.EOF`. But they cannot carry data: every `ErrNotFound` is the same `ErrNotFound`.

A **custom error type** is a struct or named type:

```go
type NotFoundError struct{ ID int }
func (e *NotFoundError) Error() string { return fmt.Sprintf("not found: %d", e.ID) }
```

You handle it with `errors.As(err, &nfErr)`, then read `nfErr.ID`. Use a custom type when each error instance has *different data*.

You will often see them combined: a custom type *and* a sentinel together (more on that in the middle file).

### Concept 3: Pointer vs value receiver

You can declare `Error()` on either:

```go
// Value receiver
type ValErr struct{ msg string }
func (e ValErr) Error() string { return e.msg }

// Pointer receiver
type PtrErr struct{ msg string }
func (e *PtrErr) Error() string { return e.msg }
```

Both compile. But:
- With a value receiver, `ValErr{}` and `&ValErr{}` both satisfy `error`.
- With a pointer receiver, only `*PtrErr` satisfies `error`. A bare `PtrErr{}` does not.

Most production code uses pointer receivers for error structs. Why? Two reasons:
1. Errors often grow over time, and pointer receivers avoid accidental copies.
2. You can compare two pointer-typed sentinels by identity (`err == ErrSentinel`).

But pointer receivers come with the **typed-nil trap** — see Concept 5.

### Concept 4: `Unwrap()` lets your error live in a chain

If you wrap an inner error, you should expose it:

```go
type DBError struct {
    Op  string
    Err error
}

func (e *DBError) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *DBError) Unwrap() error { return e.Err }
```

Now `errors.Is(dbErr, sql.ErrNoRows)` works automatically — `errors.Is` walks the chain by calling `Unwrap`. Without that method, your custom type is a dead end.

### Concept 5: The typed-nil trap

This is the bug every Go programmer hits at least once:

```go
type MyErr struct{ msg string }
func (e *MyErr) Error() string { return e.msg }

func doWork() error {
    var e *MyErr // nil pointer
    return e     // returned as an error interface
}

func main() {
    err := doWork()
    if err != nil {
        fmt.Println("got an error!") // <-- prints!
    }
}
```

`err != nil` is **true** even though the underlying pointer is nil. Why? Because an interface value is *(type, value)*. The type slot is `*MyErr`, the value slot is `nil`, but together they are not the zero interface. The fix is simple: never return a pointer-typed nil as an error. Either return `nil` literally, or only assign on the failure branch.

We will revisit this in detail later. For now: **always `return nil`, never `return (*MyErr)(nil)`**.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **`errors.New`** | A sticky note that just says "broken". |
| **Custom error type** | A repair ticket with fields: customer ID, item, fault code, technician notes. |
| **Sentinel error** | A specific labeled bin: "lost & found, item not present". Always the same bin. |
| **`Unwrap`** | The clear plastic sleeve on the ticket so you can read the original report underneath. |
| **`errors.Is`** | "Does this ticket — or any inside it — match this complaint code?" |
| **`errors.As`** | "Pull the first ticket from this stack that is a 'damaged in transit' form, and read its fields." |
| **Pointer receiver** | A ticket pinned to a board: everyone references the same ticket. |
| **Value receiver** | A photocopy of the ticket — every passer-by gets their own copy. |
| **Typed nil trap** | An empty envelope marked "REPAIR TICKET" — the form is missing but the envelope is still labeled. |

---

## Mental Models

**The struct-with-an-`Error()` model.** Forget the word "exception". A Go error is *an object that knows how to describe itself in one line*. Anything else — fields, codes, stacks — is bonus structure that consumers can opt into.

**The two-channel model.** A custom error type carries two things:
1. A human channel — `Error() string` for logs and panics.
2. A machine channel — exported fields and methods like `Code()`, `Kind()`, `Unwrap()`.

When you design a new error type, ask: what should each channel say?

**The chain-of-tags model.** Wrapping makes errors a linked list. Each link carries some information, and `errors.Is`/`errors.As` are the two ways to read along the list. Your job, as the author of a custom type, is to make the link cooperate.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Carries structured data — IDs, codes, paths — without string parsing. | More code than a one-liner `errors.New`. |
| Plays nicely with `errors.As` so callers can branch on type. | Mistakes around pointer vs value receivers cause subtle bugs. |
| You can attach `Unwrap`, `Is`, `As` for fine control over chain semantics. | Public custom types become part of your API and hard to change. |
| Custom formatting (`%+v`) gives rich diagnostics without inflating logs. | Returning a typed nil pointer accidentally satisfies `err != nil`. |
| Translation to HTTP/gRPC status codes becomes one switch on a `Kind`. | Over-engineering small libraries — most leaf errors only need a sentinel. |

### When to use:
- The error has at least one field a caller might want to read (ID, path, code).
- You want callers to branch on a category (`KindNotFound`, `KindPermission`).
- The error needs a friendly format different from the wrapped cause.

### When NOT to use:
- A single fixed message in a small package — a sentinel is enough.
- A truly internal error you immediately log and discard — `fmt.Errorf` is fine.

---

## Use Cases

- **Domain errors** — `UserNotFoundError`, `InvalidPasswordError`, `OrderClosedError` with IDs and reasons.
- **I/O errors with context** — file path, line number, byte offset attached to a parser error.
- **Validation results** — a list of field-level violations exposed as a typed error.
- **Adapter errors** — wrapping `database/sql`, `net/http`, gRPC errors into your own taxonomy.
- **CLI errors** — exit codes attached to the error so `main()` can `os.Exit(err.Code)`.

---

## Code Examples

### Example 1: Smallest possible custom error

```go
package main

import "fmt"

type ConfigError struct {
    Key string
}

func (e *ConfigError) Error() string {
    return fmt.Sprintf("missing config key: %s", e.Key)
}

func main() {
    var err error = &ConfigError{Key: "DB_URL"}
    fmt.Println(err) // missing config key: DB_URL
}
```

**What it does:** Defines a custom type with one field; implements `Error()`; demonstrates that the value can be assigned to the `error` interface.

### Example 2: Sentinel error

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func find(id int) error {
    if id == 0 {
        return ErrNotFound
    }
    return nil
}

func main() {
    err := find(0)
    if errors.Is(err, ErrNotFound) {
        fmt.Println("handled: not found")
    }
}
```

**What it does:** Declares a package-level sentinel and matches against it with `errors.Is`. The whole file is six lines of meaningful code.

### Example 3: Custom type plus `errors.As`

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field string
    Why   string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Why)
}

func register(name string) error {
    if name == "" {
        return &ValidationError{Field: "name", Why: "required"}
    }
    return nil
}

func main() {
    err := register("")
    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("bad field=%s reason=%s\n", ve.Field, ve.Why)
    }
}
```

**What it does:** Returns a typed error, then extracts its fields with `errors.As`. The caller never has to parse the message string.

### Example 4: Wrapping with `Unwrap`

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

type ReadError struct {
    Path string
    Err  error
}

func (e *ReadError) Error() string {
    return fmt.Sprintf("read %s: %v", e.Path, e.Err)
}

func (e *ReadError) Unwrap() error { return e.Err }

func openConfig() error {
    return &ReadError{Path: "/etc/app.toml", Err: io.EOF}
}

func main() {
    err := openConfig()
    fmt.Println(err)                        // read /etc/app.toml: EOF
    fmt.Println(errors.Is(err, io.EOF))     // true
}
```

**What it does:** Wraps a deeper cause (`io.EOF`) inside `ReadError`, exposes it through `Unwrap`, and shows that `errors.Is` walks the chain.

### Example 5: Constructor function

```go
package main

import "fmt"

type AuthError struct {
    UserID int
    Reason string
}

func (e *AuthError) Error() string {
    return fmt.Sprintf("auth: user %d: %s", e.UserID, e.Reason)
}

func NewAuthError(id int, reason string) error {
    return &AuthError{UserID: id, Reason: reason}
}

func main() {
    err := NewAuthError(7, "wrong password")
    fmt.Println(err)
}
```

**What it does:** Hides the `&` and the field names behind a constructor. Callers say `NewAuthError(id, reason)` and stop thinking about pointer-vs-value details.

### Example 6: The typed-nil trap (DON'T do this)

```go
package main

import "fmt"

type MyErr struct{ msg string }

func (e *MyErr) Error() string { return e.msg }

func bad() error {
    var e *MyErr // returned as a typed-nil pointer
    return e
}

func main() {
    err := bad()
    fmt.Println(err == nil) // false — the famous gotcha
}
```

**What it does:** Demonstrates the bug. `err` is *not* nil because the interface carries the type `*MyErr` even though the underlying pointer is nil. Always `return nil` literally.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Struct + pointer receiver + constructor

```go
type DBError struct {
    Op  string
    Err error
}

func (e *DBError) Error() string  { return e.Op + ": " + e.Err.Error() }
func (e *DBError) Unwrap() error  { return e.Err }

func NewDBError(op string, err error) *DBError {
    return &DBError{Op: op, Err: err}
}
```

The default shape: pointer receiver, `Unwrap`, constructor. Use it as a starting template.

### Pattern 2: Sentinel + custom type pair

```go
var ErrNotFound = errors.New("not found")

type NotFoundError struct {
    Resource string
    ID       int
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %d not found", e.Resource, e.ID)
}

func (e *NotFoundError) Is(target error) bool {
    return target == ErrNotFound
}
```

`errors.Is(err, ErrNotFound)` works whether the error is `ErrNotFound` itself or a `*NotFoundError`. Callers can use the sentinel for "any not-found" and the type for "which not-found".

### Pattern 3: Op label

```go
type Error struct {
    Op  string // "user.Get", "db.Tx.Commit", ...
    Err error
}

func (e *Error) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *Error) Unwrap() error { return e.Err }
```

Each layer adds an Op string. The final printed error reads like a path: `api.Handler: service.GetUser: db.Query: connection refused`. This is the classic Upspin/Cheney pattern (we will go deeper at middle level).

### Pattern 4: Always return `nil` literal

```go
func doWork() error {
    if /* something failed */ {
        return &MyErr{...}
    }
    return nil // <-- never `return (*MyErr)(nil)`
}
```

A boring rule that prevents the typed-nil trap.

### Pattern 5: Prefer `errors.As` over type assertion

```go
var ve *ValidationError
if errors.As(err, &ve) {
    // ve.Field, ve.Why
}
```

Not:

```go
if ve, ok := err.(*ValidationError); ok { ... } // misses wrapped chains
```

`errors.As` walks the chain; a bare type assertion only checks the outermost value.

---

## Clean Code

- **One type per failure shape.** Do not pack unrelated failures into one struct with optional fields.
- **Field names are part of your API.** Renaming `Path` to `File` is a breaking change.
- **Keep `Error()` short.** One line. No newlines, no stack traces, no JSON. Fancy formatting goes in `Format` or marshallers, not in `Error()`.
- **Constructors hide the `&`.** New code reads cleaner with `NewNotFound("user", id)` than `&NotFoundError{Resource: "user", ID: id}`.
- **Avoid double-wrapping.** Calling `fmt.Errorf("%w", &MyErr{...})` is rarely useful — your custom type already wraps.

---

## Product Use / Feature

In a real Go service, custom errors are how the API layer translates failures to status codes:

```go
func writeError(w http.ResponseWriter, err error) {
    var nf *NotFoundError
    var ve *ValidationError
    var au *AuthError
    switch {
    case errors.As(err, &nf):
        http.Error(w, nf.Error(), http.StatusNotFound)
    case errors.As(err, &ve):
        http.Error(w, ve.Error(), http.StatusBadRequest)
    case errors.As(err, &au):
        http.Error(w, "unauthorized", http.StatusUnauthorized)
    default:
        log.Printf("internal: %v", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}
```

That single function is the value of having custom types: a clean, type-safe map from "domain failure" to "HTTP semantics". Without typed errors you would be parsing strings.

---

## Error Handling

- **Always check for the wrapped chain.** `errors.Is` and `errors.As` walk through `Unwrap`. A bare `==` or type assertion does not.
- **Do not double-log.** If a layer translates an error to a status code, the original error is logged once at the boundary, not at every level.
- **Do not expose internal errors to users.** A `*DBError` with a SQL string in it is fine in the log, hostile in an HTTP response.
- **Wrap, don't replace.** Use `fmt.Errorf("...: %w", err)` or your own custom type's `Err` field to preserve the cause.

---

## Security Considerations

- **Error messages can leak data.** "user 'alice@example.com' not found" leaks whether the email exists. Many auth systems return a uniform error to prevent enumeration.
- **Stack-bearing errors leak code structure.** Do not include a `Stack` field in errors marshalled to clients.
- **Custom `MarshalJSON` may unintentionally expose unexported fields.** Be deliberate about which fields the JSON form contains.
- **Field types matter.** A `Password string` field on a custom error is a footgun — log redactors must be aware of it.

---

## Performance Tips

- **Allocations.** Each `&MyErr{...}` is a heap allocation. In hot loops where errors are common, reuse a sentinel instead.
- **Avoid `fmt.Sprintf` in `Error()` if you can.** A simple `+` concat is faster, though less flexible.
- **`errors.As` is reflection-based.** Cheap but not free; avoid in tight loops.
- See `optimize.md` for benchmarks and concrete numbers.

---

## Best Practices

- **Use pointer receivers** for error structs; consistent and avoids copy weirdness.
- **Always implement `Unwrap`** when you carry an inner error.
- **Pair sentinel + type** for "category sentinel + carrier type" use cases.
- **Constructors over literals** so callers don't reach into your struct shape.
- **Write a `Test` that exercises `errors.Is` and `errors.As`** to lock the API contract.
- **`return nil` literal** on success — never a typed-nil pointer.
- **Document each exported error type** with a small example showing how to detect it.

---

## Edge Cases & Pitfalls

- **Typed-nil pointer returned as error.** Always `return nil` on success.
- **Value receiver on a struct meant for a sentinel.** `ErrFoo := MyErr{}`-style sentinels with value receivers compare by *value*, not identity, which surprises some people.
- **Forgetting `Unwrap()`** on a custom type that has an `Err` field — `errors.Is` will not see through it.
- **Recursive `Error()`.** If `e.Err.Error()` is called inside `e.Error()` and the chain has a cycle, you get infinite recursion. Build chains carefully.
- **Marshalling unexported fields.** `encoding/json` skips them; if your callers expect them, use a custom `MarshalJSON`.
- **Comparing sentinels with `==`** when the error is wrapped — the bare `==` does not walk the chain. Use `errors.Is`.

---

## Common Mistakes

1. **Returning a typed nil pointer** as `error`.
2. **Comparing error messages with `strings.Contains`** instead of using `errors.Is`/`errors.As`.
3. **Defining `Error()` on a value receiver and a pointer receiver inconsistently** — the method set surprises you when assigning to an interface.
4. **Forgetting `Unwrap()`** when your type embeds a cause.
5. **Naming the type without the `Error` suffix** — `User` is a model; `UserError` reads as an error. (Convention, not a rule.)
6. **Putting newlines in `Error()`** so logs become unreadable.
7. **Using sentinels everywhere** when each instance actually has different data — you lose the ID.
8. **Using a custom type for "single-value" errors** — overkill; a sentinel is enough.
9. **Not testing `errors.Is`/`errors.As` behaviour** so you ship a type that breaks chains.
10. **Marshalling internal errors to JSON for clients** — leaks structure.

---

## Common Misconceptions

- **"Implementing `error` is hard."** It is one method.
- **"Sentinels are obsolete."** They are not — `io.EOF` is the most-used error in Go.
- **"`fmt.Errorf` with `%w` is always enough."** Fine for small packages; for public APIs you usually want types.
- **"Custom types make my package slower."** Allocation cost matters only if errors are common; for the failure-is-rare case it is irrelevant.
- **"`errors.Is` only checks the outermost error."** It walks the whole chain.
- **"`Unwrap` is only useful with `fmt.Errorf`."** Any custom type with an inner error should implement it.

---

## Tricky Points

- **Method sets and addressability.** A value receiver method `func (e MyErr) Error() string` lets `MyErr{}` and `&MyErr{}` both satisfy `error`. A pointer receiver method only allows `*MyErr`. Choose carefully.
- **Sentinels with custom types.** When you write `var ErrFoo = &MyErr{...}`, the sentinel is now address-comparable: `err == ErrFoo` works only if everyone returns *that exact pointer*. Most libraries combine this with an `Is(target) bool` to make `errors.Is` flexible.
- **`Error()` recursion.** If `Error()` calls `e.Err.Error()` and `e.Err == e`, you stack-overflow.
- **Embedding another struct that has `Error()`.** Promoted methods can accidentally satisfy `error` for types you did not intend to be errors.

---

## Test

```go
package myerr

import (
    "errors"
    "testing"
)

type NotFoundError struct{ ID int }

func (e *NotFoundError) Error() string { return "not found" }

func TestErrorsAsFindsCustomType(t *testing.T) {
    var err error = &NotFoundError{ID: 42}
    var nf *NotFoundError
    if !errors.As(err, &nf) {
        t.Fatal("errors.As should find *NotFoundError")
    }
    if nf.ID != 42 {
        t.Fatalf("want 42, got %d", nf.ID)
    }
}

func TestNilCustomErrorIsNotNilInterface(t *testing.T) {
    var nf *NotFoundError
    var err error = nf
    if err == nil {
        t.Fatal("expected the typed-nil trap (err != nil)")
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What is the minimum to implement `error`?*
   A method `Error() string`. That is the entire interface.

2. *What is the difference between a sentinel and a custom type?*
   A sentinel is a fixed value (`var ErrX = errors.New(...)`); a custom type is a struct that can carry per-instance data.

3. *Why does `var e *MyErr; var err error = e; err != nil` evaluate to true?*
   Because the interface stores `(type=*MyErr, value=nil)`, which is not the zero interface.

4. *What method makes `errors.Is` walk the chain?*
   `Unwrap() error` (or `Unwrap() []error` since Go 1.20 for multi-error cases).

5. *Should `Error()` be on a value or pointer receiver?*
   Almost always pointer. Consistency, no accidental copies, and the type can be `nil`-checkable.

6. *Why `errors.As` instead of `err.(*MyErr)`?*
   `errors.As` walks the chain and handles wrapped errors; the bare assertion sees only the outermost layer.

7. *Should every error in my package be a custom type?*
   No. Sentinels are right for "one fixed condition". Custom types are right when each occurrence has different data.

8. *What is the Op pattern?*
   Each layer adds a short label like `"db.Get"` to the error so the final message reads as a path.

---

## Cheat Sheet

```go
// Minimal custom error
type FooError struct{ Field string }
func (e *FooError) Error() string { return "foo: " + e.Field }

// With wrap
type WrapErr struct {
    Op  string
    Err error
}
func (e *WrapErr) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *WrapErr) Unwrap() error { return e.Err }

// Sentinel
var ErrNotFound = errors.New("not found")

// Detection
if errors.Is(err, ErrNotFound) { /* ... */ }

var fe *FooError
if errors.As(err, &fe) { /* fe.Field */ }

// Constructor
func NewFoo(field string) error { return &FooError{Field: field} }

// Always
return nil // never `return (*FooError)(nil)`
```

```bash
go vet ./...   # catches some error-comparison mistakes
errcheck ./... # third-party: catches unhandled errors
```

---

## Self-Assessment Checklist

- [ ] I can implement `error` with one method.
- [ ] I know when to use a sentinel and when to use a struct.
- [ ] I always use a pointer receiver for error structs.
- [ ] I implement `Unwrap` when my type carries an inner error.
- [ ] I detect errors with `errors.Is` / `errors.As`, not string parsing or bare assertions.
- [ ] I never return a typed-nil pointer as an error.
- [ ] I write a constructor instead of letting callers compose the struct.
- [ ] I test `errors.Is` / `errors.As` on my custom type.

---

## Summary

A custom error type is a struct (or named type) that implements `Error() string`. It is how you carry structured data alongside a failure: IDs, paths, codes, wrapped causes. The standard tools — sentinels, `Unwrap`, `errors.Is`, `errors.As` — combine with custom types to give you a clean way to branch on failure categories without scraping strings. The biggest beginner traps are the typed-nil pointer and forgetting `Unwrap`. Use pointer receivers, ship a constructor, and test the chain semantics, and your custom errors will scale from a one-file script to a service with dozens of failure shapes.

---

## What You Can Build

- A small `httperror` package mapping `*NotFoundError`, `*ValidationError`, `*AuthError` to HTTP status codes.
- A CLI tool that returns a `*ExitError` with an integer code consumed by `main()`.
- A parser that returns `*ParseError{Line, Col, Msg}` so the IDE can underline the right spot.
- A repository layer that turns `sql.ErrNoRows` into your typed `*NotFoundError`.

---

## Further Reading

- [Package errors](https://pkg.go.dev/errors)
- [The Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Dave Cheney — Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Rob Pike — Errors are values](https://go.dev/blog/errors-are-values)
- [Upspin error package](https://github.com/upspin/upspin/tree/master/errors)

---

## Related Topics

- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w` and `Unwrap` semantics
- [09-errors-is-vs-as-deep](../09-errors-is-vs-as-deep/junior.md) — detecting errors in chains
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — when one fixed value is enough
- [08-stack-traces-debugging](../08-stack-traces-debugging/junior.md) — adding `Stack` to a custom error type
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — when to wrap, when to translate

---

## Diagrams & Visual Aids

```
            +---------------------+
            |      error          |   interface
            |  Error() string     |
            +----------^----------+
                       |
       +---------------+---------------+
       |                               |
+--------------+              +-----------------+
| errors.New() |              |  *MyError       |   custom type
| (sentinel)   |              |  Op  Path  Err  |
+--------------+              |  Error() string |
                              |  Unwrap() error |
                              +--------+--------+
                                       |
                              +--------v--------+
                              |  inner error    |
                              +-----------------+
```

```
chain walk by errors.Is / errors.As
+---------+   Unwrap   +---------+   Unwrap   +---------+
| WrapErr | --------> | DBError | --------> |  io.EOF  |
+---------+           +---------+           +---------+
   ^                       ^
   |                       |
errors.As(&we)        errors.As(&db)
```

```
typed-nil trap
   var e *MyErr   ---> (*MyErr, nil)
   var err error = e
   err == nil   ---> false  (the type slot is non-empty)
```
