# Context Values — Middle

[← Back to index](junior.md)

The junior file showed you the unexported key idiom, the accessor pattern, and what a request-scoped value is. The middle level is about *applying* those rules at production scale: layering middlewares, designing a logger that lives in context, propagating trace context across services, and choosing between context values and explicit parameters when the decision is non-obvious.

By the end of this page you should be able to:

- Compose a middleware stack that adds request ID, authenticated user, logger, and trace context in the right order.
- Design a typed accessor package with constructor and reader functions.
- Identify when an argument is "metadata" (belongs in context) and when it is "data" (belongs in the signature).
- Read OpenTelemetry-style trace propagation code without confusion.
- Write a custom `*slog.Handler` that pulls fields from the request context.
- Use `t.Context()` in tests (Go 1.24+) with values baked in.

## Building a Production Middleware Stack

Most real Go services route their requests through five to ten middleware layers. The order matters; the place where each value is attached matters; the choice of accessor matters.

A realistic stack looks like this:

```go
mux := http.NewServeMux()
mux.HandleFunc("/api/v1/", handler)

h := withRecover(
    withRequestID(
        withTracing(
            withAuth(
                withRequestLogger(
                    mux)))))

srv := &http.Server{Addr: ":8080", Handler: h}
```

Each wrap adds one well-defined piece of state to the request context.

### withRequestID

```go
package reqid

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "net/http"
)

type ctxKey struct{}

var key = ctxKey{}

func newID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

func With(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, key, id)
}

func From(ctx context.Context) string {
    if id, ok := ctx.Value(key).(string); ok {
        return id
    }
    return ""
}

func Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = newID()
        }
        w.Header().Set("X-Request-ID", id)
        ctx := With(r.Context(), id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

Note: the package exports `Middleware`, `With`, and `From`, but not `key`. The key type is private. Even another package that defines its own `type ctxKey struct{}` cannot read or write this slot.

### withAuth

```go
package authctx

import (
    "context"
    "errors"
    "net/http"
    "strings"
)

type ctxKey struct{}

var key = ctxKey{}

type User struct {
    ID    string
    Email string
    Roles []string
}

var ErrNoUser = errors.New("no authenticated user in context")

func With(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, key, u)
}

func From(ctx context.Context) (User, error) {
    u, ok := ctx.Value(key).(User)
    if !ok {
        return User{}, ErrNoUser
    }
    return u, nil
}

func Middleware(verifyToken func(string) (User, error)) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
            u, err := verifyToken(tok)
            if err != nil {
                http.Error(w, "unauthorized", http.StatusUnauthorized)
                return
            }
            ctx := With(r.Context(), u)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

The accessor returns an `error` not a `bool`. For a value that downstream code *requires*, an error is more honest. Calling code can wrap or check with `errors.Is(err, authctx.ErrNoUser)`.

### withRequestLogger

A logger that already knows the request ID and the user is one of the highest-leverage things context can carry. Every downstream `log.Info(...)` produces structured output with no boilerplate.

```go
package logctx

import (
    "context"
    "log/slog"
)

type ctxKey struct{}

var key = ctxKey{}

func With(ctx context.Context, l *slog.Logger) context.Context {
    return context.WithValue(ctx, key, l)
}

// From always returns a non-nil logger.
func From(ctx context.Context) *slog.Logger {
    if l, ok := ctx.Value(key).(*slog.Logger); ok {
        return l
    }
    return slog.Default()
}
```

The middleware:

```go
func Middleware(base *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            id := reqid.From(r.Context())
            u, _ := authctx.From(r.Context())

            l := base.With(
                "request_id", id,
                "user_id", u.ID,
                "method", r.Method,
                "path", r.URL.Path,
            )

            ctx := With(r.Context(), l)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

Notice the ordering: this middleware must come **after** `reqid.Middleware` and `authctx.Middleware`, because it reads from them. A handler deep in the stack now writes:

```go
log := logctx.From(r.Context())
log.Info("processing order", "order_id", id)
```

and the output already carries `request_id`, `user_id`, `method`, `path`.

### withTracing (OpenTelemetry-style)

OpenTelemetry uses context values pervasively. The trace context is propagated via headers (`traceparent`), parsed into a `SpanContext`, and attached to the request context:

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/trace"
)

func TracingMiddleware(tracer trace.Tracer) func(http.Handler) http.Handler {
    prop := otel.GetTextMapPropagator()
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            ctx := prop.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
            ctx, span := tracer.Start(ctx, r.URL.Path)
            defer span.End()
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

`prop.Extract` reads `traceparent` headers and attaches the parsed span context to `ctx` via... `context.WithValue` (under the hood, OTEL uses its own private key types). `tracer.Start` then creates a child span and stores it under another key. Any code that later calls `trace.SpanFromContext(ctx)` reads it out.

This is a real-world example of three context values chained together for a single concern.

## Designing Typed Accessor Packages

Look at every accessor pair you've seen so far. They follow the same shape:

```go
package somepkg

type ctxKey struct{}
var key = ctxKey{}

func With(ctx context.Context, x T) context.Context {
    return context.WithValue(ctx, key, x)
}

func From(ctx context.Context) (T, ok)
```

This is so common it can be templated. A real package usually adds:

- A type-safe getter that panics on absence (`MustFrom`) for code paths where absence is a bug.
- A fallback default (`From` returns `slog.Default()` when nothing is attached).
- A `Set` helper that mutates an `*http.Request` in place: `r = r.WithContext(With(r.Context(), x))`.

Example with all three:

```go
package userctx

import "context"

type ctxKey struct{}
var key = ctxKey{}

type User struct {
    ID    string
    Email string
}

func With(ctx context.Context, u User) context.Context {
    return context.WithValue(ctx, key, u)
}

func From(ctx context.Context) (User, bool) {
    u, ok := ctx.Value(key).(User)
    return u, ok
}

func MustFrom(ctx context.Context) User {
    u, ok := From(ctx)
    if !ok {
        panic("userctx: no user in context")
    }
    return u
}
```

`MustFrom` exists for handlers that ran *after* the auth middleware — if there is no user there, the system is misconfigured and panicking is correct. It is loud and immediate. Compare:

```go
// Quiet failure: easy to miss, code keeps running with zero User.
u, _ := userctx.From(ctx)
charge(u.ID, amt) // u.ID is "", charge succeeds with no user
```

vs.

```go
// Loud failure: panic with stack trace pointing at the middleware misconfiguration.
u := userctx.MustFrom(ctx)
charge(u.ID, amt)
```

Pick `MustFrom` for paths where absence means "the program is wrong," and `From` (with `bool`) for paths where absence means "the request was anonymous."

## Context Value vs Parameter — Decision Framework

The hardest decision at middle level is "should this thing go on the context or be a parameter?" Here is a practical framework.

### Question 1: Is it request-scoped?

If the value's lifetime is exactly one HTTP request (or one RPC, one job), it is a context candidate. If it lives longer (a database handle, a config) it is not.

### Question 2: Is it metadata or data?

- **Metadata** — request ID, trace ID, locale, user identity. Most layers ignore it; a few layers log it; tracing infrastructure cares about it.
- **Data** — the order ID, the payment amount, the file the request is operating on. The function uses it directly.

Metadata in context, data in parameters.

### Question 3: Would adding it as a parameter pollute every signature?

If putting it on every signature gives you a `(ctx, id, user, traceID, locale, requestID, db, cache, ...)` parameter list, the metadata-vs-data line has been crossed. Move the metadata to context.

### Question 4: Does the function need to *act* on it?

If `getOrder(ctx, id)` is going to do something different based on the value (apply RBAC, pick a tenant database), the value is participating in the function's logic. Either explicit parameter or struct method.

### Question 5: Is it mutable?

Context values should not be mutable. If you want a place to write to (a counter, a buffer), context is wrong. Use a struct field or pass a pointer.

### The 80/20 rule

Eighty percent of the time the answer is "parameter." Defaulting to context is the trap. Default to parameter; promote to context only when you have a clear reason.

## Pre-Configured Loggers

The single most powerful context value in any production Go service is a pre-configured logger. Every other piece of metadata exists to inform it.

```go
log := base.With(
    "request_id", reqid.From(ctx),
    "user_id", user.ID,
    "tenant", user.TenantID,
    "trace_id", span.SpanContext().TraceID().String(),
    "method", r.Method,
    "path", r.URL.Path,
)
ctx = logctx.With(ctx, log)
```

Now every layer that pulls `logctx.From(ctx)` gets a logger with all that pre-bound. A repository writing `log.Info("query", "sql", q)` produces:

```json
{
  "time":"...",
  "level":"INFO",
  "msg":"query",
  "request_id":"req-7c4f",
  "user_id":"u-100",
  "tenant":"t-22",
  "trace_id":"1234...",
  "method":"POST",
  "path":"/api/v1/orders",
  "sql":"SELECT ..."
}
```

with zero work at the call site.

### Alternative: a `*slog.Handler` that pulls from context

`slog.Default().Info(...)` does not look at the context. To make logs context-aware automatically, you can wrap a `Handler`:

```go
type ctxHandler struct {
    next slog.Handler
}

func (h *ctxHandler) Enabled(ctx context.Context, l slog.Level) bool {
    return h.next.Enabled(ctx, l)
}

func (h *ctxHandler) Handle(ctx context.Context, r slog.Record) error {
    if id := reqid.From(ctx); id != "" {
        r.AddAttrs(slog.String("request_id", id))
    }
    if u, ok := userctx.From(ctx); ok {
        r.AddAttrs(slog.String("user_id", u.ID))
    }
    return h.next.Handle(ctx, r)
}

func (h *ctxHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
    return &ctxHandler{next: h.next.WithAttrs(attrs)}
}

func (h *ctxHandler) WithGroup(name string) slog.Handler {
    return &ctxHandler{next: h.next.WithGroup(name)}
}
```

Now `slog.InfoContext(ctx, "starting")` automatically picks up `request_id` and `user_id`. The trade-off: this couples your handler to specific accessor packages. The pre-configured logger approach is more flexible; the handler approach is more automatic.

## Trace Propagation Patterns

Trace context flows differently from other request data because it crosses process boundaries. The pattern:

```
┌──────────────┐    HTTP    ┌──────────────┐    gRPC    ┌──────────────┐
│  Service A   │ ─────────► │  Service B   │ ─────────► │  Service C   │
│ (root span)  │ traceparent│ (child span) │  metadata  │ (child span) │
└──────────────┘            └──────────────┘            └──────────────┘
```

At each boundary:

1. **On ingress**: extract the trace context from the incoming headers (or gRPC metadata) into a `context.Context` value.
2. **In-process**: every operation that should be a span calls `tracer.Start(ctx, "op-name")`, which returns a new context with the new span attached.
3. **On egress**: inject the current span context back into outgoing request headers.

Code that performs an outbound HTTP call has to remember:

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
resp, err := http.DefaultClient.Do(req)
```

The `Inject` reads from `ctx` (find the current span) and writes to `req.Header` (set `traceparent`). The receiving service then `Extract`s it back into its own ingress context. Continuity preserved.

## Working With `t.Context()` (Go 1.24+)

Go 1.24 introduced `(*testing.T).Context()`, which returns a context that is automatically canceled when the test completes. This is great for value tests:

```go
func TestHandler(t *testing.T) {
    ctx := userctx.With(t.Context(), User{ID: "u-1"})

    got, ok := userctx.From(ctx)
    if !ok || got.ID != "u-1" {
        t.Fatalf("got %v, ok=%v", got, ok)
    }
}
```

Before 1.24 you'd write `context.Background()` and lose the auto-cancel benefit. With `t.Context()` your test code naturally inherits cancellation propagation as well.

## Testing Middleware Chains

A whole stack of middleware deserves an integration test:

```go
func TestStack(t *testing.T) {
    var sawUser User
    var sawID string

    finalHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        sawUser, _ = userctx.From(r.Context())
        sawID = reqid.From(r.Context())
        w.WriteHeader(200)
    })

    stack := reqid.Middleware(
        authctx.Middleware(fakeVerify)(
            finalHandler))

    srv := httptest.NewServer(stack)
    defer srv.Close()

    req, _ := http.NewRequest("GET", srv.URL, nil)
    req.Header.Set("Authorization", "Bearer good-token")
    req.Header.Set("X-Request-ID", "test-id")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        t.Fatal(err)
    }
    resp.Body.Close()

    if sawID != "test-id" {
        t.Errorf("request id: got %q, want %q", sawID, "test-id")
    }
    if sawUser.ID == "" {
        t.Error("no user in context")
    }
}
```

This kind of test catches re-ordering accidents in production code.

## Building a Custom Context Value Package

Suppose you need a "rate-limit bucket" attached to every request — so multiple handlers don't redo the lookup. The pattern:

```go
package ratelimitctx

import (
    "context"
    "time"
)

type ctxKey struct{}

var key = ctxKey{}

type Bucket struct {
    Remaining int
    ResetAt   time.Time
}

func With(ctx context.Context, b Bucket) context.Context {
    return context.WithValue(ctx, key, b)
}

func From(ctx context.Context) (Bucket, bool) {
    b, ok := ctx.Value(key).(Bucket)
    return b, ok
}
```

This is a *value type*, not a *pointer*. Passing a `Bucket` by value through context is fine for small types (a few fields). Pointer is fine too if you want mutability — but remember the mutation concerns: two goroutines mutating the same pointer in context need synchronization.

## Avoiding Common Layering Bugs

### Reading before writing

If `withRequestLogger` reads from `reqid` and `authctx`, those middlewares must wrap *outside* it. The composition order is bottom-up:

```go
h := reqid.Middleware(           // outermost
    authctx.Middleware(verify)(  // middle
        logctx.Middleware(base)( // innermost (reads from above)
            handler)))
```

If you swap, `logctx.Middleware` will see an empty request ID.

### Re-attaching the same value

```go
ctx = reqid.With(ctx, "from-header")
// somewhere deeper, by accident:
ctx = reqid.With(ctx, "regenerated")
```

The second value shadows the first. Downstream code now sees the regenerated ID. Inspect every place that calls `With` and ensure at most one of them runs per request.

### Forgetting `r.WithContext(ctx)`

A subtle bug:

```go
ctx := withRequestID(r.Context())
next.ServeHTTP(w, r) // BUG: r still has the old context!
```

The new context is built but the request still carries the old one. Always pass `r.WithContext(ctx)`.

## When to Skip Context Values Entirely

If your service is a simple CLI tool with no concurrency and one execution path, context values are noise. A `Run(args, deps)` function with explicit dependencies is clearer.

If your service is a library function with no caller-supplied context (a sort, a parser), do not invent one to carry metadata. Functions that do not take a `context.Context` should not pretend to.

Context values exist because real services have many layers and metadata that must flow across them. In a single-layer system, they earn their complexity.

## Summary

At middle level the discipline is no longer about the syntax of `WithValue`; it is about the engineering of a clean accessor package, the ordering of middlewares, and the calibrated choice of context-vs-parameter. The unexported key idiom is your safety net. Typed accessors and `MustFrom`/`From` variants are your ergonomic surface. Discipline about what counts as request-scoped metadata is what keeps the context from becoming a junk drawer.
