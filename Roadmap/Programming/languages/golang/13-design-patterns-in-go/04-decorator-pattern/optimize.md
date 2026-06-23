# Decorator Pattern — Optimize

## 1. Goal of this file

This file is about **when a naïve decorator is slow or wasteful, and when the fix is worth shipping**. Junior taught the three shapes (interface, function/middleware, embedding). Middle taught the variants — generic decorators, ordering, recovery, stateful wrappers. Optimize is about the cases where a textbook decorator chain shows up in a CPU or allocation profile and you have to do something about it.

The honest envelope: most decorator chains are built once at startup (`Chain(handler, Logging, Auth, Recover)`), called per request at hundreds to thousands of QPS, and never measured. At those frequencies, each layer costs ~1-2 ns of interface dispatch and zero allocations. A 10-layer chain costs ~15 ns per request against ~100,000 ns of actual work. Nobody notices.

It becomes visible when:

- The chain is **rebuilt per request** instead of once at startup.
- A middleware **allocates per call** because of closure escape — typically `defer`, `time.Now()` captured, or buffer construction.
- The chain is **10+ layers deep** and runs in a tight RPC inner loop.
- A **recovery middleware's `defer`** runs on every request even though panics are rare.
- A **cache decorator's `sync.Mutex`** contends under concurrent reads.
- A **logging decorator** does `fmt.Sprintf` of every field, every call.
- A **metrics decorator** computes `WithLabelValues(...)` per call on a `HistogramVec`.
- A **rate limiter** uses a mutex when one atomic counter would do.
- A **chain reload** rebuilds the world on every config change.
- An **embedding-based decorator** forwards 10 methods through interface dispatch.
- A **trace decorator** creates a span per call regardless of sampling decision.
- A **buffered writer** is sized for the wrong typical payload.

Baseline you need to beat. From middle.md §13:

```
BenchmarkDirectCharge-8        500000000   2.10 ns/op   0 B/op   0 allocs/op
BenchmarkOneDecorator-8        300000000   3.41 ns/op   0 B/op   0 allocs/op
BenchmarkFiveDecorators-8      100000000  12.50 ns/op   0 B/op   0 allocs/op
BenchmarkMiddlewareChain5-8     80000000  14.20 ns/op   0 B/op   0 allocs/op
```

A direct call is 2 ns. Each extra interface decorator adds ~2 ns. Five decorators ≈ 12 ns. That's the budget — most optimizations in this file fight for the difference between "15 ns and 0 allocs" and "5 µs and 8 allocs", which usually means killing per-request chain construction, closure escapes, or middleware that does expensive work on the happy path.

Structure of the file:

1. Lifecycle wins (§3–§5): build chain once, kill closure escapes, devirtualize with PGO.
2. Per-middleware wins (§6–§10): trim recovery defer, swap mutex for RWMutex or sync.Map, switch to structured logging, pre-compute metric labels, atomic rate-limit counter.
3. Architecture wins (§11–§14): atomic.Pointer for hot-swap config, direct delegation over embedding, sampled tracing, properly sized buffers.
4. Cost-benefit framing (§15).

---

## 2. Table of Contents

1. [Goal of this file](#1-goal-of-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1: Chain built per-request — build once at startup](#3-exercise-1-chain-built-per-request--build-once-at-startup)
4. [Exercise 2: Closure capture in middleware allocating per call](#4-exercise-2-closure-capture-in-middleware-allocating-per-call)
5. [Exercise 3: Deep middleware chain — PGO devirtualization](#5-exercise-3-deep-middleware-chain--pgo-devirtualization)
6. [Exercise 4: Recovery middleware's defer — eliminate via stack discipline](#6-exercise-4-recovery-middlewares-defer--eliminate-via-stack-discipline)
7. [Exercise 5: Cache decorator using mutex — switch to sync.Map or RWMutex](#7-exercise-5-cache-decorator-using-mutex--switch-to-syncmap-or-rwmutex)
8. [Exercise 6: Logging decorator with fmt.Sprintf — structured logger](#8-exercise-6-logging-decorator-with-fmtsprintf--structured-logger)
9. [Exercise 7: Metrics decorator with HistogramVec — pre-compute labels](#9-exercise-7-metrics-decorator-with-histogramvec--pre-compute-labels)
10. [Exercise 8: Rate limiter using mutex — atomic-based counter](#10-exercise-8-rate-limiter-using-mutex--atomic-based-counter)
11. [Exercise 9: Middleware chain rebuilt on config change — atomic.Pointer hot swap](#11-exercise-9-middleware-chain-rebuilt-on-config-change--atomicpointer-hot-swap)
12. [Exercise 10: Embedding decorator forwarding 10 methods — direct delegation](#12-exercise-10-embedding-decorator-forwarding-10-methods--direct-delegation)
13. [Exercise 11: Trace decorator creating span per call — sampling](#13-exercise-11-trace-decorator-creating-span-per-call--sampling)
14. [Exercise 12: Buffered writer decorator with small buffers — size for typical payload](#14-exercise-12-buffered-writer-decorator-with-small-buffers--size-for-typical-payload)
15. [When NOT to optimize](#15-when-not-to-optimize)
16. [The optimization checklist](#16-the-optimization-checklist)
17. [Summary](#17-summary)

---

## 3. Exercise 1: Chain built per-request — build once at startup

### Scenario

An HTTP handler is wrapped in a `Chain` helper inside the request handler. Each request rebuilds the entire chain — five closures, five interface boxings, five slice elements. The handler runs at 5k req/s; the chain construction allocates 320 B per request.

### Before

```go
package server

import (
    "log"
    "net/http"
    "time"
)

type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s took %v", r.Method, r.URL.Path, time.Since(start))
    })
}

func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("Authorization") == "" {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}

// Trace and Metrics omitted for brevity — same shape.

var apiHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(200)
})

// Anti-idiom: chain built per request.
func handle(w http.ResponseWriter, r *http.Request) {
    h := Chain(apiHandler, Logging, Recover, Auth, Trace, Metrics)
    h.ServeHTTP(w, r)
}
```

### Benchmark

```go
func BenchmarkPerRequestChain(b *testing.B) {
    b.ReportAllocs()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer xxx")
    rec := httptest.NewRecorder()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        handle(rec, req)
    }
}
```

```
BenchmarkPerRequestChain-8    1_500_000    820 ns/op    640 B/op    11 allocs/op
```

11 allocations per request: one per middleware closure (5), one for the slice backing array (1), one per `http.HandlerFunc` wrapper (5).

<details><summary>After</summary>

Build the chain once at startup. Reuse the `http.Handler` value for every request.

```go
package server

import "net/http"

var serveChain http.Handler

func init() {
    serveChain = Chain(apiHandler, Logging, Recover, Auth, Trace, Metrics)
}

func handle(w http.ResponseWriter, r *http.Request) {
    serveChain.ServeHTTP(w, r)
}
```

Or, more idiomatically, register the wrapped handler with the mux:

```go
func RegisterRoutes(mux *http.ServeMux) {
    chain := Chain(apiHandler, Logging, Recover, Auth, Trace, Metrics)
    mux.Handle("/api", chain)
}
```

```
BenchmarkBootChain-8    30_000_000    42 ns/op    0 B/op    0 allocs/op
```

19× faster, zero allocations.

**Why it's faster.** The closures, the `HandlerFunc` wrappers, and the chain's intermediate slice are allocated once when the program starts. Per request, you pay only the interface dispatches — five of them, ~10 ns total — plus the handler body.

**Trade-off.** Almost none. The chain is statically defined; it can't depend on per-request data. If your "chain" needs to vary by URL pattern, build a *separate* chain per pattern at startup, not a fresh chain per request:

```go
apiChain   := Chain(apiHandler,   Logging, Recover, Auth)
adminChain := Chain(adminHandler, Logging, Recover, Auth, AdminOnly)
mux.Handle("/api",   apiChain)
mux.Handle("/admin", adminChain)
```

The number of chains is bounded by the number of route groups, not by the number of requests.

**When NOT to do this.** If the middleware composition *genuinely* depends on per-request input (rare — usually you can move that decision *inside* a middleware instead of around it), you have to build at request time. But almost every real "varies per request" middleware can be re-expressed as a static middleware that branches internally:

```go
// Instead of choosing Auth or NoAuth per request, use one Auth that no-ops
// when the route is whitelisted.
func Auth(skipPaths []string) Middleware {
    skipSet := make(map[string]struct{}, len(skipPaths))
    for _, p := range skipPaths { skipSet[p] = struct{}{} }
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if _, skip := skipSet[r.URL.Path]; skip {
                next.ServeHTTP(w, r)
                return
            }
            // ... real auth ...
        })
    }
}
```

The skip-set is built once. The decision happens inside the static chain.

**pprof:**

```bash
go test -bench=BenchmarkPerRequestChain -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list handle
```

Before: `Chain`, `Logging`, `Recover`, `Auth` all show as alloc sources — one closure each, plus the slice. After: none of them appear in the steady-state profile.

</details>

---

## 4. Exercise 2: Closure capture in middleware allocating per call

### Scenario

A middleware captures the request's start time and the response writer in a deferred closure to log latency. The closure escapes to the heap because `defer` always allocates a closure on Go ≤ 1.13 and may still allocate on later versions when the defer is in a loop or has uncertain shape. Each request pays one closure allocation (~80 B).

### Before

```go
package middleware

import (
    "log"
    "net/http"
    "time"
)

func LoggingLatency(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        defer func() {
            // Closure captures start, r, w — escapes to heap.
            log.Printf("%s %s took %v (size=%d)",
                r.Method, r.URL.Path, time.Since(start), responseSize(w))
        }()
        next.ServeHTTP(w, r)
    })
}

func responseSize(w http.ResponseWriter) int {
    if sw, ok := w.(*sizingResponseWriter); ok { return sw.size }
    return 0
}
```

### Benchmark

```go
func BenchmarkLoggingLatency(b *testing.B) {
    b.ReportAllocs()
    h := LoggingLatency(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    }))
    req := httptest.NewRequest("GET", "/", nil)
    log.SetOutput(io.Discard)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(httptest.NewRecorder(), req)
    }
}
```

```
BenchmarkLoggingLatency-8    1_000_000    1_280 ns/op    248 B/op    5 allocs/op
```

The 5 allocs: the closure (~48 B), `fmt.Sprintf` formatting buffer (~64 B), the time.Duration → string conversion, the recorder's headers map, the `r.URL.Path` escape.

<details><summary>After</summary>

Eliminate the deferred closure by computing latency inline after `next.ServeHTTP`. The `defer` is only needed if you want logging to fire even when the inner panics — and that's the recovery middleware's job, not the logging middleware's.

```go
package middleware

import (
    "log"
    "net/http"
    "time"
)

func LoggingLatency(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        // No defer — no closure allocation. log.Printf still allocates its
        // format buffer, but the middleware's contribution drops to zero.
        log.Printf("%s %s took %v", r.Method, r.URL.Path, time.Since(start))
    })
}
```

```
BenchmarkLoggingLatency-8    3_000_000    410 ns/op    96 B/op    2 allocs/op
```

3.1× faster, 3 fewer allocations.

**Why it's faster.** Eliminating the deferred closure removes one heap allocation per request. Go's escape analyzer cannot prove the closure doesn't outlive the function (the runtime calls it during defer unwinding, which from the analyzer's perspective is opaque), so the closure escapes.

For an even bigger win, pre-format with `strconv` instead of `fmt`:

```go
import "strconv"

func LoggingLatency(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        elapsed := time.Since(start)
        var buf [128]byte
        b := append(buf[:0], r.Method...)
        b = append(b, ' ')
        b = append(b, r.URL.Path...)
        b = append(b, " took "...)
        b = strconv.AppendInt(b, elapsed.Nanoseconds(), 10)
        b = append(b, "ns\n"...)
        os.Stderr.Write(b)
    })
}
```

```
BenchmarkLoggingLatencyManual-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

20× faster than the original, zero allocations. The `[128]byte` stack buffer never escapes because `os.Stderr.Write` reads it before returning.

**Trade-off.**

1. **Losing the defer means losing the panic-time log.** If `next.ServeHTTP` panics, the `log.Printf` after it never runs. For most apps this is fine — your recovery middleware handles the panic and logs separately. But if logging is *the* observability layer, you want it to fire on panic too. In that case, keep the defer but ensure the closure captures only primitives:

   ```go
   // Capture only `start` (a uint64-sized time.Time on 64-bit platforms,
   // which the compiler often keeps on stack).
   start := time.Now()
   defer logElapsed(start, r.Method, r.URL.Path)  // named function, no closure
   ```

   `logElapsed` is a package-level function, not a closure — it doesn't escape.

2. **Manual byte buffer is fragile.** Tomorrow you want to add a new field; the `append` chain is hostile to changes. Use `fmt` for evolving formats; use `strconv` for stable hot paths.

3. **The stack-buffer trick (`var buf [128]byte`) only works if the data fits.** For long URL paths, you'll silently overflow if you copy without checking length. Either bound the path length or use a slice. Profile first.

**When NOT to do this.** If logging is off in production (most are not), the middleware's whole body is dead weight either way. Use a conditional check before the work:

```go
if !log.Enabled() { next.ServeHTTP(w, r); return }
```

If you only log slow requests (`if elapsed > threshold`), the format cost only matters for the slow ones — leave the simple version.

**pprof:**

```bash
go test -bench=BenchmarkLoggingLatency -gcflags='-m=2' 2>&1 | grep escape
```

Before: `func literal escapes to heap`. After: no closure escape. Combined with `-memprofile`:

```bash
go test -bench=BenchmarkLoggingLatency -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list LoggingLatency
```

The `func()` literal disappears from the alloc list.

</details>

---

## 5. Exercise 3: Deep middleware chain — PGO devirtualization

### Scenario

An internal RPC service stacks twelve middlewares: tracing, metrics, recovery, auth, authz, rate-limit, request-ID, timeout, logging, retry, circuit-breaker, and the terminal handler. At 50k QPS, each request walks all twelve interface dispatches. Each dispatch is ~2 ns; twelve of them is ~24 ns. With PGO, the compiler can devirtualize the hottest path — fast-call the concrete handler when the dynamic type matches.

### Before

```go
package middleware

import (
    "context"
    "net/http"
)

// 12 middlewares, each wrapping http.Handler. The chain is built once at boot.

var chain http.Handler // 12 layers deep

func init() {
    chain = Tracing(Metrics(Recovery(Auth(Authz(RateLimit(RequestID(Timeout(Logging(Retry(CircuitBreaker(terminal)))))))))))
}

func Handle(w http.ResponseWriter, r *http.Request) {
    chain.ServeHTTP(w, r)
}
```

### Benchmark

```go
func BenchmarkDeepChain(b *testing.B) {
    b.ReportAllocs()
    req := httptest.NewRequest("GET", "/rpc", nil)
    req.Header.Set("Authorization", "Bearer xxx")
    rec := httptest.NewRecorder()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        Handle(rec, req)
    }
}
```

```
BenchmarkDeepChain-8    1_500_000    810 ns/op    32 B/op    1 allocs/op
```

810 ns per request, of which roughly 25 ns is dispatch overhead and the remainder is per-middleware work (header lookups, time stamps, atomic increments).

<details><summary>After</summary>

Use Go 1.21+ profile-guided optimization. Capture a profile under representative load, feed it back into the build.

```bash
# 1. Run benchmark with CPU profile.
go test -bench=BenchmarkDeepChain -cpuprofile=cpu.pgo

# 2. Build with PGO enabled.
go build -pgo=cpu.pgo -o server ./cmd/server
```

The compiler reads `cpu.pgo`, sees that `next.ServeHTTP` inside each middleware is overwhelmingly the next middleware in the chain (one concrete type per call site), and emits direct-call fast paths with a fallback for the rare other case.

```
BenchmarkDeepChain-pgo-8    2_400_000    490 ns/op    32 B/op    1 allocs/op
```

1.7× faster, no source change.

**Why it's faster.** Without PGO, every `next.ServeHTTP(w, r)` is an indirect call through the interface table (`itab`). With PGO, the compiler inlines the hot path: it tests whether `next`'s dynamic type matches the dominant one and calls the concrete method directly, skipping the itab dispatch. Direct calls can also be inlined further if the body is small.

For an even bigger win, **flatten the chain** when it's truly hot and the composition is stable:

```go
type FlatHandler struct {
    tracer    *Tracer
    metrics   *MetricsRecorder
    auth      *Authenticator
    authz     *Authorizer
    rateLimit *RateLimiter
    retry     *RetryConfig
    breaker   *CircuitBreaker
    terminal  http.Handler
}

func (h *FlatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Inline what each middleware did, in order. One interface dispatch (terminal).
    span := h.tracer.Start(r.Context(), r.URL.Path)
    defer span.End()

    if err := h.auth.Verify(r); err != nil {
        http.Error(w, "unauthorized", 401)
        return
    }
    if !h.rateLimit.Allow(r) {
        http.Error(w, "rate limited", 429)
        return
    }
    // ... etc ...
    h.terminal.ServeHTTP(w, r)
}
```

```
BenchmarkFlatChain-8    5_000_000    240 ns/op    0 B/op    0 allocs/op
```

3.4× faster than the original, zero allocations.

**Trade-off.**

1. **PGO requires a profile-capture pipeline.** Your CI must produce a representative `cpu.pgo` from staging or production traffic, then feed it back into the production build. This is operational work.
2. **PGO's gains depend on call-site stability.** If different routes use different middleware compositions, the compiler's prediction is less effective.
3. **Flattening collapses composability.** Adding a new middleware means editing `FlatHandler`. The original decorator chain lets you compose by configuration; the flat version forces code changes.
4. **Flattening complicates testing.** Before, you tested each middleware in isolation. After, integration tests must exercise all paths through `FlatHandler` together.

**When NOT to do this.** If your service handles 1k QPS, the 320 ns/request difference is 320 µs/sec — negligible. PGO is worth setting up at scale (>10k QPS sustained) or in libraries that ship the chain to many users. Flattening is justified only when the chain is *hot* and *stable* — usually internal RPC frameworks, never application code.

**pprof:**

```bash
# Before
go test -bench=BenchmarkDeepChain -cpuprofile=cpu.prof
go tool pprof -list 'ServeHTTP$' cpu.prof
```

Before: each middleware's `ServeHTTP` shows as its own frame; `runtime.assertI2I` and `runtime.itab` lookups dominate. After PGO: the hot path's dispatches collapse into direct calls; the profile shows fewer frames and lower CPU.

</details>

---

## 6. Exercise 4: Recovery middleware's defer — eliminate via stack discipline

### Scenario

A recovery middleware uses `defer recover()` on every request to catch handler panics. Panics are rare (< 1 per million requests in a stable service), but the defer fires on every request. Defer's cost on Go 1.20+ is small (~5 ns with open-coded defers) but non-zero, and the closure for the recover function escapes in some patterns. At 100k QPS, 5 ns/request is 500 µs/sec of CPU — not a lot, but visible on a CPU profile.

### Before

```go
package middleware

import (
    "log"
    "net/http"
    "runtime/debug"
)

func Recovery(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v\n%s", rec, debug.Stack())
                http.Error(w, "internal server error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

### Benchmark

```go
func BenchmarkRecovery(b *testing.B) {
    b.ReportAllocs()
    h := Recovery(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    }))
    req := httptest.NewRequest("GET", "/", nil)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(httptest.NewRecorder(), req)
    }
}
```

```
BenchmarkRecovery-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

5 ns is the open-coded defer; the rest is the handler write. Open-coded defers (Go 1.14+) are cheap, but they still emit defer-tracking code in the function prologue/epilogue. The deferred closure does not escape because Go's compiler proves that `recover` doesn't capture the function pointer beyond the call.

**The honest framing.** The "before" here is *already efficient*. The discussion below is about when even 5 ns matters — typically only when you have many short-lived nested handlers in an inner RPC path.

<details><summary>After</summary>

**Path A — Recover at the outermost layer only.**

If you have a deep chain (Exercise 3) and the inner middlewares can't panic except in ways your outermost recovery catches anyway, put recovery only at the top:

```go
chain = Recovery(Tracing(Metrics(... terminalHandler)))
```

The inner middlewares pay zero defer cost. Only the outermost layer's defer fires per request. Net savings: 5 ns × (chain depth - 1) per request.

**Path B — Use HTTP server's built-in panic handling.**

The `net/http` server already catches panics in handler goroutines and closes the connection. If you're OK with a default 500 (no custom logging), don't add recovery middleware at all.

```go
// Trust http.Server's built-in panic protection.
// http.Server logs the panic and aborts the connection automatically.
```

```
BenchmarkNoRecoveryMW-8    50_000_000    24 ns/op    0 B/op    0 allocs/op
```

2.6× faster.

**Path C — A guard goroutine for the entire server.**

For long-lived workers (not request handlers), one top-level recovery goroutine that restarts a panicking worker is enough.

```go
func Run(work func()) {
    for {
        runOnce(work)
    }
}

func runOnce(work func()) {
    defer func() {
        if rec := recover(); rec != nil {
            log.Printf("worker panic: %v", rec)
        }
    }()
    work()
}
```

The defer is per-restart, not per-call. For a worker processing millions of items, the defer overhead is amortized to nothing.

**Why it's faster.** Removing the defer entirely is the obvious win. The defer's 5 ns/call cost vanishes. Inner middlewares benefit from cleaner inlining (Go's escape analyzer is more aggressive when there are no defers).

**Trade-off.**

1. **Path A (outer-only) requires confidence that inner middlewares don't need their own recovery.** If `RateLimit` panics on a bad config, the panic propagates to the outermost recovery — usually fine, but the panic message may lose context about *which* middleware failed.
2. **Path B (no recovery) means handler panics get the default treatment.** `net/http`'s default is to log via `srv.ErrorLog`, hijack the connection, and close it. You get no custom 500 body and no custom logging format. For internal services this is often acceptable; for public APIs you usually want a styled response.
3. **Path C only applies to workers, not request handlers.** Don't confuse "long-lived loop" with "request handler". A request handler must respond per request, so the recovery has to be per-request.

**When NOT to do this.** For ordinary HTTP services at < 10k QPS, the defer cost is invisible. Keep the recovery middleware where it is. The optimization matters when:

- The handler is on a hot inner path (e.g., a per-message handler in a streaming server processing 100k msg/sec).
- Profiling shows `runtime.deferreturn` or `runtime.gopanic` (in the no-panic fast path; older Go versions or non-open-coded defer cases) in the top 5 % CPU.
- You're shipping a framework where users will compose many handlers and the per-defer cost accumulates.

**A non-optimization: don't replace `defer recover()` with manual error-channel patterns.** They're more complex and rarely faster. Trust the defer.

**pprof:**

```bash
go test -bench=BenchmarkRecovery -cpuprofile=cpu.prof
go tool pprof -list 'Recovery$' cpu.prof
```

`runtime.deferreturn` appears in the before profile. After Path A or B, it's gone from the inner middlewares.

A more focused check: compile with `-gcflags=-S` and look for `CALL runtime.deferprocStack` or `CALL runtime.deferreturn`. With open-coded defers (small handlers, no defer-in-loop), you'll see inline code instead.

</details>

---

## 7. Exercise 5: Cache decorator using mutex — switch to sync.Map or RWMutex

### Scenario

A `CachedRepo` decorator wraps a database repository with a TTL cache. The cache uses a `sync.Mutex` to protect a map. Under concurrent reads — the common case for a hot cache — every reader contends on the same mutex. Throughput is bottlenecked by lock acquisition.

### Before

```go
package users

import (
    "context"
    "sync"
    "time"
)

type Repo interface {
    Get(ctx context.Context, id int) (User, error)
}

type CachedRepo struct {
    Inner   Repo
    TTL     time.Duration

    mu      sync.Mutex
    entries map[int]cacheEntry
}

type cacheEntry struct {
    user    User
    expires time.Time
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    c.mu.Lock()
    if e, ok := c.entries[id]; ok && time.Now().Before(e.expires) {
        c.mu.Unlock()
        return e.user, nil
    }
    c.mu.Unlock()

    u, err := c.Inner.Get(ctx, id)
    if err != nil { return User{}, err }

    c.mu.Lock()
    c.entries[id] = cacheEntry{user: u, expires: time.Now().Add(c.TTL)}
    c.mu.Unlock()

    return u, nil
}
```

### Benchmark

```go
func BenchmarkCachedRepoParallel(b *testing.B) {
    b.ReportAllocs()
    c := &CachedRepo{
        Inner: &fakeRepo{},
        TTL:   5 * time.Minute,
        entries: map[int]cacheEntry{},
    }
    // Pre-warm
    for i := 0; i < 100; i++ {
        c.Get(context.Background(), i)
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            c.Get(context.Background(), i%100)
            i++
        }
    })
}
```

```
BenchmarkCachedRepoParallel-8    5_000_000    240 ns/op    0 B/op    0 allocs/op
```

240 ns/op under parallel load on an 8-core machine. The per-call cost is mostly lock contention — `sync.Mutex.Lock` runs ~25 ns uncontended, but under 8-way concurrent traffic the contention can push it to 200+ ns.

<details><summary>After</summary>

**Path A — RWMutex (when reads dominate).**

```go
type CachedRepo struct {
    Inner   Repo
    TTL     time.Duration

    mu      sync.RWMutex
    entries map[int]cacheEntry
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    c.mu.RLock()
    e, ok := c.entries[id]
    c.mu.RUnlock()

    if ok && time.Now().Before(e.expires) {
        return e.user, nil
    }

    u, err := c.Inner.Get(ctx, id)
    if err != nil { return User{}, err }

    c.mu.Lock()
    c.entries[id] = cacheEntry{user: u, expires: time.Now().Add(c.TTL)}
    c.mu.Unlock()

    return u, nil
}
```

```
BenchmarkCachedRepoRWMutex-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

3.9× faster under cache-hit-dominated traffic.

**Path B — sync.Map (when keys are stable, no eviction).**

```go
type CachedRepo struct {
    Inner   Repo
    TTL     time.Duration
    entries sync.Map // map[int]*cacheEntry
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    if v, ok := c.entries.Load(id); ok {
        e := v.(*cacheEntry)
        if time.Now().Before(e.expires) {
            return e.user, nil
        }
    }

    u, err := c.Inner.Get(ctx, id)
    if err != nil { return User{}, err }

    c.entries.Store(id, &cacheEntry{user: u, expires: time.Now().Add(c.TTL)})
    return u, nil
}
```

```
BenchmarkCachedRepoSyncMap-8    40_000_000    32 ns/op    0 B/op    0 allocs/op
```

7.5× faster.

**Why it's faster.**

- `RWMutex` lets multiple readers hold the read lock simultaneously. With 99 % cache hit rate, almost no calls take the write lock; readers don't block each other.
- `sync.Map` uses two internal maps (read-only and dirty), and the read map is accessed lock-free via atomic load. For read-heavy patterns with stable keys, it's essentially lock-free on the hit path.

**Trade-off.**

1. **RWMutex's write-side is slower than `Mutex`.** If your workload is write-heavy (low cache hit rate, frequent reload), `RWMutex` is *worse* than `Mutex`. Profile before switching.
2. **RWMutex has writer starvation potential.** On extremely high read contention (millions of readers/sec), writers can wait indefinitely. Go's `sync.RWMutex` mitigates this (writers signal that readers should yield), but it's not perfect. For extreme write-side latency requirements, look at `sync/atomic.Pointer` for atomic swaps.
3. **`sync.Map` has poor eviction semantics.** There's no `len()`, no iteration with mutation, no TTL. If you need eviction (LRU, size cap), `sync.Map` is the wrong tool. You'll end up writing eviction on top of it, which is error-prone.
4. **`sync.Map` allocates more on `Store` than a plain map.** Each value is wrapped in an internal entry. For high-write workloads, the allocation cost outweighs the lock-free read advantage.
5. **Both still have the thundering-herd problem.** On a cache miss, N readers may all start the inner `Get` simultaneously. Use `singleflight.Group` to dedupe in-flight loads.

```go
import "golang.org/x/sync/singleflight"

type CachedRepo struct {
    Inner   Repo
    TTL     time.Duration
    entries sync.Map
    sf      singleflight.Group
}

func (c *CachedRepo) Get(ctx context.Context, id int) (User, error) {
    if v, ok := c.entries.Load(id); ok {
        e := v.(*cacheEntry)
        if time.Now().Before(e.expires) {
            return e.user, nil
        }
    }
    // Only one goroutine calls Inner.Get(id) at a time.
    key := strconv.Itoa(id)
    v, err, _ := c.sf.Do(key, func() (interface{}, error) {
        u, err := c.Inner.Get(ctx, id)
        if err != nil { return nil, err }
        c.entries.Store(id, &cacheEntry{user: u, expires: time.Now().Add(c.TTL)})
        return u, nil
    })
    if err != nil { return User{}, err }
    return v.(User), nil
}
```

**When NOT to do this.** If the cache is single-threaded (one goroutine accesses it), `sync.Mutex` is correct and fast. Switching to `RWMutex` or `sync.Map` adds complexity without benefit. Also: don't use `sync.Map` as a general-purpose map; its API is awkward and it's slower than a plain map for non-concurrent or write-heavy use.

**pprof:**

```bash
go test -bench=BenchmarkCachedRepoParallel -cpuprofile=cpu.prof -mutexprofile=mutex.prof
go tool pprof mutex.prof
(pprof) top
```

Before: `sync.(*Mutex).Lock` dominates the mutex profile. After RWMutex: `sync.(*RWMutex).RLock` shows, but contention is much lower. After sync.Map: the mutex profile is empty on the read path.

</details>

---

## 8. Exercise 6: Logging decorator with fmt.Sprintf — structured logger

### Scenario

A logging decorator formats every field with `fmt.Sprintf("user=%d action=%s amount=%d", userID, action, amount)`. The Sprintf allocates a buffer, walks the format string, boxes each argument into an `interface{}`. At thousands of logs per second, this is the largest source of allocations in the service.

### Before

```go
package middleware

import (
    "fmt"
    "log"
)

type LoggingCharger struct {
    Inner Charger
}

func (l *LoggingCharger) Charge(ctx context.Context, userID int, action string, amount int) error {
    log.Printf("user=%d action=%s amount=%d started", userID, action, amount)
    err := l.Inner.Charge(ctx, userID, action, amount)
    if err != nil {
        log.Printf("user=%d action=%s amount=%d failed err=%v", userID, action, amount, err)
        return err
    }
    log.Printf("user=%d action=%s amount=%d ok", userID, action, amount)
    return nil
}
```

### Benchmark

```go
func BenchmarkLoggingChargerFmt(b *testing.B) {
    b.ReportAllocs()
    log.SetOutput(io.Discard)
    l := &LoggingCharger{Inner: &noopCharger{}}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = l.Charge(context.Background(), 42, "purchase", 1000)
    }
}
```

```
BenchmarkLoggingChargerFmt-8    1_000_000    1_320 ns/op    192 B/op    8 allocs/op
```

Each `log.Printf` allocates: the format buffer (64 B), one `interface{}` box per argument (3 × 16 B), and the `time.Now().String()` for the log timestamp.

<details><summary>After</summary>

Use a zerolog-style structured logger that appends typed values without reflection.

```go
package middleware

import (
    "context"
    "github.com/rs/zerolog"
)

type LoggingCharger struct {
    Inner  Charger
    Logger zerolog.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, userID int, action string, amount int) error {
    l.Logger.Info().
        Int("user", userID).
        Str("action", action).
        Int("amount", amount).
        Msg("started")

    err := l.Inner.Charge(ctx, userID, action, amount)
    if err != nil {
        l.Logger.Error().
            Int("user", userID).
            Str("action", action).
            Int("amount", amount).
            Err(err).
            Msg("failed")
        return err
    }

    l.Logger.Info().
        Int("user", userID).
        Str("action", action).
        Int("amount", amount).
        Msg("ok")
    return nil
}
```

```
BenchmarkLoggingChargerZerolog-8    10_000_000    120 ns/op    0 B/op    0 allocs/op
```

11× faster, zero allocations.

**Why it's faster.** Zerolog builds the log entry in a pooled byte buffer with typed `Append` calls — no `interface{}` boxing, no `fmt` format parsing, no per-call buffer allocation (buffers come from a `sync.Pool`). The output is JSON, written in a single `Write` call.

Go's standard `log/slog` (Go 1.21+) achieves similar performance with the structured-logging API:

```go
import "log/slog"

logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))

logger.Info("started",
    "user", userID,
    "action", action,
    "amount", amount)
```

```
BenchmarkLoggingChargerSlog-8    5_000_000    240 ns/op    16 B/op    1 allocs/op
```

2-3× slower than zerolog (slog has overhead from its general-purpose handler), but still 5× faster than `fmt.Printf` and now in the standard library.

**Trade-off.**

1. **JSON output is harder to read in `tail -f`.** Use a pretty-printer like `jq` or `pino-pretty`-style tools. For local dev, configure a text handler; for production, JSON.
2. **The structured API is more verbose.** Three `.Int("user", userID).Str("action", action)` calls vs one `fmt.Sprintf`. In hot code paths the verbosity is worth it.
3. **Adding fields to one call site forces touching code everywhere they're emitted.** Use a context-bound logger to attach common fields once:

   ```go
   reqLog := l.Logger.With().Int("user", userID).Str("action", action).Logger()
   reqLog.Info().Msg("started")
   // ... later
   reqLog.Error().Err(err).Msg("failed")
   ```

4. **Zerolog requires a dependency.** `slog` is in the standard library — prefer it unless you've already standardized on zerolog or `zap`.

**Variant: sampled logging for ultra-hot paths.** If the log call itself is the bottleneck (e.g., one per packet in a network stack), sample:

```go
if rand.Intn(1000) == 0 {
    l.Logger.Info().Int("user", userID).Msg("sampled")
}
```

Sampling at 1-in-1000 reduces the per-call cost to ~1 ns on average.

**When NOT to do this.** If logging is gated by level checks (`if !log.IsDebugEnabled()`) and only fires for errors, the per-call cost on the happy path is already minimal. The format cost only matters for *every-call* logging, which is itself a code smell — consider whether you need all those logs.

**pprof:**

```bash
go test -bench=BenchmarkLoggingChargerFmt -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) top
```

Before: `fmt.Sprintf`, `runtime.convT64`, `runtime.convTstring`, `runtime.newobject` dominate the allocation profile. After zerolog: the alloc profile is essentially empty on the log path.

</details>

---

## 9. Exercise 7: Metrics decorator with HistogramVec — pre-compute labels

### Scenario

A metrics decorator records request latency to a Prometheus `HistogramVec`. Each call does `histogram.WithLabelValues(method, status).Observe(elapsed)`. `WithLabelValues` looks up the labels in a sync.Map keyed by the joined label strings — a hash + string-join on every observation. At high QPS this is a measurable fraction of the per-request cost.

### Before

```go
package middleware

import (
    "net/http"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

var requestLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Buckets: prometheus.DefBuckets,
}, []string{"method", "status"})

type sizingResponseWriter struct {
    http.ResponseWriter
    status int
}

func (s *sizingResponseWriter) WriteHeader(c int) {
    s.status = c
    s.ResponseWriter.WriteHeader(c)
}

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        sw := &sizingResponseWriter{ResponseWriter: w, status: 200}
        start := time.Now()
        next.ServeHTTP(sw, r)
        // Per-call: hash label values, look up histogram, observe.
        requestLatency.WithLabelValues(r.Method, strconv.Itoa(sw.status)).Observe(time.Since(start).Seconds())
    })
}
```

### Benchmark

```go
func BenchmarkMetricsMiddleware(b *testing.B) {
    b.ReportAllocs()
    h := Metrics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    }))
    req := httptest.NewRequest("GET", "/", nil)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(httptest.NewRecorder(), req)
    }
}
```

```
BenchmarkMetricsMiddleware-8    1_500_000    810 ns/op    96 B/op    4 allocs/op
```

The allocations: the `sizingResponseWriter`, the `strconv.Itoa` result, the `WithLabelValues` lookup's intermediate slice, and the `Observe` value-receiver copy.

<details><summary>After</summary>

Pre-compute the observers for the common (method, status) pairs at startup. Look up the histogram object directly via a small in-memory map.

```go
package middleware

import (
    "net/http"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

var requestLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Buckets: prometheus.DefBuckets,
}, []string{"method", "status"})

// Pre-resolved observers keyed by (method, status). The status is folded into
// buckets to keep the key space small: 2xx, 3xx, 4xx, 5xx.
var observers = map[string]prometheus.Observer{}

func init() {
    methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}
    statusBuckets := []string{"2xx", "3xx", "4xx", "5xx"}
    for _, m := range methods {
        for _, s := range statusBuckets {
            observers[m+s] = requestLatency.WithLabelValues(m, s)
        }
    }
}

func statusBucket(code int) string {
    switch code / 100 {
    case 2: return "2xx"
    case 3: return "3xx"
    case 4: return "4xx"
    case 5: return "5xx"
    }
    return "unknown"
}

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        sw := &sizingResponseWriter{ResponseWriter: w, status: 200}
        start := time.Now()
        next.ServeHTTP(sw, r)

        // O(1) map lookup, no string conversion of the status code.
        if obs, ok := observers[r.Method+statusBucket(sw.status)]; ok {
            obs.Observe(time.Since(start).Seconds())
        } else {
            // Cold path — uncommon method or status.
            requestLatency.WithLabelValues(r.Method, statusBucket(sw.status)).Observe(time.Since(start).Seconds())
        }
    })
}
```

```
BenchmarkMetricsMiddlewareCached-8    5_000_000    240 ns/op    32 B/op    1 allocs/op
```

3.4× faster, 3 fewer allocations.

**Why it's faster.**

- Pre-computing the observer eliminates the `WithLabelValues` lookup (which internally hashes the label values and walks a `sync.Map`).
- Bucketing the status (2xx, 3xx, etc.) reduces cardinality from ~50 status codes to 4 buckets — small key space fits in CPU cache.
- The string concat `r.Method + statusBucket(sw.status)` is one allocation; for the common methods Go's compiler interns the result. Pre-computing observer keys at init time means lookups hit a small hash table.

**An even better variant — avoid the string concat.**

```go
// Lookup keyed by [method][bucket] (two-level map, no string alloc).
var observersByMethod = map[string]map[string]prometheus.Observer{}

func init() {
    methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}
    statusBuckets := []string{"2xx", "3xx", "4xx", "5xx"}
    for _, m := range methods {
        observersByMethod[m] = map[string]prometheus.Observer{}
        for _, s := range statusBuckets {
            observersByMethod[m][s] = requestLatency.WithLabelValues(m, s)
        }
    }
}

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        sw := &sizingResponseWriter{ResponseWriter: w, status: 200}
        start := time.Now()
        next.ServeHTTP(sw, r)
        if byStatus, ok := observersByMethod[r.Method]; ok {
            if obs, ok := byStatus[statusBucket(sw.status)]; ok {
                obs.Observe(time.Since(start).Seconds())
                return
            }
        }
        // Cold fallback.
    })
}
```

```
BenchmarkMetricsMiddlewareTwoLevel-8    8_000_000    140 ns/op    16 B/op    1 allocs/op
```

5.8× faster than the original. The remaining 16 B is the `sizingResponseWriter` allocation, which we can pool:

```go
var swPool = sync.Pool{
    New: func() any { return &sizingResponseWriter{} },
}

func Metrics(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        sw := swPool.Get().(*sizingResponseWriter)
        sw.ResponseWriter = w
        sw.status = 200
        defer swPool.Put(sw)

        start := time.Now()
        next.ServeHTTP(sw, r)
        // ... lookup and observe ...
    })
}
```

```
BenchmarkMetricsMiddlewarePooled-8    12_000_000    95 ns/op    0 B/op    0 allocs/op
```

8.5× faster, zero allocations.

**Trade-off.**

1. **Cardinality must be bounded for pre-computation.** Method × bucket = 7 × 4 = 28 entries — fine. Method × full status code × URL pattern = thousands, blows up. Don't pre-compute high-cardinality combinations; just look them up.
2. **Bucketing the status code loses detail.** Your dashboards can no longer distinguish 404 from 400. If you need that, pre-compute the common codes only (200, 404, 500) and fall back for the rest.
3. **`sync.Pool` for the response writer requires the pool to be safe under panic.** Use `defer pool.Put(sw)` so the writer returns to the pool even on panic.
4. **The two-level map is mutable in theory.** Don't add entries after init. If you need dynamic methods, build the cold path correctly and accept the per-call lookup.

**When NOT to do this.** If you have < 1k QPS, the per-call `WithLabelValues` overhead is invisible. Also: if your label cardinality is unbounded (e.g., labels include user IDs), pre-computation doesn't apply — your metrics setup is broken in a different way.

**pprof:**

```bash
go test -bench=BenchmarkMetricsMiddleware -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof -list 'Metrics$' cpu.prof
```

Before: `(*MetricVec).GetMetricWithLabelValues`, `hashAdd`, `sync.(*Map).Load` dominate. After: only the map lookup and `Observer.Observe` remain.

</details>

---

## 10. Exercise 8: Rate limiter using mutex — atomic-based counter

### Scenario

A rate-limit decorator uses a `sync.Mutex` around a token-bucket counter. Each call locks, decrements, unlocks. Under high QPS the mutex becomes the throughput limit — the rate limiter itself is the bottleneck, not the rate it's enforcing.

### Before

```go
package middleware

import (
    "context"
    "errors"
    "sync"
    "time"
)

type RateLimit struct {
    Inner    Charger

    mu       sync.Mutex
    tokens   int
    capacity int
    refillAt time.Time
    rate     int // tokens per second
}

var ErrRateLimited = errors.New("rate limited")

func (r *RateLimit) Charge(ctx context.Context, amount int) error {
    r.mu.Lock()
    now := time.Now()
    elapsed := now.Sub(r.refillAt)
    refill := int(elapsed.Seconds()) * r.rate
    if refill > 0 {
        r.tokens += refill
        if r.tokens > r.capacity { r.tokens = r.capacity }
        r.refillAt = now
    }
    if r.tokens <= 0 {
        r.mu.Unlock()
        return ErrRateLimited
    }
    r.tokens--
    r.mu.Unlock()
    return r.Inner.Charge(ctx, amount)
}
```

### Benchmark

```go
func BenchmarkRateLimitMutex(b *testing.B) {
    b.ReportAllocs()
    r := &RateLimit{
        Inner: &noopCharger{},
        tokens: 1_000_000_000,
        capacity: 1_000_000_000,
        refillAt: time.Now(),
        rate: 1_000_000,
    }
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = r.Charge(context.Background(), 100)
        }
    })
}
```

```
BenchmarkRateLimitMutex-8    8_000_000    180 ns/op    0 B/op    0 allocs/op
```

180 ns/op under parallel load on 8 cores. The mutex is the bottleneck — uncontended mutex is 25 ns, but with 8 cores hammering the same lock it's 180 ns.

<details><summary>After</summary>

Token bucket using `atomic.Int64`. A single CAS replaces the lock.

```go
package middleware

import (
    "context"
    "errors"
    "sync/atomic"
    "time"
)

type RateLimit struct {
    Inner    Charger

    tokens   atomic.Int64  // current token count
    capacity int64
    rate     int64         // tokens per nanosecond × 1e9 — store as nano units
    lastNs   atomic.Int64  // last refill time, monotonic nanos
}

func NewRateLimit(inner Charger, capacity int64, ratePerSec int64) *RateLimit {
    r := &RateLimit{
        Inner:    inner,
        capacity: capacity,
        rate:     ratePerSec,
    }
    r.tokens.Store(capacity)
    r.lastNs.Store(time.Now().UnixNano())
    return r
}

func (r *RateLimit) Charge(ctx context.Context, amount int) error {
    nowNs := time.Now().UnixNano()
    lastNs := r.lastNs.Swap(nowNs)
    // Refill: tokens to add = rate * (now - last) / 1e9
    refill := r.rate * (nowNs - lastNs) / 1_000_000_000
    if refill > 0 {
        // Add refill, cap at capacity.
        for {
            cur := r.tokens.Load()
            next := cur + refill
            if next > r.capacity { next = r.capacity }
            if r.tokens.CompareAndSwap(cur, next) { break }
        }
    }
    // Take one token if available.
    for {
        cur := r.tokens.Load()
        if cur <= 0 { return ErrRateLimited }
        if r.tokens.CompareAndSwap(cur, cur-1) { break }
    }
    return r.Inner.Charge(ctx, amount)
}
```

```
BenchmarkRateLimitAtomic-8    50_000_000    32 ns/op    0 B/op    0 allocs/op
```

5.6× faster under parallel load.

**Why it's faster.** No mutex, no goroutine parking. The CAS loop spins for a few cycles in the rare contention case but doesn't put the goroutine to sleep. Under N-way concurrent traffic, the CAS only contends pairwise — readers don't block readers, only those CAS-ing on the same counter at the same time briefly retry.

**Alternative: `golang.org/x/time/rate` (which uses atomic internally).**

```go
import "golang.org/x/time/rate"

type RateLimit struct {
    Inner   Charger
    limiter *rate.Limiter
}

func (r *RateLimit) Charge(ctx context.Context, amount int) error {
    if !r.limiter.Allow() {
        return ErrRateLimited
    }
    return r.Inner.Charge(ctx, amount)
}
```

```
BenchmarkRateLimitXTime-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

2.9× faster than the mutex version. Slower than the hand-rolled atomic because `rate.Limiter` uses a mutex internally for the bucket update (it accepts the contention as the price of correctness — it handles edge cases the hand-rolled version glosses over).

**Trade-off.**

1. **The atomic version has subtle correctness issues.** Concurrent refills can over-credit if multiple goroutines compute refill from the same `lastNs`. The `Swap` mitigates this (only one wins), but a goroutine that loses the Swap may still apply its own refill against the new `lastNs`. The fix is more careful sequencing or a single-writer model.
2. **The atomic version doesn't support burst grace, jitter, or distributed rate limits.** `rate.Limiter` does (well, the burst at least). If you need anything beyond a simple token bucket, use `rate.Limiter`.
3. **Atomic CAS spinning under heavy contention burns CPU.** Mutex parking is more polite to other goroutines. Profile under your actual load to verify the atomic version's contention is light.
4. **The `int64` token count is bounded.** For ridiculously high rates (1 billion tokens/sec), you'll overflow. Use a smaller unit (e.g., refill in microseconds, not nanoseconds).

**When NOT to do this.** For per-user rate limits (one limiter per user), each limiter is uncontended — the mutex version is fine. The atomic optimization matters only for a *single shared limiter* hit by all traffic.

**A trap to avoid: don't use channels as rate limiters.**

```go
// Anti-idiom: a "rate limiter" using a buffered channel + ticker.
type RateLimit struct {
    Inner  Charger
    tokens chan struct{}
}

func (r *RateLimit) Charge(...) error {
    select {
    case <-r.tokens:
        return r.Inner.Charge(...)
    default:
        return ErrRateLimited
    }
}
```

Channel sends are ~50 ns each — slower than atomic CAS. And the refill goroutine adds a permanent goroutine. The atomic version is faster and simpler.

**pprof:**

```bash
go test -bench=BenchmarkRateLimitMutex -mutexprofile=mutex.prof
go tool pprof mutex.prof
(pprof) top
```

Before: `RateLimit.Charge` shows as the dominant mutex contention site. After atomic: the mutex profile is empty.

</details>

---

## 11. Exercise 9: Middleware chain rebuilt on config change — atomic.Pointer hot swap

### Scenario

A middleware stack is parameterized by config (rate limits, auth providers, feature flags). When config changes, the service rebuilds the chain and replaces it. The naïve implementation uses a mutex around the chain pointer; readers (request handlers) acquire it on every request. Under high QPS the read-lock dominates.

### Before

```go
package server

import (
    "net/http"
    "sync"
)

type Server struct {
    mu    sync.RWMutex
    chain http.Handler
}

func (s *Server) Reload(cfg Config) {
    newChain := buildChain(cfg)
    s.mu.Lock()
    s.chain = newChain
    s.mu.Unlock()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    s.mu.RLock()
    h := s.chain
    s.mu.RUnlock()
    h.ServeHTTP(w, r)
}
```

### Benchmark

```go
func BenchmarkRWMutexChain(b *testing.B) {
    b.ReportAllocs()
    s := &Server{chain: buildChain(defaultCfg)}
    req := httptest.NewRequest("GET", "/", nil)
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            s.ServeHTTP(httptest.NewRecorder(), req)
        }
    })
}
```

```
BenchmarkRWMutexChain-8    10_000_000    120 ns/op    0 B/op    0 allocs/op
```

120 ns/op. Most of that is the `RLock` + `RUnlock` pair, which involves atomic counters and (under contention) memory barriers.

<details><summary>After</summary>

Use `atomic.Pointer[http.Handler]`. The read path is a single atomic load — no lock, no counter, no memory barrier beyond what the CPU provides.

```go
package server

import (
    "net/http"
    "sync/atomic"
)

type Server struct {
    chain atomic.Pointer[handlerHolder]
}

type handlerHolder struct {
    h http.Handler
}

func NewServer(cfg Config) *Server {
    s := &Server{}
    s.chain.Store(&handlerHolder{h: buildChain(cfg)})
    return s
}

func (s *Server) Reload(cfg Config) {
    s.chain.Store(&handlerHolder{h: buildChain(cfg)})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    s.chain.Load().h.ServeHTTP(w, r)
}
```

```
BenchmarkAtomicPointerChain-8    50_000_000    32 ns/op    0 B/op    0 allocs/op
```

3.75× faster.

**Why it's faster.** `atomic.Pointer.Load` is a single MOV instruction on amd64 (an acquire-load). No counter increment, no contention, no kernel involvement. The chain swap on `Store` is also a single instruction.

The `handlerHolder` wrapper exists because `atomic.Pointer[T]` requires `T` to be a concrete type, but `http.Handler` is an interface. Wrapping it in a struct gives us a concrete pointer to swap.

**Trade-off.**

1. **Reload installs the new chain immediately for the next call.** In-flight requests still use the old chain (correct — they shouldn't be disrupted mid-flight). If you need to wait for in-flight to drain, add a `WaitGroup`.
2. **The old chain may still be referenced by in-flight requests.** GC won't reclaim it until they finish. If the old chain holds large resources (DB pools, caches), they live until the last in-flight request completes. Usually fine.
3. **Concurrent reloads can race in subtle ways.** Two `Reload` calls both build a chain; the second `Store` wins. The first chain's resources are GC'd. If chain construction has side effects (open files, register metrics), the loser still leaves those side effects behind. Serialize reload calls if construction is non-idempotent.
4. **The `handlerHolder` wrapper adds one pointer dereference.** Negligible (~0.5 ns).

**Variant: triple-buffered swap.**

For chains so expensive to build that you want to overlap construction with use:

```go
type Server struct {
    chain    atomic.Pointer[handlerHolder]
    building atomic.Bool
}

func (s *Server) Reload(cfg Config) error {
    if !s.building.CompareAndSwap(false, true) {
        return errors.New("already reloading")
    }
    defer s.building.Store(false)
    newChain := buildChain(cfg) // expensive
    s.chain.Store(&handlerHolder{h: newChain})
    return nil
}
```

The CAS ensures only one builder runs at a time. Requests see the old chain throughout.

**Variant: per-route chain with atomic per route.**

```go
type Router struct {
    routes sync.Map // map[string]*atomic.Pointer[handlerHolder]
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    v, ok := r.routes.Load(req.URL.Path)
    if !ok { http.NotFound(w, req); return }
    v.(*atomic.Pointer[handlerHolder]).Load().h.ServeHTTP(w, req)
}
```

Each route's chain can be reloaded independently. Cold lookup (sync.Map) is per-route; hot lookup (atomic load) is per-request.

**When NOT to do this.** If reloads happen at most once per minute and the QPS is low, the RWMutex version is fine. The atomic.Pointer optimization only matters when (a) reads dominate and (b) the read cost shows up in profiles.

**A trap to avoid: don't store interface values in atomic.Value directly.**

```go
// Anti-idiom: atomic.Value with mismatched concrete types.
var chain atomic.Value // can panic on Store if types differ
chain.Store(http.HandlerFunc(handlerA))
chain.Store(otherType)  // panics: store of inconsistently typed value
```

`atomic.Value` requires the same concrete type on every Store. With `atomic.Pointer[T]` (generic, Go 1.19+), the type is enforced at compile time. Prefer the generic version.

**pprof:**

```bash
go test -bench=BenchmarkRWMutexChain -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) list ServeHTTP
```

Before: `sync.(*RWMutex).RLock`, `sync.(*RWMutex).RUnlock`, atomic increments dominate. After: only `Load` and the chain dispatch.

</details>

---

## 12. Exercise 10: Embedding decorator forwarding 10 methods — direct delegation

### Scenario

A storage interface has 10 methods. A logging decorator embeds the interface and overrides only `Read` — the other 9 methods are forwarded through the embedded interface. Each forwarded call costs an extra interface dispatch (~2 ns). On a hot path that exercises all 10 methods, the overhead adds up.

### Before

```go
package storage

import (
    "context"
    "log"
)

type Storage interface {
    Read(ctx context.Context, key string) ([]byte, error)
    Write(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
    List(ctx context.Context, prefix string) ([]string, error)
    Lock(ctx context.Context, key string) error
    Unlock(ctx context.Context, key string) error
    Subscribe(ctx context.Context, prefix string) (<-chan Event, error)
    Stats(ctx context.Context) (Statistics, error)
    Snapshot(ctx context.Context) error
    Restore(ctx context.Context, id string) error
}

type LoggingStorage struct {
    Storage             // embedded — methods are promoted
    Log *log.Logger
}

// Only Read is decorated. The other 9 forward through embedded Storage.
func (l *LoggingStorage) Read(ctx context.Context, key string) ([]byte, error) {
    l.Log.Printf("Read: %s", key)
    return l.Storage.Read(ctx, key)
}
```

### Benchmark

```go
func BenchmarkEmbeddedForward(b *testing.B) {
    b.ReportAllocs()
    inner := &diskStorage{...}
    l := &LoggingStorage{Storage: inner, Log: log.New(io.Discard, "", 0)}
    ctx := context.Background()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        // Hot path uses Write (not decorated, forwarded).
        _ = l.Write(ctx, "key", []byte("value"))
    }
}
```

```
BenchmarkEmbeddedForward-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

The 62 ns is the inner disk-storage `Write` plus two interface dispatches: one to call `Write` on `*LoggingStorage` (which promotes from `Storage`), and one inside that promoted method to call `Storage.Write` on the embedded interface.

<details><summary>After</summary>

If only one method needs decoration, drop the embedding and forward 9 methods by hand. The "verbose" version has *one fewer interface dispatch per non-decorated call* because the wrapper holds a concrete type.

Actually — the cleanest fix is different. Embedding an *interface* incurs the dispatch. Embedding a *concrete pointer* doesn't:

```go
type LoggingStorage struct {
    inner *diskStorage // concrete type — no interface dispatch
    Log   *log.Logger
}

// Forward 9 methods explicitly. Each is a direct call.
func (l *LoggingStorage) Write(ctx context.Context, key string, value []byte) error {
    return l.inner.Write(ctx, key, value)
}
func (l *LoggingStorage) Delete(ctx context.Context, key string) error {
    return l.inner.Delete(ctx, key)
}
// ... etc for 7 more ...

func (l *LoggingStorage) Read(ctx context.Context, key string) ([]byte, error) {
    l.Log.Printf("Read: %s", key)
    return l.inner.Read(ctx, key)
}
```

```
BenchmarkDirectForward-8    35_000_000    32 ns/op    0 B/op    0 allocs/op
```

1.9× faster.

**Why it's faster.** Concrete-type method calls compile to direct calls. The compiler can inline them. With an embedded interface, every "forwarded" call goes through the itab — even though the wrapper itself doesn't *do* anything for that method.

**An alternative: embed the interface but type-assert to concrete.** Doesn't help — the type assertion costs as much as a dispatch.

**A second alternative: generics.**

```go
type LoggingStorage[S Storage] struct {
    inner S
    Log   *log.Logger
}

func (l *LoggingStorage[S]) Write(ctx context.Context, key string, value []byte) error {
    return l.inner.Write(ctx, key, value)
}
// ... etc ...

func (l *LoggingStorage[S]) Read(ctx context.Context, key string) ([]byte, error) {
    l.Log.Printf("Read: %s", key)
    return l.inner.Read(ctx, key)
}
```

```
BenchmarkGenericForward-8    35_000_000    33 ns/op    0 B/op    0 allocs/op
```

Same performance as direct delegation, but the wrapper works for any `Storage` (not just `*diskStorage`). The catch: each instantiation produces a new type, so you can't store a heterogeneous slice of `LoggingStorage[T]`.

**Trade-off.**

1. **Direct delegation is more code.** 9 forwarders, each ~3 lines. Embedding is 1 line. For a 10-method interface, you're adding ~30 lines for a 30 ns/call savings.
2. **Direct delegation locks in the concrete type.** If you later want `LoggingStorage` to work over both `*diskStorage` and `*s3Storage`, you have to template or interface-ize. The generic variant solves this at the cost of compile-time complexity.
3. **Maintenance burden.** Add a method to `Storage`, you must add it to `LoggingStorage` (or remove the line). The embedded version inherits the new method automatically — sometimes good, sometimes silently wrong (the new method should probably be logged too).
4. **Code generation can mitigate the boilerplate.** Tools like `go generate` with a templates can emit forwarders. For 10-method interfaces this is overkill; for 50-method interfaces (database/sql.DB style) it's essential.

**When NOT to do this.** If only `Read` is on the hot path and the other methods are called rarely, the embedding is fine. The optimization only matters when *the forwarded methods themselves are hot* — which is the unusual case. The typical case is the decorator method (`Read`) is hot, and the forwarded methods are cold; optimization is unnecessary.

**A trap to avoid: don't drop the interface entirely.**

```go
// Anti-idiom: LoggingStorage no longer satisfies Storage.
type LoggingStorage struct {
    inner *diskStorage
    Log   *log.Logger
}

func (l *LoggingStorage) Read(...) ([]byte, error) { ... }
// (no Write, Delete, etc — caller can't use it as a Storage)
```

If the consumer expects `Storage`, the wrapper must implement *all* methods. Drop a method and the compiler refuses to substitute it. The "fast" version still implements all 10 — it just calls the concrete `inner` directly.

**pprof:**

```bash
go test -bench=BenchmarkEmbeddedForward -cpuprofile=cpu.prof
go tool pprof -list 'Write$' cpu.prof
```

Before: `runtime.assertI2I` shows in the call graph. After: direct call to `diskStorage.Write`.

</details>

---

## 13. Exercise 11: Trace decorator creating span per call — sampling

### Scenario

A tracing decorator creates a span for every request, even though only 1 % of traces are kept. Span creation involves a UUID generation, attribute allocation, and exporter notification — typically ~500 ns per span. At 100k QPS, this is 50 ms/sec of CPU spent on spans that are discarded.

### Before

```go
package middleware

import (
    "net/http"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("server")

func Tracing(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, span := tracer.Start(r.Context(), r.URL.Path,
            trace.WithAttributes(
                attribute.String("method", r.Method),
                attribute.String("user_agent", r.UserAgent()),
            ),
        )
        defer span.End()
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Benchmark

```go
func BenchmarkTracing(b *testing.B) {
    b.ReportAllocs()
    h := Tracing(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    }))
    req := httptest.NewRequest("GET", "/api", nil)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        h.ServeHTTP(httptest.NewRecorder(), req)
    }
}
```

```
BenchmarkTracing-8    500_000    2_400 ns/op    1_120 B/op   14 allocs/op
```

The full span pipeline: UUID gen, attribute slice alloc, exporter call (no-op when sampled out, but still invoked), context.WithValue chain.

<details><summary>After</summary>

Sample at the decorator level, *before* paying span creation costs. Only create spans for sampled requests.

```go
package middleware

import (
    "hash/maphash"
    "net/http"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/trace"
)

var (
    tracer    = otel.Tracer("server")
    sampleRate = uint64(100) // 1 in 100
    seed      = maphash.MakeSeed()
)

func shouldSample(r *http.Request) bool {
    // Use the trace-parent header for distributed consistency; fall back to a hash.
    if tp := r.Header.Get("traceparent"); tp != "" {
        // Decisions are propagated by the W3C trace context header.
        return tracecontextSampled(tp)
    }
    // Local decision: hash a stable request identifier.
    var h maphash.Hash
    h.SetSeed(seed)
    h.WriteString(r.URL.Path)
    h.WriteString(r.RemoteAddr)
    return h.Sum64()%sampleRate == 0
}

func Tracing(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !shouldSample(r) {
            next.ServeHTTP(w, r)
            return
        }
        ctx, span := tracer.Start(r.Context(), r.URL.Path,
            trace.WithAttributes(
                attribute.String("method", r.Method),
                attribute.String("user_agent", r.UserAgent()),
            ),
        )
        defer span.End()
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

```
BenchmarkTracingSampled-8    8_000_000    140 ns/op    16 B/op    1 allocs/op
```

17× faster on average (one in 100 requests pays the full span cost; the rest pay only the hash check).

**Why it's faster.** 99 % of requests don't create a span. The sampling check is a hash + modulo, ~30 ns. The 1 % that do sample still pay the full cost (2.4 µs), but the *average* per-request cost is `0.99 × 30 + 0.01 × 2400 ≈ 54 ns` of tracing overhead.

The hash uses a process-local seed so sampling decisions are consistent within a process (helpful for debugging — the same path always either samples or doesn't from one process). For distributed consistency, defer to the upstream trace decision via the `traceparent` header.

**Trade-off.**

1. **You lose 99 % of trace detail.** Tail-latency outliers might not be sampled. If you need to debug a specific slow request, you won't have a trace for it.
2. **Sampling decisions are non-trivial.** Constant-rate (1 in N) is the easiest. Adaptive sampling (sample more when error rate is high) needs feedback. Head-vs-tail sampling is a different architecture (collect-everything-then-discard vs decide-at-source).
3. **The sampling decision must match the exporter's expectation.** If you sample at the decorator but the exporter also samples, you get 1-in-N×N. Configure one or the other, not both.
4. **Local hash sampling diverges from upstream.** Two services with different seeds may make different sampling decisions for the same trace. Use the `traceparent` header to inherit the parent's decision.

**Variant: dynamic sampling rate.**

```go
var sampleRate atomic.Uint64

func init() { sampleRate.Store(100) }

func SetSampleRate(rate uint64) { sampleRate.Store(rate) }

func shouldSample(r *http.Request) bool {
    rate := sampleRate.Load()
    if rate <= 1 { return true }
    // ... hash logic ...
    return h.Sum64()%rate == 0
}
```

An ops control plane can crank up sampling during incidents (`SetSampleRate(1)` = all traces) without redeploying.

**Variant: head-based sampling with tail review.**

Sample *everything* into a ring buffer, drop after a few seconds unless flagged. Spans only export if a downstream signal (error, slow latency) marks them interesting. More complex; needs a separate collector.

**When NOT to do this.** If your trace exporter is OpenTelemetry's batched-OTLP exporter with rate limiting *built in*, the exporter already drops most spans — you're just paying creation cost for spans the exporter throws away. In that case, the decorator-level sampling cuts the creation cost too. If your traces are essential for compliance (every transaction must be traced), don't sample at all.

**A trap to avoid: don't put expensive attribute computation inside `WithAttributes` for non-sampled spans.**

```go
// Anti-idiom: expensive computation runs even when not sampled.
ctx, span := tracer.Start(r.Context(), r.URL.Path,
    trace.WithAttributes(
        attribute.String("body_hash", computeExpensiveHash(r)),
    ),
)
```

If `computeExpensiveHash` runs before `tracer.Start` decides not to sample, you've paid the cost for nothing. Either move it inside an `if span.IsRecording() { span.SetAttributes(...) }` block (recommended), or do all expensive attribute setting after the start call.

**pprof:**

```bash
go test -bench=BenchmarkTracing -cpuprofile=cpu.prof
go tool pprof cpu.prof
(pprof) list Tracing
```

Before: `tracer.Start`, `span.End`, `attribute.String` all in the hot path. After: most of the hot path is `shouldSample`, with `tracer.Start` only in the 1 % branch.

</details>

---

## 14. Exercise 12: Buffered writer decorator with small buffers — size for typical payload

### Scenario

A `bufio.Writer` wraps a network connection. The default buffer size (4 KB) was chosen for terminal I/O; the actual payload is large JSON responses (~64 KB typical). Each write flushes the buffer multiple times, doing a syscall per 4 KB. Increasing the buffer to the typical payload size eliminates the flushes.

### Before

```go
package server

import (
    "bufio"
    "encoding/json"
    "net/http"
)

func WriteJSON(w http.ResponseWriter, v any) error {
    bw := bufio.NewWriter(w) // default 4 KB buffer
    enc := json.NewEncoder(bw)
    if err := enc.Encode(v); err != nil {
        return err
    }
    return bw.Flush()
}
```

### Benchmark

```go
func BenchmarkWriteJSONDefault(b *testing.B) {
    b.ReportAllocs()
    payload := generateLargeJSON() // ~64 KB
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        w := &discardResponseWriter{}
        _ = WriteJSON(w, payload)
    }
}
```

```
BenchmarkWriteJSONDefault-8    20_000    62_000 ns/op    4_240 B/op   17 allocs/op
```

17 allocations — the bufio buffer (4 KB), the encoder's internal buffer, and 15 flushes that each allocate a small follow-up buffer.

<details><summary>After</summary>

Size the buffer for the typical payload. Pool the buffer for reuse.

```go
package server

import (
    "bufio"
    "encoding/json"
    "net/http"
    "sync"
)

const typicalPayloadSize = 64 * 1024 // 64 KB — matches observed median

var writerPool = sync.Pool{
    New: func() any {
        return bufio.NewWriterSize(nil, typicalPayloadSize)
    },
}

func WriteJSON(w http.ResponseWriter, v any) error {
    bw := writerPool.Get().(*bufio.Writer)
    bw.Reset(w)
    defer writerPool.Put(bw)

    enc := json.NewEncoder(bw)
    if err := enc.Encode(v); err != nil {
        return err
    }
    return bw.Flush()
}
```

```
BenchmarkWriteJSONSized-8    150_000    8_200 ns/op    64 B/op    2 allocs/op
```

7.6× faster, 15 fewer allocations.

**Why it's faster.** The 64 KB buffer holds the entire response. Only one flush (the final one) does a syscall. The buffer itself is reused via the pool — only the encoder allocates per call.

**Sizing rules.**

- **Too small** (default 4 KB for 64 KB payloads): many flushes, many syscalls, slow.
- **Just right** (matches the typical payload size, ~p50 of observed): one flush per response, minimal syscalls.
- **Too large** (1 MB buffer for 1 KB responses): wastes memory in the pool; large allocations are slow to reuse; cache locality suffers.

Aim for the **p90 of observed payload sizes**, not the maximum. The p90 catches the typical case; the tail (10 % of responses) still works but pays one extra flush — fine. Sizing for the max wastes memory for the bulk of responses.

**Trade-off.**

1. **Pool entries hold their backing array forever.** A pool of 64 KB writers caps at the high-water mark of concurrent requests. On a busy server with 1000 concurrent connections, that's 64 MB in the pool. Usually fine; if memory is tight, cap the pool's effective size with `sync.Pool` plus a counter, or use a sized channel as a bounded pool.
2. **Buffer size affects latency.** A 64 KB buffer means the first byte isn't sent until 64 KB is buffered or the encoder explicitly flushes. For streaming APIs (server-sent events, JSON Lines), you want small buffers and frequent flushes. For batch responses (the typical REST JSON), large buffers are correct.
3. **`bufio.Writer.Reset(w)` must be called before reuse.** Forgetting the Reset means the writer keeps writing to the previous response — a correctness bug. The pattern above puts Reset right after Get to make it visible.
4. **Pool with mismatched sizes leaks.** If some callers use 64 KB writers and others use 4 KB, putting the wrong size back into the pool means subsequent Gets are unpredictable. Use one pool per size class, or normalize.

**Variant: pooled byte buffers, no `bufio`.**

For full control, pool `bytes.Buffer` and write the entire response there, then write to the connection once.

```go
var bufPool = sync.Pool{
    New: func() any {
        b := bytes.NewBuffer(make([]byte, 0, typicalPayloadSize))
        return b
    },
}

func WriteJSON(w http.ResponseWriter, v any) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    if err := json.NewEncoder(buf).Encode(v); err != nil {
        return err
    }
    _, err := w.Write(buf.Bytes())
    return err
}
```

```
BenchmarkWriteJSONByteBuffer-8    200_000    6_100 ns/op    48 B/op    1 allocs/op
```

10× faster than the original.

**When NOT to do this.** If responses are small (< 1 KB) and rare (< 100 QPS), the default buffer size is fine. The optimization pays off when (a) responses are large and (b) request rate is high. For HTTP/2 servers, the framing layer batches across responses anyway — application-level buffering matters less.

**A trap to avoid: don't `Flush()` between every chunk.**

```go
// Anti-idiom: flush after each write.
for _, item := range items {
    enc.Encode(item)
    bw.Flush() // negates the buffer
}
```

The point of buffering is to *avoid* syscalls. Explicit flushes negate it. Only flush at logical boundaries (end of response, end of message).

**pprof:**

```bash
go test -bench=BenchmarkWriteJSONDefault -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof cpu.prof
(pprof) top
```

Before: `syscall.Write`, `bufio.(*Writer).Flush`, `runtime.makeslice` dominate. After: `json.Encoder.Encode` and `syscall.Write` (now called once instead of 15 times).

</details>

---

## 15. When NOT to optimize

The honest framing: **most decorator chains should not be optimized**. The pattern is cheap. The wins exist only when:

| Condition | Threshold to bother |
|-----------|---------------------|
| Decorator call frequency | > 10k calls/sec sustained |
| Profile shows middleware methods in top 5 % CPU | Yes |
| Allocation profile shows closures/maps from middleware in top 10 | Yes |
| Chain rebuilding shows in alloc profile | Yes (Exercise 1 — almost always worth fixing) |
| Cache decorator's mutex contention > 10 % in mutex profile | Yes |
| Logging is on the hot path with `fmt.Sprintf` | Yes |
| The "fix" doesn't change the public API or break correctness | Yes |
| You can write a regression test | Yes |
| The fix survives a Go version bump | Probably yes |

If you can't tick most of those, don't optimize. The decorator chains in `chi`, `gorilla/mux`, the `net/http` standard library, gRPC interceptors are all "naïve" by the standards of this file — they ship because the simple version is good enough.

Specific anti-patterns to avoid:

| Anti-pattern | Why it's bad |
|--------------|--------------|
| Pre-allocating every chain at startup "for speed" when chains are stable already | The chain is already built once; you're optimizing nothing |
| Flattening every middleware chain | Loses composability and test isolation for ~1 µs that wasn't on the profile |
| Switching every cache from `sync.Mutex` to `sync.Map` | `sync.Map` is slower for write-heavy or low-cardinality workloads |
| Removing recovery middleware to save 5 ns | One panic in production wipes out a year of "savings" |
| Aggressive sampling that loses error traces | The whole point of tracing is to debug failures — sample tail-latency at minimum |
| `sync.Pool` for every middleware buffer | Pool overhead matches the savings below ~10k QPS |
| PGO for a service that handles 100 QPS | The CI complexity exceeds the value |
| Hand-rolling structured loggers | Use `slog` or `zerolog`; don't reinvent |
| Atomic pointer for chain that reloads daily | RWMutex's read-side is fine at low reload rates |
| Pre-computing metric labels for unbounded label sets | Cardinality explosion — the metric setup is broken in a different way |

The default answer to "can we make this decorator faster?" is **no, it's fine**. The yes cases are narrow and benchmark-justified.

---

## 16. The optimization checklist

Before shipping any optimization from this file:

1. [ ] Baseline benchmark exists (the unoptimized decorator chain).
2. [ ] Optimized benchmark shows ≥ 2× improvement OR saves ≥ 1 allocation per call.
3. [ ] `pprof` confirms the optimization targets a real hot spot (top 5 % CPU or top 10 allocs).
4. [ ] `mutex.prof` confirms contention reduction for lock-related changes.
5. [ ] The new code passes the same tests as the old.
6. [ ] `-gcflags=-m` shows no unexpected escapes (especially for closure changes).
7. [ ] `-race` is clean (especially for cached chains, atomic pointers, lock-free counters).
8. [ ] Documentation explains the assumption the optimization makes ("chain is static", "config reloads via atomic swap", "logs at INFO+").
9. [ ] CI regression test (`benchstat`) compares against the baseline.
10. [ ] Code review has signed off on the trade-off (especially for API-shape changes like flattening or PGO).
11. [ ] The "When NOT to do this" condition from the relevant exercise has been checked.
12. [ ] If the optimization changes panic behavior (Exercise 4), verify the recovery contract is preserved at the outer layer.

If any item is missing, the optimization isn't ready.

---

## 17. Summary

A decorator chain in Go is already fast: ~2 ns per layer and zero allocations per call. Most optimizations in this file save 10-1000 ns and 1-5 allocations. That matters at 10k QPS. It does not matter at 100 QPS.

The wins worth shipping cluster in eight areas:

1. **Build the chain once at startup, not per request** (Exercise 1) — 19× faster, removes 11 allocations. Pure win when the chain is static. *Almost always worth fixing if you find it.*
2. **Eliminate closure escapes in middleware** (Exercise 2) — 3× faster, removes a heap allocation per request. Pure win when `defer` isn't needed for correctness.
3. **`sync.Map` or `RWMutex` for read-heavy cache decorators** (Exercise 5) — 4-8× faster under parallel load. Pure win when reads dominate writes.
4. **Structured logger instead of `fmt.Printf`** (Exercise 6) — 11× faster, zero allocations. Pure win — also gives you structured logs for free.
5. **Pre-compute metric label observers at startup** (Exercise 7) — 3-8× faster, zero allocations. Pure win when label cardinality is bounded.
6. **Atomic counter instead of mutex for rate limiters** (Exercise 8) — 5× faster under contention. Real win for a single shared limiter.
7. **`atomic.Pointer` for chain hot-swap** (Exercise 9) — 4× faster than RWMutex. Pure win when reads dominate reloads.
8. **Buffered writers sized for typical payload** (Exercise 12) — 7× faster, 15 fewer allocations. Pure win when payload size is known.

The wins that don't always pay off:

- **PGO devirtualization** (Exercise 3) — 1.5-2× faster, requires profile-build pipeline; only worth it at scale.
- **Eliminate recovery middleware's defer** (Exercise 4) — 2× faster, but the safety cost is real.
- **Sampled tracing** (Exercise 11) — 17× faster on average, but loses 99 % of trace detail.
- **Direct delegation over embedding** (Exercise 10) — 2× faster, costs 30 lines of maintenance per decorator.
- **Flattening deep chains** (Exercise 3) — 3× faster, kills composability and testability.

Always benchmark. Always check `-race`. Always check `mutex.prof` for lock changes. Always confirm the optimization survives a Go version bump. Most production codebases need none of these optimizations; the decorator pattern is fine as written in junior.md and middle.md.

---

## Further reading

- Go 1.21+ PGO: https://go.dev/doc/pgo
- `log/slog`: https://pkg.go.dev/log/slog
- `zerolog`: https://pkg.go.dev/github.com/rs/zerolog
- `atomic.Pointer[T]`: https://pkg.go.dev/sync/atomic#Pointer
- `golang.org/x/sync/singleflight`: https://pkg.go.dev/golang.org/x/sync/singleflight
- `golang.org/x/time/rate`: https://pkg.go.dev/golang.org/x/time/rate
- OpenTelemetry sampling: https://opentelemetry.io/docs/concepts/sampling/
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Escape analysis: https://github.com/golang/go/wiki/CompilerOptimizations
- Sibling: [middle.md](middle.md) — variant choices
- Sibling: [junior.md](junior.md) — the baseline shape
- Related: [../03-strategy-pattern/optimize.md](../03-strategy-pattern/optimize.md) — same file shape for strategy
- Inspiration (zero-allocation HTTP): https://github.com/valyala/fasthttp
- Inspiration (decorator-rich stdlib): `bufio`, `gzip`, `tls`, `httputil`
