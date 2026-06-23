# fmt.Errorf — Junior Level

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
> Focus: "How do I create an error with a formatted message?"

You already know `errors.New("something failed")` — a one-liner that builds a basic error from a fixed string. But real programs do not deal in fixed strings. They deal in *this* user, *that* file, *the* third byte in a sequence. You need an error that includes runtime values: an ID, a path, a port number, the original cause.

That is exactly what `fmt.Errorf` is for.

```go
return fmt.Errorf("could not open file %q at port %d", path, port)
```

It looks like `fmt.Sprintf`, except the result is an `error` value, not a string. The verbs you know from `Printf` work the same: `%s`, `%d`, `%v`, `%q`, `%t`, and so on.

But there is one verb you have probably never seen anywhere else: **`%w`**. It is unique to `fmt.Errorf`. It does *not* format anything by itself — instead, it asks the function to *wrap* an existing error so the chain stays inspectable. This single verb is the most important thing in this whole file.

After reading this you will:
- Know the signature `fmt.Errorf(format string, a ...any) error`.
- Be able to format runtime values into an error message.
- Understand why `%w` is different from `%v` and when to use each.
- Recognize the typical idiom `fmt.Errorf("op: %w", err)` and read it correctly.
- Avoid the most common mistakes: wrapping `nil`, using `%w` on non-errors, using `%v` and losing the chain.

---

## Prerequisites

- **Required:** Functions and multiple return values — you already write functions returning `(T, error)`.
- **Required:** Basic familiarity with the `error` interface (covered in 5.2).
- **Required:** `errors.New` — the simplest way to make an error (covered in 5.3).
- **Required:** `fmt.Printf` / `fmt.Sprintf` — knowing what `%v`, `%s`, `%d`, `%q` do.
- **Helpful:** A glance at `errors.Is` and `errors.As` — you do not need to use them yet, just know they exist (full coverage in 5.5).

---

## Glossary

| Term | Definition |
|------|-----------|
| **fmt.Errorf** | A standard-library function that formats values and returns an `error`, like `Sprintf` for errors. |
| **format string** | The first argument; contains literal text plus verbs like `%s`, `%d`, `%w`. |
| **verb** | A single placeholder in the format string. `%v` is generic, `%s` is string, `%d` is integer, `%w` is wrap. |
| **wrap** | To attach context to an error while keeping the original *findable* via `errors.Is` and `errors.As`. |
| **embed** | To paste the original error's text into the new error's message, throwing away the chain. |
| **error chain** | A linked list of errors created by repeated wrapping. The "outer" error remembers the "inner" one. |
| **Unwrap** | The method that returns the next error in the chain. `errors.Is` uses it under the hood. |
| **%w verb** | The wrap verb, valid only inside `fmt.Errorf`. Argument must be an `error`. |
| **wrapError** | The internal struct created when you call `fmt.Errorf` with a single `%w`. Implements `Unwrap()`. |
| **wrapErrors** | The internal struct created when you call `fmt.Errorf` with multiple `%w` (Go 1.20+). |

---

## Core Concepts

### Concept 1: `fmt.Errorf` builds an error from a format string

The signature is exactly the one you would expect:

```go
func Errorf(format string, a ...any) error
```

You hand it a format string and some arguments; it returns an `error` whose `Error()` method gives you the formatted text.

```go
err := fmt.Errorf("user %d not found in table %q", id, "users")
fmt.Println(err) // user 42 not found in table "users"
```

If you have ever called `fmt.Sprintf`, you already know how to call `fmt.Errorf`. The only difference is the return type: `error` instead of `string`.

### Concept 2: All the usual verbs work

Anything you would put in a `Sprintf` call works here too:

| Verb | Meaning | Example |
|------|---------|---------|
| `%v` | Default format for any value | `42`, `[1 2]`, `{Alice 30}` |
| `%s` | String value (or `Error()` for errors) | `"hello"` |
| `%d` | Decimal integer | `42` |
| `%q` | Quoted string | `"hello"` |
| `%t` | Boolean | `true` |
| `%x` | Hex | `2a` |
| `%T` | Type | `*main.User` |
| `%w` | **Wrap an error** | (special — see below) |

```go
err := fmt.Errorf("port %d is invalid (received %q, want %t)", port, raw, ok)
```

### Concept 3: `%w` wraps; `%v` only formats

This is the one concept that makes `fmt.Errorf` different from `fmt.Sprintf`. When you have an existing error and you want to add context to it, you have two choices:

**Embedding (loses the chain):**
```go
return fmt.Errorf("read config: %v", err)
```
The original `err` is rendered into a string and embedded into the new error. After this, `errors.Is(newErr, originalErr)` is **false**. The new error is just text.

**Wrapping (preserves the chain):**
```go
return fmt.Errorf("read config: %w", err)
```
Now the resulting error has an internal `Unwrap() error` method that returns the original `err`. `errors.Is(newErr, originalErr)` is **true**. The new error's `Error()` text *looks the same*, but its identity is preserved.

**Rule of thumb:** if you are wrapping an error to add context for callers, use `%w`. Use `%v` only when the original error is genuinely just diagnostic text, not something a caller might want to inspect.

### Concept 4: One `%w` per call (or many in Go 1.20+)

Before Go 1.20, you could only use `%w` *once* in a single `fmt.Errorf` call. Using it twice was a runtime mistake — the second one came out as `%!w(...)`.

Since Go 1.20:

```go
err := fmt.Errorf("multi: %w and %w", errA, errB)
```

This wraps *both* `errA` and `errB`. `errors.Is(err, errA)` is true and `errors.Is(err, errB)` is true. Useful for "the operation had two simultaneous failures" cases.

You will see single-`%w` 99% of the time.

### Concept 5: The `%w` argument must be an error

`%w` requires the corresponding argument to satisfy the `error` interface. If it does not, the formatted output contains `%!w(<type>=<value>)` to mark the misuse — and the wrapping does not happen.

```go
fmt.Errorf("oops: %w", "string here")
// produces: "oops: %!w(string=string here)"
```

This is a silent runtime bug, not a compile error. Always pass an actual `error` to `%w`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Format verbs** | Filling in blanks in a paragraph: "User ___ failed at step ___." Each blank has a type. |
| **`%v` (embed)** | Photocopying a receipt and stapling it inside another report. The original is now a copy of text — the receipt itself is gone. |
| **`%w` (wrap)** | Stapling the *original* receipt to the report. The new report references the receipt, but the receipt is still its own thing. |
| **Multiple `%w`** | Stapling two receipts to one report — the report says "I had two attached costs." |
| **`%w` with a non-error** | Asking for a stapled "receipt" but handing the stapler a coffee cup. The system shrugs and writes "type mismatch" on the report. |

---

## Mental Models

**The intuition:** `fmt.Errorf` is `fmt.Sprintf` with one extra trick. The trick is `%w`, which says "do not just print this error — *remember* it." Everything else is regular formatting.

**Why this model helps:** It kills the temptation to think of `%w` as a magic verb. It is just a directive that flips a bit on the resulting error: "I have a wrapped child." That bit is what `errors.Is` and `errors.As` use to walk the chain. No magic, just a hidden field.

**Second intuition:** Think of `%w` as "I am storing a pointer," and `%v` as "I am stamping a string." After `%v`, only text remains. After `%w`, a pointer remains and the text is a side effect for human eyes.

**Third intuition:** Each call to `fmt.Errorf("...: %w", err)` adds one *link* to a chain. The deeper your call stack, the longer the chain. Reading the chain top-to-bottom is reading "what was the operation, then what went wrong, then what really went wrong."

---

## Pros & Cons

| Pros | Cons |
|------|------|
| One function for both formatting and wrapping. | The `%w` vs `%v` distinction is invisible at the call site if you do not look closely. |
| Output text is identical for `%w` and `%v` — only identity differs, so swapping accidentally is silent. | Minor cost: 1–3 allocations per call vs 0 for a package-level sentinel. |
| Plays well with the rest of the `errors` package: `Is`, `As`, `Unwrap`. | Verbose for one-off "thing happened" errors — `errors.New` is shorter. |
| Standard, idiomatic, no third-party dependency required. | Pre-Go 1.20: only one `%w` per call; the rule was easy to forget. |
| Multi-wrap (Go 1.20+) collects multiple causes cleanly. | Wrapping a `nil` produces a non-nil result that prints `%!w(<nil>)` — caller bugs. |

### When to use:
- Whenever you propagate an error and want to add context (operation name, ID, path, etc.).
- Whenever you want callers to still find the underlying error via `errors.Is` / `errors.As`.

### When NOT to use:
- When the message is fully static and never includes runtime values — use `errors.New` instead.
- When the error is a top-level package sentinel (`var ErrFoo = errors.New("foo")`).

---

## Use Cases

- **Adding context to a propagated error:** `fmt.Errorf("save user %d: %w", id, err)`.
- **Building a sentinel-bearing error:** `fmt.Errorf("lookup %q: %w", key, ErrNotFound)`.
- **Wrapping a typed error from a stdlib call:** `fmt.Errorf("connect %s: %w", addr, sysErr)`.
- **Reporting multiple simultaneous failures (Go 1.20+):** `fmt.Errorf("commit: %w; rollback: %w", commitErr, rollbackErr)`.
- **Producing a structured-looking message** with formatted runtime data: `fmt.Errorf("port %d out of range [%d,%d]", p, lo, hi)`.

---

## Code Examples

### Example 1: Basic formatting

```go
package main

import "fmt"

func main() {
    id := 42
    err := fmt.Errorf("user %d not found", id)
    fmt.Println(err)         // user 42 not found
    fmt.Println(err.Error()) // same string
}
```

**What it does:** `fmt.Errorf` returns an `error` whose textual form contains the formatted message. `err.Error()` and `fmt.Println(err)` produce the same output.

### Example 2: Wrapping with `%w`

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func lookup(id int) error {
    return fmt.Errorf("lookup %d: %w", id, ErrNotFound)
}

func main() {
    err := lookup(7)
    fmt.Println(err)                       // lookup 7: not found
    fmt.Println(errors.Is(err, ErrNotFound)) // true
}
```

**What it does:** Wraps `ErrNotFound` so the caller can still detect it with `errors.Is`. The printed text shows both the context and the original message.
**How to run:** `go run main.go`.

### Example 3: Embedding with `%v` (the wrong choice in most cases)

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func lookupBad(id int) error {
    return fmt.Errorf("lookup %d: %v", id, ErrNotFound) // note %v
}

func main() {
    err := lookupBad(7)
    fmt.Println(err)                            // lookup 7: not found
    fmt.Println(errors.Is(err, ErrNotFound))    // false!
}
```

**What it does:** Looks identical when printed but `errors.Is` cannot find the sentinel. The text matches; the identity does not.

### Example 4: Wrapping a stdlib error

```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func readConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("read config %q: %w", path, err)
    }
    return data, nil
}

func main() {
    _, err := readConfig("/no/such/file.json")
    fmt.Println(err)
    fmt.Println(errors.Is(err, fs.ErrNotExist)) // true
}
```

**What it does:** `os.ReadFile` returns an error wrapping `fs.ErrNotExist`. Wrapping that error again with `%w` keeps the chain intact, so `errors.Is(err, fs.ErrNotExist)` still works at the top.

### Example 5: Multiple verbs, including `%w`

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    cause := errors.New("permission denied")
    err := fmt.Errorf("user=%q action=%q port=%d: %w",
        "alice", "open", 22, cause)
    fmt.Println(err)
    // user="alice" action="open" port=22: permission denied
}
```

**What it does:** Demonstrates that `%w` peacefully co-exists with other verbs. Only one verb `%w` per call (pre-1.20) but unlimited `%v`/`%s`/`%d`.

### Example 6: Multi-wrap (Go 1.20+)

```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrA = errors.New("A failed")
    ErrB = errors.New("B failed")
)

func main() {
    err := fmt.Errorf("multi: %w; %w", ErrA, ErrB)
    fmt.Println(err)                   // multi: A failed; B failed
    fmt.Println(errors.Is(err, ErrA))  // true
    fmt.Println(errors.Is(err, ErrB))  // true
}
```

**What it does:** Both `ErrA` and `ErrB` are wrapped. `errors.Is` finds either one. The string just shows them concatenated.

> Every example here is runnable. Save with `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Operation prefix + `%w`

```go
return fmt.Errorf("save user %d: %w", u.ID, err)
```

The format `"<operation>: %w"` is the most common shape in real Go code. Read top-to-bottom, the chain reads like a stack of operations.

### Pattern 2: Sentinel-bearing error

```go
var ErrNotFound = errors.New("not found")

func get(id int) error {
    return fmt.Errorf("get %d: %w", id, ErrNotFound)
}
```

The caller does `errors.Is(err, ErrNotFound)`. Wrap the sentinel so context is preserved without losing identity.

### Pattern 3: Validate and report

```go
if port < 0 || port > 65535 {
    return fmt.Errorf("port %d out of range [0,65535]", port)
}
```

No wrap needed — there is no underlying error. Just formatted runtime data.

### Pattern 4: Wrap then re-wrap

```go
func loadConfig(path string) error {
    data, err := os.ReadFile(path)
    if err != nil {
        return fmt.Errorf("read %q: %w", path, err)
    }
    if err := parse(data); err != nil {
        return fmt.Errorf("parse %q: %w", path, err)
    }
    return nil
}
```

Each layer adds context. The final printed error reads like a sentence.

### Pattern 5: Quoted string verb `%q`

```go
return fmt.Errorf("config key %q is missing", key)
```

`%q` adds quotes around a string, useful for visually separating the name from the surrounding text.

---

## Clean Code

- Put the operation name *first*, then the values, then `%w`. `"save user 42: db down"` is easier to read than `"db down while saving user 42"`.
- Lowercase first letter, no trailing period: `"open file: %w"`, not `"Open file. %w"`.
- Use `%q` around strings that could be empty or contain spaces — it makes the boundary visible: `read %q` shows `read ""` for an empty path.
- One `%w` per `fmt.Errorf` for clarity. Multi-wrap is a feature, not a default.
- If the message is a fixed string, use `errors.New`, not `fmt.Errorf`. `fmt.Errorf("oops")` is heavier than `errors.New("oops")`.

---

## Product Use / Feature

A signup handler:

```go
func handleSignup(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        log.Print(fmt.Errorf("signup read body: %w", err))
        http.Error(w, "bad request", 400)
        return
    }
    var req SignupRequest
    if err := json.Unmarshal(body, &req); err != nil {
        log.Print(fmt.Errorf("signup parse JSON: %w", err))
        http.Error(w, "invalid JSON", 400)
        return
    }
    if err := userService.Create(r.Context(), req); err != nil {
        log.Print(fmt.Errorf("signup create user %q: %w", req.Email, err))
        http.Error(w, "internal error", 500)
        return
    }
    w.WriteHeader(http.StatusCreated)
}
```

Each `fmt.Errorf` annotates the failure with the step that produced it. The wrapped errors preserve the original cause for log filtering and debugging.

---

## Error Handling

Yes, this *is* error handling, but here are sub-rules specific to `fmt.Errorf`:

- Use `%w` whenever you might want callers to inspect the wrapped error.
- Do not wrap something *and then* return only `err.Error()`. You lose the chain.
- Do not call `fmt.Errorf` on a `nil` error — wrapping nil produces an error whose text is `"... %!w(<nil>)"` and the chain points to nothing meaningful.
- Always check the original error first, then wrap on the failure path.

---

## Security Considerations

- **Do not interpolate secrets.** `fmt.Errorf("auth failed for token %q", token)` writes the token into log files forever. Mask tokens, hashes, passwords.
- **Do not echo user input verbatim** in errors that propagate to UIs — sanitize or quote with `%q` and consider truncation.
- **Be careful with `%v` of structs.** A struct containing `Password string` will helpfully print its password. Either implement a redacted `String()` method or do not pass the whole struct.

---

## Performance Tips

- `fmt.Errorf` allocates 1 to 3 times per call (formatted string + wrapper struct).
- For static messages, prefer `errors.New` (one allocation) or a package-level sentinel (zero per call).
- Wrapping is cheap in absolute terms (~150 ns) but multiplies in tight loops. For hot paths, wrap once at the boundary.
- See `optimize.md` for a full breakdown.

---

## Best Practices

- **Wrap with `%w`, not `%v`.** Default to wrapping unless you have a reason to flatten.
- **Add context, not noise.** "save user 42: db down" is good. "an error occurred during operation: db down" is wrap-for-the-sake-of-wrap.
- **Lowercase, no period.** Standard Go convention.
- **Use `%q` for strings.** Especially user-supplied paths and identifiers.
- **One `%w` per call** unless you specifically want multi-wrap semantics.
- **Never wrap nil.** Always check `if err != nil` first.

---

## Edge Cases & Pitfalls

- **`fmt.Errorf("%w", nil)`** — produces a non-nil error with text `"%!w(<nil>)"`. Looks like a wrap but unwraps to nothing useful.
- **`%w` with a non-error argument** — produces `"%!w(<type>=<value>)"`. Silent runtime bug.
- **More than one `%w` before Go 1.20** — only the first wraps; the rest become `%!w(...)`.
- **`%w` and `%v` together for the same error** — wrap once, do not also embed:
  ```go
  // BAD
  fmt.Errorf("op: %v: %w", err, err)
  ```
- **Calling `fmt.Errorf` with `Errorf` aliases.** Some logging libraries accept format strings shaped like `Errorf`'s but do not implement `%w`. Read the doc.

---

## Common Mistakes

1. **Using `%v` instead of `%w`** when you intended to wrap. Output looks identical; `errors.Is` fails.
2. **Wrapping nil** by forgetting the `if err != nil` check.
3. **Passing a non-error to `%w`** — string, struct, or `nil` interface.
4. **Capitalizing the message:** `fmt.Errorf("Failed to read")` — should be lowercase.
5. **Ending with a period:** `fmt.Errorf("read failed.")` — Go errors are sentence fragments.
6. **Using `fmt.Errorf` instead of `errors.New`** for static messages.
7. **Re-wrapping the same error** twice in one call: `fmt.Errorf("%w: %w", err, err)`.
8. **Hard-coding the wrapped error's text** into the format: `fmt.Errorf("read failed: %s", err.Error())` — flatten *and* you have to call `Error()` manually.

---

## Common Misconceptions

- **"`%w` is a string verb."** No — it does not produce text directly. It wraps; the text is a side effect because `Errorf` also formats the wrapped error's `Error()` into the output.
- **"`%w` always panics if argument is not an error."** No — it produces `%!w(...)` and continues. The bug is silent.
- **"`fmt.Errorf` and `errors.New` are interchangeable."** No — `fmt.Errorf` does formatting (and optionally wrapping); `errors.New` does neither. Pick the lighter one when there is no formatting to do.
- **"Multi-wrap is always available."** Only since Go 1.20. Earlier versions limit you to one `%w`.

---

## Tricky Points

- **`%w` only inside `fmt.Errorf`.** It is not a general format verb. `fmt.Sprintf("%w", err)` does *not* wrap — it just produces `%!w(error=...)`.
- **The wrapped error must be a *direct* argument**, not a sub-expression that returns an error indirectly. Type-asserted things still work as long as the value satisfies `error`.
- **`fmt.Errorf("%w", err)` with `err` being a typed nil** wraps a non-nil interface holding a nil pointer. Tricky but logically consistent.
- **The order of arguments matters** when you have multi-wrap: the multi-wrap struct stores them in argument order, and `errors.Is` walks them all.

---

## Test

```go
package errfmt

import (
    "errors"
    "fmt"
    "testing"
)

var ErrSentinel = errors.New("sentinel")

func wrapIt(err error) error {
    return fmt.Errorf("wrap: %w", err)
}

func TestWrap_PreservesIdentity(t *testing.T) {
    err := wrapIt(ErrSentinel)
    if !errors.Is(err, ErrSentinel) {
        t.Fatalf("expected errors.Is true, got false")
    }
}

func TestEmbed_LosesIdentity(t *testing.T) {
    err := fmt.Errorf("wrap: %v", ErrSentinel)
    if errors.Is(err, ErrSentinel) {
        t.Fatalf("expected errors.Is false, got true")
    }
}
```

Run with `go test ./...`.

---

## Tricky Questions

1. *What is the signature of `fmt.Errorf`?*
   `func Errorf(format string, a ...any) error`.

2. *What does `%w` do that `%v` does not?*
   `%w` wraps the argument, allowing `errors.Is` and `errors.As` to find it. `%v` only inserts the formatted text.

3. *What happens if you pass a non-error to `%w`?*
   The output contains `%!w(<type>=<value>)` and no wrapping occurs. No panic, no compile error.

4. *Can you have multiple `%w` in one call?*
   Only since Go 1.20. Before that, only the first works; later ones become `%!w(...)`.

5. *What is the result of `fmt.Errorf("%w", nil)`?*
   A non-nil error whose text is `"%!w(<nil>)"`. Avoid wrapping nil.

6. *Why use `fmt.Errorf` at all if `errors.New` exists?*
   For runtime values in the message and for the wrapping semantics of `%w`.

---

## Cheat Sheet

```go
// Plain formatted error
fmt.Errorf("port %d invalid", 22)

// Wrap an error (preserve identity)
fmt.Errorf("op: %w", err)

// Embed text only (lose identity)
fmt.Errorf("op: %v", err)

// Multi-wrap (Go 1.20+)
fmt.Errorf("op: %w and %w", a, b)

// Verbs you will use: %s %d %q %v %w
// %w must be passed an error.
// One %w pre-1.20; many %w 1.20+.

// Detect what was wrapped
errors.Is(err, ErrSentinel)
errors.As(err, &typedTarget)

// What NOT to do
fmt.Errorf("oops: %w", "string")        // not an error
fmt.Errorf("oops: %w", nil)             // wraps nothing
fmt.Errorf("oops: %v", err)             // hides identity
```

---

## Self-Assessment Checklist

- [ ] I know that `fmt.Errorf` returns an `error`, not a string.
- [ ] I can list at least four format verbs.
- [ ] I can explain the difference between `%w` and `%v` in one sentence.
- [ ] I know `%w` only works inside `fmt.Errorf`.
- [ ] I know multi-wrap requires Go 1.20+.
- [ ] I can read `errors.Is(err, ErrFoo)` and predict whether it is true based on whether the wrap chain used `%w` or `%v`.
- [ ] I avoid wrapping nil errors.
- [ ] I prefer `errors.New` for static messages.

---

## Summary

`fmt.Errorf` is `Sprintf` for errors, plus one extra trick. It formats runtime values into an error message, and with the `%w` verb it wraps an existing error so the chain stays inspectable. Use `%w` to preserve identity, use `%v` only when you genuinely want a flat string. Wrap with operation context: `fmt.Errorf("op: %w", err)` is the heart of idiomatic Go error propagation.

---

## What You Can Build

- A small CLI that opens a file, reads it, parses JSON, validates fields — and at every failure, the error message reads as a chain of operations.
- A "stack-of-context" helper that wraps each layer of a request handler with the layer name.
- A retry helper whose final error is `fmt.Errorf("after %d attempts: %w", n, lastErr)`.

---

## Further Reading

- [Package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Working with errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Go 1.20 release notes — multiple `%w`](https://go.dev/doc/go1.20#errors)
- Source: `$GOROOT/src/fmt/errors.go`

---

## Related Topics

- [01-error-handling-basics](../01-error-handling-basics/junior.md) — the `error` interface and the `if err != nil` idiom.
- [03-errors-new](../03-errors-new/junior.md) — when `errors.New` is the right tool.
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — the broader wrapping protocol and `errors.Is` / `errors.As`.
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — `var Err... = errors.New(...)` exposed as API.

---

## Diagrams & Visual Aids

```
fmt.Errorf("op: %w", inner)

   outer (wrapError)
   +---------+--------+
   | msg     | "op: <inner.Error()>" |
   | err     | -------> inner       |
   +---------+--------+
                |
                v
              inner (errorString)
              +-----+----------+
              | msg | "x went wrong" |
              +-----+----------+

errors.Is(outer, inner) walks outer.err → inner → nil → done.
```

```
%v vs %w (same printout, different identity)

         text     identity preserved?
%v       yes      no   (chain stops here)
%w       yes      yes  (chain extends through Unwrap)
```

```
Multi-wrap (Go 1.20+)

fmt.Errorf("ctx: %w; %w", a, b)

   wrapErrors
   +-----+-------------------+
   | msg | "ctx: a's text; b's text" |
   | errs| -> [a, b]                 |
   +-----+-------------------+

errors.Is checks each entry in errs.
```
