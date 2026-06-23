# Handle, Don't Just Check — Optimization

> Each entry shows slow, wasteful, or noisy error-handling code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `fmt.Errorf` in a hot loop

```go
for _, tok := range tokens {
    if !valid(tok) {
        return fmt.Errorf("invalid token at position %d: %s", i, tok)
    }
}
```

**Problem:** `fmt.Errorf` allocates 2-3 times per call; in a hot validator that is a meaningful overhead.

**Better:** static sentinel + the position carried in a typed error.

```go
var errInvalidToken = errors.New("invalid token")

type tokenError struct {
    pos int
    tok string
}
func (e *tokenError) Error() string { return fmt.Sprintf("invalid token at %d: %s", e.pos, e.tok) }
func (e *tokenError) Unwrap() error { return errInvalidToken }

for i, tok := range tokens {
    if !valid(tok) {
        return &tokenError{pos: i, tok: tok}
    }
}
```

One allocation instead of three; the `Error()` formatting happens only when the message is actually printed.

---

## Optimization 2 — Wrapping at every layer in a hot path

```go
// db.go
return fmt.Errorf("query: %w", err)
// repo.go
return fmt.Errorf("get user: %w", err)
// service.go
return fmt.Errorf("login: %w", err)
// handler.go
return fmt.Errorf("handler: %w", err)
```

**Problem:** Four wraps per error in a high-volume path = 4× allocations, 4× message formatting.

**Better:** wrap once at the boundary.

```go
// internal layers: surface raw
return err

// boundary: wrap with the request context once
log.Printf("login handler %s: %v", reqID, err)
```

For very hot paths where errors are rare, no wrap at all in internals is fine — the boundary's structured log carries the request ID, user ID, op name.

---

## Optimization 3 — Sentinel constructed per call

```go
func validate(s string) error {
    if !valid(s) {
        return errors.New("invalid input") // BAD: per-call allocation
    }
    return nil
}
```

**Problem:** `errors.New` allocates each time. In a validator called millions of times, this is millions of allocations.

**Better:** package-level sentinel.

```go
var ErrInvalidInput = errors.New("invalid input")

func validate(s string) error {
    if !valid(s) {
        return ErrInvalidInput
    }
    return nil
}
```

Zero allocations on the error path. Bonus: callers can `errors.Is(err, ErrInvalidInput)` to check kind.

---

## Optimization 4 — `debug.Stack` per error

```go
return &myErr{err: err, stack: debug.Stack()}
```

**Problem:** `debug.Stack()` is 5-10 µs per call and several allocations. A wrap helper that calls it allocates kilobytes per error.

**Better:** capture cheap PCs at origin only; symbolize when actually printed.

```go
type myErr struct {
    err error
    pcs [16]uintptr
    n   int
}
func wrap(err error) *myErr {
    e := &myErr{err: err}
    e.n = runtime.Callers(2, e.pcs[:])
    return e
}
```

Capture cost ~150 ns vs ~5 µs.

---

## Optimization 5 — Multiplicative retry across services

```go
// Service A
for i := 0; i < 3; i++ {
    if err := callB(ctx); err == nil { break }
}
// Service B
for i := 0; i < 3; i++ {
    if err := callC(ctx); err == nil { break }
}
// Service C
for i := 0; i < 3; i++ {
    if err := dbOp(ctx); err == nil { break }
}
```

**Problem:** A single C blip becomes 3 × 3 × 3 = 27 attempts and a multiplicative latency multiplier. The user-visible request blows past timeouts.

**Better:** retry once, at the outermost layer. Inner services do not retry.

```go
// Outermost service (only)
for i := 0; i < 3; i++ {
    if err := op(ctx); err == nil { return nil }
}
```

Documented convention: "we retry at the entry point only".

---

## Optimization 6 — Logging stacks on every error

```go
slog.Error("error", "stack", string(debug.Stack()), "err", err)
```

**Problem:** ~5-10 µs and a kilobyte per log line. For 10k errors per minute this is significant CPU and significant log volume.

**Better:** log stacks only at the panic recovery boundary, where they are genuinely useful. Internal errors get structured fields without stacks.

```go
slog.Error("op failed",
    "op", "loadUser",
    "user_id", userID,
    "err", err.Error(),
)
```

Reserve `debug.Stack()` for `recover()` blocks.

---

## Optimization 7 — Running stack capture even for handled errors

```go
func wrap(err error) error {
    return &withStack{err: err, pcs: capture()}
}
// Used in every layer, even when 99% of errors are silently recovered
```

**Problem:** Most errors are silently handled (cache miss, retry, default). Capturing stacks for them is pure waste.

**Better:** capture only at *known-fatal* error sites, or rely on the `recover()` boundary's `debug.Stack`.

```go
// Most code: just wrap with context
return fmt.Errorf("op: %w", err)

// Only at "this should not happen" boundaries: capture
return &fatalErr{err: err, pcs: capture()}
```

---

## Optimization 8 — `errors.Is` chain walk in hot loop

```go
for _, item := range millionItems {
    err := process(item)
    if errors.Is(err, ErrSkip) { continue }
    if errors.Is(err, ErrRetry) { /* ... */ }
    if errors.Is(err, ErrFatal) { return err }
}
```

**Problem:** Each `errors.Is` walks the chain; with 5+ wraps per error and three checks per iteration, a 1M-item loop spends 15M chain walks.

**Better:** test once, switch on result.

```go
type result int
const (
    skip result = iota
    retry
    fatal
)

func classify(err error) result {
    switch {
    case errors.Is(err, ErrSkip):  return skip
    case errors.Is(err, ErrRetry): return retry
    case errors.Is(err, ErrFatal): return fatal
    }
    return fatal
}

for _, item := range items {
    err := process(item)
    if err == nil { continue }
    switch classify(err) {
    case skip: continue
    case retry: /* ... */
    case fatal: return err
    }
}
```

One classification per error; reuse the result.

---

## Optimization 9 — `errors.New` inside a method

```go
func (s *Service) Op() error {
    if !s.ready {
        return errors.New("service not ready") // BAD: per-call allocation
    }
    return nil
}
```

**Problem:** Every call to a method that fails the readiness check allocates a fresh sentinel. The result is identical each time.

**Better:**

```go
var errNotReady = errors.New("service not ready")

func (s *Service) Op() error {
    if !s.ready {
        return errNotReady
    }
    return nil
}
```

---

## Optimization 10 — Stack-allocated PC slice

```go
func capture() []uintptr {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return pcs[:n]
}
```

**Problem:** The `make([]uintptr, 32)` escapes to the heap because the slice is returned.

**Better:** embed in the struct so the array stays inline.

```go
type stack struct {
    pcs [32]uintptr
    n   int
}

func (s *stack) capture() {
    s.n = runtime.Callers(2, s.pcs[:])
}
```

If the parent struct is also kept on the stack, the entire capture is allocation-free.

---

## Optimization 11 — Generic `recover` middleware that prints to user

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Fprintf(w, "panic: %v\n%s", r, debug.Stack())
    }
}()
```

**Problem:** Two issues. (1) Sends sensitive stack info to the client (security). (2) Even if you decide to keep, sending the stack makes responses 10-100x larger than necessary.

**Better:** log internally, respond bland.

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic %v\n%s", r, debug.Stack())
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}()
```

---

## Optimization 12 — Pool the goroutine-dump buffer

```go
func dumpAllGoroutines() string {
    buf := make([]byte, 1<<20) // 1 MB allocated each call
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

**Problem:** A 1 MB allocation per dump. If your monitoring scrapes this every 30 seconds across many pods, the GC pressure adds up.

**Better:** `sync.Pool`.

```go
var dumpPool = sync.Pool{
    New: func() any { b := make([]byte, 1<<20); return &b },
}

func dumpAllGoroutines() string {
    bp := dumpPool.Get().(*[]byte)
    defer dumpPool.Put(bp)
    n := runtime.Stack(*bp, true)
    return string((*bp)[:n])
}
```

---

## Optimization 13 — Verbose error in metric labels

```go
errorCounter.WithLabelValues(err.Error()).Inc()
```

**Problem:** `err.Error()` returns "open /tmp/foo-12345: no such file or directory". The number `12345` makes every label unique. Cardinality explosion.

**Better:** label by *kind*, not message.

```go
errorCounter.WithLabelValues(errorKind(err)).Inc()

func errorKind(err error) string {
    switch {
    case errors.Is(err, fs.ErrNotExist): return "not_exist"
    case errors.Is(err, fs.ErrPermission): return "permission"
    default: return "other"
    }
}
```

---

## Optimization 14 — `errors.Is(err, target)` where `==` works

```go
if errors.Is(err, io.EOF) { ... } // when err is known to be raw io.EOF
```

**Problem:** Negligible, but in tight loops where the error is known to come from a single source, `==` is faster than `errors.Is` (no chain walk).

**Better:** when both sides are sentinels and you know the chain has no wraps:

```go
if err == io.EOF { ... }
```

Use `errors.Is` whenever there *might* be a wrap. The cost difference is small but the cognitive risk of `==` failing under future wrapping is the bigger issue. Default to `errors.Is`.

---

## Optimization 15 — Chained log lines

```go
// In each layer:
log.Printf("step1: %v", err)
log.Printf("step2: %v", err)
log.Printf("step3: %v", err)
```

**Problem:** N log lines per error. Log infrastructure cost grows with N. Operators learn to skip them.

**Better:** one structured log line at the boundary, with all the context as fields.

```go
slog.Error("login failed",
    "step", "step3",
    "user", u,
    "request_id", rid,
    "err", err,
)
```

One line, all the fields, queryable.

---

## Optimization 16 — Sleeping past the parent deadline

```go
for i := 0; i < 5; i++ {
    if err := op(ctx); err == nil { return nil }
    time.Sleep(backoff(i))
}
```

**Problem:** `time.Sleep` blocks past `ctx.Done()`. The retry loop continues even though the user has long since given up. Wasted work.

**Better:** select on context.

```go
select {
case <-time.After(backoff(i)):
case <-ctx.Done(): return ctx.Err()
}
```

Saves both upstream pressure and wasted CPU.

---

## Optimization 17 — Unused wrap in stable layer

```go
// Cache layer that always returns the same kind:
func (c *Cache) Get(k string) (V, error) {
    v, err := c.store.Get(k)
    if err != nil {
        return nil, fmt.Errorf("cache get: %w", err) // adds nothing
    }
    return v, nil
}
```

**Problem:** Every cache miss allocates a wrap that just adds "cache get" to a string the caller can already deduce from the call site.

**Better:** if the kind is uniform and the call site is obvious, return raw.

```go
func (c *Cache) Get(k string) (V, error) {
    return c.store.Get(k) // caller knows it called Cache.Get
}
```

If you need to *transform* (driver error → cache miss sentinel), do that — but a transform is different from a wrap.

---

## Optimization 18 — Captured stack vs structured log fields

```go
slog.Error("op failed", "stack", string(debug.Stack()))
```

**Problem:** Stacks in logs are kilobytes per line. Most log backends store them inefficiently and search slowly.

**Better:** structured fields are searchable; stacks belong in tracing or sampled logs.

```go
slog.Error("op failed",
    "op", "loadUser",
    "user_id", userID,
    "err", err.Error(),
    "trace_id", traceID,
)
```

Click through to the trace UI for the stack; do not duplicate in every log line.

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkBareCheck(b *testing.B) {
    err := errors.New("x")
    for i := 0; i < b.N; i++ {
        if err != nil {
            _ = err
        }
    }
}

func BenchmarkErrorf(b *testing.B) {
    inner := errors.New("inner")
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("op: %w", inner)
    }
}

func BenchmarkErrorsIs(b *testing.B) {
    sentinel := errors.New("s")
    err := fmt.Errorf("a: %w", fmt.Errorf("b: %w", fmt.Errorf("c: %w", sentinel)))
    for i := 0; i < b.N; i++ {
        _ = errors.Is(err, sentinel)
    }
}
```

```bash
go test -bench=. -benchmem
```

Expected output (modern x86-64, Go 1.22):

```
BenchmarkBareCheck   1000000000   ~1 ns/op    0 B/op    0 allocs/op
BenchmarkErrorf       6000000   ~200 ns/op  104 B/op    3 allocs/op
BenchmarkErrorsIs    50000000    ~25 ns/op    0 B/op    0 allocs/op
```

The bare check is essentially free. `Errorf` and `Is` cost real time; budget accordingly.

---

## When NOT to Optimize

- **Cold-path errors** (1 per minute): clarity wins, allocations do not matter.
- **Top-level recovery** middleware: full stacks and structured logs are more valuable than nanoseconds.
- **Debug builds, tests, CLI tools**: keep the diagnostic value.
- **Manual investigation tools**: operators want full traces.

The pattern: optimize only what is *both* hot and dominant in the profile. A 200 ns `fmt.Errorf` called once per HTTP request out of 50 ms total handling is invisible.

---

## Summary

The fast path of error handling in Go is the bare check (~1 ns) and a static sentinel return (~1 ns). The expensive paths are `fmt.Errorf` (~200 ns, 3 allocs), stack capture (~150 ns to ~10 µs depending on depth), and panic/recover (microseconds). Optimize hot validators with sentinels and typed errors; keep `fmt.Errorf` for cold paths. Wrap at the boundary, not at every layer. Log once, with structured fields. Avoid unbounded retries and multiplicative retries across services. Cancel-aware sleeps prevent wasted work past the parent deadline. Stack traces in metric labels destroy cardinality; in logs they bloat storage. The bigger optimisation in error handling is usually *removing* unnecessary work — fewer wraps, fewer logs, fewer retries — than making each operation faster.
