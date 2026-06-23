# Observability Engineering — Junior Level

> **Topic:** [Observability Engineering Roadmap](README.md)
> **Focus:** What observability *is*, and how it differs from monitoring. The three pillars — logs, metrics, traces — and the idea that the real unit is a wide structured event. Emitting your first correlated signal: a `trace_id` that appears in both a span and a log. Why "find the one affected customer" is the whole game.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Observability vs Monitoring](#observability-vs-monitoring)
6. [The Three Pillars and the Wide Event](#the-three-pillars-and-the-wide-event)
7. [Real-World Analogies](#real-world-analogies)
8. [Mental Models](#mental-models)
9. [Code Examples](#code-examples)
10. [What Observability Costs](#what-observability-costs)
11. [Use Cases](#use-cases)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does "observable" actually mean?** and **What's the smallest thing a junior can do to make a service answer questions it couldn't before?**

**Observability is the ability to understand a system's internal state from the outside, by looking at what it emits — including the ability to ask questions you didn't think of in advance.** The last clause is the whole point. Anyone can build a dashboard for a problem they already foresaw. The hard part — and the reason this discipline exists — is the bug *nobody anticipated*: a single customer in one region, on one app version, hitting one code path, getting errors that no dashboard shows because no one thought to graph that combination.

The word comes from **control theory**. An engineer named Rudolf Kálmán defined a system as *observable* in 1960 if you can reconstruct its full internal state purely from its outputs over time. Software borrowed the term because **distributed systems made the old approach break**. When a single "place an order" click fans out across a payments service, an inventory service, a fraud check, a notification queue, and four databases, there is no longer one machine to log into and `tail -f`. The behaviour you care about lives *between* the services, in the path of one request, and you can only see it if every hop emits enough context to stitch the story back together.

This page introduces the three classic signals — **logs**, **metrics**, **traces** (with **profiles** as an emerging fourth) — and the idea that unifies them: the **arbitrarily-wide structured event**. The next level ([`middle.md`](middle.md)) covers OpenTelemetry and instrumentation strategy in depth; [`senior.md`](senior.md) covers SLOs and designing what to instrument; [`professional.md`](professional.md) covers building an observability platform for a whole organisation.

> 🎓 **Why this matters for a junior:** The first real outage you debug will not match any dashboard. The engineers who resolve it fast are not the ones who memorised the dashboards — they're the ones who can *ask a new question of the telemetry on the spot*. Learning to emit correlated, structured, context-rich signals from day one is what makes that possible. Sprinkle `print()` and you debug blind; emit a wide event with a `trace_id`, and you debug with the lights on.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small web service or program in at least one language (Go, Python, Java, JavaScript).
- **Required:** What an HTTP request/response cycle is — observability is mostly about understanding requests.
- **Helpful:** Basic exposure to each pillar. The three sibling roadmaps are the ground floor:
  - [`../logging/junior.md`](../logging/junior.md) — what a structured log line is.
  - [`../metrics/junior.md`](../metrics/junior.md) — what a counter/gauge/histogram is.
  - [`../tracing/junior.md`](../tracing/junior.md) — what a span and a `trace_id` are.
- **Helpful:** You've seen a dashboard (Grafana, Datadog, Honeycomb) once. You don't need to build one yet — just know that this roadmap is about *what you emit* and *how you query it*, not only the pretty graphs on top.

You can read this page without having mastered the three siblings — it is the *map* of how they fit together — but you'll get the most from it if you've at least seen one of each.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Observability** | The ability to understand a system's internal state from its external outputs, *including questions you didn't anticipate*. The subject of this roadmap. |
| **Monitoring** | Watching *known* failure modes via predefined dashboards and alerts. A subset of what an observable system can do. |
| **Telemetry** | The data a system emits about itself — logs, metrics, traces, profiles. The raw material of observability. |
| **The three pillars** | Logs, metrics, traces — the traditional categories of telemetry. Useful, but see the critique in [The Three Pillars](#the-three-pillars-and-the-wide-event). |
| **Log** | A timestamped record of a discrete event, ideally structured (key/value), e.g. JSON. |
| **Metric** | A numeric measurement aggregated over time — a counter, gauge, or histogram. |
| **Trace** | The end-to-end record of one request's journey across services, made of **spans**. |
| **Span** | One timed operation within a trace (a DB query, an HTTP call). Has a name, start/end time, and attributes. |
| **Profile** | A sample-based view of where a program spends CPU or memory — the emerging "fourth pillar." |
| **trace_id** | A unique ID for one request's whole journey, shared by every span and (ideally) every log line for that request. The thread that stitches signals together. |
| **Structured event** | A log/event emitted as key/value fields (not a prose string), so it can be queried and filtered. |
| **Wide event** | A structured event with *many* fields (dozens to hundreds) capturing everything known at that point in the request. |
| **Cardinality** | The number of distinct values a field can take. `user_id` is high-cardinality; `http_method` is low. |
| **Dimensionality** | The number of *different fields* you can slice by. More dimensions = more questions you can ask. |
| **Context propagation** | Passing the `trace_id` (and other context) from one service to the next so the trace stays connected. |
| **OpenTelemetry (OTel)** | The vendor-neutral standard (spec + SDKs + Collector) for generating and exporting telemetry. |
| **Unknown-unknown** | A failure you didn't predict and have no dashboard for. The thing observability is *for*. |
| **SLI / SLO** | Service Level Indicator (a measured number) / Objective (the target for it). The user-facing layer; see [`senior.md`](senior.md). |

---

## Core Concepts

### 1. Observability is about *unanticipated* questions

A monitoring dashboard answers a question you asked at design time. Observability answers a question you ask *now*, for the first time, during an incident — "show me error rate, but only for app version 4.2.1, in eu-west, for customers on the enterprise plan." If you can answer that without shipping new code, you are observable. If you have to add instrumentation and redeploy first, you are merely monitored. The whole discipline is built around preserving your ability to ask the question you haven't thought of yet.

### 2. The three signals answer different questions about the *same* event

A log says *what happened* ("charge failed: card declined"). A metric says *how much, in aggregate* ("error rate is 2%"). A trace says *what path this request took and where the time went* ("checkout → payments(900ms) → bank(870ms)"). They are not competitors; they are three views of one underlying reality. The mistake is treating them as three separate tools owned by three separate teams. The skill is **correlating** them: the metric tells you *that* something spiked and *when*; the trace tells you *which* requests; the log tells you *why* each one failed.

### 3. The real unit is the wide structured event

Charity Majors' core argument (in *Observability Engineering*) is that "logs, metrics, traces" describes the *storage formats*, not the goal. What you actually want is **one arbitrarily-wide structured event per unit of work** — per request, per job — carrying *everything you knew* at that moment: user ID, build version, region, feature flags, latency, error, downstream call durations. From that one rich event you can derive metrics (count them), reconstruct traces (group by `trace_id`), and read them like logs. Emit narrow, pre-aggregated data and you've thrown away the ability to ask new questions. Emit wide events and you keep it.

### 4. High cardinality is the superpower, not the enemy

In the [metrics](../metrics/) world, high-cardinality labels (like `user_id`) are *forbidden* because they explode the time-series database. In the *event* world, high cardinality is exactly what lets you find the **one affected customer** out of a million. The same data that kills a TSDB is the data that solves the 3 a.m. bug. The difference is the storage model: events are stored raw and queried, not pre-aggregated into fixed time series. (Cardinality's *cost* is real, though — see [telemetry-cost](../telemetry-cost-and-sampling-strategy/).)

### 5. Correlation is the thing that turns three signals into observability

A `trace_id` shared across a span and every log line for that request is the single most valuable thing a junior can add. It turns "I see an error metric spiked" into "click the spike → see the exemplar trace → read the logs for that exact request." Without correlation you have three disconnected data sources and you debug by guessing which log goes with which spike. With it, you debug by *following one thread*.

---

## Observability vs Monitoring

This is the central distinction of the whole roadmap, so it's worth making concrete.

| | **Monitoring** | **Observability** |
|---|---|---|
| **Question type** | Known-unknowns — "is the thing I worried about broken?" | Unknown-unknowns — "why is *this specific weird thing* happening?" |
| **Built from** | Dashboards + alerts you defined ahead of time | Rich events you query interactively |
| **New question costs** | Add instrumentation, deploy, wait | Type a new query |
| **Best at** | "CPU is high," "error rate exceeded 1%" | "Only enterprise users in eu-west on v4.2.1 see this" |
| **Data** | Pre-aggregated, low-cardinality | Raw, high-cardinality, high-dimensionality |
| **The failure it catches** | The one you predicted | The one you didn't |

**The defining test — the 3 a.m. question.** A customer emails: "checkout has been failing for me all morning." No dashboard shows it; the global error rate looks fine because it's *one* customer out of a million.

- A **monitored** system: you're stuck. There's no `customer_id` dashboard. You start adding logging and redeploying, hoping to catch it next time.
- An **observable** system: you query your events — `filter error=true, group by customer_id`, find the one customer, then `filter customer_id=X, group by build_version` and discover they're pinned to an old client that calls a deprecated endpoint. Five minutes, no deploy.

Observability **includes** monitoring — you still build dashboards and alerts for the failures you *can* predict (that's what the `monitoring-alerting` skill is about). The difference is that monitoring is where you *stop* when you're not observable, and where you *start* when you are.

> The control-theory root: a system is observable if you can reconstruct its internal state from its outputs. Distributed systems broke the assumption that you could just inspect the state directly (SSH in and look), so we had to reconstruct it from emitted telemetry instead.

---

## The Three Pillars and the Wide Event

### The classic framing

| Pillar | Shape | Answers | Cardinality tolerance |
|---|---|---|---|
| **Logs** | Timestamped events (ideally structured) | "What happened to this thing?" | High |
| **Metrics** | Numbers aggregated over time | "How much, in aggregate? What's the trend?" | **Low** (labels must be bounded) |
| **Traces** | A tree of spans for one request | "What path did this request take? Where was the time?" | High |
| **Profiles** *(4th)* | Sampled CPU/memory by code location | "Which function is burning the CPU / leaking memory?" | High |

These are real and useful — each sibling roadmap ([logging](../logging/), [metrics](../metrics/), [tracing](../tracing/), [continuous-profiling](../continuous-profiling/)) goes deep on one.

### Why "three pillars" is also a *critique*

The "three pillars" model is criticised (most prominently by Charity Majors) because it leads teams to build **three disconnected silos** — a logging system, a metrics system, a tracing system — each storing the *same events* in a different, lossy way, with no thread connecting them. You spot a spike in the metrics tool, then go *guess* which logs in the logging tool correspond to it.

The reframing: **the pillars are an implementation detail. The real unit is the arbitrarily-wide structured event.** Capture one wide event per request with high cardinality (many distinct values) and high dimensionality (many fields), store it raw, and *query* it. From that:

- **Metrics** = count/aggregate the events.
- **Traces** = group the events by `trace_id` and order by time.
- **Logs** = just read the events.

You stop pre-deciding what's a "metric" vs a "log" and instead keep the rich data, deriving each view on demand.

### A wide event, concretely

```json
{
  "timestamp": "2026-06-22T03:14:22.481Z",
  "trace_id": "7c1e9b3a5f2d4a8e",
  "span_id": "a1b2c3d4",
  "service": "checkout",
  "endpoint": "POST /checkout",
  "http_status": 500,
  "error": true,
  "error_kind": "payment_declined",
  "duration_ms": 902,
  "db_duration_ms": 14,
  "payment_duration_ms": 870,
  "user_id": "u_99214",
  "customer_plan": "enterprise",
  "region": "eu-west-1",
  "build_version": "4.2.1",
  "feature_flags": ["new_checkout", "fast_path"],
  "device": "ios-17.2",
  "retry_count": 2
}
```

Every one of those fields is a **dimension you can slice by**. Group by `region`, by `build_version`, by `customer_plan`, by `error_kind` — each grouping is a question you didn't have to anticipate. *That* is observability.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Monitoring** | The warning lights on a car dashboard — someone decided in advance which failures get a light. No light for "weird vibration only at 73 mph." |
| **Observability** | A mechanic's full diagnostic port — you can plug in and ask any question about any sensor, even ones the dashboard never shows. |
| **The 3 a.m. question** | "My car shudders only when turning left, uphill, in the rain." No warning light covers it — you need the diagnostic port. |
| **Wide event** | A black-box flight recorder — captures *every* parameter every second, so after the fact you can ask any question, not just the ones the cockpit gauges showed. |
| **trace_id correlation** | A tracking number on a parcel — the same code on every scan, in every warehouse, so you can follow one package's whole journey. |
| **High cardinality** | A passenger manifest with every name — useless as a gauge ("how many passengers"), priceless when you need to find *the one* who's missing. |
| **The three pillars as silos** | Three witnesses to a crime who never compare notes — each saw part of it; nobody put the story together. |
| **OpenTelemetry** | A universal power adapter — one standard plug so your telemetry fits any backend socket without rewiring. |

---

## Mental Models

### 1. Monitoring = known-unknowns; observability = unknown-unknowns

Draw two boxes. "Known-unknowns" are the failures you can name in advance ("disk fills up," "error rate spikes") — monitoring covers these with dashboards and alerts. "Unknown-unknowns" are the failures you *can't* name yet — observability is the toolkit for those. Every incident that surprises you lived in the second box. The goal is not to predict more (impossible); it's to keep enough rich data that *any* question is answerable after the fact.

### 2. One event, three views

Instead of "do I need a log, a metric, or a trace here?", think: **emit one rich event; the three views are derived.** A log is the event read as text. A metric is many events counted. A trace is events sharing a `trace_id`, ordered. When you internalise this, you stop emitting a separate counter *and* a separate log *and* a separate span for the same thing — you emit one wide event and let the backend slice it.

### 3. The debugging loop: hypothesis → query → narrow → repeat

Observability-driven debugging is a tight loop. You form a *hypothesis* ("maybe it's a specific region"), *query* the events to test it (`group by region`), *narrow* based on the answer ("it's all eu-west — now group by build_version"), and *repeat* until you've cornered the cause. Each step is a new question. A monitored system breaks this loop the moment your next question needs a dimension no dashboard has. An observable one lets you run the loop to the end.

### 4. Cardinality: poison for metrics, fuel for events

Hold two facts at once. In metrics, a `user_id` label is *poison* — a million users means a million time series and a dead TSDB. In events, a `user_id` field is *fuel* — it's exactly how you find the one affected user. Same data, opposite verdict, because of the storage model: time-series store pre-aggregated; event stores store raw and index for query. Knowing which world you're in tells you whether a high-cardinality field is a crime or a gift.

### 5. The thread that connects everything is the trace_id

Picture every signal your system emits as a loose bead. The `trace_id` is the string you run through all of them so they form one necklace per request. Put the `trace_id` in your spans (automatic) *and* in your log lines (one line of code) *and* attach it to metrics as exemplars, and suddenly clicking a metric spike can take you to the exact trace and the exact logs. No `trace_id`, no necklace — just a pile of beads.

---

## Code Examples

The single highest-value thing a junior can do is **correlate signals with a `trace_id`**. Here's a minimal OpenTelemetry span, plus getting that span's `trace_id` into a structured log line.

### Go — a span with attributes, and trace_id in the log

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("checkout")
var logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

func checkout(w http.ResponseWriter, r *http.Request) {
	// Start a span — this is the unit of a trace. It carries a trace_id.
	ctx, span := tracer.Start(r.Context(), "POST /checkout")
	defer span.End()

	userID := r.Header.Get("X-User-Id")
	// Attributes are the "wide event" fields — slice by any of them later.
	span.SetAttributes(
		attribute.String("user.id", userID),
		attribute.String("customer.plan", "enterprise"),
		attribute.String("region", "eu-west-1"),
		attribute.String("build.version", "4.2.1"),
	)

	start := time.Now()
	err := charge(ctx, userID)
	dur := time.Since(start)

	// THE KEY MOVE: put the trace_id in the log so log <-> trace correlate.
	sc := span.SpanContext()
	log := logger.With(
		slog.String("trace_id", sc.TraceID().String()),
		slog.String("span_id", sc.SpanID().String()),
		slog.String("user_id", userID),
		slog.Int64("duration_ms", dur.Milliseconds()),
	)

	if err != nil {
		span.RecordError(err) // attach the error to the trace
		span.SetAttributes(attribute.Bool("error", true))
		log.Error("checkout failed", slog.String("error", err.Error()))
		http.Error(w, "payment failed", 500)
		return
	}
	log.Info("checkout ok")
	w.Write([]byte("ok"))
}

func charge(ctx context.Context, _ string) error { return nil } // stub
```

Now a single request produces a **span** (with `trace_id`, attributes, error) *and* a **log line carrying the same `trace_id`**. In your backend you can jump from one to the other.

### Python — the same correlation with the OTel SDK

```python
import json, logging, time
from opentelemetry import trace

tracer = trace.get_tracer("checkout")
logger = logging.getLogger("checkout")

def checkout(user_id: str):
    # A span is the trace unit; attributes are the wide-event fields.
    with tracer.start_as_current_span("POST /checkout") as span:
        span.set_attribute("user.id", user_id)
        span.set_attribute("customer.plan", "enterprise")
        span.set_attribute("region", "eu-west-1")
        span.set_attribute("build.version", "4.2.1")

        ctx = span.get_span_context()
        trace_id = format(ctx.trace_id, "032x")   # hex, the form backends show

        start = time.monotonic()
        try:
            charge(user_id)
            ok = True
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("error", True)
            ok = False

        # Structured log line carrying the SAME trace_id.
        logger.info(json.dumps({
            "trace_id": trace_id,
            "user_id": user_id,
            "duration_ms": int((time.monotonic() - start) * 1000),
            "error": not ok,
        }))

def charge(_): ...  # stub
```

### A structured "wide event" you can query

Whether you emit it as a log, a span, or both, aim for *one rich event per request* rather than ten thin ones:

```json
{
  "trace_id": "7c1e9b3a5f2d4a8e", "service": "checkout",
  "endpoint": "POST /checkout", "http_status": 500, "error": true,
  "error_kind": "payment_declined", "duration_ms": 902,
  "user_id": "u_99214", "customer_plan": "enterprise",
  "region": "eu-west-1", "build_version": "4.2.1", "device": "ios-17.2"
}
```

> Don't reach for the full OpenTelemetry Collector setup yet — that's [`middle.md`](middle.md). At this level, the win is small and real: **emit spans, and put the `trace_id` in your logs.**

---

## What Observability Costs

| What | Cost | Notes |
|---|---|---|
| Starting a span | microseconds | Cheap on the hot path; cost is in *export*, not creation. |
| Adding an attribute | negligible | More attributes = more dimensions to slice by — usually worth it. |
| Putting `trace_id` in a log | one extra field | Essentially free; the highest value-per-byte change you can make. |
| Storing wide events / traces | grows with volume × width | This is the real bill — see [telemetry-cost](../telemetry-cost-and-sampling-strategy/). |
| High-cardinality **metric labels** | can melt a TSDB | High cardinality is fine in *events*, dangerous in *metrics*. Know the difference. |

The headline for a junior: **emitting is cheap; storing everything forever is not.** That's why senior teams *sample* (keep a representative subset of traces) — covered at [`middle.md`](middle.md) and in depth at [telemetry-cost](../telemetry-cost-and-sampling-strategy/). For now, emit rich events; learning to control their cost comes next.

---

## Use Cases

| Situation | What observability gives you |
|---|---|
| A customer reports a bug no dashboard shows | Slice events by `customer_id` to find the one affected user |
| Latency is up but you don't know which hop | A trace shows where the time went, span by span |
| Error rate spiked at 14:32 | Jump from the metric spike (exemplar) to a sample failing trace |
| "Is the new release worse?" | Group events by `build_version` and compare |
| A queue is backing up intermittently | Correlate the queue gauge with traces during the backups |
| Debugging in production safely | Read real request events instead of trying to reproduce locally (cross-ref [testing-in-production](../../quality-engineering/testing/13-testing-in-production/)) |

---

## Best Practices

1. **Put a `trace_id` in every log line.** The cheapest, highest-leverage thing you can do. It's what turns three pillars into one connected story.
2. **Emit structured events, not prose.** `{"event":"charge_failed","user_id":"u_42"}` is queryable; `"charge failed for u_42"` is not.
3. **Emit one *wide* event per request, not ten thin ones.** Attach everything you know — user, region, version, durations — to a single event.
4. **Prefer auto-instrumentation to start.** OpenTelemetry's agents/libraries instrument your HTTP server and DB client for free; add manual spans only where the auto ones aren't enough. (Detail in [`middle.md`](middle.md).)
5. **Use OpenTelemetry, not a vendor's proprietary SDK.** It's the standard; it keeps you portable across backends.
6. **Think "what question might I ask?" when choosing attributes.** Every attribute is a future slice. `build_version` and `region` are nearly always worth it.
7. **Don't fall into the silo trap.** A log, a metric, and a trace for the same event with no shared ID is three problems, not one solution. Correlate them.

---

## Edge Cases & Pitfalls

- **A trace that doesn't propagate.** If service A starts a trace but doesn't pass the context to service B, B starts a *new* trace and the journey is broken in two. **Context propagation** (passing the `trace_id` across the network) is what keeps it whole — see [`middle.md`](middle.md).
- **Logs and traces that don't share a `trace_id`.** You have both pillars but can't connect them. You'll debug by guessing which log goes with which trace. Always emit the `trace_id` in logs.
- **Treating observability as "buy a tool."** A Datadog/Honeycomb subscription doesn't make you observable; *emitting rich, correlated, queryable events* does. The tool is the backend, not the discipline.
- **Putting high-cardinality data in metric labels.** `user_id` as a Prometheus label is a classic TSDB-killer. The *same* field in an event is correct. Know which world you're in.
- **One thin event per log statement.** Ten `log.info()` calls scattered through a handler give you ten disconnected fragments; one wide event at the end gives you a queryable record.
- **Sampling away the errors.** Naïve random sampling can drop the rare failing traces you most need. (Tail-based sampling fixes this — [telemetry-cost](../telemetry-cost-and-sampling-strategy/).)

---

## Common Mistakes

1. **Confusing monitoring with observability.** Building more dashboards is not the same as being able to ask new questions. The test is the 3 a.m. unanticipated bug.
2. **No `trace_id` in logs.** The single most common reason teams "have all three pillars" but still debug blind.
3. **Emitting unstructured prose logs.** You can't `group by` a sentence. Structure everything.
4. **Low dimensionality.** Emitting only `status` and `latency`, then being unable to ask "which region / version / customer?" Add the dimensions *before* the incident.
5. **Treating the pillars as separate products owned by separate teams.** Silos defeat the whole point — correlation is the goal.
6. **Believing high cardinality is always bad.** It's bad for *metrics*, essential for *events*. The blanket rule "no high cardinality" throws away your superpower.
7. **Skipping OpenTelemetry for a quick vendor SDK.** Locks you in and makes correlation across signals harder later.

---

## Tricky Points

1. **"Observability" is a property of the system, not a product you install.** You can buy a great backend and still be unobservable if you emit thin, uncorrelated data. Conversely, a system emitting rich correlated events is observable even with humble tooling.
2. **A trace and a "wide event" can be the same thing.** A span *is* a structured event with timing and a `trace_id`. The mental shift is to stop seeing them as separate and start seeing one rich event that happens to have duration.
3. **The same high-cardinality field is forbidden in one storage model and required in another.** This trips up people who learned metrics first ("never use `user_id`!") and then can't understand why event-based observability *wants* it.
4. **More dimensions cost almost nothing to emit but everything if missing.** You can't slice by a field you didn't record. The asymmetry argues for emitting generously (within cost limits) — you can always ignore a field, but you can't query one you never captured.
5. **Auto-instrumentation gives breadth; manual gives depth.** Auto-instrumentation traces your framework's boundaries for free but knows nothing about *your* business logic. The valuable attributes (`customer_plan`, `cart_value`) are ones only you can add.

---

## Test Yourself

1. In one sentence each, define monitoring and observability. What single test distinguishes them?
2. Where does the word "observability" come from, and why did distributed systems make it necessary?
3. Name the three pillars and the emerging fourth. For each, give the question it answers.
4. What is the critique of the "three pillars" framing, and what does it propose instead?
5. Why is high cardinality a *superpower* for events but a *problem* for metrics?
6. A customer reports a bug no dashboard shows. Walk through how you'd find the cause in an observable system.
7. What is the single cheapest change that connects logs and traces? Why does it matter so much?
8. Take a service you've written. Add an OTel span and put its `trace_id` into your log lines. Confirm the same ID appears in both.

---

## Tricky Questions

**Q1: We have Grafana dashboards and PagerDuty alerts. Are we observable?**

You're *monitored*, which is good and necessary — but not necessarily *observable*. The test: can you answer a question you didn't build a dashboard for, like "error rate for enterprise customers in eu-west on build 4.2.1," without shipping code? If yes, observable. If you'd have to add instrumentation and redeploy, you're monitored. Observability includes monitoring but goes further.

**Q2: Isn't "the wide event" just a log line with extra fields?**

Almost — and that's the insight. A sufficiently rich, structured, queryable log line *is* the wide event. The shift isn't a new data type; it's (a) making it wide (many fields), (b) making it structured (queryable, not prose), (c) putting a `trace_id` on it so it correlates, and (d) storing it where you can run arbitrary queries, not just full-text search.

**Q3: My senior told me never to use `user_id` as a label. Now you're telling me to put it in events. Which is it?**

Both, in their right places. As a **metric label** (Prometheus), `user_id` is forbidden — it creates one time series per user and melts the database. As an **event/span attribute**, `user_id` is exactly what you want — it's how you find the one affected customer. Different storage model, opposite rule. The skill is knowing which world you're in.

**Q4: Why not just SSH into the box and look at the state directly?**

Because in a distributed system there's no single box. One request touches dozens of services and machines; the behaviour you care about lives *between* them. You can't inspect the state directly, so you reconstruct it from emitted telemetry — which is literally the control-theory definition of observability.

**Q5: Do I need OpenTelemetry, or can I just use my cloud vendor's agent?**

You can start with a vendor agent, but OpenTelemetry is the standard for a reason: it's vendor-neutral, so your instrumentation outlives any single backend, and it unifies all signals (traces, metrics, logs, profiles) under one API with built-in correlation. Junior advice: use OTel from the start; you'll thank yourself when you switch backends or add a signal.

**Q6: We added tracing but our traces are all single-service — they stop at the network boundary. Why?**

Context isn't propagating. Service A starts a trace but doesn't forward the `trace_id` (in the `traceparent` header) to service B, so B starts a fresh trace. You need **context propagation** — usually automatic if both services use OTel's HTTP instrumentation, manual otherwise. Covered in [`middle.md`](middle.md).

---

## Cheat Sheet

```text
┌──────────────────── OBSERVABILITY ENGINEERING — JUNIOR CHEAT SHEET ───────────────────────┐
│                                                                                            │
│  OBSERVABILITY vs MONITORING                                                               │
│    monitoring    = watch KNOWN failures via predefined dashboards/alerts (known-unknowns) │
│    observability = ask ARBITRARY new questions, no new code (unknown-unknowns)             │
│    TEST: the 3 a.m. bug no dashboard shows — can you still find it? then you're observable │
│    origin: control theory — reconstruct internal state from external outputs              │
│                                                                                            │
│  THE THREE PILLARS (+ profiles)                                                            │
│    LOGS    what happened to this thing?       (events, structured)                         │
│    METRICS how much, in aggregate?            (numbers over time, LOW cardinality)         │
│    TRACES  what path did this request take?   (spans, trace_id, HIGH cardinality)          │
│    PROFILES which code burns CPU/memory?      (the emerging 4th)                           │
│                                                                                            │
│  THE REAL UNIT: the ARBITRARILY-WIDE STRUCTURED EVENT                                      │
│    one rich event per request, many fields, queried (not pre-aggregated)                   │
│    metrics = count events · traces = group by trace_id · logs = read events               │
│                                                                                            │
│  CARDINALITY                                                                               │
│    high cardinality = SUPERPOWER in events (find the ONE customer)                         │
│                     = POISON in metric labels (melts the TSDB)                             │
│                                                                                            │
│  THE ONE THING TO DO TODAY                                                                 │
│    put trace_id in every log line → logs <-> traces correlate → debug with the lights on  │
│                                                                                            │
│  STANDARD: OpenTelemetry (vendor-neutral spec + SDKs + Collector). use it from day one.    │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Observability** is the ability to understand a system's internal state from its outputs — *including questions you didn't anticipate*. **Monitoring** is watching the failures you *did* anticipate. Observability includes monitoring and goes further; the test is the 3 a.m. unanticipated bug.
- The word comes from **control theory** (reconstruct internal state from external outputs); **distributed systems** made it necessary because there's no single box to inspect.
- The **three pillars** — logs, metrics, traces (+ profiles) — answer different questions about the same events. The critique: they become silos. The reframe: the real unit is the **arbitrarily-wide structured event**, queried not pre-aggregated, from which metrics/traces/logs are *derived*.
- **High cardinality** is a *superpower* for events (find the one affected customer) and a *problem* for metric labels (melts the TSDB). Same data, opposite rule, because of the storage model.
- **Correlation via `trace_id`** is what turns three signals into one connected story. Putting the `trace_id` in every log line is the cheapest, highest-value change a junior can make.
- **OpenTelemetry** is the vendor-neutral standard (spec + SDKs + Collector); use it from day one to stay portable and to unify all signals.
- Emitting is cheap; *storing everything forever* is the cost — which is why teams sample (next levels, and [telemetry-cost](../telemetry-cost-and-sampling-strategy/)).

---

## What You Can Build

- A **correlation demo**: a one-handler service that emits both an OTel span and a JSON log line carrying the same `trace_id`. Prove they share the ID.
- A **wide-event emitter**: instead of ten `log.info()` calls per request, build one struct/dict you fill as the request runs and emit *once* at the end with every field.
- A **"monitoring vs observability" quiz**: write ten incident descriptions and label each as solvable by a dashboard (monitoring) or requiring an ad-hoc query (observability).
- A **find-the-customer drill**: generate 100k fake request events (mostly fine, a handful failing for one `customer_id`), load them into something queryable (even `jq` over a JSONL file), and practise slicing by `customer_id`, `region`, `build_version` until you corner the failure.
- A **broken-trace reproduction**: two services where the first doesn't forward the trace context — observe that traces split — then fix propagation and watch them join.

---

## Further Reading

- **OpenTelemetry — "Observability primer"** — <https://opentelemetry.io/docs/concepts/observability-primer/>. The clearest free intro to the signals and how they relate.
- **Charity Majors — "Observability — A Manifesto"** and the *Observability Engineering* book (O'Reilly). The wide-event / high-cardinality argument from the source.
- **Cindy Sridharan — *Distributed Systems Observability*** (O'Reilly, free). The three-pillars framing and its limits.
- **Google SRE Book — "Monitoring Distributed Systems"** — <https://sre.google/sre-book/monitoring-distributed-systems/>. Where the Four Golden Signals and the monitoring discipline come from.
- The `observability-stack` and `monitoring-alerting` skills — for the tooling side (Prometheus/Grafana/Tempo/Loki, alert design).

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — OpenTelemetry in depth, instrumentation strategy, context propagation, sampling basics.
- **Senior level:** [senior.md](senior.md) — SLIs/SLOs/error budgets, designing what to instrument, the debugging loop in production.
- **Professional level:** [professional.md](professional.md) — designing an observability platform and driving org-wide adoption.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics (the pillars this roadmap unifies):**

- [Logging — Junior](../logging/junior.md) — the per-event pillar.
- [Metrics — Junior](../metrics/junior.md) — the aggregate pillar.
- [Tracing — Junior](../tracing/junior.md) — the per-request-path pillar.
- [Continuous Profiling](../continuous-profiling/) — the emerging fourth pillar.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — how to keep all of this affordable.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — SLOs and error budgets as the user-facing layer.
- [Quality Engineering → Testing → Testing in Production](../../quality-engineering/testing/13-testing-in-production/) — observability is the prerequisite that makes testing in prod safe.

---

## Diagrams & Visual Aids

### Monitoring vs observability

```text
   MONITORING (known-unknowns)            OBSERVABILITY (unknown-unknowns)
   ┌─────────────────────────┐           ┌──────────────────────────────────┐
   │ predefined dashboards   │           │ rich wide events, stored raw     │
   │ + alerts on thresholds  │           │ query ANY dimension, ANY time    │
   │                         │           │                                  │
   │ "is CPU high?"  ✓       │           │ "error rate for enterprise users │
   │ "is error rate up?" ✓   │           │  in eu-west on build 4.2.1?"  ✓  │
   │                         │           │                                  │
   │ the bug you predicted   │           │ the bug you DIDN'T predict       │
   └─────────────────────────┘           └──────────────────────────────────┘
            you stop here                 ⊇ includes monitoring, goes further
            when not observable
```

### Three pillars → one wide event

```text
   THE SILO TRAP                          THE WIDE-EVENT MODEL
   ┌─────┐ ┌────────┐ ┌──────┐            ┌──────────────────────────────────┐
   │LOGS │ │METRICS │ │TRACES│            │   ONE WIDE STRUCTURED EVENT      │
   └──┬──┘ └───┬────┘ └──┬───┘            │  trace_id, user, region, version,│
      │ no shared id     │                │  status, durations, flags, ...   │
      ▼        ▼         ▼                └────────────┬─────────────────────┘
   guess which goes with which              derive ────┼──── metrics = count
                                                       ├──── traces = group by trace_id
                                                       └──── logs   = read
```

### The debugging loop

```text
        ┌──────────────┐
        │  HYPOTHESIS  │  "maybe it's one region?"
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │    QUERY     │  group by region
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │    NARROW    │  "all eu-west — now group by build_version"
        └──────┬───────┘
               ▼
            repeat ──► until you've cornered the cause (no redeploy needed)
```

### The trace_id thread

```text
   request ──► [span: checkout] ──► [span: payments] ──► [span: bank]
                  trace=7c1e...        trace=7c1e...       trace=7c1e...
                     │                     │                  │
                     ▼                     ▼                  ▼
                  log{trace=7c1e}     log{trace=7c1e}    log{trace=7c1e}
                     │                     │                  │
                     └──────────── metric exemplar ──────────┘
   ONE trace_id threaded through spans + logs + metric exemplars = one story.
```

---
