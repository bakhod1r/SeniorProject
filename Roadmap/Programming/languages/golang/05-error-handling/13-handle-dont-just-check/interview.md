# Handle, Don't Just Check — Interview Questions

> Cross-level interview prep on Cheney's principle and graceful error handling. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What does "don't just check errors, handle them gracefully" mean?
**Short answer:** Do not stop at `if err != nil { return err }`. Decide what to do — recover, retry, transform, surface, log, or abort — at every error site. "Checking" is the reflex; "handling" is the decision.

**Stronger answer:** Cheney's 2016 essay argued that Go's verbosity around `if err != nil` is not the problem; the *content* between check and return is. Every error site is a small design decision; treat it as one.

---

### Q2. Is `if err != nil { return err }` always wrong?
No. It is correct when the caller has more context than you and there is genuinely nothing to do at this layer. It becomes lazy when it is the *reflex* answer to every error — not because surfacing was the right decision, but because no decision was made.

---

### Q3. Name the six decisions you can make on a non-nil error.
Recover, retry, transform, surface, log, abort.

| Decision | Example |
|----------|---------|
| Recover | Return defaults |
| Retry | Loop with backoff |
| Transform | Map to domain sentinel |
| Surface | `return fmt.Errorf("op: %w", err)` |
| Log | `log.Printf` and continue |
| Abort | `panic(err)` |

---

### Q4. What is the "happy path stays straight" idiom?
Idiomatic Go pulls error branches *out* of the main flow with early returns, so the success story stays at the left margin:

```go
x, err := step1()
if err != nil { return err }
y, err := step2(x)
if err != nil { return err }
return finish(y)
```

No `else` blocks; no nested success indentation. The reader follows the plot top-to-bottom.

---

### Q5. Why is "log and return" an anti-pattern?
The next layer logs again. Five layers of "log and return" produce five copies of the same error in the log. The signal-to-noise ratio collapses. Rule: **log OR return, not both.** One owner per error.

---

### Q6. What does it mean to "transform" an error at a boundary?
Re-express the error in the next layer's vocabulary. A storage adapter sees `sql.ErrNoRows` and returns `ErrUserNotFound`. The HTTP handler sees `ErrUserNotFound` and returns `404`. Each layer translates so the next reader gets a familiar dialect.

---

### Q7. When should you panic vs. return an error?
- **Panic** for *programmer errors* (impossible state, broken invariant) and for irrecoverable startup failures with no caller.
- **Return error** for *expected* failures: I/O, network, validation, parsing.

A library that panics on bad input forces every caller to defensively wrap with `recover` — a poor API.

---

## Middle

### Q8. When is it correct to retry, and when is it not?
A retry is correct only when:
1. The operation is **idempotent** (calling twice has the same effect as once), and
2. The error is **transient** (network blip, transient unavailability, deadline near-miss).

Retrying a non-idempotent op causes duplicate side effects. Retrying a non-transient error wastes time and budget. Both conditions must hold.

---

### Q9. What is exponential backoff with jitter and why use it?
Each retry waits longer than the last (exponential), with a random component (jitter). Exponential gives a struggling service breathing room; jitter prevents synchronised retries from thousands of clients arriving at once ("thundering herd").

```go
delay := time.Duration(rand.Int63n(int64(base * (1 << attempt))))
```

---

### Q10. How do you handle errors from goroutines you spawn?
Two options:

1. **`golang.org/x/sync/errgroup`** — the idiomatic way for fan-out:
   ```go
   g, ctx := errgroup.WithContext(ctx)
   for _, x := range items {
       x := x
       g.Go(func() error { return work(ctx, x) })
   }
   return g.Wait()
   ```

2. **Channels** — for explicit collection of all errors.

In both cases, *every spawned goroutine should also have a `defer recover()`* to prevent a panic from crashing the whole process.

---

### Q11. What is the errWriter pattern?
Capture errors in a state field instead of checking after every operation:

```go
type errWriter struct {
    w   io.Writer
    err error
}
func (e *errWriter) write(p []byte) {
    if e.err != nil { return }
    _, e.err = e.w.Write(p)
}
```

Long sequences of writes collapse into one error decision at the end. Pattern from Rob Pike's "errors are values".

---

### Q12. How should you treat `context.Canceled` and `context.DeadlineExceeded`?
As *expected* signals to stop, not as failures. Recommendations:

- Surface as-is (`return ctx.Err()`); do not wrap with "failed".
- Filter from error metrics so cancellations do not trigger alerts.
- Do not log them at warn/error level; debug or info is enough.

---

### Q13. When should you wrap with `%w` vs. break the chain with `%v`?
- **Wrap (`%w`)** when callers may want to `errors.Is`/`errors.As` the inner error — typically in storage and infrastructure layers.
- **Break (`%v`)** when the inner error's identity is an implementation detail you do not want callers to depend on. Useful at public-package boundaries to keep the API surface clean.

---

### Q14. How do you map domain errors to HTTP status codes?
Centralise the table at the transport boundary:

```go
func httpStatus(err error) int {
    switch {
    case errors.Is(err, ErrNotFound):       return 404
    case errors.Is(err, ErrAlreadyExists):  return 409
    case errors.Is(err, ErrInvalidInput):   return 400
    case errors.Is(err, ErrUnauthorized):   return 401
    default:                                 return 500
    }
}
```

One table, one place to update. Internal sentinels never leak; clients see only HTTP semantics.

---

### Q15. What is "degraded mode" and why does it matter?
A response strategy in which the service continues to serve requests with reduced functionality when a non-critical dependency fails. Examples: cached recommendations when the personaliser is down, generic feed when the user-specific one fails. Recovery + observability gives you a graceful failure mode for users and a clear signal for operators.

---

## Senior

### Q16. What does it mean for a service to "own" an error?
A single layer is responsible for *deciding* what to do about it. Every other layer either surfaces (with context) or has nothing to add. Ownership prevents "log and return" chains, double-handling, and ambiguous responsibility. Typical owners: top-level HTTP middleware, worker recovery, scheduled job runner.

---

### Q17. How do circuit breakers fit into "handle, don't just check"?
A breaker turns *cascading transient failures* into a *handled* failure. After N consecutive errors to a downstream, the breaker opens; subsequent calls return `ErrBreakerOpen` immediately without hitting the downstream. The caller sees a known, decidable error and can pick degraded mode. Without a breaker, the same call would surface as a confusing timeout.

---

### Q18. What is a saga and why does it matter for error handling?
A saga is a sequence of local transactions across services, each with a *compensator* (undo action). When step 4 of 6 fails, compensators run in reverse to bring the system back to a consistent state. Saga handling rule: *never just surface a failure mid-saga* — always compensate first. Surfacing without compensating leaves the system inconsistent.

---

### Q19. What is the difference between fail-fast and fail-soft?
- **Fail-fast** — error → immediate, loud failure. Used when an inconsistent state is dangerous (financial transactions, config validation at startup).
- **Fail-soft** — error → degraded behaviour, user still served. Used for non-critical features (recommendations, analytics, decoration).

A senior service is explicit about which paths are fail-fast and which are fail-soft. Default to fail-fast unless degraded mode is designed in.

---

### Q20. How do error budgets affect handling decisions?
If your SLO is 99.9%, your error budget is 0.1%. Once the budget is half spent, handling becomes more conservative — broader retries, longer breaker cooldowns, slower deploys. Once the budget is exhausted, you cannot risk new releases. The handling policy is a function of how much budget remains.

---

### Q21. Why is multiplicative retry across services dangerous?
If service A retries 3 times, calling B that retries 3 times, calling C that retries 3 times, a single C blip becomes 27 attempts and a 3 × 3 × 3 latency multiplier. The user-visible request blows past timeouts. Solution: enforce *one* retry layer per request graph — typically the outermost.

---

### Q22. How do you make an HTTP handler safe against panics?
A recovery middleware:

```go
func recover(next http.Handler) http.Handler {
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

One recovery, at the top. Internal handlers do not need their own. The middleware also enforces "no stack traces in responses" — important for security.

---

### Q23. What is the canonical mapping from errors to gRPC codes?
| Error | gRPC code |
|-------|-----------|
| `ErrNotFound` | `codes.NotFound` |
| `ErrInvalidInput` | `codes.InvalidArgument` |
| `ErrPermissionDenied` | `codes.PermissionDenied` |
| `ErrUnauthenticated` | `codes.Unauthenticated` |
| Transient/upstream | `codes.Unavailable` |
| Anything else | `codes.Internal` |

The boundary maps; internal layers keep their own vocabulary.

---

## Professional

### Q24. What is the cost of `fmt.Errorf("ctx: %w", err)`?
Roughly 2-3 allocations and 150-300 ns. Acceptable on cold paths; measurable on hot ones. The allocations are: the `*wrapError` struct, the formatted message string, and (sometimes) the variadic `[]any` for arguments.

---

### Q25. How does branch prediction interact with `if err != nil`?
On the happy path, errors are rare; the predictor learns to predict "branch not taken" almost perfectly. The cost of the check is one or two predictable instructions. On error paths, the predictor mispredicts, but those paths are rare so the amortised cost is negligible. *The happy path stays fast precisely because the error path is the explicit branch.*

---

### Q26. Why was the `try` proposal rejected?
The `try` builtin would have made surface-handling implicit (`v := try(step())`). It was rejected because:
1. It hid the decision — `try` always means "surface", suppressing other choices.
2. It made lazy handling easier, defeating the visibility that explicit `if err != nil` provides.
3. It did not compose well with wrapping.
4. The community valued visible decisions over keystroke savings.

---

### Q27. How does Go's error model compare with Rust's `Result<T, E>`?
Both use values, both make errors visible in signatures. Differences:
- Rust's `?` operator is the equivalent of the rejected Go `try` — accepted there because Rust prizes terseness.
- Rust's compiler refuses unhandled errors; Go's only refuses uninitialised variables.
- Both lack stack traces by default; Rust uses `Backtrace` opt-in similar to Go's `runtime.Callers`.

Cheney's principle applies in both languages — both let you choose to handle, both let you be lazy.

---

### Q28. How does Go's error model compare with exception-based languages?
| Aspect | Go | Java/C# |
|--------|----|---------| 
| Handling visibility | Explicit at every site | Often hidden in catch-all clauses |
| Default behaviour | Forces a decision | Implicit propagation |
| Cost of "throw" | Free (return) | µs (stack capture) |
| Cost of catch | Free (predictable branch) | µs (filter) |
| Lazy handling | `return err` (visible) | `catch (Exception ignored) {}` (almost invisible) |

Go forces the writer to *say* what to do at the throw site; exceptions let the catch site (often far away) decide.

---

### Q29. What is the typed-nil pitfall in error returns?
```go
var p *MyErr // nil
return p     // returns a non-nil error interface that wraps a nil pointer
```

The interface header has a non-nil type pointer (`*MyErr`) and a nil data pointer. `err == nil` is false; `err.Error()` panics. Always return the literal `nil`, not a typed-nil, when there is no error.

---

### Q30. How do you make a high-volume hot path allocation-free for errors?
- Return *static sentinels* (`var ErrFoo = errors.New("foo")`) instead of constructing per call.
- Use *typed errors* with embedded fields rather than `fmt.Errorf`.
- Defer wrapping to the boundary instead of wrapping at every step.
- Avoid stack capture; capture only at recovery sites.

A parser that returns `errInvalidToken` (sentinel) is allocation-free; one that does `fmt.Errorf("invalid token at %d", pos)` allocates per token.

---

## Behavioural / Code Review

### Q31. You see a PR with `if err != nil { log.Printf("err: %v", err); return err }`. What do you say?
Two issues. (1) The wrap message is content-free — "err: %v" tells the reader nothing. Use `fmt.Errorf("op name: %w", err)` so context grows by layer. (2) Logging *and* returning duplicates the noise. Pick one. If this is the boundary, log; if it is an internal layer, just return.

---

### Q32. A junior asks: "Why doesn't Go just have try/catch like Java?"
Because it would let the writer skip the decision. The verbosity of `if err != nil` is the cost paid for visibility — every error site is a moment to think. Java code that pretends to handle but actually swallows is a real and large class of bug; Go's verbosity makes that pattern obvious in review.

---

### Q33. You are designing an HTTP API for a CRUD service. How do you structure errors?
- **Domain sentinels** (`ErrNotFound`, `ErrAlreadyExists`, etc.) returned by the application layer.
- **Custom types** for errors that carry data (`ValidationError{Field, Reason}`).
- **A boundary middleware** that maps sentinels to status codes and unknown errors to 500 with a logged stack.
- **No internal vocabulary leaking** — clients never see SQL, never see file paths, never see stack traces.

Document the model in a 2-3 page README. Enforce in PR review.

---

### Q34. You see a service that retries on every error. What is wrong?
At least two things:
1. Non-transient errors (validation, auth) get retried wastefully and never succeed.
2. Without idempotency the retry causes duplicate side effects (double-charged customers, duplicate inserts).

Fix: a `retryable(err) bool` predicate that whitelists transient kinds, and idempotency keys for any non-trivially-idempotent operation.

---

### Q35. The team's logs are full of "error" lines that say nothing. How do you fix the culture?
Three steps:
1. **Document the error model** — sentinels, wrapping rules, who logs.
2. **Add structured logging** with `request_id`, `user_id`, `op` — make it easy to write a useful log line.
3. **Code review with specific feedback** — every reviewer asks "what does this wrap message tell the reader?" and "is this layer logging *and* returning?" Over a few weeks, the habit shifts.

The culture problem is not "people are bad"; it is that the right thing was never documented or modelled. Make the right thing easy and the wrong thing visible.

---

### Q36. A handler does `defer file.Close()` for a file you wrote. Acceptable?
Mostly no. `Close` may report buffer-flush errors — meaning data may not be on disk. Pattern:

```go
err := write(file)
if cerr := file.Close(); err == nil {
    err = cerr
}
return err
```

For files you only read, `defer file.Close()` is acceptable because read errors surface during reads.

---

### Q37. A spawned goroutine has no `recover`. Is this a problem?
Almost always yes. A panic in any goroutine kills the entire process — Go does not isolate goroutine panics. Every `go f()` you write should have a recovery, *unless* you explicitly want crash-on-panic (e.g., a worker that should be restarted by the orchestrator after a clean state reset).

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    work()
}()
```

---

### Q38. Describe the worst error-handling bug you have debugged.
Open-ended. A strong answer narrates:
1. **The symptom** — users seeing 500s, double-charges, lost data.
2. **The investigation** — logs, traces, tests, reproduction.
3. **The root cause** — usually one of: swallow, missed retry, non-idempotent retry, missed translation.
4. **The fix** — what code changed.
5. **The systemic change** — what convention or guardrail prevents recurrence (a lint rule, a doc, a test).

The systemic change is what distinguishes a senior answer from a junior one.

---

### Q39. You have 30 seconds to summarise Cheney's principle. Go.
*Don't just check errors, handle them gracefully.* Every `if err != nil` is a decision: recover, retry, transform, surface, log, or abort. The verbosity of `if err != nil` is the price of an explicit value-based model — its purpose is to force you to think. The content between the check and the return is what makes the code good. Keep the happy path straight, log once at the boundary, and reserve panic for impossible states.
