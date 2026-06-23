# Common Usecases — Interview

[← Back to index](junior.md)

A graduated set of interview questions and model answers. Junior questions test recall of common APIs; senior and staff questions test taste, trade-off awareness, and the ability to reason about cross-service deadlines.

## Junior

### Q1. How do you get a `context.Context` inside an HTTP handler?

`r.Context()`. The HTTP server creates a context per request whose lifetime ends when the client disconnects, the handler returns, or `srv.Shutdown` proceeds past its grace period.

### Q2. How do you make an outbound HTTP call cancellable?

Use `http.NewRequestWithContext(ctx, method, url, body)` (Go 1.13+). The HTTP client honors `ctx.Done()`. Older code uses `req.WithContext(ctx)` after `http.NewRequest`.

### Q3. Why never use `db.Query("...")` instead of `db.QueryContext(ctx, "...")`?

Without context, the query has no deadline and ignores cancellation. A misbehaving query holds a connection until the database's own timeout fires (often 30 s+). Always use the `Context` variant in production.

### Q4. What is `context.TODO()` for?

A placeholder marker for code that should accept a real context but does not yet. Linters and reviewers can grep for it. Behaviorally identical to `context.Background()`; the difference is intent.

### Q5. What's the type-safe pattern for `WithValue` keys?

```go
type myKey struct{}
ctx = context.WithValue(ctx, myKey{}, value)
v, ok := ctx.Value(myKey{}).(MyType)
```

The empty struct type is unique to its package, zero-allocation, and impossible to construct externally.

### Q6. When should you NOT use `WithValue`?

For anything that is not request-scoped read-only metadata. Examples: configuration, database handles, HTTP clients, feature flags. Pass them as parameters or via DI.

### Q7. How do you set a per-call timeout shorter than the request's overall deadline?

```go
sub, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
defer cancel()
external.Call(sub, ...)
```

The child's deadline is the earlier of the parent's deadline and `now+800ms`.

### Q8. What does `r.WithContext(ctx)` do in middleware?

Returns a shallow-copied `*http.Request` whose `Context()` returns `ctx`. This is how middleware adds values to context — you cannot mutate `r` directly.

## Middle

### Q9. Walk me through a graceful shutdown.

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

go srv.ListenAndServe()
<-ctx.Done()  // wait for SIGTERM

shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
```

Two contexts are involved: the *signal* context cancels everything on SIGTERM; the *shutdown* context bounds how long we wait for in-flight requests to drain. They are separate so a second Ctrl-C cannot abort the drain.

### Q10. How do you propagate a deadline across an HTTP boundary?

There is no standard header. A common convention is `X-Request-Deadline` (RFC3339) or a `Grpc-Timeout`-style relative duration. Service meshes (Envoy, Istio) often inject `x-envoy-expected-rq-timeout-ms`. The receiving server reads the header, parses, and constructs a context with `context.WithDeadline`.

### Q11. How does deadline propagation work in gRPC?

gRPC encodes the remaining duration in the `grpc-timeout` HTTP/2 header automatically when you call `client.Method(ctx, req)`. The server-side handler receives a context whose deadline matches. No application code needed.

### Q12. Why is storing `context.Context` in a struct field an anti-pattern?

The Go documentation explicitly forbids it. Reasons:

1. The stored context's lifetime is decoupled from the methods that use it — usually it's whatever was passed at construction (often `Background()`), so per-request cancellation is lost.
2. It hides the dependency: callers cannot tell that a method needs a context.
3. It precludes per-request deadlines, trace IDs, etc.

The exception is rare: long-lived services that explicitly model their lifetime as a single context can store it (e.g. a background poller wrapping a `cancel` func).

### Q13. What's the difference between `http.Server.WriteTimeout` and a context deadline?

`WriteTimeout` is a socket-level timeout: if the response body has not finished writing by then, the connection is closed. It is invisible inside the handler — you cannot read it as `ctx.Deadline()`. For per-handler logic, derive your own context with `WithTimeout` or use `http.TimeoutHandler`.

### Q14. What's `t.Context()` in Go 1.24+?

A context returned by `*testing.T` that:

- Is automatically canceled when the test ends.
- Has no deadline (use `WithTimeout` if needed).
- Is unique per test or subtest.

Replaces the manual `context.WithTimeout(context.Background(), 2*time.Second)` boilerplate plus the `defer cancel()`. Cleanup is automatic.

### Q15. Why wrap getter functions around `ctx.Value`?

To centralize the type assertion, key, and default behavior. Callers do `userID, ok := UserIDFrom(ctx)` instead of `userID, ok := ctx.Value(userIDKey{}).(string)`. The package owning the key has the only assertion site, which is auditable for correctness.

## Senior

### Q16. You're calling three downstream services from one handler. How do you budget the deadline?

Several strategies:

1. **Hard caps**: each downstream gets a fixed sub-deadline (e.g. 200 / 500 / 1000 ms). Predictable, doesn't adapt.
2. **Proportional**: each gets a fraction of remaining time. Adapts to slowdowns but can starve later calls.
3. **Sequential with retries inside a single ctx**: a wrapper context bounds the entire operation including retries.

In practice, hard caps with a small percentage (10–20%) reserved for response writing and overhead are the most maintainable.

### Q17. A goroutine spawned from a handler must outlive the request. What do you do?

Use `context.WithoutCancel(r.Context())` (Go 1.21+) to detach from cancellation while preserving values:

```go
bg := context.WithoutCancel(r.Context())
go audit.Record(bg, event)
```

Pre-1.21, write a wrapper that delegates `Value` to the parent but returns nil from `Done`/`Err`/`Deadline`. Always give the background ctx its own deadline and cleanup story (queue, logs).

### Q18. Combine two contexts so cancellation flows from either parent.

Go provides no built-in. The pattern:

```go
func WithEither(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
        case <-stop:
        }
        cancel()
    }()
    return ctx, func() { close(stop); cancel() }
}
```

The returned ctx's `Value` chain is `a`'s. If you need values from both, layer additional `WithValue` calls.

### Q19. How does OpenTelemetry interact with `context.Context`?

OTel stores the active span in the context. `tracer.Start(ctx, name)` returns a new ctx with the span; downstream calls deriving from this ctx that themselves call `tracer.Start` produce child spans automatically. Cross-process propagation uses `propagator.Inject`/`Extract` over HTTP headers (`traceparent`, `tracestate`) or gRPC metadata. Instrumented HTTP/gRPC layers (`otelhttp`, `otelgrpc`) handle this automatically.

### Q20. A middleware accidentally writes `context.WithValue(context.Background(), key, v)`. Why is this a serious bug?

It detaches the request from its lifetime. Downstream:

- `r.Context().Done()` no longer signals client disconnect or shutdown.
- The deadline is gone.
- Every other middleware-added value is gone too.

The fix: derive from `r.Context()`:

```go
ctx := context.WithValue(r.Context(), key, v)
next.ServeHTTP(w, r.WithContext(ctx))
```

This is one of the most common ctx bugs in production.

### Q21. Cancel function discipline: why exactly does `go vet -lostcancel` matter?

If you discard `cancel`, two resources leak:

1. The `time.Timer` inside `timerCtx` lives until the deadline fires (could be hours).
2. The child remains in the parent's `children` map, blocking GC.

Under load (millions of requests), accumulated timers and map entries become measurable. `go vet -lostcancel` is enabled by default and catches the pattern statically.

### Q22. How would you propagate a tenant ID across HTTP, gRPC, and Kafka?

- HTTP middleware: read from header, store in ctx with `WithTenantID`.
- gRPC interceptor: read from metadata, store in ctx with the same helper.
- Kafka consumer: read from message headers, store in ctx.

Producer-side: HTTP middleware reads ctx, writes header; gRPC interceptor writes metadata; Kafka producer attaches header. The context-value layer is identical across transports; only the marshalling differs.

### Q23. A handler calls a long-running batch job. How do you wire context?

If the handler should *not* wait for the job: spawn a goroutine with detached ctx, return immediately, expose status via a job ID.

```go
jobID := uuid.NewString()
go runBatch(context.WithoutCancel(r.Context()), jobID, params)
json.NewEncoder(w).Encode(JobAccepted{ID: jobID})
```

If the handler *should* wait (synchronous batch): use the request's ctx but be honest about timeouts — long ctx deadlines tie up server connections.

## Staff

### Q24. Design a context-aware connection pool.

Each `Acquire` takes a ctx; if the pool is full, the caller waits on either an idle connection becoming available or `ctx.Done()`. On context cancel, return `ctx.Err()`. Critical: the goroutine waiting must not leak even if the pool releases a connection an instant after cancel — use a select with the connection channel and `ctx.Done()`, and on cancel, eagerly try to steal-and-release any connection that arrived simultaneously.

### Q25. Your service's p99 latency is dominated by one downstream. How does context help diagnose and fix?

Diagnosis: per-call OTel spans show which downstream consumed the budget. Tail-latency of one specific call jumps out.

Fix options:

- Tighter sub-deadline on that call (`WithTimeout(ctx, smaller)`).
- Hedged requests (race two with shared context, cancel slow on first response).
- Caching ahead of the slow call.
- Circuit breaker that short-circuits when downstream is unhealthy, surfacing `context.DeadlineExceeded` immediately.

### Q26. How do you migrate an existing codebase that uses `Background()` everywhere to context-aware?

Bottom-up: start at the I/O leaves (DB, HTTP client) and add ctx parameters. Use `context.TODO()` as a temporary placeholder at the seam, then walk upward, eventually plumbing `r.Context()` from handlers. CI gate: a regex grep that flags new `Background()` in handler files. The migration is mechanical but tedious; aim for a steady cadence.

### Q27. When should you NOT use `errgroup.WithContext`?

When you want each goroutine to have its own ctx independent of siblings — e.g. fanning out to read-replicas, each with its own retry budget. `errgroup.WithContext` cancels everyone on first error, which is wrong here. Use plain `errgroup.Group` with per-goroutine `WithTimeout`.

### Q28. A library you depend on takes `context.Context` but never selects on `Done`. How do you reason about cancellation?

The library is non-cooperative; cancellation is a no-op for it. You can't fix that from the outside. Workarounds:

- Wrap the call in a goroutine and select on `ctx.Done()` *outside* the call — but the underlying goroutine and resource still leak.
- Submit a patch to the library.
- Replace the dependency.

The lesson: always check that a third-party library actually respects ctx before depending on its cancellation semantics.

### Q29. Explain how `context.AfterFunc` differs from `defer cancel()`.

`AfterFunc(ctx, f)` schedules `f` to run when `ctx.Done()` closes, on a goroutine spawned by the runtime. Use cases:

- Closing a long-lived resource on cancel without a select loop in the user code.
- Releasing a worker from a non-cooperative library.

Returns a stop function — call it if `f` should not run. Distinct from `defer cancel()` which is about *when you* trigger cancellation; `AfterFunc` is about *what runs when* cancellation happens.

### Q30. Critique this code:

```go
type Service struct {
    ctx context.Context
    db  *sql.DB
}

func (s *Service) Do(input In) error {
    return s.db.QueryRowContext(s.ctx, "...", input.ID).Err()
}
```

Three problems:

1. Storing ctx in a struct field is an anti-pattern.
2. Every call uses the same ctx — no per-request cancellation, deadline, or values.
3. The interface lies: a caller cannot pass a deadline.

Fix: take ctx as a parameter:

```go
func (s *Service) Do(ctx context.Context, input In) error { ... }
```

If you genuinely need a service-level cancellation (background goroutines), keep a `cancel` func plus a service-lifetime ctx, but methods that handle requests still take ctx as a parameter.

### Q31. How do you test that a function correctly respects context cancellation?

Pattern: call with an already-canceled context and assert the function returns `ctx.Err()` quickly:

```go
func TestQuickExit(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    cancel()  // pre-cancel
    err := DoWork(ctx)
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("got %v, want context.Canceled", err)
    }
}
```

Alternative: cancel mid-flight and assert it returns within a tight bound:

```go
ctx, cancel := context.WithCancel(t.Context())
go func() {
    time.Sleep(10 * time.Millisecond)
    cancel()
}()
start := time.Now()
err := DoWork(ctx)
if time.Since(start) > 100*time.Millisecond {
    t.Fatalf("did not respect cancellation")
}
```

### Q32. A function takes ctx but its implementation has no I/O. Should you remove the ctx parameter?

Generally no. Reasons to keep it:

- Forward compatibility: today's pure function may add I/O tomorrow.
- API uniformity: callers expect ctx-first signatures.
- Testability: lets tests inject a deadline that propagates if the function later calls a sub-helper.

Reasons to remove: if it's a private helper that will never become I/O-bearing. Even then, the cost of keeping it is one parameter, often worth it.

[← Back to index](junior.md)
