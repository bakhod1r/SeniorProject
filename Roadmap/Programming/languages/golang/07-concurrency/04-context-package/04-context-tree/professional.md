# Context Tree — Professional

[← Back to index](junior.md)

## Treating the Tree as a Production Asset

At professional level the question is no longer "does this code work?" but "what is this tree costing us in dollars, microseconds, and goroutines?" The context tree is invisible by default, but it affects:

- Heap allocations per request (every `With...` allocates).
- Goroutine count (custom contexts and pre-1.21 cleanup goroutines).
- Tail latency under cancel storms.
- Memory occupancy (children maps that never empty).
- Observability fidelity (knowing *which* deadline killed a request).

This file is a tour of the levers, the measurements, and the decisions.

## Allocation Cost Per Node

Approximate, on amd64 with Go 1.22 (your mileage will vary):

| Node | Bytes | Notes |
|------|-------|-------|
| `emptyCtx` | 0 | Global singleton, never allocated per-call |
| `cancelCtx` | 96 | Mutex, atomic.Value, map header, two errors |
| `cancelCtx` with allocated `done` | +96 | `chan struct{}` allocation |
| `cancelCtx` with allocated `children` | +384 | Map header + small backing array |
| `timerCtx` | 96 + cancelCtx | Plus the `time.Timer` (~96 bytes) |
| `valueCtx` | 48 | Two interface values, one parent pointer |
| `withoutCancelCtx` | 16 | One interface value |
| `afterFuncCtx` | 96 + cancelCtx | Plus a `sync.Once` and a function pointer |

A "typical" HTTP request might allocate 6–10 contexts: `req.Context()` -> middleware `WithTimeout` -> two `WithValue` -> handler `WithTimeout` -> two fan-out `WithTimeout`. Roughly 1–2 KB of allocations per request just for the tree. Negligible at hundreds of QPS; visible at hundreds of thousands.

## Measuring

```go
func BenchmarkTree(b *testing.B) {
    parent := context.Background()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ctx, cancel := context.WithCancel(parent)
        ctx = context.WithValue(ctx, "k", "v")
        ctx2, cancel2 := context.WithTimeout(ctx, time.Second)
        _ = ctx2
        cancel2()
        cancel()
    }
}
```

Run with `-benchmem`. Compare:

- `BenchmarkTree-8   2000000   850 ns/op   240 B/op   5 allocs/op` (baseline)
- After folding two `WithValue` calls into a single struct value, one fewer alloc.

## Pattern: Single Value Container

If your middleware injects 5 values, that is 5 `valueCtx` nodes and 5 walks per lookup. Replace with a single struct:

```go
type reqCtx struct {
    RequestID string
    UserID    string
    Trace     trace.SpanContext
    Logger    *log.Logger
    Locale    string
}

type reqCtxKey struct{}

func WithReq(parent context.Context, r reqCtx) context.Context {
    return context.WithValue(parent, reqCtxKey{}, r)
}

func GetReq(ctx context.Context) (reqCtx, bool) {
    r, ok := ctx.Value(reqCtxKey{}).(reqCtx)
    return r, ok
}
```

One node, one walk. Field access on the struct is O(1).

## Pattern: Shallow Fan-Out

Bad:

```go
for _, item := range items {
    sub, cancel := context.WithTimeout(ctx, perItem)
    defer cancel()
    go process(sub, item)
}
```

Each `sub` is a child of `ctx`. `ctx.children` grows to `len(items)`. Cancellation cascade is O(N) under `ctx.mu`.

Good:

```go
batchCtx, cancel := context.WithTimeout(ctx, total)
defer cancel()
for _, item := range items {
    go process(batchCtx, item)
}
```

One child of `ctx`. Each worker shares the same context. `cancel()` runs in O(1).

This works if all workers share the same deadline. If they need independent budgets, accept the cost or use `errgroup`-like coordination.

## Pattern: Pool Reuse vs Allocate

Goroutine pools that hold a long-lived `cancelCtx` per worker rarely re-derive. The cost is one node per worker, not per task. This is a good shape.

A poorly designed pool allocates `WithCancel(jobCtx)` for every task. With 10k tasks per second, that is 10k allocations and 10k map churns on `jobCtx.children`. Avoid.

## AfterFunc Replaces Goroutine

Pre-1.21:

```go
// 1 goroutine per registered cleanup, blocked on <-ctx.Done() until cancellation
go func() {
    <-ctx.Done()
    cleanup()
}()
```

Go 1.21+:

```go
context.AfterFunc(ctx, cleanup)
```

Zero permanent goroutines. One goroutine fires when (and only if) the cancellation actually happens. A server with 100k connections saves 100k goroutines.

`AfterFunc` returns a `stop` function. Call it when the cleanup is no longer needed (e.g., the connection closed normally), to deregister and avoid running cleanup twice.

```go
stop := context.AfterFunc(ctx, conn.Close)
defer func() {
    if !stop() {
        // AfterFunc already fired or is firing. Don't close again.
    }
}()
```

## Custom Contexts: The Watcher Tax

Every cancel-derive of a non-built-in `Context` spawns a watcher goroutine. To detect them:

1. Grep for `func .* Context() .*Done()` definitions in your codebase.
2. Profile goroutines (`go tool pprof http://.../goroutine?debug=2`) and look for stacks rooted in `propagateCancel`.

If you find your own custom context, retire it. If it is a third-party dep, file an issue or wrap it carefully:

```go
// BAD: wraps and re-implements Done
type myCtx struct{ context.Context; logger *log.Logger }

// GOOD: rely on WithValue
ctx := context.WithValue(ctx, loggerKey{}, logger)
```

## Observability: Mapping the Tree

OpenTelemetry spans naturally mirror the context tree. Each span attaches to the current context; child spans derive from the parent. Treat span IDs as a tree-shape audit.

A debug-only tree dumper:

```go
type Snapshot struct {
    Kind     string
    Deadline time.Time
    Err      error
    Cause    error
    Children []Snapshot
}

func Dump(ctx context.Context) Snapshot {
    // Walk using reflection. For diagnostics only; the standard library
    // does not expose children. You can keep your own registry instead.
    ...
}
```

In production you should *not* introspect contexts. Instrument the entry points (handlers, RPC servers) and use traces to reconstruct the tree.

## Tail Latency Under Cancellation

A cancel cascade holds `parent.mu` while it iterates `parent.children`. If you have 50k children and each child's cancel involves modest work (closing channels, running AfterFuncs), the cascade takes milliseconds. During that time `parent.Done()` has fired but `parent.cancel()` has not returned. The originating call (the `cancel()` you invoked) is the slow one.

If the originating cancel is on the request-serving goroutine, it adds to your tail latency. Mitigations:

- Avoid wide trees (5–50 children per node, not 50k).
- Move cancellation off the critical path (`go cancel()` if the caller doesn't need to wait — rare, but possible).
- Use `AfterFunc` instead of `<-ctx.Done()` cleanups; `AfterFunc` callbacks run in new goroutines so they don't contribute to cascade time.

## Cause Propagation as a Debugging Feature

In production, attributing cancellations is invaluable. Examples:

```go
// At your HTTP handler entry:
ctx, cancel := context.WithCancelCause(req.Context())
defer cancel(nil)

// On any internal failure:
cancel(fmt.Errorf("validation failed: %w", err))
```

Now downstream goroutines that print `context.Cause(ctx)` get the original validation error, not a generic "context canceled."

The pattern scales: at every "fork" in your tree (each handler, each fan-out parent), use `WithCancelCause`. Set the cause when *you* know why. Read the cause when *they* report a cancellation.

## Cause and Errgroup

`errgroup.WithContext` (current versions) does not yet set a Cause. To propagate the originating error:

```go
ctx, cancel := context.WithCancelCause(parent)
eg, ctx := errgroup.WithContext(ctx)

eg.Go(func() error {
    if err := work(ctx); err != nil {
        cancel(fmt.Errorf("worker A: %w", err))
        return err
    }
    return nil
})
// ...
if err := eg.Wait(); err != nil {
    cause := context.Cause(ctx) // worker A's wrapped error
    return cause
}
```

This pattern surfaces *which* worker triggered the group's cancellation.

## Tree Depth Limits

Go's runtime has no hardcoded limit on tree depth. Practically:

- `context.Value(k)` walks O(depth). Hot lookups in deep trees are slow.
- `parentCancelCtx` walks O(depth) per derivation to find the nearest `cancelCtx`.
- Stack frames for cascade are O(depth). Stack growth in Go is dynamic, so this rarely matters.

Keep trees under 20 levels for sanity. In practice 6–10 is typical.

## Tree Width Limits

A `cancelCtx`'s `children` is a Go map. Maps handle millions of entries fine. The bottleneck is cascade time under the lock. For widths above 10k, consider:

- Sharding into multiple parents.
- Cancelling in batches.
- Replacing wide cancel cascades with a single closed channel that everyone selects on (a manual "broadcast" pattern that bypasses the cancel tree).

## Garbage Collection Considerations

Each `cancelCtx` references its parent. The parent's `children` map references each cancelable child. So:

- A long-lived parent retains every cancelable child until the child is cancelled.
- A short-lived child does not retain its parent (the parent is referenced externally too).
- `valueCtx` retains its parent and its value; if the value is large, this matters.
- `WithoutCancel` does not register with the parent's children map, so it does not extend the parent's GC reachability.

Worst case: a never-cancelled child of a forever-lived parent (e.g., `Background()` indirectly via a server-lifetime parent) leaks forever. This is the goroutine-leak-detection scenario.

## Tooling

- `go vet` — catches lost cancels.
- `staticcheck` — catches some shadowing and unused contexts.
- `goleak` (Uber) — verifies tests do not leak goroutines after exit.
- `pprof` — `goroutine` profile shows pending `propagateCancel` watchers.
- `trace` (`go tool trace`) — visualises goroutine creation per request.

## A Production Checklist

- [ ] Every `With...` is paired with `defer cancel()` (`go vet` enforces).
- [ ] No custom `Context` implementations in the codebase.
- [ ] No `cancel` stored in struct fields.
- [ ] Fan-out shares a parent context; per-worker children are short-lived.
- [ ] `WithCancelCause` used at every meaningful decision point.
- [ ] `AfterFunc` replaces all post-1.21 `<-ctx.Done()` cleanup goroutines.
- [ ] `WithoutCancel` is used for background continuations and audited.
- [ ] Goroutine count is monitored; spikes correlate with handler activity, not idle time.
- [ ] Tail latency does not correlate with cancellation rate (cascade is fast).
- [ ] Tracing reflects the request's logical tree.

## Anti-patterns at Scale

### Wide cancel tree from a shared `context.Background()`

10k workers, each `WithCancel(Background())`. `Background()` is an `emptyCtx`, so `propagateCancel` short-circuits (no parent registration). Effective tree: 10k isolated subtrees. Each worker's cancellation only affects its own subtree. There is no "kill switch."

Better: a shared root.

```go
rootCtx, cancelAll := context.WithCancel(context.Background())
defer cancelAll()
for i := 0; i < N; i++ {
    go worker(rootCtx)
}
```

Now one cancel hits all workers.

### Per-task `WithValue` in a hot loop

```go
for _, t := range tasks {
    ctx := context.WithValue(parent, "task", t)
    process(ctx, t)
}
```

Allocates one `valueCtx` per iteration. If `task` could be a function argument, pass it directly. `WithValue` is for *cross-cutting* request-scoped data, not per-call parameters.

### Holding the result of `WithoutCancel` longer than the parent

If `parent` is GCed and `detached := WithoutCancel(parent)` is still alive, `detached.Value(k)` keeps walking up through a no-longer-needed chain. Audit.

### Cancel piggy-backed on application data

```go
type taskCtx struct {
    context.Context
    cancel context.CancelFunc
}
```

Storing the cancel in a struct couples lifecycle to data. Use closures or explicit functions instead.

## When to Build Without Context

If a piece of code does not block, does not call out, and does not need cancellation, it does not need a context. The "ctx as the first parameter to everything" rule is a heuristic, not a requirement. Pure CPU work, in-memory transformations, and library utilities (parse, format, compute) should not take `ctx`.

## Summary

The context tree is a cheap but real production asset. Each `With...` allocates; each derive of a non-built-in parent spawns a watcher; each long-lived parent retains every uncancelled child. The cure for every cost is the same: keep trees shallow and narrow, derive sparingly, and trust the built-in node types. `AfterFunc` and `WithoutCancel` are the modern tools for cleanup and detachment; `WithCancelCause` is the modern tool for diagnosis. Audit your codebase against the production checklist quarterly.
