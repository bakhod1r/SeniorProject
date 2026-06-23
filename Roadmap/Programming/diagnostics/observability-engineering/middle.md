# Observability Engineering — Middle Level

> **Topic:** [Observability Engineering Roadmap](README.md)
> **Focus:** OpenTelemetry as the unifying standard — the spec, the SDKs, and the Collector. Context propagation and how a trace stays whole across services. Instrumentation strategy: auto vs manual, span design, and RED/USE/golden-signals as a default metric set. Correlating signals — exemplars (metric→trace), span→profile. The first encounter with sampling and cost.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [OpenTelemetry — The Unifying Standard](#opentelemetry--the-unifying-standard)
6. [The Three Signals and the Wide Event, Revisited](#the-three-signals-and-the-wide-event-revisited)
7. [Context Propagation](#context-propagation)
8. [Instrumentation Strategy](#instrumentation-strategy)
9. [RED, USE, and the Golden Signals](#red-use-and-the-golden-signals)
10. [Correlating Signals](#correlating-signals)
11. [Sampling — First Contact](#sampling--first-contact)
12. [Code Examples](#code-examples)
13. [Real-World Analogies](#real-world-analogies)
14. [Mental Models](#mental-models)
15. [Use Cases](#use-cases)
16. [Coding Patterns](#coding-patterns)
17. [Best Practices](#best-practices)
18. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Tricky Points](#tricky-points)
21. [Test Yourself](#test-yourself)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Summary](#summary)
25. [What You Can Build](#what-you-can-build)
26. [Further Reading](#further-reading)
27. [Related Topics](#related-topics)
28. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **How do you actually instrument a distributed system with OpenTelemetry?** and **What's the right *strategy* — not just the API calls — for deciding what to instrument?**

At the junior level you learned the *what*: observability is asking unanticipated questions, the pillars are views of one wide event, and a shared `trace_id` is what connects them. This level is the *how at scale*. The central tool is **OpenTelemetry (OTel)** — the vendor-neutral standard that won the observability instrumentation war. It is three things: a **specification** (a common data model for traces, metrics, logs, and profiles), a set of **SDKs** (one per language, implementing that spec), and the **Collector** (a standalone process that receives, processes, and exports telemetry). Learn OTel and you've learned the substrate every modern backend speaks.

But tooling is the easy half. The hard half is **strategy**: a trace with a thousand meaningless spans is worse than ten well-chosen ones; a service drowning in auto-instrumented noise with no business attributes can't answer the questions that matter. This level covers the decisions — auto vs manual instrumentation, how to design a span, which metrics to emit *first* (RED/USE/golden signals), how to make context propagate so traces don't snap at the network boundary, and how to correlate signals so a metric spike leads you to a trace leads you to a log leads you to a profile.

The next level ([`senior.md`](senior.md)) covers SLOs and the discipline of deciding what *not* to instrument; [`professional.md`](professional.md) covers designing the Collector topology and backends for an entire organisation.

> 🎓 **Why this matters at the middle level:** This is the tier where you stop being handed instrumented services and start instrumenting them yourself. The difference between a mid engineer and a senior one, on the observability axis, is whether your instrumentation *answers questions during the incident* or just *generates data nobody can use*. Strategy is the multiplier.

---

## Prerequisites

- **Required:** The junior page — observability vs monitoring, the three pillars, the wide-event model, `trace_id` correlation.
- **Required:** Working knowledge of at least one pillar's SDK — see [`../tracing/middle.md`](../tracing/middle.md) and [`../metrics/middle.md`](../metrics/middle.md).
- **Required:** Comfort with HTTP services across a network — context propagation is about HTTP headers.
- **Helpful:** Exposure to Prometheus and a tracing backend (Jaeger/Tempo). You'll see their concepts here.
- **Helpful:** [`../logging/middle.md`](../logging/middle.md) for structured logging — the log half of correlation.

---

## Glossary

| Term | Definition |
|------|-----------|
| **OpenTelemetry (OTel)** | The CNCF vendor-neutral standard: spec + SDKs + Collector, for traces, metrics, logs, profiles. |
| **Signal** | One telemetry type in OTel: traces, metrics, logs, or profiles. |
| **SDK** | The language library implementing the OTel API (records spans/metrics) and pipeline (processors, exporters). |
| **API vs SDK** | OTel separates the *API* (what your code calls) from the *SDK* (what actually processes/exports). Libraries depend on the API only. |
| **Collector** | A standalone OTel process with receivers → processors → exporters. The telemetry pipeline's hub. |
| **OTLP** | OpenTelemetry Protocol — the wire format the SDK and Collector use to ship telemetry. |
| **Exporter** | The component that sends telemetry to a backend (OTLP, Prometheus, Jaeger, …). |
| **Processor** | A Collector/SDK stage that transforms telemetry (batch, filter, tail-sample, drop attributes). |
| **Auto-instrumentation** | Telemetry generated automatically for frameworks/libraries (HTTP, DB, gRPC) without code changes. |
| **Manual instrumentation** | Spans/attributes/metrics you add by hand to capture business meaning. |
| **Context propagation** | Carrying trace context (the `traceparent` header) across service boundaries so the trace stays connected. |
| **W3C Trace Context** | The standard `traceparent`/`tracestate` HTTP headers for propagation. |
| **Span** | One timed operation in a trace; has name, timing, status, and attributes. The wide-event unit. |
| **Span attribute** | A key/value field on a span — the dimensions you query by. |
| **Resource** | Attributes describing the *source* of telemetry (service name, version, host, region). |
| **Semantic conventions** | OTel's standardised attribute names (`http.request.method`, `db.system`) so tools understand them. |
| **Exemplar** | A sample trace ID attached to a metric data point, linking the aggregate to a concrete request. |
| **RED / USE** | Request-rate/Error-rate/Duration (services) / Utilisation/Saturation/Errors (resources). Default metric sets. |
| **Sampling** | Keeping a subset of traces to control cost. Head-based (decide at start) vs tail-based (decide at end). |

---

## Core Concepts

### 1. OpenTelemetry won because it's the standard nobody has to lose

Before OTel there were OpenTracing, OpenCensus, and a dozen vendor agents — instrument once for Datadog, re-instrument for New Relic. OTel merged the competing standards into one **vendor-neutral** API and protocol. Now you instrument *once* with OTel and point it at *any* backend. That portability is why it won, and why "use OpenTelemetry" is the default answer to "how should we instrument?"

### 2. The API/SDK split is what makes libraries instrumentable

OTel deliberately separates the **API** (what your code and third-party libraries call to create spans) from the **SDK** (what decides sampling, batching, and where data goes). A library can depend on the *API* only and emit spans that do nothing until *your application* installs an SDK. This is why a database driver can be instrumented without forcing a backend on its users — the application chooses.

### 3. A trace is only as good as its propagation

A trace that stops at the first network call isn't a trace — it's a single-service log. **Context propagation** carries the `trace_id` and parent `span_id` across the wire (via the W3C `traceparent` header) so that service B's spans become *children* of service A's. Get this wrong and you have a pile of disconnected single-service traces; get it right and you can see one request's whole journey across forty services.

### 4. Auto-instrumentation gives breadth; manual gives the answers

Auto-instrumentation traces your HTTP server, DB client, and message queue for free — enormous breadth for zero code. But it knows *nothing* about your domain. The attributes that solve incidents — `customer.plan`, `cart.value`, `feature.flag`, `payment.provider` — only you can add. Strategy: lean on auto for coverage, add manual spans and attributes where the business logic lives.

### 5. The starting metric set is a solved problem: RED / USE / golden signals

You don't have to invent which metrics to emit. For *services*, emit **RED** (Rate, Errors, Duration). For *resources*, emit **USE** (Utilisation, Saturation, Errors). Google's **Four Golden Signals** (latency, traffic, errors, saturation) are the same idea. Emit these first, everywhere, and you'll catch the majority of incidents before reaching for anything clever.

### 6. Correlation is engineered, not accidental

For a metric spike to link to a trace, you must emit **exemplars**. For a trace span to link to a profile, the profiler must be span-aware. For logs to link to traces, the `trace_id` must be in the log. None of this happens by default — you wire it. The payoff is the single most powerful debugging move there is: spike → exemplar trace → logs for that request → profile of that span.

---

## OpenTelemetry — The Unifying Standard

OTel has three layers. Understanding which is which keeps you from confusion.

| Layer | What it is | You touch it when |
|---|---|---|
| **Specification** | The language-agnostic data model + semantics (what a span/metric/log *is*, standard attribute names) | Designing instrumentation, reading docs |
| **SDKs** (per language) | The library that implements the spec: creates spans/metrics, samples, batches, exports | Writing instrumentation code |
| **Collector** | A standalone process: receivers → processors → exporters | Designing the telemetry pipeline ([`professional.md`](professional.md)) |

### The four signals

OTel unifies all telemetry under one umbrella:

- **Traces** — spans, the per-request path. The most mature signal.
- **Metrics** — counters/gauges/histograms, with a bridge to/from Prometheus.
- **Logs** — structured records, correlated to traces via `trace_id`.
- **Profiles** — sampled CPU/memory by code location; the newest signal (cross-ref [continuous-profiling](../continuous-profiling/)).

The win of unifying them is **shared context**: the same `trace_id`, the same resource attributes, the same propagation, across every signal. That shared context is what makes correlation possible.

### The SDK pipeline (in-process)

```text
   your code ──► Tracer/Meter (API) ──► SDK Provider
                                          │
                                  ┌───────┴────────┐
                                  │  Sampler       │  (keep this trace?)
                                  │  SpanProcessor │  (batch)
                                  │  Exporter      │  (OTLP → Collector/backend)
                                  └────────────────┘
```

### The Collector (out-of-process)

The Collector is the hub you run *near* your services. It decouples your apps from your backends:

```text
   services ──OTLP──► [ COLLECTOR ]
                       receivers  ──► processors        ──► exporters ──► backends
                       (otlp,         (batch, tail_      (prometheus,    (Tempo, Loki,
                        prometheus)    sampling,          otlp, loki)     Honeycomb,
                                       attributes,                        Datadog)
                                       filter)
```

Why it matters even at the middle level: it means you can switch backends, add tail-based sampling, or scrub PII *without redeploying every service*. Full topology design is in [`professional.md`](professional.md).

> **Why OTel won, in one line:** instrument once, vendor-neutral, all signals share context, and the Collector lets you change everything downstream without touching app code.

---

## The Three Signals and the Wide Event, Revisited

The junior page argued the *real* unit is the wide structured event. At the middle level you see how OTel makes that practical: **a span IS a wide structured event** — it has timing, a `trace_id`, a status, and an arbitrary bag of attributes. So the modern stance is:

- Treat each **span** as the wide event for that operation. Attach every dimension you might query (`user.id`, `customer.plan`, `region`, `build.version`, `payment.provider`) as span attributes.
- Derive **metrics** from spans (span metrics / RED) or emit them directly with exemplars pointing back to spans.
- Correlate **logs** by stamping `trace_id` and `span_id` on every line.

This is the difference between "we have three pillars" and "we have one observable system." The pillars are output formats; the span-as-wide-event is the source of truth.

---

## Context Propagation

A trace spans services. For service B's work to appear as a *child* of service A's span, A must send the trace context to B, and B must read it.

```text
   Service A                                  Service B
   ┌─────────────────────┐                    ┌─────────────────────┐
   │ span: POST /checkout│                     │ span: POST /charge  │
   │ trace=7c1e span=aaaa│                     │ trace=7c1e span=bbbb│
   └──────────┬──────────┘                     │ parent=aaaa         │
              │ HTTP call                       └─────────▲───────────┘
              │ header:                                   │
              │   traceparent: 00-7c1e...-aaaa-01         │
              └───────────────────────────────────────────┘
   Same trace_id, B's span parented to A's → ONE connected trace.
```

The standard is **W3C Trace Context**: the `traceparent` header carries `version-traceid-spanid-flags`, and `tracestate` carries vendor-specific data. Key points:

- With OTel HTTP instrumentation on both ends, propagation is **automatic** — the SDK injects `traceparent` on outgoing requests and extracts it on incoming ones.
- For **non-HTTP** hops — message queues (Kafka, SQS), background jobs — you must propagate manually (inject context into the message headers, extract on the consumer). This is the #1 place traces break.
- A **propagator** is configurable; the default is W3C, but legacy systems may use B3 (Zipkin) — configure both during a migration.

When traces "split" into many single-service fragments, propagation is almost always the culprit.

---

## Instrumentation Strategy

### Auto vs manual

| | **Auto-instrumentation** | **Manual instrumentation** |
|---|---|---|
| **Effort** | Near-zero (agent or library) | Code per span/attribute |
| **Coverage** | Framework boundaries: HTTP, DB, gRPC, queues | Wherever you add it |
| **Knows your domain?** | No | **Yes** — this is its value |
| **Risk** | Noise, too many spans | Effort, inconsistency |
| **Use it for** | Baseline coverage everywhere | Business-meaningful spans & attributes |

**The strategy:** turn on auto-instrumentation *everywhere* for baseline coverage, then add **manual attributes** to the auto-created spans (you can grab the current span and `SetAttributes`) and **manual spans** only around meaningful business operations the framework can't see ("apply discount rules," "run fraud model").

### Span design — the senior-track skill, introduced

- **A span is a unit of work worth timing.** "Handle request," "query DB," "call payments." Not "increment counter."
- **Don't over-span.** A span per loop iteration is noise. A span per meaningful operation is signal.
- **Name spans by operation, low-cardinality.** `GET /users/:id`, not `GET /users/12345` — the high-cardinality detail goes in *attributes*, not the span *name*.
- **Put dimensions in attributes.** `user.id`, `customer.plan`, `region`, `build.version`. These are what you'll `group by`.
- **Record errors on the span** (`span.RecordError` + set status to error) so failures show up in the trace and in derived metrics.
- **Use semantic conventions** for standard things (`http.request.method`, `db.system`, `db.statement`) so backends and tools understand them automatically.

### What to instrument first

1. **Every service boundary** — inbound and outbound (auto gives this).
2. **Every external dependency** — DB, cache, queue, third-party API (auto gives this).
3. **The business-critical operations** — the things in your domain a PM would name (manual).
4. **RED metrics per endpoint** and **USE metrics per resource** (next section).

---

## RED, USE, and the Golden Signals

You don't invent your starting metrics. Three well-known frameworks converge:

| Framework | For | The signals |
|---|---|---|
| **RED** (Tom Wilkie) | request-driven *services* | **R**ate (req/s), **E**rrors (failed req/s), **D**uration (latency distribution) |
| **USE** (Brendan Gregg) | *resources* (CPU, disk, pool) | **U**tilisation (% busy), **S**aturation (queue/wait), **E**rrors |
| **Four Golden Signals** (Google SRE) | *services* | Latency, Traffic, Errors, Saturation |

They overlap heavily — RED ≈ golden-signals minus saturation; USE covers the resource side. **The strategy:** emit **RED for every service/endpoint** and **USE for every resource it depends on**, and you have a default observability floor that catches most incidents.

A subtlety worth internalising now: **measure success latency and error latency separately.** A flood of fast 500s (failing in 2ms) will *improve* your overall p99 while customers scream. Split duration by status class so a fast-failure can't hide.

---

## Correlating Signals

Correlation is what turns telemetry into observability. Three links, each engineered:

### 1. metric → trace, via exemplars

An **exemplar** is a `trace_id` attached to a metric data point (specifically, to a histogram bucket). When you see a latency-histogram spike, you click it and jump to an *actual slow trace* in that bucket — not "a trace from around that time," but *the* trace that produced that data point. This is the highest-leverage correlation in modern observability.

### 2. trace → log, via trace_id in logs

Covered at junior level: stamp `trace_id` and `span_id` on every log line. From a trace span you can pull every log emitted during it.

### 3. trace → profile, via span context

The newest link: a continuous profiler that is *span-aware* tags CPU samples with the active `span_id`, so you can ask "for this slow span, which function was burning CPU?" (cross-ref [continuous-profiling](../continuous-profiling/)).

```text
   [metric spike] ──exemplar──► [trace span] ──trace_id──► [logs]
                                      │
                                  span_id
                                      ▼
                                 [profile: hot functions for this span]
```

This chain — spike to trace to logs to profile — is the observability-driven debugging loop made concrete.

---

## Sampling — First Contact

You cannot afford to store every trace at scale (cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)). Sampling keeps a representative subset.

| Strategy | When the decision is made | Pro | Con |
|---|---|---|---|
| **Head-based** | At trace *start* (e.g. keep 10%) | Cheap, simple, decided once and propagated | Decides *before* you know if the trace is interesting (an error you'd want is dropped) |
| **Tail-based** | At trace *end*, in the Collector | Keep *all* errors and slow traces; drop boring fast ones | Needs to buffer whole traces; more infra |

The middle-level rule: **head sampling is fine to start; move to tail-based sampling so you never drop the errors.** Naïve random head sampling at 1% means you keep one in a hundred failures — and the rare failure is exactly what you wanted. Tail sampling lets you keep 100% of errors and 1% of successes. Sampling design is its own topic — see [telemetry-cost](../telemetry-cost-and-sampling-strategy/).

> Sampling decisions must **propagate** with the trace context — if A samples a trace in, B must honour that, or you get half-traces.

---

## Code Examples

### Go — OTel SDK setup with OTLP export to a Collector

```go
package main

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func initTracing(ctx context.Context) (func(context.Context) error, error) {
	exp, err := otlptracegrpc.New(ctx, // export OTLP to the Collector
		otlptracegrpc.WithEndpoint("otel-collector:4317"),
		otlptracegrpc.WithInsecure())
	if err != nil {
		return nil, err
	}
	// Resource = WHO is emitting. These become attributes on every span.
	res, _ := resource.New(ctx, resource.WithAttributes(
		semconv.ServiceName("checkout"),
		semconv.ServiceVersion("4.2.1"),
		semconv.DeploymentEnvironment("prod"),
	))
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		// Head sampler: keep 10% — replace with ParentBased + tail sampling at scale.
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.10))),
	)
	otel.SetTracerProvider(tp)
	return tp.Shutdown, nil
}
```

### Go — auto-attributes on a span + business span

```go
import (
	"context"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

func handleCheckout(ctx context.Context, userID, plan string) error {
	// Enrich the auto-created HTTP server span with BUSINESS dimensions.
	span := trace.SpanFromContext(ctx)
	span.SetAttributes(
		attribute.String("user.id", userID),     // high-cardinality: fine on a span
		attribute.String("customer.plan", plan),  // a dimension you'll group by
	)

	// A manual span around domain logic auto-instrumentation can't see.
	ctx, fraud := otel.Tracer("checkout").Start(ctx, "fraud.evaluate")
	score := runFraudModel(ctx, userID)
	fraud.SetAttributes(attribute.Float64("fraud.score", score))
	fraud.End()

	return charge(ctx, userID)
}

func runFraudModel(context.Context, string) float64 { return 0.1 }
func charge(context.Context, string) error          { return nil }
```

### Python — propagation across an HTTP call (manual injection)

```python
from opentelemetry import trace
from opentelemetry.propagate import inject, extract
import requests

tracer = trace.get_tracer("checkout")

def call_payments(amount: int):
    with tracer.start_as_current_span("call.payments"):
        headers = {}
        inject(headers)          # writes 'traceparent' into headers → propagation
        return requests.post("http://payments/charge",
                             json={"amount": amount}, headers=headers)

# On the PAYMENTS service, the incoming request continues the SAME trace:
def on_request(incoming_headers):
    ctx = extract(incoming_headers)   # reads 'traceparent' → continues the trace
    with tracer.start_as_current_span("POST /charge", context=ctx):
        ...
```

### OpenTelemetry Collector — a starter config

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  batch: {}                          # batch before export — efficiency
  attributes:                        # scrub PII before it leaves the building
    actions:
      - { key: user.email, action: delete }
  tail_sampling:                     # keep all errors + slow traces, sample the rest
    decision_wait: 10s
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: sample-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }

exporters:
  otlp/tempo:    { endpoint: tempo:4317, tls: { insecure: true } }   # traces
  prometheus:    { endpoint: 0.0.0.0:8889 }                          # metrics
  loki:          { endpoint: http://loki:3100/loki/api/v1/push }     # logs

service:
  pipelines:
    traces:  { receivers: [otlp], processors: [attributes, tail_sampling, batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [prometheus] }
    logs:    { receivers: [otlp], processors: [attributes, batch], exporters: [loki] }
```

This one file shows the whole value of the Collector: PII scrubbing, tail sampling, and fan-out to three backends — none of it in your application code.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **OpenTelemetry** | The shipping-container standard — one box size, and every port, ship, and truck handles it. Instrument once, ship anywhere. |
| **The Collector** | A mail sorting office — everything funnels in, gets sorted/filtered/redacted, and fans out to the right destinations. |
| **Context propagation** | A baton in a relay race — if a runner drops it at the handoff, the race result is split and meaningless. |
| **Auto-instrumentation** | Factory-installed sensors on a car. **Manual** | Aftermarket sensors you add for the things you specifically care about. |
| **Exemplar** | A footnote on a statistic that links to the exact source document. The number *and* the receipt. |
| **Head sampling** | Deciding at the door which party guests to photograph — before you know who'll be interesting. **Tail** | Photographing everyone, keeping only the interesting shots afterward. |
| **Semantic conventions** | Agreeing everyone writes the date as YYYY-MM-DD, so any tool can read it. |

---

## Mental Models

### 1. OTel = one API, many backends

Picture a wall socket adapter. Your code plugs into the OTel *API*; the *SDK + Collector* are the adapter; the backend is the foreign socket. Change countries (backends) and you change the adapter, never the device. This is the entire value proposition — and the reason "should we use OTel?" has one answer.

### 2. A span is a wide event with a clock

Stop thinking "spans for tracing, logs for events, counters for metrics." Think: *I emit one rich, timed, attributed event per operation (a span); the pillars are projections of it.* When you internalise this, your instrumentation gets denser in attributes and sparser in redundant log lines.

### 3. The relay baton — propagation or it didn't happen

A trace is a relay race; the trace context is the baton. Auto-instrumented HTTP hands it off automatically; queues and custom protocols drop it unless you hand it off by hand. Whenever a trace is suspiciously short, ask "where did we drop the baton?"

### 4. Default metrics are a checklist, not a creative act

RED for every service, USE for every resource. You don't brainstorm metrics for a new service — you run the checklist. Creativity is for the *attributes* and the *business spans*, not for re-deciding that you need a request rate.

### 5. Correlation is a chain you build link by link

Spike → (exemplar) → trace → (trace_id) → logs → (span_id) → profile. Each arrow is a feature you have to turn on. The teams that debug in minutes are the ones who built every link *before* the incident.

---

## Use Cases

| Situation | OTel-era move |
|---|---|
| New microservice needs observability | Auto-instrument + RED metrics + resource attributes (service, version, env) |
| Trace stops at the queue | Manually propagate context into message headers |
| Latency spike, unknown cause | Exemplar from the histogram → the exact slow trace → its logs |
| Switching observability vendor | Re-point the Collector exporter; touch no app code |
| Need to scrub PII before it leaves | An `attributes` processor in the Collector |
| Cost too high | Tail-sampling policy: keep errors + slow, drop boring (cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)) |
| "Which build regressed?" | `group by build.version` on span attributes |

---

## Coding Patterns

### Pattern 1 — Enrich the existing span, don't create a redundant one

```go
span := trace.SpanFromContext(ctx)           // grab the auto-created span
span.SetAttributes(attribute.String("customer.plan", plan))  // add domain context
```

Auto-instrumentation already made a span for the request. Add your business attributes *to it* rather than starting a parallel one.

### Pattern 2 — Always end the span (defer / context manager / try-finally)

```python
with tracer.start_as_current_span("op") as span:   # ends automatically
    ...
```

A span that never ends never exports — and leaks. Use language constructs that guarantee `End()`.

### Pattern 3 — Status and error on the span, every error path

```go
if err != nil {
    span.RecordError(err)
    span.SetStatus(codes.Error, "charge failed")
}
```

Without this, the failing request looks fine in the trace and in any span-derived error metric.

### Pattern 4 — Resource attributes once, at startup

Set `service.name`, `service.version`, `deployment.environment` on the **Resource**, not on every span. They stamp every signal automatically and are how you slice fleet-wide.

### Pattern 5 — Propagate context into non-HTTP carriers

```python
inject(message.headers)   # producer
ctx = extract(message.headers)  # consumer
```

Queues, cron jobs, and custom RPC drop the baton unless you inject/extract explicitly.

---

## Best Practices

1. **Use OpenTelemetry. Once.** Don't scatter vendor SDKs; instrument with OTel and choose backends downstream.
2. **Auto-instrument for breadth, manually enrich for depth.** Baseline everywhere; business attributes where they matter.
3. **Set resource attributes** (`service.name`, `version`, `env`, `region`) — they make fleet-wide slicing possible.
4. **Follow semantic conventions** for standard attributes so tools light up automatically.
5. **Emit RED per service and USE per resource** as your default floor; split duration by success/error.
6. **Engineer correlation**: `trace_id` in logs, exemplars on histograms, span-aware profiles.
7. **Run a Collector** even for a small fleet — it's where sampling, PII scrubbing, and backend changes live without redeploys.
8. **Adopt tail-based sampling** so you never drop the errors you most need.
9. **Keep span names low-cardinality** (route templates) and put the high-cardinality detail in attributes.

---

## Edge Cases & Pitfalls

- **Broken propagation across queues/jobs.** Auto-HTTP propagates; async carriers don't. Inject/extract manually or your traces split.
- **High-cardinality span *names*.** `GET /users/12345` blows up the span-name dimension. Use `GET /users/:id`; the ID goes in an attribute.
- **Auto-instrumentation noise.** Some libraries create a span per redis command — thousands per request. Configure/suppress what you don't need.
- **Sampling that drops errors.** Random head sampling discards rare failures. Use tail sampling keyed on status/latency.
- **Spans that never end.** A forgotten `End()` (especially in async code) leaks and never exports — the operation just vanishes from traces.
- **Logging the `trace_id` in a different format than the backend expects.** Hex (32 chars) is standard; emit it consistently or correlation silently fails.
- **PII in attributes shipped to a third-party backend.** Emails, card numbers in spans/logs. Scrub in the Collector (`attributes` processor) before export.
- **Mismatched propagators.** One service uses B3, another W3C — traces split at the boundary. Configure a composite propagator during migration.

---

## Common Mistakes

1. **Treating OTel as just a tracing library.** It's the unifying standard for *all four signals* with shared context — that's the point.
2. **All auto, no manual.** Lots of framework spans, zero business attributes — you can trace the plumbing but not answer "which customer / plan / version."
3. **No context propagation strategy for async.** Beautiful HTTP traces that snap at the first Kafka publish.
4. **Skipping exemplars**, then wondering why you can't get from a metric spike to a trace.
5. **Over-spanning.** A span per function call buries the signal. Span meaningful operations only.
6. **Hard-coding a vendor exporter in app code** instead of exporting OTLP to a Collector — you lose the ability to change anything downstream.
7. **Random sampling that loses errors.** The rare failing trace is the one you wanted; don't let head sampling eat it.
8. **Not splitting success vs error latency**, letting fast failures flatter the p99.

---

## Tricky Points

1. **The OTel API and SDK are separate on purpose.** Code/libraries call the *API*; nothing happens until an application installs the *SDK*. This is why instrumented libraries don't force a backend on you.
2. **A sampling decision is part of the propagated context.** The `traceparent` sampled-flag tells downstream services whether the trace is being kept. If they ignore it, you get half-traces.
3. **Exemplars only work if the metric is recorded *inside* an active span** — the SDK reads the current `trace_id` at record time. Record the histogram observation where the span is current.
4. **Resource attributes are a cardinality multiplier.** Every distinct `(service, version, host, region)` combination is a separate stream — `host.name` per pod in a big fleet can be its own cardinality problem (more in [`professional.md`](professional.md)).
5. **"Logs in OTel" is the least mature signal** — many teams still ship logs via their existing stack and only stamp the `trace_id` for correlation. That's a legitimate middle-ground.
6. **Auto-instrumentation version skew** can silently change span names/attributes across a library upgrade, breaking dashboards built on them. Pin and review.

---

## Test Yourself

1. Name the three layers of OpenTelemetry. Which one do you touch when writing instrumentation code?
2. Why does OTel separate the API from the SDK? What does that enable for third-party libraries?
3. A trace splits into single-service fragments at a Kafka boundary. What's wrong and how do you fix it?
4. Give the RED signals and the USE signals. Which is for services, which for resources?
5. What is an exemplar, and what must be true at record time for one to attach?
6. Head vs tail sampling — give one advantage of each and the failure mode of naïve head sampling.
7. You want PII scrubbed before telemetry reaches a SaaS backend. Where do you do it and why there?
8. Take a two-service demo. Instrument both with OTel, propagate context, and confirm one connected trace spans both. Then add an exemplar and jump from a metric to a trace.

---

## Tricky Questions

**Q1: Why use OpenTelemetry instead of my backend vendor's own SDK?**

Vendor neutrality and unification. With OTel you instrument *once* and can point at any backend (or several at once) by changing the Collector's exporters — no re-instrumentation when you switch vendors. And all four signals share context (`trace_id`, resource attributes, propagation), which is what makes correlation work. A vendor SDK locks your instrumentation to that vendor and often handles only one signal.

**Q2: Our traces are perfect within a service but never cross the network. Why?**

Context propagation isn't happening across the boundary. Either both services aren't using OTel's HTTP instrumentation (so the `traceparent` header isn't injected/extracted), or the hop is non-HTTP (a queue) where you must inject/extract manually, or the two ends use different propagators (B3 vs W3C). Fix the propagation and the fragments join into one trace.

**Q3: Should I auto-instrument or manually instrument?**

Both. Auto-instrument everywhere for breadth — it traces HTTP, DB, queues for free. Then manually add the *business* attributes and spans auto-instrumentation can't know about (`customer.plan`, `fraud.score`, "apply discount"). Auto gives coverage; manual gives the attributes that actually solve incidents.

**Q4: My p99 latency *dropped* during an incident customers are furious about. How?**

Almost certainly fast failures. Your service started returning 500s in 2ms, which drags the *overall* p99 down even as users get errors. The fix is to **split duration by status class** — success-latency and error-latency separately — so a flood of fast failures can't flatter your percentile.

**Q5: What's the minimum to correlate a metric spike with a specific trace?**

Exemplars. Configure your metrics SDK to attach the active `trace_id` to histogram observations, and record those observations *inside* the request span. Then your backend (Prometheus + a trace backend, or Honeycomb) lets you click a histogram data point and jump to the exact trace that produced it.

**Q6: We can't afford to keep every trace. How do we sample without going blind?**

Tail-based sampling in the Collector. Buffer each trace until it completes, then keep it if it errored or was slow, and keep only a small percentage of the boring fast ones. This guarantees you retain 100% of the interesting traces (errors, latency outliers) while cutting volume dramatically — unlike random head sampling, which drops rare failures. (Deep dive: [telemetry-cost](../telemetry-cost-and-sampling-strategy/).)

---

## Cheat Sheet

```text
┌──────────────────── OBSERVABILITY ENGINEERING — MIDDLE CHEAT SHEET ────────────────────────┐
│                                                                                             │
│  OPENTELEMETRY = spec + SDKs + Collector. instrument ONCE, vendor-neutral, all signals.    │
│    API (your code calls) │ SDK (samples/batches/exports) │ Collector (receive→process→export)│
│    signals: traces · metrics · logs · profiles  — all share context (trace_id, resource)    │
│                                                                                             │
│  CONTEXT PROPAGATION = the relay baton                                                      │
│    W3C 'traceparent' header. auto for HTTP. MANUAL for queues/jobs (inject/extract).        │
│    traces split into fragments → you dropped the baton (or mismatched propagators).         │
│                                                                                             │
│  INSTRUMENTATION STRATEGY                                                                   │
│    auto  = breadth (HTTP/DB/queue spans free)                                               │
│    manual = depth (business attributes: customer.plan, fraud.score; business spans)         │
│    span name = LOW cardinality (route template). high-cardinality detail → ATTRIBUTES.      │
│                                                                                             │
│  DEFAULT METRICS (don't invent them)                                                        │
│    RED  (services): Rate, Errors, Duration      USE (resources): Util, Saturation, Errors   │
│    split duration by success/error so fast-failures don't flatter p99.                      │
│                                                                                             │
│  CORRELATION (engineer each link)                                                           │
│    metric spike ──exemplar──► trace ──trace_id──► logs ──span_id──► profile                 │
│                                                                                             │
│  SAMPLING                                                                                   │
│    head  = decide at start (cheap, may drop errors)                                         │
│    tail  = decide at end in Collector (keep ALL errors + slow). prefer tail at scale.       │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **OpenTelemetry** is the vendor-neutral standard — **spec + SDKs + Collector** — unifying traces, metrics, logs, and profiles under shared context. It won because you instrument *once* and choose backends downstream; the API/SDK split lets libraries emit telemetry without forcing a backend.
- **Context propagation** (W3C `traceparent`) is what keeps a trace whole across services. It's automatic for HTTP, manual for queues/jobs — and the #1 reason traces break.
- **Instrumentation strategy**: auto-instrument for breadth, manually enrich for depth. Span meaningful operations; keep span *names* low-cardinality and put high-cardinality detail in *attributes*.
- **RED** (services) and **USE** (resources) are your default metric floor — don't reinvent them; split duration by success/error so fast failures don't flatter the p99.
- **Correlation is engineered**: exemplars link metrics→traces, `trace_id` links traces→logs, span-aware profiling links traces→profiles. The chain spike→trace→logs→profile is the debugging loop made real.
- **The Collector** is the hub where sampling, PII scrubbing, and backend changes live *without redeploying apps*. Run one even at small scale.
- **Sampling** controls cost; **tail-based** sampling keeps every error and slow trace while dropping the boring majority — prefer it over naïve head sampling, which eats the failures you need.

---

## What You Can Build

- A **two-service traced demo**: gateway → backend, both OTel-instrumented, context propagated, one trace spanning both. Then break propagation and watch it split.
- A **queue-propagation exercise**: a producer/consumer over Kafka or SQS where you inject/extract trace context into message headers so async work stays in the trace.
- A **RED dashboard generator**: a small library wrapper that, given an HTTP handler, emits rate/errors/duration automatically with success/error split.
- An **exemplar walkthrough**: histogram with exemplars wired, Grafana panel, click a spike → land on the exact trace. Document each link in the chain.
- A **Collector lab**: run the Collector locally, add an `attributes` processor that drops `user.email`, add tail sampling for errors, and fan out to Tempo + Prometheus + Loki — all without touching the app.

---

## Further Reading

- **OpenTelemetry docs** — <https://opentelemetry.io/docs/>. Concepts, language SDKs, Collector, semantic conventions.
- **W3C Trace Context** — <https://www.w3.org/TR/trace-context/>. The propagation standard.
- **Tom Wilkie — "The RED Method"** and **Brendan Gregg — "The USE Method"** — <https://www.brendangregg.com/usemethod.html>. The default metric frameworks.
- **OpenTelemetry semantic conventions** — <https://opentelemetry.io/docs/specs/semconv/>. Standard attribute names.
- **Grafana — "Exemplars"** docs and **Prometheus exemplars** — the metric→trace link.
- The `observability-stack` and `monitoring-alerting` skills — for backend/tooling and alert design.

---

## Related Topics

- **Down a level:** [junior.md](junior.md) — observability vs monitoring, the pillars, the wide event, `trace_id` correlation.
- **Up a level:** [senior.md](senior.md) — SLIs/SLOs/error budgets, designing what (and what *not*) to instrument, the debugging loop in production.
- **Professional:** [professional.md](professional.md) — Collector topology, backends, build-vs-buy, org-wide adoption.
- **Interview prep:** [interview.md](interview.md). **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Tracing — Middle](../tracing/middle.md) — spans and propagation in depth.
- [Metrics — Middle](../metrics/middle.md) — RED/USE and cardinality.
- [Logging — Middle](../logging/middle.md) — structured logs, the log half of correlation.
- [Continuous Profiling](../continuous-profiling/) — the span→profile link.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — sampling in depth.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — instrumenting without code changes.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — SLOs/error budgets.
- [Quality Engineering → Testing → Testing in Production](../../quality-engineering/testing/13-testing-in-production/) — observability as its prerequisite.

---

## Diagrams & Visual Aids

### The OTel architecture

```text
   ┌─ APP ────────────────────────┐
   │ code → OTel API (Tracer/Meter)│
   │            │                  │
   │       OTel SDK                │  sample · batch · export (OTLP)
   └────────────┼─────────────────┘
                ▼  OTLP
   ┌─ COLLECTOR ───────────────────────────────────────────────┐
   │ receivers ─► processors (batch, attributes, tail_sampling) │
   │                              └─► exporters                  │
   └───────────────────┬───────────────┬───────────────┬────────┘
                       ▼               ▼               ▼
                    Tempo           Prometheus        Loki
                   (traces)         (metrics)        (logs)
```

### Context propagation across a boundary

```text
   A: span aaaa (trace 7c1e)  ──HTTP──►  B: span bbbb (trace 7c1e, parent aaaa)
                  header: traceparent: 00-7c1e...-aaaa-01
   ✓ same trace_id, B parented to A = one connected trace
   ✗ header dropped (queue/mismatched propagator) = two split traces
```

### Auto vs manual instrumentation

```text
   AUTO (breadth)                         MANUAL (depth)
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │ HTTP server span         │  enrich  │ + customer.plan="enterp." │
   │ DB query span            │ ───────► │ + fraud.score=0.1         │
   │ outbound HTTP span       │          │ + span "apply.discount"   │
   └──────────────────────────┘          └──────────────────────────┘
   the plumbing, for free                 the business meaning, by hand
```

### The correlation chain

```text
   [metric: latency spike] ──exemplar(trace_id)──► [trace: slow span]
                                                        │
                                          trace_id ─────┼───── span_id
                                                        ▼           ▼
                                                   [logs for     [profile: hot
                                                    this request]  funcs in span]
```

---
