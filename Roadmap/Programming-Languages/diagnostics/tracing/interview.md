# Tracing — Interview Questions

> **Topic:** [Tracing Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about spans, trace/span IDs, context propagation (W3C Trace Context, baggage), instrumentation, OpenTelemetry, sampling, exemplars, and the failure modes that break traces across service and queue boundaries.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Propagation](#propagation)
4. [OpenTelemetry / Implementation](#opentelemetry--implementation)
5. [Sampling](#sampling)
6. [Tricky / Trap Questions](#tricky--trap-questions)
7. [System / Design Scenarios](#system--design-scenarios)
8. [Live Coding / Whiteboard](#live-coding--whiteboard)
9. [Behavioral / Experience](#behavioral--experience)
10. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
11. [Cheat Sheet](#cheat-sheet)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

Tracing interviews split into two flavours. The first is "do you know the model" — what a span is, what a trace ID is, how `traceparent` is structured, what span kind means, the difference between an attribute and an event. The second is "do you understand propagation and cost" — given a broken trace, can you locate the boundary where the context dropped; given a 200-service mesh, can you design sampling that's affordable and still useful; given a Kafka queue in the middle, do you know why parent-child breaks and why a span *link* is the right primitive instead.

Junior questions are about vocabulary. Senior and staff questions are about *boundaries* (where context is lost), *economics* (what tracing everything costs and how sampling fixes it), and *organizational* problems (how do you get 200 teams to agree on a propagation format and attribute conventions). This file is graduated: each question is tagged with the level it usually lands at, carries a crisp model answer, and ends with what-if probes — because the follow-up is where the interview actually happens.

Real OTel APIs and real trade-offs throughout. No vendor-neutral hand-waving where a concrete answer exists.

---

## Conceptual / Foundational

### Q: What is a span? What is a trace? (junior)

A **span** is a single timed operation: a name, a start and end timestamp (hence a duration), a set of attributes, optional events, a status, and a kind. It represents one unit of work — an HTTP handler, a DB query, a business operation.

A **trace** is a tree of spans that share one **trace ID**, describing one end-to-end request as it flows through (potentially many) services. Each span except the root has a **parent span ID**, and that parent/child chain is what assembles the tree. The root span is the entry point (usually the first `SERVER` span); its children are the work it triggered.

The mental model: a trace is the *whole story* of a request; a span is *one sentence* of that story.

> **What if I asked you the difference between a span and a log line?**
> A log line is a point-in-time event with no inherent duration or parent. A span has a duration (start *and* end) and a position in a tree. A span event is the closest thing to a log line *scoped to a span* — a timestamped note inside it. The power of tracing over logs is the causal structure: a trace shows you *what called what and how long each took*, which a pile of independent log lines does not.

### Q: What are the trace ID and span ID, and how big are they? (junior)

The **trace ID** is a 16-byte (128-bit) identifier, rendered as 32 hex characters, shared by every span in the trace. The **span ID** is an 8-byte (64-bit) identifier, rendered as 16 hex characters, unique to a single span. An all-zero trace ID or span ID is invalid (it signals "no trace").

The trace ID is generated once, at the root, and copied unchanged to every downstream service via propagation. Each new span gets a fresh span ID; its `parent_span_id` points at the span that created it.

> **What if a downstream service generates a new trace ID instead of reusing the incoming one?**
> Then you get two disconnected traces for one logical request — the classic "the trace stops at the boundary" symptom. The downstream failed to *extract* the incoming context before starting its root span, so it minted a fresh root. The fix is extract-then-start: read `traceparent` from the incoming headers, and start the server span as a child of what you found.

### Q: What's the difference between an attribute and an event on a span? (junior)

An **attribute** is a key-value pair that describes the *whole span* — it's true for the span's entire lifetime. `http.request.method=POST`, `db.system=postgresql`, `db.rows=10000`. An **event** is a timestamped note about a *moment within* the span — `cache.miss`, `retry attempt=2`, a validation warning that didn't abort.

Rule of thumb: if it describes the operation as a whole, it's an attribute; if it happened *at a point in time during* the operation, it's an event.

> **What if a candidate uses an event where an attribute belongs?**
> It's not catastrophic but it's wrong for querying. Backends let you filter and aggregate on attributes (`show me all spans where db.rows > 1M`); events are harder to aggregate over and are meant to be read inline on a single span's timeline. Putting `http.status_code` as an event instead of an attribute means you can't slice your traces by status code.

### Q: What is span kind and why does it matter? (junior → middle)

Span kind is the *role* of the span: `SERVER` (handling an inbound request), `CLIENT` (making an outbound call), `PRODUCER` (enqueueing a message), `CONSUMER` (processing a message), `INTERNAL` (plain in-process work, the default).

It matters because backends use kind to do **cross-service stitching** and latency math. A `CLIENT` span on service A is matched with the `SERVER` span on service B; the *gap* between the client span's duration and the server span's duration is the network + queue time. Get the kind wrong and the UI can't draw the service map or compute that gap correctly.

> **What if every span in a service is INTERNAL?**
> The backend can't tell which spans are service boundaries, so the service-dependency map degrades and you lose the ability to measure inter-service latency. Auto-instrumentation sets kinds correctly; this usually only happens when someone hand-rolls spans and forgets `WithSpanKind`.

### Q: What is context propagation, in one sentence? (junior → middle)

Carrying the active trace context across a boundary so the next unit of work attaches its spans to the correct parent. In-process the boundary is a function call, an `await`, or a thread hop, and the carrier is a language construct (Go `context.Context`, Python `contextvars`, Node `AsyncLocalStorage`, Java thread-local). Cross-service the boundary is the network, and the carrier is HTTP (or message) headers — you **inject** on the way out and **extract** on the way in.

> **What if I told you a trace looks complete within each service but the services are separate traces — where's the bug?**
> Cross-service propagation broke. Three candidates, in order of likelihood: (1) the two ends disagree on format — A injects W3C `traceparent`, B extracts only B3; (2) the client never started a `CLIENT` span / never injected; (3) the server never extracted before starting its span. Check format agreement first — it's the most common and the most invisible.

### Q: Why use distributed tracing instead of logs and metrics? (middle)

Logs, metrics, and traces are the three pillars and they answer different questions. **Metrics** tell you *something is wrong* (p99 latency doubled) — cheap, aggregated, no per-request detail. **Logs** tell you *what happened* in one place — rich, but you have to grep across N services and manually reconstruct causality. **Traces** tell you *where the time went across the whole request* — the causal tree, with per-span durations, so you can see that the 800ms was one slow DB call in the fraud service, not the gateway.

Tracing's unique value is **causality and latency attribution across service boundaries**. The other two can't give you that without you mentally reassembling it.

> **What if someone says "we have good logging, we don't need tracing"?**
> Ask them how they'd find which of 12 downstream services caused a p99 spike, without tracing. With logs alone they'll be correlating timestamps across 12 log streams by hand — which is exactly the trace tree, reconstructed manually and unreliably (clock skew, no shared request ID unless they already built one). Tracing is logging's correlation problem, solved structurally.

### Q: What is the relationship between tracing and the trace ID in logs? (middle)

They're complementary and the integration is the cheapest high-leverage win in observability. The trace SDK exposes the *current* span context; your log formatter reads the trace ID (and span ID) off it and stamps every log line. Now you can pivot: from a slow trace, jump to exactly that request's logs (filter by `trace_id`); from an error log, jump to its trace. Three tools become one investigation.

> **What if your logs and traces won't join even though both have the ID?**
> Encoding mismatch. One side renders the trace ID as 32-hex-char, the other as a decimal integer or a truncated 64-bit value. Standardize on the 32-hex-character form everywhere. This bites teams that built a homegrown correlation ID before adopting OTel and never reconciled the formats.

---

## Propagation

### Q: Walk me through the `traceparent` header field by field. (middle)

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ││  └─ trace-id (16 bytes / 32 hex)  └ parent-id      └ flags
             └ version
```

- **version** — `00` today; reserved for future format changes.
- **trace-id** — 32 hex chars, the shared ID for the whole request. The downstream **reuses** it unchanged.
- **parent-id** — 16 hex chars, the span ID of the *caller's* span (specifically its `CLIENT` span). The downstream's `SERVER` span becomes a child of this.
- **trace-flags** — 1 byte; bit `01` = "sampled." This is a hint the downstream should honor (parent-based sampling).

> **What if the parent-id is the trace's root span ID, not the immediate caller's?**
> Then the candidate has the model wrong. `parent-id` is *always* the immediate caller's span ID — the tree is built hop by hop, each downstream parenting to the span directly above it, not to the root. If it were the root, you'd get a flat two-level tree instead of the real call hierarchy.

### Q: What is `tracestate` and how is it different from `traceparent`? (middle → senior)

`traceparent` carries the identity (trace ID, parent span ID, flags) — it's mandatory and standardized. `tracestate` carries *vendor-specific* key-value state across hops: `tracestate: rojo=00f067,congo=t61rcWk`. It lets multiple tracing systems coexist and pass along their own routing/sampling state without colliding. You rarely touch it by hand; propagators manage it. It's size-limited by the spec (512 chars per the W3C recommendation) precisely because it rides on every request.

> **What if a vendor's `tracestate` entry grows unbounded?**
> Header bloat on every hop, and eventually you blow past the size cap and entries get dropped (oldest first, by spec). It's a real concern in long call chains where several vendors each append state. Keep your own `tracestate` usage tiny.

### Q: What is baggage and how does it differ from a span attribute? (senior)

**Baggage** is arbitrary key-value data propagated *across services* in the `baggage` header, readable by every downstream service. A **span attribute** stays on the span it was set on and does not propagate. Use baggage for a small value that many downstream services need to read — a `tenant.id`, a `feature.flag.cohort` — so you don't have to thread it through every API.

The critical caveats: baggage is (1) a **PII / secret leak vector** — it goes everywhere, including to third parties if your headers leak; (2) a **header-bloat vector** — it rides on every single request, so a large baggage payload taxes every hop; (3) **not automatically copied onto spans** — if you want a baggage value to appear as a span attribute, you copy it explicitly (or run a baggage-to-attribute processor).

> **What if someone wants to put the full user object in baggage so every service has it?**
> Stop them. Baggage is for tiny, non-sensitive routing values. A full user object is a PII leak on every hop and bloats every request header. If services need user data, they fetch it by ID; the *ID* might belong in baggage, the object never does.

### Q: A request crosses from HTTP into Kafka and the trace breaks there. Why, and how do you fix it? (senior → staff)

Two distinct problems:

1. **Carrier change.** Over HTTP, auto-instrumentation injects/extracts `traceparent` in HTTP headers. Across Kafka, the carrier is the *message headers* (Kafka records carry headers), and you need a propagator that injects context into the record headers on produce and extracts on consume. If your Kafka client instrumentation doesn't do this, the context never crosses — the consumer starts a fresh root.

2. **Parent-child is the wrong relationship across a queue.** The producer and consumer are decoupled in *time* — a message may sit in the queue for seconds, minutes, or be processed in a batch with thousands of others. Modeling the consumer span as a *child* of the producer span makes the producer span's duration meaningless (it would have to "contain" the consumer). The correct primitive is a **span link**: the consumer starts a new trace (or a new root span) and adds a *link* to the producer's span context. The link says "this work was caused by that message" without implying temporal containment.

So the fix: propagate context via message headers (PRODUCER injects, CONSUMER extracts), and connect them with a **link**, not a parent edge. Span kinds `PRODUCER` and `CONSUMER` signal the queue boundary to the backend.

> **What if a single consumer poll pulls a batch of 500 messages from 500 different traces?**
> This is exactly why links exist and parenting fails. The batch-processing span can't have 500 parents, but it *can* carry 500 links — one to each originating message's span context. The backend renders this as a fan-in: one consumer span linked back to 500 producer spans. Parent-child can only express one parent; links are many-to-one and many-to-many.

### Q: How does context propagate across a thread pool or executor in-process? (senior)

It doesn't, automatically — and this is the most common in-process break. The active context lives in a per-thread or per-task construct (`contextvars`, Java thread-local, Node `AsyncLocalStorage`). When you hand work to a different thread (a `ThreadPoolExecutor`, a Java `ExecutorService`, a `CompletableFuture`), the worker thread has *its own* (empty) context, so spans created there become orphans or attach to the wrong parent.

The fix is **capture-and-reattach**: on the submitting thread, capture the current context; on the worker thread, attach it before doing the work and detach after.

```python
ctx = otel_context.get_current()        # capture on submitting thread
def run():
    token = otel_context.attach(ctx)    # reattach on worker thread
    try:    return fn()
    finally: otel_context.detach(token)
pool.submit(run)
```

Java offers `Context.taskWrapping(executor)` to wrap an executor so every submitted task carries the caller's context. Node's `AsyncLocalStorage` usually survives `async`/`await` but breaks on some callback-style and event-emitter paths.

> **What if the orphaned background work's spans still "mostly" connect to the trace?**
> That's the dangerous case — it makes the bug intermittent and easy to miss. It happens when *some* code paths preserve context and others don't, or when the worker happens to run while the parent's context is still current on a shared thread. You don't notice until a specific path produces orphans under load. The fix is the same; the lesson is to *test propagation explicitly* (assert the worker's span has the parent's trace ID) rather than eyeballing the waterfall.

### Q: What's the difference between W3C Trace Context and B3 propagation? (senior)

Both serialize trace context into headers; they differ in format. **W3C Trace Context** uses `traceparent` + `tracestate` (one combined header for identity) and is the OpenTelemetry default and the modern standard. **B3** is Zipkin's older format using separate headers (`X-B3-TraceId`, `X-B3-SpanId`, `X-B3-ParentSpanId`, `X-B3-Sampled`), with a single-header variant (`b3: traceid-spanid-sampled-parentid`).

In a mixed or migrating fleet you run a **composite propagator** that reads *and writes* both, so a B3-only service and a W3C-only service can still share a trace during the transition.

> **What if half your fleet is W3C and half is B3 and you can't change them all at once?**
> Composite propagator everywhere you can, configured to *inject both formats and extract whichever is present*. The cost is header duplication during migration; the benefit is no broken traces at the seam. Then migrate services to W3C-only one at a time, leaving the composite in place until the last B3-only service is gone.

### Q: What does it mean to "inject" and "extract," and where do auto-instrumentation libraries do it? (middle)

**Inject** = write the current context into an outgoing carrier (serialize the active span context into request headers). **Extract** = read context from an incoming carrier and make it the parent for new spans. They're the two halves of the cross-service contract: the client injects, the server extracts.

Auto-instrumentation libraries do both for known protocols: an instrumented HTTP client (`otelhttp.NewTransport`, the `requests` instrumentation, the Java agent's HttpClient hook) injects on every outbound call; an instrumented HTTP server (`otelhttp.NewHandler`, the Flask/Express/Servlet instrumentation) extracts on every inbound request. You only inject/extract by hand for transports the libraries don't cover — a custom binary RPC, a message queue, a webhook.

> **What if you inject context but never started a CLIENT span first?**
> You inject the *parent's* context, so the downstream's server span becomes a child of the wrong span (the caller's parent, not the caller's outbound call). The nesting is subtly wrong — the downstream appears to hang off something it shouldn't. Correct order: start the CLIENT span, *then* inject the now-current context, so the downstream parents to the client span.

---

## OpenTelemetry / Implementation

### Q: What are the main components of the OpenTelemetry architecture? (middle → senior)

- **API** — the surface your code calls (`tracer.Start`, `span.SetAttribute`). It's a no-op by default, so instrumented libraries can depend on it without forcing an SDK.
- **SDK** — the implementation: it actually creates spans, applies the sampler, batches, and hands spans to exporters.
- **TracerProvider** — the SDK entry point; holds the Resource, the sampler, and the span processors. You configure it once at startup.
- **Resource** — attributes describing the *emitter*: `service.name`, `service.version`, host, region. Set once per process.
- **Span processor** — receives spans on start/end; the common one is the **BatchSpanProcessor** (buffers and exports in batches).
- **Exporter** — serializes spans to a destination, usually **OTLP** to a collector.
- **Propagator** — inject/extract for context across boundaries.
- **Collector** — a separate process/deployment that receives, processes (batch, filter, tail-sample), and forwards telemetry to one or more backends.

> **What if you ship spans straight from the app to the backend, skipping the collector?**
> It works for a demo and falls over in production. The collector gives you: a buffering/retry layer so a backend blip doesn't drop spans or block your app; tail-based sampling (which needs a whole trace assembled, impossible in a single stateless app); attribute scrubbing (PII removal) in one central place; and the freedom to swap backends without redeploying every service. Direct export couples every service to the backend's availability and config.

### Q: What's the difference between a BatchSpanProcessor and a SimpleSpanProcessor? (senior)

**SimpleSpanProcessor** exports each span synchronously the moment it ends — blocking, one network call per span. Fine for tests and examples; a throughput killer in production. **BatchSpanProcessor** queues finished spans and exports them in batches on a timer or when the queue fills, on a background thread. Use the batch processor in production, always — it amortizes export cost and keeps the hot path fast.

> **What if your process crashes with spans still in the batch queue?**
> You lose the unexported spans (and possibly the in-flight trace). The batch processor trades a small window of potential loss for throughput. Mitigations: a shorter export interval, a `Shutdown()`/`ForceFlush()` in your graceful-shutdown path so a *clean* exit drains the queue, and accepting that traces are best-effort telemetry, not durable records — you don't reconcile your bank ledger from traces.

### Q: Walk me through starting a span correctly in your language of choice. (middle)

Go, the explicit-context language:

```go
ctx, span := tracer.Start(ctx, "reserve_inventory",
    trace.WithSpanKind(trace.SpanKindInternal))
defer span.End()                      // scope-bound end: survives early return / panic

span.SetAttributes(attribute.Int("items", n))
if err := doWork(ctx); err != nil {   // pass ctx DOWN so child spans attach
    span.RecordException(err)
    span.SetStatus(codes.Error, err.Error())
    return err
}
```

The three things an interviewer is checking: (1) you `defer span.End()` (or use a scope-bound helper) so the span can't leak on an early return; (2) you thread the *returned* `ctx` into downstream calls so their spans nest correctly; (3) on error you pair `RecordException` with `SetStatus(Error, ...)`.

> **What if you forget to pass the returned `ctx` down and keep using the old one?**
> Child operations start spans from the *parent's* context, not your new span's — so they become siblings of your span instead of children. The tree is flattened: work that happened *inside* `reserve_inventory` appears *next to* it. In Go this is the #1 manual-instrumentation bug because the context is explicit and easy to drop.

### Q: Why pair `recordException` with `setStatus(ERROR)`? Isn't one enough? (middle → senior)

They do different jobs. `recordException(e)` attaches the exception (type, message, stack) as a span *event* — it's the forensic detail. `setStatus(ERROR, msg)` sets the span's *status*, which is what backends use to mark the span as failed and what error filters query on ("show me all failed traces"). An exception recorded *without* an error status is invisible to error dashboards; an error status *without* a recorded exception tells you it failed but not why.

> **What if a span has an exception event but OK status — what does the UI show?**
> A green (successful) span that, when you open it, has an exception buried in its events. Your "error rate" panel undercounts because it filters on status, and on-call misses the failure. Half-marked failures are worse than unmarked ones because they look fine at a glance.

### Q: How do you set the trace ID on log lines, and where does the value come from? (middle)

The value comes from the *current span context* exposed by the SDK. Your log formatter (or a logging filter/processor) reads it and adds `trace_id` / `span_id` fields:

```go
sc := trace.SpanContextFromContext(ctx)
logger.With("trace_id", sc.TraceID().String(),
            "span_id", sc.SpanID().String()).Info("charge failed")
```

The key design choice is to do this *once* in a shared logging library so every service emits the field identically (same key name, same 32-hex encoding), not per-service.

> **What if there's no active span when the log line is written?**
> The span context is invalid (all-zero). Emit a sentinel (`"-"`) or omit the field, and check `sc.IsValid()` first. This happens for startup logs, background jobs outside a request, and any code path not under a span — don't crash the logger or write a bogus all-zero ID that looks like a real trace.

### Q: What are semantic conventions and why do they matter? (middle → senior)

Semantic conventions are OpenTelemetry's *standardized attribute names* — `http.request.method`, `db.system`, `messaging.destination.name`, `url.full`. Because they're standard, *any* backend knows how to render them: a DB span with `db.query.text` shows the query in a purpose-built DB view; an HTTP span with `http.route` and `http.response.status_code` populates the HTTP latency-by-route UI. Using ad-hoc names (`myDbQuery`, `statusCode`) gives you a generic span the backend can't light up.

> **What if your code uses the old `http.method` and a newer library uses `http.request.method`?**
> The conventions *evolved* (the HTTP semantics were renamed and stabilized). You end up with two attribute names for the same thing, so queries and dashboards that filter on one miss spans carrying the other. Pin a convention version across the fleet and migrate deliberately; a collector processor can rename old → new during the transition.

### Q: What is the Resource and what's the single most important attribute on it? (middle)

The Resource is the set of attributes describing the *process emitting* telemetry — it's attached to every span from that process. `service.name` is the non-negotiable one: it's how the backend groups spans into services and draws the service map. Also important: `service.version` (correlate a regression with a deploy), `deployment.environment` (don't mix prod and staging traces), and host/region/pod identity.

> **What if `service.name` is missing?**
> Every backend renders the spans as `unknown_service` (often `unknown_service:<process-name>`). Your service map collapses, you can't filter by service, and if several services forget it they all merge into one `unknown_service` blob. It's the first thing to check when a new service's traces look wrong.

---

## Sampling

### Q: Why sample traces at all? (middle)

Because tracing *everything* is unaffordable and unnecessary. At scale, every request generating a full trace means enormous data volume — storage, network egress to the backend, backend ingestion cost — for traces that are 99.9% identical, healthy, and never looked at. Sampling keeps a representative (and a targeted) subset: enough to characterize normal behavior and *all* the interesting ones (errors, slow requests), at a fraction of the cost.

> **What if a candidate says "just trace everything, storage is cheap"?**
> Push back with numbers. A service at 50k req/s, each request fanning out to 10 spans, is 500k spans/s. Even at a few hundred bytes per span that's tens of MB/s per service, before backend indexing overhead — and you have hundreds of services. "Storage is cheap" ignores ingestion, indexing, and query cost, which dominate. Unsampled tracing at scale is a six-or-seven-figure line item that buys you mostly redundant healthy traces.

### Q: Head sampling vs tail sampling — explain the difference and the trade-off. (senior)

**Head sampling** decides *at the start of the trace*, before you know how it turns out, usually at the root: "sample 1% of traces." The decision propagates via the sampled flag in `traceparent`, so every service in the trace honors it (parent-based sampling) — you get *whole* traces, never half. It's cheap and stateless. The fatal weakness: you decide *before* you know if the request errored or was slow, so you'll sample away the very traces you most wanted.

**Tail sampling** decides *after the trace completes*, once you can see the outcome: "keep all traces with an error, all traces over 1s, and 1% of the healthy fast ones." It captures the interesting traces by definition. The cost: you must *buffer every span of every trace* until the trace finishes so you can make the decision — which requires a stateful, memory-hungry component (the collector's tail-sampling processor) and is harder to scale.

The trade-off in one line: head sampling is cheap but blind; tail sampling is smart but expensive and stateful.

> **What if your traces span multiple collectors and a trace's spans land on different collector instances — how does tail sampling work?**
> This is the hard operational problem. Tail sampling needs *all spans of a trace in one place* to decide. So you need a two-tier collector layout: a first tier that load-balances by **trace ID** (a `loadbalancing` exporter hashing on trace ID) so every span of a given trace is routed to the *same* second-tier collector, which then has the whole trace and can tail-sample it. Get the routing wrong and you tail-sample partial traces, making inconsistent keep/drop decisions across one trace.

### Q: What is parent-based sampling and why does it prevent half-traces? (senior)

Parent-based sampling means a span honors the sampling decision of its *parent*, carried in the `traceparent` sampled flag (`-01` = sampled). The root makes the decision once; every downstream service reads the flag and respects it. The result: a trace is either fully sampled (every service kept its spans) or fully dropped — never half, where the gateway is sampled but the fraud service independently decided not to be, leaving a trace with holes.

> **What if a downstream service ignores the incoming sampled flag and runs its own independent sampler?**
> You get inconsistent, broken traces — gaps where one service kept spans and the next dropped them. The waterfall has missing middles, and latency math across the gap is impossible. The whole point of the propagated flag is fleet-wide consistency; a service running an independent head sampler defeats it. (Tail sampling is different — there the decision is made centrally *after* collection, so consistency is restored at the collector.)

### Q: What are exemplars and how do they connect metrics to traces? (senior → staff)

An **exemplar** is a concrete trace ID attached to a metric data point — specifically, an example of a request that contributed to that bucket. When you record a latency histogram, the metrics SDK can attach the trace ID of one request that fell into the high-latency bucket. Now in your dashboard, the p99 spike isn't just a number — it carries a *clickable example trace* of an actual slow request.

This closes the observability loop: **metric** alert (p99 high) → click the **exemplar** → open the **trace** of a real slow request → spot the red span → pivot to its **logs** by trace ID. Without exemplars, you see "p99 is high" and then go hunting for an example by hand.

> **What if your sampling drops the exact trace an exemplar points to?**
> A dangling exemplar — the metric says "here's a slow request" and the trace is gone. This is a real interaction between sampling and exemplars: you want the exemplar's trace to *survive* sampling. The fix is to bias sampling toward keeping traces that get chosen as exemplars (or that are slow/errored — which exemplars usually are anyway, since exemplars favor outlier buckets). Tail sampling that keeps all slow traces naturally keeps most exemplar targets.

### Q: A trace has a "sampled" flag but you don't see it in the backend. Why? (senior)

Several layers can drop a "sampled" trace between the flag and the backend: (1) **tail sampling** at the collector overrode the head decision and dropped it (head said keep, tail said drop because it was healthy and over quota); (2) the **batch processor** dropped it under queue pressure (queue full, spans discarded); (3) the **exporter** failed (backend down, retries exhausted); (4) the backend **rate-limited or rejected** ingestion; (5) the trace is *incomplete* and the backend hasn't assembled/displayed it yet (spans still arriving, or a span is missing so it can't render). "Sampled" means "we *intended* to keep it," not "it's guaranteed in the backend."

> **What if only *some* spans of a sampled trace are missing?**
> One service in the chain either didn't honor the sampled flag, isn't exporting (misconfigured endpoint), or dropped spans under load. Look at which service's spans are absent — that's your suspect. Often it's a service that runs its own sampler ignoring the parent flag, or one whose collector connection is broken.

---

## Tricky / Trap Questions

### Q: You turned on auto-instrumentation and now have thousands of tiny spans per request. Is something broken? (senior)

Wrong instinct: "the tracing is misconfigured, turn it off." Often it's working *too* well.

Some instrumentations are chatty by design — an ORM that traces every individual statement, an HTTP client that traces every retry attempt, a Redis client that spans every command including pipelined ones. A request that touches the DB 200 times in a loop now has 200 DB spans. It's not *broken*, but it's a span-explosion and a cost problem, and it makes the waterfall unreadable.

Fixes: tune the noisy instrumentation's verbosity (most have a level/filter), disable instrumentations you don't need, fix the underlying N+1 (200 DB spans is usually telling you about a real query-loop bug), and lean on sampling. Auto-instrumentation is a *starting point*, not a finished config.

> **What if the span explosion is from a single endpoint that does a legitimate bulk operation over 10,000 rows?**
> Then per-row spans are genuinely wrong granularity. Span the *batch*, not each row — one span `process_batch` with an attribute `batch.size=10000`, plus events for notable items, instead of 10,000 spans. Spans should map to operations a human would investigate, not to every loop iteration.

### Q: Two engineers each instrumented the HTTP call to a downstream — auto AND manual. What happens? (middle → senior)

Wrong instinct: "more spans, more visibility, fine." It's a bug.

You get **double-counting**: two spans for one call. The auto-instrumentation's CLIENT span wraps the actual HTTP call; the manual span wraps the same call. Now the waterfall shows a manual span containing a near-identical client span, your "number of downstream calls" metric is doubled, and the durations nest confusingly. The fix is to *know what's already instrumented* — if auto covers the HTTP call, don't manually wrap it; add your manual span around the *business operation* (`fetch_pricing`) that contains the call, where it adds meaning the auto span can't.

> **What if you genuinely need attributes on the auto-generated client span?**
> Don't wrap it — *enrich* it. Get the current span (`trace.getActiveSpan()`) inside the call and add your attributes to the existing auto span, or use the instrumentation's request hook (many expose a callback to set attributes on the span they create). Wrapping creates a duplicate; enriching annotates the real one.

### Q: A trace's total duration is 200ms but the root span shows 800ms. How? (senior)

Wrong instinct: "the clocks are broken" (possible, but check the model first).

The root span's duration includes time *not covered by any child span* — work that happened but wasn't instrumented. If the root is 800ms and the visible child spans sum (in wall-clock, accounting for parallelism) to 200ms, there's 600ms of *un-instrumented* time inside the root: a slow serialization step, a `sleep`, lock contention, GC, or a synchronous call nobody put a span around. The "gap" in the waterfall — root span bar long, but blank underneath — is the un-instrumented region, and it's often exactly where the latency hides.

> **What if the gap is at the very start of the root span, before the first child?**
> That's pre-processing before the first downstream call: request parsing, auth/middleware, deserialization, connection-pool checkout. It's invisible because nobody instrumented the middleware. Add a span (or rely on framework middleware instrumentation) around the entry path. A long blank head on the root span is a classic "where did the time go before we even started working" signal.

### Q: Your CLIENT span says 500ms but the downstream SERVER span says 50ms. Where did the 450ms go? (senior → staff)

Wrong instinct: "the downstream is slow" — it isn't; it reported 50ms.

The CLIENT span measures *from the caller's perspective*: it starts when the caller initiates the call and ends when the caller gets the response. The SERVER span measures only the *remote processing*. The 450ms gap is everything *between*: network latency (both directions), TLS handshake, connection-pool wait on the client side, time queued in the server's accept backlog before the handler ran, and load-balancer hops. That gap is a *feature* of the model, not a bug — it's how you distinguish "the downstream is slow" from "the network/queue/connection-setup is slow."

> **What if the gap is huge and intermittent?**
> Suspect connection-pool exhaustion on the client (the call waited to *get* a connection before it even hit the wire — instrument the checkout), or the server's accept queue backing up under load (the request sat in the kernel/accept backlog before the handler's SERVER span started). Both live in the client-to-server gap. A span around connection acquisition on the client side disambiguates them.

### Q: You added a span and now a method that was 10ms is 12ms. Did tracing make it slower? (middle)

Wrong instinct: "tracing has 20% overhead, rip it out." You measured one span's cost against a tiny operation.

A span has real but small cost: object allocation, attribute storage, and (with a batch processor) an enqueue — typically tens to low-hundreds of nanoseconds, *not* 2ms. A 2ms jump on a 10ms method from *one* span is implausibly large; the more likely causes are a SimpleSpanProcessor exporting synchronously (turn on batching), expensive attribute *computation* (you called an expensive function to build an attribute value even when not sampled), or measurement noise on a 10ms baseline. Real per-span overhead is in the noise for anything doing actual I/O.

> **What if the attribute values are expensive to compute — does sampling save you?**
> Only if you *defer* the computation. If you eagerly call `expensiveSerialize(obj)` to pass as an attribute value, you pay that cost whether or not the span is sampled, because the argument is evaluated before the SDK decides. Guard expensive attribute computation behind `span.IsRecording()` (or pass a lazy callback where the API supports it) so unsampled spans skip the work entirely. This is the tracing analog of lazy log arguments.

### Q: A request shows up as two traces; the second one's root has the first trace's ID in an attribute but a different trace ID. What happened? (senior)

Wrong instinct: "duplicate request." Look at the IDs.

Someone extracted the incoming context, *read* the trace ID off it (and stuffed it into an attribute for "correlation"), but then started a **new root span without using the extracted context as parent** — so the new span got a fresh trace ID. The intent was right (preserve the link) but the execution lost it: they recorded the upstream trace ID as data instead of *continuing* the trace. The fix is to start the server span *from the extracted context* (`Start(extractedCtx, ...)`), which reuses the trace ID and parents correctly, rather than starting from a fresh context and annotating it.

> **What if they did it deliberately to "start a clean trace per service for cost reasons"?**
> Then they've reinvented broken distributed tracing. Per-service traces with a correlation attribute means you can't see the cross-service waterfall — the whole reason for distributed tracing. If cost is the concern, the answer is *sampling* (keep fewer whole traces), not *fragmenting* every trace into per-service pieces joined by a manual attribute. The link primitive exists for the rare cases (queues) where a new trace is genuinely correct; a synchronous RPC is not one of them.

### Q: An attribute is a per-request UUID. Is that a problem? (middle → senior)

Wrong instinct: "high cardinality is always bad, never do it" — that rule is from *metrics*, not traces.

A high-cardinality value (a per-request UUID) is *fine as a span attribute* — it does **not** cause the combinatorial storage explosion it would as a *metric label*, because each span is stored individually anyway, not aggregated into time series. In fact, a per-request ID on a span is often exactly what you want for pivoting to a specific request. The real costs are subtler: it inflates the backend's *index* size (if that attribute is indexed for search), and it's useless to *aggregate* on (grouping spans by a unique-per-request value gives one span per group). So: fine to attach, don't index it unless you'll search by it, don't try to group by it.

> **What if someone applies the metrics cardinality rule and strips all unique IDs off spans?**
> They've removed the ability to find a specific request's trace by its ID — a major loss. The cardinality rule is load-bearing for *metric labels* (where each combination is a stored time series) and mostly irrelevant for *span attributes* (stored per-span regardless). Conflating the two is a common and costly category error.

### Q: Your trace's spans have wildly inconsistent timestamps — a child starts before its parent. What's going on? (senior)

Wrong instinct: "the trace is corrupt." It's almost always **clock skew** between machines.

Span timestamps are set by each service using its *own* wall clock. If service A's clock and service B's clock differ by 50ms (NTP drift), B's child span can appear to start *before* A's parent span, or the waterfall shows negative gaps. The spans are individually correct; the *cross-machine comparison* is off by the skew. This is why durations *within* one process are trustworthy (one clock) but *cross-service* timing has skew-sized error bars.

> **What if you need accurate cross-service latency despite skew?**
> You can't fully eliminate it without synchronized clocks, but you can: tighten NTP (or PTP for sub-ms), prefer the *gap between CLIENT and SERVER spans on the same pair* as a relative measure (still skewed but consistent for that pair), and treat sub-10ms cross-service timings with suspicion. Some systems estimate and correct skew at the collector by comparing client/server span pairs, but it's approximate. The honest answer: cross-service span timing has a skew-bounded error; size your conclusions accordingly.

### Q: A span never shows up, but `span.End()` definitely ran. Name three reasons. (senior)

Wrong instinct: "the End() didn't run." The question stipulates it did.

1. **It wasn't sampled.** The sampler dropped the trace; `End()` runs but the processor discards an unsampled span. (`IsRecording()` would have been false.)
2. **The batch processor dropped it.** Queue full under load, or the process exited before a flush, so the span was enqueued but never exported.
3. **Export failed.** The exporter couldn't reach the collector/backend (wrong endpoint, network, auth), retried, and gave up. The span existed locally and died at the export hop.

Honorable mentions: the span was created from a *non-recording* context (no SDK installed, just the no-op API); the backend received it but can't *display* it because the trace is incomplete (a parent span is missing).

> **What if the span shows up but detached from its trace, as its own root?**
> Context wasn't current when it was created — the span got a fresh trace ID instead of inheriting one. Either the parent context wasn't passed in (Go: dropped `ctx`), or you crossed a thread/async boundary that lost it. The span is fine; its *parentage* was lost at creation time.

---

## System / Design Scenarios

### Q: Design tracing for a 200-service mesh. Where do you start and what are the hard parts? (staff)

Frame it as four problems: standardization, topology, sampling, and cost governance.

**1. Standardization (the people problem, and the hardest).** 200 services means many teams. You need *one* propagation format (W3C `traceparent`) enforced fleet-wide, *one* shared instrumentation/logging library so `service.name`, attribute conventions, and trace-ID-in-logs are identical everywhere, and a pinned semantic-conventions version. The mechanism: a paved-road internal SDK that wires up OTel correctly by default, so the easy path is the correct path. Without this, you get 200 dialects and traces that don't join.

**2. Topology.** Apps export OTLP to a **local collector** (agent, per-node DaemonSet) — cheap, fast, owns retry/buffering. Agents forward to a **gateway collector tier** that does aggregation, attribute scrubbing (PII), and, if you tail-sample, trace-ID-aware load balancing so each trace lands whole on one gateway. Gateways forward to the backend (Tempo/Jaeger/vendor). The collector is the control point: change sampling, scrubbing, and routing centrally without redeploying 200 services.

**3. Sampling.** Head sampling alone wastes the budget on healthy traces; trace-everything is unaffordable at this scale. Use **tail sampling at the gateway**: keep all errors, all slow traces (per-service latency thresholds), a small baseline of healthy traces for statistics, and 100% for specific high-value flows. This requires the trace-ID load-balancing tier above.

**4. Cost governance.** Per-service span budgets, alerts on span-volume anomalies (a new deploy that 10×'s span count), and disabling chatty auto-instrumentations by default. Make cost visible per team or it grows unbounded.

> **What if three teams refuse to adopt the standard SDK and keep their own instrumentation?**
> Traces break at their boundaries. Two mitigations: run a **composite propagator** at the mesh ingress/collector so their format (B3, or a homegrown header) is translated to W3C, recovering *propagation* even if their span quality is poor; and use the **service mesh's sidecar** (Envoy/Istio) which can propagate `traceparent` and emit ingress/egress spans independently of the app, giving you *some* trace continuity through non-conforming services. The mesh sidecar is the safety net for the long tail of services you can't force to conform.

### Q: Traces break across a Kafka boundary. Diagnose and fix it. (staff)

Already covered the *why* in [Propagation](#propagation); here's the *diagnosis plan*.

1. **Confirm where it breaks.** Find a request that crosses the queue. Does the producer side have a `PRODUCER` span and the consumer side a `CONSUMER` span, and do they share a trace ID (or carry a link)? If the consumer span has a *fresh* trace ID and no link, the context didn't cross.
2. **Inspect the Kafka message headers.** Pull a raw message and check for a `traceparent` header on the record. Absent → the producer never injected; present → the consumer never extracted (or extracted from the wrong place).
3. **Check the instrumentation.** Is the Kafka client instrumentation installed *and* configured to propagate? Some require explicit enabling of context propagation; some only instrument produce/consume timing without inject/extract.
4. **Check the relationship model.** Even if context crosses, if someone modeled consumer-as-child-of-producer, batch consumption breaks it. Confirm it's a **link**, not a parent edge.
5. **Fix:** producer injects context into record headers (PRODUCER kind), consumer extracts from record headers and starts a new trace/root with a **link** to the producer's context (CONSUMER kind). Verify a batch poll produces one consumer span with N links, not N broken roots.

> **What if messages are re-keyed, re-partitioned, or aggregated by a stream processor (Kafka Streams / Flink) in the middle?**
> Then one output message derives from *many* inputs, and the clean one-to-one link breaks. Model it as the stream processor emitting a span (or a new trace) that **links to all contributing input messages' contexts** — a fan-in. You're explicitly representing "this aggregate was produced from these N inputs." Trying to force parent-child through a stateful aggregation is hopeless; links are the only primitive that expresses many-to-one causality across the queue.

### Q: Design the tracing for a payments flow that must never log card numbers but must be fully debuggable. (staff)

The tension: rich traces for debugging vs. zero PII/PAN in telemetry (PCI-DSS scope). Resolve it at every layer.

**Attribute discipline.** Span attributes carry *references and outcomes*, never sensitive data: `payment.id`, `merchant.id`, `payment.amount_cents`, `payment.currency`, `card.brand`, `card.last4`, `payment.result`, `decline.reason`. **Never** the PAN, CVV, or full track data. Custom attributes go under a namespace (`payment.*`).

**Block the leak vectors.** Auto-instrumentation captures headers, query strings, and sometimes bodies — configure a **denylist** so `Authorization`, card fields, and request bodies are never captured. Add a **collector-side scrubbing processor** as defense in depth: a redaction transform that strips anything matching a PAN regex from every span before it leaves your boundary, so an instrumentation bug can't leak even if the app misconfigures.

**Baggage hygiene.** No card data in baggage — it propagates everywhere, including potentially to third-party callouts (the issuer, the fraud vendor). Baggage carries `payment.id` at most.

**Sampling.** 100% of failed and high-value payments (you need every declined or large transaction's trace); a baseline sample of successful ones. Tail sampling keeps all errors by definition.

**Span links for the async ledger/settlement.** Capture happens synchronously; settlement is a later async job — link, don't parent.

> **What if a regulator asks you to prove no PAN ever reached the observability backend?**
> You point to the *collector* as the single egress control point and show the scrubbing processor config plus its test suite (a request with a known test PAN, asserting it's absent downstream). The architectural reason the collector matters: it's the one place to *prove* a property about all outbound telemetry. If apps exported directly to the backend, you'd have to audit 200 app configs instead of one collector policy — auditability is itself an argument for the collector tier.

### Q: A service's traces are present but useless — every span is named `request` and has no attributes. How do you fix the org, not just the service? (staff)

The single service is a symptom; the cause is no shared standard.

1. **Define the standard.** A short, enforced spec: span naming (operation-based, low cardinality — `GET /users/:id`, not `GET /users/42`), required attributes per span kind (use semantic conventions), required Resource attributes (`service.name`, `service.version`, `deployment.environment`), trace-ID-in-logs format.
2. **Make conformance the default.** Ship a paved-road SDK/middleware that produces conformant spans automatically (correct names from the router template, kinds, semantic attributes). Teams should get good traces by *adopting the library*, not by reading a doc and hand-coding.
3. **Detect drift.** A collector processor or CI check that flags non-conforming telemetry: spans named `request`, missing `service.name`, concrete IDs in span names (cardinality), unknown attribute keys. Surface a per-service "trace quality score."
4. **Close the loop with incentives.** Tie it to incident reviews — when a postmortem says "we couldn't debug X because traces were useless," that's the lever to get the owning team to adopt the standard.

> **What if you can't change the service at all (third-party, or frozen legacy)?**
> Enrich at the **collector**. A processor can rewrite span names (e.g., derive a better name from `http.route` attributes the framework still emits), add missing attributes from context, and set a `service.name` based on the source. You can't make a frozen service emit business spans, but you can normalize and salvage what it *does* emit so it at least joins the fleet's traces consistently. The collector is your last line of defense for telemetry you don't control.

### Q: Your tracing bill tripled after a deploy. Find out why and stop it. (staff)

1. **Locate the volume spike.** Span volume by service (every collector exposes span-received metrics). One service's deploy almost certainly 10×'d its span count.
2. **Find the source.** Either a new auto-instrumentation got enabled (someone turned on the ORM-per-statement tracer), a code change put a span inside a hot loop (per-row spans over a big batch), or a retry storm is multiplying spans. Pull a sample trace from that service and count spans — the explosion's shape tells you which.
3. **Stop the bleed immediately.** At the *collector* (no redeploy): drop or sample down the offending span pattern, or disable the chatty instrumentation centrally. This is exactly why centralized collector control matters — you fix cost without waiting on the team's redeploy.
4. **Fix at the source.** Then push the real fix to the service: batch the per-row spans, tune the instrumentation verbosity, fix the retry storm (which is probably a real bug anyway).
5. **Prevent recurrence.** Alert on per-service span-volume anomalies tied to deploys, and add span-budget awareness to the paved-road SDK.

> **What if the volume is legitimate — the service genuinely got more traffic, not more spans-per-request?**
> Then the lever is *sampling*, not span reduction. Lower the head sample rate for that high-volume service, or move it to tail sampling so you keep all its errors/slow traces but only a fraction of its healthy ones. Distinguishing "more spans per request" (a bug/config issue, fix the source) from "more requests" (a scaling issue, fix with sampling) is the key diagnostic split — and it changes the entire remediation.

---

## Live Coding / Whiteboard

### Q: Here's a Go function with a propagation bug. Find it.

```go
func (s *Service) Process(ctx context.Context, id int) error {
    ctx, span := s.tracer.Start(ctx, "Process")
    defer span.End()

    go func() {
        _, child := s.tracer.Start(context.Background(), "async.audit")
        defer child.End()
        s.audit(id)
    }()

    return s.handle(ctx, id)
}
```

The bug: the goroutine starts its span from `context.Background()`, not the parent `ctx`. `audit` becomes an **orphan** — a fresh root with its own trace ID, disconnected from the request's trace. The interviewer wants you to spot the `context.Background()` and explain *why* it loses the context (background carries no active span).

Fix — capture the parent context and pass it into the goroutine:

```go
go func(ctx context.Context) {
    _, child := s.tracer.Start(ctx, "async.audit")
    defer child.End()
    s.audit(id)
}(ctx)
```

Bonus correctness note: if the goroutine outlives the request and `Process` returns (ending `span`), the audit span is still a valid child — span lifetimes are independent; only the *parent linkage* (captured at `Start`) matters. But if you want the audit *not* tied to the request's lifecycle/sampling, a **link** to the parent may be more appropriate than a child relationship.

### Q: Decode this `traceparent` header by hand.

```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

- **version** `00`.
- **trace-id** `0af7651916cd43dd8448eb211c80319c` — 32 hex chars (16 bytes). The whole-request ID; the downstream reuses it.
- **parent-id** `b7ad6b7169203331` — 16 hex chars (8 bytes). The caller's span ID; the downstream's server span parents to this.
- **trace-flags** `01` — bit 0 set = **sampled**. The downstream should honor it and sample its spans too.

Interviewer is checking you know the field order, the byte/hex sizes, and that `01` means sampled (not "version 1" or "one hop").

### Q: Add a manual business span to this auto-instrumented Python handler, correctly.

Before — only the auto SERVER span (Flask) and auto CLIENT span (requests) exist:

```python
@app.post("/checkout")
def checkout():
    cart = load_cart(request.json["user_id"])
    resp = requests.post("http://pricing/quote", json=cart)
    return {"total": resp.json()["total"]}
```

After — one manual span for the business operation, error handling paired correctly, no double-wrapping of the auto'd HTTP call:

```python
@app.post("/checkout")
def checkout():
    with tracer.start_as_current_span("business.checkout") as span:
        user_id = request.json["user_id"]
        span.set_attribute("user.id", user_id)          # business attr, not PII-heavy
        cart = load_cart(user_id)
        span.set_attribute("cart.item_count", len(cart))
        try:
            # requests auto-instrumentation makes the CLIENT span + injects
            # traceparent itself — DON'T wrap it in another manual span.
            resp = requests.post("http://pricing/quote", json=cart)
            resp.raise_for_status()
        except requests.RequestException as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR), str(e))
            raise
        span.set_attribute("checkout.total", resp.json()["total"])
        return {"total": resp.json()["total"]}
```

Talking points: the manual span describes the *business operation* and nests above the auto'd HTTP call (which keeps its own CLIENT span and propagation); attributes are business-meaningful and low-risk; `record_exception` + `set_status(ERROR)` are paired; the HTTP call is *not* double-wrapped.

### Q: Write the consumer side of a Kafka span link in pseudocode.

```python
def on_message(record):
    # 1. Extract the upstream context from the MESSAGE headers (not HTTP headers).
    carrier = {k: v for k, v in record.headers}      # traceparent lives here
    upstream_ctx = propagator.extract(carrier)
    upstream_span_ctx = trace.get_current_span(upstream_ctx).get_span_context()

    # 2. Start a NEW root span (CONSUMER kind) that LINKS to the producer —
    #    NOT a child, because produce/consume are decoupled in time / batched.
    with tracer.start_as_current_span(
        "process order",
        kind=SpanKind.CONSUMER,
        links=[Link(upstream_span_ctx)],             # the causal link
    ) as span:
        span.set_attribute("messaging.system", "kafka")
        span.set_attribute("messaging.destination.name", record.topic)
        handle(record.value)
```

The load-bearing choices: extract from *message* headers (the carrier changed from HTTP to Kafka record headers); `SpanKind.CONSUMER`; and a **link** to the producer's span context instead of parenting — because a poll can return a batch from many traces, and producer/consumer are time-decoupled. For a batch, you'd collect a link per message and attach all of them.

### Q: This span leaks. Fix it.

```python
def handle(req):
    span = tracer.start_span("handle")
    span.set_attribute("path", req.path)
    if not req.valid:
        return error()          # ← span never ended: leak on the early-return path
    result = do_work(req)
    span.end()
    return result
```

The early `return error()` skips `span.end()`, so the span is never ended (never exported, leaks). Use a scope-bound construct so end is guaranteed on *every* exit path including exceptions:

```python
def handle(req):
    with tracer.start_as_current_span("handle") as span:   # context-managed: always ends
        span.set_attribute("path", req.path)
        if not req.valid:
            span.set_status(Status(StatusCode.ERROR), "invalid request")
            return error()
        return do_work(req)
```

Talking points: `with` (Python), `defer span.End()` (Go), try-with-resources `Scope` (Java), `startActiveSpan` callbacks — all exist precisely to make end unconditional. Manual `start_span` + manual `end()` is the leak-prone form; only reach for it when you genuinely need the span to cross the lexical scope.

### Q: Read this trace waterfall and tell me what's wrong.

```
[==================== gateway: POST /checkout (800ms) ====================]
  [== auth (20ms) ==]
                       [============ pricing CLIENT (700ms) ============]
                          [ pricing SERVER (40ms) ]
```

Two findings. **First**, the `pricing CLIENT` span is 700ms but the `pricing SERVER` span is only 40ms — a 660ms gap. The downstream did 40ms of work; the other 660ms is network/connection/queue time on the client side. Suspect connection-pool exhaustion (the client waited to acquire a connection) or the server's accept backlog. **Second**, there's a blank region in the gateway span between `auth` ending (~20ms) and `pricing CLIENT` starting (~100ms?) — un-instrumented work between auth and the pricing call. The latency story: the downstream is *not* the problem (40ms); the problem is the 660ms the client spent getting to and from it. Investigate client-side connection acquisition first.

---

## Behavioral / Experience

### Q: Tell me about a time tracing caught a bug you couldn't find with logs.

The interviewer wants a concrete story showing tracing's unique value — cross-service latency attribution — not "tracing is great."

Example skeleton:

- **Symptom.** Checkout p99 latency was 2s; logs in every service looked individually fast.
- **Why logs failed.** Each service logged its own handler time (~50ms), all healthy. No single log said "the request spent 1.8s *between* services."
- **What the trace showed.** The waterfall showed a 1.7s gap between the gateway's CLIENT span and the downstream's SERVER span — the downstream did 50ms of work but the call took 1.75s.
- **Root cause.** The gateway's HTTP connection pool was sized at 10; under load, requests queued *waiting to acquire a connection* before the call even hit the wire. The wait was invisible to both services' logs because neither logged connection-pool checkout.
- **Lesson.** Logs tell you what happened *inside* each service; only the trace shows the time *between* them. The CLIENT/SERVER gap is where this class of bug hides.

Tell *one* story with numbers and the specific span gap that revealed it.

### Q: Describe a propagation bug you debugged.

Pick a story where the trace broke at a specific boundary. Example:

"Two of our services showed as separate traces for the same request, but each looked perfectly instrumented alone. I checked format first: the upstream injected W3C `traceparent`, but the downstream — an older service — only had B3 extraction configured. Both were 'correct' in isolation, but they spoke different languages on the wire, so the downstream saw no context it recognized and minted a fresh root. Fix was a composite propagator on the downstream to extract both formats. Lesson: when a trace splits at a boundary and both sides look instrumented, suspect a *format mismatch* before anything else."

### Q: Tell me about a time you reduced tracing cost without losing debuggability.

"Our tracing bill was dominated by one high-traffic service emitting full traces for millions of healthy requests we never looked at. I moved it from 100% head sampling to **tail sampling**: keep every error, every trace over the service's p99 latency threshold, and 1% of the healthy fast ones. The interesting traces — the ones on-call actually opens — were kept by definition, and volume dropped ~95%. The hard part was the collector topology: tail sampling needs every span of a trace in one place, so I added a trace-ID load-balancing tier in front of the tail-sampling collectors. Lesson: cost reduction in tracing is a *sampling* problem, and tail sampling lets you cut volume without cutting the traces that matter — at the price of stateful collector infrastructure."

### Q: When did you decide NOT to add a span?

"A code reviewer asked me to span every iteration of a loop that processed 10,000 rows. I pushed back: 10,000 spans per request would explode the waterfall, blow up our span budget, and tell us nothing a single `process_batch` span with `batch.size=10000` and a couple of events for notable rows couldn't. Spans should map to operations a human would *investigate*, not to every loop iteration. We spanned the batch, not the rows. Lesson: instrumentation granularity is a design decision with a cost; more spans isn't more insight past the point where they map to investigable units of work."

### Q: Tell me about getting an organization to standardize on tracing conventions.

"We had a dozen teams each instrumenting differently — different span names, some missing `service.name`, three propagation formats. Traces didn't join across teams. Writing a standards doc didn't move anyone. What worked was a **paved-road SDK**: a thin internal library that wrapped OTel and produced conformant spans *by default* — correct service name, W3C propagation, trace-ID-in-logs, semantic-convention attributes — so the easy path was the correct path. Then a collector check flagged non-conforming telemetry with a per-service quality score, and we used incident reviews ('we couldn't debug this because the traces were useless') as the lever to drive adoption. Lesson: you don't standardize observability with documents; you standardize it by making the correct thing the *default* thing and surfacing drift."

---

## What I'd Ask a Candidate Now

Questions that separate "knows the OTel API" from "understands tracing."

### Q: When would you use a span link instead of a parent-child relationship?

Listening for: *temporal decoupling* and *fan-in*. Parent-child implies the parent *contains* the child in time. When work is decoupled (a queue: produce now, consume later) or many-to-one (a batch consumer pulling 500 messages from 500 traces; a stream aggregation), parent-child can't express it — a span can have only one parent, and the containment assumption is false. Links express "caused by" without "contained by." A candidate who only knows parent-child has never traced across a queue.

### Q: Head or tail sampling — which would you pick, and what does that decision cost you operationally?

Listening for the *trade-off awareness*, not a dogmatic answer. Head: cheap, stateless, but blind — you might sample away the errors. Tail: captures the interesting traces, but needs a stateful collector that buffers whole traces and a trace-ID-aware load-balancing tier so every span of a trace lands together. The strong answer names the *operational cost* of tail sampling (memory, stateful collectors, the routing requirement), not just "tail is better."

### Q: What's the relationship between cardinality rules for metrics and for span attributes?

A great filter question. Weak candidates apply the metrics cardinality rule ("never high cardinality") to spans reflexively. Strong ones know it's *mostly irrelevant for span attributes* — spans are stored per-instance, so a per-request UUID doesn't explode storage the way a metric label would; it only affects index size and is useless to aggregate on. Knowing *why* the rules differ (time-series aggregation vs. per-span storage) shows real understanding of the data model.

### Q: A trace is missing spans from exactly one service in the chain. Walk me through your diagnosis.

Listening for a structured boundary search, not guessing. Candidates: is that service installed/exporting (check its collector connection)? Did it honor the incoming sampled flag, or run an independent sampler that dropped these spans? Did it extract the incoming context (else its spans are a separate trace, not "missing")? Is its clock so skewed the spans look detached? The good answer treats the *one missing service* as the suspect and works the propagation + export + sampling chain through it.

### Q: How do you stop tracing from leaking PII, and where's the right place to enforce it?

Listening for *defense in depth* with the *collector as the chokepoint*. App-side: configure auto-instrumentation denylists (headers, bodies, query strings), keep PII out of attributes and baggage. Defense in depth: a collector-side scrubbing/redaction processor so an app misconfiguration can't leak. The insight that earns points: the **collector is the single egress control point** — the one place to *prove* a property holds for all outbound telemetry, which matters for audits. A candidate who only says "don't log PII in spans" misses the architectural enforcement.

### Q: When is the trace ID in logs *not* enough, and you actually need the full trace?

Reveals understanding of what each tool is *for*. The trace ID in logs lets you pivot, but logs still only show *what happened in each place*. When the question is "where did the latency go across the whole request" or "which of 10 downstream calls was slow" or "what's the call structure," you need the *trace tree*, because logs don't encode causality or per-span duration. A candidate who thinks "trace ID in logs" replaces tracing has missed that tracing's value is the *structure*, not the ID.

### Q: What's a tracing anti-pattern you've seen ship, and why is it bad?

Self-aware candidates have a real one: per-service traces joined by a correlation attribute (defeats the cross-service waterfall); per-loop-iteration spans (explosion, no insight); PII in baggage (leaks on every hop); manual + auto double-wrapping (double-counting); ignoring the parent sampled flag (broken half-traces); `service.name` missing everywhere (`unknown_service`). The *why it's bad* and how they caught it is more revealing than the anti-pattern itself.

---

## Cheat Sheet

Top-10 must-know questions for any tracing interview:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW TRACING QUESTIONS                                              │
├──────────────────────────────────────────────────────────────────────────┤
│  1. Span vs trace?                                                       │
│       → Span = one timed operation. Trace = tree of spans, one trace ID.│
│                                                                          │
│  2. Decode traceparent: 00-<32hex trace>-<16hex parent>-<flags>.        │
│       → version-traceid-parentid-flags; 01 = sampled.                   │
│                                                                          │
│  3. Inject vs extract?                                                   │
│       → Client injects context to headers; server extracts to parent.   │
│                                                                          │
│  4. Why does a trace split at a service boundary?                       │
│       → Format mismatch (W3C vs B3), or no inject/extract. Check format.│
│                                                                          │
│  5. Attribute vs event?                                                  │
│       → Attribute describes whole span; event = a moment in time.       │
│                                                                          │
│  6. Span link vs parent-child?                                          │
│       → Link = caused-by without contained-by (queues, fan-in, batch).  │
│                                                                          │
│  7. Head vs tail sampling?                                              │
│       → Head: cheap, blind, decides early. Tail: smart, stateful, late. │
│                                                                          │
│  8. Why the trace ID in logs?                                           │
│       → Pivot logs↔traces↔metrics; cheapest observability win.          │
│                                                                          │
│  9. Auto vs manual instrumentation?                                     │
│       → Auto = frameworks + propagation, free. Manual = business meaning.│
│       → Use both. Don't double-wrap.                                    │
│                                                                          │
│ 10. What's an exemplar?                                                 │
│       → A trace ID on a metric data point; metric → click → trace.      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **W3C Trace Context** — <https://www.w3.org/TR/trace-context/>. The `traceparent`/`tracestate` spec; read it once, the header structure questions become free.
- **W3C Baggage** — <https://www.w3.org/TR/baggage/>. The propagated key-value spec and its size constraints.
- **OpenTelemetry Specification** — <https://opentelemetry.io/docs/specs/otel/>. API/SDK, context & propagation, sampling.
- **OpenTelemetry Semantic Conventions** — <https://opentelemetry.io/docs/specs/semconv/>. The standardized attribute names interviewers expect you to reach for.
- **OpenTelemetry Sampling** — <https://opentelemetry.io/docs/concepts/sampling/>. Head vs tail, parent-based, the collector's tail-sampling processor.
- **OTel Collector — tail sampling & load balancing** — the `tailsamplingprocessor` and `loadbalancingexporter` docs; the trace-ID-routing topology for tail sampling at scale.
- **Yuri Shkuro, *Mastering Distributed Tracing*** — propagation, sampling, and instrumentation in depth from a Jaeger author.
- **Charity Majors et al., *Observability Engineering*** — high-cardinality, events vs metrics, and why tracing's data model differs from metrics'.
- **Google Dapper paper** — <https://research.google/pubs/pub36356/>. The original distributed-tracing design; sampling and propagation motivations still apply.

---

## Related Topics

- [Tracing — Junior](junior.md)
- [Tracing — Middle](middle.md)
- [Tracing — Senior](senior.md)
- [Tracing — Professional](professional.md)
- [Tracing — Tasks](tasks.md)
- [Logging — Interview](../logging/interview.md)
- [Metrics — Interview](../metrics/interview.md)
- [Debugging — Interview](../debugging/interview.md)
- [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/)
