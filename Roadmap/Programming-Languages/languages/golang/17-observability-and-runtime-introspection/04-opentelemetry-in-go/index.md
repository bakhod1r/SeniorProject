---
layout: default
title: OpenTelemetry in Go
parent: Observability & Runtime Introspection
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/17-observability-and-runtime-introspection/04-opentelemetry-in-go/
---

# OpenTelemetry in Go

[← Back](../)

We explore OpenTelemetry (OTel) with the Go SDK — the vendor-neutral standard for producing **traces, metrics, and logs** from a Go service. Unlike `runtime/trace`, which captures in-process scheduler events, OpenTelemetry is built for **cross-service distributed tracing**: a request that fans out across HTTP and gRPC boundaries becomes a single connected trace, exportable to Jaeger, Tempo, Prometheus, or any vendor backend over OTLP.

## Sub-pages

- [junior.md](junior.md) — What OTel is, the three signals, a first instrumented HTTP handler
- [middle.md](middle.md) — The API/SDK split, the trace pipeline, propagation, metric instruments
- [senior.md](senior.md) — Sampling strategy, cardinality, cost, semantic conventions, vendor lock-in
- [professional.md](professional.md) — Provider lifecycle, batching internals, the Collector, hermetic shutdown
- [specification.md](specification.md) — The OTel data model, module paths, OTLP, W3C Trace Context
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-instrumentation scenarios
- [optimize.md](optimize.md) — Reducing overhead, cardinality, and export cost
