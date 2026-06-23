# Error Design — Best Practices — Find the Bug

> Each snippet contains a real-world bug related to error design. Find it, explain it, fix it.

---

## Bug 1 — Capitalized message that breaks composition

```go
return errors.New("Failed to open config file.")
```

**Bug:** Capitalized first letter and trailing period. When wrapped, the result is `load /etc/x.conf: Failed to open config file.: open /etc/x.conf: no such file or directory` — three sentences pretending to be one.

**Fix:**
```go
return errors.New("open config file")
```

Or, if you have the path and the cause:
```go
return fmt.Errorf("open %s: %w", path, err)
```

---

## Bug 2 — `%v` instead of `%w`

```go
if err := db.Query(...); err != nil {
    return fmt.Errorf("query users: %v", err)
}

// elsewhere:
if errors.Is(err, sql.ErrNoRows) { ... }  // never matches
```

**Bug:** `%v` interpolates the message but does not wrap. The chain is broken; `errors.Is` cannot see through the layer.

**Fix:**
```go
return fmt.Errorf("query users: %w", err)
```

---

## Bug 3 — Stringly-typed error matching

```go
if strings.Contains(err.Error(), "not found") {
    return defaultUser, nil
}
```

**Bug:** Brittle. The next message rewording (`"missing"`, `"absent"`, `"could not locate"`) silently breaks this branch.

**Fix:**
```go
if errors.Is(err, ErrNotFound) {
    return defaultUser, nil
}
```

---

## Bug 4 — Logging *and* returning

```go
func step() error {
    if err := work(); err != nil {
        log.Printf("step failed: %v", err)
        return err
    }
    return nil
}
```

**Bug:** Lower layers should not log. The caller almost certainly logs as well, producing duplicate lines for the same failure.

**Fix:** wrap and return; let the boundary log.
```go
if err := work(); err != nil {
    return fmt.Errorf("step: %w", err)
}
```

---

## Bug 5 — Typed nil returned as `error`

```go
type MyErr struct{ Field string }

func (e *MyErr) Error() string { return e.Field + ": bad" }

func validate(s string) error {
    var e *MyErr
    if s == "" {
        e = &MyErr{Field: "name"}
    }
    return e  // returns non-nil interface even when e is nil pointer
}

err := validate("ok")
if err != nil {
    fmt.Println("bug:", err)  // prints "bug: <nil>: bad" or panics
}
```

**Bug:** An interface holding a nil concrete pointer is *not* nil. The error check accidentally fires on success.

**Fix:** return literal `nil`:
```go
func validate(s string) error {
    if s == "" {
        return &MyErr{Field: "name"}
    }
    return nil
}
```

---

## Bug 6 — Sentinel changes per init

```go
var ErrCannotConnect = fmt.Errorf("cannot connect to %s", host)  // host changes
```

**Bug:** A sentinel must be a constant of identity. Recomputing it produces a different value on each binary build (and breaks across processes that compare by identity, though Go does not do that for values).

**Fix:** the sentinel carries kind, the wrap carries data:
```go
var ErrCannotConnect = errors.New("cannot connect")

return fmt.Errorf("connect %s: %w", host, ErrCannotConnect)
```

---

## Bug 7 — Panic for control flow

```go
func parse(b []byte) (Token, error) {
    defer func() {
        if r := recover(); r != nil {
            // ... convert to error
        }
    }()
    if len(b) == 0 {
        panic("empty input")
    }
    // ...
}
```

**Bug:** Panic-and-recover used as a control flow shortcut. This is what `return err` is for. Worse: hidden panic paths are extremely hard to debug.

**Fix:**
```go
func parse(b []byte) (Token, error) {
    if len(b) == 0 {
        return Token{}, errors.New("empty input")
    }
    // ...
}
```

Reserve panic for *programmer errors* (broken invariants), not *operational errors* (bad input).

---

## Bug 8 — Public sentinel renamed without deprecation

```go
// v1.0
var ErrNotFound = errors.New("not found")

// v1.1
var ErrMissing = errors.New("not found")  // renamed without alias
```

**Bug:** Every caller of `errors.Is(err, ErrNotFound)` now fails to compile. This is a major-version change being shipped as a minor.

**Fix:** keep both, mark old as deprecated:
```go
var ErrMissing = errors.New("not found")

// Deprecated: use ErrMissing instead.
var ErrNotFound = ErrMissing
```

Remove `ErrNotFound` only in the next major version.

---

## Bug 9 — Goroutine that swallows its error

```go
func startWorker() {
    go func() {
        if err := workForever(); err != nil {
            // no return path; nobody sees this
        }
    }()
}
```

**Bug:** The goroutine ignores its error. The launching function gets no signal of the failure.

**Fix:** route the error somewhere:
```go
func startWorker() <-chan error {
    out := make(chan error, 1)
    go func() {
        out <- workForever()
    }()
    return out
}
```

Or use `errgroup`. Or panic-and-recover-and-log if you cannot route. Anything but silent loss.

---

## Bug 10 — Embedded sentinel loses identity through `%v`

```go
err := fmt.Errorf("ctx: %v", io.EOF)  // %v not %w!
errors.Is(err, io.EOF)  // false
```

**Bug:** `%v` interpolates the message; the chain does not exist.

**Fix:** use `%w`.
```go
err := fmt.Errorf("ctx: %w", io.EOF)
errors.Is(err, io.EOF)  // true
```

---

## Bug 11 — `errors.As` on a non-pointer target

```go
var ve ValidationError
if errors.As(err, ve) {  // missing &
    // ...
}
```

**Bug:** `errors.As` panics at runtime with "errors: target must be a non-nil pointer".

**Fix:**
```go
var ve *ValidationError
if errors.As(err, &ve) {
    // ...
}
```

The target must be `*T` where `T` is your error type (or `**T` for pointer types).

---

## Bug 12 — Sentinel without `Unwrap` in custom type

```go
type MyErr struct {
    inner error
}

func (e *MyErr) Error() string { return "my: " + e.inner.Error() }
// no Unwrap!
```

**Bug:** `errors.Is(err, e.inner)` returns false because the chain is broken: `MyErr` is the outer error, but it does not expose the inner.

**Fix:** implement `Unwrap()`:
```go
func (e *MyErr) Unwrap() error { return e.inner }
```

Now the chain walk reaches the inner error.

---

## Bug 13 — Doubly wrapped boilerplate

```go
return fmt.Errorf("error: %w", fmt.Errorf("error: %w", err))
```

**Bug:** Two layers of `error:` boilerplate that add no information. The final message is `error: error: <inner>`.

**Fix:** keep one wrap with information, drop the noise:
```go
return fmt.Errorf("op: %w", err)
```

---

## Bug 14 — Sentinel for every internal kind

```go
package userstore

var (
    ErrConnectionLost     = errors.New("connection lost")
    ErrConnectionTimeout  = errors.New("connection timeout")
    ErrConnectionRefused  = errors.New("connection refused")
    ErrConnectionReset    = errors.New("connection reset")
    ErrConnectionAborted  = errors.New("connection aborted")
    ErrAuthFailed         = errors.New("auth failed")
    ErrAuthExpired        = errors.New("auth expired")
    ErrAuthRevoked        = errors.New("auth revoked")
    // 30 more...
)
```

**Bug:** Every export is a public API commitment. Most of these are internal kinds the caller will never branch on individually.

**Fix:** collapse into kinds, keep the structured field for detail:
```go
var (
    ErrTransient    = errors.New("transient")
    ErrAuth         = errors.New("auth")
    ErrInternal     = errors.New("internal")
)
```

Or use a single `Error` type with a `Kind` enum.

---

## Bug 15 — `panic(err)` to skip handling

```go
func mustOpen(path string) *os.File {
    f, err := os.Open(path)
    if err != nil {
        panic(err)  // I don't want to write `if err != nil`
    }
    return f
}

// caller
defer func() { recover() }()  // catches everywhere
mustOpen("/etc/x")
```

**Bug:** Panic used to dodge error handling. Recovery is global, masking many other bugs.

**Fix:** return the error and check it. Reserve `Must*` helpers for *startup-only* code where a failure means the program cannot run:
```go
func mustOpen(path string) *os.File {
    f, err := os.Open(path)
    if err != nil {
        log.Fatal(err)  // startup; cannot continue
    }
    return f
}
```

---

## Bug 16 — Logging the secret in error wrap

```go
return fmt.Errorf("login %s/%s: %w", user, password, err)
```

**Bug:** The wrap embeds the password. Now every log line containing this error contains a plaintext password.

**Fix:** never include secrets in error messages:
```go
return fmt.Errorf("login %s: %w", user, err)
```

---

## Bug 17 — `recover` and continue in business logic

```go
func process(items []Item) error {
    for _, it := range items {
        defer func() {
            if r := recover(); r != nil {
                log.Println("recovered:", r)
                // and silently continue
            }
        }()
        handle(it)
    }
    return nil
}
```

**Bug:** Two issues:
1. `defer` inside a for-loop accumulates one defer per iteration — they all run at function end, not per iteration.
2. Recovery without escalation hides real bugs.

**Fix:**
```go
func process(items []Item) error {
    for _, it := range items {
        if err := safeHandle(it); err != nil {
            return fmt.Errorf("item %v: %w", it.ID, err)
        }
    }
    return nil
}

func safeHandle(it Item) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    handle(it)
    return nil
}
```

`defer` is now scoped to one item; panic is converted to an error the caller sees.

---

## Bug 18 — `errors.Join` of one error

```go
return errors.Join(err)
```

**Bug:** Wraps a single error in a multi-error envelope for no benefit. `errors.Is`/`As` still works but the type is needlessly complex.

**Fix:**
```go
return err
```

`errors.Join` is for multiple errors; for one, return it directly.

---

## Bug 19 — Comparing wrapped errors with `==`

```go
err := fmt.Errorf("ctx: %w", io.EOF)
if err == io.EOF {  // false
    // ...
}
```

**Bug:** `==` compares the wrapping error's pointer, not the chain. Wrapping always changes identity.

**Fix:**
```go
if errors.Is(err, io.EOF) {
    // ...
}
```

`errors.Is` walks the chain. Always use it for sentinel matching.

---

## Bug 20 — Returning user-facing message instead of an error

```go
func parseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, errors.New("Please enter a valid age between 0 and 150!")
    }
    // ...
}
```

**Bug:** The error message is a user-facing string with capitalization, punctuation, and exclamation. It will be embedded in logs, then probably translated by a translation system — but it cannot be, because there is no stable code.

**Fix:** internal error in idiomatic style; user-facing message generated at the boundary:
```go
var ErrInvalidAge = errors.New("invalid age")

func parseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse age %q: %w", s, ErrInvalidAge)
    }
    // ...
}

// at the boundary
case errors.Is(err, ErrInvalidAge):
    writeJSON(w, 400, APIError{Code: "user.invalid_age", Message: t.Translate(ctx, "user.invalid_age")})
```

---

## Bug 21 — Mutable error type

```go
type MyErr struct {
    Field string
    Count int
}

func (e *MyErr) Error() string {
    e.Count++
    return fmt.Sprintf("%s (called %d times)", e.Field, e.Count)
}
```

**Bug:** `Error()` has side effects. Two consumers (a log line and an assertion) get different strings; structured loggers may call `Error()` multiple times.

**Fix:** `Error()` must be pure.
```go
func (e *MyErr) Error() string {
    return fmt.Sprintf("%s", e.Field)
}
```

If you need to count `Error()` calls, do it externally — but you almost certainly do not.

---

## Bug 22 — Using `errors.Is` to test identity-based equality of values

```go
type ValErr struct{ Code int }
func (e *ValErr) Error() string { return "val" }

a := &ValErr{Code: 1}
b := &ValErr{Code: 1}
errors.Is(a, b)  // false
```

**Bug:** `errors.Is` falls back to `==`, which compares pointers. Two `*ValErr` with the same fields are not pointer-equal.

**Fix:** implement `Is`:
```go
func (e *ValErr) Is(t error) bool {
    o, ok := t.(*ValErr)
    return ok && e.Code == o.Code
}
```

Or use a value-receiver type, where Go's `==` does field comparison.

---

## Bug 23 — `_ = f()` swallowing

```go
func main() {
    _ = json.Unmarshal(data, &v)
    use(v)
}
```

**Bug:** A failed unmarshal leaves `v` in a partial state; the program proceeds as if everything is fine. The `_ =` is a deliberate "I do not care" — but you should care.

**Fix:**
```go
if err := json.Unmarshal(data, &v); err != nil {
    log.Fatal(err)
}
use(v)
```

A `_ =` on an error return should be commented if it is intentional, otherwise replaced with proper handling.

---

## Bug 24 — Stack trace embedded in error string

```go
return fmt.Errorf("error: %w\nstack: %s", err, debug.Stack())
```

**Bug:** Error messages should not contain stack traces — they bloat logs, leak internals if the message is sent to a client, and are hard to parse out programmatically.

**Fix:** capture the stack as a *separate field* of the error type, or log it separately at the boundary:
```go
type withStack struct {
    err error
    pcs []uintptr
}
func (e *withStack) Error() string { return e.err.Error() }
func (e *withStack) Unwrap() error { return e.err }
```

The boundary logger then prints both: `slog.Error(..., "err", err.Error(), "stack", formatStack(e.pcs))`. Stack stays out of the error message.

---

## Bug 25 — Public typed error with mutable field

```go
type ValidationError struct {
    Field   string
    Reason  string
    Visited int  // public, mutable!
}
```

**Bug:** A public mutable field on an error type invites callers to mutate. The error becomes shared mutable state.

**Fix:** keep visible state immutable. If you need a counter, keep it private and provide methods:
```go
type ValidationError struct {
    Field  string
    Reason string
    visited atomic.Int32  // private
}

func (e *ValidationError) Visit() { e.visited.Add(1) }
func (e *ValidationError) Visits() int32 { return e.visited.Load() }
```

But really: do not put a counter on an error. Keep errors as inert values.
