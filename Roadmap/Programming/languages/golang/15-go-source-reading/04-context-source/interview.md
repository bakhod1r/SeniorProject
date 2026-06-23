# `context` Source — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus a "what not to say" list and a five-minute pre-interview checklist. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. `context` looks small (one file, ~700 lines) and is profoundly load-bearing: every Go service uses it, almost every leak starts with it, and the interview signal is whether you can explain *why* the package exists in the shape it does — interface, immutable values, cancellation tree, one-shot signal — without reaching for analogies that don't fit.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is `context` and what problem does it solve?

**Short answer:** `context.Context` is the standard way to carry a deadline, cancellation signal, and request-scoped values across API boundaries and goroutines in Go. The problem it solves is *propagation*: when a request comes in and fans out into many goroutines (handlers, RPC calls, DB queries), you need one signal that says "stop, the caller is gone" and one channel that says "here's the deadline by which everyone must be done." Before `context`, every package invented its own cancellation type and they didn't compose; `context` standardises the shape so a deadline set at the HTTP handler propagates all the way to the SQL driver.

**Follow-up:** What does it *not* solve? Answer: it isn't a logger, a DI container, or a transaction object. Stuffing those into `Context.Value` is the classic abuse — `context` is about request lifetime, not request configuration.

---

### Q2. What's the difference between `context.Background()` and `context.TODO()`?

**Short answer:** Mechanically they're identical — both return an empty context with no deadline, no cancellation, no values. The difference is *semantic*: `Background()` declares "this is the root of a request or top-level operation"; `TODO()` declares "I don't know what context to use here yet, please come back and fix this." Linters (`staticcheck`, `contextcheck`) treat `TODO()` as a TODO marker; reviewers should too. Pick `Background()` in `main`, in init, in tests where the lifetime is the process. Pick `TODO()` when you're refactoring and haven't yet plumbed the real context through.

**Follow-up:** Should `TODO()` ever ship to production? Answer: yes, occasionally — for code that legitimately has no caller-supplied context (a long-running supervisor, a periodic flusher) and where `Background()` would be a lie about lifetime. In that case leave a comment explaining why; otherwise it's a code-review red flag.

---

### Q3. `WithCancel` vs `WithTimeout` vs `WithDeadline` — when do you reach for each?

**Short answer:** All three return a derived context plus a `cancel` function. `WithCancel` is unbounded — it only stops when you call `cancel()`; use it when the parent goroutine decides shutdown manually (e.g. user clicks "abort"). `WithTimeout(parent, 5*time.Second)` is "stop after 5 seconds from now" — use it for outbound RPCs, DB queries, anything with a SLO. `WithDeadline(parent, t)` is "stop at this absolute wall-clock time" — use it when the deadline is inherited (HTTP request has 30s left, all downstream calls share that ceiling). `WithTimeout` is sugar over `WithDeadline(parent, time.Now().Add(d))`.

**Follow-up:** What if the parent already has an earlier deadline? Answer: the child inherits the *earlier* of the two — `WithDeadline(parent, t)` returns a context that fires when `min(parent.Deadline, t)` arrives. Never extends the parent; always tightens or matches it.

---

### Q4. Why is `context.Value` discouraged for anything beyond request-scoped data?

**Short answer:** Three reasons. (1) **Type-unsafe API** — `Value(key) any` requires every caller to type-assert; the compiler can't tell you you've requested a wrong-typed value. (2) **Invisible dependency** — a function that reads `ctx.Value("user")` looks pure from its signature; reviewers can't see what it needs. (3) **Lookup cost** — `Value` walks the parent chain linearly; deep chains turn every `ctx.Value` into a hot-path traversal. The package doc explicitly warns: use `Context.Value` *only* for request-scoped data that transits process and API boundaries (auth token, trace ID, locale), not for passing optional parameters to functions.

**Follow-up:** What's the alternative for non-request data? Answer: explicit parameters or a dedicated config/service struct. If `f` needs a logger, take `logger *slog.Logger` as a parameter; don't fish it out of `ctx`. The signature should declare what `f` depends on.

---

### Q5. When *must* you call `cancel` returned from `WithCancel`/`WithTimeout`/`WithDeadline`?

**Short answer:** Always, even if the context already expired by deadline. `cancel` releases the resources associated with the context — most importantly it removes the child from its parent's children map and stops the deadline timer (for `WithDeadline`). Failing to call `cancel` is a goroutine leak in the cancellation propagation tree: the parent keeps a reference to the child, and any timers stay armed. The idiomatic pattern is `defer cancel()` immediately after creating the derived context — same line if possible.

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
// use ctx
```

**Follow-up:** What does `go vet` catch here? Answer: `lostcancel` analyzer flags any code path that returns or exits without calling cancel. It's enabled by default; if you see the warning, take it seriously — it's almost always a real leak.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through what happens when `WithCancel`'s `cancel` is called.

**Short answer:** `cancel()` does five things in order. (1) Acquires the cancel context's mutex. (2) Closes the `done` channel (lazily allocated — see the source). (3) Sets `err` to `context.Canceled` (or `context.DeadlineExceeded` for timeout, or a custom cause for `WithCancelCause`). (4) Walks the children map, calls `cancel(removeFromParent=false)` on each — propagation is depth-first, eager. (5) Sets `children` to nil and unlocks. After return, every goroutine blocked on `<-ctx.Done()` wakes; every call to `ctx.Err()` returns the non-nil error. The propagation is synchronous from the caller's perspective: when `cancel()` returns, the whole subtree has been signalled.

```go
// runtime/context simplified:
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    c.mu.Lock()
    if c.err != nil { c.mu.Unlock(); return }   // already cancelled
    c.err = err
    c.cause = cause
    closeChan(&c.done)
    for child := range c.children {
        child.cancel(false, err, cause)          // recurse, holding our mutex
    }
    c.children = nil
    c.mu.Unlock()
    if removeFromParent { removeChild(c.Context, c) }
}
```

**Follow-up:** Why does `cancel` hold the lock across child cancellation? Answer: to avoid a race where a new child registers between snapshotting the map and walking it. The downside is that a deeply nested tree can hold the root mutex for a while; in practice trees are shallow (request → handlers → RPCs), and the lock is uncontended once cancellation has fired.

---

### Q7. How does cancellation propagate to a non-stdlib `Context` (one written by a user)?

**Short answer:** It uses `parentCancelCtx` to find the nearest stdlib `*cancelCtx` ancestor and registers as its child. If no stdlib `*cancelCtx` exists in the chain (because someone wrote a custom context type that doesn't expose the internal hook), the runtime falls back to spawning a goroutine that watches `parent.Done()` and calls cancel on the child when it fires. That goroutine is the price you pay for not being a stdlib context — it lives until either parent or child is cancelled. The lesson: custom `Context` implementations are legal but cost a goroutine per derivation unless they participate in the unexported `parentCancelCtx` protocol (which they can't, since it's unexported).

**Follow-up:** What's the practical impact? Answer: usually zero — one extra goroutine per outer context. But in high-fanout systems wrapping a custom context type at the top can multiply goroutines by the number of derivations. If you're writing middleware that returns a custom `Context`, prefer embedding `context.Context` and letting the stdlib types remain visible to `parentCancelCtx`.

The actual `parentCancelCtx` lookup is worth reading in `context/context.go`:

```go
// parentCancelCtx returns the underlying *cancelCtx for parent.
// It does this by looking up parent.Value(&cancelCtxKey) to find the
// innermost enclosing *cancelCtx and then checking whether parent.Done()
// matches that *cancelCtx. (If not, the *cancelCtx has been wrapped
// in a custom implementation providing a different done channel,
// in which case we should not bypass it.)
func parentCancelCtx(parent Context) (*cancelCtx, bool) {
    done := parent.Done()
    if done == closedchan || done == nil { return nil, false }
    p, ok := parent.Value(&cancelCtxKey).(*cancelCtx)
    if !ok { return nil, false }
    pdone, _ := p.done.Load().(chan struct{})
    if pdone != done { return nil, false }
    return p, true
}
```

The `done == parent.Done()` check is the trick — if a custom context replaced `Done()`, the lookup fails and the fallback goroutine kicks in. The lookup itself goes through `Value`, which is how `cancelCtx` becomes findable in the chain.

---

### Q8. Why is the key-type pattern (`type myKey struct{}`) needed for `context.Value`?

**Short answer:** `Context.Value` keys are compared with `==`, and the comparison is across packages. If two packages both used `"user"` as a key, they'd collide silently — one's read would see the other's write. The standard pattern is to declare an *unexported* key type in each package and use a zero-value instance:

```go
package auth
type userKey struct{}

func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, userKey{}, u)
}
func UserFrom(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(userKey{}).(User)
    return u, ok
}
```

The unexported type guarantees no other package can construct the same key — `userKey{}` from outside `auth` is a compile error because the type is unexported. The pattern also forces consumers through `UserFrom`, which encapsulates the type assertion.

**Follow-up:** Why not use a string key behind a private constant? Answer: string keys still collide if two packages happen to pick the same string; only the unexported type makes collisions impossible. Strings work in practice but are a smell.

---

### Q9. Show a goroutine leak that comes from missing `cancel`.

**Short answer:** The classic shape: a parent goroutine creates a `WithCancel` context, fans out workers that listen on `ctx.Done()`, but the parent returns without calling `cancel()`. The workers block forever on `Done()` because the channel is never closed. The context object stays alive (parent's map references it), the workers stay alive (blocked on receive), and the leak compounds per request.

```go
func leak() {
    ctx, _ := context.WithCancel(context.Background()) // BUG: cancel ignored
    go func() {
        select {
        case <-ctx.Done(): // never fires
        case <-time.After(time.Hour): // safety net, but bad
        }
    }()
    // returns, ctx is never cancelled, goroutine leaks
}
```

The fix is `defer cancel()` on the line after `WithCancel`. The leak is invisible until you look at `pprof.Lookup("goroutine")` and see N copies of `select` blocked on `runtime_chanrecv`.

**Follow-up:** Why doesn't the GC clean this up? Answer: the goroutine holds a reference to `ctx` (via the closed-over variable), `ctx` holds a reference to its parent's `children` map, and the parent's map holds a reference back to `ctx`. The cycle is reachable through any live goroutine — GC won't collect anything that has a runnable or blocked goroutine pointing at it.

---

### Q10. How does `WithDeadline` interact with `WithCancel`?

**Short answer:** `WithDeadline` returns a context that's cancelled when either (a) the deadline arrives, (b) `cancel` is called explicitly, or (c) the parent is cancelled. Internally it embeds a `cancelCtx` and arms a `time.AfterFunc` that calls `cancel(DeadlineExceeded)` when the deadline arrives. Calling the returned `cancel` explicitly is still required to stop the timer and release the parent slot — if you let the deadline fire naturally and never call `cancel`, the timer fires and self-cancels, but the parent's children map still holds the entry until the parent itself is cancelled or GC'd. So `defer cancel()` matters even when you "know" the deadline will fire first.

```go
ctx, cancel := context.WithDeadline(parent, time.Now().Add(5*time.Second))
defer cancel() // always, even if deadline will fire
```

**Follow-up:** What error does the context return when the deadline fires? Answer: `context.DeadlineExceeded` from `ctx.Err()`. If you called `cancel` explicitly, you get `context.Canceled` instead. The distinction matters for retry logic: `Canceled` usually means "client gave up, don't retry," `DeadlineExceeded` means "we ran out of budget, maybe the next try will fit."

---

### Q11. What's `context.WithoutCancel` for, and when would you use it?

**Short answer:** `WithoutCancel(parent)` (added in Go 1.21) returns a context that inherits `parent`'s values but *not* its cancellation or deadline — `Done()` returns nil, `Err()` returns nil forever. Use it when you need to do follow-up work after the parent finishes, like flushing analytics after an HTTP handler returns, or writing an audit log entry after a cancelled request. Before 1.21 you'd do this by creating a fresh `Background()` and manually copying values across — `WithoutCancel` makes it one call.

```go
go func(ctx context.Context) {
    ctx = context.WithoutCancel(ctx) // detach from request lifetime
    flushMetrics(ctx)                // can outlive the request
}(r.Context())
```

**Follow-up:** Why not just use `context.Background()` for the detached work? Answer: you'd lose request-scoped values (trace ID, tenant ID, locale) that the downstream code expects. `WithoutCancel` keeps the values, drops only the cancellation. That's almost always what you want.

---

### Q12. How does `context.AfterFunc` work and when do you reach for it?

**Short answer:** `AfterFunc(ctx, f)` (Go 1.21+) registers `f` to be called *in a new goroutine* when `ctx` is cancelled. It returns a `stop` function that cancels the registration. Use it to attach cleanup actions to a context's cancellation without writing the `go func() { <-ctx.Done(); cleanup() }()` boilerplate yourself. The runtime can sometimes coalesce these registrations into the cancel callback chain rather than spawning a watcher goroutine for each — cheaper than DIY.

```go
stop := context.AfterFunc(ctx, func() {
    conn.Close() // run when ctx is cancelled
})
defer stop() // call if we finished naturally and don't need the cleanup
```

**Follow-up:** What does `stop()` return? Answer: a bool — true if the call de-registered `f` before it ran, false if `f` already ran (or was already scheduled to run). Lets you distinguish "we cleaned up ourselves" from "the deadline fired and `f` got there first."

---

## 4. Senior questions (Q13–Q20)

### Q13. Walk through the cost of `context.Value` lookup in detail.

**Short answer:** `ctx.Value(key)` is a linear walk up the parent chain. Each `valueCtx` checks `c.key == key`; if not, recurses to `c.Context.Value(key)`. With N derived contexts in the chain, lookup is O(N) per call. Two implications. (1) **Hot-path cost** — if a handler reads three values inside a tight loop, each read walks the chain; cache the values in locals at the top of the function. (2) **Allocation per `WithValue`** — every call boxes the key, value, and parent pointer into a heap-allocated `valueCtx`. A request that adds 10 values via 10 separate `WithValue` calls has 10 allocations and a 10-deep chain. Better to bundle related values into one struct and `WithValue` once.

```go
type requestInfo struct {
    UserID  string
    Tenant  string
    TraceID string
}
ctx = context.WithValue(ctx, requestInfoKey{}, info) // one alloc, one chain entry
```

**Follow-up:** Has Go ever optimised this? Answer: no — the design deliberately keeps `valueCtx` linear because (a) chains are usually short (<10 entries), (b) a map would change the API contract (keys must be hashable), (c) immutability is preserved. If you have a deep chain in production, it's a code smell, not a stdlib bug to fix.

The source for `valueCtx.Value` is one of the shortest functions in the package and worth memorising:

```go
func (c *valueCtx) Value(key any) any {
    if c.key == key { return c.val }
    return value(c.Context, key)
}

func value(c Context, key any) any {
    for {
        switch ctx := c.(type) {
        case *valueCtx:
            if key == ctx.key { return ctx.val }
            c = ctx.Context
        case *cancelCtx:
            if key == &cancelCtxKey { return c }
            c = ctx.Context
        // ... other special cases ...
        default:
            return c.Value(key)
        }
    }
}
```

The iterative `for` loop unrolls the recursion — important because a 1000-deep ctx chain would otherwise blow the stack. The `case *cancelCtx` branch is what `parentCancelCtx` uses to find ancestors.

---

### Q14. Discuss context propagation in microservices — how does it cross gRPC and HTTP?

**Short answer:** Cancellation and deadline cross process boundaries via *metadata*, not via the language-level `Context` directly. (1) **gRPC** — the client serialises `ctx.Deadline()` into the request and propagates trace headers from `ctx.Value`; the server reconstructs a `Context` with the same deadline and cancellation semantics. Client cancellation is sent over the wire as a stream termination, which the server's `Context` observes via `Done()`. (2) **HTTP** — `net/http` doesn't auto-propagate deadlines; you set headers manually (`X-Request-Deadline`, OpenTelemetry's `traceparent`). The receiving server constructs a `Context` and ideally calls `WithDeadline` based on the header. `httptrace` and OpenTelemetry middleware handle this for you.

The non-obvious bit: cancellation only propagates *one way* by default (client → server). If a server starts work, the client cancels, the server sees its `r.Context().Done()` fire and should stop. But if the server initiates a downstream call, the *server*'s ctx must be passed to that call so the downstream sees the same cancellation. Forgetting to plumb `ctx` through is the most common bug.

**Follow-up:** What's `traceparent` carrying? Answer: W3C trace context — trace ID, span ID, sampling flags. It's propagated alongside but separate from cancellation; both belong in the request context but only deadline / cancellation are stdlib-handled.

---

### Q15. When does the context-first-parameter convention not apply?

**Short answer:** Three legitimate exceptions. (1) **Methods on a type that already encapsulates a context** — a `*http.Client` doesn't take `ctx` on every method because the per-request context lives on the `*Request`. (2) **Lifecycle methods on long-lived objects** — `(*sql.DB).Stats()` doesn't take ctx because it's a synchronous, in-memory query of pool state. (3) **Constructors and configuration** — `New(...)` shouldn't take ctx unless construction itself does I/O. The convention is "if the function does work that could be cancelled or has a deadline, take ctx as the first parameter." If it's a pure computation, taking ctx is overhead and misleading documentation.

```go
// Good: ctx first, I/O happens, cancellation matters
func (s *Store) Get(ctx context.Context, id string) (Item, error)

// Good: no ctx, pure computation
func (s *Store) Len() int

// Bad: ctx that's never used
func NewStore(ctx context.Context, opts Options) *Store { /* doesn't touch ctx */ }
```

**Follow-up:** What's the smell of "ctx parameter passed but ignored"? Answer: lint catches it (`SA1019` or `unused-parameter`). It's a maintenance landmine — a future change adds an I/O call inside, but no caller is passing a *meaningful* ctx because they assumed it didn't matter. Either use it or drop it.

---

### Q16. Build a middleware that injects auth claims into the request context.

**Short answer:** Verify the token, type-safely stuff the parsed claims into `ctx.Value` via an unexported key, hand the modified request down the chain. The middleware owns the key type; consumers retrieve via a typed accessor.

```go
package auth

type claimsKey struct{}

type Claims struct {
    Subject string
    Scopes  []string
    Expires time.Time
}

func ClaimsFrom(ctx context.Context) (Claims, bool) {
    c, ok := ctx.Value(claimsKey{}).(Claims)
    return c, ok
}

func Middleware(verify func(string) (Claims, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
            claims, err := verify(tok)
            if err != nil {
                http.Error(w, "unauthorized", http.StatusUnauthorized)
                return
            }
            ctx := context.WithValue(r.Context(), claimsKey{}, claims)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

Senior moves: (a) `claimsKey` is unexported — no other package can construct one; (b) `ClaimsFrom` is the only public accessor — consumers don't see the `Value(key).(Claims)` shape; (c) `verify` is injected — testable without hardcoding a JWT library; (d) on failure, return before mutating context — no half-authenticated requests downstream.

**Follow-up:** Should `Claims` live in context or on the request? Answer: context is right because the downstream call chain (DB, RPC) inherits it for free — anywhere `ctx` flows, auth flows. Putting it on the `*http.Request` ties it to HTTP and you re-extract on every internal call.

---

### Q17. Handle "request-scoped vs application-scoped" data — what goes where?

**Short answer:** Three buckets.

| Data | Lifetime | Storage |
|------|----------|---------|
| **Application-scoped** (logger, DB pool, config) | Process | Dependency injection / struct fields |
| **Request-scoped** (trace ID, user, locale) | Single request | `context.Value` |
| **Method-scoped** (query params, body) | Single call | Function parameters |

The mistake is treating `context.Value` as a general-purpose service locator. A logger pulled from `ctx.Value` looks request-scoped but is actually application-scoped — its lifetime is the process, its dependencies are constant. Inject it. The opposite mistake: passing the trace ID as a parameter through 12 functions. Trace ID flows with the request; put it in context once, consumers retrieve it where needed.

The diagnostic question: "if I restarted the process, would this value still be the same?" If yes, inject. If no (different per request), context.

**Follow-up:** What about per-tenant configuration in a multi-tenant service? Answer: tenant *identity* (which tenant is this request for) is request-scoped — context. Tenant *config* (rate limits, feature flags, billing tier) is application-scoped — inject a `TenantRegistry` or similar that you lookup by tenant ID inside the handler.

---

### Q18. Show `WithCancelCause` use cases.

**Short answer:** `WithCancelCause(parent)` returns `(ctx, cancel func(error))` — the cancel takes an error explaining *why*. `context.Cause(ctx)` retrieves that error, which is more specific than `ctx.Err()`'s generic `Canceled`. Three use cases. (1) **Distinguishing cancellation reasons** — "user cancelled" vs "downstream timeout" vs "circuit broken" — each becomes a distinct cause that callers can switch on. (2) **Surfacing the root cause in deep chains** — a cancel deep in the tree carries its reason all the way up to the handler logging "request failed because: rate limit exceeded." (3) **Replacing custom error wrapping** — instead of wrapping `ctx.Err()` with context strings in every consumer, set the cause at cancel time and read it once at the boundary.

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil) // nil = no cause beyond normal cancel

if rateLimitExceeded {
    cancel(errRateLimited) // specific cause
}

// elsewhere, after work:
if err := ctx.Err(); err != nil {
    return fmt.Errorf("work failed: %w", context.Cause(ctx))
}
```

**Follow-up:** What does `Err()` return when `Cause()` was set? Answer: `Err()` still returns the canonical `context.Canceled` or `context.DeadlineExceeded` (for `WithDeadlineCause`). `Cause()` returns the custom error you passed. The split lets stdlib consumers (HTTP, database/sql) keep using `Err()` for control flow while application code reads `Cause()` for logging and reporting.

---

### Q19. How do you detect leaked contexts in production?

**Short answer:** Three signals to monitor. (1) **Goroutine count over time** — `runtime.NumGoroutine()` or `expvar` exposes it; a steady-state service with a slow upward trend usually means context-watcher goroutines aren't being cancelled. (2) **`pprof.Lookup("goroutine")` snapshots** — look for many goroutines blocked on the same `runtime_chanrecv` / `Done` stack frame; that's the smoking gun for a leaked context tree. (3) **`go vet`'s `lostcancel`** at CI — catches missing `cancel()` calls at compile time; the cheap defence. For runtime detection, the `golang.org/x/exp/event` and OpenTelemetry packages can emit a span per context lifetime; long-lived spans without close are leak candidates.

```go
// Goroutine count metric for Prometheus:
goroutineCount := prometheus.NewGaugeFunc(
    prometheus.GaugeOpts{Name: "goroutines"},
    func() float64 { return float64(runtime.NumGoroutine()) },
)
```

The deeper move: most leaks come from one of three patterns — (a) launching a goroutine that listens on `ctx.Done()` without a way to cancel from outside, (b) `select { case <-ctx.Done(): }` blocks where ctx is never cancelled, (c) `WithCancel` without `defer cancel()`. Code review for those patterns is more effective than runtime detection.

**Follow-up:** What's the simplest leak detector for tests? Answer: `goleak.VerifyTestMain` from `go.uber.org/goleak`. Snapshots goroutines before the test and verifies none leaked. Catches most context leaks at the unit level before they reach production.

---

### Q20. What's the trade-off between `context` and goroutine-local storage (GLS)?

**Short answer:** Go deliberately doesn't have GLS. The alternative is `context` — explicit, passed by parameter, immutable, scoped. The trade-offs go each way. **Against GLS:** invisible state, hard to test (you can't set GLS in a unit test the way you can pass a fake context), thread-affinity assumptions break in M:N runtimes. **For GLS (what `context` gives up):** transparent — no need to thread ctx through every function, less boilerplate. Go's choice is explicitness: every function that needs request state declares it via parameter; nothing crosses without being typed in the signature. The downside is the famous "ctx is everywhere" complaint — every function in a Go service takes `ctx context.Context` as its first parameter. The upside is no surprises: you can read a function signature and know what it depends on.

The pragmatic split: stdlib uses `context` for everything request-scoped. Some logging frameworks (zap, slog) pull request fields from context to avoid the boilerplate. That's GLS smuggled in via the context — explicit at the boundary, implicit inside the logger.

**Follow-up:** Why doesn't Go just add GLS? Answer: the language proposal exists, gets rejected each time. Reasons: composability (GLS doesn't survive goroutine spawning cleanly), debuggability (hidden state is hard to reason about), and the design philosophy of "make dependencies visible." Adding GLS would also break the runtime's freedom to migrate goroutines across OS threads.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. Critique `context`'s design — interface + values + cancel in one type.

**Short answer:** It's a *tagged union of responsibilities* hiding behind one interface, and that bothers people for good reasons. Three critiques. (1) **Conflated concerns** — cancellation, deadlines, and key-value storage are three different things forced into one interface; some calls want only cancel (an iterator), some want only values (a logger), and they all carry the same baggage. (2) **`Value(any) any` is a hole in the type system** — every API that takes a `Context` accepts arbitrary state with no compile-time signature; a clear language design failure. (3) **Mandatory ctx parameter everywhere** — almost every Go function now takes `ctx context.Context` as its first parameter, which is noise for the 30% of cases where ctx is plumbed but unused.

Counter-defence. (1) Bundling means *one* parameter does the work of three — the cost of three separate parameters would be worse. (2) `Value` is a pragmatic compromise: gRPC and HTTP need to carry request metadata across boundaries; without it, every framework would reinvent the wheel with a worse type. (3) "Ctx everywhere" is a function-style cost paid up front for cancellation propagation that would otherwise leak goroutines.

The honest read: `context` is the right answer for Go circa 2014, when it shipped. With generics (1.18+) and structured concurrency proposals, the design would look different today — typed values, separate cancel and value types, integration with `errgroup`-like coordination.

**Follow-up:** What would you redesign? Answer: typed values via generic accessors (`context.Value[Claims](ctx)`), separate `Canceller` and `Valuer` interfaces composed when needed, structured concurrency that auto-cancels children when the parent's scope exits. The Go team is exploring some of this; the constraint is backward compatibility — any change must coexist with billions of lines of `func F(ctx context.Context, ...)`.

---

### Q22. Compare `context` to async/await contexts in Rust and JS.

**Short answer:** They solve overlapping but not identical problems.

| Concern | Go `context` | Rust async (`tokio`, etc.) | JS `AbortController` |
|---------|--------------|-----------------------------|----------------------|
| **Cancellation** | Explicit signal via `Done()` channel | Cooperative drop of futures | `AbortSignal` event |
| **Deadlines** | Built-in `WithDeadline` | Combinator (`tokio::time::timeout`) | Manual via `setTimeout` + abort |
| **Values** | Built-in `Value` map | Task-local storage (`tokio::task_local!`) | Not standardised |
| **Propagation** | Manual parameter passing | Implicit via future graph | Manual signal passing |
| **Idiom** | "Pass ctx as first param" | "Compose futures" | "Pass signal to fetch" |

Rust's model is *structurally* better — dropping a future automatically cancels its work; you can't leak a context by forgetting to call cancel, because the drop is enforced by the type system. The cost is that Rust async is famously hard to reason about (the "pinning" problem, lifetime gymnastics). Go's `context` is more brittle (you can leak by forgetting `cancel()`) but vastly simpler to learn and use.

JS's `AbortController` is closer to Go's model — explicit signal, manual propagation — but lacks values and deadlines as first-class concepts. The web platform ended up reinventing what Go got right in 2014.

**Follow-up:** Could Go adopt Rust's model? Answer: not without breaking changes — Go's goroutines don't have lifetimes you can attach drop semantics to. A new "scope" primitive (see structured concurrency) could approximate it, but goroutines + context will remain the lingua franca for years.

---

### Q23. When would you *not* use `context`?

**Short answer:** Five cases. (1) **Long-lived workers with no caller** — a metrics flusher that runs for the process lifetime takes no ctx because there's no caller to cancel it; if it needs shutdown, hook into the process's signal handler, not a context. (2) **Pure computations** — a hash function, a serialiser, a math routine that's CPU-bound and short — adding `ctx` is overhead and misleading. (3) **Inside a Locker/mutex critical section** — you can't cancel a mutex acquisition without releasing it; pass ctx around the lock, not through it. (4) **APIs you can't change** — wrapping a legacy library that doesn't take ctx; don't fake it by stuffing ctx into a global. (5) **Type with its own lifecycle** — a `*sql.Conn` already has `Close()`; layering ctx-based cancellation on top duplicates the model.

The diagnostic question: "would adding ctx let the caller cancel work that's otherwise unbounded?" If no, leave it out — ctx is a signal, not a marker of seriousness.

**Follow-up:** What about goroutines you launch from `main`? Answer: take a context tied to `signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)`. Cancellation flows from OS signal to ctx; shutdown is testable by calling cancel manually in tests.

---

### Q24. Argue for and against "scoped values" (proposal #67434 / golang.org/cl/scoped-values).

**Short answer:** Scoped values are a proposed alternative to `context.Value` where values are bound to a *dynamic scope* (call stack), not to a context object that you must thread through. Conceptually: `WithScopedValue(key, val, fn)` runs `fn()` with `key` bound to `val`; deep inside, anyone can `LookupScopedValue(key)` without ctx plumbing. Comparable to Java's `ScopedValue` (JEP 429).

**For:** (1) Eliminates ctx-threading boilerplate for genuinely process-traversing values (trace ID, tenant). (2) Type-safe — generic accessors return the right type. (3) Faster lookup — scope is a thread-local-ish slot, not a chain walk.

**Against:** (1) Reintroduces GLS that Go has resisted since 1.0 — invisible state, hard to test. (2) Breaks the "function signature is the dependency contract" principle. (3) Goroutine boundaries muddy scope — when you spawn a goroutine inside a scope, does the new goroutine inherit? Java's design says no; tricky to extend. (4) Adds another way to do what `context.Value` already does — three years of "should I use ctx or scope?" debates.

The honest staff-level read: scoped values are a *better technical solution* for the trace-ID-style use case, but the Go team is reluctant to add language complexity for an 80%-solved problem. If it ships, it'll be opt-in and the stdlib will continue using `context.Value` for compatibility.

**Follow-up:** How would this interact with goroutines? Answer: open design question. Likely model: scoped values are inherited at goroutine spawn (copied into the new goroutine's scope) but mutations in the parent don't propagate. Same as Java's `ScopedValue` semantics under structured concurrency.

---

### Q25. How does `context` interact with structured concurrency proposals?

**Short answer:** Structured concurrency (SC) is the idea that every goroutine has a *parent scope* it cannot outlive — when the scope exits, all child goroutines are joined or cancelled. `context` is Go's incomplete approximation: cancellation propagates parent-to-child, but goroutine lifetime is not bound to context lifetime. You can spawn a goroutine in `ctx`'s scope and let it leak past the cancel; SC would forbid that by construction.

Three interaction points if SC ships. (1) **Cancellation alignment** — SC scopes would replace `WithCancel`'s manual model; cancel would fire when scope exits. (2) **`errgroup` formalisation** — `errgroup.Group` is the current ad-hoc SC primitive; SC would make it a language feature with compile-time enforcement. (3) **Goroutine leaks become impossible** — the type system prevents returning from a scope while children are still running. The migration question: how does ctx-as-parameter coexist with scope-as-implicit? Likely answer: ctx becomes the *cancellation signal*, scope becomes the *lifetime guarantee*; you keep both, they layer.

Staff move: name the proposal's trade-off honestly. SC is provably better at preventing leaks but at the cost of *ergonomic* changes — many "fire and forget" goroutines today (logging, metrics) violate SC and would need refactoring. Go's design philosophy of "you can launch a goroutine cheaply, anywhere" runs counter to SC's "every goroutine has a parent scope." Reconciling those will define how the proposal evolves.

**Follow-up:** Is there a Go proposal you'd point to? Answer: the broader "structured concurrency" discussion lives in issues like #28342 and the various `errgroup` enhancement proposals. There's no formal accepted spec; the community is feeling out what the shape should be. Watch the proposal repo and `errgroup` for the direction of travel.

---

## 6. What NOT to say

These will tank your interview signal. Avoid them.

- **"`context.Background()` and `context.TODO()` are the same thing."** Mechanically true, semantically a smell — you've conflated the linter intent. Say "they're identical mechanically but signal different things to readers and linters."
- **"`context.Value` is a map."** It's not — it's a linear chain of `valueCtx` wrappers. Calling it a map suggests you've never read the source.
- **"You don't need `cancel()` if the timeout will fire anyway."** False — the timer keeps a reference and the parent's children map keeps the child reachable until you cancel.
- **"I put the logger in context for convenience."** Red flag — logger is application-scoped, not request-scoped. Reviewers will assume you don't understand the value pattern.
- **"`context.Context` is thread-safe because it's an interface."** No — it's thread-safe because the *implementations* (`cancelCtx`, `valueCtx`) are documented as safe for concurrent use; interfaces themselves have no thread-safety guarantee.
- **"I never call `cancel`, I just let GC handle it."** Goroutine leak guaranteed — GC can't collect anything reachable from a blocked goroutine.
- **"Go's `context` is just like async/await."** No — async/await is about *suspension*, context is about *cancellation propagation*. They're orthogonal.
- **"I use string keys for `context.Value` because they're simple."** Collision risk across packages; unexported-type keys are the standard pattern for a reason.
- **"Cancellation propagates automatically across HTTP/gRPC."** Partly true — gRPC handles it via stream termination; HTTP requires header-based deadline propagation that you wire up yourself.
- **"`WithoutCancel` is for tests."** It exists for production code that needs to outlive the parent (analytics flush, audit logs); using it in tests is fine but isn't the headline use case.
- **"I always pass `context.Background()` into library functions."** Smell — you're discarding the caller's deadline and cancellation. Pass the caller's ctx through; create new ones only at entry points.
- **"The `Done()` channel is closed when cancel is called or the deadline expires."** Correct, but say more — also when any ancestor is cancelled. Cancellation is hierarchical.
- **"`context.Value` lookups are constant time."** They're O(chain depth). Cache values in locals when reading in a hot loop.
- **"A custom `Context` type is just embedding the interface."** That works mechanically but costs an extra goroutine per derivation because it can't participate in `parentCancelCtx`. Prefer not to wrap unless you have to.

---

## 7. Five-minute pre-interview checklist

Walk through this list silently the morning of the interview. If any item makes you blank, open the file and re-read that section.

- **Define context in one sentence.** "Deadline + cancellation + request-scoped values, propagated across goroutines and API boundaries."
- **`Background()` vs `TODO()`.** Mechanically identical, semantically different; `TODO()` is a marker.
- **Three constructors.** `WithCancel` (manual), `WithTimeout` (relative), `WithDeadline` (absolute). All return `(ctx, cancel)`. Always `defer cancel()`.
- **What `cancel` does.** Closes Done channel, sets `Err()`, cancels children, removes from parent's children map, stops any timer.
- **Key-type pattern.** `type myKey struct{}` — unexported, so no other package can collide.
- **`Value` cost.** O(N) walk of the chain. Bundle related values; cache reads in locals.
- **`WithCancelCause`.** Cancel with a typed error; retrieve via `context.Cause(ctx)`. `Err()` still returns canonical `Canceled`/`DeadlineExceeded`.
- **`WithoutCancel`.** Inherits values, drops cancellation. Use for follow-up work that outlives the parent.
- **`AfterFunc`.** Register cleanup on cancellation; cheaper than DIY `go func(){<-Done();...}()`.
- **Leak diagnosis.** Goroutine count trending up + `pprof.Lookup("goroutine")` shows many blocked on `Done()`. CI catches with `go vet lostcancel`.
- **Propagation across services.** gRPC: deadline in stream headers, cancel via stream termination. HTTP: manual via headers (`traceparent`, `X-Request-Deadline`).
- **Request-scoped vs app-scoped.** Logger/DB/config → inject. Trace ID / user / locale → context. Diagnostic: "would this change between requests?"
- **When NOT to use context.** Long-lived workers, pure computation, locks, legacy APIs, types with their own lifecycle.
- **Design critique.** Conflates three concerns; `Value(any) any` is a type hole; ctx-everywhere is noise. Justification: bundling is cheaper than three params; `Value` is pragmatic; cancellation propagation is worth the boilerplate.
- **Structured concurrency.** Future direction — every goroutine has a parent scope; context's cancellation propagation aligns; goroutine leaks become impossible. Not shipped.
- **Three things to mention unprompted.** (a) `defer cancel()` on every derivation. (b) Unexported key type for `Value`. (c) Don't put loggers in context.

If you can give the five-minute version of all 16 bullets without hesitation, you're ready. The interview question you'll get is almost certainly one of: "explain context," "how do you cancel a long-running operation," "have you debugged a goroutine leak," or "design a request lifecycle." Each maps cleanly onto a section above; the rest is composure.
