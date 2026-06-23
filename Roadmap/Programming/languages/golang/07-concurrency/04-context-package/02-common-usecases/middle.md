# Common Usecases — Middle

[← Back to index](junior.md)

The junior file showed you how `r.Context()`, `http.NewRequestWithContext`, and `db.QueryContext` plug together. The middle level is about the *machinery around* those calls: graceful shutdown, middleware that decorates the context, production-grade key patterns, server timeouts, and the new `t.Context()` API.

By the end of this page you should be able to:

- Wire up `srv.Shutdown(ctx)` so in-flight requests drain before the binary exits.
- Write middleware that adds a request ID, a logger, and an authenticated user to the context.
- Distinguish between request timeouts (`http.Server.WriteTimeout`) and request *deadlines* (context-driven).
- Decide when to add a value to a context and when to pass it as a parameter.
- Use `t.Context()` from Go 1.24+ in tests.

## Graceful Shutdown

A long-running HTTP server has a problem: when SIGTERM arrives (a deploy, a Kubernetes rolling restart), in-flight requests should *finish*, not be killed mid-response. `http.Server.Shutdown` handles this:

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/health", health)

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       90 * time.Second,
    }

    // Catch SIGINT / SIGTERM.
    rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    serverErr := make(chan error, 1)
    go func() { serverErr <- srv.ListenAndServe() }()

    select {
    case err := <-serverErr:
        if !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("server: %v", err)
        }
    case <-rootCtx.Done():
        log.Println("shutdown signal received")
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("shutdown: %v", err)
    }
}
```

What `srv.Shutdown(ctx)` does, step by step:

1. Stops accepting new connections.
2. Waits for active requests to finish.
3. If `ctx` expires before all are done, force-closes the remaining connections and returns `ctx.Err()`.

Notice that the shutdown uses a **separate** context from the root signal context. We don't want SIGINT-during-SIGINT to kill the drain phase early. The `30*time.Second` budget is the maximum we are willing to wait for in-flight requests. Pick a value matching your longest expected handler.

### Coordinating with worker goroutines

If your service has long-lived workers (consumers, schedulers), they should listen to `rootCtx.Done()`:

```go
go runConsumer(rootCtx, queue)
go runScheduler(rootCtx)
```

When SIGTERM fires, `rootCtx` is canceled and every worker stops. The HTTP server's drain happens in parallel. A complete shutdown looks like:

```
SIGTERM
   │
   ├── rootCtx canceled  ──► workers stop
   │
   └── srv.Shutdown(shutdownCtx)
          │
          ├── new connections refused
          ├── active requests drain
          └── return when all drained or shutdownCtx expired
```

`errgroup.WithContext` is the standard way to coordinate the workers and surface the first error:

```go
g, ctx := errgroup.WithContext(rootCtx)
g.Go(func() error { return runConsumer(ctx, queue) })
g.Go(func() error { return runScheduler(ctx) })

if err := g.Wait(); err != nil {
    log.Printf("worker: %v", err)
}
```

## Server Timeouts vs Context Deadlines

`http.Server` has four timeouts. None of them is a context deadline:

| Field | Meaning |
|-------|---------|
| `ReadHeaderTimeout` | Max time to read request headers |
| `ReadTimeout` | Max time to read entire request including body |
| `WriteTimeout` | Max time from end of header read to end of response write |
| `IdleTimeout` | Max keep-alive idle time |

These are **socket-level safeguards**. They protect the server from slowloris attacks and runaway clients. They are *not* visible inside your handler — they cannot be checked, extended, or refined per route.

For per-handler deadlines, use `http.TimeoutHandler` or derive your own context with `WithTimeout`:

```go
mux.Handle("/slow", http.TimeoutHandler(slowHandler, 10*time.Second, "timeout"))
```

`http.TimeoutHandler` cancels the request's context when the timeout fires and writes a 503 to the client. Your handler still has to *check* `ctx.Done()` for the cancellation to actually free resources. Otherwise the response is dropped but your handler keeps running.

A pattern for variable deadlines per route:

```go
func withRouteTimeout(d time.Duration, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), d)
        defer cancel()
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}

mux.Handle("/api/heavy", withRouteTimeout(2*time.Second, heavyHandler))
mux.Handle("/api/cheap", withRouteTimeout(200*time.Millisecond, cheapHandler))
```

`r.WithContext(ctx)` returns a shallow-copied request whose context is `ctx`. Always do this when you derive a context inside middleware — never mutate `r` directly.

## Middleware That Decorates Context

Middleware is the canonical place to put values into the context. Each middleware function:

1. Reads or generates a value (request ID, user, logger).
2. Calls `context.WithValue` to add it.
3. Wraps `r` with `r.WithContext(...)` and calls the next handler.

A complete chain of three middlewares:

```go
package main

import (
    "context"
    "log/slog"
    "net/http"

    "github.com/google/uuid"
)

// === Request ID ==========================================================
type reqIDKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, reqIDKey{}, id)
}

func RequestIDFrom(ctx context.Context) string {
    id, _ := ctx.Value(reqIDKey{}).(string)
    return id
}

func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = uuid.NewString()
        }
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
    })
}

// === Logger ==============================================================
type loggerKey struct{}

func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
    return context.WithValue(ctx, loggerKey{}, l)
}

func LoggerFrom(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}

func LoggerMiddleware(base *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            l := base.With("request_id", RequestIDFrom(r.Context()), "path", r.URL.Path)
            next.ServeHTTP(w, r.WithContext(WithLogger(r.Context(), l)))
        })
    }
}

// === Authenticated user ==================================================
type User struct {
    ID    string
    Email string
}

type userKey struct{}

func WithUser(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, userKey{}, u)
}

func UserFrom(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(userKey{}).(User)
    return u, ok
}

func AuthMiddleware(verify func(token string) (User, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            token := r.Header.Get("Authorization")
            user, err := verify(token)
            if err != nil {
                http.Error(w, "unauthorized", http.StatusUnauthorized)
                return
            }
            next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
        })
    }
}

// === Wiring ==============================================================
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("GET /me", func(w http.ResponseWriter, r *http.Request) {
        u, _ := UserFrom(r.Context())
        log := LoggerFrom(r.Context())
        log.Info("loading profile", "user_id", u.ID)
        // ... use u.ID in DB query, etc.
    })

    var handler http.Handler = mux
    handler = AuthMiddleware(verifyToken)(handler)
    handler = LoggerMiddleware(slog.Default())(handler)
    handler = RequestIDMiddleware(handler) // outermost: id flows everywhere

    http.ListenAndServe(":8080", handler)
}

func verifyToken(token string) (User, error) {
    return User{ID: "u-123", Email: "test@example.com"}, nil
}
```

Order matters: the outermost middleware in the chain runs first on the way in. Here `RequestIDMiddleware` is outermost so the ID is available to `LoggerMiddleware`. If you swap the order, the logger's `request_id` field is empty.

### The Type-Safe Key Pattern

Notice every key is an unexported empty struct: `type reqIDKey struct{}`. This pattern has three properties:

1. **Zero size**: `unsafe.Sizeof(reqIDKey{}) == 0`. No allocation.
2. **Type-unique**: two packages can both have `type key struct{}` and they will not collide because Go uses pointer identity for keys, derived from the type's package path.
3. **Unexported**: nothing outside the package can construct one, which means nothing outside the package can read or write the value. The package owns the key.

The alternative, `string` keys, is broken:

```go
// BAD
ctx = context.WithValue(ctx, "user_id", id)
```

Anything in any package that does `ctx.Value("user_id")` reads your value. Tests, third-party middleware, future you. The compiler cannot help. Use the struct key.

For repeated reuse, some teams expose a singleton constant of the key type:

```go
type contextKey int
const (
    keyUserID contextKey = iota
    keyTraceID
    keyLogger
)
```

This works and is type-safe across keys but slightly less hermetic — every `contextKey`-typed value collides with every other in the same package. The empty-struct-per-key approach is the cleanest.

## When To Use `WithValue` vs Pass As Parameter

A practical decision tree:

```
Is the value needed by EVERY function on the call path?
   ├── YES → context value (tracing, logger, user)
   └── NO  → parameter

Is the value request-scoped (changes per request)?
   ├── YES → context value
   └── NO  → DI / config / package-level

Is the value the actual subject of the function?
   ├── YES → parameter (it's the input!)
   └── NO  → consider context

Would the function silently misbehave if the value is missing?
   ├── YES → parameter (don't hide critical inputs)
   └── NO  → context value with sensible default
```

Examples:

| Value | Where it goes | Why |
|-------|---------------|-----|
| `userID` for "get my profile" | parameter | It IS the function's input |
| Authenticated user (for authz checks across many handlers) | context | Cross-cutting, request-scoped |
| Trace ID | context | Cross-cutting, observability |
| `*sql.DB` | DI / parameter | Not request-scoped, must exist |
| Feature flag value | DI / package-level | Not request-scoped |
| Per-request `slog.Logger` (with attrs) | context | Cross-cutting, request-scoped |
| Tenant ID in multi-tenant SaaS | context | Request-scoped, used by every layer |
| Idempotency key | context | Request-scoped, used by middleware + handler |

Senior reviewers will push back on `ctx.Value` for anything that *could* be a parameter without making 30 signatures longer. When in doubt: **parameter**.

## Tests with `t.Context()` (Go 1.24+)

Pre-Go 1.24 the idiom was:

```go
func TestThing(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    // ...
}
```

Go 1.24 added `t.Context()` which gives you a context that:

- Is canceled automatically when the test ends.
- Has no deadline (set one with `WithTimeout` if needed).
- Inherits cleanup from `t.Cleanup`.

```go
func TestThing(t *testing.T) {
    ctx := t.Context()
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    o, err := loadOrder(ctx, 42)
    if err != nil { t.Fatal(err) }
    _ = o
}
```

If your test spawns a goroutine that should die when the test ends, capture `t.Context()` instead of `context.Background()`:

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(100 * time.Millisecond):
            // poll
        }
    }
}()
```

Cancel propagation works automatically — when `t` finishes, `ctx.Done()` closes.

`b.Context()` exists on `*testing.B` for benchmarks. `tb.Context()` on `testing.TB`.

## Table-Driven Tests with Per-Case Timeout

```go
func TestLookup(t *testing.T) {
    cases := []struct {
        name    string
        id      int64
        timeout time.Duration
        wantErr error
    }{
        {"happy path", 1, 2 * time.Second, nil},
        {"slow query", 999, 50 * time.Millisecond, context.DeadlineExceeded},
    }

    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            ctx, cancel := context.WithTimeout(t.Context(), tc.timeout)
            defer cancel()

            _, err := loadOrder(ctx, tc.id)
            if !errors.Is(err, tc.wantErr) {
                t.Fatalf("got %v, want %v", err, tc.wantErr)
            }
        })
    }
}
```

Each subcase has its own deadline, deriving from `t.Context()` so all goroutines spawned in that subcase die when the subcase ends.

## Worker Pools With Context

A common middle-level task: build a pool of N workers consuming from a channel. The pool stops when ctx is canceled.

```go
func RunPool[T, R any](
    ctx context.Context,
    n int,
    jobs <-chan T,
    process func(context.Context, T) (R, error),
) <-chan Result[R] {
    out := make(chan Result[R])

    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-jobs:
                    if !ok {
                        return
                    }
                    r, err := process(ctx, j)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- Result[R]{Value: r, Err: err}:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

type Result[R any] struct {
    Value R
    Err   error
}
```

Key invariants:

- Every blocking operation selects on `ctx.Done()`.
- `out` is closed by a goroutine waiting on `wg`, after all workers stop.
- The caller can `range` over `out` and the loop ends naturally on cancellation.

Use this whenever you want N parallel HTTP fetches, N parallel DB inserts, or N parallel anything.

## A Compact Pipeline Example

A classic three-stage pipeline: produce IDs, fetch records, write results. Cancellation flows top to bottom:

```go
func produceIDs(ctx context.Context, ids []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, id := range ids {
            select {
            case <-ctx.Done():
                return
            case out <- id:
            }
        }
    }()
    return out
}

func fetchRecords(ctx context.Context, in <-chan int) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for id := range in {
            r, err := db.Lookup(ctx, id)
            if err != nil {
                continue
            }
            select {
            case <-ctx.Done():
                return
            case out <- r:
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer cancel()

    ids := produceIDs(ctx, []int{1, 2, 3, 4, 5})
    records := fetchRecords(ctx, ids)

    for r := range records {
        fmt.Println(r)
    }
}
```

If you press Ctrl-C, `ctx` is canceled, `produceIDs` exits, the channel closes, `fetchRecords` finishes the in-flight item then exits. No goroutine leaks.

## A Note on `context.WithValue` Performance

Every `WithValue` allocates a new struct (`*valueCtx`) and adds to the chain. Lookups are linear in chain depth. For 5–10 values this is invisible (single-digit nanoseconds). For 50, it shows up in profiles.

| Chain depth | `Value()` cost (typical) |
|-------------|--------------------------|
| 1 | ~5 ns |
| 5 | ~12 ns |
| 20 | ~40 ns |
| 100 | ~200 ns |

If you find yourself adding 30 values to a context, you have probably misused it. Bundle related values into a single struct and store one key:

```go
type RequestInfo struct {
    ID, TenantID, UserID string
    Logger               *slog.Logger
}

type reqInfoKey struct{}

func WithRequestInfo(ctx context.Context, ri *RequestInfo) context.Context {
    return context.WithValue(ctx, reqInfoKey{}, ri)
}

func RequestInfoFrom(ctx context.Context) *RequestInfo {
    ri, _ := ctx.Value(reqInfoKey{}).(*RequestInfo)
    return ri
}
```

One key, one allocation, one O(depth) lookup, then field accesses are O(1).

## Self-Assessment

You are ready for the senior file when you can:

- Implement `srv.Shutdown` with proper SIGTERM handling and per-worker coordination.
- Write a chain of three middlewares (request ID, logger, auth) using type-safe keys.
- Explain why we never mutate `r` directly and always do `r.WithContext(...)`.
- Defend, in review, why a particular value belongs in `ctx.Value` or in a parameter.
- Refactor a test from `context.Background()` boilerplate to `t.Context()`.

## What's Next

Senior takes us across services: deadline budgeting (when ctx has 500ms left, what does each downstream call get?), gRPC's role in metadata propagation, and observability (OpenTelemetry's role in injecting/extracting span context).

[← Back to index](junior.md)
