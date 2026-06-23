# Wrapping & Unwrapping Errors — Optimization

> Each entry shows wasteful or slow wrap/unwrap code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — Wrapping with no new context

```go
if err != nil {
    return fmt.Errorf("%w", err)
}
```

**Problem:** Adds an allocation (~150 ns, one `*wrapError`) for zero benefit. The chain gains a node with no context.

**Better:**
```go
if err != nil {
    return err
}
```

Only wrap when you have something to add (operation, input, resource).

---

## Optimization 2 — Wrapping inside a hot loop

```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("loop iter %d: %w", i, err)
    }
}
```

**Problem:** Fine if errors are rare. **Bad** if errors are common — e.g., a parser scanning a million tokens with 10% malformed. Each wrap costs an allocation.

**Better:** Wrap once at the boundary.
```go
result, err := parseAll(items)
if err != nil {
    return fmt.Errorf("parse run: %w", err)  // wrap once
}
```

If you genuinely need per-item context, accumulate into a slice and `errors.Join` once at the end:
```go
var errs []error
for _, item := range items {
    if err := process(item); err != nil {
        errs = append(errs, fmt.Errorf("item %v: %w", item, err))
    }
}
return errors.Join(errs...)
```

The `errors.Join` is one allocation regardless of how many errors.

---

## Optimization 3 — `errors.Is` against many sentinels

```go
if errors.Is(err, ErrA) || errors.Is(err, ErrB) || errors.Is(err, ErrC) {
    // ...
}
```

**Problem:** Each call walks the chain independently. For a chain of depth 5 and 3 sentinels, that's 15 method dispatches. For high-rate paths, measurable.

**Better:** walk once and switch.
```go
for e := err; e != nil; e = errors.Unwrap(e) {
    switch e {
    case ErrA, ErrB, ErrC:
        // matched
        return
    }
}
```

This is rarely worth doing — only on profiled hot paths.

---

## Optimization 4 — Sentinel created per call

```go
func find(id int) error {
    return fmt.Errorf("find %d: %w", id, errors.New("not found"))
}
```

**Problem:** `errors.New("not found")` allocates a new `*errorString` every call. Callers cannot use `errors.Is(err, ErrNotFound)` because there is no sentinel to compare to.

**Better:** package-level sentinel.
```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return fmt.Errorf("find %d: %w", id, ErrNotFound)
}
```

The sentinel is allocated once at init. Wrapping reuses it. Callers can `errors.Is(err, ErrNotFound)`.

---

## Optimization 5 — Multi-`%w` for a single cause

```go
return fmt.Errorf("op: %w; %w", err, err)
```

**Problem:** Same error wrapped twice. The `*wrapErrors` allocates a `[]error` slice with two pointers to the same value. Useless.

**Better:**
```go
return fmt.Errorf("op: %w", err)
```

---

## Optimization 6 — `errors.Join` of always-nil errors

```go
return errors.Join(err1, err2, err3)
```

**Problem:** If most calls have all-nil arguments, `errors.Join` still iterates to filter and may allocate a `*joinError` if at least one is non-nil. For a path where errors are rare, hot-loop callers see needless work.

**Better:** check first.
```go
if err1 == nil && err2 == nil && err3 == nil {
    return nil
}
return errors.Join(err1, err2, err3)
```

(`errors.Join` does the same internally — this manual check just skips the loop in `Join`.)

---

## Optimization 7 — Cumulative wrap in a loop

```go
var combined error
for _, x := range items {
    if err := process(x); err != nil {
        combined = fmt.Errorf("item %v: %w", x, errors.Join(combined, err))
    }
}
```

**Problem:** Each iteration builds a new `*wrapError` *and* a new `*joinError`. Both allocate. Allocations grow linearly with errors.

**Better:** accumulate once, format once.
```go
var errs []error
for _, x := range items {
    if err := process(x); err != nil {
        errs = append(errs, fmt.Errorf("item %v: %w", x, err))
    }
}
return errors.Join(errs...)
```

One `errors.Join` allocation at the end.

---

## Optimization 8 — Long wrap chains in long-lived storage

```go
var failureLog []error  // package-level

func record(err error) {
    failureLog = append(failureLog, fmt.Errorf("at %s: %w", time.Now(), err))
}
```

**Problem:** Each error is wrapped (allocates) and stored forever. The wrapped chain stays alive in memory; chains held in `failureLog` are never collected. Over time the heap grows.

**Better:** decide whether you need the *chain* or just the *summary*.
```go
type FailureRecord struct {
    Time    time.Time
    Summary string
    Kind    string  // a small classification
}

var failureLog []FailureRecord
```

If you must keep the original error, bound the log size and rotate.

---

## Optimization 9 — `errors.As` in a loop with reflection

```go
for _, e := range errs {
    var pe *fs.PathError
    if errors.As(e, &pe) {
        process(pe)
    }
}
```

**Problem:** Each `errors.As` does reflection (`reflectlite.TypeOf` + `AssignableTo`). For 10,000 errors that is 10,000 reflection calls.

**Better:** sometimes a direct type assertion at the top of the chain is enough:
```go
for _, e := range errs {
    if pe, ok := e.(*fs.PathError); ok {
        process(pe)
        continue
    }
    var pe2 *fs.PathError
    if errors.As(e, &pe2) {  // only if direct didn't work
        process(pe2)
    }
}
```

Only worthwhile when the typical case is "no wrap" and you can shortcut.

---

## Optimization 10 — Chain depth from accidental layering

```go
func a() error { return fmt.Errorf("a: %w", b()) }
func b() error { return fmt.Errorf("b: %w", c()) }
func c() error { return fmt.Errorf("c: %w", d()) }
func d() error { return fmt.Errorf("d: %w", e()) }
func e() error { return io.EOF }
```

**Problem:** Five layers of wrap with no useful context. Each `errors.Is(err, io.EOF)` walks five nodes; each error allocates four wrappers.

**Better:** wrap with *useful* context, or pass through.
```go
func a() error {
    if err := business(); err != nil {
        return fmt.Errorf("loading user 42: %w", err)
    }
    return nil
}
```

Five "named context" wraps are fine; five "no-op" wraps are pure waste.

---

## Optimization 11 — Custom `Is` doing string compare

```go
func (e *MyErr) Is(target error) bool {
    return e.Error() == target.Error()
}
```

**Problem:** `Error()` may allocate to format. String comparison is O(len). Reflection-free but still wasteful.

**Better:** compare a stable identifier (a kind enum, a numeric code).
```go
func (e *MyErr) Is(target error) bool {
    t, ok := target.(*MyErr)
    return ok && e.Kind == t.Kind
}
```

---

## Optimization 12 — Capturing stack trace on every wrap

```go
import "github.com/pkg/errors"

if err != nil {
    return errors.Wrap(err, "loading")
}
```

**Problem:** `pkg/errors.Wrap` captures a stack trace. Each capture is ~µs and allocates a `[]uintptr` (variable length, often 8–32 frames). For high-rate paths this is significant.

**Better:** capture stack only at the *original* point of failure, not every wrap. `cockroachdb/errors` separates this. Or use the standard library's `fmt.Errorf` (no stack capture) and rely on wrap context as your trace.

---

## Optimization 13 — `errors.Join` building a long error string lazily

```go
err := errors.Join(errs...)
log.Print(err)  // Error() is called here — builds the joined string
log.Print(err)  // Error() called again — string rebuilt
```

**Problem:** `joinError.Error()` builds the joined string each call. If you log the same error multiple times, the string is built multiple times.

**Better:** materialize once.
```go
err := errors.Join(errs...)
msg := err.Error()
log.Print(msg)
log.Print(msg)
```

Or design so you don't log the same error twice.

---

## Optimization 14 — Wrapping with expensive context

```go
return fmt.Errorf("at %s on %s: %w", time.Now().Format(time.RFC3339), hostname(), err)
```

**Problem:** `time.Now()`, `Format`, and `hostname()` are evaluated *every* call, including success cases if you have eager wrapping. Even on the failure path, the formatting cost is paid per error.

**Better:** keep the wrap minimal. Time and host belong to the logger, not the error itself.
```go
return fmt.Errorf("operation X: %w", err)
// Logger adds time and host once at the boundary.
```

---

## Optimization 15 — `errors.Unwrap` in a manual walk when `errors.Is` would do

```go
for e := err; e != nil; e = errors.Unwrap(e) {
    if e == target {
        return true
    }
}
return false
```

**Problem:** This is exactly `errors.Is` minus the `Is` method support. It misses custom `Is` overrides and panics on non-comparable layers.

**Better:** just use `errors.Is`.
```go
return errors.Is(err, target)
```

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkWrap(b *testing.B) {
    leaf := errors.New("leaf")
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("op: %w", leaf)
    }
}

func BenchmarkIs(b *testing.B) {
    leaf := errors.New("leaf")
    chain := fmt.Errorf("a: %w", fmt.Errorf("b: %w", fmt.Errorf("c: %w", leaf)))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = errors.Is(chain, leaf)
    }
}
```

```bash
go test -bench=. -benchmem
```

Look for `allocs/op`, `B/op`, and `ns/op`. Compare wrap-heavy vs sentinel-only versions.

For allocation profiling:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Search for `*wrapError`, `*wrapErrors`, `*joinError`. If they are in the top 10 by count, they may be worth attention.

---

## When NOT to Optimize

- **Cold paths** — handlers fire 1/s, wraps cost nothing in aggregate.
- **Top-level wrapping at API boundaries** — readability beats nanoseconds.
- **Error paths that are genuinely rare** — your service does not hit them at scale, so optimization is invisible.
- **Tests** — clarity wins; tests do not run in production.

When in doubt: measure. Premature optimization of wrap chains produces unreadable code with no measurable benefit.

---

## Summary

The fast path of wrap/unwrap is already cheap in Go: `if err == nil` short-circuits, sentinel comparisons via `errors.Is` are sub-microsecond, walks are linear in chain length. The slow parts — wrapping with no context, cumulative joins in loops, stack trace capture on every wrap, custom `Is` doing string compares — only matter on high-rate failure paths. Profile first. Optimize only what shows up. Keep the chain useful and short, and the wrap will pay for itself many times over in debug time saved.
