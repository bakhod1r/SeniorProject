# Context Values — Find the Bug

[← Back to index](junior.md)

A field guide to the bugs that show up around `context.WithValue` and `ctx.Value`. Each entry shows broken code, asks you to spot the defect, and then walks through the fix. Most of these bugs survive code review because the failure is subtle, intermittent, or hidden by accidental equality. Studying them by example is the fastest way to internalize the pattern.

## Bug 1 — The String-Keyed Collision

```go
package main

import (
    "context"
    "fmt"
)

func main() {
    ctx := context.Background()
    ctx = context.WithValue(ctx, "user", "alice")

    ctx = thirdPartyMiddleware(ctx)

    fmt.Println("user:", ctx.Value("user"))
}

func thirdPartyMiddleware(ctx context.Context) context.Context {
    return context.WithValue(ctx, "user", 42)
}
```

**What's wrong?**

The string `"user"` is used as a key by two unrelated pieces of code. The library's `WithValue` shadows ours. When we print, we see `42` instead of `"alice"`. Worse — if we ever tried `ctx.Value("user").(string)` we would panic, because the dynamic type is now `int`.

**Why it survived review.** The bug looks like a feature: "the library stamps the field after we did." If the library's behaviour is undocumented, no one notices. The smell is the string key, not the library.

**Fix.** Use private key types per package:

```go
type ctxKey struct{}
var userKey = ctxKey{}

ctx = context.WithValue(ctx, userKey, "alice")
```

Now the library's `"user"` key cannot collide.

---

## Bug 2 — The Exported Key

```go
package authctx

import "context"

type ctxKey int

const UserKey ctxKey = 0

func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, UserKey, u)
}
```

**What's wrong?**

`UserKey` is exported. Any package can now write `context.WithValue(ctx, authctx.UserKey, "fake")` and override the user. Worse, downstream code that reads via `ctx.Value(authctx.UserKey).(User)` will panic on the wrong type.

**Why it survived review.** Exporting feels generous: "let everyone use it." But the whole point of the unexported idiom is to make the slot tamper-proof.

**Fix.** Unexport the constant. Expose accessor functions instead:

```go
type ctxKey int
const userKey ctxKey = 0

func WithUser(ctx context.Context, u User) context.Context { ... }
func UserFromContext(ctx context.Context) (User, bool) { ... }
```

---

## Bug 3 — Type Assertion Panic

```go
func handler(w http.ResponseWriter, r *http.Request) {
    u := r.Context().Value(userKey).(User) // <-- panic if missing
    fmt.Fprintf(w, "hello %s", u.Email)
}
```

**What's wrong?**

If the middleware that attaches `User` did not run (misconfiguration, a different route, a test case that forgot to set it up), `r.Context().Value(userKey)` returns `nil`. The type assertion `nil.(User)` panics. The whole request crashes.

**Why it survived review.** The success path looks clean. The reviewer thinks "nice, no boilerplate."

**Fix.** Use the comma-ok form, or wrap the assertion behind an accessor that handles absence:

```go
u, ok := r.Context().Value(userKey).(User)
if !ok {
    http.Error(w, "unauthorized", http.StatusUnauthorized)
    return
}
```

Better: have one place where this assertion lives.

```go
u, err := authctx.From(r.Context())
if err != nil {
    http.Error(w, "unauthorized", http.StatusUnauthorized)
    return
}
```

---

## Bug 4 — Typed Nil Stored as a Value

```go
var u *User
// u is nil here

ctx = context.WithValue(ctx, userKey, u)

// later:
got, ok := ctx.Value(userKey).(*User)
fmt.Println(got, ok) // (<nil>, true)
```

**What's wrong?**

`ok` is `true` because the stored value *was* a `*User` (the typed nil). But `got` is nil. Code that does `got.Email` panics.

**Why it survived review.** The comma-ok form looks defensive — until you realize it does not catch this case.

**Fix.** Either prevent storing nil pointers:

```go
if u == nil {
    return ctx
}
return context.WithValue(ctx, userKey, u)
```

or check for nil explicitly after retrieval:

```go
u, ok := ctx.Value(userKey).(*User)
if !ok || u == nil {
    return ErrNoUser
}
```

This is one reason to store value types when possible. `User{}` is a valid zero, not a panic-causing nil.

---

## Bug 5 — Middleware Order Reversed

```go
func main() {
    h := http.HandlerFunc(handler)

    // BUG: logger middleware is outside auth, but reads user from context.
    h = logctx.Middleware(slog.Default())(h)
    h = authctx.Middleware(verify)(h)

    http.ListenAndServe(":8080", h)
}
```

**What's wrong?**

When `logctx.Middleware` runs, it tries to read the user from the context. But `authctx.Middleware` is *inside* it — it has not run yet for this request. The logger is built with `user_id=""`.

**Why it survived review.** The handler still works. The auth still works. The only sign is that logs have empty `user_id` fields.

**Fix.** Wrap inside-out so dependencies are added before dependents:

```go
h := http.HandlerFunc(handler)
h = logctx.Middleware(slog.Default())(h)  // reads from auth, runs LAST
h = authctx.Middleware(verify)(h)          // attaches user, runs first

// Equivalently: h = authctx.M(authVerify)(logctx.M(slog.Default())(h))
```

When composing manually, think bottom-up: the outermost wrap runs first when a request arrives.

---

## Bug 6 — Storing the DB Handle

```go
ctx = context.WithValue(ctx, dbKey, db)

// ...
func loadOrder(ctx context.Context, id string) (Order, error) {
    d := ctx.Value(dbKey).(*sql.DB)
    return d.QueryRow("SELECT ...").Scan(...)
}
```

**What's wrong?**

The DB handle is application-scoped — it should be injected at construction. By putting it in context, we have:

- Hidden the dependency from `loadOrder`'s signature.
- Made tests harder: each test must build a context with the right key.
- Made refactors invisible: changing what `loadOrder` needs requires updating every call site of `WithValue`, not the call sites of `loadOrder`.

**Why it survived review.** It "works." The reviewer thinks "less plumbing."

**Fix.** Constructor injection:

```go
type OrderRepo struct {
    db *sql.DB
}

func NewOrderRepo(db *sql.DB) *OrderRepo {
    return &OrderRepo{db: db}
}

func (r *OrderRepo) Load(ctx context.Context, id string) (Order, error) {
    return r.db.QueryRowContext(ctx, "SELECT ...").Scan(...)
}
```

Now `Load` clearly needs a DB. Tests build a `*OrderRepo` with a fake DB.

---

## Bug 7 — Mutable Value Race

```go
type RequestState struct {
    Visited map[string]bool
}

ctx = context.WithValue(ctx, stateKey, &RequestState{Visited: make(map[string]bool)})

// later, in concurrent goroutines:
go func() {
    s := ctx.Value(stateKey).(*RequestState)
    s.Visited["a"] = true
}()
go func() {
    s := ctx.Value(stateKey).(*RequestState)
    s.Visited["b"] = true
}()
```

**What's wrong?**

Two goroutines mutate the same `map` without synchronization. `go test -race` flags this. Production: occasional crashes, lost writes, undefined behaviour.

**Why it survived review.** The mutation is hidden behind a struct, behind a context lookup. The reviewer sees "a goroutine writes to a map" without realising both goroutines hold the same map.

**Fix.** Either use a synchronized type (`sync.Map`, mutex-protected struct) or — far better — do not store mutable state in context. Pass an explicit accumulator that lives in the calling goroutine:

```go
visited := make(map[string]bool)
var mu sync.Mutex
mark := func(s string) { mu.Lock(); visited[s] = true; mu.Unlock() }

go func() { mark("a") }()
go func() { mark("b") }()
```

---

## Bug 8 — Context Stored in a Process-Wide Cache

```go
var (
    cache   = map[string]cachedEntry{}
    cacheMu sync.Mutex
)

type cachedEntry struct {
    ctx   context.Context
    order Order
}

func loadOrder(ctx context.Context, id string) (Order, error) {
    cacheMu.Lock()
    e, ok := cache[id]
    cacheMu.Unlock()
    if ok {
        return e.order, nil
    }
    // load fresh
    o, err := db.QueryContext(ctx, "...")
    if err != nil {
        return Order{}, err
    }
    cacheMu.Lock()
    cache[id] = cachedEntry{ctx: ctx, order: o} // BUG
    cacheMu.Unlock()
    return o, nil
}
```

**What's wrong?**

The cache stores the *context* used to load each order. That context belongs to whichever request happened to warm the cache. It holds references to that request's user, request ID, logger, and trace span. The entry lives forever. The request data lives forever. Memory grows; trace IDs from old requests show up in places that should have new ones.

**Why it survived review.** The reviewer focused on "is the cache thread-safe?" not "what is in each entry?"

**Fix.** Store only the data you need:

```go
cache[id] = cachedEntry{order: o}
```

Or, if you really need request data in the cache (you probably don't), extract the *values* you want, not the context:

```go
cache[id] = cachedEntry{
    order:     o,
    cachedBy:  reqid.From(ctx),
}
```

---

## Bug 9 — Lookup in Hot Loop

```go
func process(ctx context.Context, items []Item) {
    for _, item := range items {
        log := logctx.From(ctx) // walks the chain every iteration
        log.Info("processing", "id", item.ID)
    }
}
```

**What's wrong?**

`logctx.From(ctx)` walks the context chain on every iteration. For a chain depth of 10 and 100,000 items, that is 1 million pointer comparisons just to fetch a logger that does not change.

**Why it survived review.** Functionally correct, just slow.

**Fix.** Hoist the lookup:

```go
log := logctx.From(ctx)
for _, item := range items {
    log.Info("processing", "id", item.ID)
}
```

This is a generic principle: any expensive lookup goes outside the loop.

---

## Bug 10 — Forgetting `r.WithContext(ctx)`

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := reqid.With(r.Context(), generateID())
        next.ServeHTTP(w, r) // BUG: r still carries the OLD context
    })
}
```

**What's wrong?**

The new context is built but never attached to the request. `next` receives the original `r`, whose `Context()` does not have the new value.

**Why it survived review.** The variable `ctx` is created — a code grep for `WithValue` shows the call. Only running the code reveals that downstream `From` calls return nothing.

**Fix.**

```go
next.ServeHTTP(w, r.WithContext(ctx))
```

The `WithContext` method returns a shallow copy of the request with the new context attached.

---

## Bug 11 — Two Middlewares, Same Key, Different Types

```go
// Middleware A:
ctx = context.WithValue(ctx, valueKey, "alice")

// Middleware B (somewhere downstream):
ctx = context.WithValue(ctx, valueKey, 42)

// Handler:
v := ctx.Value(valueKey).(string) // PANIC: value is int
```

**What's wrong?**

Both middlewares use the same key but different value types. The second shadows the first; the handler's type assertion fails.

**Why it survived review.** Each middleware looks fine in isolation. The collision is global.

**Fix.** One key per concept. Don't reuse keys across libraries or modules. If you must, define separate key types.

---

## Bug 12 — Goroutine That Outlives the Request Holds Values

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // has the user, the logger, the big request body

    go func() {
        // Outlives the request. Holds the context forever.
        time.Sleep(time.Hour)
        slowAuditLog(ctx)
    }()

    w.WriteHeader(202)
}
```

**What's wrong?**

The spawned goroutine retains a reference to `ctx`, which retains `r.Context()`, which carries everything the request loaded — the parsed body, the database row buffer, the user struct. None of it is reclaimed for an hour.

**Why it survived review.** "We need the audit to have request context." True — but holding the whole context is too much.

**Fix.** Extract only what you need, drop the rest:

```go
go func() {
    auditCtx := context.Background()
    auditCtx = reqid.With(auditCtx, reqid.From(ctx))
    auditCtx = userctx.With(auditCtx, userctx.MustFrom(ctx))
    time.Sleep(time.Hour)
    slowAuditLog(auditCtx)
}()
```

Or use `context.WithoutCancel(ctx)` if all values are needed and the lifetime cost is acceptable. Document the choice.

---

## Bug 13 — Reading a Context Value That Was Never Set

```go
func loadConfig(ctx context.Context) (Config, error) {
    env, _ := ctx.Value(envKey).(string)
    if env == "" {
        env = "production"
    }
    return loadFromFile(env)
}
```

**What's wrong?**

If `envKey` is not set, `env` is `""` and `loadConfig` silently loads production config — in a test, in dev, anywhere. The fallback hides a bug.

**Why it survived review.** The fallback "looked safe." `""` is a valid signal in many APIs. Here it conceals a misconfiguration.

**Fix.** Make absence loud or explicit:

```go
env, ok := ctx.Value(envKey).(string)
if !ok || env == "" {
    return Config{}, errors.New("missing env in context")
}
```

Or — better — pass `env` as a parameter, since it is request-scoped data the function *needs*:

```go
func loadConfig(env string) (Config, error) { ... }
```

---

## Bug 14 — Misusing `context.TODO()`

```go
func loadOrder(id string) (Order, error) {
    return db.QueryRowContext(context.TODO(), "...").Scan(...)
}
```

**What's wrong?**

`context.TODO` is meant as a placeholder for code that has not yet been threaded through. Shipping it to production means the function silently has no deadline, no cancellation, no values. A request that times out at the edge does not propagate cancellation here.

**Why it survived review.** "TODO" looks like a marker that something is pending; it actually compiles and runs as a real context.

**Fix.** Plumb a real `ctx` argument:

```go
func loadOrder(ctx context.Context, id string) (Order, error) {
    return db.QueryRowContext(ctx, "...").Scan(...)
}
```

Then update callers to pass their own contexts.

---

## Bug 15 — Mixed Key Types

```go
type ctxKey int
const userKey ctxKey = 0

ctx = context.WithValue(ctx, 0, "wrong")           // BUG: key is plain int 0
ctx = context.WithValue(ctx, userKey, "right")     // key is ctxKey(0)

v := ctx.Value(userKey) // "right"
v = ctx.Value(0)        // "wrong"
```

**What's wrong?**

`0` and `userKey` are different types. Both stored, both retrievable, but the first is a footgun. Some unrelated package's `int(0)` key would collide with `0` here.

**Why it survived review.** The line with the int literal looks like a small mistake — wrong type, but compile-OK.

**Fix.** Make the key type required by the API. Wrap `WithValue` in an accessor that takes typed inputs:

```go
func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, userKey, u)
}
```

Now callers cannot accidentally pass `0`.

---

## Bug 16 — Context Reused Across Requests in a Server

```go
type Server struct {
    ctx context.Context // BUG: storing a context in a long-lived struct
}

func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    // uses s.ctx instead of r.Context()
}
```

**What's wrong?**

The server stores a context that was created at start-up. Every request now reuses it. The values in that context (if any) come from start-up, not from per-request middleware. The per-request context (with request ID, user) is discarded.

**Why it survived review.** The struct field looks like initialization plumbing.

**Fix.** Do not store `context.Context` in long-lived structs. Pass a fresh per-request context (via `r.Context()`) through the call chain.

A common exception: a server may store a *cancellation* context for its own lifecycle (`s.runCtx`), used only for "stop everything." Do not store anything other than that.

---

## Bug 17 — Tests That Build Contexts the Wrong Way

```go
func TestHandler(t *testing.T) {
    ctx := context.Background()
    ctx = context.WithValue(ctx, "user", "alice") // BUG: string key
    // ... call handler
}
```

**What's wrong?**

The test uses a `string` key. Production code uses a private type. The test's context never actually contains the user from the handler's point of view. The test passes for the wrong reason (the handler's "no user → 401" path runs).

**Why it survived review.** Both the test and production "work." The test's name (`TestHandler_HappyPath`) suggests success even though the handler is actually 401-ing.

**Fix.** Use the same accessor in tests as in production:

```go
ctx := authctx.With(context.Background(), User{...})
```

---

## Bug 18 — Forgetting That Cancellation Doesn't Erase Values

```go
ctx, cancel := context.WithCancel(parent)
ctx = userctx.With(ctx, user)
cancel()

// Some code expects values to be gone after cancel:
if _, ok := userctx.From(ctx); ok {
    // BUG: this still runs
    log.Println("still have user, even after cancel")
}
```

**What's wrong?**

Cancellation closes the `Done` channel. It does not affect `Value` lookups. The user is still there. Code that depends on "no value after cancel" is wrong.

**Why it survived review.** The author conflated two orthogonal concepts.

**Fix.** Treat cancellation and values as independent. Check `ctx.Err() != nil` to detect cancellation; do not rely on values disappearing.

---

## Bug 19 — Custom Context Forgets to Delegate Value

```go
type MyCtx struct {
    deadline time.Time
}

func (c *MyCtx) Deadline() (time.Time, bool) { return c.deadline, true }
func (c *MyCtx) Done() <-chan struct{}        { return nil }
func (c *MyCtx) Err() error                   { return nil }
func (c *MyCtx) Value(key any) any            { return nil } // BUG
```

**What's wrong?**

A custom context that always returns `nil` from `Value` breaks the chain. Anything wrapped by `MyCtx` and then by `context.WithValue` will find values in the `valueCtx`. But anything that calls `Value` on `MyCtx` directly (after `MyCtx` was wrapped around a context with values) finds nothing.

**Why it survived review.** Without a parent embedded, `MyCtx` cannot delegate. The author didn't realize that.

**Fix.** Embed `context.Context`:

```go
type MyCtx struct {
    context.Context
    deadline time.Time
}

func (c *MyCtx) Deadline() (time.Time, bool) { return c.deadline, true }
```

Now `Value` delegates to the embedded context automatically.

---

## Bug 20 — Header Injection via Request ID

```go
func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newID()
        }
        ctx := reqid.With(r.Context(), id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**What's wrong?**

The header value is taken verbatim and threaded into logs. An attacker can send `X-Request-ID: x\nlevel=fatal msg=hacked` and corrupt the structured log output.

**Why it survived review.** Trusting an inbound header is common practice. The vulnerability surfaces in log analysis, not in the request flow.

**Fix.** Validate or sanitize:

```go
const maxIDLen = 64
var idRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

if !idRe.MatchString(id) || len(id) > maxIDLen {
    id = newID()
}
```

Reject anything that does not match a safe pattern.

---

## Bug 21 — Default Context for a Long-Running Background Job

```go
func main() {
    go runBackgroundWorker()
    http.ListenAndServe(":8080", nil)
}

func runBackgroundWorker() {
    ctx := context.TODO()
    for {
        doWork(ctx)
        time.Sleep(time.Minute)
    }
}
```

**What's wrong?**

`context.TODO` has no cancellation, no deadline, no values. The worker keeps running after SIGTERM, blocking shutdown. Logs from `doWork` have no correlation IDs.

**Why it survived review.** "Workers don't have requests; what should the context be?"

**Fix.** Build a root context tied to the program's lifecycle:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    go runBackgroundWorker(ctx)
    // ...
}

func runBackgroundWorker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        doWork(ctx)
        time.Sleep(time.Minute)
    }
}
```

If you want per-tick correlation IDs, generate a fresh one inside the loop and attach it.

---

## Bug 22 — Forgetting That `nil` Stored Equals `nil` Missing

```go
ctx = context.WithValue(ctx, k, nil) // explicit nil

if ctx.Value(k) != nil {
    // never runs
}

// But conceptually, "the value was set."
```

**What's wrong?**

Storing `nil` is indistinguishable from "not set" at the `Value` level. Code that wants "value was provided, even if nil" needs a sentinel:

```go
var explicitNil = struct{}{}
ctx = context.WithValue(ctx, k, explicitNil)
```

Or simply do not store nil — handle the absence at the caller.

---

## Summary

Most context-value bugs fall into a small number of buckets:

- **Untyped keys** that collide (Bug 1, 2, 17).
- **Type assertions** that panic when missing or wrong (Bug 3, 4).
- **Wrong things** in context (Bug 6 — DB, Bug 7 — mutable state, Bug 16 — long-lived).
- **Middleware ordering** that leaves dependencies unset (Bug 5).
- **Lifetime leaks** through goroutines and caches (Bug 8, 12).
- **Misuse** of TODO, custom contexts, headers (Bug 14, 19, 20, 21).

The defenses are equally repetitive: private key types, typed accessors, request-scoped data only, correct middleware ordering, no contexts in caches, and a willingness to push back on the temptation to "just add it to context."
