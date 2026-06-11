# Tracing — Junior Level

> **Topic:** [Tracing Roadmap](README.md)
> **Focus:** What a trace is. What a span is. Trace vs span vs log. Your first instrumented span in Go, Python, Java, Node, and Rust. Why a request needs context that travels *with* it.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Anatomy of a Span](#anatomy-of-a-span)
8. [Trace vs Span vs Log vs Metric](#trace-vs-span-vs-log-vs-metric)
9. [Code Examples](#code-examples)
10. [Why Request-Scoped Context Matters](#why-request-scoped-context-matters)
11. [Pros & Cons of Tracing vs Logging](#pros--cons-of-tracing-vs-logging)
12. [Use Cases](#use-cases)
13. [Coding Patterns](#coding-patterns)
14. [Clean Code](#clean-code)
15. [Best Practices](#best-practices)
16. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Test Yourself](#test-yourself)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Summary](#summary)
23. [What You Can Build](#what-you-can-build)
24. [Further Reading](#further-reading)
25. [Related Topics](#related-topics)
26. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a trace, really?** and **What does a beginner do the first time they want to know where a request spent its time?**

A **log** answers *"what did this one line of code say?"* A **metric** answers *"how many, how fast, on average?"* A **trace** answers a question neither can: *"what was the actual path this one request took, and where did the time go along that path?"*

When a single button-click in a web app fans out to an API gateway, an auth service, a database, and a payment provider, no single log file tells you the whole story. The auth service's logs don't know about the database. The database's logs don't know which user clicked. Tracing stitches all of it back together by attaching **the same ID** to every step of one request and recording how long each step took. The result is a tree — a parent operation with children nested under it, each child a unit of work with a start time and a duration.

This page is your first map. We'll define the two words you must never confuse — **trace** and **span** — walk through the anatomy of a span (its ID, its parent, its name, its attributes, its timing), and write your first instrumented span in five languages using **OpenTelemetry**, the cross-language standard that almost every tracing backend speaks. The next level (`middle.md`) covers how that ID gets *propagated* across an `await` and across a network call. `senior.md` covers sampling — how to keep the interesting traces without storing all of them.

> 🎓 **Why this matters for a junior:** The first time you open a trace UI and see a 4-second request broken into spans — and one bright bar that's 3.8 seconds of "wait for database" — you stop *guessing* where slowness lives and start *seeing* it. That shift from guessing to seeing is the whole reason tracing exists. Logs tell you a service was slow; a trace tells you *which call inside it* was slow, and what called it.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program in at least one of Go, Python, Java, JavaScript/Node, or Rust.
- **Required:** What a function call is, and that one function can call another (a *call stack*).
- **Required:** What an HTTP request is — a client sends one, a server handles it, and a response comes back.
- **Helpful:** Basic familiarity with logging. See [`../logging/junior.md`](../logging/junior.md). Tracing builds on the same instinct ("record what happened") but organizes it as a tree instead of a flat stream.
- **Helpful:** Awareness that real systems are made of *multiple* services talking over the network — that's the world tracing was invented for.
- **Helpful:** Knowing what a UUID or a random hex ID looks like. Trace and span IDs are just that — random identifiers.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Trace** | The whole story of one request as it moves through your system. A tree of spans sharing one **trace ID**. |
| **Span** | One unit of work inside a trace — a function call, a DB query, an HTTP call. Has a name, a start time, a duration, and an ID. |
| **Trace ID** | A unique identifier (16 bytes / 32 hex chars in OpenTelemetry) shared by *every* span in one trace. |
| **Span ID** | A unique identifier (8 bytes / 16 hex chars) for *one* span. Different for every span. |
| **Root span** | The first span in a trace — has no parent. Usually "handle the incoming request." |
| **Parent / child span** | A span started *inside* another is its child. The parent's duration usually contains the child's. |
| **Attribute** (a.k.a. tag) | A key-value pair attached to a span: `http.method=GET`, `user.id=42`, `db.system=postgresql`. |
| **Event** | A timestamped note *within* a span — like a log line that belongs to this span: "cache miss," "retry 1." |
| **Status** | Whether the span succeeded or failed: `Unset`, `Ok`, or `Error`. |
| **Tracer** | The object you ask to start spans. You get one from the SDK: `tracer.start_span(...)`. |
| **Span context** | The small bundle (`trace ID` + `span ID` + flags) that identifies a span and links children to it. |
| **OpenTelemetry (OTel)** | The vendor-neutral standard + SDKs for traces, metrics, and logs. What you'll write your instrumentation against. |
| **Instrumentation** | The code that creates spans — either written by hand (*manual*) or injected by a library/agent (*automatic*). |
| **Exporter** | The component that ships finished spans out to a backend (Jaeger, Tempo, Datadog, etc.). |
| **Backend** | The system that stores and displays traces. Jaeger and Grafana Tempo are common open-source ones. |
| **Waterfall view** | The visual layout of a trace: horizontal bars, each a span, nested and time-aligned. |

---

## Core Concepts

### 1. A Trace Is a Tree; a Span Is a Node

The single most important sentence on this page: **a trace is a tree of spans.** The root span is the trunk. Every operation that happens *inside* it becomes a child. A child that does its own sub-work gets grandchildren. When you draw it out, you get exactly the shape of a call stack — except this call stack spans *machines*, and each node remembers how long it took.

```text
trace (id=4bf92...)
└─ span "GET /checkout"          [0ms ──────────────── 920ms]  (root)
   ├─ span "auth.verify"         [2ms ── 30ms]
   ├─ span "db.load_cart"        [31ms ──── 80ms]
   └─ span "payment.charge"      [81ms ──────────────── 915ms]  ← the slow one
      └─ span "POST stripe.com"  [90ms ──────────────── 910ms]
```

### 2. Every Span Knows Its Trace and Its Parent

A span carries three crucial IDs: its own **span ID**, the **trace ID** it belongs to, and its **parent span ID**. With these three, a backend can reassemble thousands of spans — arriving out of order, from different machines — into the exact tree above. No central coordinator is needed; the IDs *are* the structure.

### 3. Spans Measure Time

A span is started, then ended. The difference is its **duration**. This is the heart of tracing: you don't just learn that a request happened — you learn that it took 920ms, and that 834ms of that was the payment call, and that 820ms of *that* was waiting on Stripe. Each level narrows the question.

### 4. Attributes Describe; Events Annotate

You hang **attributes** on a span to describe it: which user, which URL, which database table, which status code. You add **events** to mark moments inside it: "cache miss at 40ms," "retry attempt 2 at 300ms." Attributes describe the whole span; events are timestamped points within it.

### 5. A Span Has a Status

By default a span is `Unset` (no opinion). On success you may set `Ok`. On failure you set `Error` and usually record the exception. This is what lets a trace UI paint failing spans red and lets you filter "show me only traces that errored."

### 6. OpenTelemetry Is the Lingua Franca

You don't write code against "Jaeger" or "Datadog." You write against **OpenTelemetry** — one API in your language — and *configure* where the spans go. Swap the exporter, and the same instrumented code ships to a different backend. This decoupling is why OTel won: your code outlives your vendor choice.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Trace** | The complete shipment tracking page for one parcel — every scan, every depot, end to end. |
| **Span** | One scan event: "arrived at Frankfurt hub, 14:02, stayed 3 hours." |
| **Trace ID** | The tracking number printed on the parcel — the same on every scan. |
| **Parent/child** | A package inside a bigger crate inside a container. Open the container to find the crate, the crate to find the package. |
| **Root span** | "Order placed" — the event that started the whole journey. |
| **Attribute** | The label on the parcel: weight, destination, fragile-or-not. |
| **Event** | A handwritten note on the manifest: "held at customs 14:30." |
| **Status** | The final stamp: delivered (Ok) or returned-to-sender (Error). |
| **Waterfall view** | The Gantt chart of the journey — each leg a horizontal bar on a timeline. |
| **Log vs trace** | A log is a single diary entry from one warehouse worker; a trace is the whole journey reconstructed from all of them. |

---

## Mental Models

### 1. Tracing Is a Call Stack That Survives the Network

You already understand a call stack: `main` calls `handleRequest`, which calls `loadCart`, which calls `queryDB`. A trace is *that exact picture* — but `queryDB` might be a different process on a different continent, and the trace still draws the nesting correctly. If you can read a stack trace, you can read a trace waterfall. The difference is that the trace also has a **time axis**.

### 2. The Span Is a `with`/`defer`/`try` Block With a Stopwatch

In code, a span is almost always a scoped block: you start it at the top, do work, and end it at the bottom — exactly like opening and closing a file. The SDK gives you `with tracer.start_as_current_span(...)` (Python), `defer span.End()` (Go), or `try (var s = span.makeCurrent())` (Java). Whatever's *inside* that block is "the work this span measures."

### 3. The Trace ID Is the Thread of Ariadne

In the myth, Theseus unspooled a thread to find his way back out of the labyrinth. The trace ID is that thread. As long as it's carried through every hop, you can always trace one request back through the maze of services. **Drop the thread — break the propagation — and the trace shatters into disconnected pieces.** That dropped thread is the #1 tracing bug, and it's why `middle.md` is mostly about propagation.

### 4. Spans Are Cheap to Create, Expensive to Over-Create

Starting a span costs roughly a few hundred nanoseconds — cheap. But a span per `for`-loop iteration over a million rows is a million spans, and *that* drowns your backend and your bill. The junior instinct "trace everything" is exactly wrong. Trace the *meaningful boundaries*: an incoming request, an outgoing call, a significant unit of work. Not every function.

---

## Anatomy of a Span

Every span — in any language, on any backend — has the same skeleton. Learn it once:

| Field | Example | What it's for |
|---|---|---|
| **Trace ID** | `4bf92f3577b34da6a3ce929d0e0e4736` | Ties this span to all others in the same request. |
| **Span ID** | `00f067aa0ba902b7` | Uniquely identifies *this* span. |
| **Parent span ID** | `a1b2c3d4e5f60718` (or empty for root) | Points at the span this one happened inside. |
| **Name** | `GET /checkout`, `db.query`, `payment.charge` | A *low-cardinality* label for the kind of operation. |
| **Start time** | `2026-06-11T09:00:00.000Z` | When the span began. |
| **End time / Duration** | `+920ms` | When it ended; the difference is the duration. |
| **Attributes** | `{http.method: "GET", user.id: 42}` | Key-value descriptors of this span. |
| **Events** | `[{name: "cache.miss", time: +40ms}]` | Timestamped notes within the span. |
| **Status** | `Error` + `"deadline exceeded"` | Success/failure of the operation. |
| **Span kind** | `SERVER`, `CLIENT`, `INTERNAL`, `PRODUCER`, `CONSUMER` | The role this span plays (handling vs making a call). |

> **The name is a category, not a value.** Name a span `GET /users/:id`, never `GET /users/42`. The user ID goes in an *attribute* (`user.id=42`). If you bake the ID into the name, every request becomes a unique span name and the backend chokes. This is the cardinality rule, and it bites everyone once.

---

## Trace vs Span vs Log vs Metric

The single most clarifying table in this whole roadmap. Pin it to your memory:

| Signal | Granularity | Answers | Example |
|---|---|---|---|
| **Metric** | Aggregate | "How many / how fast, overall?" | `http_requests_total{status="500"} = 1473` |
| **Log** | One event | "What did the code say at this instant?" | `ERROR user 42 not found` |
| **Span** | One operation | "How long did *this* step take, and did it succeed?" | span `db.query` took 48ms, status Ok |
| **Trace** | One request | "What's the full path and where did the time go?" | 6 spans across 4 services, 920ms total |

The three are **complementary, not competing** — together they're called the *three pillars of observability*. A mature system emits all three and **correlates them**: the metric spike tells you something's wrong, the trace tells you *where*, and the logs (carrying the same trace ID) tell you *what exactly*. You'll learn that correlation in `middle.md`; the key idea now is that a span is *not* a fancy log — it's a measured, parented, time-bounded operation.

> A useful rule of thumb: if the thing you want to record has a **duration** and a **place in the request's path**, it's a span (or an event on a span). If it's a **count or a gauge over time**, it's a metric. If it's a **point-in-time message**, it's a log. See [`../metrics/README.md`](../metrics/README.md) and [`../logging/README.md`](../logging/README.md) for the sibling disciplines.

---

## Code Examples

All examples use **OpenTelemetry** and the same toy scenario: handle a "checkout" request, which loads a cart and charges a payment. We export to the console so you can *see* the spans without setting up a backend.

### Python

```python
# pip install opentelemetry-sdk opentelemetry-api
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

# One-time setup: where do spans go? Here, the console.
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("checkout")  # your first tracer

def load_cart(user_id: int) -> list[str]:
    with tracer.start_as_current_span("db.load_cart") as span:
        span.set_attribute("user.id", user_id)
        return ["book", "pen"]            # pretend DB call

def charge(user_id: int, amount: int) -> None:
    with tracer.start_as_current_span("payment.charge") as span:
        span.set_attribute("payment.amount", amount)
        span.add_event("calling payment provider")
        # pretend HTTP call to Stripe here

def checkout(user_id: int) -> None:
    # The ROOT span — everything below nests under it automatically.
    with tracer.start_as_current_span("checkout") as span:
        span.set_attribute("user.id", user_id)
        items = load_cart(user_id)
        charge(user_id, amount=len(items) * 500)

if __name__ == "__main__":
    checkout(user_id=42)
```

Run it. You'll see three JSON span objects printed. Look for `trace_id` — it's **identical** across all three. Look for `parent_id` — `db.load_cart` and `payment.charge` both point at `checkout`'s span ID. The tree is right there in the output.

### Go

```go
// go get go.opentelemetry.io/otel \
//        go.opentelemetry.io/otel/sdk/trace \
//        go.opentelemetry.io/otel/exporters/stdout/stdouttrace
package main

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func main() {
	exporter, _ := stdouttrace.New(stdouttrace.WithPrettyPrint())
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	defer tp.Shutdown(context.Background()) // flush spans on exit
	otel.SetTracerProvider(tp)

	tracer := otel.Tracer("checkout")
	checkout(context.Background(), tracer, 42)
}

func checkout(ctx context.Context, tracer trace.Tracer, userID int) {
	ctx, span := tracer.Start(ctx, "checkout") // root span
	defer span.End()
	span.SetAttributes(attribute.Int("user.id", userID))

	loadCart(ctx, tracer, userID)
	charge(ctx, tracer, 1000)
}

func loadCart(ctx context.Context, tracer trace.Tracer, userID int) {
	_, span := tracer.Start(ctx, "db.load_cart") // child: ctx carries the parent
	defer span.End()
	span.SetAttributes(attribute.Int("user.id", userID))
}

func charge(ctx context.Context, tracer trace.Tracer, amount int) {
	_, span := tracer.Start(ctx, "payment.charge")
	defer span.End()
	span.AddEvent("calling payment provider")
	span.SetAttributes(attribute.Int("payment.amount", amount))
}
```

**The crucial detail in Go:** `tracer.Start(ctx, ...)` returns a *new* `ctx` that carries the span. You pass *that* `ctx` down. The child knows its parent **because the parent is hidden inside the `context.Context`.** Pass the wrong `ctx` (or `context.Background()`), and the child becomes an orphan root. This is the single most common Go tracing bug — more in `middle.md`.

### Java

```java
// build.gradle: implementation 'io.opentelemetry:opentelemetry-api'
//               implementation 'io.opentelemetry:opentelemetry-sdk'
//               implementation 'io.opentelemetry:opentelemetry-exporter-logging'
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import io.opentelemetry.exporter.logging.LoggingSpanExporter;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;

public class Checkout {
    static final OpenTelemetry otel = OpenTelemetrySdk.builder()
        .setTracerProvider(SdkTracerProvider.builder()
            .addSpanProcessor(SimpleSpanProcessor.create(LoggingSpanExporter.create()))
            .build())
        .build();
    static final Tracer tracer = otel.getTracer("checkout");

    public static void main(String[] args) {
        Span root = tracer.spanBuilder("checkout").startSpan();
        try (Scope s = root.makeCurrent()) {          // makeCurrent => children attach
            root.setAttribute(AttributeKey.longKey("user.id"), 42L);
            loadCart(42);
            charge(1000);
        } finally {
            root.end();                                // ALWAYS end the span
        }
    }

    static void loadCart(long userId) {
        Span span = tracer.spanBuilder("db.load_cart").startSpan();
        try (Scope s = span.makeCurrent()) {
            span.setAttribute(AttributeKey.longKey("user.id"), userId);
        } finally { span.end(); }
    }

    static void charge(long amount) {
        Span span = tracer.spanBuilder("payment.charge").startSpan();
        try (Scope s = span.makeCurrent()) {
            span.addEvent("calling payment provider");
            span.setAttribute(AttributeKey.longKey("payment.amount"), amount);
        } finally { span.end(); }
    }
}
```

The `try (Scope s = span.makeCurrent())` is Java's version of "make this the current span so children attach to it," and the `finally { span.end(); }` is the non-negotiable cleanup. Forget the `end()` and the span leaks — it's never reported. (In real Java you'd usually skip all this and use the **auto-instrumentation agent**; see `middle.md`.)

### Node.js (JavaScript / TypeScript)

```js
// npm i @opentelemetry/sdk-trace-node @opentelemetry/api
const { trace } = require("@opentelemetry/api");
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");
const { SimpleSpanProcessor, ConsoleSpanExporter } =
  require("@opentelemetry/sdk-trace-base");

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register(); // installs the context manager (async_hooks under the hood)

const tracer = trace.getTracer("checkout");

function loadCart(userId) {
  return tracer.startActiveSpan("db.load_cart", (span) => {
    span.setAttribute("user.id", userId);
    span.end();
    return ["book", "pen"];
  });
}

function charge(amount) {
  return tracer.startActiveSpan("payment.charge", (span) => {
    span.addEvent("calling payment provider");
    span.setAttribute("payment.amount", amount);
    span.end();
  });
}

function checkout(userId) {
  tracer.startActiveSpan("checkout", (span) => {       // root
    span.setAttribute("user.id", userId);
    const items = loadCart(userId);                    // child, automatically
    charge(items.length * 500);
    span.end();
  });
}

checkout(42);
```

`startActiveSpan` runs your callback *with the span as the active context*, so anything you call inside becomes a child automatically. You still must call `span.end()` yourself — Node won't do it for you.

### Rust (`tracing` + OpenTelemetry)

```rust
// Cargo.toml:
//   tracing = "0.1"
//   tracing-subscriber = "0.3"
use tracing::{info, instrument};

#[instrument]                       // this attribute = "make this fn a span"
fn load_cart(user_id: u64) -> Vec<&'static str> {
    info!(user_id, "loading cart"); // an event inside the span
    vec!["book", "pen"]
}

#[instrument]
fn charge(amount: u64) {
    info!(amount, "calling payment provider");
}

#[instrument]                       // the root span: name = "checkout"
fn checkout(user_id: u64) {
    let items = load_cart(user_id); // child span, nested automatically
    charge(items.len() as u64 * 500);
}

fn main() {
    tracing_subscriber::fmt().init(); // console output of the span tree
    checkout(42);
}
```

Rust's idiomatic path is the **`tracing` crate**: the `#[instrument]` attribute turns a function into a span automatically, and `info!`/`warn!` macros emit events scoped to the current span. To ship these spans to a real backend you add `tracing-opentelemetry` (covered in `middle.md`); for now, `fmt()` prints the nested tree to your terminal.

---

## Why Request-Scoped Context Matters

Here's the question that separates "I made a span" from "I understand tracing": **how does `load_cart` know it belongs to the same request as `checkout`?**

The answer is **context propagation**, and you've already used it without naming it:

- In **Go**, the parent span lives inside the `context.Context` you passed down.
- In **Python** and **Node**, it lives in an implicit "current span" stored in a context variable (`contextvars` / `async_hooks`).
- In **Java**, `makeCurrent()` puts it in a thread-local.
- In **Rust**, the `tracing` subscriber tracks the currently-entered span.

In *all five*, the rule is identical: **a new span attaches to whatever the "current" span is.** Get the current span right, and the tree assembles itself. Lose it — start a span without the parent in scope — and you get an **orphan**: a span with no parent, floating in its own trace, disconnected from the request it actually served.

This is why "request-scoped context" is the central idea. The request carries a small invisible backpack (the active span context) as it moves through your code. Every span you start peeks in the backpack, finds its parent, and links to it. The hard part — and the subject of the entire next level — is keeping that backpack attached when the request crosses an `await`, a thread pool, a goroutine, or the network. Those boundaries *drop the backpack* unless you're careful.

> **The one-sentence takeaway:** a trace stays whole only as long as the context is propagated; the moment it's lost, the trace breaks into orphans, and a broken trace is often worse than no trace — because it *looks* like the request stopped where it actually just lost its thread.

---

## Pros & Cons of Tracing vs Logging

| Approach | Pros | Cons |
|---|---|---|
| **Tracing (spans)** | Shows the *path* and *timing* of one request across services. Built-in parent/child structure. Finds the slow hop instantly. Correlates services automatically via trace ID. | Needs context propagation (easy to break). Sampling means not every request is kept. Setup + backend required. Per-span cost if overused. |
| **Logging** | Dead simple. Works everywhere, no propagation needed. Captures arbitrary detail. See [`../logging/junior.md`](../logging/junior.md). | Flat — no built-in structure linking lines across services. You reconstruct the request manually (grep by request ID). No automatic timing. |
| **Metrics** | Tiny and cheap at any scale. Perfect for dashboards and alerts. See [`../metrics/README.md`](../metrics/README.md). | Aggregate only — can't explain *one* slow request. High-cardinality labels get expensive fast. |

The honest rule: **use all three.** A metric alert says "p99 is bad." A trace shows "it's the payment span." A log (carrying the trace ID) says "Stripe returned 429 rate-limited." Each hands off to the next.

---

## Use Cases

| Situation | Why a trace helps |
|---|---|
| "The checkout is slow but I don't know which part." | The waterfall shows exactly which span dominates the duration. |
| "A request failed somewhere across five services." | The trace highlights the one span with `Error` status, in the right service. |
| "Is the database or the payment provider the bottleneck?" | Compare the two child spans' durations side by side. |
| "This request worked but felt sluggish — no error." | Tracing catches *slow-but-successful*; logs and error metrics don't. |
| "I want to see what one specific user's request did." | Filter traces by the `user.id` attribute. |
| "Did the retry actually fire?" | A span event (`retry.attempt=2`) records it on the timeline. |

---

## Coding Patterns

### Pattern 1 — Span Per Meaningful Boundary, Not Per Function

```python
# GOOD: spans at boundaries that matter.
with tracer.start_as_current_span("handle_request"):
    with tracer.start_as_current_span("db.query"):
        rows = db.query(...)
    with tracer.start_as_current_span("render"):
        return render(rows)

# BAD: a span for every tiny helper. Noise, cost, no insight.
with tracer.start_as_current_span("add"):  # don't trace add(a, b)
    return a + b
```

### Pattern 2 — Name by Category, Detail in Attributes

```go
// GOOD: low-cardinality name, high-cardinality detail in attributes.
ctx, span := tracer.Start(ctx, "GET /users/:id")
span.SetAttributes(attribute.Int("user.id", id))

// BAD: the ID in the name explodes cardinality.
ctx, span := tracer.Start(ctx, fmt.Sprintf("GET /users/%d", id)) // ✗
```

### Pattern 3 — Always End the Span (Prefer Scoped Helpers)

```go
ctx, span := tracer.Start(ctx, "work")
defer span.End()           // defer guarantees it ends, even on panic/early-return
```

```python
with tracer.start_as_current_span("work"):  # the `with` block ends it for you
    ...
```

### Pattern 4 — Record Errors on the Span

```python
with tracer.start_as_current_span("charge") as span:
    try:
        do_charge()
    except Exception as e:
        span.record_exception(e)
        span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
        raise
```

This is what turns a span red in the UI and makes "show me failed traces" work.

---

## Clean Code

- **End every span you start.** Use `defer` (Go), `with` (Python), `try-with-resources` (Java), `startActiveSpan` (Node). A leaked span is a span that never reports.
- **Names are categories.** `GET /orders/:id`, not `GET /orders/9931`. IDs are attributes.
- **Don't trace trivial functions.** A span has a cost and adds visual noise. Trace boundaries, not arithmetic.
- **Never put secrets or PII in attributes.** A trace backend is searchable storage; `password`, full card numbers, and tokens do not belong in spans. (Senior topic, but start the habit now.)
- **Use semantic-convention names** where they exist: `http.request.method`, `db.system`, `url.full`. Backends light up special UIs when you use the standard keys. More in `middle.md`.
- **Set status on failure.** An un-statused error span looks successful in the UI.

---

## Best Practices

1. **Write against OpenTelemetry, configure the backend separately.** Your instrumented code shouldn't mention Jaeger or Datadog by name.
2. **Start with one root span per incoming request**, then add child spans only for outbound calls and significant work.
3. **Pass context explicitly in Go** (`ctx` as the first argument, everywhere). Most Go propagation bugs are a missing or wrong `ctx`.
4. **Prefer auto-instrumentation for frameworks** (HTTP servers, DB drivers) and reserve manual spans for *your* business logic. (`middle.md` covers this split.)
5. **Look at a real trace early.** Run the console exporter, read the JSON, find the shared trace ID and the parent links. Understanding beats memorizing.
6. **Put the trace ID in your logs** so you can jump from a log line to its trace. (The correlation pattern; `middle.md`.)
7. **Resist "trace everything."** Meaningful boundaries only. Volume is cost and noise.

---

## Edge Cases & Pitfalls

- **The orphan span.** Start a span without the parent in the current context and it becomes its own root — disconnected from the request. Caused by passing `context.Background()` in Go, or losing the active context across an `await`.
- **The leaked (never-ended) span.** Forgot `span.End()` / `span.end()`. It's started but never finished, so the exporter never sends it. The trace looks truncated.
- **High-cardinality span names.** IDs, timestamps, or full URLs in the span *name* create millions of distinct names and overwhelm the backend. Keep names to a handful of categories.
- **Tracing a million-iteration loop.** One span per iteration = a span flood. Trace the loop as *one* span, or sample inside it.
- **Console exporter in production.** `SimpleSpanProcessor` + `ConsoleSpanExporter` is for learning. Production uses a *batch* processor and a real exporter (covered later) — `SimpleSpanProcessor` blocks on every span.
- **Forgetting to flush on exit.** Short-lived programs (CLIs, scripts) exit before batched spans are sent. Call `provider.shutdown()` / `tp.Shutdown(ctx)` before the program ends.
- **Clock skew between machines.** Two services with unsynchronized clocks make a child span look like it started *before* its parent. NTP matters. (Senior topic.)

---

## Common Mistakes

1. **Confusing a span with a log.** A span is a measured, parented operation with a duration. A log is a point-in-time message. Don't make a span per log line.
2. **Putting the user ID (or order ID) in the span name.** Cardinality explosion. It belongs in an attribute.
3. **Forgetting to end a span.** The most common reason "my span never shows up."
4. **Starting a child span from the wrong context** (`Background()` in Go, lost context after `await` in Python/Node). Result: orphan spans.
5. **Tracing every function.** Noise and cost. Trace boundaries.
6. **Leaving the console exporter on in production.** Slow and floods stdout.
7. **Not setting error status**, so failed operations look fine in the UI.
8. **Logging secrets into span attributes.** Traces are searchable storage; treat them like a database, not a scratchpad.
9. **Expecting a backend with no exporter configured.** No exporter = spans go nowhere. You must wire one up.
10. **Assuming the trace is complete when propagation is broken.** A truncated-looking trace usually means a *dropped context*, not a request that stopped.

---

## Tricky Points

1. **The trace ID is shared; the span ID is not.** Every span in one trace has the *same* trace ID and a *different* span ID. New juniors often expect each span to have a "new trace ID" — no.
2. **The root span has no parent ID** (it's empty/zero). That's how a backend identifies the root.
3. **A span's duration usually *contains* its children's**, but not always — async children can outlive a parent if you're not careful, which is itself a bug signal.
4. **"Current span" is implicit in most languages, explicit in Go.** Python/Node/Java/Rust track it for you in context-local storage; Go makes you thread `ctx` by hand. Both can break — Go visibly, the others invisibly.
5. **A span isn't sent the instant it ends.** Batch processors buffer and flush periodically. "I ended it but don't see it" is often just the batch interval (or a missing flush on exit).
6. **`add_event` is not the same as `set_attribute`.** Events are timestamped and can repeat; attributes describe the whole span and are singular per key.
7. **Span kind matters for the UI.** A `CLIENT` span (you calling out) and a `SERVER` span (you being called) are different roles; backends use kind to stitch cross-service edges. Default `INTERNAL` is fine for plain work.

---

## Test Yourself

Work through these honestly — no answers provided.

1. Run the console-exporter example in your language. Find the `trace_id` in the output and confirm it's identical across all three spans. Find each span's `parent_id` and draw the tree on paper.
2. Add a fourth span (`apply_discount`) as a child of `checkout`. Re-run and confirm it appears as a sibling of `load_cart` in the waterfall.
3. Deliberately break it: start `load_cart`'s span from a *fresh* context (Go: `context.Background()`; Python: outside the `with`). Observe that it becomes its own root trace. That's an orphan — recognize the symptom.
4. Add an attribute `user.id` and an event `cache.miss` to one span. Confirm in the output which is which.
5. Make `charge` raise an exception, call `record_exception`, and set the span status to `Error`. Find the error in the output.
6. Explain, in one sentence each, the difference between a trace, a span, a log, and a metric — without looking at the table.
7. Take a span name with an ID baked in (`GET /users/42`) and rewrite it correctly. Where did the `42` go?
8. In your language, identify *exactly* what carries the "current span" (a `ctx` argument? a `contextvar`? a thread-local?). This is the thing that breaks in `middle.md`.

---

## Tricky Questions

**Q1: What's the difference between a trace and a span?**

A **span** is one operation — a function call, a DB query — with a name, a duration, and an ID. A **trace** is the whole tree of spans for one request, all sharing one trace ID. One trace, many spans. Confusing the two is the most common beginner error.

**Q2: Why not just use logs with a shared request ID?**

You can, and people did for years — but you lose the *structure* and the *timing for free*. Tracing gives you parent/child nesting and per-operation durations automatically, plus a waterfall UI. With logs you reconstruct all of that by hand. Logs and traces are complementary; the modern move is to put the trace ID *in* your logs so you get both. See [`../logging/middle.md`](../logging/middle.md).

**Q3: My span doesn't show up in the output. Why?**

Almost always one of: (a) you forgot to call `span.end()`/`End()`; (b) no exporter is configured; (c) the program exited before a batch processor flushed (call `shutdown()`); or (d) the span was started outside a configured provider.

**Q4: I started a child span but it shows up as its own separate trace. What happened?**

You started it without the parent in the current context — an **orphan**. In Go you probably passed `context.Background()` instead of the `ctx` returned by the parent's `Start`. In Python/Node, you started it outside the parent's active scope. The fix is to propagate the context correctly — the whole subject of `middle.md`.

**Q5: Should I put the customer's email in a span attribute so I can search by it?**

No. Span attributes go to a searchable backend that many people can read; PII (emails, names, card numbers, tokens) does not belong there. Use a non-identifying key like a hashed user ID, or keep PII out of telemetry entirely. This is a hard rule at senior/professional level — start the habit now.

**Q6: Why is "trace everything" wrong?**

Because spans cost CPU, memory, network, and storage, and a span per trivial function buries the meaningful boundaries in noise. You want the *signal* — the request, the outbound calls, the significant units of work — not a span for `add(a, b)`. Tracing is about boundaries, not coverage.

**Q7: Do I have to choose between Jaeger, Tempo, and Datadog before I write code?**

No — that's the whole point of OpenTelemetry. You write against the OTel API and choose the backend by configuring an *exporter*. Swap backends later by swapping the exporter; your instrumented code doesn't change.

---

## Cheat Sheet

```text
┌──────────────────────────────── TRACING — JUNIOR CHEAT SHEET ───────────────────────────────────┐
│                                                                                                 │
│  THE TWO WORDS                                                                                  │
│    TRACE = the whole request, one tree, one TRACE ID.                                           │
│    SPAN  = one operation in it, one SPAN ID, one PARENT ID.                                     │
│                                                                                                 │
│  SPAN ANATOMY                                                                                   │
│    trace_id · span_id · parent_id · name · start · duration                                     │
│    attributes (describe) · events (timestamped notes) · status (Ok/Error) · kind                │
│                                                                                                 │
│  THE FOUR SIGNALS                                                                               │
│    METRIC → how many / how fast (aggregate)                                                     │
│    LOG    → what the code said (one event)                                                      │
│    SPAN   → how long this step took (one operation)                                             │
│    TRACE  → the whole path (one request)                                                        │
│                                                                                                 │
│  START A SPAN                                                                                   │
│    Python: with tracer.start_as_current_span("name") as span: ...                              │
│    Go:     ctx, span := tracer.Start(ctx, "name"); defer span.End()                            │
│    Java:   Span s = tracer.spanBuilder("name").startSpan(); try(...) {...} finally{ s.end(); } │
│    Node:   tracer.startActiveSpan("name", span => { ...; span.end(); })                         │
│    Rust:   #[instrument] on the function                                                        │
│                                                                                                 │
│  GOLDEN RULES                                                                                   │
│    • Name = category, not value. IDs go in attributes.                                          │
│    • Always end the span.                                                                       │
│    • A child attaches to the CURRENT context — keep it propagated.                              │
│    • Trace boundaries, not every function.                                                      │
│    • No secrets / PII in attributes.                                                            │
│    • Broken propagation → orphan spans → a lying trace.                                          │
│                                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **trace** is the whole story of one request — a tree of **spans** sharing one **trace ID**.
- A **span** is one operation: a name, a start, a duration, a span ID, a parent ID, attributes, events, and a status.
- The four signals are complementary: **metric** (how many/how fast), **log** (what was said), **span** (how long this step took), **trace** (the whole path).
- **OpenTelemetry** is the cross-language standard: write against its API, configure the backend with an *exporter*. Your code outlives your vendor choice.
- Your first span is a scoped block — `with` / `defer` / `try-with-resources` / `startActiveSpan` / `#[instrument]` — with a stopwatch around the work.
- A child span attaches to the **current span context**. In Go that's the `ctx` you pass; in Python/Node/Java/Rust it's tracked implicitly. **Keep it propagated or the trace breaks.**
- The span **name is a category** (`GET /users/:id`); the value (`user.id=42`) goes in an **attribute**. Baking IDs into names explodes cardinality.
- **Always end every span**, **never log PII into attributes**, and **trace boundaries, not every function**.
- A broken trace usually means **dropped context** (an orphan span), not a request that stopped — which is exactly why the next level is all about **propagation**.

---

## What You Can Build

- A **console-exporter playground**: the checkout example in your language, plus a script that pretty-prints the resulting span tree from the JSON so you can *see* trace IDs and parent links. Best 30 minutes you'll spend learning tracing.
- A **"trace vs log vs metric" quiz card**: given a thing to record (a 500 error, a request latency, a cache hit rate, "user logged in"), decide which signal it belongs to. Drill until it's automatic.
- A **deliberately-broken-trace demo**: the same example with a forced orphan span (wrong context), so you learn to *recognize* the symptom — a span that's its own root trace.
- A **span-name linter** (10 lines): scan span names for digits/UUIDs and warn that an ID may have leaked into a name instead of an attribute.
- A **tiny HTTP handler** that creates a root span per request and a child span per outbound call, exported to the console — your first taste of real request tracing before `middle.md` adds propagation across the network.

---

## Further Reading

- **Specs & docs (read once, refer often)**
  - OpenTelemetry — Tracing concepts: <https://opentelemetry.io/docs/concepts/signals/traces/>
  - W3C Trace Context (`traceparent` header) — <https://www.w3.org/TR/trace-context/> (you'll need this in `middle.md`)
  - OpenTelemetry language SDKs: Go, Java, Python, JS, Rust — <https://opentelemetry.io/docs/languages/>
- **Papers & books**
  - *Dapper, a Large-Scale Distributed Systems Tracing Infrastructure* — Sigelman et al. The Google paper that started distributed tracing.
  - *Distributed Tracing in Practice* — Parker, Spoonhower, Mace, Sigelman. The gentle, thorough introduction.
- **Articles**
  - "What is distributed tracing?" — Honeycomb / Lightstep intros. Search the vendor docs; the conceptual sections are vendor-neutral and excellent.
  - Jaeger "Getting Started" — run a local backend and see your spans in a real UI: <https://www.jaegertracing.io/docs/getting-started/>

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — context propagation (in-process and cross-service), manual + auto instrumentation, attributes/events/status in depth, putting the trace ID into your logs.
- **Senior level:** [senior.md](senior.md) — sampling strategies, span granularity, overhead budgets, async/queue propagation.
- **Professional level:** [professional.md](professional.md) — OTel end-to-end architecture, tail sampling, baggage, exemplars, org-wide instrumentation standards.
- **Interview prep:** [interview.md](interview.md) — tracing questions you'll be asked.
- **Practice problems:** [tasks.md](tasks.md) — guided, graduated exercises.

**Sibling diagnostic topics:**

- [Logging — Junior](../logging/junior.md) — read this alongside; tracing and logging are complementary, and you'll correlate them by trace ID.
- [Metrics — README](../metrics/README.md) — the aggregate view; metrics tell you *something* is wrong, traces tell you *where*.
- [Debugging — Senior](../debugging/senior.md) — distributed debugging, where traces become your primary lens.

**Cross-roadmap links:**

- [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/) — the system-design angle: collector topology, storage, backends.

---

## Diagrams & Visual Aids

### A Trace Is a Tree of Spans

```text
                          TRACE  (trace_id = 4bf92f3577b34da6...)
   ┌───────────────────────────────────────────────────────────────────────┐
   │ span "GET /checkout"  (root, parent=∅)        [0ms ─────────── 920ms]  │
   │   ├─ span "auth.verify"      parent=checkout  [2ms ── 30ms]            │
   │   ├─ span "db.load_cart"     parent=checkout  [31ms ─── 80ms]          │
   │   └─ span "payment.charge"   parent=checkout  [81ms ─────────── 915ms] │
   │        └─ span "POST stripe" parent=charge    [90ms ─────────── 910ms] │ ← slow
   └───────────────────────────────────────────────────────────────────────┘
   Same trace_id on all five. Each parent_id points one level up.
```

### The Waterfall View (what the UI shows you)

```text
   time →   0        200       400       600       800     920 ms
   GET /checkout   ████████████████████████████████████████████
   auth.verify     ██
   db.load_cart      ███
   payment.charge        ████████████████████████████████████
   POST stripe            ███████████████████████████████████
                          ▲ the wide bar = where the time went
```

### Trace vs Span vs Log vs Metric

```text
   ┌──────────┬──────────────┬───────────────────────────────────────────┐
   │ Signal   │ Granularity  │ Answers                                    │
   ├──────────┼──────────────┼───────────────────────────────────────────┤
   │ METRIC   │ aggregate    │ "how many / how fast overall?"             │
   │ LOG      │ one event    │ "what did the code say right then?"        │
   │ SPAN     │ one operation│ "how long did this step take? ok/error?"   │
   │ TRACE    │ one request  │ "what path did it take, where's the time?" │
   └──────────┴──────────────┴───────────────────────────────────────────┘
```

### The Context "Backpack" (why propagation matters)

```text
   request enters ──▶ [checkout span active] ──▶ calls load_cart
                              │  carries: trace_id + current span_id
                              ▼
                      load_cart reads the "backpack",
                      finds checkout as its parent ✓

   BUT across an await / goroutine / network hop:
   request ──▶ [checkout active] ──╳── backpack DROPPED ──▶ load_cart
                                                      finds NO parent ✗
                                                      → ORPHAN span, broken trace
   (Keeping the backpack attached is the whole job of middle.md.)
```

---
