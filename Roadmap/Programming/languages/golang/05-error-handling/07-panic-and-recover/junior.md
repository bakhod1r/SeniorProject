# panic and recover — Junior Level

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
> Focus: "What is a panic?" and "When should I ever use it?"

In the previous topics you learned that Go does not have exceptions: failures are reported as ordinary `error` values returned from a function. So why does Go have a thing called `panic` that *looks* like throwing an exception?

Because **some failures are not errors.** They are bugs. They are "the program is in an impossible state." They are "we are about to dereference a nil pointer and corrupt memory." For those, Go has a separate mechanism:

- **`panic(v any)`** — stop normal execution, run any deferred functions, and unwind the stack until the goroutine dies (or until something `recover`s).
- **`recover()`** — when called from inside a deferred function during an active panic, capture the panic value and resume normal execution.

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    panic("the building is on fire")
}
// Output: recovered: the building is on fire
```

That is the entire mechanism. Three keywords (`panic`, `recover`, `defer`) and a small set of rules.

After reading this file you will:
- Know what `panic` and `recover` are and what each one does.
- Recognize the situations Go itself panics on (nil dereference, out-of-range index, etc.).
- Be able to write the `defer/recover` idiom correctly.
- Understand why panics are *not* exceptions and *not* general error handling.
- Know when to panic, when not to, and the rules for recovering.

---

## Prerequisites

- **Required:** Functions and `defer` — `recover` only works inside a deferred call. If you do not understand `defer`, this whole topic will not click.
- **Required:** The `error` value and `if err != nil` (covered in 5.1). Errors and panics are different mechanisms; you have to know one before you can compare it to the other.
- **Required:** Goroutines (basic understanding) — many panic rules are about goroutines.
- **Helpful but not required:** Interfaces — the panic value is an `any` (formerly `interface{}`), so an understanding of dynamic types helps.
- **Helpful but not required:** Stack traces and how Go prints them — `runtime/debug.Stack()` and the default panic output.

---

## Glossary

| Term | Definition |
|------|-----------|
| **panic** | A built-in function that begins stack unwinding. Also the *state* the goroutine is in while unwinding. |
| **recover** | A built-in function that stops a panic when called inside a deferred function. Returns the panic value. |
| **defer** | A statement that schedules a function call to run as the surrounding function returns or panics. The bridge between `panic` and `recover`. |
| **stack unwinding** | The process of leaving function frames one by one, running their deferred calls. |
| **panic value** | The argument passed to `panic`. Can be any value: a string, an `error`, a struct. |
| **runtime panic** | A panic raised by the Go runtime itself (nil dereference, divide by zero, etc.) rather than by user code calling `panic`. |
| **goroutine** | A lightweight thread of execution. Each goroutine has its own panic/recover scope. |
| **fatal error** | A different, more severe shutdown that `recover` cannot catch (e.g., out of memory). Distinct from panic. |
| **stack trace** | The chain of function calls printed when a panic crashes the program. |

---

## Core Concepts

### Concept 1: panic is a runtime mechanism, not a value-passing mechanism

When you call `panic("oops")`, Go does not just *return* "oops" to the caller. It does something fundamentally different: it stops normal execution, runs all `defer`s in the current function in reverse order, then in the function that called this one, and so on, all the way up the goroutine's call stack. If nothing catches it, the goroutine dies and (if it is the main goroutine, or any goroutine without a recover) the program crashes with a stack trace.

This is *not* the same as `return err`. A return is a normal hand-off. A panic is a runtime event.

### Concept 2: recover only works inside a deferred function

```go
defer func() {
    if r := recover(); r != nil {
        // we are now safe; r holds the panic value
    }
}()
```

That is the only legal shape. `recover()` called *not* in a deferred function returns `nil` and does nothing. `recover()` called in a function that the deferred function then calls (one level deeper) also returns `nil`. The `recover()` call must be **directly** in the deferred function body.

### Concept 3: defer is the bridge

```
┌─────────────┐
│  panic("x") │ ─── starts unwinding
└─────────────┘
       │
       ▼
┌──────────────┐
│ deferred fn  │ ─── runs; can call recover()
└──────────────┘
       │
       ▼
┌──────────────┐
│ deferred fn  │ ─── from caller; runs next
└──────────────┘
       │
       ▼
   (program dies if no recover)
```

`defer` is what gives `recover` a place to run. Without `defer` there is no point at which user code executes during the unwinding.

### Concept 4: the panic value can be anything

```go
panic("string")
panic(errors.New("error value"))
panic(42)
panic(struct{ Code int }{Code: 500})
```

`panic` takes `any`. Most idiomatic Go code panics with an `error` or a string. Inside a `recover`, the type-assert tells you which:

```go
if r := recover(); r != nil {
    switch v := r.(type) {
    case error:
        // handle error
    case string:
        // handle string
    default:
        // unknown
    }
}
```

### Concept 5: errors vs panics — choose one model per failure

| Use `error` when… | Use `panic` when… |
|-------------------|-------------------|
| The caller can do something | The caller cannot reasonably handle it |
| The failure is *expected* | The failure means a bug in the program |
| It is a known failure mode | It is "this should never happen" |
| The function signature can carry it | The function pre-condition was violated |

Go programs lean *very heavily* on errors and use panic sparingly. A typical large Go codebase has hundreds of `if err != nil` checks and zero or one explicit `panic`. The rare panics tend to be in `init()` functions for misconfiguration, or wrapping pre-condition checks in libraries.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **panic** | A fire alarm. Everything stops; orderly evacuation procedures (defers) run; people leave the building (the function frames). |
| **recover** | The safety officer at the exit. They are the only one allowed to say "false alarm, we can stay." If no one is at that exit, the building empties. |
| **defer** | The pre-arranged evacuation plan. Without one, no one runs the recovery procedures. |
| **runtime panic** | A short-circuit caused by faulty wiring (the program tried to do something nonsensical) — same fire alarm, same evacuation, but you did not press the button yourself. |
| **panic in a goroutine without recover** | A fire in a wing of the building with no fire marshal. The whole building must be evacuated (the entire process dies). |
| **panic value** | The note attached to the alarm: "kitchen fire," "drill," "false alarm." Whoever responds reads it. |

---

## Mental Models

**The intuition:** Think of `panic` as the parachute on an airplane. Most of the time you fly with errors — small course corrections handled by the pilot. The parachute is for "the wing fell off." Pulling it triggers an emergency procedure: cabin depressurizes, oxygen masks drop, you eject. You do not pull it because the in-flight movie is bad.

**Why this model helps:** It kills the temptation to use `panic` for control flow. The cost of pulling a parachute that you did not need is much higher than the cost of pulling none at all when you needed one. So `panic` is reserved for scenarios where the alternative is genuinely worse than crashing — corruption, stuck state, impossible invariants.

**The second intuition:** `recover` is like a try/catch *only* if you imagine it as one giant catch at the very top of the goroutine. It is not for routine handling; it is for "we are crashing, but I want to log this and turn it into a 500 response before the goroutine dies."

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Lets you abort impossible-state code paths immediately. | Hidden control flow — opposite of Go's "errors are values" philosophy if overused. |
| Built-in stack trace on uncaught panics, free debugging info. | Recover is brittle — must be in a deferred function, must be at the right level. |
| Natural for "this is a bug, stop the world" assertions. | A panic in a goroutine without recover crashes the entire program. |
| Survives the panicking function's normal returns; runs all defers. | Performance: panic+recover is ~100x more expensive than a normal return. |
| Standard libraries use it for clearly impossible situations (e.g., regexp.MustCompile). | Easy to misuse for routine errors (anti-pattern). |
| Useful at server boundaries to keep one bad request from killing the process. | Cannot recover certain runtime errors (fatal errors, stack overflow in some cases). |

### When to use:
- A library helper like `MustParse` where the caller has guaranteed valid input.
- An impossible state that indicates a bug (a `default` clause in a switch that should be exhaustive).
- A top-level boundary in a server handler so one panicking request does not crash the whole process.

### When NOT to use:
- Any error that the caller can reasonably handle. Return an `error`.
- Validation of user input — use `error`.
- Control flow ("I want to bail out of nested loops") — use return values, not panic.
- "Generic error handling" — Go programs that try to use `panic/recover` like try/catch end up worse off.

---

## Use Cases

- **`MustX` constructors** — `regexp.MustCompile`, `template.Must`. They panic on bad input that the caller has guaranteed cannot be wrong.
- **Init-time misconfiguration** — `panic` in `init()` if a required environment variable is missing.
- **Runtime invariants** — assertion-style checks: "this map should always have key X; if it doesn't, we are broken."
- **Top-level recovery** — HTTP middleware that recovers from a panicking handler and returns 500.
- **Test failures from helpers** — testing helpers that detect impossible setup may panic to fail loudly.
- **Reflect-heavy code** — when invalid types are encountered, `reflect` panics; library authors sometimes mirror that style.

---

## Code Examples

### Example 1: A panic that crashes the program

```go
package main

import "fmt"

func main() {
    fmt.Println("before")
    panic("boom")
    fmt.Println("after") // never runs; compiler may even complain
}
```

**What it does:** Prints "before", then crashes with `panic: boom` and a stack trace. The "after" line is unreachable.
**How to run:** `go run main.go`. Exit code is non-zero.

### Example 2: Recovering from a panic

```go
package main

import "fmt"

func safeDivide(a, b int) (result int) {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered from:", r)
            result = 0
        }
    }()
    return a / b
}

func main() {
    fmt.Println(safeDivide(10, 2)) // 5
    fmt.Println(safeDivide(10, 0)) // recovered from: runtime error: integer divide by zero \n 0
    fmt.Println("program continues")
}
```

**What it does:** Calls a function that may divide by zero (a runtime panic). The deferred recover catches it, sets the result to a default, and returns normally. The caller never sees a crash.

### Example 3: A built-in panic — index out of range

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("caught:", r)
        }
    }()
    s := []int{1, 2, 3}
    fmt.Println(s[10]) // runtime panic
}
```

**What it does:** Accessing index 10 on a length-3 slice triggers a runtime panic: `runtime error: index out of range [10] with length 3`. The deferred recover sees and reports it.

### Example 4: panic with an error value

```go
package main

import (
    "errors"
    "fmt"
)

func mustOpen(name string) {
    if name == "" {
        panic(errors.New("mustOpen: empty name"))
    }
    fmt.Println("opening", name)
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            if err, ok := r.(error); ok {
                fmt.Println("recovered error:", err.Error())
            } else {
                fmt.Println("recovered non-error:", r)
            }
        }
    }()
    mustOpen("")
}
```

**What it does:** Panics with an `error` value, and the deferred function inspects the type to print it appropriately.

### Example 5: nil map write

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("caught:", r)
        }
    }()
    var m map[string]int  // nil map
    m["x"] = 1            // panics: assignment to entry in nil map
    _ = m
    fmt.Println("never runs")
}
```

**What it does:** A nil map can be *read* from (returns the zero value), but writing to it panics. The deferred recover catches it.

### Example 6: panic in a deeply nested call

```go
package main

import "fmt"

func a() { b() }
func b() { c() }
func c() { panic("deep") }

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    a() // panic propagates up: c -> b -> a -> main
}
```

**What it does:** The panic in `c` unwinds through `b` and `a`, runs the deferred recover in `main`, and the program continues normally.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: The defer/recover idiom

```go
defer func() {
    if r := recover(); r != nil {
        // log, convert to error, etc.
    }
}()
```

This is the canonical shape. Memorize it: anonymous function, called via `defer`, body checks `recover()` for non-nil.

### Pattern 2: Convert panic to error at an API boundary

```go
func Run() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("run panicked: %v", r)
        }
    }()
    riskyWork()
    return nil
}
```

A library that wraps reflective or unsafe machinery often adopts this pattern: internally it may panic; externally it returns an error. Notice the **named return** `(err error)` — required so the deferred function can assign to it.

### Pattern 3: HTTP middleware that recovers

```go
func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic in handler: %v", rec)
                http.Error(w, "internal server error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

Standard production pattern. One panicking handler returns 500 instead of taking down the server.

### Pattern 4: MustX constructor

```go
func MustParseURL(s string) *url.URL {
    u, err := url.Parse(s)
    if err != nil {
        panic(fmt.Sprintf("MustParseURL: %v", err))
    }
    return u
}
```

When the caller has *guaranteed* the input is valid (e.g., a string literal), they prefer a panic over an `if err != nil` check.

### Pattern 5: Goroutine wrapper that recovers

```go
func goSafe(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v", r)
            }
        }()
        fn()
    }()
}
```

Without this wrapper, a panic in any goroutine kills the entire process. Useful for "fire and forget" tasks that must not crash the server.

---

## Clean Code

- Use `panic` sparingly. A whole package with two or three panics is healthy. A package with twenty is broken.
- Name the recovered value `r` or `rec`. Everyone reads `r := recover()` instantly.
- Keep the deferred function tiny: log, set an error, return. Do not do real work inside `recover()` blocks.
- Always *think* about what to do with the recovered value — log it, convert to error, set a flag. Do not silently swallow.
- Never `recover()` outside a deferred function. It is a no-op and confuses readers.
- Pair `recover` with a corresponding *intentional* `panic` in your own code; do not rely on accidental runtime panics for control flow.

---

## Product Use / Feature

A real Go HTTP server typically wraps every request in a recover middleware:

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/healthz", healthz)
    mux.HandleFunc("/api/save", saveHandler)

    handler := recoverMiddleware(mux)
    http.ListenAndServe(":8080", handler)
}

func saveHandler(w http.ResponseWriter, r *http.Request) {
    // some risky work; if it panics, the middleware turns it into a 500
    saveToDB(r.Body)
    w.Write([]byte("ok"))
}
```

The product effect: a single bad request does not bring down the server. The error is logged, the user sees 500, and the next request runs normally.

---

## Error Handling

Errors and panics are *separate* mechanisms but often combined at boundaries:

- Inside a function: prefer returning errors. Reserve panic for impossible states.
- At an API boundary: you may convert a panic from a library call into an error you return.
- At a goroutine boundary: always recover, otherwise one panic kills the program.

A common idiom:

```go
func DoWork() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("work panicked: %v", r)
        }
    }()
    return doWorkInternal()
}
```

Internal code is allowed to panic; external API exposes only errors. Callers stay in the `if err != nil` world.

---

## Security Considerations

- **Stack traces leak code structure.** Default panic output prints function names, file paths, and line numbers. Do not show this to end users — log it, return a bland message.
- **Panic values may carry secrets.** If you panic with a database row or a token, that data ends up in logs. Treat panic values like log content: never include credentials.
- **DoS via forced panics.** If a handler panics on certain inputs, attackers can spam those inputs to flood your logs. Always sanitize and rate-limit.
- **Recovery hides bugs.** A blanket `recover()` in main can mask real corruption. After recovering, *log loudly* and consider crashing on repeat occurrences.

---

## Performance Tips

- A panic+recover is roughly 100x more expensive than a normal return. The runtime walks the stack, runs deferred calls, and rebuilds frames.
- `defer` itself has a small cost (a few ns since Go 1.14's open-coded defers). One defer per request is negligible; one defer per loop iteration on a hot path is measurable.
- Do not use panic+recover as a control-flow shortcut for "exit deeply nested loops." Use a labeled break or return.
- A `defer func() { recover() }()` pays cost on every call, even on the success path (the runtime registers the defer). Place such recovers at boundaries (e.g., one per request), not inside inner loops.
- See `optimize.md` for benchmarks and concrete numbers.

---

## Best Practices

- **Default to errors, panic only on impossible states.** If a normal program might encounter this, return an `error`.
- **Always recover at goroutine boundaries.** A panicking goroutine without recover crashes the whole process.
- **Convert panic to error at API surfaces.** Internal code can panic; exposed API returns errors.
- **Log the stack trace when recovering.** Use `runtime/debug.Stack()` to capture context for debugging.
- **Pair `MustX` with non-Must equivalents.** `template.Must` exists alongside `template.Parse`. Callers choose based on whether they have static input.
- **Do not rely on recover for resource cleanup.** Use `defer` for cleanup; recover is for catching the panic, not for closing files.

---

## Edge Cases & Pitfalls

- **`recover()` only works *directly* in a deferred function.** Nesting it inside a helper called from `defer` does not work:
  ```go
  defer logRecovered() // this function calls recover; does NOT work
  ```
- **The deferred function must be deferred *before* the panic.** A `defer` registered after the panic line is never reached.
- **Re-panicking is allowed.** Inside a recover, you can call `panic(r)` again to keep unwinding after logging.
- **`recover()` returns nil if not panicking.** That is *also* the value if you panicked with `panic(nil)`. Pre-Go-1.21, this caused a subtle bug; in 1.21+, `panic(nil)` panics with a `*PanicNilError` instead.
- **A panic across goroutines does not propagate.** The panicking goroutine dies; other goroutines do not see it. The main goroutine ends only when *its* stack unwinds without a recover.

---

## Common Mistakes

1. **Calling `recover()` outside a deferred function** — returns nil; the panic is not caught. The most common mistake by beginners.
2. **Wrapping recover in a helper.** `defer myRecover()` where `myRecover` calls `recover()` — does not work, because recover is no longer in the deferred frame.
3. **Forgetting that goroutines panic in isolation** — spawning a goroutine without a recover wrapper, then being surprised when the whole program dies.
4. **Panic for normal errors** — using panic instead of returning an error for things like "file not found."
5. **Recovering and ignoring** — `defer func() { recover() }()` swallows the panic without logging or any reaction. Hides bugs.
6. **Forgetting named returns** — when converting panic to error, forgetting `(err error)` so the deferred assignment never reaches the caller.
7. **Re-panic without context** — `panic(r)` inside a recover loses the stack trace from the original panic.
8. **Defer in a tight loop** — combining defers and tight loops can quickly stack up cleanup work.

---

## Common Misconceptions

- **"Panic is Go's exception."** No. Exceptions are designed for general failure handling. Panic is designed for impossible states. Errors are Go's general failure handling.
- **"Recover catches everything."** No. It catches panics in the same goroutine. It does not catch fatal runtime errors (some allocation failures, stack overflows, concurrent map writes detected by the runtime, etc.).
- **"Panic always crashes the program."** Only if no `recover` runs in any deferred function up the stack of that goroutine.
- **"defer/recover is fast."** It is much slower than a normal return. Do not treat it as a primary control-flow mechanism.
- **"You can panic across goroutines."** No. A panic stays in its own goroutine. To signal another goroutine, use channels.

---

## Tricky Points

- **`recover()` returns `any`.** You usually need a type assertion to extract a useful value. `r.(error)`, `r.(string)`.
- **Panic during a deferred function.** Yes, defers can panic. The new panic replaces the old one and unwinding continues.
- **Multiple defers + recover.** Defers run in LIFO order. The recover only matters if it appears in the deferred function that runs while the panic is propagating.
- **`os.Exit` skips defers.** Unlike panic, `os.Exit(1)` does *not* run deferred functions. They are silently dropped. (See specification.md.)
- **`log.Fatal` vs `panic`.** `log.Fatal` calls `os.Exit` after logging — no defers, no recover. `panic` runs defers and is recoverable. They look similar but behave very differently.

---

## Test

```go
package recovertest

import (
    "fmt"
    "testing"
)

func safeDivide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    return a / b, nil
}

func TestSafeDivide_Success(t *testing.T) {
    got, err := safeDivide(10, 2)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if got != 5 {
        t.Fatalf("got %d, want 5", got)
    }
}

func TestSafeDivide_DivByZero(t *testing.T) {
    _, err := safeDivide(10, 0)
    if err == nil {
        t.Fatal("expected error from panic, got nil")
    }
}

func TestPanicValue(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic, got none")
        }
    }()
    panic("boom")
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *What does `recover()` return if you call it outside a deferred function?*
   `nil`. It does nothing.

2. *What is the difference between `panic` and `os.Exit`?*
   `panic` unwinds the stack and runs deferred functions; `os.Exit` immediately terminates the process without running any defers.

3. *If a goroutine panics and does not recover, what happens to other goroutines?*
   The whole program crashes. Other goroutines stop without any chance to clean up.

4. *Can you `recover` from a runtime panic like nil dereference?*
   Yes — runtime panics are ordinary panics from `recover`'s perspective.

5. *Can you panic with `nil`?*
   In Go 1.21+, `panic(nil)` panics with a `*runtime.PanicNilError` so the recover sees a non-nil value. Before 1.21, `panic(nil)` was a footgun: `recover()` returned nil and the recover code thought no panic happened.

6. *Why must `recover` be inside a *directly* deferred function?*
   The runtime checks the call stack to decide whether `recover` should consume the panic. It only consumes if the caller of `recover` is the deferred function being run during the unwind. A helper called from the deferred function does not match.

7. *Is `panic` the same as throwing an exception?*
   No. Panic is reserved for impossible states. Exceptions in other languages are routinely used for normal failure handling. Go uses errors for that.

---

## Cheat Sheet

```go
// Trigger a panic
panic("message")
panic(errors.New("e"))
panic(struct{ Code int }{500})

// Recover (always inside a defer!)
defer func() {
    if r := recover(); r != nil {
        // r is any; type-assert to use
    }
}()

// Convert panic to error (named return!)
func F() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    risky()
    return nil
}

// Recover at a goroutine boundary
go func() {
    defer func() { _ = recover() }()
    work()
}()

// Built-in panics to know:
// - nil pointer dereference
// - index out of range
// - divide by zero (integer)
// - nil map write
// - failed type assertion (single-value form)
// - send on closed channel
// - close of nil/closed channel

// Stack trace:
import "runtime/debug"
debug.PrintStack() // or string(debug.Stack())
```

---

## Self-Assessment Checklist

- [ ] I can describe what `panic` does step by step (stop, unwind, run defers, kill goroutine).
- [ ] I can describe what `recover` does and where it must be called.
- [ ] I can write the canonical defer/recover pattern from memory.
- [ ] I can list at least four built-in panics.
- [ ] I know that a goroutine panic without recover crashes the whole program.
- [ ] I can explain the difference between `panic`, `os.Exit`, and `log.Fatal`.
- [ ] I know panic+recover is roughly 100x slower than a normal return.
- [ ] I can recognize a misuse of panic for normal error handling.

---

## Summary

`panic` and `recover` are Go's mechanism for catastrophic, impossible-state failures, deliberately separate from the everyday `error` value. `panic` unwinds the stack while running deferred functions; `recover` (when called inside one of those deferred functions) stops the unwind and returns the panic value. The default rule is "use errors for failures, panic only for bugs." The main practical use of recover is to **survive unexpected panics at boundaries** — server handlers, goroutines, library APIs — without taking down the whole process.

---

## What You Can Build

- A small HTTP middleware that recovers panicking handlers and returns 500.
- A goroutine helper `goSafe(fn)` that wraps any function in a recover/log so background work cannot crash the program.
- A `MustParse` family of helpers that panics on bad input for use with static configuration.
- A test harness that asserts a function panics with a specific value.

---

## Further Reading

- [Effective Go: Panic](https://go.dev/doc/effective_go#panic)
- [Effective Go: Recover](https://go.dev/doc/effective_go#recover)
- [The Go Blog: Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover)
- The `runtime` source: `$GOROOT/src/runtime/panic.go`

---

## Related Topics

- [01-error-handling-basics](../01-error-handling-basics/junior.md) — errors as values, the foundation
- [02-error-interface](../02-error-interface/junior.md) — the `error` interface
- 03-creating-errors — `errors.New`, `fmt.Errorf`
- Goroutines and concurrency — panic interacts strongly with goroutine boundaries

---

## Diagrams & Visual Aids

```
Normal call flow:
  caller --(call)--> callee
  caller <--(return v, err)-- callee

Panic flow:
  caller        callee
    |             |
    | --(call)--> |
    |             | panic("x")
    |             | run callee's defers
    | run caller's defers (one of them may recover)
    |
    | If a deferred recover fires: continue normally
    | If not: keep unwinding to caller's caller
    | If we reach the top of the goroutine: goroutine dies
    | If it was the main goroutine: process crashes
```

```
defer + recover pattern:
   func F() {
       defer func() {       <-- the deferred function
           r := recover()   <-- captures panic, if any
           if r != nil {
               handle(r)
           }
       }()
       risky()              <-- may panic
   }
```

```
Goroutine isolation:
   main goroutine          worker goroutine
        |                          |
        |      go work()           |
        | -----------------------> |
        |                          | panic("x") with no recover
        |                          | -> ENTIRE PROGRAM CRASHES
```
