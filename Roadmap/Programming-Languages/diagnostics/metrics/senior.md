# Metrics — Senior Level

> **Topic:** [Metrics Roadmap](README.md)
> **Focus:** The design decisions that decide whether a metrics system survives contact with scale. Histogram bucket design. Why you cannot average percentiles. Pull vs push as an architecture choice. Cardinality budgets you enforce, not hope for. And the most under-taught skill: deciding what *not* to measure.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Histogram Bucket Design](#histogram-bucket-design)
6. [Native vs Classic Histograms](#native-vs-classic-histograms)
7. [Percentiles & Aggregation Pitfalls](#percentiles--aggregation-pitfalls)
8. [Why You Cannot Average p99s](#why-you-cannot-average-p99s)
9. [Summaries vs Histograms — The Real Trade-off](#summaries-vs-histograms--the-real-trade-off)
10. [Pull vs Push as an Architecture Decision](#pull-vs-push-as-an-architecture-decision)
11. [Cardinality Budgets You Enforce](#cardinality-budgets-you-enforce)
12. [What NOT to Measure](#what-not-to-measure)
13. [Counter Resets, Rate, and the increase() Trap](#counter-resets-rate-and-the-increase-trap)
14. [Aggregation Temporality — Cumulative vs Delta](#aggregation-temporality--cumulative-vs-delta)
15. [Code Examples](#code-examples)
16. [Worked Example — A Histogram That Lied](#worked-example--a-histogram-that-lied)
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

> Focus: **The arithmetic of metrics is unforgiving, and most of it is invisible until it bites.** Middle level taught you to keep labels bounded. Senior level is where you learn that a histogram with the wrong buckets reports a p99 that is off by 4×, that averaging two services' p99s is *meaningless*, and that "just add a metric" is a budget decision with a recurring cost.

At middle level the question was *"will the labels help me debug at 3 a.m.?"* At senior level the questions get sharper and quantitative: *"Are my histogram buckets placed where my latency actually lives, or am I interpolating across a chasm? Can the aggregation I'm asking Grafana to do even produce a correct number? What does this metric cost per month in series, in scrape bandwidth, in TSDB RAM — and is the answer it gives me worth that?"*

This is the level where you stop trusting the dashboard and start auditing it. The single most common senior realization: **a wrong metric is worse than no metric**, because it gives confident, false numbers that drive bad decisions. A p99 latency dashboard built on summaries that get averaged across a fleet will read "120ms" while real p99 is 800ms — and nobody questions it because it has a green checkmark and three decimal places.

We stay strictly at the *code-emits* level: bucket choices in the instrumentation, what type you pick, how you expose it, how you bound its cardinality at the source. The *query-side* mechanics (recording rules, alert expressions, downsampling) belong to the monitoring stack and are linked, not repeated.

> 🎓 **Why this matters for a senior:** Juniors emit metrics. Middles keep them bounded. Seniors own the *correctness* and *cost* of the signal. When a metric is wrong, the engineer who designed its buckets and its aggregation semantics is the one who owns the false 3 a.m. confidence — or the one who prevented it.

---

## Prerequisites

- **Required:** All of [`middle.md`](middle.md) — cardinality as a product, bounded labels, naming/units conventions, RED/USE, the route-template discipline.
- **Required:** You can read a Prometheus query: `rate()`, `histogram_quantile()`, `sum by (...)`, `increase()`. You don't need to *write* recording rules, but you must understand what they compute.
- **Required:** You've operated a metrics backend (Prometheus, Mimir, Datadog, Cloud Monitoring) at least enough to have seen a series-count graph and a scrape-duration graph.
- **Helpful:** You've felt the pain of a wrong percentile — a dashboard that disagreed with reality during an incident.
- **Helpful:** Comfort with the difference between *recording* a measurement and *aggregating* it — the heart of this page.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bucket boundary (`le`)** | A histogram's upper bound. Each `_bucket{le="0.1"}` counts observations ≤ 0.1s. The set of boundaries *is* the histogram's resolution. |
| **Cumulative bucket** | Prometheus classic histogram buckets are cumulative: `le="1"` includes everything `le="0.5"` counted. The `+Inf` bucket equals `_count`. |
| **Linear interpolation** | How `histogram_quantile()` estimates a percentile *inside* a bucket: it assumes observations are uniformly spread across the bucket's width. Wrong when they aren't. |
| **Native / exponential histogram** | Prometheus's newer histogram with automatic, exponentially-spaced buckets and a configurable resolution (`schema`). No manual bucket choice; far less storage. OTel calls it the exponential histogram. |
| **φ-quantile (phi)** | The quantile a *summary* is configured to track client-side (e.g. φ=0.99 with error 0.001). Computed in-process, **not re-aggregatable**. |
| **Aggregation temporality** | OTel's term for whether a counter reports a running total (**cumulative**) or the change since last export (**delta**). |
| **Cardinality budget** | A pre-agreed maximum series count per service/team/metric, with enforcement (limits, relabel drops, alerts) — not a wish. |
| **Active series** | Series receiving samples in the current head block. The number that drives TSDB RAM and the number you budget against. |
| **Churn** | The rate at which old series die and new ones are born (e.g. pods rolling). High churn inflates index size even at steady active-series count. |
| **Exemplar** | A sampled trace ID attached to a histogram bucket observation — the bridge from "p99 is high" to "here's a slow trace." Detail at [`professional.md`](professional.md). |
| **Relabeling / `metric_relabel_configs`** | Scrape-time rewriting/dropping of labels or whole metrics — the last line of defense against a cardinality bomb you can't fix in code. |
| **Pushgateway** | A Prometheus component that holds metrics from batch jobs until scraped. Easy to misuse (it has no notion of "job ended"). |
| **OTLP** | OpenTelemetry Protocol — the push transport for OTel metrics/traces/logs to a collector. |

---

## Core Concepts

### 1. A histogram's accuracy is decided at instrumentation time, forever

`histogram_quantile()` can only interpolate *within* the buckets you chose when you wrote the code. If all your traffic lives between 1ms and 5ms but your boundaries jump `1ms → 5ms → 25ms`, every percentile in that range is a guess across a 4ms-wide bucket. You cannot fix this in the query, in Grafana, or after the fact — the resolution was lost at `Observe()` time. **Bucket design is a write-time decision with read-time-forever consequences.**

### 2. Percentiles do not aggregate the way counts do

You can `sum()` counters across instances and get a correct total. You **cannot** average, sum, or `max()` precomputed percentiles across instances and get a correct percentile. A p99 is a property of a *distribution*; combining distributions requires the underlying buckets, not the summary statistic. This single fact dictates "histograms over summaries" for anything you aggregate.

### 3. Pull vs push is not a preference — it's a set of operational consequences

Pull gives you target liveness for free and centralizes service discovery. Push handles ephemeral and network-restricted workloads but needs a separate heartbeat and shifts discovery to the sender. The decision changes how you detect "is it down?", how you handle firewalls and serverless, and where the cardinality control point lives. Pick deliberately.

### 4. Cardinality is a budget with a monthly bill

Every active series costs index RAM, head-block RAM, disk, and scrape/remote-write bandwidth — continuously. "Add a label" is "increase the recurring bill." A senior treats series count as a capacity-planned resource with limits and alerts, the same way they treat a connection pool or a memory budget.

### 5. The hardest skill is subtraction

The instinct is to measure more. The discipline is to measure *less, but correctly*. Most bespoke business metrics are never queried, never alerted on, and silently inflate cost and cognitive load. Deleting a never-queried metric is a senior contribution. **What not to measure is a design decision, not an oversight.**

### 6. Counters are monotonic *until they aren't*

A counter resets to zero on process restart. `rate()` and `increase()` are built to handle this — but only if you use the counter idiom correctly (never reset it yourself, never `Set()` it, never reuse it across a value that can go down). Misuse produces negative rates and silent data loss.

### 7. The metric you emit and the number on the dashboard are connected by *semantics you must know*

Cumulative vs delta, `rate()` windows vs scrape intervals, how `le` interpolation works — the emitted bytes are only half the contract. A senior knows the read-side math well enough to emit data that the read side can interpret *correctly*, even though they only write the emit side.

---

## Histogram Bucket Design

A classic Prometheus histogram is a set of counters, one per *cumulative* bucket boundary `le` (less-than-or-equal), plus a `_count` and a `_sum`. When you query `histogram_quantile(0.99, ...)`, Prometheus:

1. Finds the bucket where the 99th-percentile observation falls.
2. **Linearly interpolates** within that bucket, assuming observations are spread uniformly across its width.

That second step is the whole ballgame. If your p99 falls in the bucket `(0.1, 0.5]` and 99% of *that bucket's* mass is actually clustered at 0.45, but interpolation assumes uniform spread, your reported p99 will be wrong — pulled toward the bucket's midpoint. **Resolution where your latency lives is everything; resolution where it doesn't is wasted series.**

### The default buckets are usually wrong for you

`prometheus.DefBuckets` is `{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}` seconds. It's a generic web-latency guess. It is wrong if:

- Your service answers in **microseconds** (cache, in-memory lookup) — everything piles into the `≤5ms` bucket and your p50/p90/p99 are all "≤5ms," i.e. useless.
- Your service answers in **tens of seconds** (video transcode, report generation) — everything is in `+Inf` and you've measured nothing above 10s.
- Your **SLO boundary** isn't a bucket edge. If your SLO is "p99 < 300ms" but your buckets jump `250ms → 500ms`, you cannot tell whether p99 is 280ms or 480ms — the exact distinction your SLO cares about.

### Rules for choosing boundaries

| Rule | Why |
|---|---|
| **Put a bucket edge *at* every SLO threshold.** | `histogram_quantile` and `... < SLO` alerts read exactly at that edge. An SLO of 300ms needs an `le="0.3"` bucket. |
| **Space buckets to match the distribution's shape**, usually geometric/log-spaced. | Latency is heavy-tailed; equal-width buckets waste resolution low and starve it high. |
| **Cover the full plausible range**, with the top finite bucket above your timeout. | If requests can take 30s, a `+Inf`-after-10s histogram hides the entire tail. |
| **Keep the count sane: ~8–15 buckets** for most services. | Each bucket × each label combo is a series. 12 buckets × 200 combos = 2,400 series for one histogram. |
| **Standardize buckets across a service family.** | You cannot compare or merge two services' histograms if their `le` sets differ. |

### A worked bucket choice

A payments API with SLOs "p50 < 50ms, p99 < 300ms, hard timeout 2s":

```text
buckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2]
                              ^p50 edge        ^extra         ^p99 edge     ^timeout
```

Edges at `0.05` (the p50 SLO) and `0.3` (the p99 SLO) so the alert reads exactly there; denser spacing in the 50–300ms band where the SLO action lives; a finite top bucket at the 2s timeout so the over-timeout tail is visible, not dumped into `+Inf`.

> The mechanical test for a histogram: pick your most important SLO threshold. Is there a bucket boundary *exactly* there? If not, your SLO alert is interpolating, and your "p99 < 300ms" alert might fire (or not) based on a guess.

---

## Native vs Classic Histograms

The classic histogram's bucket-design burden is real, and the ecosystem's answer is the **native histogram** (Prometheus 2.40+, GA-track) / **exponential histogram** (OpenTelemetry). Instead of fixed boundaries you choose, it uses *automatically* exponentially-spaced buckets at a configurable resolution (`schema` / scale), covering the whole range with bounded relative error.

| | **Classic histogram** | **Native / exponential histogram** |
|---|---|---|
| Buckets | Fixed `le` set you choose | Auto, exponentially spaced, dynamic range |
| You must design buckets | **Yes** — the hard part | No — pick a resolution, done |
| Series cost | One series **per bucket** per label combo | A *single* series carrying a sparse bucket structure |
| Resolution | Coarse where you guessed wrong | Uniform relative error everywhere |
| Re-aggregatable | Yes (sum the bucket counters) | Yes (merge the structures) |
| Maturity | Universal, stable | Newer; backend + client support still spreading |
| `histogram_quantile` | Interpolates within wide buckets | Far tighter buckets → far better quantiles |

The native histogram solves the two worst classic-histogram failure modes at once: *wrong bucket placement* and *series-per-bucket cost*. A classic latency histogram with 12 buckets × 300 label combos is 3,600 series; the native equivalent is roughly 300 series with *better* accuracy.

**Senior guidance:** for new latency/size instrumentation on a stack that supports them end to end (client → scrape → TSDB → Grafana), prefer native/exponential histograms — you stop hand-designing buckets and you cut series cost by an order of magnitude. Keep classic histograms where any link in the chain lacks support, or where you need exact, named SLO-edge buckets that some teams still alert on. Both are *aggregatable*, which is the property summaries lack.

```go
// Go (prometheus/client_golang ≥ 1.16): native histogram via factor, not Buckets.
duration := promauto.NewHistogramVec(prometheus.HistogramOpts{
    Name:                            "http_request_duration_seconds",
    Help:                            "Request latency.",
    NativeHistogramBucketFactor:     1.1,  // ~10% relative error per bucket
    NativeHistogramMaxBucketNumber:  160,  // cap resolution → cap memory
    NativeHistogramMinResetDuration: time.Hour,
    // Note: omit Buckets to go native-only, or keep both during migration.
}, []string{"method", "route"})
```

---

## Percentiles & Aggregation Pitfalls

The defining senior mistake in metrics is treating a percentile like a sum. They behave completely differently under aggregation.

| Operation | Counters | Percentiles |
|---|---|---|
| Combine across instances | `sum()` — **correct** | averaging precomputed p99s — **meaningless** |
| Combine across time | `increase()` over a window — correct | you must recompute from buckets over the window |
| Stored as | one number, additive | a property of a distribution, non-additive |

### The mechanism of the error

A percentile answers "the value below which X% of observations fall." That requires *knowing the distribution*. A precomputed p99 has **thrown the distribution away** and kept one number. You cannot reconstruct a fleet-wide distribution from per-instance summary numbers — the information is gone.

The *correct* way to get a fleet p99 from histograms is to aggregate the **buckets** first, then compute the quantile from the combined buckets:

```promql
# CORRECT: sum the bucket counters across instances, THEN take the quantile.
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

The `sum by (le)` merges every instance's bucket counts into one fleet-wide histogram; `histogram_quantile` then reads a real distribution. This works *only because* histograms keep the buckets. A summary has no `_bucket` series — there is nothing to `sum by (le)` — which is exactly why summaries cannot be aggregated.

> The emit-side lesson: **if a latency will ever be looked at across more than one instance — and it always will — it must be a histogram, not a summary.** This is a decision you make in the instrumentation, and it's almost always irreversible without a migration.

---

## Why You Cannot Average p99s

This deserves its own section because it's the most confidently-made wrong move in the field.

Two instances, each serving 100 requests:

```text
Instance A latencies:  99 requests at 10ms, 1 request at 1000ms   → p99(A) ≈ 10ms
Instance B latencies:  99 requests at 10ms, 1 request at 1000ms   → p99(B) ≈ 10ms

avg(p99(A), p99(B)) = avg(10ms, 10ms) = 10ms        ← what the wrong dashboard shows
```

Now the *true* fleet p99 over all 200 requests:

```text
200 requests total: 198 at 10ms, 2 at 1000ms.
The 99th percentile is the value below which 198 of 200 (99%) fall.
The slowest 2 (1%) are the two 1000ms requests.
True fleet p99 ≈ 1000ms.                              ← 100× higher than the average
```

`avg(p99)` reported 10ms; reality was 1000ms. **The average of percentiles hid the tail completely.** During an incident this is the difference between "everything's fine" and "1% of every user's requests are timing out."

### The failure-story version

A team ran 30 API pods, each exporting a *summary* with a client-computed `quantile{quantile="0.99"}`. Their Grafana panel did `avg(http_request_duration_seconds{quantile="0.99"})` because it was the obvious thing and it produced a smooth green line at ~120ms. A customer escalation revealed real p99 was ~850ms. The summary made the correct aggregation *impossible* (no buckets to merge), and the `avg()` made the wrong number *plausible*. The fix was a migration to histograms and the query above — and a lint rule banning `avg(...{quantile=...})` in dashboards. **The metric type, chosen in code months earlier, made the dashboard unfixable until the code changed.**

### Quick reference: legal vs illegal percentile operations

| You wrote | Legal? | Correct alternative |
|---|---|---|
| `avg(p99_per_instance)` | ❌ | `histogram_quantile(0.99, sum by (le)(rate(..._bucket[5m])))` |
| `max(p99_per_instance)` | ❌ (it's a different question) | Aggregate buckets, then quantile |
| `sum(rate(..._bucket[5m]))` then quantile | ✅ | This is the right way |
| `histogram_quantile(0.99, rate(..._bucket[5m]))` *per series* then `avg` | ❌ | Aggregate buckets *before* the quantile |

---

## Summaries vs Histograms — The Real Trade-off

Middle level said "prefer histograms." Senior level says *why*, and *when a summary is actually correct*.

| | **Histogram** | **Summary** |
|---|---|---|
| Quantiles computed | **At query time**, from buckets | **At emit time**, in-process |
| Aggregatable across instances | **Yes** (sum buckets) | **No** — fundamental limitation |
| Bucket design needed | Yes (classic) / no (native) | No |
| CPU cost in-process | Cheap (increment a counter) | Higher (maintains a streaming quantile sketch) |
| Quantile accuracy | Interpolated; depends on buckets | Exact for the configured φ, *for that instance only* |
| Choose the quantile later | **Yes** — any quantile from the buckets | **No** — only the φ's you pre-declared |
| Right when… | Almost always; anything aggregated | Single-instance, fixed quantile, can't pre-pick buckets |

The summary's *only* genuine advantage: it gives an **exact** quantile for a single process without you choosing buckets. The instant you have more than one replica — i.e. always, in production — that advantage evaporates because you can't combine them. And you can't ask a summary for p95 if you only configured p50/p99: the quantiles are baked in at emit time.

> **Senior rule:** Summaries are for single-process tools and the rare case where you truly need an exact per-instance quantile and will never aggregate. For services, histograms (native where possible). If your codebase standardized on summaries for latency, that's technical debt with a migration cost — flag it.

```python
# Python prometheus_client: Summary configured with quantiles is the trap.
# This is NOT aggregatable — avoid for multi-replica services.
from prometheus_client import Summary, Histogram

# ❌ per-instance quantiles, cannot be merged across pods:
LAT_SUMMARY = Summary("rpc_latency_seconds", "RPC latency")  # ._sum/._count only by default

# ✅ histogram with SLO-aligned buckets, aggregatable:
LAT_HIST = Histogram(
    "rpc_latency_seconds", "RPC latency",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)
```

---

## Pull vs Push as an Architecture Decision

Middle level gave the rule of thumb (long-lived → pull, ephemeral → push). Senior level treats it as a system-design choice with consequences across discovery, liveness, security, and cardinality control.

| Dimension | **Pull (Prometheus scrape)** | **Push (StatsD / OTLP / Pushgateway)** |
|---|---|---|
| Liveness detection | **Free** — a failed scrape *is* `up == 0` | Needs a separate heartbeat metric |
| Service discovery | Centralized in the scraper (k8s SD, Consul, files) | Each sender must know the collector address |
| Ephemeral jobs (cron, Lambda) | **Bad** — job dies before the scrape | **Good** — fire-and-exit |
| Firewalled / NAT'd targets | Hard — scraper must reach the target | Easier — target dials out |
| Backpressure / overload | Scraper controls the rate | Sender can flood the collector |
| Cardinality control point | At scrape (`metric_relabel_configs`) — central | At the sender or collector pipeline |
| Staleness semantics | Built-in (missed scrape → stale) | You must model it |
| Multi-tenant isolation | Scraper-side limits per target | Collector-side limits per source |

### The senior nuances

- **"Free liveness" is the underrated win of pull.** With push, a service that crashes simply *stops sending*, and absence-of-data is ambiguous (crashed? network? deploy?). With pull, `up == 0` is unambiguous and instantly alertable. Teams that go all-in on push routinely rebuild this with heartbeats and dead-man's-switch alerts.
- **OTLP push to a collector is the modern hybrid.** The OpenTelemetry Collector receives pushes, then *can be scraped by Prometheus* (or remote-writes onward). This decouples the app's transport choice from the backend's, and centralizes cardinality control in the collector pipeline — the best of both for heterogeneous fleets. (Architecture detail: [`professional.md`](professional.md).)
- **Pushgateway is a footgun.** It exists for batch jobs to push a final result before exiting. It is **not** a general push proxy. Its classic abuse: pointing many service instances at it, which (a) collapses their identity (last write wins or stale series linger), and (b) makes the gateway a single point of failure with no liveness semantics. Use it *only* for ephemeral batch jobs, and `DELETE` the group when the job is decommissioned.

```go
// Pushgateway — CORRECT use: a batch job pushes its result, then exits.
import "github.com/prometheus/client_golang/prometheus/push"

func reportBatchResult(processed float64, success bool) error {
    g := prometheus.NewGauge(prometheus.GaugeOpts{
        Name: "batch_records_processed_total",
        Help: "Records processed by the nightly job.",
    })
    g.Set(processed)
    pusher := push.New("http://pushgw:9091", "nightly_etl").
        Grouping("instance", os.Getenv("HOSTNAME")). // bounded grouping key
        Collector(g)
    // Push once at the end of the job. Do NOT run this in a long-lived loop.
    return pusher.Push()
}
```

---

## Cardinality Budgets You Enforce

Middle level taught you to *estimate* cardinality before adding a label. Senior level is about **enforcement** — turning "please be careful" into limits the system upholds even when someone isn't.

### The three lines of defense

```text
1. IN-CODE         → cap label values at the instrumentation site (allow-lists, .Unknown)
2. CLIENT-SIDE     → Micrometer MeterFilter / OTel views — refuse/aggregate excess tags
3. SCRAPE/PIPELINE → metric_relabel_configs drop, OTel attribute limits, backend per-tenant caps
   + ALERT on prometheus_tsdb_head_series so the next bomb pages you, not OOMs you.
```

You want the failure to happen at line 1 (a label collapses to `"other"`), not line 3 (the TSDB OOMs). But you put *all three* in place, because the team member who adds `user_id` next quarter won't read this page.

### Set an actual number

A cardinality budget is a real figure: *"the `checkout` service may emit at most 50,000 active series."* Derive it from capacity: a Prometheus head holds roughly a few million active series per ~comfortable GB of RAM; divide across services. Then:

- Alert when a service crosses, say, 80% of its budget.
- Alert on *per-metric* series count (`count by (__name__)(...)`), so one runaway metric is caught before it consumes the whole budget.
- Alert on **churn** (`rate(prometheus_tsdb_head_series_created_total[1h])`) — high churn (pod autoscaling baking `pod`/`instance` into series) inflates index even at flat active-series.

### Micrometer — a hard cap as code

```java
import io.micrometer.core.instrument.*;
import io.micrometer.core.instrument.config.MeterFilter;

// Defense line 2: cap tag cardinality at the registry, fleet-wide.
registry.config()
    // Any meter exceeding 100 distinct tag combos → excess collapse to a single series.
    .meterFilter(MeterFilter.maximumAllowableTags(
        "http.server.requests", "uri", 100, MeterFilter.deny()))
    // Or globally cap total meters to fail loud instead of OOM:
    .meterFilter(MeterFilter.maximumAllowableMetrics(10_000));
```

`maximumAllowableTags` with `deny()` stops new high-cardinality values from minting series once the cap is hit — turning a silent cardinality bomb into a bounded, observable degradation. This is the safety net `middle.md` promised.

### OpenTelemetry — drop/limit attributes in a View

```go
// OTel Go: a View that strips a high-cardinality attribute from one instrument.
import (
    "go.opentelemetry.io/otel/sdk/metric"
    "go.opentelemetry.io/otel/attribute"
)

provider := metric.NewMeterProvider(
    metric.WithView(metric.NewView(
        metric.Instrument{Name: "http.server.duration"},
        metric.Stream{
            // Keep only bounded attributes; user_id / request_id never become series.
            AllowAttributeKeys: attribute.NewSet(
                attribute.String("http.method", ""),
                attribute.String("http.route", ""),
                attribute.String("http.status_class", ""),
            ).Filter(func(attribute.KeyValue) bool { return true }),
        },
    )),
)
```

A View is the OTel control point: it can rename, drop, or re-bucket an instrument's attributes *in the SDK*, before they ever reach the exporter. It's where you enforce "this attribute is allowed on this metric, that one isn't," centrally.

---

## What NOT to Measure

The most under-taught senior skill. Every metric has a recurring cost (series, RAM, scrape time, dashboard clutter, cognitive load) and most provide near-zero value. Subtraction is a contribution.

### The categories to *not* emit

| Don't measure | Why | What to do instead |
|---|---|---|
| **Things you'll never alert on or query** | Pure cost, zero signal. The "we might need it someday" metric. | Delete it. Add it back in 5 minutes if you ever do need it. |
| **Anything derivable from existing metrics** | `success_total` when you have `requests_total` and `errors_total` — `success = requests − errors`. Redundant series. | Compute at query time. |
| **High-resolution metrics for low-stakes paths** | A 15-bucket histogram on a health-check endpoint. | A counter, or nothing. |
| **Per-row / per-item business events** | `order_total{order_id=...}`, `email_sent{recipient=...}` — these are *events*, not metrics. | Logs / wide events / warehouse. |
| **Internal implementation counters nobody owns** | `internal_queue_loop_iterations_total` — meaningful only to the author, for one debugging session. | A temporary debug build, or a trace. |
| **Vanity gauges** | `total_users_registered` recomputed every scrape via a DB count. | Query the DB on demand; don't poll it into a gauge. |
| **Duplicates of platform metrics** | Re-emitting CPU/memory the runtime/node-exporter already gives you. | Use the existing ones. |

### The test for "should this be a metric?"

Ask, in order:

1. **Will I alert on it, or put it on a dashboard a human watches?** If neither — it's not a metric.
2. **Is it bounded?** If the value set grows with users/requests — it's a log/trace, not a metric.
3. **Can I derive it from something I already emit?** If yes — derive it; don't store it.
4. **Does the resolution match the stakes?** A health check doesn't need a 12-bucket histogram.

> The aggregate insight: **a metrics system's health is measured partly by what it *doesn't* contain.** A fleet with 400 carefully chosen metrics is more debuggable than one with 4,000 mostly-unqueried ones — the signal isn't buried, the bill is lower, and the next on-call can actually read the dashboard. Periodic "metric garbage collection" (find names with zero queries in the last 90 days, propose deletion) is senior maintenance work.

---

## Counter Resets, Rate, and the increase() Trap

A counter only ever goes up — *within a process lifetime*. On restart it goes back to zero. `rate()` and `increase()` are explicitly designed to handle this: when they see the value drop, they assume a reset and account for it. This is why you must respect the counter idiom in code, or you defeat that logic.

### The emit-side rules that keep `rate()` correct

| Rule | Violation symptom |
|---|---|
| **Never `Set()` a counter, only `Inc()`/`Add(positive)`.** | A `Set()` that lowers the value looks like a reset → `rate()` invents a huge spurious increase. |
| **Never reuse a counter for a value that can decrease.** | That's a gauge. A counter that goes down corrupts every `rate()` over it. |
| **Don't recreate the counter object per request.** | A fresh counter starts at 0 each time → constant phantom resets, `rate()` ≈ 0. |
| **Keep `_total` suffix and counter type aligned.** | Tooling and `rate()` assume monotonicity from the type. |

### The `increase()` extrapolation trap

`increase()` and `rate()` **extrapolate to the edges of the range window**, and they interpolate across gaps. Two consequences seniors must know:

- `increase(counter[1m])` can return a **fractional or non-integer** value (e.g. `0.97`) even for an integer counter, because of edge extrapolation. Don't be alarmed; don't `==`-compare it to an integer.
- A counter that increments rarely (a few times an hour) measured with a short window can read **zero or wildly extrapolated** values. For rare events, widen the window or alert on the raw counter, not its rate.

```go
// A correct counter: one object, only Inc/Add(positive), lives for the process.
var ordersFailed = promauto.NewCounterVec(prometheus.CounterOpts{
    Name: "orders_failed_total",
    Help: "Orders that failed, by reason class.",
}, []string{"reason"}) // bounded reason classes

func onFailure(reason string) {
    ordersFailed.WithLabelValues(classify(reason)).Inc() // never Set, never recreate
}
```

---

## Aggregation Temporality — Cumulative vs Delta

A senior who emits OpenTelemetry metrics must understand **aggregation temporality**, because it changes what the emitted number *means* and which backends accept it.

| | **Cumulative** | **Delta** |
|---|---|---|
| A counter reports | running total since start | the increase since the last export |
| Restart handling | reader sees the reset (like Prometheus) | each export is self-contained |
| Natural for | Prometheus, long-lived processes | StatsD-style, serverless / FaaS, short-lived |
| Backend fit | Prometheus/Mimir want cumulative | Many SaaS (Datadog) prefer delta |
| Risk | none beyond reset handling | **lost export = lost data permanently** (no running total to recover from) |

The trap: a serverless function that exports **cumulative** counters is wrong, because each invocation is a fresh process starting at zero — the "running total" is meaningless across invocations. FaaS wants **delta**. Conversely, sending **delta** to a Prometheus-style backend that expects cumulative gives garbage. OTel lets you set the temporality per exporter; **match it to the backend and the process lifetime.**

```python
# OTel Python: pick delta temporality for an ephemeral/serverless exporter.
from opentelemetry.sdk.metrics.export import (
    PeriodicExportingMetricReader, AggregationTemporality,
)
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.metrics import Counter

exporter = OTLPMetricExporter(
    # Delta for counters: each export stands alone — correct for FaaS.
    preferred_temporality={Counter: AggregationTemporality.DELTA},
)
reader = PeriodicExportingMetricReader(exporter, export_interval_millis=5000)
```

---

## Code Examples

### Go — SLO-aligned classic histogram + native option

```go
package metrics

import (
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

// SLOs: p50 < 50ms, p99 < 300ms, timeout 2s.
// Bucket EDGES sit exactly on the SLO thresholds so alerts read there, not interpolate.
var checkoutLatency = promauto.NewHistogramVec(prometheus.HistogramOpts{
    Name: "checkout_duration_seconds",
    Help: "Checkout latency. Buckets aligned to SLO thresholds.",
    Buckets: []float64{
        0.005, 0.01, 0.025,
        0.05, // ← p50 SLO edge
        0.075, 0.1, 0.15, 0.2,
        0.3, // ← p99 SLO edge
        0.5, 1, 2, // ← top finite bucket at the 2s timeout
    },
    // Opt into native histograms too (Prometheus ≥2.40, scrape must enable it):
    NativeHistogramBucketFactor:    1.1,
    NativeHistogramMaxBucketNumber: 160,
}, []string{"method", "route", "status_class"})

func ObserveCheckout(method, route, statusClass string, d time.Duration) {
    checkoutLatency.WithLabelValues(method, route, statusClass).Observe(d.Seconds())
}
```

The query side then reads `histogram_quantile(0.99, sum by (le)(rate(checkout_duration_seconds_bucket{route="/checkout"}[5m])))` — aggregating buckets *before* the quantile, the only correct way.

### Java — Micrometer with explicit SLO buckets and a tag cap

```java
import io.micrometer.core.instrument.*;
import io.micrometer.core.instrument.config.MeterFilter;
import java.time.Duration;

public class CheckoutMetrics {
    private final Timer.Builder base;

    public CheckoutMetrics(MeterRegistry registry) {
        // Cardinality budget enforcement at the registry (defense line 2).
        registry.config().meterFilter(
            MeterFilter.maximumAllowableTags("checkout.duration", "route", 50, MeterFilter.deny()));

        this.base = Timer.builder("checkout.duration")
            // SLO histogram: emit buckets, aggregatable across instances.
            .publishPercentileHistogram()
            // Service Level Objective boundaries → exact buckets at these points:
            .serviceLevelObjectives(
                Duration.ofMillis(50),   // p50 SLO
                Duration.ofMillis(300),  // p99 SLO
                Duration.ofSeconds(2))   // timeout
            // Do NOT use .publishPercentiles(...) here — those are client-side,
            // non-aggregatable summaries. Histogram buckets aggregate; percentiles don't.
            .minimumExpectedValue(Duration.ofMillis(1))
            .maximumExpectedValue(Duration.ofSeconds(2));
    }

    public void record(String method, String route, String statusClass, Duration d) {
        base.tags("method", method, "route", route, "status_class", statusClass)
            .register(registryOf()).record(d);
    }
    private MeterRegistry registryOf() { /* injected */ return null; }
}
```

The Micrometer subtlety worth stating outright: `publishPercentiles(0.99)` emits a **client-side, non-aggregatable** `quantile` series — the summary trap. `publishPercentileHistogram()` + `serviceLevelObjectives(...)` emits **buckets**, which Prometheus aggregates correctly. Prefer the latter for anything multi-instance.

### Python — histogram with deliberate buckets, derived metric avoidance

```python
from prometheus_client import Histogram, Counter

# One histogram, SLO-aligned buckets. No separate "success_total" — derive it.
REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "Request latency by route.",
    ["method", "route", "status_class"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.0),
)
# requests_total comes from the histogram's _count — don't emit a second counter for it.
# errors = sum(rate(..._count{status_class="5xx"})) ; success = total - errors  (at query time)

def observe(method: str, route: str, status: int, seconds: float) -> None:
    cls = f"{status // 100}xx"          # bounded
    REQUEST_DURATION.labels(method, route, cls).observe(seconds)
```

### Node — prom-client buckets sized to the actual distribution

```js
const client = require("prom-client");

// A cache-lookup service answering in MICROSECONDS. DefBuckets would be useless
// (everything ≤5ms). Buckets must live where THIS service's latency lives.
const lookupDuration = new client.Histogram({
  name: "cache_lookup_duration_seconds",
  help: "Cache lookup latency (sub-millisecond service).",
  labelNames: ["shard", "result"], // result: hit | miss  (bounded)
  buckets: [
    0.00005, 0.0001, 0.00025, 0.0005, // 50µs..500µs — where p50/p90 live
    0.001, 0.0025, 0.005, 0.01,       // 1ms..10ms — the tail
  ],
});

function observeLookup(shard, hit, seconds) {
  lookupDuration.labels(shard, hit ? "hit" : "miss").observe(seconds);
}
module.exports = { observeLookup };
```

The point this example makes: **the same `DefBuckets` is wrong in two opposite directions** depending on the service. A microsecond service needs microsecond buckets; a transcode service needs buckets up to minutes. Bucket design is per-service, decided by the distribution.

### Rust — `metrics` histogram with fixed boundaries via a recorder

```rust
use metrics::{histogram, counter};
use metrics_exporter_prometheus::{PrometheusBuilder, Matcher};
use std::time::Instant;

fn install_recorder() {
    // Set bucket boundaries at the recorder for one metric family.
    // SLO-aligned: edges at 50ms and 300ms.
    let builder = PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full("http_request_duration_seconds".into()),
            &[0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.0],
        )
        .expect("valid buckets");
    builder.install().expect("install prometheus recorder");
}

fn record(method: &str, route: &'static str, status: u16, started: Instant) {
    let class = format!("{}xx", status / 100); // bounded
    histogram!("http_request_duration_seconds",
        "method" => method.to_string(),
        "route" => route,
        "status_class" => class.clone()
    ).record(started.elapsed().as_secs_f64());
    counter!("http_requests_total",
        "method" => method.to_string(),
        "route" => route,
        "status_class" => class
    ).increment(1);
}
```

In the `metrics` crate, the *histogram type is a summary-like distribution by default*; `set_buckets_for_metric` on the Prometheus exporter is what turns it into an **aggregatable bucketed histogram** in the exposition. Without it, you get exporter-side quantiles that don't aggregate — the Rust version of the summary trap.

### OpenTelemetry Go — exponential histogram via aggregation selector

```go
import (
    "go.opentelemetry.io/otel/sdk/metric"
)

// Make duration instruments use base-2 exponential (native) histograms,
// so you NEVER hand-design buckets and series cost stays ~1 per label combo.
provider := metric.NewMeterProvider(
    metric.WithReader(metric.NewPeriodicReader(exporter)),
    metric.WithView(metric.NewView(
        metric.Instrument{Kind: metric.InstrumentKindHistogram},
        metric.Stream{
            Aggregation: metric.AggregationBase2ExponentialHistogram{
                MaxSize:  160, // cap buckets → cap memory/series payload
                MaxScale: 20,
            },
        },
    )),
)
```

---

## Worked Example — A Histogram That Lied

**Symptom:** A search service's dashboard shows p99 latency steady at **45ms**. The SLO is "p99 < 50ms," so the panel is green and nobody worries. Meanwhile, customer support reports a steady trickle of "search took forever" complaints, and the load balancer's own latency metric shows p99 nearer **600ms**.

**Two metrics for the same thing disagree by 13×. One of them is lying. Which?**

**Step 1 — inspect the buckets.** Pull the raw exposition:

```bash
curl -s localhost:9090/metrics | grep search_duration_seconds_bucket
# search_duration_seconds_bucket{le="0.005"} 9100
# search_duration_seconds_bucket{le="0.01"}  9700
# search_duration_seconds_bucket{le="0.025"} 9950
# search_duration_seconds_bucket{le="0.05"}  9980
# search_duration_seconds_bucket{le="+Inf"}  10000
```

**There it is.** The bucket boundaries are `{0.005, 0.01, 0.025, 0.05, +Inf}`. The *highest finite bucket is 50ms*. Everything slower than 50ms — the entire tail the customers are feeling — falls into `+Inf` and is **invisible to interpolation**.

**Step 2 — why p99 reads 45ms.** `histogram_quantile(0.99, ...)` needs the value below which 99% (9,900) of 10,000 observations fall. From the buckets, 9,980 are `≤ 50ms` and 9,950 are `≤ 25ms`. The 9,900th observation lands in `(0.025, 0.05]`, so the algorithm **interpolates inside that last finite bucket** and returns ~45ms. It *cannot* return anything above 50ms — there is no finite bucket up there. The histogram is structurally incapable of reporting the real tail. **The green dashboard is an artifact of the bucket ceiling, not the truth.**

**Step 3 — confirm the tail.** The `_sum` and `_count` give the *mean*:

```bash
# search_duration_seconds_sum   1180.0
# search_duration_seconds_count 10000
# mean = 1180/10000 = 0.118s = 118ms
```

A 118ms **mean** with a claimed 45ms p99 is impossible for a non-negative distribution unless there's a heavy tail above the bucket ceiling. The mean alone falsifies the dashboard. (This is a great senior cross-check: if `mean ≫ reported p99`, your buckets are truncating the tail.)

**Step 4 — the fix (in code, not the query).** Add finite buckets above the SLO and well into the tail:

```go
Buckets: []float64{
    0.005, 0.01, 0.025,
    0.05,  // SLO edge — keep it
    0.1, 0.25, 0.5, 1, 2.5, 5, // ← the tail that was hiding in +Inf
},
```

After the deploy, `histogram_quantile(0.99, ...)` reads **610ms**, matching the load balancer. The panel goes red, the SLO breach is now visible, and the real work (the actual latency bug) can begin.

**Lessons:**

1. **A histogram can only report what its buckets resolve.** A too-low ceiling makes the tail *structurally invisible* and produces a confidently wrong, low percentile.
2. **`_sum/_count` (the mean) is a free sanity check** against a truncated histogram. `mean ≫ p99` ⇒ truncation.
3. **Cross-check independent measurements** (your histogram vs the LB's). When two metrics for one quantity disagree, *don't pick the comforting one*.
4. The bug lived in the **instrumentation**, fixed by changing **emit-time bucket boundaries** — exactly the senior-level, write-time decision this page is about.

---

## Pros & Cons

| Choice | Pros | Cons |
|---|---|---|
| **Classic histogram** | Universal support; exact named SLO-edge buckets | Manual bucket design; series-per-bucket cost; truncation risk |
| **Native/exponential histogram** | No bucket design; ~1 series; uniform accuracy | Newer; needs end-to-end support; less explicit SLO edges |
| **Summary** | Exact per-instance quantile, no buckets | **Not aggregatable**; quantiles fixed at emit time; higher CPU |
| **Pull** | Free liveness; central discovery & cardinality control | Bad for ephemeral/firewalled; scraper must reach targets |
| **Push (OTLP/StatsD)** | Ephemeral & firewalled friendly; FaaS-native | No free liveness; sender can flood; discovery on the sender |
| **Cumulative temporality** | Prometheus-native; reset-resilient | Meaningless for per-invocation FaaS |
| **Delta temporality** | Correct for serverless; self-contained exports | A lost export is lost forever; needs delta-aware backend |
| **More metrics** | More potential visibility | Recurring cost; clutter; unqueried noise |
| **Fewer, chosen metrics** | Cheap; readable; signal not buried | Requires discipline to decide what to cut |

---

## Use Cases

- **"Is p99 latency truly under SLO across the whole fleet?"** → histogram with an `le` edge at the SLO, `histogram_quantile(0.99, sum by (le)(rate(..._bucket[5m])))`. Never `avg(p99_per_pod)`.
- **"Our service answers in microseconds and every percentile reads the same."** → wrong buckets; resize to where the distribution lives (or go native histogram).
- **"We have 30 pods and the dashboard p99 looks too good."** → you're averaging summaries; migrate to histograms and aggregate buckets first.
- **"A Lambda's counters are nonsense."** → cumulative temporality on an ephemeral process; switch to delta.
- **"Prometheus RAM is climbing for no obvious reason."** → check `prometheus_tsdb_head_series` and churn; a label is leaking (often `pod`/`instance` under autoscaling).
- **"We have 4,000 metrics and nobody can find anything."** → metric GC: find zero-query names, propose deletion. Subtraction is the fix.
- **"A batch job's final result needs to be in Prometheus."** → Pushgateway, pushed once at job end, group deleted on decommission.

---

## Coding Patterns

### Pattern 1 — Put a bucket edge on every SLO threshold

```go
// SLO: p99 < 300ms. There MUST be an le="0.3" bucket or the alert interpolates.
Buckets: []float64{0.05, 0.1, 0.15, 0.2, 0.3 /* ← SLO */, 0.5, 1, 2},
```

### Pattern 2 — Aggregate buckets before the quantile (the only correct fleet p99)

```promql
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
# NOT: avg(histogram_quantile(0.99, rate(..._bucket[5m])))  ← wrong, averages percentiles
```

### Pattern 3 — Derive, don't double-emit

```text
have: http_requests_total, errors via status_class. 
DON'T emit http_success_total — compute success = total − errors at query time.
have: histogram → its _count IS your request count. DON'T add a parallel counter.
```

### Pattern 4 — Counter idiom: one object, Inc only

```go
var c = promauto.NewCounter(...) // created ONCE, package-level
c.Inc()                          // never Set, never Add(negative), never recreate per call
```

### Pattern 5 — Match aggregation temporality to process lifetime

```text
long-lived service  → cumulative (Prometheus-native)
serverless / FaaS   → delta (each invocation self-contained; cumulative is meaningless)
```

### Pattern 6 — Enforce the cardinality budget in code, not in a wiki

```java
registry.config().meterFilter(
    MeterFilter.maximumAllowableTags("http.server.requests", "uri", 100, MeterFilter.deny()));
// The bomb degrades to "other" series instead of OOMing the TSDB.
```

---

## Clean Code

- **Every histogram's buckets are justified by the SLO and the distribution.** A comment stating the SLO sits next to the `Buckets` literal. No copy-pasted `DefBuckets` on a microsecond or multi-minute service.
- **An `le` edge exists at every SLO threshold** the metric is alerted on.
- **Latency is a histogram, never a summary,** for any multi-instance service. Summaries are flagged as debt.
- **Counters use `Inc`/`Add(positive)` only**, are created once, and never `Set()`.
- **No metric is emitted that's derivable** from existing ones (`success = total − errors`).
- **Every label value from an external source passes an allow-list** before becoming a label; overflow → `"other"`.
- **Aggregation temporality is explicit** and matches the process lifetime and backend.
- **A per-service cardinality budget is documented and enforced** (filter + alert), not aspirational.

---

## Best Practices

1. **Design buckets around your SLOs and your actual distribution.** Edge at every SLO threshold; finite top bucket above your timeout; ~8–15 buckets; geometric spacing for heavy tails. Sanity-check with `_sum/_count`.
2. **Prefer native/exponential histograms for new latency work** where the whole pipeline supports them — no bucket design, ~10× fewer series, uniform accuracy.
3. **Never average, sum, or max precomputed percentiles.** Aggregate *buckets*, then compute the quantile. Lint dashboards for `avg(...{quantile=...})`.
4. **Use histograms, not summaries, for anything aggregated** — i.e. anything in a service with more than one replica.
5. **Choose pull vs push deliberately:** pull for long-lived (free liveness), push/OTLP for ephemeral and firewalled, Pushgateway *only* for batch jobs that exit.
6. **Set a numeric cardinality budget per service and enforce it** at three layers (code allow-lists, client filters/views, scrape relabel) plus an alert on `prometheus_tsdb_head_series` and churn.
7. **Match aggregation temporality to lifetime:** cumulative for long-lived, delta for serverless.
8. **Practice subtraction.** Quarterly, find metrics with zero queries in 90 days and delete them. A wrong or unused metric is a liability.
9. **Respect the counter idiom** so `rate()`/`increase()` stay correct: `Inc` only, one object, never `Set`.
10. **Cross-check independent measurements** of the same quantity (your histogram vs the LB's, the app's vs the proxy's). Disagreement means one is lying — investigate, don't pick the comfortable one.

---

## Edge Cases & Pitfalls

- **`+Inf` ceiling truncation.** The highest finite bucket below your real tail makes the tail invisible; the reported high-percentile is capped at that ceiling and reads falsely low. (The worked example.)
- **All percentiles collapse to one value.** Every observation lands in the same coarse bucket → p50 = p90 = p99 = the bucket edge. Your buckets don't match the distribution.
- **`histogram_quantile` returns `NaN`.** Empty buckets in the window, or no `+Inf` bucket. Confirm the metric is actually being observed and the scrape captured `le="+Inf"`.
- **Native histogram disabled at scrape.** The client emits native histograms but Prometheus's `scrape_classic_histograms`/feature flag isn't set → the data is dropped. End-to-end support means *every* link, including scrape config.
- **Counter `Set()` looks like a reset.** A monitoring library that lets you `Set` a counter will produce a giant spurious `rate()` spike. Use a gauge if it can go down.
- **`rate()` of a rare counter over a short window** reads zero or wildly extrapolated. Widen the window or alert on the raw counter for low-frequency events.
- **Delta-to-cumulative mismatch.** OTel delta counters sent to a cumulative-expecting backend (or vice versa) produce garbage. Set temporality per exporter.
- **Pushgateway stale series.** A decommissioned job's pushed series linger forever (the gateway never expires them). `DELETE` the group, or you alert on a metric from a job that no longer exists.
- **Histogram `_sum` overflow / negative observations.** Observing negative durations (clock going backwards, `time.Since` on a wrong start) corrupts `_sum` and breaks the mean. Guard against negative observations.
- **Churn-driven cardinality.** Active series flat, but `pod`/`instance` churn from autoscaling balloons the index. Watch `prometheus_tsdb_head_series_created_total`, not just the current count.

---

## Common Mistakes

1. **Averaging percentiles across instances** (`avg(p99)`), producing a number that's wrong by orders of magnitude and looks reassuring.
2. **Using a summary for service latency**, making correct fleet aggregation *impossible* by construction.
3. **Copy-pasting `DefBuckets`** onto a microsecond or multi-minute service, so every percentile is meaningless.
4. **No bucket edge at the SLO threshold**, so the SLO alert interpolates across a wide bucket and fires (or doesn't) on a guess.
5. **Truncating the tail with too low a `+Inf`-adjacent ceiling**, hiding the exact slow requests customers feel.
6. **Cumulative temporality on serverless**, where each invocation is a fresh zero-start process.
7. **`Set()`-ing a counter** or recreating it per request, corrupting every `rate()` over it.
8. **Emitting derivable metrics** (`success_total`) and parallel request counters when the histogram's `_count` already has it.
9. **Treating cardinality as a guideline, not a budget** — no limits, no alert, first sign is the OOM.
10. **Never deleting metrics.** Thousands of unqueried series rot the dashboard and the bill, and nobody owns the cleanup.

---

## Tricky Points

- **`histogram_quantile` accuracy is bounded by bucket width, not by sample count.** A billion samples in a too-wide bucket still give you a fuzzy percentile. More traffic doesn't fix bad buckets.
- **Native histograms are aggregatable *and* high-resolution** — they're not a compromise between the two; they beat classic histograms on both axes where supported. The only cost is ecosystem maturity.
- **A histogram already carries the count and the sum.** `_count` is your request counter and `_bucket{le="+Inf"}` equals it; `_sum/_count` is the mean. Re-emitting any of these is pure waste.
- **"Aggregatable" and "exact" are in tension.** Summaries are exact-per-instance but not aggregatable; histograms are aggregatable but interpolated. For fleets you almost always want aggregatable, so you accept interpolation and design buckets to make it tight.
- **Pull's free liveness is a *correctness* property, not just convenience.** Absence-of-data in a push system is genuinely ambiguous; `up == 0` in pull is not. Teams underestimate how much they rely on this until they go push-only.
- **Delta temporality has no recovery from a lost export.** Cumulative can survive a dropped export (the next one carries the running total); delta cannot — the increment is simply gone. Weigh this for unreliable networks.
- **The cheapest cardinality control is at emit time, the most reliable is at the pipeline.** You want both: the code prevents the obvious bomb, the pipeline catches what the code missed.
- **A metric's *resolution* is a cost lever.** A 30-bucket histogram isn't "more accurate," it's "more expensive"; match bucket count to how much the precision actually matters.

---

## Test Yourself

1. Your SLO is "p99 < 200ms." You inherit a histogram with buckets `{0.05, 0.1, 0.5, 1}`. Why can't this dashboard tell you whether you're meeting the SLO, and what's the minimal fix?
2. Two pods each report `quantile{quantile="0.99"} = 20ms` from a summary. Your dashboard shows `avg = 20ms`. Construct a request distribution where the true fleet p99 is 10× that. Then explain why no query over these summaries can recover the truth.
3. Write the correct PromQL for fleet-wide p99 latency from a histogram, and explain what each part does and why the order (`sum by (le)` before `histogram_quantile`) is mandatory.
4. A 200ms Lambda exports a cumulative request counter via OTLP. The dashboard rate is nonsense. Diagnose and fix in one sentence (name the concept).
5. A service answers in 20–80µs. Someone instrumented it with `DefBuckets`. What does every percentile read, and how do you fix it two different ways (classic and native)?
6. Your Prometheus RAM is climbing 2GB/day with flat traffic. List the queries (against Prometheus's own metrics) you'd run, in order, to find the cause.
7. Give three examples of metrics you should *delete*, with the reasoning for each.
8. Why does observing a counter with `Set()` produce a giant spurious `rate()` spike? Walk through what `rate()` does when it sees the value drop.

---

## Tricky Questions

**Q1: My native histogram gives accurate quantiles with no bucket design. Why would I ever use a classic histogram again?**

A: Three reasons. (a) **Support gaps** — if any link (client lib, scrape config, TSDB, Grafana, the SaaS backend) doesn't speak native histograms end to end, the data is dropped or unusable; classic works everywhere. (b) **Explicit SLO-edge buckets** — some teams alert directly on `..._bucket{le="0.3"}` for an exact SLO threshold; native histograms' boundaries are exponential and won't land exactly on 0.3. (c) **Stability/audit requirements** where you want fixed, named, unchanging boundaries. For greenfield on a modern stack, native; otherwise classic.

**Q2: Can I just compute p99 per pod with a recording rule and then take the max across pods for a "fleet p99"?**

A: No — `max(p99_per_pod)` answers "what's the worst single pod's p99," not "what's the fleet's p99." They're different questions and the max is usually *higher* than the true fleet p99 (one bad pod dominates) but can also be *lower* (if the slow requests are spread across pods). The only correct fleet p99 aggregates the **buckets** first: `histogram_quantile(0.99, sum by (le)(rate(..._bucket[5m])))`. Per-pod-then-combine is wrong for *any* combining function.

**Q3: We're all-in on push (OTLP to a collector). What did we give up versus pull, and how do we get it back?**

A: You gave up **free liveness** — with pull, a missed scrape is `up == 0`, an instant unambiguous "it's down." With push, a crashed service just stops sending, and absence is ambiguous (crash? network? deploy? scaled to zero?). Get it back with an explicit **heartbeat** metric per instance plus a **dead-man's-switch** alert (`absent_over_time(heartbeat[5m])` or your backend's equivalent). You also moved cardinality control and discovery to the sender/collector — fine, but now the collector pipeline is where you enforce limits.

**Q4: My `increase(orders_total[1h])` returns 4023.7. How can an integer counter increase by a fraction?**

A: `increase()` (and `rate()`) **extrapolate** to the exact edges of the range window because samples rarely land precisely on the boundaries. The result is an estimate, so non-integer values are normal and expected. Don't `==`-compare it to an integer or treat the fraction as data loss. If you need an exact integer count over a precise window, that's a different (harder) question — usually you query the raw counter delta at known scrape points.

**Q5: A teammate wants to add an `endpoint` label to a metric that already has `method` (5), `status_class` (5), and the histogram has 12 buckets. There are 80 endpoints. Is it safe?**

A: Do the arithmetic: `5 × 5 × 12 × 80 = 24,000` series for one histogram — *probably* fine if it's one metric, but check it against the service's cardinality budget and confirm `endpoint` is the **route template** (80 bounded values), not the concrete path (unbounded → bomb). Also confirm 80 won't grow with new routes faster than the budget allows. "Safe" is a budget question, not a yes/no — and the answer is "yes, if it fits the budget and the value set is genuinely bounded."

**Q6: We have a summary in a single-process CLI tool that reports an exact p99. Should I migrate it to a histogram on principle?**

A: No. The summary's one real advantage — exact per-instance quantile with no bucket design — applies precisely here: single process, no aggregation, no fleet. Migrating buys you nothing and costs you bucket design. The "always use histograms" rule is about *aggregation*; with one instance there's nothing to aggregate. Keep the summary. (But the moment that tool becomes a multi-replica service, revisit.)

**Q7: Our dashboard p99 (from our histogram) reads 40ms; the load balancer's p99 reads 500ms. Who's right?**

A: Suspect *your* histogram first, because the most common cause is a truncated bucket ceiling (your top finite bucket is below the real tail, dumping it into `+Inf` and capping the interpolated quantile). Verify with `_sum/_count`: if the **mean** is well above your reported p99, your buckets are truncating the tail and the LB is right. The LB measures the full request including time your in-handler histogram may not cover (queueing, body read/write), so it can also be *legitimately* higher — but truncation is the usual culprit, and it's a code fix (add finite buckets into the tail).

**Q8: Is it ever correct to alert directly on a raw histogram bucket instead of a computed quantile?**

A: Yes, and it's often *better*. `sum(rate(..._bucket{le="0.3"}[5m])) / sum(rate(..._count[5m]))` gives you "fraction of requests faster than 300ms" — a direct SLO measurement with no interpolation, exact at the bucket edge. Alerting on the *ratio of requests within the SLO bucket* is more robust than alerting on an interpolated `histogram_quantile`, because it reads a real counted boundary, not an estimate inside a bucket. This is why putting an `le` edge exactly at the SLO threshold matters so much.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║                       METRICS — SENIOR CHEAT SHEET                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  HISTOGRAM BUCKETS (decided at emit time, forever)                          ║
║    • edge AT every SLO threshold     • finite top bucket ABOVE the timeout   ║
║    • geometric spacing for tails     • ~8–15 buckets   • per-service, not    ║
║    • DefBuckets is WRONG for µs and for multi-minute services    DefBuckets  ║
║    • sanity check: mean = _sum/_count ; mean ≫ p99 ⇒ tail TRUNCATED         ║
║                                                                              ║
║  PERCENTILES DON'T AGGREGATE LIKE COUNTERS                                   ║
║    ❌ avg(p99) / max(p99) / sum(p99)         ← MEANINGLESS                   ║
║    ✅ histogram_quantile(0.99, sum by (le)(rate(..._bucket[5m])))           ║
║       (aggregate BUCKETS first, THEN take the quantile)                      ║
║                                                                              ║
║  TYPE CHOICE                                                                 ║
║    summary  → exact per-instance, NOT aggregatable → single-process only    ║
║    histogram→ aggregatable, interpolated → services (default)               ║
║    native/exponential → no bucket design, ~1 series, uniform error → prefer ║
║                                                                              ║
║  PULL vs PUSH                                                                ║
║    pull  → FREE liveness (up==0), central discovery → long-lived            ║
║    push  → ephemeral/firewalled/FaaS; NO free liveness (add heartbeat)      ║
║    Pushgateway → batch jobs that EXIT only; DELETE group on decommission    ║
║                                                                              ║
║  TEMPORALITY (OTel)   cumulative → long-lived ;  delta → serverless         ║
║    delta: lost export = lost data forever                                    ║
║                                                                              ║
║  CARDINALITY = BUDGET (a number, enforced)                                   ║
║    code allow-list  +  client filter/view  +  scrape relabel                ║
║    alert on prometheus_tsdb_head_series AND churn (..._created_total)        ║
║                                                                              ║
║  WHAT NOT TO MEASURE                                                         ║
║    never-queried · derivable (success=total−errors) · per-row events ·      ║
║    high-res on low-stakes paths · duplicates of platform metrics            ║
║    subtraction is a contribution — GC unqueried metrics quarterly           ║
║                                                                              ║
║  COUNTER IDIOM   Inc/Add(+) only · one object · never Set · never recreate  ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- **Histogram buckets are a write-time decision with read-time-forever consequences.** Put an `le` edge at every SLO threshold, a finite top bucket above the timeout, space geometrically for heavy tails, keep ~8–15 buckets, and *never* paste `DefBuckets` onto a microsecond or multi-minute service. `_sum/_count` (the mean) is a free truncation check.
- **Native/exponential histograms** dissolve bucket design and cut series cost ~10× at *better* accuracy — prefer them for new latency work where the whole pipeline supports them.
- **You cannot average, sum, or max precomputed percentiles** — it produces numbers wrong by orders of magnitude that *look* reassuring. The only correct fleet quantile aggregates **buckets** first (`sum by (le)`), then computes the quantile. This is why summaries (no buckets) can't be aggregated and histograms can.
- **Summaries are for single-process tools**; for any multi-replica service, histograms. A summary-based latency dashboard is unfixable until the metric type changes in code.
- **Pull vs push is an architecture decision**, not a preference: pull buys free liveness and central control; push handles ephemeral/firewalled/FaaS but needs an explicit heartbeat. OTLP-to-collector is the modern hybrid; Pushgateway is for exiting batch jobs only.
- **Aggregation temporality** must match lifetime: cumulative for long-lived, delta for serverless; a lost delta export is gone forever.
- **Cardinality is a budget — a number you enforce** at three layers (code, client filter/view, pipeline relabel) plus alerts on series count and churn. The failure should happen as an `"other"` bucket, not a TSDB OOM.
- **The hardest senior skill is subtraction.** Never-queried, derivable, per-row, and duplicate metrics are pure cost. A wrong metric is worse than no metric. GC your metrics.
- **Respect the counter idiom** (`Inc`/`Add(+)`, one object, never `Set`) so `rate()`/`increase()` stay correct, and know that `increase()` extrapolates (non-integer results are normal).

---

## What You Can Build

- A **bucket-design linter**: given a metric's SLO thresholds and a histogram's `le` set, it flags missing SLO-edge buckets, a `+Inf`-adjacent ceiling below the timeout, and "all percentiles collapse to one bucket" risk.
- A **percentile-aggregation auditor** for dashboards: parse Grafana panel queries and flag every `avg/max/sum` applied to a `quantile`-labeled series or to a per-series `histogram_quantile`.
- A **histogram-truncation detector**: a job that, for each latency histogram, compares `_sum/_count` to the interpolated p99 and alerts when `mean ≫ p99` (tail hiding in `+Inf`).
- A **cardinality-budget enforcer**: per-service series budgets in config, an exporter that scrapes `count by (__name__)` and `head_series`, and alerts at 80% of budget plus a churn alert.
- A **metric GC report**: query the backend's "metrics with zero queries in 90 days," cross-reference active series, and produce a deletion proposal with the cost saved.
- A **summary-to-histogram migration kit**: detects summary-typed latency metrics across a fleet and generates the histogram replacement with SLO-aligned buckets and the corrected aggregation query.
- A **temporality validator**: scans OTel exporters and flags cumulative counters in serverless deployments (and delta counters pointed at cumulative backends).

---

## Further Reading

- **Prometheus — "Histograms and summaries"** — the canonical explanation of bucket interpolation and why summaries don't aggregate: <https://prometheus.io/docs/practices/histograms/>.
- **Prometheus — Native histograms** documentation and design docs — the exponential-bucket model and `histogram_quantile` over them.
- **OpenTelemetry — Metrics data model & aggregation temporality** — <https://opentelemetry.io/docs/specs/otel/metrics/data-model/> (cumulative vs delta, exponential histograms).
- **Gil Tene — "How NOT to Measure Latency"** (the "coordinated omission" and percentile-averaging talk) — essential, opinionated, and directly about why your latency numbers lie.
- **Brendan Gregg — The USE Method** and *Systems Performance* — for the resource-saturation framing behind what's worth measuring.
- **Björn Rabenstein / Beorn — Prometheus histogram talks** — bucket design and native histograms from the people who built them.
- **"Observability Engineering" — Majors, Fong-Jones, Miranda** — the cardinality-budget and metrics-vs-events boundary, at scale.
- **Micrometer docs — "Histograms and percentiles"** — the `publishPercentiles` (summary) vs `publishPercentileHistogram` (aggregatable) distinction in code.

---

## Related Topics

- **Previous level:** [middle.md](middle.md) — cardinality as a product, bounded labels, naming/units, RED/USE.
- **Next level up:** [professional.md](professional.md) — OpenTelemetry architecture at scale, exemplars (histogram bucket → trace), fleet cardinality governance, recording-rule strategy, multi-tenant TSDBs.
- **Interview:** [interview.md](interview.md). **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Senior](../logging/senior.md) — where the *identity* you removed from labels belongs; structured fields and aggregation.
- [Tracing](../tracing/README.md) — exemplars link a slow histogram bucket to a concrete trace; per-request attributes are the right home for `user_id`/`request_id`.
- [Telemetry Cost and Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the budget side of "what (not) to measure," across all three signals.
- [Observability Engineering](../observability-engineering/) — metrics as one pillar; the system view.

**Cross-roadmap links:**

- [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/) — the histogram says *that* latency is high; the profiler says *why*.
- [Quality Engineering → Performance → Latency & Throughput](../../quality-engineering/performance/03-latency-and-throughput/) — percentiles, coordinated omission, and what a latency number actually means.

---

## Diagrams & Visual Aids

### Bucket placement vs the distribution

```text
   latency distribution (heavy-tailed):
        ▁▂▅█▇▅▃▂▁                              ▁           ▁
        └──────────┬─────────────────────┬─────────────────────────►
        0    25   50   100   200   300         800ms        2s (timeout)

   ❌ DefBuckets ceiling at 10s but coarse here:  ...0.25 │ 0.5 │ 1 │ ...
        p99 interpolated across a 250ms-wide bucket → fuzzy

   ❌ Truncated ceiling at 50ms:  ...0.025 │ 0.05 │ +Inf
        everything >50ms → +Inf → p99 CANNOT exceed 50ms → FALSE GREEN

   ✅ SLO-aligned, tail-covering:  ...0.05(p50) │ ... │ 0.3(p99) │ 0.5 │ 1 │ 2(timeout)
        edge at each SLO, dense where action lives, finite top above timeout
```

### Why averaging p99 lies

```text
   Pod A: 99×10ms + 1×1000ms → p99(A)=10ms ┐
   Pod B: 99×10ms + 1×1000ms → p99(B)=10ms ┘  avg(p99) = 10ms   ← WRONG, looks fine

   TRUE fleet over 200 reqs: 198×10ms + 2×1000ms
        99th percentile = the 2 slowest (1%) = 1000ms          ← reality, 100× higher

   correct: sum the BUCKETS, THEN quantile:
        histogram_quantile(0.99, sum by (le)(rate(..._bucket[5m]))) = 1000ms ✅
```

### The three lines of cardinality defense

```text
   ┌─ emit (code) ─────────┐   ┌─ client (SDK) ──────────┐   ┌─ pipeline (scrape) ─────┐
   │ allow-list label vals │ → │ MeterFilter / OTel View │ → │ metric_relabel_configs  │
   │ overflow → "other"    │   │ cap tags, drop attrs    │   │ drop, per-tenant limits │
   └───────────────────────┘   └─────────────────────────┘   └──────────┬──────────────┘
        cheapest, earliest         central, fleet-wide          last resort, catches all
                                                                          │
                              ALERT: prometheus_tsdb_head_series  &  ..._created_total (churn)
                              ── so the next bomb PAGES you, it doesn't OOM you ──
```

### Pull vs push consequence map

```text
                 PULL (scrape)                        PUSH (OTLP / StatsD)
   liveness   │ up==0, free, unambiguous      │  silence is ambiguous → need heartbeat
   discovery  │ centralized in scraper        │  each sender knows the collector
   ephemeral  │ ✗ dies before scrape          │  ✓ fire-and-exit (FaaS, cron)
   firewall   │ scraper must reach target     │  target dials out → easier
   cardinality│ controlled at scrape (relabel)│  controlled at sender / collector
   modern hybrid: app → OTLP push → Collector → scraped by Prometheus (control in collector)
```

---
