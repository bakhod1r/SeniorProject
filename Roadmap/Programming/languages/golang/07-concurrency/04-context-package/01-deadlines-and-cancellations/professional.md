# Deadlines and Cancellations — Professional

[← Back to index](junior.md)

## When Context Is the Bottleneck

You've written a service. It does 200k requests/second. The profile shows `context.WithTimeout` at the top of the alloc graph. What now?

This document is the cookbook for that level of scrutiny: the allocation accounting, the structural choices that minimise it, the rare but real cases where you customise the `Context` interface, the mature use of `AfterFunc` for cleanup, and the disciplined use of `WithoutCancel` to decouple lifetimes.

## Allocation Accounting

Each call traces back to a small set of allocations:

| Constructor                     | Allocations |
|---------------------------------|-------------|
| `Background()` / `TODO()`       | none — pre-existing globals |
| `WithCancel(parent)`            | 1 × `cancelCtx`, lazy `done` chan |
| `WithDeadline(parent, t)`       | 1 × `timerCtx`, 1 × `time.Timer`, lazy `done` chan |
| `WithTimeout(parent, d)`        | same as `WithDeadline` |
| `WithValue(parent, k, v)`       | 1 × `valueCtx` (small struct) |
| `WithCancelCause(parent)`       | same as `WithCancel` |
| `WithoutCancel(parent)`         | 1 × `withoutCancelCtx` |
| `AfterFunc(parent, f)`          | 1 × node + closure |

Every layer adds an allocation. A request that derives 6 contexts pays 6 allocations + however many timers. At 200k req/s that is over 1M allocations/second from contexts alone.

### Measuring Real Cost

Set up a benchmark in your service repo:

```go
func BenchmarkContextChain(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        ctx := context.Background()
        ctx, c1 := context.WithTimeout(ctx, time.Second)
        ctx, c2 := context.WithCancel(ctx)
        ctx = context.WithValue(ctx, traceKey{}, "abc")
        c2()
        c1()
        _ = ctx
    }
}
```

Run with `-benchmem`:

```
BenchmarkContextChain-8   3500000   325 ns/op   192 B/op   4 allocs/op
```

Four allocations per chain, 192 B. For a high-QPS service, treat that as a budget.

## Reducing Allocations

### 1. Build the chain once, reuse downstream

If three sub-calls all need the same deadline, derive once:

```go
// BAD — three timers, three timerCtx allocations
func handle(ctx context.Context) {
    a, _ := context.WithTimeout(ctx, 200*time.Millisecond); defer a.Done()
    b, _ := context.WithTimeout(ctx, 200*time.Millisecond); defer b.Done()
    c, _ := context.WithTimeout(ctx, 200*time.Millisecond); defer c.Done()
    callA(a); callB(b); callC(c)
}

// GOOD — one timer, three sub-calls share it
func handle(ctx context.Context) {
    ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    callA(ctx); callB(ctx); callC(ctx)
}
```

When *should* you derive separately? When the calls have **different individual** deadlines (e.g. a fast cache lookup + a slow upstream).

### 2. Avoid WithValue in hot paths

Every `WithValue` is one allocation. Lookups are linear in chain depth. If you find yourself adding 6 values on the request path, consolidate:

```go
type RequestData struct {
    TraceID  string
    UserID   int64
    TenantID string
}

type reqDataKey struct{}

func WithRequestData(ctx context.Context, d RequestData) context.Context {
    return context.WithValue(ctx, reqDataKey{}, d)
}

func RequestDataFrom(ctx context.Context) (RequestData, bool) {
    d, ok := ctx.Value(reqDataKey{}).(RequestData)
    return d, ok
}
```

One allocation, one lookup. Adding fields later does not multiply cost.

### 3. Reuse contexts across requests where safe

For long-lived background tasks, derive **once** at startup, share among all goroutines:

```go
type Server struct {
    rootCtx    context.Context
    rootCancel context.CancelFunc
    // ...
}

func (s *Server) Start() {
    s.rootCtx, s.rootCancel = context.WithCancel(context.Background())
    for i := 0; i < s.workers; i++ {
        go s.worker(s.rootCtx, i)
    }
}
```

Per-request contexts still derive from the request, but the **server-level cancel** lives one allocation per process.

### 4. Use sync.Pool for request-data structs

If the request-data struct is large, pool it:

```go
var reqDataPool = sync.Pool{New: func() any { return &RequestData{} }}

func handler(w http.ResponseWriter, r *http.Request) {
    d := reqDataPool.Get().(*RequestData)
    defer func() { *d = RequestData{}; reqDataPool.Put(d) }()
    // populate d
    ctx := context.WithValue(r.Context(), reqDataKey{}, d)
    // ...
}
```

Trade-off: pointer in the context value means consumers must handle a possibly-stale or zero value. Worth it only when allocation profiles warrant it.

## Custom Context Implementations

Writing your own `Context` is rare but legitimate when:

1. You want **typed accessors** instead of `interface{}` lookup.
2. You want to **avoid the slow path** of `propagateCancel` for derived cancelables (i.e. you implement `cancelCtx`-compatible internals).
3. You're building a **framework** that wraps every request with a domain-specific context type.

### Pattern: Typed Wrapper Forwarding to Embedded Context

```go
type RequestCtx struct {
    context.Context
    UserID  int64
    Tenant  string
    TraceID string
}

func (r *RequestCtx) Value(k any) any {
    switch k.(type) {
    case userIDKey:  return r.UserID
    case tenantKey:  return r.Tenant
    case traceIDKey: return r.TraceID
    }
    return r.Context.Value(k)
}

func WrapRequest(ctx context.Context, uid int64, tenant, trace string) *RequestCtx {
    return &RequestCtx{
        Context: ctx,
        UserID:  uid,
        Tenant:  tenant,
        TraceID: trace,
    }
}
```

Three values for one allocation. Lookups are O(1) for the typed keys, falling back to `Value` for foreign keys.

Limitations:

- The custom type still satisfies `context.Context` so it flows naturally.
- `propagateCancel` from a derived cancelable child takes the **slow path**: an extra goroutine. If you derive cancelables off the wrapper inside hot loops, that goroutine is a real cost.

### Pattern: Embedding for cancelCtx Compatibility

You cannot easily satisfy the `cancelCtx` fast path from outside the standard library — the relevant types are unexported. The compiler cannot tell that your custom type "is" a `cancelCtx`. The slow-path goroutine is the price of custom contexts that you derive `WithCancel` from.

The mitigation: **wrap as late as possible**. Build all your `WithCancel`/`WithTimeout` first, then wrap with your custom value-only context once.

```go
ctx := context.Background()
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
ctx = WrapRequest(ctx, uid, tenant, trace) // value-only wrapper
```

Now further `WithCancel(ctx)` calls climb up to the `timerCtx`, recognise it, and take the fast path.

## AfterFunc Patterns

`AfterFunc(ctx, f)` registers `f` to run when `ctx` is canceled. The pattern is "callback on cancel". Compared to `<-ctx.Done()` selectors:

| `<-ctx.Done()` selector            | `AfterFunc`                          |
|------------------------------------|--------------------------------------|
| Always-running goroutine           | Goroutine spawned only on cancel     |
| Costs ~2 KB stack while idle       | Zero stack while idle                |
| Composes with other cases          | One callback only                    |
| Easy to express timeouts           | Best for cleanup hooks               |

### Pattern: Bounded Lease with AfterFunc Release

```go
type Lease struct {
    id      string
    release func()
}

func Acquire(ctx context.Context, id string) (*Lease, error) {
    if err := remoteLockAcquire(ctx, id); err != nil {
        return nil, err
    }

    l := &Lease{id: id}
    stop := context.AfterFunc(ctx, func() {
        remoteLockRelease(context.Background(), id)
    })
    l.release = func() {
        if stop() {
            // We canceled the AfterFunc before it ran; release ourselves.
            remoteLockRelease(context.Background(), id)
        }
    }
    return l, nil
}

func (l *Lease) Release() { l.release() }
```

Properties:

- If the user calls `Release` while `ctx` is still alive, `stop()` returns true, the AfterFunc never runs, we release synchronously.
- If `ctx` is canceled first, the AfterFunc runs the release on its own goroutine. The user's `Release()` finds `stop()` returns false (already running) and does nothing.

This is the right shape for **resource handles** that must be freed once and only once, regardless of who notices the cancellation first.

### Pattern: Watchdog Timer

```go
func StartWatchdog(ctx context.Context, log *log.Logger) func() {
    deadline, ok := ctx.Deadline()
    if !ok {
        return func() {}
    }
    warn := deadline.Add(-100 * time.Millisecond)
    if !warn.After(time.Now()) {
        return func() {}
    }
    timer := time.AfterFunc(time.Until(warn), func() {
        log.Printf("warning: 100ms before deadline still in handler")
    })
    return func() { timer.Stop() }
}
```

Logs a warning when 100 ms remain, helping you spot near-timeout cases in production.

## WithoutCancel — Decoupling Patterns

`WithoutCancel` strips cancellation while preserving values. The right use cases:

### Pattern: Detached Audit Log

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    if err := serve(ctx, w); err != nil {
        respondError(w, err)
    }
    // Audit must complete even if request was cancelled.
    auditCtx := context.WithoutCancel(ctx)
    auditCtx, cancel := context.WithTimeout(auditCtx, 5*time.Second)
    go func() {
        defer cancel()
        if err := audit.Send(auditCtx, r); err != nil {
            log.Printf("audit failed: %v", err)
        }
    }()
}
```

We took the values (trace ID, user ID) but not the request's lifetime; we re-attached our own 5s deadline.

### Pattern: Outbound on Shutdown

A graceful shutdown handler kicks off "drain" tasks that need to outlive the parent context:

```go
func shutdown(rootCtx context.Context) {
    rootCtx.Done() // wait for top-level cancel

    drainCtx := context.WithoutCancel(rootCtx)
    drainCtx, cancel := context.WithTimeout(drainCtx, 30*time.Second)
    defer cancel()

    if err := flushQueue(drainCtx); err != nil {
        log.Printf("drain failed: %v", err)
    }
}
```

### Anti-pattern: WithoutCancel Inside the Hot Path

Do not sprinkle `WithoutCancel` to "make code work" without understanding why a cancellation arrived. If a cancel is bubbling up that you did not expect, the fix is to **understand the cancel source**, not silence it.

## Distinguishing Cancellation Causes in Production

In a microservice, every "context canceled" log line carries no information about who canceled. The recipe:

```go
type cancelReason struct {
    reason string
    when   time.Time
}

func startRequestSpan(ctx context.Context, r *http.Request) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancelCause(ctx)
    context.AfterFunc(ctx, func() {
        if c := context.Cause(ctx); c != nil && !errors.Is(c, context.Canceled) {
            metrics.Increment("requests.canceled", "reason", classify(c))
        }
    })
    return ctx, func() { cancel(errors.New("server: handler returned")) }
}
```

When upstream cancellation arrives, `Cause` carries the upstream's error; we classify and report it. When we cancel ourselves, we tag the cause. Logs become diagnostic instead of noise.

## Slow Goroutine Forwarders

Recall: when a derived cancelable's parent is **not** a recognised internal type, `propagateCancel` spawns a forwarder goroutine. Three places this bites you:

1. **Custom Context implementations** — see above, mitigate by wrapping late.
2. **Mock contexts in tests** — fine in tests, just be aware.
3. **`reflect`-based middleware that hides the underlying cancelCtx** — rare, but I've seen it.

You can detect the slow path by counting goroutines in a benchmark:

```go
func BenchmarkDerive(b *testing.B) {
    base := myCustomContext()
    runtime.GC()
    pre := runtime.NumGoroutine()
    var cs []context.CancelFunc
    for i := 0; i < b.N; i++ {
        _, c := context.WithCancel(base)
        cs = append(cs, c)
    }
    fmt.Println("extra goroutines:", runtime.NumGoroutine()-pre)
    for _, c := range cs { c() }
}
```

If `extra goroutines` is roughly `b.N`, you are on the slow path.

## Cancellation Across Process Boundaries

A subtle production case: an HTTP server canceled by the client. The Go server's `r.Context()` is canceled when the client closes the connection. **But** by default the server still finishes writing the response — and it has up to `WriteTimeout` to do so.

For HTTP/2, multiple streams share a connection; one stream's cancel does not cancel siblings. The runtime handles this; you do not need to.

For gRPC, **deadlines propagate over the wire** as gRPC-Timeout headers. A context with `Deadline = now + 200ms` becomes "200m" on the wire; the server starts its own context with that deadline. If the call traverses three services, each peels off some milliseconds; the final service may end up with a 50 ms budget.

Lesson: when calling RPCs from a request handler, **derive a sub-deadline that accounts for network round-trip**. A common rule of thumb: subtract 50 ms from each hop.

## Gracefully Shutting Down a Server

A robust HTTP server with context-driven shutdown:

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    rootCtx, stop := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer stop()

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           buildMux(),
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       2 * time.Minute,
    }

    // Server runs in its own goroutine.
    serverErr := make(chan error, 1)
    go func() { serverErr <- srv.ListenAndServe() }()

    select {
    case <-rootCtx.Done():
        log.Println("shutdown signal received")
    case err := <-serverErr:
        if !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("server crashed: %v", err)
        }
    }

    shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutCtx); err != nil {
        log.Printf("graceful shutdown failed: %v", err)
    }
}
```

Patterns to notice:

- `signal.NotifyContext` (Go 1.16+) is the modern way to bind SIGINT to a context cancel. No `chan os.Signal` boilerplate.
- The shutdown context is **derived from `Background`**, not from `rootCtx`. We just received cancel from rootCtx; deriving from it would cancel `Shutdown` immediately.
- Read/Write timeouts limit per-connection lifetime independently of context.

## errgroup — The Standard Composition

`golang.org/x/sync/errgroup` is the standard concurrency primitive built on context. The common pattern:

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)

for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

The `errgroup.WithContext` derived ctx is canceled the **first** time any goroutine returns a non-nil error. All other goroutines see `ctx.Done()` immediately.

`SetLimit` bounds concurrency without a separate semaphore. Useful for fan-out where each task is expensive (a DB query, a file read).

For cause-tracking variants, `errgroup.WithContextCause` (Go 1.21+) propagates the first error as `Cause`.

## Pattern: Pre-emptive Deadline Splitting

Suppose your handler must call three downstream services in sequence within 1 second. Each call gets a third? Not quite — the first call's success informs whether the next runs at all. A better strategy:

```go
func three(ctx context.Context) error {
    deadline, ok := ctx.Deadline()
    if !ok {
        return errors.New("missing deadline")
    }

    // Reserve 50ms for ourselves at the end.
    budget := time.Until(deadline) - 50*time.Millisecond

    // First call: 30% of budget.
    a, cancelA := context.WithTimeout(ctx, time.Duration(float64(budget)*0.3))
    if _, err := callA(a); err != nil { cancelA(); return err }
    cancelA()

    // Second call: 30%.
    b, cancelB := context.WithTimeout(ctx, time.Duration(float64(budget)*0.3))
    if _, err := callB(b); err != nil { cancelB(); return err }
    cancelB()

    // Third call: whatever remains.
    return callC(ctx)
}
```

Why split? Because if call A is slow, C still gets a fair share. If A is fast, C gets *more* than its fair share — and that's fine because the parent deadline still bounds it.

## When the Standard Library Surprises You

A few real-world gotchas, all from production:

### http.Server.Shutdown Does Not Cancel Active Requests

`Shutdown` waits for in-flight requests to finish. It does **not** cancel their contexts. To force them, you have to also cancel the server's `BaseContext`:

```go
baseCtx, baseCancel := context.WithCancel(context.Background())
srv := &http.Server{
    BaseContext: func(net.Listener) context.Context { return baseCtx },
}
// On hard shutdown:
baseCancel()
srv.Shutdown(timeoutCtx)
```

### sql.DB Pool May Outlive Its Context

`db.QueryContext(ctx, ...)` cancels the in-flight query when ctx fires, but the connection it occupied returns to the pool. If the database server doesn't honor `KILL QUERY` quickly, the connection sits idle in your pool, occasionally returning a stale "connection: lost" on next use. Mitigate with `db.SetConnMaxLifetime`.

### io.Copy Is Not Cancellable

`io.Copy(dst, src)` does not take a context. To make it cancellable wrap the reader:

```go
type ctxReader struct {
    ctx context.Context
    r   io.Reader
}
func (cr *ctxReader) Read(p []byte) (int, error) {
    if err := cr.ctx.Err(); err != nil {
        return 0, err
    }
    return cr.r.Read(p)
}
```

This checks before each read. For cancellation **mid-read**, you need a Reader that supports it natively (like `*net.Conn`).

## A Production Checklist

Before declaring a service "context-clean":

- [ ] Every public function accepting context puts it first, named `ctx`.
- [ ] Every `WithCancel`/`WithTimeout`/`WithDeadline` has a `defer cancel()`.
- [ ] No `time.Sleep` in a context-aware loop; only `time.NewTimer`/`time.NewTicker`.
- [ ] No context stored in a struct; only cancel funcs.
- [ ] Hot paths use **one** context derivation, not several.
- [ ] `WithValue` keys are unexported types; values are typed structs.
- [ ] Server has `signal.NotifyContext` shutdown.
- [ ] `srv.Shutdown` uses a context derived from `Background()`, not from the canceled root.
- [ ] DB and HTTP calls take the request's context.
- [ ] Long-running detached jobs use `WithoutCancel` (Go 1.21+).
- [ ] Cancellation reasons are reported with `WithCancelCause`/`Cause`.
- [ ] `go vet ./...` clean.
- [ ] Race detector run in CI.

## Mental Model At This Level

Production context usage is about **lifetime accounting**: every operation belongs to exactly one context tree, every tree has a clear root, every root has a clear shutdown path. The context API is the language of lifetime. The pitfalls all stem from confusing one lifetime for another — using `Background` where you needed the request, using the request where you needed `WithoutCancel`, deriving from the wrong layer.

Beyond mechanics, the senior reviewer focuses on:

- **Lifetime accounting** as a first-class design concern.
- **Allocation budget** for every per-request context derivation.
- **Diagnostic discipline** with `WithCancelCause` so production logs name the source.
- **Boundary design** — context cancellation maps to network shutdown gracefully.

The two leaves of the context tree are still `Background` and `TODO`. From there, every choice is a deliberate piece of lifetime engineering.

Next: [specification.md](specification.md) — the formal contract of the Context interface and cancellation semantics.
