# Tracing — Hands-On Exercises

> **Topic:** [Tracing Roadmap](README.md)
> **Focus:** Practical labs that take you from "I started a span and saw it in Jaeger" to "I can keep one trace whole across HTTP, a message queue, and a thread pool — and decide head vs tail sampling on purpose."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Setup You Need Once](#setup-you-need-once)
3. [Warm-Up](#warm-up)
4. [Core](#core)
5. [Advanced](#advanced)
6. [Capstone](#capstone)
7. [Related Topics](#related-topics)

---

## Introduction

Tracing is a discipline you cannot fake by reading. You can recite the W3C `traceparent` format perfectly and still ship a service whose trace silently snaps in half at the first thread-pool handoff. The only way to internalize propagation is to break it on purpose, watch the trace fall apart in the UI, and then fix it. These labs are built around that loop.

The exercises are tiered. The **Warm-Up** band gives you fluency with the OpenTelemetry SDK in one language — start a span, set attributes, export to a real backend, read the waterfall. The **Core** band is the heart of tracing: cross-service propagation over HTTP, manual vs auto instrumentation, semantic conventions, and the single highest-ROI integration in observability — the trace ID in your logs. The **Advanced** band drops you into the situations that separate middle from senior: context lost across async boundaries and queues, head vs tail sampling implemented and compared, exemplars linking a metric to a trace. The **Capstone** band stops being about API calls and starts being about design: instrument a whole request path, write the propagation-test harness that stops regressions, and decide a sampling strategy you can defend to a staff engineer.

Do not skip ahead. The Advanced and Capstone tasks assume you can stand up a collector, inject and extract context by hand, and read a Gantt waterfall without thinking. If you are still googling "how do I set the global propagator" mid-task, you will lose the thread (literally — the trace context) before you finish. Work each band end-to-end. If a task takes more than the stated budget, write down which boundary ate your context — that note is worth more than the green checkmark.

For background reading at each level: see [junior.md](junior.md) (span anatomy), [middle.md](middle.md) (propagation, auto vs manual, trace-ID-in-logs), [senior.md](senior.md) (sampling, async/queue propagation, overhead), [professional.md](professional.md) (collector architecture, tail sampling, exemplars, baggage), and [interview.md](interview.md).

---

## Setup You Need Once

Most labs below assume a local trace backend so you can *see* spans, not just print them. Get this running once and reuse it:

```bash
# Jaeger all-in-one with OTLP receivers enabled (gRPC :4317, HTTP :4318).
docker run --rm --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  jaegertracing/all-in-one:1.57

# UI at http://localhost:16686 — pick your service, find traces by trace_id or tags.
```

For the Collector-based labs (tail sampling, fan-out), you'll also run the OpenTelemetry Collector:

```bash
docker run --rm --name otelcol \
  -p 4317:4317 -p 4318:4318 \
  -v "$PWD/collector.yaml:/etc/otelcol-contrib/config.yaml" \
  otel/opentelemetry-collector-contrib:0.102.0
```

Language toolchains used across the labs: Go 1.22+, Python 3.11+, Node 20+, JDK 17+, Rust 1.77+. Each task names the language it uses, but most generalize — port them if you prefer.

> A reminder that will save you an hour: if your spans never show up, it is almost always (1) `service.name` unset → look under `unknown_service`, (2) wrong OTLP port (4317 gRPC vs 4318 HTTP), or (3) a `BatchSpanProcessor` you never flushed before the process exited. Add a `ForceFlush`/`shutdown` in your shutdown path before you debug anything fancier.

---

## Warm-Up

These are 20-to-40-minute exercises. The goal is SDK fluency in one language — not distributed insight. If a Warm-Up task takes more than 90 minutes, stop and re-read the corresponding section of [junior.md](junior.md).

### Task 1: Export your first span to Jaeger

**Problem.** Write a single-process program that starts one root span `compute.invoice`, does ~50ms of fake work, ends it, and exports it via OTLP to your local Jaeger. Find the span in the UI.

**Starting point.** An empty `main.go`/`app.py` and a running Jaeger (see [Setup](#setup-you-need-once)).

**Constraints.**
- Use the OpenTelemetry SDK, not a vendor SDK.
- Set `service.name` on the Resource to `invoice-demo`.
- Export over OTLP/gRPC to `localhost:4317` (or OTLP/HTTP to `:4318`).
- The process must flush before it exits — no lost span.

**Hints.**
- Go: `otlptracegrpc.New(...)` → `sdktrace.NewTracerProvider(WithBatcher(exp), WithResource(...))`; `defer tp.Shutdown(ctx)`.
- Python: `TracerProvider(resource=Resource.create({"service.name": "invoice-demo"}))`, `BatchSpanProcessor(OTLPSpanExporter())`, and call `provider.shutdown()` at the end.
- If you see `unknown_service` in the UI, your Resource isn't applied to the provider.

**Acceptance criteria.**
- [ ] The span `compute.invoice` appears in Jaeger under service `invoice-demo`.
- [ ] Its duration is ~50ms (not 0ms, not the whole process lifetime).
- [ ] Re-running the program produces a new trace each time (new trace ID).

**Stretch goals.**
- Add a child span `apply_tax` under the root and confirm the parent/child nesting in the waterfall.
- Swap the exporter to `ConsoleSpanExporter` and read the raw span JSON — find the `trace_id`, `span_id`, and `parent_span_id` fields by eye.

### Task 2: Attributes vs events — put the right data in the right place

**Problem.** Take the span from Task 1 and enrich it: add **attributes** that describe the whole operation and **events** that mark moments in time.

**Starting point.** Your Task 1 program.

**Constraints.**
- Attributes: `invoice.subtotal_cents` (int), `invoice.currency` (string), `customer.tier` (string, low cardinality).
- Events: one `cache.miss` event, and one `discount.applied` event carrying an attribute `percent=10`.
- Do **not** put the raw customer email or full card number anywhere — practice the PII discipline now.

**Hints.**
- Go: `span.SetAttributes(attribute.Int("invoice.subtotal_cents", 12345))`; `span.AddEvent("cache.miss")`.
- Python: `span.set_attribute(...)`; `span.add_event("discount.applied", {"percent": 10})`.
- An event is a timestamped note *inside* the span; an attribute describes the span as a whole. If you find yourself wanting many of the same key with different values over time, that's an event, not an attribute.

**Acceptance criteria.**
- [ ] In the Jaeger span detail, the three attributes show under "Tags".
- [ ] The two events show under "Logs" with correct relative timestamps.
- [ ] No email, token, or card data appears anywhere on the span.

**Stretch goals.**
- Add a high-cardinality attribute (`request.id` = a fresh UUID) and articulate in one sentence why that's acceptable as a *span attribute* but would be dangerous as a *metric label*.

### Task 3: Status and recorded exception — make a span show up as failed

**Problem.** Write a span around an operation that throws. Record the exception and set the span status to ERROR so the trace is filterable as a failure.

**Starting point.** A function that raises/returns an error roughly half the time.

**Constraints.**
- On the failure path, call both `recordException(e)` **and** `setStatus(ERROR, msg)` — the pair, not just one.
- On the success path, the span status stays unset/OK.
- The exception's stack trace must be attached (it rides as a span event).

**Hints.**
- Java: `span.recordException(e); span.setStatus(StatusCode.ERROR, e.getMessage());` in the catch, `span.end()` in finally.
- Go: `span.RecordException(err)` then `span.SetStatus(codes.Error, err.Error())`.
- A span that recorded an exception but never set ERROR status is invisible to "show me failed traces" filters. That asymmetry is a real bug, not a style nit.

**Acceptance criteria.**
- [ ] In Jaeger, filter by `error=true` and your failed traces appear; successful ones do not.
- [ ] The failed span shows the exception type and stack as an event.
- [ ] The successful span is not marked red.

**Stretch goals.**
- Run 20 iterations and confirm the error-rate split in the UI matches your ~50% throw rate.

### Task 4: Set the right span kind

**Problem.** Build a tiny program with four spans of different kinds and confirm the backend treats them differently.

**Starting point.** A program that (a) handles an inbound request, (b) calls a DB, (c) publishes to a queue, (d) does plain in-process work.

**Constraints.**
- Tag them `SERVER`, `CLIENT`, `PRODUCER`, and `INTERNAL` respectively.
- Use the SDK's span-kind option at span creation, not as an attribute set afterward.

**Hints.**
- Go: `tracer.Start(ctx, "GET /x", trace.WithSpanKind(trace.SpanKindServer))`.
- Python: `tracer.start_as_current_span("db.query", kind=trace.SpanKind.CLIENT)`.
- Kind drives cross-service stitching later — a `CLIENT` span is what links to a remote `SERVER` span. Get the muscle memory now.

**Acceptance criteria.**
- [ ] All four spans render with their correct kind in the UI.
- [ ] You can state in one sentence why `CLIENT` and `SERVER` are the load-bearing kinds for distributed tracing.

**Stretch goals.**
- Decode the difference: explain why a `CLIENT` span's duration will be *longer* than the matching `SERVER` span's duration on the remote side (network + queue time lives in the gap).

### Task 5: Decode a `traceparent` header by hand

**Problem.** Given the header below, name each field and answer whether the trace is sampled — without running any code.

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

**Constraints.**
- Write four lines: version, trace-id, parent span-id, sampled (yes/no).
- State how many hex characters the trace-id and span-id should each be, and validate the example against that.

**Hints.**
- Format: `version-traceid-spanid-traceflags`. Trace-id is 16 bytes (32 hex chars); span-id is 8 bytes (16 hex chars).
- The flags byte: bit `01` = sampled. `00` = not sampled.

**Acceptance criteria.**
- [ ] You named all four fields correctly.
- [ ] You confirmed the trace-id is 32 hex chars and the span-id is 16.
- [ ] You correctly said this trace **is** sampled.

**Stretch goals.**
- Write a 15-line CLI in any language that parses a pasted `traceparent` and prints the decoded fields plus a validity check (wrong length → error). You'll reuse this in Task 25.

### Task 6: Turn on auto-instrumentation with zero span code

**Problem.** Stand up a single HTTP service (Flask, Express, or a Servlet app) and get every inbound request traced **without writing a single span**, using auto-instrumentation.

**Starting point.** A minimal HTTP "hello" server with no OTel code.

**Constraints.**
- Java: run under `-javaagent:opentelemetry-javaagent.jar`, no code change.
- Python: `opentelemetry-bootstrap -a install` then run with `opentelemetry-instrument python app.py`.
- Node: a `tracing.js` preloaded via `node --require ./tracing.js app.js` using `getNodeAutoInstrumentations()`.
- `OTEL_SERVICE_NAME` set; OTLP endpoint pointed at your backend.

**Hints.**
- The auto-instrumentation creates the `SERVER` span for each request and (in later tasks) injects/extracts propagation for you.
- If nothing appears, confirm the instrumentation for your framework is actually installed (`opentelemetry-bootstrap` output lists them).

**Acceptance criteria.**
- [ ] Every `curl` to your endpoint produces a `SERVER` span in the UI — and you wrote no span code.
- [ ] The span carries semantic-convention HTTP attributes (method, route, status code).

**Stretch goals.**
- Hit a path with a query string containing `?token=secret`. Check whether the auto-instrumentation captured it as an attribute. If it did, that's a PII finding you'll fix in Task 12.

---

## Core

These tasks are 1-to-3 hours each. They are the substance of tracing: keeping one trace whole across a network boundary, mixing auto and manual instrumentation, and wiring trace IDs into logs. If you can do all of them comfortably, you're solidly at the middle level.

### Task 7: Instrument a 2-service request end-to-end and view ONE trace

**Problem.** Build two services — `gateway` and `pricing` — where `gateway` handles `GET /checkout` and calls `pricing`'s `GET /quote` over HTTP. Instrument both so that a single request produces **one** trace spanning both services.

**Starting point.** Two HTTP servers that already talk to each other but have no tracing.

**Constraints.**
- Use auto-instrumented HTTP server + client on both sides (e.g. `otelhttp` in Go, Flask + `requests` in Python, Express + `axios` in Node).
- Both services set their own `service.name` (`gateway`, `pricing`).
- The trace must share **one** trace ID across both services.

**Hints.**
- Go: wrap the handler with `otelhttp.NewHandler(...)` and the client transport with `otelhttp.NewTransport(...)`. That does inject on the way out and extract on the way in.
- Python: install `opentelemetry-instrumentation-flask` and `-requests`; run both under `opentelemetry-instrument`.
- In Jaeger, search by service `gateway`, open the trace, and confirm a `pricing` span hangs underneath the `gateway` client span.

**Acceptance criteria.**
- [ ] One trace contains spans from **both** services.
- [ ] The two services share the same trace ID.
- [ ] The waterfall shows: gateway SERVER → gateway CLIENT → pricing SERVER → (pricing work), correctly nested.

**Stretch goals.**
- Add 200ms of artificial latency inside `pricing` and confirm the `pricing` SERVER span widens in the waterfall while the gateway client span widens by the same amount (network + remote time).

**Sample Solution (Go, the inject/extract that `otelhttp` does for you).**

```go
// --- gateway (client side) ---
func callPricing(ctx context.Context, tracer trace.Tracer) (*http.Response, error) {
	ctx, span := tracer.Start(ctx, "GET pricing",
		trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost:8081/quote", nil)
	// Inject the current context into outgoing headers (otelhttp.Transport does this):
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
	return http.DefaultClient.Do(req)
}

// --- pricing (server side) ---
func quoteHandler(w http.ResponseWriter, r *http.Request) {
	// Extract BEFORE starting the server span, so the server span is a child:
	ctx := otel.GetTextMapPropagator().Extract(r.Context(),
		propagation.HeaderCarrier(r.Header))
	ctx, span := otel.Tracer("pricing").Start(ctx, "GET /quote",
		trace.WithSpanKind(trace.SpanKindServer))
	defer span.End()
	span.SetAttributes(semconv.HTTPRoute("/quote"))
	w.Write([]byte(`{"price":100}`))
}
```

### Task 8: Break propagation on purpose, then fix it with a composite propagator

**Problem.** Deliberately reproduce the #1 cross-service bug: configure `gateway` to inject **B3** and `pricing` to extract only **W3C**. Observe two disconnected traces. Then fix it.

**Starting point.** Your working two-service setup from Task 7.

**Constraints.**
- Force the mismatch via the global propagator config on each side.
- Confirm you get **two** traces (different trace IDs) for one request.
- Fix it by configuring a **composite** propagator that reads and writes both W3C and B3 on both sides.

**Hints.**
- Python: `set_global_textmap(B3MultiFormat())` on gateway, `set_global_textmap(TraceContextTextMapPropagator())` on pricing → mismatch. Then `CompositePropagator([TraceContextTextMapPropagator(), B3MultiFormat()])` on both → fixed.
- Go: set `otel.SetTextMapPropagator(...)` with `propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, b3.New())`.
- This is the lab that makes "the trace stops at the gateway" a symptom you recognize instantly.

**Acceptance criteria.**
- [ ] In the broken state, one request yields two separate traces.
- [ ] You can articulate *why* — the server couldn't parse the header the client wrote.
- [ ] In the fixed state, one trace spans both services again.

**Stretch goals.**
- Capture the actual outgoing headers in the broken state (log `req.Header`) and show the `X-B3-*` headers present but no `traceparent` — the physical evidence of the mismatch.

### Task 9: Layer a manual business span between auto spans

**Problem.** In `gateway`, add a manual `INTERNAL` span named `business.checkout` that sits *between* the auto-created SERVER span and the auto-created CLIENT call to pricing. Confirm the three-level nesting.

**Starting point.** Your Task 7 setup with auto-instrumentation on.

**Constraints.**
- The manual span must be a child of the auto SERVER span and a parent of the auto CLIENT span — get the context threading right.
- Add one business attribute (`checkout.step="price"`).
- Use a scope-bound helper (`with` / `defer` / try-with-resources / `startActiveSpan`) so the span can't leak on an early return.

**Hints.**
- Python: `with tracer.start_as_current_span("business.checkout") as span:` *inside* the Flask handler — the auto SERVER span is already current, so this nests under it; the `requests.get` inside nests under *this*.
- Go: thread the `ctx` returned by your manual `tracer.Start` into the HTTP client call.
- The art of middle-level tracing: auto gives you the bones, manual gives you the meaning.

**Acceptance criteria.**
- [ ] Waterfall shows SERVER → `business.checkout` → CLIENT → pricing SERVER.
- [ ] The `checkout.step` attribute is on the manual span, not on the auto spans.
- [ ] No leaked/unended span if the handler returns early.

**Stretch goals.**
- Deliberately wrap the *same* HTTP call in both a manual CLIENT span and the auto CLIENT instrumentation. Observe the double-counted span and explain why "know what's already instrumented" matters.

### Task 10: Apply semantic conventions and make the backend "light up"

**Problem.** Take your `pricing` DB call (add a real or fake SQL query) and attach OTel **semantic-convention** attributes so the backend renders it as a proper database span.

**Starting point.** A `pricing` handler that runs a query (use SQLite/Postgres, or simulate one).

**Constraints.**
- Set `db.system`, `db.namespace`, `db.query.text`, `db.operation.name` using current convention names.
- The query text must be the **parameterized template**, not the bound values (no PII, no per-row cardinality).
- Use `http.route` (template `/quote/:id`), never the concrete path `/quote/42`.

**Hints.**
- Current names: `db.system=postgresql`, `db.query.text="SELECT price FROM items WHERE id = $1"`.
- Older code uses `http.method`/`http.status_code`; newer uses `http.request.method`/`http.response.status_code`. Pick one convention version and be consistent.
- If your backend has a DB-aware view (Jaeger shows tags; Grafana Tempo/vendors render query panels), confirm it picks up the query.

**Acceptance criteria.**
- [ ] The DB span carries all four `db.*` attributes with convention-correct keys.
- [ ] `http.route` is a template, not a concrete ID.
- [ ] No bound parameter values or PII appear in `db.query.text`.

**Stretch goals.**
- Write a 5-line linter (grep/regex) that flags any span attribute key matching `http.method` or `http.status_code` (the old names) so you can drive a deliberate migration.

### Task 11: Inject trace_id and span_id into every log line

**Problem.** Wire your `gateway` and `pricing` loggers so that **every** log line carries the current `trace_id` and `span_id`. Then trigger an error, copy the `trace_id` from the log, and find that exact trace in the UI.

**Starting point.** Your two services with structured logging (JSON) but no trace correlation.

**Constraints.**
- The correlation must come from the SDK's *current span context*, not a value you thread manually.
- Encode the trace ID as the canonical 32-hex-char string (not decimal) so it matches the backend.
- A log line emitted outside any span must degrade gracefully (e.g. `trace_id="-"`), not crash.

**Hints.**
- Go: `sc := trace.SpanContextFromContext(ctx)` then `slog ... With("trace_id", sc.TraceID().String())`.
- Python: a `logging.Filter` that reads `trace.get_current_span().get_span_context()` and formats `trace_id` as `format(ctx.trace_id, "032x")`.
- Node: read `trace.getSpan(context.active())?.spanContext()?.traceId` in your log function.

**Acceptance criteria.**
- [ ] Every log line inside a request carries `trace_id` and `span_id`.
- [ ] You copied a `trace_id` from a log line and found the matching trace in the UI.
- [ ] A log emitted at startup (no active span) shows `trace_id="-"` and doesn't crash.

**Stretch goals.**
- Filter your log backend (or just `grep`) by one `trace_id` and confirm you can reconstruct the request's log narrative across **both** services from logs alone.

**Sample Solution (Python logging filter).**

```python
import logging
from opentelemetry import trace

class TraceContextFilter(logging.Filter):
    def filter(self, record):
        ctx = trace.get_current_span().get_span_context()
        record.trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else "-"
        record.span_id = format(ctx.span_id, "016x") if ctx.is_valid else "-"
        return True

# Formatter: "%(asctime)s %(levelname)s trace_id=%(trace_id)s span_id=%(span_id)s %(message)s"
```

### Task 12: Audit and fix PII captured by auto-instrumentation

**Problem.** Your auto-instrumentation is grabbing sensitive data. Fire a request with an `Authorization` header and a `?token=secret` query param, find where they leaked into span attributes, and configure them out.

**Starting point.** Your auto-instrumented service from Task 6/7.

**Constraints.**
- First *prove* the leak: find the captured `Authorization`/`token` value on a span.
- Then configure the instrumentation to drop or redact those — via header denylists, query sanitization, or a SpanProcessor that scrubs attributes.
- The fix must not disable tracing of the endpoint, only the sensitive fields.

**Hints.**
- Many instrumentations expose a header-capture allowlist (`OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_*`) — and capture nothing by default, so a leak means something explicitly opted in.
- A belt-and-suspenders fix is a custom `SpanProcessor`/`SpanExporter` wrapper that redacts attribute keys matching a denylist before export.
- This is the difference between "instrumented" and "shippable."

**Acceptance criteria.**
- [ ] You demonstrated the leak before fixing it (screenshot or span JSON).
- [ ] After the fix, neither the auth header value nor the token appears on any span.
- [ ] The endpoint is still traced; only the sensitive attributes are gone.

**Stretch goals.**
- Write a reusable "PII auditor": a script that fires a request with known sensitive markers and fails CI if any of them show up in exported spans.

### Task 13: Honor the sampled flag (parent-based sampling)

**Problem.** Configure both services with **parent-based** sampling so that the sampling decision made at the gateway propagates to pricing via the `traceparent` flags — no half-traces.

**Starting point.** Your two-service setup, currently `AlwaysOn`.

**Constraints.**
- Gateway sampler: `ParentBased(root=TraceIdRatioBased(0.5))` — sample 50% of *new* roots.
- Pricing sampler: `ParentBased(...)` so it always follows the incoming `-01`/`-00` flag.
- Verify that when a trace is sampled at the gateway, pricing's span is present; when it's dropped, pricing has no span either.

**Hints.**
- The `traceparent` flags byte (`01` vs `00`) is the wire signal; `ParentBased` is the sampler that reads it.
- If pricing uses `AlwaysOn` instead of `ParentBased`, you'll get pricing spans for traces the gateway dropped — orphaned half-traces. That's the bug this task teaches you to avoid.

**Acceptance criteria.**
- [ ] Roughly 50% of requests produce a full two-service trace; the rest produce none.
- [ ] You never see a pricing span without its gateway parent.
- [ ] You can explain, in one sentence, why a non-parent-based downstream sampler causes half-traces.

**Stretch goals.**
- Log the sampled flag (`sc.IsSampled()`) on both sides and confirm it matches end-to-end across 50 requests.

---

## Advanced

These tasks are 3-to-6 hours each. They reward methodical work over speed. Several have more than one defensible answer — what matters is that you can demonstrate the trace staying whole (or explain exactly why it didn't).

### Task 14: Propagate context across a message queue (producer → consumer)

**Problem.** Extend the request path: `gateway` publishes an `order.created` message to a queue (Kafka, RabbitMQ, Redis Streams, or SQS), and a separate `fulfillment` consumer processes it. Keep them on the **same trace** — manually injecting/extracting context through the message headers.

**Starting point.** A working producer and consumer with no trace propagation across the queue.

**Constraints.**
- The producer span is `PRODUCER` kind; the consumer span is `CONSUMER` kind.
- Inject `traceparent` into the **message headers/metadata**, extract on the consumer side — the queue is just another carrier.
- Decide and justify: does the consumer span **parent** to the producer, or **link** to it? (For async fan-out / batch, links are usually correct.)

**Hints.**
- The carrier abstraction is the same as HTTP — a `TextMapPropagator` over the message's header map. Kafka has record headers; SQS has message attributes; Redis Streams needs a field you reserve.
- For a single message consumed once, a parent relationship reads fine. For batch consumption (one consumer span covering N messages), use **span links** — one parent can't represent N producers.
- Auto-instrumentation covers some brokers; do it by hand once anyway so you understand what it does.

**Acceptance criteria.**
- [ ] The consumer's span shares the producer's trace ID.
- [ ] Producer span is `PRODUCER`, consumer span is `CONSUMER`.
- [ ] You wrote one paragraph justifying parent-vs-link for your consumption pattern.

**Stretch goals.**
- Switch to **batch** consumption (pull 10 messages at once) and re-implement using span **links** — one consumer span linking to all 10 producer span contexts. Confirm the links render in the UI.

**Sample Solution (Go — inject into Kafka headers, extract on consume).**

```go
// PRODUCER: inject the active context into the record's headers.
func publish(ctx context.Context, w *kafka.Writer, payload []byte) error {
	ctx, span := tracer.Start(ctx, "publish order.created",
		trace.WithSpanKind(trace.SpanKindProducer))
	defer span.End()

	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier) // writes "traceparent" into the map
	hdrs := make([]kafka.Header, 0, len(carrier))
	for k, v := range carrier {
		hdrs = append(hdrs, kafka.Header{Key: k, Value: []byte(v)})
	}
	return w.WriteMessages(ctx, kafka.Message{Value: payload, Headers: hdrs})
}

// CONSUMER: extract from the record's headers, then start a CONSUMER span.
func consume(parent context.Context, m kafka.Message) {
	carrier := propagation.MapCarrier{}
	for _, h := range m.Headers {
		carrier[h.Key] = string(h.Value)
	}
	ctx := otel.GetTextMapPropagator().Extract(parent, carrier)
	_, span := tracer.Start(ctx, "process order.created",
		trace.WithSpanKind(trace.SpanKindConsumer))
	defer span.End()
	// ... process ...
}
```

### Task 15: Find and fix a broken-context bug across async / threads

**Problem.** You are given (or you write) a service whose background work — a thread-pool task, a goroutine, a `CompletableFuture`, or a `tokio::spawn`ed future — produces an **orphan** span instead of nesting under the request. Reproduce the orphan, then fix it by carrying the context across the boundary.

**Starting point.** A handler that offloads work to a worker and loses the trace context doing it.

**Constraints.**
- First *reproduce* the orphan and prove it (the worker's span has no parent / a different trace ID).
- Then fix it by **capturing the context on the submitting thread and re-attaching it on the worker** (or by wrapping the executor / instrumenting the future).
- The fix must not be "do the work synchronously" — the async boundary must remain, just with context carried across it.

**Hints.**
- Python `ThreadPoolExecutor`: capture `otel_context.get_current()` before `submit`, then `attach`/`detach` inside the task.
- Java `ExecutorService`/`CompletableFuture`: wrap with `Context.current().wrap(runnable)` or use `Context.taskWrapping(executor)`.
- Go goroutine: pass `ctx` *into* the goroutine closure; never start from `context.Background()`.
- Rust: `.instrument(span)` on the spawned future, or capture and re-enter the context.

**Acceptance criteria.**
- [ ] You demonstrated the orphan span (different/missing parent) before the fix.
- [ ] After the fix, the worker's span nests under the request's trace, sharing its trace ID.
- [ ] You can name the exact boundary where context was lost and why language X loses it there.

**Stretch goals.**
- Write a regression test that *asserts* the worker span shares the request's trace ID, using an in-memory span exporter, so this can't silently regress.

**Sample Solution (Python — capture-and-reattach across a thread pool).**

```python
from concurrent.futures import ThreadPoolExecutor
from opentelemetry import context as otel_context, trace

tracer = trace.get_tracer("worker-demo")

def submit_with_context(pool, fn, *args):
    ctx = otel_context.get_current()        # capture on the PARENT thread
    def run():
        token = otel_context.attach(ctx)    # re-attach on the WORKER thread
        try:
            with tracer.start_as_current_span("background.work"):
                return fn(*args)            # now a child of the request span
        finally:
            otel_context.detach(token)
    return pool.submit(run)
```

### Task 16: Implement and compare head vs tail sampling

**Problem.** Configure two sampling strategies for the same traffic and compare what each keeps. **Head sampling** decides at span start (in the SDK, no full trace context). **Tail sampling** decides after the full trace is assembled (in the Collector, with the whole trace's data).

**Starting point.** Your multi-service setup producing a mix of fast/slow/errored traces, plus a running OpenTelemetry Collector.

**Constraints.**
- **Head:** SDK sampler `TraceIdRatioBased(0.1)` — keep 10% blindly.
- **Tail:** Collector `tail_sampling` processor with policies: keep 100% of traces with an error, keep 100% of traces over 500ms, and probabilistically sample 10% of the rest.
- Drive identical traffic through both setups and compare: what fraction of **error** traces did each strategy retain?

**Hints.**
- Head sampling can't know a trace will error — it decided before the error happened, so it keeps ~10% of errors too.
- Tail sampling needs the Collector to buffer all spans of a trace until it's complete (a `decision_wait` window) before deciding — that's its cost.
- A minimal tail-sampling Collector config:

```yaml
processors:
  tail_sampling:
    decision_wait: 5s
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: sample-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [tail_sampling]
      exporters: [otlp/jaeger]
```

**Acceptance criteria.**
- [ ] Head sampling retains ~10% of *all* traces, including only ~10% of error traces.
- [ ] Tail sampling retains ~100% of error and slow traces, plus ~10% of the rest.
- [ ] You wrote a short comparison: tail keeps the interesting traces but costs buffering + a complete-trace assumption; head is cheap but blind.

**Stretch goals.**
- Measure the Collector's memory under tail sampling as you raise traffic, and explain why a single-node tail sampler needs all spans of a trace to land on the same Collector instance (the sharding problem — a `professional.md` topic).

### Task 17: Link a metric to a trace with an exemplar

**Problem.** Emit a histogram metric (request latency) with **exemplars** that carry a `trace_id`, then pivot from a high-latency bucket on a dashboard straight to the exact trace.

**Starting point.** A service exporting both traces and a latency histogram metric.

**Constraints.**
- The exemplar must attach the `trace_id` (and `span_id`) of the request that produced the sample.
- The metric must be scraped/exported in a format that carries exemplars (OTLP, or Prometheus with the OpenMetrics exemplar extension).
- Demonstrate the pivot: from a slow bucket → exemplar → the trace in your trace UI.

**Hints.**
- In OTel, exemplars are produced automatically when a measurement is recorded *inside a sampled span* and the exemplar filter is `trace_based` — the SDK pulls the current trace context.
- Prometheus exposes exemplars via the `# {trace_id="..."} value timestamp` syntax on histogram buckets; Grafana renders them as clickable dots.
- This is the metric-side of "trace ID in logs" — same idea, different signal.

**Acceptance criteria.**
- [ ] Your latency histogram carries exemplars with a `trace_id`.
- [ ] You clicked an exemplar on a slow bucket and landed on the corresponding trace.
- [ ] You can explain why exemplars need the metric to be recorded *within* a sampled span.

**Stretch goals.**
- Close the loop end-to-end: metric alert (p99 high) → exemplar → trace → red span → filter logs by that span's `trace_id`. Document the full pivot as a 5-step runbook.

### Task 18: Eliminate trace-noise — tune span granularity and span explosion

**Problem.** Auto-instrumentation has given you thousands of tiny spans per request (an ORM tracing every statement, a client tracing every retry). Reduce the noise without losing the spans that matter.

**Starting point.** A request whose waterfall has 200+ spans, most of them meaningless.

**Constraints.**
- Identify which instrumentations are chatty (count spans by source).
- Apply at least two reduction techniques: disable a noisy instrumentation, raise its threshold, or collapse repetitive spans — without dropping the business-meaningful ones.
- Quantify before/after span count per request.

**Hints.**
- Some instrumentations let you suppress sub-spans (e.g. don't trace each connection-pool acquire).
- Span *count* is a cost and a cognitive-load problem; the goal is the smallest set of spans that still lets you diagnose a real bug.
- Sampling (Task 16) reduces *trace* count; this task reduces *span* count *within* a trace. Different lever.

**Acceptance criteria.**
- [ ] You measured spans-per-request before and after.
- [ ] You reduced span count by a meaningful factor while keeping the SERVER, CLIENT, and business spans.
- [ ] You can name which instrumentation was the worst offender and why.

**Stretch goals.**
- Argue the other side: name one debugging scenario where the noisy per-statement spans would have been exactly what you needed, and propose a config that keeps them only under a debug flag.

---

## Capstone

These are open-ended scenarios. The point is not one correct answer but a complete approach you can design and defend at a review. Treat each as if you're pitching it to a staff engineer.

### Task 19: Instrument a full request path across three services and a queue

**Problem.** Take a realistic flow — `gateway` → `pricing` (HTTP) → publish to a queue → `fulfillment` consumer → `inventory` (HTTP) — and make a single user request produce **one coherent trace** from the click to the warehouse, with meaningful business spans at each hop.

**Constraints.**
- Auto-instrumentation for all HTTP and DB calls; manual spans for the business operations (`reserve_inventory`, `score_fraud`, `apply_promotion`).
- Cross-queue propagation done correctly (parent or link, justified).
- Trace ID in every service's logs, identically formatted.
- Correct span kinds throughout (SERVER/CLIENT/PRODUCER/CONSUMER/INTERNAL).
- `service.name` and `service.version` set on every Resource.

**Hints.**
- Build it incrementally: get HTTP-to-HTTP whole first (Task 7), then add the queue hop (Task 14), then the business spans (Task 9).
- The queue is where most people's traces break — test that boundary explicitly.
- Keep a "broken" branch that mismatches the propagation format, so you can demo the failure mode in the review.

**What "done" looks like.** You can open one trace in the UI and read the entire request as a single waterfall spanning three services and a queue. Every hop has the right span kind; business spans carry domain attributes; every log line across all services shares the trace ID. You can demo the pivot from any log line to the full trace. You wrote a one-page "how propagation flows through this system" doc with a diagram of every inject/extract boundary. You have a deliberately-broken branch ready to show the two-traces failure and explain the fix in 60 seconds.

### Task 20: Build a propagation-test harness that runs in CI

**Problem.** Propagation breaks silently — the in-process spans still mostly connect, so nobody notices until an incident. Design and build an automated test that **fails CI** if cross-boundary propagation regresses.

**Constraints.**
- Spin up the relevant services (in-process or testcontainers), send a request, and **assert** the downstream span carries the upstream trace ID.
- Cover at least two boundary types: an HTTP hop and a queue hop (or a thread-pool hop).
- Use an in-memory / test span exporter to inspect emitted spans programmatically — not a screenshot, not a human looking at Jaeger.
- The test must be fast and deterministic enough to run on every PR.

**Hints.**
- Go: `tracetest.NewInMemoryExporter()` (or `tracetest.SpanRecorder`) lets you read all emitted spans and assert parent/child + trace-id equality.
- Python: `InMemorySpanExporter` from `opentelemetry.sdk.trace.export.in_memory_span_exporter`.
- The assertion that matters: `downstream_span.context.trace_id == upstream_span.context.trace_id` AND `downstream_span.parent.span_id == upstream_span.context.span_id`.

**What "done" looks like.** You have a test that, when someone "accidentally" swaps a propagator format or starts a goroutine from `context.Background()`, goes red with a clear message ("downstream span trace_id 0xABC != upstream 0xDEF — propagation broke at the HTTP boundary"). It runs in under a few seconds. You added it to the CI pipeline and demonstrated it catching a real regression you introduced on purpose. You wrote a short note on which boundaries it does and does not cover.

### Task 21: Decide a sampling strategy and defend it

**Problem.** You own tracing for a system doing 50k requests/sec across 12 services. Storing 100% of traces is too expensive; storing a blind 1% loses almost every error and slow trace. Design the sampling strategy.

**Constraints.**
- Your design must specify: head vs tail vs a hybrid, the exact policies (errors, latency, key endpoints, baseline rate), and *where* each decision happens (SDK vs Collector).
- Address the hard parts: parent-based propagation so traces stay whole, and the tail-sampler sharding problem (all spans of a trace must reach the same decision-maker).
- State the cost/retention trade-off in numbers (rough is fine): expected trace volume retained, and the storage that implies.

**Hints.**
- Common production answer: parent-based head sampling at a low baseline to cut volume cheaply at the edge, **plus** tail sampling in the Collector to *guarantee* errors and slow traces are kept.
- The sharding problem is real: a load-balanced fleet of Collectors must route all spans of a trace ID to one instance (a `loadbalancing` exporter keyed by trace ID feeding a second tail-sampling tier).
- Name what you're willing to lose. "We keep 100% of errors and p99-slow traces, and 2% of the boring fast ones" is a defensible sentence; "we sample 5%" is not.

**What "done" looks like.** You have a written design with a diagram of the two-tier Collector topology (load-balancing exporter → tail-sampling Collectors), the explicit policy list with thresholds, the parent-based propagation note, and a back-of-envelope cost estimate. You can defend why head-only is insufficient (loses errors) and why tail-only at the edge is impossible (you don't have the whole trace at the edge). You can answer "what happens to a trace whose spans land on two different tail samplers?" with the sharding fix. A staff engineer leaves your review understanding exactly what gets kept, what gets dropped, and what it costs.

### Task 22: Migrate a B3 fleet to W3C with zero broken traces

**Problem.** You inherit 12 services all speaking Zipkin **B3** propagation. The org standard is now W3C `traceparent`. Design and execute a migration that never produces a broken trace during the rollout — services on the old and new format must interoperate the whole time.

**Constraints.**
- No flag day: services will be deployed one at a time over weeks, so old and new must coexist.
- Every service must **read** both formats throughout the migration; the write format flips per service on a controlled schedule.
- You must be able to prove, at any point, that a request crossing an old→new (and new→old) boundary stays on one trace.

**Hints.**
- The bridge is a **composite propagator** that extracts both B3 and W3C everywhere — turn that on across the *whole* fleet first, before changing any write format.
- Then flip the *inject* (write) format service by service. Because every service still extracts both, a B3-writing caller and a W3C-writing callee still connect.
- Keep B3 extraction on for a deprecation window after the last service flips, then remove it last.

**What "done" looks like.** You have a phased plan: Phase 1 — every service extracts both formats (no write change, zero risk). Phase 2 — flip write to W3C one service at a time, validating each with the propagation-test harness from Task 20. Phase 3 — after a soak period with no broken-trace alerts, remove B3 extraction. You can show, with the harness, that a mixed-format boundary stays whole at every phase. You wrote a rollback step for each phase and a one-paragraph "why composite-extract-first is the only safe ordering."

---

## If you can do all of these, you have the senior level

You can stand up tracing in any of Go, Python, Java, Node, or Rust and have one trace span multiple services within an hour. You instinctively check the propagation format first when a trace "stops at a boundary." You can carry context across HTTP, a queue, and a thread pool — and you have a CI test that screams when someone breaks it. You can choose head vs tail sampling with numbers behind the choice, run a fleet-wide propagation migration without dropping a trace, and pivot from a metric exemplar to a trace to a log line without thinking about which tool you're in. The next step is not more tracing labs — it is designing the org-wide standards (the shared logging library, the Collector topology, the semantic-convention version pin) that make every team's traces correlate by default, and teaching the next engineer to never lose the context.

---

## Related Topics

- [Tracing — Junior](junior.md) — span anatomy, your first span, orphan spans.
- [Tracing — Middle](middle.md) — propagation, auto vs manual, semantic conventions, trace-ID-in-logs.
- [Tracing — Senior](senior.md) — head vs tail sampling, async/queue propagation, span granularity, overhead budgets.
- [Tracing — Professional](professional.md) — collector architecture, tail-sampling sharding, exemplars, baggage pitfalls, org-wide standards.
- [Tracing — Interview](interview.md).
- Sibling diagnostic topics: [Logging](../logging/README.md) (the foundation for trace-ID-in-logs), [Metrics](../metrics/README.md) (exemplars), [Debugging](../debugging/README.md) (distributed investigation).
- Cross-roadmap: [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/) — collector topology and backend storage.
