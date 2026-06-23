# errors.Join — Optimization

> Each entry shows slow or wasteful multi-error code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `Join` in a tight loop

```go
var multi error
for _, x := range items {
    if err := step(x); err != nil {
        multi = errors.Join(multi, err)
    }
}
return multi
```

**Problem:** Every iteration allocates a new `*joinError` and copies the previous slice. For N iterations, total work is O(N²). The result is also a left-leaning nested join, which is harder to read.

**Better:** collect into a slice, Join once:
```go
var errs []error
for _, x := range items {
    if err := step(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

Quantitative comparison for N=1000:

| Pattern | Time | Allocs |
|---------|------|--------|
| join-in-loop | ~600 µs | 2000 |
| collect-then-join | ~10 µs | 20-30 |

A 60× speedup.

---

## Optimization 2 — Variadic vs slice spread

```go
return errors.Join(a, b, c, d, e)
```

**Problem:** Each variadic call site builds a new `[]error` from the arguments. The variadic slice itself is an allocation (though it sometimes gets stack-allocated by escape analysis).

**Better:** if you are joining a slice you already have, pass it with `...`:
```go
return errors.Join(errs...)
```

Same result; no per-call-site overhead beyond the slice you already built.

---

## Optimization 3 — Eager `Error()` formatting

```go
err := errors.Join(errs...)
log.Println("collected:", err)
// later ...
return err
```

**Problem:** `Println` calls `err.Error()`, which walks every child and formats them. If the error is then returned and formatted *again* by the caller, you pay twice.

**Better:** log once, at the boundary. Pass the error up; let the consumer decide whether to format.

---

## Optimization 4 — Wrapping each error with the same prefix

```go
var errs []error
for _, x := range items {
    if err := step(x); err != nil {
        errs = append(errs, fmt.Errorf("processing failed: %w", err))
    }
}
return errors.Join(errs...)
```

**Problem:** "processing failed" appears N times in the output — once per error. Storage and read time scale with N.

**Better:** wrap *once*, at the join boundary:
```go
var errs []error
for _, x := range items {
    if err := step(x); err != nil {
        errs = append(errs, err)
    }
}
if joined := errors.Join(errs...); joined != nil {
    return fmt.Errorf("processing failed: %w", joined)
}
return nil
```

The prefix appears once; the join is the cause.

---

## Optimization 5 — Per-error stack capture in a multi-error

```go
for _, x := range items {
    if err := step(x); err != nil {
        // Each wrapped error has its own stack
        errs = append(errs, errStackWrap(err))
    }
}
return errors.Join(errs...)
```

**Problem:** Capturing a stack per error in a multi-error is rarely useful. The stacks are typically all the same (they all point at the loop). You pay 5-10 µs per error for redundant data.

**Better:** capture one stack at the join site:
```go
joined := errors.Join(errs...)
if joined != nil {
    return errStackWrap(joined)
}
```

Or skip the stack entirely; the caller can capture one if needed.

---

## Optimization 6 — Mutex-bound concurrent collection

```go
var mu sync.Mutex
var errs []error
for _, j := range jobs {
    go func(j Job) {
        if err := j.Run(); err != nil {
            mu.Lock()
            errs = append(errs, err)
            mu.Unlock()
        }
    }(j)
}
```

**Problem:** Mutex contention serializes goroutines on the unhappy path. For high error rates, the mutex becomes a bottleneck.

**Better:** indexed-slot writes — no mutex needed:
```go
errs := make([]error, len(jobs))
for i, j := range jobs {
    go func(i int, j Job) {
        errs[i] = j.Run() // each goroutine writes a distinct slot
    }(i, j)
}
// after wg.Wait():
return errors.Join(errs...) // nils filtered
```

Each goroutine touches a different cache line (or close); true contention is zero.

---

## Optimization 7 — Bounded `Error()` for huge multi-errors

```go
err := errors.Join(largeListOfErrs...) // 10,000 children
log.Println(err) // huge log line
```

**Problem:** Concatenating 10,000 `Error()` strings produces a multi-megabyte log entry. Log indices choke; transport bandwidth balloons.

**Better:** truncate at the source; or print a summary:
```go
const max = 10
errs := largeListOfErrs
truncated := 0
if len(errs) > max {
    truncated = len(errs) - max
    errs = errs[:max]
}
err := errors.Join(errs...)
log.Printf("error: %v (and %d more truncated)", err, truncated)
```

Or use structured logging with each child as a separate field, capped to the first N.

---

## Optimization 8 — Repeated `errors.Is` walks

```go
err := validate(req)
if errors.Is(err, ErrA) { /* ... */ }
if errors.Is(err, ErrB) { /* ... */ }
if errors.Is(err, ErrC) { /* ... */ }
if errors.Is(err, ErrD) { /* ... */ }
```

**Problem:** Each `errors.Is` walks the entire tree. For a tree with M nodes and K targets, total work is O(M·K).

**Better:** walk once, build a set:
```go
matched := map[error]bool{}
walk(err, func(e error) {
    for _, s := range []error{ErrA, ErrB, ErrC, ErrD} {
        if errors.Is(e, s) {
            matched[s] = true
        }
    }
})
if matched[ErrA] { /* ... */ }
if matched[ErrB] { /* ... */ }
```

For a small number of targets, the gain is small; for many, it is significant.

---

## Optimization 9 — Joining inside a fmt.Errorf

```go
return fmt.Errorf("step failed: %s", errors.Join(errs...).Error())
```

**Problem:** `Join(errs...)` allocates the joinError; `.Error()` formats it (one more allocation). Then `fmt.Errorf` creates another error from the string. Three errors materialized; only the outer one is kept.

**Better:** use `fmt.Errorf("...: %w", ...)` so the join is preserved:
```go
joined := errors.Join(errs...)
if joined != nil {
    return fmt.Errorf("step failed: %w", joined)
}
return nil
```

`%w` keeps the joined error in the unwrap chain — no string materialization unless someone calls `Error()`.

---

## Optimization 10 — Allocating multi-error per nil

```go
func safe() error {
    err := errors.Join() // always nil
    return err
}
```

**Problem:** This always returns nil but reads as if it might allocate. Confusing.

**Better:** just return nil:
```go
return nil
```

`errors.Join()` is a no-op; do not pretend it might be useful.

---

## Optimization 11 — Pool of multi-errors for repeated patterns

```go
type Validator struct {
    errs []error
}

func (v *Validator) Add(err error) {
    if err != nil {
        v.errs = append(v.errs, err)
    }
}

func (v *Validator) Result() error {
    return errors.Join(v.errs...)
}
```

**Problem:** Each new `Validator` allocates its `errs` slice.

**Better:** reuse via `sync.Pool` for hot paths:
```go
var validatorPool = sync.Pool{
    New: func() any {
        return &Validator{errs: make([]error, 0, 8)}
    },
}

func GetValidator() *Validator { return validatorPool.Get().(*Validator) }

func PutValidator(v *Validator) {
    v.errs = v.errs[:0]
    validatorPool.Put(v)
}
```

Caller:
```go
v := GetValidator()
defer PutValidator(v)
v.Add(check1())
v.Add(check2())
return v.Result()
```

The slice is reused; `errors.Join` still allocates one joinError per failure call (on the unhappy path), but the per-success allocation is eliminated.

---

## Optimization 12 — Avoiding `Join` when one error is enough

```go
return errors.Join(err)
```

**Problem:** A 1-element `Join` allocates two heap objects to wrap a single error. The caller cannot tell the difference (`errors.Is` works either way), but the cost is paid.

**Better:** if you have exactly one non-nil error, return it directly:
```go
if len(errs) == 0 {
    return nil
}
if len(errs) == 1 {
    return errs[0]
}
return errors.Join(errs...)
```

For most real code the optimization is invisible (`errors.Join` is fast enough), but in a hot validator the extra branch can save 30-50 ns and 2 allocations per call.

---

## Optimization 13 — `errors.As` in a loop instead of a walk

```go
var ve *ValidationErr
for {
    if !errors.As(err, &ve) { break }
    // process ve, then unwrap and try again
    err = errors.Unwrap(err)
}
```

**Problem:** `errors.As` already walks the tree once per call. Repeating it inside a loop walks the tree N times.

**Better:** walk once, collect all matches:
```go
var matches []*ValidationErr
walk(err, func(e error) {
    var ve *ValidationErr
    if errors.As(e, &ve) {
        matches = append(matches, ve)
    }
})
for _, ve := range matches {
    // process ve
}
```

`errors.As` is O(tree-size); a manual walk is O(tree-size) once.

---

## Optimization 14 — Joining of joins with deduplication

```go
return errors.Join(
    errors.Join(a, b),
    errors.Join(b, c),
    errors.Join(c, d),
)
// b appears twice; c appears twice
```

**Problem:** Duplicated children inflate the join. Cardinality grows; `Error()` text repeats. For shared sentinels (one error appearing in multiple sub-collections), the duplication wastes space.

**Better:** flatten + dedupe before joining:
```go
seen := make(map[error]struct{})
var unique []error
for _, group := range groups {
    if u, ok := group.(interface{ Unwrap() []error }); ok {
        for _, c := range u.Unwrap() {
            if _, dup := seen[c]; !dup {
                seen[c] = struct{}{}
                unique = append(unique, c)
            }
        }
    }
}
return errors.Join(unique...)
```

Note: dedupe by identity works for sentinels but not for distinct wrapped errors with the same message. For those, dedupe by `errors.Is(e, knownSentinel)`.

---

## Benchmarking

Always measure. A baseline benchmark suite:

```go
package multi

import (
    "errors"
    "testing"
)

var sentinel = errors.New("sentinel")

func BenchmarkJoinNil(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.Join(nil, nil, nil)
    }
}

func BenchmarkJoinSingle(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.Join(sentinel)
    }
}

func BenchmarkJoinMany(b *testing.B) {
    errs := make([]error, 10)
    for i := range errs {
        errs[i] = sentinel
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = errors.Join(errs...)
    }
}

func BenchmarkJoinInLoop(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var multi error
        for k := 0; k < 100; k++ {
            multi = errors.Join(multi, sentinel)
        }
        _ = multi
    }
}

func BenchmarkAppendThenJoin(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var errs []error
        for k := 0; k < 100; k++ {
            errs = append(errs, sentinel)
        }
        _ = errors.Join(errs...)
    }
}

func BenchmarkIsHit(b *testing.B) {
    err := errors.Join(errors.New("a"), errors.New("b"), sentinel)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = errors.Is(err, sentinel)
    }
}

func BenchmarkIsMiss(b *testing.B) {
    miss := errors.New("not present")
    err := errors.Join(errors.New("a"), errors.New("b"), errors.New("c"))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = errors.Is(err, miss)
    }
}
```

Run with:
```bash
go test -bench=. -benchmem
```

Expected output (modern x86-64, Go 1.21):
```
BenchmarkJoinNil-8           1000000000   1.5 ns/op    0 B/op   0 allocs/op
BenchmarkJoinSingle-8         50000000    30 ns/op    32 B/op   2 allocs/op
BenchmarkJoinMany-8           20000000    70 ns/op   192 B/op   2 allocs/op
BenchmarkJoinInLoop-8           500000  3000 ns/op  6400 B/op 200 allocs/op
BenchmarkAppendThenJoin-8     10000000   200 ns/op   880 B/op   3 allocs/op
BenchmarkIsHit-8              50000000    40 ns/op     0 B/op   0 allocs/op
BenchmarkIsMiss-8             50000000    50 ns/op     0 B/op   0 allocs/op
```

The `JoinInLoop` vs `AppendThenJoin` ratio (~15× here) is the headline result. For larger N the gap widens.

---

## When NOT to Optimize

- **Cold paths.** A validator that runs once per request out of 50 ms total is not worth tuning.
- **Tests.** Clarity wins. A 5 µs vs 50 ns difference is invisible in test output.
- **Top-level recovery handlers.** They run rarely; capture as much detail as you can afford.
- **CLI tools.** A multi-megabyte error in a one-shot CLI is fine.

The pattern: optimize what is *both* hot and dominant in the profile. A multi-error allocation per failed validation in a 10k QPS service is worth tuning. The same allocation in a once-per-day report is not.

---

## Summary

The fast path of `errors.Join` is "build a slice, call Join once". The pathological path is "Join in a loop", which is quadratic. `errors.Is` is fast (~50 ns even for trees of dozens of nodes); repeated calls are still cheap. Allocations dominate for hot paths — pool the slices, dedupe before joining, and bound the children. Format lazily: `Error()` is the expensive method and should run once at the boundary, not at every layer. Most importantly, profile first; the typical service will never see `errors.Join` in its hot profile, and over-engineering it costs maintainability for no measurable gain.

---

## Further Reading

- [Package errors — Join](https://pkg.go.dev/errors#Join)
- `$GOROOT/src/errors/join.go` — the implementation.
- `$GOROOT/src/errors/wrap.go` — `Is` and `As`.
- `go test -bench=. -benchmem` — measure your own paths.
- `go tool pprof -alloc_objects` — find the hot allocators.
- [Go 1.20 release notes](https://go.dev/doc/go1.20#errors)
