# fmt.Errorf — Find the Bug

> Each snippet contains a real-world bug related to `fmt.Errorf`. Find it, explain it, fix it.

---

## Bug 1 — `%v` instead of `%w`

```go
var ErrNotFound = errors.New("not found")

func get(id int) error {
    return fmt.Errorf("get %d: %v", id, ErrNotFound)
}

if errors.Is(get(7), ErrNotFound) {
    // BUG: never fires
}
```

**Bug:** `%v` only inserts the formatted text. It does not wrap; the resulting error has no `Unwrap` method, so `errors.Is` cannot find `ErrNotFound`.

**Fix:**
```go
return fmt.Errorf("get %d: %w", id, ErrNotFound)
```

The output text is identical; the identity is preserved.

---

## Bug 2 — Wrapping `nil`

```go
func step(x int) error {
    err := compute(x)
    return fmt.Errorf("step: %w", err)
}
```

**Bug:** When `compute` returns `nil`, `fmt.Errorf` is still called. The result is a non-nil error whose text is `"step: %!w(<nil>)"`. The caller's `if err != nil` branch fires and the program treats success as failure.

**Fix:**
```go
func step(x int) error {
    if err := compute(x); err != nil {
        return fmt.Errorf("step: %w", err)
    }
    return nil
}
```

Always check `if err != nil` *before* wrapping.

---

## Bug 3 — `%w` outside `fmt.Errorf`

```go
func log(err error) {
    msg := fmt.Sprintf("got error: %w", err)
    fmt.Println(msg)
}
```

**Bug:** `%w` is only valid in `fmt.Errorf`. In `Sprintf` it produces `"got error: %!w(error=...)"` — no wrap, ugly text.

**Fix:** in `Sprintf`, use `%v`:
```go
msg := fmt.Sprintf("got error: %v", err)
```

If you actually want to wrap, use `fmt.Errorf` and chain to whoever logs.

---

## Bug 4 — `%w` with a non-error argument

```go
func fail(reason string) error {
    return fmt.Errorf("operation failed: %w", reason)
}
```

**Bug:** `reason` is a `string`, not an `error`. The output contains `"%!w(string=...)"` and no wrapping happens.

**Fix:** if there is no underlying error, use `%s` (or `%q`):
```go
return fmt.Errorf("operation failed: %s", reason)
```

If you want to wrap, you need an actual error to wrap:
```go
return fmt.Errorf("operation failed (%s): %w", reason, ErrSomething)
```

---

## Bug 5 — Two `%w` before Go 1.20

```go
// targeted at Go 1.18
return fmt.Errorf("a: %w; b: %w", errA, errB)
```

**Bug:** Pre-Go 1.20, only the first `%w` wraps. The second renders as `%!w(...)` and is *not* found by `errors.Is`. The bug is silent: no panic, just a partially-functioning chain.

**Fix:** wrap one and embed the other, *or* upgrade to Go 1.20+:
```go
// pre-1.20
return fmt.Errorf("a: %w; b: %v", errA, errB)
// 1.20+
return fmt.Errorf("a: %w; b: %w", errA, errB)
```

---

## Bug 6 — Mixing `%w` and `Error()`

```go
return fmt.Errorf("step: %s: %w", err.Error(), err)
```

**Bug:** The same error is rendered twice — once flat as text, once wrapped. The output reads "step: <err>: <err>" with the same content twice. Plus the cost is doubled.

**Fix:** wrap once:
```go
return fmt.Errorf("step: %w", err)
```

---

## Bug 7 — `fmt.Errorf` on a static message

```go
func validate() error {
    return fmt.Errorf("invalid input")
}
```

**Bug:** Not strictly broken, but wasteful: `fmt.Errorf` walks the format string, allocates twice, and is not inlined. For a static message, `errors.New` is faster.

**Fix:**
```go
func validate() error {
    return errors.New("invalid input")
}
```

Or, even better, define a sentinel at package scope:
```go
var ErrInvalid = errors.New("invalid input")
```

---

## Bug 8 — Wrapping in the success path

```go
err := compute()
err = fmt.Errorf("compute: %w", err)
if err != nil {
    return err
}
```

**Bug:** The wrap happens unconditionally. If `compute` returns `nil`, the wrap produces `"compute: %!w(<nil>)"`, the `if err != nil` then evaluates true, and the function returns a fake error. Same as Bug 2 in a different shape.

**Fix:**
```go
if err := compute(); err != nil {
    return fmt.Errorf("compute: %w", err)
}
return nil
```

Or with a deferred wrap:
```go
defer func() {
    if err != nil {
        err = fmt.Errorf("compute: %w", err)
    }
}()
```

---

## Bug 9 — Inlining a secret

```go
func auth(token string) error {
    if !valid(token) {
        return fmt.Errorf("auth failed for token %q: %w", token, ErrUnauth)
    }
    return nil
}
```

**Bug:** The token is interpolated into the error message. Once this error reaches a log file, the token is recorded in plaintext.

**Fix:** never include secrets in error messages. Use a hash, a prefix, or no info at all:
```go
return fmt.Errorf("auth failed: %w", ErrUnauth)
```

If you must identify the token for debugging, use a hash:
```go
return fmt.Errorf("auth failed for token sha256=%x: %w", sha256.Sum256([]byte(token))[:6], ErrUnauth)
```

---

## Bug 10 — Capitalized message with trailing period

```go
return fmt.Errorf("Failed to read config.")
```

**Bug:** Go convention is lowercase, no trailing punctuation, because errors compose:
```
load: Failed to read config.: parse: ...
```
The capital and period look out of place when wrapped.

**Fix:**
```go
return fmt.Errorf("failed to read config")
```

Even better, omit "failed to":
```go
return errors.New("read config")
```

---

## Bug 11 — Wrapping at every layer with no new info

```go
func a() error { return fmt.Errorf("a: %w", b()) }
func b() error { return fmt.Errorf("b: %w", c()) }
func c() error { return fmt.Errorf("c: %w", d()) }
func d() error { return errors.New("the actual error") }

// printout: a: b: c: the actual error
```

**Bug:** Each wrap adds only a function name. The chain reads like a stack trace, but with single letters. Hard to operationalize, hard to grep.

**Fix:** wrap with operation context, not function names:
```go
func loadOrders(userID int) error {
    if err := readDB(userID); err != nil {
        return fmt.Errorf("load orders for user %d: %w", userID, err)
    }
    return nil
}
```

---

## Bug 12 — Type assertion against the unexported wrap struct

```go
err := fmt.Errorf("op: %w", base)
if w, ok := err.(*fmt.wrapError); ok {  // BUG: cannot import unexported
    fmt.Println(w.err)
}
```

**Bug:** `fmt.wrapError` is unexported. The code does not even compile. Even if it did, relying on an internal type is fragile.

**Fix:** use `errors.Unwrap`:
```go
inner := errors.Unwrap(err)
fmt.Println(inner)
```

Or `errors.As` for typed extraction.

---

## Bug 13 — Comparing a wrapped error with `==`

```go
err := fmt.Errorf("ctx: %w", io.EOF)
if err == io.EOF {
    // BUG: never true
}
```

**Bug:** `err` is now a `*wrapError`, not `io.EOF` itself. `==` checks reference identity. Wrapping always changes identity.

**Fix:** use `errors.Is`:
```go
if errors.Is(err, io.EOF) {
    // ...
}
```

---

## Bug 14 — Wrapping a typed nil pointer

```go
type MyErr struct{ Msg string }
func (e *MyErr) Error() string { return e.Msg }

func validate(x int) error {
    var e *MyErr
    if x < 0 {
        e = &MyErr{"negative"}
    }
    return fmt.Errorf("validate: %w", e)
}
```

**Bug:** When `x >= 0`, `e` is a typed nil pointer. `fmt.Errorf("validate: %w", e)` wraps a non-nil interface (because the type word is non-nil) holding a nil pointer. The resulting error is non-nil, prints "validate: <nil>", and looks like a failure.

**Fix:** check before wrapping; return explicit nil:
```go
func validate(x int) error {
    if x < 0 {
        return fmt.Errorf("validate: %w", &MyErr{"negative"})
    }
    return nil
}
```

---

## Bug 15 — `%w` in a logging call

```go
log.Printf("got: %w", err)
```

**Bug:** `log.Printf` wraps `fmt.Sprintf`, which does not understand `%w`. The output contains `%!w(error=...)` and is ugly. No wrap happens; logs become useless.

**Fix:** in logs, use `%v`:
```go
log.Printf("got: %v", err)
```

Or, with a structured logger:
```go
slog.Error("operation failed", "err", err)
```

---

## Bug 16 — Re-wrapping the same error twice

```go
if err != nil {
    return fmt.Errorf("inner: %w", fmt.Errorf("outer: %w", err))
}
```

**Bug:** Builds a chain of two `*wrapError` layers in one statement, with the same underlying `err`. The chain works (two unwraps reach `err`) but the cost is double and the message reads "inner: outer: ...". Usually unintentional.

**Fix:** wrap once with both contexts:
```go
return fmt.Errorf("inner outer: %w", err)
```

Or pick one:
```go
return fmt.Errorf("inner: %w", err)
```

---

## Bug 17 — Operation name as a runtime variable, missing format

```go
return fmt.Errorf(op + ": %w", err)
```

**Bug:** Concatenating `op` into the format string is dangerous. If `op` contains `%` characters (e.g., a URL with `%20`), `fmt.Errorf` interprets them as format verbs and produces garbage.

**Fix:**
```go
return fmt.Errorf("%s: %w", op, err)
```

Always pass dynamic strings as arguments, never concatenate them into the format.

---

## Bug 18 — Ignoring the error from `fmt.Errorf` chain in tests

```go
func TestWrap(t *testing.T) {
    err := wrap()
    if err.Error() != "expected: text" {
        t.Fatal("mismatch")
    }
}
```

**Bug:** Comparing by `.Error()` is brittle. If the wrapped error's text changes (different Go version, different OS path format), the test breaks unrelated to the function under test.

**Fix:** compare identity:
```go
if !errors.Is(err, ExpectedSentinel) {
    t.Fatalf("got %v, want wrap of ExpectedSentinel", err)
}
```

Reserve `.Error()` comparisons for tests that genuinely depend on the user-facing string.

---

## Bug 19 — Multi-`%w` with a duplicated argument

```go
err := fmt.Errorf("%w and %w", a, a)
```

**Bug:** Not a crash, but wasteful. Internally `wrappedErrs` deduplicates by argument index, so `Unwrap()` returns `[a]` (one element), but the message text says "a and a." Probably not what you intended.

**Fix:** if you have one error, wrap it once:
```go
err := fmt.Errorf("%w", a)
```

If you genuinely have two distinct errors that happen to be equal, the test should use distinct values.

---

## Bug 20 — Wrapping an error and then logging it; the inner error is logged separately

```go
func step() error {
    if err := inner(); err != nil {
        log.Printf("inner failed: %v", err)
        return fmt.Errorf("step: %w", err)
    }
    return nil
}

// caller
if err := step(); err != nil {
    log.Printf("step failed: %v", err)
}
```

**Bug:** The inner error is logged twice — once inside `step` and once outside. Multiplied across a real call stack, you get the same error in 5+ log lines.

**Fix:** log once at the boundary:
```go
func step() error {
    if err := inner(); err != nil {
        return fmt.Errorf("step: %w", err)
    }
    return nil
}

// caller (top-level)
if err := step(); err != nil {
    log.Printf("step: %v", err)
}
```

The inner function wraps; the top-level logs.

---

## Bug 21 — `fmt.Errorf` inside a tight loop, building the same context

```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("loop iter %d: %w", time.Now().Unix(), err) // BUG
    }
}
```

**Bug:** The loop iteration index is *not* what `time.Now().Unix()` returns — that is the timestamp. Logically wrong; readers will be confused.

**Fix:**
```go
for i, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("loop iter %d: %w", i, err)
    }
}
```

---

## Bug 22 — Ignoring the wrap because of a typed-error assertion

```go
err := fmt.Errorf("ctx: %w", &MyErr{"oops"})
if me, ok := err.(*MyErr); ok {
    fmt.Println(me.Msg)
}
```

**Bug:** The type assertion fails because `err` is a `*wrapError`, not a `*MyErr`. Even though `*MyErr` is wrapped *inside*, the outer type does not match.

**Fix:** use `errors.As`:
```go
var me *MyErr
if errors.As(err, &me) {
    fmt.Println(me.Msg)
}
```

`errors.As` walks the chain; type assertion does not.
