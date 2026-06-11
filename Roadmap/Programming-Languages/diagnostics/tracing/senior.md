# Tracing — Senior Level

> **Topic:** [Tracing Roadmap](README.md)
> **Focus:** The economics and engineering of tracing at scale. Sampling as a design decision (head vs tail, parent-based, probabilistic, rate-limiting). Span granularity and the overhead budget. Async, queue, and batch context propagation — the boundaries where traces quietly die. Semantic conventions as a contract, not a suggestion.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Overhead Budget](#the-overhead-budget)
6. [Sampling — The Central Design Decision](#sampling--the-central-design-decision)
7. [Head Sampling in Practice](#head-sampling-in-practice)
8. [Tail Sampling in Practice](#tail-sampling-in-practice)
9. [Span Granularity — How Much Is Too Much](#span-granularity--how-much-is-too-much)
10. [Async and Concurrency Propagation](#async-and-concurrency-propagation)
11. [Queue and Message Propagation — Producer/Consumer and Links](#queue-and-message-propagation--producerconsumer-and-links)
12. [Batch, Fan-Out, and Fan-In](#batch-fan-out-and-fan-in)
13. [Semantic Conventions as a Contract](#semantic-conventions-as-a-contract)
14. [The SpanProcessor and Exporter Pipeline](#the-spanprocessor-and-exporter-pipeline)
15. [Code Examples](#code-examples)
16. [Real Failure Stories](#real-failure-stories)
17. [Pros & Cons](#pros--cons)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Clean Code](#clean-code)
21. [Best Practices](#best-practices)
22. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Points](#tricky-points)
25. [Test Yourself](#test-yourself)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Summary](#summary)
29. [What You Can Build](#what-you-can-build)
30. [Further Reading](#further-reading)
31. [Related Topics](#related-topics)
32. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **At scale, tracing stops being "add a span" and becomes "what can I afford to keep, where does the context die, and is my data shaped like the spec says it is."**

At middle level you learned to keep the trace whole: inject and extract `traceparent`, layer manual spans on auto-instrumented ones, stamp the trace ID onto logs. That gets you correct traces. It does not get you *affordable* traces, and it does not survive contact with a thread pool, a Kafka topic, or a 5,000-span request.

The senior shift is from correctness to **economics and engineering under constraint**. A service doing 50,000 requests per second, each emitting 30 spans, produces 1.5 million spans per second. At ~500 bytes per exported span that is ~750 MB/s — 2.7 TB/hour — *per service*. You cannot keep it. You cannot afford to keep it. And 99.9% of it is the same boring success path you will never look at. So the central senior questions become:

1. **Sampling** — which traces do I keep, *who decides*, and *when*? Do I decide at the start of the request (head) when I know nothing about the outcome, or at the end (tail) when I know it was slow or errored but have to buffer every span until then?
2. **Granularity** — how many spans is a span too many? A span per loop iteration is a debugging tool that becomes a cost center and a UI that nobody can read.
3. **Overhead** — what is my CPU, memory, and latency budget for instrumentation, and how do I stay inside it?
4. **Propagation across the hard boundaries** — async runtimes, thread pools, queues, batch jobs — where the trace silently breaks and you don't notice until you need it.
5. **Semantic conventions as a contract** — because the moment two teams disagree on `http.route` vs `http.target`, your fleet-wide latency dashboard is a lie.

> 🎓 **Why this matters at senior level:** A junior adds a span and it works in dev. A middle keeps the trace whole across services. A senior owns the *trade-off curve*: keep more traces and pay for storage, or sample harder and miss the one trace the incident needed. The senior knows that the trace you didn't keep is invisible, that the buffer your tail sampler needs can OOM your collector, and that an unbounded span count is a self-inflicted outage. This page is about making those calls deliberately, not discovering them in a postmortem.

---

## Prerequisites

- **Required:** All of [`middle.md`](middle.md) — W3C propagation, inject/extract, manual vs auto, span kind, attributes/events/status, semantic-convention basics, trace ID in logs.
- **Required:** You can run a service with auto-instrumentation and see end-to-end traces in Jaeger or Tempo.
- **Required:** Comfort with one async model in depth: Go's scheduler, Python `asyncio`/`contextvars`, Node's event loop/`async_hooks`, the JVM thread/executor model, or Rust `tokio`.
- **Required:** You understand the [OpenTelemetry Collector](#the-spanprocessor-and-exporter-pipeline) exists as a separate process between your app and the backend.
- **Helpful:** You've run a message queue (Kafka, SQS, RabbitMQ, NATS) in anger and know what "at-least-once" means.
- **Helpful:** Basic capacity math — you can estimate spans/sec from RPS and reason about bytes and cost.
- **Helpful:** Familiarity with the metrics side ([`../metrics/middle.md`](../metrics/middle.md)) — cardinality intuition transfers directly to span attributes.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Head sampling** | The sampling decision is made at the *start* of the trace (root span creation), before the outcome is known. Cheap, stateless, but blind to errors and latency. |
| **Tail sampling** | The decision is made at the *end*, after all spans of a trace are collected, so you can keep "slow" or "errored" traces. Requires buffering and a stateful component (usually the Collector). |
| **Parent-based sampling** | The child honors the parent's sampling decision (the `sampled` flag in `traceparent`). Ensures a trace is sampled *consistently* across services — all-or-nothing, no half-traces. |
| **Probabilistic / ratio sampling** | Keep a fixed fraction (e.g. 1%) of traces. Implemented as `TraceIdRatioBased`, which thresholds on the trace ID so the decision is *deterministic and consistent* given the same trace ID. |
| **Rate-limiting sampler** | Keep at most N traces per second regardless of traffic — caps absolute volume, unlike ratio which scales with traffic. |
| **Consistent sampling** | Every service in a trace independently arrives at the *same* keep/drop decision because it's a deterministic function of the trace ID. The basis of `traceidratio` working without coordination. |
| **`Sampler`** | The OTel SDK component that returns `RECORD_AND_SAMPLE`, `RECORD_ONLY`, or `DROP` for each new root span. |
| **`SamplingResult`** | The sampler's output: the decision plus optional attributes and a modified `tracestate`. |
| **`ParentBased`** | A composite sampler: delegate to one sampler when there's a remote/local parent, another (the "root" sampler) when there isn't. |
| **`SpanProcessor`** | The pipeline stage that receives spans on start/end. `BatchSpanProcessor` (prod) batches and exports asynchronously; `SimpleSpanProcessor` exports synchronously (dev only). |
| **Exporter** | Serializes spans (OTLP, Jaeger, Zipkin) and ships them to a Collector or backend. |
| **OTel Collector** | A standalone process that receives, processes (batch, tail-sample, redact, enrich), and exports telemetry. Where fleet-wide tail sampling lives. |
| **Span link** | A non-parent reference to another span context. The correct tool for fan-in, batch, and async-decoupled relationships. |
| **`tracestate`** | The W3C companion header carrying vendor key-value state, including consistent-sampling probability (`ot=th:...`, the W3C "tracestate probability sampling" / `r`-value mechanism). |
| **Overhead budget** | The explicit CPU/memory/latency cost you allow instrumentation to consume, expressed as a percentage of the request's own work. |
| **Span granularity** | How finely you decompose work into spans. Too coarse = no signal; too fine = cost + unreadable waterfalls. |

---

## Core Concepts

### 1. The trace you didn't keep is invisible — sampling is a lossy decision you make blind

Sampling is not a tuning knob; it's a bet. Every dropped trace is gone forever. The hard part is that **head sampling makes the keep/drop decision before it knows whether the request errored or was slow** — exactly the traces you most want. Tail sampling fixes the blindness but pays for it in buffering and statefulness. There is no free lunch; there is only choosing which cost you pay.

### 2. Sampling must be *consistent* across a trace, or you get half-traces

If service A decides to keep a trace and service B independently decides to drop it, you get a trace with holes — a span tree missing its middle. The fix is **parent-based sampling** (B honors A's decision via the `sampled` flag) plus **consistent probability sampling** (the decision is a deterministic function of the trace ID, so everyone computes the same answer). A senior never deploys independent random samplers per service; that's how you manufacture broken traces.

### 3. The root decides; everyone downstream inherits

In a well-configured fleet, the **entry point** (the first service to see the request, or the load balancer) makes the sampling decision, and every downstream service uses `ParentBased` to honor it. This concentrates the policy in one place and makes traces all-or-nothing. The mental model: *one decision per request, made once, at the edge, honored everywhere*.

### 4. Spans cost money three times

A span costs **CPU** (creating it, setting attributes, serializing it), **memory** (held in the BatchSpanProcessor queue until export; held in the tail-sampler buffer until the trace completes), and **storage/egress** (network to the collector, disk at the backend, query cost). A span-per-iteration loop multiplies all three. Senior granularity decisions are budget decisions.

### 5. Context dies at every boundary the runtime doesn't carry it across

Middle taught you this in-process. At senior scale the boundaries multiply: a goroutine, a `ThreadPoolExecutor`, a `CompletableFuture`, a `tokio::spawn`, a `setImmediate`, and — the big ones — a **message queue** and a **batch job**. Across a queue the context doesn't travel in a function argument; it travels as a *message attribute you must inject and extract by hand*, and the relationship is usually a **link**, not a parent.

### 6. Semantic conventions are a fleet contract, and drift is silent

When every service emits `http.request.method`, your "errors by method" dashboard works. The day one team ships `http.method` (the old name) instead, that service vanishes from the dashboard — no error, just absence. Conventions are an API between producers (your services) and consumers (dashboards, alerts, anomaly detectors). Senior teams pin a semconv version, lint for it, and migrate in lockstep.

### 7. Overhead is a budget you set, not a number you discover

"How much does tracing cost?" is the wrong question. "What fraction of request latency and host CPU am I *willing* to spend on tracing, and how do I stay under it?" is the right one. Set a budget (e.g. < 2% CPU, < 1ms p99 added latency, bounded memory), then choose sampling rate, span count, exporter batching, and attribute volume to live inside it.

---

## The Overhead Budget

Before any sampling decision, set the budget. Tracing overhead has four components; each has a lever.

| Cost component | What drives it | Lever |
|---|---|---|
| **CPU per span** | Span creation, attribute setting, exception recording, serialization | Fewer spans (granularity), fewer attributes, async export |
| **Memory** | BatchSpanProcessor queue depth; tail-sampler buffering whole traces | Bound the queue (`max_queue_size`); tail-sample with TTL eviction |
| **Added latency** | Synchronous export (the killer), attribute computation on the hot path | Always use `BatchSpanProcessor`, never `SimpleSpanProcessor` in prod |
| **Network / storage / query** | Bytes per span × span rate × retention | Sampling rate, span count, attribute size, retention policy |

### The single worst overhead mistake

`SimpleSpanProcessor` exports **synchronously on `span.End()`** — your request thread blocks on a network round-trip to the collector for *every span*. In production this turns a 5ms handler into a 50ms one and couples your tail latency to the collector's health. **Use `BatchSpanProcessor` everywhere except local debugging.** It queues spans and exports them on a background timer in batches.

```go
// Go — production span processor config. The numbers ARE the budget.
bsp := sdktrace.NewBatchSpanProcessor(exporter,
    sdktrace.WithMaxQueueSize(2048),        // hard cap on in-flight spans (memory bound)
    sdktrace.WithMaxExportBatchSize(512),   // spans per export call
    sdktrace.WithBatchTimeout(5*time.Second),       // flush at least this often
    sdktrace.WithExportTimeout(30*time.Second),     // give up on a stuck collector
)
// When the queue is full, the SDK DROPS spans rather than block your request.
// That's the correct failure mode: shed telemetry, never the user's request.
```

The last point is doctrine: **when telemetry can't keep up, drop telemetry — never block the request.** A full BatchSpanProcessor queue silently discards spans. That's a feature. The alternative — backpressure into request handling — means your observability tool causes the outage it's meant to diagnose.

### Budget math you should be able to do at a whiteboard

- RPS × spans/request = spans/sec. 50k RPS × 30 spans = 1.5M spans/sec.
- spans/sec × ~500 bytes = export bandwidth. 1.5M × 500 B = 750 MB/s.
- Apply sampling: 1% head sampling → 15k spans/sec → 7.5 MB/s. Now affordable.
- Memory: `max_queue_size` × ~1 KB/span = worst-case processor memory. 2048 × 1 KB = ~2 MB. Trivial — until you forget to bound it.

---

## Sampling — The Central Design Decision

There is no single right sampler. There's a decision tree driven by what you're optimizing.

| Sampler | Decides when | Stateful? | Keeps errors/slow? | Volume scales with traffic? | Use when |
|---|---|---|---|---|---|
| **AlwaysOn** | Head | No | Yes (all) | Yes | Dev, staging, very low traffic |
| **AlwaysOff** | Head | No | No | — | Disable a noisy service |
| **TraceIdRatioBased** (probabilistic) | Head | No | No (blind) | Yes | High-traffic baseline, cheap, consistent |
| **Rate-limiting** | Head | Per-process | No (blind) | No (capped) | Cap absolute cost under traffic spikes |
| **ParentBased** | Head | No | Inherits | Inherits | **Always wrap your root sampler in this** |
| **Tail (Collector)** | Tail | Yes (buffers traces) | **Yes** | Configurable | You need every error/slow trace; can afford a stateful collector tier |

### Head vs tail — the defining trade-off

```text
   HEAD SAMPLING                              TAIL SAMPLING
   decide at root span creation               decide after the whole trace is collected
   ┌──────────────────────────┐               ┌────────────────────────────────────────┐
   │ "keep 1% by trace-id"     │              │ buffer EVERY span of EVERY trace until  │
   │ stateless, ~0 memory      │              │ the trace is 'done', then decide:       │
   │ decision propagates via   │              │   error?  → keep                        │
   │ traceparent sampled flag  │              │   slow?   → keep                        │
   │                           │              │   boring? → drop (keep 1% baseline)     │
   │ ✗ blind to errors/latency │              │ ✓ keeps the traces you actually want    │
   │ ✓ cheap, simple, no buffer│              │ ✗ collector must buffer + be stateful   │
   └──────────────────────────┘               └────────────────────────────────────────┘
```

The killer detail of tail sampling: **the application must export 100% of spans to the collector** (the collector can't decide to keep an error trace if the app already dropped its spans). So tail sampling moves the cost — your *app-to-collector* bandwidth is full-volume; the *collector-to-backend* bandwidth is sampled. That's why tail sampling lives in the Collector, near the app (often a per-node agent), not in the backend.

### Parent-based: the non-negotiable wrapper

Whatever your root sampler is, wrap it in `ParentBased`. This says: *if there's a parent, honor its decision; only run my sampler for root spans.* Without it, each service re-decides and you get half-traces.

```python
# Python — the canonical production head sampler.
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

# Keep 5% of traces, decided ONCE at the root, honored by all children.
sampler = ParentBased(root=TraceIdRatioBased(0.05))
provider = TracerProvider(sampler=sampler, resource=resource)
```

### Consistency: why `TraceIdRatioBased` works without coordination

`TraceIdRatioBased(0.05)` doesn't flip a coin. It hashes the trace ID into a fixed range and keeps the trace if it falls under the 5% threshold. Because **every service computes the same hash of the same trace ID, they all reach the same decision** — even without `ParentBased`, even with no communication. This is *consistent sampling*, and it's why ratio sampling produces whole traces. (W3C is standardizing this further via `tracestate` probability fields so heterogeneous SDKs agree exactly.)

---

## Head Sampling in Practice

Head sampling is your cheap baseline. It runs in the SDK, costs near-zero, and produces consistent whole traces. Its weakness — blindness to outcome — is partly recoverable with a **custom sampler** that reads root-span attributes (the route, an inbound header) available *at start time*.

### Rate-limiting vs ratio — pick based on your traffic shape

- **Ratio** (`TraceIdRatioBased`): keep 1% → at 10k RPS you keep 100/s; at 100k RPS you keep 1000/s. Volume *scales with traffic*. Good when cost scales fine and you want consistent statistical coverage.
- **Rate-limiting**: keep ≤ 100 traces/sec regardless of traffic. Volume is *capped*. Good when a traffic spike must not blow your telemetry budget — but under a spike your sampled *fraction* shrinks, so a rare bug during the spike is less likely to be captured.

Many fleets combine them: ratio as the base, with a rate limit as a circuit breaker.

### A custom head sampler — "always keep `/checkout`, 1% of the rest"

This is the most useful head-sampling pattern: encode business priority. You can read attributes set at root creation (route, method, a `x-debug: 1` header lifted into an attribute).

```go
// Go — custom Sampler: always sample checkout & health-excluded; ratio for the rest.
type prioritySampler struct {
    base sdktrace.Sampler // e.g. TraceIDRatioBased(0.01)
}

func (s prioritySampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
    // Attributes available at root-span start are in p.Attributes.
    for _, a := range p.Attributes {
        if a.Key == semconv.HTTPRouteKey && a.Value.AsString() == "/checkout" {
            return sdktrace.SamplingResult{
                Decision:   sdktrace.RecordAndSample,
                Tracestate: trace.SpanContextFromContext(p.ParentContext).TraceState(),
            }
        }
    }
    return s.base.ShouldSample(p) // delegate everything else to 1% ratio
}
func (s prioritySampler) Description() string { return "priority(checkout=on, base=1%)" }

// Wrap in ParentBased so children inherit and only roots run this:
sampler := sdktrace.ParentBased(prioritySampler{base: sdktrace.TraceIDRatioBased(0.01)})
```

> **The head-sampler's hard limit:** at root creation you don't yet know the *response status* or *latency* — they haven't happened. You can sample on *inputs* (route, tenant, a debug header) but never on *outcomes*. For outcomes, you need tail sampling.

---

## Tail Sampling in Practice

Tail sampling is how you guarantee "we kept every error trace and every slow trace, plus a 1% baseline of normal." It lives in the **OTel Collector** because the decision needs the *whole trace*, which means buffering all spans of a trace until it's "complete" (no new spans for some quiet period).

### How it works, and what it costs

1. The app exports **100%** of spans to the collector (head sampler = AlwaysOn, or a high ratio).
2. The collector's `tail_sampling` processor **groups spans by trace ID** and **buffers** them.
3. After a `decision_wait` window (e.g. 10s of no new spans), it evaluates **policies**: latency threshold, error status, attribute match, plus a probabilistic baseline.
4. Matching traces are exported to the backend; the rest are dropped.

The cost is real and load-bearing: the collector must **hold every span of every in-flight trace in memory** for `decision_wait`. At high RPS this is gigabytes. Get `num_traces` (the buffer cap) wrong and the collector OOMs — and a tail-sampling collector OOM is a single point of failure for *all* your tracing.

### A production tail-sampling policy

```yaml
# otel-collector-config.yaml — tail_sampling processor
processors:
  tail_sampling:
    decision_wait: 10s          # how long to wait for a trace to "finish"
    num_traces: 100000          # max traces buffered (MEMORY BOUND — size for your RPS)
    expected_new_traces_per_sec: 5000
    policies:
      - name: keep-all-errors
        type: status_code
        status_code: { status_codes: [ERROR] }       # every errored trace
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 1000 }               # every trace over 1s
      - name: keep-checkout
        type: string_attribute
        string_attribute: { key: http.route, values: [/checkout] }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 1 }     # 1% of everything else
```

### The tail-sampling trap: traces split across collectors

Tail sampling requires **all spans of one trace to reach the same collector instance** — otherwise no single collector sees the whole trace and the decision is wrong. With a fleet of collectors behind a load balancer, you must route by trace ID (a `loadbalancing` exporter in a two-tier collector setup: tier 1 routes by trace ID, tier 2 does the tail sampling). Forget this and your tail sampler quietly makes decisions on partial traces.

```text
   apps ──► [tier-1 collectors] ──route by trace-id──► [tier-2 tail-sampling collectors] ──► backend
            (loadbalancing exporter)                   (each owns a trace-id shard, sees WHOLE traces)
```

---

## Span Granularity — How Much Is Too Much

The waterfall is a UI a human reads under pressure. A span-per-loop-iteration trace is unreadable *and* expensive. Granularity is a deliberate decision.

| Granularity | Looks like | When it's right | When it's wrong |
|---|---|---|---|
| **Per request** | One span for the whole handler | Almost never enough alone | You lose all internal structure |
| **Per logical operation** | `reserve_inventory`, `charge_payment`, one span per DB query | **The default — aim here** | — |
| **Per loop iteration** | A span per item in a 10k-item batch | Debugging a specific item bug, briefly | Production default → span explosion |
| **Per function call** | A span on every method | Never in production | Tracing as a profiler — use a profiler |

### The rule

**A span should represent a unit of work you'd want to see as a distinct bar in the waterfall and measure independently.** A DB query: yes. A cache lookup: yes. The third iteration of a string-builder loop: no — that's what an *event* or an *attribute* is for. If you find yourself wanting per-iteration spans, you want a **profiler** (flame graph), not a tracer.

```python
# WRONG — span explosion: 10,000 spans for one batch, unreadable + expensive.
for item in batch:                                # 10k items
    with tracer.start_as_current_span("process_item"):  # 10k spans!
        process(item)

# RIGHT — one span for the batch; record counts as attributes, anomalies as events.
with tracer.start_as_current_span("process_batch") as span:
    span.set_attribute("batch.size", len(batch))
    failures = 0
    for item in batch:
        if not process(item):
            failures += 1
            if failures <= 10:                    # bound the events too!
                span.add_event("item.failed", {"item.id": item.id})
    span.set_attribute("batch.failures", failures)
```

### Bound everything that can grow with input

Span count, event count, and attribute size are all attack surfaces for your own bill. The SDK has limits (`OTEL_SPAN_EVENT_COUNT_LIMIT`, `OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT`, default 128 each) — but don't rely on silent truncation. **Bound them in your code**, because truncation loses data unpredictably and a span at the limit is a span that's too big.

---

## Async and Concurrency Propagation

This is where senior tracing earns its title. Middle covered the principle; here are the exact, correct mechanisms per runtime — because the default behavior of each async primitive is to *lose* the context.

### The universal rule

**Synchronous same-thread code propagates for free. The instant you cross to another thread, task, goroutine, future, or callback, you must carry the context across explicitly.** What "explicitly" means is runtime-specific.

### Go — `context.Context` and the goroutine trap

```go
// Go threads ctx as the first argument. The trap is goroutines that drop it.
func (s *Service) FanOut(ctx context.Context, ids []int) error {
    ctx, span := s.tracer.Start(ctx, "fanout")
    defer span.End()

    var wg sync.WaitGroup
    for _, id := range ids {
        wg.Add(1)
        // CAPTURE ctx in the closure / pass as arg — never context.Background().
        go func(ctx context.Context, id int) {
            defer wg.Done()
            // Child span correctly parented to "fanout" because ctx flowed in.
            _, sp := s.tracer.Start(ctx, "process", trace.WithAttributes(
                attribute.Int("item.id", id)))
            defer sp.End()
            s.process(ctx, id)
        }(ctx, id) // ← pass ctx explicitly; loop-var capture is the classic bug
    }
    wg.Wait()
    return nil
}
```

### Python — `contextvars` and the `ThreadPoolExecutor` break

`asyncio` propagates context automatically (it's built on `contextvars`). **Raw threads and `ThreadPoolExecutor` do not.** Use `contextvars.copy_context()` to carry it across.

```python
import contextvars
from concurrent.futures import ThreadPoolExecutor
from opentelemetry import trace

tracer = trace.get_tracer("worker")

def fan_out(items):
    with tracer.start_as_current_span("fanout"):
        ctx = contextvars.copy_context()       # snapshot CURRENT context (incl. active span)
        with ThreadPoolExecutor(max_workers=8) as pool:
            # ctx.run rebinds the context inside the worker thread:
            futures = [pool.submit(ctx.run, _process, item) for item in items]
            return [f.result() for f in futures]

def _process(item):
    # Runs on a worker thread BUT inside the copied context → span is parented correctly.
    with tracer.start_as_current_span("process") as span:
        span.set_attribute("item.id", item.id)
        return do_work(item)
```

For `asyncio`, the simpler reality: `asyncio.create_task()`, `gather`, and `await` all preserve context automatically. The one gotcha is **`loop.run_in_executor`** — it crosses into a thread pool, so wrap the callable with `contextvars.copy_context().run` exactly as above.

### Node.js — `AsyncLocalStorage` and the callback cliff

`@opentelemetry/context-async-hooks` installs `AsyncLocalStorage`, which follows promises, `async/await`, `setTimeout`, and most of the event loop automatically. It breaks on: **manual `EventEmitter` patterns, connection pools that reuse callbacks across requests, and some older callback-style libraries** that detach from the async chain.

```js
const { context, trace } = require("@opentelemetry/api");

// Promises/await: context flows automatically — nothing to do.
async function fanOut(items) {
  const tracer = trace.getTracer("worker");
  return tracer.startActiveSpan("fanout", async (span) => {
    const results = await Promise.all(items.map(processItem)); // context preserved across all
    span.end();
    return results;
  });
}

// EventEmitter break: the 'data' callback may run OUTSIDE the active context.
// Re-bind it explicitly with context.bind():
function onStream(stream) {
  const active = context.active();
  stream.on("data", context.bind(active, (chunk) => {
    // Now the active context is restored inside this callback.
    trace.getSpan(context.active())?.addEvent("chunk", { bytes: chunk.length });
  }));
}
```

### Java — thread-locals and the executor problem

The OTel context is a thread-local. `ExecutorService`, `CompletableFuture`, and any `new Thread()` start with an *empty* context unless you wrap them. The agent auto-wraps many executors; for manual code, wrap explicitly.

```java
import io.opentelemetry.context.Context;
import java.util.concurrent.*;

ExecutorService raw = Executors.newFixedThreadPool(8);
// Context.taskWrapping propagates the CURRENT context into every submitted task:
ExecutorService traced = Context.taskWrapping(raw);

void fanOut(List<Item> items) {
    Span span = tracer.spanBuilder("fanout").startSpan();
    try (Scope s = span.makeCurrent()) {
        List<Future<?>> futures = new ArrayList<>();
        for (Item item : items) {
            // Submitted via 'traced' → the task runs with THIS context as current.
            futures.add(traced.submit(() -> process(item)));
        }
        for (Future<?> f : futures) f.get();
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR);
    } finally {
        span.end();
    }
}
// CompletableFuture: wrap with Context.current().wrap(runnable) before supplyAsync,
// or use the traced executor as the second arg to supplyAsync(..., traced).
```

### Rust — `tracing` and the `.instrument()` discipline

In `tokio`, a spawned future starts detached from the current span. You **must** attach the span with `.instrument(span)` (for explicit spans) or `#[instrument]` (on the function). Forget it and the spawned work is an orphan.

```rust
use tracing::Instrument;

async fn fan_out(items: Vec<Item>) {
    let span = tracing::info_span!("fanout");
    async {
        let handles: Vec<_> = items.into_iter().map(|item| {
            // Each spawned task gets its OWN child span, attached via .instrument():
            let child = tracing::info_span!("process", item.id = item.id);
            tokio::spawn(async move {
                process(item).await;
            }.instrument(child))            // ← without this, the task is an orphan
        }).collect();
        for h in handles { let _ = h.await; }
    }
    .instrument(span)                       // ← attach the parent span to this async block
    .await;
}
```

| Runtime | Auto-propagates across | Breaks across (carry by hand) |
|---|---|---|
| **Go** | nothing implicit — `ctx` is always explicit | any goroutine that doesn't receive `ctx` |
| **Python** | `asyncio` tasks, `gather`, `await` | `ThreadPoolExecutor`, raw threads, `run_in_executor` |
| **Node** | promises, `async/await`, timers (via `AsyncLocalStorage`) | manual `EventEmitter`, pooled callbacks, some old libs |
| **Java** | nothing implicit (thread-local) | `ExecutorService`, `CompletableFuture`, `new Thread()` |
| **Rust** | the current sync scope | every `tokio::spawn` without `.instrument()` |

---

## Queue and Message Propagation — Producer/Consumer and Links

The network hop is easy: `traceparent` rides HTTP headers. The **queue** hop is where most fleets lose the trace, because:

1. The context can't ride a function argument — it must be **injected into the message** (as Kafka headers, SQS message attributes, an AMQP header, a NATS header).
2. The relationship is usually **not a parent-child**. A producer enqueues; minutes later a consumer (maybe one of many, maybe replaying) dequeues. Making the consumer a *child* of the producer would create traces that stay "open" across an arbitrary queue delay and break the latency semantics of the producer span. The correct relationship is usually a **span link**.

### Producer/Consumer span kinds + a link

```text
   PRODUCER side                      QUEUE                    CONSUMER side
   ┌────────────────────┐                                     ┌─────────────────────┐
   │ span (PRODUCER)    │  inject traceparent INTO message    │ span (CONSUMER)     │
   │  enqueue order      │ ──────────────────────────────────►│  new trace OR linked │
   │  span ENDS here     │   (headers/attributes travel       │  via span LINK to    │
   │                     │    with the message payload)        │  the producer's span │
   └────────────────────┘                                     └─────────────────────┘
   Producer span ends at enqueue — it does NOT stay open until the consumer runs.
   The consumer starts a fresh root (CONSUMER) span and LINKS to the producer context.
```

### Kafka — Go producer/consumer with manual inject/extract

```go
// PRODUCER: inject the current context into Kafka record headers.
func produce(ctx context.Context, w *kafka.Writer, key, val []byte) error {
    ctx, span := tracer.Start(ctx, "orders publish",
        trace.WithSpanKind(trace.SpanKindProducer),
        trace.WithAttributes(
            semconv.MessagingSystemKey.String("kafka"),
            semconv.MessagingDestinationNameKey.String("orders"),
        ))
    defer span.End()

    msg := kafka.Message{Key: key, Value: val}
    // Inject traceparent into the record's headers (the carrier across the queue):
    otel.GetTextMapPropagator().Inject(ctx, &kafkaHeaderCarrier{&msg})
    return w.WriteMessages(ctx, msg)
}

// CONSUMER: extract the producer context, start a CONSUMER span LINKED (not parented) to it.
func consume(ctx context.Context, msg kafka.Message) {
    // Recover the producer's span context from the message headers:
    parentCtx := otel.GetTextMapPropagator().Extract(ctx, &kafkaHeaderCarrier{&msg})
    link := trace.LinkFromContext(parentCtx)

    _, span := tracer.Start(ctx, "orders process",
        trace.WithSpanKind(trace.SpanKindConsumer),
        trace.WithLinks(link),                    // ← LINK, not parent
        trace.WithAttributes(
            semconv.MessagingSystemKey.String("kafka"),
            semconv.MessagingOperationKey.String("process"),
        ))
    defer span.End()
    handle(msg)
}

// kafkaHeaderCarrier adapts kafka.Message headers to the OTel TextMapCarrier interface.
type kafkaHeaderCarrier struct{ msg *kafka.Message }
func (c *kafkaHeaderCarrier) Get(key string) string {
    for _, h := range c.msg.Headers { if h.Key == key { return string(h.Value) } }
    return ""
}
func (c *kafkaHeaderCarrier) Set(key, val string) {
    c.msg.Headers = append(c.msg.Headers, kafka.Header{Key: key, Value: []byte(val)})
}
func (c *kafkaHeaderCarrier) Keys() []string {
    ks := make([]string, len(c.msg.Headers))
    for i, h := range c.msg.Headers { ks[i] = h.Key }
    return ks
}
```

### Parent vs link — the senior judgment call

| Use a **parent** (child span) | Use a **link** |
|---|---|
| Synchronous request/response (HTTP, gRPC) | Asynchronous decoupling (queue, event bus) |
| The caller waits for the callee | The producer does not wait for the consumer |
| One caller → one callee | Fan-in: many producers → one consumer (batch) |
| Latency of callee is part of caller's latency | Consumer runs minutes/hours later, or replays |

The deciding question: **does the upstream span's *duration* meaningfully include the downstream work?** If yes (sync call), parent. If no (the producer already returned), link. Getting this wrong gives you producer spans that appear to take 4 hours (because they "wait" for a consumer that ran after lunch).

### SQS / messaging semantic conventions

OTel's messaging conventions standardize the attributes so backends render queue topology: `messaging.system` (`kafka`/`aws_sqs`/`rabbitmq`), `messaging.destination.name`, `messaging.operation` (`publish`/`receive`/`process`), `messaging.message.id`. Set these and your APM draws the producer→queue→consumer graph automatically.

---

## Batch, Fan-Out, and Fan-In

Batches break the one-parent assumption. A consumer that pulls **100 messages from 100 different traces** in one poll cannot have one parent — it has 100 sources. This is the canonical **fan-in**, and links are the only correct model.

```python
# Python — a batch consumer: one processing span LINKED to all source traces.
from opentelemetry import trace
from opentelemetry.trace import Link
from opentelemetry.propagate import extract

tracer = trace.get_tracer("batch-consumer")

def process_batch(messages):
    # Each message carries its own producer context in its headers.
    links = []
    for m in messages:
        producer_ctx = extract(m.headers)                  # recover producer span context
        sc = trace.get_current_span(producer_ctx).get_span_context()
        if sc.is_valid:
            links.append(Link(sc, attributes={"messaging.message.id": m.id}))

    # ONE span for the batch, LINKED to every source trace (fan-in):
    with tracer.start_as_current_span(
        "process_batch",
        kind=trace.SpanKind.CONSUMER,
        links=links,                                       # N links, not N parents
    ) as span:
        span.set_attribute("messaging.batch.message_count", len(messages))
        for m in messages:
            handle(m)
```

In the backend UI, this span shows up in its own (batch) trace, with **clickable links to each of the 100 originating traces** — exactly the "where did this batch's items come from?" navigation you want, without a 100-parent monstrosity.

### Cron / scheduled batch jobs

A nightly job has *no inbound request* and therefore no inbound context — it's the **root of its own trace**. Don't try to link it to anything; start a fresh root span (`SpanKind.INTERNAL` or `SERVER` if triggered by a scheduler call), set `service.name` to the job, and let it own its trace. If the job processes records that *do* carry trace context (e.g. rows written by traced requests), link to those per record.

---

## Semantic Conventions as a Contract

Conventions are not cosmetic. They're the schema your dashboards, alerts, and anomaly detectors query against. Treat them like an API.

### The drift failure mode

```text
   Team A emits:  http.request.method = "POST"   (semconv 1.20+)
   Team B emits:  http.method         = "POST"   (semconv 1.0, the OLD name)

   Dashboard query: count by http.request.method
   → Team B's traffic is INVISIBLE. No error. Just a hole in the graph.
   → Your "5xx by service" alert never fires for Team B. Silent blindness.
```

### The migration reality

The HTTP conventions went through a stable rename: `http.method` → `http.request.method`, `http.status_code` → `http.response.status_code`, `http.url` → `url.full`, `net.peer.name` → `server.address`. OTel shipped `OTEL_SEMCONV_STABILITY_OPT_IN=http/dup` so instrumentation emits **both** old and new during migration. Senior teams:

1. **Pin a semconv version** in a shared config/library.
2. **Emit dup during transition**, update dashboards to new names, then drop old.
3. **Lint** custom attributes for namespace + convention compliance in CI.

| Domain | Current (stable) keys | Old keys (you'll still see) |
|---|---|---|
| HTTP server | `http.request.method`, `http.route`, `http.response.status_code`, `url.path`, `server.address` | `http.method`, `http.status_code`, `http.target` |
| HTTP client | `http.request.method`, `url.full`, `http.response.status_code` | `http.url`, `net.peer.name` |
| Database | `db.system`, `db.namespace`, `db.query.text`, `db.operation.name` | `db.name`, `db.statement`, `db.operation` |
| Messaging | `messaging.system`, `messaging.destination.name`, `messaging.operation` | `messaging.destination` |
| Resource | `service.name`, `service.version`, `deployment.environment.name` | `deployment.environment` |

### Custom attributes: namespace and bound them

Your own attributes belong under a company namespace (`acme.checkout.step`, not `step`) to avoid colliding with future OTel conventions. And mind cardinality: a span attribute can hold a high-cardinality value (a request UUID) — it doesn't multiply storage the way a *metric label* would — but it inflates the trace backend's index. Be intentional; never put PII or secrets, and never the *concrete* path in `http.route` (use the template `/users/:id`).

---

## The SpanProcessor and Exporter Pipeline

Senior tracing means owning the pipeline from span to backend. The shape:

```text
   Tracer ─► Sampler (head) ─► SpanProcessor ─► Exporter ─► [OTel Collector] ─► Backend
             (keep/drop)        (Batch!)          (OTLP)      (batch, tail-sample,   (Jaeger,
                                                               redact, enrich,        Tempo,
                                                               route by trace-id)     Datadog…)
```

### Why a Collector, not direct-to-backend

Senior fleets export to a **Collector**, not straight to the backend, because the Collector is where you do the work that shouldn't live in every app: **tail sampling, PII redaction, attribute enrichment (add `k8s.pod.name`), batching, retries, backend fan-out, and protocol translation**. Moving these out of the app means you change sampling policy or swap backends *without redeploying every service*. The app's job shrinks to "emit OTLP to localhost:4317."

```yaml
# A senior collector pipeline: redact, enrich, tail-sample, export.
processors:
  attributes/redact:
    actions:
      - { key: http.request.header.authorization, action: delete }  # kill secrets
      - { key: db.query.text, action: hash }                        # hash, don't drop
  resource:
    attributes:
      - { key: k8s.cluster.name, value: prod-us-east, action: insert }  # enrich
  tail_sampling: { ... }   # as above
  batch: { timeout: 5s, send_batch_size: 1024 }
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [attributes/redact, resource, tail_sampling, batch]
      exporters: [otlp/tempo]
```

> **PII redaction belongs in the Collector, not scattered across 40 services.** One redaction policy, enforced centrally, audited once. Auto-instrumentation *will* capture `Authorization` headers and query strings if you let it — strip them here.

---

## Code Examples

### Full Go SDK init — production sampler + batch processor + resource

```go
func initTracing(ctx context.Context) (func(context.Context) error, error) {
    res, err := resource.New(ctx,
        resource.WithAttributes(
            semconv.ServiceName("checkout"),
            semconv.ServiceVersion(buildVersion),
            semconv.DeploymentEnvironmentName("production"),
        ),
        resource.WithProcess(), resource.WithContainer(), // host/k8s enrichment
    )
    if err != nil { return nil, err }

    exp, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("localhost:4317"), // the node-local collector
        otlptracegrpc.WithInsecure())
    if err != nil { return nil, err }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithResource(res),
        // ParentBased(ratio) — consistent, whole traces, 5% baseline.
        sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.05))),
        sdktrace.WithSpanProcessor(sdktrace.NewBatchSpanProcessor(exp,
            sdktrace.WithMaxQueueSize(2048),
            sdktrace.WithMaxExportBatchSize(512))),
    )
    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{}, propagation.Baggage{}))
    return tp.Shutdown, nil // call on graceful shutdown to flush the batch queue
}
```

### Graceful shutdown — flush the buffer or lose the last traces

The most-forgotten line in production tracing: **on shutdown, the BatchSpanProcessor still holds un-exported spans.** If you don't flush, you lose the final batch — often *the traces from the request that crashed you*.

```go
func main() {
    shutdown, err := initTracing(context.Background())
    if err != nil { log.Fatal(err) }
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer cancel()
        _ = shutdown(ctx)  // ← flushes the batch queue; without this you drop spans
    }()
    runServer()
}
```

### Python — async batch consumer with link, asyncio-safe

```python
import asyncio
from opentelemetry import trace
from opentelemetry.trace import Link, SpanKind
from opentelemetry.propagate import extract

tracer = trace.get_tracer("consumer")

async def consume_loop(queue):
    while True:
        msg = await queue.get()              # asyncio: context flows automatically
        producer_ctx = extract(msg.headers)
        sc = trace.get_current_span(producer_ctx).get_span_context()
        link = Link(sc) if sc.is_valid else None

        with tracer.start_as_current_span(
            "process", kind=SpanKind.CONSUMER,
            links=[link] if link else None,
        ) as span:
            span.set_attribute("messaging.system", "redis")
            span.set_attribute("messaging.operation", "process")
            try:
                await handle(msg)            # await preserves context across the await point
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR)
```

### Node — tail-sample-friendly setup (export everything, sample at collector)

```js
// For tail sampling: the APP samples ALWAYS_ON, the COLLECTOR decides what to keep.
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { AlwaysOnSampler, ParentBasedSampler } = require("@opentelemetry/sdk-trace-base");
const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-grpc");

new NodeSDK({
  serviceName: "checkout",
  // Export 100% to the collector; the collector's tail_sampling does the real filtering.
  sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  spanProcessors: [new BatchSpanProcessor(
    new OTLPTraceExporter({ url: "http://localhost:4317" }),
    { maxQueueSize: 2048, maxExportBatchSize: 512 }
  )],
}).start();
```

### Java — agent with sampler + semconv stability via system properties

```bash
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.service.name=checkout \
  -Dotel.traces.sampler=parentbased_traceidratio \
  -Dotel.traces.sampler.arg=0.05 \
  -Dotel.exporter.otlp.endpoint=http://localhost:4317 \
  -Dotel.semconv-stability.opt-in=http/dup \
  -Dotel.bsp.max.queue.size=2048 \
  -Dotel.bsp.max.export.batch.size=512 \
  -Dotel.instrumentation.common.peer-service-mapping=... \
  -jar checkout.jar
# parentbased_traceidratio = ParentBased(TraceIdRatioBased(0.05)) — the production default.
# http/dup = emit BOTH old and new HTTP attribute names during the semconv migration.
```

### Rust — sampler + batch + resource via opentelemetry-otlp

```rust
use opentelemetry_sdk::trace::{self, Sampler, BatchConfig};
use opentelemetry_sdk::Resource;
use opentelemetry::KeyValue;

fn init_tracer() -> opentelemetry_sdk::trace::Tracer {
    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(opentelemetry_otlp::new_exporter().tonic()
            .with_endpoint("http://localhost:4317"))
        .with_trace_config(
            trace::config()
                // ParentBased(ratio) — consistent whole traces at 5%.
                .with_sampler(Sampler::ParentBased(Box::new(
                    Sampler::TraceIdRatioBased(0.05))))
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", "checkout"),
                    KeyValue::new("service.version", env!("CARGO_PKG_VERSION")),
                    KeyValue::new("deployment.environment.name", "production"),
                ])),
        )
        // Batch exporter on the tokio runtime — async, non-blocking.
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .expect("tracer init")
}
```

---

## Real Failure Stories

These are the shapes of incidents that teach the senior lessons. Names are generic; the mechanisms are real and recur across companies.

### 1. The trace that ate the collector (tail-sampling OOM)

A team turned on tail sampling to "keep all the errors." They set `num_traces: 1000000` without doing the memory math. A traffic spike during a sale pushed in-flight traces past a million; each held all its spans in memory; the collector OOMed and **restarted, dropping every buffered trace** — including all the error traces they turned on tail sampling to keep. *Lesson:* tail sampling makes the collector a stateful, memory-bound, single point of failure. Size `num_traces` from RPS × `decision_wait`, alert on collector memory, and run the two-tier (route-by-trace-id) topology so one collector's death isn't fleet-wide.

### 2. "The trace stops at Kafka" (queue propagation never wired)

A checkout flow traced perfectly through three HTTP services, then *vanished* — the order-processing consumer's work appeared as a separate, parentless trace. Cause: the producer never injected `traceparent` into the Kafka record headers, and the consumer never extracted it. Auto-instrumentation covered the HTTP hops but the team used a raw Kafka client the instrumentation didn't wrap. *Lesson:* auto-instrumentation covers *known* libraries; custom or raw queue clients need manual inject (producer) and extract+link (consumer). Test propagation across the queue explicitly.

### 3. The 4-hour span (parent where a link belonged)

An APM dashboard showed producer spans with p99 latency of *hours*. Engineers chased a non-existent Kafka slowness for a day. The real cause: someone made the consumer a **child** of the producer, so the producer span stayed "open" in the UI until the consumer processed the message — which, during a backlog, was hours later. *Lesson:* across async decoupling, use a **link**, not a parent. The producer span ends at enqueue. A producer span whose duration includes consumer time is a modeling bug, not a performance bug.

### 4. The dashboard with a hole (semconv drift)

A "5xx rate by service" dashboard quietly stopped showing one service after a library upgrade. No alert fired during a real incident *for that service* because the alert queried `http.status_code` and the upgraded library now emitted `http.response.status_code`. The blindness lasted weeks. *Lesson:* semantic-convention names are a contract. Pin the version, run `http/dup` during migrations, and treat a service disappearing from a dashboard as a P2, not a curiosity.

### 5. The 30% latency tax (SimpleSpanProcessor in prod)

A service's p99 jumped 30% after an "observability improvement." The change: someone wired `SimpleSpanProcessor` (synchronous export) instead of `BatchSpanProcessor`. Every `span.End()` blocked the request thread on a gRPC call to the collector; when the collector had a GC pause, the *application's* tail latency spiked in lockstep. *Lesson:* `SimpleSpanProcessor` is for unit tests. `BatchSpanProcessor` everywhere else. Never let the request thread block on telemetry export.

### 6. The PII leak in span attributes

A security review found full `Authorization` bearer tokens and customer emails sitting in trace attributes, searchable in the APM UI by anyone with read access. Auto-instrumentation had captured request headers and query strings wholesale. *Lesson:* audit what auto-instrumentation captures *before* shipping, and enforce redaction centrally in the Collector so one policy covers the whole fleet. See [`../logging/senior.md`](../logging/senior.md) for the parallel discipline on the logs side.

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **Head sampling (ratio)** | Cheap, stateless, consistent whole traces, near-zero memory | Blind to errors/latency — drops the traces you most want |
| **Tail sampling** | Keeps every error & slow trace; outcome-aware | Stateful, memory-bound collector; SPOF; full app→collector bandwidth |
| **Parent-based** | Whole traces, one decision per request | Edge must be configured correctly; misconfig = half-traces |
| **Rate-limiting sampler** | Caps absolute volume under spikes | Sampled *fraction* shrinks during spikes — may miss spike bugs |
| **Coarse granularity** | Cheap, readable waterfalls | May hide where time actually went |
| **Fine granularity** | Deep visibility | Span explosion: cost, unreadable UI, SDK limit truncation |
| **Span links (async)** | Correct async modeling; fan-in works | Less obvious in some UIs than parent-child; teams forget them |
| **Collector tier** | Central sampling/redaction/enrichment; swap backends freely | Another system to run, scale, and monitor |
| **Semconv discipline** | Portable dashboards, alerts that fire | Migration churn; drift causes silent blindness |

---

## Use Cases

- **"We can't afford 100% tracing but need every error."** Head AlwaysOn → Collector tail sampling with error + latency policies.
- **"Cost is fine but we want statistical coverage."** `ParentBased(TraceIdRatioBased(0.05))` head sampling; no collector buffering needed.
- **"A traffic spike must not 10× our telemetry bill."** Rate-limiting sampler as a circuit breaker over a ratio base.
- **"The trace dies at the queue."** Manual inject (producer) + extract & link (consumer); set messaging semconv.
- **"This batch's items came from where?"** One consumer span, N links — clickable navigation to source traces.
- **"A dashboard has a hole."** Semconv drift — a service emitting old attribute names. Pin + `dup` + migrate.
- **"Tracing added latency."** `SimpleSpanProcessor` in prod, or synchronous attribute computation on the hot path. Switch to batch.
- **"The waterfall is unreadable."** Span-per-iteration explosion. Collapse to per-operation spans; use events/attributes for detail.

---

## Coding Patterns

### Pattern: ParentBased(ratio) as the universal default

```python
sampler = ParentBased(root=TraceIdRatioBased(float(os.environ["OTEL_SAMPLE_RATIO"])))
# One env var tunes fleet-wide sampling. Consistent, whole traces, no per-service drift.
```

### Pattern: link, don't parent, across a queue

```go
parentCtx := propagator.Extract(ctx, carrier)
_, span := tracer.Start(ctx, "process",
    trace.WithSpanKind(trace.SpanKindConsumer),
    trace.WithLinks(trace.LinkFromContext(parentCtx))) // link across the async boundary
```

### Pattern: bound everything that scales with input

```python
with tracer.start_as_current_span("batch") as span:
    span.set_attribute("batch.size", len(items))   # a count, not 10k spans
    for i, item in enumerate(items):
        if failed(item) and i < 50:                # bound the events
            span.add_event("item.failed", {"id": item.id})
```

### Pattern: flush on shutdown

```go
defer func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = tracerProvider.Shutdown(ctx) // flush the batch queue or lose the last traces
}()
```

### Pattern: copy context across a thread pool (Python)

```python
ctx = contextvars.copy_context()
pool.submit(ctx.run, work, arg) # worker runs inside the captured context → correct parenting
```

---

## Clean Code

- **`ParentBased` is mandatory around any root sampler.** A bare per-service sampler manufactures half-traces.
- **`BatchSpanProcessor` in production, always.** `SimpleSpanProcessor` is a test-only tool.
- **Bound the processor queue** (`max_queue_size`) so a slow collector can't grow memory unbounded — let it drop spans instead.
- **Flush on shutdown.** Wire `provider.Shutdown(ctx)` into your graceful-shutdown path.
- **Across async/queue boundaries, carry context explicitly** — `ctx`, `copy_context().run`, `Context.taskWrapping`, `.instrument()`, `context.bind`. The default is to lose it.
- **Link for async, parent for sync.** Decide by whether the upstream duration includes the downstream work.
- **One span per logical operation, not per loop iteration.** Counts and anomalies go in attributes/events.
- **Pin a semconv version fleet-wide** and lint custom attributes for namespacing.
- **Redact PII in the Collector**, centrally — not in 40 separate services.

---

## Best Practices

1. **Set an overhead budget first** (CPU %, added p99 latency, memory), then choose sampling and granularity to fit it.
2. **Default to `ParentBased(TraceIdRatioBased(r))`** with `r` from one env var; tune fleet-wide from one place.
3. **Use tail sampling when you must keep all errors/slow traces** — and size `num_traces` from RPS × `decision_wait`, alert on collector memory, run the two-tier route-by-trace-id topology.
4. **Always `BatchSpanProcessor`; bound the queue; flush on shutdown.**
5. **Cap span/event/attribute volume per request.** Anything that scales with input is a self-inflicted cost.
6. **Across queues: inject in the producer, extract + link in the consumer**, with messaging semconv set.
7. **Carry context across every async boundary explicitly**, using the runtime's correct mechanism.
8. **Pin semconv, migrate with `dup`, lint for drift** — a service vanishing from a dashboard is a P2.
9. **Push sampling, redaction, and enrichment into the Collector** so you can change policy without redeploying services.
10. **Test propagation in CI** — assert a downstream/consumer span carries the upstream trace ID across HTTP *and* the queue.

---

## Edge Cases & Pitfalls

- **Tail sampler sees partial traces.** Spans of one trace landed on different collector instances. Route by trace ID (loadbalancing exporter, two-tier collectors).
- **Collector OOM on tail buffering.** `num_traces` too high or a `decision_wait` too long during a spike. Size it; alert on memory.
- **`SimpleSpanProcessor` shipped to prod.** Synchronous export couples request latency to collector health. Use batch.
- **Forgot to flush on shutdown.** The last batch — often the crash's traces — is lost.
- **Half-traces from independent samplers.** No `ParentBased`; each service re-decides. Trace has holes.
- **Producer-as-parent across a queue.** Producer spans appear to last hours. Use links.
- **Context lost in a thread pool / `tokio::spawn` / `CompletableFuture`.** Orphan spans. Carry context across the boundary by hand.
- **Semconv drift.** One service emits old attribute names → silent dashboard/alert blindness.
- **Span/attribute SDK limits silently truncating.** A span at the 128-attribute or event limit loses data unpredictably. Bound it yourself.
- **Sampling on a header an attacker controls.** A `x-debug: 1`-forces-keep rule is a DoS vector (force 100% sampling). Rate-limit or restrict it.
- **Baggage growth.** Propagated `baggage` rides every request header; unbounded baggage bloats every hop and can leak PII. Keep it tiny and non-sensitive.
- **Ratio sampling under low traffic.** 1% of 10 RPS is ~6 traces/minute — too few to be useful. Raise the rate at low volume.

---

## Common Mistakes

1. **No `ParentBased`** → half-traces across services.
2. **`SimpleSpanProcessor` in production** → latency tax + coupling to collector health.
3. **Tail sampling without memory math** → collector OOM that drops the very errors you wanted.
4. **Span-per-iteration loops** → span explosion, unreadable waterfalls, cost.
5. **Parent instead of link across a queue** → producer spans that "take hours."
6. **No inject/extract across a custom queue client** → trace dies at the queue.
7. **Losing context in async/thread-pool boundaries** and not noticing until an incident.
8. **Semconv drift** → silent dashboard holes and alerts that never fire.
9. **No shutdown flush** → losing the final, most relevant traces.
10. **Sampling decisions scattered in every service** instead of centralized at the edge + collector.
11. **PII captured by auto-instrumentation** and never redacted.
12. **Tuning sampling rate without an overhead budget** — guessing instead of engineering.

---

## Tricky Points

- **Head sampling cannot sample on outcome.** At root creation the status and latency don't exist yet. Inputs only (route, tenant, debug header). Outcomes need tail.
- **`TraceIdRatioBased` is deterministic, not random.** It thresholds on the trace ID, so all services agree without coordination — that's *why* it produces whole traces.
- **Tail sampling pays full bandwidth app→collector.** You only save downstream of the sampling decision. The cost moved; it didn't vanish.
- **A link is not weaker than a parent — it's a different relationship.** Use it whenever the upstream's duration shouldn't include the downstream's.
- **The producer span ends at enqueue.** It does not wait for the consumer. If your producer span's duration includes consumer time, your model is wrong.
- **`BatchSpanProcessor` drops spans when full — by design.** Shedding telemetry under load is correct; backpressuring the request is not.
- **Sampling and metrics disagree intentionally.** Metrics count *all* requests; sampled traces represent a *fraction*. Never compute rates from sampled traces — that's what metrics are for. (Exemplars bridge them — `professional.md`.)
- **`decision_wait` is a latency floor for tail decisions.** A trace isn't sampled until `decision_wait` after its last span — your error traces appear in the backend seconds late. Fine for debugging, not for real-time alerting (alert on metrics).
- **Consistent sampling across heterogeneous SDKs needs the `tracestate` probability mechanism.** Different-language SDKs at the same ratio agree only if they use the same hashing — W3C is standardizing it; mixed-version fleets can still drift slightly.

---

## Test Yourself

1. Your service does 40k RPS, 25 spans/request, ~500 B/span. Compute spans/sec and export bandwidth at 100% and at 2% head sampling. Which is affordable?
2. Explain why `ParentBased` is required and what *exactly* breaks without it. Draw the resulting trace.
3. A teammate proposes "each service randomly keeps 10% of traces, independently." What's wrong, and what's the fix?
4. You must keep 100% of error traces but only 1% of successes. Which sampling strategy, where does it run, and what's the memory cost?
5. A Kafka consumer's spans show up as separate parentless traces. List the exact producer-side and consumer-side changes to fix it — and say whether you parent or link.
6. A producer span shows a p99 of 3 hours. Diagnose it without looking at Kafka metrics.
7. A batch consumer pulls 200 messages from 200 different traces per poll. How do you model the processing span? Why not 200 parents?
8. Your "5xx by service" dashboard silently lost a service after a dependency upgrade. Name the most likely cause and the two-step fix.
9. Python: you submit work to a `ThreadPoolExecutor` and the worker spans are orphans. Write the fix.
10. Set an overhead budget for a latency-sensitive service (state the numbers) and list the four levers you'd pull to stay inside it.

---

## Tricky Questions

**Q1: Head or tail sampling — which do you pick, and why isn't it obvious?**

It depends on what you're optimizing. **Head** is cheap, stateless, and produces consistent whole traces, but it's *blind to outcome* — it decides before it knows the request errored or was slow, so it drops exactly the traces you'd want. **Tail** is outcome-aware (keep all errors, all slow traces, 1% baseline) but requires the collector to **buffer every span of every trace** until the trace completes, making it stateful, memory-bound, and a single point of failure. The senior answer is usually *both*: head AlwaysOn (or high ratio) from the app, tail sampling in the collector for the real keep/drop. The non-obvious cost: tail sampling pays **full app→collector bandwidth** — you only save downstream of the decision.

**Q2: Why must sampling be consistent across services, and how is that achieved without coordination?**

If services decide independently, you get **half-traces** — a span tree with holes where a service dropped what others kept. Consistency is achieved two ways that compose: **`ParentBased`** (children honor the parent's `sampled` flag) and **`TraceIdRatioBased`** (the keep/drop is a deterministic threshold on the *trace ID*, so every service computes the same answer from the same ID). No messages, no coordination — same input, same decision everywhere.

**Q3: A producer span's p99 latency is "4 hours." What happened?**

Someone made the **consumer a child of the producer** across a queue, so the producer span stays open in the UI until the consumer runs — which, during a backlog, was hours later. The producer span *should end at enqueue*; the consumer should start a fresh span **linked** (not parented) to the producer context. Across async decoupling, parent-child is the wrong model because the upstream's duration must not include the downstream's.

**Q4: Why can't I compute my error rate from sampled traces?**

Because sampled traces are a *fraction* of reality (and tail sampling deliberately over-represents errors). Rates computed from a biased, partial sample are wrong. **Metrics count every request; traces are examples.** Compute rates from metrics; use traces to investigate the *individual* requests behind a rate. (Exemplars link a metric data point to a representative trace — `professional.md`.)

**Q5: My tail-sampling collector keeps OOMing during traffic spikes. What's the root cause and fix?**

Tail sampling holds **all spans of all in-flight traces in memory** for `decision_wait`. A spike pushes the in-flight trace count past `num_traces`, memory blows, the collector restarts and **drops every buffered trace** — including the errors you turned tail sampling on to keep. Fix: size `num_traces` from `RPS × decision_wait`, alert on collector memory, run a **two-tier topology** (tier 1 routes by trace ID, tier 2 buffers) so spans of one trace land on the same instance and one collector's death isn't fleet-wide, and shorten `decision_wait` if your traces complete fast.

**Q6: When do I use a span link instead of a parent?**

When the **upstream span's duration should not include the downstream work**: async queues, event buses, batch fan-in (many sources → one processing span), and any case where the producer already returned. Parent-child is for synchronous request/response where the caller genuinely waits. The test question: *does the caller's latency include the callee's?* Yes → parent. No → link.

**Q7: How many spans is too many for one request?**

When the waterfall stops being readable by a human under incident pressure, or when span count scales with *input size* (per loop iteration, per item in a 10k batch). Aim for **one span per logical operation** — a DB query, an RPC, a business step. If you want per-item detail, use **events or attributes** (bounded), and if you want per-function timing, use a **profiler** (flame graph), not a tracer. Span count is a cost multiplier on CPU, memory, and storage simultaneously.

**Q8: How do you stop tracing from adding latency to requests?**

Three rules. **One:** `BatchSpanProcessor`, never `SimpleSpanProcessor` — export happens async on a background timer, not synchronously on `span.End()`. **Two:** keep attribute computation off the hot path (don't serialize a giant object to set an attribute on every span). **Three:** let the processor **drop spans when its queue is full** rather than backpressure the request. Telemetry must degrade gracefully; it must never be the cause of the outage it's meant to diagnose.

**Q9: A whole service disappeared from the latency dashboard. No errors. Why?**

Almost certainly **semantic-convention drift** — a library upgrade changed the attribute name the service emits (`http.status_code` → `http.response.status_code`, or `http.method` → `http.request.method`), and the dashboard/alert still queries the old name. No error fires because the data isn't *wrong*, it's under a *different key*. Fix: pin a semconv version fleet-wide, run `OTEL_SEMCONV_STABILITY_OPT_IN=http/dup` during migration to emit both names, update queries, then drop the old. Treat a service vanishing from a dashboard as a real incident.

---

## Cheat Sheet

```text
┌──────────────────────────── TRACING — SENIOR CHEAT SHEET ───────────────────────────────┐
│                                                                                          │
│  SAMPLING — pick by what you optimize                                                    │
│    HEAD (root decides): cheap, stateless, CONSISTENT, but BLIND to errors/latency        │
│      → ParentBased(TraceIdRatioBased(r))   ← the universal default                       │
│      → rate-limiting: caps absolute volume (spike circuit-breaker)                       │
│    TAIL (collector decides after whole trace): keeps errors+slow, but STATEFUL + MEM     │
│      → app=AlwaysOn, collector tail_sampling{ errors, latency>Xms, 1% baseline }         │
│      → MUST route by trace-id (two-tier collectors) or you sample partial traces         │
│                                                                                          │
│  ParentBased is MANDATORY — without it: HALF-TRACES                                       │
│  TraceIdRatioBased is DETERMINISTIC on trace-id → all services agree, no coordination     │
│                                                                                          │
│  OVERHEAD BUDGET (set FIRST)                                                              │
│    BatchSpanProcessor ALWAYS (Simple = sync = latency tax). Bound max_queue_size.        │
│    Full queue → DROP spans (correct). FLUSH on shutdown or lose the last traces.         │
│    spans/sec = RPS × spans/req ; bytes/s = spans/sec × ~500B ; then apply sampling        │
│                                                                                          │
│  GRANULARITY                                                                             │
│    one span per LOGICAL OPERATION. NOT per loop iteration (span explosion).               │
│    per-item detail → events/attributes (bounded). per-function → use a PROFILER.          │
│                                                                                          │
│  ASYNC / QUEUE PROPAGATION (carry context EXPLICITLY)                                     │
│    Go: pass ctx into goroutine · Py: copy_context().run · Node: context.bind             │
│    Java: Context.taskWrapping · Rust: .instrument(span)                                   │
│    QUEUE: producer INJECT into msg headers → consumer EXTRACT + LINK (not parent)         │
│    parent if caller waits ; LINK if async-decoupled / fan-in / producer already returned  │
│                                                                                          │
│  SEMCONV = a CONTRACT. drift = SILENT dashboard holes.                                    │
│    pin version · migrate with http/dup · lint custom attrs (namespace them)              │
│                                                                                          │
│  COLLECTOR does: tail-sample · redact PII · enrich · batch · route — change w/o redeploy │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At scale, tracing is **economics and engineering under constraint**, not "add a span." The defining questions are sampling, granularity, overhead, hard-boundary propagation, and semconv as a contract.
- **Sampling is a lossy bet made blind.** **Head** sampling is cheap, stateless, consistent, but can't see outcomes. **Tail** sampling keeps every error/slow trace but is stateful, memory-bound, and a single point of failure. Most fleets run both: head AlwaysOn from the app, tail policies in the Collector.
- **`ParentBased` is non-negotiable** — without it, independent per-service decisions create half-traces. **`TraceIdRatioBased`** is deterministic on the trace ID, so services agree without coordination (consistent sampling).
- **Set an overhead budget** (CPU %, added latency, memory) and pick sampling/granularity/batching to fit. **`BatchSpanProcessor` always**; bound its queue; flush on shutdown; let it drop spans under load rather than backpressure requests. **`SimpleSpanProcessor` is test-only** — it's a latency tax.
- **Granularity: one span per logical operation.** Span-per-iteration is a self-inflicted span explosion. Per-item detail → bounded events/attributes; per-function timing → a profiler.
- **Carry context explicitly across every async boundary** — goroutines, thread pools, `CompletableFuture`, `tokio::spawn`, `EventEmitter`. The default is to lose it.
- **Across queues: inject in the producer, extract and *link* in the consumer.** Parent if the caller waits; link if async-decoupled or fan-in. A producer-as-parent gives you "4-hour" producer spans.
- **Semantic conventions are a fleet contract.** Drift causes silent dashboard holes and alerts that never fire. Pin the version, migrate with `dup`, lint for compliance.
- **Push sampling, redaction, and enrichment into the Collector** so policy changes without redeploying services. See [`../logging/senior.md`](../logging/senior.md) and [`../metrics/middle.md`](../metrics/middle.md) for the other two pillars.

---

## What You Can Build

- A **sampling cost calculator**: input RPS, spans/request, bytes/span, and sampling rate; output spans/sec, bandwidth, monthly storage at each strategy — so sampling becomes a budget decision, not a guess.
- A **two-tier OTel Collector deployment**: tier-1 `loadbalancing` exporter routing by trace ID into tier-2 tail-sampling collectors, with policies for errors + latency + a baseline — and a load test that proves it samples *whole* traces, not partial ones.
- A **queue-propagation library** for your stack (Kafka/SQS/NATS): producer inject helper, consumer extract+link helper, with messaging semconv set, plus a CI test asserting the consumer span links to the producer's trace ID.
- A **granularity linter**: a check that flags `start_span` calls inside loops, or any span creation whose count scales with input.
- A **semconv-drift detector**: a CI job (or collector processor) that alerts when a service emits a deprecated attribute name, so dashboard holes are caught at deploy time.
- An **overhead benchmark harness**: measure p50/p99 latency and CPU with tracing off, head-sampled, and AlwaysOn, to quantify your actual overhead budget on real handlers.
- A **PII-redaction collector config** with an audit: fire a request carrying `Authorization` and `?token=`, confirm both are stripped before the backend.

---

## Further Reading

- **Sampling**
  - OpenTelemetry Sampling concepts — <https://opentelemetry.io/docs/concepts/sampling/>
  - OTel Collector `tail_sampling` processor — <https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor>
  - OTel Collector `loadbalancing` exporter (route-by-trace-id for tail sampling) — contrib repo.
  - W3C Trace Context Level 2 & the `tracestate` probability sampling mechanism — <https://www.w3.org/TR/trace-context/>
- **Propagation & conventions**
  - OTel Context Propagation — <https://opentelemetry.io/docs/concepts/context-propagation/>
  - OTel Messaging semantic conventions — <https://opentelemetry.io/docs/specs/semconv/messaging/>
  - HTTP semconv migration & `OTEL_SEMCONV_STABILITY_OPT_IN` — <https://opentelemetry.io/docs/specs/semconv/http/>
- **Pipeline**
  - OTel Collector architecture (receivers/processors/exporters) — <https://opentelemetry.io/docs/collector/>
  - `BatchSpanProcessor` configuration & span limits — OTel SDK spec.
- **Books / talks**
  - Yuri Shkuro, *Mastering Distributed Tracing* — sampling strategies and adaptive sampling chapters.
  - Charity Majors et al., *Observability Engineering* — events vs metrics, high-cardinality, sampling economics.

---

## Related Topics

- **Previous level:** [middle.md](middle.md) — propagation basics, inject/extract, span kind, semconv intro, trace ID in logs.
- **Next level up:** [professional.md](professional.md) — fleet-wide OTel architecture, adaptive sampling, baggage governance, exemplars, org-wide telemetry standards.
- **Foundations:** [junior.md](junior.md) — span anatomy, your first span.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Senior](../logging/senior.md) — sampling logs, PII redaction, and the logs side of correlation; the same economics in a different pillar.
- [Metrics — Middle](../metrics/middle.md) — cardinality intuition that transfers directly to span attributes; rates belong to metrics, not sampled traces.
- [Debugging — Senior](../debugging/senior.md) — distributed debugging with traces, the diagnostic toolkit you ship.

**Cross-roadmap links:**

- [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/) — collector topology, backend storage, and trace-store scaling.

---

## Diagrams & Visual Aids

### The Sampling Decision Tree

```text
   Do you need every ERROR / SLOW trace kept?
        │
        ├── NO  → HEAD sampling: ParentBased(TraceIdRatioBased(r))
        │          cheap · stateless · consistent · blind to outcome
        │          (add rate-limiting if spikes must not blow the budget)
        │
        └── YES → TAIL sampling in the Collector
                   app = AlwaysOn  →  collector buffers whole traces  →
                   policies: errors + latency>Xms + 1% baseline
                   COST: stateful · memory-bound · route-by-trace-id required
```

### Head vs Tail — Where the Cost Lives

```text
   HEAD                                  TAIL
   app ──(1%)──► collector ──► backend   app ──(100%)──► collector ──(1%+errors)──► backend
        ↑ decision here                       ↑ full bandwidth      ↑ decision here (buffered)
   cheap, blind                          app→collector pays full ; collector is stateful/SPOF
```

### Sync = Parent, Async = Link

```text
   SYNC (caller waits)                    ASYNC (producer returns immediately)
   ┌─────────────┐                        ┌─────────────┐        ┌──────────────┐
   │ caller      │  parent                │ producer    │ enqueue│  consumer    │
   │   ┌───────┐ │  child                 │ span ENDS   │───────►│  new span    │
   │   │ callee│ │  (duration nested)     │ at enqueue  │  LINK  │  LINK to     │
   │   └───────┘ │                        └─────────────┘        │  producer    │
   └─────────────┘                                               └──────────────┘
   caller's duration includes callee     producer's duration does NOT include consumer
```

### The Senior Pipeline

```text
   Tracer ─► Sampler(head) ─► BatchSpanProcessor ─► OTLP Exporter
                                                         │
                                                         ▼
                              ┌──────── OTel Collector (per-node agent) ────────┐
                              │  receive → redact PII → enrich(k8s) → batch      │
                              │  → route-by-trace-id → tail_sample → export      │
                              └──────────────────────┬───────────────────────────┘
                                                     ▼
                                        Backend (Tempo / Jaeger / Datadog)
   Change sampling, redaction, backend — WITHOUT redeploying a single service.
```

---
