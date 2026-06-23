# Stack Traces & Debugging — Optimization

> Each entry shows slow or wasteful stack-tracing/debugging code, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `debug.Stack()` per error

```go
func wrap(err error) error {
    return fmt.Errorf("op: %w\nstack: %s", err, debug.Stack())
}
```

**Problem:** `debug.Stack()` walks and formats the stack; ~5-10 µs per call and several allocations. Inside a wrap helper called many times per request, the cost adds up fast.

**Better:** capture cheap PCs at origin only. Symbolize when the trace is actually printed.
```go
type withStack struct {
    err error
    pcs []uintptr
}

func wrap(err error) error {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &withStack{err: err, pcs: pcs[:n]}
}
```

Capture cost: ~150 ns vs ~5 µs.

---

## Optimization 2 — Heap-allocated PC slice

```go
func capture() []uintptr {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return pcs[:n]
}
```

**Problem:** The `make([]uintptr, 32)` allocates on the heap because the slice escapes via the return.

**Better:** pass a stack-allocated array:
```go
type Snap struct {
    pcs [32]uintptr
    n   int
}

func (s *Snap) Capture() {
    s.n = runtime.Callers(2, s.pcs[:])
}
```

The `[32]uintptr` lives inside the struct; if `*Snap` is itself stack-allocated (small lifetime), the whole capture is allocation-free.

Verify with `go test -benchmem`.

---

## Optimization 3 — Symbolizing every captured stack eagerly

```go
type stackErr struct {
    msg    string
    frames []runtime.Frame  // resolved at construction
}

func New(msg string) error {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    fs := runtime.CallersFrames(pcs[:n])
    var frames []runtime.Frame
    for {
        f, more := fs.Next()
        frames = append(frames, f)
        if !more { break }
    }
    return &stackErr{msg: msg, frames: frames}
}
```

**Problem:** Resolution allocates strings (`Function`, `File`) per frame. If 95% of errors are silently handled, those strings are wasted.

**Better:** store PCs, resolve only when a consumer asks:
```go
type stackErr struct {
    msg string
    pcs []uintptr
}

func (e *stackErr) Frames() []runtime.Frame { /* resolve here, lazily */ }
```

---

## Optimization 4 — Calling `runtime.Caller` repeatedly

```go
for i := 0; i < depth; i++ {
    pc, file, line, ok := runtime.Caller(i)
    if !ok { break }
    // ...
}
```

**Problem:** `runtime.Caller(i)` walks the stack from the top *each call*. The total work is O(depth²).

**Better:** one call to `runtime.Callers`:
```go
pcs := make([]uintptr, depth)
n := runtime.Callers(0, pcs)
// O(depth) total
```

---

## Optimization 5 — `runtime.Stack(_, true)` in a loop

```go
go func() {
    for {
        time.Sleep(100 * time.Millisecond)
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        ship(buf[:n])
    }
}()
```

**Problem:** Full goroutine dumps cost tens of µs to ms each, depending on goroutine count. Ten dumps per second can consume measurable CPU on a busy service.

**Better:** dump on demand, or sample rarely. Use `pprof.Lookup("goroutine").WriteTo(w, 1)` for a *deduplicated* dump that is much smaller and faster:
```go
pprof.Lookup("goroutine").WriteTo(file, 1)  // dedup'd by stack hash
```

Reserve `runtime.Stack(_, true)` for "we are stuck and need to look".

---

## Optimization 6 — Block/mutex profile rate of 1

```go
runtime.SetBlockProfileRate(1)
runtime.SetMutexProfileFraction(1)
```

**Problem:** Sampling every event captures all blocking and contention — possibly thousands per second per CPU. Significant runtime overhead.

**Better:** sample sparsely:
```go
runtime.SetBlockProfileRate(1000)        // ~once per µs of blocking
runtime.SetMutexProfileFraction(1000)    // 1/1000 contentions
```

`1` is for active investigation only.

---

## Optimization 7 — Logging the same stack at every layer

```go
if err := step(); err != nil {
    log.Printf("step failed\n%s", debug.Stack())
    return err
}
// ... caller does the same thing ...
```

**Problem:** Each layer logs the same trace. Logs swell, log infrastructure pays, operators learn to ignore stacks.

**Better:** log once, at the boundary (top-level handler / worker recovery). Internal layers wrap the error with context but do not capture or print stacks.

---

## Optimization 8 — `runtime/debug.Stack` in tests for assertion lines

```go
func assertEqual(t *testing.T, got, want int) {
    if got != want {
        t.Errorf("got %d want %d\n%s", got, want, debug.Stack())
    }
}
```

**Problem:** `debug.Stack()` allocates and formats the entire test stack. For thousand-iteration property tests this burns time.

**Better:** use `t.Helper()` so the test framework reports the *caller's* line for free, no stack formatting required:
```go
func assertEqual(t *testing.T, got, want int) {
    t.Helper()
    if got != want {
        t.Errorf("got %d want %d", got, want)
    }
}
```

---

## Optimization 9 — Capturing stacks inside library code

```go
// inside an internal validator called per-token
func mustValidate(s string) {
    if !valid(s) {
        log.Printf("invalid token at %s", debug.Stack())
        return
    }
}
```

**Problem:** A library called millions of times per request capturing stacks every failure is a CPU hog.

**Better:** library returns errors with *kind* and *position*; the boundary captures one stack if any error occurred. Push the diagnostic decoration to where it is paid for once.

---

## Optimization 10 — Building a flame graph with too-fine sampling

```bash
go tool pprof http://prod:6060/debug/pprof/profile?seconds=300
```

**Problem:** A 5-minute CPU profile of a busy service produces a huge protobuf. Loading it can be slow; analysis tools may struggle.

**Better:** start with 30 seconds. Increase only if needed.
```bash
go tool pprof http://prod:6060/debug/pprof/profile?seconds=30
```

For periodic monitoring, even shorter intervals (10 s) are usually enough.

---

## Optimization 11 — Storing full backtraces in metrics

```go
metrics.Counter("errors", attribute.String("stack", string(debug.Stack()))).Inc()
```

**Problem:** Most metric backends index labels; using the entire stack as a label produces millions of unique series. Cardinality explosion crashes Prometheus, kills Datadog cost.

**Better:** label the metric by `kind` or `op` only. Stacks belong in logs/traces, not in metric labels.
```go
metrics.Counter("errors", attribute.String("kind", k)).Inc()
```

---

## Optimization 12 — `runtime.NumGoroutine` polled every millisecond

```go
go func() {
    for {
        n := runtime.NumGoroutine()
        gauge.Set(float64(n))
        time.Sleep(time.Millisecond)
    }
}()
```

**Problem:** `runtime.NumGoroutine()` is cheap *but* a 1ms poll is overkill — the metric becomes noise.

**Better:** poll at the rate your scrape interval cares about (commonly 5-15 s). Save CPU and reduce metric churn.
```go
time.Sleep(10 * time.Second)
```

---

## Optimization 13 — Allocating a goroutine-dump buffer per call

```go
func dump() string {
    buf := make([]byte, 1<<20)  // 1 MB allocated each call
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

**Problem:** A 1 MB allocation for each dump. For an endpoint that gets hit by monitoring it adds GC pressure.

**Better:** use a `sync.Pool`:
```go
var dumpPool = sync.Pool{
    New: func() any { b := make([]byte, 1<<20); return &b },
}

func dump() string {
    bp := dumpPool.Get().(*[]byte)
    defer dumpPool.Put(bp)
    n := runtime.Stack(*bp, true)
    return string((*bp)[:n])
}
```

---

## Optimization 14 — `cockroachdb/errors` everywhere when you do not need stacks

```go
import "github.com/cockroachdb/errors"

return errors.WithStack(err)
```

**Problem:** Every `WithStack` captures a fresh stack trace. A service that wraps errors at every layer accumulates many stacks per error.

**Better:** capture once, at origin. Use `errors.Wrap` (which does not necessarily re-capture) for layered context. For most services, the standard library plus a single `recover` middleware is enough — no third-party dependency needed.

---

## Optimization 15 — Logging stacks as multiline strings in JSON logs

```go
slog.Error("error", "stack", string(debug.Stack()))
```

**Problem:** Multiline strings in JSON logs blow up storage. Many log backends store them inefficiently and search slowly.

**Better:** transmit stack as a structured field with newlines escaped, or post-process the trace into a fingerprint hash + sample. Pyroscope-style sampling stores stacks once and references them by hash from logs.

For routine production use:
```go
slog.Error("error",
    "stack_hash", hash(stack),
    "stack_sample", firstNFrames(stack, 5),
)
```

Full stack only when explicitly requested.

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkCallers(b *testing.B) {
    var pcs [32]uintptr
    for i := 0; i < b.N; i++ {
        _ = runtime.Callers(2, pcs[:])
    }
}

func BenchmarkDebugStack(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = debug.Stack()
    }
}
```

```bash
go test -bench=. -benchmem
```

Expected output (modern x86-64, Go 1.21):
```
BenchmarkCallers     8000000   ~150 ns/op   0 B/op   0 allocs/op
BenchmarkDebugStack   200000  ~6500 ns/op 1024 B/op  3 allocs/op
```

40x ratio between cheap PC capture and full text formatting. Plan budgets accordingly.

For allocation profiling:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

---

## When NOT to Optimize

- **Cold-path errors** (1 per minute) — clarity wins, allocations do not matter.
- **Top-level recovery middleware** — a panic should be loud and detailed.
- **Debug builds / tests** — keep the diagnostic value, not the speed.
- **Manual investigation tools** — operators want full traces.

The pattern: optimize only what is *both* hot and dominant in the profile. A 10 µs `debug.Stack` called once per HTTP request out of 50 ms total processing is invisible.

---

## Summary

The fast path of stack work in Go is `runtime.Callers` with a stack-allocated buffer — sub-microsecond and allocation-free. The expensive path is symbolization (`CallersFrames`) and full text formatting (`debug.Stack`). Optimize by capturing cheap PCs at origin, deferring symbolization until needed, and logging stacks once at the boundary. For high-volume systems, watch out for goroutine-dump cost, block-profile rates, and metric label cardinality. Measure before tuning, and remember that for most services error rates are too low for any of this to matter.
