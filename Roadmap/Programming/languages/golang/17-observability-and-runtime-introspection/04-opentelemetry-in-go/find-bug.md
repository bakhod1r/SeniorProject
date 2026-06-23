# OpenTelemetry in Go — Find the Bug

> Each snippet contains a real-world bug in OpenTelemetry-Go instrumentation. OTel produces traces, metrics, and logs through a `TracerProvider`/`MeterProvider` you wire up once, an exporter (OTLP/stdout), and a propagator for cross-service context. Most bugs come from broken context threading, missing lifecycle calls, or cardinality/cost mistakes. Find the bug, explain it, fix it.

---

## Bug 1 — Child span passed the wrong context

```go
func handler(ctx context.Context) {
    ctx, span := tracer.Start(ctx, "handler")
    defer span.End()
    doWork(context.Background()) // child should be under "handler"
}

func doWork(ctx context.Context) {
    _, span := tracer.Start(ctx, "do-work")
    defer span.End()
}
```

**Bug:** `doWork` is called with `context.Background()`, not the `ctx` returned by `Start`. The parent link lives in `context.Context`, so `do-work` becomes a **separate root trace** with its own trace ID instead of a child of `handler`.

**Fix:** thread the `ctx`:

```go
doWork(ctx) // the ctx returned by tracer.Start
```

This is the single most common OTel bug. Shadowing `ctx` on the `Start` line makes passing the right one automatic.

---

## Bug 2 — Provider never registered

```go
func main() {
    exp, _ := stdouttrace.New()
    tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))
    defer tp.Shutdown(context.Background())

    // ... business code uses otel.Tracer("x").Start(...)
}
```

**Bug:** `otel.SetTracerProvider(tp)` is never called. The global `otel.Tracer(...)` therefore returns a **no-op** tracer that silently drops every span. The program runs fine and emits nothing.

**Fix:** register the provider globally:

```go
otel.SetTracerProvider(tp)
```

If you prefer not to use the global, pass `tp.Tracer(...)` explicitly everywhere — but then `otel.Tracer` must not be used.

---

## Bug 3 — No `Shutdown`, last spans lost

```go
func main() {
    tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))
    otel.SetTracerProvider(tp)

    runServerOnce() // creates spans, then returns
    // main returns here
}
```

**Bug:** No `tp.Shutdown(ctx)`. With `WithBatcher`, spans are buffered and flushed on a timer or at shutdown. When `main` returns before the batch timer fires, the buffered spans are **never exported**.

**Fix:**

```go
defer func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _ = tp.Shutdown(ctx)
}()
```

Bound the context so a dead collector can't hang shutdown forever.

---

## Bug 4 — `RecordError` without `SetStatus`

```go
ctx, span := tracer.Start(ctx, "charge")
defer span.End()
if err := charge(ctx); err != nil {
    span.RecordError(err)
    return err
}
```

**Bug:** `RecordError` adds an error *event* but does **not** change the span's status. The span stays `Unset`/`Ok` — green in the UI. Alerting and dashboards that key on span status treat this failed operation as a success.

**Fix:** also set the status:

```go
span.RecordError(err)
span.SetStatus(codes.Error, "charge failed")
return err
```

---

## Bug 5 — Propagator never set, so traces don't cross services

```go
func main() {
    otel.SetTracerProvider(tp)
    // missing: otel.SetTextMapPropagator(...)

    client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
    _, _ = client.Get("http://downstream/api")
}
```

**Bug:** `otelhttp.NewTransport` injects trace headers using the **global** propagator, but the default global propagator is a **no-op**. Without `SetTextMapPropagator`, no `traceparent` header is written, and the downstream service starts a brand-new trace.

**Fix:**

```go
otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
    propagation.TraceContext{}, propagation.Baggage{},
))
```

Set it on **both** the caller and the callee.

---

## Bug 6 — `WithSyncer` in production

```go
tp := sdktrace.NewTracerProvider(
    sdktrace.WithSyncer(otlpExporter), // exports on the request path!
)
```

**Bug:** `WithSyncer` installs a `SimpleSpanProcessor` that exports each span **synchronously** when it ends — a network round-trip to the collector on every `span.End()`, on the request hot path. Under load, request latency is now coupled to collector latency, and a slow collector slows every request.

**Fix:** use the batch processor in production:

```go
tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(otlpExporter))
```

Reserve `WithSyncer` for tests and the `stdouttrace` exporter.

---

## Bug 7 — High-cardinality attribute on a metric

```go
reqs, _ := meter.Int64Counter("http.requests")

func handler(w http.ResponseWriter, r *http.Request) {
    reqs.Add(r.Context(), 1,
        metric.WithAttributes(attribute.String("user.id", userID(r))))
}
```

**Bug:** `user.id` is unbounded. Every unique user creates a new metric **time series**. With millions of users, the metrics backend OOMs and the bill explodes — a classic cardinality incident.

**Fix:** remove the unbounded dimension from the metric. Keep low-cardinality dimensions only; put the user ID on the **span** instead:

```go
reqs.Add(r.Context(), 1,
    metric.WithAttributes(attribute.String("route", "/checkout")))
// user.id belongs on the span (one record per trace), not the metric.
```

Defense in depth: an SDK `View` with an `AttributeFilter` can drop `user.id` centrally.

---

## Bug 8 — Goroutine uses a cancelled request context

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go func() {
        _, span := tracer.Start(ctx, "async-job") // ctx cancelled when handler returns
        defer span.End()
        slowWork(ctx) // aborted early
    }()
    w.Write([]byte("accepted"))
}
```

**Bug:** `r.Context()` is cancelled when the handler returns. The background goroutine's `ctx` is dead almost immediately, so `slowWork` is aborted and `async-job` is truncated.

**Fix:** keep the span/trace link but drop cancellation with `context.WithoutCancel` (Go 1.21+):

```go
bgCtx := context.WithoutCancel(r.Context())
go func() {
    _, span := tracer.Start(bgCtx, "async-job")
    defer span.End()
    slowWork(bgCtx)
}()
```

---

## Bug 9 — Mismatched OTLP transport and port

```go
exp, _ := otlptracegrpc.New(ctx,
    otlptracegrpc.WithEndpoint("collector:4318"), // HTTP port!
    otlptracegrpc.WithInsecure(),
)
```

**Bug:** `otlptracegrpc` speaks OTLP/gRPC, whose default port is **4317**. Port **4318** is OTLP/**HTTP**. Pointing the gRPC exporter at the HTTP port yields opaque connection/transport errors and no spans.

**Fix:** match exporter to port:

```go
otlptracegrpc.WithEndpoint("collector:4317") // gRPC
// or use otlptracehttp for 4318
```

---

## Bug 10 — Span per loop iteration in a hot path

```go
ctx, span := tracer.Start(ctx, "process-batch")
defer span.End()
for _, item := range millionItems {
    _, s := tracer.Start(ctx, "process-item") // a million spans
    process(ctx, item)
    s.End()
}
```

**Bug:** Creating a span per element of a million-item loop floods the backend with a million spans per batch, adds per-iteration allocation, and makes the trace unreadable.

**Fix:** span the batch, not each item; record per-item facts as attributes/events or counts:

```go
ctx, span := tracer.Start(ctx, "process-batch")
defer span.End()
span.SetAttributes(attribute.Int("batch.size", len(millionItems)))
for _, item := range millionItems {
    process(ctx, item)
}
```

If per-item visibility is essential, sample or use a metric (a counter), not a span each.

---

## Bug 11 — Provider shut down before the server drains

```go
<-sigterm
tp.Shutdown(ctx)          // flush telemetry first
srv.Shutdown(drainCtx)    // THEN drain requests
```

**Bug:** Ordering is reversed. The provider is shut down (and becomes terminal) **before** in-flight requests finish. Spans from the final requests — exactly the ones that show whether the new deploy is healthy — end after the provider is dead and are dropped.

**Fix:** drain the server first, then flush the providers:

```go
<-sigterm
srv.Shutdown(drainCtx)    // let in-flight requests finish; their spans enqueue
tp.Shutdown(flushCtx)     // THEN flush the final batch
```

Bound both contexts with timeouts.

---

## Bug 12 — Library imports the SDK directly

```go
// inside a reusable library package
import sdktrace "go.opentelemetry.io/otel/sdk/trace"

func init() {
    tp := sdktrace.NewTracerProvider(/* ... */)
    otel.SetTracerProvider(tp) // library hijacks the global provider!
}
```

**Bug:** A library configures the **SDK** and overwrites the application's global `TracerProvider` in its `init`. Now the app's carefully configured exporter/sampler is replaced by the library's defaults — or whichever `init` runs last wins. Libraries must not own the SDK.

**Fix:** libraries depend on the **API only** and never set the global provider:

```go
import "go.opentelemetry.io/otel"
var tracer = otel.Tracer("github.com/me/mylib")
// no SDK, no SetTracerProvider — the application wires that up.
```

---

## Bug 13 — Dynamic value baked into the span name

```go
ctx, span := tracer.Start(ctx, fmt.Sprintf("GET /users/%d", userID))
defer span.End()
```

**Bug:** The user ID is in the **span name**, making span names unbounded (one per user). Backends group by span name; this fragments the data so you can never aggregate "GET /users/:id" latency, and it inflates index cardinality.

**Fix:** use a low-cardinality route template as the name and put the ID in an attribute:

```go
ctx, span := tracer.Start(ctx, "GET /users/:id")
defer span.End()
span.SetAttributes(attribute.Int("user.id", userID))
```

---

## Bug 14 — Metric temporality wrong for Prometheus

```go
// Pushing OTLP metrics with DELTA temporality to a Prometheus-backed store
exp, _ := otlpmetricgrpc.New(ctx,
    otlpmetricgrpc.WithTemporalitySelector(deltaSelector),
)
```

**Bug:** Prometheus expects **cumulative** counters (it computes rates itself). With **delta** temporality, each export reports only the change since the last collection, so the Prometheus-facing store sees counters that appear to reset every cycle — rates are wrong/sawtoothed.

**Fix:** use cumulative temporality for Prometheus-style backends (the default, or the Prometheus exporter which is inherently cumulative):

```go
// Use exporters/prometheus, or cumulative temporality on the OTLP exporter.
exp, _ := prometheus.New()
mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(exp))
```

---

## Bug 15 — `WithInsecure` shipped to production

```go
exp, _ := otlptracegrpc.New(ctx,
    otlptracegrpc.WithEndpoint("otel-collector.prod:4317"),
    otlptracegrpc.WithInsecure(), // plaintext in production
)
```

**Bug:** `WithInsecure()` disables TLS. In production this sends telemetry — which may contain attributes derived from request data — in plaintext over the network, and lets any party impersonate the collector endpoint.

**Fix:** use TLS (and auth) toward the collector:

```go
exp, _ := otlptracegrpc.New(ctx,
    otlptracegrpc.WithEndpoint("otel-collector.prod:4317"),
    otlptracegrpc.WithTLSCredentials(credentials.NewClientTLSFromCert(pool, "")),
)
```

`WithInsecure` is for local dev only.

---

## Bug 16 — PII recorded in a span attribute

```go
span.SetAttributes(
    attribute.String("user.email", req.Email),
    attribute.String("request.body", string(rawBody)),
    attribute.String("auth.token", token),
)
```

**Bug:** Email, raw request body, and auth token are PII/secrets. Attributes are exported and stored in the telemetry backend, often with broad access. This is a compliance and security leak.

**Fix:** never record secrets/PII; redact or hash, and record only what you need:

```go
span.SetAttributes(
    attribute.String("user.id", hash(req.Email)), // pseudonymous
    attribute.Int("request.body_bytes", len(rawBody)),
)
```

Add a Collector `attributes`/`redaction` processor as a backstop across all services.

---

## Bug 17 — Mixing a global and an explicit provider

```go
otel.SetTracerProvider(globalTP) // global
router := chi.NewRouter()
router.Use(otelhttp.NewMiddleware("svc")) // uses the GLOBAL provider

svc := NewService(WithTracerProvider(otherTP)) // explicit, different pipeline
```

**Bug:** Middleware spans go to `globalTP`; service spans go to `otherTP`. The two pipelines have different exporters/samplers, so a single request's spans are split across backends — "half my spans are missing."

**Fix:** pick one strategy. Either everything uses the global:

```go
svc := NewService(WithTracerProvider(globalTP)) // same provider
```

or thread the explicit provider into the middleware too. Don't mix.

---

## Bug 18 — Sampler expected to see the error

```go
// Custom sampler that tries to keep error traces:
func (s sampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
    for _, kv := range p.Attributes {
        if kv.Key == "error" && kv.Value.AsBool() {
            return sdktrace.SamplingResult{Decision: sdktrace.RecordAndSample}
        }
    }
    return drop
}
```

**Bug:** `ShouldSample` runs at span **start**, before the request executes. The `error` attribute is set later, during/after the work — so it is **not** present in `p.Attributes` at sampling time. The sampler can never see it; error traces are dropped.

**Fix:** outcome-based selection (keep errors, keep slow) must be **tail sampling in the Collector**, which sees the completed trace. The SDK sampler can only use start-time information:

```yaml
processors:
  tail_sampling:
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
```

---

## Bug 19 — Fresh attribute slice allocated on every metric call

```go
func record(ctx context.Context, route, method, status string) {
    latency.Record(ctx, elapsed,
        metric.WithAttributes(
            attribute.String("route", route),
            attribute.String("method", method),
            attribute.String("status", status),
        )) // new []KeyValue every call, in a hot path
}
```

**Bug:** In a hot path, building a fresh `[]attribute.KeyValue` (and the `WithAttributes` option) on every call allocates and forces an attribute-set hash each time. Under high QPS this shows up in allocation profiles.

**Fix:** precompute the attribute set / option for the common combinations:

```go
var okGetAttrs = metric.WithAttributeSet(attribute.NewSet(
    attribute.String("route", "/checkout"),
    attribute.String("method", "GET"),
    attribute.String("status", "ok"),
))
latency.Record(ctx, elapsed, okGetAttrs)
```

---

## Bug 20 — No error handler, drops are invisible

```go
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exp, sdktrace.WithMaxQueueSize(512)),
)
otel.SetTracerProvider(tp)
// no otel.SetErrorHandler(...)
```

**Bug:** Under a traffic spike, the 512-span queue overflows and the `BatchSpanProcessor` **drops** spans silently. Export failures are also swallowed. With no error handler registered, you have no signal that telemetry is being lost — discovered only when a trace is missing during an incident.

**Fix:** register an error handler and size the queue for your QPS:

```go
otel.SetErrorHandler(otel.ErrorHandlerFunc(func(e error) {
    log.Printf("otel error: %v", e) // surface drops/export failures
}))
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exp, sdktrace.WithMaxQueueSize(4096)),
)
```

Monitor dropped-span counts so overflow is visible *before* an incident.

---

## Bug 21 — Confusing OTel with `runtime/trace`

```go
// Goal: "find why this service is GC-thrashing and blocking on a mutex"
ctx, span := otel.Tracer("svc").Start(ctx, "investigate")
defer span.End()
// ... expecting span data to show scheduler/GC behavior
```

**Bug:** OpenTelemetry spans describe **application/request** operations across services. They do not capture scheduler events, GC pauses, goroutine blocking, or syscalls. The engineer is using the wrong tool for an in-process performance question.

**Fix:** for in-process scheduler/runtime analysis use `runtime/trace` + `go tool trace` (or a CPU profile):

```go
f, _ := os.Create("trace.out")
trace.Start(f)        // runtime/trace, not OTel
defer trace.Stop()
// reproduce load, then: go tool trace trace.out
```

OTel tells you *which service/span* is slow; `runtime/trace` tells you *why, inside the process*. See [03-runtime-trace-application-tracing](../03-runtime-trace-application-tracing/junior.md).

---

## Bug 22 — Unbounded baggage propagated everywhere

```go
member, _ := baggage.NewMember("debug.payload", string(largeJSONBlob))
bag, _ := baggage.New(member)
ctx = baggage.ContextWithBaggage(ctx, bag)
// every downstream HTTP/gRPC call now carries this blob in a header
```

**Bug:** Baggage is propagated as a header to **every** downstream service for the rest of the request. A large blob inflates every outbound request, risks exceeding header size limits (causing 431/dropped requests), and may leak data across service boundaries.

**Fix:** keep baggage tiny and non-sensitive — small identifiers only:

```go
member, _ := baggage.NewMember("tenant.id", "acme")
bag, _ := baggage.New(member)
ctx = baggage.ContextWithBaggage(ctx, bag)
```

Large or sensitive data belongs on a span attribute (local to the producing service), not in propagated baggage.

---

## Summary

OpenTelemetry instrumentation looks like a few `Start`/`End`/`Record` calls, but the bugs cluster into three habits:

1. **Broken context and lifecycle.** Forgetting to thread the `ctx` from `Start` (orphaned spans), forgetting `SetTracerProvider` (no-op tracer), forgetting `Shutdown` or getting shutdown *ordering* wrong (lost final spans), missing the propagator (broken cross-service traces), or using a cancelled request context in a goroutine. Always thread `ctx`, register the provider, set the propagator, and drain-then-flush with bounded timeouts.

2. **Cost and cardinality mistakes.** High-cardinality attributes on metrics, dynamic values in span names, a span per loop iteration, fresh attribute slices in hot paths, and unbounded baggage. Keep metric dimensions bounded, span names static, baggage tiny — and push unbounded values onto spans, not metric dimensions.

3. **Wrong tool / wrong layer.** `WithSyncer` in production, mismatched OTLP port, delta temporality for Prometheus, libraries owning the SDK, expecting the SDK sampler to see outcomes (use Collector tail sampling), `WithInsecure`/PII in production, no error handler, and confusing OTel with `runtime/trace`. Use `WithBatcher`, match transport to port, keep the SDK in `main`, do outcome-based sampling in the Collector, secure and redact, register an error handler — and reach for `runtime/trace` for in-process questions and OTel for cross-service ones.

Treat instrumentation as a side effect that must never change behavior, never block the request path, and never grow your bill linearly with success — and the rest of OpenTelemetry becomes dependable.
