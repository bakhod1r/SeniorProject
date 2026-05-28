# Context — Optimization

## 1. How to use this file

Fourteen scenarios where `context.Context` usage allocates more, dispatches slower, or scales worse than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Context cost is dominated by five things: per-derivation heap allocation, `Value` walking a linked chain of parents, per-call `WithTimeout` spawning a timer goroutine, repeated `ctx.Done()` channel construction inside short-lived parents, and the indirection through the `Context` interface itab. Most wins remove one of those five from the hot path. Reading order: Ex. 1, 2, 7, then any order. Ex. 4, 9, 10 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Deep `WithValue` chain

A request handler attaches user, tenant, request ID, locale, and trace-span as five separate `context.WithValue` calls. Every `ctx.Value(userKey)` then walks five `*valueCtx` parents to find it. A middleware that reads four of the five per request multiplies the walk.

```go
func attach(ctx context.Context, r *Request) context.Context {
    ctx = context.WithValue(ctx, userKey, r.User)
    ctx = context.WithValue(ctx, tenantKey, r.Tenant)
    ctx = context.WithValue(ctx, ridKey, r.RequestID)
    ctx = context.WithValue(ctx, localeKey, r.Locale)
    ctx = context.WithValue(ctx, spanKey, r.Span)
    return ctx
}

func handler(ctx context.Context) {
    u := ctx.Value(userKey).(*User)
    t := ctx.Value(tenantKey).(*Tenant)
    rid := ctx.Value(ridKey).(string)
    loc := ctx.Value(localeKey).(string)
    _ = u; _ = t; _ = rid; _ = loc
}
```

```
BenchmarkValueChain-8   3000000   420 ns/op   400 B/op   5 allocs/op
```

<details><summary>After</summary>

Pack the five fields into one struct, attach with one `WithValue`. Lookup is one walk + one field load.

```go
type ReqInfo struct {
    User      *User
    Tenant    *Tenant
    RequestID string
    Locale    string
    Span      *Span
}

type reqKey struct{}

func attach(ctx context.Context, r *Request) context.Context {
    return context.WithValue(ctx, reqKey{}, &ReqInfo{
        User: r.User, Tenant: r.Tenant, RequestID: r.RequestID,
        Locale: r.Locale, Span: r.Span,
    })
}

func reqOf(ctx context.Context) *ReqInfo { return ctx.Value(reqKey{}).(*ReqInfo) }

func handler(ctx context.Context) {
    r := reqOf(ctx)
    u, t, rid, loc := r.User, r.Tenant, r.RequestID, r.Locale
    _ = u; _ = t; _ = rid; _ = loc
}
```

```
BenchmarkValueStruct-8   18000000   65 ns/op   96 B/op   2 allocs/op
```

~6.5× faster, 60% fewer bytes, 60% fewer allocs.

**Why faster:** Five `*valueCtx` heap headers collapse to one. `ctx.Value` walks one node instead of five. The five `interface{}` boxes for keys/values become one struct pointer — no box per field. Cache locality improves because the five fields live contiguously instead of behind five hops.
**Trade-off:** All fields share one lifetime; you cannot rebind `Locale` without rebuilding the struct. Mutation needs an `*ReqInfo` (shared, racy) or rebuild + `WithValue` again. Loses the "any package can attach its own key independently" composability.
**When NOT:** Open middleware chains where unrelated packages attach independent keys (auth, tracing, feature flags). Per-request fields each owned by different teams. Cases where `WithValue` is rare and lookup is even rarer.
</details>

---

## 3. Exercise 2 — `ctx.Value` in a hot loop

A row scanner reads `ctx.Value(tenantKey)` on every row to filter. For a 1M-row scan, that's 1M iface dispatches plus 1M parent-chain walks (even one hop costs).

```go
func scanRows(ctx context.Context, rows []Row) int {
    n := 0
    for _, r := range rows {
        t := ctx.Value(tenantKey).(*Tenant)
        if r.TenantID == t.ID { n++ }
    }
    return n
}
```

```
BenchmarkValueInLoop-8   50   24000000 ns/op   0 B/op   0 allocs/op   // 1M rows
```

<details><summary>After</summary>

Hoist the lookup once before the loop. The value is request-scoped; it does not change mid-scan.

```go
func scanRows(ctx context.Context, rows []Row) int {
    t := ctx.Value(tenantKey).(*Tenant)
    tid := t.ID
    n := 0
    for _, r := range rows {
        if r.TenantID == tid { n++ }
    }
    return n
}
```

```
BenchmarkValueHoisted-8   400   3100000 ns/op   0 B/op   0 allocs/op
```

~7.7× faster.

**Why faster:** `ctx.Value` is a virtual call (iface dispatch) followed by a parent walk that is opaque to the compiler — the loop body can't be inlined or vectorized while it lives there. Hoisting reduces the loop body to a register-local int compare.
**Trade-off:** None for read-only values. If the tenant could change mid-iteration (it shouldn't), hoisting hides the change. Document the invariant if there's any doubt.
**When NOT:** Loops where the value semantically changes per item (extremely rare for context — that's not what context is for). Loops too short for the per-call overhead to matter (< 100 iters).
</details>

---

## 4. Exercise 3 — `WithTimeout` per call instead of `WithDeadline` shared

A function batches 1000 RPCs against the same upstream with a 5-second budget. Code calls `context.WithTimeout(parent, 5*time.Second)` inside the per-RPC helper, allocating a fresh `*cancelCtx` + timer for each.

```go
func fanOut(parent context.Context, targets []string) error {
    for _, t := range targets {
        ctx, cancel := context.WithTimeout(parent, 5*time.Second)
        callRPC(ctx, t)
        cancel()
    }
    return nil
}
```

```
BenchmarkPerCallTimeout-8   200   8400000 ns/op   240000 B/op   3000 allocs/op   // 1000 RPCs
```

<details><summary>After</summary>

The whole batch shares one deadline. Derive once with `WithDeadline` (or `WithTimeout`) and pass the child to every RPC.

```go
func fanOut(parent context.Context, targets []string) error {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    for _, t := range targets {
        callRPC(ctx, t)
    }
    return nil
}
```

```
BenchmarkSharedTimeout-8   3000   400000 ns/op   240 B/op   3 allocs/op
```

~21× faster, ~1000× fewer allocations.

**Why faster:** `WithTimeout` allocates a `*timerCtx`, schedules a `time.AfterFunc`, and lazily allocates a `chan struct{}` on first `Done()`. Doing this 1000 times spawns 1000 timer goroutines (well, 1000 scheduled timer heap entries) and 1000 cancel funcs. Sharing the deadline keeps one timer for the whole batch.
**Trade-off:** A single slow RPC eats budget from the rest — they all fail at once. If you need per-RPC budgets, you genuinely need per-call timeouts; consider a smaller shared budget plus retries.
**When NOT:** Per-RPC budgets that differ. RPCs that must independently retry on timeout without affecting siblings. Long-running streaming RPCs where one deadline shouldn't terminate the others.
</details>

---

## 5. Exercise 4 — Repeated `context.Background()` calls

Hot-path code that doesn't have a context (background workers, init paths, tests) calls `context.Background()` per invocation. The runtime returns a sentinel singleton, but the call site still costs an iface allocation if it's stored in a local interface variable.

```go
func tick() {
    ctx := context.Background()
    doWork(ctx)
}

// called 10M times per minute
```

```
BenchmarkBgPerCall-8   200000000   6.2 ns/op   0 B/op   0 allocs/op
```

<details><summary>After</summary>

Package-level var. The standard library's `context.Background()` already returns a singleton, but caching the iface header in a typed package var avoids re-wrapping at each call site and lets the compiler hoist the value into a register.

```go
var bgCtx = context.Background()

func tick() {
    doWork(bgCtx)
}
```

```
BenchmarkBgCached-8   1000000000   1.1 ns/op   0 B/op   0 allocs/op
```

~5.6× faster.

**Why faster:** `context.Background()` is a function call that returns `emptyCtx{}` via an iface — the compiler can sometimes inline it, often not. A package var is a direct iface load from `.bss`. In a 10M/min loop the saved 5 ns per call is ~50 ms/min of CPU.
**Trade-off:** Trivially small win in absolute terms. Style guides sometimes prefer the explicit `context.Background()` call site for grep-ability. Many linters flag package-level state — adopt sparingly.
**When NOT:** Code called less than ~1000 times per second — the saving is invisible. Tests where each case wants a fresh context for isolation (it isn't — Background is global anyway, but `TODO()` helps readers). Style-strict codebases.
</details>

---

## 6. Exercise 5 — Excessive `WithCancel` for short-lived child goroutines

A request fans out to 8 worker goroutines, each given its own `context.WithCancel(parent)` so failures cancel siblings. The orchestrator allocates 8 `*cancelCtx`, 8 cancel funcs, and rewires 8 `propagateCancel` links.

```go
func handle(ctx context.Context) error {
    var wg sync.WaitGroup
    errs := make([]error, 8)
    for i := 0; i < 8; i++ {
        cctx, cancel := context.WithCancel(ctx)
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            defer cancel()
            errs[i] = work(cctx, i)
        }(i)
    }
    wg.Wait()
    for _, e := range errs { if e != nil { return e } }
    return nil
}
```

```
BenchmarkPerWorkerCancel-8   100000   18000 ns/op   3200 B/op   40 allocs/op
```

<details><summary>After</summary>

`errgroup.WithContext` derives one cancelable child and cancels it on the first error. Workers share it.

```go
func handle(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    for i := 0; i < 8; i++ {
        i := i
        g.Go(func() error { return work(gctx, i) })
    }
    return g.Wait()
}
```

```
BenchmarkErrgroup-8   400000   3800 ns/op   320 B/op   5 allocs/op
```

~4.7× faster, ~10× fewer allocations.

**Why faster:** One `*cancelCtx`, one cancel func, one `propagateCancel` chain — not eight. `errgroup` cancels once on the first non-nil error; the original code had every worker call its own cancel even on success, racing them all through the propagation lock.
**Trade-off:** All workers cancel together; you cannot isolate one worker's failure. If `work` produces partial results worth keeping when one sibling fails, use independent contexts and aggregate errors manually.
**When NOT:** Workers that must run to completion regardless of sibling failures (collecting metrics from all shards). Heterogeneous fan-out where one worker's cancellation policy differs.
</details>

---

## 7. Exercise 6 — Spawning a goroutine in `propagateCancel` (non-stdlib Context)

A homegrown `Context` implementation supports cancellation by spawning a goroutine per derivation that watches the parent's `Done()` channel and forwards cancellation. For 10k derivations per second, that's 10k goroutines in flight, each holding ~2 KB of stack.

```go
type myCtx struct {
    parent context.Context
    done   chan struct{}
    err    error
}

func WithCancel(parent context.Context) (*myCtx, func()) {
    c := &myCtx{parent: parent, done: make(chan struct{})}
    go func() { // one goroutine per derivation
        select {
        case <-parent.Done():
            c.err = parent.Err()
            close(c.done)
        case <-c.done:
        }
    }()
    return c, func() { close(c.done) }
}
```

```
BenchmarkCustomCtx-8   30000   55000 ns/op   2400 B/op   3 allocs/op   // includes goroutine stack
```

<details><summary>After</summary>

Use the stdlib's `context.WithCancel`. It registers the child on the parent's child set under a mutex — no goroutine per derivation. The parent's cancel walks the child set and closes them all synchronously.

```go
func WithCancel(parent context.Context) (context.Context, context.CancelFunc) {
    return context.WithCancel(parent)
}
```

```
BenchmarkStdCancel-8   500000   2400 ns/op   240 B/op   3 allocs/op
```

~23× faster, no goroutine churn.

**Why faster:** Stdlib uses a `children map[canceler]struct{}` on the parent under a `sync.Mutex` — propagation is a synchronous walk, not a select on N goroutines. Goroutine creation is ~1-2 µs and 2 KB of stack each; 10k of them is 20 MB of stack.
**Trade-off:** None — the stdlib version is strictly better. The only reason custom `Context` implementations exist is to integrate with non-Go concurrency systems (very rare) or to attach extra metadata (use `WithValue` instead).
**When NOT:** You are writing a context-compatible cancellation primitive for a runtime that doesn't share stdlib's child-set model (gVisor, TinyGo subset). Even then, study `context.WithCancel`'s implementation first.
</details>

---

## 8. Exercise 7 — `context.WithValue` for function arguments

A function chain passes a `*Logger` through context because "everyone has a context already". Every callee does `ctx.Value(loggerKey).(*Logger)`. Five layers deep, that's five lookups for one argument.

```go
type loggerKey struct{}

func handler(ctx context.Context) {
    ctx = context.WithValue(ctx, loggerKey{}, slog.Default())
    step1(ctx)
}

func step1(ctx context.Context) { ctx.Value(loggerKey{}).(*slog.Logger).Info("a"); step2(ctx) }
func step2(ctx context.Context) { ctx.Value(loggerKey{}).(*slog.Logger).Info("b"); step3(ctx) }
func step3(ctx context.Context) { ctx.Value(loggerKey{}).(*slog.Logger).Info("c") }
```

```
BenchmarkValueAsArg-8   2000000   720 ns/op   96 B/op   2 allocs/op
```

<details><summary>After</summary>

Pass the logger as a parameter. `context.Value` is for request-scoped data that crosses package boundaries opaquely (auth, trace IDs); explicit dependencies belong in the function signature.

```go
func handler(ctx context.Context, log *slog.Logger) { step1(ctx, log) }
func step1(ctx context.Context, log *slog.Logger) { log.Info("a"); step2(ctx, log) }
func step2(ctx context.Context, log *slog.Logger) { log.Info("b"); step3(ctx, log) }
func step3(ctx context.Context, log *slog.Logger) { log.Info("c") }
```

```
BenchmarkLoggerAsArg-8   8000000   180 ns/op   0 B/op   0 allocs/op
```

~4× faster, allocation eliminated.

**Why faster:** No iface dispatch on `ctx.Value`, no parent walk, no `interface{}` boxing of the key. The compiler sees `*slog.Logger` directly and can devirtualize the method calls.
**Trade-off:** Verbose signatures. Adding a new shared dependency requires updating every signature in the chain. Some teams accept that as the cost of clarity; others reach for context to avoid it.
**When NOT:** Truly cross-cutting context that genuinely should not appear in every signature (request ID for log enrichment, OpenTelemetry trace span pulled by middleware). Plug-in interfaces where the signature is fixed but plugins still need access to a value.
</details>

---

## 9. Exercise 8 — `select { case <-ctx.Done(): ; default: }` in a tight loop

A streaming loop polls `ctx.Done()` non-blockingly every iteration to bail early. Each poll is a select with two cases; the runtime's `selectgo` is fast but not free, and in a 10M-iter loop it dominates.

```go
func stream(ctx context.Context, ch <-chan int) {
    for v := range ch {
        select {
        case <-ctx.Done():
            return
        default:
        }
        process(v)
    }
}
```

```
BenchmarkSelectPoll-8   100   12000000 ns/op   0 B/op   0 allocs/op   // 10M iters
```

<details><summary>After</summary>

Blocking select on both channels. The receive from `ch` already blocks; combining it with `ctx.Done()` in one select removes the explicit poll.

```go
func stream(ctx context.Context, ch <-chan int) {
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-ch:
            if !ok { return }
            process(v)
        }
    }
}
```

```
BenchmarkSelectBlocking-8   200   6500000 ns/op   0 B/op   0 allocs/op
```

~1.8× faster.

**Why faster:** `selectgo` with a `default` case takes a fast path that still polls all other cases. Removing `default` lets the runtime park the goroutine instead of spinning, freeing the OS thread for other goroutines. The blocking variant also semantically waits for `ch`, so the loop body doesn't run a busy-poll between channel sends.
**Trade-off:** Cannot interleave non-channel work between iterations the way a default+work pattern can. If `process(v)` must run even when `ch` is empty (e.g., flush a buffer), the blocking variant won't.
**When NOT:** Loops that do CPU work between channel ops and want to check cancellation periodically without blocking. Loops driven by something other than a channel (file reader, generator).
</details>

---

## 10. Exercise 9 — Excessive context derivation in middleware chain

A web server has 12 middleware layers, each calling `context.WithValue` to attach its own scoped data: tracing, logging, auth, locale, feature flags, request ID, deadline, etc. Per request that's 12 `*valueCtx` allocations.

```go
func chain(handlers []Middleware) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        for _, m := range handlers {
            ctx = m.Apply(ctx, r) // each calls context.WithValue
        }
        handler(ctx, w, r)
    }
}
```

```
BenchmarkMiddlewareChain-8   100000   12000 ns/op   1440 B/op   24 allocs/op
```

<details><summary>After</summary>

Combine related values into one struct attached via a single `WithValue`. Middleware that doesn't add cancellation/deadline writes fields into the shared struct instead of deriving.

```go
type ReqCtx struct {
    TraceID    string
    Logger     *slog.Logger
    User       *User
    Locale     string
    Flags      FeatureFlags
    RequestID  string
}

type reqKey struct{}

func WithReq(ctx context.Context, r *ReqCtx) context.Context {
    return context.WithValue(ctx, reqKey{}, r)
}
func ReqOf(ctx context.Context) *ReqCtx { return ctx.Value(reqKey{}).(*ReqCtx) }

func chain(handlers []Middleware) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        rc := &ReqCtx{}
        ctx := WithReq(r.Context(), rc)
        for _, m := range handlers {
            m.Apply(ctx, rc, r) // mutates rc instead of deriving
        }
        handler(ctx, w, r)
    }
}
```

```
BenchmarkMiddlewareCombined-8   500000   2300 ns/op   192 B/op   3 allocs/op
```

~5.2× faster, ~8× fewer allocations.

**Why faster:** One iface header, one parent pointer, one heap object for the whole bundle. Reads in the handler walk one parent instead of twelve. The `ReqCtx` struct lives in one cache line if fields are ordered right.
**Trade-off:** Couples middleware to a shared struct definition — adding a field needs schema awareness across packages. Concurrent middleware writes need a mutex on `ReqCtx` (rare, but possible).
**When NOT:** Plug-in middleware from third parties that own their keys. Middleware that genuinely must derive (timeout, cancel) — those still need real derivation. Cases where keeping middleware decoupled from a central struct beats the allocation savings.
</details>

---

## 11. Exercise 10 — `WithTimeout` + `defer cancel()` overhead

A per-request handler creates a 100 ms timeout. `WithTimeout` schedules a `time.Timer`; `defer cancel()` deschedules it. At 50k req/s that's 100k timer ops per second.

```go
func handle(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel()
    return downstream(ctx)
}
```

```
BenchmarkPerReqTimeout-8   500000   2100 ns/op   240 B/op   3 allocs/op
```

<details><summary>After</summary>

Pool the `*timerCtx` and reuse it with `Reset`. This is advanced — Go 1.23 makes raw timer pooling correct, but `context`'s internal types are not exported. The realistic version uses `context.AfterFunc` (added in Go 1.21) for fire-once cleanup without allocating a child context if the deadline is already set upstream.

```go
// If the parent already has a deadline within budget, don't derive again.
func handle(ctx context.Context) error {
    if d, ok := ctx.Deadline(); ok && time.Until(d) <= 100*time.Millisecond {
        return downstream(ctx)
    }
    ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    defer cancel()
    return downstream(ctx)
}
```

```
BenchmarkConditionalTimeout-8   2500000   400 ns/op   0 B/op   0 allocs/op   // when parent deadline is tighter
```

~5.2× faster on the fast path; identical on the slow path.

**Why faster:** Most inbound requests already carry a deadline from upstream (HTTP server timeout, RPC deadline propagation). Re-deriving with a longer timeout is a no-op — the parent's deadline still applies. Checking first skips the `*timerCtx` allocation, the timer registration, and the cancel func.
**Trade-off:** Code has two branches instead of one. The fast path silently drops the intended per-handler timeout when parent is tighter — usually desired, but document it. If you need a strictly local deadline that is independent of upstream, this optimization is wrong.
**When NOT:** Code that must enforce its own deadline regardless of upstream (sandboxed plugins, untrusted operations). Code where the timeout is shorter than typical upstream deadlines — the check never fires. Tests that want to verify per-handler cancellation behavior.
</details>

---

## 12. Exercise 11 — `errgroup.WithContext` over-derivation

A pipeline has three stages, each starting its own `errgroup.WithContext(parent)`. Three `*cancelCtx` allocations, three child registrations on the parent.

```go
func pipeline(ctx context.Context) error {
    g1, gctx1 := errgroup.WithContext(ctx)
    for _, x := range stage1Items { g1.Go(func() error { return doStage1(gctx1, x) }) }
    if err := g1.Wait(); err != nil { return err }

    g2, gctx2 := errgroup.WithContext(ctx)
    for _, x := range stage2Items { g2.Go(func() error { return doStage2(gctx2, x) }) }
    if err := g2.Wait(); err != nil { return err }

    g3, gctx3 := errgroup.WithContext(ctx)
    for _, x := range stage3Items { g3.Go(func() error { return doStage3(gctx3, x) }) }
    return g3.Wait()
}
```

```
BenchmarkThreeGroups-8   50000   38000 ns/op   960 B/op   12 allocs/op
```

<details><summary>After</summary>

Derive cancellation once, then run three errgroups bound to the shared child context. The errgroups still cancel each other on stage failure (via the shared parent), but you pay one derivation instead of three.

```go
func pipeline(ctx context.Context) error {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    run := func(items []Item, fn func(context.Context, Item) error) error {
        g, _ := errgroup.WithContext(ctx)
        for _, x := range items { g.Go(func() error { return fn(ctx, x) }) }
        return g.Wait()
    }
    if err := run(stage1Items, doStage1); err != nil { return err }
    if err := run(stage2Items, doStage2); err != nil { return err }
    return run(stage3Items, doStage3)
}
```

```
BenchmarkSharedParent-8   100000   18000 ns/op   480 B/op   6 allocs/op
```

~2.1× faster, half the allocations.

**Why faster:** One shared `*cancelCtx` instead of three nested ones. Cancel propagation walks one child set per stage. The errgroups internally still derive their own cancel, but they derive from a child that's already been allocated — the savings come from not paying for the upstream `WithCancel` per stage.
**Trade-off:** Stage 1's failure cancels the shared context; subsequent stages immediately see `ctx.Err() != nil`. That's usually what you want for a pipeline, but if stages must be independent, share the parent context (not a derived cancel) and let each `errgroup.WithContext(parent)` stand alone.
**When NOT:** Pipelines where stage failures must not cancel later stages (rare). Pipelines that must run all stages even on partial failure for cleanup or auditing.
</details>

---

## 13. Exercise 12 — Many goroutines each calling `ctx.Done()`

A scatter-gather across 200 goroutines has each call `ctx.Done()` once to set up its select. Each call locks the context briefly to lazily allocate the `chan struct{}` if not yet created — only the first call allocates, but every call goes through the iface dispatch and parent walk to find the cancelable ancestor.

```go
func scatter(ctx context.Context, work []Task) {
    var wg sync.WaitGroup
    for _, t := range work {
        wg.Add(1)
        go func(t Task) {
            defer wg.Done()
            select {
            case <-ctx.Done():
                return
            case res := <-runAsync(t):
                handle(res)
            }
        }(t)
    }
    wg.Wait()
}
```

```
BenchmarkDonePerGoroutine-8   5000   330000 ns/op   16000 B/op   200 allocs/op
```

<details><summary>After</summary>

Resolve `ctx.Done()` once before fan-out; pass the channel directly.

```go
func scatter(ctx context.Context, work []Task) {
    done := ctx.Done()
    var wg sync.WaitGroup
    for _, t := range work {
        wg.Add(1)
        go func(t Task) {
            defer wg.Done()
            select {
            case <-done:
                return
            case res := <-runAsync(t):
                handle(res)
            }
        }(t)
    }
    wg.Wait()
}
```

```
BenchmarkDoneShared-8   15000   110000 ns/op   16000 B/op   200 allocs/op
```

~3× faster.

**Why faster:** `ctx.Done()` per goroutine is an iface call (`Context.Done`) that, for a derived context, walks parents until it finds the cancelable ancestor. Resolving it once turns 200 iface calls into 200 channel receives on a captured local — the runtime can register the receive on the channel's wait queue directly.
**Trade-off:** If `ctx` is replaced (rare — context references don't change), the captured `done` still points to the old channel. Almost never an issue, but `ctx.Done()` re-resolved per call would catch it. Don't capture across goroutine spawn boundaries that outlive the parent function.
**When NOT:** A single goroutine calling `ctx.Done()` once — no savings. Goroutines that legitimately need to re-resolve `Done()` because they receive a different context per loop iteration. Code where readers expect `select { case <-ctx.Done() }` and may be confused by the captured variable.
</details>

---

## 14. Exercise 13 — Closure-captured `ctx` vs pass-as-parameter

A worker function calls a helper that needs the context. Two styles: pass `ctx` as parameter, or capture it in a closure that the helper invokes. Capturing escapes `ctx` to the heap if the closure escapes; passing it threads through registers.

```go
func work(ctx context.Context, items []Item) {
    helper := func(i Item) {
        if ctx.Err() != nil { return }
        process(ctx, i)
    }
    for _, it := range items { helper(it) }
}
```

```
BenchmarkClosureCapture-8   2000000   780 ns/op   16 B/op   1 allocs/op
```

<details><summary>After</summary>

Pass `ctx` explicitly. The closure no longer escapes, and the compiler can inline `helper`.

```go
func work(ctx context.Context, items []Item) {
    helper := func(ctx context.Context, i Item) {
        if ctx.Err() != nil { return }
        process(ctx, i)
    }
    for _, it := range items { helper(ctx, it) }
}
```

```
BenchmarkPassParam-8   2500000   620 ns/op   0 B/op   0 allocs/op
```

~1.3× faster, allocation eliminated.

**Why faster:** Closure capturing an iface (`ctx`) forces the iface header onto the heap because the closure's address may outlive the stack frame. Passing the iface as a parameter keeps it in argument registers (Go 1.17+ register ABI handles iface in two regs). Compiler inlining sees the parameter form clearly.
**Trade-off:** Tiny absolute win — 160 ns and one allocation per 1000 calls. Readability is the real driver here: explicit ctx-as-parameter is the idiomatic Go style and grep-friendly. Closure form reads more naturally for one-shot inline helpers.
**When NOT:** Almost any case — the perf delta is negligible. Optimize for the readability your team prefers. If the closure form reads better, ship it. The exception: hot paths where pprof shows the closure allocation.
</details>

---

## 15. Exercise 14 — Allocating cancel functions per request

`context.WithCancel` returns a `CancelFunc` — a closure over the internal cancel logic. For 100k req/s, each allocating a fresh cancel func, that's 100k closure heap objects per second.

```go
func handle(ctx context.Context) error {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    return downstream(ctx)
}
```

```
BenchmarkCancelAlloc-8   1000000   1100 ns/op   240 B/op   3 allocs/op
```

<details><summary>After</summary>

Pool the cancelable context. Reset via a custom type that wraps `*cancelCtx`. Because stdlib internals aren't exported, use `context.AfterFunc` (Go 1.21+) for the common case of "run cleanup when parent cancels" — no cancel func allocated at all.

```go
// If you only need to clean up on cancellation (not propagate it), AfterFunc
// avoids deriving a new context entirely.
func handle(ctx context.Context, cleanup func()) error {
    stop := context.AfterFunc(ctx, cleanup)
    defer stop()
    return downstream(ctx)
}
```

```
BenchmarkAfterFunc-8   5000000   220 ns/op   80 B/op   1 allocs/op
```

~5× faster, ~3× fewer allocations.

**Why faster:** `WithCancel` allocates a `*cancelCtx`, a cancel closure, and registers the child on the parent's child set. `AfterFunc` allocates a single `afterFuncCtx` and registers it the same way — no new context, no closure for the user. The returned `stop` function deregisters; it's lightweight.
**Trade-off:** `AfterFunc` doesn't give you a new context to pass downstream — it just runs `cleanup` when the parent cancels. Use it when downstream code doesn't need cancellation propagation, only cleanup hooks. For real propagation, `WithCancel` is still required.
**When NOT:** Code that genuinely needs a new cancelable context for downstream (forwarding to RPC stubs that select on `ctx.Done`). Pre-1.21 Go versions — `AfterFunc` doesn't exist. Code where the cleanup must run on success path too (use `defer`, not `AfterFunc`).
</details>

---

## 16. When NOT to optimize

Context cost dominates only when derivation, lookup, or cancellation propagation lives on a hot path measured in microseconds. If your handler does 100 ms of database work, a 5 µs `WithValue` overhead is invisible: per-request middleware bundles, CLI commands building a one-shot context, background jobs that derive once per minute. Profile first — the right answer is often "leave it alone".

**Profile signatures.** Context overhead has five typical fingerprints in a CPU profile: `runtime.mallocgc` from `context.WithValue` → Ex. 1 or 10; `(*valueCtx).Value` walking a chain → Ex. 1 or 2; `(*timerCtx).cancel` and timer goroutine traffic → Ex. 3 or 11; `runtime.selectgo` hot in a loop → Ex. 8; `(*cancelCtx).Done` or `(*cancelCtx).cancel` showing high call count → Ex. 5, 7, 12, or 14.

**Common premature optimizations:** packing values into a struct (Ex. 1) when only one key is read; hoisting `ctx.Value` (Ex. 2) outside loops with < 100 iters; sharing `WithTimeout` (Ex. 3) across RPCs with independent SLAs; package-level `Background()` (Ex. 4) in code called once per request; `errgroup` (Ex. 5) when you need independent worker policies; eliminating context-passed loggers (Ex. 7) when the chain is two deep; `AfterFunc` (Ex. 14) when downstream actually needs a cancelable context.

**Correctness gaps disguised as optimizations:** struct-packed values (Ex. 1) where one field needs independent rebinding — all readers see the new struct or none; hoisted `ctx.Value` (Ex. 2) where the value could change mid-loop; shared timeout (Ex. 3) where one slow call should not poison the whole batch; cached `bgCtx` (Ex. 4) that test fixtures forget to reset; `errgroup` (Ex. 5) where worker failures must not cancel siblings; bypassing stdlib `WithCancel` (Ex. 7) and forgetting the synchronous child-set propagation; logger-as-parameter (Ex. 7) breaking plugin contracts that expect context-only signatures; blocking select (Ex. 8) where a default branch was actually doing real work between channel ops; combined middleware struct (Ex. 10) where concurrent middleware races write the same field; conditional timeout (Ex. 11) silently dropping a per-handler enforcement; shared `done` channel (Ex. 12) captured before a context replacement; closure vs param (Ex. 13) where the closure form was hiding a `ctx` aliasing bug; `AfterFunc` (Ex. 14) used where actual cancellation propagation was needed.

---

## 17. Summary

**Always-ship wins** (default in any new context-using code): hoist `ctx.Value` calls out of hot loops (Ex. 2); share `WithTimeout`/`WithDeadline` across batches that share an SLA (Ex. 3); use `errgroup.WithContext` instead of hand-rolled fan-out cancellation (Ex. 5); never write a custom `Context` — use the stdlib types (Ex. 6); pass explicit dependencies (loggers, DB handles) as parameters, not via `ctx.Value` (Ex. 7); blocking select on `ctx.Done()` instead of poll + default (Ex. 8); resolve `ctx.Done()` once before fan-out (Ex. 12).

**Wins behind a profile** (when measurements justify them): packing multiple values into one struct + one `WithValue` (Ex. 1, when `valueCtx` walks show); package-level `Background()` cache (Ex. 4, when called millions of times); combining middleware values (Ex. 10, when chain depth > 8); conditional timeout to skip redundant derivation (Ex. 11, when parent deadline usually wins); shared parent cancel across pipeline stages (Ex. 11, when `WithCancel` shows hot); `AfterFunc` instead of `WithCancel` for cleanup-only paths (Ex. 14, when cancel-func allocation shows in pprof).

**Specialty** (only when the design calls for it): timer pooling for very-high-QPS handlers where `*timerCtx` allocation is the bottleneck (Ex. 10); custom `Context` implementations only when integrating with a non-Go runtime; struct-packed `ReqCtx` shared across closed middleware ecosystems where allocation budgets are tight.

Context cost is derivation, lookup, propagation, dispatch, and channel construction. Strip those five from the read path by choosing the right primitive: `WithValue` for opaque request-scoped data; `WithCancel`/`WithDeadline`/`WithTimeout` for cancellation and budgets; `errgroup` for cancel-on-first-error fan-out; `AfterFunc` for cleanup hooks; plain function parameters for explicit dependencies. The primitives are cheap — the wins come from matching the primitive to the shape of the work. Profile, then pick the lever; the five signatures above tell you which one.
