# Stack Traces & Debugging — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Capture vs Display: A Real Decision](#capture-vs-display-a-real-decision)
3. [PCs, Frames, and the Two-Stage API](#pcs-frames-and-the-two-stage-api)
4. [Building a Stack-Aware Error Type](#building-a-stack-aware-error-type)
5. [Third-Party Error Packages](#third-party-error-packages)
6. [Inlining and Why Frames Disappear](#inlining-and-why-frames-disappear)
7. [Goroutine Dumps in Practice](#goroutine-dumps-in-practice)
8. [GOTRACEBACK and SetTraceback](#gotraceback-and-settraceback)
9. [The Cost of Capture](#the-cost-of-capture)
10. [Patterns That Show Up Everywhere](#patterns-that-show-up-everywhere)
11. [Logging Stacks Like a Grown-Up](#logging-stacks-like-a-grown-up)
12. [Tests That Print Helpful Stacks](#tests-that-print-helpful-stacks)
13. [The pprof Tools (Preview)](#the-pprof-tools-preview)
14. [Common Anti-Patterns](#common-anti-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the *mechanics*: print the stack with `debug.Stack()`, use `runtime.Caller` to find your caller. At middle level the question shifts. You have a service that returns errors across packages, panics that cross goroutines, and stacks that get logged in three different formats. You need to decide *when* to capture, *where* to format, and *what* to attach to which value.

This file is the answer set: **what stacks cost, when to capture them, and how to structure them so they help in production rather than fill up your log volume.**

---

## Capture vs Display: A Real Decision

Two distinct moments in the life of a stack trace:

- **Capture** — the moment you record the frames. Cheap if you only collect PCs; expensive if you symbolize.
- **Display** — the moment you turn the frames into human text. Always expensive.

Naive code does both at once: `fmt.Println(string(debug.Stack()))`. That is fine for *one* call. For a system that captures a stack on every error and *never* prints them (because the errors are handled silently), you have wasted hundreds of microseconds per request.

**Heuristic:**

| If… | Do… |
|-----|-----|
| Errors are rare and humans always read them | Capture + symbolize at origin |
| Errors are rare but most are silently handled | Capture PCs only, symbolize lazily |
| Errors are *very* common (parser, validator) | Do not capture; rely on context strings |
| You panic | Let the runtime print it for you |

The cheap path is `runtime.Callers` into a fixed-size array. Symbolize only when something — a logger, a debugger, a test — actually wants to see the trace.

---

## PCs, Frames, and the Two-Stage API

Go's runtime gives you four routines worth knowing:

```go
runtime.Caller(skip int) (pc uintptr, file string, line int, ok bool)
runtime.Callers(skip int, pc []uintptr) int
runtime.FuncForPC(pc uintptr) *runtime.Func
runtime.CallersFrames(callers []uintptr) *Frames
```

- **`Caller`** — one frame, slow per call (it does symbolization for you). Convenient for "where am I" lines but a poor choice if you need many frames.
- **`Callers`** — many PCs at once, no symbolization. The fast capture primitive.
- **`FuncForPC`** — symbolizes a single PC into a `*runtime.Func`. Returned function exposes `Name()` and `FileLine(pc)`. Does *not* understand inlining well.
- **`CallersFrames`** — symbolizes a slice of PCs and **understands inlining**. The modern, correct way.

Always prefer `Callers` + `CallersFrames` over `FuncForPC` for new code. `FuncForPC` exists for backward compatibility and produces wrong results when inlining merged multiple "real" calls into one frame.

```go
pcs := make([]uintptr, 32)
n := runtime.Callers(2, pcs)  // skip Callers itself + your wrapper
frames := runtime.CallersFrames(pcs[:n])
for {
    f, more := frames.Next()
    fmt.Printf("%s\n  %s:%d\n", f.Function, f.File, f.Line)
    if !more { break }
}
```

The `2` skips two frames: `runtime.Callers` and your wrapper. If you call `runtime.Callers` directly from the function you want to start at, use `1`.

---

## Building a Stack-Aware Error Type

Standard-library errors do not carry a stack. If you want one, build it:

```go
type stackErr struct {
    msg string
    err error
    pcs []uintptr
}

func (e *stackErr) Error() string { return e.msg }
func (e *stackErr) Unwrap() error { return e.err }

// StackTrace returns a slice of resolved frames.
func (e *stackErr) StackTrace() []runtime.Frame {
    out := make([]runtime.Frame, 0, len(e.pcs))
    fs := runtime.CallersFrames(e.pcs)
    for {
        f, more := fs.Next()
        out = append(out, f)
        if !more { break }
    }
    return out
}

func New(msg string) error {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &stackErr{msg: msg, pcs: pcs[:n]}
}

func Wrap(err error, msg string) error {
    if err == nil { return nil }
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &stackErr{msg: msg + ": " + err.Error(), err: err, pcs: pcs[:n]}
}
```

Notes:
- The PC slice is captured *eagerly*. Symbolization happens only if `StackTrace()` is called.
- The `Unwrap` method keeps the error chain intact for `errors.Is` and `errors.As`.
- A 32-frame buffer is plenty for almost every case.

A common improvement: capture once, and on subsequent `Wrap` calls **inherit** the bottom error's stack instead of capturing a new one. That is what `pkg/errors` did, and it is the right default for layered errors.

---

## Third-Party Error Packages

Two packages dominate the historical "errors with stack traces" niche:

### `github.com/pkg/errors` (Dave Cheney's package, archived)

Introduced `errors.Wrap`, `errors.WithStack`, and a `StackTrace()` method on its error types. It taught the community that:
- A stack trace is most useful when captured at the *origin*.
- Wrapping should add context, not new stacks.
- `%+v` formatting can print the trace.

It is now archived. New code should use either the standard library or `cockroachdb/errors`.

### `github.com/cockroachdb/errors`

A more featureful, currently maintained package used by CockroachDB. Highlights:
- Captures stack at origin and preserves it across wraps.
- Provides `errors.WithStack`, `errors.Wrap`, `errors.WithSafeDetails`.
- Has telemetry helpers, sentinel-aware detection, and wire encoding.
- Compatible with the standard library's `errors.Is`/`errors.As`/`%w`.

If your team really needs error-attached stacks at scale, `cockroachdb/errors` is the modern answer.

### A modern minimal alternative

Many projects skip the dependency and instead:

1. Capture the stack only at the **panic recovery boundary**, not on every error.
2. Use structured logging + a request ID to correlate.
3. Use distributed tracing (OpenTelemetry) for cross-service "where".
4. Reserve attached stacks for genuine "we cannot reproduce this without one" cases.

That gets you 90% of the diagnostic value without the per-error allocation tax.

---

## Inlining and Why Frames Disappear

The Go compiler aggressively inlines small functions. After inlining, a "call" you wrote in source code may not exist at runtime as a separate frame. This affects stack traces in two ways:

1. **Without `CallersFrames`**, an inlined call appears as the *outer* function only. You lose a frame.
2. **With `CallersFrames`**, the runtime knows the inline relationship and emits a virtual frame for the inlined function so you see both names. Use it.

Inlining is also why some traces have `(...)` instead of argument types — the compiler has lost the precise type information at that point.

**To disable inlining** during a debugging session:
```bash
go build -gcflags='all=-l' ./...
```
or for a single package:
```bash
go test -gcflags='-l' ./mypkg
```

This produces slower binaries but trace-friendlier ones. Useful only for diagnosis.

---

## Goroutine Dumps in Practice

A goroutine dump is a stack trace *for every goroutine alive at the moment the dump runs*. Three ways to get one:

### 1. SIGQUIT (Ctrl-\ on Unix terminals)

The runtime catches SIGQUIT, prints a goroutine dump, and exits with status 131. No code changes required. Good for quickly inspecting a hanging program.

### 2. `runtime.Stack(buf, true)`

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

Programmatic; you can write the dump to a file or HTTP response.

### 3. `pprof.Lookup("goroutine").WriteTo(w, 2)`

Higher-level. Returns a structured profile or — with `debug=2` — a verbose, human-readable dump similar to `runtime.Stack`. Available out of the box if you import `net/http/pprof`.

### Reading a dump

```
goroutine 47 [chan receive, 5 minutes]:
main.worker(0xc0001c0000)
        /app/main.go:42 +0x83
created by main.run
        /app/main.go:17 +0x52
```

Components:
- **Goroutine ID** — internal, but useful for grouping.
- **State** — `running`, `chan receive`, `select`, `IO wait`, `sleep`, `runnable`, etc.
- **Wait time** — how long it has been in this state.
- **Stack** — same format as a panic trace.
- **`created by`** — *who launched this goroutine*. Critical for hunting goroutine leaks.

Patterns to look for:
- **Many goroutines stuck in `chan receive`** on the same channel = forgotten producer.
- **Many in `IO wait`** = downstream service hung.
- **A growing count of `select`** for the same `created by` line = a goroutine leak.

---

## GOTRACEBACK and SetTraceback

`GOTRACEBACK` controls what the runtime prints on panic. Five settings:

| Value | Effect |
|-------|--------|
| `none` (or `0`) | No trace. |
| `single` (default, or `1`) | Only the panicking goroutine. |
| `all` (or `2`) | All goroutines, user-visible. |
| `system` | All goroutines including runtime-internal ones. |
| `crash` | `system` + abort (writes a core file on supported OSes). |

Set via environment:
```bash
GOTRACEBACK=all go run main.go
```

Or programmatically:
```go
import "runtime/debug"
debug.SetTraceback("all")
panic("now everything is dumped")
```

`SetTraceback` can only *increase* verbosity, not decrease it. So a binary launched with `GOTRACEBACK=none` cannot suddenly become verbose at runtime.

In production, `GOTRACEBACK=all` is the right default for finding latent concurrency bugs at the cost of larger crash dumps. For binaries you ship to customers, `single` is often safer (less leakage of internal structure).

---

## The Cost of Capture

Real numbers, modern x86-64, Go 1.21, no instrumentation:

| Operation | Cost |
|-----------|------|
| `if err != nil` against nil | < 1 ns |
| `errors.New("...")` package-level | 0 per call |
| `errors.New("...")` in function | ~30 ns, 1 alloc |
| `fmt.Errorf("ctx: %w", err)` | ~150 ns, 2-3 allocs |
| `runtime.Caller(1)` | ~250 ns, 1 alloc (the file string) |
| `runtime.Callers(2, pcs[:32])` | ~150 ns, 0 allocs (with caller-supplied buffer) |
| `runtime.CallersFrames` resolution | ~1 µs per 5-10 frames |
| `runtime/debug.Stack()` | 5-10 µs, multiple allocs |
| `runtime.Stack(buf, true)` (10 goroutines) | 30-100 µs |
| Panic + `recover` (no work inside) | ~1-3 µs |

**Implications:**
- A `runtime.Callers` capture per error is acceptable for most services (~150 ns).
- `debug.Stack` per error is *not* acceptable for high-volume paths.
- `runtime.Stack(_, true)` is for diagnostics, not steady-state observability.

Always measure your specific path with `go test -bench=. -benchmem` before deciding.

---

## Patterns That Show Up Everywhere

### Pattern A: Recovery middleware

```go
func recoverHandler(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic %v\n%s", rec, debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

The single most reused snippet in production Go services.

### Pattern B: Caller-aware logger

```go
type logger struct{}

func (l *logger) Logf(format string, args ...any) {
    _, file, line, _ := runtime.Caller(1)
    log.Printf("%s:%d "+format, append([]any{file, line}, args...)...)
}
```

Useful for small projects where you do not want to pull `slog`.

### Pattern C: Error with deferred symbolization

Capture cheap PCs at error origin; only symbolize when something prints them. Production-grade pattern; described in detail above.

### Pattern D: Periodic goroutine snapshot

```go
go func() {
    t := time.NewTicker(5 * time.Minute)
    for range t.C {
        if runtime.NumGoroutine() > 10000 {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            log.Printf("goroutine spike (%d):\n%s", runtime.NumGoroutine(), buf[:n])
        }
    }
}()
```

A trip-wire that dumps when goroutines exceed a threshold. Excellent leak detector.

### Pattern E: Crash on panic in a worker

For background workers, you may *want* the process to die on panic so the orchestrator restarts a clean instance:

```go
go func() {
    defer func() {
        if rec := recover(); rec != nil {
            log.Printf("worker panic %v\n%s", rec, debug.Stack())
            os.Exit(1)
        }
    }()
    workForever()
}()
```

The pattern is "log first, exit second" so the trace lands in the log before the process is gone.

---

## Logging Stacks Like a Grown-Up

Three rules:

1. **Once.** Log the stack at exactly one place — the boundary. Every additional log of the same trace is noise.
2. **Structured.** Pair the stack with `request_id`, `user_id`, `trace_id`. Without correlation, the stack is just a wall of text.
3. **Lazy.** Capture cheaply; symbolize only when the log level lets the line through.

A `slog`-style example:

```go
slog.Error("handler panic",
    "panic", fmt.Sprint(rec),
    "stack", string(debug.Stack()),
    "request_id", reqID,
)
```

The structured fields let you query for "give me the stacks of all panics for request X". A flat `log.Printf` does not.

---

## Tests That Print Helpful Stacks

`testing` already prints the test function and line for `t.Errorf` and `t.Fatalf`. Two extra patterns:

### `t.Helper`

```go
func mustOpen(t *testing.T, path string) *os.File {
    t.Helper()
    f, err := os.Open(path)
    if err != nil { t.Fatalf("open %s: %v", path, err) }
    return f
}
```

`t.Helper` tells the test framework "skip me when reporting failure locations". The reported line becomes the *caller's*, not the helper's.

### Custom assertion with stack

```go
func assertEq[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v\n%s", got, want, debug.Stack())
    }
}
```

Used sparingly when the standard `Errorf` line is not enough.

---

## The pprof Tools (Preview)

`pprof` is to Go what `valgrind` and `perf` are to C — only better integrated. Profiles are stack-trace-shaped *samples* of the running program:

| Profile | What it shows |
|---------|---------------|
| `cpu` | Where time is spent. Stacks sampled at fixed-frequency. |
| `heap` | Where memory is allocated and what is alive. |
| `goroutine` | Stacks of every live goroutine right now. |
| `block` | Where goroutines block on synchronization primitives. |
| `mutex` | Contended mutexes. |

Activate the HTTP endpoints:

```go
import _ "net/http/pprof"
// ...
go http.ListenAndServe("localhost:6060", nil)
```

Then:
```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30  # CPU
go tool pprof http://localhost:6060/debug/pprof/heap                 # heap
go tool pprof http://localhost:6060/debug/pprof/goroutine            # goroutines
```

Senior level goes deep on this. For now, know that "profile" and "stack trace" share the same building blocks — `runtime.Callers` underlies pprof samples.

---

## Common Anti-Patterns

1. **Capturing a stack for every wrap.** Five wraps = five stacks = five duplicated lists of frames. Capture once.
2. **Using `runtime/debug.Stack()` in a hot path.** It allocates and walks the whole stack every call.
3. **Printing the stack and then `panic`-ing again** — the runtime prints it a second time.
4. **Logging the trace but not the panic value.** Where ≠ what.
5. **Sending raw stack to clients** — security leak.
6. **Forgetting `t.Helper`** — your assertions report the helper line, not the test line.
7. **Not collecting goroutine dumps before killing a hung process** — invaluable evidence lost.
8. **Symbolizing too eagerly** — burning CPU on traces nobody will read.

---

## Summary

Stack traces in Go are explicit. Capturing them is split into a cheap PC-collection step and an expensive symbolization step, and middle-level engineers learn to use the right step at the right moment. Errors do not carry stacks unless you build a type that does. Goroutine dumps are the secret weapon for concurrency bugs. `GOTRACEBACK` is your dial for verbosity. `pprof` builds on the same primitives. Capture at origin, format at boundary, log once, and remember that production stacks are sensitive — handle accordingly.

---

## Further Reading

- [Diagnostics — go.dev](https://go.dev/doc/diagnostics)
- [Package runtime — Callers, CallersFrames](https://pkg.go.dev/runtime)
- [Package runtime/debug](https://pkg.go.dev/runtime/debug)
- [Dave Cheney — Stack traces and the errors package](https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package)
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors)
- [Profiling Go programs](https://go.dev/blog/pprof)
