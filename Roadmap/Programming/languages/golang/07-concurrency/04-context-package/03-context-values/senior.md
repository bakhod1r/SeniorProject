# Context Values — Senior

[← Back to index](junior.md)

The junior file taught the syntax and the unexported key idiom. The middle file taught middleware composition and accessor design. The senior level is about *judgment*: when to refuse context values entirely, when to model a domain so context-passing is unnecessary, how to reason about lifetime leakage, and how to spot the API smells that betray a misuse.

By the end of this page you should be able to:

- Argue convincingly when *not* to use a context value, even when it looks convenient.
- Detect the four most common architectural anti-patterns around context.
- Reason about the lifetime of objects placed in context and the leaks that result.
- Replace context values with explicit DI or struct method receivers where it improves code.
- Compare Go's design with `ThreadLocal`/`AsyncLocalStorage`/CLS in other ecosystems.
- Reason about thread-safety of values placed in context.

## The Hardest Skill: Saying No

There is a recurring pattern in code reviews of Go services that have grown for two years. Someone reaches for `context.WithValue` because the alternative looks ugly. A struct gets too many fields. A function signature gets too long. A new feature needs a flag in three layers. Context starts absorbing all of it.

The senior engineer's job is to recognise this drift and roll it back. Below are the four anti-patterns to watch for.

### Anti-pattern 1: context as a function-parameter substitute

The smell: a function whose *behaviour* changes based on a context value.

```go
func ListOrders(ctx context.Context) ([]Order, error) {
    tenant, _ := tenantctx.From(ctx)
    return db.QueryForTenant(tenant)
}
```

If the function does not work without the value, the value is a parameter in disguise. The fix is one of:

- Pass it explicitly: `ListOrders(ctx context.Context, tenant TenantID)`.
- Move the function onto a struct whose constructor takes the tenant: `(*TenantOrders).List(ctx)`.
- Build a request-scoped service struct: `Services{Tenant: t, DB: db}` and pass it around.

Each option makes the dependency visible. The context-only version hides it, and reviewers cannot tell what `ListOrders` actually needs without reading the implementation.

The line: **if reading the context value can fail and the function has no sensible behaviour when it does, the value should be a parameter.**

### Anti-pattern 2: context as a DI container

The smell: a `Services` struct stored in context.

```go
ctx = context.WithValue(ctx, servicesKey, Services{
    DB:    db,
    Cache: cache,
    Log:   log,
})

// later
svc := ctx.Value(servicesKey).(Services)
svc.DB.Query(...)
```

This trades visible plumbing for invisible coupling. Every function now has an implicit dependency on whatever `Services` happens to contain. Tests have to fake the entire bag. Refactors that add a new field break callers that did not expect it.

The fix is mundane and correct: wire dependencies through constructors.

```go
type OrderHandler struct {
    db    DB
    cache Cache
    log   *slog.Logger
}

func NewOrderHandler(db DB, cache Cache, log *slog.Logger) *OrderHandler { ... }

func (h *OrderHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) { ... }
```

The handler owns its dependencies. The compiler knows what is needed. Tests construct the handler with fakes. No context magic.

The line: **infrastructure objects (DB, cache, clients, loggers without request-specific fields) are application-scoped; they belong in constructors, not in context.**

### Anti-pattern 3: context as mutable state

The smell: code that retrieves a value from context, mutates it, expects future readers to see the change.

```go
type Counter struct {
    n int
}

ctx = context.WithValue(ctx, counterKey, &Counter{})

// somewhere downstream
c := ctx.Value(counterKey).(*Counter)
c.n++
```

This works only by accident — `*Counter` is a pointer, so the mutation is visible. But:

- The mutation is not synchronized; two goroutines crash.
- The context's "immutable values" contract is violated in spirit if not in letter.
- Future readers cannot tell whether the value will be the one the caller set or some later mutation.

The fix is to put the counter in a struct dedicated to the operation and pass it explicitly.

The line: **context carries immutable, request-scoped data. Mutable state belongs to the goroutine that owns the operation.**

### Anti-pattern 4: context as a callback registry

The smell: storing function values in context so deep code can invoke them.

```go
ctx = context.WithValue(ctx, hookKey, func(e Event) {
    metrics.Record(e)
})

// deep in the call stack
hook := ctx.Value(hookKey).(func(Event))
hook(Event{...})
```

Function values in context are difficult to reason about. They cannot be type-checked at the call site without a panic-able assertion. They couple deep code to the caller's local function literal. They blur the line between "carry data" and "carry behaviour."

The fix is to define an interface, attach an interface value if you really must, or — much better — pass the dependency through constructor injection.

The line: **behaviour belongs in interfaces injected at construction, not in `any`-typed slots looked up at use.**

## Lifetime and Leakage

A value placed in a context lives as long as any reference to the chain. In a normal HTTP request that is "until the response is written and the handler returns." In a long-running goroutine spawned from the request, it can be much longer.

### Leaking values through goroutines

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // has request ID, user, ...

    go func() {
        // This goroutine outlives the request.
        // The user in ctx is now reachable forever, until this goroutine exits.
        backgroundWork(ctx)
    }()

    w.WriteHeader(202)
}
```

If `backgroundWork` runs for ten minutes, the user value in `ctx` lives for ten minutes. The `*User` is reachable, the GC cannot collect it, and the user's email sits in the heap.

Two fixes:

1. **Detach the long-running work** with `context.WithoutCancel(ctx)` — but this still carries values. If that is acceptable (you want the trace ID to flow), fine. If not:
2. **Build a fresh context** for the background work and copy only what you need:

```go
go func() {
    bg := context.Background()
    bg = traceid.With(bg, traceid.From(ctx))
    backgroundWork(bg)
}()
```

The background work no longer holds the user, the database row buffer, or anything else attached to the original request.

### Leaking values through caches

Storing the *result* of a context-derived computation in a process-wide cache is fine. Storing the *context itself* is a leak:

```go
var cache sync.Map

func get(ctx context.Context, id string) Order {
    if v, ok := cache.Load(id); ok {
        return v.(entry).order
    }
    // ...
    cache.Store(id, entry{ctx: ctx, order: o}) // BUG: ctx is request-scoped
    return o
}
```

Now the cache holds the context of whichever request first warmed the entry. That context carries the user, the trace ID, and the logger of a single, long-gone request. Worse, if your accessors then read that user from the cached context for a *different* request, you have leaked authentication state.

The fix is to never store a `context.Context` outside the call chain. Extract the data you need, store the data.

### Leaking large values

Same principle: a 50 MB byte slice placed in context lives as long as the longest goroutine that holds the chain. Pass it as a parameter so it dies with the function.

## Replacing Context Values With Explicit Design

A code review heuristic: when you see five `WithValue` calls in a single middleware chain, ask whether the problem can be modelled differently.

### Replacement 1: a request struct

Instead of attaching `requestID`, `user`, `tenant`, `locale` separately:

```go
type Request struct {
    ID     string
    User   User
    Tenant TenantID
    Locale string
}
```

Attach one value, the `*Request`. Now lookup is one walk, accessors are field reads:

```go
req := requestctx.From(ctx)
log.Info("processing", "request_id", req.ID)
```

Trade-off: every layer that wants only the request ID still loads the whole struct. For small structs this is fine.

### Replacement 2: a request-scoped service

If five middleware layers all build the same `*RequestLogger`, build it once at the edge and store the *factory output* in context. Or — more often — define a `RequestServices` struct with everything wired and pass it as a method receiver:

```go
type RequestServices struct {
    Log    *slog.Logger
    User   User
    Tenant TenantID
}

func (s *RequestServices) Handle(w http.ResponseWriter, r *http.Request) {
    s.Log.Info(...)
}
```

The handler is now a method on a struct constructed per request. No context lookups, no type assertions.

### Replacement 3: explicit parameters

For "values" that are actually parameters in disguise, just make them parameters. A function with `(ctx, userID, tenantID)` is clearer than one with `(ctx)` and three implicit lookups.

## Comparison With Other Languages

The decision to omit goroutine-local storage is fundamental to Go's design. Comparing with neighbours sharpens the trade-offs.

### Java `ThreadLocal`

`ThreadLocal<User> CURRENT_USER` is set on thread entry, read anywhere, cleared on exit. Pros: zero plumbing. Cons:

- Coupled to the OS thread. With virtual threads (Loom) or async frameworks, surprising lifetimes.
- Leaks if not cleared — pools reuse threads.
- Implicit dependency: a method's signature does not tell you it reads `CURRENT_USER`.

Go's explicit `context.Context` parameter solves all three. The parameter is visible, the lifetime is the call chain, no thread reuse leaks.

### Node.js `AsyncLocalStorage`

Node's `AsyncLocalStorage` (built on `async_hooks`) provides Go-style request-scoped storage for async callbacks. The mechanism: the runtime attaches state to a "store" that follows the async continuation. Pros: works across `await`. Cons: depends on every async API correctly preserving the chain. A library that calls `setImmediate` without instrumentation can lose state.

Go avoids the runtime instrumentation by making the context an explicit value.

### Rust `tokio::task_local!`

`tokio` has `task_local!` for per-task state. Like Go, you must explicitly enter/exit a scope:

```rust
TOKIO_LOCAL.scope(value, async {
    do_work().await;
}).await;
```

Closer to Go in spirit — explicit scoping — but tied to the runtime. Go's mechanism is library-level, not runtime-level.

### Erlang process dictionary

Each Erlang process has a dictionary (`get`/`put`). Universally regarded as a code smell. Erlang's idiomatic answer is the same as Go's: pass state explicitly through function arguments.

The takeaway: every mature concurrent language has wrestled with this. Implicit per-task state always wins ergonomics in the short term and loses maintainability in the long term. Go chose explicitness.

## Thread Safety of Values

A value placed in context is shared. Multiple goroutines may pull it out and use it. The package documentation says values must be safe for concurrent use — but this constraint applies to the lookup, not the value.

### Safe-by-design values

- **Strings, numbers, structs of value types** — immutable, safe.
- `time.Time` — immutable in practice.
- `*slog.Logger` — designed for concurrent use.
- `*url.URL` — read-only if you do not mutate.

### Unsafe-by-design values

- `map[string]string` — concurrent writes race.
- `*bytes.Buffer` — methods are not safe for concurrent use.
- `*sync.Map` — safe, but each get/set is a sync point. Costly under contention.
- Mutable structs without a mutex.

### When in doubt, freeze

Make context values immutable. If a value must change, build a new value and attach a new context:

```go
ctx = reqctx.With(ctx, oldReq.WithRetryCount(oldReq.RetryCount + 1))
```

The downstream code that received the old context still sees the old value. The downstream code that received the new context sees the new one. No mutation, no race.

## API Smell: the `MustGet` Trap

A common production pattern looks innocent but accumulates fragility:

```go
func MustUser(ctx context.Context) User {
    u, ok := ctx.Value(userKey).(User)
    if !ok {
        panic("user not in context")
    }
    return u
}

func handler(w http.ResponseWriter, r *http.Request) {
    u := MustUser(r.Context())
    // ...
}
```

`MustUser` only panics if the middleware is missing — *but you don't know which call site triggered it.* You get a stack trace from a deep call, and the cause is up at the routing layer. Two improvements:

1. **Test it explicitly.** Every route's middleware chain should have an integration test that confirms the user (or whatever) is present.
2. **Centralise the panic.** Have one path that panics — at handler entry — not scattered through the codebase.

A better pattern: the handler's constructor takes a typed function that already promises the value, so calling code does not need `Must` at all:

```go
type AuthHandler func(w http.ResponseWriter, r *http.Request, u User)

func auth(h AuthHandler) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        u, ok := userctx.From(r.Context())
        if !ok {
            http.Error(w, "unauthorized", http.StatusUnauthorized)
            return
        }
        h(w, r, u)
    }
}
```

Now the handler signature *guarantees* a user. No panic, no `Must`.

## When the Context Tree Diverges

Sometimes you want children of the same parent to see *different* values. Example: a batch job processes 1000 items in parallel, each with its own item-ID logged.

```go
for _, it := range items {
    it := it
    go func() {
        itemCtx := itemctx.With(ctx, it.ID)
        process(itemCtx)
    }()
}
```

Each goroutine builds its own derived context. They share the parent's request ID but each has a unique item ID. The chain looks like:

```
       Background
            │
       (request ctx with requestID, user)
       ┌────┼────┐
   item1   item2   item3   ...
   ctx     ctx     ctx
```

`Value(itemKey)` returns the correct item per goroutine. `Value(requestIDKey)` returns the shared request ID for all.

This is the cleanest use of context in concurrent code: the immutable tree gives each branch its own labels.

## API Surface for Library Authors

If you ship a library that puts a value in context, you have obligations:

1. **Keep the key type private.** Do not export `Key` constants.
2. **Provide a `From` (or `FromContext`) function.** Do not require users to import your key type.
3. **Document presence semantics.** Does `From` return a zero value? An `ok` bool? An error? Be explicit.
4. **Document the type stored.** "Returns a `*Span`" not "returns whatever is at the key."
5. **Provide a `With` constructor.** Hide `context.WithValue`.
6. **Use one key per concept.** Five separate keys in one library means five chain hops per request.

OpenTelemetry, `net/http`, `runtime/pprof`, and `database/sql` all follow these rules.

## Anti-Pattern Diagnostic

When reviewing context-heavy code, ask the following five questions:

1. **Is the key private?** If exported, scrutinize. The only exception: `http.ServerContextKey` and similar from the standard library, where the package owns both the key and the type.
2. **Does the accessor return `any`?** If yes, hide it behind a typed accessor.
3. **Does the function fail when the value is absent?** If yes, the value is a parameter in disguise.
4. **Is the value mutable?** If yes, refactor.
5. **Does the value have a lifetime longer than a request?** If yes, move to DI/struct fields.

If any answer is wrong, propose the fix in the review.

## Putting It Together: a Refactor

Imagine a service that grew with five middlewares, four of them attaching to context. A new feature requires "language preference" everywhere. A junior PR adds a sixth middleware. The senior says no:

> "We have six values now. Half of them are read by every layer (request ID, user). Two are read by only one place each (locale, A/B variant). Let's promote the always-read ones to a `*RequestMeta` struct, attach that, and pass the rare ones as parameters where they're needed."

The PR becomes:

```go
type RequestMeta struct {
    RequestID string
    User      User
    Tenant    TenantID
    Locale    string
}

func WithMeta(ctx context.Context, m *RequestMeta) context.Context { ... }
func Meta(ctx context.Context) *RequestMeta { ... }
```

One context value, one chain hop, all the request metadata. The variant flag is passed to the specific handler that uses it.

The same code is now smaller, faster, and easier to test. That is the senior-level outcome.

## Summary

At senior level, knowing `context.WithValue` syntax is the table stakes. The job is calibration: recognise the four anti-patterns (parameter substitute, DI container, mutable state, callback registry); manage lifetime so context values do not leak through goroutines or caches; replace context with explicit design when complexity grows; and review every library you ship to make sure the key is private, the accessor is typed, and the contract is documented. Go's choice to omit goroutine-local storage is a design constraint that pushes you toward better APIs; the senior's job is to honour that push instead of working around it.
