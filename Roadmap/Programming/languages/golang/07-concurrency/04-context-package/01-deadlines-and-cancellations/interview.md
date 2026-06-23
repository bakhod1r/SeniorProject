# Deadlines and Cancellations — Interview

[← Back to index](junior.md)

A graduated set of interview questions on Go's `context` package, with model answers. Junior questions test mechanics; staff questions test taste.

## Junior

### Q1. What is `context.Context` and why does Go have it?

A `Context` is a type carrying cancellation, deadline, and request-scoped values across function calls and goroutines. Go has it because (a) goroutines have no preemption story for cancellation, so cooperation must be explicit, and (b) request-scoped data (trace IDs, deadlines) needs a uniform plumbing channel.

### Q2. What's the difference between `context.Background()` and `context.TODO()`?

Behaviorally identical: both return an empty context with no deadline, no values, `Done()` returning nil. The difference is intent — `Background` is the documented entry point for `main`, tests, and long-lived workers; `TODO` marks code that *should* receive a real context but hasn't been wired up yet.

### Q3. Why must you always defer the cancel function?

For two reasons. (1) Resource cleanup: a `timerCtx` holds a `time.Timer` that will not be released until either cancel or the deadline fires; with long deadlines, leaks accumulate. (2) Tree pruning: each `WithCancel` adds an entry to the parent's `children` map, and only `cancel()` removes it. Plus, `go vet -lostcancel` is enabled by default and will fail builds.

### Q4. How do `WithTimeout` and `WithDeadline` relate?

`WithTimeout(parent, d)` is equivalent to `WithDeadline(parent, time.Now().Add(d))`. They share an implementation; `WithTimeout` is sugar for "now plus this duration."

### Q5. What are the two values that `ctx.Err()` can return?

After `Done()` fires, `ctx.Err()` returns either `context.Canceled` (someone called `cancel()`) or `context.DeadlineExceeded` (the deadline elapsed). Before `Done()` fires, it returns `nil`.

### Q6. How do you respect cancellation in a loop?

Use `select` with `<-ctx.Done()` as one case. For example:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case work := <-queue:
        process(work)
    }
}
```

If you have a CPU-bound loop with no blocking operation, periodically check `ctx.Err()` non-blockingly.

### Q7. What's wrong with `time.Sleep` inside a cancellable goroutine?

`time.Sleep` ignores cancellation; the goroutine wakes only after the full duration. Replace with `time.NewTicker` or `time.NewTimer` and select on it alongside `ctx.Done()`. That way cancel preempts the sleep.

## Middle

### Q8. Can a child context have a longer deadline than its parent?

No. `WithDeadline(parent, d)` checks if the parent already has a deadline before `d` and, if so, uses the parent's. The child will be canceled at the parent's deadline. You cannot extend a parent's deadline by deriving a child with a later one.

### Q9. Explain the propagation model.

Contexts form a tree. Cancellation flows from parent to all descendants synchronously. Cancelling a child does not affect the parent or siblings. The standard library's internal `propagateCancel` either (a) registers the child in the parent's `children` map (fast path) or (b) spawns a goroutine that forwards the cancel signal (slow path, used for custom Context implementations).

### Q10. What does `go vet -lostcancel` catch?

Discarded or partially-deferred cancel functions. Examples:

- `ctx, _ := context.WithCancel(p)` — ignored.
- A path that returns before `defer cancel()` runs.
- A cancel passed into a closure that may not run.

It runs as part of `go vet` and is included by default.

### Q11. How do you cancel a context "manually" while also using a deadline?

`WithCancel` and `WithTimeout` produce a single context. The returned `cancel` function works whether the deadline has fired or not. You can call `cancel` early; subsequent deadline expiry is a no-op since the context is already canceled.

### Q12. What's the difference between `errors.Is(err, context.Canceled)` and `err == context.Canceled`?

The standard library wraps context errors. `errors.Is` walks the wrap chain; `==` only matches direct equality. Always use `errors.Is`.

### Q13. Why is storing `context.Context` in a struct considered bad?

The Context represents a request lifetime. Structs typically live across many requests; pinning a single context to a struct conflates lifetimes. The official guidance: pass `ctx` as the first parameter to every method. Storing the **cancel function** in a struct is fine and useful.

### Q14. What does `context.WithValue` cost?

One allocation for the new `valueCtx` struct, no allocation per lookup. Lookups are O(depth); each `Value(k)` walks up the chain. In hot paths with many values, consolidate into a single struct.

## Senior

### Q15. Walk me through `propagateCancel` for a `WithCancel(parent)` call.

It checks `parent.Done()`. If nil, parent is uncancellable; nothing to do. Otherwise it tries to find the parent's underlying `cancelCtx` via `parentCancelCtx`. If found, it locks the parent, registers the child in `children`, unlocks. If not found (custom Context), it spawns a goroutine that forwards: `select { case <-parent.Done(): child.cancel(); case <-child.Done(): }`. The goroutine version is the slow path and avoid-able by sticking with the standard `cancelCtx`/`timerCtx`.

### Q16. What is `context.WithCancelCause`?

Introduced in Go 1.20. Returns `cancel func(error)`. Calling `cancel(myErr)` sets a cause that `context.Cause(ctx)` exposes; `ctx.Err()` is unchanged for backward compatibility (still returns `Canceled`). It's useful for diagnostic logging in long pipelines where the root failure should propagate without being masked as "context canceled."

### Q17. What is `context.WithoutCancel`?

Go 1.21+. Returns a context that inherits **values** from the parent but **no cancellation**: `Done()` returns nil, `Err()` returns nil, `Deadline()` returns `(zero, false)`. Used for fire-and-forget tasks (audit logs, async telemetry) that must outlive a request but should keep its trace IDs.

### Q18. How does `context.AfterFunc` differ from a goroutine selecting on `Done()`?

`AfterFunc(ctx, f)` registers a callback. The runtime spawns a goroutine to run `f` only when `ctx` is canceled — there is no permanently-running goroutine waiting. It returns a `stop` function that deregisters before f runs (returns `false` if f already ran). Better than a select-loop goroutine for cleanup hooks: zero idle cost.

### Q19. How does cancellation behave under HTTP/2 stream cancellation?

The Go server attaches a per-request context to each handler invocation. When the client cancels a single HTTP/2 stream, that request's context is canceled. Other streams on the same connection are unaffected. The handler must respect `r.Context().Done()` to bail.

### Q20. Why does the `context` package's `cancelCtx` use a global pre-closed channel?

Optimization. Many contexts are never observed (their `Done()` is never called). Allocating a channel per context is wasteful. The implementation lazy-allocates: `Done()` lazily creates a chan, and if cancel arrives **before** anyone called Done, the implementation just stores the singleton `closedchan`. Saves a per-context channel allocation.

### Q21. Suppose your service calls three downstream RPCs in a sequence. Each takes ~200 ms. Your handler has a 1 s budget. Walk me through deadline budgeting.

Capture the parent deadline on entry. Reserve a small tail budget (say 50 ms for response-writing) and divide the remainder by 3. Each downstream call gets its own `WithTimeout` derived from `r.Context()`. If A finishes early, B inherits the unused budget naturally — its `WithTimeout` from `r.Context()` still uses the original 1 s parent. So it's not strict thirds; it's "the whole remaining minus what's used."

If sub-call latencies are heterogeneous, weight the budget. Don't be afraid to bail with `errors.New("insufficient budget")` if `time.Until(deadline) < threshold` at the top of a step.

### Q22. What's the right way to log "we got canceled"?

Two pieces. (1) Translate the context error into a domain error at boundaries: `if errors.Is(err, context.Canceled) { return ErrClientGone }`. (2) Use `WithCancelCause` upstream to record *why* you canceled, so `Cause(ctx)` carries diagnostic information. Logs become "client closed connection" instead of "context canceled."

## Staff

### Q23. Design a custom Context that adds typed accessors for trace ID, tenant ID, and user ID without using `WithValue`. What are the tradeoffs?

```go
type RequestCtx struct {
    context.Context
    TraceID  string
    TenantID string
    UserID   int64
}
```

Tradeoffs:

- **Pro:** O(1) typed access, single allocation for three values, no `interface{}` boxing.
- **Con:** Custom type taken as input means `propagateCancel` falls into the slow path when downstream code does `WithCancel(rctx)` — extra goroutine per derivation.
- **Mitigation:** wrap *late* in the chain. Build all `WithCancel`/`WithTimeout` first, then wrap once with the typed wrapper. Subsequent derivations still find the underlying `cancelCtx`.

### Q24. A junior writes:

```go
go func() {
    <-ctx.Done()
    cleanup()
}()
```

What's wrong, and how would you fix it?

If `ctx` is never canceled (e.g. `Background()`), the goroutine leaks. Even if it is canceled, you've created a permanently-resident goroutine just to wait. Use `context.AfterFunc(ctx, cleanup)` instead — no idle goroutine, exactly-once execution, returns a `stop` function for early cancellation.

### Q25. Walk me through a graceful HTTP shutdown that respects in-flight requests but enforces a hard 30-second cap.

```go
rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

baseCtx, baseCancel := context.WithCancel(context.Background())
srv := &http.Server{
    BaseContext: func(net.Listener) context.Context { return baseCtx },
}

go func() { srv.ListenAndServe() }()

<-rootCtx.Done()

shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutCtx); err != nil {
    baseCancel() // hard kill: cancel all in-flight handler contexts
}
```

Critical: the shutdown context derives from `Background()`, **not** `rootCtx`. `rootCtx` is already canceled; deriving from it makes Shutdown return immediately. The `BaseContext` trick gives you a "kill switch" for any handler ignoring the timeout.

### Q26. Why does `context.Cause(ctx)` walk *up* the tree?

Because cancellation can happen at any level. If the parent canceled with cause "upstream timed out" and the child was registered via `propagateCancel`, the child's cancel was triggered without any local cause. `Cause` walks up to find the closest ancestor with a recorded cause. Otherwise it returns `ctx.Err()`.

### Q27. Tell me about the difference between propagating a deadline over gRPC versus inside a single process.

In-process: `WithTimeout` returns a context whose `Done()` channel closes at the deadline. Receivers select on the same channel.

gRPC: the deadline is encoded as a `grpc-timeout` header on the wire (a string like `"200m"` for 200 ms). The server side reads this header and constructs its own `WithDeadline(serverBase, ...)` for the RPC. The two sides have **separate** `Done()` channels but synchronized deadlines (modulo clock skew and network propagation latency). The client typically reserves margin (50 ms is common) for round-trip; otherwise the server may run out before responding.

### Q28. Two goroutines each call `cancel()` simultaneously. What happens?

Safe. The cancel function uses `cancelCtx.cancel(...)` which acquires `cancelCtx.mu`. The first caller sets `err`, closes `done`, cascades to children. The second caller sees `err != nil` and returns immediately. The `Done` channel is closed exactly once.

### Q29. Why is calling cancel from inside the cancellation cascade not a deadlock?

The cascade is `for child := range c.children { child.cancel(false, err, cause) }`. Crucially, `removeFromParent=false` is passed; the children do not try to remove themselves from the parent's `children` map (which would re-acquire `c.mu`). After the cascade, `c.children = nil` is set and `c.mu.Unlock()` runs. The lock is held only during the synchronous walk.

If a child is custom and its `cancel` blocks (which it shouldn't!), the cascade waits. That's why custom Contexts must keep cancel cheap.

### Q30. What's a real production scenario where `WithCancelCause` saved you?

A service called five microservices in a fan-out. One of them returned a malformed response. The errgroup canceled the others. Logs said "context canceled" five times — useless. After adopting `errgroup.WithContextCause`, the cause "service-X: invalid response code 502" propagated, so all four siblings logged the actual cause, and our retry policy could decide based on the original error type rather than "canceled."

### Q31. Describe a pitfall with `r.Context()` in middleware.

If your middleware stores values via `WithValue` and the underlying handler does `srv.Shutdown`, the request context cancels. If you then `go audit(r.Context(), ...)`, the audit goroutine fires almost immediately because the request just ended. Use `context.WithoutCancel(r.Context())` to keep the values without inheriting the cancel.

### Q32. Design a context-aware retry helper.

```go
func Retry[T any](ctx context.Context, attempts int, fn func(context.Context) (T, error)) (T, error) {
    var zero T
    var err error
    for i := 0; i < attempts; i++ {
        if i > 0 {
            backoff := time.Duration(1<<i) * 100 * time.Millisecond
            t := time.NewTimer(backoff)
            select {
            case <-ctx.Done():
                t.Stop()
                return zero, ctx.Err()
            case <-t.C:
            }
        }
        var v T
        v, err = fn(ctx)
        if err == nil {
            return v, nil
        }
        if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
            return zero, err
        }
    }
    return zero, fmt.Errorf("after %d attempts: %w", attempts, err)
}
```

Notes: respects context during backoff; bails on context errors; uses `time.NewTimer` (not `Sleep`); uses `errors.Is` to identify cancellation.

### Q33. When would you intentionally use `context.Background()` deep inside a handler?

Two cases. (1) Spawning a fire-and-forget background task that must outlive the request and does **not** need request-scoped values. (2) `srv.Shutdown(ctx)` — you want a fresh context for graceful shutdown, not the canceled root. In modern code, prefer `context.WithoutCancel(r.Context())` for the first case (preserves trace IDs).

### Q34. A reviewer says "this function takes context but doesn't pass it to db.Query." What's the worst-case impact?

The query continues running on the database server even after the request has been canceled. The Go side is freed, but the DB still does the work, holds a connection, possibly takes a row lock. Under load this saturates the DB connection pool with abandoned queries — a textbook cascade failure. Always pass `ctx` to `QueryContext`/`ExecContext`/`PrepareContext`/`PingContext`.

## Wrap-Up Tip

Most senior interview rounds have one or two context questions. The give-away signs of a strong answer are: (a) you say "tree" and "cascade" without prompting, (b) you mention `errors.Is`, (c) you mention `WithoutCancel`/`AfterFunc`/`WithCancelCause` for newer Go versions, (d) you can name `go vet -lostcancel` from memory, (e) you immediately think about lifetime accounting when designing concurrent code.
