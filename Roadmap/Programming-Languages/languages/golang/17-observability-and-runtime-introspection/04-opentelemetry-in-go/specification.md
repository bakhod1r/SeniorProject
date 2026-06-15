# OpenTelemetry in Go — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where OpenTelemetry Is Specified](#where-opentelemetry-is-specified)
3. [The Signal Model](#the-signal-model)
4. [The Trace Data Model](#the-trace-data-model)
5. [The Metrics Data Model](#the-metrics-data-model)
6. [Resources and Attributes](#resources-and-attributes)
7. [Context Propagation: W3C Trace Context and Baggage](#context-propagation-w3c-trace-context-and-baggage)
8. [OTLP: The Wire Protocol](#otlp-the-wire-protocol)
9. [The Go API/SDK Module Map](#the-go-apisdk-module-map)
10. [Semantic Conventions Versioning](#semantic-conventions-versioning)
11. [Stability Guarantees](#stability-guarantees)
12. [References](#references)

---

## Introduction

OpenTelemetry is specified by the **OpenTelemetry Specification**, a language-agnostic document, plus per-language implementations. The Go implementation (`opentelemetry-go`) conforms to that spec. Unlike a Go standard-library topic, the authority is not `go.dev/ref/spec`; it is the OpenTelemetry project's specification and the Go module APIs on `pkg.go.dev`.

Sources of truth, in decreasing formality:

1. **OpenTelemetry Specification** — `opentelemetry.io/docs/specs/otel/` (data model, API, SDK semantics).
2. **OTLP specification** — `opentelemetry.io/docs/specs/otlp/` (the wire protocol).
3. **Semantic Conventions** — `opentelemetry.io/docs/specs/semconv/` (attribute keys).
4. **Go API/SDK reference** — `pkg.go.dev/go.opentelemetry.io/otel` and submodules.

This file separates "what the OpenTelemetry spec defines" from the concrete Go module paths that implement it.

---

## Where OpenTelemetry Is Specified

The specification is organized by concern:

- **API** — the surface that instrumentation calls (tracer/meter/logger, span, context). Stable.
- **SDK** — the configurable implementation (providers, processors, exporters, samplers, readers).
- **Data model** — the precise structure of a span, a metric point, a log record.
- **Context propagation** — how `SpanContext` and baggage cross process boundaries.
- **OTLP** — the protobuf-based protocol for transmitting telemetry.
- **Semantic conventions** — agreed attribute names and values.

The Go project implements each part as a separate module so that the **API** can be depended upon by libraries without pulling in the **SDK**.

---

## The Signal Model

OpenTelemetry defines exactly three **signals**:

| Signal | Unit of data | Question answered |
|--------|-------------|-------------------|
| **Traces** | Spans (forming a trace) | How did one request flow across services? |
| **Metrics** | Measurements aggregated into metric points | What are the rates/latencies/counts over time? |
| **Logs** | Log records | What was the detailed state at a point in time? |

The signals share a common **context** (so a log record and a metric exemplar can reference a trace), a common **resource**, and common **attribute** semantics. They are configured through parallel provider types: `TracerProvider`, `MeterProvider`, `LoggerProvider`.

---

## The Trace Data Model

The spec defines a **span** as the primitive of tracing. Required and notable fields:

- **Name** — operation name; should be low-cardinality.
- **SpanContext** — immutable, propagatable: **TraceID** (16 bytes), **SpanID** (8 bytes), **TraceFlags** (includes the *sampled* bit), and **TraceState** (vendor key/value list).
- **ParentSpanID** — links a span to its parent, forming the trace tree.
- **SpanKind** — one of `INTERNAL`, `SERVER`, `CLIENT`, `PRODUCER`, `CONSUMER`.
- **StartTimeUnixNano / EndTimeUnixNano** — timestamps.
- **Attributes** — typed key/value pairs (string, bool, int64, float64, and homogeneous arrays).
- **Events** — timestamped `(name, attributes)` records within the span. Errors are recorded as events.
- **Links** — references to other `SpanContext`s (possibly other traces), each with attributes.
- **Status** — `Unset`, `Ok`, or `Error` with a description.

A **trace** is the set of spans sharing one TraceID; the parent relationships define its tree. The TraceID is generated at the root and propagated unchanged to every span in the trace.

The Go API expresses these as the `trace.Span` interface (`SetName`, `SetAttributes`, `AddEvent`, `AddLink`, `RecordError`, `SetStatus`, `End`), `trace.SpanContext`, and `trace.SpanKind`.

---

## The Metrics Data Model

The spec defines **instruments** that produce **measurements**, aggregated into **metric points**.

Instrument kinds:

| Instrument | Synchronous? | Monotonic? | Typical aggregation |
|-----------|-------------|-----------|---------------------|
| Counter | yes | yes (non-negative additions) | Sum |
| UpDownCounter | yes | no | Sum |
| Histogram | yes | n/a | Explicit-bucket histogram |
| Gauge (sync, newer) | yes | n/a | Last value |
| Observable Counter | no (callback) | yes | Sum |
| Observable UpDownCounter | no (callback) | no | Sum |
| Observable Gauge | no (callback) | n/a | Last value |

Each metric point carries **attributes**, a **time window**, an **aggregation**, and an **aggregation temporality** — **cumulative** (since start) or **delta** (since last collection). Temporality is a model-level property; the chosen value must match the consuming backend (Prometheus consumes cumulative).

The Go SDK expresses this via `metric.Meter` (instrument constructors), `sdkmetric.Reader`, `sdkmetric.View`, and aggregation types.

---

## Resources and Attributes

A **Resource** is an immutable set of attributes describing the entity that produces telemetry (a service, host, container, process). It is attached to every span, metric, and log from that source. The spec mandates the attribute `service.name`; conventionally also `service.version`, `service.instance.id`, `deployment.environment`, and host/process attributes.

**Attributes** are typed key/value pairs. Permitted value types: string, boolean, signed 64-bit integer, double, and arrays of a single primitive type. Keys are dot-namespaced strings (`http.request.method`). The same attribute model is used for resources, spans, span events, links, and metric points.

In Go: `go.opentelemetry.io/otel/attribute` (`attribute.KeyValue`, typed constructors) and `go.opentelemetry.io/otel/sdk/resource`.

---

## Context Propagation: W3C Trace Context and Baggage

Propagation is specified separately and follows W3C standards.

### W3C Trace Context

Two HTTP headers carry trace context across services:

- **`traceparent`** — `version-traceid-spanid-traceflags`, e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`. The trailing `01` is the sampled flag.
- **`tracestate`** — a vendor-extensible list of key/value pairs for additional, vendor-specific trace data.

The propagator reads these on inbound requests (extract) and writes them on outbound requests (inject). In Go: `propagation.TraceContext{}`.

### Baggage

**Baggage** is application-defined key/value data propagated alongside trace context via the **`baggage`** header (W3C Baggage spec). It is not automatically copied onto spans. In Go: `propagation.Baggage{}` and the `go.opentelemetry.io/otel/baggage` package.

The Go convention is to install a composite propagator:

```go
propagation.NewCompositeTextMapPropagator(
    propagation.TraceContext{}, propagation.Baggage{})
```

Note: the **default** global propagator is a **no-op**; propagation does nothing until one is set.

---

## OTLP: The Wire Protocol

**OTLP** (OpenTelemetry Protocol) is the spec's native transport. It defines protobuf message schemas for traces, metrics, and logs, and two transports:

- **OTLP/gRPC** — protobuf over gRPC (HTTP/2). Default endpoint port **4317**.
- **OTLP/HTTP** — protobuf (or JSON) over HTTP/1.1. Default endpoint port **4318**, path `/v1/traces`, `/v1/metrics`, `/v1/logs`.

OTLP specifies retryable vs non-retryable responses, partial-success semantics, and gzip compression. It is the protocol every OTel exporter and the Collector speak. In Go: `exporters/otlp/otlptrace/otlptracegrpc`, `.../otlptracehttp`, and the metric equivalents.

---

## The Go API/SDK Module Map

The Go implementation is split into modules so libraries can depend on the API alone:

| Module path | Role |
|-------------|------|
| `go.opentelemetry.io/otel` | API root: global providers, `Tracer`, `Meter` accessors, error handler. |
| `go.opentelemetry.io/otel/trace` | Trace **API**: `Span`, `Tracer`, `SpanContext`, `SpanKind`. |
| `go.opentelemetry.io/otel/metric` | Metrics **API**: `Meter`, instrument interfaces. |
| `go.opentelemetry.io/otel/baggage` | Baggage API. |
| `go.opentelemetry.io/otel/propagation` | Propagators: `TraceContext`, `Baggage`. |
| `go.opentelemetry.io/otel/attribute` | Attribute types. |
| `go.opentelemetry.io/otel/sdk/trace` | Trace **SDK**: `TracerProvider`, processors, samplers. |
| `go.opentelemetry.io/otel/sdk/metric` | Metrics **SDK**: `MeterProvider`, readers, views. |
| `go.opentelemetry.io/otel/sdk/resource` | Resource construction and detectors. |
| `go.opentelemetry.io/otel/exporters/stdout/stdouttrace` | Stdout trace exporter. |
| `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc` | OTLP/gRPC trace exporter. |
| `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp` | OTLP/HTTP trace exporter. |
| `go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc` | OTLP/gRPC metric exporter. |
| `go.opentelemetry.io/otel/exporters/prometheus` | Prometheus (pull) metric exporter. |
| `go.opentelemetry.io/otel/semconv/vX.Y.Z` | Versioned semantic-convention constants. |
| `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` | net/http instrumentation. |
| `go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc` | gRPC instrumentation. |

The API and SDK modules are versioned together (e.g. `v1.x`); the contrib modules and metric SDK have moved through their own version timelines — pin versions and bump deliberately.

---

## Semantic Conventions Versioning

Semantic conventions are versioned independently of the API/SDK. The Go `semconv` package ships one sub-package per spec version (`semconv/v1.20.0`, `semconv/v1.26.0`, …). Constants and recommended keys can **change between versions** — notably the HTTP conventions were reworked (`http.method` → `http.request.method`, `http.status_code` → `http.response.status_code`). Code importing two different `semconv` versions emits inconsistent attribute keys. The specification treats semantic conventions as stable *within* a version and explicitly versioned across them; pin one version per system.

---

## Stability Guarantees

OpenTelemetry signals reach stability independently:

- **Tracing** — API and SDK are **stable** (v1.0+). The trace data model and W3C propagation are settled.
- **Metrics** — API and SDK are **stable** (reached after tracing). Temporality, instruments, and views are part of the stable surface.
- **Logs** — stabilized later than traces and metrics; the Go logs SDK and the `slog` bridge are the integration points. Treat logs as the most recently stabilized signal and check current status.
- **Baggage / propagation** — stable.

Within a stable signal, the project follows semantic-versioning compatibility for the `v1` modules. Experimental features live behind clearly named, separately versioned modules. The practical rule: build on the stable trace and metric APIs, pin module and `semconv` versions, and adopt newer signals/features deliberately after checking their stability level.

---

## References

- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/) — authoritative, language-agnostic.
- [OpenTelemetry Go documentation](https://opentelemetry.io/docs/languages/go/)
- [`go.opentelemetry.io/otel` reference](https://pkg.go.dev/go.opentelemetry.io/otel)
- [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [W3C Baggage](https://www.w3.org/TR/baggage/)
- [opentelemetry-go (source)](https://github.com/open-telemetry/opentelemetry-go)
- [opentelemetry-go-contrib (source)](https://github.com/open-telemetry/opentelemetry-go-contrib)
