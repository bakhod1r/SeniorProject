# Error Handling Basics — Junior Level

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
> Focus: "What is an error?" and "How do I handle one?"

In most programming languages — Java, Python, JavaScript, C# — when something goes wrong the language *throws an exception*. Control jumps somewhere else. You wrap risky code in `try/catch`. You hope someone, somewhere, catches it.

**Go does not work that way.**

In Go, an error is just a **value**. A function that can fail returns the error to you, the caller, as one of its return values. You then have a choice: handle it, ignore it (bad idea), or pass it up to your own caller.

```go
// A function that can fail returns (result, error)
file, err := os.Open("data.txt")
if err != nil {
    // The file could not be opened. Handle it.
    fmt.Println("could not open file:", err)
    return
}
// If we reach here, err was nil — we have a valid file.
```

That `if err != nil` block is the most recognizable shape in Go code. You will write it thousands of times. It is not a wart in the language; it is the language's deliberate design choice that says: **the caller is responsible for thinking about failure**.

After reading this file you will:
- Understand what an `error` is in Go
- Know the `if err != nil` idiom and why it exists
- Be able to write functions that return errors and call functions that return errors
- Understand the difference between an error and a panic
- Know when to ignore an error (almost never) and when to handle it

---

## Prerequisites

- **Required:** Functions and multiple return values — the entire error mechanism rides on a function returning `(value, error)`.
- **Required:** Interfaces (basic understanding) — `error` is an interface; you do not need to know everything about interfaces yet, just that "an interface is something that has methods."
- **Required:** `nil` — knowing that `nil` is Go's "no value" for pointers, slices, maps, channels, functions, and interfaces.
- **Helpful but not required:** `fmt` package, `os` package — many examples use them.
- **Helpful but not required:** Basic understanding of `panic` (covered separately in 5.7).

---

## Glossary

| Term | Definition |
|------|-----------|
| **error** | A built-in interface type with one method: `Error() string`. Any type that implements this method *is* an error. |
| **nil** | The zero value of an interface. A `nil` error means "no error happened." |
| **idiom** | A standard pattern of code. `if err != nil { return err }` is *the* Go error idiom. |
| **caller** | The function that called yours. The caller is the one responsible for deciding what to do with the error you return. |
| **propagate** | To pass an error up to your caller instead of handling it yourself. |
| **handle** | To decide what to do about an error: log it, retry, return a default, fail the request, etc. |
| **panic** | A different mechanism for *unrecoverable* situations (covered in 5.7). Errors are for *expected* failures; panics are for "the program is in an impossible state." |
| **sentinel error** | A specific named error value used as a marker, e.g. `io.EOF` (covered in 5.6). |
| **error wrapping** | Attaching context to an error while preserving the original (covered in 5.5). |

---

## Core Concepts

### Concept 1: Errors are values

This is the most important sentence in Go's error story. An error is not a control-flow event. It is not a magic mechanism. It is just a value, no different from an `int` or a `string`, that you pass around with regular function returns.

Because errors are values:
- You can compare them.
- You can store them in slices and maps.
- You can write functions that take or return them.
- You can build helpers that decorate or transform them.
- The compiler knows about them.

If you ever feel that error handling in Go is verbose, remember: every other language hides errors with magic, and that magic costs you readability and predictability. Go's tradeoff is "more keystrokes, fewer surprises."

### Concept 2: The `error` interface

Go has one built-in interface that defines what an error *is*:

```go
type error interface {
    Error() string
}
```

That is the entire definition. Any value that has an `Error() string` method satisfies the interface and counts as an error. We will go very deep on this in [02-error-interface](../02-error-interface/junior.md). For now: an `error` is just a thing that knows how to describe itself as a string.

### Concept 3: The "second return value" convention

By overwhelming convention in the standard library and the broader Go ecosystem, the **last** return value of a function that can fail is `error`:

```go
func parseAge(s string) (int, error)
func openDB(url string) (*DB, error)
func writeAll(w io.Writer, data []byte) error
```

Three rules:
1. The error is the *last* return value.
2. If the error is non-`nil`, the other return values **should be considered garbage**.
3. If the error is `nil`, the other return values are valid.

### Concept 4: The `if err != nil` idiom

After every call that can fail, you check the error:

```go
result, err := doSomething()
if err != nil {
    // failure path
    return err  // or handle it locally
}
// success path — use result
```

This pattern is so frequent that it has become the visual rhythm of Go code. It is not pretty in the same way a one-liner is pretty, but it is *honest*: you can see, at every step, where the program might fail.

### Concept 5: nil means "no error"

When a function succeeds, it returns `nil` for its error value. So `err == nil` is the success check, and `err != nil` is the failure check.

```go
n, err := io.WriteString(w, "hello")
if err == nil {
    fmt.Println("wrote", n, "bytes")
}
```

A `nil` error is the *only* signal of success. Do not try to invent other signals.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Errors are values** | A delivery driver hands you a package *and* a slip that says "the box was wet when I picked it up." The slip is the error — a tangible piece of information, not a scream. |
| **`if err != nil`** | A factory worker on an assembly line who checks every part against a quality slip before passing it on. Boring, repetitive, but means defects do not cascade. |
| **`nil` error** | A clean health-check: nothing to report. |
| **Returning the error up** | A junior employee who says "I do not have authority to decide this — let me ask my manager." |
| **Ignoring an error (`_`)** | Pretending you did not see the warning light on your dashboard. The car still runs… for now. |

---

## Mental Models

**The intuition:** Think of every function that can fail as a *vending machine*. You put in money, push a button, and the machine returns either *(your snack, no problem)* or *(no snack, here is why)*. There is never a moment where the machine secretly throws your money away while pretending to work — the failure is always physically returned to you on the same path as the success.

**Why this model helps:** It kills the temptation to use `try/catch`-style thinking. There is no "elsewhere" the error can go. It is right there, in your hand. You either use it or you drop it on the floor on purpose (`_ = ...`), but you cannot pretend it does not exist.

**The second intuition:** Errors compose like math. If `f` can fail and `g` can fail, then a function that calls both can fail, and the failure is just one more value being threaded through. There is no separate "exception" universe parallel to the "values" universe.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Failures are explicit and visible at every call site. | Code is verbose; lots of `if err != nil { return err }`. |
| No hidden control flow — execution is linear. | Easy to forget to handle an error (compiler warns only if you discard the value). |
| Errors are first-class values you can program against. | Building a deep stack trace requires extra work or third-party libraries. |
| No try/catch, so no try/catch-related bugs (catching too much, catching too little). | New developers from exception-language backgrounds find it noisy at first. |
| Predictable performance — no stack unwinding cost. | Wrapping with context still requires discipline (`fmt.Errorf` with `%w`). |
| Easy to test failure paths — you just construct an error value. | "Errors as values" only works if everyone follows the convention. |

### When to use:
- Any time a function can fail in a way the *caller* can reasonably do something about: file not found, parse failed, network unreachable, validation failed.

### When NOT to use:
- Programmer mistakes that should never happen at runtime: index out of range, dividing by zero on a constant, calling a method on a nil pointer that the program logically guaranteed was non-nil. Those should `panic`. (See 5.7.)

---

## Use Cases

- **Reading files** — `os.Open` returns an error if the file does not exist or permissions are wrong.
- **Parsing input** — `strconv.Atoi` returns an error if the string is not a number.
- **Network calls** — `http.Get` returns an error if DNS fails, the server is down, etc.
- **Database queries** — drivers return an error for missing rows, broken connections, syntax errors.
- **JSON/YAML decoding** — `json.Unmarshal` returns an error for malformed input.
- **Validating user input** — your own functions return an error when input fails business rules.

---

## Code Examples

### Example 1: A function that can fail

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
    result, err := divide(10, 2)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("result:", result)

    result, err = divide(10, 0)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("result:", result)
}
```

**What it does:** Defines a function that returns `(float64, error)`. On success, error is `nil`. On failure, the value is meaningless and the error explains why.
**How to run:** `go run main.go`

### Example 2: Calling a standard-library function that can fail

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    file, err := os.Open("does-not-exist.txt")
    if err != nil {
        fmt.Println("could not open:", err)
        return
    }
    defer file.Close()
    fmt.Println("opened:", file.Name())
}
```

**What it does:** Tries to open a file that does not exist; the error tells you exactly that. Notice that we do *not* use `file` after the error check.
**How to run:** `go run main.go`

### Example 3: Propagating errors upward

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

func parsePositive(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, err  // pass it up unchanged
    }
    if n < 0 {
        return 0, errors.New("number must be positive")
    }
    return n, nil
}

func main() {
    for _, s := range []string{"42", "-5", "abc"} {
        n, err := parsePositive(s)
        if err != nil {
            fmt.Printf("input %q: %v\n", s, err)
            continue
        }
        fmt.Printf("input %q: %d\n", s, n)
    }
}
```

**What it does:** `parsePositive` either passes through `strconv.Atoi`'s error or returns its own. The caller decides how to react.

### Example 4: Multiple checks in sequence

```go
package main

import (
    "fmt"
    "os"
)

func writeReport() error {
    f, err := os.Create("report.txt")
    if err != nil {
        return err
    }
    defer f.Close()

    if _, err := f.WriteString("Header\n"); err != nil {
        return err
    }
    if _, err := f.WriteString("Body\n"); err != nil {
        return err
    }
    return nil
}

func main() {
    if err := writeReport(); err != nil {
        fmt.Println("report failed:", err)
        os.Exit(1)
    }
    fmt.Println("done")
}
```

**What it does:** Each step that can fail is followed by an immediate error check. `defer f.Close()` ensures the file is closed even on the failure path.

### Example 5: Returning a default on a non-fatal error

```go
package main

import (
    "fmt"
    "strconv"
)

func parsePort(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil || n < 1 || n > 65535 {
        return 8080  // sensible default
    }
    return n
}

func main() {
    fmt.Println(parsePort("3000")) // 3000
    fmt.Println(parsePort("abc"))  // 8080
    fmt.Println(parsePort("-1"))   // 8080
}
```

**What it does:** Sometimes the right behavior is "use a default on error." This is fine as long as you have *thought* about it — not as a way to dodge writing `if err != nil`.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Early return on error

```go
v, err := step1()
if err != nil {
    return err
}
v2, err := step2(v)
if err != nil {
    return err
}
return step3(v2)
```

This is called the **happy-path pattern**: the error checks form the "left margin" and the success path flows straight down.

### Pattern 2: Wrap with context (preview)

```go
if err != nil {
    return fmt.Errorf("loading config: %w", err)
}
```

`%w` is for *wrapping*. We will go deep on this in [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md). For now: it adds context.

### Pattern 3: Sentinel comparison (preview)

```go
if errors.Is(err, io.EOF) {
    // expected end of input
}
```

We will cover this in [06-sentinel-errors](../06-sentinel-errors/junior.md). It is the *only* correct way to compare wrapped errors.

### Pattern 4: Error logging then early return

```go
if err := saveUser(u); err != nil {
    log.Printf("save user %d: %v", u.ID, err)
    return err
}
```

Log + return is fine at the top of a request handler. **Do not** log+return in deep helpers — you will see the same error logged ten times.

### Pattern 5: Ignore intentionally with `_`

```go
_, _ = io.WriteString(os.Stderr, "warning\n")
```

Used when the error is genuinely uninteresting (e.g., writing to stderr in a logger). Use sparingly and *deliberately*.

---

## Clean Code

- Name your error variables `err` — every Go developer reads `err` instantly. `e`, `error1`, `myErr` slow people down.
- Keep the success path on the left margin. Wrap failure in `if err != nil { ... }` with a quick `return`.
- Do *not* nest:
  ```go
  // BAD
  if err == nil {
      // a hundred lines of happy path
  } else {
      return err
  }
  ```
- Read top-to-bottom: `if err != nil { return err }` then continue. Your function should look like a checklist.
- Do not write redundant prefixes in error messages: not `error: failed to open file: ...` but `open file: ...`. The caller may add context.
- Lowercase first letter, no trailing punctuation: `errors.New("invalid age")` — *not* `errors.New("Invalid age.")`. The Go convention treats error strings as fragments that compose into longer sentences.

---

## Product Use / Feature

A real Go service might handle a single HTTP request like this:

```go
func handleSignup(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "could not read body", http.StatusBadRequest)
        return
    }
    var req SignupRequest
    if err := json.Unmarshal(body, &req); err != nil {
        http.Error(w, "invalid JSON", http.StatusBadRequest)
        return
    }
    if err := req.Validate(); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    user, err := userService.Create(r.Context(), req)
    if err != nil {
        log.Printf("signup: %v", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

Five `if err != nil` blocks, five different responses. Each one is a deliberate decision about how this specific failure should look to the user.

---

## Error Handling

Yes — this whole topic *is* error handling. But here are some meta-rules about *handling errors that come from your own error-returning code*:

- Decide who owns the error: the caller, or the current function.
- A function should not "handle" an error twice: e.g., do not log it AND return it AND wrap it. Pick one or two.
- If you return an error, you do not need to log it; the caller (or some shared logging middleware) will.
- If you log it, you usually do not need to return it. (Exception: API boundaries where the caller still needs to react.)

---

## Security Considerations

- **Do not leak internal details to users.** A SQL error message can reveal table names, column names, sometimes data. Wrap or mask before sending to clients:
  ```go
  if err != nil {
      log.Printf("db query: %v", err)             // full detail in logs
      http.Error(w, "internal error", 500)        // bland message to user
      return
  }
  ```
- **Do not include secrets in error strings.** `fmt.Errorf("auth failed for token %q", token)` is a recipe for a leaked token in logs.
- **Constant-time error paths.** For authentication, two failure paths ("user not found" vs "wrong password") should produce indistinguishable responses to the outside, otherwise you leak which usernames exist.

---

## Performance Tips

- An `error` is an interface value, two words wide. Returning `nil` is essentially free; returning a non-`nil` error allocates if you create a new error value with `errors.New` or `fmt.Errorf`.
- Hot paths that can fail extremely often (think: parsing a million tokens) may benefit from sentinel errors (a single global `var ErrFoo = errors.New("foo")`) so the "failure" path does not allocate per call.
- Do not avoid error-returning APIs for performance — the cost of `if err != nil` on a value comparison is a few nanoseconds. The cost of getting a hidden bug wrong is hours.
- See `optimize.md` for benchmarking and concrete numbers.

---

## Best Practices

- **Always check the error.** Even if you "know" it cannot happen, write the check. The next refactor may invalidate that assumption.
- **Add context when you propagate.** Use `fmt.Errorf("doing X: %w", err)` so the caller has a breadcrumb trail. (Detail in 5.5.)
- **Compare with `errors.Is` / `errors.As`, not `==`.** Once errors get wrapped, `==` stops working. (Detail in 5.5 and 5.6.)
- **Return errors, do not throw them.** No `panic` for expected failures.
- **Lowercase, no punctuation.** Standard library convention.
- **Do not return `nil` for "not found"** — if "not found" is a real outcome, return a sentinel error so the caller can distinguish it from "no result yet."

---

## Edge Cases & Pitfalls

- **A non-nil error wrapping a nil concrete pointer.** `var e *MyError = nil; var err error = e; err != nil` is **true** because the interface header is non-nil even though the pointer inside is nil. Classic Go trap. (See [02-error-interface](../02-error-interface/junior.md).)
- **`if err == nil` *and using the value anyway*.** Always check error first. Some library functions return a partial value with an error.
- **Forgetting `:=` vs `=`.** `n, err := f()` declares `err`. A second `n, err := g()` in the same scope is a compile error if `n` and `err` already exist (use `=`) — unless at least one variable is new (`n2, err := ...`). This trips up beginners.

---

## Common Mistakes

1. **Writing `if err != nil { return nil }`** — silently swallowing the error. The caller will think it worked.
2. **Returning the wrong default.** `return -1, nil` instead of `return 0, err` when something failed.
3. **Logging *and* returning, then logging again upstream.** The same error appears five times in the log.
4. **Wrapping without `%w`.** `fmt.Errorf("xxx: %v", err)` flattens to a string and breaks `errors.Is`/`errors.As`.
5. **Comparing wrapped errors with `==`.** Once wrapped, the equality fails. Use `errors.Is`.
6. **Returning the same error from multiple paths with no context.** Caller cannot tell which step failed.
7. **Using `panic` instead of `error` for normal failures.** Panics should be reserved for "impossible" states.
8. **Using a `bool` instead of an `error` to indicate failure.** Loses information; use `error`.

---

## Common Misconceptions

- **"Go has no error handling."** Wrong — Go has *very explicit* error handling. There is just no exception machinery.
- **"`if err != nil` is bad."** Verbose, yes. Bad, no. Forced explicitness is the design.
- **"`nil` is special."** Not in this case. A `nil` error is just an interface value whose type and data words are both zero.
- **"`error` is a type."** It is an *interface*. The dynamic value can be many concrete types.
- **"Returning an error means the function was useless."** Not at all — many functions return both a partial result and an error.

---

## Tricky Points

- **Comparing nil errors of different concrete types.** Two `nil` errors are equal because both interface headers are zeroed. Two non-nil errors of different types are never equal even if their messages match.
- **Multi-return error swallowing.** `_, err := f()` is fine. `f()` (with no assignment) when `f` returns an error does *not* warn — Go's compiler does not flag unused error return values (only unused local variables).
- **`defer` and errors.** Closing a file via `defer f.Close()` discards the error from `Close`. For writes, you sometimes want to capture it via a named return value.

---

## Test

```go
package basics

import (
    "errors"
    "testing"
)

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func TestDivide_Success(t *testing.T) {
    got, err := divide(10, 2)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if got != 5 {
        t.Fatalf("got %v, want 5", got)
    }
}

func TestDivide_ByZero(t *testing.T) {
    _, err := divide(10, 0)
    if err == nil {
        t.Fatalf("expected error, got nil")
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What is the type of `error` in Go?*
   An interface with a single method `Error() string`.

2. *If a function returns `(int, error)` and the error is non-nil, what is the value of the int?*
   By convention, garbage. Do not use it.

3. *Can `nil` satisfy the `error` interface?*
   Yes — a nil error is an interface value with a nil type and nil data, and `err == nil` is true.

4. *What is the difference between `panic` and `error`?*
   Errors are values returned to the caller for *expected* failures. Panic is a runtime mechanism for *unrecoverable* situations (covered in 5.7).

5. *Why does Go not have exceptions?*
   Design choice: Go's authors believe exceptions create hidden control flow and encourage sloppy handling. Errors as values force you to think.

---

## Cheat Sheet

```go
// Define a function that can fail
func f() (T, error) { ... }

// Call it
v, err := f()
if err != nil { return err }   // propagate
// or
if err != nil { /* handle */ }

// Create a basic error
errors.New("message")          // simple
fmt.Errorf("ctx: %w", err)     // wrap with context

// Compare errors
errors.Is(err, target)         // sentinel match
errors.As(err, &concrete)      // type match

// Ignore intentionally
_, _ = f()

// Last return value is error
func g() (int, string, error)  // YES
func g() (error, int)          // NO
```

---

## Self-Assessment Checklist

- [ ] I can write a function with signature `func name(...) (T, error)`.
- [ ] I can call such a function and check `if err != nil`.
- [ ] I know what `nil` means for an error.
- [ ] I can explain why Go does not use exceptions.
- [ ] I can read code with five `if err != nil` checks in a row without flinching.
- [ ] I can list at least three pitfalls of error handling.
- [ ] I know that errors are values, not events.
- [ ] I do not confuse `panic` with `error`.

---

## Summary

Errors in Go are **values**: ordinary returns from functions that can fail. The `if err != nil` idiom is how you check them. The `error` interface is one method, `Error() string`. Compared to exception-based languages, Go trades brevity for explicitness: every failure point is visible, every choice about handling is local. Master this idiom and you have mastered 80% of day-to-day Go programming.

---

## What You Can Build

- A CLI tool that reads a config file and reports a precise error if the file is missing, invalid JSON, or has an out-of-range value.
- An HTTP handler that validates a request body and returns 400 on user-fixable errors, 500 on server-side errors.
- A retry helper: a function that calls another function up to N times and returns the last error if all attempts fail.

---

## Further Reading

- [Effective Go: Errors](https://go.dev/doc/effective_go#errors)
- [The Go Blog: Error handling and Go (Andrew Gerrand)](https://go.dev/blog/error-handling-and-go)
- [The Go Blog: Errors are values (Rob Pike)](https://go.dev/blog/errors-are-values)
- Source code of the `errors` package: `$GOROOT/src/errors/errors.go`

---

## Related Topics

- [02-error-interface](../02-error-interface/junior.md) — the formal `error` interface
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w`, `errors.Is`, `errors.As`
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — named error values like `io.EOF`
- [07-panic-and-recover](../07-panic-and-recover/junior.md) — for unrecoverable cases

---

## Diagrams & Visual Aids

```
caller                       callee
  |                            |
  |---- call f() ------------->|
  |                            |  (work)
  |<---- (value, nil) ---------|   success
  |
  |  if err != nil { ... }
  |
  |---- call f() ------------->|
  |                            |  (oh no)
  |<---- (zero, err) ----------|   failure
  |
  |  err != nil → handle/propagate
```

```
  Function                Caller
+-----------+         +------------+
|  do work  | ------> | check err  |
| return    |         |  if !nil:  |
| (v, err)  |         |   handle   |
+-----------+         |  else:     |
                      |   use v    |
                      +------------+
```
