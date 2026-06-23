# Context Tree — Optimization

[← Back to index](junior.md)

A guide to making the context tree pay its lowest cost. The optimizations here range from "always do this" (idiomatic and free) to "only when profiles say so" (subtle, sometimes worth it).

---

## 1. Always Pair `With...` With `defer cancel()`

The lowest-effort highest-payoff rule. Every `With...` returns a `cancel` function. Calling it (or `cancel(nil)` for cause variants):

- Removes the node from its parent's `children` map.
- Stops the underlying `time.Timer` (if any).
- Frees the descendants for GC once they too are uncancelled.

`go vet` enforces this. Treat its warnings as compile errors. Configure `golangci-lint` with `lostcancel` enabled.

---

## 2. Cancel Inside Loops Without `defer`

```go
// Bad: 1000 deferred cancels stack until function exit
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    process(ctx, item)
}

// Good: cancel inline
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    process(ctx, item)
    cancel()
}
```

Or wrap the iteration body in a closure with its own defer.

---

## 3. Hoist Common Parents

If 100 goroutines all need a 5-second budget from the same request, derive once.

```go
// Bad
for _, item := range items {
    ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
    go work(ctx, item)
    _ = cancel
}

// Good
sharedCtx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
defer cancel()
for _, item := range items {
    go work(sharedCtx, item)
}
```

One `timerCtx` for 100 goroutines vs. 100 `timerCtx`. Memory saved, GC pressure reduced, cascade simpler.

---

## 4. Collapse WithValue Chains

Each `WithValue` is a node with allocation and a level of `Value()` walk. If your middleware adds 5 keys, that is 5 nodes and 5 walks per lookup.

```go
// Bad: 5 nodes
ctx = context.WithValue(ctx, requestIDKey, id)
ctx = context.WithValue(ctx, userIDKey, userID)
ctx = context.WithValue(ctx, traceKey, trace)
ctx = context.WithValue(ctx, loggerKey, logger)
ctx = context.WithValue(ctx, localeKey, locale)

// Good: 1 node with a struct
type reqCtx struct {
    RequestID string
    UserID    string
    Trace     trace.SpanContext
    Logger    *log.Logger
    Locale    string
}
type reqCtxKey struct{}
ctx = context.WithValue(ctx, reqCtxKey{}, reqCtx{RequestID: id, UserID: userID, ...})

// Lookup
r := ctx.Value(reqCtxKey{}).(reqCtx)
log := r.Logger
```

Allocation savings: 4 fewer `valueCtx` per request. Lookup savings: 1 walk instead of 5.

---

## 5. Use `AfterFunc` Instead of `<-ctx.Done()` Goroutines

Pre-1.21:

```go
go func() {
    <-ctx.Done()
    conn.Close()
}()
```

Cost: one permanent goroutine while waiting.

Go 1.21+:

```go
context.AfterFunc(ctx, conn.Close)
```

Cost: zero permanent goroutines. A goroutine is spawned only if and when cancellation happens. For a server with 100k connections, this saves 100k goroutines and the associated stack memory (around 200MB).

Caveat: `AfterFunc`'s callback runs in a fresh goroutine, which has its own allocation cost. The savings come from steady-state, not the cancellation moment.

---

## 6. `WithoutCancel` to Avoid New Tree Allocation

When you need a background continuation, the natural shape is "fresh `context.Background()` with the values copied over." Before Go 1.21 that meant:

```go
// Inefficient: walks the parent on every Value call AND copies
newCtx := context.Background()
newCtx = context.WithValue(newCtx, k1, v1)
newCtx = context.WithValue(newCtx, k2, v2)
// ... for every key you cared about
```

Go 1.21+:

```go
newCtx := context.WithoutCancel(req.Context())
```

One node. All values still accessible via the parent walk. Faster, less code, fewer bugs.

---

## 7. Avoid Custom `Context` Implementations

If you implement `Context` yourself, every derivation of a built-in `With...` from your context spawns a watcher goroutine. At scale this is the largest single source of goroutine bloat we have seen in production.

Symptoms:

- High goroutine count not correlated with actual work.
- `pprof` profile shows many goroutines blocked in `context.propagateCancel.func1`.

Fix: use `context.WithValue` to attach any extra data. Do not write your own `Context`.

---

## 8. Lazy `Done()`

The runtime allocates the `Done()` channel only on first call. If your code derives a `WithCancel` but never reads `Done()`, the channel is never allocated.

This is mostly automatic. The takeaway is: do not call `ctx.Done()` defensively in code paths that do not actually wait on it. A call is enough to trigger allocation.

```go
// Bad: triggers allocation just to discard
_ = ctx.Done()

// Bad: triggers allocation for an unused select case
select {
case <-ctx.Done():
default:
}
```

Both touch `Done()`. If you genuinely need to poll, accept the cost. If not, skip.

---

## 9. Cause Set at Source

`Cause` does a tree walk. If you set the cause at the most relevant ancestor and rely on the walk, downstream code does not need to do extra work.

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)
// ... at the failure point:
cancel(fmt.Errorf("validation: %w", err))
```

Downstream:

```go
if c := context.Cause(ctx); c != nil {
    return fmt.Errorf("upstream: %w", c)
}
```

The walk is O(depth). For trees of depth 10 or less it is negligible.

---

## 10. Avoid Wide Trees

A single parent with 10,000 cancelable children means a 10,000-entry `children` map. The cascade locks the parent's mutex while iterating all 10k. Tail latency on cancel spikes.

If you must have 10k cancelable units, consider:

- Sharding: 10 parents with 1k children each. Cancel them in parallel.
- Broadcast channel: a single closed channel that everyone selects on. Bypasses the cancel tree entirely.
- Per-batch cancellation: maintain a list of cancel functions; iterate and call them yourself, possibly in parallel.

---

## 11. Avoid Deep Trees

A 100-deep tree means `Value()` walks 100 levels per lookup. If `Value(k)` is in your hot path, this matters.

Mitigations:

- Collapse `WithValue` chains into a single struct (see #4).
- Cache the result of `ctx.Value(k)` in a local variable for the duration of a function.
- For very hot lookups, denormalise the value into a struct passed by argument.

---

## 12. Reuse Long-Lived Roots

A worker pool with N permanent workers should derive one root context at pool creation, not per worker per task. The pool's root is cancelled at shutdown; workers see cascade.

```go
type Pool struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func NewPool() *Pool {
    ctx, cancel := context.WithCancel(context.Background())
    return &Pool{ctx: ctx, cancel: cancel}
}

func (p *Pool) Submit(task Task) {
    // task uses p.ctx; no new context derived per task
    go task.Run(p.ctx)
}
```

If each task needs its own deadline, derive per-task only when truly necessary:

```go
func (p *Pool) Submit(task Task) {
    go func() {
        ctx, cancel := context.WithTimeout(p.ctx, task.Budget)
        defer cancel()
        task.Run(ctx)
    }()
}
```

---

## 13. Cancel Cascade Off the Hot Path

The originating `cancel()` call is the slowest piece — it runs the entire cascade synchronously. In a high-throughput hot path, you may want to offload:

```go
// Defer-friendly: cascade runs after the response is sent
defer cancel()

// Or explicit:
go cancel() // not recommended; you lose the timing guarantee
```

`go cancel()` shifts the cascade to a separate goroutine. The drawback: by the time `cancel()` actually runs, downstream code may have already done work that should have been aborted. Use sparingly and only when profile data shows cancel as a hotspot.

---

## 14. Batch AfterFunc Cleanups

`AfterFunc` allocates a small wrapper per registration. If you have 5 cleanup steps, prefer one `AfterFunc` with 5 statements over 5 `AfterFunc` calls:

```go
context.AfterFunc(ctx, func() {
    db.Close()
    cache.Flush()
    metrics.Emit()
})
```

vs:

```go
context.AfterFunc(ctx, db.Close)
context.AfterFunc(ctx, cache.Flush)
context.AfterFunc(ctx, metrics.Emit)
```

The latter is 3 cancel-tree entries; the former is 1. Plus the multi-AfterFunc version runs callbacks in parallel goroutines (order not guaranteed), which may or may not be what you want.

---

## 15. Watch for `time.After` Inside Loops

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(time.Hour):
        doWork()
    }
}
```

`time.After` returns a new channel and allocates a new timer every iteration. The previous timer is not GCed until it fires, which may be an hour later. Use `time.Timer` + `Reset`.

This is adjacent to context but commonly co-occurs.

---

## 16. Profile Before Optimizing

The optimizations above are all real, but most apps do not need them. Before reshaping your code:

1. Run `go test -bench . -benchmem`.
2. Run `pprof` (heap, goroutine, block) under realistic load.
3. Identify the actual hotspot.
4. Apply the relevant tactic.
5. Re-measure.

A typical Go server allocates 1–2 KB of context-tree-related memory per request. That's negligible at 1k QPS. At 100k QPS it's 200 MB/sec of allocations — worth attention.

---

## 17. Allocations to Watch For

`-benchmem` typical numbers (Go 1.22, amd64):

- `WithCancel(ctx)`: 1 alloc, ~96 bytes.
- `WithTimeout(ctx, d)`: 2 allocs (cancelCtx + Timer), ~192 bytes.
- `WithValue(ctx, k, v)`: 1 alloc, 48 bytes (if k and v are interface-convertible).
- `WithoutCancel(ctx)`: 1 alloc, 16 bytes.
- `AfterFunc(ctx, f)`: 1 alloc plus closure overhead, ~120 bytes.

In a hot path producing thousands of contexts per second, these add up to MB/s of allocations.

---

## 18. Replace `context` With Channels for Pure Broadcast

For some patterns, `context` is overkill. A simple "shutdown signal" to N goroutines can be a single closed channel:

```go
done := make(chan struct{})
// to stop everyone:
close(done)
// in each worker:
select {
case <-done:
    return
case <-workCh:
    // ...
}
```

No tree, no children map, no cancel functions. The trade-off: no per-worker error reasons, no deadline, no value propagation.

Use channels when you need only broadcast cancellation among siblings. Use context when you need values, deadlines, or hierarchical cancellation.

---

## 19. Avoid `defer cancel(nil)` Inside Tight Loops

The `cancel(nil)` for `WithCancelCause` is required to prevent the parent's children map from leaking the node. But in a tight loop, this single deferred call adds up.

```go
for i := 0; i < N; i++ {
    ctx, cancel := context.WithCancelCause(parent)
    defer cancel(nil) // 1M deferred cancels at function exit
}
```

Same fix as #2: cancel inline.

---

## 20. `WithDeadlineCause` for Diagnostic Attribution

```go
ctx, cancel := context.WithTimeoutCause(parent, time.Second,
    fmt.Errorf("db query budget exhausted"))
defer cancel()
```

When the timer fires, `Cause(ctx)` returns the descriptive error. Downstream logging can attribute the timeout precisely without inspecting the call stack.

The cost: one extra interface allocation per `WithTimeoutCause` for the cause error. Negligible.

---

## 21. Pre-Cancel Optimisation for Already-Doomed Work

If you can detect at function entry that the work cannot succeed (e.g., user is rate-limited), return early without deriving a context.

```go
func handle(ctx context.Context, req Req) error {
    if rateLimited(req.User) {
        return ErrRateLimited
    }
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return process(ctx, req)
}
```

The check is cheap; the context allocation is saved on the rejection path.

---

## 22. `errgroup` vs Hand-Rolled

`errgroup.WithContext(parent)` derives a cancelable context and gives you `Go`/`Wait`. It is well-tested and idiomatic. Replacing it with hand-rolled WaitGroup + cancel patterns is rarely cheaper and easily buggy.

---

## 23. Avoid Re-Wrapping the Same Context

```go
// Bad: each call wraps ctx again
func middleware1(h Handler) Handler {
    return func(ctx context.Context, r Req) {
        ctx = context.WithValue(ctx, k1, v1)
        h(ctx, r)
    }
}
func middleware2(h Handler) Handler {
    return func(ctx context.Context, r Req) {
        ctx = context.WithValue(ctx, k2, v2)
        h(ctx, r)
    }
}
```

After 10 middlewares, the request has a 10-deep value chain. Either compose middlewares to wrap once with a struct (see #4) or accept the cost. Most middleware frameworks already use a single value node.

---

## 24. Lazy Cause Attachment

Sometimes setting a cause for every cancellation is overkill — most cancellations are "user clicked stop." Reserve `WithCancelCause` for points where extra debug info matters.

```go
// Most middleware: plain WithCancel
ctx, cancel := context.WithCancel(parent)

// Critical path: WithCancelCause
ctx, cancel := context.WithCancelCause(parent)
```

The cause field allocation is small, but the cumulative effect can be measured.

---

## 25. Benchmark Real Trees

A useful benchmark for your specific tree shape:

```go
func BenchmarkRequestTree(b *testing.B) {
    b.ReportAllocs()
    parent := context.Background()
    for i := 0; i < b.N; i++ {
        // Simulate a typical request tree
        ctx, cancel := context.WithTimeout(parent, 5*time.Second)
        ctx = context.WithValue(ctx, "id", "req-1")
        ctx = context.WithValue(ctx, "user", "u-1")

        sub, sCancel := context.WithTimeout(ctx, time.Second)
        _ = sub
        sCancel()
        cancel()
    }
}
```

Compare against a "flattened" version that uses one `WithValue` with a struct. The difference is your headroom.

---

## Summary

The optimisations rank roughly:

1. **Free, always:** defer every cancel; cancel-in-loop without defer; one `WithValue` with a struct; `AfterFunc` instead of goroutine; no custom contexts.
2. **Worth measuring:** hoist common parents; collapse middleware; lazy `Done`; `WithoutCancel` for detachment.
3. **Profile-driven:** offload cascade with `go cancel()`; batched `AfterFunc`; tree sharding for very wide cancel.
4. **Niche:** pre-cancel on doomed work; replace context with channels for pure broadcast.

A well-shaped context tree is fast, predictable, and a joy to read. The expensive trees are usually the surprising ones.
