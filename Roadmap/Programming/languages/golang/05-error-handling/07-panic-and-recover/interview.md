# panic and recover — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has a question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What does `panic` do?
**Short answer:** It stops normal execution of the current function, runs all deferred calls in this function and up the call stack, and (if not recovered) crashes the program with a stack trace.

**Stronger answer:** It begins a **stack-unwinding sequence** initiated by the runtime. Each frame's deferred functions run in LIFO order. A `recover` inside any of them stops the unwinding. Otherwise the goroutine dies; if it is the only or main goroutine, the program exits with code 2.

---

### Q2. What does `recover` do?
**Short answer:** Inside a deferred function during an active panic, `recover()` captures the panic value and stops the unwinding. Outside that scenario, it returns nil and does nothing.

---

### Q3. Where must `recover()` be called?
**Directly in a deferred function.** The canonical shape:

```go
defer func() {
    if r := recover(); r != nil { /* ... */ }
}()
```

Calling `recover()` in a function called by a deferred function does not work — it returns nil.

---

### Q4. What is the difference between `panic` and `error`?
- **error**: a value returned to the caller; for *expected* failures the caller can handle.
- **panic**: a runtime unwinding sequence; for *impossible states* and bugs.

Errors are everyday, panics are exceptional. A well-written Go program returns errors thousands of times and panics zero or one times.

---

### Q5. Can a `defer` run during a panic?
Yes. Defers are the *only* code that runs during a panic. That is also why `defer` is the bridge between `panic` and `recover` — without `defer`, `recover` has nowhere to live.

---

### Q6. Name three things that cause a built-in (runtime) panic.
- Nil pointer dereference.
- Index out of range.
- Integer divide by zero.
- Nil map write.
- Send on a closed channel.
- Failed type assertion (single-value form).

---

### Q7. What happens if a panic in a goroutine is not recovered?
**The whole program crashes.** Other goroutines do not get to clean up. There is no "kill just this goroutine" path.

---

## Middle

### Q8. Write the canonical `defer/recover` pattern.
```go
defer func() {
    if r := recover(); r != nil {
        // r is `any`; type-assert to use
    }
}()
```

It must be:
- Declared with `defer`.
- An anonymous function (or a function whose body contains `recover` directly).
- Above the code that may panic.

---

### Q9. What is the panic-to-error idiom?
A function uses `defer/recover` to convert any internal panic into a returned error:

```go
func F() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("F panicked: %v", r)
        }
    }()
    risky() // may panic
    return nil
}
```

Crucially, `(err error)` is a **named return** so the deferred function can write to it.

Used at API boundaries to keep external callers in the `if err != nil` world while internal code is free to panic on impossible states.

---

### Q10. Why does a panic in a goroutine crash the whole program?
Because Go does not provide a "kill just one goroutine" option. The runtime decision: a panicking goroutine that runs out of frames means "we are in an impossible state" and the only safe response is to crash the process. Recovery, if desired, must be set up *inside* the goroutine before launching.

---

### Q11. How do you make a goroutine panic-safe?
Wrap it in a recover:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("goroutine panic: %v", r)
        }
    }()
    work()
}()
```

For frequent use, extract a `goSafe` helper.

---

### Q12. Does `defer` run when `os.Exit` is called?
**No.** `os.Exit` terminates the process directly — no defers, no cleanup. This is why panicking is sometimes preferred for fatal scenarios: defers (for cleanup) still run.

---

### Q13. What is the difference between `panic`, `os.Exit`, and `log.Fatal`?

| | Defers run? | Recoverable? | Default exit code |
|---|---|---|---|
| `panic("x")` | Yes | Yes | 2 |
| `os.Exit(1)` | **No** | No | 1 |
| `log.Fatal(...)` | **No** (calls `os.Exit`) | No | 1 |
| `log.Panic(...)` | Yes (calls `panic`) | Yes | 2 |

---

### Q14. How do you capture a stack trace on panic?
```go
import "runtime/debug"

defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

`debug.Stack()` returns the current goroutine's stack as `[]byte`. Costs ~10 µs per call.

---

### Q15. What is `MustX` and when is it appropriate?
A `MustX` function panics on errors instead of returning them. Used when the caller has *guaranteed* valid input — typically static data:

```go
var rx = regexp.MustCompile(`^[a-z]+$`)
```

If the regex literal is wrong, the program panics at startup, which is the right time to find out.

Provide both `Compile` (returns error) and `MustCompile` (panics) in libraries.

---

### Q16. What is "re-panic"?
Calling `panic(r)` from inside a recover, to continue the unwinding after partial handling:

```go
defer func() {
    if r := recover(); r != nil {
        log.Print("logged:", r)
        panic(r) // pass it on
    }
}()
```

Useful when you want to log/observe but not actually consume the panic. Lose stack trace clarity, though — the new panic shows the re-panic location.

---

## Senior

### Q17. Should libraries panic, and if so, when?
A library should panic only:
- For *programmer errors* (caller violated documented preconditions: passing nil, calling methods in the wrong order).
- Inside `MustX` companion functions, where the user opts in.

A library should *never* panic on data the caller cannot validate (file not found, bad input, network failure). Those are errors.

The convention is part of the API contract. Document it.

---

### Q18. What is a "panic boundary"?
A layer in the architecture where panics from below are caught and handled. Common boundaries:
- HTTP middleware (per-request).
- gRPC interceptor (per-RPC).
- Goroutine launcher (per-goroutine).
- Worker pool dispatch.

Inside a boundary, code is free to panic; outside, panics are unexpected. Production systems define these explicitly.

---

### Q19. When should you NOT recover a panic?
When the panic indicates that **shared state is corrupted** and continuing would propagate corruption. Examples:
- Panic during a database transaction with side effects already committed externally.
- Panic during a write to a shared cache that may have left it in a partial state.
- Runtime fatal errors (concurrent map writes, deadlocks) — `recover` cannot catch them anyway.

In those cases, crash the process and let a supervisor restart it cleanly.

---

### Q20. How do panics interact with `defer` resource cleanup?
Defers run during panic. So `defer mu.Unlock()`, `defer f.Close()`, `defer cancel()` — all run.

The trap: just because the resource is *released* does not mean the data it protected is *consistent*. A panic mid-write may leave shared state in a half-updated state. Other goroutines holding the same lock will see partial data. Designing for panic-safety means thinking about invariants, not just cleanup.

---

### Q21. What is goroutine supervision?
A pattern where long-lived goroutines run inside a recover wrapper that logs panics and optionally restarts them with backoff:

```go
func Supervise(name string, work func()) {
    backoff := time.Second
    for {
        safe := func() {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("supervise %s: %v", name, r)
                }
            }()
            work()
        }
        safe()
        time.Sleep(backoff)
        if backoff < time.Minute { backoff *= 2 }
    }
}
```

Borrowed from Erlang's "let it crash, supervise the restart" philosophy. Crucial for production services with long-lived workers.

---

### Q22. How should panics integrate with metrics and alerting?
- Increment a counter on every recovered panic, labeled by boundary.
- Log full stack trace on first observation; sample after that.
- Page on sustained panic rate (e.g., > 1/min).
- Do not page on single one-off panics; file a ticket instead.
- Tag traces with "panic recovered: yes" so observability tools can group.

---

### Q23. How is `panic(nil)` handled in modern Go?
Pre-1.21: `panic(nil)` was legal; `recover()` returned nil; the recover code thought no panic happened (footgun).

Go 1.21+: `panic(nil)` is replaced by `panic(&runtime.PanicNilError{})`. `recover()` returns the non-nil sentinel, and recover code can detect that someone called `panic(nil)`.

---

## Professional

### Q24. What runtime data structures back panic and defer?
- **`g._panic`**: linked list of active panics (since defers can panic during a panic).
- **`g._defer`**: linked list of registered defers, LIFO.
- Both are fields on the goroutine struct (`g`). Defers may be on stack or heap depending on escape analysis and lifetime.

The runtime walks `_defer` during panic propagation; `recover` sets `_panic.recovered = true`.

---

### Q25. What is an "open-coded defer"?
An optimization (Go 1.14+) where the compiler inlines simple defers directly into the function body, avoiding the cost of registering a `_defer` struct at runtime. Conditions:
- At most 8 defers per function.
- All defers are unconditional (not in a loop).
- The function does not use `recover` extensively in ways the optimizer cannot see.

Result: defer overhead drops from ~50 ns to ~2 ns. The optimization is automatic.

---

### Q26. How does `recover()` know it is in a "directly" deferred function?
The compiler passes the caller's argument-pointer (`argp`) implicitly. The runtime compares this to the recorded `argp` of the active deferred call. They match only when the caller of `recover` is the deferred function itself, not a function called by it.

This is why `defer logRecover()` (where `logRecover` calls `recover`) is borderline and `defer cleanup()` where `cleanup` calls `helper()` and `helper` calls `recover` is broken.

---

### Q27. Can `recover` catch a `runtime.Error`?
Yes. Runtime panics (nil deref, out-of-range, etc.) go through the same `gopanic` machinery as user panics. From `recover`'s perspective they are identical — only the value's type differs (`runtime.Error` versus whatever the user panicked with).

---

### Q28. What is `runtime.throw`, and why can't `recover` catch it?
`runtime.throw` is the runtime's "fatal error" mechanism, used for invariant violations the runtime cannot recover from: concurrent map writes, deadlock detection, some allocation failures. It bypasses `gopanic` entirely — prints a message, dumps all goroutine stacks, calls `runtime·exit`.

`recover` only sees panics that go through `gopanic`. Fatal errors are not panics.

---

### Q29. How expensive is panic+recover compared to a normal return?
- Plain return: ~1 ns.
- panic + recover (one frame): ~500 ns.
- panic + recover (10 frames deep): ~1-2 µs.

So panic+recover is roughly **100-500x slower** than a normal return. Why: allocate `_panic` record, walk the deferred-call list, run each, set up recovery jump.

This is why panic must not be used for control flow.

---

### Q30. How does the runtime know which function frames have defers when panicking?
Stack frame metadata. The compiler emits per-function metadata (used by GC, scheduler, panic walker) that includes pointer to deferred call records and (for open-coded defers) a bitmap of which inline defers are active.

The panic walker uses the same metadata as the GC stack scanner — they are shared infrastructure.

---

## Behavioral / Code Review

### Q31. You see `defer func() { recover() }()` in code review. Acceptable?
**Bad.** It swallows panics silently — no log, no metric, no error returned. This makes bugs invisible. At minimum:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered panic: %v", r)
    }
}()
```

Better: integrate with the team's error logging or metrics convention.

---

### Q32. A junior asks: "Why not just panic and recover for all errors?"
- Panic does not appear in the function signature. Callers cannot anticipate it.
- Panic is ~100x slower than a return.
- Panic obscures the data flow — readers cannot tell where execution leaves a function.
- Panic in a goroutine without recover crashes the program.
- Tests must use special patterns (defer-recover) to assert panics.
- Mixed panic/error code is harder to refactor, harder to lint, harder to grep.

In short: errors are the model the language was designed for. Panic is the safety net.

---

### Q33. You see a long-running worker goroutine launched without a recover wrapper. How do you respond?
"This is a production risk. One panic in `process()` will crash the entire service. Wrap the goroutine in a recover that logs and either restarts the worker or signals the supervisor. Show me the call site, I'll suggest the pattern."

The fix:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
            // restart or alert
        }
    }()
    worker()
}()
```

---

### Q34. A library uses `panic` for "validation errors" caught by the caller's recover. Good design?
Bad. Validation errors are *expected* failures (the user gave bad input). They should be returned as errors so callers handle them in normal control flow. Forcing callers to write `defer/recover` to handle expected validation breaks Go convention and surprises everyone reading the code.

The fix: return `error`. Document the kinds of validation errors. If you want, provide a `MustValidate` companion that panics for static input.

---

### Q35. When designing an HTTP middleware that recovers, what should it do?
Standard implementation:
1. Catch the panic with `recover`.
2. Log the panic value plus stack trace at ERROR level, with request context (method, path, request ID).
3. Increment a metric tagged by route.
4. Return a 500 Internal Server Error to the client with a generic message (no stack details).
5. Optionally, call an alerting hook for first-of-kind panics.

Crucially, **do not** include the panic value or stack trace in the HTTP response — that leaks code structure to clients.
