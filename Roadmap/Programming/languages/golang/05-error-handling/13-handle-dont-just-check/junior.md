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

# Handle, Don't Just Check — Junior Level

## Introduction
> Focus: "What does it mean to *handle* an error?" and "Why is `if err != nil { return err }` not enough?"

Open any first-week-of-Go project and you will see the same shape repeated dozens of times:

```go
x, err := step1()
if err != nil {
    return err
}
y, err := step2(x)
if err != nil {
    return err
}
z, err := step3(y)
if err != nil {
    return err
}
return finish(z)
```

That code passes review at most companies. It even works. But Dave Cheney pointed out, in a famous 2016 essay, that this is **not error handling** — it is *error checking*. We checked that `err != nil`. We did nothing about it. We just sent it upstairs and hoped someone else would.

Sometimes that is the right answer. Often it is not. The difference between a program that is comfortable to debug and one that is impossible to debug usually lies in the line that comes *between* the check and the return — the line where you decide what to actually *do*.

This file is about that decision. After reading it you will:

- Understand the difference between *checking* and *handling* an error
- Know the small set of decisions you can make when an error appears (retry, log, recover, transform, surface, abort)
- Be able to keep your **happy path** straight and your error paths short
- Recognise when "return the error" is correct and when it is lazy
- Have a feeling for *where* in your program errors should actually be handled

```go
// Reflex (just checks)
if err != nil { return err }

// Handling (decides)
if err != nil {
    if errors.Is(err, fs.ErrNotExist) {
        return defaults, nil           // recover
    }
    return nil, fmt.Errorf("load config: %w", err)  // surface with context
}
```

That second block does work. The first one passes the buck.

---

## Prerequisites

- **Required:** the `error` interface and how functions return errors (covered in 5.1, 5.2).
- **Required:** `fmt.Errorf("...: %w", err)` for wrapping (covered in 5.4, 5.5).
- **Required:** `errors.Is` and `errors.As` for inspecting an error (covered in 5.5, 5.9).
- **Helpful:** sentinel errors and how to compare them (covered in 5.6).
- **Helpful:** `panic`/`recover` (covered in 5.7) — you need to know when to escalate.

---

## Glossary

| Term | Definition |
|------|-----------|
| **check** | Test whether `err != nil` and branch on the result. |
| **handle** | *Decide* what to do about a non-nil error: retry, log, transform, recover, surface, abort. |
| **surface** | Return the error to the caller (with or without context). |
| **swallow** | Silently discard the error. Almost always a bug. |
| **transform** | Convert the error into a different one — e.g. mapping an internal error to an HTTP status code. |
| **happy path** | The straight-line code that runs when nothing fails. |
| **boundary** | A layer or interface where the meaning of errors changes (HTTP, gRPC, package public API). |
| **idempotent** | An operation that produces the same result whether you call it once or many times. Safe to retry. |
| **circuit breaker** | A switch that "opens" after repeated failures to a downstream service so we stop hitting it. |
| **degraded mode** | Continuing to serve requests with reduced functionality after a non-critical dependency fails. |
| **panic** | An unrecoverable runtime error. The runtime prints a stack trace; only `recover` catches it. |

---

## Core Concepts

### Concept 1: Checking vs handling

A *check* asks one question: is `err` nil? A *handle* answers a different one: *now what?* Check is reflex; handle is decision. The common shape `if err != nil { return err }` is a check followed by the laziest possible handling: pass it on. That is sometimes correct — but only when you have *no better answer*.

### Concept 2: The six decisions

When an error appears, you have a small menu of things to do:

| Decision | What it looks like | When to use |
|----------|--------------------|-------------|
| **Recover** | Return a default, fall back to a cache, ignore | The error is expected and you have a sane default |
| **Retry** | Try again (often with backoff) | The operation is idempotent and the failure is transient |
| **Transform** | Wrap with context, change type, map to status | At a boundary, especially API/transport edges |
| **Surface** | `return err` (or `return fmt.Errorf("ctx: %w", err)`) | You cannot decide here; the caller knows more |
| **Log** | Record and continue | This goroutine has nowhere to surface; the error matters but is not fatal |
| **Abort** | Panic or `os.Exit` | Programmer error or unrecoverable invariant violation |

Every `if err != nil { ... }` should pick one of these *consciously*. "Surface" is fine; "I did not think about it" is not.

### Concept 3: Handle once

A common bug is to *both* log an error *and* return it. The next layer logs it again. By the time it reaches the top there are five copies of the same line in the log. The rule is: **log OR return, not both.** Either you decide now (log it because the caller does not need to know), or you let the caller decide (return it without logging). One owner per error.

### Concept 4: The happy path stays straight

Idiomatic Go pulls error branches *out* of the main flow. The reader follows the success story top-to-bottom; failures peel off to the right and disappear. Compare:

```go
// Hard to read: success buried inside indentation
if x, err := step1(); err == nil {
    if y, err := step2(x); err == nil {
        if z, err := step3(y); err == nil {
            return finish(z)
        } else { return nil, err }
    } else { return nil, err }
} else { return nil, err }
```

```go
// Idiomatic: happy path stays at the left margin
x, err := step1()
if err != nil { return nil, err }
y, err := step2(x)
if err != nil { return nil, err }
z, err := step3(y)
if err != nil { return nil, err }
return finish(z), nil
```

Cheney's point about verbosity: yes, the second version has more `if err != nil` lines. They are the price you pay for a flat happy path. Every other indentation strategy hides the success story.

### Concept 5: Where to handle

Errors are most useful where you have *enough information* to do something about them. That is sometimes the deepest layer (a `os.IsNotExist` check next to the `os.Open` call), sometimes the middle (a retry loop in the storage adapter), and sometimes the top (a recovery middleware that turns any panic into HTTP 500). The right place depends on *who knows what*.

A senior heuristic: **handle as close to the source as possible while still having enough information.** Push the decision down until the function losing context, then handle there.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Check** | A smoke alarm that beeps. It tells you something is wrong. It does not put the fire out. |
| **Handle** | A sprinkler system that beeps *and* douses the fire. It decided what to do about the smoke. |
| **Retry** | Trying the door handle a second time after a wobble — sometimes the lock just sticks. |
| **Recover** | Bringing your own water to a restaurant whose kitchen is closed — the meal continues with a default. |
| **Transform** | A receptionist taking a complaint in plain English and filing a structured ticket for IT. |
| **Surface** | A junior teller who cannot resolve the issue and routes you to a manager who can. |
| **Log OR return** | Two officers writing a report for the same incident — one of them should keep quiet. |
| **Happy path straight** | A highway: you can see for miles. Branches peel off to the side; you stay on the road. |
| **Handle at boundary** | Customs: every package gets translated into the local language at the border. |

---

## Mental Models

**The "decide or surface" model.** Every `if err != nil` is a fork. You either *decide* (act locally) or *surface* (delegate to your caller). The interesting design question is which one. Programs that always decide are fragile (they swallow what they should not). Programs that always surface are confusing (an error that bubbles ten layers loses its context). Real code mixes both, deliberately.

**The "context budget" model.** Each error has a budget for context — message strings, tags, wraps. As an error rises, layers add context: `read config`, then `start service`, then `boot`. The user-visible message becomes a path, like a directory: `boot → start service → read config → permission denied`. Spend the budget at layers where the *next* reader will not know. Skip layers where the wrap adds nothing.

**The "happy path is sacred" model.** Imagine your function as a story. The happy path is the plot. Errors are detours. The reader should be able to read the plot without ever following the detours. Every line of indentation that is not a loop or a real conditional clouds the plot.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Forces the writer to think about each failure. | More text on the page than try/catch languages. |
| Errors are values; you can decide locally. | Easy to be lazy and just `return err`. |
| Easy to test — failure paths are explicit branches. | Easy to log + return and double the noise. |
| Composable — a handler can wrap any function. | Without discipline, message chains become nonsense. |
| No hidden control flow (no exceptions). | Forgetting to handle is silent — the compiler can't detect "I forgot to decide." |

### When to use:
- Every operation that can fail and *isn't* a programmer error.
- File I/O, network calls, parsing, deserialisation, DB queries, RPC.

### When NOT to use:
- *Programmer errors* — out-of-bounds slice access, nil dereferences. Those should panic.
- Conditions you cannot recover from anywhere — "config file missing at boot" can simply panic at startup.

---

## Use Cases

- **Loading configuration** — file missing? fall back to defaults *or* fail fast at startup.
- **Calling a downstream service** — transient timeout? retry with backoff. Auth? fail loudly.
- **Database operations** — transaction conflict? retry. Foreign key violation? user error, surface.
- **HTTP/RPC handlers** — domain error? map to status code. Internal? log stack and 500.
- **Background workers** — every iteration's panic must be recovered to keep the worker alive.
- **CLI tools** — print useful messages, exit with the right code, no stack trace at the user.

---

## Code Examples

### Example 1: The reflex (and why it is incomplete)

```go
package main

import (
    "fmt"
    "os"
)

func loadConfig() ([]byte, error) {
    data, err := os.ReadFile("config.json")
    if err != nil {
        return nil, err
    }
    return data, nil
}

func main() {
    data, err := loadConfig()
    if err != nil {
        fmt.Println("error:", err)
        os.Exit(1)
    }
    fmt.Println(string(data))
}
```

**What it does:** loads a file. If anything fails, the user sees `open config.json: no such file or directory`. Acceptable for a tiny CLI; **lazy** for anything bigger because we lost the chance to handle "missing → use defaults" right where the information was.

### Example 2: Recover with a default

```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

type Config struct {
    Port int
}

func loadConfig() (Config, error) {
    data, err := os.ReadFile("config.json")
    if errors.Is(err, fs.ErrNotExist) {
        return Config{Port: 8080}, nil // recover with a default
    }
    if err != nil {
        return Config{}, fmt.Errorf("read config: %w", err)
    }
    _ = data // pretend we parsed it
    return Config{Port: 9090}, nil
}

func main() {
    cfg, err := loadConfig()
    if err != nil {
        fmt.Println("fatal:", err)
        os.Exit(1)
    }
    fmt.Println("port:", cfg.Port)
}
```

**What it does:** when the file is missing we *handle* the error by returning a sane default. Other failures (permission denied, disk error) are surfaced with context.

### Example 3: Retry on transient failure

```go
package main

import (
    "errors"
    "fmt"
    "math/rand"
    "time"
)

var errTransient = errors.New("transient")

func flakyCall() error {
    if rand.Intn(3) != 0 {
        return errTransient
    }
    return nil
}

func withRetry(op func() error, attempts int) error {
    var err error
    for i := 0; i < attempts; i++ {
        if err = op(); err == nil {
            return nil
        }
        if !errors.Is(err, errTransient) {
            return err
        }
        time.Sleep(time.Duration(50*(i+1)) * time.Millisecond)
    }
    return fmt.Errorf("after %d attempts: %w", attempts, err)
}

func main() {
    if err := withRetry(flakyCall, 5); err != nil {
        fmt.Println("gave up:", err)
        return
    }
    fmt.Println("succeeded")
}
```

**What it does:** retries only the errors we can retry, surfaces the rest. The decision to retry is made *at the source* because the storage adapter is the only one who knows whether `errTransient` is even possible.

### Example 4: Transform at a boundary

```go
package main

import (
    "errors"
    "fmt"
    "net/http"
)

var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)

func getUser(id int) error {
    if id == 0 {
        return ErrNotFound
    }
    return nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    err := getUser(0)
    switch {
    case errors.Is(err, ErrNotFound):
        http.Error(w, "user not found", http.StatusNotFound)
    case errors.Is(err, ErrConflict):
        http.Error(w, "conflict", http.StatusConflict)
    case err != nil:
        http.Error(w, "internal error", http.StatusInternalServerError)
    default:
        fmt.Fprintln(w, "ok")
    }
}

func main() {
    http.HandleFunc("/", handler)
    fmt.Println("listening on :8080")
    _ = http.ListenAndServe(":8080", nil)
}
```

**What it does:** The HTTP boundary translates domain errors into HTTP status codes. The domain layer keeps its own vocabulary (`ErrNotFound`); the transport layer translates. *Each layer handles in its own language.*

### Example 5: The happy path stays straight

```go
package main

import (
    "fmt"
    "strconv"
)

func parsePoint(sx, sy string) (int, int, error) {
    x, err := strconv.Atoi(sx)
    if err != nil {
        return 0, 0, fmt.Errorf("x: %w", err)
    }
    y, err := strconv.Atoi(sy)
    if err != nil {
        return 0, 0, fmt.Errorf("y: %w", err)
    }
    return x, y, nil
}

func main() {
    x, y, err := parsePoint("3", "4")
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println("point:", x, y)
}
```

**What it does:** No nested `if err == nil`. The error branches each return immediately. The success story is six lines starting at column 1.

> Every example above is runnable. Save as `main.go` and `go run`.

---

## Coding Patterns

### Pattern 1: Decide then return

```go
v, err := op()
if err != nil {
    if errors.Is(err, ErrNotFound) {
        return Default, nil
    }
    return Zero, fmt.Errorf("op: %w", err)
}
```

Decision happens *first*. Only after deciding do we either recover or surface.

### Pattern 2: Wrap with the operation name

```go
if err != nil {
    return fmt.Errorf("load user %d: %w", id, err)
}
```

Each layer adds *what it was doing* and *which entity*. Avoid generic wraps like "error" or "failed".

### Pattern 3: Log OR return, never both

```go
// In a layer that decides
if err := flushCache(); err != nil {
    log.Printf("cache flush failed: %v", err) // we own this
    // do not return — flushing is best-effort
}

// In a layer that surfaces
data, err := readUser(id)
if err != nil {
    return nil, err // do not also log; caller will
}
```

The boundary that *owns* the error logs. Every other layer just passes it.

### Pattern 4: The errWriter (deferred error checking)

```go
type errWriter struct {
    w   io.Writer
    err error
}

func (ew *errWriter) write(p []byte) {
    if ew.err != nil {
        return
    }
    _, ew.err = ew.w.Write(p)
}

func writeMessage(w io.Writer) error {
    ew := &errWriter{w: w}
    ew.write([]byte("hello "))
    ew.write([]byte("world\n"))
    return ew.err
}
```

When you have a long string of operations that all return the same kind of error, capture it in a small struct and check at the end. From Rob Pike's "errors are values" essay.

### Pattern 5: The early return idiom

Always return early on errors. Never use `if err == nil { ... } else { ... }` — flip the condition.

```go
// Yes
if err != nil { return err }
useResult(...)

// No
if err == nil { useResult(...) } else { return err }
```

---

## Clean Code

- Treat each `if err != nil` as a small design decision, not a reflex.
- Wrap errors with **context that the caller cannot reconstruct** (file name, user ID, op name).
- Do **not** wrap with the same word the caller will add ("query", then "query", then "query").
- Keep error messages **lowercase and without trailing punctuation** — convention from `Effective Go`.
- Use sentinels (`var ErrFoo = errors.New("foo")`) for *expected* error kinds, custom types for ones that carry data.
- Reserve `panic` for impossible states. If your library panics on bad input, callers cannot decide; they have to crash with you.

---

## Product Use / Feature

A small backend handler illustrates every decision you have to make in real code:

```go
func ChargeOrder(ctx context.Context, orderID string) error {
    order, err := db.GetOrder(ctx, orderID)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return ErrOrderNotFound // surface a domain error
        }
        return fmt.Errorf("get order %s: %w", orderID, err) // surface with context
    }

    if order.Paid {
        return nil // recover: idempotent — already done, no work needed
    }

    if err := stripe.Charge(ctx, order.Amount); err != nil {
        if isTransient(err) {
            // retry once
            if err := stripe.Charge(ctx, order.Amount); err != nil {
                return fmt.Errorf("charge order %s: %w", orderID, err)
            }
        } else {
            return fmt.Errorf("charge order %s: %w", orderID, err)
        }
    }

    if err := db.MarkPaid(ctx, orderID); err != nil {
        log.Printf("MarkPaid failed for %s: %v", orderID, err)
        // continue: we have the money; reconciler will fix the row
    }
    return nil
}
```

Every error is *handled*, not just checked: idempotent skip, transient retry, transport context, log-and-continue when the money is already taken. That last line is where junior code tends to fail — surfacing an error after Stripe charged the customer would tell the caller "this failed", which is wrong.

---

## Error Handling

- "Handle errors gracefully" does not mean "log them and continue". It means *deciding*.
- Every layer either decides or delegates. Pick one explicitly.
- Wrap with `%w` when the caller might `errors.Is`/`errors.As` the inner error.
- Wrap with `%v` (or just a message) when you want to *break the chain* — useful when the inner error's identity is an implementation detail you do not want callers to depend on.
- Test failure paths the same way you test success paths.

---

## Security Considerations

- **Internal errors must not leak to users.** Map them to "internal error" at the boundary; log the detail server-side.
- A stack trace in an HTTP response is an information leak. Recovery middleware should send a generic 500.
- Error messages can leak data: `fmt.Errorf("auth user %s with token %s", u, t)` writes the token into your logs.
- Beware of error messages that vary by case — `"user not found"` vs `"wrong password"` is a known account-enumeration leak. Return the same message in both cases.
- Centralise the place where errors become user-visible. Trust nothing else to do it correctly.

---

## Performance Tips

- `if err != nil` is a single integer compare. It is **free**.
- `errors.Is` is a small loop over the unwrap chain. Cheap.
- `fmt.Errorf("...: %w", err)` allocates the new error and a string. ~100-300 ns. Fine for normal paths.
- Avoid wrapping in hot loops if errors are rare and printed only once at the boundary — wrap once at the boundary instead.
- Capturing stack traces is the expensive part — covered in 5.8. The act of *handling* an error itself is essentially free.

---

## Best Practices

- **Make the decision explicit.** Even a comment `// caller will translate to status` is enough to show you decided.
- **Keep the happy path at the left margin.** Early return errors.
- **Wrap with operation context.** "save user 42" not "error".
- **Log once.** At the boundary, with structured fields.
- **Use sentinels for kinds.** `errors.Is(err, ErrNotFound)` is the protocol between layers.
- **Reserve panic for invariants.** Not for normal failures.
- **Test failure paths.** A function that has never been called with a failing dependency has never been *handled*.

---

## Edge Cases & Pitfalls

- **`return nil, err` after the operation succeeded.** A surprisingly common bug after copy/paste — make sure you `return value, nil` on success.
- **Forgotten `Close`** — `defer file.Close()` ignores the error. For files you only read, fine. For files you wrote, the `Close` may be the only signal that the OS finished writing. Capture it.
- **Wrapping nil.** `fmt.Errorf("...: %w", nil)` produces an error whose message contains the literal string and `%!w(<nil>)` formatting. Always guard `if err != nil` first.
- **Comparing errors with `==`.** Works for sentinels *not* wrapped in `%w`. Use `errors.Is` to be safe across wraps.
- **Returning `err.Error()` as a string.** You lose type information. Future code cannot `errors.As` on the kind.

---

## Common Mistakes

1. **`if err != nil { return err }` everywhere** without thought — the reflex this whole topic is about.
2. **Logging *and* returning** — duplicates the noise.
3. **Swallowing errors** with `_` — the silent killer.
4. **Wrapping with the same word** — `query: query: query: timeout`.
5. **Returning the inner error type's identity** through public APIs — couples callers to your implementation.
6. **Panic on bad input** in a library — callers cannot recover; they crash with you.
7. **Mapping all errors to 500** at the HTTP boundary — hides legitimate 4xx user errors.
8. **Retrying non-idempotent operations** — duplicate side effects.
9. **Empty `else` blocks for errors** — unreachable code.
10. **Silently ignoring `Close()` errors** on files you wrote.

---

## Common Misconceptions

- **"Go is verbose because of `if err != nil`."** The verbosity comes from *not handling*. Real Go code is not 50% checks if each block makes a decision.
- **"Returning errors is the same as handling them."** It is not. Surface is one decision among six.
- **"Panicking is wrong."** Panic for programmer errors and unrecoverable invariants; do not panic for normal failures.
- **"`%w` always."** Sometimes you want to *break* the chain — `%v` is the right choice when the inner error is an implementation detail.
- **"Errors should always have a stack trace."** Most errors do not need one. The boundary's recovery middleware adds one if needed.

---

## Tricky Points

- **Where to handle.** The deepest layer that has *enough information*. If your storage adapter knows about `sql.ErrNoRows` but doesn't know that "no rows means a default config", surface to the caller.
- **When to log.** At the layer that can decide nothing else useful — typically the top boundary or a worker's recovery.
- **When to retry.** Only when the operation is *idempotent* and the failure is *transient*. Both conditions matter; both are easy to assume incorrectly.
- **When to wrap vs. when to break the chain.** Wrap (`%w`) when the inner error's identity matters to callers. Break (`%v`) when it is private.
- **`recover` does not catch panics in *other* goroutines.** Each goroutine needs its own.

---

## Test

```go
package main

import (
    "errors"
    "io/fs"
    "testing"
)

// loadConfig with a default-on-missing rule
func loadConfig(read func(string) ([]byte, error)) (port int, err error) {
    _, err = read("config.json")
    if errors.Is(err, fs.ErrNotExist) {
        return 8080, nil // recover
    }
    if err != nil {
        return 0, err // surface
    }
    return 9090, nil
}

func TestLoadConfig_DefaultOnMissing(t *testing.T) {
    p, err := loadConfig(func(string) ([]byte, error) {
        return nil, fs.ErrNotExist
    })
    if err != nil {
        t.Fatalf("expected no error, got %v", err)
    }
    if p != 8080 {
        t.Fatalf("expected default 8080, got %d", p)
    }
}

func TestLoadConfig_SurfaceOther(t *testing.T) {
    e := errors.New("permission denied")
    _, err := loadConfig(func(string) ([]byte, error) {
        return nil, e
    })
    if !errors.Is(err, e) {
        t.Fatalf("expected wrapped %v, got %v", e, err)
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *Is `if err != nil { return err }` always wrong?*
   No. It is correct when the caller has more information than you and there is nothing to do here. It is *lazy* when it is the reflex answer to every check.

2. *What does "handle errors gracefully" actually mean?*
   Pick one of the six decisions (recover, retry, transform, surface, log, abort) consciously, instead of always picking "surface".

3. *Where should I handle an error?*
   As close to the source as possible while still having enough information to do something useful. Push the decision down until pushing further loses context.

4. *Why is logging-and-returning bad?*
   The next layer logs again. By the top there are five copies of the same line. Either own it or pass it.

5. *Should I wrap with `%w` everywhere?*
   No. Wrap when callers may `errors.Is`/`errors.As`. Use `%v` to break the chain when the inner identity is private.

6. *Is it OK to return the same error from many places?*
   With sentinels, yes — that is what they are for. With wrapped errors, prefer to add context unique to *each* call site.

7. *When should I panic instead of return error?*
   For *programmer errors* (impossible state, broken invariant) and at startup when there is no caller to surface to. Never for routine failures.

---

## Cheat Sheet

```go
// Six decisions
recover  : return defaults, nil
retry    : for i := 0; i < N; i++ { ... }
transform: return DomainErrFoo
surface  : return fmt.Errorf("op: %w", err)
log      : log.Printf("op: %v", err); // do not also return
abort    : panic(err)  // only for impossible states

// Happy path stays straight
x, err := step1()
if err != nil { return err }
y, err := step2(x)
if err != nil { return err }
return finish(y)

// Wrap with context
return fmt.Errorf("load user %d: %w", id, err)

// Compare across wraps
if errors.Is(err, ErrNotFound) { ... }
var pe *fs.PathError
if errors.As(err, &pe) { ... }

// errWriter pattern
type errWriter struct{ w io.Writer; err error }
func (e *errWriter) write(b []byte) {
    if e.err != nil { return }
    _, e.err = e.w.Write(b)
}

// Recover on panic, log once
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

---

## Self-Assessment Checklist

- [ ] I can name the six decisions you make on a non-nil error.
- [ ] I never write `if err != nil { return err }` without thinking about whether it is the right decision.
- [ ] I keep my happy path at the left margin.
- [ ] I do not log *and* return the same error.
- [ ] I wrap errors with operation context, not a generic word.
- [ ] I retry only idempotent operations on transient failures.
- [ ] I translate domain errors at API boundaries to status codes.
- [ ] I use `errors.Is` and `errors.As` instead of `==`.
- [ ] I reserve `panic` for impossible states.

---

## Summary

Cheney's principle is short: *don't just check errors, handle them gracefully*. "Checking" is the reflex `if err != nil { return err }`. "Handling" is choosing — recover, retry, transform, surface, log, abort — at every error site. Most beginner Go code drowns in checks because the writer never made a decision. The verbosity that critics complain about is the cost of an explicit, value-based error model; the *content* between check and return is what makes the code good. Keep the happy path straight, log once at the boundary, wrap with context the caller cannot reconstruct, and reserve panic for impossible states. Everything else flows from there.

---

## What You Can Build

- A small CLI tool that loads config with sensible defaults when the file is missing.
- A retry helper that takes a function and an "is this retryable?" predicate.
- An HTTP middleware that maps domain sentinels to status codes.
- A worker pool that recovers panics in each task and logs them once.
- An `errWriter`-style helper for writing protocol messages — capture errors, check at the end.

---

## Further Reading

- [Don't just check errors, handle them gracefully — Dave Cheney](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Errors are values — Rob Pike](https://go.dev/blog/errors-are-values)
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Go Code Review Comments — Errors](https://go.dev/wiki/CodeReviewComments#errors)

---

## Related Topics

- [04-fmt-errorf](../04-fmt-errorf/junior.md) — `%w` and adding context
- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `errors.Is`/`errors.As`
- [06-sentinel-errors](../06-sentinel-errors/junior.md) — the protocol between layers
- [07-panic-and-recover](../07-panic-and-recover/junior.md) — the abort decision
- [12-error-design-best-practices](../12-error-design-best-practices/junior.md) — broader design principles

---

## Diagrams & Visual Aids

```
                     +-------------+
                     |  if err !=  |
                     |     nil     |
                     +------+------+
                            |
        +-------------------+-------------------+
        |        |        |        |       |       |
     recover  retry  transform surface   log   abort
        |        |        |        |       |       |
     defaults  loop+   wrapErr   return   .Print  panic
              backoff   /map     err              os.Exit
```

```
Happy path stays straight:

main() -> step1() -> step2() -> step3() -> finish()
              \         \         \
               err       err       err     <-- branches peel off
                |         |         |
                v         v         v
              return    return    return
```

```
Where to handle?

deepest layer ... mid layer ... boundary
   |               |              |
   |  source       |  knows       |  user-visible
   |  of failure   |  policy      |  language
   |               |              |
   v               v              v
 retry?         transform?     map to HTTP status
 fallback?      add context?   log + sanitize
```

```
Log OR return — never both:

  layer A: log+return  -> "ERROR" line written
  layer B: log+return  -> "ERROR" line written (same error!)
  layer C: log+return  -> "ERROR" line written
                          ^^^ three log lines for one event

  Better:
  layer A:     return  -> nothing logged
  layer B:     return  -> nothing logged
  layer C: log         -> ONE line written
```
