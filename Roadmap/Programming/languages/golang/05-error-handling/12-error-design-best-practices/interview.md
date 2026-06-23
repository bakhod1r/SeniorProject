# Error Design — Best Practices — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. Why is `errors.New("Error: failed to read file.")` considered bad style?
**Short answer:** Three problems: the "Error:" prefix is redundant, the capitalized first letter composes badly when wrapped, and the trailing period reads awkwardly mid-sentence in logs.

**Stronger answer:** Wrap chains read like `read /etc/x.conf: open: no such file or directory`. Capitalizing turns this into `read /etc/x.conf: Open: No such file or directory!` — three sentences pretending to be one.

---

### Q2. What is the difference between `%w` and `%v` in `fmt.Errorf`?
- `%w` wraps the error so `errors.Is`/`errors.As` can walk the chain.
- `%v` interpolates the error's message but does not wrap.

Use `%w` when the caller might want to identify or inspect the cause. Use `%v` when you explicitly want to hide the inner error (e.g., to prevent leaking internals).

---

### Q3. When should a function panic vs return an error?
- **Panic** for *programmer errors*: contract violations, broken invariants, things no caller can sensibly handle.
- **Return** for *operational errors*: I/O, network, validation, anything a sane caller can recover from.

Concrete: panic on `nil` argument where non-nil is required; return on a missing file.

---

### Q4. What is a sentinel error?
A package-level error value compared by identity. `io.EOF` is the canonical example. Callers use `errors.Is(err, io.EOF)` to check for it. The identity (pointer) is what makes the match work, not the message.

---

### Q5. Why is matching errors by string content (`strings.Contains(err.Error(), "not found")`) bad?
- **Brittle:** the next message rewording breaks every caller.
- **Slow:** string scan vs pointer compare.
- **Leaky:** couples handling logic to internal wording.

Use `errors.Is` against a sentinel or `errors.As` against a typed error.

---

### Q6. What does "errors are values" mean?
Go errors are not exceptions. They are not magical. They are `interface { Error() string }` — values you compare, inspect, store, ship over the network. You design them with the same care as any other type. The phrase comes from Rob Pike's 2015 talk.

---

### Q7. What is the typed-nil pitfall?
```go
var p *MyErr  // nil pointer
return p      // returns non-nil error (interface contains type tag)
```

An interface value is nil only when both its dynamic type *and* value are nil. Returning a typed nil pointer produces a non-nil `error`. Always return literal `nil`:

```go
return nil
```

---

### Q8. What is the rule about logging and returning?
**Either log or return — never both.** Lower layers wrap and propagate; the boundary (HTTP handler, worker top, CLI main) is the single layer that logs. Otherwise the same failure produces N log lines.

---

## Middle

### Q9. When would you choose a typed error over a sentinel?
When callers need *fields*, not just kind. `*os.PathError` carries the path that failed; `io.EOF` does not. If your callers want to act on structured information (the offending field, the retry-after duration), use a typed error. If they only need to branch on kind, a sentinel is cheaper.

---

### Q10. How do you implement an error family that is both "a kind" and "a struct with fields"?
Implement the `Is(target error) bool` method on the typed error so it matches a sentinel:

```go
type NotFoundError struct{ Resource, Key string }
func (e *NotFoundError) Is(target error) bool { return target == ErrNotFound }
```

Now `errors.Is(err, ErrNotFound)` matches any `*NotFoundError` and `errors.As(err, &nf)` extracts the fields.

---

### Q11. What are the three handling classes you should encode for every error?
- **Retryable (transient)** — caller retries with backoff.
- **Permanent (operational)** — caller surfaces to user, no retry.
- **Programmer** — bug, panic, debug.

Encode the class as part of the error's kind (`KindTransient`, `KindInvalid`, etc.) so every consumer can ask `kind.Retryable()` instead of duplicating switches.

---

### Q12. How do you preserve a chain across goroutine boundaries?
Use `errgroup` for fan-out work, or send errors through a channel and collect with `errors.Join`:

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

Never use `go func() { _ = doWork() }()` — that leaks errors silently.

---

### Q13. How do you migrate `pkg/errors.Wrap` code to standard library?
- `pkg/errors.Wrap(err, "ctx")` → `fmt.Errorf("ctx: %w", err)`
- `pkg/errors.Cause(err)` → walk `errors.Unwrap` or use `errors.As`
- `errors.Cause(err) == ErrFoo` → `errors.Is(err, ErrFoo)`

Linters like `errorlint` automate most of the migration.

---

### Q14. Why are exported sentinels public API?
Once `var ErrNotFound = errors.New("...")` is exported, callers will write `errors.Is(err, mypkg.ErrNotFound)`. Renaming, removing, or changing its identity breaks them. Treat sentinel additions and removals with the same care as adding/removing a public function.

---

### Q15. How do `errors.Is` and `errors.As` walk the chain?
Both walk `Unwrap()` recursively (and `Unwrap() []error` for multi-errors).
- `Is` checks `==` and `Is(target)` method at each step.
- `As` checks type-assignability and `As(target)` method at each step.

Both are O(depth) in the chain length. Custom `Is`/`As` methods on your error type let you control matching.

---

### Q16. How should errors compose into structured logs?
Carry structured fields (op, kind, path, request_id) in the error type. The boundary logs with structured fields:

```go
slog.Error("request failed", "op", e.Op, "kind", e.Kind, "request_id", reqID, "err", e.Error())
```

A flat `log.Printf("%v", err)` is unqueryable. Structured logs let you filter by kind across millions of records.

---

### Q17. Should error messages be localized?
**No.** Errors are English, for developers and operators. Localized text is generated at the boundary from a stable error code:

```json
{ "code": "user.not_found", "message": "User not found" }  // localized
```

Internal errors keep `not found`; the API gateway translates `code` → localized `message`.

---

## Senior

### Q18. How would you design an error vocabulary for a 30-service architecture?
- A shared `errs` package with kind enum, sentinels, and a structured `Error` type.
- Adapters at each external boundary (DB, queue, RPC) translate foreign errors into `errs.*`.
- Each protocol boundary (HTTP, gRPC) has a single translation table from `kind` to status.
- Error codes (`user.not_found`) are public API, versioned with the API.
- Telemetry consumes structured fields directly.

The investment pays off in onboarding time, debuggability, and consistency across teams.

---

### Q19. How should errors interact with retries?
The retry decision belongs to the *kind*, not duplicated at every retry call site:

```go
func Retryable(err error) bool {
    var e *errs.Error
    if !errors.As(err, &e) { return false }
    return e.Kind.Retryable()
}
```

A retry helper checks `Retryable(err)` and applies exponential backoff. Non-idempotent operations require an idempotency key in addition.

---

### Q20. How do you cross a process boundary safely with errors?
Send a code, a message, and optional structured details — *not* the Go error chain.

```go
// gRPC
return status.Error(codes.NotFound, "user not found")

// HTTP JSON
{ "code": "user.not_found", "message": "...", "request_id": "..." }
```

The receiver reconstructs an internal error from the code. Foreign errors never leak.

---

### Q21. Why is "stack on every error" usually wrong at scale?
- **CPU**: ~5-10 µs per `debug.Stack` plus allocations.
- **Volume**: stacks are kilobytes; high-rate errors blow up log infrastructure.
- **Redundancy**: 5 wraps = 5 stacks, mostly identical.
- **Operator fatigue**: stacks become noise; people stop reading them.

Capture stacks at the *origin* (or at the panic boundary). Wraps are cheap; stacks are not.

---

### Q22. What anti-patterns do you flag in code review for error design?
- Capitalized error strings, trailing punctuation.
- `error: %w` boilerplate wraps.
- Stringly-typed `strings.Contains(err.Error(), ...)` matching.
- Logging *and* returning the same error.
- Panicking for control flow.
- Public sentinels for every internal kind.
- `_ = f()` swallowing.
- `go func() { _ = work() }()` losing errors.

Each one is a small fix; together they define the codebase's error culture.

---

### Q23. How should context.Canceled be treated in observability?
**Not as an error.** It usually means the caller asked us to stop — normal flow. Do not log it as error, do not page on it, do not count it in your error budget. Translate it at the boundary (HTTP 499 or no response at all). A separate counter for "cancelled by client" is sometimes useful for understanding traffic patterns.

---

### Q24. How do you evolve error contracts without breaking callers?
- **Additive changes** (new kind, new field) are safe in minor versions.
- **Removals** require deprecation, a release window, and a major version.
- **Message changes** are technically safe but break tests using string match — fix the tests instead of avoiding the wording change.
- **Documentation** in the function comment is the contract; CI tools enforce it.

Treat sentinels like any other public symbol: deprecate, alias, then remove across two release cycles.

---

### Q25. What does "errors are part of the domain" mean?
Errors describe failure modes that are part of your business: "cart is empty", "user is banned", "quota exceeded". They are not just plumbing. Designing them well means modeling the domain — the same as any other type. Ben Johnson's article *Failure is your domain* makes this case with concrete patterns.

---

## Professional

### Q26. What is the cost model of `fmt.Errorf` with `%w`?
~150 ns and 2-3 allocations: the `wrapError` struct, the formatted message string, possibly an `[]any` for varargs (often elided by escape analysis). Acceptable per request; expensive in a hot loop. For very high-throughput error paths, use pre-allocated sentinels and skip the wrap.

---

### Q27. How does `errors.Is` interact with custom `Is` methods?
At each step of the chain walk:
1. Check `err == target`.
2. If err implements `Is(target) bool`, call it; if true, match succeeds.
3. Otherwise, unwrap and continue.

This is how families work: a typed error implements `Is` to match the family sentinel without exposing its concrete type.

---

### Q28. What happens when `%w` is used with multiple errors in Go 1.20+?
`fmt.Errorf("%w, %w", a, b)` returns an error implementing `Unwrap() []error`. `errors.Is` walks both branches; `errors.As` finds the first matching branch. Pre-1.20 this was a runtime error; post-1.20 it is the multi-error idiom.

---

### Q29. Why are typed errors with pointer receivers not value-equal across construction sites?
```go
type MyErr struct{ code int }
func (e *MyErr) Error() string { ... }

a := &MyErr{code: 1}
b := &MyErr{code: 1}
a == b  // false (different pointers)
```

Pointer equality, not field equality. To make them match, implement `Is`:

```go
func (e *MyErr) Is(t error) bool {
    o, ok := t.(*MyErr)
    return ok && e.code == o.code
}
```

Or use a value-receiver type, which compares by field equality.

---

### Q30. What is the right way to design a public error code (cross-process)?
- Stable string identifier: `user.not_found`, `payment.declined`.
- Documented in API spec; versioned with the API.
- One-to-one mapping with internal `Kind` enum.
- Independent of internal Go types — internal evolution does not affect external contract.
- Localized at the edge from the code, not at the source of the error.

---

### Q31. When should you NOT use `errors.Join`?
- In a hot path where the slice allocation matters.
- When errors are unordered/streaming (use a channel + collector instead).
- When callers want each error individually (return `[]error` directly).
- When you only have one error (just return it; `Join(nil, err)` returns `err`).

---

### Q32. Walk through how you would design errors for a payment service.
1. **Kinds:** `KindNotFound`, `KindInvalid`, `KindDeclined`, `KindFraudCheck`, `KindUpstreamUnavailable`, `KindIdempotencyConflict`.
2. **Public codes:** `payment.not_found`, `payment.declined`, etc.
3. **Retry policy:** transient kinds (`KindUpstreamUnavailable`) retry with backoff; declined and invalid do not.
4. **Idempotency:** every write requires a key; retries reference the same key.
5. **Logging:** structured at the boundary, with `kind`, `op`, `request_id`, `idempotency_key`.
6. **Metrics:** counter labeled by `kind` (low cardinality), latency histogram by `op`.
7. **Tracing:** error recorded on the failed span; trace ID echoed to client.
8. **External errors:** translated at the gateway adapter; PSP-specific errors never leak.

---

### Q33. How do you decide between letting a panic propagate and converting it to an error?
- **Let it propagate** when the panic indicates a programming bug. Crashing is correct; the runtime prints a trace, the orchestrator restarts.
- **Convert to error** at HTTP/RPC entry points so a single panic does not take down the whole service. The conversion is a `recover` middleware that logs the stack and returns 500.
- **Never recover-and-continue** in business logic. If you recovered something, log it and exit; otherwise you mask bugs.

---

## Behavioral / Code Review

### Q34. A junior asks: "Why can't I just put the error message in any case I want?"
The lowercase / no-trailing-punctuation rule is about *composition*. Errors are wrapped many times; the resulting message is one sentence. `Could not connect.` becomes `process item: handle item: do step: Could not connect.: in /etc/x.conf` — readable nowhere. The convention exists so wrapped errors compose into something a human can scan.

---

### Q35. A teammate writes `if strings.Contains(err.Error(), "timeout") { retry() }`. What do you suggest?
The behavior depends on a string. The next time someone improves the message, retries silently break. Suggest:
1. Define a sentinel: `var ErrTimeout = errors.New("timeout")`.
2. Adapter wraps the upstream timeout: `return fmt.Errorf("upstream: %w", ErrTimeout)`.
3. Retry helper uses `errors.Is(err, ErrTimeout)`.

Now retries are explicit, tested, and immune to message wording.

---

### Q36. You are reviewing a PR that adds 14 new exported sentinels. How do you respond?
Ask why each one needs to be exported. Most internal kinds do not — callers never branch on them. Common outcomes:
- 8 of them become unexported.
- 2 of them merge into one (same kind, different wraps).
- 4 of them are genuine new public errors and stay.

Each export is a public API commitment. Fewer is almost always better.

---

### Q37. Your team has a 6-layer call chain that wraps with `fmt.Errorf` at every layer. The error message is unreadable. What do you recommend?
- Layers without unique information: drop the wrap, return the error as-is.
- Layers with information: keep the wrap but ensure the wording is `verb noun` and concise.
- Consider a structured error type with `Op` field instead of textual wraps; the boundary logs `op` separately.
- For deeply layered code, consider whether the depth itself is a smell.

Aim for 1-3 layers of wrap before the boundary, not 6.

---

### Q38. The team is debating whether to use `cockroachdb/errors` everywhere. What is your stance?
Trade-offs:
- **Pro**: stack traces, telemetry helpers, cross-package conventions, sophisticated wire encoding.
- **Con**: dependency, more allocations than stdlib, learning curve for the team.

For most services, stdlib + a small `errs` package is enough. Adopt `cockroachdb/errors` when:
- You have many services and the cross-process error contract is complex.
- Stack-attached errors are a real win (debugging non-reproducible bugs).
- The team is large enough to invest in mastering the library.

For a single service of moderate size: stdlib.

---

### Q39. You ship a library used by external teams. They ask for stable error codes. How do you respond?
- Define a small set of exported sentinels and document each one.
- Use them consistently in your public functions.
- Implement `Is` on internal typed errors so they match the family sentinel.
- Never break the identity in patch or minor releases.
- Provide a CHANGELOG entry for any error-related change.

Versioning errors is part of versioning the library. Treat them as you treat function signatures.

---

### Q40. An on-call engineer says "every alert is the same `internal error` with no context." What do you do?
The boundary is logging `internal error` without the chain. Audit:
1. Confirm the boundary log includes the full `err.Error()` (not just a sanitized message).
2. Confirm structured fields (`op`, `kind`, `request_id`) are attached.
3. Confirm the alert links to the trace ID for click-through.
4. Confirm the wraps along the chain include enough information (not just `error: %w`).

Within an hour, the on-call engineer should be able to go from alert to log line to trace to source. If they cannot, the error design is incomplete.
