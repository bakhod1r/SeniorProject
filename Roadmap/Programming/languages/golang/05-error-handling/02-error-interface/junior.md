# error interface — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The error Interface](#the-error-interface)
5. [Your First Custom Error](#your-first-custom-error)
6. [Why an Interface and Not a Struct](#why-an-interface-and-not-a-struct)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros-cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Common Mistakes](#common-mistakes)
13. [Edge Cases](#edge-cases)
14. [Tricky Points](#tricky-points)
15. [Cheat Sheet](#cheat-sheet)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Diagrams](#diagrams)

---

## Introduction
> Focus: "What is the error interface?" and "How do I make my own error type?"

In [01-error-handling-basics](../01-error-handling-basics/junior.md) you learned that an error is a *value* you return from functions. But what *is* an error, exactly?

Go answers: **an error is anything with an `Error() string` method.**

That is the entire definition. Not a struct, not a class — an *interface*. Any type — yours, mine, the standard library's — can be an error if it has that one method.

```go
type error interface {
    Error() string
}
```

This file is about the rules, mechanics, and idioms of writing your own error types using this interface. We'll start with `errors.New` (which is what you've used so far), explain what it actually is under the hood, and build up to writing your own error types with extra fields like a status code or a path.

---

## Prerequisites

- **Required:** You can write and call functions that return `error`.
- **Required:** You understand structs and methods.
- **Required:** You know what an interface is at a high level.
- **Helpful:** You've read [01-error-handling-basics](../01-error-handling-basics/junior.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **interface** | A Go type that lists method signatures. Anything with those methods *is* the interface. |
| **method set** | The set of methods declared on a type (and its pointer, with caveats). |
| **method** | A function with a receiver, e.g. `func (e *MyErr) Error() string`. |
| **receiver** | The thing the method is attached to: value (`func (e MyErr) ...`) or pointer (`func (e *MyErr) ...`). |
| **satisfy** | A type *satisfies* an interface when it has all the interface's methods. |
| **dynamic type** | The actual concrete type stored in an interface value at runtime. |
| **predeclared** | Built into the language. `error`, `int`, `bool` are predeclared. |

---

## The error Interface

Go has only one *predeclared* interface: `error`. Its definition is conceptually:

```go
type error interface {
    Error() string
}
```

Three observations:

1. **One method.** Just `Error()`. Not `Error()`, `Code()`, `Unwrap()` — only `Error()`.
2. **Returns a string.** A human-readable description of the failure.
3. **The interface lives in the universe block.** You do not import it; you cannot redefine it.

So when you write `errors.New("oops")`, you get back something that has an `Error() string` method. When you write `if err != nil { fmt.Println(err) }`, the `fmt` package calls `err.Error()` to get the text.

---

## Your First Custom Error

```go
package main

import "fmt"

type DivisionError struct {
    Dividend, Divisor float64
}

func (e *DivisionError) Error() string {
    return fmt.Sprintf("cannot divide %g by %g", e.Dividend, e.Divisor)
}

func Divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, &DivisionError{Dividend: a, Divisor: b}
    }
    return a / b, nil
}

func main() {
    _, err := Divide(10, 0)
    if err != nil {
        fmt.Println(err)  // calls err.Error()
    }
}
```

**What happened:**
1. We defined a struct `DivisionError` with two fields.
2. We attached an `Error() string` method to `*DivisionError`. Now `*DivisionError` satisfies the `error` interface.
3. `Divide` returns a `*DivisionError` when `b == 0`. The compiler accepts this because `*DivisionError` is an `error`.
4. The caller treats it like any other error.

**Why a pointer receiver (`*DivisionError`)?**
- It avoids copying the struct on every method call.
- It's the convention for error types in the standard library (`*os.PathError`, `*net.OpError`, `*json.SyntaxError`).
- Pointer comparisons work cleanly with `errors.Is`.

You *can* use a value receiver, but unless your error has no fields (or you have a strong reason), use pointer receivers.

---

## Why an Interface and Not a Struct

If `error` were a struct, every error would have the same fields. Want to add a status code? Now everyone in the world has to.

If `error` were a class hierarchy (Java-style), you would need to extend a base class. Cross-package inheritance is awkward.

By making `error` an *interface*, Go says: "show me an `Error() string` method and I will accept your value." Each package, each application, can define error types with whatever extra fields they need. They all interoperate because they all satisfy the same one-method interface.

This is the **structural typing** philosophy: types are not labels you stick on; they emerge from what the type can do.

---

## Code Examples

### Example 1: errorString — what `errors.New` returns

The standard library's implementation of `errors.New`:

```go
package main

import "fmt"

type errorString struct {
    s string
}

func (e *errorString) Error() string {
    return e.s
}

func New(text string) error {
    return &errorString{s: text}
}

func main() {
    err := New("hello")
    fmt.Println(err.Error())
}
```

That's it. `errors.New` is **literally** four lines. You could write it yourself.

### Example 2: An error with a code

```go
type APIError struct {
    Code    int
    Message string
}

func (e *APIError) Error() string {
    return fmt.Sprintf("API %d: %s", e.Code, e.Message)
}

func getUser(id int) (*User, error) {
    if id < 0 {
        return nil, &APIError{Code: 400, Message: "negative id"}
    }
    return nil, &APIError{Code: 404, Message: "user not found"}
}
```

The caller can either ignore the structure (just print `err`) or extract the code:

```go
err := getUser(-1)
var apiErr *APIError
if errors.As(err, &apiErr) {
    fmt.Println("status:", apiErr.Code)
}
```

### Example 3: An error with a path

```go
type PathError struct {
    Op   string  // "open", "read", "write"
    Path string
    Err  error   // underlying cause
}

func (e *PathError) Error() string {
    return e.Op + " " + e.Path + ": " + e.Err.Error()
}

// usage
return &PathError{Op: "read", Path: "/etc/foo", Err: io.ErrUnexpectedEOF}
```

This is essentially how `os.PathError` works in the standard library.

### Example 4: A value receiver (small, immutable error)

```go
type StaticError string

func (e StaticError) Error() string { return string(e) }

const ErrShutdown StaticError = "system is shutting down"

func canStart() error {
    if isShuttingDown {
        return ErrShutdown
    }
    return nil
}
```

Here the error has no fields except a string. A value receiver works fine and avoids the heap allocation a pointer would imply.

### Example 5: Multiple methods (preview)

```go
type RetryableError struct {
    Inner error
}

func (e *RetryableError) Error() string { return "retryable: " + e.Inner.Error() }
func (e *RetryableError) Unwrap() error { return e.Inner }
```

Here we add a second method, `Unwrap()`. This makes `errors.Is` and `errors.As` look through the wrapper. Detail in [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md).

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Anyone can define an error type. | Easy to make typos like `Errorr()` — the wrong name silently fails to satisfy. |
| Custom errors carry structured data. | Custom types = more code than `errors.New`. |
| Interface-based — flexible and decoupled. | Pointer vs value receiver trips up beginners. |
| Standard library uses the same pattern. | Need to remember to export struct fields if other packages should read them. |

---

## Use Cases

- **API errors** — carry HTTP status codes alongside messages.
- **Validation errors** — carry the offending field name.
- **Path/IO errors** — carry the file path and operation.
- **Database errors** — carry the SQL state, query, parameters.
- **HTTP transport errors** — carry the URL, status, and response body snippet.

---

## Coding Patterns

### Pattern A: Pointer receiver, allocate per failure

```go
type FieldError struct{ Field string }
func (e *FieldError) Error() string { return "field " + e.Field }
return &FieldError{Field: "email"}
```

Default for any error with fields.

### Pattern B: String-typed error (sentinel-friendly)

```go
type ErrCode string
func (e ErrCode) Error() string { return string(e) }

const ErrNotFound = ErrCode("not found")
```

The constant comparison `err == ErrNotFound` works *and* the type itself satisfies `error`. Useful for enum-like sentinels.

### Pattern C: Embedded error

```go
type ValidationError struct {
    error  // embed
    Field string
}
```

Embedding the `error` interface gives you the `Error()` method "for free" (delegated to the inner error). Combine with extra fields. Detail in `middle.md`.

### Pattern D: Behavior-bearing error

```go
type Temporary interface {
    Temporary() bool
}
```

A separate, *behavioral* interface. Errors that "implement" it can be detected via type assertion: `if t, ok := err.(Temporary); ok && t.Temporary() { /* retry */ }`. The standard `net` package used to use this exactly.

---

## Clean Code

- **Name your error types `XxxError`** — `ParseError`, `NetworkError`. Convention from the standard library.
- **`Error() string` is your *only* required method** — do not stuff every diagnostic into it. Use fields instead.
- **Lowercase, no trailing punctuation** in the message — `"open foo.txt: no such file"` not `"Open foo.txt: No such file."`
- **Pointer receivers** for any error with fields. Value receivers only for empty types or single-string wrappers.
- **Export the struct and its fields** if other packages will inspect them via `errors.As`.

---

## Common Mistakes

1. **Misspelling the method name** — `func (e *MyErr) Errorr() string`. Compiler does not warn until you try to assign to `error`. Even then, the compiler error can be cryptic.
2. **Wrong receiver type** — defining `Error()` on `MyErr` (value) but returning `&MyErr{}` (pointer) — works, but the value type does *not* satisfy `error`, only `*MyErr` does.
3. **Recursive `Error()`** — calling `fmt.Errorf("...%v...", e)` *inside* `e.Error()`. Creates infinite recursion because `%v` calls `Error()`.
4. **Forgetting to export fields** — if you want the caller to inspect `Code`, `Path`, `Field`, those fields need to start with a capital letter.
5. **Returning a typed nil pointer through an interface** — already covered in 5.1; particularly easy to trigger with custom error types.

---

## Edge Cases

- **Empty error type:** `type ErrFoo struct{}` with `Error()` returning `"foo"` — useful but rarely necessary; a sentinel `var ErrFoo = errors.New("foo")` is simpler.
- **Error with non-comparable fields** (a slice or map): `errors.Is(a, b)` will fail with a runtime panic if both are the same dynamic type — interface equality requires comparable dynamic types.
- **Method on the wrong receiver:** `Error()` on the value works for value calls; `Error()` on the pointer means only `*T` is an error, not `T`.

---

## Tricky Points

- A type can have *both* an `Error()` method and other methods. The error satisfies `error` *and* whatever other interfaces those methods imply.
- The compiler resolves `err.Error()` at runtime via the itab, so calling `Error()` on a nil interface panics — but on a `nil` typed pointer (interface is non-nil), it depends on how `Error()` handles nil receivers.
- A method declared on `T` is in the method set of both `T` and `*T`. A method declared on `*T` is *only* in the method set of `*T`. So a value `T` does not satisfy an interface whose method requires `*T`.

---

## Cheat Sheet

```go
// Define an error type
type MyError struct {
    Code int
    Msg  string
}
func (e *MyError) Error() string {
    return fmt.Sprintf("err %d: %s", e.Code, e.Msg)
}

// Return it
return &MyError{Code: 42, Msg: "boom"}

// Inspect at the caller (preview)
var me *MyError
if errors.As(err, &me) {
    use(me.Code)
}
```

---

## Self-Assessment

- [ ] I can write a struct with an `Error() string` method.
- [ ] I know why pointer receivers are conventional for error types.
- [ ] I can name three pitfalls when implementing custom error types.
- [ ] I understand `error` is an interface, not a base class.
- [ ] I can recognize when a type satisfies `error` by inspecting its method set.

---

## Summary

The `error` interface is one method, `Error() string`, and that simplicity is the entire foundation of Go's error system. Custom error types are just structs (or other types) with that method attached. Use a pointer receiver, export fields you want callers to inspect, and you have all the building blocks for any error API you can imagine.

---

## Further Reading

- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [Go blog: Error handling and Go](https://go.dev/blog/error-handling-and-go)
- `$GOROOT/src/os/error.go` — `*PathError`, `*LinkError`, `*SyscallError`.
- `$GOROOT/src/net/net.go` — `*OpError`.
- `$GOROOT/src/errors/errors.go` — `errorString`.

---

## Diagrams

```
              error (interface)
                  |
                  | Error() string
                  v
  +---------------+--------------+--------------+
  |               |              |              |
*errorString  *PathError    *MyError     ErrCode (string-typed)
```

```
err := &MyError{...}     // concrete value
                          |
                          v  (assigned to interface)
+--------+--------+
|  itab  |  data  |   <- error interface header
+--------+--------+
   |          |
   v          v
type+method  *MyError
table        instance
```
