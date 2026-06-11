# Tracing Roadmap

> *"A trace is the story of one request — told by every service that touched it."*

This roadmap is about **distributed tracing as it appears inside the code** — instrumenting spans, propagating context, choosing what's a span vs a log, and avoiding the "trace everything" trap. It's the third pillar of observability alongside [Logging](../logging/) and [Metrics](../metrics/).

> Looking for the *system-design* angle (collector topology, storage backends, Jaeger / Tempo / Honeycomb architecture)? See [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/).
>
> This section is the **language-level** discipline — what your code emits, how spans are linked, how context crosses an `await` or a thread boundary.

---

## Why a Dedicated Roadmap

Distributed tracing is the diagnostic tool that *changes how you read code*:

- Logs tell you what each service said.
- Metrics tell you the aggregate shape.
- **Traces tell you the actual path** one request took, end-to-end, including the slow span you didn't suspect.

The hard parts aren't the SDK — they're **context propagation across async boundaries**, **deciding what's worth a span**, and **sampling without losing the interesting traces**.

| Roadmap | Question it answers |
|---|---|
| [Logging](../logging/README.md) | What did each service say? |
| [Metrics](../metrics/README.md) | What does it look like at aggregate? |
| **Tracing** (this) | What path did *this one* request take? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Trace, Span, Context | The data model; parent/child, root span, span attributes/events |
| 02 | OpenTelemetry SDK | The cross-language standard; tracer, span, propagator, exporter |
| 03 | Context Propagation | W3C Trace Context (`traceparent` header), B3, baggage; how a trace stays whole across services |
| 04 | Propagation Across Async / Threads | Why a context disappears across `await` or a goroutine; explicit vs implicit propagation |
| 05 | Manual Instrumentation | When to start a span, naming conventions, attributes vs events |
| 06 | Auto-Instrumentation | Java agents, Python `opentelemetry-instrument`, what they catch and miss |
| 07 | Sampling | Head-based vs tail-based sampling; rate-based vs always-on for errors |
| 08 | Span Events vs Logs | When a log should be an event on a span; the unifying trend |
| 09 | Linking Spans to Logs & Metrics | Trace ID in logs, exemplars on metrics, correlated views |
| 10 | Debugging With Traces | Reading a trace, identifying slow spans, missing spans, broken propagation |
| 11 | Cost & Overhead | Per-span allocation cost, exporter batch tuning, tail-sampling complexity |
| 12 | Anti-patterns | "Trace every function," missing parent links, log-spam-as-spans, leaking PII into attributes |

---

## Languages

Examples in **Go** (`go.opentelemetry.io/otel`), **Java** (OpenTelemetry SDK, Java agent), **Python** (`opentelemetry-sdk`, automatic instrumentation), **Node** (`@opentelemetry/*`), **Rust** (`tracing` + `tracing-opentelemetry`).

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Distributed Tracing in Practice* — Parker, Spoonhower, Mace, Sigelman
- *Mastering Distributed Tracing* — Yuri Shkuro (the Jaeger author)
- *OpenTelemetry Specification* — opentelemetry.io
- *Dapper, a Large-Scale Distributed Systems Tracing Infrastructure* — Sigelman et al. (the Google paper that started it all)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
