# OpenTelemetry in Go — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is OpenTelemetry, and what are its three signals?

**Model answer.** OpenTelemetry (OTel) is a vendor-neutral standard and set of SDKs for producing observability data and shipping it to any backend. Its three signals are **traces** (spans showing how a request flows across services), **metrics** (numeric measurements aggregated over time — counts, latencies), and **logs** (structured records, correlatable to traces by trace ID). You instrument once with OTel and can send the data to Jaeger, Tempo, Prometheus, Datadog, or any OTLP backend.

**Common wrong answers.**
- "It's a tracing UI / backend." (No — Jaeger/Tempo are the UI; OTel produces the data.)
- "It replaces logging." (No — it complements logs with traces and metrics.)
- "It's the same as `runtime/trace`." (No — that's in-process scheduler tracing; OTel is cross-service.)

**Follow-up.** *Can you adopt the signals independently?* — Yes; most teams start with traces or metrics and add the others later.

---

### Q2. What is a span, and what is a trace?

**Model answer.** A **span** is a single timed operation: a name, start and end times, attributes, a status, and a parent. A **trace** is a tree of spans that share one **trace ID** — the complete story of one request across functions and services. When a parent operation calls a child and passes context, the child's span shares the trace ID and records the parent, building the tree.

**Follow-up.** *Where do span names vs values go?* — Names are low-cardinality operation labels; dynamic values (IDs, amounts) go in attributes.

---

### Q3. Why does `tracer.Start` return a new `context.Context`?

**Model answer.** The active span lives inside `context.Context`. `Start` returns a new `ctx` carrying the just-created span, and you must pass *that* `ctx` to nested calls so their spans become children. If you pass the original `ctx` or a fresh `context.Background()`, the child spans orphan into separate traces. Context threading is the mechanism that connects spans.

**Common wrong answer.** "It returns ctx for cancellation." (Not the point here — it carries the span.)

**Follow-up.** *What's the idiomatic pattern?* — `ctx, span := tracer.Start(ctx, "name"); defer span.End()`, shadowing `ctx` so you naturally pass the right one.

---

### Q4. What does the `stdouttrace` exporter do, and why is it useful?

**Model answer.** It serializes spans to JSON and writes them to a writer (stdout by default). It is useful for learning and debugging because you can see real spans without running any backend. You swap it for `otlptracegrpc` later with no other code change — that's the benefit of the vendor-neutral design.

**Follow-up.** *Name a production exporter.* — `otlptracegrpc` (OTLP over gRPC, port 4317) or `otlptracehttp` (port 4318).

---

### Q5. Why must you call `Shutdown` before the program exits?

**Model answer.** In production you use a `BatchSpanProcessor` that buffers spans and exports them in batches. When the program exits, some spans may still be in the buffer. `provider.Shutdown(ctx)` flushes them. Skip it and the last batch of every run is silently lost. Always `defer` it, ideally with a bounded timeout so a dead collector can't hang shutdown.

**Follow-up.** *What about metrics?* — The `MeterProvider` also buffers; shut it down too.

---

## Middle

### Q6. Explain the API/SDK split and why libraries depend only on the API.

**Model answer.** OpenTelemetry-Go is two layers. The **API** (`go.opentelemetry.io/otel`, `.../trace`, `.../metric`) defines interfaces and a no-op implementation. The **SDK** (`.../sdk/trace`, `.../sdk/metric`) is the real implementation you wire up in `main`. Libraries import **only the API** and call `otel.Tracer(...).Start(...)`. If the application installs an SDK (`otel.SetTracerProvider`), those calls produce real spans; if not, they hit the no-op and cost almost nothing. This is why you can use an instrumented library without being forced into a backend.

**Common wrong answer.** "Libraries should configure the SDK so they work out of the box." (No — that imposes a backend and fights the app's own setup.)

**Follow-up.** *What happens if a library imports the SDK directly?* — It conflicts with the application's provider; you get duplicate or diverging pipelines.

---

### Q7. How do two services end up in the same trace?

**Model answer.** Context propagation via **W3C Trace Context**. The calling service injects a `traceparent` header (and `tracestate`) into the outbound request — `otelhttp.NewTransport` or the `otelgrpc` interceptor does this automatically, *provided a propagator is set* (`propagation.TraceContext{}`). The receiving service extracts the header — `otelhttp.NewHandler` / `otelgrpc` interceptor — and continues the same trace, sharing the trace ID. Both sides must set the propagator; the default global propagator is a no-op.

**Follow-up.** *What's in `traceparent`?* — version, trace ID, parent span ID, and trace flags (including the sampled bit).

---

### Q8. What are the metric instrument types?

**Model answer.** Synchronous: **Counter** (monotonic, only goes up — request count), **UpDownCounter** (goes up and down — active connections, queue depth), **Histogram** (distributions — latency). Asynchronous (observable, recorded via a callback the SDK invokes on collection): **Observable Counter / UpDownCounter / Gauge** (sampled values — current CPU, in-memory cache size). Synchronous instruments record inline at the event; observable ones poll a callback.

**Follow-up.** *When do you use an observable gauge vs recording in code?* — Observable for values you can sample at collection time (queue length) rather than at an event.

---

### Q9. What's the difference between `ParentBased(TraceIDRatioBased(0.1))` and a plain `TraceIDRatioBased(0.1)`?

**Model answer.** `TraceIDRatioBased(0.1)` keeps ~10% of traces, deciding deterministically from the trace ID. `ParentBased(...)` wraps it so that if a span has a parent (an upstream service already decided), it honors the parent's sampled flag; only for root spans does it apply the 10% ratio. `ParentBased` is the production default because it keeps whole traces intact across the fleet — without it, services could make inconsistent decisions and produce partial traces.

**Follow-up.** *Why is the trace-ID-based decision important?* — It's deterministic, so every service computing it on the same trace ID agrees.

---

### Q10. `RecordError` vs `SetStatus` — what's the difference and why use both?

**Model answer.** `span.RecordError(err)` adds an *event* to the span containing the error message and (optionally) a stack. It does **not** change the span's status. `span.SetStatus(codes.Error, "msg")` marks the span as failed (red in the UI). Use both, in order: record the error for detail, set the status so alerting and the UI treat the span as an error. A common bug is calling only `RecordError`, leaving the span green even though it failed.

**Follow-up.** *Does an HTTP 500 auto-set error status?* — `otelhttp` sets server-error status by convention, but for your own logic you set it explicitly.

---

### Q11. Why should you never use `WithSyncer` (SimpleSpanProcessor) in production?

**Model answer.** `WithSyncer` installs a `SimpleSpanProcessor` that exports each span *synchronously* when it ends — a network call on the span's `End`, on the request path. Under load this serializes requests behind the exporter and couples request latency to collector latency. `WithBatcher` (the `BatchSpanProcessor`) buffers spans and exports in batches off the request path, dropping spans on overflow rather than blocking. Production uses `WithBatcher`; `WithSyncer` is for tests and `stdouttrace`.

**Follow-up.** *What happens to spans when the batch queue is full?* — They're dropped (and a counter increments); the request is never blocked.

---

### Q12. How do OpenTelemetry metrics relate to Prometheus?

**Model answer.** Two paths. (1) The **Prometheus exporter** (`exporters/prometheus`) registers the OTel `MeterProvider` so Prometheus scrapes a `/metrics` endpoint — pull model, cumulative temporality. (2) **OTLP → Collector → Prometheus**: the app pushes OTLP metrics to a Collector, whose `prometheus` exporter exposes them for scraping or `prometheusremotewrite` pushes to a Prometheus-compatible store. Use the direct exporter for minimal moving parts when you already run Prometheus; use OTLP+Collector for one uniform pipeline across all signals. Note OTel dotted names get rewritten to Prometheus conventions (`checkout.requests` → `checkout_requests_total`).

**Follow-up.** *Why does temporality matter here?* — Prometheus expects cumulative counters; delta temporality makes counters look like they reset.

---

## Senior

### Q13. How would you design a sampling strategy for a high-QPS fleet?

**Model answer.** Combine head and tail sampling. **Head sampling** in the SDK (`ParentBased(TraceIDRatioBased(r))` at a low ratio like 1–5%) caps volume at the source and keeps the decision consistent across services. **Tail sampling** in the Collector then *additionally* keeps 100% of error traces and slow (high-latency) traces, plus the head-sampled baseline. Head sampling can't prefer errors/slow because it decides before the outcome is known; tail sampling can, because it sees the whole assembled trace. The result: you pay for a small fraction of normal traffic but never miss the interesting traces.

**Common wrong answer.** "Sample 100% so we never miss anything." (Unaffordable and unreadable at scale.)

**Follow-up.** *Why must sampling be consistent across a trace?* — Otherwise one service keeps a span and another drops it, producing partial, misleading traces.

---

### Q14. Cardinality — why is it the silent killer, and how do you control it?

**Model answer.** Every unique combination of attribute values on a **metric** creates a separate time series. Bounded dimensions (route template, method, status, region) are fine. Add an unbounded one (user ID, request ID, raw URL, error string) and you multiply series into the millions — OOMing the backend and exploding the bill. For traces, high-cardinality attributes inflate storage and slow queries. Control it: keep unbounded values on **spans** (one record per trace, bounded) not metric dimensions; use **Views** at the SDK to drop attributes; use Collector **processors** to strip/hash centrally; and flag any metric attribute derived from user input in code review.

**Follow-up.** *Where's the cheapest place to fix it?* — At the SDK via a View, before the data is even exported.

---

### Q15. How does OpenTelemetry help you avoid vendor lock-in, and how can you lose that benefit?

**Model answer.** OTel's promise is portability: instrument once with the standard API and semantic conventions, and the *exporter/Collector* — not your code — talks to a specific backend. You preserve it by (1) instrumenting with OTel, not a vendor agent; (2) writing dashboards/alerts against semantic conventions, not proprietary fields; (3) exporting to a **Collector**, so switching backends is a Collector config change rather than a fleet redeploy. You lose it by exporting OTLP directly to a vendor from every service (destination hard-coded across the fleet), by using vendor-specific attributes, or by hand-rolling instrumentation that drifts from conventions.

**Follow-up.** *How would you evaluate a new backend with zero risk?* — Add it as a second exporter in the Collector pipeline and run both in parallel.

---

### Q16. Contrast OpenTelemetry with `runtime/trace`. When do you use each?

**Model answer.** They answer different questions. **OpenTelemetry** is cross-service, always-on, exported observability: "where does this request spend time across services?", "what's our p99 and error rate?", "which downstream is slow?" **`runtime/trace`** (with `go tool trace`) is single-process, on-demand, deep scheduler/runtime profiling: "why is *this* process GC-thrashing / blocking on a mutex / starving Ps?" They're complementary: an OTel trace tells you *which service and span* is slow; turning on `runtime/trace` (or a CPU profile) on that service tells you *why, inside the process*. Using one when you needed the other wastes hours.

**Follow-up.** *Would you run `runtime/trace` always-on in production?* — No; it's a heavyweight, on-demand diagnostic. OTel is the always-on layer.

---

### Q17. How do you correlate traces, metrics, and logs?

**Model answer.** Three mechanisms. **Traces↔logs:** inject trace ID and span ID into structured log records (an `slog` handler / logging bridge) so "logs for this trace" and "trace for this log" are one query/click. **Traces↔metrics:** **exemplars** attach a trace ID to a specific histogram bucket sample, so a p99 spike on a dashboard links to an example slow trace. **Shared resource:** all three carry the same `service.name`/`version`/`environment`, so they join in the backend. Designing for correlation up front turns three data streams into one investigative surface.

**Follow-up.** *What's the bridge from "dashboard is red" to "this exact request"?* — Exemplars.

---

### Q18. You deploy a new version and the first requests' traces are missing. Why?

**Model answer.** Almost certainly a **shutdown ordering** problem on the *old* pod, or a startup race on the new one. The classic cause: on SIGTERM the process shut down the `TracerProvider` *before* draining in-flight requests, so the final requests' spans were dropped (provider already terminal); or it didn't bound the shutdown context, hung, and got SIGKILLed, losing the buffered batch. Correct order: stop accepting and **drain the server first**, **then** shut down providers, with **bounded timeouts**. On startup, ensure the provider is registered before the server starts serving, or early requests hit the no-op tracer.

**Follow-up.** *Why bound the shutdown context?* — A dead collector can otherwise make `Shutdown` hang until Kubernetes SIGKILLs you, losing more telemetry.

---

## Staff / Architect

### Q19. Design the observability architecture for a 30-service platform adopting OpenTelemetry.

**Model answer.** Collector-first, shared-module, governed.

**Topology.** Each service exports OTLP to a local Collector **agent** (sidecar/daemonset) for cheap hand-off; agents forward to a Collector **gateway** cluster that does tail sampling, PII redaction, batching, and fan-out to backends (e.g. Tempo for traces, a Prometheus-compatible store for metrics, a log store). Backends sit behind the gateway, so switching them is gateway config.

**Adoption.** Ship a shared internal instrumentation module that sets resource (`service.name`/version/env), propagator, OTLP exporter to the agent, sane sampling, and the error handler — so a service adopts OTel by importing one package. Instrument boundaries with contrib libraries first, then enrich.

**Governance.** Pin one `semconv` version org-wide; register custom attributes; sampling and redaction policy live in the gateway (changeable centrally); cardinality reviewed in CI.

**Cost.** Metrics for health (cheap), head+tail sampled traces for debugging, leveled/sampled logs. Telemetry scales with interestingness, not success count.

**Follow-up.** *Why agent + gateway rather than direct-to-backend?* — Cheap local export, central expensive processing (tail sampling needs whole traces), and one place to change backends or policy.

---

### Q20. How do you model and control the cost of telemetry?

**Model answer.** Four cost centers: in-process overhead (cut by sampling + batching, avoid `WithSyncer`), network egress (batching + gzip + sampling), backend ingest/storage (usually dominant; scales with cardinality and sampling rate), and human cost (noise/alert fatigue). The design principle: telemetry volume should scale with **interestingness**, not **traffic**. Metrics scale with cardinality (control via Views/Collector). Traces should scale with errors and latency (tail sampling), not success count. Logs should be structured and sampled/leveled. A system whose bill grows linearly with successful traffic is mis-designed. Measure: spans/sec, active metric series, GB of logs, and the SDK's dropped-span count.

**Follow-up.** *What's the most common cost incident?* — Someone adds a high-cardinality attribute (customer_id) to a metric and discovers it on the invoice.

---

### Q21. How do you govern semantic conventions across many teams?

**Model answer.** Treat them as an organizational interface. (1) **Pin one `semconv` version** and bump it deliberately org-wide — the conventions evolve and keys *rename* across versions (HTTP conventions were reworked), so uncoordinated bumps fracture cross-service dashboards. (2) **Standardize custom attributes** in an internal namespaced registry (`tenant.id`, `feature.flag`) so they mean the same thing everywhere. (3) **Enforce via a shared instrumentation module** that sets resource and common attributes once, rather than relying on each team to remember keys. The payoff is portability: a single SLO query spans every service, vendor dashboards light up, and a backend migration is mechanical.

**Follow-up.** *Why does a mismatched attribute key matter?* — `http.status` vs `http.response.status_code` means no cross-service dashboard or alert works.

---

### Q22. When does adding instrumentation hurt, and how do you keep overhead low?

**Model answer.** It hurts when you span every function (noise + allocation), use `WithSyncer` (export on the request path), sample at 100% on a hot high-QPS path, or pass a fresh attribute slice on every metric call (per-call allocation). Keep it low by: **sampling** (a non-recording span is nearly free — the decision is made before attribute allocation), instrumenting **boundaries** and meaningful business steps rather than every call, using **`WithBatcher`** with a queue sized for your QPS, **precomputing attribute sets** in hot loops, and **profiling** with `pprof` to confirm instrumentation isn't a hot spot. Treat telemetry as a side effect that must never change behavior or dominate latency.

**Follow-up.** *Why is sampling the biggest lever?* — It cuts cost before the SDK even allocates a recording span's attributes and before export.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Three signals? | Traces, metrics, logs. |
| Span vs trace? | Span = one operation; trace = tree of spans sharing a trace ID. |
| What carries the active span? | `context.Context`. |
| Production span processor? | `BatchSpanProcessor` (`WithBatcher`). |
| Default OTLP ports? | 4317 (gRPC), 4318 (HTTP). |
| Production sampler? | `ParentBased(TraceIDRatioBased(r))`. |
| Cross-service header? | W3C `traceparent` (Trace Context). |
| API vs SDK? | Libraries import API; `main` installs SDK. |
| Errors+slow traces kept how? | Tail sampling in the Collector. |
| OTel vs `runtime/trace`? | Cross-service vs in-process scheduler. |
| Forgot `Shutdown`? | Last batch of spans lost. |

---

## Mock Interview Pacing

A 45-minute interview on OpenTelemetry might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–20 min: middle — Q6, Q7, Q9, Q10, Q11.
- 20–35 min: a senior scenario — Q13, Q14, Q15, or Q18.
- 35–45 min: a staff curveball — Q19 or Q20.

If the candidate claims production OTel experience, go straight to Q13 (sampling), Q14 (cardinality), and Q18 (shutdown/missing traces) — all field-test questions. If they've only read tutorials, stay in middle territory and probe whether they understand the API/SDK split (Q6) and propagation (Q7). A staff candidate should reach Q19 within twenty minutes and naturally bring up the Collector and vendor-neutrality without prompting.
