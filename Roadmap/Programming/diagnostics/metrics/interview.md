# Metrics — Interview Questions

> **Topic:** [Metrics Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about metric types, labels and cardinality, naming and units, pull vs push, the golden signals, percentiles and histogram buckets, OpenTelemetry, and the cost of getting any of it wrong.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Cardinality & Labels](#cardinality--labels)
4. [Naming, Units & Conventions](#naming-units--conventions)
5. [Percentiles, Histograms & Aggregation](#percentiles-histograms--aggregation)
6. [Pull vs Push, Collection & OpenTelemetry](#pull-vs-push-collection--opentelemetry)
7. [Tricky / Trap Questions](#tricky--trap-questions)
8. [System / Design Scenarios](#system--design-scenarios)
9. [Whiteboard / Live Exercises](#whiteboard--live-exercises)
10. [Behavioral / Experience](#behavioral--experience)
11. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
12. [Cheat Sheet](#cheat-sheet)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Metrics interviews split into two flavours. The first is "do you know the model" — can you name the four instrument types, explain a counter vs a gauge, read a `histogram_quantile` query, recite the golden signals. That's table stakes and a junior is expected to clear it. The second is "do you understand the *economics and the lies*" — why one careless label OOM-kills a Prometheus server, why you cannot average two p99s, why a fast flood of `500`s makes your latency dashboard look *better*, and where the boundary between a metric and a trace actually sits. Senior and staff interviews live almost entirely in the second flavour.

This file is the question bank, graduated junior → staff. Trap questions also explain *why* the obvious instinct is wrong, because in production the wrong instinct is the expensive part — and in metrics, "expensive" frequently means "the monitoring system itself is the outage." The scenario section is where staff candidates earn their title: given "the TSDB is melting," can you diagnose under pressure, stop the bleed, and explain the blast radius?

---

## Conceptual / Foundational

### Q: Name the metric instrument types and when you'd use each.

Four core types, present (under different names) in StatsD, Prometheus, OpenTelemetry, Micrometer:

- **Counter** — a monotonically increasing cumulative value. Requests served, bytes sent, errors. You never read the raw value; you `rate()` it. Resets to zero on process restart (the query engine handles the reset).
- **Gauge** — a value that goes up *and* down, sampled at read time. Current temperature, queue depth, in-flight requests, memory in use, connection-pool size. Snapshot of "right now."
- **Histogram** — bucketed observations of a distribution: latency, payload size. Emits per-bucket cumulative counters plus `_sum` and `_count`. Lets you compute quantiles **after** the fact and **aggregate across machines**.
- **Summary** — like a histogram but computes selected quantiles (p50/p90/p99) *client-side* and exposes them directly. Cheaper to query, but the quantiles are **not aggregatable** across instances.

The decision: monotonic count → counter; point-in-time level → gauge; distribution you want percentiles of → histogram (almost always over summary). Mention OTel adds an **UpDownCounter** (a delta-reported gauge-like counter) and **exponential histograms**.

**What-if — "I want average latency, isn't a counter of total-time ÷ counter of count enough?"** That gives you the mean, which hides the tail — the exact thing latency SLOs care about. A `sum/count` average can be 40ms while p99 is 4s. Use a histogram.

**What-if — "Why not just use gauges for everything?"** A gauge holds one value, the last sample. For a rate you'd lose every event between scrapes; for a distribution you'd see only the most recent observation. Counters survive between scrapes (cumulative) and histograms preserve the shape.

### Q: Counter vs gauge — give me a case where choosing wrong silently breaks the dashboard.

A counter is cumulative and only goes up; you graph `rate(x[5m])`. A gauge is the instantaneous value; you graph it directly.

Break case: you model "total requests" as a **gauge** that you `set()` to a running total in app code. On restart it resets to 0 — but the query engine doesn't know it's a counter, so `rate()` semantics (which special-case resets) don't apply, and any direct graph shows a cliff to zero that looks like a traffic outage that never happened. Inverse break: you model "current queue depth" as a **counter**; now it can never decrease, so `rate()` of it is meaningless and the raw value is a lie. Pick the type that matches the *physics* of the quantity: does it only ever accumulate (counter) or can it fall (gauge)?

**What-if — "How does Prometheus handle a counter resetting on restart?"** `rate()` and `increase()` detect a decrease in a counter as a reset and assume it dropped to 0 then climbed, summing the pre- and post-reset deltas. That's why you must never `set()` a counter to an arbitrary lower value — you'd fake a reset and inflate the rate.

### Q: What's the difference between a metric, a log, and a trace?

- **Metric** — a pre-aggregated numeric time series, cheap and constant-cost regardless of traffic. Answers *"is something wrong, and roughly where?"* Bounded cardinality is mandatory.
- **Log** — a timestamped event record, often structured. Answers *"what exactly happened in this one case?"* High cardinality is fine; cost scales with volume.
- **Trace** — a causally-linked tree of spans across services for one request. Answers *"where did the time go / where did it fail in this request's path?"* High-cardinality attributes (user ID, request ID) live here legitimately.

The load-bearing consequence: **identity (user ID, request ID, full URL) belongs in logs and traces, never in a metric label** — because metrics are billed by *series count*, and identity is unbounded. Metrics tell you *that* checkout is slow for `eu-west`; traces tell you *which user's* checkout and *why*.

**What-if — "Then why have metrics at all if traces are richer?"** Cost and always-on coverage. Metrics are constant-cost — a counter is the same handful of bytes whether you serve 10 or 10 million requests, so you can keep them on 100% of traffic forever. Traces you sample (often 1%), so they can't reliably catch a 1-in-10,000 error rate; the metric can.

### Q: What are the Four Golden Signals? Where do they come from?

From the Google SRE book — *if you measure only four things about a user-facing system:*

- **Latency** — how long requests take. Crucially, **measure success and error latency separately** (a flood of fast 500s otherwise flatters your p99).
- **Traffic** — demand: requests/sec, transactions/sec.
- **Errors** — rate of failed requests, and the *kind* (5xx, timeout, or the sneaky "200 with an error body").
- **Saturation** — how "full" the system is; the resource nearest its limit. The **leading indicator** — it pages you *before* the customer is hurt, whereas latency and errors mean the customer is *already* hurting.

**What-if — "How do RED and USE relate to the golden signals?"** **RED** (Rate, Errors, Duration — Tom Wilkie) is the golden signals minus saturation, applied per *service*. **USE** (Utilisation, Saturation, Errors — Brendan Gregg) is applied per *resource* (CPU, memory, disk, pool). Golden Signals ≈ RED + saturation, framed for the user-facing layer. You use RED on endpoints and USE on the resources they run on; together they tell you "the service is slow" *and* "because the DB pool is saturated."

### Q: Why measure success latency and error latency separately?

Because a failure path is usually a *different distribution* — often much faster (you reject early) or much slower (you time out). If you mix them, a sudden flood of fast rejections (auth failing, circuit breaker tripping) drags your p99 *down* and the latency dashboard looks *great* while the system is on fire. Splitting by `status_class` (or a `success`/`error` label) keeps the success-path latency honest, which is the number your SLO is actually about.

**What-if — "What about a 200 that's actually an error?"** That's why "error" must be defined semantically, not just by HTTP status. A `200 OK` carrying `{"error": "..."}` in the body is an error your status-based metric misses. Decide what *counts* as an error for your domain and instrument *that*, sometimes with an explicit `outcome` label set in business logic.

---

## Cardinality & Labels

### Q: What is cardinality, and why is it the defining failure mode of metrics?

Cardinality is the count of **distinct label-value combinations** for a metric — and it's a **product**, not a sum. A counter with `method` (5) × `status_class` (5) × `route` (20) × `region` (4) = 2,000 series. Add `user_id` (1,000,000) and it's 2,000,000,000 series.

It's *the* failure mode because a TSDB's cost is driven by **series count, not sample count**. Prometheus keeps an inverted index mapping every label value to its series and holds active series in RAM. A million-user label means a million index entries and a million in-memory series *per metric carrying it*. Push past a few million active series and the server OOM-kills itself — meaning you go blind exactly when you need to see.

**What-if — "Is a histogram free of this?"** No — a histogram is the *worst* offender, because it's one series **per bucket** per label combination, plus `_sum` and `_count`. A 12-bucket histogram across 600 label combos is `12 × 600 + 2×600 = ~8,400` series before you add anything. Histograms are not free; budget them.

### Q: What makes a good label vs a bad one? Give me the test.

A good label has a **small, finite, predictable** value set you could write on a whiteboard: HTTP method, status class, region, queue name, **route template**, customer *tier*. A bad label has an **unbounded or unpredictable** set: user ID, request ID, email, full URL, raw error message, timestamp, raw IP.

The test: *"Can the number of distinct values grow without bound as the system runs (with users, traffic, time, or deploys)?"* If yes — it's not a label, it's a log field.

The fix pattern is **dimension, don't identify**: replace the identity with the *category* it belongs to. `path="/users/42"` → `route="/users/:id"`. `customer_id="cus_8X2k"` → `tier="enterprise"`. `error="dial tcp 10.2.3.4:5432: connection refused"` → `error_type="connection_refused"`. You lose "which one" (go to traces) and keep "which kind" (bounded, cheap, aggregatable).

**What-if — "A label that *looks* bounded but isn't?"** `version="1.2.3-abc123-dirty-2026-06-11"` — a per-build suffix makes it grow with every deploy. Or `host`/`pod` in an autoscaling fleet — dozens of stable pods is fine; hundreds of ephemeral pods per hour is a slow leak, since old pods' series linger until they age out. "Bounded" is about the *value set*, not the *label name*.

**What-if — "Where do I put `customer_id` then, if a PM demands per-customer numbers?"** Logs or traces (as a span attribute — perfectly fine there), or a purpose-built analytics store (a wide-event system like Honeycomb, or a data warehouse). The metric answers "is the fleet healthy?"; the warehouse answers "what did customer X do?"

### Q: A scanner is hitting random URLs — `/aaaa`, `/bbbb`, … — and your `route` label is exploding. What happened and how do you fix it?

The instrumentation is labelling **unmatched** requests by their concrete path instead of by the matched route template. Every junk URL a scanner (or a fuzzer, or a misconfigured client) sends becomes a new `route` value, and the series count climbs without bound — a cardinality bomb driven by *external* traffic you don't control.

Fix: for any request that doesn't match a known route, label it `route="unmatched"` (or `"other"`). More generally, **map free-form / externally-sourced label values through an allow-list**, and bucket anything unknown into `"other"`, capping cardinality at the source.

**What-if — "Why is this one especially dangerous?"** Because the cardinality is driven by an *adversary or accident outside your system*. Internal labels you can reason about; a label fed by raw user input has no ceiling you control. This is also why error-*message* labels are lethal — the message often embeds an IP, a port, or a generated ID.

### Q: How do you control cardinality at the collection layer, after the fact?

When you can't fix the instrumentation immediately, control it at scrape/ingest time:

- **Relabeling / drop rules** (Prometheus `metric_relabel_configs`, OTel Collector processors): drop a runaway label or whole metric before storage. `labeldrop`, `labelmap`, or `drop` actions.
- **Allow-list the labels you keep**; everything else is stripped.
- **Aggregate away** the offending dimension with a recording rule, then drop the raw high-card series.
- **Per-target / per-metric series limits** (`sample_limit`, `label_limit`, `label_value_length_limit` in Prometheus) — a circuit breaker so one bad target can't take down the server.
- In Micrometer: `MeterFilter.maximumAllowableTags(...)` caps tag values per meter; in OTel, a **view** can drop or rename attributes.

**What-if — "Drop the label or aggregate it?"** Drop if the dimension is useless (request ID). Aggregate-then-drop if the *summed* value matters but the breakdown doesn't (you want total request rate, not per-user). Relabeling is the firefighting tool; fixing the instrumentation is the cure.

### Q: How do you put a guardrail on cardinality so the next bomb doesn't surprise you?

Monitor your monitoring. Alert on `prometheus_tsdb_head_series` crossing a budget. Track per-metric series with `topk(10, count by (__name__)({__name__=~".+"}))` and alert when any single metric crosses a threshold (a "cardinality tripwire" exporter). Set `sample_limit`/`label_limit` per scrape target as a hard ceiling. In CI, lint new instrumentation for known-bad label names (`user_id`, `request_id`, `email`, `path`). The principle: a **cardinality budget defined before you need it**, not discovered in the postmortem.

---

## Naming, Units & Conventions

### Q: Walk me through metric naming conventions and why they're not just style.

Naming is an **API contract** with every tool downstream — Grafana's auto-units, alerting libraries, and Prometheus tooling *parse* these conventions:

- **`snake_case`, lowercase**: `http_request_duration_seconds`.
- **Subsystem prefix**: `db_query_duration_seconds`, `cache_evictions_total` — groups related metrics, avoids collisions.
- **Counters end in `_total`**: `http_requests_total`. Tooling identifies counters by this suffix.
- **Base SI units in the suffix**: `_seconds` (never `_ms`), `_bytes` (never `_kb`), `_ratio` (0–1, never `_percent`). Grafana auto-formats; alert thresholds assume base units.
- **Don't bake label data into the name**: `http_requests_total{method="GET"}`, **not** `http_get_requests_total` — otherwise you can't sum across methods without regex gymnastics.
- **Describe the thing, not the source**: `payment_authorizations_total` survives refactors and reads well on a dashboard.

**What-if — "Why seconds, not milliseconds? Milliseconds are more readable."** Readability is a *display* concern Grafana handles. Storing in base SI units means every duration metric across your fleet is directly comparable and aggregatable — no per-metric unit conversion, no `_ms` here and `_seconds` there breaking a cross-service dashboard. The data stays canonical; the dashboard divides for humans.

**What-if — "I have `latency_ms` in one service and `request_seconds` in another."** You can't build a single fleet dashboard or a shared recording rule over them — every query needs per-service unit handling. This is exactly the cross-service consistency problem; standardise on `_seconds` everywhere.

### Q: Ratios — `_ratio` (0–1) or `_percent` (0–100)?

Store as a unitless ratio in `0..1` with a `_ratio` suffix: `cache_hit_ratio = 0.95`. Percent is a display format Grafana applies; keeping the data unitless means thresholds, math across metrics, and alert expressions stay simple (`> 0.99` reads cleanly). `_percent` invites the classic bug where someone alerts on `> 95` against a metric that's actually `0.95`.

---

## Percentiles, Histograms & Aggregation

### Q: Why can't you average two p99s?

Because a percentile is a property of a **distribution**, and the average of two percentiles is not the percentile of the combined distribution. Server A's p99 might be 100ms and server B's p99 200ms, but the true p99 of *all* requests across both depends on each server's *traffic volume and full shape*, not just their individual p99s. If A served 1M requests and B served 10, the combined p99 is essentially A's. Averaging gives 150ms, which corresponds to no real request anywhere.

The right way: aggregate the **raw distributions**, then compute the percentile once over the merged data. With histograms that's exactly what you do — sum the per-bucket counters across instances, *then* `histogram_quantile`. This is the single biggest reason histograms beat summaries for fleet-wide latency.

**What-if — "So how do summaries break here?"** A summary computes its quantiles **client-side, per instance**. You get `latency{quantile="0.99"}` already cooked per pod. There is no correct way to combine them into a fleet p99 — you'd be averaging p99s, which is exactly the sin above. A summary's quantiles are only valid for the single instance that produced them.

**What-if — "What about p50 — can I average medians?"** Same problem, same answer. No percentile is averageable across distributions. The median is just p50; it inherits the identical flaw.

### Q: How does a histogram let you compute a fleet-wide p99 correctly?

A Prometheus histogram exposes **cumulative per-bucket counters**: `http_request_duration_seconds_bucket{le="0.1"}`, `{le="0.25"}`, … each counting observations ≤ that bound, plus `_sum` and `_count`. Buckets are additive across instances, so:

```promql
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

`sum by (le)` merges every pod's buckets into one fleet-wide distribution; `histogram_quantile` interpolates the 99th percentile within the bucket that crosses it. Because buckets are just counters, the merge is exact addition — that's what makes histograms aggregatable where summaries are not.

**What-if — "How accurate is `histogram_quantile`?"** As accurate as your bucket boundaries. It assumes a *linear* distribution **within** the bucket that contains the quantile, so the error is bounded by that bucket's width. If p99 falls in a `[1s, 2.5s]` bucket, the answer is somewhere in that 1.5s-wide guess. Tight buckets near your SLO = good estimate; coarse buckets = mush.

### Q: How do you choose histogram bucket boundaries?

Put the **resolution where the decisions are** — densely around your SLO and your typical latency, coarsely in the tail. If your SLO is "p99 < 250ms" and traffic clusters at 5–50ms, you need fine buckets through ~300ms, not the default `{5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s}` if that leaves a 100ms→250ms gap straddling your target.

Common mistakes: buckets too coarse where it matters (all traffic in 1–5ms but the first bucket is 5ms — every quantile pins to the bottom edge and p50 is meaningless); buckets too fine everywhere (cardinality blows up); buckets that don't extend past your real tail (everything beyond the last `le` collapses into `+Inf`, so you can't tell 11s from 110s).

**What-if — "I don't know the distribution in advance."** Use **exponential / native histograms** (Prometheus native histograms, OTel exponential histograms). Buckets are generated on a fixed multiplicative schedule covering many orders of magnitude with bounded relative error and far fewer stored series — no hand-tuning, and you don't have to guess the range up front.

**What-if — "How do I pick buckets for a new service with no data?"** Start with a sensible exponential spread around your SLO, ship, then look at the actual distribution after a week and re-bucket. Or skip the guessing entirely with native/exponential histograms.

### Q: What's the trade-off between a classic histogram and a native/exponential histogram?

Classic histogram: explicit static `le` bounds you choose; one series per bucket, so cost and resolution are *your* fixed decision; widely supported by every Prometheus version and tool. Native/exponential histogram: buckets generated automatically on a multiplicative schedule, dramatically fewer stored series for the same resolution, no manual tuning, bounded *relative* error across the whole range — but newer, needs recent Prometheus/Grafana, and the on-wire/storage format differs. For most latency work today, classic histograms with well-chosen buckets are the safe default; native histograms are where the ecosystem is heading and shine when you can't predict the range.

---

## Pull vs Push, Collection & OpenTelemetry

### Q: Pull vs push — what's the difference and when do you use each?

**Pull (scrape)**: the monitoring server fetches `/metrics` over HTTP every N seconds. Prometheus is the canonical example. **Push**: your service sends metrics out to a collector or gateway. StatsD, Graphite, and OTLP-push are examples.

Rule of thumb: **pull for long-lived services, push for ephemeral jobs**. A web server lives for weeks — it exposes `/metrics` and lets Prometheus scrape it; a failed scrape *is* a free liveness signal. A 200ms Lambda or a cron job dies before any 15-second scrape could reach it — it pushes (to a Pushgateway or an OTLP collector) and exits.

Pull's bonuses: the scrape itself tells you "is it up?" for free, and the server controls the sampling interval centrally. Pull's cost: service discovery — the server must know every target. Push inverts both: targets need to know the collector, and "is it up?" needs a separate heartbeat (silence is ambiguous — dead, or just idle?).

**What-if — "Prometheus is pull, but I have ephemeral jobs — what do I do?"** Pushgateway for batch jobs (they push their final metrics before exiting; Prometheus scrapes the gateway). But Pushgateway is a *cache* with footguns: it holds the last pushed value forever (stale metrics linger after the job is gone unless you delete them), and it's a single point of aggregation. The modern answer is often an **OTel Collector** receiving OTLP push and re-exposing for scrape, or remote-write.

**What-if — "How does Prometheus do service discovery in Kubernetes?"** It queries the Kubernetes API (`kubernetes_sd_config`) for pods/services/endpoints, then uses relabeling to decide which to scrape (e.g. only pods with a `prometheus.io/scrape: true` annotation) and on which port/path. Targets appear and disappear automatically as pods churn.

### Q: Where does OpenTelemetry fit in the metrics picture?

OpenTelemetry (OTel) is a **vendor-neutral standard** for instrumenting and exporting telemetry — metrics, traces, logs — over a common protocol (**OTLP**). For metrics specifically: you instrument once against the OTel API (Counter, UpDownCounter, Histogram, Gauge, plus async/observable variants), and the OTel SDK exports via OTLP to an **OTel Collector**, which can then fan out to Prometheus, a vendor backend, or several at once.

Key concepts an interviewer probes:
- **Instruments**: Counter, UpDownCounter, Histogram, Gauge, and *observable* (callback-based) versions for values you sample rather than record.
- **Views**: reshape metrics in the SDK — drop attributes (cardinality control), change a histogram's buckets, rename, or filter — without touching instrumentation code.
- **Temporality**: **cumulative** (value since start, what Prometheus expects) vs **delta** (value since last export, what some push backends and StatsD-style systems expect). Mismatched temporality is a classic OTel bug.
- **Exemplars**: attach a sample trace ID to a histogram bucket so you can jump from "this latency bucket spiked" straight to a representative trace.
- **The Collector**: a separate process for receiving, processing (batching, filtering, attribute manipulation, cardinality limiting), and exporting — the place to enforce fleet-wide policy.

**What-if — "Cumulative vs delta temporality — why do I care?"** Prometheus scrape model is cumulative (counters only go up; the query engine computes rates). Delta temporality reports the increment since the last export. If you wire a delta-exporting SDK into a cumulative-expecting backend (or vice versa) without the Collector converting, your rates are wrong or your counters look like they reset every interval. Pick temporality to match the backend.

**What-if — "What are exemplars and why are they powerful?"** An exemplar is a single example observation (with its trace ID and timestamp) attached to a histogram bucket. So when p99 latency jumps, you don't just see *that* it jumped — you click the bucket and land on an actual slow request's trace. It's the bridge from aggregate metric back to a concrete case, without putting high-cardinality IDs in the metric itself.

---

## Tricky / Trap Questions

### Q: Your latency dashboard shows p99 *improving* during an incident customers are screaming about. What's happening?

Wrong instinct: "the dashboard is wrong, ignore it." The dashboard is reporting exactly what you told it to.

Almost certainly you're measuring latency across **all** requests, success and error mixed. Something is now failing **fast** — auth rejecting early, a circuit breaker tripping, a downstream returning instant 503s — and those fast failures flood the histogram, dragging p99 *down*. The success path may be as slow or slower than before, but it's drowned out.

Fix: split latency by `status_class` (or a `success`/`error` label) and watch the success-path p99. Also watch the error *rate* and *traffic* — a latency drop combined with an error-rate spike is the signature of "fast failures flattering the numbers."

### Q: Someone says "let's add a `customer_id` label temporarily to debug one merchant." What do you say?

Wrong instinct: "sure, it's temporary, we'll remove it." "Temporarily add a high-cardinality label" is how almost every TSDB outage starts, and "temporary" labels are never removed before they OOM the server.

With, say, 40,000 merchants and a 12-bucket histogram across 4 status classes and 3 regions, that one label takes a healthy `~576` series to `12 × 40,000 × 4 × 3 = 5,760,000` series for *one* metric. Prometheus RAM climbs over days, then OOMs and crash-loops on WAL replay — and because the whole fleet shares that Prometheus, **every** team's dashboards and alerts go dark, including the very incident you added the label to debug.

The right move: put `merchant_id` where identity belongs — a **trace attribute** or a log field — and label the metric with `merchant_tier` (bounded) if you need a metric breakdown at all.

### Q: Your p99 from the dashboard says 200ms but users report multi-second page loads. Why might both be true?

Wrong instinct: "the metric is lying." Several legitimate gaps:

- **Wrong percentile for the experience.** p99 means 1 in 100 requests is *worse* than 200ms. A page makes 30 backend calls; the chance *all* dodge the slow 1% is `0.99^30 ≈ 74%` — so ~26% of page loads hit at least one slow call. Tail latency compounds across fan-out.
- **You're measuring server time, not end-to-end.** The histogram times the handler; the user's clock includes DNS, TLS, queueing, network, client render. Measure at the edge/RUM too.
- **Coarse buckets.** If your largest bucket before `+Inf` is 1s, everything from 1s to 60s reads as "≥1s" and `histogram_quantile` can't see the real tail.
- **Averaging across instances** (if it's a summary) — the reported p99 isn't a real p99.

### Q: Your average request latency looks healthy but customers complain about slowness. First check?

Wrong instinct: "latency is fine, must be a client problem." The **average is the wrong statistic**. A mean of 40ms is consistent with 95% of requests at 10ms and 5% at 4s — and the 4s requests are the ones generating complaints. The average is dominated by the bulk and blind to the tail.

First check: look at the **distribution** — p50, p95, p99, p99.9 — from the histogram, not the mean. If you only have a mean (counter-sum ÷ counter-count), that's the actual bug: replace it with a histogram.

### Q: A metric value "looks frozen" — same number every scrape. Is it broken?

Wrong instinct: "the exporter is dead, restart it." Depends on the type:

- A **gauge** legitimately holds steady if the underlying level didn't change (idle queue depth, stable pool size). Not necessarily broken.
- A **counter** that's flat means *no events occurred* in that window (zero traffic) — which might be correct (3am) or a real outage upstream. `rate()` of it is genuinely 0.
- **Truly stale** (the exporter stopped updating): Prometheus marks a series **stale** when a scrape returns but the series is absent, and after `~5min` of failed scrapes. Use the `up` metric and `absent()`/staleness to distinguish "value is 0/flat" from "target is gone."

The check: is `up{job=...}` still 1? Is the `_count` of a histogram advancing? Distinguish "no change" from "no data."

### Q: You alert on `rate(errors_total[1m]) > 0` and get paged constantly. What's wrong?

Wrong instinct: "errors are bad, any error should page." A single transient error in a healthy high-traffic system is normal; paging on `> 0` is alert-fatigue by design.

Fix: alert on an **error *ratio*** over a meaningful window, against an SLO: `rate(errors_total[5m]) / rate(requests_total[5m]) > 0.01` for `5m`. Better still, alert on **burn rate** against an error budget (multi-window: fast burn over 5m AND 1h). Raw error *count* ignores traffic — 10 errors in 10/sec is catastrophic, 10 in 100,000/sec is noise. Ratio and budget make the alert proportional to actual harm.

### Q: Two pods report `http_requests_total` but a `sum()` gives a number that periodically drops. Why?

Wrong instinct: "the counter is broken." Pods **restart**, and a counter resets to 0 on restart. A naive `sum(http_requests_total)` over the raw counters drops every time a pod restarts.

You almost never sum raw counters. Use `sum(rate(http_requests_total[5m]))` — `rate()` handles each counter's resets correctly *before* summing, so a restart doesn't create a phantom dip. Summing cumulative counters directly is a classic mistake; always rate-then-aggregate.

### Q: Why is `rate()` over a counter sometimes *higher* than the real rate right after a deploy?

Wrong instinct: "the metric is inflated." During a rolling deploy, old pods disappear (their series go stale) and new pods appear with counters starting at 0. `rate()` interpolates over the lookback window and, combined with series churn and extrapolation at the window edges, can briefly over- or under-shoot. Prometheus's `rate()` also *extrapolates* to the window boundaries, which can slightly inflate a sparse series. Use a longer window (`[5m]` over `[1m]`) to smooth deploy churn, and don't over-read a 30-second blip during a rollout.

---

## System / Design Scenarios

### Q: Your TSDB is melting from cardinality — Prometheus is OOM-crash-looping. Diagnose and stop the bleed, live.

Stop the bleed first, root-cause second.

1. **Confirm it's cardinality, not sample volume.** On a healthy replica (or via the admin API while the primary is down), the head-series count is the tell: `prometheus_tsdb_head_series` is the metric; a sudden step-up is the signature.
2. **Find the culprit metric.** `topk(10, count by (__name__)({__name__=~".+"}))` — the runaway metric usually dwarfs the next by 100×+. Then find the offending *label*: `count(count by (label_you_suspect) (the_metric))`.
3. **Stop ingestion of the bomb.** Add a `metric_relabel_configs` drop rule for that label (or the whole metric), reload config — you don't have to restart-replay. This halts further growth immediately.
4. **Get the server stable.** If it's crash-looping on WAL replay, the dropped label won't help past data; you may need to delete the offending series (`/api/v1/admin/tsdb/delete_series`) and clean tombstones, or in the worst case wipe the WAL to break the loop, accepting a gap.
5. **Restore the fleet.** Remember the **blast radius**: every tenant sharing this Prometheus was blind. Confirm dashboards/alerts are back.
6. **Root cause and prevent.** Find the commit/label that introduced it (usually an identity label "for debugging"). Replace identity with category; move per-entity debugging to traces. Add a `sample_limit`/`label_limit` per target and a series-count alert so the next one trips a circuit breaker instead of an outage.

**What-if — "How do you prevent a recurrence beyond the alert?"** Per-target ingestion limits as a hard ceiling; CI lint banning `user_id`/`request_id`/`path` label names; a cardinality budget per team; and architecturally, isolate tenants onto separate Prometheus instances (or use a multi-tenant system like Mimir/Cortex with per-tenant series limits) so one team's bomb can't blind everyone.

### Q: Design the metrics for a new payments service.

**Golden signals / RED first, business metrics second.**

- **RED per endpoint** via one middleware: `http_requests_total{method,route,status_class}` (counter), `http_request_duration_seconds{method,route}` (histogram, success vs error split), `http_requests_in_flight` (gauge, saturation). Bounded labels only — route *template*, status *class*.
- **Business metrics**: `payment_authorizations_total{outcome,card_brand,tier}`, `payment_capture_duration_seconds`, dollar volume, success ratio by card brand. Outcome and brand are bounded; **never** `card_number`, `merchant_id`, or `customer_id` as labels.
- **Saturation / USE on resources**: DB pool `db_connections_in_use / db_connections_max`, queue depth, downstream issuer client in-flight.
- **Latency split** success vs error so a flood of declined-card fast-fails can't flatter p99.
- **Histograms** for all latency (aggregatable fleet p99), buckets tuned around the SLO; consider exemplars to jump to a trace.
- **Alerts**: error-budget burn rate (multi-window), p99 > SLO for 5m, saturation leading indicators (pool > 90%, queue depth climbing), downstream issuer error rate. **Not** raw error count.

**What-if — "Where does per-customer / per-merchant analysis live?"** Not the TSDB. `merchant_id` is a trace attribute and a log field; per-merchant aggregates go to a warehouse or wide-event store. Compliance bonus: never put PAN/CVV anywhere near a metric label (or a log) — PCI scope.

### Q: A PM wants a dashboard of per-customer API usage for 200,000 customers. How do you serve it without killing the TSDB?

Not with a metric label — 200,000 series per metric, growing forever, and the dashboard would query 200k series anyway. Options, in order of preference:

1. **Wrong tool for metrics; right tool for a warehouse.** Per-customer usage is an analytics question. Emit usage as **events** (logs / wide events) keyed by `customer_id`, land them in a warehouse (BigQuery, ClickHouse, Snowflake), and build the per-customer dashboard there. That's what those systems are *for*.
2. **Bounded metric for fleet health + drill-down elsewhere.** Keep the metric labelled by `tier`/`plan` (bounded) for "is the fleet healthy?", and link to the warehouse/traces for "what did customer X do?".
3. **If it must be near-real-time per customer**, a streaming aggregation (Flink/Kafka Streams) or a purpose-built usage-metering service — not Prometheus.

The principle: metrics answer "is *the system* healthy?" with bounded cardinality; per-entity analytics is a different system with different economics.

### Q: Your metrics bill (or TSDB storage) is exploding. How do you cut cost without going blind?

Cost in metrics is dominated by **series count** and **retention × resolution**. Attack in that order:

1. **Find the high-cardinality offenders** (`topk` by series per metric) and fix or drop their runaway labels — usually 80% of the cost is a few metrics.
2. **Drop labels nobody queries.** Audit dashboards/alerts for which labels are actually used; relabel-drop the rest.
3. **Reduce resolution / retention by tier.** Keep raw high-resolution data for days, **downsample** to coarser resolution for long-term (recording rules, or Thanos/Mimir downsampling). You rarely need 15s resolution for data 6 months old.
4. **Recording rules** for expensive, frequently-queried aggregations — compute once, store the small result, drop the need to keep raw high-card series hot.
5. **Sampling for traces, not metrics.** Metrics are constant-cost per series; don't "sample" them — control cardinality instead. (Sampling belongs to traces.)

**What-if — "Can I just sample metrics to cut cost?"** Sampling a counter or histogram corrupts it — you'd undercount and your rates/quantiles would be wrong. The lever for metrics is **cardinality and retention**, not sampling. Sampling is a *trace* cost lever.

### Q: Design alerting that doesn't drown the on-call in noise.

- **Alert on symptoms, not causes.** Page on user-facing SLO violations (error budget burn, latency SLO breach), not on every CPU spike. Cause-level signals go on dashboards, not pagers.
- **SLO-based burn-rate alerts, multi-window.** Page fast when burning the budget fast (e.g. 2% of monthly budget in 1h *and* still burning over 5m); ticket (not page) for slow burns.
- **Ratios and durations, never raw counts or instantaneous spikes.** `for: 5m` to ride out blips.
- **Saturation as the leading page** so you act before customers are hurt.
- **Severity tiers**: page for "users affected now," ticket for "will be affected soon," dashboard for "good to know."

**What-if — "Why burn rate over a static threshold?"** A static `error_rate > 1%` either pages on a harmless 2-minute blip or is too slow to catch a fast catastrophic burn. Burn-rate alerting ties the page to **how fast you're consuming the error budget**, which is proportional to actual customer harm — fewer false pages, faster real ones.

---

## Whiteboard / Live Exercises

### Q: Compute the series count. `method`(5), `route`(40), `status_class`(5), `region`(3) on a histogram with 12 buckets. Then someone adds `user_id`(100,000).

Histogram series = (label combinations) × (buckets + 2) for `_bucket` per `le`, plus `_sum` and `_count`.

```
label combos = 5 × 40 × 5 × 3 = 3,000
buckets contribute 12 _bucket series each, + _sum + _count = 14 series per combo
total = 3,000 × 14 = 42,000 series        ← healthy
```

Add `user_id` (100,000):

```
3,000 × 100,000 = 300,000,000 combos × 14 = 4,200,000,000 series   💥
```

What breaks: TSDB index and RAM explode (series, not samples, drive memory), Prometheus OOMs and crash-loops on WAL replay, and **every** tenant sharing that server goes blind. Fix: drop `user_id`; if you need a metric slice, use `tier` (bounded); put `user_id` in traces.

### Q: Here's a query — read it and tell me what it computes and whether it's correct.

```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

It computes the 99th-percentile request latency over the last 5 minutes — **but it's subtly wrong if this metric has multiple series** (per pod, per route), because it computes a *per-series* p99 and you almost never want that. To get a fleet-wide p99 you must aggregate buckets *before* the quantile:

```promql
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

`sum by (le)` merges all instances' buckets into one distribution; then the quantile is computed once over the whole thing. Add other grouping labels (`route`) if you want per-route p99: `sum by (le, route) (...)`. Talking point: this is the "you can't average p99s" rule expressed in PromQL — aggregate the raw buckets, *then* take the percentile.

### Q: Fix the labels on this instrumentation.

```python
REQUESTS.labels(
    path=request.path,                    # "/users/42/orders/98"
    error=str(exc),                       # "timeout connecting to 10.0.0.5:5432"
    customer=request.customer_id,         # "cus_8Kd2"
    status=str(response.status_code),     # "503"
).inc()
```

Every label here is a cardinality bomb except (arguably) status:

```python
REQUESTS.labels(
    route=request.url_rule,               # "/users/:id/orders/:id"  (template)
    error_type=classify(exc),             # "upstream_timeout"       (bounded set)
    tier=customer.tier,                   # "enterprise"             (bounded)
    status_class=f"{response.status_code // 100}xx",  # "5xx"        (5 values)
).inc()
```

Talking points: `path` → route **template**; raw exception string (embeds IP/port) → bounded `error_type` from a classifier; `customer_id` → `tier` (identity → category; the ID goes to a trace); raw status code (60 values) → `status_class` (5 values, and what error-rate alerts query). Net series drop is many orders of magnitude.

### Q: This service exposes `request_latency_ms` as a gauge set to the last request's duration. What's wrong and how do you fix it?

Two bugs. (1) **Wrong unit** — `_ms` instead of base SI `_seconds`, fighting Grafana auto-format and any cross-service comparison. (2) **Wrong type** — a gauge holds *one* value (the most recent request), so it's blind to the distribution; you can never compute p50/p95/p99, and you see whatever the last request happened to be. A burst of slow requests between scrapes is invisible.

Fix: make it a **histogram** named `request_duration_seconds`, observing each request's duration in seconds:

```python
DURATION = Histogram(
    "http_request_duration_seconds",
    "Request latency in seconds.",
    ["route", "method"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
)
DURATION.labels(route, method).observe(elapsed_seconds)
```

Now p99 across the fleet is `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`.

### Q: Write the minimal RED instrumentation for one HTTP handler. Talk me through the label choices.

```go
var (
    reqs = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "http_requests_total",
        Help: "HTTP requests by method, route, status class.",
    }, []string{"method", "route", "status_class"})

    dur = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name: "http_request_duration_seconds",
        Help: "Request latency by method and route.",
        Buckets: prometheus.DefBuckets,
    }, []string{"method", "route"})

    inFlight = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "http_requests_in_flight",
        Help: "In-flight requests (saturation).",
    })
)

func Instrument(route string, next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        inFlight.Inc()
        defer inFlight.Dec()
        rec := &statusRecorder{ResponseWriter: w, code: 200}
        start := time.Now()
        next(rec, r)
        cls := strconv.Itoa(rec.code/100) + "xx" // "2xx".."5xx"
        reqs.WithLabelValues(r.Method, route, cls).Inc()
        dur.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
    }
}
```

Choices: **`route` is the template** passed in (`/users/:id`), never `r.URL.Path` (bomb). **`status_class`** (5 values) not the raw code (60) — and it's what alerts query. Counter `_total` gives Rate and (via the class) Errors; histogram `_seconds` gives Duration; the gauge gives Saturation. That's all of RED + saturation from one wrapper, bounded by construction. Talking point: the `defer inFlight.Dec()` and recording on the way out mean panics and early returns are still measured.

---

## Behavioral / Experience

### Q: Tell me about a time a metric (or its absence) caused or prolonged an incident.

The interviewer wants arc, evidence, surprise, lesson — not "I love observability."

Example skeleton:

- **Symptom.** Checkout error rate climbing, but the dashboard had 40 bespoke business metrics and *not one* showed the 5xx rate — RED was never instrumented.
- **Wrong first move.** Team chased the business metrics, suspecting a pricing bug.
- **Investigation.** Pulled raw access logs, computed the error rate by hand, saw it was upstream payment timeouts — invisible because there was no error-rate metric and no latency split.
- **Resolution.** Added a RED middleware (rate/errors/duration, status split) fleet-wide; the next occurrence paged in 90 seconds.
- **Lesson.** Instrument the *standard* signals before the clever ones. Bespoke metrics are second, not first.

Tell *one* incident, with concrete numbers.

### Q: Describe a cardinality incident you were involved in.

Pick a specific story where series count — not sample volume — was the killer. Important elements: the label that did it (almost always an identity "added to debug"), the blast radius (every tenant of the shared TSDB went blind), and the fix (identity → category, move per-entity debugging to traces, add a series-count alert + per-target limit). Bonus if you mention the diagnosis query (`topk` by series per metric on a healthy replica) and that you added a tripwire afterwards so the next one trips a limit instead of an outage.

### Q: Tell me about a time you removed or simplified metrics rather than adding them.

Shows maturity — most engineers only ever add. Example: "We had three overlapping latency metrics — a summary, a gauge of last-duration, and a histogram — emitted by different generations of code. The summary made fleet p99 impossible to compute, the gauge was noise, and the histogram was the only correct one. I deprecated the first two, migrated dashboards to the histogram, and cut series count and confusion at once. Lesson: a metric you can't aggregate correctly is worse than no metric, because it gives false confidence."

### Q: When did a metric mislead you, and what did you learn?

"Average latency was flat and healthy through a customer-reported slowdown. I trusted the average for two days before someone asked for p99 — which was 6× the mean. The 95% fast requests masked a slow 5%. I'd been watching the one statistic that's blind to the tail. Now the first latency panel on every dashboard is a percentile distribution, never a mean, and 'show me the average' is a yellow flag in design reviews."

### Q: Tell me about standardising metrics across a fleet or team.

Shows you can drive consistency, not just instrument one service. "Two teams emitted the same concept as `latency_ms` and `request_seconds` with different label sets — no cross-service dashboard was possible and shared recording rules broke. I wrote a thin instrumentation library (RED middleware, base-SI units, fixed label set: method/route/status_class) that teams adopted, plus a CI lint banning `_ms` suffixes and identity-shaped label names. Lesson: naming and label sets are an API; consistency has to be *enforced*, not requested."

---

## What I'd Ask a Candidate Now

Questions that separate "knows the model" from "has run metrics in anger."

### Q: How do you decide whether a new dimension belongs in a metric label, a log field, or a trace attribute?

Listening for the bounded-value-set test, not a vibe. Strong answer: "If the value set is small, finite, and can't grow with users/traffic/time/deploys — label. If it's identity or unbounded but I want it per-case — log field or trace attribute. The deciding question is always 'can this grow without limit?' If yes, it never touches a metric label." Bonus: knowing that the *same* `user_id` that's lethal as a label is perfectly fine as a trace attribute.

### Q: Why can't you average percentiles, and how do you compute a fleet p99 correctly?

The single best discriminator for senior metrics knowledge. Strong answer states that a percentile is a property of a distribution, the average of percentiles corresponds to no real request, and the only correct path is to aggregate the raw distributions (sum histogram buckets across instances) *then* take the quantile. A candidate who shrugs and says "just average them" hasn't run latency at scale.

### Q: When would you reach for a summary over a histogram, if ever?

Mostly a trap — the right answer is "almost never for anything you aggregate." Acceptable: a single-instance, non-aggregated quantile where you want exact client-side percentiles and don't care about fleet roll-up, or where bucket cardinality is genuinely prohibitive. A candidate who reaches for summaries by default, or doesn't know they're un-aggregatable, reveals the gap.

### Q: Your dashboard and your customers disagree about whether the service is healthy. Walk me through reconciling them.

Black-box-meets-instrumentation thinking. Listening for: check what the metric actually measures (server time vs end-to-end), check the percentile (p99 ≠ p99.9 ≠ tail of a fan-out), check success/error split, check bucket resolution, add RUM/edge measurement. The candidate who says "the metric must be right, it's the customer's network" is the wrong hire.

### Q: How do you keep metrics cost under control as a system grows?

Reveals operational maturity. Good answers: series-count budgets and alerts, per-target ingestion limits, cardinality lint in CI, downsampling for long-term retention, recording rules for hot aggregations, and the discipline that metrics cost is cardinality × retention (not sampling — that's for traces). Bad sign: "we'd just buy more Prometheus RAM."

### Q: What's a metric anti-pattern you see constantly, and how do you push back on it?

Self-aware, opinionated answer expected: "Averages on the dashboard," "raw status code as a label," "label data baked into the metric name," "alerting on raw error count," "a `user_id` label 'temporarily'." The push-back matters more than the list — how do you teach the team without being the metrics police?

---

## Cheat Sheet

Top-10 must-know questions for any metrics interview:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW METRICS QUESTIONS                                               │
├──────────────────────────────────────────────────────────────────────────┤
│  1. The four instrument types?                                           │
│       → Counter (monotonic), Gauge (up/down), Histogram (distribution),  │
│         Summary (client-side quantiles, NOT aggregatable).               │
│                                                                          │
│  2. What is cardinality and why does it kill a TSDB?                     │
│       → Product of label value counts; SERIES count drives RAM/index.    │
│         user_id label = OOM = whole fleet blind.                         │
│                                                                          │
│  3. Good label vs bad label — the test?                                 │
│       → "Can the value set grow without limit?" yes → it's a LOG field.  │
│         Dimension, don't identify: path→route, customer_id→tier.         │
│                                                                          │
│  4. Why can't you average two p99s?                                     │
│       → Percentile is a property of a distribution. Aggregate raw        │
│         histogram buckets first, THEN histogram_quantile.                │
│                                                                          │
│  5. Histogram vs summary?                                               │
│       → Histogram: buckets, aggregatable, fleet p99. Summary: per-       │
│         instance quantiles, NOT mergeable. Prefer histogram.            │
│                                                                          │
│  6. Naming & units — why do they matter?                                │
│       → Tools PARSE them. _total on counters, base SI _seconds/_bytes,  │
│         snake_case, no label data in the name.                          │
│                                                                          │
│  7. Four Golden Signals / RED / USE?                                    │
│       → Latency, Traffic, Errors, Saturation. RED=services,             │
│         USE=resources. Saturation is the LEADING indicator.             │
│                                                                          │
│  8. Pull vs push?                                                        │
│       → Pull (Prometheus) for long-lived; push (StatsD/OTLP/Pushgw)     │
│         for ephemeral jobs. Failed scrape = free liveness.              │
│                                                                          │
│  9. Why split success vs error latency?                                 │
│       → A flood of fast 500s drags p99 DOWN, flattering a dying system. │
│                                                                          │
│ 10. Where does OpenTelemetry fit?                                       │
│       → Vendor-neutral API + OTLP + Collector; views for cardinality;  │
│         cumulative vs delta temporality; exemplars → traces.            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **Google SRE Book — "Monitoring Distributed Systems"** (Four Golden Signals) — <https://sre.google/sre-book/monitoring-distributed-systems/>.
- **Tom Wilkie — "The RED Method"** — <https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/>.
- **Brendan Gregg — "The USE Method"** — <https://www.brendangregg.com/usemethod.html>.
- **Prometheus — "Metric and label naming"** and **"Histograms and summaries"** — <https://prometheus.io/docs/practices/naming/>, <https://prometheus.io/docs/practices/histograms/>.
- **Prometheus — "Cardinality is key"** and `prometheus_tsdb_head_series` — monitoring your monitoring.
- **OpenTelemetry — Metrics Data Model & SDK** (instruments, views, temporality, exemplars) — <https://opentelemetry.io/docs/specs/otel/metrics/>.
- **"Observability Engineering" — Majors, Fong-Jones, Miranda** — the definitive cardinality argument and the metrics-vs-wide-events boundary.
- **Google SRE Workbook — "Alerting on SLOs"** — multi-window burn-rate alerting done right.

---

## Related Topics

- [Metrics — Junior](junior.md)
- [Metrics — Middle](middle.md)
- [Metrics — Senior](senior.md)
- [Metrics — Professional](professional.md)
- [Metrics — Tasks](tasks.md)
- [Logging — Interview](../logging/interview.md)
- [Tracing — Interview](../tracing/interview.md)
- [Debugging — Interview](../debugging/interview.md)
