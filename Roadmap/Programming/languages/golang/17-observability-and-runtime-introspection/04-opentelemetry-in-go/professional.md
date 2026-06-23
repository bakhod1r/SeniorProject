# OpenTelemetry in Go — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The SDK Architecture, End to End](#the-sdk-architecture-end-to-end)
3. [TracerProvider Lifecycle and the Provider Registry](#tracerprovider-lifecycle-and-the-provider-registry)
4. [Inside the BatchSpanProcessor](#inside-the-batchspanprocessor)
5. [Exporter Internals: OTLP/gRPC vs OTLP/HTTP](#exporter-internals-otlpgrpc-vs-otlphttp)
6. [The Sampler Interface and Custom Samplers](#the-sampler-interface-and-custom-samplers)
7. [The Metrics SDK: Readers, Aggregations, Temporality](#the-metrics-sdk-readers-aggregations-temporality)
8. [The OpenTelemetry Collector](#the-opentelemetry-collector)
9. [Graceful Shutdown, Draining, and Signal Handling](#graceful-shutdown-draining-and-signal-handling)
10. [Performance Profile and Allocation Behavior](#performance-profile-and-allocation-behavior)
11. [A Fully Wired Production Setup](#a-fully-wired-production-setup)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats OpenTelemetry-Go not as a set of calls but as a set of cooperating subsystems with lifecycles, buffering semantics, and back-pressure behavior you must understand to run it reliably. The SDK is small and readable; most production incidents come from misunderstanding the *processor* and *exporter* lifecycle — dropped spans under load, lost telemetry on shutdown, a Collector pipeline that silently discards data.

This file is for engineers who own the observability platform: who configure the Collector, set sampling and redaction policy, tune the batch processor, and guarantee that the last spans of a deploy actually arrive. After reading you will:

- Know the SDK's component graph and how data flows through it
- Reason about the `BatchSpanProcessor` queue, batching, and drop behavior precisely
- Understand the OTLP exporters' transport, retry, and timeout semantics
- Implement a custom `Sampler` correctly
- Understand metric readers, aggregation temporality, and why it matters for Prometheus
- Place and configure a Collector and know what each pipeline stage does
- Implement shutdown that flushes the final telemetry without hanging

OpenTelemetry is conceptually simple — produce spans and metrics, ship them out — but the buffering and lifecycle details govern whether you actually *see* the telemetry when it matters most: under load and during deploys.

---

## The SDK Architecture, End to End

The trace SDK is a pipeline of well-defined components:

```
otel.Tracer(name)            // API: returns a Tracer from the global provider
    │ .Start(ctx, name)
    ▼
TracerProvider               // sdk/trace: holds resource, samplers, processors
    │  consults Sampler at span start (record? export?)
    ▼
Span (recording)             // accumulates attributes/events until End()
    │ .End()
    ▼
SpanProcessor.OnEnd(span)    // BatchSpanProcessor enqueues; SimpleSpanProcessor exports inline
    ▼
SpanExporter.ExportSpans()   // OTLP/stdout: serialize + transmit
    ▼
Collector / backend
```

Three facts a professional internalizes:

1. **The sampler runs at `Start`, not `End`.** The decision to record-and-export is made when the span begins, based on parent context and the configured `Sampler`. A non-recording span is nearly free — attributes set on it are dropped.
2. **`OnEnd` is the hand-off to the processor.** With `BatchSpanProcessor`, `OnEnd` is a non-blocking enqueue. With `SimpleSpanProcessor`, `OnEnd` calls the exporter synchronously — which is why it is unsuitable for production.
3. **The exporter is the only network-touching component.** Everything upstream is in-process. The exporter owns timeouts, retries, and connection lifecycle.

The metrics SDK mirrors this with a different vocabulary: `MeterProvider` → `Reader` (Periodic or manual) → `Exporter`, with aggregation happening in the reader.

---

## TracerProvider Lifecycle and the Provider Registry

### Construction is configuration

`sdktrace.NewTracerProvider(opts...)` is pure setup: it stores the resource, the sampler, and the list of span processors. No goroutines for export start until a processor needs them (`BatchSpanProcessor` starts a background flush goroutine on creation).

### Registration vs explicit passing

There are two ways to make tracers find your provider:

- **Global registry:** `otel.SetTracerProvider(tp)`. Then `otel.Tracer(name)` anywhere returns a tracer backed by `tp`. Convenient; the default style. The catch: until you call it, `otel.Tracer` returns a **no-op** that silently drops everything.
- **Explicit:** pass `tp` (or a `Tracer`) into the code that needs it. More testable, no global state, but more plumbing.

Libraries should use the global so they work regardless of how the app wires up. Applications may use either; mixing the two inconsistently is a classic "half my spans vanished" bug.

### One provider, many tracers

A provider yields many `Tracer` instances keyed by instrumentation name (and optional version/schema). The name identifies *who* produced the span (`go.opentelemetry.io/contrib/.../otelhttp`, `github.com/me/mypkg`). Backends use it to attribute spans to instrumentation scopes. Use a stable, package-level name — typically the import path.

### Shutdown is terminal

`tp.Shutdown(ctx)` flushes and stops all processors, then the provider is dead — further spans go nowhere. It is idempotent and must be called exactly once at process end. `ForceFlush(ctx)` flushes without shutting down, for mid-life flushes (batch jobs, pre-deploy drains).

---

## Inside the BatchSpanProcessor

This is the component whose behavior under load you must understand.

### The data structures

The `BatchSpanProcessor` holds:
- a bounded **queue** (`MaxQueueSize`, default 2048) of finished spans,
- a **batch** assembled from the queue up to `MaxExportBatchSize` (default 512),
- a **timer** (`BatchTimeout`, default 5s) that forces a flush even when the batch is not full,
- an **export timeout** (`ExportTimeout`, default 30s) bounding each `ExportSpans` call.

### The flow

1. `OnEnd(span)` enqueues the finished span — **non-blocking**. If the queue is full, the span is **dropped** and a dropped-spans counter increments. This is the back-pressure design: protect the application, sacrifice telemetry.
2. A background goroutine drains the queue into batches and calls `exporter.ExportSpans(ctx, batch)` either when a batch fills or the timer fires.
3. Export errors are logged (via the OTel error handler) and the batch is dropped — `BatchSpanProcessor` does **not** itself retry; retry lives in the OTLP exporter (below).

### Tuning implications

- **Bursty high-QPS service:** raise `MaxQueueSize` so transient spikes do not overflow, and possibly `MaxExportBatchSize` for throughput.
- **Latency-sensitive freshness (you want spans in the UI fast):** lower `BatchTimeout`.
- **Flaky collector:** the export timeout and the exporter's retry govern resilience; the queue size governs how long you can buffer through an outage before dropping.

### The drop you must monitor

Dropped spans are silent unless you watch for them. Register the OTel error handler and/or scrape the SDK's self-metrics. A service that "lost traces during the incident" usually overflowed its batch queue precisely when traffic spiked — the worst time to be blind.

---

## Exporter Internals: OTLP/gRPC vs OTLP/HTTP

The OTLP exporters are where the network lives.

### Common semantics

Both `otlptracegrpc` and `otlptracehttp`:
- Serialize spans to the OTLP protobuf schema.
- Apply a per-export **timeout** (`WithTimeout`).
- Implement **retry with backoff** for retryable errors (`WithRetry`): transient network failures and `UNAVAILABLE`/`429`-style responses are retried with exponential backoff and a max elapsed time; non-retryable errors (malformed request) are not.
- Support **compression** (gzip) to cut egress.

### gRPC vs HTTP

| | OTLP/gRPC (`otlptracegrpc`) | OTLP/HTTP (`otlptracehttp`) |
|---|---|---|
| Default port | 4317 | 4318 |
| Transport | HTTP/2 + protobuf | HTTP/1.1 + protobuf (or JSON) |
| Streaming/multiplexing | Yes (HTTP/2) | No |
| Proxy/LB friendliness | Needs gRPC-aware infra | Works through any HTTP proxy |
| Typical choice | Service-to-Collector inside the mesh | Edge/constrained environments, simple proxies |

gRPC is the default for in-cluster service→Collector hops; HTTP is the escape hatch where gRPC is inconvenient. Functionally equivalent for the data; differ in operational fit.

### TLS and auth

Production exporters use `WithTLSCredentials` and inject auth (headers, mTLS) toward the Collector. `WithInsecure` is dev-only. The Collector, not the app, typically holds the credentials for the *backend*, which is another reason to export to a Collector rather than directly to a vendor.

---

## The Sampler Interface and Custom Samplers

`Sampler` is a small interface:

```go
type Sampler interface {
    ShouldSample(parameters SamplingParameters) SamplingResult
    Description() string
}
```

`ShouldSample` is called at span `Start` with the parent context, trace ID, span name, kind, and attributes. It returns a decision: `Drop`, `RecordOnly`, or `RecordAndSample`, plus optional trace-state changes.

### Built-in samplers

- `AlwaysSample()` / `NeverSample()` — extremes.
- `TraceIDRatioBased(fraction)` — deterministic ratio keyed on the trace ID, so the decision is consistent wherever the same trace ID appears.
- `ParentBased(root, opts...)` — honor the parent's sampled flag if there is a parent; otherwise apply `root`. The production default: `ParentBased(TraceIDRatioBased(r))`.

### Writing a custom sampler

You might want "always sample `/health` at 0%, errors-prone routes at 100%, everything else at 5%." Implement `ShouldSample` and inspect the parameters:

```go
func (s routeSampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
    if name := p.Name; strings.HasPrefix(name, "GET /health") {
        return sdktrace.SamplingResult{Decision: sdktrace.Drop}
    }
    return s.fallback.ShouldSample(p)
}
```

Two cautions: (1) keep `ShouldSample` cheap — it runs on every span start; (2) attribute-based decisions only see attributes available *at start*, not ones added later. For decisions that need the *outcome* (error, latency), you need **tail sampling in the Collector**, not an SDK sampler — the SDK cannot see the future.

---

## The Metrics SDK: Readers, Aggregations, Temporality

The metrics SDK has subtleties that bite during Prometheus integration.

### Readers

A `Reader` collects aggregated metrics from the SDK:
- **`PeriodicReader`** pulls on a timer and pushes to an exporter (OTLP push model).
- The **Prometheus exporter** is itself a reader that is collected on scrape (pull model).

### Aggregation

Each instrument has a default aggregation: counters → sum, histograms → explicit-bucket histogram, gauges → last value. **Views** override aggregation, bucket boundaries, and attribute sets.

### Temporality — the gotcha

Aggregation **temporality** is *cumulative* (running total since process start) or *delta* (change since last collection).

- **Prometheus expects cumulative** counters (it computes rates itself). The Prometheus exporter uses cumulative temporality.
- Some push backends prefer **delta**. The OTLP exporter's temporality is configurable; the wrong choice produces counters that look reset every cycle or rates that double-count.

Getting temporality wrong is a common, confusing metrics bug — "my request rate graph is sawtoothed" or "my counter keeps resetting." Match temporality to the backend: cumulative for Prometheus, delta only where the backend asks for it.

### Cardinality at the SDK

Views are the SDK-level cardinality control: drop an attribute (`Stream{AttributeFilter: ...}`) so a high-cardinality dimension never becomes thousands of series. This is the cheapest place to fix cardinality — before the data is even exported.

---

## The OpenTelemetry Collector

The Collector is a standalone process that sits between your services and your backends. It is the keystone of a serious deployment.

### Why it exists

- **Decoupling / portability.** Services export OTLP to the Collector; the Collector fans out to Jaeger, Tempo, Prometheus, a vendor. Switching backends is a Collector config change, not a fleet redeploy.
- **Central processing.** Sampling (including **tail** sampling), attribute redaction (PII), batching, filtering, and enrichment happen once, centrally, instead of in every service.
- **Buffering and resilience.** The Collector batches and retries toward backends, absorbing backend outages.
- **Protocol translation.** Receive OTLP; emit Jaeger, Prometheus, Zipkin, vendor formats.

### Pipeline shape

A Collector config is **receivers → processors → exporters**, grouped into pipelines per signal:

```yaml
receivers:
  otlp:
    protocols: { grpc: {}, http: {} }
processors:
  memory_limiter: {}            # protect the Collector from OOM
  tail_sampling:                # keep errors + slow + sample the rest
    policies: [ ... ]
  attributes:                   # redact / hash PII, drop high-cardinality keys
    actions: [ ... ]
  batch: {}                     # batch toward backends
exporters:
  otlp/tempo: { endpoint: tempo:4317 }
  prometheus: { endpoint: 0.0.0.0:9464 }
service:
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, tail_sampling, batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [prometheus] }
```

### Agent vs gateway

A common topology: a Collector **agent** as a sidecar/daemonset close to each service (cheap local OTLP, fast hand-off), forwarding to a Collector **gateway** cluster that does the expensive tail sampling and fan-out. The agent keeps per-service export cheap; the gateway centralizes policy.

The `memory_limiter` processor and the `tail_sampling` decision window are the two things to size carefully — the Collector is a real service with real capacity limits, and an under-provisioned gateway drops data exactly under load.

---

## Graceful Shutdown, Draining, and Signal Handling

The most-lost telemetry is the telemetry of the final requests before a deploy. Correct shutdown ordering prevents that.

```go
func main() {
    ctx := context.Background()

    shutdownTracer, _ := initTracer(ctx)  // returns tp.Shutdown
    shutdownMeter, _ := initMeter(ctx)

    srv := &http.Server{Addr: ":8080", Handler: instrumentedHandler()}
    go srv.ListenAndServe()

    // Wait for SIGTERM/SIGINT.
    stop := make(chan os.Signal, 1)
    signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
    <-stop

    // 1. Stop accepting, drain in-flight requests (their spans complete).
    drainCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    _ = srv.Shutdown(drainCtx)

    // 2. THEN flush telemetry — bounded, so a dead collector can't hang us.
    flushCtx, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel2()
    _ = shutdownTracer(flushCtx)
    _ = shutdownMeter(flushCtx)
}
```

The ordering rules:
1. **Drain the server first** so in-flight requests finish and their spans are enqueued.
2. **Then shut down the providers** so the final batch flushes.
3. **Bound every shutdown context** so an unreachable collector cannot wedge the process (which, in Kubernetes, leads to SIGKILL and *more* lost telemetry).

Reverse this order — shut down providers before draining — and you lose exactly the spans you most want during a rollout: the ones that show whether the new version is healthy.

---

## Performance Profile and Allocation Behavior

Where the cost actually is:

- **A non-recording span (dropped by the sampler) is cheap** — no attribute storage, no enqueue. Sampling reduces cost *before* allocation.
- **A recording span allocates** for its attribute slice, events, and the span object. High-frequency span creation in a hot loop shows up in allocation profiles.
- **`BatchSpanProcessor` enqueue is a channel/ring-buffer op** — cheap and non-blocking.
- **Export is amortized** across a batch and happens off the request path.
- **Metric recording (`Add`/`Record`) is lock-light** but the attribute set passed each call is hashed to find the aggregation series — passing a fresh `[]attribute.KeyValue` each call costs an allocation; precompute attribute sets where hot.

Practical guidance: sample to cut the bulk of span cost; reuse attribute sets in hot paths; never use `WithSyncer` in production; and profile with the same tools as any Go code (`pprof`) to confirm instrumentation is not a hot spot. See [optimize.md](optimize.md) for benchmarks and concrete reductions.

---

## A Fully Wired Production Setup

A complete, realistic initialization — traces and metrics, OTLP to a Collector, proper resource, sampling, propagator, bounded shutdown.

```go
func initObservability(ctx context.Context) (shutdown func(context.Context) error, err error) {
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("checkout"),
			semconv.ServiceVersion(buildVersion),
			semconv.DeploymentEnvironment(env),
		),
		resource.WithHost(), resource.WithProcess(),
	)
	if err != nil {
		return nil, err
	}

	// Traces
	traceExp, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(collectorAddr),
		otlptracegrpc.WithTLSCredentials(creds),
	)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp,
			sdktrace.WithMaxQueueSize(4096),
			sdktrace.WithBatchTimeout(2*time.Second),
		),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.05))),
	)

	// Metrics
	metricExp, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(collectorAddr),
		otlpmetricgrpc.WithTLSCredentials(creds),
	)
	if err != nil {
		return nil, err
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(e error) {
		log.Printf("otel error: %v", e) // surface dropped-span / export errors
	}))

	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}
```

Note the `SetErrorHandler` — without it, export failures and span drops are invisible.

---

## Edge Cases the Source Reveals

- **No-op until registered.** `otel.Tracer`/`otel.Meter` return no-op implementations until `SetTracerProvider`/`SetMeterProvider` run. Code "works" and emits nothing.
- **Sampler sees start-time attributes only.** Attributes added after `Start` cannot influence the sampling decision; outcome-based selection must be tail sampling.
- **`OnEnd` after `Shutdown` is a no-op.** Spans ending after provider shutdown are dropped; ordering of server-drain vs provider-shutdown matters.
- **Batch queue overflow is silent** without the error handler. Always register one.
- **gRPC exporter against an HTTP port (4318)** fails with confusing transport errors; match protocol to port (4317 gRPC / 4318 HTTP).
- **Temporality mismatch** with the backend yields reset-looking counters; cumulative for Prometheus.
- **Resource detectors can block.** `resource.WithHost()`/cloud detectors may do I/O; in constrained environments give them a context with a timeout.
- **`context.WithoutCancel`** is needed to keep a span in a goroutine that must outlive a cancelled request context.
- **Double `span.End()`** is ignored but signals confused ownership; end once.

These are not facts to memorize but pointers to reach for the (small, readable) SDK source when behavior surprises you.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Spans not arriving | Verify `SetTracerProvider` called; exporter endpoint/port (4317/4318); `Shutdown` on exit; check error handler logs. |
| Traces break across services | Set `TraceContext` propagator on both sides; use `otelhttp`/`otelgrpc` for transport/handler. |
| Lost spans under load | Raise `MaxQueueSize`; monitor dropped-span count; ensure `WithBatcher` not `WithSyncer`. |
| Lost spans on deploy | Drain server *before* provider `Shutdown`; bound shutdown context. |
| Metric series explosion | Add a View dropping the high-cardinality attribute; redact in Collector too. |
| Prometheus counters look reset | Set cumulative temporality; use the Prometheus exporter or correct OTLP temporality. |
| Need errors/slow traces kept | Tail sampling in the Collector, not an SDK sampler. |
| PII in telemetry | Redact via Collector `attributes`/`transform` processor; don't record it in the first place. |
| Switch backend | Change the Collector exporter pipeline; services untouched. |
| Collector OOM | Add `memory_limiter`; size the gateway; cap tail-sampling decision window. |
| Verify overhead | Benchmark hot paths with/without instrumentation; profile with `pprof`. |

---

## Summary

At the professional level, OpenTelemetry-Go is a set of subsystems with explicit lifecycles and buffering semantics. Spans are sampled at **start**, accumulate while recording, hand off at **`OnEnd`** to a processor, and leave the process only through an **exporter**. The **`BatchSpanProcessor`** is the component to understand: a bounded queue that drops under overflow to protect the application, a batch assembled by size or timer, exported off the request path. The **OTLP exporters** own timeouts, retries, compression, and TLS, and differ only operationally between gRPC (4317, in-mesh) and HTTP (4318, proxy-friendly). The **metrics SDK** adds readers, aggregations, and the temporality gotcha that must match the backend. The **Collector** is the keystone — receivers → processors → exporters — centralizing tail sampling, redaction, and fan-out, and making the application vendor-neutral.

The two operational details that most often determine whether you actually have telemetry when you need it are **batch-queue sizing** (so you do not drop spans under load) and **shutdown ordering** (drain the server, then flush the providers, with bounded contexts, so you do not lose the final, most-important spans of a deploy). Master the lifecycle and the buffering, register an error handler so failures are visible, and OpenTelemetry becomes a dependable platform rather than a demo that quietly loses data at the worst moment.
