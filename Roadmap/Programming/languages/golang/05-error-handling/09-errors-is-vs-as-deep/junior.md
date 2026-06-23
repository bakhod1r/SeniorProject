# errors.Is vs errors.As — Junior Level

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
> Focus: "What do `errors.Is` and `errors.As` do?" and "When do I use which?"

When you wrap an error with `fmt.Errorf("doing X: %w", err)`, the original error is still in there — but it is not on the surface anymore. You cannot just write `if err == io.EOF` and expect it to work; the `==` only sees the outer wrapper. You need a way to **look inside the chain** and ask:

- *"Is `io.EOF` somewhere in this chain?"* — that is `errors.Is`.
- *"Is there an error of type `*os.PathError` somewhere in this chain, and can I get it?"* — that is `errors.As`.

These two functions are the entire reason error wrapping in Go is useful. Without them, wrapping would just be a way to lose information politely. With them, the caller of a function can match a sentinel they care about, *or* extract an error type they can read fields off, no matter how many layers of wrapping have been applied between origin and consumer.

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    wrapped := fmt.Errorf("read header: %w", io.EOF)

    // == does not see through wrapping:
    fmt.Println(wrapped == io.EOF) // false

    // errors.Is does:
    fmt.Println(errors.Is(wrapped, io.EOF)) // true
}
```

After reading this file you will:

- Know the difference between `errors.Is` and `errors.As`.
- Know when to use each one (and when neither).
- Understand the unwrap chain: how Go walks from the outer error down to the cause.
- Recognize the most common bugs: comparing wrapped errors with `==`, passing a non-pointer to `As`, calling `Is` against a non-comparable target.
- Know where `fmt.Errorf("%w", err)` and `errors.Join(...)` fit in the picture.

---

## Prerequisites

- **Required:** The `error` interface — knowing that `error` is just `interface { Error() string }`.
- **Required:** Basic familiarity with `fmt.Errorf` and the `%w` verb (covered in 5.5).
- **Required:** Sentinel errors — package-level variables like `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`.
- **Helpful but not required:** Custom error types with methods (covered in 5.4).
- **Helpful but not required:** Type assertions and type switches.

---

## Glossary

| Term | Definition |
|------|-----------|
| **sentinel error** | A package-level error variable used as a known marker — `io.EOF`, `sql.ErrNoRows`. Comparable with `==`. |
| **error chain** | The linked list formed by an error and its `Unwrap()` results. Wrapping adds links to the front. |
| **`Unwrap()`** | A method `Unwrap() error` that returns the next error in the chain, or `nil` at the end. |
| **`Unwrap() []error`** | The Go 1.20+ multi-error variant: an error with multiple wrapped causes (used by `errors.Join`). |
| **target** | The error you are looking for. `Is(err, target)` — `target` is what you compare against. |
| **as-target** | The pointer you pass to `errors.As`. Must be a non-nil pointer to either a concrete type implementing `error` or to an interface. |
| **`errors.Is(err, target)`** | Returns true if `target` is anywhere in `err`'s chain. |
| **`errors.As(err, &target)`** | Returns true and assigns into `*target` if any error in the chain is assignable to `*target`. |
| **`fmt.Errorf("...%w", err)`** | The standard way to create a wrapped error. The `%w` verb attaches `err` as the `Unwrap()` result. |
| **`errors.Join(errs...)`** | Go 1.20+ — combines multiple errors into one whose `Unwrap()` returns `[]error`. |
| **comparable** | A Go type for which `==` is defined. Pointers, integers, strings are comparable; slices, maps, functions are not. |

---

## Core Concepts

### Concept 1: The error chain

A `error` value can have an `Unwrap()` method returning the *next* error in a logical chain. Wrapping is just attaching that link.

```go
e1 := errors.New("disk read failed")
e2 := fmt.Errorf("config load: %w", e1)
e3 := fmt.Errorf("startup: %w", e2)

// chain: e3 -> e2 -> e1 -> nil
fmt.Println(errors.Unwrap(e3))            // "config load: disk read failed"
fmt.Println(errors.Unwrap(errors.Unwrap(e3))) // "disk read failed"
```

`errors.Is` and `errors.As` walk that chain so you do not have to.

### Concept 2: `errors.Is` answers "is this error the same as that one?"

`errors.Is(err, target)` returns `true` if any error in `err`'s chain equals `target` — using `==` for the equality check unless the error overrides it with a custom `Is` method.

```go
if errors.Is(err, io.EOF) {
    // somewhere down the chain, EOF is present
}
```

You almost always use `Is` to match a **sentinel** error (a known package-level variable). Sentinels are the simplest match: a single value, comparable with `==`.

### Concept 3: `errors.As` answers "is there an error of this type, and can I have it?"

`errors.As(err, &target)` walks the chain looking for an error that is assignable to `*target`. If found, it stores that error into `*target` and returns `true`.

```go
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    fmt.Println("path involved:", pathErr.Path)
}
```

You use `As` to extract a **typed error** so you can read its fields. Sentinels do not have fields; typed errors do (path, status code, original input, line number, …).

### Concept 4: Both walk the chain, both stop on first match

The traversal order is **outer error first**, then `Unwrap()`, then *its* `Unwrap()`, and so on. As soon as a match is found, the walk stops. Both functions return `false` if `err` is `nil`.

### Concept 5: `Is` uses equality; `As` uses assignability

This is the single most important distinction.

| Function | Match rule |
|----------|-----------|
| `errors.Is(err, target)` | An error in the chain is `== target`, **or** that error has an `Is(target) bool` method that returns true. |
| `errors.As(err, &target)` | An error in the chain is assignable to `*target`, **or** that error has an `As(any) bool` method that fills `*target`. |

Equality is symmetric: two values match. Assignability is one-directional: a value of type `*os.PathError` is assignable to a variable of type `*os.PathError` (or to a variable of type `error`, since `*os.PathError` implements `error`).

### Concept 6: `nil` short-circuits

```go
errors.Is(nil, io.EOF)   // false — nothing to compare
errors.Is(io.EOF, nil)   // false — wait, see "tricky points"
errors.As(nil, &target)  // false — same reason
```

A `nil` error never matches anything. (Except, perplexingly, `errors.Is(nil, nil)` is `true`. Almost no one needs that case.)

### Concept 7: `fmt.Errorf("%w", err)` is the gateway

`%w` is the verb that *makes* an error wrap another. Without `%w`, you get a string-formatted error with no chain — `errors.Is` and `errors.As` will not look inside it.

```go
// Wrong: chain is broken
err := fmt.Errorf("loading: %v", io.EOF)
fmt.Println(errors.Is(err, io.EOF)) // false

// Right:
err = fmt.Errorf("loading: %w", io.EOF)
fmt.Println(errors.Is(err, io.EOF)) // true
```

If your team has not switched to `%w`, `Is` and `As` will be useless for that code path.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **`errors.Is`** | Asking "is there a person named Alice in this photo?" — yes/no. |
| **`errors.As`** | Asking "is there an electrician in this photo? Bring them out." — extracts the typed person. |
| **The chain** | A nested package: the courier label is on the outside, the warehouse barcode is one layer in, the manufacturer's note is at the core. |
| **`%w` vs `%v`** | A clear envelope vs an opaque one. `%w` lets you see what is inside; `%v` glues the contents into the description and discards the original. |
| **Sentinel error** | A traffic sign. Always the same; everyone knows it on sight. |
| **Typed error** | A police report — same general shape every time, but the fields (suspect, time, place) are filled in differently per incident. |
| **Custom `Is` method** | A judge who decides that two distinct documents count as "the same case" — equivalence rule chosen by the type. |
| **Custom `As` method** | A translator who can hand you a structured summary of the document, regardless of its original language. |

---

## Mental Models

**The Russian-doll model.** The outermost error is the doll you see. `errors.Is` and `errors.As` open dolls one at a time, comparing against your target, until either a match is found or no more dolls remain.

**The two-question model.**
- *Are these two errors the same thing, conceptually?* — `Is`.
- *Is there a thing of this shape in the chain, and may I have it?* — `As`.

If you cannot phrase your check as one of those two questions, you are probably about to misuse one of them.

**The extraction model.** `Is` returns information by yes/no; `As` returns information by writing through a pointer. The two functions exist because some errors carry no fields you need to read (sentinels), and some carry fields you absolutely do (typed errors).

**The "outer-first" walk.** Both functions visit the outermost error first. If the outermost matches, traversal never reaches the cause. This matters when wrappers themselves implement matching methods.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Lets a caller match a sentinel even after many layers of wrapping. | Both have overhead; `As` allocates more than `Is`. |
| Lets a caller extract a typed error and read its fields. | Many subtle pitfalls: non-pointer `As`, non-comparable `Is`, broken chain via `%v`. |
| Standard library — no external dependency. | Pre-Go-1.13 code does not use them; mixed codebases need migration. |
| Pluggable: types can override matching with `Is(target) bool` or `As(any) bool`. | Override methods can be wrong, infinite-loop, or confuse readers. |
| Multi-error trees in 1.20+ allow joining errors. | Multi-error walks can be O(N) in the number of joined causes. |

### When to use:
- You want the caller to be able to detect a specific known error (sentinel) — use `Is`.
- You want the caller to read fields of a specific error type — use `As`.
- You wrap errors with context (`%w`) and your caller needs to match on the original.

### When NOT to use:
- The error type has no caller-relevant identity (`fmt.Errorf("%v", e)` and a string is enough).
- You only care about the error's *message* — just print it.
- You are inside a tight loop and the match is always the outermost — direct type assertion or `==` is cheaper.

---

## Use Cases

- **Detecting EOF**: `if errors.Is(err, io.EOF) { break }`.
- **Detecting "row not found"**: `if errors.Is(err, sql.ErrNoRows) { return notFound() }`.
- **Detecting "context cancelled"**: `if errors.Is(err, context.Canceled) { ... }`.
- **Reading a path error**: `var pe *os.PathError; if errors.As(err, &pe) { log("path", pe.Path) }`.
- **HTTP status mapping**: extract a typed `APIError` to map to a status code.
- **Retry decisions**: a typed `RetryableError` is extracted with `As`; the loop reads its `RetryAfter` field.

---

## Code Examples

### Example 1: `Is` against a sentinel

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func read() error {
    // Imagine this came from a real I/O call
    return fmt.Errorf("read header: %w", io.EOF)
}

func main() {
    err := read()
    if errors.Is(err, io.EOF) {
        fmt.Println("end of input — clean shutdown")
        return
    }
    fmt.Println("unexpected:", err)
}
```

**What it does:** Wraps `io.EOF` in a context message and recovers it with `errors.Is`. The plain `==` would fail.

### Example 2: `As` to extract a typed error

```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func main() {
    _, err := os.Open("/no/such/file")
    var pe *os.PathError
    if errors.As(err, &pe) {
        fmt.Printf("op=%s path=%s err=%v\n", pe.Op, pe.Path, pe.Err)
    }
}
```

**What it does:** `os.Open` returns a `*os.PathError`. `errors.As` writes that pointer into our local variable so we can read `pe.Path`.

### Example 3: A custom typed error and `As`

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %s", e.Field, e.Message)
}

func validate(s string) error {
    if s == "" {
        return &ValidationError{Field: "name", Message: "required"}
    }
    return nil
}

func main() {
    err := fmt.Errorf("user create: %w", validate(""))

    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("validation: field=%s\n", ve.Field)
    }
}
```

**What it does:** Wraps a typed `*ValidationError` in a context, then extracts it for reading.

### Example 4: Wrapping breaks `==` but not `Is`

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    wrapped := fmt.Errorf("layer1: %w", fmt.Errorf("layer2: %w", io.EOF))

    fmt.Println(wrapped == io.EOF)              // false
    fmt.Println(errors.Is(wrapped, io.EOF))     // true
    fmt.Println(errors.Unwrap(wrapped) == io.EOF) // false (still wrapped one more layer)
}
```

**What it does:** Two layers of wrapping; only `errors.Is` finds the cause.

### Example 5: `As` requires a pointer

```go
package main

import (
    "errors"
    "fmt"
)

type MyErr struct{ X int }

func (m *MyErr) Error() string { return "my error" }

func main() {
    err := &MyErr{X: 7}

    // Correct: pointer to *MyErr
    var got *MyErr
    fmt.Println(errors.As(err, &got)) // true; got.X == 7

    // Wrong: passing the value, not a pointer to it
    // errors.As(err, got) // panics: target must be a non-nil pointer

    // Wrong: pointer to wrong concrete type
    var other *struct{ Y int }
    _ = other
    // errors.As(err, &other) // false — *MyErr is not assignable to *struct{Y int}
}
```

**What it does:** Demonstrates the strict requirement on the second argument: a non-nil pointer to a type that implements `error`.

### Example 6: Multi-error with `errors.Join` (Go 1.20+)

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    err := errors.Join(io.EOF, fmt.Errorf("disk failure"))

    fmt.Println(errors.Is(err, io.EOF))      // true — found in the joined set
    fmt.Println(errors.Is(err, io.ErrClosedPipe)) // false
}
```

**What it does:** `errors.Join` produces an error whose `Unwrap()` returns `[]error`. `errors.Is` knows how to walk that slice.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Match a sentinel with `Is`

```go
if errors.Is(err, sql.ErrNoRows) {
    return ErrUserNotFound
}
```

The most common pattern. Sentinels are package-level `error` variables created with `errors.New`; matching them is what `Is` was made for.

### Pattern 2: Extract a typed error with `As`

```go
var pe *os.PathError
if errors.As(err, &pe) {
    log.Printf("path %q caused %v", pe.Path, pe.Err)
}
```

The other most common pattern. Always declare the target as a typed nil pointer (`var pe *T`).

### Pattern 3: Combine the two

```go
// First check by category, then read fields:
if errors.Is(err, ErrPermission) {
    var pe *os.PathError
    if errors.As(err, &pe) {
        log.Printf("permission denied for %s", pe.Path)
    }
    return
}
```

`Is` for the *what*, `As` for the *details*.

### Pattern 4: Wrap with context using `%w`

```go
if err := loadConfig(); err != nil {
    return fmt.Errorf("startup: %w", err)
}
```

If you do not wrap with `%w`, the chain is broken at this point. `Is` and `As` will not see past it.

### Pattern 5: Define a sentinel for your package

```go
var ErrNotFound = errors.New("not found")

// Callers do:
if errors.Is(err, mypkg.ErrNotFound) { ... }
```

A single, exported sentinel that callers can match on. This is how `io.EOF`, `sql.ErrNoRows`, and `context.Canceled` are defined.

### Pattern 6: Define a typed error for your package

```go
type APIError struct {
    Status int
    Body   string
}

func (e *APIError) Error() string {
    return fmt.Sprintf("api error %d: %s", e.Status, e.Body)
}

// Callers do:
var ae *mypkg.APIError
if errors.As(err, &ae) { ... }
```

A typed error gives the caller actionable fields. Always implement `Error()` on the pointer receiver so the zero value of the variable is a typed nil.

---

## Clean Code

- Prefer `errors.Is` over `==` for any error you might wrap. It costs almost nothing extra and survives future wrapping.
- Use `errors.As` whenever you need a field off the error. Never type-assert manually after wrapping; the assertion will fail on the wrapper.
- Keep sentinel errors short and stable. Once exported, they are part of your API.
- Wrap with `%w` consistently. Mixing `%v` and `%w` in the same package leads to surprising "why isn't `Is` working?" bugs.
- Do not implement `Is` or `As` on a type unless you genuinely need custom matching. The default behavior is usually what you want.

---

## Product Use / Feature

In a typical Go service the patterns look like:

```go
// HTTP handler — translate domain errors to status codes
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
    user, err := h.svc.Get(r.Context(), id)
    switch {
    case errors.Is(err, ErrUserNotFound):
        http.Error(w, "not found", http.StatusNotFound)
    case errors.Is(err, context.DeadlineExceeded):
        http.Error(w, "timeout", http.StatusGatewayTimeout)
    case err != nil:
        var ve *ValidationError
        if errors.As(err, &ve) {
            http.Error(w, ve.Error(), http.StatusBadRequest)
            return
        }
        http.Error(w, "internal", http.StatusInternalServerError)
    default:
        json.NewEncoder(w).Encode(user)
    }
}
```

```go
// Retry loop using `As` to read backoff
func withRetry(fn func() error) error {
    for attempt := 0; attempt < 5; attempt++ {
        err := fn()
        var re *RetryableError
        if errors.As(err, &re) {
            time.Sleep(re.RetryAfter)
            continue
        }
        return err
    }
    return errors.New("retries exhausted")
}
```

---

## Error Handling

- Every error passed to `errors.Is` or `errors.As` may be `nil`. Both functions handle `nil` safely (return `false`); you do not need to pre-check.
- Both stop on first match. If your chain has two equivalent errors, only the outermost is reported.
- `errors.As` panics if the second argument is not a non-nil pointer to either an interface type or a concrete type implementing `error`. Always pass `&local`.
- `errors.Is` does *not* panic when the target is nil; it just returns false (unless `err` is also nil — which returns true; almost never useful).

---

## Security Considerations

- Avoid using `errors.Is` against secrets you do not want leaked. The function returns true/false; it does not leak the value. But debug logs that print both can.
- A custom `Is` method runs arbitrary user code while walking the chain. If the chain is constructed from untrusted input, a malicious `Is` could panic or hang. In practice this is rare, but it is the right answer to "is `errors.Is` a sandbox?" — it is not.
- An `As` method that copies internal data into the target may leak fields the package authors did not intend to expose. Define `As` carefully on types that hold sensitive data.

---

## Performance Tips

- `errors.Is` is a few pointer comparisons per chain link. Cheap.
- `errors.As` does a `reflect.Value.Elem()` and an assignability check per chain link. More expensive than `Is`, but still nanosecond-scale.
- Multi-error trees (`errors.Join`) make the walk O(total errors). Joining 1000 errors and calling `Is` is 1000 comparisons.
- A custom `Is` method that itself calls `errors.Is` recursively can cause exponential walk costs. Be careful.
- Avoid repeated `errors.As` on the same error in a tight loop. Cache the extracted value.

(For deeper benchmarks and allocation analysis, see `optimize.md` and `professional.md`.)

---

## Best Practices

- **Always wrap with `%w`** if you want `Is`/`As` to find the cause.
- **Use `Is` for sentinels, `As` for typed errors** — this is the rule of thumb.
- **Never type-assert past a wrap**. `wrapped.(*MyErr)` returns false if `wrapped` is `*fmt.wrapError` containing a `*MyErr`.
- **Declare typed targets with the right pointer level.** `var pe *os.PathError` (not `pe os.PathError`).
- **Document sentinels and typed errors** in your package — they are part of the API.
- **Test that wrapping preserves matchability** — a one-line unit test (`errors.Is(wrapErr, sentinel) == true`) catches future regressions.

---

## Edge Cases & Pitfalls

- **Non-comparable target**: `errors.Is(err, slice)` (where `slice` is a slice type used as a sentinel) panics inside the equality check, because slices are not comparable. Sentinels must be comparable.
- **Nil concrete type wrapped in interface**: `var p *MyErr = nil; var e error = p; errors.Is(e, p)` is true — the comparison passes — but the error is "not really" useful. Beware the typed-nil trap.
- **`As` with `**Type` (double pointer)** does not match a `*Type` error. `As` looks for assignability to `*Type`, not `**Type`.
- **Custom `Is` returning true unconditionally** silently masks real errors. Reviewers should look hard at any `func (e *T) Is(target error) bool` body.
- **`errors.Join(nil, nil)` returns nil**, not a wrapper. Easy to forget when chaining join calls.
- **Infinite chain**: a buggy `Unwrap` that returns the same error or cycles produces an infinite loop. Both `Is` and `As` will hang.

---

## Common Mistakes

1. **Using `%v` when you meant `%w`.** `fmt.Errorf("op: %v", err)` discards the chain.
2. **Comparing wrapped errors with `==`.** `wrapped == io.EOF` is false; use `errors.Is`.
3. **Type-asserting past a wrap.** `if pe, ok := wrappedErr.(*os.PathError); ok` fails after `fmt.Errorf("%w", ...)`. Use `errors.As`.
4. **Passing a value to `As`.** `errors.As(err, target)` instead of `errors.As(err, &target)`. Panics.
5. **Passing a nil pointer to `As`.** `var pe *MyErr; errors.As(err, pe)` instead of `&pe`. Panics.
6. **Using a non-comparable sentinel.** Using a struct with a slice field as a sentinel breaks `==` and panics inside `errors.Is`.
7. **Forgetting `Unwrap` on a custom error type.** Without `Unwrap`, your wrapper hides the cause from `Is`/`As`.

---

## Common Misconceptions

- **"`Is` and `As` only work on errors created with `fmt.Errorf`."** False — they work on any error with an `Unwrap()` method. `fmt.Errorf("%w", ...)` is just one way to make one.
- **"`As` returns the error."** It does not — it writes to the pointer. The return is just a bool.
- **"`Is` checks the message."** It does not — it checks identity (or the custom `Is` method).
- **"Wrapping is a stack trace."** It is not. Wrapping carries cause; stack traces carry location. Different things.
- **"`errors.Is` and `==` are the same when there is no wrap."** Almost — but `Is` also calls a custom `Is(target) bool` if defined. Direct `==` does not.
- **"`As` works for any pointer."** Only for pointers to types implementing `error`, or pointers to interface types containing `error`.

---

## Tricky Points

- **Custom `Is(target) bool`**: a type can declare its own equality rule:
  ```go
  func (e *MyErr) Is(target error) bool { return target == ErrFoo || target == ErrBar }
  ```
  Both calls `errors.Is(myerr, ErrFoo)` and `errors.Is(myerr, ErrBar)` then return true.

- **Custom `As(target any) bool`**: a type can fill in the target itself, e.g., to expose a derived value rather than itself.

- **Multi-error post Go 1.20**: `Unwrap() []error` is walked depth-first, pre-order. The first match wins.

- **`errors.Is` walks before checking equality**: the *outer* error is checked first, then unwrapped. If you implement `Is` on a *wrapper* that returns true unconditionally, you mask all inner sentinels.

---

## Test

```go
package errpkg

import (
    "errors"
    "fmt"
    "io"
    "testing"
)

func TestWrapPreservesIs(t *testing.T) {
    err := fmt.Errorf("ctx: %w", io.EOF)
    if !errors.Is(err, io.EOF) {
        t.Fatalf("expected wrapped error to match io.EOF; got %v", err)
    }
}

type myErr struct{ code int }

func (e *myErr) Error() string { return "my error" }

func TestAsExtractsType(t *testing.T) {
    err := fmt.Errorf("op: %w", &myErr{code: 42})
    var got *myErr
    if !errors.As(err, &got) {
        t.Fatalf("As did not match")
    }
    if got.code != 42 {
        t.Fatalf("got code %d; want 42", got.code)
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What is the difference between `errors.Is` and `==`?*
   `==` compares the outer value only. `errors.Is` walks the chain and also calls a custom `Is(target) bool` method if defined.

2. *Why does `errors.As` need a pointer?*
   So it can write the matched error into your variable. Returning the error would lose the type information.

3. *What happens if the second argument to `errors.As` is `nil`?*
   It panics: `errors.As: target must be a non-nil pointer`.

4. *Why doesn't `errors.Is` panic on a nil target?*
   It returns false (unless `err` is also nil; then it returns true).

5. *How does `errors.Is` interact with `errors.Join`?*
   `errors.Join(...)` produces an error whose `Unwrap()` returns `[]error`. `errors.Is` walks each element depth-first.

6. *Do `Is` and `As` look at the error message?*
   No. They look at identity (`==`), assignability (`reflect`), or your custom `Is`/`As` methods.

---

## Cheat Sheet

```go
// Match a sentinel
if errors.Is(err, io.EOF) { ... }

// Extract a typed error
var pe *os.PathError
if errors.As(err, &pe) { use(pe.Path) }

// Wrap with context
return fmt.Errorf("doing X: %w", err)

// Join several errors (Go 1.20+)
err := errors.Join(err1, err2, err3)

// Walk the chain manually (rare)
for e := err; e != nil; e = errors.Unwrap(e) {
    // ...
}

// Define a sentinel
var ErrNotFound = errors.New("not found")

// Define a typed error
type APIError struct{ Status int; Body string }
func (e *APIError) Error() string { return ... }
```

| Need | Function |
|------|----------|
| Match a known specific error | `errors.Is` |
| Extract fields from a typed error | `errors.As` |
| Combine multiple errors into one | `errors.Join` |
| Make an error wrappable | use `%w` in `fmt.Errorf` |

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence each what `errors.Is` and `errors.As` do.
- [ ] I know the rule of thumb: `Is` for sentinels, `As` for typed errors.
- [ ] I always use `%w` (not `%v`) when I want `Is`/`As` to see through my wrap.
- [ ] I always pass `&local` (a non-nil pointer) to `errors.As`.
- [ ] I declare the target variable as `var x *T`, not `var x T`.
- [ ] I know `errors.Join` and that its `Unwrap` returns `[]error`.
- [ ] I know that a custom `Is(target error) bool` method overrides the default `==` check.
- [ ] I avoid type-asserting past a wrap; I use `As` instead.

---

## Summary

`errors.Is` and `errors.As` are the two functions that make wrapped errors useful. `Is` answers "is this error the one I am looking for?" — equality through the chain, with optional custom `Is` method. `As` answers "is there an error of this type, and may I have it?" — assignability through the chain, with optional custom `As` method. Use `%w` to wrap, use `Is` for sentinels, use `As` for typed errors with fields, and never type-assert past a wrap.

---

## What You Can Build

- A small CLI that classifies errors from `os.Open`, `net.Dial`, and `json.Unmarshal` and prints "kind: typed | sentinel | unknown" using `Is` and `As`.
- A package that defines a sentinel `ErrNotFound` and a typed `APIError`, and write tests that show `Is` and `As` find them through three layers of wrapping.
- An HTTP middleware that translates a small set of `errors.Is` matches into status codes.
- A retry helper that uses `errors.As` to read a `RetryAfter` field off a typed error.

---

## Further Reading

- [Package errors](https://pkg.go.dev/errors) — Go standard library reference
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) — the original blog post introducing `Is` / `As` / `%w`
- [Wrapping errors with %w](https://pkg.go.dev/fmt#Errorf) — `fmt.Errorf` doc
- [`errors.Join`](https://pkg.go.dev/errors#Join) — Go 1.20+ multi-errors
- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)

---

## Related Topics

- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w` and the chain
- [10-custom-error-types](../10-custom-error-types/junior.md) — typed errors that pair with `As`
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — package-level error variables that pair with `Is`
- [12-error-design-best-practices](../12-error-design-best-practices/junior.md) — designing error families that read well with `Is`

---

## Diagrams & Visual Aids

```
fmt.Errorf("startup: %w",
    fmt.Errorf("config: %w",
        io.EOF))

chain (outer first):
+--------------------------+   "startup: config: EOF"
| outer error              |
+--------------------------+
            | Unwrap()
            v
+--------------------------+   "config: EOF"
| middle error             |
+--------------------------+
            | Unwrap()
            v
+--------------------------+   io.EOF
| inner error              |
+--------------------------+
            | Unwrap()
            v
           nil
```

```
errors.Is(err, target):
  for e in chain(err):
      if e == target: return true       // equality
      if e has Is(target) bool method:
          if e.Is(target): return true  // custom rule
  return false

errors.As(err, &target):
  for e in chain(err):
      if e is assignable to *target:
          *target = e
          return true                   // assignability
      if e has As(target any) bool method:
          if e.As(target): return true  // custom rule
  return false
```

```
errors.Join(a, b, c)  ->  an error with Unwrap() []error -> [a, b, c]

  Walk order for errors.Is(joined, x):
     joined  -> a (not match) -> a's chain -> b (not match) -> b's chain -> ...
     pre-order DFS; first match wins.
```

```
ASCII decision tree:

    +-------------------------------+
    | Have an error, want to react. |
    +-------------------------------+
                  |
        Need fields off it?
        /                \
      yes                 no
       |                   |
   errors.As           errors.Is
   var x *T             vs sentinel
   if errors.As(...){ } if errors.Is(...){ }
```
