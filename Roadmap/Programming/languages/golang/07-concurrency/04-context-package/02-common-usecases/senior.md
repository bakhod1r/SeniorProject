# Common Usecases — Senior

[← Back to index](junior.md)

The middle file showed you middleware, shutdown, and worker pools. The senior file is about cross-service propagation: how a 500 ms deadline that started at the edge of your system arrives, intact and budget-aware, at a Postgres replica three hops deep.

By the end of this page you should be able to:

- Budget deadlines across multiple downstream calls.
- Propagate cancellation across HTTP and gRPC boundaries.
- Inject and extract OpenTelemetry span context with the same ctx threading.
- Combine independent contexts (Go has no built-in merge — explain the patterns).
- Reason about ctx across goroutine boundaries and avoid the most common leak shapes.

## Deadline Budgeting

The edge of your system stamps a deadline on every request. If the load balancer's timeout is 5 s, the handler should not blindly hand 5 s to every downstream call — that gives the slowest call a chance to consume the entire budget and starve the rest.

Three strategies:

### 1. Hand-rolled per-call sub-deadlines

```go
func processOrder(ctx context.Context, id int64) error {
    // Auth check: short, must not exceed 200 ms.
    authCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
    defer cancel()
    if err := authz.Check(authCtx, id); err != nil {
        return err
    }

    // DB lookup: cap at 500 ms, but never longer than parent.
    dbCtx, cancel2 := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel2()
    o, err := db.LoadOrder(dbCtx, id)
    if err != nil {
        return err
    }

    // External enrichment: best effort, 1 s cap.
    enrichCtx, cancel3 := context.WithTimeout(ctx, 1*time.Second)
    defer cancel3()
    return enrich(enrichCtx, o)
}
```

Each call gets a hard cap. Combined they cannot exceed `200+500+1000 = 1700 ms` — comfortably inside the 5 s edge budget.

### 2. Proportional budgeting

Some teams write a helper that gives each step a fraction of the remaining budget:

```go
func splitBudget(ctx context.Context, fraction float64) (context.Context, context.CancelFunc) {
    deadline, ok := ctx.Deadline()
    if !ok {
        return context.WithCancel(ctx)
    }
    remaining := time.Until(deadline)
    return context.WithTimeout(ctx, time.Duration(float64(remaining)*fraction))
}

// Usage: 30% of remaining time for the DB.
dbCtx, cancel := splitBudget(ctx, 0.3)
defer cancel()
```

The risk: a single slow upstream eats all the budget; downstream calls get a tiny window and time out. For consistency, prefer hard caps unless you have a specific reason for fraction-based splitting.

### 3. Headroom for retries

If a step retries on failure, its sub-budget must hold *all* attempts:

```go
// Total cap 1 s for up to 3 attempts.
retryCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
defer cancel()

for i := 0; i < 3; i++ {
    err := callDownstream(retryCtx)
    if err == nil {
        return nil
    }
    if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
        return err  // budget exhausted, bail
    }
    time.Sleep(backoff(i))  // careful: still uses budget
}
```

Always check the error before retrying — if the parent context is gone, retries are pointless.

### Visualizing the budget tree

```
   r.Context()           deadline: 5 s
        │
        ▼
   processOrder(ctx)
        │
        ├── authz.Check(authCtx)        cap: 200 ms
        │
        ├── db.LoadOrder(dbCtx)         cap: 500 ms
        │
        └── enrich(enrichCtx)           cap: 1000 ms

   Total possible: 1700 ms.
   Buffer remaining: 3300 ms (logging, response write, retries).
```

If the parent deadline is shorter than your sum, derived deadlines automatically use the parent's — children cannot extend.

## Cross-Service Deadline Propagation

When service A calls service B, A's remaining deadline should travel with the request so B knows when to give up. This is *deadline propagation*.

### HTTP

There is no standard HTTP header for context deadlines. Two common conventions:

| Header | Format | Notes |
|--------|--------|-------|
| `X-Request-Deadline` | RFC3339 absolute time | Easy to read, drift between clocks |
| `Grpc-Timeout` (re-purposed) | duration string `<n><unit>` | gRPC-style relative timeout |
| Envoy `x-envoy-expected-rq-timeout-ms` | milliseconds | Auto-injected by Envoy proxies |

A simple convention:

```go
func injectDeadline(ctx context.Context, req *http.Request) {
    if d, ok := ctx.Deadline(); ok {
        req.Header.Set("X-Request-Deadline", d.UTC().Format(time.RFC3339Nano))
    }
}

func extractDeadline(r *http.Request) (context.Context, context.CancelFunc) {
    h := r.Header.Get("X-Request-Deadline")
    if h == "" {
        return r.Context(), func() {}
    }
    t, err := time.Parse(time.RFC3339Nano, h)
    if err != nil {
        return r.Context(), func() {}
    }
    return context.WithDeadline(r.Context(), t)
}
```

In a service mesh (Istio, Linkerd, Envoy), the proxy typically handles this for you with `x-envoy-expected-rq-timeout-ms`. Check your mesh's documentation.

### gRPC

gRPC builds deadline propagation into the protocol. When you call `client.Method(ctx, req)`, the deadline from `ctx` is encoded into a `grpc-timeout` HTTP/2 header on the outgoing call. The server reads that header and constructs a context with the matching deadline. No code on either side has to do anything explicit.

```go
// Client.
ctx, cancel := context.WithTimeout(parent, 800*time.Millisecond)
defer cancel()
resp, err := client.GetUser(ctx, &pb.GetUserRequest{Id: 42})
```

On the server, the handler's `ctx` parameter has a deadline ~800 ms in the future (minus network transit). If the deadline expires, the server-side handler's `ctx.Done()` closes, the gRPC framework sends a `DEADLINE_EXCEEDED` status, and the client's call returns the same status code.

### Metadata: gRPC's analogue of headers

gRPC also carries arbitrary key-value metadata. This is where you put trace IDs, auth tokens, and tenant info:

```go
import "google.golang.org/grpc/metadata"

// Outgoing.
md := metadata.Pairs(
    "x-request-id", reqID,
    "x-tenant-id", tenantID,
)
ctx = metadata.NewOutgoingContext(ctx, md)
resp, err := client.GetUser(ctx, &pb.GetUserRequest{Id: 42})

// Incoming (server).
md, ok := metadata.FromIncomingContext(ctx)
if !ok { /* no metadata */ }
reqIDs := md.Get("x-request-id")  // []string, may be empty
```

A gRPC interceptor is a clean place to extract metadata into context values:

```go
func unaryServerInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    md, _ := metadata.FromIncomingContext(ctx)
    if ids := md.Get("x-request-id"); len(ids) > 0 {
        ctx = WithRequestID(ctx, ids[0])
    }
    if t := md.Get("x-tenant-id"); len(t) > 0 {
        ctx = WithTenantID(ctx, t[0])
    }
    return handler(ctx, req)
}
```

The handler downstream sees the same type-safe getters (`RequestIDFrom`, `TenantIDFrom`) it would in HTTP middleware. The mechanism differs; the abstraction is identical.

## OpenTelemetry: Span Context In, Span Context Out

OpenTelemetry's tracer uses the same context plumbing. A span is created from a context and stored *back* in the context:

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace"
)

func processOrder(ctx context.Context, id int64) error {
    tracer := otel.Tracer("orders")
    ctx, span := tracer.Start(ctx, "processOrder",
        trace.WithAttributes(attribute.Int64("order.id", id)))
    defer span.End()

    // Anything called with this ctx becomes a child span automatically.
    if err := db.LoadOrder(ctx, id); err != nil {
        span.RecordError(err)
        return err
    }
    return nil
}
```

`tracer.Start(ctx, name)` returns a *new* context with the new span injected, plus the span itself. Downstream calls that take this ctx and themselves call `tracer.Start` build a parent-child tree without explicit wiring.

### Cross-process propagation

OpenTelemetry has a `propagation.TextMapPropagator` for serializing the active span into HTTP headers (the standard `traceparent` and `tracestate` headers):

```go
// Outbound HTTP.
otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

// Inbound (typically in middleware).
ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(r.Header))
```

After `Extract`, the span context lives in `ctx` and any spans you start are automatically children of the inbound trace. With instrumented HTTP handlers (`otelhttp.NewHandler`) and clients (`otelhttp.NewTransport`), this happens automatically. For gRPC, use `otelgrpc.NewServerHandler` and `otelgrpc.NewClientHandler`.

## Combining Contexts

Go has no built-in `Merge(a, b context.Context) context.Context`. The standard library does not provide one because the semantics are ambiguous (which deadline wins? which values shadow?). When you need it, the patterns below cover almost every case.

### Use case 1: detach values from cancellation

You want to keep request-scoped values (trace ID, logger) but ignore the request's cancellation. Example: spawning a background flush after a request returns.

Go 1.21+ ships `context.WithoutCancel`:

```go
bgCtx := context.WithoutCancel(r.Context())
// bgCtx has the same Value chain but Done() returns nil.

go func() {
    flushBuffer(bgCtx)  // outlives the request
}()
```

Pre-1.21 you had to write a wrapper:

```go
type detachedCtx struct{ parent context.Context }

func (detachedCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (detachedCtx) Done() <-chan struct{}       { return nil }
func (detachedCtx) Err() error                  { return nil }
func (d detachedCtx) Value(k any) any           { return d.parent.Value(k) }

func WithoutCancel(parent context.Context) context.Context {
    return detachedCtx{parent: parent}
}
```

### Use case 2: cancel on either of two parents

You want cancellation when *either* `ctx1.Done()` or `ctx2.Done()` fires. Useful when one ctx is the request, another is a global shutdown ctx.

```go
func MergeCancel(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
        case <-stop:
        }
        cancel()
    }()
    return ctx, func() {
        close(stop)
        cancel()
    }
}
```

The returned context's `Value` chain is `a`'s, not `b`'s. If you need both, wrap in another `WithValue` chain manually.

### Use case 3: cancel on all parents (intersection)

Less common. Cancel only when *both* contexts are done. Wrap with a goroutine that waits for both.

In practice you almost always want *either* (use case 2) — the union of parents — not the intersection.

## Context Across Goroutine Boundaries

Every goroutine that takes a context must derive its own behavior from it. Three rules:

### Rule 1: pass ctx, don't capture-and-go

```go
// BAD: ctx captured by closure, but no Done check.
go func() {
    for {
        process(ctx)  // never sees ctx.Done()
    }
}()

// GOOD: explicit ctx parameter, explicit Done.
go func(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            process(ctx)
        }
    }
}(ctx)
```

### Rule 2: a goroutine outliving its caller must not use the caller's ctx

```go
// BAD: caller returns immediately, ctx is canceled, the goroutine dies.
func enqueueFlush(ctx context.Context) {
    go flush(ctx)  // ctx canceled when caller returns!
    return
}

// GOOD: detach.
func enqueueFlush(ctx context.Context) {
    bg := context.WithoutCancel(ctx)
    go flush(bg)
    return
}
```

### Rule 3: errgroup is your friend

For "spawn N goroutines, wait, propagate first error":

```go
import "golang.org/x/sync/errgroup"

func fanOut(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, url := range urls {
        url := url
        g.Go(func() error {
            return fetch(ctx, url)
        })
    }
    return g.Wait()
}
```

`errgroup.WithContext` returns a new ctx that is canceled when *any* goroutine returns an error (or when the parent is canceled). Other goroutines see `ctx.Done()` and bail.

If you want to bound concurrency, set `g.SetLimit(n)` (Go 1.20+).

## A Realistic gRPC Service Skeleton

```go
package main

import (
    "context"
    "log"
    "net"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/metadata"

    pb "example.com/proto"
)

type orderServer struct {
    pb.UnimplementedOrderServiceServer
    db *DB
}

func (s *orderServer) GetOrder(ctx context.Context, req *pb.GetOrderRequest) (*pb.Order, error) {
    // Cap downstream calls at 80% of remaining budget.
    deadline, ok := ctx.Deadline()
    if ok {
        remaining := time.Until(deadline)
        if remaining < 50*time.Millisecond {
            return nil, status.Error(codes.DeadlineExceeded, "no time left")
        }
    }

    rid := requestIDFromMD(ctx)
    log.Printf("[%s] GetOrder id=%d", rid, req.Id)

    o, err := s.db.LoadOrder(ctx, req.Id)
    if err != nil {
        return nil, status.FromError(err).Err()
    }
    return o.toProto(), nil
}

func requestIDFromMD(ctx context.Context) string {
    md, _ := metadata.FromIncomingContext(ctx)
    if ids := md.Get("x-request-id"); len(ids) > 0 {
        return ids[0]
    }
    return ""
}

func main() {
    lis, _ := net.Listen("tcp", ":50051")
    grpcServer := grpc.NewServer(
        grpc.UnaryInterceptor(otelgrpc.UnaryServerInterceptor()),
    )
    pb.RegisterOrderServiceServer(grpcServer, &orderServer{db: openDB()})
    grpcServer.Serve(lis)
}
```

The handler trusts gRPC to give it a context with the propagated deadline (encoded in `grpc-timeout`) and metadata. It in turn passes ctx to `s.db.LoadOrder`, which uses `db.QueryRowContext` — propagation is end-to-end.

## Cancel Propagation Failures

Three classic failure modes you should diagnose on sight:

### Failure 1: ctx not propagated

Service A calls service B with a 5 s deadline. B's handler does `db.QueryContext(context.Background(), ...)`. The DB query has no deadline — it can run for 30 s while A's caller times out and B holds the connection.

**Symptom**: Service B has slow tail latency long after A has given up.

**Fix**: pass `ctx` everywhere. Add a `vet`-style lint in CI for `Background()` inside handler files.

### Failure 2: ctx swallowed by middleware

A middleware wraps `r` but accidentally constructs a fresh context:

```go
// BUG
func auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.WithValue(context.Background(), userKey{}, user)  // <- broken
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

The handler downstream has no deadline, no trace, no nothing. Always derive from `r.Context()`:

```go
ctx := context.WithValue(r.Context(), userKey{}, user)
```

### Failure 3: stored ctx

```go
type Service struct{ ctx context.Context }
```

Discussed in deadlines-and-cancellations; mentioned again here because it is the single most common ctx anti-pattern in code review.

## Best Practices Checklist (Senior)

- [ ] Every cross-service call has a well-thought-out deadline budget.
- [ ] gRPC and HTTP middleware extract incoming metadata into typed ctx values.
- [ ] OpenTelemetry instrumentation is attached at the transport layer (`otelhttp`, `otelgrpc`).
- [ ] Background goroutines that outlive a request use `context.WithoutCancel`.
- [ ] Combined contexts use a documented helper (`MergeCancel`) — no ad-hoc goroutines per call site.
- [ ] No ctx is stored in a struct, ever.
- [ ] Every `errgroup` uses `errgroup.WithContext` so first-error cancels the rest.
- [ ] `signal.NotifyContext` provides the root for the program; workers and HTTP server share it.

## What's Next

Professional-level patterns: payment systems with idempotency in context, multi-stage file uploads with progress, scheduled job orchestration, and the subtle interaction between context and `runtime/trace`.

[← Back to index](junior.md)
