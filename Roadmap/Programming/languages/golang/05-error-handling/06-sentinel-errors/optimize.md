# Sentinel Errors — Optimization

> Each entry shows slow or wasteful sentinel-related code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `errors.New` per call where a sentinel would do

```go
func find(id int) error {
    return errors.New("not found")
}
```

**Problem:** Every call allocates a fresh `*errorString` (~32 B). For a hot lookup function called millions of times per second, that is millions of allocations and matching GC work.

**Better:** package-level sentinel.
```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return ErrNotFound
}
```

Allocation per call: 0. Identity-based detection becomes possible (`errors.Is(err, ErrNotFound)`).

---

## Optimization 2 — `fmt.Errorf` for a static message

```go
return fmt.Errorf("invalid input")
```

**Problem:** `fmt.Errorf` runs the full formatting machinery and allocates 1–2 objects. For a static message there is no formatting work to do.

**Better:**
```go
return errors.New("invalid input")
```

Or, even better, a package sentinel:
```go
var ErrInvalidInput = errors.New("invalid input")
return ErrInvalidInput
```

Per call: 0 allocations.

---

## Optimization 3 — Wrapping a sentinel in a hot inner loop

```go
func process(items []item) error {
    for _, it := range items {
        if !valid(it) {
            return fmt.Errorf("item %v invalid: %w", it, ErrInvalid)
        }
    }
    return nil
}
```

**Problem:** Wrapping is fine on the *failure path*, but if `process` fails 90% of the time during a scan, every failure allocates a wrapper struct + a formatted message string. For high-rate paths this is real cost.

**Better:** wrap once at the boundary:
```go
func process(items []item) error {
    for _, it := range items {
        if !valid(it) {
            return ErrInvalid // bare; let caller add context
        }
    }
    return nil
}

// caller
if err := process(items); err != nil {
    return fmt.Errorf("scan items: %w", err)
}
```

Now the wrap happens once per scan, not once per failed item.

---

## Optimization 4 — `errors.Is` over a long sentinel list

```go
switch {
case errors.Is(err, ErrA):
case errors.Is(err, ErrB):
case errors.Is(err, ErrC):
case errors.Is(err, ErrD):
case errors.Is(err, ErrE):
}
```

**Problem:** Each `errors.Is` walks the wrap chain. For a chain of depth 3 and 5 sentinels, that's 15 comparisons. Usually negligible, but on a hot path it adds up.

**Better:** unwrap once and switch:
```go
for e := err; e != nil; e = errors.Unwrap(e) {
    switch e {
    case ErrA, ErrB, ErrC, ErrD, ErrE:
        return /* handle */
    }
}
```

This walks the chain once and compares against all sentinels per layer. For 5 sentinels and depth 3: 15 → 9 comparisons in the worst case, fewer when matched early.

Apply only when measured. Most code does not need this.

---

## Optimization 5 — Comparing sentinels via `.Error()`

```go
if err.Error() == ErrNotFound.Error() {
    /* ... */
}
```

**Problem:** Allocates the `.Error()` string each call (most concrete error types build the string lazily) and runs an O(len) comparison.

**Better:** identity comparison:
```go
if errors.Is(err, ErrNotFound) {
    /* ... */
}
```

Comparison is O(1) plus the wrap-chain walk.

---

## Optimization 6 — Sentinel chain bypassing `Unwrap`

```go
func IsNotFound(err error) bool {
    for {
        if err == ErrNotFound {
            return true
        }
        u, ok := err.(interface{ Unwrap() error })
        if !ok {
            return false
        }
        err = u.Unwrap()
        if err == nil {
            return false
        }
    }
}
```

**Problem:** Re-implementing `errors.Is`. Likely loses behavior (the custom `Is(target error) bool` method override on typed errors). Also adds bug surface.

**Better:** just use the standard library:
```go
func IsNotFound(err error) bool {
    return errors.Is(err, ErrNotFound)
}
```

The standard library is well-optimized; the helper layer adds only the function-call cost.

---

## Optimization 7 — Sentinel for the success case

```go
var (
    ErrSuccess = errors.New("ok")
    ErrFailure = errors.New("failed")
)

func op() error {
    if good() {
        return ErrSuccess
    }
    return ErrFailure
}
```

**Problem:** Every caller has to do `errors.Is(err, ErrSuccess)` to mean "success." Worse, callers using the standard `if err != nil` idiom *always* see "failure" because `ErrSuccess` is non-nil.

**Better:** use `nil` for success.
```go
func op() error {
    if good() {
        return nil
    }
    return ErrFailure
}
```

Standard idiom; one allocation saved (the bogus success sentinel); zero confusion at call sites.

---

## Optimization 8 — `errors.Is` instead of `==` on a known-bare error

```go
ch := make(chan error)
go func() {
    ch <- io.EOF // always bare
}()
err := <-ch
if errors.Is(err, io.EOF) {
    // ...
}
```

**Problem:** Within this isolated channel pipeline, the error is *guaranteed* to be bare `io.EOF`. The full `errors.Is` walk is unnecessary.

**Better (only when really hot):**
```go
if err == io.EOF {
    // ...
}
```

Cost saved: one method-table lookup, one Unwrap attempt. Single-digit nanoseconds. *Almost never worth it* — if anyone refactors to wrap, the check silently breaks. Use `errors.Is` as the safe default and revert to `==` only after a profiler points here.

---

## Optimization 9 — Repeated sentinel detection in the same function

```go
func handle(err error) {
    if errors.Is(err, ErrNotFound) {
        log.Print("not found")
    }
    if errors.Is(err, ErrNotFound) {
        metrics.Incr("not_found")
    }
    if errors.Is(err, ErrNotFound) {
        return
    }
}
```

**Problem:** Three chain walks for one logical check. Each walk is the full depth.

**Better:** cache the result:
```go
func handle(err error) {
    notFound := errors.Is(err, ErrNotFound)
    if notFound {
        log.Print("not found")
        metrics.Incr("not_found")
        return
    }
    /* other handling */
}
```

---

## Optimization 10 — `errors.Join` over many `nil` sentinels

```go
return errors.Join(maybeErr1(), maybeErr2(), maybeErr3())
```

**Problem:** `errors.Join` filters out nils internally, but it still constructs a `*joinError` and a slice if at least one is non-nil. If most are nil, you pay the slice allocation for nothing.

**Better (only when measured):** check first:
```go
errs := make([]error, 0, 3)
if e := maybeErr1(); e != nil { errs = append(errs, e) }
if e := maybeErr2(); e != nil { errs = append(errs, e) }
if e := maybeErr3(); e != nil { errs = append(errs, e) }
if len(errs) == 0 {
    return nil
}
return errors.Join(errs...)
```

Skips the slice allocation when everything succeeds. Most of the time, `errors.Join` directly is fine.

---

## Optimization 11 — Wrapping a sentinel via `errors.Wrap` (third-party)

```go
return errors.Wrap(ErrNotFound, "find")
```

**Problem:** `github.com/pkg/errors`'s `Wrap` captures a stack trace per call. Stack capture is ~1 µs and allocates a slice of `uintptr`. For high-volume sentinel paths this is hidden tax.

**Better:** use stdlib wrapping:
```go
return fmt.Errorf("find: %w", ErrNotFound)
```

No stack trace; faster; identity preserved. Use stack capture only at the *original* point of failure if you really need it.

---

## Optimization 12 — Allocating a sentinel-shaped error per request

```go
func handle(r *Request) error {
    return errors.New(fmt.Sprintf("not found: %s", r.Key))
}
```

**Problem:** A new `*errorString` per request, plus the formatted message string. Two allocations per call. Sentinels would give zero, but the message includes context.

**Better:** wrap a sentinel:
```go
var ErrNotFound = errors.New("not found")

func handle(r *Request) error {
    return fmt.Errorf("not found: %s: %w", r.Key, ErrNotFound)
}
```

You pay the allocation for the wrap, but now identity-based detection (`errors.Is`) works at the caller.

---

## Optimization 13 — `errors.Is` on `errors.Join` result with many branches

```go
return errors.Join(errs...) // 100 errors
```

**Problem:** Caller's `errors.Is(joined, target)` walks every branch of the join. For 100 branches, 100 comparisons. If callers detect the same sentinel many times, costs add up.

**Better:** if you only need the *first* matching sentinel, capture it during construction:
```go
var firstNotFound error
for _, e := range errs {
    if errors.Is(e, ErrNotFound) && firstNotFound == nil {
        firstNotFound = e
    }
}
// return firstNotFound or errors.Join(errs...) per use case
```

Mostly overkill. Real systems rarely have 100-branch joins.

---

## Optimization 14 — Sentinel comparison hidden behind a method

```go
func (e *MyError) IsNotFound() bool {
    return errors.Is(e, ErrNotFound)
}

// repeated detection
for i := 0; i < 1e6; i++ {
    if e.IsNotFound() { ... }
}
```

**Problem:** Every call is one indirect method call plus the chain walk. For a hot `for` loop the method dispatch adds overhead.

**Better:** call once and cache, or compute the kind eagerly when constructing:
```go
type MyError struct {
    Kind     Kind   // KindNotFound, etc.
    /* ... */
}
// detection becomes a struct field compare
```

Now detection is a simple int compare, no chain walk.

---

## Optimization 15 — Allocating per error before checking sentinel

```go
err := fetch()
err = fmt.Errorf("fetch: %w", err)
if errors.Is(err, io.EOF) {
    return nil
}
return err
```

**Problem:** Wraps unconditionally, then checks the sentinel. Wrapping allocates a `*fmt.wrapError` even on the success-equivalent (`io.EOF`) path.

**Better:** check the sentinel before wrapping:
```go
err := fetch()
if errors.Is(err, io.EOF) {
    return nil
}
if err != nil {
    return fmt.Errorf("fetch: %w", err)
}
return nil
```

Allocation only when actually returning a real failure.

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkSentinelReturn(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = returnsSentinel()
    }
}

func BenchmarkErrorsNew(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("not found")
    }
}

func BenchmarkFmtErrorfWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("ctx: %w", ErrFoo)
    }
}
```

```bash
go test -bench=. -benchmem
```

Typical results on amd64 (Go 1.21):

```
BenchmarkSentinelReturn-8     1000000000   0.5 ns/op    0 B/op  0 allocs/op
BenchmarkErrorsNew-8           50000000   30   ns/op   16 B/op  1 allocs/op
BenchmarkFmtErrorfWrap-8       10000000  120   ns/op   80 B/op  2 allocs/op
```

The numbers tell the story: returning a sentinel is free; `errors.New` allocates; `fmt.Errorf` allocates more. Use the cheapest one that gives you the information your caller needs.

---

## When NOT to Optimize

- **Cold paths.** A handler that fires 1/s — allocations are noise.
- **Single-wrap chains.** One layer of `fmt.Errorf("op: %w", ...)` is fine; do not unroll it.
- **Tests.** Clarity over allocation count.
- **CLI tools.** Startup dominates anything errors do.
- **Once-per-request errors.** A web request involves dozens of allocations anyway; one error wrap is invisible.

When in doubt: measure. Premature optimization of sentinel paths is a common source of unreadable code with no measurable benefit.

---

## Summary

Sentinels are already the cheapest error mechanism Go offers — zero allocations per return, sub-nanosecond comparison. The expensive parts are *creating new errors* (`errors.New` inside a function, `fmt.Errorf` for static messages) and *wrapping per call in hot loops*. Promote per-call errors to package sentinels, wrap once at the boundary, prefer `errors.Is` over re-implementations, and let the standard library do its job. Profile before optimizing; only the high-rate paths matter.
