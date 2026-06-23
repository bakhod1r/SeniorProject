# Context Internals — Optimize

[← Back to index](index.md)

## When Context Optimization Matters

You typically do not optimise context usage. The standard library's defaults are correct and fast for any service handling fewer than ~50k requests per second. Above that, a careful audit can save 1–5% of CPU and meaningful heap pressure.

This page is for that audit. We assume you already have profiles showing context constructors in the top-10 of allocation reports, and we step through each lever you can pull.

---

## Lever 1 — Eliminate Redundant Derivations

The single biggest win for most services. Look for code that derives three contexts where one would do:

```go
// BEFORE — three timer allocations
func handler(ctx context.Context) {
    cacheCtx, cancel1 := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel1()
    cacheVal, err := cache.Get(cacheCtx, key)

    dbCtx, cancel2 := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel2()
    dbVal, err := db.Query(dbCtx, key)

    rpcCtx, cancel3 := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel3()
    return rpc.Call(rpcCtx, payload)
}
```

If the three sub-calls share a single 100ms budget:

```go
// AFTER — one timer allocation
func handler(ctx context.Context) {
    ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel()

    cacheVal, _ := cache.Get(ctx, key)
    dbVal, _   := db.Query(ctx, key)
    return rpc.Call(ctx, payload)
}
```

Savings per request:

- 2 timerCtx allocations (~80 bytes each = 160 bytes)
- 2 time.Timer allocations (~150 bytes each = 300 bytes)
- 2 CancelFunc closures (~16 bytes each = 32 bytes)
- 2 entries in the runtime timer heap

At 50k RPS, this is roughly 25 MB/s of heap saved.

When is the original form correct? When the sub-calls have **genuinely independent budgets** — e.g., cache lookup has a 20ms tight budget but the RPC has 200ms. In that case, derive each separately. The cost is justified.

---

## Lever 2 — Consolidate `WithValue` Fields

Each `WithValue` is a heap allocation. Each lookup costs one chain step.

```go
// BEFORE — five allocations, five-deep chain
ctx = context.WithValue(ctx, traceKey{}, traceID)
ctx = context.WithValue(ctx, userKey{}, userID)
ctx = context.WithValue(ctx, tenantKey{}, tenantID)
ctx = context.WithValue(ctx, requestKey{}, requestID)
ctx = context.WithValue(ctx, sessionKey{}, sessionID)
```

```go
// AFTER — one allocation, one-deep
type RequestMetadata struct {
    TraceID, UserID, TenantID, RequestID, SessionID string
}
type requestKey struct{}

ctx = context.WithValue(ctx, requestKey{}, RequestMetadata{...})
```

Savings: 4 allocations per request + 4 chain steps on every `Value` lookup.

Accessing the consolidated value is also faster: a typed accessor:

```go
func FromContext(ctx context.Context) RequestMetadata {
    m, _ := ctx.Value(requestKey{}).(RequestMetadata)
    return m
}
```

One lookup, one type-assertion, one struct field read. Compared to five separate lookups, an order of magnitude faster.

### When to keep separate values

If different packages need to set their own fields independently and you cannot agree on a single struct, keep them separate. The cost is the price of decoupling.

---

## Lever 3 — Use Background-Derived Cancel for Long-Lived Workers

```go
// BEFORE — context derived from a long-lived parent that itself derives from a parent...
func startWorker(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    go func() {
        defer cancel()
        worker(ctx)
    }()
}
```

If `parent` is the server's root context (which lives for the process), the derivation is correct but the chain depth grows with worker count. Every worker's `cancelCtx` sits in `parent.children`.

For workers that are entirely independent (no parent cancellation actually needs to propagate), use `Background`:

```go
func startWorker() {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        defer cancel()
        worker(ctx)
    }()
}
```

Trade-off: now you must handle process-wide shutdown manually. The pattern is to maintain a slice of cancel funcs and call them on `SIGTERM`.

This is rare. Usually the chain depth is fine. But if you have 100,000 workers, the parent's children map is non-trivial.

---

## Lever 4 — Avoid the Slow Path

If your custom Context type triggers the forwarder-goroutine slow path, every derivation costs a goroutine. The fix is to forward the magic key:

```go
type myCtx struct {
    context.Context  // embedded
    extra string
}

func (m *myCtx) Value(key any) any {
    if key == extraKey{} {
        return m.extra
    }
    return m.Context.Value(key)  // delegate, including &cancelCtxKey
}
```

The embedded `context.Context` is critical. If your `Value` ever short-circuits without delegating, the chain is broken.

Verify with a benchmark:

```go
func BenchmarkDerive(b *testing.B) {
    parent := &myCtx{Context: context.Background()}
    runtime.GC()
    pre := runtime.NumGoroutine()
    for i := 0; i < b.N; i++ {
        _, c := context.WithCancel(parent)
        c()
    }
    runtime.GC()
    post := runtime.NumGoroutine()
    b.Logf("goroutine delta: %d", post-pre)
}
```

`post - pre` should be near zero (some goroutines exit). If it is roughly `b.N`, you are on the slow path.

### Alternative: `afterFuncer`

If your custom type cannot embed a `cancelCtx` cleanly (e.g., you want custom cancellation logic), implement the `afterFuncer` interface:

```go
type AfterFuncer interface {
    AfterFunc(func()) func() bool
}

func (c *myCtx) AfterFunc(f func()) func() bool {
    // register f to fire on cancellation
    // return a stop function
}
```

`propagateCancel` will use this instead of the slow path. One callback registration per child instead of one goroutine.

---

## Lever 5 — Reuse Contexts Where Safe

Per-request derivation is the bulk of the cost. For shared state across requests (server-level workers, periodic tasks, telemetry pushers), derive once at startup:

```go
type Server struct {
    rootCtx    context.Context
    rootCancel context.CancelFunc
}

func (s *Server) Start() {
    s.rootCtx, s.rootCancel = context.WithCancel(context.Background())
    for i := 0; i < s.workers; i++ {
        go s.worker(s.rootCtx, i)
    }
}
```

One context, shared by all workers. One cancel per server lifecycle.

This is not an optimisation per se — it is correct architecture. But it pays performance dividends compared to deriving in each goroutine's `init`.

---

## Lever 6 — Pre-Allocate the Done Channel Where Anticipated

The standard library's `cancelCtx.Done` is lazy: the channel is allocated on first read. If you know `Done` will be read soon — e.g., the context is created specifically for a `select` in the next line — there is no avoiding the allocation.

But you can avoid **re-allocation** if you cancel the context before observing `Done`. The cancel substitutes `closedchan` instead of allocating:

```go
// PATTERN — observe Done after cancel; no fresh chan allocation
ctx, cancel := context.WithCancel(ctx)
if someEarlyExitCondition {
    cancel()
    // ctx.Done() now returns closedchan; never allocates
    return
}
```

This is a minor optimisation. The standard library already does this for you. The lesson is mostly "don't worry about Done allocation; the lazy path handles it."

---

## Lever 7 — Reduce Cancel-Chain Depth at Server Level

In an HTTP server, every request's context derives from `r.Context()` which derives from `BaseContext` which derives from `context.Background()`. The chain at the leaf is typically depth 2-3.

If you wrap with middleware, each layer adds a derivation:

```
request.Context()
  → middleware1.WithValue (trace)
    → middleware2.WithValue (user)
      → middleware3.WithCancel (auth-timeout)
        → middleware4.WithValue (tenant)
          → handler
```

Depth 5. Each `ctx.Value()` walks all five.

If middleware sets many values, consolidate as in Lever 2. If middleware wraps with `WithCancel` for its own reasons, consider whether the cancel is genuinely needed (most middlewares do not need to cancel; they need to observe and pass through).

---

## Lever 8 — `errgroup.SetLimit` Instead of Per-Goroutine Contexts

A common pattern: fan out 1000 tasks, each with its own context:

```go
g, ctx := errgroup.WithContext(parent)
for _, item := range items {
    item := item
    g.Go(func() error {
        // each task could be cancelled when any fails
        return process(ctx, item)
    })
}
return g.Wait()
```

`errgroup.WithContext` derives one `cancelCtx` (via `WithCancelCause`). All 1000 goroutines share it. Cancellation of one cancels all.

This is efficient. The mistake is when developers derive *additional* contexts inside each task:

```go
g.Go(func() error {
    ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel()
    return process(ctx, item)
})
```

Now you have 1001 contexts. If each task's timeout is identical, derive the timeout once:

```go
ctxT, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
defer cancel()
g, ctx := errgroup.WithContext(ctxT)
// ...
```

One timer for all 1000 tasks. Saves 999 timer allocations.

Trade-off: this means all tasks share a 100ms window in total, not 100ms each. Pick the semantics you actually want.

---

## Lever 9 — Use `signal.NotifyContext` for Process Shutdown

Old idiom:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
go func() {
    <-sigCh
    cancel()
}()
```

Allocations: a `chan os.Signal`, a goroutine, a cancel func.

New idiom (Go 1.16+):

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
defer stop()
```

Behind the scenes, `NotifyContext` uses one goroutine and one channel. Net allocation savings: the boilerplate channel and goroutine you would have written.

More important: the resulting context is a regular standard-library cancelCtx, so it benefits from the fast path everywhere else.

---

## Lever 10 — `AfterFunc` Instead of Selector Goroutines

You sometimes write:

```go
go func() {
    select {
    case <-ctx.Done():
        cleanup()
    }
}()
```

This goroutine sits parked, costing ~2 KB stack while idle. If you have 100,000 contexts that need this cleanup, that is 200 MB.

Replace with:

```go
context.AfterFunc(ctx, cleanup)
```

`AfterFunc` registers a callback. No goroutine until cancellation actually fires. Zero stack overhead for the parked watcher. When cancel arrives, one new goroutine is spawned to run `cleanup` — then exits.

Compare the two:

| Pattern        | Idle goroutines | Goroutines on fire |
|----------------|-----------------|---------------------|
| select-on-Done | 1 per ctx       | 1 per ctx (continues briefly) |
| `AfterFunc`    | 0               | 1 per ctx (transient)         |

At rest, AfterFunc is free. At cancel time, equivalent.

The downside: `AfterFunc` is one callback only — you cannot compose it with other select cases.

---

## Lever 11 — Pool the `RequestData` Struct

If your consolidated request-data struct is large (many fields, slices, etc.), pool it:

```go
var requestDataPool = sync.Pool{
    New: func() any { return &RequestData{} },
}

func handler(w http.ResponseWriter, r *http.Request) {
    d := requestDataPool.Get().(*RequestData)
    defer func() {
        *d = RequestData{}
        requestDataPool.Put(d)
    }()

    d.TraceID = extractTrace(r)
    d.UserID = extractUser(r)

    ctx := context.WithValue(r.Context(), requestDataKey{}, d)
    serve(ctx)
}
```

Trade-off: consumers must understand that the value is pooled and may be reset after the handler returns. Don't return references from inside the handler.

Useful only when `RequestData` is genuinely large. For small structs (<100 bytes), the pool overhead is comparable to the allocation cost.

---

## Lever 12 — Measure With `runtime/metrics`

To know if any of these optimisations help, you need data.

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/sched/goroutines:goroutines"},
}

metrics.Read(samples)
heapBytes := samples[0].Value.Uint64()
goroutines := samples[1].Value.Uint64()
```

Track these every minute during a load test. Differences attribute to context changes vs baseline.

For per-call timing, `go test -bench` with `-benchmem` against a hot function:

```go
func BenchmarkHandlerHot(b *testing.B) {
    req := buildFakeRequest()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        handler(req)
    }
}
```

Compare `B/op` and `allocs/op` before and after.

---

## Lever 13 — Profile with `pprof`

For a running service:

```
go tool pprof http://localhost:6060/debug/pprof/allocs
(pprof) top 20
(pprof) list context.WithTimeout
```

If `context.WithTimeout` is in the top 10 by allocs, your service is context-bound and the levers above apply.

For CPU:

```
go tool pprof http://localhost:6060/debug/pprof/profile
(pprof) top 20
(pprof) list context.(*cancelCtx).cancel
```

If `cancelCtx.cancel` is in the top 10, you are creating too many short-lived contexts or have a long fan-out cascade.

Common pprof findings and their fixes:

| Symptom                                        | Likely cause                              | Fix                          |
|------------------------------------------------|-------------------------------------------|------------------------------|
| `context.WithTimeout` high in allocs           | Per-call timer in hot path                | Lever 1                      |
| `runtime.gopark` from `(*cancelCtx).propagateCancel` | Slow-path goroutines                 | Lever 4 (afterFuncer)        |
| `runtime.makechan` near `(*cancelCtx).Done` high | First-time Done observations             | Cannot avoid; lazy is optimal |
| `context.value` (lowercase) in CPU             | Deep value chains                         | Lever 2 (consolidate)        |
| `runtime.mapassign` near `propagateCancel` high | Children map churn                       | Lever 1 + Lever 5            |

---

## Lever 14 — A Custom "Lite" Context for Internal Hot Paths

For genuinely extreme hot paths (>100k QPS, profile dominated by `context`), consider a private `Context`-like type that satisfies the same interface but is tailored:

```go
type liteCtx struct {
    deadline time.Time
    err      atomic.Value
    done     chan struct{}
}
```

Skip the children map (not needed for leaf contexts that have no derivations). Skip the parent pointer (not needed if you never call `Value`). Skip the mutex (use atomics for everything).

The cost: this type does not interoperate with `WithCancel(liteCtx)` via the fast path. It is for leaves only.

**Caveat**: this is rarely justified. The standard library is fast enough for almost every workload. Build this only after you have exhausted the standard levers and pprof still blames context.

---

## A Performance Budget Worksheet

For a service targeting 50k QPS with a per-request budget of 100 microseconds of context overhead:

| Operation                | Cost                    | Calls per request | Budget contribution |
|--------------------------|-------------------------|--------------------|----------------------|
| `WithTimeout`            | ~400ns + 3 allocs       | 1                  | 400ns + 192 B        |
| `WithValue` (consolidated) | ~30ns + 1 alloc       | 1                  | 30ns + 48 B          |
| `ctx.Value(deep)`        | ~5ns × depth            | 5                  | 100ns                |
| `defer cancel()`         | ~50ns                   | 1                  | 50ns                 |
| `ctx.Done() <-receive`   | ~3ns                    | several            | 30ns                 |
| **Total**                |                         |                    | ~610ns + 240 B       |

At 50k QPS:

- 30.5ms/sec CPU spent on context (~3% of one core)
- 12 MB/sec heap pressure

Within budget. If you exceed 5% of a core or 30 MB/sec heap, audit using the levers above.

---

## Anti-Optimizations

Some "optimizations" that look helpful are not:

### Don't: `sync.Pool` for cancelCtxes

The standard `cancelCtx` cannot be reset (atomic.Value cannot store nil after non-nil; children map persists; done channel is closed). Pooling is impractical without forking the package.

### Don't: Cache a long-lived `cancelCtx` and "cancel" it by deriving a fresh child each request

The parent's children map would grow with every request. Memory leak.

### Don't: Replace `context` with a custom global "request scope"

You lose hierarchical cancellation, goroutine-safe propagation, and standard-library integration (`net/http`, `database/sql`, `grpc`). The Go ecosystem is designed around `context`. Forking it forks the ecosystem.

### Don't: Skip `defer cancel()` to save 50ns

You lose the children-map cleanup. Saves a nanosecond, costs a memory leak.

---

## A Realistic Optimization Workflow

Start with a profile. Find the top three context-related entries. Apply the relevant lever. Re-profile. Repeat.

Set a measurable bar: "context overhead < 5% of CPU and < 30 MB/sec heap." If you are below the bar, stop optimising and work on something else.

When you have implemented every lever you can, document the architecture for future reviewers: a comment in the handler explaining why timeouts are shared, why values are consolidated, why custom types forward magic keys. Otherwise the next engineer will "clean up the code" and undo your work.

---

## A Final Word

The `context` package is well-optimised by default. The standard library's authors are excellent. The optimisations on this page are for the 1% of services where context overhead actually moves the needle.

For the other 99%, the right answer is: do not optimise context. Optimise database queries, HTTP parsers, or whatever else pprof shows is actually slow. Context is rarely the bottleneck; when it is, you have spent enough engineering on the rest of the service to recognise that fact.

---

Back to [index](index.md).
