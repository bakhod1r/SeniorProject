# errors.Is vs errors.As — Optimization

> Each entry shows slow or wasteful `errors.Is`/`errors.As` code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `errors.As` in a hot path where a type assertion would do

```go
for _, err := range errs {
    var pe *os.PathError
    if errors.As(err, &pe) { handle(pe) }
}
```

**Problem:** `errors.As` does reflection (`reflect.TypeOf().AssignableTo()`) on every iteration. ~30-100 ns per call. If `err` is never wrapped — known because it comes from a single source — direct type assertion is much cheaper.

**Better:**
```go
for _, err := range errs {
    if pe, ok := err.(*os.PathError); ok { handle(pe) }
}
```

A type assertion is ~1 ns. Use it whenever you control the producer and know there is no wrap. Use `errors.As` only when wrapping might be in the way.

Benchmark (Go 1.21, amd64):
```
BenchmarkAssertion-8      1000000000   1.2 ns/op   0 allocs/op
BenchmarkErrorsAs-8        20000000    65 ns/op    0 allocs/op
```

---

## Optimization 2 — Repeated `errors.As` on the same error

```go
func handle(err error) {
    var pe *os.PathError
    var ne *net.OpError
    var de *DBError

    if errors.As(err, &pe) { logPath(pe) }
    if errors.As(err, &ne) { logNetwork(ne) }
    if errors.As(err, &de) { logDB(de) }
}
```

**Problem:** Each `errors.As` walks the chain again. If the chain is 5 deep and 3 different `As` calls all miss, you have done 15 chain steps.

**Better:** walk once, dispatch with type switch.
```go
func handle(err error) {
    for e := err; e != nil; e = errors.Unwrap(e) {
        switch x := e.(type) {
        case *os.PathError: logPath(x)
        case *net.OpError:  logNetwork(x)
        case *DBError:      logDB(x)
        }
    }
}
```

This visits each chain link once and dispatches in O(1) per link. Notes:
- This pattern does not handle multi-error trees (`Unwrap() []error`). Add explicit handling if you need that.
- It does not invoke custom `Is`/`As` methods. Acceptable for the common case where you know the concrete types.

---

## Optimization 3 — `errors.Join` accumulator nesting

```go
var err error
for _, item := range items {
    if e := process(item); e != nil {
        err = errors.Join(err, e)
    }
}
return err
```

**Problem:** Each `errors.Join` produces a new wrapper around the previous one. After N iterations, the chain is N deep (a left-spine tree). `errors.Is(err, target)` walks all N nodes on a miss.

**Better:** collect, join once.
```go
var errs []error
for _, item := range items {
    if e := process(item); e != nil {
        errs = append(errs, e)
    }
}
return errors.Join(errs...)
```

A single multi-error wrapper of depth 1. Walk visits N+1 nodes for a full miss but the tree is balanced and the per-node work is the same as before.

---

## Optimization 4 — Allocating the target pointer per call

```go
func wrapAndExtract(err error) string {
    var pe *os.PathError
    if errors.As(err, &pe) {
        return pe.Path
    }
    return ""
}
```

**Problem:** Not really. The local `var pe *os.PathError` is a stack variable; no heap allocation. But many programmers worry about this. Verify with `go test -benchmem` and `go build -gcflags='-m'` to be sure.

If `pe` truly escapes (e.g., you save it into a heap-allocated struct), it could allocate. Otherwise the typical `var pe *T; errors.As(err, &pe)` pattern is allocation-free.

---

## Optimization 5 — Custom `Is` method that calls `errors.Is` recursively

```go
type compoundErr struct{ a, b error }

func (e *compoundErr) Error() string { return ... }

func (e *compoundErr) Is(target error) bool {
    return errors.Is(e.a, target) || errors.Is(e.b, target)
}
```

**Problem:** Each `errors.Is(parent, target)` calls `e.Is(target)`, which calls `errors.Is(e.a, target)` and `errors.Is(e.b, target)` — recursively walking sub-chains. With nested `compoundErr` values, the walk is exponential in the depth.

**Better:** Implement `Unwrap() []error` instead. The standard library's walk is iterative and short-circuits.

```go
func (e *compoundErr) Unwrap() []error { return []error{e.a, e.b} }
```

The single-error walk now handles both branches; no recursion in your code; complexity is linear in nodes.

---

## Optimization 6 — Pre-wrap, post-wrap, and pre-allocated kinds

```go
return fmt.Errorf("svc.GetUser %d: %w", id, err)
```

**Problem:** `fmt.Errorf` allocates the wrapper struct + formatted message string. In a request handler that always wraps, this is fine; in a parser that wraps per token, the cost is high.

**Better (when frequency is high):**
- Use a typed wrapper that does no formatting: a struct with `id int`, `err error`. The message can be lazily computed in `Error()`.
- Skip wrapping when no context is being added.
- For "this just happened" matches, return the sentinel directly without wrap.

```go
type getUserErr struct {
    id  int
    err error
}

func (e *getUserErr) Error() string { return fmt.Sprintf("svc.GetUser %d: %v", e.id, e.err) }
func (e *getUserErr) Unwrap() error { return e.err }
```

Now wrapping is one struct allocation (~24 bytes); the message string is computed only when something prints the error.

---

## Optimization 7 — `errors.Is` against a slice of sentinels

```go
for _, target := range []error{ErrA, ErrB, ErrC, ErrD} {
    if errors.Is(err, target) {
        // ...
    }
}
```

**Problem:** Each `errors.Is` call walks the chain. With 4 targets and a 5-deep chain, that is 20 chain steps for a miss.

**Better:** walk the chain once and dispatch on a custom-mapped kind sentinel.

```go
type errKind int

const (
    kindUnknown errKind = iota
    kindA
    kindB
    // ...
)

func classifyOnce(err error) errKind {
    switch {
    case errors.Is(err, ErrA): return kindA
    case errors.Is(err, ErrB): return kindB
    case errors.Is(err, ErrC): return kindC
    case errors.Is(err, ErrD): return kindD
    }
    return kindUnknown
}
```

Or, if your error types implement a `Kind()` method, just dispatch on that:

```go
type kinder interface{ Kind() errKind }

func classifyOnce(err error) errKind {
    var k kinder
    if errors.As(err, &k) {
        return k.Kind()
    }
    return kindUnknown
}
```

One walk; immediate classification.

---

## Optimization 8 — Custom `Is` doing string comparison

```go
func (e *myErr) Is(target error) bool {
    return e.Error() == target.Error()
}
```

**Problem:** `Error()` may format a string each call; equal strings still allocate. Worse, identity-vs-equality semantics.

**Better:** compare a stable kind field, never the message.
```go
func (e *myErr) Is(target error) bool {
    return target == e.kind
}
```

---

## Optimization 9 — Early return on common case

```go
func handle(err error) {
    if err == nil { return }
    if errors.Is(err, KindCommon) { handleCommon(); return }
    // 12 more switch cases
}
```

**Problem:** If `KindCommon` is the most frequent, prioritizing it is right. If it is rare, every call does a full chain walk before falling through.

**Better:** order the switch so the *most likely* match is first. Profile to know the distribution. The CPU branch predictor and instruction cache also benefit from a stable order.

---

## Optimization 10 — Avoiding `errors.Is` when the chain is known to be empty

If you know the producer returns a sentinel directly without wrapping, do not pay for `errors.Is`:

```go
// expensive in tight loop
if errors.Is(err, io.EOF) { ... }

// faster when err is io.EOF directly:
if err == io.EOF { ... }
```

This is only safe when *you* control the producer. If the producer is `bufio.Reader.Read`, EOF comes through as `io.EOF` directly — `==` works. If the producer is `parsers.NextToken` and may wrap, use `errors.Is`.

A reasonable rule: if the caller is internal-only and you trust the producer, use `==`. If the caller crosses a package boundary, use `errors.Is`.

---

## Optimization 11 — Caching the result of an expensive `As`

```go
func httpStatus(err error) int {
    var ke *kindedErr
    if errors.As(err, &ke) {
        return ke.HTTPStatus
    }
    return 500
}

// hot path
for _, err := range errs {
    log.Print(httpStatus(err)) // pays the As cost each call
}
```

**Problem:** repeated `As` for the same error.

**Better:** classify once.
```go
type classified struct { err error; status int }

func classify(err error) classified {
    var ke *kindedErr
    if errors.As(err, &ke) {
        return classified{err, ke.HTTPStatus}
    }
    return classified{err, 500}
}

// hot path
for _, c := range classifieds { // already classified upstream
    log.Print(c.status)
}
```

This is just CSE (common subexpression elimination) by hand. Rarely critical, but visible at scale.

---

## Optimization 12 — Pre-allocating multi-error slices

```go
func gather(items []Item) error {
    var errs []error
    for _, it := range items {
        if e := process(it); e != nil {
            errs = append(errs, e)
        }
    }
    return errors.Join(errs...)
}
```

**Problem:** the slice grows by doubling. For `len(items) == 1024`, you might allocate 11 backing arrays.

**Better:** pre-allocate to expected capacity.
```go
errs := make([]error, 0, len(items))
```

If errors are rare, this over-allocates. If they are common, it saves N append-driven copies.

---

## Optimization 13 — Avoiding `errors.As` panic-prone patterns

This isn't speed; it is correctness. `errors.As` panics if you misuse the target. In hot code these panics fire under load — and panic-recover dwarfs the cost of `As`. Make sure you cannot reach an `As` with a bad target.

```go
// Bad: target may be nil if config is missing
errors.As(err, cfg.Target) // ouch

// Good: ensure target is always *T at compile time
var pe *os.PathError
errors.As(err, &pe)
```

A linter (`errorlint`, `wrapcheck`) can catch many of these mistakes.

---

## Optimization 14 — Skipping work when error is nil

```go
func wrap(err error) error {
    if err == nil { return nil }
    return fmt.Errorf("op: %w", err)
}
```

**Problem:** None — this is the fix. The bug is forgetting it:
```go
return fmt.Errorf("op: %w", err) // err might be nil
```

If `err` is nil, `fmt.Errorf` panics ("argument to %w is not error" — well, actually it constructs a wrapper around a nil error, which then makes `errors.Is` weird). Always nil-guard before wrapping.

---

## Optimization 15 — `errors.Is` chain walk in a benchmark

A benchmark to memorize:

```go
var sentinel = errors.New("s")

func deepWrap(n int) error {
    err := sentinel
    for i := 0; i < n; i++ {
        err = fmt.Errorf("layer %d: %w", i, err)
    }
    return err
}

func BenchmarkIs5(b *testing.B) {
    err := deepWrap(5)
    for i := 0; i < b.N; i++ {
        if !errors.Is(err, sentinel) {
            b.Fatal("expected match")
        }
    }
}

func BenchmarkIs50(b *testing.B) {
    err := deepWrap(50)
    for i := 0; i < b.N; i++ {
        if !errors.Is(err, sentinel) {
            b.Fatal("expected match")
        }
    }
}
```

Typical numbers (Go 1.21, amd64):
- 5-deep: ~30 ns/op
- 50-deep: ~250 ns/op
- linear in chain depth

Linear, allocation-free. Predictable. Use these numbers as your back-of-envelope estimates.

---
