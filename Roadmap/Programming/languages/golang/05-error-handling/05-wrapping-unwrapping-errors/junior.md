# Wrapping & Unwrapping Errors — Junior Level

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
> Focus: "What is wrapping?" and "How do I add context to an error without losing it?"

When an error happens deep inside your program, the message is often too vague to be useful at the top. Imagine your file reader returns `"no such file or directory"`. Up at the HTTP handler, that message tells you *something* went wrong — but not *what* you were trying to do, with *which* path, in *which* operation.

In Go, the answer to that problem is **error wrapping**.

```go
data, err := os.ReadFile(path)
if err != nil {
    return fmt.Errorf("loading config %q: %w", path, err)
}
```

That little `%w` is the heart of this entire topic. It says: "make a new error that *contains* the old one." The new error has its own message ("loading config 'foo.json'") *and* keeps a pointer to the original. Later code can pull the original back out with `errors.Is` or `errors.As`.

After reading this file you will:
- Know what `%w` does and how it differs from `%v`.
- Be able to wrap an error and unwrap it again.
- Use `errors.Is` to check whether a chain contains a specific error.
- Use `errors.As` to extract a typed error from a chain.
- Understand why wrapping matters for real-world Go code.

---

## Prerequisites

- **Required:** Error handling basics — you know what an `error` is, how to return one, and how to write `if err != nil`. (See [01-error-handling-basics](../01-error-handling-basics/junior.md).)
- **Required:** `fmt.Errorf` — you have built error messages with `fmt.Errorf("%v: %s", a, b)` style formatting.
- **Required:** `errors.New` — the simple constructor for an error with a message.
- **Helpful:** Knowing what an interface is in Go. The wrap mechanism uses an `Unwrap() error` method.
- **Helpful:** Understanding pointer vs value receivers; custom error types are usually pointer-based.

---

## Glossary

| Term | Definition |
|------|-----------|
| **wrap** | To create a new error that *carries* an existing error inside it. The new error has its own message; the old one is reachable via `Unwrap`. |
| **unwrap** | To pull the inner error out of a wrapper. Done with `errors.Unwrap(err)` or via the chain-walking helpers. |
| **chain** | The linked list of errors formed by repeated wrapping. Walking the chain means calling `Unwrap` until you get `nil`. |
| **`%w`** | The `fmt.Errorf` verb introduced in Go 1.13 that wraps the argument. The result is an error whose `Unwrap()` returns the wrapped value. |
| **`%v`** | The standard formatting verb. Embeds the error's *string* but does **not** wrap. The original error is unreachable through the chain. |
| **`errors.Is`** | Walks the chain looking for an error equal to `target`. Used for sentinel comparisons like `io.EOF`. |
| **`errors.As`** | Walks the chain looking for an error of a specific dynamic type, and assigns it to your variable. Used for typed errors. |
| **`errors.Unwrap`** | Returns the next error in the chain, or `nil`. Rarely called directly. |
| **`errors.Join`** | (Go 1.20) Combines multiple errors into a single error whose chain branches into many. |
| **sentinel error** | A package-level variable like `var ErrNotFound = errors.New("not found")`. Compared with `errors.Is`. |

---

## Core Concepts

### Concept 1: An error can hide inside another error

Before Go 1.13, if you wanted to add context to an error, you wrote:

```go
return fmt.Errorf("loading config: %v", err)
```

The result's `.Error()` returned `"loading config: original message"`. But the *original `err` value* was gone — flattened into a string. If the caller wanted to check `err == os.ErrNotExist`, they could not, because what they had was a brand-new error with no link to the original.

Wrapping fixes this. With `%w`:

```go
return fmt.Errorf("loading config: %w", err)
```

…the new error is still a string, but it also has a hidden `Unwrap() error` method that returns the original. The caller can still ask "is this `os.ErrNotExist`?" and get a correct answer.

### Concept 2: The `Unwrap` method

A type that wraps another error implements one extra method:

```go
type wrappingError struct {
    msg     string
    wrapped error
}

func (w *wrappingError) Error() string  { return w.msg }
func (w *wrappingError) Unwrap() error  { return w.wrapped }
```

`fmt.Errorf("...: %w", err)` returns a value that already implements this. You do not have to write the type yourself.

### Concept 3: `errors.Is` walks the chain

```go
err := fmt.Errorf("layer A: %w", fmt.Errorf("layer B: %w", io.EOF))

errors.Is(err, io.EOF)  // true
err == io.EOF           // false
```

`errors.Is(err, target)` calls `Unwrap()` repeatedly, comparing each layer with `==` (or via the layer's optional custom `Is(target) bool` method). It returns true the moment it finds a match.

### Concept 4: `errors.As` extracts a typed error

If you want fields, not just identity, use `errors.As`:

```go
var pathErr *fs.PathError
if errors.As(err, &pathErr) {
    fmt.Println("the bad path was:", pathErr.Path)
}
```

`errors.As` walks the chain like `Is`, but instead of comparing for equality it checks whether each layer is the type pointed to by `&pathErr`. On match, it assigns and returns true.

### Concept 5: `%w` vs `%v`

This is the single most important rule of this topic.

| Verb | Wraps? | Caller can use `errors.Is`/`errors.As`? |
|------|--------|------------------------------------------|
| `%v` | No  | No — the original is lost. |
| `%w` | Yes | Yes — the original is reachable. |

If you intend any caller to inspect the cause, **always use `%w`**. If you are absolutely sure no caller will ever look past the message string, `%v` is technically OK, but it is so common to be wrong that the safe default is `%w`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Wrapping** | A nested package: the outer box says "your order from Acme" and inside there is a smaller box with the actual product. The outer label adds context, the inner box is the real thing. |
| **`%w` vs `%v`** | `%w` photocopies the receipt and *staples it* to your invoice. `%v` photocopies the receipt and *throws the original away*, leaving you with only the photocopy. |
| **`errors.Is`** | Walking down a Russian nesting doll until you find a doll with a specific painted symbol. |
| **`errors.As`** | Walking down a Russian nesting doll until you find one of a specific *type* (a wooden one vs a plastic one) — and once you find it, you take it out to inspect it. |
| **Chain** | A paper trail: the customer complaint → the support ticket → the internal bug report → the original log line. Each link adds context, none destroys the previous. |
| **`errors.Join`** | A single envelope containing several separate complaints. The envelope itself is one error, but it branches into many causes. |

---

## Mental Models

**Linked list of causes.** Imagine each error as a node:

```
[outer message] → [middle message] → [inner sentinel io.EOF] → nil
```

The arrow is `Unwrap()`. The walk is the linear traversal of that list.

**Onion of context.** Each `fmt.Errorf("X: %w", err)` adds another layer. From outside, you see only the outermost message. To find the core, you peel.

**The "%w is sticky tape" model.** `%w` does not glue the cause's *string* to your error — it *staples* the original error value behind your message. The string version (`.Error()`) is what you read; the wrapped value is what `errors.Is` and `errors.As` find.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Adds context without destroying the original. | One extra character (`%w` vs `%v`) — easy to type the wrong one. |
| Enables `errors.Is`/`errors.As` across many layers. | Wrap chains can grow long and hard to read in logs. |
| Standardized in the `fmt`/`errors` packages — no third-party dependency. | Beginners often forget `%w` and silently lose error identity. |
| Custom types can opt in by adding `Unwrap`/`Is`/`As` methods. | Comparing wrapped errors with `==` is a classic bug. |
| Works across goroutines and async boundaries. | Cost of wrap is real (allocates) — visible in extreme hot paths. |
| Plays nicely with structured logging, OpenTelemetry, etc. | Multiple `%w` (Go 1.20+) introduces complexity around tree traversal. |

### When to use:
- Any time you propagate an error and want to add context (the operation, the input, the resource).
- Any time the caller might reasonably want to inspect the cause via `errors.Is` or `errors.As`.

### When NOT to use:
- For a *user-facing* error string with no need for inspection downstream — but even there `%w` is usually the safer default.
- When you want to *deliberately* hide the cause (e.g., to avoid leaking internals to a public API). Then `%v` or a fresh `errors.New` is appropriate.

---

## Use Cases

- **File operations** — wrapping `os.Open` errors with the path and operation name.
- **Database queries** — wrapping driver errors with the SQL operation.
- **HTTP clients** — wrapping low-level network errors with the URL and method.
- **JSON/YAML parsing** — wrapping decode errors with the source filename.
- **Multi-step pipelines** — each step adds its name to the chain so the final error reads like a breadcrumb.
- **Concurrent fan-out** — collecting all errors with `errors.Join` so the caller can see every failure.

---

## Code Examples

### Example 1: Wrapping with `%w`

```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func loadConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("load config %q: %w", path, err)
    }
    return data, nil
}

func main() {
    _, err := loadConfig("does-not-exist.json")
    if err != nil {
        fmt.Println("error:", err)
        fmt.Println("is os.ErrNotExist?", errors.Is(err, os.ErrNotExist))
    }
}
```

**What it does:** `loadConfig` wraps the underlying error with the operation and path. `errors.Is` still finds `os.ErrNotExist` even through the wrap.
**How to run:** `go run main.go`

### Example 2: `%v` vs `%w` side by side

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    base := io.EOF

    wrappedW := fmt.Errorf("read failed: %w", base)
    wrappedV := fmt.Errorf("read failed: %v", base)

    fmt.Println("wrappedW:", wrappedW)
    fmt.Println("wrappedV:", wrappedV)

    fmt.Println("errors.Is(wrappedW, io.EOF):", errors.Is(wrappedW, io.EOF))
    fmt.Println("errors.Is(wrappedV, io.EOF):", errors.Is(wrappedV, io.EOF))
}
```

**Output:**
```
wrappedW: read failed: EOF
wrappedV: read failed: EOF
errors.Is(wrappedW, io.EOF): true
errors.Is(wrappedV, io.EOF): false
```

The strings look identical — but only `%w` preserves identity.

### Example 3: `errors.Is` across multiple layers

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func dbLookup(id int) error {
    return fmt.Errorf("lookup id=%d: %w", id, ErrNotFound)
}

func service(id int) error {
    if err := dbLookup(id); err != nil {
        return fmt.Errorf("service: %w", err)
    }
    return nil
}

func main() {
    err := service(7)
    fmt.Println(err)
    fmt.Println("is ErrNotFound?", errors.Is(err, ErrNotFound))
}
```

The chain is `service → lookup → ErrNotFound`. `errors.Is` walks all the way down.

### Example 4: `errors.As` to extract a typed error

```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func main() {
    _, err := os.Open("/nope/does-not-exist.txt")
    if err == nil {
        return
    }

    var pathErr *fs.PathError
    if errors.As(err, &pathErr) {
        fmt.Println("op:", pathErr.Op)
        fmt.Println("path:", pathErr.Path)
        fmt.Println("inner:", pathErr.Err)
    }
}
```

`errors.As` finds the layer whose dynamic type is `*fs.PathError` and assigns it. Now you can read its fields.

### Example 5: Calling `errors.Unwrap` directly

```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    inner := errors.New("inner")
    outer := fmt.Errorf("outer: %w", inner)

    fmt.Println("outer:", outer)
    fmt.Println("unwrap once:", errors.Unwrap(outer))
    fmt.Println("unwrap twice:", errors.Unwrap(errors.Unwrap(outer)))
}
```

The second `Unwrap` returns `nil` — `inner` itself does not wrap anything.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Wrap on every propagation

```go
if err != nil {
    return fmt.Errorf("operation X: %w", err)
}
```

The simplest pattern. Each function adds one breadcrumb. The error message reads top-down like a stack trace made of words.

### Pattern 2: Wrap with the *interesting* parameter

```go
if err != nil {
    return fmt.Errorf("delete user id=%d: %w", id, err)
}
```

Adding the input lets the reader of the log answer "which one?" without rerunning the program.

### Pattern 3: Sentinel + wrap + `errors.Is`

```go
var ErrConflict = errors.New("conflict")

func save(u User) error {
    if alreadyExists(u) {
        return fmt.Errorf("save user %d: %w", u.ID, ErrConflict)
    }
    // ...
}

// caller
if errors.Is(err, ErrConflict) {
    // handle the conflict specifically
}
```

### Pattern 4: Typed error + wrap + `errors.As`

```go
type ValidationError struct {
    Field string
    Msg   string
}

func (v *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", v.Field, v.Msg)
}

// caller
var ve *ValidationError
if errors.As(err, &ve) {
    fmt.Println("bad field:", ve.Field)
}
```

### Pattern 5: Don't wrap in inner loops you don't need

```go
// BAD — wraps every iteration even when not needed
for _, item := range items {
    err := process(item)
    err = fmt.Errorf("loop: %w", err)  // wraps nil!
    if err != nil {
        return err
    }
}

// GOOD — only on failure
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("processing %v: %w", item, err)
    }
}
```

`fmt.Errorf` with `%w` and a nil argument produces a *non-nil* error. Wrapping unconditionally is wrong.

---

## Clean Code

- **Use `%w` by default.** Reach for `%v` only when you know exactly why you don't want the cause exposed.
- **One wrap per layer.** A function that wraps at every step inside itself produces an error message like "do: step1: substep1: subsubstep1: ..." — too noisy.
- **Lowercase first letter, no trailing punctuation.** Same rule as plain errors. `"load config %q: %w"`, not `"Load config %q: %w."`.
- **Put the cause last.** Convention: the wrapped `%w` argument is the last value in the format. Reads like English: "load config 'foo.json': open foo.json: no such file or directory."
- **Name the operation, not the file/line.** Wrap with what *you were doing* (`load config`, `delete user`) — not where in the code (`error in main.go line 24`). The path of operations is the breadcrumb.
- **`errors.Is` and `errors.As` over `==` and type assertions** for any error that *might* be wrapped. Once you adopt wrapping, `==` checks become unreliable.

---

## Product Use / Feature

A typical web service request that fails three layers deep:

```go
func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
    id := mux.Vars(r)["id"]
    if err := h.svc.Delete(r.Context(), id); err != nil {
        switch {
        case errors.Is(err, ErrNotFound):
            http.Error(w, "user not found", http.StatusNotFound)
        case errors.Is(err, ErrUnauthorized):
            http.Error(w, "forbidden", http.StatusForbidden)
        default:
            log.Printf("delete user %s: %v", id, err)
            http.Error(w, "internal error", http.StatusInternalServerError)
        }
        return
    }
    w.WriteHeader(http.StatusNoContent)
}

// Service
func (s *Service) Delete(ctx context.Context, id string) error {
    if err := s.repo.Delete(ctx, id); err != nil {
        return fmt.Errorf("svc.Delete %s: %w", id, err)
    }
    return nil
}

// Repository
func (r *Repo) Delete(ctx context.Context, id string) error {
    res, err := r.db.ExecContext(ctx, "DELETE FROM users WHERE id=$1", id)
    if err != nil {
        return fmt.Errorf("db delete: %w", err)
    }
    n, _ := res.RowsAffected()
    if n == 0 {
        return ErrNotFound
    }
    return nil
}
```

When the user does not exist, the handler sees `svc.Delete <id>: <something the repo wrapped>: ErrNotFound`. `errors.Is` finds the sentinel; the handler returns 404. The log line, if needed, has the full chain for debugging.

---

## Error Handling

This *is* the error-handling topic, but here are the meta-rules that come with wrapping:

- **Wrap once per layer, not per line.** If your function calls `step1`, `step2`, `step3`, you wrap each call's error — but you do not also wrap inside `step1` itself unless `step1` calls something else. One wrap per function boundary.
- **Don't double-wrap.** `fmt.Errorf("X: %w", fmt.Errorf("X: %w", err))` adds nothing. Add new context per layer; if you have nothing new to say, just `return err`.
- **Don't wrap a nil error.** `fmt.Errorf("X: %w", nil)` produces a non-nil error with the literal `"<nil>"` in it. Always check `if err != nil` first.
- **Translate at boundaries.** When an error leaves your package's API surface, decide: pass through wrapped, translate to a domain error, or convert to a fresh public error.

---

## Security Considerations

- **Wrapped errors expose more text.** If the inner error is `pq: relation "users" does not exist`, your wrap `fmt.Errorf("db: %w", err)` keeps that text reachable via `.Error()`. Anyone who logs or returns the error sees the inner. *Do not* return wrapped DB errors directly to clients.
- **PII in the wrap message.** `fmt.Errorf("user email %s: %w", email, err)` leaks an email into the log if someone logs the error. Wrap with IDs, not personal data.
- **Tokens and secrets.** Never wrap with `fmt.Errorf("auth token %s: %w", token, err)`. The token will end up in your logs.
- **Distinguish public vs internal.** A safe pattern: log the wrapped chain internally, return a stripped-down `errors.New("internal error")` to clients.

---

## Performance Tips

- A `%w` wrap allocates roughly 100–200 ns of work and one heap object (`*fmt.wrapError`). For normal request handling, invisible. For million-events-per-second hot loops, measurable — see `optimize.md`.
- Wrapping `nil` is wasteful — always guard with `if err != nil` first.
- `errors.Is` and `errors.As` are O(chain length). Long chains slow them down.
- Sentinels declared at package level (`var ErrFoo = errors.New("foo")`) are allocated *once*; comparisons against them via `errors.Is` are cheap.
- Chains do not capture stack traces by default — that is good for performance but you lose the file/line info. Use the wrap context (`"load config %q"`) as your breadcrumb.

---

## Best Practices

- **Always `%w`, never `%v`** unless you have a specific reason.
- **Always check `if err != nil`** before wrapping, never wrap an unconditional value.
- **Use `errors.Is` for sentinels, `errors.As` for typed errors.** Forget `==` and type assertions on potentially wrapped errors.
- **Name your operation in the wrap.** "load config" is a breadcrumb; "error" is noise.
- **Wrap at boundaries you cross**, not at every line.
- **Keep the wrap message short.** The chain itself adds length.
- **Test wrap behavior.** Write tests that assert `errors.Is(err, expected)` for known failure modes.

---

## Edge Cases & Pitfalls

- **`fmt.Errorf("%w", nil)`** — produces an error whose `.Error()` is `"%!w(<nil>)"`. The function returns a non-nil error. Always guard.
- **`%w` more than once before Go 1.20.** Pre-1.20, `fmt.Errorf("%w and %w", a, b)` returned a string-formatted result that wraps **only the first**. Since 1.20, multiple `%w` are valid and produce a multi-wrapper.
- **Unwrap on a non-wrapping error returns `nil`.** That is fine — it ends the chain.
- **`errors.Is` on a non-comparable error.** If a wrapped layer is a struct with a slice/map field, `==` panics. The fix: implement `Is(target error) bool` on the type to override the default comparison.
- **Custom `Unwrap` returning `nil`.** A bug in your type that breaks the entire chain.

---

## Common Mistakes

1. **`%v` instead of `%w`.** Silent loss of identity. Most common bug in the topic.
2. **Wrapping a nil error.** `fmt.Errorf("op: %w", err)` *without* an `if err != nil` guard.
3. **`err == ErrFoo`** when `err` is wrapped. Always false. Use `errors.Is`.
4. **Type-asserting** when you should `errors.As`. `e := err.(*MyErr)` panics on a wrapped error of the right type but inside another layer.
5. **Wrapping for the sake of wrapping.** Five layers of `fmt.Errorf("op: %w", err)` with no new context per layer. Pure noise.
6. **Forgetting `Unwrap()` on a custom error type.** Your custom wrap looks fine but `errors.Is` cannot see through it.
7. **Returning the typed nil pointer** as an interface — same trap as in plain error handling, exacerbated by wrapping.

---

## Common Misconceptions

- **"`%w` and `%v` produce different strings."** They produce *the same string*. They differ in whether the cause is reachable behind that string.
- **"Wrapping is expensive."** It is real cost (one allocation per wrap), but in normal services it is invisible compared to I/O.
- **"`errors.Unwrap` is the main API."** Almost no one calls it directly. You use `errors.Is` and `errors.As`, which call `Unwrap` internally.
- **"`errors.Is(err, nil)` is always false."** Actually, it is true if `err == nil`. Try not to depend on this — checking `err != nil` first is clearer.
- **"Once I wrap, I can't get the original back."** You always can — that is the point of wrapping.

---

## Tricky Points

- **Wrapping does not affect `.Error()`.** If you wrap `io.EOF` with `"X: %w"`, `err.Error()` is `"X: EOF"`. The string mentions the cause's text once, not twice.
- **`errors.Is(err, target)` calls `target.Is(err)` if `target` has an `Is` method? No.** It is the opposite — it walks `err` and on each layer asks "does *this layer* have an `Is(target) bool` method?" That layer's method overrides the equality check.
- **`errors.As` with the wrong target type compiles but panics at runtime.** The target must be a non-nil pointer to a type that implements `error`. The compiler does not enforce this; the function panics if you pass a wrong shape.
- **Multiple `%w` in Go 1.20+** produces an error whose `Unwrap()` returns `[]error`, not `error`. The chain is now a tree, and `errors.Is`/`errors.As` walk the whole tree.

---

## Test

```go
package wrapping

import (
    "errors"
    "fmt"
    "io"
    "testing"
)

func TestWrap_PreservesIdentity(t *testing.T) {
    wrapped := fmt.Errorf("layer A: %w", fmt.Errorf("layer B: %w", io.EOF))
    if !errors.Is(wrapped, io.EOF) {
        t.Fatalf("expected errors.Is(err, io.EOF) to be true")
    }
}

func TestWrap_VerbV_DropsIdentity(t *testing.T) {
    wrapped := fmt.Errorf("layer A: %v", io.EOF)
    if errors.Is(wrapped, io.EOF) {
        t.Fatalf("expected %%v to drop identity, but errors.Is found io.EOF")
    }
}

func TestUnwrap_OnLeaf_ReturnsNil(t *testing.T) {
    leaf := errors.New("leaf")
    if got := errors.Unwrap(leaf); got != nil {
        t.Fatalf("expected nil from Unwrap on leaf, got %v", got)
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What is the difference between `%w` and `%v` in `fmt.Errorf`?*
   `%w` wraps — the resulting error's `Unwrap()` returns the argument. `%v` formats the error as a string and discards the original.

2. *If I wrap an error, what does `.Error()` return?*
   The new format string with the cause's `.Error()` substituted in. `%w` and `%v` produce the same string output; they differ only in whether the cause is reachable.

3. *Can I have more than one `%w` in a single `fmt.Errorf`?*
   Since Go 1.20, yes. The result wraps multiple errors via an `Unwrap() []error` method.

4. *What does `errors.Unwrap(err)` return on a non-wrapping error?*
   `nil`. Plain errors made with `errors.New` are leaves of the chain.

5. *Why does `errors.Is(wrapped, io.EOF)` work but `wrapped == io.EOF` not?*
   `errors.Is` walks the chain; `==` compares only the outermost interface value, which is the wrapper, not the wrapped.

6. *Can I wrap a `nil` error?*
   You can, but the result is non-nil and contains the literal `"<nil>"`. Always `if err != nil` first.

---

## Cheat Sheet

```go
// Wrap
fmt.Errorf("op: %w", err)             // wraps err
fmt.Errorf("op: %v", err)             // does NOT wrap

// Unwrap
errors.Unwrap(err)                    // next link, or nil

// Compare by identity (sentinel)
errors.Is(err, ErrNotFound)           // walks chain

// Extract by type
var pe *fs.PathError
errors.As(err, &pe)                   // walks chain, assigns

// Multiple wraps (Go 1.20+)
fmt.Errorf("ctx: %w; %w", err1, err2)
errors.Join(err1, err2, err3)         // combines errors

// Custom wrapping type
type myErr struct{ msg string; cause error }
func (e *myErr) Error() string { return e.msg }
func (e *myErr) Unwrap() error { return e.cause }
```

---

## Self-Assessment Checklist

- [ ] I understand the difference between `%w` and `%v`.
- [ ] I can wrap an error in a function and unwrap it in a test.
- [ ] I can use `errors.Is` to check sentinel identity through a chain.
- [ ] I can use `errors.As` to extract a typed error from a chain.
- [ ] I know `%w` does not affect the `.Error()` string.
- [ ] I never compare wrapped errors with `==`.
- [ ] I know that wrapping a nil error produces a non-nil result.
- [ ] I can write a custom error type with an `Unwrap()` method.

---

## Summary

Error wrapping in Go means attaching context to an error while preserving the original. The mechanism is `fmt.Errorf("...: %w", err)` plus the `errors.Is`, `errors.As`, and `errors.Unwrap` helpers. The chain is a linked list of causes; `errors.Is` walks it for identity, `errors.As` walks it for type. The single most important rule: prefer `%w` over `%v` — they look the same in print, but only one of them lets the caller see the truth.

---

## What You Can Build

- A small library that loads JSON config files and returns errors that distinguish "file missing" (via `errors.Is(err, fs.ErrNotExist)`) from "file invalid" (via `errors.As` for `*json.SyntaxError`).
- A retry helper that retries only when the wrapped cause is transient (network timeout, 5xx) and gives up immediately on permanent errors.
- A request handler that classifies errors using `errors.Is` against a small set of domain sentinels and maps each to an HTTP status.

---

## Further Reading

- [Working with Errors in Go 1.13 (the Go Blog)](https://go.dev/blog/go1.13-errors)
- [Go 1.20 Release Notes — `errors.Join`](https://go.dev/doc/go1.20#errors)
- [Package errors documentation](https://pkg.go.dev/errors)
- Source code of the wrap implementation: `$GOROOT/src/fmt/errors.go`
- Source code of `errors.Is` / `errors.As`: `$GOROOT/src/errors/wrap.go`

---

## Related Topics

- [01-error-handling-basics](../01-error-handling-basics/junior.md) — the underlying `error` interface and idiom
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — `io.EOF` and friends
- [07-panic-and-recover](../07-panic-and-recover/junior.md) — for unrecoverable cases
- [02-error-interface](../02-error-interface/junior.md) — formal interface definition

---

## Diagrams & Visual Aids

```
fmt.Errorf("loading %q: %w", path, err)

   +--------------------------+
   | wrapError                |
   |   msg: "loading 'a.json':|
   |         no such file..." |
   |   err: ----------------+ |
   +-----------------------|--+
                           v
                    +-------------+
                    | os.PathError|
                    |  Op: "open" |
                    |  Path: ...  |
                    |  Err: ----+ |
                    +----------|--+
                               v
                        +-------------+
                        | syscall.ENOENT |
                        +-------------+
```

```
errors.Is walk:

   wrapped --Unwrap--> middle --Unwrap--> inner --Unwrap--> nil
       |                  |                 |
       v                  v                 v
   == target?        == target?        == target?
       |                  |                 |
       no                 no               yes -> return true
```

```
%w vs %v:

   %v: "ctx: original message"     <-- string only
   %w: "ctx: original message"     <-- string PLUS Unwrap() -> original
```
