# Context Values — Optimization

[← Back to index](junior.md)

`context.WithValue` is small, deterministic, and almost never the bottleneck. But when you are squeezing latency or allocations out of a hot path, knowing exactly how much each call costs lets you make informed trade-offs. This page covers measurable optimizations: when to flatten a deep chain, when to hoist a lookup, when to choose a struct over multiple values, and when to abandon context entirely in favour of explicit parameters.

By the end of this page you should be able to:

- Benchmark `Value` lookup at varying chain depths.
- Recognise the allocation cost of `WithValue` and reduce it where it matters.
- Flatten deep chains by grouping related fields.
- Decide when context overhead has crossed into "rewrite this" territory.

## Baseline Cost

A single `context.WithValue` call allocates one `valueCtx` (64 bytes) and possibly boxes the value (varying cost). A single `ctx.Value(key)` walks the chain to the matching link.

Microbenchmark on an M1 Pro, Go 1.23:

| Operation | Time | Allocs |
|---|---|---|
| `WithValue(ctx, k, "string")` | 25 ns | 1 |
| `WithValue(ctx, k, intVal)` | 35 ns | 2 |
| `WithValue(ctx, k, &user)` | 25 ns | 1 |
| `WithValue(ctx, k, userStruct)` | 35 ns | 2 |
| `ctx.Value(k)` at depth 1, hit | 3 ns | 0 |
| `ctx.Value(k)` at depth 5, hit | 12 ns | 0 |
| `ctx.Value(k)` at depth 10, hit | 25 ns | 0 |
| `ctx.Value(k)` at depth 50, hit | 130 ns | 0 |
| `ctx.Value(k)` at depth 10, miss | 28 ns | 0 |

At normal application depths the lookup is sub-microsecond. Optimizations only pay off when this number is repeated millions of times per second (hot inner loops, very deep chains, or both).

## Optimization 1 — Hoist `Value` Out of Loops

The single most common cost in real codebases.

**Before:**

```go
for _, item := range items {
    log := logctx.From(ctx) // walks 5+ links every iteration
    log.Info("processing", "id", item.ID)
}
```

**After:**

```go
log := logctx.From(ctx)
for _, item := range items {
    log.Info("processing", "id", item.ID)
}
```

For 100,000 items and a depth-10 chain: before is 100,000 × 25 ns = 2.5 ms of pure lookup. After is one 25 ns lookup. The savings are real even in moderately hot loops.

**When to apply:** Whenever a lookup is independent of loop variables. Almost always.

## Optimization 2 — Combine Related Values Into a Struct

If your middleware attaches `requestID`, `user`, `tenant`, `locale`, `startTime` separately, every request has a depth-5 value chain.

**Before:**

```go
ctx = context.WithValue(ctx, reqIDKey, "req-1")
ctx = context.WithValue(ctx, userKey, user)
ctx = context.WithValue(ctx, tenantKey, tenant)
ctx = context.WithValue(ctx, localeKey, "en-US")
ctx = context.WithValue(ctx, startKey, time.Now())
```

Five allocations, depth-5 chain, five lookups per accessor.

**After:**

```go
type RequestMeta struct {
    ID       string
    User     User
    Tenant   TenantID
    Locale   string
    Start    time.Time
}

ctx = context.WithValue(ctx, metaKey, &RequestMeta{
    ID:     "req-1",
    User:   user,
    Tenant: tenant,
    Locale: "en-US",
    Start:  time.Now(),
})
```

One allocation, depth-1 added, one lookup that returns the whole struct.

**Trade-off:** any code that uses one field still loads the whole struct. For small structs (under a cache line) this is fine and arguably faster (fewer hops). For large structs, prefer separate values for the most-read field.

## Optimization 3 — Pointer Storage Beats Struct Storage

`context.WithValue` accepts `any`. Passing a value type requires the runtime to box it; passing a pointer requires only the pointer's word.

**Slower:**

```go
ctx = context.WithValue(ctx, k, User{ID: "u-1", Email: "..."}) // 2 allocs
```

**Faster:**

```go
ctx = context.WithValue(ctx, k, &User{ID: "u-1", Email: "..."}) // 1 alloc
```

The User struct moves to the heap either way (because it ends up in an `any`); a pointer just avoids one extra wrap. For a hot path inserting millions of contexts per second, this matters. For ordinary application code, it is a stylistic preference.

**Don't go too far:** small types (a single string, a single int) do not benefit from being wrapped in a pointer. The `any` representation already handles them efficiently.

## Optimization 4 — Use Empty Struct Keys

```go
type ctxKey struct{} // zero size

var key = ctxKey{}
```

The zero-byte value `ctxKey{}` does not allocate when converted to `any`. Integer keys (`type ctxKey int; const k ctxKey = 0`) require boxing the int, although the runtime caches small integers. For absolute zero-allocation keys, the empty struct wins.

The difference is single-digit nanoseconds per `WithValue` call. Optimize this only if you have measured it.

## Optimization 5 — Avoid Calling `WithValue` Per Iteration

```go
// Bad: builds 1000 ctxs, one per item
for _, item := range items {
    itemCtx := context.WithValue(ctx, itemKey, item.ID)
    process(itemCtx)
}
```

Each `WithValue` allocates. If `process` does not store the context anywhere permanent, you are heating the allocator for no purpose.

**Better:**

```go
for _, item := range items {
    process(ctx, item.ID) // pass the data explicitly
}
```

Or, if the context value is needed for downstream code:

```go
for _, item := range items {
    func() {
        itemCtx := context.WithValue(ctx, itemKey, item.ID)
        process(itemCtx)
    }()
}
```

The local `func()` lets the compiler reason about escape. But the explicit-parameter version is cleaner.

## Optimization 6 — Flatten Custom Context Implementations

If your codebase has custom `Context` types in the chain, the runtime's optimised type-switch loop hits the `default:` branch and falls back to interface dispatch. Every link becomes a virtual call.

The fix: build custom contexts by embedding `context.Context`, and ensure they appear at the *root* of the chain rather than in the middle. The standard library's `valueCtx`/`cancelCtx`/`timerCtx` types are recognised by the fast path; custom types are not.

For most applications this is invisible. For a service whose hot path includes custom context wrappers, it can be 30-50 ns per lookup.

## Optimization 7 — Replace Context With Struct Methods

For library code where everything always needs the same set of dependencies, building a struct and putting the methods on it is faster and clearer than passing them through context.

**Before:**

```go
func processBatch(ctx context.Context, items []Item) {
    log := logctx.From(ctx)
    db, _ := dbctx.From(ctx) // BUG anyway, but for the example
    for _, it := range items {
        log.Info("...")
        db.Exec(ctx, "INSERT ...", it)
    }
}
```

Two context lookups per call, plus a Value walk.

**After:**

```go
type Processor struct {
    db  *sql.DB
    log *slog.Logger
}

func (p *Processor) Process(ctx context.Context, items []Item) {
    for _, it := range items {
        p.log.Info("...")
        p.db.ExecContext(ctx, "INSERT ...", it)
    }
}
```

No lookups. The dependencies are field accesses. Faster, clearer, and the dependencies are visible to the constructor.

## Optimization 8 — Avoid Re-Parsing Header Values Per Request

A common pattern is middleware that re-parses the same header into a context value on every request:

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        locale := parseLocale(r.Header.Get("Accept-Language"))
        ctx := localectx.With(r.Context(), locale)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

`parseLocale` may itself allocate or call into a slow library. If many requests come in with the same `Accept-Language`, an LRU cache around `parseLocale` is cheaper than the allocations inside it.

This is not strictly a context optimization, but it commonly arrives via context middleware.

## Optimization 9 — Use `WithoutCancel` Sparingly

`context.WithoutCancel` allocates a small wrapper struct and an interior `cancelCtx`. For a long-lived background goroutine this is fine. For per-request wrappers in a hot path, that allocation matters. If you are using `WithoutCancel` for fast-path detachment, consider whether the values are actually needed:

```go
go func() {
    // Tracing wants the trace ID; nothing else.
    bg := context.Background()
    bg = tracectx.With(bg, tracectx.From(ctx))
    work(bg)
}()
```

`Background()` is a singleton — zero allocation. One `WithValue` for the trace ID — one allocation. Total: cheaper than `WithoutCancel` + full chain.

## Optimization 10 — Pre-allocate Sentinel Contexts

```go
var (
    backgroundCtx = context.Background()
    testCtx       = userctx.With(backgroundCtx, User{ID: "test"})
)

func TestThing(t *testing.T) {
    // reuse testCtx; do not rebuild every call
}
```

Useful in tests, less so in production. Production code usually wants a fresh context per request.

## Profiling Real Code

To see whether context lookups are actually expensive in your service:

### Step 1: pprof a CPU profile

```bash
go test -cpuprofile cpu.out -bench .
go tool pprof -http=:8080 cpu.out
```

Look for `(*valueCtx).Value` and `runtime.assertE2T` (the interface equality check). If they are in the top samples, you have a measurable problem.

### Step 2: trace allocations

```bash
go test -memprofile mem.out -bench .
go tool pprof -alloc_objects mem.out
```

Look for `context.WithValue`. Per-request allocation counts in the thousands suggest the middleware stack is making many `WithValue` calls — combine them.

### Step 3: try a synthetic benchmark

```go
func BenchmarkLookupAtDepth10(b *testing.B) {
    type k int
    var key k = 0
    ctx := context.Background()
    ctx = context.WithValue(ctx, key, "v")
    for i := 1; i < 10; i++ {
        ctx = context.WithValue(ctx, k(i), "v")
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = ctx.Value(key) // hit at bottom — worst case
    }
}
```

Compare with depths of 1, 5, 25. Plot the curve. Decide whether your real-world depth crosses into the costly region.

## When to Skip Optimization Entirely

The honest answer for most services: **don't optimize context.** Even at depths of 20 with hundreds of thousands of requests per second, the cost is a small fraction of total request time. CPU goes to JSON parsing, regex evaluation, database round-trips, and TLS — not to context lookups.

Optimize context when:

- A profile demonstrates `Value` in the top 5 hot functions.
- You have a tight loop inside a request that calls `Value` per element.
- You have a non-standard custom context wrapper in the hot path.
- You see hundreds of `WithValue` calls per request in alloc profile.

Otherwise, focus on the actual hotspots.

## A Concrete Refactor

Here is a realistic before/after.

**Before:**

```go
func Stack(h http.Handler) http.Handler {
    h = withRequestID(h)         // 1 WithValue
    h = withTracing(h)           // 2 WithValue (span ctx, propagation ctx)
    h = withAuth(h)              // 1 WithValue
    h = withTenant(h)            // 1 WithValue
    h = withLocale(h)            // 1 WithValue
    h = withLogger(h)            // 1 WithValue
    return h
}
```

Per request: 7 `WithValue` allocations, depth-7 chain, ~25 ns per Value lookup miss.

**After:**

```go
type RequestState struct {
    ID       string
    Span     trace.Span
    User     User
    Tenant   TenantID
    Locale   string
    Log      *slog.Logger
}

func Stack(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rs := &RequestState{
            ID:     parseOrGenerateID(r),
            Span:   startSpan(r),
            User:   verify(r),
            Tenant: lookupTenant(r),
            Locale: parseLocale(r),
        }
        rs.Log = slog.Default().With(
            "request_id", rs.ID,
            "user_id", rs.User.ID,
            // ...
        )
        ctx := context.WithValue(r.Context(), stateKey, rs)
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

One `WithValue`. Depth-1 chain. Single accessor:

```go
func State(ctx context.Context) *RequestState {
    return ctx.Value(stateKey).(*RequestState)
}
```

Result: 6 fewer allocations per request, 5-10× faster value lookups, simpler code. The trade-off is that adding a new field requires editing the struct rather than adding a middleware — a small price for an order-of-magnitude improvement.

## Avoiding Premature Pessimization

Some "optimizations" make code worse:

### Bad: caching context.Value results in package-level maps

```go
var userCache sync.Map

func User(ctx context.Context) User {
    if v, ok := userCache.Load(ctx); ok { // BUG: ctx is the key
        return v.(User)
    }
    u := ctx.Value(userKey).(User)
    userCache.Store(ctx, u)
    return u
}
```

Three problems: (1) the cache leaks the context forever; (2) the cache leaks the user forever; (3) the cache is slower than a direct lookup at typical depths. Never cache context lookups across requests.

### Bad: replacing context with thread-locals via cgo

Don't.

### Bad: storing every conceivable value in one struct

A `RequestState` with 50 fields is harder to read than five separate values. Group what is read together. Keep what is read independently separate.

## Summary

`context.Value` is fast and `WithValue` is cheap. Most optimizations are about *structure* — hoisting lookups out of loops, combining many small values into one struct, using empty-struct keys, and abandoning context entirely for application-scoped dependencies. Real wins come from measuring (pprof, benchmarks) and structural refactors, not from micro-tuning the API itself. The biggest single win in most codebases is replacing five `WithValue` middlewares with one struct attached at the edge — fewer allocations, fewer chain hops, clearer code.
