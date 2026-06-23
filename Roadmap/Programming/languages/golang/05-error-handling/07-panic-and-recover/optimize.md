# panic and recover — Optimization

> Each entry shows wasteful or slow panic-related code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — panic for control flow

```go
func find(items []int, target int) int {
    defer func() {
        if r := recover(); r != nil {
            // got the index from panic
        }
    }()
    for i, v := range items {
        if v == target {
            panic(i)
        }
    }
    return -1
}
```

**Problem:** Using panic to "return" the index is ~100x slower than a normal return. The runtime walks the stack and runs defers.

**Better:**
```go
func find(items []int, target int) int {
    for i, v := range items {
        if v == target {
            return i
        }
    }
    return -1
}
```

A normal return is ~1 ns; the panic approach is ~500 ns. For a hot lookup, that is 500x slower with no benefit.

---

## Optimization 2 — defer in a tight loop

```go
for i := 0; i < 1_000_000; i++ {
    defer cleanup(i) // builds 1M deferred records
}
```

**Problem:** Each `defer` allocates and registers. A million defers stack up to run at function exit, plus the registration cost is paid each iteration.

**Better:** explicit cleanup, or move the loop into a helper:
```go
for i := 0; i < 1_000_000; i++ {
    func(i int) {
        defer cleanup(i)
        work(i)
    }(i)
}
```

Each iteration runs and immediately runs its cleanup. No accumulation.

---

## Optimization 3 — recover boundary in a hot inner function

```go
func parseToken() Token {
    defer func() {
        recover()
    }()
    // very tight, called millions of times
    return tokenFrom(...)
}
```

**Problem:** Even if no panic occurs, registering a defer with a closure for `recover` adds cost on every call. For a million calls per second, this is measurable.

**Better:** put the recover at the *outer* boundary (e.g., once per request), and let inner functions panic freely. The boundary catches all of them.

```go
// Hot inner function: no defer
func parseToken() Token { return tokenFrom(...) }

// Outer boundary: one defer per request
func handleRequest(...) (err error) {
    defer func() {
        if r := recover(); r != nil { err = fmt.Errorf("%v", r) }
    }()
    parseToken() // may panic; caught above
    return nil
}
```

---

## Optimization 4 — capturing stack on every error

```go
func wrap(err error) error {
    return fmt.Errorf("wrapping: %w (stack=%s)", err, debug.Stack())
}
```

**Problem:** `debug.Stack()` is ~10 µs and allocates a `[]byte`. For high-rate paths, this dominates.

**Better:** capture stack only on actual panics, not on every error wrap. Errors do not need stacks; they are values, not anomalies. If you must capture, use `runtime.Callers` once at the original site:

```go
func origin(err error) error {
    var pcs [10]uintptr
    n := runtime.Callers(2, pcs[:])
    return &stackErr{cause: err, pcs: pcs[:n]}
}
```

---

## Optimization 5 — repeated `runtime/debug.Stack()` calls

```go
defer func() {
    if r := recover(); r != nil {
        log.Print(r, debug.Stack())
        metrics.Add("panic", debug.Stack()) // BUG: 2nd call is shorter or different stack
        sentry.Send(r, debug.Stack())
    }
}()
```

**Problem:** `debug.Stack()` is called three times. Each call walks the stack independently. The second and third calls also have different stack contents (because they are now nested deeper inside the recover code).

**Better:** capture once, reuse:
```go
defer func() {
    if r := recover(); r != nil {
        stack := debug.Stack()
        log.Print(r, string(stack))
        metrics.Add("panic", string(stack))
        sentry.Send(r, stack)
    }
}()
```

---

## Optimization 6 — open-coded defer disabled by complex usage

```go
func F() error {
    defer cleanup1()
    defer cleanup2()
    defer cleanup3()
    defer cleanup4()
    defer cleanup5()
    defer cleanup6()
    defer cleanup7()
    defer cleanup8()
    defer cleanup9() // 9th defer
    return doWork()
}
```

**Problem:** Open-coded defers (Go 1.14+) only apply to functions with at most 8 unconditional defers. The 9th forces all defers to fall back to heap-allocated runtime defers, increasing cost from ~2 ns to ~50 ns per defer.

**Better:** group cleanup into a helper:
```go
type cleanups struct{ /* ... */ }
func (c *cleanups) run() { /* run all */ }

func F() error {
    var c cleanups
    defer c.run() // one defer
    c.add(cleanup1)
    // ...
    return doWork()
}
```

This keeps you under the 8-defer limit.

---

## Optimization 7 — defer in a loop instead of per-iteration cleanup

```go
func processFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close() // accumulates
        readWork(f)
    }
    return nil
}
```

**Problem:** Defers stack up; files stay open until the function returns. With thousands of paths you exhaust file descriptors. Also defer registration cost per iteration.

**Better:**
```go
for _, p := range paths {
    if err := processOne(p); err != nil { return err }
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    readWork(f)
    return nil
}
```

Each iteration's defer fires immediately at the end of `processOne`.

---

## Optimization 8 — needless named return for recover

```go
func F() (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%v", r)
        }
    }()
    result = compute()
    return
}
```

**Problem:** Named returns can prevent some compiler optimizations because the returns must live in the stack frame more conservatively. If the function does not benefit from named returns elsewhere, this is overhead for no gain.

**Better:** use named returns *only* where the deferred recover writes to them; otherwise stick to anonymous returns. In this specific case, you do need a named return for `err`. But you do *not* need to name `result`:

Wait — Go requires either all named or none. So if you must name `err`, you must name `result`. The mitigation: keep functions with this pattern small, or move the recover to a wrapper:

```go
func F() (int, error) {
    return safeCompute(compute)
}

func safeCompute(fn func() int) (n int, err error) {
    defer func() {
        if r := recover(); r != nil { err = fmt.Errorf("%v", r) }
    }()
    return fn(), nil
}
```

Named returns are now isolated to a tiny helper.

---

## Optimization 9 — formatting recover values eagerly

```go
defer func() {
    msg := fmt.Sprintf("recovered with: %+v\n%s", recover(), debug.Stack())
    if msg != "" {
        log.Print(msg)
    }
}()
```

**Problem:** `fmt.Sprintf` runs *every* time the function exits, even on the success path (because `recover()` returns nil). The `debug.Stack()` cost is paid on every call. The check `if msg != ""` does not help — `fmt.Sprintf` always returns non-empty for this format.

**Better:** check first, format only on panic:
```go
defer func() {
    r := recover()
    if r == nil { return }
    log.Printf("recovered: %v\n%s", r, debug.Stack())
}()
```

The `r == nil` early return skips all the work on the happy path.

---

## Optimization 10 — using panic in tests instead of t.Fatal

```go
func TestThing(t *testing.T) {
    if !condition {
        panic("test failed")
    }
}
```

**Problem:** Panic in tests crashes the test binary and (depending on test runner) may abort sibling tests. Other test infrastructure (cleanup hooks, parallel test coordination) does not run.

**Better:**
```go
if !condition {
    t.Fatal("test failed")
}
```

`t.Fatal` is integrated with the testing framework: marks the test failed, runs cleanups, signals other tests safely.

---

## Optimization 11 — recover allocating a closure

```go
go func() {
    defer func() { recover() }()
    work()
}()
```

**Problem:** The deferred anonymous function captures nothing here, so it should be free. But if you accidentally capture variables (closure), the runtime must allocate the closure on the heap.

```go
go func() {
    n := 1
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic at iter %d: %v", n, r) // captures n
        }
    }()
    work()
}()
```

The captured `n` forces a heap allocation per goroutine.

**Better:** if you do not need to capture, do not. If you must, weigh the cost (per-goroutine, paid at startup) against the benefit (better diagnostics on panic).

---

## Optimization 12 — panic-driven parser

```go
func parse(s string) (out Tree) {
    defer func() {
        if r := recover(); r != nil {
            out = Tree{Err: r.(error)}
        }
    }()
    return parseInternal(s) // panics on syntax errors
}
```

**Problem:** "Convenient" panic-style parsers are a known anti-pattern. Each syntax error in user input incurs the full panic+recover cost (~500 ns). For a parser called millions of times on malformed input, this is dominant.

**Better:** return errors normally:
```go
func parse(s string) (Tree, error) {
    return parseInternal(s)
}

func parseInternal(s string) (Tree, error) {
    // explicit error returns at every step
}
```

Slightly more verbose; orders of magnitude faster on the error path.

---

## Optimization 13 — defer for trivial cleanup

```go
func write(b []byte) error {
    f, err := os.Create("/tmp/x")
    if err != nil { return err }
    defer f.Close()
    _, err = f.Write(b)
    return err
}
```

**Problem:** None — this is the *correct* idiom. But sometimes engineers try to remove the defer "for performance":

```go
func write(b []byte) error {
    f, err := os.Create("/tmp/x")
    if err != nil { return err }
    _, err = f.Write(b)
    f.Close()
    return err
}
```

This *appears* faster but loses cleanup on panic. If `f.Write` panics (it shouldn't, but in a hostile environment...), the file is not closed. Worse: if open-coded defer applies, the deferred form is essentially the same speed.

**Conclusion:** keep the defer. Do not micro-optimize at the cost of correctness.

---

## Optimization 14 — using log.Panic instead of panic

```go
if invalidConfig {
    log.Panic("invalid config")
}
```

**Problem:** `log.Panic` calls `panic`, but it also formats and logs first. The logging adds cost on the panic path. If you also have a recover that logs, you log twice.

**Better:** if you want logging, log explicitly before panicking. If you want a clean panic, just `panic`:
```go
log.Print("invalid config")
panic("invalid config")
```

Or even better, don't panic at all — return an error and let the caller decide.

---

## Optimization 15 — multiple recovers in nested calls

```go
func outer() {
    defer func() { recover() }() // catch any
    middle()
}

func middle() {
    defer func() { recover() }() // catch any
    inner()
}

func inner() {
    defer func() { recover() }() // catch any
    riskyWork()
}
```

**Problem:** Three defers, three recovers. Each function call pays the defer cost. The innermost recover catches first, so the outer two never see a panic — pure overhead.

**Better:** one recover at the outermost boundary that needs it. Inner functions stay clean:
```go
func outer() {
    defer func() { recover() }()
    middle()
}

func middle() { inner() }  // no defer

func inner() { riskyWork() }  // no defer
```

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkPanicRecover(b *testing.B) {
    for i := 0; i < b.N; i++ {
        func() {
            defer func() { recover() }()
            panic("x")
        }()
    }
}

func BenchmarkNormalReturn(b *testing.B) {
    for i := 0; i < b.N; i++ {
        if err := returnErr(); err != nil { _ = err }
    }
}
```

```bash
go test -bench=. -benchmem
```

Typical numbers:
- `BenchmarkNormalReturn`: ~1 ns/op, 0 allocs.
- `BenchmarkPanicRecover`: ~500 ns/op, 1-2 allocs.

The 500x ratio is your reminder that panic is *not* free.

For allocation analysis:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

---

## When NOT to Optimize

- **One panic per request** — at typical request rates, the cost is invisible. Do not micro-optimize this.
- **MustX in initialization code** — runs once at startup. Cost does not matter.
- **Test helpers using panic** — clarity over speed in tests.
- **CLI tools** — startup dominates everything.

When in doubt: measure. Premature optimization of panic paths is a common source of unreadable code with no measurable benefit.

---

## Summary

The fast path of panic is "no panic happened" — and that is already free in Go: defers may be open-coded into nearly nothing. The slow paths are panic+recover (orders of magnitude slower than a normal return), defers in tight loops, and recover stacks that catch everything. Use panic and recover at boundaries where the cost is amortized over an entire request or task. Profile before tuning. Keep code readable for the 99.9% case where nothing panics.
