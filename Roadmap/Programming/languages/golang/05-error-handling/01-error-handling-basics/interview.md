# Error Handling Basics — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What is an error in Go?
**Short answer:** An error is any value implementing the built-in `error` interface, which has one method: `Error() string`.

**Stronger answer:** It is a *value*, not an exception. Go has no try/catch; functions that can fail return an `error` as their last return value. The caller checks `if err != nil`.

---

### Q2. How do you return an error from a function?
```go
func f() (int, error) {
    if bad {
        return 0, errors.New("something failed")
    }
    return 42, nil
}
```

The convention is `(value, error)` with `error` last. On failure, return zero or a sensible default for the value and a non-nil error. On success, return the value and `nil`.

---

### Q3. What does `if err != nil` do?
It checks whether the function call returned an error. If so, you handle it (return, log, retry, etc.). If `err` is `nil`, the call succeeded and the other return values are valid.

---

### Q4. Can you ignore an error?
Yes — `_, _ = f()` — but you almost never should. The compiler does not warn for unchecked errors; only the linter (`errcheck`) does.

---

### Q5. What is the zero value of an error?
`nil`.

---

### Q6. How do you create an error with a custom message?
- `errors.New("message")` — simple.
- `fmt.Errorf("user %d: %v", id, cause)` — formatted.

---

### Q7. Why does Go not have exceptions?
Design choice: the authors believe exceptions create hidden control flow and encourage sloppy handling. Errors as values force explicit thinking at each call.

---

## Middle

### Q8. What is the difference between `error` and `panic`?
- **error**: a value returned for *expected* failures (file not found, parse error). The caller decides what to do.
- **panic**: a runtime mechanism for *unrecoverable* situations (nil dereference, index out of range, "this should never happen" bugs). Stack unwinds; can be intercepted with `recover` (rare, for top-level safety nets).

---

### Q9. What is error wrapping and why use it?
Wrapping attaches context to an existing error while preserving the original:
```go
return fmt.Errorf("loading config: %w", err)
```
The `%w` verb (Go 1.13+) lets `errors.Is` and `errors.As` see *through* the wrapper to find the original error or a typed cause. Use it to add a breadcrumb trail without losing identity.

---

### Q10. What is the difference between `%w` and `%v` in `fmt.Errorf`?
- `%v` formats the error as a string and *embeds the text*. The original error is no longer recoverable.
- `%w` *wraps* — the resulting error has an `Unwrap() error` method returning the original. `errors.Is` and `errors.As` can find it.

Use `%w` when you might want to inspect the cause; `%v` when you only need the printout.

---

### Q11. How do `errors.Is` and `errors.As` differ?
- **`errors.Is(err, target)`** — checks identity: "is `err` (or anything it wraps) equal to `target`?". Used for sentinels like `io.EOF`.
- **`errors.As(err, &target)`** — checks type: "is `err` (or anything it wraps) of the same dynamic type as `*target`?". Used for typed errors where you need to extract fields.

```go
if errors.Is(err, io.EOF) { /* end of stream */ }

var perr *os.PathError
if errors.As(err, &perr) { /* now perr.Path is accessible */ }
```

---

### Q12. What is a sentinel error?
A package-level error variable used as a known marker, e.g. `io.EOF`, `sql.ErrNoRows`. Callers compare with `errors.Is` to detect that specific condition. Sentinels are part of the package's public API.

---

### Q13. What is the typed-nil interface gotcha?
```go
type MyErr struct{}
func (*MyErr) Error() string { return "x" }

func f() error {
    var p *MyErr = nil
    return p  // returns NON-nil interface
}

err := f()
fmt.Println(err == nil) // false!
```
The interface header has a non-nil type word (`*MyErr`) and a nil data word. `err == nil` requires both to be nil, so the comparison is false.

**Fix:** return an explicit `nil` from the function when there is no error.

---

### Q14. When would you use `errors.Join`?
When you want to report *multiple* failures, not just the first:
```go
var errs []error
for _, x := range items {
    if err := process(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```
Available since Go 1.20.

---

### Q15. Why is `defer f.Close()` sometimes wrong?
Because it discards `Close`'s error. If `Close` flushes a buffer (e.g., a network connection or a buffered writer), an error there is real and might mean data was lost. Capture it:
```go
defer func() {
    if cerr := f.Close(); cerr != nil && err == nil {
        err = cerr
    }
}()
```

---

## Senior

### Q16. How do you design an error API for a library?
Three options:
- **Sentinels** (`var ErrNotFound = errors.New("...")`) for binary "is it this kind?" questions.
- **Typed errors** (`type ValidationError struct { Field string }`) for structured info.
- **Error kinds** (an enum field on a single struct) for many related conditions.

Pick one model per package and stick with it. Errors become public API; renames are breaking changes.

---

### Q17. How do you handle errors across goroutines?
- **`errgroup`** for fan-out where the first error cancels the rest.
- **Channel of errors** for fine-grained collection.
- **`errors.Join`** for "tell me everything that failed."

Crucial: a goroutine without an error return has nowhere to put its error. Use one of the patterns above.

---

### Q18. What is error translation, and why does it matter?
Each architectural layer should expose errors in *its* vocabulary. The DB layer translates `pq` errors into domain errors (`ErrConflict`); the HTTP layer translates domain errors into HTTP statuses. This decouples layers and lets you swap implementations.

Without translation, your HTTP handler does `strings.Contains(err.Error(), "duplicate key")` — fragile and tied to PostgreSQL.

---

### Q19. How do you avoid leaking sensitive information through errors?
- Log full detail internally; return bland messages externally.
- Wrap with safe message + original cause; expose only the safe message.
- Never include secrets, tokens, or PII in error strings.
- Be wary of error messages in 4xx responses — they often go straight to a UI.

---

### Q20. What is a circuit breaker and how does it relate to errors?
A circuit breaker watches the error rate of a downstream call. After enough failures, it "trips" and short-circuits subsequent calls (returning an error immediately) instead of waiting for them to fail. After a cool-down, it tests with a probe call. This prevents retry storms from worsening an outage.

Error handling without a breaker is a recipe for cascading failure under load.

---

### Q21. How do `context.Canceled` and `context.DeadlineExceeded` change error handling?
They are *expected* outcomes when a context is cancelled or times out. They should usually:
- Not page on-call (not a real failure).
- Not be retried at the same level (the timeout already accounts for that).
- Be propagated up so the caller can return promptly.

Many handlers explicitly downgrade them in metrics:
```go
if errors.Is(err, context.Canceled) {
    // do not count as error
}
```

---

## Professional

### Q22. What is the memory representation of an `error`?
Two machine words (16 B on amd64): `*itab` (type info + method table) and `unsafe.Pointer` (data). A nil error is a zeroed pair.

---

### Q23. What does `errors.New("x")` allocate?
On first observation by the compiler, an `*errorString` (16 B) and a string descriptor pointing into read-only memory. If used at package scope (`var ErrFoo = errors.New("foo")`), this happens once at init. Inside a function, it allocates per call (and escapes to the heap because it returns).

---

### Q24. Is `if err != nil` slow?
No. It is two-word comparison against zero, often optimized to a single instruction. Branch prediction handles the "no error" case at near-zero cost. The expense lies in *constructing* errors, not in checking them.

---

### Q25. How does `errors.Is` work internally?
It loops, calling `Unwrap()` on each wrapped error, comparing each layer with `==` (or, if the layer has its own `Is(target) bool` method, calling that). Stops when it finds a match or runs out of unwrapping. O(depth of chain).

---

### Q26. How does `errors.As` work?
Similar loop, but instead of equality it uses `reflect.TypeOf(target).Elem()` to check whether each wrapped error is assignable to the target type. If yes, it does the assignment and returns true. If a layer has its own `As(target any) bool` method, it can override.

---

### Q27. What happens if you call `Unwrap()` on a non-wrapping error?
It returns nil. By convention, errors not built via `%w` (or without an explicit `Unwrap` method) are leaves of the chain.

---

### Q28. How does Go's runtime distinguish `error` from `panic`?
They are separate mechanisms. `error` is a return value — no runtime involvement. `panic` triggers stack unwinding via the runtime's defer machinery; `recover` intercepts during a deferred call. The two systems are decoupled — a panicking goroutine can return an `error` from a deferred recovery, but the runtime does not implicitly translate one to the other.

---

### Q29. What are the trade-offs of stack traces in Go errors?
Pros: debugging is faster — you see *where* it happened. Cons: capture cost (~µs per call), memory cost (one stack snapshot per error), and discipline (must capture at the original point of failure). Standard library does not capture stack traces by default; `runtime/debug.Stack()` is opt-in. Third-party packages like `github.com/cockroachdb/errors` provide them.

---

### Q30. How would you build a structured error type with full diagnostic info?
```go
type Error struct {
    Op      string  // operation, e.g. "user.Save"
    Kind    Kind    // domain kind enum
    Cause   error   // wrapped error
    Stack   []uintptr  // captured at construction
}

func (e *Error) Error() string { /* compose message */ }
func (e *Error) Unwrap() error { return e.Cause }
func (e *Error) Is(t error) bool { /* compare Kind */ }
```

Wrap creation in a helper `errors.E(...)` with smart argument detection (similar to Upspin's design).

---

## Behavioral / Code Review

### Q31. Walk me through how you would code-review error handling.
- Is every `if err != nil` doing something useful, or is it pure pass-through that loses context?
- Are wrapped errors using `%w`, not `%v`?
- Are sentinels compared with `errors.Is`, not `==`?
- Are typed errors extracted with `errors.As`?
- Is the error logged once, at a clear boundary?
- Are user-facing messages safe (no leaks)?
- Are retries bounded? Are they only for transient failures?
- Is `panic` used only for impossible states?
- Are tests covering both happy and failure paths?
- Is `context.Canceled` handled distinctly from real errors?

---

### Q32. You are reviewing a PR that wraps `sql.ErrNoRows` as a domain `ErrNotFound`. Good or bad?
**Good** — at the storage/persistence layer, translating driver errors into domain errors is exactly right. The domain layer should not know about SQL-driver internals.

The PR is *bad* if the translation happens far from the storage layer, leaks the original message, or fails to use `errors.Is` for the source check.

---

### Q33. You see five layers each wrap with `%w`. Worth it?
Maybe. Each layer should add *useful context*: an operation name, a key, a path. Five layers of `op: %w` may be useful or noisy depending on whether each adds new information. Avoid wrapping just for the sake of it.

---

### Q34. A junior asks: "Why not use `panic` everywhere?"
- Panic does not appear in the function signature; callers cannot anticipate it.
- Panic unwinds the stack — costly compared to a return.
- Panic skips intermediate cleanup unless `defer` is used carefully.
- Panic implies "the program is broken." Most failures are not bugs in the program — they are realities of the world.
- Panic crosses goroutine boundaries weirdly: a panic in a goroutine without `recover` crashes the entire process.
- Panic / recover is hard to test exhaustively.

Use `error` for failures, `panic` for impossible states.
