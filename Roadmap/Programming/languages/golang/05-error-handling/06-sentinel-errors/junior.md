# Sentinel Errors — Junior Level

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
> Focus: "What is a sentinel error?" and "How do I use one?"

When you read from a file in Go and reach the end, the standard library returns a very specific error: `io.EOF`. It is not "end of file detected" or "stream finished" — it is **the** value `io.EOF`, declared once in the `io` package, and you compare against it directly.

```go
for {
    line, err := reader.ReadString('\n')
    if err == io.EOF {
        break          // expected end of input
    }
    if err != nil {
        return err     // a real failure
    }
    process(line)
}
```

That `io.EOF` is a **sentinel error** — a known, named error value that the package promises to return for a specific condition. Sentinels are the simplest way for a function to say "this kind of failure happened, you can react to it specifically."

After reading this file you will:
- Understand what a sentinel error is and why it exists
- Know how to declare one with `var ErrFoo = errors.New("foo")`
- Recognize famous sentinels: `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`
- Know how to compare against them safely with `errors.Is`
- Understand why `==` is fragile and when it still works
- Be able to design your own small set of sentinels for a package

---

## Prerequisites

- **Required:** [Error handling basics](../01-error-handling-basics/junior.md) — the `error` interface and the `if err != nil` idiom.
- **Required:** Knowledge that `errors.New("text")` returns an `error` value.
- **Required:** Understanding of package-level variables — `var X = ...` at the top of a file.
- **Helpful:** Familiarity with `io.Reader`, `os.Open`, and other stdlib functions that return errors. We will use them as examples.
- **Helpful (preview):** Awareness that `errors.Is` and `%w` exist (covered fully in [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md)).

---

## Glossary

| Term | Definition |
|------|-----------|
| **sentinel error** | A package-level error variable used as a named marker for a specific failure condition. |
| **package-level variable** | A `var` declared at the top of a file, outside any function. Lives for the program's lifetime. |
| **`io.EOF`** | The canonical sentinel: the value returned by readers when there is nothing left to read. |
| **`errors.Is`** | The function for safely comparing an error against a sentinel, even when wrapped. |
| **`==` comparison** | Direct interface equality. Works for unwrapped sentinels but breaks once anyone wraps. |
| **wrapping** | Adding context with `fmt.Errorf("...: %w", err)`. The wrapped chain preserves identity. |
| **typed error** | An alternative to sentinels — an error that is a struct with fields, identified by type. |
| **error kind** | A small enum field on a struct to express many related conditions in one type. |
| **API contract** | The promise a package makes about its observable behavior, including which errors it returns. |

---

## Core Concepts

### Concept 1: A sentinel is just a variable

The shock for newcomers: a sentinel error is *not* a special kind of error. It is an ordinary `error` value, declared once, referred to by name.

```go
package mypkg

import "errors"

var ErrNotFound = errors.New("not found")
```

That single line creates the sentinel. Now any code in `mypkg` (or anyone importing `mypkg`) can return `mypkg.ErrNotFound` to signal "the thing was not found", and any caller can recognize it.

### Concept 2: It is a singleton

Every call to `find()` that fails with "not found" returns the *same* `ErrNotFound` value. Not a copy — the literal same pointer. That is what makes equality comparison meaningful: a sentinel has *identity*.

```go
err1 := find(1)        // returns ErrNotFound
err2 := find(2)        // returns ErrNotFound
err1 == err2           // true — same pointer
err1 == ErrNotFound    // true
```

### Concept 3: The naming convention is `Err…`

Go packages name sentinels with the prefix `Err`:

```go
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrInvalidInput  = errors.New("invalid input")
)
```

The `Err` prefix tells readers immediately: this is an error variable. The standard library follows it religiously: `io.EOF` is the only major exception, kept for historical reasons.

### Concept 4: The `errors.Is` comparison

To check whether an error matches a sentinel, use `errors.Is`:

```go
if errors.Is(err, mypkg.ErrNotFound) {
    // handle the "not found" case
}
```

`errors.Is` walks the wrap chain so it works even after `fmt.Errorf("...: %w", ErrNotFound)`. Plain `==` breaks the moment someone wraps the error. Always prefer `errors.Is` in new code.

### Concept 5: `io.EOF` is the prototype

The most copied sentinel in Go is `io.EOF`:

```go
// from $GOROOT/src/io/io.go (paraphrased)
var EOF = errors.New("EOF")
```

When a `Reader` reaches end of input, it returns `io.EOF`. Callers are *expected* to check for it specifically because end-of-stream is not a "failure" — it is a normal outcome of reading. Without a sentinel, the caller would have to string-match the message.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Sentinel error** | A traffic-light color: there is *one* "red" everyone agrees on. You do not invent new shades; you check `light == Red`. |
| **`io.EOF`** | The "out of paper" indicator on a printer. Not a malfunction — just a known condition with a specific signal. |
| **`errors.Is`** | A magnifying glass for inspecting layered packages: "is `Red` somewhere in this stack?" instead of just checking the top sticker. |
| **`==` on a wrapped error** | Looking only at the outermost label of a stack of nested boxes. The inner box might be the one you want, but you cannot see it. |
| **Naming convention `Err…`** | Hospital signs that always start with the same color so nurses recognize "warning" instantly. |

---

## Mental Models

**The intuition:** A sentinel is a *postage stamp*. The function sticks a known stamp on the envelope (returns the sentinel value) so the receiver can sort the mail by stamp without reading the letter inside.

**Why this model helps:** It separates "what kind of failure" (the stamp) from "the long story" (the message). Comparison is identity, not content. You do not have to guess at the wording.

**The second intuition:** A sentinel is the smallest possible *enum value* in Go. Languages like Rust use enum variants for this. Go does not have enums for errors, so package-level variables play the role.

**The third intuition:** Think of `io.EOF` as a *whitelist token*. The reader returns it only on the one condition it documents. If you see it, you know exactly what happened.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Trivial to declare — one line per sentinel. | Creates tight coupling: callers depend on your specific variable. |
| Cheap at runtime — no allocation per use, just a pointer. | Once exported, renaming is a breaking API change. |
| Easy to test — `errors.Is` makes assertions clean. | No structured data — cannot carry fields like `Path` or `Line`. |
| Self-documenting — reading `io.EOF` tells you exactly what condition fires. | Sentinels proliferate if you do not curate them. |
| Compose with wrapping — `fmt.Errorf("...: %w", ErrFoo)` keeps identity. | Wrong tool for "many similar failures" — use a typed error or kind enum. |
| Standard library uses them, so they look familiar to all Go programmers. | New developers reach for `==` out of habit, breaking under wrapping. |

### When to use:
- A small, fixed set of distinct conditions a caller might want to react to.
- Conditions that are *expected*, not exceptional (`io.EOF`, `sql.ErrNoRows`).
- When you want zero-allocation error returns from a hot path.

### When NOT to use:
- When you need to carry data (path, line number, field name) — use a typed error.
- When you have dozens of variants — use an `error kind` enum on a struct.
- When the caller does not need to react differently — return a plain `errors.New(...)`.

---

## Use Cases

- **End-of-stream signals** — `io.EOF`, `bufio.ErrBufferFull`.
- **Not-found queries** — `sql.ErrNoRows`, `os.ErrNotExist`.
- **Permission denials** — `os.ErrPermission`.
- **Cancellation/timeout** — `context.Canceled`, `context.DeadlineExceeded`.
- **Closed connections** — `net.ErrClosed`, `io.ErrClosedPipe`.
- **Custom domain markers** — `ErrInsufficientFunds`, `ErrEmailTaken`.

---

## Code Examples

### Example 1: Declaring and returning a sentinel

```go
package main

import (
    "errors"
    "fmt"
)

var ErrEmpty = errors.New("empty input")

func first(items []int) (int, error) {
    if len(items) == 0 {
        return 0, ErrEmpty
    }
    return items[0], nil
}

func main() {
    _, err := first(nil)
    if errors.Is(err, ErrEmpty) {
        fmt.Println("the slice was empty")
    }
}
```

**What it does:** Declares a sentinel `ErrEmpty`, returns it from `first` when the slice is empty, and compares with `errors.Is` at the call site.
**How to run:** `go run main.go`

### Example 2: The `io.EOF` loop

```go
package main

import (
    "bufio"
    "errors"
    "fmt"
    "io"
    "strings"
)

func main() {
    r := bufio.NewReader(strings.NewReader("alpha\nbeta\n"))
    for {
        line, err := r.ReadString('\n')
        if line != "" {
            fmt.Print("read: ", line)
        }
        if errors.Is(err, io.EOF) {
            break
        }
        if err != nil {
            fmt.Println("error:", err)
            return
        }
    }
    fmt.Println("done")
}
```

**What it does:** Reads lines until the reader signals `io.EOF`. Notice `line != ""` — readers may return *both* a partial line and `io.EOF` on the last chunk.

### Example 3: Comparing without wrapping (legacy)

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func find(id int) error {
    return ErrNotFound
}

func main() {
    err := find(7)
    if err == ErrNotFound {
        fmt.Println("matched with ==")
    }
    if errors.Is(err, ErrNotFound) {
        fmt.Println("matched with errors.Is")
    }
}
```

**What it does:** Both `==` and `errors.Is` work because the error is *not wrapped*. The `==` comparison is legacy-correct here but fragile — see Example 4.

### Example 4: Why `==` breaks under wrapping

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func find(id int) error {
    return fmt.Errorf("find user %d: %w", id, ErrNotFound)
}

func main() {
    err := find(7)
    if err == ErrNotFound {
        fmt.Println("== matched (will not print)")
    }
    if errors.Is(err, ErrNotFound) {
        fmt.Println("errors.Is matched (this is what you want)")
    }
}
```

**What it does:** Demonstrates the trap. The wrapped error is *not* the sentinel — it is a `*fmt.wrapError` whose `Unwrap()` returns the sentinel. `==` compares the outer pointer; `errors.Is` walks the chain.

### Example 5: A small set of domain sentinels

```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrInvalidInput = errors.New("invalid input")
    ErrUnauthorized = errors.New("unauthorized")
    ErrConflict     = errors.New("conflict")
)

func transfer(from, to string, amount int) error {
    if amount <= 0 {
        return ErrInvalidInput
    }
    if from == to {
        return ErrConflict
    }
    if from == "guest" {
        return ErrUnauthorized
    }
    return nil
}

func main() {
    err := transfer("guest", "alice", 100)
    switch {
    case errors.Is(err, ErrInvalidInput):
        fmt.Println("400 Bad Request")
    case errors.Is(err, ErrUnauthorized):
        fmt.Println("401 Unauthorized")
    case errors.Is(err, ErrConflict):
        fmt.Println("409 Conflict")
    case err != nil:
        fmt.Println("500 Internal")
    default:
        fmt.Println("OK")
    }
}
```

**What it does:** Shows a tiny error vocabulary used to map domain failures to HTTP statuses. The same vocabulary is reusable across many functions in the package.

---

## Coding Patterns

### Pattern 1: Group sentinels in one block

```go
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrInvalidInput  = errors.New("invalid input")
)
```

Keep all sentinels for a package in one `var (...)` block at the top of a file (often `errors.go`). It is a one-stop reference for callers.

### Pattern 2: Wrap the sentinel for context

```go
if !exists(id) {
    return fmt.Errorf("user %d: %w", id, ErrNotFound)
}
```

Wrapping with `%w` adds context (`user 7: not found`) but preserves the sentinel for `errors.Is`. Best of both.

### Pattern 3: Detect with `errors.Is`

```go
if errors.Is(err, ErrNotFound) {
    // handle the "not found" case
}
```

The mechanically-correct check. Works whether the error is a bare sentinel or wrapped at any depth.

### Pattern 4: Switch on multiple sentinels

```go
switch {
case errors.Is(err, ErrA):
case errors.Is(err, ErrB):
case errors.Is(err, ErrC):
default:
}
```

Used when several distinct outcomes need different reactions. Cleaner than nested `if`.

### Pattern 5: Sentinel vs success branching

```go
n, err := r.Read(buf)
if errors.Is(err, io.EOF) {
    // success-equivalent: nothing more to read
    return processed
}
if err != nil {
    return fmt.Errorf("read: %w", err)
}
```

Some sentinels are *not failures* — `io.EOF` is the canonical example. Treat them as a success-shaped outcome.

---

## Clean Code

- Name sentinels `Err…`. The standard library does. Readers expect it.
- Keep error messages lowercase, no trailing punctuation: `errors.New("not found")` — not `errors.New("Not found.")`.
- Group sentinels at the top of a single file. Easier to find, easier to enumerate.
- Document the *meaning* of each sentinel in a comment:
  ```go
  // ErrNotFound is returned by Get when no record matches the given id.
  var ErrNotFound = errors.New("not found")
  ```
- Do not export every sentinel. If a sentinel is internal-only, lowercase it: `var errCacheMiss = errors.New("cache miss")`.
- Prefer `errors.Is` to `==` even for unwrapped errors. The cost is the same; the resilience is higher.

---

## Product Use / Feature

A small e-commerce service might define:

```go
package orders

import "errors"

var (
    ErrOrderNotFound       = errors.New("order not found")
    ErrInsufficientStock   = errors.New("insufficient stock")
    ErrAlreadyPaid         = errors.New("already paid")
    ErrPaymentDeclined     = errors.New("payment declined")
)

func (s *Service) Place(o Order) error {
    if !s.inStock(o) {
        return ErrInsufficientStock
    }
    if err := s.charge(o); err != nil {
        return fmt.Errorf("charge order %s: %w", o.ID, err)
    }
    return nil
}
```

The HTTP handler then translates:

```go
switch {
case errors.Is(err, orders.ErrOrderNotFound):
    http.Error(w, "not found", 404)
case errors.Is(err, orders.ErrInsufficientStock):
    http.Error(w, "out of stock", 409)
case errors.Is(err, orders.ErrPaymentDeclined):
    http.Error(w, "payment declined", 402)
default:
    http.Error(w, "internal error", 500)
}
```

A four-sentinel vocabulary covers all the user-actionable outcomes.

---

## Error Handling

This entire topic *is* about error handling, but the meta-rules:

- A sentinel says *what* failed; it does not say *what to do*. The caller decides.
- Wrap a sentinel with `%w` when adding context; do not concatenate strings.
- Do not return a *new* `errors.New("not found")` every time — define the sentinel once, return it many times.
- Compare with `errors.Is`, not `==`, even when you "know" no one wraps. Today they do not; tomorrow someone will.

---

## Security Considerations

- **Sentinel messages are public.** Whatever you put in `errors.New("...")` ends up in `.Error()` output, which may flow to logs, alerts, or even API responses. Keep messages free of secrets.
- **Sentinel identity is global.** Two binaries that import your package both have the same `ErrNotFound`. If you also embed the package in a plugin loaded at runtime, watch out: dynamic linking can produce a *different* sentinel pointer with the same name, and `errors.Is` will fail. (Rare in pure Go; common with cgo plugins.)
- **Do not leak existence via sentinel choice.** If `ErrUserNotFound` and `ErrInvalidPassword` are distinguishable to the outside, you tell attackers which usernames exist. Translate to a single generic message at the API boundary.

---

## Performance Tips

- A sentinel allocates *once* at program init. Returning it from a function costs zero allocations.
- `errors.Is` on a non-wrapped sentinel is two comparisons and a method-table lookup — single-digit nanoseconds.
- For a *hot* error path (millions of calls per second), sentinels are the cheapest possible error return.
- Wrapping with `fmt.Errorf("...: %w", ErrFoo)` allocates a wrapper struct and a formatted message. Use it where the context helps; skip it in tight inner loops.
- Avoid creating a new `errors.New("not found")` *inside* a function — that is a per-call allocation. Pull it up to package scope.

---

## Best Practices

- **Always export sentinels with the `Err` prefix.** Convention.
- **Compare with `errors.Is`, not `==`.** Defensive against future wrapping.
- **Wrap with `%w` when adding context.** Preserves identity.
- **Document each sentinel.** A comment explaining when it is returned saves the next reader hours.
- **Curate the set.** Five sentinels is a vocabulary. Fifty is a dictionary no one reads. Use typed errors / kinds for many variants.
- **Keep messages stable.** Once exported, the message becomes part of your contract.
- **Treat `nil` as success.** Do not invent `var ErrSuccess = errors.New("ok")`.

---

## Edge Cases & Pitfalls

- **`errors.Is(nil, ErrFoo)` is false.** A nil error matches no sentinel.
- **`errors.Is(ErrFoo, nil)` is false.** A non-nil error does not match nil.
- **A `%v` wrap loses identity.** `fmt.Errorf("ctx: %v", ErrFoo)` flattens the chain — `errors.Is` will not find `ErrFoo` afterwards. Use `%w`.
- **Sentinel from a vendored copy.** If two import paths both bring in your package as separate copies (rare with modules, common with vendoring mistakes), the two `ErrFoo` values are different pointers and never match.
- **Comparing two errors with `==` when both could be wrapped.** Always false unless both are bare. Use `errors.Is`.

---

## Common Mistakes

1. **`if err.Error() == "not found"`** — string comparison, brittle and breaks on locale or wrapping.
2. **`var ErrFoo = errors.New("Foo!")`** — capitalized, with punctuation. Breaks the convention.
3. **Returning `errors.New("not found")` directly** instead of `ErrNotFound`. Each call allocates; identity comparison fails.
4. **Wrapping with `%v`** — `fmt.Errorf("op: %v", ErrFoo)` loses the sentinel. Use `%w`.
5. **Forgetting that `io.EOF` is not an error condition.** Treating it as a 500 in an HTTP handler is wrong.
6. **Defining a sentinel inside a function** instead of at package scope. The function-local `errors.New` allocates per call.
7. **Defining 30 sentinels.** That many usually means you wanted typed errors with a kind field, not sentinels.
8. **Comparing sentinels from different packages.** `pkg1.ErrNotFound != pkg2.ErrNotFound` always.

---

## Common Misconceptions

- **"Sentinels are special errors."** They are not. They are ordinary error values exported by name.
- **"`io.EOF` is a failure."** It is the *expected* end-of-input signal. Treat it as success-equivalent for the loop.
- **"Sentinels are slower than other errors."** They are the fastest — zero-allocation per call.
- **"`==` works as long as I don't use `%w`."** It works *today*. Tomorrow a teammate adds wrapping and your check silently breaks. Use `errors.Is` from day one.
- **"Sentinels are bad."** They have trade-offs. The famous Dave Cheney post argues *against overuse*, not against existence — the standard library uses them everywhere.

---

## Tricky Points

- **`io.EOF` vs `io.ErrUnexpectedEOF`.** `EOF` says "stream ended at a valid boundary." `ErrUnexpectedEOF` says "stream ended in the middle of something." They look similar, mean different things.
- **Sentinels with custom `Is`.** A sentinel is just a value, but a *typed* error can implement `Is(target error) bool` to broaden matching. Different topic; surfaces in 5.5.
- **`errors.Is(err, target)` matches *anywhere in the chain*.** It is not "is the outermost error this" — it is "is *any* unwrapped layer this."
- **`fs.ErrNotExist` vs `os.ErrNotExist`.** Same value (alias). The standard library re-exports across packages so you can match against either.

---

## Test

```go
package main

import (
    "errors"
    "testing"
)

var ErrNotFound = errors.New("not found")

func find(id int) error {
    if id == 0 {
        return ErrNotFound
    }
    return nil
}

func TestFind_NotFound(t *testing.T) {
    err := find(0)
    if !errors.Is(err, ErrNotFound) {
        t.Fatalf("got %v, want ErrNotFound", err)
    }
}

func TestFind_OK(t *testing.T) {
    if err := find(1); err != nil {
        t.Fatalf("got %v, want nil", err)
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What is a sentinel error?*
   A package-level error variable used as a known marker for a specific failure condition.

2. *Why use `errors.Is` instead of `==`?*
   `errors.Is` walks the wrap chain. `==` only checks the outermost pointer; it breaks once anyone wraps the error with `%w`.

3. *Is `io.EOF` a failure?*
   No. It signals the expected end of a stream. Code should treat it as a normal loop terminator.

4. *Can a sentinel carry data?*
   No. Use a typed error if you need fields like `Path` or `Line`.

5. *Why is the prefix `Err`?*
   Convention. Every Go programmer recognizes `ErrFoo` immediately as a sentinel.

6. *Can I define a sentinel inside a function?*
   You can, but you should not. Each call allocates a fresh `*errorString`, identity comparison fails, and the sentinel is invisible to other callers.

---

## Cheat Sheet

```go
// Declare
var ErrNotFound = errors.New("not found")

// Return
return ErrNotFound
return fmt.Errorf("user %d: %w", id, ErrNotFound)

// Detect
if errors.Is(err, ErrNotFound) { /* handle */ }

// Multiple
switch {
case errors.Is(err, ErrA):
case errors.Is(err, ErrB):
}

// Famous stdlib sentinels
io.EOF
io.ErrUnexpectedEOF
sql.ErrNoRows
os.ErrNotExist
os.ErrPermission
context.Canceled
context.DeadlineExceeded
```

---

## Self-Assessment Checklist

- [ ] I can declare a sentinel error.
- [ ] I know why the prefix is `Err`.
- [ ] I can return a sentinel from a function.
- [ ] I can compare an error against a sentinel with `errors.Is`.
- [ ] I know why `==` is fragile.
- [ ] I recognize `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`.
- [ ] I can wrap a sentinel with `%w` and still match it with `errors.Is`.
- [ ] I do not invent a sentinel per call inside a function.

---

## Summary

A *sentinel error* is a package-level error variable used as a named marker. Declare with `var ErrFoo = errors.New("foo")`, return as `ErrFoo` or wrapped with `%w`, detect with `errors.Is`. The standard library uses them everywhere — `io.EOF` is the prototype. They are the simplest, cheapest, and oldest tool in Go's error vocabulary; their main trade-off is the API coupling that comes from exporting them.

---

## What You Can Build

- A small package with three or four sentinels mapping to HTTP status codes.
- A line-by-line file reader that uses `io.EOF` as the loop terminator.
- A lookup function that returns `ErrNotFound` (wrapped with the key) for missing keys.
- A retry helper that distinguishes a transient sentinel (retryable) from a permanent one (give up).

---

## Further Reading

- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [The Go Blog: Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — the influential critique of sentinel overuse.
- Source: `$GOROOT/src/io/io.go` — definition of `EOF` and `ErrUnexpectedEOF`.
- Source: `$GOROOT/src/database/sql/sql.go` — `ErrNoRows`, `ErrTxDone`.
- Source: `$GOROOT/src/os/error.go` — `ErrNotExist`, `ErrPermission`.

---

## Related Topics

- [01-error-handling-basics](../01-error-handling-basics/junior.md) — the foundation
- [02-error-interface](../02-error-interface/junior.md) — what an error is
- 03-creating-custom-errors — typed errors as the alternative
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w`, `errors.Is`, `errors.As`
- [07-panic-and-recover](../07-panic-and-recover/junior.md) — the other failure mechanism

---

## Diagrams & Visual Aids

```
   package mypkg
   ----------------
   var ErrNotFound = errors.New("not found")  <-- ONE value, package-level
                          |
                          | (returned by many functions)
                          v
   func Get(id) error  ---+--> ErrNotFound
   func Find(k) error  ---+--> ErrNotFound
   func Lookup() error ---+--> ErrNotFound

   caller:
       err := Get(7)
       if errors.Is(err, mypkg.ErrNotFound) { ... }
```

```
   Wrapping preserves identity
   ---------------------------
   err = ErrNotFound

   wrapped = fmt.Errorf("user 7: %w", err)

       wrapped --[Unwrap()]--> err --[==]--> ErrNotFound
                                            ^
                                            |
                              errors.Is finds it here
```

```
   == vs errors.Is
   ---------------
   bare:    err == ErrFoo            true
   wrapped: err == ErrFoo            false   <-- the trap
            errors.Is(err, ErrFoo)   true
```
