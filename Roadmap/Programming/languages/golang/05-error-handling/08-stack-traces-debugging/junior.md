# Stack Traces & Debugging — Junior Level

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
> Focus: "What is a stack trace?" and "How do I read one?"

When a Go program crashes — or when you ask it nicely — it can print a list of function calls that were active at that moment, with file names and line numbers. That list is called a **stack trace** (or "stack dump", or "traceback"). It is the single most important diagnostic tool in any programmer's box, because it answers the question that always comes up first when something goes wrong: *where did this happen?*

In other languages a stack trace usually arrives attached to an exception. In Go, errors do *not* carry stack traces by default. You either:
- Get a stack trace because the program **panicked** and the runtime printed one for you, or
- Capture one **explicitly** using the `runtime` and `runtime/debug` packages.

That is a big philosophical difference compared to Java or Python. It is also one of the first things every Go developer needs to understand.

```go
package main

import "runtime/debug"

func main() {
    debug.PrintStack()
}
```

Run this and you will see the function names, file paths, and line numbers leading from `main` to `debug.PrintStack`. That is your first stack trace, captured deliberately.

After reading this file you will:
- Be able to read a panic stack trace from top to bottom
- Know how to capture a stack trace programmatically
- Understand the difference between *capturing* a trace and *displaying* one
- Know about `runtime.Caller`, `runtime.Stack`, `runtime/debug.Stack`, and `debug.PrintStack`
- Understand `GOTRACEBACK` and what each setting does
- Know when to look at a stack trace and when to reach for a debugger or pprof

---

## Prerequisites

- **Required:** `panic` and `recover` (covered in 5.7) — the most common way to see a stack trace is via a panic.
- **Required:** Goroutines (basic understanding) — Go traces are per-goroutine.
- **Required:** Functions and call stacks — knowing what "the function called me" means.
- **Helpful but not required:** Comfort with the standard library's `os`, `fmt`, and `runtime` packages.
- **Helpful but not required:** Familiarity with reading file paths and line numbers in compiler errors.

---

## Glossary

| Term | Definition |
|------|-----------|
| **stack trace** | A snapshot of the active function calls in a goroutine, top-most caller first or last (Go puts the failing function first). |
| **frame** | One entry in the trace: a function plus the line it was at when the snapshot happened. |
| **PC** | Program counter — the instruction address inside a function. `runtime.Caller` returns one. |
| **panic** | A runtime mechanism for unrecoverable errors. By default panics print a stack trace before the program exits. |
| **goroutine dump** | A trace of *every* goroutine, not just the current one. Triggered by `runtime.Stack(buf, true)` or by `SIGQUIT`. |
| **GOTRACEBACK** | Environment variable controlling how much the runtime prints on panic: `none`, `single`, `all`, `system`, `crash`. |
| **inline** | The compiler may merge a small function into its caller; inlined functions can be missing or unusual in traces. |
| **delve / dlv** | The standard interactive debugger for Go programs. |
| **pprof** | A profiling tool built into the runtime, useful for CPU, memory, and goroutine analysis. |

---

## Core Concepts

### Concept 1: A panic prints a stack trace

The simplest way to see a stack trace is to crash on purpose:

```go
package main

func c() { panic("boom") }
func b() { c() }
func a() { b() }

func main() { a() }
```

Run it. The output looks like:

```
panic: boom

goroutine 1 [running]:
main.c(...)
        /tmp/main.go:3
main.b(...)
        /tmp/main.go:4
main.a(...)
        /tmp/main.go:5
main.main()
        /tmp/main.go:7 +0x...
exit status 2
```

The order is **deepest first**: the function that panicked is on top, and `main` is at the bottom. Read it top-to-bottom and you walk *backward* through the call chain.

### Concept 2: Stack traces are per-goroutine

Go programs almost always have many goroutines running. A panic in one goroutine prints *that goroutine's* trace, plus — depending on the panic — sometimes a "goroutine N [...]:" header. Other goroutines keep going (or the runtime kills them after the panic, depending on the setting).

If you want to dump *every* goroutine, use `runtime.Stack(buf, true)` or send the process `SIGQUIT` (Ctrl-\ on Unix terminals).

### Concept 3: Capturing without panicking

You do not need to crash to see a trace. The standard library gives you four building blocks:

```go
runtime.Caller(skip int) (pc uintptr, file string, line int, ok bool)
runtime.Callers(skip int, pc []uintptr) int
runtime.Stack(buf []byte, all bool) int
runtime/debug.Stack() []byte
runtime/debug.PrintStack()
```

The first two give you raw program counters; the second two give you human-readable text.

### Concept 4: The PC → frame pipeline

Stack traces work in two stages:
1. **Capture PCs** — collect the program counters of the active call frames.
2. **Resolve symbols** — turn each PC into "function, file, line".

`runtime.Callers` is the cheap step: it just copies a few `uintptr`s into a slice. `runtime.CallersFrames` is the slower step: it looks up each PC in the binary's symbol table.

You can capture PCs cheaply at the time of an error and resolve them later when (or if) the error is actually printed.

### Concept 5: GOTRACEBACK controls how much you see

When the program panics, the runtime asks `GOTRACEBACK` how verbose to be:

| Value | Meaning |
|-------|---------|
| `none` | No traceback (rare, used for stripped builds). |
| `single` | Only the panicking goroutine (the default). |
| `all` | All goroutines. |
| `system` | All goroutines including runtime-internal ones. |
| `crash` | Like `system`, then dump core. |

Default is `single`. Setting `GOTRACEBACK=all` is the first thing to try when a panic confuses you.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| **Stack trace** | The "you are here" map at a department store, showing every floor you took to get to the third-floor coffee shop. |
| **Panic + trace** | A black-box recorder on an airplane: it stops, prints, and the program lands hard. |
| **`runtime.Caller`** | Looking up "who called me" in your phone's recent-calls list — one entry at a time. |
| **Goroutine dump** | A roll-call of every employee in the building when the fire alarm rings. |
| **`GOTRACEBACK=all`** | Turning on every camera in the store after a shoplifting incident, not just the one above the register. |
| **Inlining** | A meeting note that says "merged with previous minute" — the original speaker is hidden inside someone else's row. |

---

## Mental Models

**The film-strip model.** A stack trace is one frame of a film. The film is your program running; the frame freezes the position of every actor (function call) at one instant. You cannot see *what* they did — you can see *where* they were standing.

**The receipt model.** Each function call is an item on a long receipt. When something goes wrong at the bottom of the receipt, you scan up to figure out which line started this purchase. The stack trace is that scan.

**The two-stage capture model.** Think of `runtime.Callers` as taking a polaroid photo of bare addresses (cheap), and `CallersFrames` as paying a translator to label everyone in the photo (expensive). Most production systems take the cheap photo at the error site and pay the translator later — only if the error is actually displayed.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Tells you exactly where execution was at the captured moment. | Capturing the trace is not free — it costs microseconds and allocates. |
| Built into the runtime, no third-party library required. | Default Go errors do *not* carry stack traces. |
| Works the same way in dev, staging, and prod. | Inlined and tail-called functions can be missing or merged in the output. |
| Goroutine dumps are uniquely powerful for diagnosing concurrency bugs. | Stack traces can leak internal file paths, function names, and structure to whoever reads them. |
| `GOTRACEBACK` lets you tune verbosity at runtime. | Without context (request ID, user ID), a trace alone is rarely enough. |

### When to use:
- Diagnosing a panic in development.
- Building a custom error type that needs to know its origin.
- Investigating a goroutine leak with a goroutine dump.

### When NOT to use:
- Per-error decoration in a hot loop. (See `optimize.md`.)
- As a replacement for structured logging or distributed tracing.

---

## Use Cases

- **Crash diagnosis** — read the panic trace to find the line that failed.
- **Custom error types** — attach a captured stack to an error so the consumer can print "where".
- **Test failures** — `t.Fatalf` / `t.Errorf` print the test trace; `runtime/debug.Stack` adds your own.
- **Goroutine leak investigation** — dump all goroutines and look for ones blocked in unexpected places.
- **Production debugging** — `pprof` endpoints expose live goroutine stacks without crashing.

---

## Code Examples

### Example 1: Read a panic trace

```go
package main

func bottom() { panic("oops") }
func middle() { bottom() }
func top()    { middle() }

func main() { top() }
```

**What it does:** Triggers a panic; the runtime prints a trace from `bottom` upward to `main`.
**How to run:** `go run main.go` and read the output.

### Example 2: Print a stack without panicking

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func reportHere() {
    fmt.Println("--- stack ---")
    fmt.Println(string(debug.Stack()))
}

func main() {
    reportHere()
    fmt.Println("still alive")
}
```

**What it does:** `debug.Stack()` returns a `[]byte` with the current goroutine's trace. The program continues normally.

### Example 3: Find your caller with `runtime.Caller`

```go
package main

import (
    "fmt"
    "runtime"
)

func whoCalledMe() {
    pc, file, line, ok := runtime.Caller(1) // skip = 1 means "my caller"
    if !ok {
        fmt.Println("could not get caller")
        return
    }
    fn := runtime.FuncForPC(pc)
    fmt.Printf("called from %s at %s:%d\n", fn.Name(), file, line)
}

func realCaller() {
    whoCalledMe()
}

func main() {
    realCaller()
}
```

**What it does:** Looks one frame up the stack and prints the caller's function, file, and line.

### Example 4: Capture PCs with `runtime.Callers`

```go
package main

import (
    "fmt"
    "runtime"
)

func capture() {
    pcs := make([]uintptr, 10)
    n := runtime.Callers(2, pcs) // skip Callers itself and capture
    pcs = pcs[:n]

    frames := runtime.CallersFrames(pcs)
    for {
        f, more := frames.Next()
        fmt.Printf("%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more {
            break
        }
    }
}

func main() {
    capture()
}
```

**What it does:** Captures the live PC slice, then resolves each to a (function, file, line) using `CallersFrames`. The standard idiom.

### Example 5: Dump every goroutine

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func sleeper(name string) {
    time.Sleep(time.Hour) // parked here so it shows up in the dump
    _ = name
}

func main() {
    go sleeper("a")
    go sleeper("b")
    time.Sleep(50 * time.Millisecond) // let the goroutines start

    buf := make([]byte, 1<<16)
    n := runtime.Stack(buf, true) // true = all goroutines
    fmt.Println(string(buf[:n]))
}
```

**What it does:** Starts two goroutines that sleep, then prints the trace of *every* goroutine. Notice "all=true" — the magic switch.

> Every example must be runnable. Include `package main` and `func main()`.

---

## Coding Patterns

### Pattern 1: Recover-and-log with stack

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

The classic top-of-handler pattern: catch the panic, log the cause and trace, do not crash the whole server.

### Pattern 2: Caller-aware logger

```go
func logAt(skip int, msg string) {
    _, file, line, _ := runtime.Caller(skip + 1)
    log.Printf("%s:%d  %s", file, line, msg)
}
```

A log helper that prints the *caller's* file and line, not its own. Many third-party loggers do this.

### Pattern 3: Capture PCs at error origin

```go
type withStack struct {
    err error
    pcs [32]uintptr
    n   int
}

func wrap(err error) error {
    var ws withStack
    ws.err = err
    ws.n = runtime.Callers(2, ws.pcs[:])
    return &ws
}
```

We capture the cheap part (PCs) at the point of failure. Resolution to file/line is deferred until someone actually prints the error.

### Pattern 4: Use `debug.SetTraceback` programmatically

```go
debug.SetTraceback("all")
panic("dump everything")
```

If you want a single panic site to print *all* goroutines (regardless of `GOTRACEBACK`), set it just before panicking.

### Pattern 5: Send SIGQUIT to inspect a hung process

In the terminal where your Go program is running, press **Ctrl-\** (on Unix). The runtime prints a goroutine dump and exits. No code changes required.

---

## Clean Code

- Capture the stack **at the origin** of the failure, not at every wrap. A 5-deep wrap chain with 5 captured stacks is wasteful and confusing.
- Print stacks at the **boundary** (top-level handler, request middleware), not deep in libraries.
- Do *not* capture stacks in tight loops. They allocate.
- Keep the message that goes with a stack short — the stack itself is the long part.
- When you need a quick diagnostic in development, `fmt.Println(string(debug.Stack()))` is a perfectly fine "print where I am".

---

## Product Use / Feature

In a real Go service the most common stack-trace usages are:

```go
// Top-level recovery middleware
func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic %v\n%s", rec, debug.Stack())
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

```go
// Diagnostic endpoint
func goroutinesHandler(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    w.Write(buf[:n])
}
```

```go
// Or use the built-in net/http/pprof endpoints
import _ "net/http/pprof"
// /debug/pprof/goroutine?debug=2 dumps all goroutines
```

---

## Error Handling

- A captured stack is *for humans*, not for `errors.Is`/`errors.As`. Do not branch on stacks.
- When you build a custom error with a stack, still implement `Unwrap()` so the rest of the error machinery keeps working.
- When you log "panic + stack", do it once, at the top boundary. Logging it again upstream will double the log volume.

---

## Security Considerations

- **Stack traces leak code structure.** They reveal package names, file paths, function names. Never send a raw stack trace in an HTTP response to an untrusted client.
- **Internal paths** like `/Users/alice/src/...` show up in builds; consider stripping them with `-trimpath`.
- **Error messages in stacks** can leak data — if you panicked with `panic(fmt.Sprintf("user %s password %s", u, p))`, the panic value is in the trace.
- **Goroutine dumps include parameters in some forms.** Treat them as sensitive.

---

## Performance Tips

- `runtime.Callers` with a small slice is cheap (~hundreds of ns); `CallersFrames` is more expensive because it does symbolization.
- `runtime/debug.Stack()` does both — capture *and* symbolize *and* format. Easily microseconds. Do not call it in hot paths.
- A panic-and-recover round trip with stack formatting can be 10-100 µs. Fine for a top-level safety net, terrible inside a tight loop.
- See `optimize.md` for benchmarks and concrete numbers.

---

## Best Practices

- **Use the runtime's tracing first.** Read the panic. `GOTRACEBACK=all`. Only then reach for tooling.
- **Capture stacks once, at the source.** Add them to the error as it is created, not as it is wrapped.
- **Format stacks lazily.** Capture cheap PCs, format only when a human will see them.
- **Use structured logs.** Pair a stack with a request ID so you can correlate.
- **Have a goroutine-dump endpoint.** `pprof.Lookup("goroutine").WriteTo(w, 2)` saves you in production.
- **Trim binaries with `-trimpath`** for distribution.

---

## Edge Cases & Pitfalls

- **Inlined functions disappear.** A small function inlined into its caller may not show as a separate frame, or may show with `[inlined]` markers. Build with `-gcflags='-l'` to disable inlining when debugging.
- **Tail calls are not always visible.** Go does not do classical tail-call optimization, but small wrappers can be optimized away.
- **`runtime.Caller(0)` returns the call site of `Caller` itself**, which is rarely what you want. You usually want `Caller(1)`.
- **`runtime.Stack` truncates** to the buffer size. If your buffer is too small, you get a partial trace. Start with 64 KB; enlarge if needed.
- **Panic before main starts** (e.g., during `init`) prints a trace, but `recover` cannot catch it.

---

## Common Mistakes

1. **Calling `runtime.Caller(0)`** when you wanted `Caller(1)` — printing your own helper as the caller.
2. **Using `runtime/debug.Stack` in a tight loop** and complaining about CPU.
3. **Logging the stack but not the panic value.** You see the *where* but not the *what*.
4. **Recovering and dropping the stack on the floor.** A bare `recover()` without `debug.Stack` makes panics invisible.
5. **Printing a raw stack to the user** in an HTTP response — leaks structure.
6. **Forgetting `all=true`** in `runtime.Stack` when investigating goroutine leaks.
7. **Buffer too small** for `runtime.Stack` — silent truncation.
8. **Using `runtime.Callers` skip values that include the wrong number of frames** — off-by-one is the usual mistake.

---

## Common Misconceptions

- **"Errors carry stack traces."** They do not — not by default. Wrapping with `%w` carries no location info.
- **"Panic is the only way to see a stack."** No — `debug.Stack` works without panicking.
- **"Stacks are free."** They allocate and walk the runtime; not free.
- **"`Caller` returns the line that called my function."** It returns whichever frame you ask for via `skip`.
- **"Inlining always preserves the call name in the trace."** Not always — sometimes you only see the outer function.

---

## Tricky Points

- **Skip parameter** — `Caller(skip)` and `Callers(skip, ...)` both have a `skip` count, but the meaning is slightly different: `Caller`'s `skip=0` is the caller of `Caller`, but `Callers`' first slot can be `runtime.Callers` itself depending on version. Read the doc for *your* Go version.
- **Goroutine ID is not in the public API.** You can grep it from `runtime.Stack` output, but Go intentionally does not expose it for normal use — it discourages thread-local state.
- **`debug.PrintStack` writes to `os.Stderr`.** If your stderr is redirected, you may miss the output.

---

## Test

```go
package debugutil

import (
    "runtime/debug"
    "strings"
    "testing"
)

func TestStackContainsCallerName(t *testing.T) {
    s := string(debug.Stack())
    if !strings.Contains(s, "TestStackContainsCallerName") {
        t.Fatalf("stack should mention the test function:\n%s", s)
    }
}
```

Run with: `go test ./...`

---

## Tricky Questions

1. *Do Go errors carry stack traces by default?*
   No. Wrapping with `%w` propagates messages, not location. Stack traces must be captured explicitly.

2. *What is the difference between `runtime.Caller` and `runtime.Callers`?*
   `Caller` returns one frame; `Callers` fills a slice with many PCs.

3. *Why use `runtime.CallersFrames` instead of looking up each PC manually?*
   It correctly handles inlined functions — it can return multiple "virtual" frames per real PC.

4. *What does `GOTRACEBACK=all` do?*
   On panic, prints a trace for *every* goroutine in the program, not only the panicking one.

5. *How do you trigger a goroutine dump without modifying the code?*
   Send `SIGQUIT` (Ctrl-\ on Unix) to the running process.

6. *Why does my stack trace show `?` for some lines?*
   The function was inlined, the symbol was stripped, or the frame is from the runtime itself.

---

## Cheat Sheet

```go
// Capture PCs (cheap)
pcs := make([]uintptr, 32)
n := runtime.Callers(2, pcs)
pcs = pcs[:n]

// Resolve to (func, file, line)
frames := runtime.CallersFrames(pcs)
for {
    f, more := frames.Next()
    fmt.Printf("%s %s:%d\n", f.Function, f.File, f.Line)
    if !more { break }
}

// One-shot human-readable text
b := debug.Stack()
fmt.Println(string(b))

// Print to stderr
debug.PrintStack()

// Find caller info
pc, file, line, ok := runtime.Caller(1)

// Dump every goroutine
buf := make([]byte, 1<<16)
n := runtime.Stack(buf, true)

// Set traceback verbosity
debug.SetTraceback("all")
```

```bash
GOTRACEBACK=all go run main.go
```

---

## Self-Assessment Checklist

- [ ] I can read a panic stack trace and find the failing line.
- [ ] I can capture a stack without panicking using `debug.Stack`.
- [ ] I know what `skip` means in `runtime.Caller` and `runtime.Callers`.
- [ ] I know how to dump every goroutine with `runtime.Stack(buf, true)`.
- [ ] I know what `GOTRACEBACK` does and the values `none`, `single`, `all`, `system`, `crash`.
- [ ] I know that errors do not carry stack traces by default.
- [ ] I do not call `runtime/debug.Stack` in hot paths.
- [ ] I avoid sending raw stacks to users.

---

## Summary

Stack traces are how Go tells you *where* code was running when something interesting happened — a panic, a captured snapshot, or a goroutine dump. The runtime prints them automatically on panic and exposes a small API (`runtime.Caller`, `runtime.Callers`, `runtime/debug.Stack`) to capture them on demand. They are not part of the `error` value by default; you opt in. Read traces top-to-bottom, lean on `GOTRACEBACK=all` and `SIGQUIT` for free debugging, and keep stacks out of hot paths and untrusted output.

---

## What You Can Build

- A small recovery middleware for an HTTP server that logs panic + stack and returns 500.
- A custom logger that prefixes every log line with the caller's file:line.
- A diagnostic CLI flag (`--dump-goroutines`) that calls `runtime.Stack(buf, true)` and prints to stderr.
- A "where am I" decorator function used in unit tests to mark setup steps with their location.

---

## Further Reading

- [Package runtime/debug](https://pkg.go.dev/runtime/debug)
- [Package runtime — Stack, Caller, Callers, FuncForPC, CallersFrames](https://pkg.go.dev/runtime)
- [The Go Blog: Stack traces and the runtime](https://go.dev/blog/) (search "traceback" or "panic")
- [Diagnostics](https://go.dev/doc/diagnostics) — official guide to debugging Go programs
- [Delve debugger](https://github.com/go-delve/delve)

---

## Related Topics

- [05-wrapping-unwrapping-errors](../05-wrapping-unwrapping-errors/junior.md) — `%w` does *not* capture a stack
- [07-panic-and-recover](../07-panic-and-recover/junior.md) — panic is the most common source of a trace
- 04-custom-error-types — adding a stack field to an error
- 03-error-vs-panic — when to escalate to panic so a trace gets printed

---

## Diagrams & Visual Aids

```
   panic
     |
     v
+----------+
| bottom() |  <-- top of trace
+----------+
| middle() |
+----------+
| top()    |
+----------+
| main()   |  <-- bottom of trace
+----------+
```

```
PCs (cheap)               Frames (slower)
[uintptr, uintptr, ...]   func, file, line
        |                       ^
        |                       |
runtime.Callers     ------>  runtime.CallersFrames
```

```
goroutine 1 [running]:
main.fail()
        /tmp/main.go:6 +0x39
main.main()
        /tmp/main.go:10 +0x17
```
