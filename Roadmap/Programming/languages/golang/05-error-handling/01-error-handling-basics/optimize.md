# Error Handling Basics — Optimization

> Each entry shows slow or wasteful error-handling code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — Allocating sentinel-style errors per call

```go
func find(id int) error {
    return errors.New("not found")
}
```

**Problem:** Each call allocates a new `*errorString`. For a hot lookup function, that's millions of allocations.

**Better:** package-level sentinel.
```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return ErrNotFound
}
```

Allocation per call: 0. Use `errors.Is(err, ErrNotFound)` to detect at the caller.

---

## Optimization 2 — Wrapping inside a tight loop

```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("loop: %w", err)
    }
}
```

**Problem:** No issue here actually — a wrap on the failure path is fine. But the *next* example shows a real problem:

```go
for _, item := range items {
    err := process(item)
    err = fmt.Errorf("item %v: %w", item, err)  // BAD: wraps even on success
    if err != nil {
        return err
    }
}
```

`fmt.Errorf` is called every iteration, including success cases where `err` is nil. Wrapping nil produces a non-nil error (`"item 1: %!w(<nil>)"`), so the loop breaks immediately.

**Better:** wrap only on the failure path:
```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("item %v: %w", item, err)
    }
}
```

---

## Optimization 3 — Repeated `fmt.Errorf` for static messages

```go
return fmt.Errorf("invalid input")
```

**Problem:** `fmt.Errorf` is heavier than `errors.New` and offers no benefit for a static string.

**Better:**
```go
return errors.New("invalid input")
```

Or, even better, a package sentinel.

---

## Optimization 4 — Building error chains for logs you never read

```go
return fmt.Errorf("layer A: layer B: layer C: %w", err)
```

**Problem:** If the error rate is high (e.g., per-byte parser failures), each wrap adds cost. Wrap once at the boundary, not at every layer of a hot inner function.

**Better:** keep the inner function returning a small error; wrap once near the API surface where context is needed.

---

## Optimization 5 — `errors.Is` on a long chain

```go
if errors.Is(err, ErrA) || errors.Is(err, ErrB) || errors.Is(err, ErrC) {
    // ...
}
```

**Problem:** Each call to `errors.Is` walks the chain via `Unwrap`. For deeply nested errors and many sentinels, this becomes O(depth × sentinels).

**Better:** unwrap once and switch:
```go
for e := err; e != nil; e = errors.Unwrap(e) {
    switch e {
    case ErrA, ErrB, ErrC:
        return /* handle */
    }
}
```

This is rarely worth doing — only for measured hot paths.

---

## Optimization 6 — Using `panic`/`recover` for control flow

```go
func parse(input string) (out Output) {
    defer func() {
        if r := recover(); r != nil {
            out = Output{Err: r.(error)}
        }
    }()
    if invalid(input) {
        panic(errors.New("invalid"))
    }
    // ...
}
```

**Problem:** Panic+recover triggers stack unwinding — *much* more expensive than returning an error (~1000x). Some parsers do this for "convenience"; do not.

**Better:** return errors normally, even if it makes the function signature uglier.

---

## Optimization 7 — Comparing errors by `.Error()` string

```go
if err.Error() == "specific message" { ... }
```

**Problem:** `.Error()` may allocate to format. Comparison is O(len(message)). And it's brittle.

**Better:** use a sentinel + `errors.Is`. Comparison is then a pointer compare and one function call per Unwrap.

---

## Optimization 8 — `errors.Join` of nil errors

```go
return errors.Join(err1, err2, err3)
```

**Problem:** If most of these are nil, `errors.Join` still allocates a `*joinError` slice if at least one is non-nil. For a path where errors are rare, you allocate when you do not need to.

**Better:** check first:
```go
var errs []error
if err1 != nil { errs = append(errs, err1) }
if err2 != nil { errs = append(errs, err2) }
if err3 != nil { errs = append(errs, err3) }
if len(errs) == 0 {
    return nil
}
return errors.Join(errs...)
```

(`errors.Join` already filters nils internally, so this matters only if your goal is to skip the allocation entirely.)

---

## Optimization 9 — Goroutine-per-task fan-out for trivial work

```go
errCh := make(chan error, len(items))
for _, x := range items {
    go func(x Item) { errCh <- process(x) }(x)
}
```

**Problem:** Spinning up N goroutines for trivial CPU-bound work has more overhead than the work itself. The error channel adds further synchronization.

**Better:** use a worker pool sized to `runtime.NumCPU()` and route tasks through a channel. Or keep it sequential if N is small.

---

## Optimization 10 — Named returns "just in case"

```go
func f() (result int, err error) {
    result = 1
    return
}
```

**Problem:** Named returns are useful when `defer` modifies them, otherwise they reduce clarity and prevent some compiler optimizations (the compiler may put the named return on the stack frame more conservatively).

**Better:** use named returns *only* when `defer` needs to write to them. Otherwise:
```go
func f() (int, error) {
    return 1, nil
}
```

---

## Optimization 11 — Stack trace capture on every error

```go
func wrap(err error) error {
    return errors.Wrap(err, "context")  // pkg/errors captures stack
}
```

**Problem:** `github.com/pkg/errors`'s `Wrap` (and similar) captures a stack trace each time. Stack capture is ~µs and allocates a slice of `uintptr`. For low-volume error paths this is fine; for high-volume it's a hidden tax.

**Better:** capture stack at the *original* point of failure only, not at every wrap. Tools like `cockroachdb/errors` separate "wrap" (cheap) from "annotate with stack" (expensive).

---

## Optimization 12 — Logger formats error needlessly

```go
log.Printf("error: %v", err)
```

**Problem:** Always formats the error string, even when the log level filters this out.

**Better (with a structured logger):**
```go
slog.Error("operation failed", "err", err)
```

Structured loggers can elide the formatting if the level is not enabled.

---

## Optimization 13 — Cumulative `errors.Join` in a loop

```go
var combined error
for _, x := range items {
    if err := process(x); err != nil {
        combined = errors.Join(combined, err)
    }
}
```

**Problem:** `errors.Join` builds a *new* `*joinError` each iteration. Allocations grow linearly with errors.

**Better:** accumulate to a slice, join once at the end:
```go
var errs []error
for _, x := range items {
    if err := process(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

---

## Optimization 14 — Defer in a function that does not need it

```go
func canFail() error {
    defer func() {}()  // empty defer
    // ...
}
```

**Problem:** Each `defer` schedules cleanup at runtime — small but non-zero cost (~50 ns each pre-Go 1.14, much less after). Empty defers are pure waste.

**Better:** delete the empty defer.

---

## Optimization 15 — Excessively chatty error context

```go
return fmt.Errorf(
    "FAILED: operation = %s, input = %v, time = %v, host = %s, err = %w",
    op, input, time.Now(), hostname, err,
)
```

**Problem:** Every iteration formats lots of context. For high-rate paths, this adds up. Also `time.Now()` is called even on success paths if you build the format eagerly.

**Better:** keep the wrap minimal at the inner layer; let the outer layer (logger) add hostname, time, etc. once.

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkErrorPath(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = process()
    }
}
```

```bash
go test -bench=. -benchmem
```

Look at `allocs/op` and `B/op`. If errors do not show up as a top contributor, do not micro-optimize them.

For allocation profiling:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Search for `errors.New`, `*errorString`, `*wrapError` in the listing.

---

## When NOT to Optimize

- **Cold path errors** — handlers fire 1/s, allocations don't matter.
- **Top-level wrapping** — readability >> 100 ns.
- **Tests** — clarity wins.
- **CLI tools** — startup cost dominates anything errors do.

When in doubt: measure. Premature optimization of error paths is a common source of unreadable code with no measurable benefit.

---

## Summary

The fast path of error handling is already free in Go: `if err != nil` checks against zero, costs nothing when `err` is nil, branch prediction handles the rest. The slow parts — `errors.New` per call, `fmt.Errorf` wrapping, `errors.Join` in loops — only matter when error rates are high. Profile first. Optimize only what matters. Keep the code readable for the 99% case.
