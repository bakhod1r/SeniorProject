# OpenTelemetry in Go — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The API/SDK Split (and Why Libraries Depend Only on the API)](#the-apisdk-split-and-why-libraries-depend-only-on-the-api)
3. [The Trace Data Model in Depth](#the-trace-data-model-in-depth)
4. [The Tracing Pipeline: Provider, Processor, Exporter](#the-tracing-pipeline-provider-processor-exporter)
5. [Context Propagation Across Goroutines and Network Boundaries](#context-propagation-across-goroutines-and-network-boundaries)
6. [Sampling: ParentBased and TraceIDRatioBased](#sampling-parentbased-and-traceidratiobased)
7. [The Metrics Signal: MeterProvider and Instruments](#the-metrics-signal-meterprovider-and-instruments)
8. [Metrics and Prometheus](#metrics-and-prometheus)
9. [Resources and Semantic Conventions](#resources-and-semantic-conventions)
10. [Graceful Shutdown and Flushing](#graceful-shutdown-and-flushing)
11. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
12. [Best Practices for Established Services](#best-practices-for-established-services)
13. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

You can already create a span, instrument an HTTP handler, and export to stdout or a collector. The middle-level questions are structural: *how is the SDK actually wired*, *what exactly travels in the context*, *how do spans get batched and sampled*, and *how do metrics fit alongside traces*.

This file moves from "make a span appear" to "configure a production pipeline." We cover the API/SDK boundary that lets libraries instrument without imposing a backend, the full trace data model (span kinds, events, links, status), the processor/exporter pipeline, propagation across goroutines and services, sampling math, and the metrics signal with its instrument types and Prometheus relationship.

After reading this you will:
- Explain why your code imports the API and only `main` imports the SDK
- Describe every field of the span data model and when to use each
- Configure a `TracerProvider` with the right processor, sampler, and exporter
- Propagate context correctly across goroutines, HTTP, and gRPC
- Choose a sampler and understand the ratio math
- Build counters, histograms, and observable gauges with a `MeterProvider`
- Wire OTel metrics to Prometheus, two different ways

---

## The API/SDK Split (and Why Libraries Depend Only on the API)

OpenTelemetry-Go is deliberately two layers.

- **The API** lives under `go.opentelemetry.io/otel` (the `trace`, `metric`, `baggage`, `propagation` packages). It defines *interfaces*: `Tracer`, `Span`, `Meter`, `Counter`. It has a built-in **no-op** implementation that does nothing.
- **The SDK** lives under `go.opentelemetry.io/otel/sdk` (`sdk/trace`, `sdk/metric`, `sdk/resource`). It is the real implementation: providers, processors, exporters, samplers.

The rule: **library code imports only the API.** A library calls `otel.Tracer("mylib").Start(...)` and creates spans against interfaces. If the consuming application never installs an SDK, those calls hit the no-op and cost almost nothing. If the application *does* install an SDK (via `otel.SetTracerProvider(sdkTP)`), the same library calls suddenly produce real spans.

This is why you can `go get` an instrumented HTTP router and not be forced into a particular tracing backend — or any tracing at all. The application owns the SDK choice; the library owns the instrumentation.

```go
// In a library — API only:
import "go.opentelemetry.io/otel"
var tracer = otel.Tracer("github.com/me/mylib")
func (c *Client) Do(ctx context.Context) {
    ctx, span := tracer.Start(ctx, "Client.Do")
    defer span.End()
    // ...
}

// In main — SDK is wired exactly once:
import sdktrace "go.opentelemetry.io/otel/sdk/trace"
otel.SetTracerProvider(sdktrace.NewTracerProvider(/* ... */))
```

Practical consequence: never reach for `sdk/trace` inside a reusable package. The day someone vendors your library into a binary that already configures OTel differently, your direct SDK use fights theirs.

---

## The Trace Data Model in Depth

A span carries more than a name and two timestamps.

| Field | Meaning |
|-------|---------|
| **Name** | Low-cardinality operation label (`"GET /users/:id"`). |
| **SpanContext** | The immutable trace ID + span ID + trace flags (sampled bit) + trace state. This is what propagates. |
| **Parent** | The span this one was created under, giving the tree shape. |
| **SpanKind** | `Server`, `Client`, `Producer`, `Consumer`, or `Internal`. Tells the backend the role. |
| **StartTime / EndTime** | Set on `Start` and `End`. |
| **Attributes** | Typed key/values (`attribute.Int64`, `String`, `Bool`, `Float64`, and slices). |
| **Events** | Timestamped points within the span (`span.AddEvent("cache.miss")`). Errors are recorded as events. |
| **Links** | References to *other* spans, possibly in other traces. Used for batching and fan-in. |
| **Status** | `Unset`, `Ok`, or `Error` with a description. |

### Span kinds

`SpanKind` matters because backends use it to compute service maps and to decide which span is the "entry point."

```go
ctx, span := tracer.Start(ctx, "GET /stock",
    trace.WithSpanKind(trace.SpanKindClient))
```

- `Server` — you received a request (set by `otelhttp.NewHandler`).
- `Client` — you made an outbound request (set by `otelhttp.NewTransport`).
- `Producer` / `Consumer` — message-queue send/receive.
- `Internal` — a function-level span with no remote peer (the default).

### Events vs attributes

An **attribute** describes the span as a whole (`http.status_code=500`). An **event** is something that happened *at a moment* during the span (`"retry", t=120ms`). Use events for discrete moments, attributes for end-state facts.

### Links

A **link** connects this span to another span context that is not its parent. The canonical use: a batch consumer processes 100 messages, each from a different trace. The batch-processing span *links* to all 100 producer spans instead of pretending one is its parent.

### Status and errors

`span.SetStatus(codes.Error, "msg")` sets the span's status. `span.RecordError(err)` adds an *event* with the error. The two are independent: `RecordError` does not change status. Production code does both, in that order.

---

## The Tracing Pipeline: Provider, Processor, Exporter

The SDK trace pipeline has three composable parts.

```
Span ends → SpanProcessor → Exporter → backend
```

### TracerProvider

The provider holds configuration and hands out tracers. You build it once:

```go
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exporter),                 // a BatchSpanProcessor
    sdktrace.WithResource(res),                     // service.name, etc.
    sdktrace.WithSampler(sdktrace.ParentBased(      // sampling policy
        sdktrace.TraceIDRatioBased(0.1))),
)
```

### SpanProcessor

A `SpanProcessor` sits between span completion and export. The two built-in kinds:

- **`SimpleSpanProcessor`** (via `WithSyncer`) — exports each span synchronously, immediately. Fine for tests and `stdouttrace`; **never** for production — it serializes export onto your request path.
- **`BatchSpanProcessor`** (via `WithBatcher`) — buffers spans and exports them in batches on a timer or when the buffer fills. This is the production default. It has tunable knobs: max queue size, batch size, export timeout, scheduled delay.

```go
sdktrace.WithBatcher(exporter,
    sdktrace.WithMaxQueueSize(2048),
    sdktrace.WithMaxExportBatchSize(512),
    sdktrace.WithBatchTimeout(5*time.Second),
)
```

When the queue overflows (collector down, traffic spike), the batch processor **drops** spans rather than blocking your handlers. That is the correct trade: telemetry is best-effort, requests are not.

### Exporter

The exporter serializes spans and sends them. Common choices:

- `stdouttrace` — JSON to a writer (learning, debugging).
- `otlptracegrpc` — OTLP over gRPC to a collector (default port `4317`).
- `otlptracehttp` — OTLP over HTTP/protobuf (default port `4318`), useful where gRPC is awkward (some proxies, browsers-adjacent setups).

You almost never write a custom exporter; you point an OTLP exporter at a Collector and let the Collector fan out to backends.

---

## Context Propagation Across Goroutines and Network Boundaries

Propagation is where traces are made or broken.

### Within a process: just pass `ctx`

The active span lives in `context.Context`. Across function calls, pass the `ctx` returned by `Start`. Across goroutines, pass the parent `ctx` into the goroutine:

```go
ctx, span := tracer.Start(ctx, "fan-out")
defer span.End()

for _, item := range items {
    item := item
    go func(ctx context.Context) {
        _, s := tracer.Start(ctx, "process-item") // child of fan-out
        defer s.End()
        process(ctx, item)
    }(ctx)
}
```

**Cancellation caveat:** if the parent `ctx` is request-scoped, it may be cancelled when the handler returns, killing your goroutine prematurely. To keep the trace link but drop cancellation, derive a context that copies the span but not the deadline — `context.WithoutCancel(ctx)` (Go 1.21+) does exactly this:

```go
go worker(context.WithoutCancel(ctx)) // keeps the span, drops cancellation
```

### Across the network: propagators

A **propagator** serializes the `SpanContext` into carrier headers and reads it back. The standard is **W3C Trace Context** — the `traceparent` (and `tracestate`) headers.

```go
otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
    propagation.TraceContext{}, // traceparent / tracestate
    propagation.Baggage{},      // baggage header
))
```

- **Outbound:** `otelhttp.NewTransport` (HTTP) and the `otelgrpc` interceptors **inject** the headers automatically — provided a propagator is set.
- **Inbound:** `otelhttp.NewHandler` and the gRPC interceptors **extract** the headers and put the remote span context into `r.Context()`, so your server span continues the upstream trace.

### Baggage

**Baggage** is application-defined key/value data that propagates alongside trace context across services (e.g. `tenant.id`). It rides the `baggage` header. Useful, but mind two things: baggage is *not* automatically copied into span attributes, and it travels to every downstream service, so keep it small and non-sensitive.

```go
member, _ := baggage.NewMember("tenant.id", "acme")
bag, _ := baggage.New(member)
ctx = baggage.ContextWithBaggage(ctx, bag)
```

---

## Sampling: ParentBased and TraceIDRatioBased

You usually cannot afford to record 100% of traces. **Sampling** decides which traces to keep.

### TraceIDRatioBased

`TraceIDRatioBased(0.1)` keeps roughly 10% of traces, deciding deterministically from the trace ID. Because the decision is a function of the trace ID, every service that sees the same trace ID makes the *same* decision — so a sampled trace is sampled end-to-end, not half-kept.

### ParentBased

A standalone ratio sampler at the root is fine, but you want consistency: if the *parent* (upstream service) decided to sample, you should too, regardless of your local ratio. `ParentBased` wraps a root sampler and respects the incoming `sampled` flag:

```go
sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))
```

Semantics: if there is a parent with a sampling decision, honor it; only if this span is a *root* (no remote parent) apply the 10% ratio. This is the standard production sampler — it keeps whole traces intact across the fleet.

### AlwaysSample / NeverSample

`AlwaysSample()` (the SDK default) and `NeverSample()` exist for tests and extremes. Production rarely uses `AlwaysSample` on a high-QPS service.

### Head vs tail sampling

The SDK does **head sampling**: the decision is made when the root span starts, before you know whether the request errored or was slow. **Tail sampling** (keep all errors, keep slow requests) requires buffering whole traces and is done in the **Collector**, not the SDK. We return to this in `senior.md` and `professional.md`.

---

## The Metrics Signal: MeterProvider and Instruments

Traces answer "what happened in this request." Metrics answer "what is the aggregate rate/latency/count over time." They use a parallel pipeline.

```go
import (
    "go.opentelemetry.io/otel"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
)

exp, _ := otlpmetricgrpc.New(ctx)
mp := sdkmetric.NewMeterProvider(
    sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exp)),
    sdkmetric.WithResource(res),
)
otel.SetMeterProvider(mp)
defer mp.Shutdown(ctx)
```

### Instruments

A `Meter` creates **instruments**. The core types:

| Instrument | Sync/Async | Use |
|-----------|-----------|-----|
| **Counter** | sync | Monotonic count: requests served, bytes sent. Only goes up. |
| **UpDownCounter** | sync | Goes up and down: active connections, queue depth. |
| **Histogram** | sync | Distribution: request latency, payload size. Produces buckets. |
| **Observable (async) Gauge / Counter / UpDownCounter** | async | Sampled via a callback: current temperature, CPU, in-memory cache size. |

Synchronous instruments are recorded inline where the event happens:

```go
meter := otel.Meter("checkout")
reqs, _ := meter.Int64Counter("checkout.requests")
latency, _ := meter.Float64Histogram("checkout.latency_seconds")

reqs.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "ok")))
latency.Record(ctx, elapsed.Seconds())
```

Asynchronous (observable) instruments register a callback the SDK invokes on each collection cycle:

```go
queueDepth, _ := meter.Int64ObservableGauge("worker.queue_depth")
meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
    o.ObserveInt64(queueDepth, int64(len(queue)))
    return nil
}, queueDepth)
```

### Views

A **View** lets you customize instrument output: rename, drop attributes, change histogram bucket boundaries, or filter which instruments are exported. This is the main lever for controlling metric cardinality at the SDK level:

```go
sdkmetric.NewView(
    sdkmetric.Instrument{Name: "checkout.latency_seconds"},
    sdkmetric.Stream{Aggregation: sdkmetric.AggregationExplicitBucketHistogram{
        Boundaries: []float64{0.005, 0.01, 0.05, 0.1, 0.5, 1, 5},
    }},
)
```

---

## Metrics and Prometheus

OpenTelemetry metrics and Prometheus overlap; there are two integration paths.

1. **Prometheus exporter (pull).** `go.opentelemetry.io/otel/exporters/prometheus` registers the OTel `MeterProvider` as a Prometheus `Collector`, so Prometheus *scrapes* a `/metrics` endpoint as usual.

   ```go
   import promexporter "go.opentelemetry.io/otel/exporters/prometheus"
   exp, _ := promexporter.New()
   mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(exp))
   http.Handle("/metrics", promhttp.Handler())
   ```

2. **OTLP → Collector → Prometheus (push then pull).** Your app pushes OTLP metrics to a Collector; the Collector's `prometheus` exporter exposes them for Prometheus to scrape, or its `prometheusremotewrite` exporter pushes to a Prometheus-compatible store.

Use the direct Prometheus exporter when you already run Prometheus and want minimal moving parts. Use OTLP → Collector when you want one uniform pipeline for all three signals and central control over processing.

Note the naming/units bridge: OTel metric names use dots (`http.server.duration`); the Prometheus exporter rewrites them to Prometheus conventions (underscores, unit suffixes). Do not be surprised that `checkout.requests` shows up as `checkout_requests_total`.

---

## Resources and Semantic Conventions

A **Resource** describes the entity producing telemetry — the same resource is attached to every span and metric from the process.

```go
res, _ := resource.New(ctx,
    resource.WithAttributes(
        semconv.ServiceName("checkout"),
        semconv.ServiceVersion("1.4.2"),
        semconv.DeploymentEnvironment("prod"),
    ),
    resource.WithHost(),       // host.name, etc.
    resource.WithProcess(),    // process.pid, runtime
)
```

`service.name` is the one you must set. The others (`service.version`, `deployment.environment`, host/process detectors) make dashboards and alerts far more useful.

**Semantic conventions** are the agreed-upon attribute keys and values: `http.request.method`, `http.response.status_code`, `db.system`, `rpc.grpc.status_code`. The `semconv` package gives you typed constants. Using them is what makes a backend's out-of-the-box dashboards work and what makes telemetry portable. The `semconv` package is versioned (`semconv/v1.26.0`) — pin a version and bump it deliberately, since key names occasionally change between schema versions.

---

## Graceful Shutdown and Flushing

Both providers buffer. On exit you must flush both.

```go
func main() {
    ctx := context.Background()
    shutdownTP, _ := initTracer(ctx)
    shutdownMP, _ := initMeter(ctx)

    // Flush on the way out, with a bounded timeout.
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        _ = shutdownTP(ctx)
        _ = shutdownMP(ctx)
    }()

    // ... run server, wait for signal ...
}
```

Two subtleties:

- **Bound the shutdown context.** If the collector is dead, an unbounded `Shutdown` can hang forever. A 5-second timeout caps the wait.
- **Order vs server shutdown.** Drain in-flight requests *first* (stop the HTTP server gracefully), *then* shut down the providers, so the spans from the final requests are flushed. Shutting down providers before the server drains loses the last requests' telemetry.

`ForceFlush` exists if you need to flush mid-run (e.g. before a long sleep in a batch job) without tearing down the provider.

---

## Common Errors and Their Real Causes

### Spans never appear in the backend

Either no SDK is installed (`otel.SetTracerProvider` not called → no-op tracer), the propagator/exporter endpoint is wrong, or the process exited without `Shutdown` so the batch never flushed. Check, in order: provider registered, exporter endpoint reachable, shutdown called.

### Traces break at a service boundary

No propagator set on one side, or the boundary is not instrumented (raw `http.Client` instead of `otelhttp.NewTransport`). Both caller and callee need a propagator and instrumented transport/handler.

### Child spans show as separate traces inside one process

A `context.Background()` (or the wrong `ctx`) was passed to the child. The parent link lives in `context.Context`.

### High memory / dropped spans under load

`WithSyncer` in production (export on the request path) or an undersized batch queue. Switch to `WithBatcher` and size the queue for your QPS, accepting that overflow drops spans.

### Metric cardinality explosion

An unbounded attribute value (user ID, URL with path params, error message) on a metric. Each unique combination is a new time series. Fix with a View that drops the offending attribute, or never record it.

### `unknown_service` everywhere

No resource, or a resource without `service.name`. Set it.

---

## Best Practices for Established Services

1. **Import the API in libraries; install the SDK only in `main`.** No `sdk/*` imports in reusable packages.
2. **Use `WithBatcher` always in production.** `WithSyncer` is for tests and `stdouttrace`.
3. **Use `ParentBased(TraceIDRatioBased(r))`** so traces stay whole across the fleet.
4. **Instrument boundaries with `otelhttp`/`otelgrpc`;** hand-write spans for meaningful business steps only.
5. **Set the propagator** (`TraceContext` + `Baggage`) on every service.
6. **Set a rich resource:** `service.name`, `service.version`, `deployment.environment`.
7. **Use `semconv` constants** for attribute keys; pin the `semconv` version.
8. **Control cardinality with Views** for metrics; be deliberate about span attributes.
9. **Shut down with a bounded timeout, after draining the server.**
10. **Prefer a Collector** between your app and backends rather than exporting directly to many backends.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Goroutine context cancelled mid-span

A request-scoped `ctx` passed to a background goroutine is cancelled when the handler returns; the goroutine's work is aborted and its span ends early. Use `context.WithoutCancel(ctx)` to keep the span but drop the deadline.

### Pitfall 2 — Forgetting the propagator, so middleware is silent

`otelhttp` injects/extracts via the *global* propagator. If you never call `SetTextMapPropagator`, the default is a **no-op** and nothing crosses the boundary. Always set it.

### Pitfall 3 — Mixing global and explicit providers

You set a global provider with `otel.SetTracerProvider`, but a library you use holds an explicit `TracerProvider` passed in via options. They diverge — some spans go to one pipeline, some to another. Decide one strategy: either everyone uses the global, or thread the provider explicitly. Inconsistency produces "half my spans are missing."

### Pitfall 4 — Histogram buckets that don't fit your latencies

The default histogram boundaries may not match your service (microseconds vs seconds). Set explicit boundaries via a View, or your latency percentiles are useless.

### Pitfall 5 — Recording error events but green spans

`RecordError` without `SetStatus(codes.Error, ...)`. The trace shows an error event but the span is OK; alerting that keys on span status misses it.

### Pitfall 6 — Span per loop iteration in a hot path

Creating a span for every element of a million-item loop floods the backend and adds overhead. Span the *batch* and use events or attributes for per-item facts, or sample.

### Pitfall 7 — Pinning the wrong exporter port

OTLP/gRPC is `4317`; OTLP/HTTP is `4318`. Pointing the gRPC exporter at `4318` produces opaque connection errors. Match exporter to port.

### Pitfall 8 — Stale `semconv` import

Copying old code that imports `semconv/v1.4.0` while the rest of the system uses `v1.26.0` means attribute keys differ (`http.method` vs `http.request.method`), and dashboards silently miss data. Standardize the version.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Explain the API/SDK split and why libraries import only the API
- [ ] Enumerate the span data-model fields, including span kind, events, links, status
- [ ] Describe the provider → processor → exporter pipeline and when to use batch vs simple
- [ ] Propagate context across goroutines (including the cancellation caveat) and across the network
- [ ] Explain `ParentBased(TraceIDRatioBased(r))` and why head sampling keeps traces whole
- [ ] Build a counter, an updowncounter, a histogram, and an observable gauge
- [ ] Wire OTel metrics to Prometheus, both the direct-exporter and Collector ways
- [ ] Set a proper resource and use semantic conventions
- [ ] Shut down both providers correctly, with a bounded timeout, after draining
- [ ] Diagnose each error in the "Common Errors" section from a one-line symptom

---

## Summary

At the middle level, OpenTelemetry stops being a single `Start`/`End` call and becomes a configured pipeline. The **API/SDK split** is the keystone: libraries call the API and stay backend-agnostic, while `main` installs the SDK once. The **trace data model** is richer than name-plus-timestamps — span kind, attributes, events, links, and status each carry meaning a backend acts on. The **pipeline** runs span → `BatchSpanProcessor` → exporter, with batching to keep export off the request path and overflow-drop to protect requests. **Propagation** lives in `context.Context` within a process (mind goroutine cancellation) and in W3C `traceparent` headers across services (mind the propagator). **Sampling** is head-based and consistent via `ParentBased(TraceIDRatioBased)`. The **metrics signal** runs a parallel `MeterProvider` with counters, up-down counters, histograms, and observable instruments, controllable through Views, and bridges to Prometheus either directly or through a Collector. Tie it together with a rich **resource**, **semantic conventions**, and a **bounded, ordered shutdown** — and you have a production-shaped observability setup rather than a demo.
