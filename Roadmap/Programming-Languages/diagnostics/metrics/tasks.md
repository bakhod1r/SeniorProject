# Metrics — Hands-On Exercises

> **Topic:** [Metrics Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can increment a counter" to "I can design the cardinality budget, histogram buckets, and OTEL pipeline for a fleet of services."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

You cannot learn metrics from reading any more than you can learn debugging from reading. You learn it by exposing a `/metrics` endpoint, querying it with PromQL, watching a dashboard lie to you because you used an average instead of a histogram, and blowing up a local Prometheus with a `user_id` label so you never do it in production. The exercises below are tiered. The **Warm-Up** band trains the mechanics — declare a counter, expose an endpoint, scrape it, read the exposition format — so that emitting a correct metric is reflex, not a copy-paste from a blog. The **Core** band is about the two things that decide whether metrics help or hurt: **labels/cardinality** and the **standard signal sets** (RED, USE, golden signals) on a real service. The **Advanced** band drops you into the situations that separate middle from senior engineers — designing histogram buckets to an SLO, reproducing and fixing a cardinality explosion, aggregating percentiles correctly across a fleet, controlling cost. The **Capstone** band stops being about clients and starts being about strategy: instrument a polyglot system end to end, wire OpenTelemetry with exemplars, and write the cardinality governance that keeps the next engineer from OOM-ing the TSDB.

Do not skip ahead. The Capstone tasks assume you can write a `histogram_quantile` query without looking it up and that you instinctively reach for the route *template* instead of the path. If you are still unsure why a summary can't be re-aggregated mid-incident, you will design the wrong thing under pressure. Work each band end-to-end. If a task takes more than the stated time, write down what blocked you — that note tells you which level doc to re-read.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on tooling. You need a local Prometheus (a single static binary), the client library for one language you're comfortable in (Go's `client_golang`, Python's `prometheus_client`, Java's Micrometer, Node's `prom-client`, or Rust's `metrics`), and — for the OTEL tasks — an OpenTelemetry Collector and a backend that supports exemplars (Tempo + Prometheus, or Grafana Cloud). Everything here runs on a laptop with Docker.

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the mechanics — declare, expose, scrape, read — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of `junior.md`.

### Task 1: Pick the right metric type for ten quantities

**Problem.** For each of the ten quantities below, name the correct metric type (counter, gauge, histogram, or summary) and justify it in one clause.

```
1.  total number of HTTP requests served since startup
2.  current number of items in an in-memory queue
3.  request latency, where you need p50/p95/p99
4.  current free disk space in bytes
5.  total bytes written to a log file
6.  number of database connections currently checked out of the pool
7.  payment amounts, where you need a fleet-wide p99 amount
8.  CPU temperature in Celsius
9.  count of cache hits vs misses
10. age in seconds of the oldest unacknowledged message in a queue
```

**Constraints.**
- No type may be "it depends" — commit to one and defend it.
- For anything you call a histogram, name whether you'd ever use a summary instead and why not.

**Hints.**
- Counters only go up (and reset to zero on restart). Gauges go up *and* down.
- "I need a percentile aggregated across machines" → histogram, never summary.
- A "current value that moves both directions" is the gauge tell.

**Self-check.**
- [ ] #1, #5, #9 are counters; #2, #4, #6, #8, #10 are gauges; #3, #7 are histograms.
- [ ] You can explain why #7 (fleet-wide p99) rules out a summary.
- [ ] You did not call any latency a gauge.

### Task 2: Declare and increment a counter in your language

**Problem.** Write the smallest possible program that declares a counter `jobs_processed_total`, increments it five times, and prints the current value (or exposes it — your choice for this warm-up).

**Constraints.**
- Use a real client library (`client_golang`, `prometheus_client`, Micrometer, `prom-client`, or `metrics`), not a hand-rolled integer.
- The metric name must end in `_total`.
- No labels yet.

**Hints.**
- Go: `promauto.NewCounter(prometheus.CounterOpts{Name: "jobs_processed_total", Help: "..."})`.
- Python: `Counter("jobs_processed_total", "...")` then `.inc()`.
- Every metric needs a non-empty `Help` string — get used to writing it.

**Self-check.**
- [ ] The name ends in `_total`.
- [ ] You wrote a Help string.
- [ ] The value is 5.

### Task 3: Expose a `/metrics` endpoint and curl it

**Problem.** Take the counter from Task 2 and expose it over HTTP at `/metrics` using your client library's built-in handler. Hit it with `curl` and read the raw output.

**Constraints.**
- Use the library's default exposition handler — do not format the text yourself.
- `curl localhost:<port>/metrics` must return the metric plus the default process/runtime metrics.

**Hints.**
- Go: `http.Handle("/metrics", promhttp.Handler())`.
- Python: `start_http_server(8000)` from `prometheus_client`.
- Node: `app.get("/metrics", async (_, res) => res.end(await register.metrics()))`.

**Self-check.**
- [ ] `curl` returns `# HELP` and `# TYPE` lines before your metric.
- [ ] You can see your `jobs_processed_total 5` line.
- [ ] You also see default metrics (`process_*`, `go_*`, `python_gc_*`, etc.).

### Task 4: Read the exposition format by hand

**Problem.** Given the raw `/metrics` text below, answer four questions without running anything.

```
# HELP http_request_duration_seconds Request latency.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/checkout",le="0.1"} 240
http_request_duration_seconds_bucket{route="/checkout",le="0.5"} 290
http_request_duration_seconds_bucket{route="/checkout",le="1"} 297
http_request_duration_seconds_bucket{route="/checkout",le="+Inf"} 300
http_request_duration_seconds_sum{route="/checkout"} 41.7
http_request_duration_seconds_count{route="/checkout"} 300
```

1. How many requests took **more than 0.5s** but at most 1s?
2. What is the **average** latency?
3. How many total requests are represented?
4. Why is the `le="+Inf"` bucket count always equal to `_count`?

**Constraints.**
- Reading only. No code.

**Hints.**
- Buckets are **cumulative**: each `le` count includes everything below it.
- Requests in `(0.5, 1]` = `bucket{le="1"}` − `bucket{le="0.5"}`.
- Average = `_sum / _count`.

**Self-check.**
- [ ] (0.5, 1]: `297 − 290 = 7`.
- [ ] Average: `41.7 / 300 = 0.139s`.
- [ ] Total: 300; and `+Inf` = count because every observation is ≤ infinity.

### Task 5: Scrape your service with a local Prometheus

**Problem.** Configure a local Prometheus to scrape the endpoint from Task 3 every 5 seconds, run it, and confirm in the Prometheus UI that your metric is being collected.

**Constraints.**
- Write a `prometheus.yml` with one `scrape_config` and a 5s `scrape_interval`.
- Confirm via the Prometheus `/targets` page that the target is **UP**.

**Hints.**
```yaml
global:
  scrape_interval: 5s
scrape_configs:
  - job_name: myservice
    static_configs:
      - targets: ["host.docker.internal:8000"]
```
- `prometheus --config.file=prometheus.yml`.
- Use `host.docker.internal` if Prometheus runs in Docker and your service on the host.

**Self-check.**
- [ ] `/targets` shows your job as **UP** with a recent scrape.
- [ ] Querying `jobs_processed_total` in the UI returns a series.
- [ ] You see the `up{job="myservice"}` synthetic metric equal to 1.

### Task 6: Fix five badly named metrics

**Problem.** Each metric name below violates a naming/unit convention. Rewrite all five correctly and state the rule each broke.

```
1.  responseTimeMs            (a latency measurement)
2.  request_count             (a monotonic request counter)
3.  memory_kb                 (resident memory of the process)
4.  http_get_requests_total   (count of GET requests)
5.  cache_hit_percent         (cache hit fraction)
```

**Constraints.**
- Use Prometheus/OpenMetrics conventions: `snake_case`, base SI units in the suffix, `_total` on counters, no label data in the name.
- Ratios are unitless 0–1 with `_ratio`, not `_percent`.

**Hints.**
- Time → `_seconds`, size → `_bytes`, never `_ms`/`_kb`.
- `http_get_requests_total` bakes a label into the name — use a `method` label.

**Self-check.**
- [ ] `http_request_duration_seconds` (histogram), `requests_total`, `process_resident_memory_bytes`, `http_requests_total{method="GET"}`, `cache_hit_ratio`.
- [ ] You named the broken rule for each (unit, type-suffix, label-in-name, ratio).

### Task 7: Write your first three PromQL queries

**Problem.** Against the metric `http_requests_total{method, route, status_class}`, write the PromQL for: (1) requests per second over the last minute, (2) the 5xx error *rate* per second, (3) the error *ratio* (5xx as a fraction of all requests).

**Constraints.**
- Use `rate()` with a range vector, not raw counter values.
- The error ratio must be a number between 0 and 1.

**Hints.**
- `rate(http_requests_total[1m])` — and remember `rate` handles counter resets.
- Ratio = `sum(rate(...{status_class="5xx"}[1m])) / sum(rate(...[1m]))`.
- Use `sum(...)` to collapse the other labels.

**Self-check.**
- [ ] Query 1: `sum(rate(http_requests_total[1m]))`.
- [ ] Query 2: `sum(rate(http_requests_total{status_class="5xx"}[1m]))`.
- [ ] Query 3 divides the two and lands in [0, 1].

**Sample Solution.**

```promql
# 1. Traffic — requests per second
sum(rate(http_requests_total[1m]))

# 2. Error rate — failed requests per second
sum(rate(http_requests_total{status_class="5xx"}[1m]))

# 3. Error ratio — fraction of requests that failed (0..1)
sum(rate(http_requests_total{status_class="5xx"}[1m]))
  /
sum(rate(http_requests_total[1m]))
```

### Task 8: Add a label and observe the series multiply

**Problem.** Take your `jobs_processed_total` counter and add a single bounded label `status` with values `{ok, error}`. Increment both. Then add a second label `worker` with 3 values. Predict the series count *before* you scrape, then verify.

**Constraints.**
- Predict the cardinality (the product) on paper first.
- Verify with `count by (__name__)({__name__="jobs_processed_total"})` in Prometheus.

**Hints.**
- 1 metric, no labels = 1 series. `status` (2) = 2 series. `status` (2) × `worker` (3) = 6 series.
- The product, not the sum — internalise this now, cheaply.

**Self-check.**
- [ ] You predicted 6 series and the query confirms 6.
- [ ] You can articulate why it's 2×3, not 2+3.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine a client, Prometheus, and PromQL, read output critically, and produce a written explanation. If you can do all of them comfortably, you're at the middle level.

### Task 9: Instrument a service with RED metrics

**Problem.** You are given (or write) a small HTTP service with 3–5 endpoints. Add **one** middleware/interceptor that produces RED — Rate, Errors, Duration — for every endpoint, with bounded labels.

**Constraints.**
- One counter `http_requests_total{method, route, status_class}` and one histogram `http_request_duration_seconds{method, route}`.
- The `route` label MUST be the route **template** (`/users/:id`), never the concrete path.
- `status_class` MUST be `2xx`/`4xx`/`5xx` (5 values), not the raw code.
- The whole handler is timed, including early returns and panics (default status to 500 in a `finally`/`defer`).

**Hints.**
- Express: `req.route.path` is the template; `req.path` is the bomb.
- Go: capture the status with a `ResponseWriter` wrapper; pass the template into the middleware per route.
- Default `status = 500` before the handler runs so an escaped exception is recorded as 5xx.

**Self-check.**
- [ ] `curl /metrics` shows `route="/users/:id"`, never `/users/42`.
- [ ] Hammering one endpoint moves only that route's series.
- [ ] An endpoint that throws records a `5xx`, not nothing.

**Sample Solution.**

```python
from prometheus_client import Counter, Histogram, Gauge
import time
from functools import wraps

REQUESTS = Counter(
    "http_requests_total", "HTTP requests by method/route/status class.",
    ["method", "route", "status_class"],
)
DURATION = Histogram(
    "http_request_duration_seconds", "Request latency by method/route.",
    ["method", "route"],
)
IN_FLIGHT = Gauge("http_requests_in_flight", "Requests in flight (saturation).")

def instrument(route):                       # route is the TEMPLATE
    def deco(handler):
        @wraps(handler)
        def wrapper(request):
            IN_FLIGHT.inc()
            start = time.perf_counter()
            status = 500                     # pessimistic default
            try:
                response = handler(request)
                status = response.status_code
                return response
            finally:
                IN_FLIGHT.dec()
                cls = f"{status // 100}xx"   # 2xx/4xx/5xx — bounded
                REQUESTS.labels(request.method, route, cls).inc()
                DURATION.labels(request.method, route).observe(
                    time.perf_counter() - start)
        return wrapper
    return deco
```

### Task 10: Build the three RED queries and a saturation query

**Problem.** Using the metrics from Task 9, write and verify the four PromQL queries that constitute a service health view: request rate, error ratio, p99 duration, and in-flight saturation.

**Constraints.**
- p99 must come from the histogram buckets via `histogram_quantile`.
- The error ratio is 5xx over all requests, in [0, 1].
- All four queries must return data when you drive a little load at the service.

**Hints.**
- `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`.
- Always `rate()` the `_bucket` before `histogram_quantile` — never the raw bucket.
- Saturation is just `http_requests_in_flight` (a gauge) or its `max_over_time`.

**Self-check.**
- [ ] p99 query returns a value in seconds, and it rises when you add artificial latency.
- [ ] You aggregated `by (le)` inside `histogram_quantile`, not outside.
- [ ] You can read all four on one Grafana row.

**Sample Solution.**

```promql
# Rate
sum(rate(http_requests_total[1m]))

# Errors (ratio, 0..1)
sum(rate(http_requests_total{status_class="5xx"}[1m]))
  / sum(rate(http_requests_total[1m]))

# Duration p99 — note the rate() on _bucket and the by (le)
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)

# Saturation — in-flight requests right now
max_over_time(http_requests_in_flight[1m])
```

### Task 11: Convert a gauge-latency anti-pattern to a histogram

**Problem.** You are handed a service that records latency as a gauge holding the *last* request's duration (`last_request_seconds`). Show why this is wrong, then replace it with a histogram and demonstrate a correct p95.

**Constraints.**
- Drive a mixed workload (most requests fast, ~5% slow) at the service.
- Capture the gauge value and the histogram p95 side by side and explain the divergence.
- Do not remove the slow requests — the point is that the gauge hides them.

**Hints.**
- A gauge holds one value; whatever the last request was, that's all you see.
- The histogram's p95 will reflect the slow tail; the gauge will flap to whatever finished last.
- `histogram_quantile(0.95, sum by (le)(rate(..._bucket[5m])))`.

**Self-check.**
- [ ] You produced a window where the gauge reads fast but p95 is slow.
- [ ] You can state in one sentence why the gauge is blind to the tail.
- [ ] The histogram p95 matches the ~5% slow requests you injected.

### Task 12: Add USE metrics for a resource

**Problem.** Pick a resource your service depends on — a DB connection pool, a thread pool, or a bounded work queue — and instrument it with **USE**: Utilisation, Saturation, Errors.

**Constraints.**
- Utilisation: `in_use / max` as a gauge ratio (0–1).
- Saturation: the *waiting* signal — queue depth or pool-wait count, not just utilisation.
- Errors: a counter of acquisition failures/timeouts.
- Demonstrate a moment where utilisation is high but saturation is still zero, and one where both are high.

**Hints.**
- Utilisation ≠ saturation: a pool can be 100% checked out with nobody waiting (fine), versus checked out *with a wait queue* (saturated).
- Most pool libraries expose `active`, `idle`, `max`, and `pending` — wire those.
- HikariCP, `pgxpool`, and `pg` (Node) all expose pool stats.

**Self-check.**
- [ ] You have three metrics: a utilisation ratio gauge, a saturation gauge, an error counter.
- [ ] You produced a high-utilisation/zero-saturation window and a high/high window.
- [ ] You can explain why utilisation alone would have missed the saturation event.

### Task 13: Reproduce a cardinality explosion locally

**Problem.** Deliberately blow up your local Prometheus. Add a `user_id` (or `request_id`) label to a metric, generate traffic with thousands of distinct values, and watch the series count and Prometheus RAM climb.

**Constraints.**
- Generate at least 50,000 distinct label values.
- Capture `prometheus_tsdb_head_series` over time and the Prometheus process RSS.
- Do NOT fix it yet — this task is about *seeing* the failure.

**Hints.**
- Loop `curl localhost:8000/do?user=$(uuidgen)` 50k times, or generate IDs in code.
- Watch `prometheus_tsdb_head_series` and `process_resident_memory_bytes{job="prometheus"}`.
- `topk(5, count by (__name__)({__name__=~".+"}))` shows which metric dominates.

**Self-check.**
- [ ] `prometheus_tsdb_head_series` jumped by ~50,000.
- [ ] Your offending metric is the top entry in the `topk` query.
- [ ] You watched Prometheus RAM rise and can state the relationship (series, not samples, drive RAM).

### Task 14: Fix the cardinality explosion

**Problem.** Take the exploded metric from Task 13 and fix it: replace the identity label with a bounded category, prove the series count collapses, and document where the per-user data should now live.

**Constraints.**
- Replace `user_id` with a bounded label (`user_tier`, `plan`, or drop it entirely).
- Show the before/after series count for that metric name.
- Write one paragraph: where does per-user drill-down go now (logs? traces? warehouse?) and why.

**Hints.**
- The fix is "dimension, don't identify": `customer_id` → `tier`, raw path → route template.
- If you need an allow-list for free-form values, map unknowns to `"other"`.
- Per-user belongs in traces (as a span attribute) or a wide-event store — never the TSDB.

**Self-check.**
- [ ] The metric's series count drops from ~50,000 to a handful.
- [ ] You can run the original "which kind of user" query on the bounded label.
- [ ] Your paragraph names the correct home for per-user data.

### Task 15: Add a relabel/metric_relabel rule to drop a label at scrape time

**Problem.** Suppose a third-party exporter you cannot modify emits a high-cardinality label (`pod_template_hash`, a build SHA, or `instance` with churn). Use Prometheus `metric_relabel_configs` to drop or rewrite that label *before* storage.

**Constraints.**
- Edit only `prometheus.yml` — you may not change the target's code.
- Either drop the label entirely (`labeldrop`) or collapse it to a bounded value (`replace`/`labelmap`).
- Confirm the series count for that metric drops after a reload.

**Hints.**
```yaml
metric_relabel_configs:
  - regex: pod_template_hash
    action: labeldrop
```
- `labeldrop` removes a label by name; `replace` can normalise a value via regex.
- Reload with `kill -HUP <pid>` or `--web.enable-lifecycle` + `POST /-/reload`.

**Self-check.**
- [ ] The unwanted label no longer appears on the metric.
- [ ] Series count for that metric dropped.
- [ ] You understand the difference between `relabel_configs` (pre-scrape, target selection) and `metric_relabel_configs` (post-scrape, sample filtering).

### Task 16: Split "we failed" from "they failed"

**Problem.** Your 5xx error metric lumps your own bugs together with downstream timeouts. Add a bounded `error_source` label (`internal`/`upstream`/`client`) and write the two alert queries that distinguish "our fault" from "their fault".

**Constraints.**
- `error_source` has exactly three values — keep it bounded.
- Classify in the middleware/handler, not by parsing logs later.
- Produce two queries: internal-error rate and upstream-error rate.

**Hints.**
- A timeout calling a dependency is `upstream`; a `nil` panic is `internal`; a 400 from a bad request body is `client`.
- This is the "RED's errors can disagree with HTTP status" subtlety — decide what *counts* as an error and where the blame lies.
- Don't make `error_source` free text; map unknown causes to a default.

**Self-check.**
- [ ] `error_source` only ever takes 3 values.
- [ ] You can alert on internal errors without paging for an upstream outage.
- [ ] A handler that returns 200 with an error body is classified correctly (decide your rule and state it).

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical design, not raw speed. Several have no single right answer — they have defensible writeups.

### Task 17: Design histogram buckets for a latency SLO

**Problem.** You have an SLO: **99% of `POST /checkout` requests complete in under 300ms.** Design the histogram buckets so that your p99 estimate near the 300ms boundary is accurate, and prove the design against a realistic latency distribution.

**Constraints.**
- The buckets MUST place explicit boundaries tight around the SLO threshold (300ms) so the quantile interpolation there is accurate.
- Keep the bucket count reasonable (roughly 10–15) — every bucket is a series per label combination.
- Validate by feeding a synthetic distribution (e.g. log-normal centred near 200ms with a tail to 2s) and comparing the histogram's `histogram_quantile(0.99, ...)` to the true p99 you compute directly from the samples.

**Hints.**
- `histogram_quantile` interpolates *linearly within the bucket that contains the quantile* — so the bucket straddling your SLO must be narrow, or the estimate is mush.
- Put boundaries at, say, `…, 0.25, 0.3, 0.35, …` so 300ms sits on a boundary, not mid-bucket.
- Coarse default buckets (`5ms→25ms→100ms→…`) are fine for general use but wrong for a tight SLO.
- Consider whether **native/exponential histograms** (Prometheus native histograms, OTEL exponential) sidestep manual bucket design here — discuss the trade-off.

**Self-check.**
- [ ] Your bucket list has explicit boundaries clustered around 300ms.
- [ ] Your histogram p99 is within a few percent of the true p99 from raw samples.
- [ ] You can explain the interpolation error you'd get if the 300ms boundary fell mid-bucket.
- [ ] You stated when you'd reach for native histograms instead.

**Sample Solution.**

```text
SLO boundary: 0.300s. Cluster buckets tightly around it.

buckets = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.75, 1, 2.5]
                                       ^^^^ SLO sits ON a boundary

# SLO compliance directly from the cumulative bucket at le=0.3:
(
  sum(rate(http_request_duration_seconds_bucket{route="/checkout",le="0.3"}[5m]))
  /
  sum(rate(http_request_duration_seconds_count{route="/checkout"}[5m]))
)  # >= 0.99  ==>  SLO met

# p99 estimate — accurate because 0.3 is a real boundary, not interpolated guesswork
histogram_quantile(0.99,
  sum by (le)(rate(http_request_duration_seconds_bucket{route="/checkout"}[5m])))
```

Verification: generate 100k log-normal samples (median ~0.2s, tail to 2s), compute the exact p99 with `numpy.percentile`, feed the same samples into the histogram, and confirm the two p99s agree to within ~2%.

### Task 18: Prove a summary cannot be aggregated across instances

**Problem.** Run the *same* service on two instances, each emitting latency as a **summary** with pre-computed p99 (`...{quantile="0.99"}`). Then run them with a **histogram**. Show that you can compute a correct fleet-wide p99 from the histograms and that there is no correct way to do it from the summaries.

**Constraints.**
- Both instances must see *different* latency distributions (e.g. instance A fast, instance B slow).
- Demonstrate that averaging the two summary p99s gives a wrong number.
- Demonstrate that summing the histogram buckets and then quantile-ing gives the right number.

**Hints.**
- The summary exposes `quantile="0.99"` per instance — there is no math that combines two per-instance p99s into a fleet p99. Averaging quantiles is meaningless.
- Histograms expose `_bucket{le}` counts, which are *additive* across instances; sum them, then `histogram_quantile`.
- Compute the ground-truth fleet p99 from the raw samples to compare against.

**Self-check.**
- [ ] You showed the averaged summary p99 differs materially from the true fleet p99.
- [ ] You showed the summed-histogram p99 matches the true fleet p99.
- [ ] You can state the one-sentence rule: quantiles don't aggregate; bucket counts do.

### Task 19: Wire OpenTelemetry metrics with exemplars

**Problem.** Instrument your service's latency histogram using the **OpenTelemetry** metrics SDK, export via OTLP to a Collector, and attach **exemplars** so that a point on the latency histogram links to a concrete trace. Then, from a spike in the p99 panel, click through to the exact slow trace.

**Constraints.**
- Use the OTEL metrics SDK (not the Prometheus client) for the histogram.
- Exemplars must carry the `trace_id`/`span_id` of a sampled request that landed in that bucket.
- Export to an OTEL Collector; surface in Prometheus (with exemplar storage) + Tempo, or Grafana Cloud.
- Demonstrate the click-through: dashboard p99 spike → exemplar dot → trace.

**Hints.**
- Exemplars require an active span context at the moment you record the histogram observation — instrument *inside* the traced request.
- Prometheus needs `--enable-feature=exemplar-storage`; OTLP scrape/remote-write must preserve exemplars.
- The OTEL SDK attaches exemplars automatically when a sampling span is active and exemplar filters allow it — verify your `ExemplarFilter` isn't dropping them.
- Keep the histogram's labels bounded (route, method) exactly as in the Prometheus version — OTEL doesn't save you from cardinality.

**Self-check.**
- [ ] Your `/metrics` (or OTLP export) carries exemplars with a `trace_id`.
- [ ] A point on the p99 panel shows an exemplar marker.
- [ ] Clicking it opens the corresponding trace in Tempo/Jaeger.
- [ ] You confirmed the histogram labels stayed bounded.

### Task 20: Build a cardinality budget and a tripwire

**Problem.** Define a per-service **cardinality budget** (a hard cap on active series), and build a tripwire that alerts *before* the next accidental `merchant_id` label OOMs the TSDB.

**Constraints.**
- Set a budget per metric name and per service (e.g. "no single metric > 50k series; no service > 200k").
- Write a Prometheus alert on `prometheus_tsdb_head_series` and on per-metric series counts.
- Demonstrate the alert firing by adding a high-cardinality label, then clearing it by fixing the label.

**Hints.**
- Per-metric series: `count by (__name__)({__name__=~".+"})`; alert when any exceeds the budget.
- Total head series: `prometheus_tsdb_head_series` with an alert threshold below your OOM point.
- A client-side guard (Micrometer's `MeterFilter.maximumAllowableTags`, or an allow-list in your wrapper) stops the bomb *before* it reaches Prometheus — wire one in too.

**Self-check.**
- [ ] You have a numeric budget written down per metric and per service.
- [ ] The alert fires when you exceed it and resolves when you fix the label.
- [ ] You added at least one client-side cap so the bomb is contained at the source.

### Task 21: Control metrics cost with sampling and aggregation

**Problem.** Your metrics bill (series count, ingestion, retention) is too high. Reduce it without losing the ability to diagnose incidents. Apply at least three levers and quantify the savings.

**Constraints.**
- Apply: (a) dropping a needless label via relabeling, (b) collapsing raw status codes to status classes, (c) pre-computing an expensive dashboard query with a **recording rule**, and (d) at least one of: longer scrape interval for cheap-to-coarsen metrics, histogram bucket reduction, or aggregation/rollup at the Collector.
- Measure series count and (if available) ingestion before and after.
- Argue which signals you must NOT coarsen (the golden signals) and why.

**Hints.**
- Recording rules turn a heavy `histogram_quantile(...)` dashboard query into a cheap stored series — cost moves from query-time to a fixed, predictable write.
- Dropping `status` code (60 values) for `status_class` (5) cuts that metric ~12×.
- A 5s scrape interval on a metric that changes slowly is waste; 30s may be plenty — but never coarsen latency/error signals you alert on.
- The OTEL Collector can aggregate/drop before remote-write — push cost reduction to the pipeline, not every service.

**Self-check.**
- [ ] You applied at least three distinct levers.
- [ ] You quantified the series/ingestion reduction.
- [ ] You can defend which signals you left at full fidelity and why.

### Task 22: Hunt and kill metric anti-patterns in a real codebase

**Problem.** Take an existing service (yours or an open-source one) and audit its metrics for anti-patterns. Produce a written report and a PR fixing the worst three.

**Constraints.**
- Check for: unbounded labels (paths, IDs, error messages), wrong units (`_ms`, `_kb`), counters without `_total`, latency as gauge or average, label data baked into names, and summaries used where fleet aggregation is needed.
- Rank findings by blast radius (a `user_id` label outranks a `_ms` suffix).
- Fix the top three in a PR with before/after series counts where relevant.

**Hints.**
- Grep for `.path`, `request.url`, `userId`, `Ms"`, `_kb`, and gauge-typed latency.
- `count by (__name__)(...)` on a live instance surfaces the real cardinality offenders fast.
- The highest-leverage fix is almost always replacing an identity label with a category.

**Self-check.**
- [ ] Your report lists findings ranked by impact, not alphabetically.
- [ ] The top finding is a real cardinality or correctness risk, not a style nit.
- [ ] Your PR shows a measurable improvement (series drop, correct units, histogram for latency).

---

## Capstone

These are open-ended scenarios. The point is not to find one correct answer but to design and defend a complete approach. Treat each as if you are pitching it to a staff engineer at a design review.

### Task 23: Instrument a polyglot system end to end

**Problem.** You have a three-service system: a Go API gateway, a Python worker, and a Node BFF, each calling the next. Instrument all three so that one Grafana dashboard gives RED for every service and USE for the resources they share (DB pool, message queue), with *consistent* metric names and label sets across all three languages.

**Constraints.**
- The same logical metric MUST have the same name and label set in all three services (`http_requests_total{method,route,status_class}` everywhere — not `latency_ms` in one and `request_seconds` in another).
- Bounded labels only; route templates only.
- One dashboard reads all three services uniformly.
- Saturation signals (in-flight, queue depth, pool utilisation) present on every hop.

**Hints.**
- Agree the metric contract *first* (names, units, label keys, value sets) as a shared doc, then implement per language.
- The hard part is label-set consistency across `client_golang`, `prometheus_client`, and `prom-client` — write a tiny per-language wrapper that enforces the contract.
- Cross-service dashboards only work if the names match exactly; a single typo (`route` vs `path`) breaks the uniform query.

**What "done" looks like.** You have a one-page metric contract (names, units, labels, expected value sets). Each of the three services emits exactly those metrics with bounded labels and route templates. One Grafana dashboard has a service-selector variable and renders RED + saturation identically for any of the three. You can demo: inject latency in the Python worker and watch *its* row light up while the others stay green, all from the same dashboard.

### Task 24: Wire OTEL metrics + traces + exemplars across the fleet

**Problem.** Extend Task 23: route all three services' metrics and traces through an OpenTelemetry Collector, with exemplars linking the latency histograms to traces, so an on-call can go from a fleet p99 spike to the exact slow distributed trace in two clicks.

**Constraints.**
- All three services export via OTLP to a shared Collector; the Collector fans out to Prometheus (metrics, with exemplars) and Tempo (traces).
- Exemplars on the latency histograms carry `trace_id`; trace context propagates across all three hops (W3C `traceparent`).
- The Collector enforces cardinality limits (drop/aggregate) before remote-write — defence in depth.
- Demonstrate the two-click path: p99 spike → exemplar → trace spanning all three services.

**Hints.**
- Context propagation must be unbroken across Go→Python→Node, or the exemplar links a histogram point to a single-service trace, not the full one.
- Put the cardinality guard in the Collector (`metricstransform`/filter processors) so no single service can OOM the backend.
- Exemplars need a sampling decision at record time — make sure your sampler isn't dropping the very requests that are slow (tail-based sampling helps here).

**What "done" looks like.** A unified observability stack where metrics and traces share `trace_id` via exemplars. You can demo: a slow checkout produces a p99 bump on the dashboard, the exemplar dot links to a trace spanning gateway→worker→BFF, and you can see which span dominated — all without touching a log. You have a written note on where cardinality is capped (Collector + client wrappers) and what the per-service series budget is.

### Task 25: Write the team's metrics standard and cardinality governance

**Problem.** Write the document a new engineer reads before adding their first metric, plus the automated guardrails that enforce it. The goal: nobody can OOM the TSDB by accident, and every service's metrics are queryable with the same dashboards.

**Constraints.**
- The standard covers: type selection, naming/units conventions, the bounded-label rule with examples, the route-template rule, RED/USE/golden-signals adoption, and the "identity goes to logs/traces, category to metrics" boundary.
- Governance covers: a per-service cardinality budget, a CI check or lint that flags suspicious labels, a TSDB series-count alert, and a client-side cap (allow-list / `maximumAllowableTags`).
- Include a short "incident playbook" for when a cardinality bomb is *already* live (find it with `topk`, drop the label via relabel, ship the fix).

**Hints.**
- Lead with the one piece of arithmetic that matters: cardinality is the product of label value counts.
- A good standard has a copy-pasteable "good vs bad labels" table and a "before you add a label, multiply the values" checklist.
- Governance must be automated — a wiki page nobody reads doesn't stop the next `merchant_id`; a CI lint and a series-count alert do.

**What "done" looks like.** A 2–3 page standard a new hire can apply in 20 minutes, with concrete good/bad examples in your team's languages. A working CI check or lint rule that flags a likely-unbounded label (matches `*_id`, `path`, `email`, raw URL) and fails the build or warns on the PR. A live TSDB series-count alert with a documented threshold and the relabel snippet to mitigate. A one-page incident playbook for an in-progress cardinality bomb. You can hand all of it to a new engineer and they ship a correct, bounded, well-named metric on their first try.

---

## If you can do all of these, you have the senior level

You can instrument a service in any of Go, Python, Java, Node, or Rust and emit RED metrics with bounded labels and route templates without thinking. You design histogram buckets to an SLO, know exactly why a summary can't be aggregated, and reach for native histograms when manual buckets stop paying off. You can reproduce, diagnose, and fix a cardinality explosion, and — more importantly — you've put the budget, the tripwire, and the client-side cap in place so it never happens. You can wire OpenTelemetry metrics with exemplars so a p99 spike links to the trace that caused it, and you can write the fleet-wide metric contract and governance that keeps a polyglot system uniform and the TSDB alive. The next step is not more metrics exercises — it is owning the SLOs these metrics feed, and designing systems whose health is legible from three numbers per service.

---

## Related Topics

- [Metrics — Junior](junior.md)
- [Metrics — Middle](middle.md)
- [Metrics — Senior](senior.md)
- [Metrics — Professional](professional.md)
- [Metrics — Interview](interview.md)
- Sibling diagnostic topics: [Logging](../logging/README.md), [Tracing](../tracing/README.md) — where identity (`user_id`, `request_id`) belongs.
- Cousins: [Monitoring & Alerting](../../../system-design/) — the SLOs and alerts these metrics feed.
