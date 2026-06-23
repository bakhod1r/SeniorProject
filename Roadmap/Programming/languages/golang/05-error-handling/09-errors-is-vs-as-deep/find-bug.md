# errors.Is vs errors.As — Find the Bug

> Each snippet contains a real-world bug related to `errors.Is`, `errors.As`, or wrapping. Find it, explain it, fix it.

---

## Bug 1 — `%v` instead of `%w`

```go
func loadConfig(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("config %s: %v", path, err)
    }
    defer f.Close()
    // ...
    return nil
}

// caller
err := loadConfig("config.json")
if errors.Is(err, os.ErrNotExist) {
    // never true
}
```

**Bug:** `%v` flattens the error into a string and discards the chain. `errors.Is` cannot find the original `*os.PathError` underneath `os.ErrNotExist`.

**Fix:**
```go
return fmt.Errorf("config %s: %w", path, err)
```

Use `%w` to preserve the chain.

---

## Bug 2 — Comparing wrapped errors with `==`

```go
func read(r io.Reader) error {
    _, err := r.Read(make([]byte, 10))
    if err != nil {
        err = fmt.Errorf("read failed: %w", err)
    }
    return err
}

err := read(somefile)
if err == io.EOF {
    // never true
}
```

**Bug:** `err` is now a `*fmt.wrapError`, not `io.EOF`. Direct `==` does not see through the wrap.

**Fix:**
```go
if errors.Is(err, io.EOF) { ... }
```

---

## Bug 3 — Type assertion past a wrap

```go
err := fmt.Errorf("op: %w", &MyErr{Code: 7})
if pe, ok := err.(*MyErr); ok {
    fmt.Println(pe.Code)
}
// ok == false; the body never runs
```

**Bug:** `err` is `*fmt.wrapError`, not `*MyErr`. The assertion checks the outermost concrete type only.

**Fix:**
```go
var pe *MyErr
if errors.As(err, &pe) {
    fmt.Println(pe.Code)
}
```

---

## Bug 4 — `errors.As` with a non-pointer

```go
var pe os.PathError
if errors.As(err, &pe) { // panics
    fmt.Println(pe.Path)
}
```

**Bug:** `os.Open` returns `*os.PathError` (pointer). The target's element type must be `*os.PathError`, not `os.PathError`.

**Fix:**
```go
var pe *os.PathError
if errors.As(err, &pe) {
    fmt.Println(pe.Path)
}
```

---

## Bug 5 — `errors.Is` against a fresh `errors.New`

```go
if errors.Is(err, errors.New("not found")) {
    return ErrUserNotFound
}
```

**Bug:** `errors.New("not found")` creates a *new* pointer on every call. `errors.Is` compares by identity (`==` on the dynamic value); the new pointer never matches the wrapped one.

**Fix:** declare a package-level sentinel and compare against it:
```go
var ErrNotFound = errors.New("not found")

if errors.Is(err, ErrNotFound) { ... }
```

---

## Bug 6 — Custom `Is` returning true unconditionally

```go
type wrapErr struct{ inner error }

func (e *wrapErr) Error() string         { return e.inner.Error() }
func (e *wrapErr) Unwrap() error         { return e.inner }
func (e *wrapErr) Is(target error) bool  { return true }
```

**Bug:** `Is(target error) bool { return true }` matches *every* possible target. `errors.Is(myWrap, anything)` returns true. Callers think every kind of error is present.

**Fix:** delete the custom `Is` method; the default chain walk via `Unwrap` is correct.

```go
// remove Is method entirely; the default behavior is correct
```

If you needed the custom `Is`, only return true for kinds you genuinely want to claim:

```go
func (e *wrapErr) Is(target error) bool { return target == ErrFoo && e.kind == kindFoo }
```

---

## Bug 7 — Forgot `Unwrap` on a custom wrapper

```go
type opErr struct {
    op  string
    err error
}

func (e *opErr) Error() string { return e.op + ": " + e.err.Error() }
// no Unwrap method!

err := &opErr{op: "load", err: io.EOF}
if errors.Is(err, io.EOF) {
    // never true
}
```

**Bug:** `*opErr` does not implement `Unwrap`, so `errors.Is` cannot walk past it.

**Fix:**
```go
func (e *opErr) Unwrap() error { return e.err }
```

---

## Bug 8 — `As` with an interface variable held by value

```go
type Temporary interface{ Temporary() bool }

var t Temporary
errors.As(err, t) // panics: target must be a non-nil pointer
```

**Bug:** `t` is the interface value itself; `errors.As` needs `&t`.

**Fix:**
```go
var t Temporary
if errors.As(err, &t) && t.Temporary() {
    retry()
}
```

---

## Bug 9 — Lost `context.Canceled`

```go
func op(ctx context.Context) error {
    err := doWork(ctx)
    if err != nil {
        return errors.New("operation cancelled or failed")
    }
    return nil
}

// caller
if errors.Is(err, context.Canceled) {
    // never true
}
```

**Bug:** the function discards the original error and returns a fresh one. `context.Canceled` is no longer in the chain.

**Fix:**
```go
return fmt.Errorf("operation: %w", err)
```

Or, if you want to handle the cancel case specially:

```go
if errors.Is(err, context.Canceled) {
    return ctx.Err() // pass through
}
return fmt.Errorf("operation: %w", err)
```

---

## Bug 10 — Wrapping in a hot loop

```go
var err error
for _, item := range items {
    if e := process(item); e != nil {
        err = errors.Join(err, e)
    }
}
return err
```

**Bug:** Each iteration nests `errors.Join`. After N items, the chain is N deep. `errors.Is(err, target)` walks all N. Worse, the resulting error tree is unbalanced.

**Fix:** collect the errors, join once at the end.
```go
var errs []error
for _, item := range items {
    if e := process(item); e != nil {
        errs = append(errs, e)
    }
}
return errors.Join(errs...) // depth 1
```

---

## Bug 11 — `errors.Unwrap` on a multi-error

```go
joined := errors.Join(io.EOF, errFoo)
inner := errors.Unwrap(joined)
fmt.Println(inner) // <nil>
```

**Bug:** `errors.Unwrap` only handles `Unwrap() error`. The result of `errors.Join` implements `Unwrap() []error`, not the single-error variant.

**Fix:** type-assert the multi-error variant:
```go
m, ok := joined.(interface{ Unwrap() []error })
if ok {
    for _, e := range m.Unwrap() {
        fmt.Println(e)
    }
}
```

Or use `errors.Is`/`errors.As` which handle both.

---

## Bug 12 — Non-comparable sentinel

```go
type fields struct{ keys []string }
func (f fields) Error() string { return "fields error" }

var ErrFields = fields{keys: nil}

err := ErrFields
if errors.Is(err, ErrFields) {
    // false! silently — non-comparable type
}
```

**Bug:** `fields` has a slice field; the type is not comparable. `errors.Is` checks `Comparable()` first and skips the equality fallback. Without a custom `Is` method, the sentinel never matches itself.

**Fix:** use a comparable sentinel (e.g., `errors.New`) or use a pointer:
```go
var ErrFields = &fields{}
```

A `*fields` is comparable (pointers are always comparable).

---

## Bug 13 — Recursive `Unwrap`

```go
type cyclic struct{ note string }
func (c *cyclic) Error() string { return c.note }
func (c *cyclic) Unwrap() error { return c }

errors.Is(&cyclic{note: "x"}, io.EOF) // hangs forever
```

**Bug:** `Unwrap` returns the receiver. `errors.Is` walks indefinitely.

**Fix:** return the actual wrapped error or `nil`. Never return the receiver.

```go
func (c *cyclic) Unwrap() error { return nil }
```

---

## Bug 14 — Wrapping a typed-nil

```go
type myErr struct{}
func (e *myErr) Error() string { return "my" }

func op() error {
    var p *myErr
    return p // typed-nil interface; non-nil error!
}

func main() {
    err := op()
    if err != nil {
        err = fmt.Errorf("op: %w", err)
    }
    fmt.Println(errors.Is(err, nil)) // false
    fmt.Println(err)                  // "op: <nil>"-ish
}
```

**Bug:** the function returns a `*myErr` value that is nil but the interface is not. `err != nil` is true; the wrap proceeds; the chain now contains a typed-nil that is hard to reason about.

**Fix:** return `nil` explicitly when there is nothing to report:
```go
func op() error {
    var p *myErr // never assigned non-nil
    if p == nil {
        return nil
    }
    return p
}
```

Or use the named return convention with explicit nil:

```go
func op() (err error) { return nil }
```

---

## Bug 15 — Custom `As` writes to the wrong type

```go
type databaseErr struct{ code int }

func (e *databaseErr) Error() string { return "db error" }

func (e *databaseErr) As(target any) bool {
    *target.(*int) = e.code // panics if target is not *int
    return true
}
```

**Bug:** if `errors.As(err, &dbErr)` (target is `**databaseErr`), the type assertion panics.

**Fix:** check the type before writing:
```go
func (e *databaseErr) As(target any) bool {
    if t, ok := target.(*int); ok {
        *t = e.code
        return true
    }
    return false
}
```

---

## Bug 16 — `errors.As` on `error` interface variable

```go
var ie error
errors.As(err, &ie)
fmt.Println(ie)
```

**Bug:** technically not a bug, but a no-op. `errors.As` always succeeds when the target is `*error` because every error is assignable to `error`. You assigned the outer `err` to `ie` — no chain walk happened. Probably not what was intended.

**Fix:** declare the target as the actual concrete or interface type you want, e.g.:
```go
var pe *os.PathError
errors.As(err, &pe)
```

---

## Bug 17 — `errors.Join` empty result is treated as failure

```go
var errs []error
// ... loop that may add nothing ...
joined := errors.Join(errs...)
if joined == nil {
    // happy path? no — joined could be nil for empty errs
}
return joined
```

**Bug:** `errors.Join()` of all-nil (or empty) returns nil. The code might mean "no errors → return nil" (which is correct), but if the intent was "always return a non-nil aggregator", this fails.

**Fix:** if `nil` is the right "no errors" signal, this is fine. If not:
```go
if len(errs) == 0 {
    return ErrNothingDone
}
return errors.Join(errs...)
```

---

## Bug 18 — Two sentinels that should be the same

```go
var ErrNotFound = errors.New("not found")          // pkg A
var ErrNotFound = errors.New("not found")          // pkg B (different file)

err := pkgA.Get(...)
if errors.Is(err, pkgB.ErrNotFound) { ... } // false
```

**Bug:** two separate `errors.New` calls produce two different pointers. They share a message but not identity. `errors.Is` matches identity, not message.

**Fix:** export one sentinel from a shared package, or translate at the boundary.

---

## Bug 19 — Wrapped function variable

```go
errFn := func() error { return io.EOF }
wrapped := fmt.Errorf("op: %w", errFn) // panics: argument to %w is not error
```

**Bug:** `errFn` is a `func() error`, not an `error`. `%w` requires the argument to be an `error` value.

**Fix:** call the function:
```go
wrapped := fmt.Errorf("op: %w", errFn())
```

---

## Bug 20 — `errors.As` into the same variable across the loop

```go
var pe *os.PathError
for _, err := range errs {
    if errors.As(err, &pe) {
        log.Print(pe.Path) // may print stale data on misses
    }
}
```

**Bug:** if `errors.As` returns false on a later iteration, `pe` still holds the previous match. The next `log.Print` could print a stale path.

**Fix:** reset `pe` each iteration, or scope it inside the loop:
```go
for _, err := range errs {
    var pe *os.PathError
    if errors.As(err, &pe) {
        log.Print(pe.Path)
    }
}
```

---
