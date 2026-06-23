# OpenTelemetry in Go — Optimization

> Honest framing first: OpenTelemetry instrumentation is a side effect, not the workload. A well-configured pipeline (sampling + batching) adds little to request latency. What is genuinely worth optimizing is the *fidelity-vs-cost* trade: how much you sample, how many attributes and series you produce, how export interacts with the request path, and whether you are collecting telemetry that scales with traffic when it should scale with interestingness. Most "OTel is slow / expensive" complaints trace back to 100% sampling, synchronous export, high cardinality, or per-call allocations — not to the SDK itself.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The closing sections cover measurement and when collecting *less* is the optimization.

---

## Optimization 1 — Batch instead of synchronous export

**Problem:** `WithSyncer` (the `SimpleSpanProcessor`) exports each span on `span.End()` — a network round-trip to the collector on the request hot path. Request latency becomes coupled to collector latency.

**Before:**
```go
tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(otlpExporter))
```
Every span end blocks on an OTLP call; a 5 ms collector RTT adds 5 ms × spans-per-request to every request.

**After:**
```go
tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(otlpExporter))
```
Spans are enqueued (non-blocking) and exported in batches off the request path.

**Expected gain:** Removes export latency from the request entirely. On a request producing 8 spans against a collector with 3 ms RTT, that is ~24 ms of synchronous overhead eliminated per request. `WithSyncer` belongs only in tests and with `stdouttrace`.

---

## Optimization 2 — Sample at the head to cap volume

**Problem:** `AlwaysSample()` (the SDK default) records and exports every trace. At high QPS this is unaffordable in backend cost and unreadable in the UI, and it allocates a recording span (with attributes) for every request.

**Before:**
```go
tp := sdktrace.NewTracerProvider(/* default AlwaysSample */ )
```
10k req/s × 8 spans = 80k spans/s exported and stored.

**After:**
```go
tp := sdktrace.NewTracerProvider(
    sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.05))),
)
```
~5% of root traces are recorded; the rest produce a non-recording span that is nearly free.

**Expected gain:** ~20× reduction in exported spans and backend cost, and a large drop in in-process allocation because non-sampled spans skip attribute storage. The decision is consistent across services (parent-based + trace-ID-keyed), so traces stay whole.

---

## Optimization 3 — Tail-sample the interesting traces in the Collector

**Problem:** Head sampling at 5% keeps a representative slice but misses most errors and slow requests — exactly what you want to look at. Raising the head ratio to catch them re-inflates cost.

**Before:** Head sample at 5%; on-call frequently finds the failing request was not sampled.

**After (Collector `tail_sampling`):**
```yaml
processors:
  tail_sampling:
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
```
Keep 100% of error and slow traces, 5% of the rest.

**Expected gain:** Near-complete coverage of the traces you actually debug, at a fraction of full cost. The SDK still head-samples to cap raw volume; the Collector rescues the interesting traces from the discarded majority.

---

## Optimization 4 — Control metric cardinality with Views

**Problem:** A metric attribute derived from user input (user ID, raw URL, request ID) multiplies time series, OOMing the backend and exploding the bill.

**Before:**
```go
reqs.Add(ctx, 1, metric.WithAttributes(
    attribute.String("user.id", uid),     // millions of series
    attribute.String("url", r.URL.Path),  // unbounded paths
))
```

**After (drop the unbounded dimension at the SDK):**
```go
sdkmetric.NewView(
    sdkmetric.Instrument{Name: "http.requests"},
    sdkmetric.Stream{AttributeFilter: attribute.NewAllowKeysFilter(
        "route", "method", "status")}, // only bounded keys survive
)
// and record route templates, not raw paths:
reqs.Add(ctx, 1, metric.WithAttributes(attribute.String("route", "/users/:id")))
```

**Expected gain:** Series count drops from O(users) to O(routes × methods × statuses) — often from millions to a few thousand. The single biggest lever on metrics cost. Keep unbounded values on spans, not metric dimensions.

---

## Optimization 5 — Precompute attribute sets in hot paths

**Problem:** Building a fresh `[]attribute.KeyValue` and `WithAttributes` option on every metric `Record`/`Add` allocates and re-hashes the attribute set each call. Under high QPS it shows up in allocation profiles.

**Before:**
```go
latency.Record(ctx, elapsed, metric.WithAttributes(
    attribute.String("route", "/checkout"),
    attribute.String("method", "GET"),
    attribute.String("status", "ok"),
))
```

**After (precompute the common combinations):**
```go
var attrOKGet = metric.WithAttributeSet(attribute.NewSet(
    attribute.String("route", "/checkout"),
    attribute.String("method", "GET"),
    attribute.String("status", "ok"),
))
latency.Record(ctx, elapsed, attrOKGet)
```

**Expected gain:** Eliminates per-call attribute allocation and re-hash for the hot combinations. Measurable in `allocs/op` on a benchmark of the recording path; meaningful on services doing tens of thousands of records per second.

---

## Optimization 6 — Tune the batch processor for your traffic shape

**Problem:** The default batch queue (2048) overflows during traffic spikes, silently dropping spans exactly when you most want them. Or, conversely, a too-long `BatchTimeout` delays spans from appearing in the UI.

**Before:**
```go
sdktrace.WithBatcher(exp) // defaults: queue 2048, batch 512, timeout 5s
```
A burst to 50k spans/s overflows the queue; drops are invisible.

**After (size for QPS and freshness):**
```go
sdktrace.WithBatcher(exp,
    sdktrace.WithMaxQueueSize(8192),     // absorb bursts
    sdktrace.WithMaxExportBatchSize(1024),
    sdktrace.WithBatchTimeout(2*time.Second), // fresher in the UI
)
otel.SetErrorHandler(otel.ErrorHandlerFunc(func(e error){ log.Print(e) }))
```

**Expected gain:** Far fewer dropped spans under load, with a visible signal when drops do happen. The right queue size is workload-specific — size it from peak spans/s × tolerated buffering window.

---

## Optimization 7 — Instrument boundaries, not every function

**Problem:** Hand-writing a span around every function produces deep, noisy traces, multiplies span volume and allocation, and obscures the few spans that matter.

**Before:** A span in every helper — `validate`, `parse`, `mapDTO`, `lookup`, `format` — yielding 40-span traces dominated by trivia.

**After:** Let contrib middleware span the boundaries (inbound request, outbound calls, DB queries) and hand-write spans only for business-meaningful steps:
```go
http.Handle("/checkout", otelhttp.NewHandler(h, "checkout")) // server boundary
// inside: one span for the meaningful step
ctx, span := tracer.Start(ctx, "fraud-check")
defer span.End()
```

**Expected gain:** Smaller traces, lower span volume and cost, and far more readable waterfalls. You keep ~80% of the diagnostic value (boundaries + key steps) at a fraction of the span count.

---

## Optimization 8 — Compress and co-locate export with a Collector agent

**Problem:** Exporting OTLP directly from each service to a remote backend pays per-span TLS/RTT cost over a long network path, and couples the service to the backend.

**Before:**
```go
otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint("vendor.example.com:4317"))
```
Long-haul export from every service; no compression configured.

**After (local agent + compression):**
```go
otlptracegrpc.New(ctx,
    otlptracegrpc.WithEndpoint("localhost:4317"), // Collector agent sidecar/daemonset
    otlptracegrpc.WithCompressor("gzip"),
)
```
The service ships to a local Collector agent cheaply; the agent batches, compresses, and forwards to the gateway/backend.

**Expected gain:** Cheap local hand-off keeps export off the long network path, gzip cuts egress bytes, and the service is decoupled from the backend (portability bonus). The expensive long-haul transmission is amortized and batched by the agent, not paid per service per span.

---

## Optimization 9 — Right-size histogram buckets

**Problem:** Default histogram bucket boundaries may not match your latency distribution (e.g. seconds-scale buckets for a microsecond service), so percentiles are meaningless and you may carry buckets you never populate.

**Before:** Default boundaries; p99 lands in one giant bucket — no useful resolution.

**After (boundaries matched to the service via a View):**
```go
sdkmetric.NewView(
    sdkmetric.Instrument{Name: "http.server.duration_seconds"},
    sdkmetric.Stream{Aggregation: sdkmetric.AggregationExplicitBucketHistogram{
        Boundaries: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
    }},
)
```

**Expected gain:** Accurate, actionable percentiles and a bucket set sized to your data (fewer empty series). Consider an exponential/base-2 histogram if your backend supports it for automatic bucketing.

---

## Optimization 10 — Don't span health checks and noisy routes

**Problem:** Liveness/readiness probes and high-frequency low-value routes generate a flood of identical spans that crowd out real traffic and cost money.

**Before:** `/health` is hit every second by the orchestrator; each produces a sampled span.

**After (drop them with a custom sampler):**
```go
func (s sampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
    if strings.HasPrefix(p.Name, "GET /health") || strings.HasPrefix(p.Name, "GET /metrics") {
        return sdktrace.SamplingResult{Decision: sdktrace.Drop}
    }
    return s.fallback.ShouldSample(p)
}
```

**Expected gain:** Removes a constant background of useless spans (often a large fraction of total span volume in a low-traffic service), reducing cost and noise without losing any real signal.

---

## Optimization 11 — Verify hermetic/offline export with `GOPROXY`-style guards

**Problem:** Teams claim "we sample/export correctly" but never verify; a misconfigured endpoint silently drops everything, or a stray import bypasses the configured pipeline.

**Before:** Assume telemetry arrives; discover during an incident that none has for weeks.

**After (assert in CI / smoke test):**
```go
// Integration test: run an in-memory exporter, exercise a request,
// assert the expected spans/metrics were produced.
exp := tracetest.NewInMemoryExporter()
tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
// ... drive the handler ...
spans := exp.GetSpans()
require.Len(t, spans, expected)
require.Equal(t, "checkout", spans[0].Name)
```

**Expected gain:** Telemetry becomes a tested contract rather than an assumption. Regressions (a refactor that drops the propagator or breaks context threading) are caught in CI, not in production.

---

## Optimization 12 — Push expensive processing to the Collector, not the app

**Problem:** Doing redaction, filtering, and complex sampling in every service spends CPU on the request path and forces a redeploy to change policy.

**Before:** Each service runs custom attribute redaction and per-route sampling logic inline.

**After (centralize in the Collector):**
```yaml
processors:
  attributes:
    actions:
      - key: user.email
        action: delete
      - key: http.url
        action: hash
  tail_sampling: { policies: [ ... ] }
```
Services emit raw OTLP; the Collector redacts, filters, and samples once for everyone.

**Expected gain:** Less per-request CPU in services, and policy changes (new redaction rule, new sampling ratio) become a Collector config change applied fleet-wide without redeploying any service.

---

## Optimization 13 — Reuse tracers and meters; avoid per-call lookups

**Problem:** Calling `otel.Tracer("name")` or `otel.Meter("name")` and creating instruments inside a hot function repeats lookups and instrument construction unnecessarily.

**Before:**
```go
func handle(ctx context.Context) {
    c, _ := otel.Meter("svc").Int64Counter("requests") // built every call
    c.Add(ctx, 1)
}
```

**After (construct once, reuse):**
```go
var (
    tracer    = otel.Tracer("svc")
    requests, _ = otel.Meter("svc").Int64Counter("requests")
)
func handle(ctx context.Context) {
    _, span := tracer.Start(ctx, "handle")
    defer span.End()
    requests.Add(ctx, 1)
}
```

**Expected gain:** Removes repeated tracer/meter resolution and instrument creation from the hot path. Small per call, but it adds up and keeps the recording path lean.

---

## Optimization 14 — Correlate signals instead of duplicating them

**Problem:** Teams log verbosely *and* span verbosely *and* emit fine-grained metrics for the same events — paying three times for overlapping information, with no link between them.

**Before:** Every request emits a detailed span, a detailed log line per step, and several high-cardinality metrics — all describing the same flow.

**After (one of each, correlated):**
- One sampled trace for the request flow.
- Structured logs that carry the `trace_id`/`span_id` (so they join the trace), emitted at the right level, sampled.
- Low-cardinality metrics for health/SLOs, with **exemplars** linking p99 buckets to example traces.

**Expected gain:** Less total telemetry volume and lower cost, with *more* investigative power because the three signals are linked by trace ID rather than collected redundantly. The optimization is collecting *less but correlated*, not more.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. The useful signals for OTel:

```go
// Microbenchmark the instrumented path vs no-op vs sampled-out.
func BenchmarkHandler(b *testing.B) {
    // variant A: no SetTracerProvider (no-op)
    // variant B: NeverSample()
    // variant C: AlwaysSample() + batch to a discarding exporter
    for i := 0; i < b.N; i++ { handle(ctx) }
}
```

```bash
go test -bench=Handler -benchmem   # ns/op and allocs/op per variant
go test -cpuprofile cpu.out -bench=Handler && go tool pprof cpu.out
```

System-level signals to track over time:
- **Spans/sec and active metric series** exported (cost drivers).
- **Dropped-span count** from the batch processor (overflow = under-provisioned).
- **Request p99 with and without instrumentation** (overhead).
- **Backend ingest/storage bill** (the usual dominant cost).
- **Collector CPU/memory and tail-sampling decision-cache size**.

A "vendor optimization" that does not move spans/sec, series count, or the bill is not an optimization. Pay special attention to two numbers: backend cost (the headline expense) and request-path overhead (the headline risk).

---

## When to Collect Less (the Real Optimization)

The biggest wins are usually subtractive.

- **Sample aggressively at the head; rescue the interesting traces with tail sampling.** Telemetry should scale with errors and latency, not with successful traffic.
- **Keep metric dimensions bounded.** No user IDs, request IDs, raw URLs, or error strings as metric attributes — that is the cardinality bill.
- **Instrument boundaries and meaningful steps, not every function.** Depth is noise.
- **Don't span health checks and trivial high-frequency routes.**
- **Correlate signals instead of triplicating them.** One trace + correlated structured logs + low-cardinality metrics beats three verbose, disconnected streams.
- **Push redaction and sampling into the Collector** so the app path stays cheap and policy is central.

A service whose telemetry cost grows linearly with successful requests is over-collecting. The most effective optimization is almost always to collect *less, but better-chosen and correlated*, telemetry.

---

## Summary

OpenTelemetry-Go is not slow; mis-configuration and over-collection are. The wins come from treating instrumentation as a tuned pipeline: **batch** instead of synchronous export to get it off the request path; **head-sample** to cap volume and skip allocating non-recording spans; **tail-sample in the Collector** to keep every error and slow trace; **control cardinality** with Views and route templates so metric series stay bounded; **precompute attribute sets** and **reuse tracers/meters** in hot paths; **size the batch queue** for your traffic and watch the dropped-span count; **instrument boundaries** rather than every function; and **push expensive processing to the Collector** so the app stays cheap and policy stays central.

But the largest optimization is upstream of all the knobs: decide what telemetry you actually need. Telemetry should scale with *interestingness*, not with *traffic*. Sample the boring majority, keep the interesting minority, bound your cardinality, and correlate the three signals instead of collecting them redundantly. Measure spans/sec, series count, dropped spans, request overhead, and the bill — and let those numbers, not habit, drive every change.
