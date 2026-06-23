# OpenTelemetry in Go — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is OpenTelemetry?" and "How do I make my Go service emit a trace?"

You have a Go service. A request comes in, it calls a database, it calls another service, and somewhere it gets slow. Logs tell you *that* something happened; they do not tell you *how the pieces connect* across services. **OpenTelemetry** (OTel for short) is the standard answer to that problem. It is a single, vendor-neutral way to produce three kinds of telemetry — **traces**, **metrics**, and **logs** — and ship them to whatever backend you like (Jaeger, Grafana Tempo, Prometheus, Datadog, Honeycomb, …).

This is different from Go's built-in `runtime/trace`. That tool records what the Go *scheduler* did inside one process — goroutines, GC, blocking. OpenTelemetry records what your *application* did across the whole system: "request X entered service A, called service B over HTTP, which queried Postgres, and the Postgres call took 240 ms." OTel is about **distributed tracing**; `runtime/trace` is about **in-process scheduler tracing**. Keep that distinction in your head — it comes up constantly.

The simplest thing OTel does is create a **span**. A span is a timed operation with a name, a start, an end, and some attributes:

```go
ctx, span := tracer.Start(ctx, "handleCheckout")
defer span.End()
```

That is the whole heartbeat of tracing. Everything else — exporters, propagation, sampling — is plumbing around that one idea.

After reading this file you will:
- Understand what OpenTelemetry is and why it exists
- Know the three signals: traces, metrics, logs
- Know the vocabulary: span, trace ID, attribute, exporter, propagation
- Wire up a `TracerProvider` and create your first span
- Instrument an HTTP handler so a request produces a real trace
- Understand why you must call `Shutdown` before the program exits

You do **not** need to understand sampling math, the Collector's internals, or semantic conventions yet. This file is about the moment you say "I want to *see* what my request did, across services."

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. Check with `go version`.
- **Required:** A Go module (`go mod init ...`). See [06-code-organization/01-modules-and-dependencies/01-go-mod-init](../../06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md).
- **Required:** Comfort with `context.Context` — OTel threads everything through `ctx`. See [05-context/01-context-basics](../../05-context-and-cancellation/01-context-package/junior.md) if you are shaky on it.
- **Required:** Basic `net/http` server experience (`http.HandleFunc`, handlers).
- **Helpful:** Having run a local backend like Jaeger in Docker, so you can *see* your spans. We will use the `stdouttrace` exporter first, which needs nothing but a terminal.

If `go version` prints `go1.21` or higher and you can write a `net/http` handler, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **OpenTelemetry (OTel)** | A vendor-neutral standard and set of SDKs for producing traces, metrics, and logs. |
| **Signal** | One of the three telemetry types: **traces**, **metrics**, **logs**. |
| **Span** | A single timed operation: a name, start time, end time, attributes, and a status. The atom of a trace. |
| **Trace** | A tree of spans sharing one **trace ID** — the full story of one request across services. |
| **Trace ID / Span ID** | Identifiers. The trace ID is shared by every span in one request; each span also has its own span ID. |
| **Attribute** | A typed key/value pair attached to a span (e.g. `http.status_code = 200`). |
| **Tracer** | The object you call `Start` on to create spans. Obtained from a `TracerProvider`. |
| **TracerProvider** | The factory that holds configuration (exporter, sampler, resource) and hands out `Tracer`s. |
| **Exporter** | The component that ships telemetry out of your process — e.g. `stdouttrace` (to the console) or `otlptracegrpc` (to a collector). |
| **Propagation** | Passing trace context across a network boundary, via HTTP/gRPC headers, so two services share one trace. |
| **Resource** | Metadata describing *what* is producing the telemetry, e.g. `service.name = checkout`. |
| **OTLP** | OpenTelemetry Protocol — the wire format used to send telemetry to a collector or backend. |
| **Shutdown** | The call that flushes buffered telemetry before the program exits. Skipping it loses your last spans. |

---

## Core Concepts

### A span is a timed operation

Mechanically, a span has:
- a **name** (`"handleCheckout"`),
- a **start time** (set when you call `Start`),
- an **end time** (set when you call `End`),
- a set of **attributes** (key/value pairs),
- a **status** (OK or Error),
- a parent (the span it was created under), giving the trace its tree shape.

You create one, do some work, and end it:

```go
ctx, span := tracer.Start(ctx, "handleCheckout")
defer span.End()
// ... do the work ...
```

`Start` returns a **new `ctx`** that carries the span. You must use *that* `ctx` for any nested work, or the child spans will not connect. This is the single most important habit in OTel.

### A trace is a tree of spans

When `handleCheckout` calls `chargeCard`, and `chargeCard` starts its own span using the `ctx` it received, the two spans share a **trace ID** and `chargeCard`'s span records `handleCheckout` as its parent. Repeat that across functions and across services, and you get a tree: the **trace**. In a UI like Jaeger, you see it as a waterfall of nested bars.

### The three signals

OpenTelemetry produces three kinds of data:

- **Traces** — the request-flow story (spans). This file focuses here.
- **Metrics** — numeric measurements over time (request count, latency histogram, queue depth). Covered more in `middle.md`.
- **Logs** — structured log records that can be correlated to a trace by trace ID.

You can adopt them independently. Most teams start with traces.

### The pipeline: producer → exporter → backend

Your code produces spans. A **TracerProvider** holds an **exporter**. When a span ends, it eventually reaches the exporter, which serializes it (often as **OTLP**) and sends it to a backend. For learning, the `stdouttrace` exporter just prints JSON to your terminal — no backend required.

```
your code → Tracer → TracerProvider → exporter → (stdout | OTLP → collector → Jaeger)
```

### Resource: who is talking

Every piece of telemetry should say *which service* produced it. That is the **resource** — most importantly `service.name`. Without it, your spans show up as "unknown_service" in the UI. Set it once when you build the provider.

### Shutdown flushes

For performance, spans are batched, not sent one at a time. So when your program is about to exit, there may be spans still sitting in a buffer. You must call `provider.Shutdown(ctx)` to flush them. Forget this, and the last few spans of every run silently vanish.

---

## Real-World Analogies

**1. A package-tracking number.** When you ship a parcel, it gets one tracking number that follows it through every depot, truck, and plane. The trace ID is that number; each scan along the way is a span. Open the tracking page and you see the whole journey as one connected timeline — even though a dozen separate facilities handled it.

**2. A relay race baton.** Each runner is a service. The baton is the trace context. As long as each runner hands the baton to the next, the timing system knows it is one race. Drop the baton (forget to propagate context) and the next runner starts a brand-new, disconnected race.

**3. A hospital chart that follows the patient.** A patient (the request) moves from reception to triage to radiology to surgery. One chart travels with them; each department adds a timestamped note. Without the shared chart, every department keeps its own isolated record and nobody can reconstruct the visit.

**4. A receipt printer with a buffer.** The till batches sales and prints them in groups to save paper-feed time. If you yank the power before it flushes, the last few sales never print. `Shutdown` is pressing "print remaining receipts" before pulling the plug.

---

## Mental Models

### Model 1 — `ctx` is the trace's bloodstream

The active span lives inside `context.Context`. Every function that wants to be part of the trace must accept `ctx` and pass along the `ctx` returned by `Start`. If a function does not get the right `ctx`, its spans float off as orphans.

### Model 2 — API vs SDK

OpenTelemetry splits into an **API** (the interfaces: `Tracer`, `Span`, `Meter`) and an **SDK** (the implementation: providers, exporters, samplers). Your business code and libraries import only the **API**. Your `main` wires up the **SDK** once. This split is why a library can be instrumented without forcing a backend on you.

### Model 3 — Instrument once at the edges, enrich in the middle

You get the most value by instrumenting the **boundaries**: incoming HTTP requests, outgoing HTTP/gRPC calls, database queries. Ready-made middleware (`otelhttp`, `otelgrpc`) does this for you. Inside, you add a few hand-written spans for the interesting business steps.

### Model 4 — Telemetry is a side effect, not the logic

Instrumentation should never change what your program *does*. A span that fails to export must not break the request. OTel is built around this: a misconfigured exporter degrades observability, it does not crash your service.

### Model 5 — The provider is global plumbing; the tracer is local

You configure the heavy machinery (provider + exporter) once in `main`. Throughout the code you just grab a tracer by name and start spans. Think "wire the building's electricity once, then plug in lamps anywhere."

---

## Pros & Cons

### Pros

- **Vendor-neutral.** Instrument once; switch backends (Jaeger → Tempo → a SaaS) by changing only the exporter config.
- **Cross-service.** A single trace spans every service a request touches — the thing logs cannot do.
- **Standardized.** Semantic conventions mean `http.method` means the same thing everywhere; dashboards are portable.
- **Three signals, one SDK.** Traces, metrics, and logs share context and configuration.
- **Rich ecosystem.** Instrumentation libraries exist for `net/http`, gRPC, database/sql, Kafka, and more.

### Cons

- **Setup ceremony.** The first wiring (provider, exporter, propagator, resource, shutdown) is a chunk of boilerplate.
- **Context discipline required.** Forget to pass `ctx` and your traces silently break.
- **Cardinality footguns.** Putting a user ID or unbounded value in an attribute can explode backend cost.
- **Overhead, if careless.** Sampling 100% of a high-QPS service produces a firehose. You must think about sampling.
- **Moving target (historically).** The Go API stabilized, but older tutorials reference dead packages. Use current module paths.

The trade is real: a modest amount of setup and discipline buys you cross-service visibility that no amount of logging can replace.

---

## Use Cases

Reach for OpenTelemetry when:

- **You run more than one service** and need to follow a request across them.
- **You need to find *where* latency lives** — which downstream call is slow, not just that the request was slow.
- **You want portable instrumentation** that is not locked to one vendor's agent.
- **You need to correlate logs, metrics, and traces** by trace ID.
- **You are adopting a service mesh / cloud-native stack** where OTLP and the Collector are the lingua franca.

You can skip it (or defer it) when:

- You have a single small binary and `log` plus `expvar` already answer your questions.
- You only care about in-process scheduler behavior — that is `runtime/trace`'s job, not OTel's.
- You are writing a short-lived CLI tool with no network calls worth tracing.

---

## Code Examples

### Example 1 — A span printed to your terminal (no backend needed)

This is the smallest complete program. It uses the `stdouttrace` exporter, so spans print as JSON.

```go
package main

import (
	"context"
	"log"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func main() {
	ctx := context.Background()

	exporter, err := stdouttrace.New(stdouttrace.WithPrettyPrint())
	if err != nil {
		log.Fatal(err)
	}

	res := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName("hello-otel"),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	defer func() { _ = tp.Shutdown(ctx) }() // flush on exit

	otel.SetTracerProvider(tp)

	tracer := otel.Tracer("main")
	ctx, span := tracer.Start(ctx, "say-hello")
	span.SetAttributes(/* attribute here in Example 3 */)
	doWork(ctx)
	span.End()
}

func doWork(ctx context.Context) {
	_, span := otel.Tracer("main").Start(ctx, "do-work")
	defer span.End()
	// pretend to do something
}
```

Run it and you will see two JSON spans printed: `do-work` nested under `say-hello`, sharing one trace ID. That nesting happened *only* because `doWork` received the `ctx` returned by `Start`.

### Example 2 — The same, but sending to a collector over OTLP/gRPC

Swap the exporter; everything else is identical. This is the realistic setup.

```go
import (
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
)

exporter, err := otlptracegrpc.New(ctx,
	otlptracegrpc.WithEndpoint("localhost:4317"),
	otlptracegrpc.WithInsecure(), // dev only; use TLS in prod
)
```

`localhost:4317` is the default OTLP/gRPC port for a Collector or a Jaeger all-in-one container. Nothing else in the program changes — that is the point of the vendor-neutral design.

### Example 3 — Attributes and recording an error

```go
import "go.opentelemetry.io/otel/attribute"
import "go.opentelemetry.io/otel/codes"

ctx, span := tracer.Start(ctx, "charge-card")
defer span.End()

span.SetAttributes(
	attribute.String("payment.provider", "stripe"),
	attribute.Int("payment.amount_cents", 1999),
)

if err := charge(ctx); err != nil {
	span.RecordError(err)               // attaches the error as an event
	span.SetStatus(codes.Error, "charge failed")
	return err
}
span.SetStatus(codes.Ok, "")
```

`RecordError` adds the error message and stack to the span. `SetStatus(codes.Error, ...)` marks the span red in the UI. Together they make failures jump out in a trace.

### Example 4 — An instrumented HTTP handler

This is the payoff. `otelhttp` wraps your handler and creates a span per request automatically.

```go
import (
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
)

func checkoutHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context() // already carries the server span from otelhttp

	_, span := otel.Tracer("checkout").Start(ctx, "validate-cart")
	// ... business logic ...
	span.End()

	w.Write([]byte("ok"))
}

func main() {
	// ... build tp and otel.SetTracerProvider(tp) as in Example 1 ...

	handler := http.HandlerFunc(checkoutHandler)
	// Wrap it: every request now gets a server span automatically.
	http.Handle("/checkout", otelhttp.NewHandler(handler, "checkout"))
	http.ListenAndServe(":8080", nil)
}
```

Hit `/checkout` and you get a parent server span (`checkout`) with a child span (`validate-cart`) — created because the handler used `r.Context()`, which `otelhttp` populated.

### Example 5 — Propagating context to a downstream service

When you call another service, inject the trace context into the outgoing request so the two services share one trace.

```go
import "go.opentelemetry.io/otel"

// Tell OTel how to read/write trace headers (do this once in main):
otel.SetTextMapPropagator(propagation.TraceContext{})

// An outgoing call that carries the trace:
client := http.Client{
	Transport: otelhttp.NewTransport(http.DefaultTransport),
}
req, _ := http.NewRequestWithContext(ctx, "GET", "http://inventory:8080/stock", nil)
resp, _ := client.Do(req) // trace headers are injected automatically
```

`otelhttp.NewTransport` injects W3C `traceparent` headers; the receiving service's `otelhttp.NewHandler` reads them and continues the same trace.

---

## Coding Patterns

### Pattern: one setup function returning a shutdown closure

```go
func initTracer(ctx context.Context) (func(context.Context) error, error) {
	exporter, err := otlptracegrpc.New(ctx, otlptracegrpc.WithInsecure())
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(mustResource()),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return tp.Shutdown, nil
}
```

In `main`: `shutdown, _ := initTracer(ctx); defer shutdown(ctx)`. Clean, testable, one source of truth.

### Pattern: `defer span.End()` immediately after `Start`

Always write `defer span.End()` on the line right after `Start`. This guarantees the span closes even if the function returns early on an error.

### Pattern: name spans after operations, not values

`Start(ctx, "get-user")` — good. `Start(ctx, "get-user-12345")` — bad, that user ID belongs in an **attribute**, not the span name. Span *names* are low-cardinality; values go in attributes.

### Pattern: let middleware do the boundaries

Use `otelhttp.NewHandler` / `otelhttp.NewTransport` and `otelgrpc` interceptors instead of hand-writing boundary spans. They follow semantic conventions for free.

---

## Clean Code

- **Set `service.name` via a `resource`** — never leave telemetry as "unknown_service".
- **Always pass the `ctx` returned by `Start`** to nested calls. Shadowing the variable (`ctx, span := ...`) makes this automatic.
- **Pair every `Start` with a `defer span.End()`** on the next line.
- **Do not log *and* span the same thing verbosely.** Pick the right signal; correlate by trace ID.
- **Keep span names static and short.** Dynamic data is attributes.
- **Centralize provider setup** in one `initTracer`/`initMeter` function, returned as a shutdown closure.

---

## Product Use / Feature

When you ship a service with OpenTelemetry:

- **On-call gets a trace waterfall** for any slow request, showing exactly which downstream call cost the time.
- **SREs build SLO dashboards** from OTel metrics (latency histograms, error rates) without per-vendor agents.
- **Incident response is faster:** paste a trace ID, see the whole cross-service path.
- **Capacity planning** uses the same metrics pipeline.
- **Vendor migrations are cheap:** point the exporter at a new backend; instrumentation does not change.

For teams running microservices, distributed tracing is often the difference between "the system is slow somewhere" and "service B's cache call is the problem."

---

## Error Handling

OTel setup can fail, and your code must degrade gracefully — telemetry problems should never take down the request path.

### Exporter construction fails

`otlptracegrpc.New` returns an error if the endpoint is malformed. Handle it in `main` and decide: fail fast (refuse to start) or run without tracing. For most services, log a warning and continue.

### The backend is unreachable

A `BatchSpanProcessor` buffers and retries; it does not block your handlers. If the collector is down, spans are dropped after the buffer fills — your requests keep serving. This is by design.

### Recording errors *on* a span

Use `span.RecordError(err)` plus `span.SetStatus(codes.Error, msg)`. `RecordError` alone does *not* mark the span as failed — you need `SetStatus` too. Forgetting `SetStatus` is the classic reason a trace shows an error event but a green span.

### Shutdown returns an error

`tp.Shutdown(ctx)` can time out while flushing. Give it a bounded context (`context.WithTimeout`) so a dead collector cannot hang your shutdown forever.

---

## Security Considerations

- **Attributes can leak PII.** Never put passwords, tokens, full emails, or raw request bodies in span attributes — they get shipped to the backend and stored. Redact first.
- **Use TLS for OTLP in production.** `WithInsecure()` is for local dev. Real exporters should use `WithTLSCredentials` and authenticate to the collector.
- **Trace headers cross trust boundaries.** A `traceparent` header from an untrusted client can be honored, letting an attacker inject trace IDs. For public-facing edges, consider stripping or re-rooting incoming trace context.
- **The Collector is an egress point.** Telemetry leaving your network is data leaving your network. Secure and audit the collector → backend hop.
- **Sampling decisions can reveal load patterns.** Rarely a concern, but be aware that trace volume correlates with traffic.

---

## Performance Tips

- **Use a `BatchSpanProcessor` (via `WithBatcher`)**, never `WithSyncer` in production — batching amortizes export cost.
- **Sample.** At high QPS, do not export 100% of traces. Start with `ParentBased(TraceIDRatioBased(0.1))` and tune.
- **Keep attributes bounded.** Each attribute is bytes on the wire and storage in the backend.
- **Reuse tracers** — `otel.Tracer("name")` is cheap, but a `Tracer` instance can be cached.
- **Span creation is cheap but not free.** Do not create a span per loop iteration in a hot path; span the loop, not each step.

---

## Best Practices

1. **Configure the provider once** in `main`, return a shutdown closure, `defer` it.
2. **Always set a `resource` with `service.name`.**
3. **Set a propagator** (`propagation.TraceContext{}`, often `NewCompositeTextMapPropagator` with Baggage) so cross-service traces connect.
4. **Instrument boundaries with middleware** (`otelhttp`, `otelgrpc`), hand-write spans only for interesting business steps.
5. **Pass `ctx` everywhere** and use the one `Start` returns.
6. **Pair `RecordError` with `SetStatus(codes.Error, ...)`.**
7. **Call `Shutdown` with a timeout** before exit.
8. **Use the API in libraries; the SDK only in `main`.**

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting to use the returned `ctx`

```go
ctx, span := tracer.Start(ctx, "parent")
doChild(context.Background()) // BUG: orphaned span, no parent
```

Pass the `ctx` from `Start`, not a fresh `context.Background()`. This is the #1 cause of "my child spans are not nested."

### Pitfall 2 — Not calling `Shutdown`

If `main` returns without `tp.Shutdown(ctx)`, the last batch of spans is lost. Always `defer` it.

### Pitfall 3 — No `service.name`

Spans appear as `unknown_service:<binary>` in the UI. Always set the resource.

### Pitfall 4 — High-cardinality attributes

`attribute.String("user.id", uid)` on every span can create millions of unique series in a metrics backend and bloat trace storage. Be deliberate about what goes in attributes.

### Pitfall 5 — Spawning a goroutine without propagating context

A goroutine that does not receive the parent `ctx` starts an orphan trace. Pass `ctx` into the goroutine (carefully — see the cancellation pitfall in `middle.md`).

### Pitfall 6 — `RecordError` without `SetStatus`

The span shows an error *event* but stays green. Reviewers think it succeeded. Always set the status too.

### Pitfall 7 — Using the no-op provider by accident

If you never call `otel.SetTracerProvider(tp)`, `otel.Tracer(...)` returns a **no-op** tracer that drops everything silently. Your code runs; no spans appear. Always register the provider.

### Pitfall 8 — Confusing OTel with `runtime/trace`

They are unrelated. `runtime/trace` (`go tool trace`) shows the scheduler; OTel shows request flow across services. Using one when you needed the other wastes hours.

---

## Common Mistakes

- **Skipping `otel.SetTracerProvider`** and wondering why nothing exports (no-op tracer).
- **Forgetting `Shutdown`**, losing the final spans.
- **Using `context.Background()` inside a request** instead of `r.Context()`, breaking parent-child links.
- **Putting dynamic values in span names** instead of attributes.
- **`WithSyncer` in production**, making every span a blocking network call.
- **Leaving `WithInsecure()` on** in a deployed service.
- **Pasting old tutorial code** that imports dead packages like `go.opentelemetry.io/otel/exporters/otlp` (the layout changed; use `.../otlp/otlptrace/otlptracegrpc`).
- **Recording errors without setting status.**

---

## Common Misconceptions

> *"OpenTelemetry is a backend / a UI."*

No. OTel produces and ships telemetry. The **UI** is Jaeger, Tempo, Grafana, Datadog, etc. OTel is the standard; the backend is separate.

> *"OTel and `runtime/trace` are the same thing."*

No. `runtime/trace` is in-process scheduler tracing. OTel is cross-service distributed tracing. Different tools, different questions.

> *"I have to send to a vendor."*

No. The `stdouttrace` exporter prints to your terminal; you can learn the whole model with zero backend.

> *"Spans connect automatically."*

Only if you thread `ctx`. The connection lives in `context.Context`; drop it and spans orphan.

> *"Logs are enough; I do not need tracing."*

Logs cannot show you the *shape* of a request across services. Tracing can. They complement, not replace, each other.

> *"Metrics and traces are configured separately and unrelated."*

They share the same SDK plumbing (resource, exporter, shutdown) and can be correlated by trace ID. Adopt them with one mental model.

---

## Tricky Points

- **`Start` returns a new `ctx`.** The returned `ctx` is the carrier; the original `ctx` does not know about the new span.
- **The global provider is a no-op until you set it.** `otel.Tracer` always returns something — but it does nothing until `SetTracerProvider` runs.
- **`otelhttp.NewHandler` reads incoming trace headers**, so a server span automatically continues an upstream trace — *if* a propagator is set.
- **Batching means delay.** A span you just ended may not appear in the backend for a second or two. That is the batch processor working, not a bug.
- **`span.End()` is idempotent-ish but call it once.** Calling `End` twice is a logic error; the second call is ignored, but it signals confused ownership.
- **Resource is set on the provider, not per span.** `service.name` is global to the process, by design.

---

## Test

Try this in a scratch folder.

```bash
mkdir otel-test && cd otel-test
go mod init example.com/otel-test
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/exporters/stdout/stdouttrace
```

Paste Example 1 into `main.go`, then:

```bash
go run .
```

Expected: two JSON span objects print, `do-work` showing a `Parent` whose span ID equals `say-hello`'s span ID, and both sharing one `TraceID`.

Now answer:
1. What happens if `doWork` uses `context.Background()` instead of the passed `ctx`? (Answer: `do-work` becomes a separate trace with no parent.)
2. What happens if you remove `tp.Shutdown(ctx)` and the program exits immediately? (Answer: with `WithBatcher`, spans may not flush — you see nothing.)
3. What does the output show for `service.name`? (Answer: `hello-otel`, from the resource.)
4. If you never call `otel.SetTracerProvider(tp)`, what prints? (Answer: nothing — the global tracer is a no-op.)

---

## Tricky Questions

**Q1.** I created a span but nothing appears in my terminal. Why?

A. Most likely you forgot `otel.SetTracerProvider(tp)` (so `otel.Tracer` is a no-op), or you forgot `tp.Shutdown(ctx)` before exit (so the batch never flushed). Check both.

**Q2.** My child spans show up as separate traces, not nested. Why?

A. You did not pass the `ctx` returned by `Start` into the child. The parent-child link lives in `context.Context`.

**Q3.** Is OpenTelemetry the same as `go tool trace`?

A. No. `go tool trace` reads `runtime/trace` output — scheduler/goroutine events inside one process. OTel is cross-service request tracing. See [03-runtime-trace-application-tracing](../03-runtime-trace-application-tracing/junior.md).

**Q4.** Do I need Jaeger to start?

A. No. Use the `stdouttrace` exporter and spans print to your console. Add a backend when you want a UI.

**Q5.** Where do I put a user ID — span name or attribute?

A. Attribute. Span names must be low-cardinality (the operation), values go in attributes (and even then, mind PII and cardinality).

**Q6.** What is the difference between the API and the SDK packages?

A. The API (`go.opentelemetry.io/otel`, `.../trace`) defines interfaces your code calls. The SDK (`.../sdk/trace`) is the implementation you wire up in `main`. Libraries import only the API.

**Q7.** My error shows as an event but the span is green. Why?

A. `RecordError` adds an event but does not change status. Add `span.SetStatus(codes.Error, "...")`.

**Q8.** Does instrumentation slow down my service noticeably?

A. With batching and sampling, the overhead is small. With `WithSyncer` (synchronous export) or 100% sampling at high QPS, it can hurt. Use `WithBatcher` and sample.

**Q9.** How do two services end up in one trace?

A. The caller injects W3C `traceparent` headers (via `otelhttp.NewTransport` and a `TraceContext` propagator); the callee reads them (via `otelhttp.NewHandler`). Both must set the propagator.

**Q10.** Can I add metrics later without rewiring traces?

A. Yes. Metrics use a parallel `MeterProvider`; they share the resource and shutdown pattern but are independent. Add them when ready.

---

## Cheat Sheet

```go
// 1. Build provider (once, in main)
exp, _ := stdouttrace.New()
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exp),
    sdktrace.WithResource(resource.NewWithAttributes(
        semconv.SchemaURL, semconv.ServiceName("my-svc"))),
)
otel.SetTracerProvider(tp)
otel.SetTextMapPropagator(propagation.TraceContext{})
defer tp.Shutdown(context.Background())

// 2. Create a span (anywhere)
ctx, span := otel.Tracer("pkg").Start(ctx, "operation")
defer span.End()
span.SetAttributes(attribute.Int("key", 1))

// 3. Record an error
span.RecordError(err)
span.SetStatus(codes.Error, "failed")

// 4. Instrument an HTTP server / client
http.Handle("/x", otelhttp.NewHandler(h, "x"))
client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
```

```
Key module paths:
  go.opentelemetry.io/otel                                   (API)
  go.opentelemetry.io/otel/sdk/trace                         (SDK)
  go.opentelemetry.io/otel/sdk/resource                      (resource)
  go.opentelemetry.io/otel/exporters/stdout/stdouttrace      (console exporter)
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc  (OTLP/gRPC)
  go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp    (HTTP middleware)
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Nothing exports | No `SetTracerProvider`, or no `Shutdown` | Register provider; defer shutdown |
| Child spans not nested | Wrong `ctx` passed | Use the `ctx` from `Start` |
| `unknown_service` in UI | No resource | Set `service.name` |
| Error event, green span | No `SetStatus` | Add `SetStatus(codes.Error, …)` |
| Traces don't cross services | No propagator | `SetTextMapPropagator(TraceContext{})` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what OpenTelemetry is
- [ ] Name the three signals
- [ ] Define span, trace ID, attribute, exporter, propagation
- [ ] Wire up a `TracerProvider` with `stdouttrace` and see spans print
- [ ] Explain why `Start` returns a new `ctx` and why you must use it
- [ ] Instrument an HTTP handler with `otelhttp` and see a parent/child trace
- [ ] Record an error on a span correctly (`RecordError` + `SetStatus`)
- [ ] Explain why `Shutdown` is required
- [ ] State the difference between OTel and `runtime/trace`
- [ ] Explain the API-vs-SDK split in one sentence

---

## Summary

OpenTelemetry is the vendor-neutral standard for producing **traces, metrics, and logs** from your Go service. Its atom is the **span** — a timed, named operation with attributes and a status — and a **trace** is a tree of spans sharing one **trace ID**, telling the full story of a request *across services*. You wire up a **TracerProvider** with an **exporter** (start with `stdouttrace`, graduate to `otlptracegrpc`) once in `main`, set a **resource** so the world knows your `service.name`, register the global provider, set a **propagator** so traces cross network boundaries, and `defer Shutdown` so the last batch flushes.

The one habit that makes or breaks everything: thread `context.Context`, and always use the `ctx` that `Start` returns. Instrument boundaries with `otelhttp`/`otelgrpc` middleware; hand-write a few spans for interesting business steps. Keep span names low-cardinality and put values in attributes. And remember the distinction that trips everyone up: OpenTelemetry is **cross-service distributed tracing**, while `runtime/trace` is **in-process scheduler tracing** — two different tools for two different questions.

---

## What You Can Build

After learning this:

- **A single instrumented HTTP service** whose every request produces a trace you can read in Jaeger.
- **A two-service demo** where one service calls another and both appear in one connected trace.
- **A debugging workflow** where, given a slow request, you open its trace and see which call cost the time.
- **A drop-in observability layer** you can point at any OTLP backend by changing one line.

You cannot yet:
- Design a sampling strategy for a high-QPS fleet (next: `senior.md`)
- Build custom metric instruments and views (next: `middle.md`)
- Run and configure an OpenTelemetry Collector (next: `professional.md`)
- Reason about cardinality budgets and cost (next: `senior.md`)

---

## Further Reading

- [OpenTelemetry Go documentation](https://opentelemetry.io/docs/languages/go/) — the official getting-started and reference.
- [`go.opentelemetry.io/otel` on pkg.go.dev](https://pkg.go.dev/go.opentelemetry.io/otel) — API reference.
- [OpenTelemetry Go Getting Started](https://opentelemetry.io/docs/languages/go/getting-started/) — step-by-step tutorial.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) — the `traceparent` header standard.
- [opentelemetry-go-contrib (instrumentation libraries)](https://github.com/open-telemetry/opentelemetry-go-contrib) — `otelhttp`, `otelgrpc`, and more.

---

## Related Topics

- [17.3 `runtime/trace` Application Tracing](../03-runtime-trace-application-tracing/junior.md) — the in-process counterpart; contrast carefully
- [17.1 Runtime Metrics Package](../01-runtime-metrics-package/junior.md) — Go's built-in runtime metrics
- [17.2 expvar](../02-expvar/junior.md) — the simplest metrics export
- [5.x Context](../../05-context-and-cancellation/01-context-package/junior.md) — the carrier OTel depends on
- 17.5 GODEBUG and runtime/debug — runtime knobs and introspection

---

## Diagrams & Visual Aids

```
A trace is a tree of spans sharing one trace ID:

    trace_id = 4bf92f...
    ┌──────────────────────────────────────────────┐
    │ span: HTTP GET /checkout      (server, root)   │
    │  ├── span: validate-cart                       │
    │  ├── span: charge-card                         │
    │  │     └── span: HTTP POST stripe (client)     │ ── propagated ──▶ Stripe
    │  └── span: reserve-inventory                   │
    │        └── span: HTTP GET inventory (client)   │ ── propagated ──▶ inventory svc
    └──────────────────────────────────────────────┘
```

```
The pipeline:

    your code
       │  tracer.Start(ctx, "...")
       ▼
   [Span]──▶[TracerProvider]──▶[BatchSpanProcessor]──▶[Exporter]
                                                          │
                              stdout ◀────────────────────┤
                                                          │ OTLP
                                                          ▼
                                              [Collector]──▶[Jaeger/Tempo/vendor]
```

```
Context propagation across a network boundary:

   Service A                                  Service B
   ─────────                                  ─────────
   ctx,span = Start(...)
   inject ──▶  HTTP header:                  ──▶ extract from header
              traceparent: 00-<traceid>-<spanid>-01
                                                 Start(...) continues
                                                 the SAME trace id
```

```
OTel vs runtime/trace (do not confuse them):

   runtime/trace  →  go tool trace  →  scheduler, goroutines, GC   (ONE process)
   OpenTelemetry  →  Jaeger/Tempo   →  request flow ACROSS services (MANY processes)
```
