# Metrics — Junior Level

> **Topic:** [Metrics Roadmap](README.md)
> **Focus:** What a metric actually is. The four types — counter, gauge, histogram, summary. Emitting your first signals in Go, Python, Java, Node, and Rust. When a metric is the wrong tool and you wanted a log or a trace instead.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Metric vs Log vs Trace](#metric-vs-log-vs-trace)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [The Four Metric Types](#the-four-metric-types)
9. [Your First Metrics — Code Examples](#your-first-metrics--code-examples)
10. [What a Metric Costs](#what-a-metric-costs)
11. [Use Cases](#use-cases)
12. [Coding Patterns](#coding-patterns)
13. [Clean Code](#clean-code)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Tricky Points](#tricky-points)
18. [Test Yourself](#test-yourself)
19. [Tricky Questions](#tricky-questions)
20. [Cheat Sheet](#cheat-sheet)
21. [Summary](#summary)
22. [What You Can Build](#what-you-can-build)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)
25. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a metric, really?** and **What does a beginner emit on day one to make a service observable?**

A **metric is a number that changes over time and can be added up.** That single sentence carries most of the discipline. "Number" rules out free text. "Over time" means it lives as a *time series* — a stream of `(timestamp, value)` points, not a one-off reading. "Added up" — *aggregatable* — means the value still means something after you combine it across a thousand machines: total requests, average latency, max queue depth. If a piece of data fails any of those three tests, it is probably a **log line** or a **trace span**, not a metric.

The reason this matters on day one is that metrics are how you find out your system is sick *before a user tells you*. Logs answer "what happened to *this* request?" — but you have to know which request to ask about. Metrics answer "is the whole system healthy *right now*?" — request rate, error rate, latency, memory — continuously, cheaply, for every request at once. A service with good metrics has a heartbeat you can watch on a dashboard. A service without them is a black box you only open after it has already fallen over.

This page covers the four building blocks every metrics library gives you — **counter**, **gauge**, **histogram**, **summary** — and how to emit each one correctly in Go, Python, Java, Node, and Rust. The next level ([`middle.md`](middle.md)) covers labels, cardinality, and naming conventions — the rules that decide whether your metrics scale or bankrupt your database. [`senior.md`](senior.md) covers histogram bucket design and what *not* to measure.

> 🎓 **Why this matters for a junior:** The first thing a senior asks when a service misbehaves is "what do the metrics say?" If the answer is "we don't have any," the next hour is spent flying blind. Learning to emit the right four numbers — and *only* the right ones — is the cheapest insurance you will ever buy against a 3 a.m. page.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small service or program in at least one language (Go, Python, Java, JavaScript, Rust).
- **Required:** What a function call, a loop, and a return value are.
- **Helpful:** What an HTTP request/response cycle looks like — most first metrics count requests.
- **Helpful:** You've seen a dashboard (Grafana, Datadog, CloudWatch) even once. You don't need to build one; just know what the line graphs on it are *made of* — that's what you're emitting.
- **Helpful:** Exposure to logging. See [`../logging/junior.md`](../logging/junior.md). Knowing what a log is makes it obvious what a metric is *not*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Metric** | A numeric measurement, sampled over time, that can be aggregated. The unit of this roadmap. |
| **Time series** | A sequence of `(timestamp, value)` points for one metric (with one fixed set of labels). The thing a metric *is*, under the hood. |
| **Counter** | A metric that only ever goes *up* (or resets to zero on restart). Requests served, bytes sent, errors. |
| **Gauge** | A metric that can go up *and* down. Current temperature, queue depth, memory in use, connections open. |
| **Histogram** | A metric that buckets observations to let you compute percentiles later. Request durations, payload sizes. |
| **Summary** | Like a histogram, but percentiles are computed *in the client* at observation time. Cheaper to store, impossible to re-aggregate. |
| **Label** (a.k.a. *tag*, *dimension*, *attribute*) | A key/value pair attached to a metric to slice it: `method="GET"`, `status="500"`. Covered in [`middle.md`](middle.md). |
| **Cardinality** | The number of distinct label-value combinations. The thing that quietly kills metrics databases. See [`middle.md`](middle.md). |
| **Instrument** | OpenTelemetry's word for "a thing you record measurements with" — `Counter`, `UpDownCounter`, `Histogram`, etc. |
| **Scrape / Pull** | A monitoring server (Prometheus) periodically fetches `/metrics` from your service. |
| **Push** | Your service sends metrics *out* to a collector (StatsD, OTLP). |
| **Exposition / exporter** | The code that turns your in-memory metrics into a format the monitoring system can read. |
| **TSDB** | Time-Series Database — where metrics are stored (Prometheus, VictoriaMetrics, InfluxDB). |
| **`_total`, `_seconds`, `_bytes`** | Naming-convention suffixes that tell humans *and tools* the type and unit. See [`middle.md`](middle.md). |
| **Percentile / quantile** | "p99 = 250ms" means 99% of observations were ≤ 250ms. The honest alternative to averages. |
| **Observability** | The property of being able to ask questions about a system's internal state from the outside. Metrics, logs, traces are its three pillars. |

---

## Core Concepts

### 1. A metric is a number you can aggregate

The defining test of a metric is **aggregatability**: does the value still mean something when you sum, average, or max it across many sources? "Total HTTP requests" aggregates beautifully — add up every server's counter and you have the fleet total. "The user's email address" does not aggregate at all — it's an identity, not a measurement. If you cannot meaningfully combine two readings, you are looking at a log field, not a metric.

### 2. A metric is sampled, not narrated

A log is a *narration*: one line per event, with full context. A metric is a *sample*: a number read at intervals, with the context deliberately thrown away. That's the trade. You lose the ability to know *which* request was slow; you gain the ability to watch *all* requests cheaply, forever. A counter that has been incremented 4.2 billion times costs the same eight bytes to store as one that's been incremented twice.

### 3. The four types are not interchangeable

A counter that goes down is a bug. A gauge used to count total requests will give nonsense the moment the process restarts. A histogram stores buckets so percentiles can be computed *after the fact, across machines*; a summary computes percentiles *now, on this machine* and they can never be correctly merged. Picking the wrong type is the most common day-one metrics mistake, and it is silent — the dashboard shows a line, it's just the *wrong* line.

### 4. You decide what to measure at design time, and you'll guess wrong

The metric you wish you had at 3 a.m. is almost always one you didn't think mattered when you wrote the code. There is no fix for this except experience and a small set of defaults — the [Four Golden Signals](middle.md) (latency, traffic, errors, saturation). Emit those from day one and you'll be wrong far less often.

### 5. Emitting a metric is cheap; storing high-cardinality metrics is not

Incrementing a counter is a single atomic add — nanoseconds. The cost is not in *emitting*; it's in *cardinality*. A metric labelled by user ID creates one time series per user. A million users is a million time series, and that bankrupts the database. The whole of [`middle.md`](middle.md) is, in a sense, about this one trap.

---

## Metric vs Log vs Trace

These are the **three pillars of observability**. They are not competitors; they answer different questions about the same system. The single most common beginner error is reaching for the wrong one.

| | **Metric** | **Log** | **Trace** |
|---|---|---|---|
| **Answers** | "Is the system healthy *in aggregate*?" | "What happened to *this thing*?" | "What path did *this request* take across services?" |
| **Shape** | A number over time | A timestamped text/JSON event | A tree of timed spans |
| **Cost per event** | ~constant (pre-aggregated) | grows with event volume | grows with request volume |
| **Cardinality tolerance** | **Low** — labels must be bounded | High — any field is fine | High — any attribute is fine |
| **Good for** | Dashboards, alerts, trends | Forensics, audit, errors-with-context | Latency breakdown, cross-service flow |
| **Bad for** | "Which user hit the bug?" | "What's my p99 over 30 days?" | Always-on cheap health |
| **Example** | `http_requests_total{status="500"}` | `{"level":"error","user":"u_42","msg":"charge failed","err":"timeout"}` | `POST /checkout → auth(8ms) → db(120ms) → ship(40ms)` |

The decisive rule: **identity goes in logs and traces, never in metric labels.** You want to know your error *rate* (metric) and, when it spikes, *which* requests failed (logs/traces filtered by the time window the metric flagged). A user ID is perfect as a log field and lethal as a metric label.

> Sibling roadmaps: [Logging](../logging/README.md) and [Tracing](../tracing/README.md). Read all three; an engineer who only knows one of the pillars debugs with one eye closed.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Metric** | The dashboard of your car — speed, RPM, fuel, temperature. Numbers, continuous, at a glance. |
| **Log** | The car's maintenance logbook — "2026-03-04: replaced brake pads, mileage 41,203." Detailed, per-event, after the fact. |
| **Trace** | A GPS route of one trip — every turn, with the time spent stuck at each light. |
| **Counter** | The car's odometer — only ever goes up, never resets (well, mostly). |
| **Gauge** | The fuel needle — goes up when you fill, down as you drive. |
| **Histogram** | A speed-camera that records the *distribution* of speeds on a road, so the council can ask "what speed did 95% of cars stay under?" |
| **Summary** | A radar gun that tells you "the 95th-percentile speed *here, today* was 62 mph" but can't be combined with the next town's gun. |
| **Cardinality** | Putting every individual driver's name on the dashboard. One needle is useful; ten million needles is a junkyard. |
| **Aggregation** | Totalling fuel used across an entire delivery fleet — meaningful. Totalling all the drivers' birthdays — meaningless. |
| **Pull (scrape)** | The inspector who walks the factory floor reading every gauge on a schedule. |
| **Push** | Each machine phoning its readings in to head office. |

---

## Mental Models

### 1. A metric is a *lossy compression* of events

Every request is an event. A counter compresses a million request-events into one number: "1,000,000." You can never get the individual requests back out — that information is gone by design. This is the point: you trade detail for the ability to keep the number forever at near-zero cost. When you need the detail back, you go to the logs or traces for that time window. Metrics tell you *where* to look; logs tell you *what* you find there.

### 2. Counters measure flow; gauges measure level

Think of a bathtub. The **counter** is the total litres that have ever come out of the tap — only goes up. The **gauge** is the current water level — rises and falls. If you find yourself wanting a gauge that "counts total events," you want a counter. If you find yourself wanting a counter for "current open connections," you want a gauge. Flow vs level resolves 90% of "which type?" questions.

### 3. Percentiles, not averages

The average is the great liar of metrics. If 99 requests take 10ms and one takes 10 seconds, the *average* is ~110ms — a number that describes *no actual request*. The p99 (250ms? 10s?) tells you what your *worst-served* users actually experience. This is why latency is a **histogram**, never a gauge holding a mean. (Deep dive in [`senior.md`](senior.md).)

### 4. Rate is the derivative of a counter

You almost never look at a raw counter; its value (4,210,993) is meaningless. You look at its *rate of change*: `rate(http_requests_total[1m])` = "requests per second over the last minute." The counter only ever goes up; the **rate** rises and falls and is what you actually graph. The monitoring system computes it for you — which is exactly why counters must monotonically increase, so the rate maths works across restarts.

---

## The Four Metric Types

| Type | Direction | What it answers | Stored as | Re-aggregatable? |
|---|---|---|---|---|
| **Counter** | up only | "How many, in total?" / "What's the rate?" | one number | ✅ yes (sum) |
| **Gauge** | up & down | "What is it *right now*?" | one number | ⚠️ sometimes (sum/avg/max — depends on meaning) |
| **Histogram** | up only (per bucket) | "What's the distribution? p50/p95/p99?" | a set of buckets + count + sum | ✅ yes (buckets add) |
| **Summary** | up only (per quantile) | "What's the p95 *on this instance*?" | pre-computed quantiles + count + sum | ❌ **no** (quantiles can't be averaged) |

### Counter

The simplest and most important. Monotonically increasing; resets to 0 only when the process restarts. The monitoring system handles the reset by detecting the drop and treating it correctly when computing rates. Use for: requests served, errors, bytes processed, tasks completed, cache hits/misses.

### Gauge

A value that can move in both directions. Use for: current memory usage, in-flight requests, queue depth, temperature, connection-pool size, a feature flag's on/off as `1`/`0`. **Do not** use a gauge for "total requests" — on restart it would reset and the monitoring system, not expecting a reset, would graph garbage.

### Histogram

The workhorse for anything where you care about the *distribution* — overwhelmingly, **latency** and **sizes**. It pre-defines a set of buckets (`≤5ms`, `≤10ms`, `≤25ms`, …) and counts how many observations fall in each. Because the buckets are just counters, they **sum cleanly across machines**, so you can compute a correct fleet-wide p99 *after the fact*. This is the killer property summaries lack. (Bucket design is subtle — see [`senior.md`](senior.md).)

### Summary

Looks like a histogram but computes the quantiles *inside the client* at observation time and exports the finished numbers (`p50=8ms`, `p99=210ms`). Cheaper to query, but the quantiles are **per-instance and cannot be merged** — you can't average ten machines' p99s into a fleet p99 (that's just mathematically wrong). Prefer histograms unless you have a specific reason. OpenTelemetry deliberately de-emphasises summaries for this reason.

```text
          observe(0.042)         observe(0.180)         observe(0.011)
                │                       │                      │
                ▼                       ▼                      ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  HISTOGRAM buckets (le = "less than or equal")                │
   │  le=0.005 : 0    le=0.01 : 0    le=0.025: 1   ← 0.011 lands   │
   │  le=0.05  : 2 ← 0.042 lands     le=0.1  : 2                   │
   │  le=0.25  : 3 ← 0.180 lands     le=+Inf : 3   (total count)   │
   │  sum = 0.233                                                   │
   └───────────────────────────────────────────────────────────────┘
   Buckets are counters → they add across machines → correct global p99.
```

---

## Your First Metrics — Code Examples

The same handful of metrics in five ecosystems: a request **counter**, an in-flight **gauge**, and a request-duration **histogram**.

### Go — `prometheus/client_golang`

```go
package main

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	requestsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests handled.",
	})
	inFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Number of requests currently being served.",
	})
	requestDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency in seconds.",
		Buckets: prometheus.DefBuckets, // .005, .01, .025, ... 10
	})
)

func handler(w http.ResponseWriter, r *http.Request) {
	requestsTotal.Inc()      // counter: only goes up
	inFlight.Inc()           // gauge: up now...
	defer inFlight.Dec()     //        ...down when we return

	start := time.Now()
	defer func() { requestDuration.Observe(time.Since(start).Seconds()) }() // histogram

	time.Sleep(20 * time.Millisecond) // pretend to do work
	w.Write([]byte("ok"))
}

func main() {
	http.HandleFunc("/", handler)
	http.Handle("/metrics", promhttp.Handler()) // Prometheus scrapes this
	http.ListenAndServe(":8080", nil)
}
```

`curl localhost:8080/metrics` now shows your three metrics in Prometheus exposition format, including auto-generated runtime metrics (`go_goroutines`, `go_memstats_*`).

### Python — `prometheus_client`

```python
from prometheus_client import Counter, Gauge, Histogram, start_http_server
import time

REQUESTS = Counter("http_requests_total", "Total HTTP requests handled.")
IN_FLIGHT = Gauge("http_requests_in_flight", "Requests currently being served.")
LATENCY = Histogram("http_request_duration_seconds", "HTTP request latency (s).")

@LATENCY.time()            # decorator times the function into the histogram
@IN_FLIGHT.track_inprogress()   # gauge up on enter, down on exit
def handle_request():
    REQUESTS.inc()
    time.sleep(0.02)

if __name__ == "__main__":
    start_http_server(8000)     # serves /metrics on :8000
    while True:
        handle_request()
```

The decorators (`.time()`, `.track_inprogress()`) are idiomatic `prometheus_client` — they remove the manual start/stop bookkeeping.

### Java — Micrometer

```java
import io.micrometer.core.instrument.*;
import io.micrometer.prometheus.PrometheusConfig;
import io.micrometer.prometheus.PrometheusMeterRegistry;

public class Service {
    static final PrometheusMeterRegistry registry =
        new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);

    static final Counter requests =
        Counter.builder("http_requests_total")
               .description("Total HTTP requests handled.").register(registry);
    static final Timer latency =        // Micrometer's histogram-backed Timer
        Timer.builder("http_request_duration_seconds")
             .description("HTTP request latency.")
             .publishPercentileHistogram()      // emit buckets, not just a summary
             .register(registry);

    static int inFlight = 0;
    static { Gauge.builder("http_requests_in_flight", () -> inFlight)
                  .register(registry); }        // gauge reads a live value

    static void handle() {
        requests.increment();
        inFlight++;
        try {
            latency.record(() -> { try { Thread.sleep(20); } catch (Exception e) {} });
        } finally { inFlight--; }
    }

    // registry.scrape() returns the Prometheus exposition text for /metrics
}
```

Micrometer is the JVM standard: one façade, many backends (Prometheus, Datadog, CloudWatch). A `Timer` is the right tool for latency — `publishPercentileHistogram()` makes it export real buckets.

### Node.js — `prom-client`

```js
const http = require("http");
const client = require("prom-client");

const requests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled.",
});
const inFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "Requests currently being served.",
});
const latency = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", client.register.contentType);
    return res.end(await client.register.metrics());
  }
  requests.inc();
  inFlight.inc();
  const stop = latency.startTimer();      // returns a function that records on call
  await new Promise((r) => setTimeout(r, 20));
  stop();
  inFlight.dec();
  res.end("ok");
});
server.listen(8080);
```

### Rust — `metrics` (facade) and `prometheus`

```rust
// Cargo.toml: metrics = "0.23", metrics-exporter-prometheus = "0.15"
use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::time::Instant;

fn handle_request() {
    counter!("http_requests_total").increment(1);          // counter
    gauge!("http_requests_in_flight").increment(1.0);      // gauge up

    let start = Instant::now();
    std::thread::sleep(std::time::Duration::from_millis(20));
    histogram!("http_request_duration_seconds").record(start.elapsed().as_secs_f64());

    gauge!("http_requests_in_flight").decrement(1.0);      // gauge down
}

fn main() {
    // Installs a /metrics HTTP listener on :9000 by default.
    PrometheusBuilder::new().install().expect("failed to install exporter");
    loop { handle_request(); }
}
```

The `metrics` crate is a *facade* (like `log` is for logging) — your code calls `counter!`/`gauge!`/`histogram!`, and a separate exporter crate decides where they go. Clean separation, swappable backend.

---

## What a Metric Costs

| Operation | Cost | Notes |
|---|---|---|
| `counter.Inc()` | ~1 atomic add, nanoseconds | Cheap enough to put on any hot path. |
| `gauge.Set(x)` | one atomic store | Cheap. |
| `histogram.Observe(x)` | find bucket + atomic increments | Cheap; cost is in *storage*, not the call. |
| **One time series** (one label combo) | a few KB in the TSDB | This is where cost lives — multiply by cardinality. |
| **A scrape** | serialise all series to text | Grows with number of series, not request volume. |

The headline: **the call is free; the cardinality is not.** A counter with no labels is one series forever, no matter how many billions of times you increment it. The same counter labelled with `user_id` is one series *per user* — and that is how teams accidentally store millions of series and get a 2 a.m. page from their *monitoring* system. (The whole story: [`middle.md`](middle.md) → cardinality.)

---

## Use Cases

| Situation | Type to reach for |
|---|---|
| Count requests / errors / jobs done | **Counter** |
| Current memory, queue depth, in-flight requests, pool size | **Gauge** |
| Request latency, response/payload size | **Histogram** |
| "How many 500s per second?" | **Counter**, then `rate()` |
| "What's my p99 latency across the fleet?" | **Histogram** (summaries can't merge) |
| "Which user triggered the error?" | **Not a metric** — log it |
| "Why was *this* checkout slow?" | **Not a metric** — trace it |
| A boolean state (leader/follower, feature on/off) | **Gauge** set to `1`/`0` |

---

## Coding Patterns

### Pattern 1 — Time a block with a deferred observe

```go
start := time.Now()
defer func() { requestDuration.Observe(time.Since(start).Seconds()) }()
```

`defer` (Go) / `finally` (Java) / decorator (Python) / `startTimer()` closure (Node) guarantees the observation happens *even if the function returns early or errors*. A timing that only records on the happy path under-counts your slowest requests — exactly the ones you care about.

### Pattern 2 — Gauge up/down in a matched pair

```python
IN_FLIGHT.inc()
try:
    do_work()
finally:
    IN_FLIGHT.dec()      # MUST run, or the gauge leaks upward forever
```

A gauge that gets `inc()`'d but not `dec()`'d on the error path will climb forever and lie about your load. Always pair them with `finally`/`defer`.

### Pattern 3 — Declare metrics once, globally

Define each metric **once** at package/module scope, not inside the request handler. Creating a new metric object per request is both slow and wrong (some libraries error on duplicate registration; others silently leak). Metrics are long-lived singletons.

### Pattern 4 — Use seconds and bytes as base units

```go
Name: "http_request_duration_seconds"   // ✅ seconds, not milliseconds
Name: "response_size_bytes"             // ✅ bytes, not KB
```

Conventions covered in [`middle.md`](middle.md), but start right: base SI units (seconds, bytes), `_total` suffix on counters. Dashboards and alerting rules assume it.

---

## Clean Code

- **One metric, one meaning.** Don't overload `http_requests_total` to also count background jobs. Make a second counter.
- **Name for the reader, not the writer.** `payment_authorizations_total` beats `pa_cnt`.
- **Always write a `Help` / description.** Future-you, staring at a dashboard at 3 a.m., needs to know what `widget_flux_seconds` means.
- **Base units, suffixed.** `_seconds`, `_bytes`, `_total`. Never `_ms` in a metric name even if you think in milliseconds.
- **No identity in labels.** No user IDs, emails, request IDs, full URLs as label values. (Why: [`middle.md`](middle.md).)
- **Co-locate the metric with the code it measures.** A latency histogram defined three files away from the handler it times rots.

---

## Best Practices

1. **Emit the Four Golden Signals first.** Latency, traffic, errors, saturation. They catch most incidents and cost almost nothing. (Detail in [`middle.md`](middle.md).)
2. **Pick the type by the question, not by habit.** "Total?" → counter. "Right now?" → gauge. "Distribution?" → histogram.
3. **Prefer histograms over summaries** unless you have a measured reason — histograms aggregate correctly across instances.
4. **Expose `/metrics` from day one**, even if nothing scrapes it yet. Adding it during an incident is too late.
5. **Let the client library give you runtime metrics for free** — goroutines, GC, heap, event-loop lag. Don't hand-roll them.
6. **Measure at the boundary.** Time the whole handler, count at the entry point — not deep inside helper functions where you'll miss code paths.
7. **Keep labels bounded and known in advance.** If you can't list every possible value of a label on a whiteboard, it's probably high-cardinality. Stop. ([`middle.md`](middle.md).)

---

## Edge Cases & Pitfalls

- **Counter used where a gauge belongs (or vice versa).** A "current connections" counter only goes up; a "total requests" gauge resets on restart. Both produce silently wrong graphs.
- **Histogram with default buckets on the wrong scale.** Default Prometheus buckets top out at 10 *seconds*. If you're measuring microsecond cache lookups, *every* observation lands in the first bucket and your percentiles are useless. (Bucket sizing: [`senior.md`](senior.md).)
- **Summary when you need cross-machine percentiles.** Ten instances each reporting their own p99 — there is no correct way to combine them into a fleet p99. Use a histogram.
- **Forgetting the gauge `dec()` on the error path.** The in-flight gauge leaks upward and your "load" graph lies.
- **Creating metrics inside the request handler.** Duplicate-registration errors or memory leaks, depending on the library.
- **Labelling with unbounded values.** `path="/users/12345"` creates a series per user ID baked into the URL. Use `path="/users/:id"` (the route template), not the concrete path.
- **Milliseconds in the metric name but seconds in the value** (or the reverse). The dashboard will be off by 1000× and you won't notice until an alert fires at the wrong threshold.

---

## Common Mistakes

1. **Putting identity in a metric label** (user ID, request ID, email). The #1 way juniors melt a TSDB. It belongs in a log.
2. **Using the average instead of a percentile.** The average hides your worst-served users. Use a histogram and look at p95/p99.
3. **Reading the raw counter value** (`4,210,993`) instead of its `rate()`. The raw value is meaningless; the rate is the signal.
4. **One giant catch-all metric** that tries to count everything with a dozen labels. Split it.
5. **No `Help` text / description.** Six months later nobody knows what the metric means.
6. **Measuring everything "just in case."** Every metric costs storage and cognitive load. Emit what you'll actually look at. (Anti-pattern detail: [`senior.md`](senior.md).)
7. **Confusing a histogram with a summary** and being surprised the percentiles "don't add up" across machines (summaries don't, histograms do).
8. **Re-creating a metric object per call** instead of declaring it once at module scope.

---

## Tricky Points

1. **Counters reset to zero on restart — and that's fine.** The monitoring system detects the drop and computes `rate()` correctly across the reset. Never "fix" this by making a counter that survives restarts; you'd break the rate maths.
2. **A gauge is *not* always aggregatable.** Summing "queue depth" across machines is meaningful; summing "CPU temperature" is not — you'd want the max or average. The library can't know which; *you* decide via the dashboard query.
3. **`Observe()` records into a histogram; it does not "set" anything.** Each call adds one data point to the distribution. There's no single "current value" of a histogram.
4. **`_total` is a *convention*, not magic** — but Prometheus tooling and alerting rules genuinely rely on it to identify counters. Follow it.
5. **The histogram's `_count` is itself a counter** of total observations, and `_sum` is a counter of the total of all observed values. `rate(_sum) / rate(_count)` gives you the *average* — which is exactly why you rarely want it.
6. **A metric with no observations yet may not appear at all** in the scrape output (lazy libraries) — so "the metric is missing" can mean "zero events," not "broken instrumentation." Check both.

---

## Test Yourself

1. Without looking, define: counter, gauge, histogram, summary. For each, give one real metric from a web service.
2. You want to track "number of items currently in the work queue." Which type? What goes wrong if you pick a counter?
3. Your service does 1M requests/day. Storage cost of `requests_total` (no labels) vs `requests_total{user_id=...}` for 100k users — roughly how many time series each?
4. Why can't you average ten machines' summary-p99 values into a fleet p99? Why *can* you do the equivalent with histograms?
5. Take a service you've written. Add a request counter, an in-flight gauge, and a latency histogram. `curl /metrics` and read your own output.
6. Given a list of facts about a request — duration, status code, user email, region — sort each into metric / log / trace.
7. Your latency histogram's percentiles all read "0.005s" no matter the load. What's almost certainly wrong?
8. Explain why you graph `rate(http_requests_total[1m])` and never the raw counter value.

---

## Tricky Questions

**Q1: Is "current temperature of the CPU" a counter or a gauge?**

A gauge. It goes up *and* down. A counter only ever increases. The test: "can this number decrease in normal operation?" If yes, it's a gauge.

**Q2: I want my "total requests" number to survive process restarts so the graph doesn't drop to zero. How?**

You don't, and you shouldn't. Counters are *meant* to reset on restart; the monitoring system detects the reset and computes `rate()` correctly across it. A counter that survives restarts (e.g. persisted to disk) actually *breaks* rate calculation. Let it reset; graph the rate, not the value.

**Q3: I labelled my latency histogram with the full request URL so I can see per-endpoint latency. Good idea?**

The *intent* is good (per-endpoint latency is valuable); the *implementation* is a cardinality bomb. `/users/12345/orders/98765` is a unique label value per request. Use the **route template** — `/users/:id/orders/:id` — which has a small, fixed set of values. (Full treatment: [`middle.md`](middle.md).)

**Q4: My average latency is 50ms but users complain it's slow. The metric says it's fine. Who's right?**

The users. Your *average* is 50ms; your *p99* might be 4 seconds. The average is dominated by the many fast requests and hides the few catastrophically slow ones — which are real users having a bad time. Stop looking at the average; look at the p99 from a histogram.

**Q5: When should I use a metric instead of a log?**

When you care about the *aggregate over time* and not *which specific event*. "How many errors per minute?" → metric. "What was the error message and stack trace for *that* failure?" → log. You almost always want both: the metric tells you *that* errors spiked and *when*; the logs (filtered to that window) tell you *why*.

**Q6: My histogram percentiles are all stuck at the lowest bucket. What happened?**

Your bucket boundaries don't fit your data. If your buckets top out at 10s but every request is 50µs, everything lands in the first bucket and the percentile estimate degenerates. You need buckets that *bracket* your real latencies. (Bucket design: [`senior.md`](senior.md).)

---

## Cheat Sheet

```text
┌──────────────────────────── METRICS — JUNIOR CHEAT SHEET ───────────────────────────────┐
│                                                                                          │
│  WHAT IS A METRIC?                                                                       │
│    A NUMBER, over TIME, that you can AGGREGATE. Fails any test → it's a log or trace.    │
│                                                                                          │
│  THE FOUR TYPES                                                                          │
│    COUNTER    only goes UP        requests, errors, bytes      → graph rate(), not value │
│    GAUGE      up AND down         queue depth, memory, in-flight                         │
│    HISTOGRAM  buckets a distrib.  latency, sizes  → correct p99 ACROSS machines          │
│    SUMMARY    client-side p99     latency  → CANNOT merge across machines (avoid)        │
│                                                                                          │
│  PICK BY THE QUESTION                                                                    │
│    "how many / what rate?"  → counter                                                   │
│    "what is it right now?"  → gauge                                                      │
│    "what's the distribution / p99?"  → histogram                                        │
│                                                                                          │
│  METRIC vs LOG vs TRACE                                                                  │
│    metric → is the system healthy in aggregate?   (cheap, low-cardinality)              │
│    log    → what happened to THIS thing?          (forensics, any field)                │
│    trace  → what path did THIS request take?      (cross-service latency)               │
│    IDENTITY (user id, req id) → log/trace, NEVER a metric label.                         │
│                                                                                          │
│  COST                                                                                    │
│    .Inc() / .Observe() = nanoseconds (free).                                            │
│    cost lives in CARDINALITY = #(label combinations). bound your labels.                │
│                                                                                          │
│  GOLDEN RULES                                                                            │
│    • averages lie — use percentiles (p95/p99).                                          │
│    • counters reset on restart — that's correct, graph the rate.                        │
│    • base units: _seconds, _bytes, _total.                                              │
│    • declare metrics ONCE, globally. pair gauge inc/dec in finally.                     │
│    • prefer histograms over summaries.                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **metric is a number, over time, that you can aggregate.** If data fails any of those three tests, it's a log or a trace.
- The **three pillars**: metrics (aggregate health), logs (per-event forensics), traces (per-request path). Use the right one; **identity belongs in logs/traces, never in metric labels.**
- The **four types**: **counter** (up only — flow), **gauge** (up & down — level), **histogram** (buckets a distribution; aggregates correctly), **summary** (client-side percentiles; *cannot* be merged — avoid).
- Pick the type by **the question you're asking**, not by habit: "how many?" → counter, "right now?" → gauge, "what distribution?" → histogram.
- **Averages lie.** Use percentiles (p95/p99) from a histogram. The p99 is what your worst-served users actually experience.
- You graph a counter's **`rate()`**, never its raw value; counters reset on restart and that is *correct*.
- **Emitting is free; cardinality is the cost.** One series per label combination — keep labels bounded.
- Emit the **Four Golden Signals** from day one, expose `/metrics` early, use base units (`_seconds`, `_bytes`, `_total`).
- Five ecosystems, same shapes: `prometheus/client_golang` (Go), `prometheus_client` (Python), Micrometer (Java), `prom-client` (Node), `metrics` (Rust).

---

## What You Can Build

- A **"sort the signal" drill**: a list of 30 facts about a web request (duration, user email, status, region, SQL text…) and a script that quizzes you on metric vs log vs trace for each.
- A **minimal instrumented HTTP service** in your language of choice exposing the three core metrics + `/metrics`. Point Prometheus (or just `curl` in a loop) at it and watch the numbers move.
- A **"four types" demo**: one tiny program that emits a counter, a gauge, a histogram, and a summary for the *same* event stream, so you can see side-by-side why the histogram's percentiles aggregate and the summary's don't.
- A **bucket-mismatch reproduction**: a latency histogram with deliberately wrong buckets (all observations in bucket 1), then fix the buckets and watch the percentiles come alive.
- A **runtime-metrics dashboard**: scrape your service's free runtime metrics (`go_goroutines`, `process_resident_memory_bytes`, Node event-loop lag) and build a one-page health board.

---

## Further Reading

- **Prometheus docs — "Metric Types"** — <https://prometheus.io/docs/concepts/metric_types/>. The canonical four-types explainer.
- **Prometheus docs — "Instrumentation best practices"** — <https://prometheus.io/docs/practices/instrumentation/>.
- **"How NOT to Measure Latency" — Gil Tene** (talk). Why averages and bad percentiles lie. Foundational.
- **OpenTelemetry — Metrics concepts** — <https://opentelemetry.io/docs/concepts/signals/metrics/>.
- **Google SRE Book — "Monitoring Distributed Systems"** (Four Golden Signals) — <https://sre.google/sre-book/monitoring-distributed-systems/>.
- **`prometheus_client` (Python)**, **`client_golang` (Go)**, **Micrometer (JVM)**, **`prom-client` (Node)**, **`metrics` (Rust)** — each client's README is short and worth one read.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — labels & cardinality, naming/units, RED/USE/golden signals, instrumenting a service correctly.
- **Senior level:** [senior.md](senior.md) — histogram bucket design, percentile aggregation pitfalls, pull vs push, what *not* to measure.
- **Professional level:** [professional.md](professional.md) — OpenTelemetry architecture, exemplars, cardinality at scale, multi-language fleet standards.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Junior](../logging/junior.md) — the per-event pillar. Read it to see exactly what a metric is *not*.
- [Tracing](../tracing/README.md) — the per-request-path pillar.
- [Error Handling — Junior](../error-handling/junior.md) — error counters start here.

**Cross-roadmap links:**

- [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/) — when a metric tells you *that* it's slow, profiling tells you *why*.
- [Backend → Observability → Metrics](../../../Backend/backend/09-observability/02-metrics/) — the Prometheus/Grafana *stack* side (this roadmap is the code-emits side).

---

## Diagrams & Visual Aids

### The three pillars

```text
            ┌───────────────────────── ONE SYSTEM ─────────────────────────┐
            │                                                              │
   METRICS  │   ▁▂▅█▅▂▁  numbers over time   "rate is 200/s, p99 is 240ms" │  ← cheap, always-on
            │                                                              │
   LOGS     │   {ts, level, msg, fields...}  "u_42 charge failed: timeout" │  ← per-event detail
            │                                                              │
   TRACES   │   ├─auth 8ms ─┬─ db 120ms ─── ship 40ms  "where the time went"│ ← per-request path
            │              └─ cache 2ms                                     │
            └──────────────────────────────────────────────────────────────┘
   Metric flags WHEN/THAT. Log+trace (filtered to that window) tell you WHY.
```

### Counter vs Gauge

```text
   COUNTER (flow, up-only)            GAUGE (level, up & down)
   value                              value
    │            ╱│  ← restart         │      ╱╲      ╱╲
    │         ╱   │                    │    ╱    ╲  ╱    ╲
    │      ╱      │╱                   │  ╱        ╲╱      ╲
    │   ╱         │                    │╱                   ╲
    └───────────────────► time         └──────────────────────► time
    graph the RATE, not the value      graph the value directly
```

### Choosing a type

```text
              ┌─────────────────────────────┐
              │  What question am I asking?  │
              └──────────────┬──────────────┘
        "how many / rate?"   │   "what is it now?"   "what distribution?"
                 ▼           │           ▼                   ▼
            ┌─────────┐      │      ┌─────────┐        ┌────────────┐
            │ COUNTER │      │      │  GAUGE  │        │ HISTOGRAM  │
            └─────────┘      │      └─────────┘        └────────────┘
                             │                          (avoid SUMMARY —
                             │                           can't merge p99
                             ▼                           across machines)
                    is it identity (user id,
                    request id, email)?
                             │ yes
                             ▼
                    NOT A METRIC → log it / trace it
```

---
