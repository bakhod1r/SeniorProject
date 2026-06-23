# errors.New — Junior Level

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
> Focus: "How do I create a brand-new error from a string?"

When a function in your program decides "something is wrong," it has to *produce an error value* to return. The `error` type itself is just an interface — Go does not give you an error out of thin air. You need a concrete value that satisfies `error`. The most direct, most boring, most universally used way to do that is:

```go
import "errors"

err := errors.New("something went wrong")
```

That single call gives you back a value of type `error` whose `Error()` method returns the string `"something went wrong"`. Nothing more, nothing less. No stack trace, no error code, no nested cause — just a string wrapped in the smallest possible interface-satisfying type.

`errors.New` is the **first error constructor** every Go programmer learns. It is also the constructor that the standard library itself uses thousands of times. Once you know it, you can read most Go code that creates errors.

After reading this file you will:
- Know the signature of `errors.New` and what it returns
- Be able to create error values from any string
- Understand when to use `errors.New` vs `fmt.Errorf`
- Recognize the package-level sentinel pattern (`var ErrFoo = errors.New(...)`)
- Know why two `errors.New("same")` results are *not* equal with `==`
- Be able to compare errors safely using `errors.Is`

---

## Prerequisites

- **Required:** The `error` interface and `if err != nil` idiom (see [01-error-handling-basics](../01-error-handling-basics/junior.md)).
- **Required:** Basic familiarity with Go imports and the standard library.
- **Required:** Pointers (just enough to know "two different pointers can have the same string inside").
- **Helpful:** Package-level variables (`var Foo = ...`).
- **Helpful:** Awareness of the `fmt` package and `fmt.Errorf` (we will compare and contrast).

---

## Glossary

| Term | Definition |
|------|-----------|
| **`errors.New`** | A function in the `errors` package that takes a `string` and returns an `error`. |
| **`*errorString`** | The unexported concrete type that `errors.New` returns. It has one field: `s string`. |
| **sentinel error** | A package-level error value used as a marker, e.g. `var ErrNotFound = errors.New("not found")`. |
| **identity** | Whether two error values are *the same value*. Two calls to `errors.New("x")` produce different identities even though both messages match. |
| **package-level variable** | A `var` declared outside any function, allocated once at program start. |
| **`fmt.Errorf`** | A heavier sibling that formats arguments into a string, optionally wrapping a cause with `%w`. |
| **`errors.Is`** | The correct way to ask "does this error chain include a specific sentinel?" |
| **wrap** | To attach context to an error while preserving identity, usually with `fmt.Errorf("...: %w", err)`. |

---

## Core Concepts

### Concept 1: The signature

```go
func New(text string) error
```

That is the entire public surface. You give it a string; you get back an `error`. The error's `Error()` method returns exactly the string you passed in.

```go
err := errors.New("disk full")
fmt.Println(err)         // disk full
fmt.Println(err.Error()) // disk full
```

### Concept 2: The implementation (one peek)

The Go standard library's implementation, in `$GOROOT/src/errors/errors.go`, is small enough to fit in a tweet:

```go
type errorString struct {
    s string
}

func (e *errorString) Error() string {
    return e.s
}

func New(text string) error {
    return &errorString{s: text}
}
```

Three things to notice:
1. `errorString` is **unexported**. You cannot import or name it from outside the `errors` package.
2. `Error()` is on the **pointer receiver** `*errorString`. The error's *identity* is therefore the *pointer*, not the string.
3. `New` returns `&errorString{...}` — a **pointer to a freshly allocated struct**. Every call gives you a *different* pointer.

That third point is the source of every "errors.New comparison" gotcha you will ever see.

### Concept 3: Pointer identity vs string equality

Because `errors.New` returns a pointer to a freshly allocated value:

```go
a := errors.New("nope")
b := errors.New("nope")
fmt.Println(a == b) // false — different pointers
```

The strings are the same. The pointers are not. `==` on errors compares the interface values, which compare by dynamic type *and* underlying pointer. So two separately constructed `errors.New("nope")` results are unequal.

This is *the* lesson of `errors.New`: **never compare errors by calling `errors.New` twice and using `==`**. Instead, declare the error once at package level and reuse the same value:

```go
var ErrNope = errors.New("nope")

func f() error { return ErrNope }
func g() error { return ErrNope }

// Now you can do: if err == ErrNope
```

### Concept 4: When to use `errors.New`

Reach for `errors.New` when:
- The error message is a **fixed string** (no formatting needed).
- You do not need to **wrap** another error.
- You are creating a **package-level sentinel** the rest of your code can compare against.

Reach for `fmt.Errorf` when:
- You need to **format values** into the message: `fmt.Errorf("user %d not found", id)`.
- You need to **wrap a cause**: `fmt.Errorf("loading config: %w", err)`.

If your message has no `%` verbs and no cause to wrap, `errors.New` is the simpler, faster choice.

### Concept 5: The sentinel pattern

By far the most important pattern built on `errors.New`:

```go
package store

import "errors"

var (
    ErrNotFound = errors.New("store: not found")
    ErrExists   = errors.New("store: exists")
)
```

These are **package-level errors** (sentinels). Every caller can compare against them:

```go
if errors.Is(err, store.ErrNotFound) {
    // user-facing 404
}
```

Most Go libraries declare a small set of these. They are the public, documented errors of the package.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **`errors.New("text")`** | Writing a single-line memo on a sticky note. The note can say anything, but each note you write is a *new* sticky, even if the words match. |
| **Pointer identity** | Two identical receipts printed at different times are still two pieces of paper. They look the same; they are not the same physical object. |
| **Package-level sentinel** | The "Out of Stock" sign behind the counter — there is only one, every cashier points to the same sign, customers all recognize it as *the* "out of stock." |
| **Per-call `errors.New`** | Buying a fresh "Out of Stock" sign every time a customer asks. Wasteful and unnecessary. |
| **`errors.New` vs `fmt.Errorf`** | A pre-printed memo vs a typewriter. Use the memo when the text is fixed; use the typewriter when you need to fill in details. |

---

## Mental Models

**The intuition:** `errors.New` is the world's smallest error factory. You feed it a string, it stamps out one error value and hands it to you. That is *all* it does. Anything more — formatting, wrapping, codes, stack traces — is somewhere else.

**Why this model helps:** It kills the temptation to think `errors.New` does anything clever. It does not. There is no caching, no interning, no deduplication. Two calls with the same string make two distinct values. Once you accept that, the comparison rules become obvious.

**The second intuition:** Think of errors as having two identities — *what they say* (the message) and *who they are* (the pointer). `errors.New` lets you control both: the string sets what it says, and where you put the call (top-level once, vs inside a function repeatedly) sets who it is.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Tiny, obvious API: one input, one output. | No formatting; for that you need `fmt.Errorf`. |
| Cheapest error constructor in the standard library. | Each call allocates a fresh `*errorString` on the heap if you do not reuse. |
| Pairs perfectly with package-level sentinels. | Pointer identity — two `errors.New("x")` are not `==`. Beginners trip on this. |
| Result is immutable — string field is set at construction. | No structured fields; if you need a code or context, you outgrow `errors.New`. |
| Works with `errors.Is` and `errors.As` (via wrapping). | Easy to misuse: comparing two ad-hoc `errors.New` values, or shadowing sentinels. |

### When to use:
- Static error messages.
- Declaring a package-level sentinel: `var ErrFoo = errors.New("foo")`.
- The first version of a library where you have not yet decided on a richer error type.

### When NOT to use:
- The message includes runtime values (`fmt.Errorf` instead).
- You need to wrap an existing error (`fmt.Errorf` with `%w`).
- You want callers to inspect structured fields like a `Code int` (define a struct that implements `error`).

---

## Use Cases

- **Sentinels** — `io.EOF` is `errors.New("EOF")`. So is `sql.ErrNoRows`. So are many of yours.
- **Validation** — `if name == "" { return errors.New("name required") }`.
- **Defensive checks** — guarding against nil arguments or empty inputs.
- **Tests** — constructing a known error to inject into mocks: `mockErr := errors.New("boom")`.
- **Quick scripts** — when you do not yet care about error structure and just want a return value.

---

## Code Examples

### Example 1: The one-liner

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.New("something went wrong")
    fmt.Println(err)
}
```

**What it does:** Creates a fresh error value and prints its message. The output is exactly `"something went wrong"`.
**How to run:** `go run main.go`

### Example 2: Returning an error from a function

```go
package main

import (
    "errors"
    "fmt"
)

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func main() {
    if v, err := divide(10, 2); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("result:", v)
    }
    if v, err := divide(10, 0); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("result:", v)
    }
}
```

**What it does:** A simple function uses `errors.New` to signal a failure mode.

### Example 3: A package-level sentinel

```go
package main

import (
    "errors"
    "fmt"
)

var ErrInvalidInput = errors.New("invalid input")

func parseAge(s string) (int, error) {
    if s == "" {
        return 0, ErrInvalidInput
    }
    // ... real parsing ...
    return 0, nil
}

func main() {
    _, err := parseAge("")
    if err == ErrInvalidInput {
        fmt.Println("matched sentinel")
    }
}
```

**What it does:** Declares a single error value, returns it from a function, and compares with `==` because we never wrapped it. Both sides refer to the *same* pointer.

### Example 4: The pointer-identity trap

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("same message")
    b := errors.New("same message")
    fmt.Println(a == b)         // false
    fmt.Println(a.Error() == b.Error()) // true
}
```

**What it does:** Demonstrates that two errors with identical messages are not equal — they are two different `*errorString` pointers.

### Example 5: Comparing safely with `errors.Is`

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func lookup(id int) error {
    return ErrNotFound
}

func main() {
    err := lookup(42)
    if errors.Is(err, ErrNotFound) {
        fmt.Println("yes, it's the not-found sentinel")
    }
}
```

**What it does:** Uses `errors.Is` so that the comparison continues to work even after wrapping (which we will see soon). For unwrapped errors, `errors.Is(err, ErrNotFound)` and `err == ErrNotFound` are equivalent — but `errors.Is` keeps working when wrappers are introduced later.

### Example 6: `errors.New` vs `fmt.Errorf`

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("user not found")
    b := fmt.Errorf("user %d not found", 42)
    fmt.Println(a) // user not found
    fmt.Println(b) // user 42 not found
}
```

**What it does:** Shows when each constructor is appropriate. `errors.New` for fixed strings, `fmt.Errorf` for formatted ones.

### Example 7: Wrapping a sentinel with `%w`

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func loadUser(id int) error {
    return fmt.Errorf("loadUser %d: %w", id, ErrNotFound)
}

func main() {
    err := loadUser(7)
    fmt.Println(err)                       // loadUser 7: not found
    fmt.Println(errors.Is(err, ErrNotFound)) // true
}
```

**What it does:** Wraps a sentinel created with `errors.New`. The string carries context, but `errors.Is` still finds the original sentinel.

### Example 8: A common mistake (do not do this)

```go
// BAD — comparing two ad-hoc errors.New values
func isMyError(err error) bool {
    return err == errors.New("expected error")
}
```

**What it does:** Always returns `false`. Each call to `errors.New` is a fresh pointer; they never compare equal. The fix is to declare the sentinel once at package scope.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Package-level sentinels

```go
package myservice

import "errors"

var (
    ErrNotFound = errors.New("myservice: not found")
    ErrExists   = errors.New("myservice: already exists")
)
```

Conventionally:
- Names start with `Err`.
- The message includes the package name as a prefix: `"myservice: not found"`.
- They are declared together near the top of the file.

### Pattern 2: Return a sentinel; let the caller match

```go
func (s *Store) Get(id int) (*User, error) {
    u, ok := s.cache[id]
    if !ok {
        return nil, ErrNotFound
    }
    return u, nil
}

// caller
u, err := s.Get(7)
if errors.Is(err, ErrNotFound) {
    // 404
}
```

### Pattern 3: Wrap with context, preserve identity

```go
return fmt.Errorf("Store.Get(%d): %w", id, ErrNotFound)
```

The caller can still match `ErrNotFound` via `errors.Is`. The string also tells them where it came from.

### Pattern 4: One-shot inline errors

```go
if x < 0 {
    return errors.New("x must be non-negative")
}
```

For simple, never-going-to-be-matched-against errors, an inline `errors.New` is fine. Allocation is once per failure path; nobody cares.

### Pattern 5: Test-only error injection

```go
func TestRetry(t *testing.T) {
    boom := errors.New("boom")
    err := callWithRetry(func() error { return boom })
    if !errors.Is(err, boom) {
        t.Fatalf("expected boom, got %v", err)
    }
}
```

A throwaway error created in a test is a fine use of `errors.New`.

---

## Clean Code

- **Sentinel naming**: prefix with `Err`. `ErrNotFound`, not `NotFoundErr` or `errNotFound` (unless deliberately unexported).
- **Message formatting**: lowercase first letter, no trailing period: `"not found"` not `"Not found."`.
- **Package prefix in messages**: `"store: not found"` so when wrapped or printed it is clear which package emitted the error.
- **Group sentinels together**: at the top of the file inside one `var (...)` block, with a comment if there is a non-obvious reason for each.
- **Do not export internal sentinels**: if a sentinel is a hint for callers, export it; if it is private control flow, keep it lowercase.

---

## Product Use / Feature

A small user service:

```go
package user

import "errors"

var (
    ErrNotFound        = errors.New("user: not found")
    ErrEmailExists     = errors.New("user: email already in use")
    ErrPasswordTooWeak = errors.New("user: password does not meet policy")
)

type Service struct{ /* ... */ }

func (s *Service) Register(email, pw string) error {
    if !strongEnough(pw) {
        return ErrPasswordTooWeak
    }
    if s.emailTaken(email) {
        return ErrEmailExists
    }
    // ... create user ...
    return nil
}
```

Three sentinels, three failure modes, all expressible to callers via `errors.Is`. The HTTP layer can map them to 400, 409, 422 cleanly.

---

## Error Handling

How to handle errors created by `errors.New`:

- **Compare with `errors.Is`** — works whether or not the error has been wrapped.
- **Avoid `==`** unless you are *certain* nothing wraps the error. As your code grows, that certainty disappears.
- **Wrap before returning** when context helps debugging: `fmt.Errorf("Get(%d): %w", id, ErrNotFound)`.
- **Do not log AND return** the same error in a deep helper; let the top of the call stack decide.

---

## Security Considerations

- **Do not embed secrets in error strings**. `errors.New("auth failed for token " + token)` will leak that token into logs forever.
- **Be careful with user-provided values**. Passing them into `errors.New` directly is fine (no format verbs interpreted), but if you build the string with `+` or `fmt.Sprintf` first, watch for log-injection (newlines, ANSI escapes).
- **Stable error messages aid attackers in fingerprinting**. For authentication flows, prefer indistinguishable failure messages: a single `errors.New("invalid credentials")` for both "user not found" and "wrong password."

---

## Performance Tips

- `errors.New` allocates one heap object per call (a `*errorString` of 16 bytes plus the string header — see `professional.md` for exact numbers).
- For fixed messages used many times, declare a single `var ErrFoo = errors.New("foo")` once and reuse. Allocation per call drops to zero.
- For dynamic messages, `errors.New(fmt.Sprintf(...))` is *worse* than `fmt.Errorf(...)`. Prefer the latter.
- Allocations on the *failure* path rarely matter. Only optimize if the failure case is in a hot loop (e.g., parsing millions of tokens where many are invalid).

---

## Best Practices

- **Declare sentinels once**: at package scope, with `var Err... = errors.New(...)`.
- **Compare with `errors.Is`**: future-proof against wrapping.
- **Use `fmt.Errorf` when you need formatting or wrapping**: do not build up strings with `+` and feed them to `errors.New`.
- **Keep error messages short and stable**: callers may match them in tests or logs.
- **Document exported sentinels**: every public `Err...` should have a doc comment explaining when it is returned.

---

## Edge Cases & Pitfalls

- **Two `errors.New` with the same string are not `==`**. Identity is by pointer, not by content.
- **Shadowing**: `var ErrFoo = errors.New("foo")` followed by a local `ErrFoo := errors.New("foo")` makes the local variable a *different* error. Code that then compares against the package-level `ErrFoo` will silently fail.
- **Mutating the message**: you cannot. The struct field `s` is unexported; the value is effectively immutable. Good.
- **Returning `errors.New` from inside a `defer`**: you can, but make sure the deferred call assigns to a named return; otherwise it is lost.
- **`errors.New("")`**: legal, but rude. Prints as an empty string. Avoid.

---

## Common Mistakes

1. **Calling `errors.New` inside a hot loop** when a sentinel would do.
2. **Comparing with `==` when a `%w` wrapper is in play** — silent false negatives.
3. **Embedding a runtime value into an `errors.New` string** by string concatenation. Use `fmt.Errorf` instead.
4. **Defining the same sentinel in two files**, producing two distinct values that never compare equal.
5. **Not prefixing the error message** with the package name, making logs hard to trace.
6. **Returning a fresh `errors.New("not found")` from each call**, breaking caller comparison logic.
7. **Using `errors.New` to "wrap"** another error: `errors.New(err.Error())` flattens the chain. Use `fmt.Errorf("...: %w", err)`.

---

## Common Misconceptions

- **"`errors.New` interns strings."** No. Each call returns a fresh allocation.
- **"`errors.New` is slow."** It is the fastest constructor in the package. The cost is one small allocation, comparable to `make([]byte, 0)`.
- **"`errors.New` adds a stack trace."** It does not. Stack traces require third-party libraries (`pkg/errors`, `cockroachdb/errors`) or manual capture.
- **"You can subclass `errorString`."** No — it is unexported. You define your *own* type that implements `error` (covered in 5.4).
- **"Two `errors.New("x")` are equal because the strings match."** False. They are different pointers.

---

## Tricky Points

- **Pointer identity vs string equality**: `a == b` is `false` even if `a.Error() == b.Error()`.
- **Capitalization**: `errors.New("Foo")` is legal but violates style. Lint rules will flag it.
- **`errors.New(nil)`**: does not compile. The argument is a `string`, not an `error`.
- **Nil interface vs nil pointer**: `var e *errorString; var err error = e; err == nil` is `false` — the interface is non-nil because the dynamic type slot is non-nil. (Same gotcha as in 5.1, restated for `errorString`.)
- **Re-creating a sentinel at runtime via `errors.New`** breaks the package-level identity. Always use the `var Err... = errors.New(...)` form.

---

## Test

```go
package mypkg

import (
    "errors"
    "testing"
)

var ErrEmpty = errors.New("empty input")

func parse(s string) error {
    if s == "" {
        return ErrEmpty
    }
    return nil
}

func TestParse_Empty(t *testing.T) {
    if err := parse(""); !errors.Is(err, ErrEmpty) {
        t.Fatalf("got %v, want ErrEmpty", err)
    }
}

func TestParse_OK(t *testing.T) {
    if err := parse("hi"); err != nil {
        t.Fatalf("unexpected: %v", err)
    }
}

func TestErrorsNew_Identity(t *testing.T) {
    a := errors.New("x")
    b := errors.New("x")
    if a == b {
        t.Fatalf("expected different pointers, got equal")
    }
    if a.Error() != b.Error() {
        t.Fatalf("expected same message")
    }
}
```

Run with `go test ./...`.

---

## Tricky Questions

1. *Why does `errors.New("a") == errors.New("a")` return `false`?*
   Because each call allocates a new `*errorString` and the interface value compares by dynamic-type-and-pointer.

2. *What is the return type of `errors.New`?*
   `error` (the interface). The dynamic type is `*errorString`, but that type is unexported.

3. *Can I subclass `errorString` to add fields?*
   No — it is unexported. You define your own struct that implements `error`.

4. *When should I use `errors.New` vs `fmt.Errorf`?*
   Use `errors.New` for static strings with no wrapping. Use `fmt.Errorf` for formatted messages or for wrapping existing errors with `%w`.

5. *Where should I declare a sentinel?*
   At package scope, with `var ErrFoo = errors.New("pkg: foo")`. Once per program lifetime.

6. *Does `errors.New` add a stack trace?*
   No. The standard library `errors.New` produces only a message.

7. *Is `errors.New` thread-safe?*
   The function itself is. The returned value is also safe to share between goroutines because the `s` field is set once and never mutated.

---

## Cheat Sheet

```go
// Create
err := errors.New("static message")

// Sentinel pattern
var ErrNotFound = errors.New("pkg: not found")

// Compare (preferred)
if errors.Is(err, ErrNotFound) { ... }

// Compare (only safe if no wrapping anywhere)
if err == ErrNotFound { ... }

// Wrap with context
return fmt.Errorf("op: %w", ErrNotFound)

// Format vs static
errors.New("invalid input")            // static
fmt.Errorf("invalid input: %d", x)     // formatted
fmt.Errorf("op: %w", err)              // wrap

// Pitfall: per-call allocation
return errors.New("not found")         // allocates each call
return ErrNotFound                     // zero allocations
```

---

## Self-Assessment Checklist

- [ ] I can write `errors.New("...")` and explain what it returns.
- [ ] I know that two `errors.New("x")` calls give different values.
- [ ] I can declare a package-level sentinel.
- [ ] I prefer `errors.Is` over `==` for comparison.
- [ ] I know when to reach for `fmt.Errorf` instead.
- [ ] I can spot a misuse where someone compared two ad-hoc `errors.New` values.
- [ ] I can name a real-world sentinel from the standard library (e.g., `io.EOF`, `sql.ErrNoRows`).

---

## Summary

`errors.New` is the smallest tool in Go's error toolbox: a function that turns a string into a value satisfying the `error` interface. Its implementation is three lines. Its rules are three: each call allocates, identity is by pointer, and you almost always want it at package scope as a sentinel. Master it before you reach for typed errors or wrapping, because every richer error pattern in Go is built on top of the same idea.

---

## What You Can Build

- A CLI argument parser that returns `ErrMissing`, `ErrInvalid`, `ErrConflict` sentinels.
- A small in-memory key-value store with `ErrNotFound` and `ErrExists`.
- A retry helper whose tests use a `boom := errors.New("boom")` to inject failures.
- A validation library where every rule has a sentinel error value.

---

## Further Reading

- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [The Go Blog: Errors are values (Rob Pike)](https://go.dev/blog/errors-are-values)
- [pkg.go.dev: errors package](https://pkg.go.dev/errors)
- Source code: `$GOROOT/src/errors/errors.go` — read it; it is twenty lines.

---

## Related Topics

- [01-error-handling-basics](../01-error-handling-basics/junior.md) — the `error` interface and `if err != nil`
- [02-error-interface](../02-error-interface/junior.md) — how `error` is defined
- [04-fmt-errorf](../04-fmt-errorf/junior.md) — formatted and wrapped errors
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w`, `errors.Is`, `errors.As`
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — design rules for sentinels at scale

---

## Diagrams & Visual Aids

```
errors.New("not found")
        |
        v
+-------------------+
| heap allocation   |
| *errorString      |
| s = "not found"   |
+-------------------+
        |
        v
   error interface
   (itab=*errorString, data=ptr)
```

Two calls, two pointers:

```
errors.New("x")  -->  ptr A  --+
                                 |==> different pointers, == is false
errors.New("x")  -->  ptr B  --+
```

Sentinel pattern:

```
package init:
    ErrNotFound  -->  ptr S (allocated once)

func A:  return ErrNotFound  -->  ptr S
func B:  return ErrNotFound  -->  ptr S

caller:  errors.Is(err, ErrNotFound)  -->  matches ptr S
```
