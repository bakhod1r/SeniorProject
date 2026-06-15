# OpenTelemetry in Go — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Observability Strategy Decision: First Principles](#the-observability-strategy-decision-first-principles)
3. [Sampling Strategy at Fleet Scale](#sampling-strategy-at-fleet-scale)
4. [Cardinality as a Cost and Reliability Problem](#cardinality-as-a-cost-and-reliability-problem)
5. [Cost Modeling: What Telemetry Actually Costs](#cost-modeling-what-telemetry-actually-costs)
6. [Semantic Conventions as an Organizational Contract](#semantic-conventions-as-an-organizational-contract)
7. [The Instrumentation Library Ecosystem](#the-instrumentation-library-ecosystem)
8. [Avoiding Vendor Lock-In](#avoiding-vendor-lock-in)
9. [OTel vs runtime/trace: Choosing the Right Tool](#otel-vs-runtimetrace-choosing-the-right-tool)
10. [Correlating the Three Signals](#correlating-the-three-signals)
11. [Rollout and Migration Strategy](#rollout-and-migration-strategy)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with OpenTelemetry is not "how do I make a span" but "what telemetry do we collect, at what fidelity, at what cost, and how do we keep it useful and portable as the system grows to dozens of services." The mechanics — providers, exporters, propagators — are settled by the time you reach this level. The hard parts are *sampling strategy*, *cardinality control*, *cost*, *semantic-convention governance*, and *not painting yourself into a vendor corner*.

This file is about the design and the trade-offs. The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Decide what to instrument and at what fidelity, against a cost budget
- Design a sampling strategy that keeps the right traces without paying for all of them
- Treat cardinality as a first-class reliability and cost constraint
- Govern semantic conventions across many teams
- Evaluate instrumentation libraries and avoid vendor lock-in
- Choose between OTel and `runtime/trace` for the question at hand

---

## The Observability Strategy Decision: First Principles

OpenTelemetry is a means, not an end. The end is *answering questions about production quickly*. The senior decision is which questions matter and what is the cheapest telemetry that answers them.

### The three signals serve different questions

- **Metrics** answer "is the system healthy, and at what rate/latency?" Cheap, aggregated, always-on. The backbone of SLOs and alerting.
- **Traces** answer "for *this* slow or failing request, where did the time/error go?" Expensive per unit, so sampled. The backbone of latency debugging across services.
- **Logs** answer "what exactly was the state at this point?" High-detail, high-volume; best correlated to traces by trace ID.

A common senior mistake teams make is to over-invest in one signal. All-traces-no-metrics gives you no cheap health signal and a giant bill. All-logs-no-traces leaves you unable to follow a request across services. The strategy is metrics for health, sampled traces for debugging, logs for detail — correlated.

### Instrument the boundaries, enrich the hot paths

You get 80% of the value from instrumenting the *edges*: inbound requests, outbound calls, DB queries, queue operations. Auto-instrumentation (`otelhttp`, `otelgrpc`, `otelsql`) covers these. Hand-written spans should be reserved for business-meaningful steps that the edge spans cannot reveal — a pricing computation, a fraud check, a cache decision. Spanning every function is noise that costs money and obscures the signal.

### The "good enough" fidelity

You do not need every span of every request. You need enough sampled traces to characterize behavior, all of your error traces, and complete metrics. Designing for "good enough" fidelity — not maximal fidelity — is the senior posture, because telemetry cost scales with traffic and unbounded fidelity scales the bill linearly with success.

---

## Sampling Strategy at Fleet Scale

Sampling is the single biggest lever on trace cost and usefulness.

### Head sampling (SDK) vs tail sampling (Collector)

- **Head sampling** decides at the root span, before the outcome is known. It is cheap (no buffering) and consistent across services when keyed on trace ID (`ParentBased(TraceIDRatioBased)`). Its weakness: it cannot prefer error or slow traces, because at decision time the request has not finished.
- **Tail sampling** decides after the whole trace is assembled, in the **Collector's** `tail_sampling` processor. It can keep *all* error traces, *all* slow traces, and a small percentage of the rest. Its cost: the Collector must buffer complete traces in memory for a decision window, and it must see the whole trace (which constrains topology).

The mature pattern is **both**: a modest head sample to cap volume at the source, then tail sampling in the Collector to ensure the *interesting* traces (errors, high latency, specific tenants) always survive.

### Consistency is non-negotiable

Whatever you choose, the sampling decision must be consistent across the trace. If service A samples a trace in and service B samples it out, you get partial traces that are worse than none. `ParentBased(TraceIDRatioBased(r))` guarantees that downstream services honor the upstream decision. Per-service independent ratios are a classic broken-trace generator.

### Adaptive and rule-based sampling

For large fleets, a flat ratio is crude: low-traffic endpoints get too few traces, high-traffic ones too many. Collector-side rules can sample per route, per status, per latency, or adaptively to hit a target spans-per-second. Push this policy into the Collector so you can change it without redeploying services.

### A worked decision

A service at 10k req/s, head-sampled at 100%, emitting ~8 spans/request, produces 80k spans/s — almost certainly unaffordable and unreadable. Head-sample at 1% (800 spans/s) for baseline behavior, and tail-sample to additionally keep 100% of errors and p99-latency requests. You pay for ~1% of normal traffic plus all the traces you actually want to look at.

---

## Cardinality as a Cost and Reliability Problem

Cardinality — the number of unique attribute-value combinations — is the silent killer of observability systems.

### Why it matters

Every unique combination of attribute values on a **metric** creates a separate time series. A latency histogram with `route`, `method`, and `status` (say 50 × 4 × 6 = 1,200 series) is fine. Add `user.id` and you multiply by the number of users — millions of series, an out-of-memory backend, and a five-figure monthly bill. For **traces**, high-cardinality attributes inflate storage and index size and slow queries.

### The rule

**Metric attributes must be bounded and low-cardinality.** Route templates (`/users/:id`), status codes, methods, regions — yes. User IDs, request IDs, full URLs, error strings, timestamps — no. Those belong on *spans* (where each trace is one record, so cardinality is bounded per trace), not on metric dimensions.

### Defense in depth

- **At the SDK:** Views drop or aggregate-away high-cardinality attributes before export.
- **In the Collector:** processors (`attributes`, `transform`, `filter`) can strip or hash dimensions centrally, so a single fix covers all services.
- **In code review:** treat any new metric attribute derived from user input as a red flag.

The most expensive incidents are not outages; they are a well-meaning engineer adding `customer_id` to a metric and discovering it next month on the invoice. Cardinality governance is a senior responsibility.

---

## Cost Modeling: What Telemetry Actually Costs

Telemetry has four cost centers, and a senior engineer can estimate each.

1. **In-process overhead.** Span creation, attribute allocation, batching. Small with sampling and batching; significant with `WithSyncer` or 100% sampling on a hot path. Measurable with benchmarks (see `optimize.md`).
2. **Network egress.** Bytes shipped to the Collector/backend. Proportional to spans × attributes × sampling rate. Compression (OTLP/gRPC) and batching reduce it.
3. **Backend ingest and storage.** Most vendors bill per span, per metric series, per GB of logs. This is usually the dominant cost, and it scales with cardinality and sampling rate.
4. **Human cost.** Too much telemetry is its own tax: noisy dashboards, alert fatigue, slow queries over bloated data. Less, well-chosen telemetry is often *more* useful.

The senior framing: telemetry volume should scale with *interestingness*, not with *traffic*. Metrics scale with cardinality (controllable). Traces should scale with errors and latency (via tail sampling), not with success count. Logs should be structured and sampled or leveled. A system whose telemetry bill grows linearly with successful traffic is mis-designed.

---

## Semantic Conventions as an Organizational Contract

Semantic conventions are the shared vocabulary — `http.request.method`, `db.system`, `service.name`, `rpc.grpc.status_code` — that makes telemetry from different teams comparable.

### Why they are a contract, not a detail

If team A names it `http.status` and team B names it `http.response.status_code`, no cross-service dashboard or alert works. Conventions are what let a single SLO query span every service, what let a vendor's out-of-the-box dashboards light up, and what make a future backend migration mechanical. They are an organizational interface, and like any interface they need governance.

### Governing them

- **Pin a `semconv` version** organization-wide and bump it deliberately. The conventions evolve (and keys *rename* across schema versions); uncoordinated bumps fracture dashboards.
- **Standardize custom attributes.** For domain attributes outside the spec (`tenant.id`, `feature.flag`), maintain an internal registry with namespaced keys, so they mean the same thing everywhere.
- **Enforce in CI / shared libs.** A shared internal instrumentation module that sets resource attributes and common span attributes once is more reliable than asking every team to remember the keys.

The payoff is portability: instrumentation written to the conventions outlives any particular backend and any particular team's local choices.

---

## The Instrumentation Library Ecosystem

Most of your spans should come from libraries, not hand-written code.

### What exists

`opentelemetry-go-contrib` provides maintained instrumentation: `otelhttp` (net/http), `otelgrpc` (gRPC), `otelsql`/driver wrappers (database/sql), plus community wrappers for popular routers (chi, gin, echo), clients (Redis, Kafka, MongoDB), and cloud SDKs. These follow semantic conventions and handle propagation for you.

### Evaluation criteria

When adopting an instrumentation library, a senior checks:
- **Maintenance and version alignment** with your OTel API/SDK versions (the contrib repo versions move with the core).
- **Semantic-convention compliance** — does it emit standard attribute keys?
- **Overhead** — does it allocate per request in a hot path?
- **Configurability** — can you turn off noisy spans, redact attributes, set span names?
- **Propagation correctness** — does it inject/extract via the global propagator?

### Build vs adopt

Prefer adopting maintained contrib instrumentation over hand-rolling. Hand-rolled boundary instrumentation drifts from conventions, misses edge cases (trailers, retries, streaming), and becomes maintenance debt. Reserve custom instrumentation for your own internal protocols where nothing exists.

---

## Avoiding Vendor Lock-In

The central promise of OpenTelemetry is portability. Realizing it requires discipline.

### The lock-in vectors

- **Backend-specific SDKs.** If you instrument with a vendor's proprietary agent/SDK instead of OTel, switching costs a re-instrumentation. Instrument with **OTel**; let the *exporter/Collector* talk to the vendor.
- **Vendor-specific attributes/queries.** Dashboards and alerts written against vendor-proprietary fields do not move. Write them against semantic conventions.
- **Export topology.** Exporting OTLP directly from every service to a vendor hard-codes the destination across your fleet. Export to a **Collector** instead; the Collector owns the vendor relationship, so changing vendors is a Collector config change, not a fleet redeploy.

### The portable architecture

```
services (OTel SDK, OTLP) ──▶ OpenTelemetry Collector ──▶ vendor A
                                                       └──▶ vendor B (parallel eval)
```

With this shape, you can run two backends in parallel to evaluate a migration, or fail over, or split signals across vendors — all by editing Collector pipelines. The application code never knows or cares. This is the single most valuable architectural decision for avoiding lock-in.

---

## OTel vs runtime/trace: Choosing the Right Tool

This distinction is worth re-stating at the senior level because picking wrong wastes real time.

| Question | Tool |
|----------|------|
| "Where does this request spend time *across services*?" | OpenTelemetry traces |
| "Why is *this one process* burning CPU / blocking / GC-thrashing?" | `runtime/trace` + `go tool trace` |
| "What is our p99 latency / error rate over time?" | OpenTelemetry metrics |
| "Are goroutines blocking on a channel / mutex inside this binary?" | `runtime/trace` (and the execution tracer) |
| "Which downstream dependency is slow?" | OpenTelemetry traces |
| "Is the scheduler starving Ps; are syscalls the bottleneck?" | `runtime/trace` |

OpenTelemetry is **cross-service, always-on, exported** observability. `runtime/trace` is **single-process, on-demand, deep** scheduler/runtime profiling that you turn on to diagnose a specific in-process performance mystery. They are complementary, not competing — a trace tells you *which service and which span* is slow; `runtime/trace` (or a CPU profile) on that service tells you *why, inside the process*. See [03-runtime-trace-application-tracing](../03-runtime-trace-application-tracing/senior.md).

---

## Correlating the Three Signals

The compounding value of OTel is correlation.

- **Traces ↔ logs.** Inject the trace ID and span ID into structured log records (via an `slog` handler or a logging bridge). Then "find the logs for this trace" is a single query, and "find the trace for this error log" is one click.
- **Traces ↔ metrics (exemplars).** Exemplars attach a trace ID to a specific histogram bucket sample, so a p99-latency spike on a dashboard links directly to an example slow trace. This is the bridge from "the dashboard is red" to "here is the exact request that was slow."
- **Shared resource.** All three signals carry the same resource (`service.name`, `service.version`, `deployment.environment`), so they join cleanly in the backend.

Designing for correlation up front — consistent resource, trace-ID-in-logs, exemplars on — is what turns three separate data streams into one investigative surface.

---

## Rollout and Migration Strategy

Adopting OTel across an existing fleet is a program, not a commit.

1. **Stand up the Collector first.** It is the stable seam. Point it at your current backend.
2. **Roll out a shared instrumentation module** that configures resource, propagator, exporter (to the Collector), and sane sampling — so each service adopts OTel by importing one internal package, not by copying boilerplate.
3. **Instrument boundaries first** (`otelhttp`/`otelgrpc`), get connected cross-service traces, then enrich.
4. **Migrate signal by signal.** Often metrics first (cheap, high value), then traces, then logs.
5. **Run old and new in parallel** if replacing a legacy tracing system; compare before cutting over.
6. **Govern from day one:** semconv version, cardinality review, sampling policy in the Collector.

The Collector-first, shared-module approach means you can change sampling, redaction, and even the backend centrally as the rollout proceeds, rather than chasing config across dozens of repos.

---

## Anti-Patterns

- **Spanning every function.** Noise, cost, and obscured signal. Instrument boundaries and meaningful steps.
- **100% head sampling on a high-QPS service.** Unaffordable and unreadable. Sample at the head; tail-sample for the interesting traces.
- **Per-service independent sampling ratios.** Produces broken, partial traces. Use `ParentBased`.
- **High-cardinality metric attributes** (user ID, request ID, raw URL, error string). The classic cost incident.
- **Exporting directly to a vendor from every service.** Hard-codes lock-in. Export to a Collector.
- **Ad-hoc attribute keys instead of semantic conventions.** Breaks cross-service dashboards and portability.
- **Hand-rolling boundary instrumentation** when maintained contrib libraries exist.
- **PII in attributes/baggage.** Compliance hazard; redact at the source.
- **No correlation.** Three uncorrelated signals are three times the data and a third of the value.
- **Treating `runtime/trace` and OTel as interchangeable.** Wrong tool for the question wastes hours.
- **Unbounded baggage** propagated to every downstream service, inflating every request.

---

## Senior-Level Checklist

- [ ] Choose signals by question: metrics for health, sampled traces for debugging, logs for detail
- [ ] Instrument boundaries with contrib libraries; reserve hand-written spans for business steps
- [ ] Use head sampling (`ParentBased(TraceIDRatioBased)`) plus Collector tail sampling for errors/latency
- [ ] Guarantee sampling consistency across the trace
- [ ] Treat metric cardinality as a hard constraint; keep high-cardinality data on spans, not metric dimensions
- [ ] Govern semantic conventions: pin the version, register custom attributes, enforce via a shared module
- [ ] Export to a Collector, not directly to a vendor, to preserve portability
- [ ] Correlate signals: trace ID in logs, exemplars on histograms, shared resource
- [ ] Model telemetry cost; ensure it scales with interestingness, not with successful traffic
- [ ] Redact PII before it leaves the process
- [ ] Use OTel for cross-service questions and `runtime/trace` for in-process performance mysteries
- [ ] Roll out Collector-first with a shared internal instrumentation module

---

## Summary

At the senior level, OpenTelemetry is a strategy problem, not a coding problem. The command-level mechanics are solved; the responsibility is to collect the *right* telemetry at the *right* fidelity for the *right* cost, and to keep it portable. That means choosing signals by the question they answer — metrics for health, sampled traces for cross-service debugging, logs for detail — and correlating them by trace ID and shared resource. It means a sampling strategy that combines consistent head sampling to cap volume with Collector-side tail sampling so every error and every slow trace survives. It means treating cardinality as a first-class cost-and-reliability constraint, keeping unbounded values on spans and out of metric dimensions. It means governing semantic conventions as an organizational interface and adopting maintained instrumentation libraries rather than hand-rolling boundaries.

Above all, it means exporting through a **Collector** so the application stays vendor-neutral and the backend relationship is a config change, not a re-instrumentation — the architectural decision that turns OpenTelemetry's portability promise into reality. And it means keeping clear the line that trips teams up: OpenTelemetry answers cross-service questions; `runtime/trace` answers in-process ones. Use each for what it is built for, and the two together give you the full picture from "which service is slow" down to "why, inside that process."
