# Common Usecases — Optimize

[← Back to index](junior.md)

Each section presents a working but suboptimal use of `context.Context` and a refactor that improves performance, allocations, or maintainability. The goal is to internalize the small habits that keep ctx use cheap and readable at scale.

## Optimization 1 — Avoid `ctx.Value` On The Hot Path

### Before

```go
func process(ctx context.Context, items []Item) error {
    for _, it := range items {
        log := LoggerFrom(ctx)            // O(depth) every iteration
        rid := RequestIDFrom(ctx)         // O(depth) every iteration
        log.Info("processing", "rid", rid, "id", it.ID)
        if err := handle(ctx, it); err != nil {
            return err
        }
    }
    return nil
}
```

### Problem

Every iteration walks the ctx chain twice. With a 6-deep chain that is ~30 ns × 2 × N items. For 100 K items: 6 ms wasted on ctx lookups alone.

### After

```go
func process(ctx context.Context, items []Item) error {
    log := LoggerFrom(ctx)
    rid := RequestIDFrom(ctx)
    for _, it := range items {
        log.Info("processing", "rid", rid, "id", it.ID)
        if err := handle(ctx, it); err != nil {
            return err
        }
    }
    return nil
}
```

Hoist context-value reads out of inner loops. Cache them in locals.

---

## Optimization 2 — Single Bundled Value Beats Many Keys

### Before

```go
ctx = WithRequestID(ctx, rid)
ctx = WithUserID(ctx, uid)
ctx = WithTenantID(ctx, tid)
ctx = WithTraceID(ctx, traceID)
ctx = WithSpanID(ctx, spanID)
ctx = WithLogger(ctx, log)
```

Six allocations, six chain entries, six O(depth) lookups when you read all six.

### After

```go
type RequestInfo struct {
    RequestID, UserID, TenantID, TraceID, SpanID string
    Logger                                       *slog.Logger
}

type reqInfoKey struct{}

func WithRequestInfo(ctx context.Context, ri *RequestInfo) context.Context {
    return context.WithValue(ctx, reqInfoKey{}, ri)
}

func RequestInfoFrom(ctx context.Context) *RequestInfo {
    ri, _ := ctx.Value(reqInfoKey{}).(*RequestInfo)
    return ri
}
```

One allocation, one chain entry. Field access on the bundle is O(1). Use this when several values logically belong together.

Trade-off: any mutation of the bundle is shared. Keep the struct immutable after middleware constructs it.

---

## Optimization 3 — Deadline Budgeting Across Services

### Before

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    a, _ := callServiceA(ctx, ...)  // takes ~3s
    b, _ := callServiceB(ctx, ...)  // p99 4s, sometimes 10s
    c, _ := callServiceC(ctx, ...)  // takes 200ms
    write(w, a, b, c)
}
```

If `r.Context()` has a 5 s deadline and service B is slow, it can consume the entire budget, leaving nothing for C. Tail latency is dominated by B.

### After

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    aCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
    defer cancel()
    a, _ := callServiceA(aCtx, ...)

    bCtx, cancel2 := context.WithTimeout(ctx, 2*time.Second)
    defer cancel2()
    b, _ := callServiceB(bCtx, ...)

    cCtx, cancel3 := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel3()
    c, _ := callServiceC(cCtx, ...)

    write(w, a, b, c)
}
```

Each call has a fixed budget. Total ≤ 4 s with 1 s headroom. Service B's slow path no longer starves C.

---

## Optimization 4 — `context.AfterFunc` For Cleanup

### Before

```go
func process(ctx context.Context, conn *Conn) error {
    done := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            conn.Close()
        case <-done:
        }
    }()
    defer close(done)
    return conn.Process()
}
```

A goroutine per call plus a manual done-channel.

### After (Go 1.20+)

```go
func process(ctx context.Context, conn *Conn) error {
    stop := context.AfterFunc(ctx, func() { conn.Close() })
    defer stop()
    return conn.Process()
}
```

`AfterFunc` registers a callback that fires when ctx is done. The `stop` cancels the registration if the work finishes first. No goroutine, no done-channel. Idiomatic and lighter.

---

## Optimization 5 — One ctx Derivation Instead Of Many

### Before

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
    process(ctx, item)
    cancel()
}
```

N timers, N parent.children entries, N allocations.

### After

```go
parentCtx, cancel := context.WithTimeout(parent, 100*time.Millisecond*time.Duration(len(items)))
defer cancel()
for _, item := range items {
    if parentCtx.Err() != nil {
        break
    }
    process(parentCtx, item)
}
```

One derivation. Total budget is the sum of per-item budgets. Fewer allocations.

Trade-off: a fast item cannot make up time for a slow one — total budget is consumed regardless. Pick the strategy based on whether each item must independently honor 100 ms or whether they share a pool.

---

## Optimization 6 — Cache Parsed Context Values

### Before

```go
func deepHelper(ctx context.Context) {
    deadline, ok := ctx.Deadline()
    if ok && time.Until(deadline) < 50*time.Millisecond {
        // skip expensive work
    }
    // ...
}
```

Called in a loop, repeatedly checks `Deadline` (constant) and recomputes `time.Until`.

### After

```go
func process(ctx context.Context, items []Item) {
    deadline, hasDeadline := ctx.Deadline()
    for _, it := range items {
        if hasDeadline && time.Until(deadline) < 50*time.Millisecond {
            return
        }
        handle(ctx, it)
    }
}
```

Cache the deadline once. Compare against `time.Now()` (cheap) inside the loop.

---

## Optimization 7 — Avoid String-Keyed Context Lookups

### Before

```go
ctx = context.WithValue(ctx, "user_id", id)
v := ctx.Value("user_id")
```

String keys cause:

- Cross-package collision risk.
- String hashing on lookup (in some runtimes).
- No compile-time type safety.

### After

```go
type userIDKey struct{}
ctx = context.WithValue(ctx, userIDKey{}, id)
v, _ := ctx.Value(userIDKey{}).(string)
```

Empty-struct key is zero-size, type-unique, and pointer-compared (faster than string comparison).

---

## Optimization 8 — Batch DB Operations Sharing One Context

### Before

```go
for _, op := range ops {
    ctx2, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    db.ExecContext(ctx2, op.SQL, op.Args...)
    cancel()
}
```

Each iteration derives a new ctx for one query. Many timers, many allocations.

### After

```go
batchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

tx, err := db.BeginTx(batchCtx, nil)
if err != nil { return err }
defer tx.Rollback()

for _, op := range ops {
    if _, err := tx.ExecContext(batchCtx, op.SQL, op.Args...); err != nil {
        return err
    }
}
return tx.Commit()
```

One context covers the whole batch. One transaction guarantees atomicity. One commit at the end.

---

## Optimization 9 — Avoid Unnecessary `WithoutCancel`

### Before

```go
go func() {
    bg := context.WithoutCancel(r.Context())
    sendMetric(bg)
}()
```

`WithoutCancel` allocates a wrapper. If you do not need the values from `r.Context()`, just use `Background`.

### After

```go
go sendMetric(context.Background())
```

Saves one allocation per request. Use `WithoutCancel` only when you need the value chain (request ID, user) but not the cancellation.

---

## Optimization 10 — Reuse Cancel Function Across Retry Attempts

### Before

```go
for i := 0; i < 3; i++ {
    ctx, cancel := context.WithTimeout(parent, 1*time.Second)
    err := call(ctx)
    cancel()
    if err == nil { return nil }
}
```

3 contexts, 3 timers, 3 cancellation registrations. The total budget is implicit: `3*time.Second` plus retry backoff.

### After

```go
ctx, cancel := context.WithTimeout(parent, 3*time.Second)
defer cancel()
for i := 0; i < 3; i++ {
    err := call(ctx)
    if err == nil { return nil }
    if ctx.Err() != nil { return ctx.Err() }
    time.Sleep(backoff(i))
}
```

One context covers all attempts. Total budget is explicit. If an early attempt is fast, later attempts can take more than 1 s.

---

## Optimization 11 — Skip `r.WithContext` When Nothing Changed

### Before

```go
func passthroughMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        next.ServeHTTP(w, r.WithContext(ctx))  // pointless allocation
    })
}
```

`r.WithContext(ctx)` allocates a new request even when ctx is unchanged.

### After

```go
func passthroughMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r)
    })
}
```

If you didn't modify the context, don't rebuild the request.

---

## Optimization 12 — Avoid Defensive Type Assertions

### Before

```go
func LoggerFrom(ctx context.Context) *slog.Logger {
    v := ctx.Value(loggerKey{})
    if v == nil { return slog.Default() }
    if l, ok := v.(*slog.Logger); ok { return l }
    return slog.Default()
}
```

Two checks for the absence case.

### After

```go
func LoggerFrom(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}
```

The comma-ok form already handles `nil` cleanly: `nil.(*slog.Logger)` returns `(nil, false)`. Remove the redundant check.

---

## Optimization 13 — Avoid `context.WithCancel` When `WithoutCancel` Is Enough

### Before

```go
detached, cancel := context.WithCancel(context.Background())
go bgJob(detached)
// cancel never called; goroutine outlives main if not bounded
```

A `WithCancel` that is never canceled leaks the cancelation registration.

### After

If you really want a separate, cancellable lifetime:

```go
detached, cancel := context.WithCancel(context.Background())
defer cancel()
go bgJob(detached)
// wait or stop bgJob explicitly
```

If you want a child of the request that ignores its cancellation but inherits values, use `WithoutCancel` (no cancel needed).

---

## Optimization 14 — Profile Before Tuning

Most ctx-related performance work is invisible until proven by a profile. Use `go test -bench` and `pprof`:

```go
func BenchmarkValueLookup(b *testing.B) {
    ctx := buildDeepContext(20)  // depth 20
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = LoggerFrom(ctx)
    }
}
```

Run with `-cpuprofile=cpu.out` and inspect `runtime.(*valueCtx).Value`. If it dominates, hoist or bundle. If it's invisible, leave it alone — premature optimization in ctx code typically harms readability without measurable gain.

---

## Performance Cheat Sheet

| Concern | Cost | When to optimize |
|---------|------|------------------|
| `WithValue` allocation | one `*valueCtx` per call | Hot path with > 1000 derivations / sec |
| `Value()` lookup | O(chain depth) ≈ 5 ns × depth | Inner loops; hoist out |
| `WithCancel` / `WithTimeout` allocation | one struct + map entry + (timer for WithTimeout) | Per-request: free; per-iteration: avoid |
| `r.WithContext` | one new `*http.Request` + bookkeeping | Skip if ctx unchanged |
| `context.WithoutCancel` (1.21+) | one wrapper allocation | Not in tight loops |
| `context.AfterFunc` | one struct + registration | Cheaper than custom goroutine |

## Anti-Optimizations To Avoid

- **Pre-allocating contexts in a pool.** Contexts are immutable; "reusing" them breaks correctness.
- **Implementing your own faster Context.** The standard library's implementations are well-tuned. Custom ones almost always introduce subtle bugs.
- **Making ctx-aware functions accept a pointer (`*context.Context`).** Idiomatic Go uses values; the interface is already a pointer to data.

## Mental Model

1. **Profile first.** Most ctx code is fine.
2. **Measure with realistic workloads.** Microbenchmarks lie.
3. **Hoist constants.** Deadline, request ID, logger all read once per scope.
4. **Bundle related values.** One `*RequestInfo` beats six separate keys.
5. **Use `AfterFunc`** for cleanup instead of bespoke goroutines.
6. **Pick budgets explicitly**, not by accident.

[← Back to index](junior.md)
