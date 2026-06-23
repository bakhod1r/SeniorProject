# Error Design — Best Practices — Optimization

> Each entry shows wasteful or sub-optimal error code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `fmt.Errorf` in a hot loop

```go
for _, item := range items {
    if !valid(item) {
        errs = append(errs, fmt.Errorf("item %d: %w", item.ID, ErrInvalid))
    }
}
```

**Problem:** `fmt.Errorf` allocates 2-3 times per call (~150 ns). For a parser called millions of times per second, this is a measurable CPU cost.

**Better:** for a hot path, return a sentinel and add context only at the boundary:
```go
for _, item := range items {
    if !valid(item) {
        return ErrInvalid  // sentinel, no allocation
    }
}
```

Or, if you need per-item context, batch the errors and format only once at the end:
```go
var bad []int
for _, item := range items {
    if !valid(item) { bad = append(bad, item.ID) }
}
if len(bad) > 0 {
    return fmt.Errorf("invalid items %v: %w", bad, ErrInvalid)
}
```

---

## Optimization 2 — Sentinel created per call

```go
func decode(b []byte) (string, error) {
    if !utf8.Valid(b) {
        return "", errors.New("invalid UTF-8")  // new sentinel each time
    }
    // ...
}
```

**Problem:** Every call to `errors.New` allocates. Ten million invalid inputs = ten million tiny allocations.

**Better:** package-level sentinel, allocated once:
```go
var ErrInvalidUTF8 = errors.New("invalid UTF-8")

func decode(b []byte) (string, error) {
    if !utf8.Valid(b) {
        return "", ErrInvalidUTF8
    }
    // ...
}
```

Zero allocations per call. Plus callers get `errors.Is(err, ErrInvalidUTF8)` for free.

---

## Optimization 3 — `%w` when the chain is never inspected

```go
// nobody ever calls errors.Is on this error
return fmt.Errorf("internal: %w", err)
```

**Problem:** `%w` allocates a `wrapError` struct in addition to the formatted message. If no caller will ever walk the chain, this is wasted work.

**Better:** for purely-textual contexts, `%v` is slightly cheaper:
```go
return fmt.Errorf("internal: %v", err)
```

Or skip the wrap entirely:
```go
return errors.New("internal: " + err.Error())
```

Caveat: only do this when you are sure no caller wants to walk the chain. When in doubt, prefer `%w` — the cost is small and the flexibility is real.

---

## Optimization 4 — `errors.As` walked deeply many times

```go
func handle(err error) {
    var a *AErr; if errors.As(err, &a) { ... }
    var b *BErr; if errors.As(err, &b) { ... }
    var c *CErr; if errors.As(err, &c) { ... }
    var d *DErr; if errors.As(err, &d) { ... }
}
```

**Problem:** Each `errors.As` walks the chain from the top. Four calls = 4× chain traversals.

**Better:** walk once, dispatch on type:
```go
func handle(err error) {
    for cur := err; cur != nil; cur = errors.Unwrap(cur) {
        switch e := cur.(type) {
        case *AErr: /* ... */ return
        case *BErr: /* ... */ return
        case *CErr: /* ... */ return
        case *DErr: /* ... */ return
        }
    }
}
```

Or use a `Kind` enum so you only call `errors.As` once and switch on the kind.

---

## Optimization 5 — Verbose wraps at every layer

```go
// 6 levels of:
return fmt.Errorf("op N: %w", err)
```

**Problem:** Six wraps = six allocations + six formatted strings per error. The composed message is rarely informative beyond 2-3 layers.

**Better:** wrap only when adding information; pass through otherwise:
```go
err := step()
if err != nil { return err }  // no new info; pass through
```

Or use a structured error with `Op` field at the boundaries that matter:
```go
return &errs.Error{Op: "users.Get", Err: err}
```

One allocation per boundary, not per wrap.

---

## Optimization 6 — `errors.Join` of always-nil errors

```go
return errors.Join(maybeErr, anotherMaybe, finalMaybe)
// where maybeErr is usually nil
```

**Problem:** `errors.Join` always allocates a slice, even when most arguments are nil. The slice is filtered for nils internally but still costs an allocation.

**Better:** check beforehand:
```go
if maybeErr == nil && anotherMaybe == nil && finalMaybe == nil {
    return nil
}
return errors.Join(maybeErr, anotherMaybe, finalMaybe)
```

Or accumulate only non-nil errors:
```go
var errs []error
if e := step1(); e != nil { errs = append(errs, e) }
if e := step2(); e != nil { errs = append(errs, e) }
if len(errs) == 0 { return nil }
return errors.Join(errs...)
```

---

## Optimization 7 — Allocating on every error path during construction

```go
func newErr(op string, kind Kind, path string) error {
    return &Error{Op: op, Kind: kind, Path: path}  // 1 alloc
}
```

**Problem:** `&Error{...}` escapes through the `error` interface; always heap-allocates. For very hot paths, every construction is an allocation.

**Better:** for the very hot case, sentinels are zero-allocation:
```go
var ErrInvalidName = &Error{Kind: KindInvalid, Op: "validate", Path: "name"}
```

Pre-construct the common cases as sentinels. Use the constructor only for cases that actually need per-call data.

---

## Optimization 8 — Pre-1.13 wraps still in code

```go
import "github.com/pkg/errors"

return errors.Wrap(err, "ctx")
```

**Problem:** `pkg/errors.Wrap` captures a stack trace by default. ~5-10 µs per call; significant in high-throughput code.

**Better:** use `fmt.Errorf` with `%w`:
```go
return fmt.Errorf("ctx: %w", err)
```

10-50× faster, no stack capture, modern API.

---

## Optimization 9 — Stack-on-every-error (already covered in topic 8 but recurs here)

```go
type withStack struct {
    err error
    s   []byte
}

func wrap(err error) error {
    return &withStack{err: err, s: debug.Stack()}
}
```

**Problem:** `debug.Stack` is microseconds + allocations. Every wrap pays it.

**Better:** capture cheap PCs at origin only; symbolize lazily. (Cross-reference topic 8 `optimize.md`.) For most services, just do not attach stacks at all and rely on structured logs + tracing.

---

## Optimization 10 — Metric label by error message

```go
errCount.With(prometheus.Labels{"err": err.Error()}).Inc()
```

**Problem:** Prometheus indexes labels; each unique `err.Error()` is a new time series. With wrap context (`"user 42: not found"`, `"user 43: not found"`, ...), cardinality explodes. Hundreds of MB of metrics, slow queries, alerting noise.

**Better:** label by `kind`, not message:
```go
errCount.With(prometheus.Labels{"kind": KindOf(err).String()}).Inc()
```

Bounded label set (10-20 kinds). Prometheus is happy.

---

## Optimization 11 — Building wrap message with `+`

```go
return errors.New("op " + path + ": " + err.Error())
```

**Problem:** Three allocations (the two `+` operations and the `errors.New`) plus the `Error()` call may itself allocate. And the wrap is "manual" — `errors.Is` cannot walk the chain.

**Better:** `fmt.Errorf` with `%w`:
```go
return fmt.Errorf("op %s: %w", path, err)
```

Slightly fewer allocations; the chain works.

---

## Optimization 12 — Re-wrapping inside a retry loop

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    if err := op(); err != nil {
        lastErr = fmt.Errorf("attempt %d: %w", attempt, err)
        continue
    }
    return nil
}
return lastErr
```

**Problem:** Every failed attempt allocates a wrap, even though only the last one is returned.

**Better:** keep the raw error; wrap once at the end:
```go
var lastErr error
for attempt := 0; attempt < maxAttempts; attempt++ {
    if err := op(); err != nil {
        lastErr = err
        continue
    }
    return nil
}
return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
```

`maxAttempts - 1` saved allocations per failing operation.

---

## Optimization 13 — `errors.New` inside a frequently-called function

```go
func validateAge(n int) error {
    if n < 0 || n > 150 {
        return errors.New("age out of range")  // new allocation per call
    }
    return nil
}
```

**Problem:** Each call allocates a fresh `errorString`. Ten million validations = ten million identical errors, all garbage.

**Better:** package-level sentinel:
```go
var ErrAgeOutOfRange = errors.New("age out of range")

func validateAge(n int) error {
    if n < 0 || n > 150 {
        return ErrAgeOutOfRange
    }
    return nil
}
```

Allocated once at init; zero per call.

---

## Optimization 14 — `errors.Join` for two errors

```go
return errors.Join(err1, err2)
```

**Problem:** `errors.Join` allocates a `joinError` and a slice — overhead for just two errors. In a hot path, the cost adds up.

**Better:** for exactly two known errors, manual wrap:
```go
return fmt.Errorf("%w; %w", err1, err2)  // Go 1.20+
```

This is slightly cheaper for the two-error case. For many errors or unknown count, `errors.Join` is the right answer.

---

## Optimization 15 — Type switch repeating identity check

```go
switch e := err.(type) {
case *NotFoundError:
    // ...
case *PermissionError:
    // ...
}
```

**Problem:** Type switch only matches the *outer* error; if the chain has wraps, this misses the typed error inside.

```go
err := fmt.Errorf("ctx: %w", &NotFoundError{...})
switch e := err.(type) {
case *NotFoundError:  // never matches!
}
```

**Better:** use `errors.As`:
```go
var nf *NotFoundError
if errors.As(err, &nf) { /* ... */ }
```

Slightly slower than a direct type switch (chain walk + reflect) but *correct*. For very hot paths, design so wraps do not happen between the type and the consumer.

---

## Optimization 16 — `Sprintf` in `Error()` for static text

```go
type MyErr struct{ Code int }

func (e *MyErr) Error() string {
    return fmt.Sprintf("error code %d", e.Code)  // allocates every call
}
```

**Problem:** Each `Error()` call formats the message. If your loggers and assertions call `Error()` multiple times, each call allocates.

**Better:** cache or precompute:
```go
type MyErr struct {
    Code int
    msg  string
}

func New(code int) *MyErr {
    return &MyErr{Code: code, msg: fmt.Sprintf("error code %d", code)}
}

func (e *MyErr) Error() string { return e.msg }
```

Allocate once, read many times.

For sentinels with no fields, make the message a const:
```go
type emptyErr string
func (e emptyErr) Error() string { return string(e) }
const ErrEmpty emptyErr = "empty"
```

---

## Optimization 17 — Heavy work inside the error chain construction

```go
return fmt.Errorf("processed %s: %w", expensiveDescription(item), err)
```

**Problem:** `expensiveDescription` runs even if the error is later filtered out by a `errors.Is(err, ErrIgnored)` check. The expensive work is done eagerly.

**Better:** lazy formatting via a custom error type:
```go
type itemErr struct {
    item Item
    err  error
}

func (e *itemErr) Error() string {
    return fmt.Sprintf("processed %s: %v", expensiveDescription(e.item), e.err)
}
func (e *itemErr) Unwrap() error { return e.err }
```

The expensive description is only computed when `Error()` is called — which is when the error reaches a logger.

---

## Optimization 18 — Constructing user-facing JSON for every error

```go
func errToAPI(err error) APIError {
    return APIError{
        Code:    "internal",
        Message: i18n.Translate("error.internal"),  // expensive lookup
        Hash:    sha256(err.Error()),               // expensive hash
    }
}
```

**Problem:** Even when the error is logged-and-discarded, you build the API response. Translation lookup and hashing are not free.

**Better:** build the API response only when responding to a client:
```go
// internal: just log
log.Printf("err: %v", err)

// at the response boundary, only:
if responding {
    api := errToAPI(err)
    json.NewEncoder(w).Encode(api)
}
```

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkSentinel(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = ErrNotFound
    }
}

func BenchmarkErrorsNew(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("x")
    }
}

func BenchmarkFmtErrorfV(b *testing.B) {
    base := errors.New("x")
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("ctx: %v", base)
    }
}

func BenchmarkFmtErrorfW(b *testing.B) {
    base := errors.New("x")
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("ctx: %w", base)
    }
}

func BenchmarkErrorsIs(b *testing.B) {
    err := fmt.Errorf("a: %w", fmt.Errorf("b: %w", ErrNotFound))
    for i := 0; i < b.N; i++ {
        _ = errors.Is(err, ErrNotFound)
    }
}
```

```bash
go test -bench=. -benchmem
```

Expected output (modern x86-64, Go 1.21):
```
BenchmarkSentinel-8        1000000000  ~1 ns/op       0 B/op   0 allocs/op
BenchmarkErrorsNew-8         50000000  ~30 ns/op     16 B/op   1 allocs/op
BenchmarkFmtErrorfV-8        10000000 ~120 ns/op     32 B/op   2 allocs/op
BenchmarkFmtErrorfW-8         8000000 ~150 ns/op     56 B/op   3 allocs/op
BenchmarkErrorsIs-8          50000000  ~25 ns/op      0 B/op   0 allocs/op
```

The 150× ratio between sentinel reuse and wrapped construction is the optimization budget. Use it where it matters.

---

## When NOT to Optimize

- **Cold-path errors** (1 per request, < 1k req/s): clarity wins, allocations are noise.
- **Boundary errors** that are about to be logged/serialized anyway: the formatting cost is dwarfed by the serialization cost.
- **One-time errors at startup**: a `log.Fatal(err)` is fine; allocate freely.
- **Test code**: optimization is the wrong goal; clarity helps debugging.

The pattern: optimize only what is *both* hot and dominant in the profile. A 150 ns `fmt.Errorf` once per HTTP request out of 5 ms total processing is invisible.

---

## Summary

The cheapest error in Go is a pre-allocated sentinel — pointer comparison, zero allocation. The next cheapest is a struct error allocated at error time. The most expensive common idiom is `fmt.Errorf` with `%w`, costing 2-3 allocations and ~150 ns. Hot paths benefit from sentinels and pre-built errors; cold paths can wrap freely. `errors.Is`/`As` is fast but walks the chain — keep chains shallow. Metric labels must be bounded (use kinds, not messages). Stack traces in errors are expensive and rarely worth it at the wrap level. Measure, then optimize. For 99% of services the standard wrap idiom is fast enough; the remaining 1% need to know the cost model.

---

## Further Reading

- [Go Blog — Profiling Go Programs](https://go.dev/blog/pprof)
- [Dave Cheney — Don't just check errors](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- `go test -bench=. -benchmem`
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors) — note its allocation profile vs stdlib
- Topic 8 `optimize.md` in this roadmap — stack capture cost
