# OpenTelemetry in Go — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end.

---

## Easy

### Task 1 — First span to stdout

Create a module `example.com/otel-demo`. Wire up a `TracerProvider` with the `stdouttrace` exporter (`WithPrettyPrint`), register it globally, and `defer Shutdown`. In `main`, start a span `"hello"`, start a child span `"world"` inside a function using the returned `ctx`, end both.

```bash
go get go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/exporters/stdout/stdouttrace
```

Success: two JSON spans print; `world` has a `Parent` whose span ID equals `hello`'s, both sharing one `TraceID`.

**Goal.** See that context threading is what nests spans.

---

### Task 2 — Break the nesting on purpose

Take Task 1 and pass `context.Background()` to the child function instead of the `ctx` returned by `Start`. Run again.

Observe: `world` is now a separate trace with no parent and a *different* trace ID.

**Goal.** Internalize that the parent link lives in `context.Context`.

---

### Task 3 — Prove that missing `Shutdown` loses spans

Remove the `defer tp.Shutdown(ctx)` line. Run the program. Then add it back and run again.

Observe: with `WithBatcher`, removing `Shutdown` often prints nothing (the batch never flushed). With it, the spans appear.

**Goal.** Understand why `Shutdown` is mandatory with batching.

---

### Task 4 — Set the resource

Add a resource with `semconv.ServiceName("otel-demo")` and `semconv.ServiceVersion("0.1.0")` to the provider. Re-run and inspect the JSON.

Observe: the `Resource` block now shows your `service.name`; without it, a backend would show `unknown_service`.

**Goal.** Always identify your service.

---

### Task 5 — Record an error correctly

In a span, simulate a failure. Call `span.RecordError(err)` and `span.SetStatus(codes.Error, "boom")`. Inspect the JSON. Then remove the `SetStatus` line and inspect again.

Observe: `RecordError` adds an error *event*; only `SetStatus` flips the span's `Status` to `Error`.

**Goal.** Learn the two-call error pattern.

---

## Medium

### Task 6 — Instrument an HTTP server

Build a `net/http` server with one handler. Wrap it with `otelhttp.NewHandler(h, "root")`. Inside the handler, use `r.Context()` to start a child span `"work"`. Switch the exporter to `otlptracegrpc` pointing at `localhost:4317`, and run a Jaeger all-in-one container:

```bash
docker run -d --name jaeger -p 16686:16686 -p 4317:4317 \
  jaegertracing/all-in-one:latest
```

Hit the endpoint, then open `http://localhost:16686` and find your trace.

Success: a server span `root` with a child `work` appears in Jaeger.

**Goal.** Get a real trace into a real UI.

---

### Task 7 — Propagate across two services

Run two small services, A and B. A's handler makes an outbound call to B using:

```go
client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
```

Set `otel.SetTextMapPropagator(propagation.TraceContext{})` in both. B is wrapped with `otelhttp.NewHandler`. Send a request to A.

Success: A's and B's spans appear in **one** trace in Jaeger. Then delete the propagator line in A and observe the trace break into two.

**Goal.** See W3C Trace Context propagation make/break a distributed trace.

---

### Task 8 — Add metrics: a counter and a histogram

Set up a `MeterProvider` with an OTLP metric exporter (or the Prometheus exporter). Create an `Int64Counter("http.requests")` and a `Float64Histogram("http.duration_seconds")`. In the handler, increment the counter with a `result` attribute and record the request duration.

Success: the counter and histogram show up in your metrics backend (or at `/metrics` with the Prometheus exporter).

**Goal.** Wire the metrics signal alongside traces.

---

### Task 9 — Observable gauge for queue depth

Create a channel-backed worker queue. Register an `Int64ObservableGauge("worker.queue_depth")` with a callback that observes `len(queue)` each collection cycle. Push and pop items.

Success: the gauge reflects the live queue length over time.

**Goal.** Use an asynchronous instrument for a sampled value.

---

### Task 10 — Configure sampling

Set the sampler to `ParentBased(TraceIDRatioBased(0.5))`. Generate 20 root requests and count how many traces reach the backend (~10). Then send requests that carry an incoming `traceparent` with the sampled flag set and observe they are always kept regardless of the local ratio.

**Goal.** Understand head sampling and parent-based consistency.

---

## Hard

### Task 11 — Goroutine that outlives the request

In a handler, launch a background goroutine that does slow work and should produce its own span. First pass the request `ctx` directly — observe the goroutine's span is cut short when the handler returns (the request ctx is cancelled). Then use `context.WithoutCancel(ctx)` and observe the span completes while staying in the same trace.

**Goal.** Solve the request-cancellation-vs-span-link problem.

---

### Task 12 — Hermetic Docker build + run with a Collector

Write a `docker-compose.yml` with your service, an `otel/opentelemetry-collector` configured to receive OTLP and export to Jaeger, and Jaeger. Point your service's exporter at the Collector, not Jaeger directly.

Success: traces flow app → Collector → Jaeger. Then change *only* the Collector config to also export to a second backend (e.g. add a logging exporter) without touching the app.

**Goal.** Experience the Collector as the portability seam.

---

### Task 13 — Tail sampling in the Collector

Configure the Collector's `tail_sampling` processor with two policies: keep 100% of traces containing an error span, and 10% of the rest. Make your service randomly error ~5% of requests. Send 200 requests.

Success: every errored trace is kept; roughly 10% of successful traces are kept.

**Goal.** See outcome-based sampling that the SDK alone cannot do.

---

### Task 14 — Cardinality blow-up and fix

Add `attribute.String("user.id", uid)` to your request **metric** counter, with a unique uid per request. Send 1,000 requests and look at the metric series count in your backend (it explodes). Then add an SDK **View** that drops `user.id` from that instrument, or move the attribute to the **span** instead. Re-measure.

**Goal.** Feel a cardinality incident and the standard fixes.

---

### Task 15 — Correct shutdown ordering

Add SIGTERM handling. Implement: stop accepting, `srv.Shutdown(drainCtx)` to drain in-flight requests, *then* `tp.Shutdown(flushCtx)` and `mp.Shutdown(flushCtx)` with bounded timeouts. Send a slow request, then SIGTERM the process mid-request.

Success: the in-flight request finishes and its span is exported. Reverse the order (shut down providers first) and observe the final span is lost.

**Goal.** Build deploy-safe shutdown that never loses the last spans.

---

## Bonus / Stretch

### Task 16 — Correlate logs with traces

Use `slog` with a custom handler (or the OTel `slog` bridge) that pulls `trace_id` and `span_id` from the active span and adds them to every log line. Emit a log inside a span.

Success: the log record carries the same trace ID you can search by in your trace UI.

**Goal.** Build the traces↔logs correlation bridge.

---

### Task 17 — Custom sampler for `/health`

Implement a `Sampler` that drops all spans named `GET /health` and delegates everything else to `ParentBased(TraceIDRatioBased(0.1))`. Verify health checks never appear in the backend while real traffic is sampled.

**Goal.** Write a `ShouldSample` and understand it sees only start-time data.

---

### Task 18 — gRPC instrumentation

Build a gRPC client/server pair. Add the `otelgrpc` stats handler (or interceptors) to both, set the propagator, and call across them.

Success: the gRPC client and server spans join into one trace with correct `Client`/`Server` span kinds.

**Goal.** Instrument the other major boundary protocol.

---

### Task 19 — Prometheus exporter end to end

Swap your metric pipeline to the `exporters/prometheus` exporter and serve `/metrics` with `promhttp.Handler()`. Scrape it with a local Prometheus. Confirm your `http.requests` counter shows up as `http_requests_total` (note the rename and cumulative temporality).

**Goal.** See the OTel→Prometheus naming/temporality bridge.

---

### Task 20 — Overhead benchmark

Write a `go test -bench` that calls an instrumented function path with (a) no SDK installed (no-op tracer), (b) the SDK with `NeverSample()`, and (c) the SDK with `AlwaysSample()` + a batch processor pointed at a discarding exporter. Compare ns/op and allocs/op.

**Goal.** Quantify instrumentation overhead and prove sampling cuts it before allocation.

---

## Solutions (sketched)

### Solution 1
```go
exp, _ := stdouttrace.New(stdouttrace.WithPrettyPrint())
tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp),
    sdktrace.WithResource(resource.NewWithAttributes(
        semconv.SchemaURL, semconv.ServiceName("otel-demo"))))
otel.SetTracerProvider(tp)
defer tp.Shutdown(context.Background())
ctx, span := otel.Tracer("main").Start(context.Background(), "hello")
child(ctx)
span.End()
```
`child` must start its span from the passed `ctx`.

### Solution 2
Passing `context.Background()` discards the parent span context → a new root trace. The fix is always threading the `ctx` from `Start`.

### Solution 3
With `WithBatcher`, spans buffer and are only flushed by the timer or `Shutdown`. A program that exits before the timer fires loses them unless `Shutdown` runs.

### Solution 4
`resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName(...), semconv.ServiceVersion(...))`. Without a resource the backend labels spans `unknown_service:<binary>`.

### Solution 5
`RecordError` → an `exception` event; `SetStatus(codes.Error, ...)` → `Status.Code = Error`. Production code does both.

### Solution 6
`http.Handle("/", otelhttp.NewHandler(handler, "root"))`; inside, `otel.Tracer("svc").Start(r.Context(), "work")`. Jaeger all-in-one listens for OTLP on 4317.

### Solution 7
Both services: `otel.SetTextMapPropagator(propagation.TraceContext{})`. A uses `otelhttp.NewTransport`; B uses `otelhttp.NewHandler`. Drop the propagator and the `traceparent` header is never injected → two traces.

### Solution 8
```go
m := otel.Meter("svc")
reqs, _ := m.Int64Counter("http.requests")
dur, _  := m.Float64Histogram("http.duration_seconds")
reqs.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "ok")))
dur.Record(ctx, elapsed.Seconds())
```

### Solution 9
```go
g, _ := m.Int64ObservableGauge("worker.queue_depth")
m.RegisterCallback(func(_ context.Context, o metric.Observer) error {
    o.ObserveInt64(g, int64(len(queue))); return nil
}, g)
```

### Solution 10
`sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.5)))`. Root traces are kept ~50%; an incoming sampled `traceparent` is honored regardless because `ParentBased` respects the parent flag.

### Solution 11
`go worker(context.WithoutCancel(ctx))` keeps the span (and trace ID) but strips the request's cancellation/deadline, so the background span completes.

### Solution 12
Collector `otlp` receiver → `otlp`/`jaeger` exporter. Adding a second backend is a new exporter + pipeline entry in the Collector YAML; the app's exporter still points only at the Collector.

### Solution 13
```yaml
processors:
  tail_sampling:
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }
```

### Solution 14
Per-request `user.id` on a metric multiplies series by user count. Fix: SDK `View` with an `AttributeFilter` dropping `user.id`, or record `user.id` on the span (one record per trace) instead of the metric.

### Solution 15
Order: `srv.Shutdown(drainCtx)` first (drain), then `tp.Shutdown(flushCtx)` / `mp.Shutdown(flushCtx)`, each with `context.WithTimeout`. Reversed order drops the final requests' spans because the provider is already terminal.

### Solution 16
A `slog.Handler` that reads `trace.SpanContextFromContext(ctx)` and adds `slog.String("trace_id", sc.TraceID().String())`. Now logs and traces join by trace ID.

### Solution 17
Implement `ShouldSample`: if `p.Name == "GET /health"` return `Decision: Drop`; else delegate to the wrapped `ParentBased` sampler. Remember it only sees start-time attributes.

### Solution 18
`grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))` and `grpc.NewClient(..., grpc.WithStatsHandler(otelgrpc.NewClientHandler()))`, plus the propagator. Spans join with `SpanKindClient`/`SpanKindServer`.

### Solution 19
`promexp, _ := prometheus.New(); mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(promexp))`; serve `promhttp.Handler()`. `http.requests` → `http_requests_total` (cumulative).

### Solution 20
Expect: no-op tracer ≈ a few ns and 0 allocs; `NeverSample` similar (decision made before allocation); `AlwaysSample` + batch shows the real recording-span allocation cost. Confirms sampling cuts cost upstream of allocation.

---

## Checkpoints

After the easy tasks: you can wire a provider, create nested spans, set a resource, record errors, and explain why `Shutdown` matters.
After the medium tasks: you can instrument HTTP servers and clients, propagate a distributed trace, add metrics (sync and observable), and configure sampling.
After the hard tasks: you can handle goroutine context correctly, run a Collector pipeline, tail-sample by outcome, diagnose and fix cardinality, and ship deploy-safe shutdown.
After the bonus tasks: you can correlate logs with traces, write a custom sampler, instrument gRPC, bridge to Prometheus, and benchmark instrumentation overhead.
