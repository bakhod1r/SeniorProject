# Error Design — Best Practices — Junior Level

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
> Focus: "What does a good Go error look like?" and "How should I write one?"

By now you have written `errors.New`, `fmt.Errorf`, `%w`, custom types, sentinels, and `errors.Join`. Each one works in isolation. The problem is that a real codebase mixes them: one function returns a sentinel, another returns a typed error, a third wraps with `%w`, a fourth panics. Reading such code is exhausting because every call site needs different handling.

This file is the *style guide*. It pulls together the conventions that the Go community has settled on after fifteen years of arguing about errors. Most are small and unglamorous — lowercase first letter, no trailing dot, return don't panic — but together they make a codebase feel coherent.

The single sentence to remember: **errors are values, treat them like data, and design them as carefully as you design any other API**.

```go
// Bad
return errors.New("Error: User Not Found.")

// Good
return fmt.Errorf("user %d: %w", id, ErrUserNotFound)
```

The first looks like a panic message printed at someone. The second is data: a sentinel for kind, an ID for context, a wrapped chain that any handler can read.

After reading this file you will:
- Know the three shapes of Go errors and when to use each.
- Write error messages that compose into readable logs.
- Decide between `%w` (wrap), `%v` (interpolate), and "no decoration" at each call site.
- Distinguish a *programmer error* (panic) from an *operational error* (return).
- Avoid the most common anti-patterns: stringly-typed errors, double-logging, swallowing.

---

## Prerequisites

- **Required:** the `error` interface (covered in 5.2) and `errors.New` / `fmt.Errorf` (covered in 5.3 and 5.4).
- **Required:** wrapping with `%w` and `errors.Is` / `errors.As` (covered in 5.5 and 5.9).
- **Required:** sentinel errors (covered in 5.6).
- **Required:** custom error types (covered in 5.10).
- **Helpful but not required:** `panic`/`recover` (covered in 5.7) — you should know it exists, but in this file we mostly *avoid* using it.
- **Helpful but not required:** package-level design decisions in any non-trivial Go project.

---

## Glossary

| Term | Definition |
|------|-----------|
| **sentinel error** | A package-level `error` value compared by identity. `io.EOF` is the canonical example. |
| **typed error** | A struct that implements `error` and carries fields the caller can inspect. `*os.PathError` is one. |
| **opaque error** | An error returned only as `error`; the caller can read its message but not its kind. |
| **wrapping** | Embedding one error inside another so `errors.Is`/`errors.As` can walk the chain. `fmt.Errorf("...: %w", err)` is the standard form. |
| **operational error** | A failure that can happen during normal operation: I/O, network, validation. The right response is to return it. |
| **programmer error** | A bug that should not be possible: nil pointer where a value was promised, invalid index, broken invariant. The right response is often to panic. |
| **error kind / family** | A category of errors (e.g., "not found", "permission denied") usable across many call sites. |
| **stringly-typed** | Branching on the *text* of `err.Error()` instead of identity, type, or wrapping. An anti-pattern. |
| **`%w` verb** | The `fmt.Errorf` verb that wraps an error so the chain is walkable with `errors.Is`/`errors.As`. |
| **`%v` verb** | The default formatting verb. Interpolates the error's text but does not wrap. |

---

## Core Concepts

### Concept 1: The three shapes of errors

Dave Cheney's taxonomy from *Don't just check errors, handle them gracefully* maps every Go error to one of three shapes:

| Shape | What the caller can do | Example |
|-------|-----------------------|---------|
| **Sentinel** | Compare by identity (`errors.Is(err, X)`). | `io.EOF` |
| **Typed** | Inspect fields via `errors.As(err, &t)`. | `*os.PathError` |
| **Opaque** | Read the message only. | `errors.New("decode failed")` |

Each shape commits you to different things at the API boundary. Sentinels commit to identity; typed errors commit to a struct shape; opaque errors commit to nothing. The corollary: **start opaque, escalate only when callers actually need more**.

### Concept 2: Wrap to add context, not to add layers

`fmt.Errorf("op: %w", err)` is the standard way to add context. The rule is: **wrap with information the next reader cannot get for free**. The function name and file are already in the stack; the *what we were trying to do* and *which input* are not.

```go
// Useless wrap — adds no information
return fmt.Errorf("error: %w", err)

// Useful wrap
return fmt.Errorf("read user %d: %w", id, err)
```

### Concept 3: Error messages are sentences inside other sentences

A Go error message will be embedded inside a longer log line: `parse config: read /etc/x.conf: open /etc/x.conf: no such file or directory`. So:

- **Lowercase** the first letter.
- **No trailing punctuation** (no period, no exclamation point).
- **No "error:" prefix** — the reader knows it is an error.
- **Be specific**: include the entity, not just the failure type.

```go
// Bad
return errors.New("Could not connect to database!")

// Good
return errors.New("connect mysql: timeout after 5s")
```

### Concept 4: Programmer errors panic, operational errors return

| Failure | Response |
|---------|----------|
| File missing, network down, user input invalid | **return** an error |
| Nil pointer where the contract said non-nil | **panic** (it is a bug) |
| Index out of range on a slice the function owns | **panic** |
| Library invariant violated by caller misuse | **panic** with a clear message |
| Database row not found | **return** a sentinel |
| Required env var missing at startup | **panic** (or `log.Fatal`) — you cannot run anyway |

The dividing line: *can a sane caller handle this and continue?* If yes, return. If no, panic.

### Concept 5: Don't just check, handle

Boilerplate `if err != nil { return err }` is fine when you have nothing to add. Most of the time you *do* have something to add — a log line, a fallback, a wrap, a metric — and the boilerplate hides that you are missing the actual handling.

```go
// Worse: silently propagates
if err != nil {
    return err
}

// Better: adds context
if err != nil {
    return fmt.Errorf("validate cart: %w", err)
}

// Best: makes a decision
if err != nil {
    if errors.Is(err, ErrTransient) {
        return retry(ctx)
    }
    return fmt.Errorf("validate cart: %w", err)
}
```

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Sentinel** | A standardized form code: "404" means the same thing in every office, you don't read the paragraph below. |
| **Typed error** | A traffic ticket: it has structured fields (date, place, fine) you can act on programmatically. |
| **Opaque error** | A handwritten note saying "it didn't work" — only good for reading aloud. |
| **Wrapping with `%w`** | A tracking label that says "package returned by Alice; original sender Bob" — both names visible. |
| **Wrapping with `%v`** | Photocopying Bob's note onto Alice's stationery — Alice's text is now there, but Bob's identity is gone. |
| **Programmer vs operational error** | A flat tire (operational — handle it) vs the engine block being missing (programmer — call an expert). |
| **Stringly-typed errors** | Diagnosing your illness by Googling exact phrases from your doctor's voicemail. |

---

## Mental Models

**The receipt model.** An error is a receipt that travels up the call stack. Each layer that wraps adds a stamp: where, what, when. The top of the stack reads the receipt to decide what to print to the user, what to log, what to retry.

**The contract model.** Returning an error is part of a function's contract just like returning a value. `func F() (T, error)` says "I will give you T or I will tell you why I cannot." A change to the *kinds* of errors a function returns is a contract change — sometimes a breaking one.

**The data model.** Errors are not exceptions. They are not magical control-flow constructs. They are values you compare, inspect, store in slices, ship over the network. Treat them with the same attention you give any other type.

**The boundary model.** The most useful place to *handle* errors (decide what to do, log them, return user-facing messages) is the system boundary — the HTTP handler, the message-queue consumer, the CLI top-level. Below the boundary: wrap with context, propagate. At the boundary: log once, translate, respond.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Errors as values are visible in the type signature — no hidden control flow. | Idiomatic Go is verbose: `if err != nil { ... }` everywhere. |
| Sentinels and typed errors give callers exact handling power. | Picking the wrong shape locks the API into commitments you may regret. |
| `%w` chains let you preserve cause without stringy parsing. | Wrap-for-the-sake-of-wrapping creates noisy "error: error: error:" messages. |
| Returning means the caller decides — flexibility. | More design work up front than `throw new RuntimeException`. |
| The convention is uniform across the standard library. | Many codebases mix conventions; cleaning up requires team discipline. |

### When to use these practices:
- Every Go function returning `error`. There is no opt-out.
- Especially in libraries you expose to other packages or repositories.
- When designing a new error path in an existing codebase — bring it up to standard rather than copy old style.

### When NOT to obsess over them:
- One-off scripts and `cmd/` mains where a `log.Fatal(err)` is fine.
- Test helpers — `t.Fatalf("...: %v", err)` is enough; no design needed.
- Internal types that never escape the package; opaque is plenty.

---

## Use Cases

- **API boundary errors** — sentinel/typed for kinds; `%w` to preserve cause.
- **Validation errors** — typed errors with field name + reason, often returned as a list joined with `errors.Join`.
- **Storage errors** — `ErrNotFound` sentinel for "row missing"; opaque for the rest.
- **Network errors** — typed when the caller may want to retry, opaque otherwise.
- **CLI errors** — almost always opaque; users see the message, not the structure.
- **Background workers** — careful logging at the boundary, no double-logging upstream.

---

## Code Examples

### Example 1: A well-shaped error

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func lookup(id int) (string, error) {
    if id == 42 {
        return "Bakhodir", nil
    }
    return "", fmt.Errorf("lookup user %d: %w", id, ErrNotFound)
}

func main() {
    name, err := lookup(7)
    if err != nil {
        if errors.Is(err, ErrNotFound) {
            fmt.Println("user not found")
            return
        }
        fmt.Println("unexpected:", err)
        return
    }
    fmt.Println(name)
}
```

**What it does:** A package-level sentinel + a wrapped error with context. The caller can ask "is this a not-found?" via `errors.Is`.

### Example 2: A typed validation error

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field  string
    Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Reason)
}

func parseAge(s string) (int, error) {
    if s == "" {
        return 0, &ValidationError{Field: "age", Reason: "required"}
    }
    return 0, nil
}

func main() {
    _, err := parseAge("")
    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("invalid %s: %s\n", ve.Field, ve.Reason)
    }
}
```

**What it does:** Typed error so the caller can read the structured fields. `errors.As` extracts the typed value from anywhere in the chain.

### Example 3: A bad message vs a good one

```go
package main

import (
    "errors"
    "fmt"
)

func badMessages() error {
    return errors.New("Error: Failed to read file!")
}

func goodMessages(path string) error {
    return fmt.Errorf("read %s: %w", path, errors.New("permission denied"))
}

func main() {
    fmt.Println(badMessages())
    fmt.Println(goodMessages("/etc/secret"))
}
```

**What it does:** The first message is shouting. The second composes naturally with whatever wrap context the caller adds.

### Example 4: Programmer error → panic

```go
package main

import "fmt"

// Set must never receive a nil map. That is a programmer mistake.
func Set(m map[string]int, k string, v int) {
    if m == nil {
        panic("Set: nil map")
    }
    m[k] = v
}

func main() {
    m := map[string]int{}
    Set(m, "a", 1)
    fmt.Println(m)
}
```

**What it does:** The function panics on a precondition violation rather than returning an error — because no caller can recover from "you passed me a nil map you were supposed to allocate".

### Example 5: Operational error → return

```go
package main

import (
    "errors"
    "fmt"
)

var ErrTimeout = errors.New("timeout")

func fetch(url string) ([]byte, error) {
    return nil, fmt.Errorf("fetch %s: %w", url, ErrTimeout)
}

func main() {
    _, err := fetch("https://example.com")
    if errors.Is(err, ErrTimeout) {
        fmt.Println("retry later")
    }
}
```

**What it does:** A network timeout is something callers can handle (retry, fall back). Returning the error gives them the choice.

### Example 6: Don't double-log

```go
package main

import (
    "errors"
    "fmt"
    "log"
)

func step() error { return errors.New("connect refused") }

func handlerBad() {
    if err := step(); err != nil {
        log.Println("step failed:", err)
        // and now the caller logs again upstream
    }
}

func handlerGood() error {
    if err := step(); err != nil {
        return fmt.Errorf("setup: %w", err)
    }
    return nil
}

func main() {
    handlerBad()
    if err := handlerGood(); err != nil {
        log.Println("top-level:", err)
    }
}
```

**What it does:** Lower layers wrap and return. Logging happens once, at the top. No duplicate lines, no wondering whose log line came first.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Wrap with operation context

```go
func Load(path string) (*Config, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, fmt.Errorf("load %s: %w", path, err)
    }
    defer f.Close()
    return parse(f)
}
```

The wrap names the operation (`load`) and the input (`path`). When the inner `os.Open` says `no such file or directory`, the outer message reads cleanly: `load /etc/x.conf: open /etc/x.conf: no such file or directory`.

### Pattern 2: Sentinel for kind, message for context

```go
var ErrNotFound = errors.New("not found")

func GetUser(id int) (*User, error) {
    if id == 0 {
        return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    // ...
    return nil, nil
}
```

The caller checks `errors.Is(err, ErrNotFound)` to handle the kind; the message gives a human the specifics.

### Pattern 3: Typed error for structured handling

```go
type RetryableError struct {
    After time.Duration
    Cause error
}

func (e *RetryableError) Error() string { return e.Cause.Error() }
func (e *RetryableError) Unwrap() error { return e.Cause }
```

When the caller catches a `*RetryableError`, it knows *how long to wait* — information you cannot encode in a sentinel.

### Pattern 4: Don't both log and return

```go
// Bad
if err != nil {
    log.Println(err)
    return err
}

// Good — return, let the caller decide what to log
if err != nil {
    return err
}
```

Logging is a *handling decision*. Lower layers should not make it.

### Pattern 5: Decide once, at the boundary

```go
func handler(w http.ResponseWriter, r *http.Request) {
    err := business(r)
    switch {
    case err == nil:
        w.WriteHeader(200)
    case errors.Is(err, ErrNotFound):
        http.Error(w, "not found", 404)
    case errors.Is(err, ErrUnauthorized):
        http.Error(w, "unauthorized", 401)
    default:
        log.Printf("internal: %v", err)
        http.Error(w, "internal error", 500)
    }
}
```

Below this point, `business` and its callees *only* wrap and propagate. The boundary translates errors into HTTP status codes.

---

## Clean Code

- **Lowercase, no trailing punctuation** in messages. Log lines compose naturally.
- **Wrap with `%w` only when you mean it.** If you do not need `errors.Is`/`errors.As` to walk the chain, `%v` is fine and slightly cheaper. (See `optimize.md`.)
- **Name your sentinels `ErrSomething`.** Standard convention, easy to grep.
- **Group your error declarations** at the top of the package's main file.
- **One sentinel per kind**, not one per call site. Reuse `ErrNotFound` everywhere it applies.
- **Do not embed runtime data in sentinels.** A sentinel is a constant — its identity is what matters.
- **Handle errors as soon as you can.** Every layer of "and then I returned the same error" is wasted code.

---

## Product Use / Feature

A typical request flowing through a service hits errors at multiple layers:

```go
// storage layer
func (r *Repo) GetUser(ctx context.Context, id int64) (*User, error) {
    var u User
    err := r.db.QueryRowContext(ctx, "...", id).Scan(&u)
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
    case err != nil:
        return nil, fmt.Errorf("query user %d: %w", id, err)
    }
    return &u, nil
}

// service layer
func (s *Service) Get(ctx context.Context, id int64) (*UserDTO, error) {
    u, err := s.repo.GetUser(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("get user: %w", err)
    }
    return toDTO(u), nil
}

// handler layer
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
    id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
    dto, err := h.svc.Get(r.Context(), id)
    switch {
    case errors.Is(err, ErrNotFound):
        http.Error(w, "user not found", 404)
    case err != nil:
        log.Printf("get user %d: %v", id, err)
        http.Error(w, "internal error", 500)
    default:
        json.NewEncoder(w).Encode(dto)
    }
}
```

The storage knows about `sql.ErrNoRows`; it translates to the *service-level* `ErrNotFound` so the rest of the system never sees the `sql` import. The handler is the only layer that decides HTTP status codes.

---

## Error Handling

- **Always check `err`.** A `_ = f()` on a function that returns `error` is a code smell unless commented.
- **Do not swallow** — at minimum, log; better, propagate.
- **Don't `panic` to skip error handling.** Panicking is for *unrecoverable* states, not for "I don't want to write `if err != nil`."
- **Use `errors.Is` for sentinels, `errors.As` for typed errors.** Type assertions still work but break under wrapping.
- **Treat `nil` errors specially.** Some patterns (returning `(*T)(nil)` as an `error`) accidentally produce a non-nil interface from a nil concrete value — see `find-bug.md`.
- **Decide what is recoverable** at design time, not at panic time.

---

## Security Considerations

- **Errors are not for users.** A raw error message can leak file paths, table names, hostnames, even secret contents. Translate at the boundary.
- **Avoid embedding secrets in error messages.** `fmt.Errorf("login %s/%s: %w", user, pass, err)` writes a password into your logs.
- **Log internally, sanitize externally.** The internal log gets the full chain; the user gets `"internal error"` and a request ID.
- **Stable error identities are public API.** If you export `ErrUserBanned`, an attacker can use the response shape to enumerate banned users. Sometimes the right answer is to map several internal errors to one external one.
- **Errors in API responses should not include stack traces** — see topic 8 for that conversation.

---

## Performance Tips

- **`errors.New` at package level is free per-call.** Used as a sentinel, no allocation per use.
- **`fmt.Errorf` allocates.** Each wrap allocates the wrapping struct + the formatted string. For high-frequency error paths (parsers, validators), consider an opaque sentinel and skip the wrap.
- **`%w` is slightly more expensive than `%v`** because it stores a reference to the wrapped error. Use it when you need the chain; `%v` is fine when you do not.
- **`errors.Join` allocates a slice.** Acceptable for batch validation; not for hot loops.
- **Type switches and `errors.As` are fast** but `errors.As` walks the chain — depth matters.

---

## Best Practices

- **Start opaque; escalate to typed/sentinel only when callers need it.**
- **One sentinel per kind, defined in one package.**
- **Wrap with operation + relevant identifier, not boilerplate.**
- **Lowercase messages, no trailing punctuation, no "error:" prefix.**
- **Log once, at the boundary.**
- **Do not return both a value and an error and expect the caller to know which to use.** Clear contract: error means the value is meaningless.
- **Test the *kind*, not the *string*.** Brittle string matching breaks the moment someone improves a message.
- **Document errors in the function comment.** "Returns `ErrNotFound` if the user does not exist."
- **Treat error contracts as API.** Adding/removing a sentinel can break callers — version accordingly.

---

## Edge Cases & Pitfalls

- **The typed-nil pitfall.** `var p *MyErr; return p` returns a non-nil `error` interface even though the concrete pointer is nil — because the interface stores the *type* tag.

```go
var p *MyErr  // nil pointer
var e error = p
fmt.Println(e == nil) // false
```

  Avoid by returning `nil` directly when there is no error.

- **`errors.Is` requires `Unwrap`.** A custom error that does not implement `Unwrap()` will not match its inner cause via `Is`.
- **Sentinels with `fmt.Errorf` lose identity.** `fmt.Errorf("oh no: %v", ErrNotFound)` does *not* preserve the chain; use `%w`.
- **`errors.As` panics on a non-pointer target.** The argument must be `*T` where `T` is your error type.
- **Message order in `errors.Join`** is the order you joined; not sorted.
- **Returning a fresh `errors.New(...)` instead of a sentinel** breaks `errors.Is`. Use the sentinel.

---

## Common Mistakes

1. **Returning `errors.New("error: foo")`** — adds noise; readers know it is an error.
2. **Capitalizing the first letter** of an error message: `"Could not connect"`.
3. **Trailing punctuation**: `"failed to read."` — composes badly.
4. **Comparing with `err.Error() == "..."`** — a single message edit breaks every caller.
5. **Wrapping just to wrap**: `fmt.Errorf("error: %w", err)` adds nothing.
6. **Logging *and* returning** the same error — duplicate lines in production logs.
7. **Panicking on operational failures** (a missing file, a network timeout).
8. **Returning operational errors as panics** (`panic(err)`) and recovering at every layer.
9. **Exporting a sentinel that does not need to be public** — every export is a commitment.
10. **Using `%v` when you meant `%w`** — silently breaks `errors.Is`.

---

## Common Misconceptions

- **"Wrapping every layer makes things easier to debug."** Up to a point. Five wraps with the same boilerplate read worse than two with information.
- **"Sentinels are always the right answer."** Sentinels are great for *families* of errors, not for one-off contexts. A unique error message wrapped over `%w` is often enough.
- **"You should never panic."** False. Panic is correct for programmer errors. The rule is "do not panic in *operational* paths."
- **"Errors should be silent if you don't want to handle them."** A silent error is a deferred bug. Log or propagate.
- **"`errors.Is` only works with sentinels."** Any error with a custom `Is(target error) bool` method works. Same for `errors.As` and the `As` method.

---

## Tricky Points

- **Sentinel-vs-typed is a tradeoff between identity and structure.** Sentinels are simpler; typed errors carry more data; `Is`-based families let you have both.
- **`Unwrap()` matters even if you do not think you need it.** Your callers will use `errors.Is`/`errors.As`; if your custom type does not implement `Unwrap()`, you have broken the chain.
- **Two errors with the same message are not equal.** `errors.New("x") != errors.New("x")`. That is *the point* of using `errors.Is` against a sentinel.
- **`%w` requires exactly one wrapped error in Go 1.20.** With Go 1.20+, multiple `%w` verbs are allowed and produce a multi-error. Earlier code may break.
- **An exported sentinel is a public API.** Renaming, removing, or changing its value is a breaking change.

---

## Test

```go
package store

import (
    "errors"
    "testing"
)

var ErrNotFound = errors.New("not found")

func find(id int) (string, error) {
    if id == 42 {
        return "Bakhodir", nil
    }
    return "", ErrNotFound
}

func TestFindMissing(t *testing.T) {
    _, err := find(7)
    if !errors.Is(err, ErrNotFound) {
        t.Fatalf("want ErrNotFound, got %v", err)
    }
}

func TestFindOK(t *testing.T) {
    name, err := find(42)
    if err != nil {
        t.Fatalf("unexpected: %v", err)
    }
    if name != "Bakhodir" {
        t.Fatalf("got %q", name)
    }
}
```

Run with: `go test ./...`

The point: assert on identity (`errors.Is`), not on string content. The test stays green when someone improves the message.

---

## Tricky Questions

1. *When should I use a sentinel vs a typed error vs an opaque error?*
   Sentinel for a fixed kind; typed when callers need fields; opaque when the caller will only display it.

2. *What is the difference between `%w` and `%v` in `fmt.Errorf`?*
   `%w` wraps so `errors.Is`/`errors.As` can walk the chain. `%v` interpolates the message but does not wrap. Use `%w` whenever the caller might want to identify the cause.

3. *Why is `errors.New("Error: ...")` bad style?*
   The "Error:" prefix is redundant (the reader knows it is an error), capitalization composes badly into wrap chains, and trailing punctuation reads awkwardly mid-sentence.

4. *Should a library panic or return an error when given a nil argument?*
   If the function's contract requires non-nil and a nil is a programming bug, panic. If nil is a legitimate "no value" case, return an error.

5. *How do you stop one error message from being logged twice?*
   Either log or return — never both. The boundary (HTTP handler, worker top, CLI main) is the only layer that logs.

6. *What is the fastest way to compare against an error kind?*
   `errors.Is(err, sentinel)` is the standard. For a single-level chain it is one pointer comparison; for deeper chains it walks `Unwrap()` and is still O(depth).

---

## Cheat Sheet

```go
// Sentinel
var ErrNotFound = errors.New("not found")

// Wrap with context
return fmt.Errorf("read user %d: %w", id, err)

// Check kind
if errors.Is(err, ErrNotFound) { ... }

// Extract typed
var ve *ValidationError
if errors.As(err, &ve) { ... }

// Multiple errors
return errors.Join(err1, err2, err3)

// Custom error
type MyErr struct { Field string }
func (e *MyErr) Error() string { return e.Field + ": bad" }
```

```go
// Style
"open /etc/x.conf: permission denied"   // good
"Error: Failed to open /etc/x.conf!"   // bad

// Programmer error
panic("Set: nil map")

// Operational error
return fmt.Errorf("connect: %w", ErrTimeout)
```

---

## Self-Assessment Checklist

- [ ] I know the three shapes of Go errors and when to choose each.
- [ ] My error messages are lowercase, with no trailing punctuation, no "error:" prefix.
- [ ] I wrap with `%w` only when I want the chain to be walkable.
- [ ] I include operation + identifier in wrap messages.
- [ ] I distinguish programmer errors (panic) from operational errors (return).
- [ ] I log errors at one place — the boundary — not at every layer.
- [ ] I use `errors.Is` for sentinels and `errors.As` for typed errors, never string matching.
- [ ] I avoid the typed-nil pitfall by returning `nil` directly.
- [ ] I treat exported error values as public API.
- [ ] I do not panic in business logic to dodge `if err != nil`.

---

## Summary

Good Go errors look the same everywhere. They are lowercase sentences without trailing punctuation. They wrap with `%w` only when the chain matters. They come in three shapes — sentinel, typed, opaque — and the choice is part of the API. Programmer errors panic; operational errors return. Lower layers add context; the boundary decides what to log and what to show. Errors are values, not exceptions, and designing them well means treating them with the same care as the rest of your types. Almost every "bad" error you see in real code violates one of three rules: capitalize the message, log-and-return, or panic instead of return.

---

## What You Can Build

- A small `errs` helper package for your own service: `errs.NotFound`, `errs.Invalid`, `errs.Internal` sentinels and a `Wrap` helper.
- A `linter` rule (or `golangci-lint` config) that flags capitalized error strings and trailing dots.
- A request-bound error logger that records exactly one log line per request, not one per layer.
- A boundary translator that maps internal error kinds to HTTP status codes and clean user-facing messages.

---

## Further Reading

- [Dave Cheney — Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Go Wiki — Errors](https://github.com/golang/go/wiki/CodeReviewComments#error-strings)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Russ Cox — Error syntax for Go](https://research.swtch.com/go-errors)
- [The Go Programming Language](https://www.gopl.io/) — Chapter on errors

---

## Related Topics

- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w` and the chain
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — when sentinels are right
- [09-errors-is-vs-as-deep](../09-errors-is-vs-as-deep/junior.md) — chain inspection
- [10-custom-error-types](../10-custom-error-types/junior.md) — typed errors in depth
- [11-errors-join](../11-errors-join/junior.md) — multi-error aggregation
- [13-handle-dont-just-check](../13-handle-dont-just-check/junior.md) — what handling really means

---

## Diagrams & Visual Aids

```
        +----------------+
        |    Caller      |
        +-------+--------+
                | err
                v
   +------------+-------------+
   |        Boundary          |  <-- log here, translate here
   |  (HTTP, RPC, CLI, queue) |
   +------------+-------------+
                | wrapped err
                v
       +--------+--------+
       |   Service       |     <-- wrap with op
       +--------+--------+
                | wrapped err
                v
       +--------+--------+
       |   Storage       |     <-- translate sql.ErrNoRows -> ErrNotFound
       +-----------------+
```

```
Sentinel       Typed             Opaque
-----------    -----------       -----------
errors.Is      errors.As         err.Error()
identity       structure         message only
io.EOF         *os.PathError     errors.New("...")
```

```
Wrap chain (errors.Is walk):

[handler err] -- Unwrap --> [service err] -- Unwrap --> [storage err] -- Unwrap --> [ErrNotFound]
                                                                                       ^
                                                                              identity match here
```
